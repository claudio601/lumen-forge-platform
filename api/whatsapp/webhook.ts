// api/whatsapp/webhook.ts
// POST /api/whatsapp/webhook
// Recibe mensajes WhatsApp via Twilio. Valida firma, orquesta flowEngine,
// llama Claude para parsing, crea deal en Pipedrive y notifica si aplica.
// [CIERRE-HONESTO] Los cierres que dicen "quedo registrada" o "ya derive" solo salen si
// Pipedrive confirma el negocio; si no, el texto B (MSG_DEAL_FAILED). Si el paso del flujo
// falla, se responde igual (texto B) en vez de un 500 sin respuesta. Los mensajes de un mismo
// numero se atienden de a uno (ver acquirePhoneTurn).

import { redact } from '../_lib/logging/redact.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateTwilioSignature, parseTwilioBody, buildTwiML } from '../_lib/whatsapp/twilio.js';
import { getHistory, addTurn } from '../_lib/whatsapp/conversation.js';
import { askClaude } from '../_lib/whatsapp/claudeAgent.js';
import { evaluateLeadSignals } from '../_lib/whatsapp/leadCapture.js';
import { ensureWhatsAppDeal, retryWhatsAppWrite } from '../_lib/whatsapp/pipedriveLead.js';
import { notifyTeam } from '../_lib/whatsapp/notify.js';
import { processFlowStep, getFlowState, recordDealOutcome, recordMediaReply, recordNoQuestion, MSG_MEDIA, MSG_DEAL_FAILED, MSG_DEAL_PENDING } from '../_lib/whatsapp/flowEngine.js';
import type { FlowResult } from '../_lib/whatsapp/flowEngine.js';
import { appendPrivacyNotice, privacyNoticeShown, withPrivacyNotice } from '../_lib/whatsapp/privacyNotice.js';
import type { FlowState } from '../_lib/whatsapp/flowEngine.js';
import {
  acquireConversationLock, claimMessage, completeMessage, loadConversation, persistConversation, enqueuePendingWrite,
  loadPendingWrites, settlePendingWrite, beginFlowStep, settleFlowStep, claimRegistration, awaitRegistration,
  MESSAGE_RETRY_WAIT_MS, MAX_PENDING_RETRIES_PER_TURN,
} from '../_lib/whatsapp/stateStore.js';
import { botReplyText, clearTranscriptAfterNote, inboundText, noteEntryIds, recordTranscript, transcriptForNote } from '../_lib/whatsapp/transcript.js';

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

interface FlowTurnInput {
    phone: string;
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
}

/**
 * Paso del flujo, negocio en Pipedrive e historial de un mensaje (dentro del turno del numero).
 * [TRANSCRIPCION] noted: la nota del negocio ya trae la transcripcion con esta respuesta.
 */
