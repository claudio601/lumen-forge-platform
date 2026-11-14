// api/whatsapp/webhook.ts
// POST /api/whatsapp/webhook
// Recibe mensajes WhatsApp via Twilio. Valida firma, orquesta flowEngine,
// llama Claude para parsing, crea deal en Pipedrive y notifica si aplica.
// [CIERRE-HONESTO] Los cierres que dicen "quedo registrada" o "ya derive" solo salen si
// Pipedrive confirma el negocio; si no, el texto B (MSG_DEAL_FAILED). Si el paso del flujo
// falla, se responde igual (texto B) en vez de un 500 sin respuesta. Los mensajes de un mismo
// numero se atienden de a uno, con una espera acotada (ver acquirePhoneTurn).

import { waitUntil } from '@vercel/functions';
import { redact } from '../_lib/logging/redact.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateTwilioSignature, parseTwilioBody, buildTwiML, buildSilentTwiML } from '../_lib/whatsapp/twilio.js';
import { getHistory, addTurn } from '../_lib/whatsapp/conversation.js';
import { askClaude } from '../_lib/whatsapp/claudeAgent.js';
import type { ClaudeResult } from '../_lib/whatsapp/claudeAgent.js';
import { evaluateLeadSignals } from '../_lib/whatsapp/leadCapture.js';
import { buildWhatsAppUpdate, ensureWhatsAppDeal, notePart, noteSearchAt, retryWhatsAppWrite } from '../_lib/whatsapp/pipedriveLead.js';
import type { PendingWhatsAppWrite } from '../_lib/whatsapp/pipedriveLead.js';
import { notifyTeam } from '../_lib/whatsapp/notify.js';
import { processFlowStep, getFlowState, hasMediaNotice, recordDealOutcome, recordMediaReply, recordNoQuestion, withMediaNotice, MSG_MEDIA_NOTICE, MSG_DEAL_FAILED, MSG_DEAL_PENDING } from '../_lib/whatsapp/flowEngine.js';
import type { FlowResult } from '../_lib/whatsapp/flowEngine.js';
import { appendPrivacyNotice, privacyNoticeShown, withPrivacyNotice } from '../_lib/whatsapp/privacyNotice.js';
import type { FlowState } from '../_lib/whatsapp/flowEngine.js';
import {
  acquireConversationLock, claimMessage, completeMessage, loadConversation, persistConversation, enqueuePendingWrite,
  duePendingWrites, loadPendingWrites, claimPendingWrite, settlePendingWrite, beginFlowStep, settleFlowStep, claimRegistration, awaitRegistration,
  stampFlow, recordRegistrationOutcome, registrationOutcome, awaitConversationUnlock, confirmDealFields, sendablePendingWrite,
  anticipateWrite, retryDeliveredWrite, noteWriteKey, pendingLeaseUntil, pendingVersion, claimDealWrite, flowFieldStamp, sameData, MESSAGE_RETRY_WAIT_MS, MAX_PENDING_RETRIES_PER_TURN, MESSAGE_IN_PROGRESS_TTL_S,
} from '../_lib/whatsapp/stateStore.js';
import type { Anticipated, NoteDeliveryMark, QueuedWrite, RegistrationClaim } from '../_lib/whatsapp/stateStore.js';
import { botReplyText, clearTranscriptAfterNote, getTranscript, inboundText, noteEntryIds, recordTranscript, transcriptForNote } from '../_lib/whatsapp/transcript.js';

const LOG_PREFIX = '[whatsapp/webhook]';

/**
 * [CIERRE-HONESTO] Un mensaje a la vez por numero, en esta instancia: el paso del flujo, la
 * creacion del negocio y la anotacion de lo que respondio Pipedrive de un mensaje terminan antes
 * de que el siguiente mensaje del mismo numero entre al flujo. Sin esto, un "gracias" que llega
 * mientras se crea el negocio no sabe si quedo registrado, y el resultado de un negocio podia
 * quedar anotado en un pedido nuevo. El historial se recupera y Claude corre dentro de la fila. La espera termina,
 * a mas tardar, TURN_WAIT_DEADLINE_MS despues de que empezo este webhook (Twilio espera 15 s):
 * si el mensaje anterior todavia no termina, este sigue igual (flowEngine reintenta el registro).
 * [TRANSCRIPCION] En ese caso (overlapped) la memoria de la instancia es mas nueva que Upstash: el
 * mensaje anterior ya leyo el estado y lo guarda al terminar. Este no lo vuelve a leer ni reintenta
 * las escrituras pendientes: restaurar el estado guardado borraria lo que el anterior ya hizo
 * (flujo, historial y transcripcion), y reintentarlas a la vez las duplicaria.
 */
const TURN_WAIT_DEADLINE_MS = 10_000;
/**
 * [REGISTRO] Hasta cuando (desde que empezo este webhook) espera un mensaje el resultado del negocio que
 * esta registrando otro mensaje del numero: Twilio corta a los 15 s y despues falta guardar y responder.
 */
const REGISTRATION_WAIT_DEADLINE_MS = 12_500;
/** [REGISTRO] Margen entre los relojes de dos instancias al comparar la hora de las escrituras de la cola. */
const CLOCK_SKEW_MS = 1_000;
/**
 * [NOTA-REF] Presupuesto de la funcion desde que empezo el webhook (MESSAGE_IN_PROGRESS_TTL_S son 60 s de
 * funcion mas 15 de margen) y lo que tarda a lo mas el reintento de una nota incierta en segundo plano: la
 * busqueda (10 s, NOTE_SEARCH_TIMEOUT_MS en pipedriveLead.ts), la nota (15 s, client.ts) y Upstash.
 */
const FUNCTION_BUDGET_MS = (MESSAGE_IN_PROGRESS_TTL_S - 15) * 1000;
const UNSURE_NOTE_RETRY_MS = 30_000;
const phoneTurns = new Map<string, Promise<void>>();
/** Mensajes en curso por numero en esta instancia, incluidos los que dejaron de esperar. */
const liveTurns = new Map<string, number>();
/**
 * [CONCURRENCIA] Numero de orden de los mensajes del cliente que siguen en curso en esta instancia: la
 * nota de otro mensaje no los incluye ni los borra (cada uno va en la nota de su propio mensaje).
 */
const openMessages = new Map<string, Set<number>>();

function othersInFlight(phone: string, mine: number): Set<number> {
  const out = new Set<number>();
  for (const seq of openMessages.get(phone) ?? []) if (seq !== mine) { out.add(seq); out.add(seq + 1); }
  return out;
}

/**
 * [CONCURRENCIA] Mensajes de esta instancia que todavia no pasan por el flujo (numero de orden -> aviso de
 * que ya pasaron). Una correccion tardia espera a los anteriores (R10): si uno de ellos abre un pedido
 * nuevo, el correo que llego despues es de ese pedido, no del negocio anterior.
 */
const pendingSteps = new Map<string, Map<number, { done: Promise<void>; resolve: () => void }>>();

function trackStep(phone: string, seq: number): void {
  let steps = pendingSteps.get(phone);
  if (!steps) { steps = new Map(); pendingSteps.set(phone, steps); }
  let resolve: () => void = () => {};
  const done = new Promise<void>((r) => { resolve = r; });
  steps.set(seq, { done, resolve });
}