async function runFlowTurn(t: FlowTurnInput): Promise<{ flowResult: FlowResult; dealResult: DealResult; reply: string; noted: boolean }> {
  const { phone, body, profileName, claudeParsed, claudeSummary, signals, aiSource, transcriptSeq, noticeDue, flowBase } = t;

  let flowResult: FlowResult;
    // [CONCURRENCIA] Si un mensaje posterior ya paso por el flujo, el paso de este corre sobre lo que este
    // leyo (flowBase) y despues se mezcla con el estado actual (H4). Sin await hasta settleFlowStep.
    const current = beginFlowStep(phone, transcriptSeq, flowBase);
    try {
          flowResult = processFlowStep(phone, body, claudeParsed, signals);
    } catch (err) {
          // [CIERRE-HONESTO] Respuesta segura: nada quedo registrado, se ofrece ventas@ (texto B).
          console.error(LOG_PREFIX + ' Flow error (respuesta segura):', redact(err, 'error'));
          // [CANTIDAD] El texto B no pregunta nada: un numero siguiente no contesta la lista anterior.
          recordNoQuestion(phone);
          const stateNow = getFlowState(phone);
          flowResult = {
                  reply: MSG_DEAL_FAILED,
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
    const settledStep = settleFlowStep(phone, transcriptSeq, flowBase, current);
    if (settledStep.captured) flowResult = { ...flowResult, captured: settledStep.captured };
    // La conversacion que pidio el negocio (si mientras tanto empieza otra, el resultado no va ahi).
    const conversationId = settledStep.conversationId;
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
  let noteKept = true;
  // [REGISTRO] Otro mensaje del numero registra (o ya registro) el negocio de esta conversacion: este no lo
  // repite. Su resultado decide la respuesta y este mensaje queda en la transcripcion para la nota siguiente.
  let deferred = false;
  let register = flowResult.shouldCreateDeal && (!flowResult.rutUpdate || Boolean(getFlowState(phone).dealId));
  if (register) {
        // [REGISTRO] La reserva va antes del guardado: quien lea la conversacion cerrada y sin negocio ya la ve.
        // La correccion tardia (RUT o correo) escribe en el negocio que ya existe: no la necesita.
        let claim = flowResult.rutUpdate ? undefined : await claimRegistration(phone);
        if (claim && !claim.claimed) {
                const finished = await awaitRegistration(phone, claim.heldBy ?? 'remote', t.startedAt + REGISTRATION_WAIT_DEADLINE_MS);
                const now = getFlowState(phone);
                // La reserva del otro termino sin resultado para esta conversacion (su instancia se corto y la
                // reserva vencio): este mensaje registra la solicitud, como el reintento de flowEngine.
                if (finished && now.firstMessageAt === conversationId && !now.deal) claim = await claimRegistration(phone);
        }
        if (claim?.claimed) t.registration.release = claim.release;
        if (claim && !claim.claimed) {
                deferred = true;
                console.log(LOG_PREFIX + ' Otro mensaje del numero registra el negocio: este no lo repite');
        } else {
                // [CONCURRENCIA] La conversacion queda guardada antes de la llamada lenta a Pipedrive: un mensaje
                // que entra mientras tanto en otra instancia parte de aqui. Lo que esa instancia cambio y se
                // mezcla al guardar (una comuna corregida) va tambien en el negocio de este mensaje.
                await persistConversation(phone);
                const settled = getFlowState(phone);
                if (settled.firstMessageAt === conversationId) flowResult = { ...flowResult, captured: settled.captured };
                // [REGISTRO] Otro mensaje que termino justo antes ya dejo el resultado (llego al guardar).
                deferred = !flowResult.rutUpdate && settled.firstMessageAt === conversationId && Boolean(settled.deal);
                if (deferred) console.log(LOG_PREFIX + ' El negocio de esta conversacion ya tiene resultado: este mensaje no lo repite');
        }
        register = !deferred;
  }
  if (register) {
        const noteOpts = { upTo: transcriptSeq, exclude: othersInFlight(phone, transcriptSeq) };
        noteIds = noteEntryIds(phone, noteOpts);
        try {
                dealResult = await ensureWhatsAppDeal({
                          phone,
                          name: profileName || phone,
                          summary: claudeSummary,
                          body,
                          captured: flowResult.captured,
                          captureStatus: flowResult.captureStatus,
                          wantsHuman: flowResult.wantsHuman,
                          // [TRANSCRIPCION] Hasta este mensaje, con la respuesta que lo acompana (y la marca del
                          // aviso de privacidad si la lleva): lo que llegue mientras tanto va a la nota siguiente.
                          transcript: transcriptForNote(phone, { ...noteOpts, reply: botReplyText(flowResult.reply, noticeDue) }),
                          ...(flowResult.rutUpdate ? { existingDealId: getFlowState(phone).dealId } : {}),
                });
                // [PENDIENTES] Si la cola esta llena, la nota no entra: la transcripcion se conserva y la
                // nota siguiente la incluye (nada se pierde). Los campos entran igual (enqueuePendingWrite);
                // si ni ellos caben (tope duro), tambien se conserva la transcripcion.
                if (dealResult.pendingWrite) {
                        const queued = await enqueuePendingWrite(phone, dealResult.pendingWrite);
                        if (!queued) noteKept = false;
                }
        } catch (err) {
                console.error(LOG_PREFIX + ' Pipedrive error (non-fatal):', redact(err, 'error'));
        }
  }

  // [CIERRE-HONESTO] El cierre solo afirma el registro si Pipedrive devolvio el negocio.
  let reply = flowResult.reply;
    if (deferred) {
          // [REGISTRO] El resultado es el del otro mensaje: "quedo registrada" solo si Pipedrive lo confirmo; si
          // fallo, el texto B; si todavia no termina, MSG_DEAL_PENDING (no afirma el registro ni el fallo).
          const now = getFlowState(phone);
          const ours = now.firstMessageAt === conversationId;
          if (!(ours && now.deal === 'registered')) reply = ours && !now.deal ? MSG_DEAL_PENDING : MSG_DEAL_FAILED;
    } else if (flowResult.shouldCreateDeal) {
          const registered = (dealResult.action === 'created' || dealResult.action === 'found') && typeof dealResult.dealId === 'number';
          if (flowResult.rutUpdate && !registered) {
                  // [RUT-VALIDO] El RUT llego despues del cierre: el negocio ya estaba registrado y sigue.
                  console.warn(LOG_PREFIX + ' Dato posterior al cierre (RUT o correo) sin confirmar en Pipedrive (' + dealResult.action + ') - el negocio anterior sigue');
          } else {
                  recordDealOutcome(phone, registered, conversationId, dealResult.dealId);
                  if (!registered) {
                          console.warn(LOG_PREFIX + ' Negocio no confirmado (' + dealResult.action + ') — respondiendo MSG_DEAL_FAILED');
                          reply = MSG_DEAL_FAILED;
                  }
          }
    }

  // [TRANSCRIPCION] La nota (o su reintento pendiente) ya lleva la conversacion hasta esta respuesta:
  // se borra solo eso, no lo que otro pedido del mismo numero registro mientras Pipedrive respondia.
  // [CONCURRENCIA] Por id: solo lo que fue en la nota, aunque mientras tanto se haya mezclado algo mas.
  const noted = typeof dealResult.dealId === 'number' && reply === flowResult.reply && noteKept;
  if (noted) clearTranscriptAfterNote(phone, noteIds);

  addTurn(phone, { role: 'assistant', content: reply }, transcriptSeq + 1);

  return { flowResult, dealResult, reply, noted };
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
          // [PENDIENTES] Las mas antiguas primero. No las reintenta quien no tiene el candado porque otro
          // mensaje lo tiene: las dos instancias las mandarian dos veces.
          if (!distributed.contended) {
                const queued = await loadPendingWrites(phone);
                for (const item of queued.slice(0, MAX_PENDING_RETRIES_PER_TURN)) {
                      await settlePendingWrite(phone, item.id, await retryWhatsAppWrite(item.write));
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
    let open = openMessages.get(phone);
    if (!open) { open = new Set(); openMessages.set(phone, open); }
    open.add(seq);

    async function respond(reply: string, noted = false): Promise<void> {
          res.setHeader('Content-Type', 'text/xml');
          // Si otro mensaje del numero lo mostro mientras tanto, este lo lleva igual (lado seguro).
          let sent = withPrivacyNotice(phone, reply, startedAt);
          if (noticeDue && sent === reply) sent = appendPrivacyNotice(reply);
          // [TRANSCRIPCION] La respuesta del bot; el aviso de privacidad, solo como marca. La que ya fue
          // a la nota no se repite.
          if (!noted) recordTranscript(phone, 'bot', botReplyText(reply, sent !== reply), { replyTo: seq });
          const xml = buildTwiML(sent);
          await persistConversation(phone);
          // [REGISTRO] Con el resultado del negocio ya guardado, otro mensaje del numero puede leerlo.
          await registration.release?.();
          await completeMessage(messageSid, xml);
          res.status(200).send(xml);
    }

    if (numMedia > 0 && body.trim().length < 3) {
          console.log(LOG_PREFIX + ' Media from ' + redact(phone, 'phone') + ' [' + messageSid + ']');
          // [CANTIDAD] MSG_MEDIA pregunta producto, proyecto y cantidad: queda anotado para el mensaje siguiente.
          recordMediaReply(phone);
          await respond(MSG_MEDIA);
          return;
    }

    if (!body.trim()) {
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

    const signals = evaluateLeadSignals(body);
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
          aiSource = 'claude';
          console.log(LOG_PREFIX + ' Claude ok — wantsHuman: ' + result.parsed.wantsHuman);
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
          phone, body, profileName, claudeParsed, claudeSummary, signals, aiSource, transcriptSeq: seq, noticeDue, flowBase, startedAt, registration,
    });
    const { flowResult, dealResult, reply, noted } = turn;

    const wantsHuman = flowResult.wantsHuman || signals.wantsHuman;
      // 'found': el cierre se junto con el negocio abierto del mismo numero (ventana de 7 dias). Avisa
      // igual que un negocio nuevo: ventas recibe una tarea por cierre, como antes de la deduplicacion.
      const shouldNotify = dealResult.action === 'created' || dealResult.action === 'found' || wantsHuman;

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