function stepDone(phone: string, seq: number): void {
  const steps = pendingSteps.get(phone);
  steps?.get(seq)?.resolve();
  steps?.delete(seq);
  if (steps && !steps.size) pendingSteps.delete(phone);
}

/** Espera, hasta `deadline`, a que los mensajes anteriores de esta instancia pasen por el flujo. */
async function awaitEarlierSteps(phone: string, seq: number, deadline: number): Promise<void> {
  const earlier = [...(pendingSteps.get(phone) ?? [])].filter(([s]) => s < seq).map(([, v]) => v.done);
  const remaining = deadline - Date.now();
  if (!earlier.length || remaining <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(earlier), new Promise<void>((resolve) => { timer = setTimeout(resolve, remaining); })]);
  clearTimeout(timer);
}

/**
 * [PENDIENTES] Reintenta una escritura de la cola. [REGISTRO] R4: sin los campos que ya supero una escritura
 * de un mensaje posterior (sale la nota); sin la reserva de los campos (`mayWriteFields`), los campos esperan
 * en la cola y sale solo la nota. Los campos que Pipedrive confirma quedan anotados con su numero de orden.
 * [NOTA-REF] La nota va con su referencia y sus marcas de envio incierto (notePart): sin ellas, el reintento
 * siguiente la repetiria sin buscarla. Con `noteLater`, la nota espera en la cola (sale en segundo plano,
 * retryUnsureNotes) y se mandan solo los campos.
 */
async function retryQueuedWrite(phone: string, item: QueuedWrite, mayWriteFields: boolean, noteLater = false): Promise<boolean> {
  const write = sendablePendingWrite(phone, item);
  const heldFields = write?.fields && !mayWriteFields ? write.fields : undefined;
  const heldNote = noteLater && write?.note !== undefined ? notePart(write) : undefined;
  const base: PendingWhatsAppWrite | undefined = write && { dealId: write.dealId, ...(write.personId ? { personId: write.personId } : {}) };
  const toSend: PendingWhatsAppWrite | undefined = write && (heldFields || heldNote)
    ? { ...base!, ...(heldFields || !write.fields ? {} : { fields: write.fields }), ...(heldNote ? {} : notePart(write)) }
    : write;
  const left = toSend && (toSend.fields || toSend.note !== undefined) ? await retryWhatsAppWrite(toSend) : undefined;
  if (toSend?.fields && !left?.fields) await confirmDealFields(phone, toSend.dealId, pendingVersion(item));
  // Lo que espera (los campos sin su reserva, la nota para despues) sigue en la cola, con lo que no llego.
  const fields = heldFields ?? left?.fields;
  const remaining = heldFields || heldNote ? { ...base!, ...(heldNote ?? notePart(left)), ...(fields ? { fields } : {}) } : left;
  await settlePendingWrite(phone, item.id, remaining);
  // Pipedrive recibio lo que se le mando (false: algo fallo y sigue en la cola).
  return !left;
}

/**
 * [NOTA-REF] Las notas con un envio incierto se buscan antes de repetirlas (pipedriveLead.ts). Esa busqueda
 * (hasta 10 s) y el envio salen en segundo plano, con waitUntil: la respuesta no los espera (Twilio corta a
 * los 15 s). Si el corte del ultimo envio incierto es de hace menos de NOTE_SETTLE_MS, se espera hasta el
 * plazo, solo si el reintento todavia cabe en la funcion (hasta `deadline`): asi un mensaje que llega dentro
 * del plazo no la deja esperando a otro mensaje que quizas no llega. Lo que no cabe sigue en la cola para un
 * mensaje siguiente; si la funcion se corta a mitad, la reserva queda sin cerrar y quien la tome despues la
 * busca antes de repetirla. Sale solo la nota: los campos esperan su reserva en la cola. Nunca rechaza
 * (inBackground).
 */
async function retryUnsureNotes(phone: string, items: QueuedWrite[], deadline: number): Promise<void> {
  for (const item of items) {
    const at = Math.max(Date.now(), pendingLeaseUntil(phone, item.id), noteSearchAt(sendablePendingWrite(phone, item)) ?? 0);
    if (at + UNSURE_NOTE_RETRY_MS > deadline) continue;
    if (at > Date.now()) await new Promise<void>((resolve) => setTimeout(resolve, at - Date.now()));
    if (!(await claimPendingWrite(phone, item.id))) continue;
    await retryQueuedWrite(phone, item, false);
  }
}

/** [REGISTRO] Vueltas de releaseDealWrite: lo que otro mensaje deja en la cola justo antes de que se suelte la reserva. */
const MAX_HANDOFF_ROUNDS = 3;

/** [REGISTRO] Lo que otros mensajes dejaron en la cola con campos desde `since`, en el orden de los mensajes. */
async function handedWrites(phone: string, since: number, skip: (item: QueuedWrite) => boolean): Promise<QueuedWrite[]> {
  return (await loadPendingWrites(phone))
    .filter((item) => item.write.fields && !skip(item) && item.at >= since - CLOCK_SKEW_MS)
    .sort((a, b) => pendingVersion(a) - pendingVersion(b) || a.at - b.at);
}

/**
 * [REGISTRO] R4: lo que otros mensajes dejaron en la cola (escrituras con campos) mientras este tenia la
 * reserva de los campos (desde `since`): quien la tiene lo manda antes de soltarla, en el orden de los
 * mensajes, sin los campos que ya supero uno posterior. Asi Pipedrive termina con el valor del mensaje mas
 * nuevo sin esperar otro mensaje del numero (si esta instancia se corta antes, o si Pipedrive le fallo a
 * este, `flush` false, salen con un mensaje siguiente, como cualquier pendiente). `skip`: las que este
 * mensaje ya intento o dejo el mismo (no se reintentan en el mismo mensaje). Despues de soltarla revisa la
 * cola otra vez: quien dejo algo entre la ultima lectura y la liberacion no consiguio la reserva y cuenta con
 * que este lo mande (si otro la tomo mientras tanto, lo manda ese al soltarla). Hasta MAX_HANDOFF_ROUNDS
 * vueltas, y cada escritura se intenta una vez por llamada: lo que quede sale con un mensaje siguiente.
 */
async function releaseDealWrite(phone: string, claim: RegistrationClaim, since: number, flush = true, skip: (item: QueuedWrite) => boolean = () => false, leaseUntil = Infinity): Promise<void> {
  let held: RegistrationClaim | undefined = claim;
  const tried = new Set<string>();
  const handed = () => handedWrites(phone, since, (item) => skip(item) || tried.has(item.id));
  try {
    if (!flush) return;
    for (let round = 1; ; round++) {
      for (const item of await handed()) {
        tried.add(item.id);
        if (!(await claimPendingWrite(phone, item.id))) continue;
        await retryQueuedWrite(phone, item, true);
      }
      const done: RegistrationClaim = held;
      held = undefined;
      await done.release();
      if (round >= MAX_HANDOFF_ROUNDS || !(await handed()).length) return;
      const again = await claimDealWrite(phone, leaseUntil);
      if (!again.claimed) return;
      held = again;
    }
  } finally {
    await held?.release();
  }
}

/**
 * [REGISTRO] Este mensaje dejo su escritura en la cola (desde `since`) porque otro tenia la reserva de los
 * campos: si ese ya la solto, la manda este. Si todavia la tiene, la manda el al soltarla (releaseDealWrite).
 */
async function handOffDealWrite(phone: string, since: number, leaseUntil: number): Promise<void> {
  const claim = await claimDealWrite(phone, leaseUntil);
  if (claim.claimed) await releaseDealWrite(phone, claim, since, true, undefined, leaseUntil);
}

/**
 * [REGISTRO] R4: lo que manda la cola por otros mensajes (releaseDealWrite, handOffDealWrite) sigue en segundo
 * plano, con waitUntil (Vercel mantiene la funcion hasta que termina, dentro de su duracion maxima): la
 * respuesta de este mensaje no espera las escrituras de otro (antes podia pasar los 15 s de Twilio). Si la
 * funcion se corta antes, la reserva de los campos vence (REGISTRATION_TTL_MS) y lo que falta sale con un
 * mensaje siguiente; mientras tanto, las escrituras de campos del numero esperan en la cola. Nunca rechaza.
 */
function inBackground(work: () => Promise<void>): void {
  const done = work().catch((err) => {
    console.error(LOG_PREFIX + ' Escrituras de la cola en segundo plano (non-fatal):', redact(err, 'error'));
  });
  waitUntil(done);
}

async function acquirePhoneTurn(phone: string, maxWaitMs: number): Promise<{ release: () => void; overlapped: boolean }> {
    const previous = phoneTurns.get(phone);
    let release: () => void = () => {};
    const mine = new Promise<void>((resolve) => { release = resolve; });
    phoneTurns.set(phone, mine);
    if (previous && maxWaitMs > 0) {
          await new Promise<void>((resolve) => {
                  const timer = setTimeout(resolve, maxWaitMs);
                  void previous.then(() => { clearTimeout(timer); resolve(); });
          });
    }
    const live = liveTurns.get(phone) ?? 0;
    liveTurns.set(phone, live + 1);
    return {
          overlapped: live > 0,
          release: () => {
                  release();
                  if (phoneTurns.get(phone) === mine) phoneTurns.delete(phone);
                  const left = (liveTurns.get(phone) ?? 1) - 1;
                  if (left > 0) liveTurns.set(phone, left);
                  else liveTurns.delete(phone);
          },
    };
}

type DealResult = Awaited<ReturnType<typeof ensureWhatsAppDeal>>;

/**
 * [RESPUESTA] La linea del log sobre la respuesta de Claude (informe de Codex del 10-11, punto 3): "Claude ok" solo
 * si se uso entera; si no, que quedo con su valor por defecto y por que. Solo nombres de campo, motivos,
 * stop_reason y largo: nunca el texto del cliente ni lo que devolvio Claude. `usable: false`: nada de la
 * respuesta se uso (el paso queda de las reglas del flujo).
 */
function claudeLogLine(result: Pick<ClaudeResult, 'parsed'> & { diagnostics?: ClaudeResult['diagnostics'] }): { level: 'log' | 'warn'; message: string; usable: boolean } {
    const d = result.diagnostics;
    if (!d?.usedDefaults) return { level: 'log', message: 'Claude ok — wantsHuman: ' + result.parsed.wantsHuman, usable: true };
    const tail = ' stop_reason=' + (d.stopReason ?? 'ninguno') + ' largo=' + d.length;
    if (d.reason) return { level: 'warn', message: 'Claude sin datos utilizables, valores por defecto en todos los campos: motivo=' + d.reason + tail, usable: false };
    const fields = Object.entries(d.fields).map(([name, why]) => name + '=' + why).join(',');
    return { level: 'warn', message: 'Claude con valores por defecto en ' + fields + tail, usable: true };
}

interface FlowTurnInput {
    phone: string;
    messageSid: string;
    body: string;
    profileName: string;
    claudeParsed: Parameters<typeof processFlowStep>[2];
    claudeSummary: string;
    signals: Parameters<typeof processFlowStep>[3];
    aiSource: 'claude' | 'heuristic';
    /** [TRANSCRIPCION] Numero de orden del mensaje del cliente: la nota llega hasta ahi. */
    transcriptSeq: number;
    /** [TRANSCRIPCION] La respuesta de este mensaje lleva el aviso de privacidad (se decide una vez). */
    noticeDue: boolean;
    /** [CONCURRENCIA] El flujo como lo leyo este mensaje al empezar: base de la mezcla de su paso. */
    flowBase: FlowState;
    /** Date.now() del inicio del webhook (plazos de Twilio). */
    startedAt: number;
    /** [REGISTRO] La reserva del registro, si este mensaje la tomo: se libera despues de guardar su resultado. */
    registration: { release?: () => Promise<void> };
    /** [CONCURRENCIA] Este mensaje espero el candado sin conseguirlo: otra instancia atiende uno anterior. */
    contended: boolean;
    /**
     * [CONCURRENCIA] Marca el candado de la conversacion (si este mensaje lo tiene): su paso ya quedo guardado y
     * sigue una llamada lenta a Pipedrive. Una correccion que espera en otra instancia (R10) ya puede seguir.
     */
    markStepped: () => Promise<void>;
}

/**
 * Paso del flujo, negocio en Pipedrive e historial de un mensaje (dentro del turno del numero).
 * [TRANSCRIPCION] noted: la nota del negocio ya trae la transcripcion con esta respuesta.
 * [REGISTRO] followUp: lo nuevo de este mensaje fue al negocio que registro otro mensaje (P3): ventas ya
 * recibio el aviso de ese registro.
 */
async function runFlowTurn(t: FlowTurnInput): Promise<{ flowResult: FlowResult; dealResult: DealResult; reply: string; noted: boolean; followUp: boolean }> {
  const { phone, body, profileName, claudeParsed, claudeSummary, signals, aiSource, transcriptSeq, noticeDue, messageSid } = t;
  // Plazo de las esperas de este mensaje (Twilio corta a los 15 s y despues falta guardar y responder).
  const waitDeadline = t.startedAt + REGISTRATION_WAIT_DEADLINE_MS;

  /** El paso del flujo de este mensaje sobre `base` (lo que leyo), mezclado con lo que ya cambio otro. */
  function step(base: FlowState): { flowResult: FlowResult; conversationId: number } {
    let flowResult: FlowResult;
    // [CONCURRENCIA] Si un mensaje posterior ya paso por el flujo, el paso de este corre sobre lo que este
    // leyo (base) y despues se mezcla con el estado actual (H4). Sin await hasta settleFlowStep.
    const current = beginFlowStep(phone, transcriptSeq, base);
    try {
          flowResult = processFlowStep(phone, body, claudeParsed, signals);
    } catch (err) {
          // [CIERRE-HONESTO] Respuesta segura: nada quedo registrado, se ofrece ventas@ (texto B).
          console.error(LOG_PREFIX + ' Flow error (respuesta segura):', redact(err, 'error'));
          // [CANTIDAD] El texto B no pregunta nada: un numero siguiente no contesta la lista anterior.
          recordNoQuestion(phone);
          const stateNow = getFlowState(phone);
          flowResult = {
                  // [ARCHIVOS] Con imagenes o archivos, tambien el aviso de que no pasan a la solicitud.
                  reply: signals.hasMedia ? withMediaNotice(MSG_DEAL_FAILED) : MSG_DEAL_FAILED,
                  shouldCreateDeal: false,
                  shouldNotify: false,
                  captureStatus: stateNow.captureStatus,
                  captured: stateNow.captured,
                  wantsHuman: stateNow.wantsHuman,
                  closedFlow: false,
          };
    }
    // [CONCURRENCIA] Un mensaje posterior que ya termino no queda pisado por el paso de este (H4): si
    // se conserva un dato suyo, el negocio de este mensaje lleva el estado mezclado.
    const settledStep = settleFlowStep(phone, transcriptSeq, base, current);
    if (settledStep.captured) flowResult = { ...flowResult, captured: settledStep.captured };
    // La conversacion que pidio el negocio (si mientras tanto empieza otra, el resultado no va ahi).
    return { flowResult, conversationId: settledStep.conversationId };
  }

  let { flowResult, conversationId } = step(t.flowBase);
  if (flowResult.rutUpdate) {
        // [CONCURRENCIA] R10: una correccion tardia (RUT o correo) escribe en el negocio anterior. Antes espera a
        // los mensajes que llegaron antes y siguen sin pasar por el flujo: en esta instancia, su paso; en otra
        // (este espero el candado sin conseguirlo), que suelte el candado o lo marque (markStepped: su paso ya
        // quedo guardado y sigue con Pipedrive). Si uno de
        // ellos abrio un pedido nuevo, este mensaje se aplica a ese pedido (como si hubiera llegado despues),
        // no al negocio anterior. Si el plazo se acaba antes, sigue como antes (riesgo conocido).
        await awaitEarlierSteps(phone, transcriptSeq, waitDeadline);
        if (t.contended && await awaitConversationUnlock(phone, waitDeadline)) await loadConversation(phone);
        // Solo si el pedido nuevo lo abrio un mensaje que llego antes que este (su marca, flowFieldStamp): si lo
        // abrio uno que llego despues, este mensaje es de la conversacion anterior y la correccion va a su negocio.
        if (getFlowState(phone).firstMessageAt !== conversationId && flowFieldStamp(phone, 'firstMessageAt') < transcriptSeq) {
                console.log(LOG_PREFIX + ' Un mensaje anterior abrio otro pedido: este mensaje se aplica al pedido nuevo');
                ({ flowResult, conversationId } = step(structuredClone(getFlowState(phone))));
        }
  }
  // [REGISTRO] Lo que dejo el paso de este mensaje, antes de mezclarlo con lo de otro (P3: que trajo de nuevo).
  const stepCaptured = flowResult.captured;
  // Los mensajes posteriores que esperaban el paso de este ya pueden seguir.
  stepDone(phone, transcriptSeq);
  addTurn(phone, { role: 'user', content: body }, transcriptSeq);

  // Log de salida: resultado del flujo para QA
  console.log(LOG_PREFIX + ' [QA:out] ' + JSON.stringify({
        ai: aiSource,
        closed: flowResult.closedFlow,
        capture_status: flowResult.captureStatus,
        wants_human: flowResult.wantsHuman,
        slots_after: {
                producto: Boolean(flowResult.captured.producto),
                tipo_de_luz: Boolean(flowResult.captured.tipo_de_luz),
                cantidad: Boolean(flowResult.captured.cantidad),
                proyecto_o_uso: Boolean(flowResult.captured.proyecto_o_uso),
                comuna_o_ciudad: Boolean(flowResult.captured.comuna_o_ciudad),
                nombre_o_empresa: Boolean(flowResult.captured.nombre_o_empresa),
                correo: Boolean(flowResult.captured.correo),
        },
        reply_caracteres: flowResult.reply.length,
  }));

  let dealResult: DealResult = {
        action: 'skipped',
  };

  let noteIds: string[] = [];
  let previousNoteIds: string[] = [];
  let noteKept = true;
  // [NOTA-REF] El rastro previo decide tambien que lineas ya quedaron en una nota.
  let trace: NoteDeliveryMark | QueuedWrite | undefined;
  let anticipated: Anticipated | undefined;
  let fieldsSent = true;
  const changed = !sameData(stepCaptured, t.flowBase.captured);
  // [REGISTRO] Otro mensaje del numero registra (o ya registro) el negocio de esta conversacion: este no lo
  // repite. Su resultado decide la respuesta y este mensaje queda en la transcripcion para la nota siguiente.
  let deferred = false;
  // [REGISTRO] La espera de la reserva de otro mensaje termino (no se acabo el plazo).
  let finished = false;
  // [REGISTRO] El negocio ya registrado en el que este mensaje escribe sus campos y su nota: el de la correccion
  // tardia (RUT o correo) o, si otro mensaje registro esta conversacion mientras este traia un dato nuevo
  // (un correo corregido durante el registro), el que registro ese.
  let updateDealId: number | undefined;
  if (flowResult.shouldCreateDeal && flowResult.rutUpdate) {
        // La correccion va al negocio de su conversacion: el del flujo si sigue activa; si otro mensaje abrio
        // otra mientras tanto, el que anoto su registro. Sin negocio conocido no crea otro.
        const now = getFlowState(phone);
        updateDealId = (now.firstMessageAt === conversationId ? now.dealId : undefined) ?? registrationOutcome(phone, conversationId)?.dealId;
        if (updateDealId === undefined) console.warn(LOG_PREFIX + ' Dato posterior al cierre sin negocio conocido para su conversacion: no se escribe');
  } else if (flowResult.shouldCreateDeal) {
        // [REGISTRO] La reserva va antes del guardado: quien lea la conversacion cerrada y sin negocio ya la ve.
        // Solo la toma un registro: una correccion o un reintento de campos usan la de los campos (R4), y un
        // pedido nuevo no espera por ellos.
        let claim = await claimRegistration(phone, t.startedAt + FUNCTION_BUDGET_MS + 5_000);
        if (!claim.claimed) {
                finished = await awaitRegistration(phone, claim.heldBy ?? 'remote', waitDeadline);
                const now = getFlowState(phone);
                // La reserva del otro termino sin resultado para esta conversacion (su instancia se corto y la
                // reserva vencio): este mensaje registra la solicitud, como el reintento de flowEngine.
                const unregistered = !registrationOutcome(phone, conversationId) && now.firstMessageAt === conversationId && !now.deal;
                if (finished && unregistered) claim = await claimRegistration(phone, t.startedAt + FUNCTION_BUDGET_MS + 5_000);
        }
        if (claim.claimed) {
                t.registration.release = claim.release;
                // [CONCURRENCIA] La conversacion queda guardada antes de la llamada lenta a Pipedrive: un mensaje
                // que entra mientras tanto en otra instancia parte de aqui. Lo que esa instancia cambio y se
                // mezcla al guardar (una comuna corregida) va tambien en el negocio de este mensaje.
                if ((await persistConversation(phone)) !== 'memory') await t.markStepped();
                const settled = getFlowState(phone);
                if (settled.firstMessageAt === conversationId) flowResult = { ...flowResult, captured: settled.captured };
                // [REGISTRO] Otro mensaje que termino justo antes ya dejo el resultado (llego al guardar).
                deferred = Boolean(registrationOutcome(phone, conversationId)) || (settled.firstMessageAt === conversationId && Boolean(settled.deal));
                if (deferred) console.log(LOG_PREFIX + ' El negocio de esta conversacion ya tiene resultado: este mensaje no lo repite');
        } else {
                deferred = true;
                console.log(LOG_PREFIX + ' Otro mensaje del numero registra el negocio: este no lo repite');
        }
        if (deferred) {
                // [REGISTRO] R4 (P3): este mensaje cambio un dato (un correo corregido) mientras otro registraba la
                // solicitud con el anterior. Con el negocio ya registrado, lo suyo va a ese negocio como una
                // correccion: Pipedrive termina con el dato del mensaje que llego despues.
                const now = getFlowState(phone);
                const ours = now.firstMessageAt === conversationId;
                const outcome = registrationOutcome(phone, conversationId);
                const registeredDeal = outcome
                        ? (outcome.deal === 'registered' ? outcome.dealId : undefined)
                        : (ours && now.deal === 'registered' ? now.dealId : undefined);
                if (registeredDeal !== undefined && !sameData(stepCaptured, t.flowBase.captured)) {
                        updateDealId = registeredDeal;
                        if (ours) flowResult = { ...flowResult, captured: now.captured };
                        console.log(LOG_PREFIX + ' Otro mensaje registro el negocio con datos anteriores: lo nuevo de este va a ese negocio');
                }
        }
  }
  // [REGISTRO] R4: la reserva de los campos, sin esperar. Una escritura en un negocio que ya existe sin ella
  // va a la cola (antes esperaba hasta 12,5 s y la respuesta podia pasar los 15 s de Twilio): quien la tiene
  // la manda al terminar la suya. Un registro no la espera (un pedido nuevo no queda sin registrar por una
  // correccion), pero si se junta con un negocio en el que otro esta escribiendo, sus campos vuelven a la
  // cola para que ese los mande despues de los suyos. Sin Upstash, solo dentro de la instancia.
  const fieldsClaim = updateDealId !== undefined || (flowResult.shouldCreateDeal && !flowResult.rutUpdate && !deferred)
        ? await claimDealWrite(phone, t.startedAt + FUNCTION_BUDGET_MS + 5_000)
        : undefined;
  const claimedAt = Date.now();
  if (fieldsClaim?.claimed && updateDealId !== undefined) {
        // [CONCURRENCIA] Como el registro: guardada antes de la llamada lenta a Pipedrive.
        if ((await persistConversation(phone)) !== 'memory') await t.markStepped();
        const settled = getFlowState(phone);
        if (settled.firstMessageAt === conversationId) flowResult = { ...flowResult, captured: settled.captured };
  }
  if (fieldsClaim) {
        const noteOpts = { upTo: transcriptSeq, exclude: othersInFlight(phone, transcriptSeq) };
        noteIds = noteEntryIds(phone, noteOpts);
        try {
                const lead = {
                          phone,
                          name: profileName || phone,
                          summary: claudeSummary,
                          body,
                          captured: flowResult.captured,
                          captureStatus: flowResult.captureStatus,
                          wantsHuman: flowResult.wantsHuman,
                          // [REGISTRO] (revision 13-11) En un negocio que ya existe, el tipo del flujo, no el del mensaje.
                          flowLeadType: getFlowState(phone).leadType,
                          // [TRANSCRIPCION] Hasta este mensaje, con la respuesta que lo acompana (y la marca del
                          // aviso de privacidad si la lleva): lo que llegue mientras tanto va a la nota siguiente.
                          transcript: transcriptForNote(phone, { ...noteOpts, reply: botReplyText(flowResult.reply, noticeDue) }),
                };
                // [NOTA-REF] La clave del registro vive desde el primer mensaje; la de correccion, desde su sid.
                const remember = (result: Anticipated): void => {
                        anticipated = result;
                        if (result.status === 'queued' || result.status === 'delivered') {
                                trace = result.status === 'queued' ? result.item : result.mark;
                                if (result.status === 'queued') inBackground(() => retryUnsureNotes(phone, [result.item], t.startedAt + FUNCTION_BUDGET_MS));
                        }
                };
                const anticipate = async (write: PendingWhatsAppWrite, kind: 'r' | 'm', reserve = true): Promise<Anticipated | undefined> => {
                        const key = noteWriteKey(kind, kind === 'r' ? String(conversationId) : messageSid, write.dealId);
                        if (!key) return undefined;
                        const result = await anticipateWrite(phone, write, { key, ver: transcriptSeq, sid: messageSid, noteIds, reserve, leaseUntil: t.startedAt + FUNCTION_BUDGET_MS + 5_000 });
                        remember(result);
                        return result;
                };
                const beforeNote = async (write: PendingWhatsAppWrite): Promise<PendingWhatsAppWrite> => {
                        const kind = updateDealId === undefined ? 'r' : 'm';
                        let result = await anticipate(write, kind);
                        if (!result || result.status === 'new' || result.status === 'memory' || result.status === 'full') return write;
                        const previous = result.status === 'queued' ? result.item : result.mark;
                        const sameSid = Boolean(messageSid && previous.sid && messageSid === previous.sid);
                        if (kind === 'r' && !sameSid && changed) {
                                trace = undefined;
                                // [NOTA-REF] La correccion no repite las lineas que ya lleva el registro.
                                previousNoteIds = previous.noteIds ?? [];
                                const previousIds = new Set(previousNoteIds);
                                const exclude = new Set(noteOpts.exclude);
                                for (const e of getTranscript(phone)?.entries ?? []) if (previousIds.has(e.id)) exclude.add(e.seq);
                                noteIds = noteEntryIds(phone, { ...noteOpts, exclude });
                                const correction = buildWhatsAppUpdate({ ...lead, existingDealId: write.dealId,
                                        transcript: transcriptForNote(phone, { ...noteOpts, exclude, reply: botReplyText(flowResult.reply, noticeDue) }) });
                                write = { ...write, note: correction.note, noteRef: correction.noteRef };
                                result = await anticipate(write, 'm');
                                if (!result || result.status === 'new' || result.status === 'memory' || result.status === 'full') return write;
                        } else if (kind === 'r') {
                                return { dealId: write.dealId, ...(write.fields ? { fields: write.fields } : {}) };
                        }
                        fieldsSent = false;
                        return { dealId: write.dealId };
                };
                let reassert: PendingWhatsAppWrite | undefined;
                if (updateDealId !== undefined && !fieldsClaim.claimed) {
                        console.log(LOG_PREFIX + ' Otro mensaje del numero esta escribiendo en el negocio: esta escritura va a la cola, en orden');
                        const write = buildWhatsAppUpdate({ ...lead, existingDealId: updateDealId });
                        const result = await anticipate(write, 'm', false);
                        if (result && result.status !== 'full') {
                                dealResult = { dealId: updateDealId, action: 'found', ...('item' in result && result.status !== 'queued' ? { pendingWrite: result.item.write } : {}) };
                        } else dealResult = { dealId: updateDealId, action: 'found', pendingWrite: write };
                } else {
                        dealResult = await ensureWhatsAppDeal({ ...lead, beforeNote, ...(updateDealId !== undefined ? { existingDealId: updateDealId } : {}) });
                        const sent = fieldsSent && typeof dealResult.dealId === 'number' && !dealResult.pendingWrite?.fields;
                        if (sent && !fieldsClaim.claimed && dealResult.action === 'found') {
                                reassert = { dealId: dealResult.dealId!, fields: buildWhatsAppUpdate({ ...lead, existingDealId: dealResult.dealId! }).fields };
                        } else if (sent) {
                                // [REGISTRO] R4: los campos que Pipedrive confirmo quedan anotados con el numero de este
                                // mensaje: la cola no vuelve a mandar los de un mensaje anterior.
                                await confirmDealFields(phone, dealResult.dealId!, transcriptSeq);
                        }
                }
                // [PENDIENTES] Si la cola esta llena, la nota no entra: la transcripcion se conserva para la nota
                // siguiente, si la hay (con el tope del estado puede omitir mensajes del medio). Los campos
                // entran igual (enqueuePendingWrite); si ni ellos caben (tope duro), tambien se conserva.
                if (anticipated && (anticipated.status === 'new' || anticipated.status === 'memory')) {
                        const item = anticipated.item;
                        // [NOTA-REF] Sin reserva se dejo para handOff; no se cierra un intento que aun no ocurrio.
                        if (fieldsClaim.claimed || updateDealId === undefined) inBackground(() => settlePendingWrite(phone, item.id, dealResult.pendingWrite));
                        else if (anticipated.status === 'memory') inBackground(async () => { await loadPendingWrites(phone); });
                } else if (dealResult.pendingWrite) {
                        const queued = await enqueuePendingWrite(phone, dealResult.pendingWrite, transcriptSeq);
                        if (!queued) noteKept = false;
                }
                if (reassert?.fields && Object.keys(reassert.fields).length) await enqueuePendingWrite(phone, reassert, transcriptSeq);
                // Lo que este mensaje dejo en la cola a proposito (no lo que fallo en Pipedrive): si quien tenia la
                // reserva ya la solto, lo manda este, en segundo plano (la respuesta no lo espera).
                if (!fieldsClaim.claimed && (reassert || updateDealId !== undefined)) inBackground(() => handOffDealWrite(phone, claimedAt, t.startedAt + FUNCTION_BUDGET_MS + 5_000));
        } catch (err) {
                console.error(LOG_PREFIX + ' Pipedrive error (non-fatal):', redact(err, 'error'));
        } finally {
                // Lo de otros, solo si a este Pipedrive le respondio (si fallo, queda en la cola para un mensaje
                // siguiente), en segundo plano: la respuesta de este mensaje no espera las escrituras de otros.
                const delivered = typeof dealResult.dealId === 'number' && !dealResult.pendingWrite;
                if (fieldsClaim.claimed) inBackground(() => releaseDealWrite(phone, fieldsClaim, claimedAt, delivered, (item) => pendingVersion(item) === transcriptSeq, t.startedAt + FUNCTION_BUDGET_MS + 5_000));
        }
  }

  // [CIERRE-HONESTO] El cierre solo afirma el registro si Pipedrive devolvio el negocio.
  let reply = flowResult.reply;
    if (deferred) {
          // [REGISTRO] El resultado es el del otro mensaje: "quedo registrada" solo si Pipedrive lo confirmo; si
          // fallo, el texto B; si todavia no termina, MSG_DEAL_PENDING (no afirma el registro ni el fallo).
          // R11: se consulta el resultado de esta conversacion, no el flujo activo del numero (otro mensaje pudo
          // abrir otra conversacion mientras tanto). Si el otro termino sin registrarla y ya no es la activa,
          // nadie la registro: el texto B.
          const now = getFlowState(phone);
          const ours = now.firstMessageAt === conversationId;
          const deal = registrationOutcome(phone, conversationId)?.deal ?? (ours ? now.deal : undefined);
          if (deal !== 'registered') reply = deal === 'failed' || (finished && !ours) ? MSG_DEAL_FAILED : MSG_DEAL_PENDING;
    } else if (flowResult.shouldCreateDeal) {
          const registered = (dealResult.action === 'created' || dealResult.action === 'found') && typeof dealResult.dealId === 'number';
          if (flowResult.rutUpdate && !registered) {
                  // [RUT-VALIDO] El RUT llego despues del cierre: el negocio ya estaba registrado y sigue.
                  console.warn(LOG_PREFIX + ' Dato posterior al cierre (RUT o correo) sin confirmar en Pipedrive (' + dealResult.action + ') - el negocio anterior sigue');
          } else {
                  recordDealOutcome(phone, registered, conversationId, dealResult.dealId);
                  // [REGISTRO] R11: tambien por conversacion, para quien espera este registro aunque el numero ya
                  // este en otra. [CONCURRENCIA] El resultado lleva la marca de este mensaje.
                  recordRegistrationOutcome(phone, conversationId, registered, dealResult.dealId);
                  stampFlow(phone, transcriptSeq);
                  if (!registered) {
                          console.warn(LOG_PREFIX + ' Negocio no confirmado (' + dealResult.action + ') — respondiendo MSG_DEAL_FAILED');
                          reply = MSG_DEAL_FAILED;
                  }
          }
    }
  // [ARCHIVOS] El texto que reemplaza la respuesta del paso (registro fallido o pendiente) conserva delante el aviso
  // de que las imagenes y los archivos no pasan a la solicitud.
  if (reply !== flowResult.reply && hasMediaNotice(flowResult.reply)) reply = withMediaNotice(reply);

  // [TRANSCRIPCION] La nota (o su reintento pendiente) ya lleva la conversacion hasta esta respuesta:
  // se borra solo eso, no lo que otro pedido del mismo numero registro mientras Pipedrive respondia.
  // [CONCURRENCIA] Por id: solo lo que fue en la nota, aunque mientras tanto se haya mezclado algo mas.
  let noted = typeof dealResult.dealId === 'number' && reply === flowResult.reply && noteKept;
  if (trace) {
        const sameSid = Boolean(messageSid && trace.sid && messageSid === trace.sid);
        const repeated = sameSid ? (getTranscript(phone)?.entries ?? []).filter((e) => e.seq === transcriptSeq).map((e) => e.id) : [];
        clearTranscriptAfterNote(phone, [...(trace.noteIds ?? []), ...previousNoteIds, ...repeated]);
        noted = sameSid;
  } else if (noted) clearTranscriptAfterNote(phone, [...previousNoteIds, ...noteIds]);

  addTurn(phone, { role: 'assistant', content: reply }, transcriptSeq + 1);

  return { flowResult, dealResult, reply, noted, followUp: deferred && updateDealId !== undefined };
}

export const config = { api: { bodyParser: false } };

function readRawBody(req: VercelRequest): Promise<Buffer> {
    return new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    const startedAt = Date.now(); // plazo de Twilio para el aviso de privacidad (privacyNotice.ts)
    if (req.method !== 'POST') {
          res.status(405).end();
          return;
    }

  let rawBody: Buffer;
    try {
          rawBody = await readRawBody(req);
    } catch {
          console.error(LOG_PREFIX + ' Failed to read body');
          res.status(400).end();
          return;
    }

  const params = parseTwilioBody(rawBody.toString('utf-8'));
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
    const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
    const webhookUrl = baseUrl + '/api/whatsapp/webhook';
    const twilioSig = (req.headers['x-twilio-signature'] as string) ?? '';
    const skipValidation = process.env.TWILIO_SKIP_VALIDATION === 'true';

  if (!skipValidation) {
        if (!validateTwilioSignature(authToken, webhookUrl, params, twilioSig)) {
                console.warn(LOG_PREFIX + ' Invalid Twilio signature');
                res.status(403).end();
                return;
        }
  }

  const from = params['From'] ?? '';
    const body = params['Body'] ?? '';
    const profileName = params['ProfileName'] ?? '';
    const messageSid = params['MessageSid'] ?? '';
    const numMedia = parseInt(params['NumMedia'] ?? '0', 10);

  if (!from) {
        res.status(400).end();
        return;
  }

  const phone = from.replace('whatsapp:', '');

  const claim = await claimMessage(messageSid, MESSAGE_RETRY_WAIT_MS - (Date.now() - startedAt));
  if (!claim.proceed) {
        if (claim.response === undefined) {
              res.status(503).end();
              return;
        }
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(claim.response);
        return;
  }

  const phoneTurn = await acquirePhoneTurn(phone, TURN_WAIT_DEADLINE_MS - (Date.now() - startedAt));
  let distributed: Awaited<ReturnType<typeof acquireConversationLock>> | undefined;
  let transcriptSeq: number | undefined;
  // [REGISTRO] La reserva del registro del negocio, si este mensaje la toma (runFlowTurn).
  const registration: { release?: () => Promise<void> } = {};
  try {
    distributed = await acquireConversationLock(phone, TURN_WAIT_DEADLINE_MS - (Date.now() - startedAt));
    // [TRANSCRIPCION] Con otro mensaje del numero en curso aqui, la memoria manda (ver acquirePhoneTurn).
    // [CONCURRENCIA] Sin el candado este mensaje igual responde: sus guardados mezclan, no pisan.
    if (!phoneTurn.overlapped) {
          await loadConversation(phone, distributed.acquired);
          // [NOTA-REF] Nunca esperar las lapidas al responder a Twilio.
          inBackground(() => retryDeliveredWrite(phone));
          // [PENDIENTES] Unas pocas por mensaje, rotando: primero las que llevan mas sin intentarse, asi las
          // que siempre fallan no frenan a las demas. Cada una se reserva antes de mandarla
          // (claimPendingWrite): otra instancia no la manda a la vez, aunque haya vencido el candado. No las
          // reintenta quien espero el candado sin conseguirlo (otro mensaje lo tiene y ya las reintenta).
          if (!distributed.contended) {
                const due = await duePendingWrites(phone, MAX_PENDING_RETRIES_PER_TURN);
                // [REGISTRO] R4: los campos del negocio se escriben con la reserva de los campos, de a uno por
                // numero (como la correccion tardia): sin ella, esperan en la cola y sale solo la nota. Antes de
                // soltarla se manda lo que otro mensaje dejo en la cola mientras tanto (releaseDealWrite, en
                // segundo plano: este mensaje sigue con su flujo).
                const fieldsClaim = due.some((item) => sendablePendingWrite(phone, item)?.fields) ? await claimDealWrite(phone, startedAt + FUNCTION_BUDGET_MS + 5_000) : undefined;
                const claimedAt = Date.now();
                const tried = new Set(due.map((item) => item.id));
                let delivered = true;
                // [NOTA-REF] Las de nota con envio incierto: aqui solo sus campos; la nota sale en segundo plano,
                // despues de buscarla (retryUnsureNotes). Se decide con la escritura que trae la reserva.
                const unsure: QueuedWrite[] = [];
                try {
                      for (const item of due) {
                            if (!(await claimPendingWrite(phone, item.id))) continue;
                            const noteLater = noteSearchAt(sendablePendingWrite(phone, item)) !== undefined;
                            if (noteLater) unsure.push(item);
                            if (!(await retryQueuedWrite(phone, item, Boolean(fieldsClaim?.claimed), noteLater))) delivered = false;
                      }
                } finally {
                      if (fieldsClaim?.claimed) inBackground(() => releaseDealWrite(phone, fieldsClaim, claimedAt, delivered, (item) => tried.has(item.id), startedAt + FUNCTION_BUDGET_MS + 5_000));
                      if (unsure.length) inBackground(() => retryUnsureNotes(phone, unsure, startedAt + FUNCTION_BUDGET_MS));
                }
          }
    }
    const flowBase = structuredClone(getFlowState(phone));
    // [TRANSCRIPCION] El aviso de privacidad se decide una vez, con el estado ya leido: la nota y el
    // mensaje que sale dicen lo mismo aunque otro mensaje del numero lo muestre mientras tanto.
    const noticeDue = !privacyNoticeShown(phone);

    // [TRANSCRIPCION] El mensaje del cliente, con sus adjuntos, antes de cualquier respuesta. Sin
    // transcripcion y con la conversacion avanzada (un estado anterior a la PR 3), la nota avisa que
    // puede faltar el inicio.
    const stateBefore = getFlowState(phone);
    const mediaTypes = Array.from({ length: Math.max(0, Math.min(numMedia || 0, 10)) }, (_, i) => params['MediaContentType' + i] ?? '');
    const seq = recordTranscript(phone, 'cliente', inboundText(body, mediaTypes), {
          inProgress: stateBefore.stage !== 'stage1' || Object.keys(stateBefore.captured).length > 0 || getHistory(phone).length > 0,
    });
    transcriptSeq = seq;
    trackStep(phone, seq);
    let open = openMessages.get(phone);
    if (!open) { open = new Set(); openMessages.set(phone, open); }
    open.add(seq);

    async function respond(reply: string, noted = false): Promise<void> {
          res.setHeader('Content-Type', 'text/xml');
          // Si otro mensaje del numero lo mostro mientras tanto, este lo lleva igual (lado seguro).
          // [ARCHIVOS] Una respuesta vacia (otro archivo sin texto de la misma rafaga, que ya tuvo el aviso) no envia
          // mensaje: TwiML sin <Message>, sin aviso de privacidad y sin linea del bot en la transcripcion.
          let sent = reply && withPrivacyNotice(phone, reply, startedAt);
          if (reply && noticeDue && sent === reply) sent = appendPrivacyNotice(reply);
          // [TRANSCRIPCION] La respuesta del bot; el aviso de privacidad, solo como marca. La que ya fue
          // a la nota no se repite.
          if (!noted && sent) recordTranscript(phone, 'bot', botReplyText(reply, sent !== reply), { replyTo: seq });
          const xml = sent ? buildTwiML(sent) : buildSilentTwiML();
          // [CONCURRENCIA] R2: con Upstash arriba, el mensaje queda en el estado compartido o aparte en Upstash
          // ('held', lo mezcla la lectura siguiente) antes de dar el MessageSid por respondido. 'memory': Upstash
          // no respondio; el bot responde igual (decision 9) y lo guarda en el proximo guardado de esta instancia.
          const persisted = await persistConversation(phone);
          if (persisted === 'memory') console.warn(LOG_PREFIX + ' Upstash no respondio al guardar: el estado de este mensaje queda en la memoria de esta instancia');
          // [REGISTRO] Con el resultado del negocio ya guardado, otro mensaje del numero puede leerlo.
          await registration.release?.();
          await completeMessage(messageSid, xml);
          res.status(200).send(xml);
    }

    if (numMedia > 0 && body.trim().length < 3) {
          console.log(LOG_PREFIX + ' Media from ' + redact(phone, 'phone') + ' [' + messageSid + ']');
          // [ARCHIVOS] Imagenes o archivos sin texto: el aviso de que no pasan a la solicitud (con la pregunta de la
          // etapa 1, MSG_MEDIA, que [CANTIDAD] queda anotada para el mensaje siguiente), o nada si la rafaga ya lo tuvo.
          // Si todavia falta el aviso de privacidad (la primera respuesta lo lleva siempre), va con el de los archivos.
          const mediaReply = recordMediaReply(phone);
          stepDone(phone, seq);
          stampFlow(phone, seq);
          await respond(mediaReply || (noticeDue ? MSG_MEDIA_NOTICE : ''));
          return;
    }

    if (!body.trim()) {
          stepDone(phone, seq);
          await respond('Hola! No recibimos tu mensaje. Puedes escribirlo de nuevo?');
          return;
    }

    // Log de entrada: mensaje recibido + estado previo del flujo
    const stateIn = getFlowState(phone);
      console.log(LOG_PREFIX + ' msg from ' + redact(phone, 'phone') + ' [' + messageSid + '] caracteres=' + body.length);
      console.log(LOG_PREFIX + ' [QA:in] ' + JSON.stringify({
            stage: stateIn.stage,
            leadType: stateIn.leadType,
            repreg: { s1: stateIn.repreguntasStage1, s2: stateIn.repreguntasStage2, s3: stateIn.repreguntasStage3 },
            slots_prev: {
                    producto: Boolean(stateIn.captured.producto),
                    tipo_de_luz: Boolean(stateIn.captured.tipo_de_luz),
                    cantidad: Boolean(stateIn.captured.cantidad),
                    proyecto_o_uso: Boolean(stateIn.captured.proyecto_o_uso),
                    comuna_o_ciudad: Boolean(stateIn.captured.comuna_o_ciudad),
            },
      }));

    // [VARIOS-IMAGEN] El flujo sabe si el texto acompana una imagen: cada imagen con su cantidad es otro item.
    // [SIN-REPETIR] La ultima respuesta que recibio el cliente: el flujo no la repite igual.
    const lastReply = getHistory(phone).filter((turn) => turn.role === 'assistant').pop()?.content;
    const signals = { ...evaluateLeadSignals(body), hasMedia: numMedia > 0, lastReply };
      const history = getHistory(phone);

    // claudeParsed con tipo explícito alineado a lo que espera processFlowStep
    let claudeParsed: {
          producto?: string;
          tipo_de_luz?: string;
          cantidad?: string;
          proyecto_o_uso?: string;
          comuna_o_ciudad?: string;
          nombre?: string;
          empresa?: string;
          correo?: string;
          wantsHuman?: boolean;
          qualifiesForDeal?: boolean;
    } = {};
      let claudeSummary = 'Consulta de ' + (profileName || phone) + ': "' + body.substring(0, 80) + '"';
      let aiSource: 'claude' | 'heuristic' = 'heuristic';

    try {
          const result = await askClaude(history, body, profileName);
          claudeParsed = result.parsed;
          claudeSummary = result.summary;
          // [RESPUESTA] "Claude ok" solo si se uso la respuesta entera; si no, el motivo de los valores por
          // defecto (claudeAgent.ts). Sin nada utilizable, el paso es de las reglas del flujo (heuristic).
          const outcome = claudeLogLine(result);
          aiSource = outcome.usable ? 'claude' : 'heuristic';
          console[outcome.level](LOG_PREFIX + ' ' + outcome.message);
          // QA: presencia de campos; los valores libres pueden incluir datos personales.
        console.log(LOG_PREFIX + ' [QA:claude] ' + JSON.stringify({
                producto: Boolean(result.parsed.producto),
                tipo_de_luz: Boolean(result.parsed.tipo_de_luz),
                cantidad: Boolean(result.parsed.cantidad),
                proyecto_o_uso: Boolean(result.parsed.proyecto_o_uso),
                comuna_o_ciudad: Boolean(result.parsed.comuna_o_ciudad),
                nombre: Boolean(result.parsed.nombre),
                empresa: Boolean(result.parsed.empresa),
                correo: Boolean(result.parsed.correo),
                wantsHuman: result.parsed.wantsHuman,
                qualifiesForDeal: result.parsed.qualifiesForDeal,
        }));
    } catch (err) {
          console.error(LOG_PREFIX + ' Claude failed (non-fatal — usando heuristica):', redact(err, 'error'));
    }

    const turn = await runFlowTurn({
          phone, messageSid, body, profileName, claudeParsed, claudeSummary, signals, aiSource, transcriptSeq: seq, noticeDue, flowBase, startedAt, registration,
          contended: distributed.contended, markStepped: distributed.markStepped,
    });
    const { flowResult, dealResult, reply, noted, followUp } = turn;

    const wantsHuman = flowResult.wantsHuman || signals.wantsHuman;
      // 'found': el cierre se junto con el negocio abierto del mismo numero (ventana de 7 dias). Avisa
      // igual que un negocio nuevo: ventas recibe una tarea por cierre, como antes de la deduplicacion.
      // [REGISTRO] Lo nuevo de un mensaje que llego mientras otro registraba (followUp) no avisa otra vez.
      const shouldNotify = (!followUp && (dealResult.action === 'created' || dealResult.action === 'found')) || wantsHuman;

    if (shouldNotify) {
          try {
                  await notifyTeam({
                            phone,
                            name: profileName || phone,
                            message: body,
                            summary: claudeSummary,
                            dealId: dealResult.dealId,
                            personId: dealResult.personId,
                            existingDeal: dealResult.action === 'found',
                  });
          } catch (err) {
                  console.error(LOG_PREFIX + ' Notify error (non-fatal):', redact(err, 'error'));
          }
    }

    console.log(
          LOG_PREFIX +
            ' closed=' + flowResult.closedFlow +
            ' capture=' + flowResult.captureStatus +
            ' deal=' + dealResult.action +
            ' notify=' + shouldNotify,
        );

    await respond(reply, noted);
  } finally {
        if (transcriptSeq !== undefined) {
              stepDone(phone, transcriptSeq);
              const open = openMessages.get(phone);
              open?.delete(transcriptSeq);
              if (open && !open.size) openMessages.delete(phone);
        }
        try {
              await registration.release?.();
              await distributed?.release();
        } finally { phoneTurn.release(); }
  }
}
