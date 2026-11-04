// Estado compartido del bot; ante una caida de Upstash conserva la memoria de la instancia.
// [CONCURRENCIA] Dos mensajes del mismo numero pueden atenderse a la vez (en dos instancias de Vercel, o
// en una cuando el anterior pasa los 10 s de espera). Con Upstash arriba, el guardado de uno no borra lo
// del otro:
// - cada guardado relee el estado compartido y mezcla en tres vias (lo que esta instancia leyo, lo
//   suyo y lo de Upstash): un dato que cambio solo un lado queda; si cambio en los dos, gana el mensaje
//   que llego despues. Cada dato lleva el numero de orden del mensaje que lo cambio (fieldSeq): un
//   mensaje posterior que cambio otro dato no hace ganar un valor viejo de este. La transcripcion y el
//   historial se mezclan por id y numero de orden. La escritura es atomica (EVAL con la revision del
//   estado): si otro guardo entre medio, se vuelve a leer y mezclar; si eso pasa en cada intento, el
//   estado de este mensaje queda aparte en Upstash (heldKey) y la lectura siguiente lo mezcla;
// - dentro de una instancia, el paso del flujo de un mensaje anterior corre sobre lo que ese mensaje
//   leyo y se mezcla igual con lo que ya cambio uno posterior (beginFlowStep y settleFlowStep);
// - las listas de solo agregar de los datos capturados (cambios, comunas_otras) se mezclan elemento a
//   elemento: los dos mensajes conservan su linea (APPEND_LISTS);
// - el registro de un negocio nuevo es uno a la vez por numero, tambien entre instancias
//   (claimRegistration): el que llega mientras otro registra espera su resultado y no lo repite. El
//   resultado queda anotado por conversacion (registrationOutcome), aunque mientras tanto empiece otra.
// [REGISTRO] Las escrituras de campos en un negocio que ya existe (las correcciones tardias de RUT o
// correo y los campos pendientes) tienen su propia reserva (claimDealWrite), aparte de la del registro: un
// pedido nuevo no espera a una correccion. Mientras no vence, quien la tiene es el unico que escribe campos
// en Pipedrive para el numero (sin Upstash, solo dentro de la instancia); el que no la consigue deja su
// escritura en la cola y quien la tiene la manda al terminar la suya. Cada escritura lleva el numero de
// orden del mensaje que la armo; la cola no reintenta campos que ya supero una escritura confirmada de un
// mensaje posterior (confirmDealFields), y la nota de esa escritura si sale.
// [PENDIENTES] Las escrituras a Pipedrive sin confirmar van en su propia cola, fuera del estado: un hash de
// Upstash por numero, que vence a los 30 dias sin escrituras nuevas. Una escritura sale de la cola cuando
// se entrega o cuando la cola vence; el tope, la escritura y el plazo van en un solo EVAL. Con la cola
// llena no entra otra nota y webhook.ts conserva la transcripcion para la nota siguiente, si la hay (con
// el tope del estado puede omitir mensajes del medio); los campos del negocio (una foto completa) se
// juntan en una sola escritura por negocio. Sin Upstash, lo nuevo queda solo en la memoria de la instancia.
// Cada mensaje reintenta unas pocas, rotando, y cada una reservada (no la manda otra instancia a la vez).
// [NOTA-REF] La reserva trae la escritura tal como esta en Upstash (otra instancia pudo cambiarla despues
// de la lectura) y dice si el intento anterior quedo sin cerrar (la instancia se corto): su nota cuenta como
// enviada con resultado incierto y se busca por su referencia antes de repetirla (pipedriveLead.ts). Lo mismo
// si un guardado en la cola quedo sin respuesta (markUnconfirmed): pudo aplicarse y otra instancia pudo
// entregarla y borrarla antes de que esta la vuelva a guardar.
// [TOPE] El estado guardado tiene un tope de bytes (MAX_STATE_BYTES): los datos capturados tienen su
// propio presupuesto (MAX_CAPTURED_BYTES); sobre el tope, salen los turnos mas antiguos del historial y
// luego mensajes del medio de la transcripcion (la nota avisa la omision).
import { createHash, randomUUID } from 'node:crypto';
import { redisJsonCommand, redisJsonCommandWithTimeout } from '../idempotency/redis.js';
import { getFlowState, saveFlowState, clearFlowState } from './flowEngine.js';
import type { FlowState } from './flowEngine.js';
import { getHistoryEntries, restoreHistory, clearHistory, normalizeTurns, MAX_TURNS } from './conversation.js';
import type { ConversationTurn, SequencedTurn } from './conversation.js';
import { privacyNoticeShown, restorePrivacyNotice } from './privacyNotice.js';
import type { PendingWhatsAppWrite } from './pipedriveLead.js';
import { getTranscript, restoreTranscript, clearTranscript, normalizeTranscript, capEntries, TRANSCRIPT_HEAD } from './transcript.js';
import type { Transcript } from './transcript.js';

export const CONVERSATION_TTL_S = 604800;
export const MESSAGE_TTL_S = 86400;
// Presupuesto: 60 s de funcion + 15 s de margen. [NOTA-REF] vercel.json declara maxDuration 60 para
// el webhook (lo vigila scripts/vercel-config.test.ts): mantenerlos alineados.
export const MESSAGE_IN_PROGRESS_TTL_S = 60 + 15;
export const CONVERSATION_LOCK_TTL_MS = 25_000;
export const MESSAGE_RETRY_WAIT_MS = 3_000;
// [PENDIENTES] Tope de notas en la cola por numero (cada una de a lo mas 90.000 bytes) y cuantas
// escrituras se reintentan por mensaje (Twilio espera 15 s). Hasta que la cola vence (30 dias sin
// escrituras nuevas), una escritura no confirmada sale de ella solo al entregarse.
export const MAX_PENDING_WRITES = 10;
export const MAX_PENDING_RETRIES_PER_TURN = 5;
export const PENDING_WRITE_TTL_S = 30 * 86400;
// [PENDIENTES] Tope duro de la cola (notas y campos): sobre el, ni los campos entran (se avisa).
export const MAX_PENDING_TOTAL = 2 * MAX_PENDING_WRITES;
// [PENDIENTES] Reserva de una escritura mientras se reintenta: el plazo de la funcion mas su margen (si la
// instancia se corta, la escritura vuelve a quedar libre a lo mas en ese plazo). [NOTA-REF] Un intento son a
// lo mas tres llamadas a Pipedrive: los campos y la nota (15 s cada una) y la busqueda de la nota (10 s).
export const PENDING_CLAIM_TTL_MS = MESSAGE_IN_PROGRESS_TTL_S * 1000;
// [TOPE] Bytes del estado guardado (flujo, historial y transcripcion), de los datos capturados y largo
// de cada dato capturado.
export const MAX_STATE_BYTES = 256 * 1024;
export const MAX_CAPTURED_BYTES = 64 * 1024;
const MAX_FIELD_TEXT = 4096;
const MAX_FIELD_ITEMS = 20;
// [REGISTRO] Plazo de la reserva del registro de un negocio: el de la funcion mas su margen.
export const REGISTRATION_TTL_MS = MESSAGE_IN_PROGRESS_TTL_S * 1000;
// [REGISTRO] Resultados del registro que se recuerdan por numero (las ultimas conversaciones), y negocios
// con campos confirmados que viajan en el estado.
const MAX_OUTCOMES = 5;
const MAX_CONFIRMED = 10;
const SAVE_ATTEMPTS = 3;
// [CONCURRENCIA] Ids de estados guardados aparte que el estado compartido ya trae mezclados (los ultimos).
const MAX_FOLDED = 20;
// Respaldo en memoria de los MessageSid para cuando Upstash no responde (solo en esta instancia).
const LOCAL_MESSAGES_MAX = 500;
const LOCAL_MESSAGE_DONE_MS = 10 * 60_000;
const LOG_PREFIX = '[whatsapp/stateStore]';

interface Snapshot {
  // [CONCURRENCIA] Revision del estado: va primero en el JSON, asi el EVAL la lee sin decodificarlo.
  rev?: number;
  updatedAt?: number; // Los estados anteriores a esta versión no tienen la marca.
  flow: FlowState;
  /** Numero de orden del ultimo mensaje que paso por el flujo (decide si un dato no tiene su marca). */
  flowSeq?: number;
  /**
   * [CONCURRENCIA] Por dato del flujo ('stage', 'captured.correo', ...), el numero de orden del mensaje que
   * lo dejo asi: si los dos lados lo cambiaron, gana el mas nuevo. Los estados anteriores no lo traen.
   */
  fieldSeq?: Record<string, number>;
  /** [REGISTRO] Resultado del registro por conversacion (su firstMessageAt), las ultimas MAX_OUTCOMES. */
  outcomes?: RegistrationOutcome[];
  /**
   * [REGISTRO] Por negocio, el numero de orden de los ultimos campos que Pipedrive confirmo: lo mismo que
   * 'v:<negocio>' en la cola, guardado tambien aqui por si ese EVAL fallo (los ultimos MAX_CONFIRMED).
   */
  confirmed?: Record<string, number>;
  /** [CONCURRENCIA] Estados guardados aparte (heldKey) que este ya trae mezclados: no se mezclan otra vez. */
  folded?: string[];
  history: ConversationTurn[];
  /** Numero de orden de cada turno del historial (null: turno guardado antes de este cambio). */
  historySeq?: (number | null)[];
  privacyShown: boolean;
  // [PENDIENTES] Hasta esta version las escrituras pendientes iban aqui; ahora van en su cola. Lo que
  // traiga uno antiguo pasa a la cola y sigue aqui hasta quedar confirmado alla (cuenta en MAX_STATE_BYTES).
  pending: PendingWhatsAppWrite[];
  // [TRANSCRIPCION] Los estados anteriores a la PR 3 no la traen: la nota avisa que puede faltar el inicio.
  transcript?: Transcript;
}

interface LocalMeta {
  updatedAt: number;
  dirty: boolean;
  /** [CONCURRENCIA] Lo ultimo que esta instancia leyo o escribio en Upstash: la base de la mezcla. */
  base?: Snapshot;
}

const local = new Map<string, LocalMeta>();
const flowSeqs = new Map<string, number>();
// [CONCURRENCIA] Marcas por dato (fieldSeq) y el flujo que describen: lo que cambia despues se marca con
// el numero de orden del mensaje que lo cambio (stampFlow).
const fieldSeqs = new Map<string, Record<string, number>>();
const stampedFlows = new Map<string, FlowState>();
// [REGISTRO] Resultados del registro por conversacion, y [CONCURRENCIA] los estados aparte ya mezclados.
const outcomesByPhone = new Map<string, RegistrationOutcome[]>();
const foldedByPhone = new Map<string, string[]>();
// Un guardado a la vez por numero en esta instancia: la base de la mezcla siempre es la ultima lectura.
const chains = new Map<string, Promise<void>>();
// saved: Upstash ya tiene la respuesta (si no, se reintenta guardarla en la entrega repetida).
const recentMessages = new Map<string, { at: number; response?: string; saved?: boolean }>();

export function conversationKey(phone: string): string {
  return 'whatsapp:conversation:' + createHash('sha256').update(phone).digest('hex');
}

/** Mismo hash que conversationKey, sin teléfono en claro. */
export function conversationLockKey(phone: string): string {
  return 'lock:' + conversationKey(phone);
}

/** [PENDIENTES] La cola de escrituras pendientes del numero (hash de Upstash: id -> escritura). */
export function pendingKey(phone: string): string {
  return 'whatsapp:pending:' + createHash('sha256').update(phone).digest('hex');
}

/** [REGISTRO] La reserva del registro de un negocio nuevo del numero (mismo hash, sin telefono en claro). */
export function registrationKey(phone: string): string {
  return 'whatsapp:registering:' + createHash('sha256').update(phone).digest('hex');
}

/** [REGISTRO] La reserva de las escrituras de campos en un negocio que ya existe (mismo hash). */
export function dealWriteKey(phone: string): string {
  return 'whatsapp:dealwrite:' + createHash('sha256').update(phone).digest('hex');
}

/**
 * [CONCURRENCIA] Estados que no se pudo guardar porque otro guardado gano cada intento: un hash de Upstash
 * por numero (id -> lo que se leyo y lo que se queria guardar), con el plazo de la conversacion.
 */
export function heldKey(phone: string): string {
  return 'whatsapp:unsaved:' + createHash('sha256').update(phone).digest('hex');
}

// Borra la reserva solo si sigue siendo de quien la tomo.
const RELEASE_SCRIPT = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;

// [CONCURRENCIA] El candado de la conversacion, con la marca de que su mensaje ya paso por el flujo y dejo
// su estado guardado (STEPPED, al final del valor). Marcarlo conserva su plazo; soltarlo acepta las dos formas.
const STEPPED = ':paso';
const MARK_LOCK_SCRIPT = `-- whatsapp:candado:paso
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
local ttl = redis.call('pttl', KEYS[1])
if ttl > 0 then redis.call('set', KEYS[1], ARGV[1] .. ARGV[2], 'PX', ttl) end
return 1`;
const RELEASE_LOCK_SCRIPT = `-- whatsapp:candado:soltar
local v = redis.call('get', KEYS[1])
if v == ARGV[1] or v == ARGV[1] .. ARGV[2] then return redis.call('del', KEYS[1]) end
return 0`;

/**
 * La fila local sigue vigente. Contencion o caida: continuar como antes, con aviso.
 * `contended`: otro mensaje del numero tiene el candado (no es que Upstash este caido): este no
 * reintenta las escrituras pendientes, para no duplicarlas.
 * `markStepped`: [CONCURRENCIA] quien tiene el candado avisa que ya paso por el flujo y guardo su estado,
 * antes de una llamada lenta a Pipedrive: otro mensaje que espera en awaitConversationUnlock deja de esperar.
 */
export async function acquireConversationLock(phone: string, maxWaitMs: number): Promise<{
  acquired: boolean;
  contended: boolean;
  release: () => Promise<void>;
  markStepped: () => Promise<void>;
}> {
  const key = conversationLockKey(phone);
  const token = randomUUID();
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  const none = async () => {};
  while (Date.now() < deadline) {
    const result = await redisJsonCommandWithTimeout<string | null>(
      Math.min(800, deadline - Date.now()), 'SET', key, token, 'NX', 'PX', CONVERSATION_LOCK_TTL_MS,
    );
    if (!result.ok) { unavailable('candado de conversaci\u00f3n'); return { acquired: false, contended: false, release: none, markStepped: none }; }
    if (result.result === 'OK') {
      return {
        acquired: true,
        contended: false,
        release: async () => {
          const released = await redisJsonCommand('EVAL', RELEASE_LOCK_SCRIPT, '1', key, token, STEPPED);
          if (!released.ok) unavailable('liberar candado de conversaci\u00f3n');
        },
        markStepped: async () => {
          const marked = await redisJsonCommand('EVAL', MARK_LOCK_SCRIPT, '1', key, token, STEPPED);
          if (!marked.ok) unavailable('marcar candado de conversaci\u00f3n');
        },
      };
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
  console.warn(LOG_PREFIX + ' Espera del candado agotada; contin\u00faa sin candado');
  return { acquired: false, contended: true, release: none, markStepped: none };
}

// ---------------------------------------------------------------------------------------------
// [REGISTRO] Un registro de negocio nuevo a la vez por numero
// webhook.ts guarda la conversacion (ya cerrada, aun sin negocio) antes de la llamada lenta a Pipedrive.
// Sin esta reserva, otro mensaje del numero que entra mientras tanto (en otra instancia, o en esta al
// vencer la espera) veia "cerrada con correo y sin negocio" y registraba de nuevo: un segundo negocio o
// nota y un segundo aviso a ventas. La reserva vive en Upstash (entre instancias) y en la memoria (sin
// Upstash); vence sola si la instancia que la tomo se corta.
// [REGISTRO] La reserva de los campos (claimDealWrite) funciona igual, con su propia clave: la toman las
// correcciones tardias, el reintento de campos pendientes y, sin esperar, el registro (R4 de la ronda 3).

type ReservationKind = 'registro' | 'campos';
const reservations: Record<ReservationKind, Map<string, { token: string; until: number }>> = { registro: new Map(), campos: new Map() };
const reservationKey = (kind: ReservationKind, phone: string) => (kind === 'registro' ? registrationKey(phone) : dealWriteKey(phone));

export interface RegistrationClaim {
  /** false: otro mensaje del numero tiene la reserva ('local': en esta instancia). */
  claimed: boolean;
  heldBy?: 'local' | 'remote';
  /** Libera la reserva (una vez; la del registro, despues de guardar el resultado del negocio). */
  release: () => Promise<void>;
}

async function claimReservation(kind: ReservationKind, phone: string, leaseUntil = Infinity): Promise<RegistrationClaim> {
  const none = async () => {};
  const now = Date.now();
  // [NOTA-REF] Un limite vencido no permite empezar otro escritor, ni siquiera por 1 ms.
  if (leaseUntil <= now) return { claimed: false, heldBy: 'local', release: none };
  const inMemory = reservations[kind];
  const label = kind === 'registro' ? 'registro del negocio' : 'campos del negocio';
  const held = inMemory.get(phone);
  if (held && held.until > now) return { claimed: false, heldBy: 'local', release: none };
  const key = reservationKey(kind, phone);
  const token = randomUUID();
  // La memoria se reserva antes de ir a Upstash: otro mensaje de esta instancia que pide la reserva a la
  // vez ya la ve tomada (sin Upstash, los dos la tomaban).
  // [NOTA-REF] Ninguna reserva del turno sobrevive a la funcion que la tomo.
  // Upstash solo acepta un PX entero: un limite fraccionario se redondea hacia abajo.
  const ttl = Math.floor(Math.min(REGISTRATION_TTL_MS, leaseUntil - now));
  if (!(ttl >= 1)) return { claimed: false, heldBy: 'local', release: none };
  inMemory.set(phone, { token, until: now + ttl });
  const set = await redisJsonCommandWithTimeout<string | null>(800, 'SET', key, token, 'NX', 'PX', ttl);
  if (set.ok && set.result !== 'OK') {
    if (inMemory.get(phone)?.token === token) inMemory.delete(phone);
    return { claimed: false, heldBy: 'remote', release: none };
  }
  if (!set.ok) unavailable('reservar ' + label);
  let released = false;
  return {
    claimed: true,
    release: async () => {
      if (released) return;
      released = true;
      // Primero Upstash: quien espera en esta instancia, al ver libre la memoria, ya no la ve alla.
      if (set.ok) {
        const del = await redisJsonCommand('EVAL', RELEASE_SCRIPT, '1', key, token);
        if (!del.ok) unavailable('liberar ' + label);
      }
      if (inMemory.get(phone)?.token === token) inMemory.delete(phone);
    },
  };
}

export function claimRegistration(phone: string, leaseUntil?: number): Promise<RegistrationClaim> {
  return claimReservation('registro', phone, leaseUntil);
}

/**
 * [REGISTRO] La reserva de los campos del negocio: no se espera. Quien no la consigue deja su escritura en
 * la cola, y quien la tiene la manda antes de soltarla (webhook.ts).
 */
export function claimDealWrite(phone: string, leaseUntil?: number): Promise<RegistrationClaim> {
  return claimReservation('campos', phone, leaseUntil);
}

/**
 * Espera, hasta `deadline`, a que termine el registro que tiene otro mensaje del numero. true: termino;
 * si era de otra instancia, lo que guardo (el resultado del negocio) ya se mezclo en la memoria.
 */
export async function awaitRegistration(phone: string, heldBy: 'local' | 'remote', deadline: number): Promise<boolean> {
  let remote = heldBy === 'remote';
  for (;;) {
    const held = reservations.registro.get(phone);
    let busy = Boolean(held && held.until > Date.now());
    if (!busy) {
      const got = await redisJsonCommandWithTimeout<string | null>(Math.max(1, Math.min(800, deadline - Date.now())), 'GET', registrationKey(phone));
      if (got.ok && got.result !== null && got.result !== undefined) { busy = true; remote = true; }
    }
    if (!busy) {
      if (remote) await loadConversation(phone);
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(200, remaining)));
  }
}

/** [REGISTRO] Lo que respondio Pipedrive al registro de una conversacion (por su firstMessageAt). */
export interface RegistrationOutcome {
  id: number;
  deal: 'registered' | 'failed';
  dealId?: number;
}

/** Por conversacion: 'registered' no se deshace (despues de registrada no se vuelve a registrar). */
function mergeOutcomes(a: RegistrationOutcome[] = [], b: RegistrationOutcome[] = []): RegistrationOutcome[] {
  const byId = new Map<number, RegistrationOutcome>();
  for (const o of [...a, ...b]) {
    const prev = byId.get(o.id);
    if (!prev || (prev.deal !== 'registered' && o.deal === 'registered')) byId.set(o.id, o);
  }
  return [...byId.values()].sort((x, y) => x.id - y.id).slice(-MAX_OUTCOMES);
}

/**
 * [REGISTRO] webhook.ts anota aqui el resultado del registro de la conversacion `conversationId`, junto
 * con recordDealOutcome: este queda aunque mientras tanto el numero haya empezado otra conversacion (R11:
 * el mensaje que esperaba ese registro no deduce un fallo porque cambio la conversacion activa). Viaja en
 * el estado guardado.
 */
export function recordRegistrationOutcome(phone: string, conversationId: number, registered: boolean, dealId?: number): void {
  const outcome: RegistrationOutcome = { id: conversationId, deal: registered ? 'registered' : 'failed', ...(registered && dealId ? { dealId } : {}) };
  outcomesByPhone.set(phone, mergeOutcomes(outcomesByPhone.get(phone), [outcome]));
}

/** [REGISTRO] El resultado anotado del registro de esa conversacion (undefined: ninguno todavia). */
export function registrationOutcome(phone: string, conversationId: number): RegistrationOutcome | undefined {
  return outcomesByPhone.get(phone)?.find((o) => o.id === conversationId);
}

/**
 * [CONCURRENCIA] Espera, hasta `deadline`, a que otro mensaje del numero suelte el candado de la
 * conversacion (lo tiene otra instancia, que llego antes) o lo marque (markStepped: ya paso por el flujo y
 * guardo su estado, y sigue con una llamada lenta a Pipedrive). true: lo solto o lo marco (su estado ya
 * esta guardado); false: el plazo se acabo o Upstash no respondio.
 */
export async function awaitConversationUnlock(phone: string, deadline: number): Promise<boolean> {
  for (;;) {
    const got = await redisJsonCommandWithTimeout<string | null>(Math.max(1, Math.min(800, deadline - Date.now())), 'GET', conversationLockKey(phone));
    if (!got.ok) return false;
    if (got.result === null || got.result === undefined || String(got.result).endsWith(STEPPED)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(200, remaining)));
  }
}

export function messageKey(sid: string): string {
  return 'whatsapp:message:' + sid;
}

function unavailable(op: string): void {
  console.warn(LOG_PREFIX + ' Upstash no disponible; respaldo en memoria (' + op + ')');
}

// ---------------------------------------------------------------------------------------------
// [PENDIENTES] Cola de escrituras a Pipedrive sin confirmar
// Un hash de Upstash por numero (pendingKey), con estos campos:
// - 'n:<id>' (lleva nota) y 'f:<id>' (solo campos del negocio): la escritura, un QueuedWrite en JSON;
// - 't:<id>': el ultimo intento de esa escritura, '<reservada hasta>:<inicio>:<token>' (ms); al cerrarse
//   queda '0:<inicio>:' (un intento que sigue con su token y ya vencio no se cerro: [NOTA-REF]);
// - 'm:legacy-<hash>': una escritura del estado anterior ya pasada a la cola (no se vuelve a pasar);
// - 'v:<negocio>': [REGISTRO] el numero de orden de los ultimos campos que Pipedrive confirmo en ese negocio.
// Cada cambio es un EVAL de esa sola clave: el tope, la escritura y el plazo de 30 dias van juntos (otra
// instancia no ve la cola a medias ni la deja sin plazo), y una escritura reservada no la manda otra.

export interface QueuedWrite {
  id: string;
  at: number;
  write: PendingWhatsAppWrite;
  /** [REGISTRO] Numero de orden del mensaje que armo sus campos: decide cuales son los mas nuevos. */
  ver?: number;
  /** [NOTA-REF] Mensaje y lineas que armaron esta nota logica (hasta 60 ids). */
  sid?: string;
  noteIds?: string[];
}

/**
 * [REGISTRO] Numero de orden de los campos de una escritura. Las guardadas antes de este cambio no lo
 * traen: se usa su hora, en la misma escala que transcript.ts (2.000 numeros por milisegundo).
 */
export function pendingVersion(item: QueuedWrite): number {
  return typeof item.ver === 'number' && Number.isFinite(item.ver) ? item.ver : item.at * 2000;
}
interface QueueEntry {
  item: QueuedWrite;
  /**
   * [NOTA-REF] Inicio del intento anterior, si quedo sin cerrar (la instancia se corto antes de soltarla):
   * lo anota la reserva y su nota se manda como incierta (sendablePendingWrite).
   */
  unsureSince?: number;
  /** Ya esta en la cola de Upstash, con su plazo (si no, solo en la memoria de esta instancia). */
  stored: boolean;
  /** Inicio del ultimo intento (0: nunca): se reintenta primero la que lleva mas tiempo sin intentarse. */
  last: number;
  /** Hasta cuando la tiene un intento en curso (0: libre) y la marca de esa reserva en Upstash. */
  until: number;
  lease?: string;
}
// En memoria: lo de Upstash mas lo que todavia no se pudo guardar alla (stored: false).
const queues = new Map<string, Map<string, QueueEntry>>();
// Entregadas cuyo borrado en Upstash fallo: se reintenta borrarlas y no se vuelven a enviar.
const delivered = new Map<string, Map<string, string | undefined>>();
// [NOTA-REF] Una sola entrega en vuelo por entrada, tambien durante su primer borrado.
const deliveryInFlight = new Set<string>();
// [REGISTRO] Por numero y negocio, el numero de orden de los ultimos campos confirmados (lo de Upstash, lo
// del estado guardado y lo de esta instancia), y los que esta instancia no pudo anotar en la cola (se
// reintenta en la lectura siguiente de la cola).
const confirmedFields = new Map<string, Map<number, number>>();
const unconfirmed = new Map<string, Map<number, number>>();

// Agrega una escritura (o la reemplaza, si ya esta: un guardado repetido). Una nueva entra solo bajo el
// tope de notas (ARGV[3], las 'n:') y el total (ARGV[4]); las que reemplaza (ARGV[6..], los campos
// anteriores del mismo negocio) salen en la misma operacion, y la cola queda con su plazo (ARGV[5]).
// 1: guardada; 0: la cola esta llena.
const ENQUEUE_SCRIPT = `-- whatsapp:cola:agregar
local k = KEYS[1]
if redis.call('hexists', k, ARGV[1]) == 0 then
  local notes, total, replaced = 0, 0, 0
  for _, f in ipairs(redis.call('hkeys', k)) do
    local p = string.sub(f, 1, 2)
    if p == 'n:' then notes = notes + 1 end
    if p == 'n:' or p == 'f:' then total = total + 1 end
  end
  for i = 6, #ARGV do replaced = replaced + redis.call('hexists', k, ARGV[i]) end
  if string.sub(ARGV[1], 1, 2) == 'n:' and notes >= tonumber(ARGV[3]) then return 0 end
  if total - replaced >= tonumber(ARGV[4]) then return 0 end
end
redis.call('hset', k, ARGV[1], ARGV[2])
for i = 6, #ARGV do redis.call('hdel', k, ARGV[i], 't:' .. ARGV[i]) end
redis.call('expire', k, tonumber(ARGV[5]))
return 1`;

// [NOTA-REF] Entrada y reserva antes del primer envio; la marca gana incluso al sobrescribir.
const ANTICIPATE_SCRIPT = `-- whatsapp:cola:anticipar
local k = KEYS[1]
local id = ARGV[1]
local alias = ARGV[9] ~= '' and redis.call('hget', k, ARGV[9])
if alias and (redis.call('hexists', k, alias) == 1 or redis.call('hexists', k, 'd:' .. string.sub(alias, 3)) == 1) then id = alias end
local marker = id == ARGV[1] and ARGV[6] or 'd:' .. string.sub(id, 3)
local d = redis.call('hget', k, marker)
if d then return {2, d} end
local w = redis.call('hget', k, id)
if w and (ARGV[8] ~= '1' or id ~= ARGV[1]) then return {3, redis.call('hget', k, 't:' .. id) or '', w, id} end
if not w then
  local notes, total = 0, 0
  for _, f in ipairs(redis.call('hkeys', k)) do
    local p = string.sub(f, 1, 2)
    if p == 'n:' then notes = notes + 1 end
    if p == 'n:' or p == 'f:' then total = total + 1 end
  end
  if string.sub(ARGV[1], 1, 2) == 'n:' and notes >= tonumber(ARGV[3]) then return 0 end
  if total >= tonumber(ARGV[4]) then return 0 end
end
redis.call('hset', k, ARGV[1], ARGV[2])
if ARGV[9] ~= '' then redis.call('hset', k, ARGV[9], ARGV[1]) end
if ARGV[7] ~= '' then redis.call('hset', k, 't:' .. ARGV[1], ARGV[7])
elseif not w then redis.call('hdel', k, 't:' .. ARGV[1]) end
redis.call('expire', k, tonumber(ARGV[5]))
return {1}`;

// [NOTA-REF] Nunca queda un intervalo sin rastro: sale la entrada y queda su marca en el mismo EVAL.
const DONE_SCRIPT = `-- whatsapp:cola:entregada
local k = KEYS[1]
redis.call('hdel', k, ARGV[1], 't:' .. ARGV[1])
redis.call('hset', k, ARGV[2], ARGV[3])
for _, f in ipairs(redis.call('hkeys', k)) do
  if string.sub(f, 1, 2) == 'd:' then
    local at = string.match(redis.call('hget', k, f), '^{"at":(%d+)')
    if at and tonumber(at) < tonumber(ARGV[4]) - tonumber(ARGV[5]) then redis.call('hdel', k, f) end
  end
end
for _, f in ipairs(redis.call('hkeys', k)) do
  if string.sub(f, 1, 2) == 's:' then
    local id = redis.call('hget', k, f)
    if redis.call('hexists', k, id) == 0 and redis.call('hexists', k, 'd:' .. string.sub(id, 3)) == 0 then redis.call('hdel', k, f) end
  end
end
redis.call('expire', k, tonumber(ARGV[6]))
return 1`;

// Pasa a la cola una escritura del estado anterior: la escritura, su marca (ARGV[3]) y el plazo (ARGV[4])
// juntos, sin tope (las trae el estado de la version anterior, una sola vez). 2: la marca ya estaba (otra
// instancia la paso, y quizas ya se entrego): no se vuelve a agregar.
const MIGRATE_SCRIPT = `-- whatsapp:cola:migrar
local k = KEYS[1]
if redis.call('hexists', k, ARGV[3]) == 1 then return 2 end
redis.call('hset', k, ARGV[1], ARGV[2], ARGV[3], '1')
redis.call('expire', k, tonumber(ARGV[4]))
return 1`;

// Reserva la escritura ARGV[3] si sigue en la cola y nadie la tiene reservada a esta hora (ARGV[1]); la
// reserva es ARGV[2]. {1, intento anterior, escritura}: reservada, con la marca del intento anterior ('' si
// no hubo) y la escritura como esta guardada ([NOTA-REF]); 0: ya no esta o la tiene otro intento.
const CLAIM_SCRIPT = `-- whatsapp:cola:reservar
local k = KEYS[1]
local w = redis.call('hget', k, ARGV[3])
if not w then return 0 end
local t = redis.call('hget', k, 't:' .. ARGV[3])
local u = t and string.match(t, '^(%d+)') or '0'
if tonumber(u) > tonumber(ARGV[1]) then return 0 end
redis.call('hset', k, 't:' .. ARGV[3], ARGV[2])
return {1, t or '', w}`;

// Cierra un intento que no se entrego, solo si la reserva sigue siendo la suya (ARGV[2]): deja la marca
// del intento, ya libre (ARGV[3]), y lo que falta, si cambio (ARGV[4]). 0: ya no era suya (vencio y la
// tomo otra instancia, o la reemplazo una escritura mas nueva): no se toca.
const SETTLE_SCRIPT = `-- whatsapp:cola:soltar
local k = KEYS[1]
if redis.call('hget', k, 't:' .. ARGV[1]) ~= ARGV[2] then return 0 end
if ARGV[4] ~= '' then redis.call('hset', k, ARGV[1], ARGV[4]) end
redis.call('hset', k, 't:' .. ARGV[1], ARGV[3])
if ARGV[5] and ARGV[5] ~= '' then redis.call('hset', k, ARGV[5], ARGV[6]) end
return 1`;

// [REGISTRO] Anota que Pipedrive confirmo los campos del negocio ARGV[1] ('v:<negocio>') armados por el
// mensaje ARGV[2], si son mas nuevos que los anotados; la cola queda con su plazo (ARGV[3]).
const CONFIRM_SCRIPT = `-- whatsapp:cola:version
local k = KEYS[1]
local cur = tonumber(redis.call('hget', k, ARGV[1]) or '0') or 0
if tonumber(ARGV[2]) > cur then redis.call('hset', k, ARGV[1], ARGV[2]) end
redis.call('expire', k, tonumber(ARGV[3]))
return 1`;

function queueOf(phone: string): Map<string, QueueEntry> {
  let q = queues.get(phone);
  if (!q) { q = new Map(); queues.set(phone, q); }
  return q;
}

const byAt = (a: QueueEntry, b: QueueEntry) => a.item.at - b.item.at;

function sortedQueue(phone: string): QueuedWrite[] {
  return [...queueOf(phone).values()].sort(byAt).map((v) => v.item);
}

function validWrite(w: unknown): w is PendingWhatsAppWrite {
  const v = w as PendingWhatsAppWrite | undefined;
  return Boolean(v && typeof v === 'object' && typeof v.dealId === 'number' && (v.note === undefined || typeof v.note === 'string'));
}

/** Id de una escritura: el prefijo dice si lleva nota (cuenta para el tope de notas). */
function entryId(write: PendingWhatsAppWrite, suffix: string = randomUUID()): string {
  return (write.note !== undefined ? 'n:' : 'f:') + suffix;
}

const entryOf = (item: QueuedWrite, stored: boolean): QueueEntry => ({ item, stored, last: 0, until: 0 });

/** [REGISTRO] `a` es anterior a `b`: por el mensaje que armo sus campos y, con el mismo, por su hora. */
function olderThan(a: QueuedWrite, b: QueuedWrite): boolean {
  const va = pendingVersion(a);
  const vb = pendingVersion(b);
  return va < vb || (va === vb && a.at < b.at);
}

/** Las escrituras de solo campos anteriores del mismo negocio: `item` (la foto completa) las reemplaza. */
function replacedBy(phone: string, item: QueuedWrite): string[] {
  if (item.write.note !== undefined) return [];
  return [...queueOf(phone).values()]
    .filter((v) => v.item.write.note === undefined && v.item.write.dealId === item.write.dealId && olderThan(v.item, item))
    .map((v) => v.item.id);
}

function confirmedVersion(phone: string, dealId: number): number {
  return confirmedFields.get(phone)?.get(dealId) ?? 0;
}

function noteConfirmed(phone: string, dealId: number, ver: number): void {
  if (!Number.isFinite(dealId) || !Number.isFinite(ver)) return;
  let byDeal = confirmedFields.get(phone);
  if (!byDeal) { byDeal = new Map(); confirmedFields.set(phone, byDeal); }
  byDeal.set(dealId, Math.max(byDeal.get(dealId) ?? 0, ver));
}

async function storeConfirmed(phone: string, dealId: number, ver: number): Promise<boolean> {
  const result = await redisJsonCommand<number>('EVAL', CONFIRM_SCRIPT, '1', pendingKey(phone), 'v:' + String(dealId), ver, PENDING_WRITE_TTL_S);
  if (!result.ok) unavailable('anotar campos confirmados');
  return result.ok;
}

/**
 * [REGISTRO] Pipedrive confirmo los campos del negocio armados por el mensaje `ver`: los de la cola que
 * armo un mensaje anterior ya no se mandan (pisarian el valor mas nuevo). Se guarda en la cola, con su
 * plazo, y viaja tambien en el estado de la conversacion (Snapshot.confirmed): si este EVAL falla, otra
 * instancia lo lee del estado, y esta lo vuelve a anotar en la lectura siguiente de la cola.
 */
export async function confirmDealFields(phone: string, dealId: number, ver: number): Promise<void> {
  noteConfirmed(phone, dealId, ver);
  if (await storeConfirmed(phone, dealId, ver)) return;
  let byDeal = unconfirmed.get(phone);
  if (!byDeal) { byDeal = new Map(); unconfirmed.set(phone, byDeal); }
  byDeal.set(dealId, Math.max(byDeal.get(dealId) ?? 0, ver));
}

/** [REGISTRO] Los negocios con campos confirmados que viajan en el estado (los mas recientes). */
function confirmedOf(phone: string): Record<string, number> {
  const entries = [...(confirmedFields.get(phone) ?? new Map<number, number>())].sort((a, b) => a[1] - b[1]).slice(-MAX_CONFIRMED);
  return Object.fromEntries(entries.map(([deal, ver]) => [String(deal), ver]));
}

function mergeConfirmed(a: Record<string, number> = {}, b: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [deal, ver] of Object.entries(b)) out[deal] = Math.max(out[deal] ?? 0, ver);
  return Object.fromEntries(Object.entries(out).sort((x, y) => x[1] - y[1]).slice(-MAX_CONFIRMED));
}

/** [REGISTRO] Los campos de `item` ya los supero otra escritura del mismo negocio, confirmada o en la cola. */
function fieldsSuperseded(phone: string, item: QueuedWrite): boolean {
  if (!item.write.fields) return false;
  if (confirmedVersion(phone, item.write.dealId) >= pendingVersion(item)) return true;
  return [...queueOf(phone).values()].some((v) => v.item.id !== item.id && v.item.write.fields !== undefined
    && v.item.write.dealId === item.write.dealId && olderThan(item, v.item));
}

const withoutFields = (write: PendingWhatsAppWrite): PendingWhatsAppWrite => {
  const rest = { ...write };
  delete rest.fields;
  return rest;
};

/**
 * [NOTA-REF] El intento anterior de la nota quedo sin cerrar: pudo llegar a Pipedrive. Solo las notas con
 * referencia (las de antes de este cambio se mandan como antes). No se conoce el fin del intento: se usa
 * su inicio para noteUnsureLast; la reserva vence a los 75 s, pasados los 30 s de espera desde ese inicio.
 */
function withUnsure(write: PendingWhatsAppWrite, since: number | undefined): PendingWhatsAppWrite {
  if (since === undefined || write.note === undefined || typeof write.noteRef !== 'string') return write;
  const prev = finiteOr(write.noteUnsure, since);
  return { ...write, noteUnsure: Math.min(prev, since), noteUnsureLast: Math.max(finiteOr(write.noteUnsureLast, since), since) };
}

const finiteOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * [NOTA-REF] Un guardado en la cola (agregar o soltar) quedo sin respuesta: pudo aplicarse en Upstash, otra
 * instancia pudo entregar la nota desde alla y borrarla, y esta la volveria a guardar (la cola no sabe que
 * se borro). La nota queda como incierta desde `at`: antes de repetirla se busca (solo si lleva referencia;
 * no cambia el ultimo envio incierto, porque esta instancia no la mando).
 */
function markUnconfirmed(entry: QueueEntry, at: number): void {
  const write = entry.item.write;
  if (write.note === undefined || typeof write.noteRef !== 'string') return;
  entry.item = { ...entry.item, write: { ...write, noteUnsure: Math.min(finiteOr(write.noteUnsure, at), at) } };
}

/**
 * [REGISTRO] Lo que se manda de una escritura de la cola: sin los campos que ya supero una escritura de un
 * mensaje posterior (R4: un correo viejo no vuelve a quedar en el negocio), con la nota. undefined: no
 * queda nada que mandar (solo eran campos superados).
 * [NOTA-REF] Despues de la reserva, la escritura que ella leyo de Upstash y, si el intento anterior quedo
 * sin cerrar, su nota marcada como incierta.
 */
export function sendablePendingWrite(phone: string, item: QueuedWrite): PendingWhatsAppWrite | undefined {
  const entry = queues.get(phone)?.get(item.id);
  const current = entry?.item ?? item;
  const write = withUnsure(current.write, entry?.unsureSince);
  if (!fieldsSuperseded(phone, current)) return write;
  return write.note !== undefined ? withoutFields(write) : undefined;
}

/** [TOPE] Sin Upstash: el mismo tope del EVAL, sobre lo que hay en la memoria. */
function fullLocally(phone: string, item: QueuedWrite, replace: string[]): boolean {
  const entries = [...queueOf(phone).values()].filter((v) => !replace.includes(v.item.id));
  if (item.id.startsWith('n:') && entries.filter((v) => v.item.id.startsWith('n:')).length >= MAX_PENDING_WRITES) return true;
  return entries.length >= MAX_PENDING_TOTAL;
}

/** Guarda una escritura en Upstash: el tope, la escritura, sus reemplazos y el plazo, en un solo EVAL. */
async function storeEntry(phone: string, item: QueuedWrite, replace: string[]): Promise<'stored' | 'full' | 'unavailable'> {
  const result = await redisJsonCommand<number>(
    'EVAL', ENQUEUE_SCRIPT, '1', pendingKey(phone), item.id, JSON.stringify(item),
    MAX_PENDING_WRITES, MAX_PENDING_TOTAL, PENDING_WRITE_TTL_S, ...replace,
  );
  // Sin respuesta no se da por guardada (aunque se haya aplicado): la proxima lectura la guarda de nuevo.
  if (!result.ok) { unavailable('guardar escritura pendiente'); return 'unavailable'; }
  return Number(result.result) === 1 ? 'stored' : 'full';
}

/**
 * Agrega una escritura nueva. false: la cola llego a su tope (en Upstash o, sin Upstash, en la memoria).
 * Lo que reemplaza sale con ella: de Upstash en el mismo EVAL; sin Upstash, de la memoria sale solo lo que
 * no estaba alla (lo de alla lo reemplaza cuando esta quede guardada).
 */
async function addEntry(phone: string, item: QueuedWrite): Promise<boolean> {
  const replace = replacedBy(phone, item);
  const at = Date.now();
  const stored = await storeEntry(phone, item, replace);
  if (stored === 'full' || (stored === 'unavailable' && fullLocally(phone, item, replace))) return false;
  const q = queueOf(phone);
  for (const id of replace) if (stored === 'stored' || !q.get(id)?.stored) q.delete(id);
  const entry = entryOf(item, stored === 'stored');
  // [NOTA-REF] Sin respuesta pudo quedar guardada alla igual.
  if (stored === 'unavailable') markUnconfirmed(entry, at);
  q.set(item.id, entry);
  return true;
}

/** [NOTA-REF] Clave estable, distinta de los UUID y de las entradas legacy-. */
export function noteWriteKey(kind: 'r' | 'm', id: string, dealId: number): string | undefined {
  return /^[A-Za-z0-9]{1,64}$/.test(id) && Number.isSafeInteger(dealId) && dealId > 0
    ? kind + id + '.' + String(dealId) : undefined;
}

const keyedNote = (id: string): boolean => /^n:[rm][A-Za-z0-9]{1,64}\.[1-9][0-9]*$/.test(id);
const deliveryKey = (id: string): string => 'd:' + id.slice(2);

export interface NoteDeliveryMark {
  at: number;
  dealId: number;
  sid?: string;
  noteIds?: string[];
}

export type Anticipated = { status: 'new'; item: QueuedWrite }
  | { status: 'queued'; item: QueuedWrite }
  | { status: 'memory'; item: QueuedWrite }
  | { status: 'delivered'; mark: NoteDeliveryMark }
  | { status: 'full' };

// [NOTA-REF] Una respuesta ilegible de Upstash no hace fallar el registro.
function parseDeliveryMark(value: unknown): NoteDeliveryMark | undefined {
  try {
    const mark = JSON.parse(String(value)) as NoteDeliveryMark;
    return mark && typeof mark.at === 'number' && typeof mark.dealId === 'number' ? mark : undefined;
  } catch { return undefined; }
}

function deliveryMark(item: QueuedWrite): string {
  return JSON.stringify({ at: Date.now(), dealId: item.write.dealId, sid: item.sid, noteIds: item.noteIds });
}

// [NOTA-REF] DONE puede terminar antes de un anticipar lento: recordar la entrega y su alias localmente.
const recentDeliveries = new Map<string, { until: number; mark: string }>();
const RECENT_DELIVERY_TTL_MS = 5 * 60_000;
const RECENT_DELIVERY_MAX = 500;
const registrationAlias = (item: QueuedWrite): string => item.id.startsWith('n:r') && item.sid && /^[A-Za-z0-9]{1,64}$/.test(item.sid)
  ? 's:' + item.sid + '.' + item.write.dealId : '';

function rememberDelivery(phone: string, item: QueuedWrite, mark: string): void {
  const now = Date.now();
  for (const [key, value] of recentDeliveries) if (value.until <= now) recentDeliveries.delete(key);
  for (const id of [item.id, registrationAlias(item)].filter(Boolean)) {
    const key = phone + ':' + id;
    recentDeliveries.delete(key);
    recentDeliveries.set(key, { until: now + RECENT_DELIVERY_TTL_MS, mark });
  }
  while (recentDeliveries.size > RECENT_DELIVERY_MAX) recentDeliveries.delete(recentDeliveries.keys().next().value!);
}

function recentDelivery(phone: string, item: QueuedWrite): NoteDeliveryMark | undefined {
  for (const id of [item.id, registrationAlias(item)].filter(Boolean)) {
    const key = phone + ':' + id;
    const value = recentDeliveries.get(key);
    if (!value) continue;
    if (value.until > Date.now()) return parseDeliveryMark(value.mark);
    recentDeliveries.delete(key);
  }
  return undefined;
}

async function storeAnticipated(phone: string, item: QueuedWrite, lease = '', overwrite = false, timeoutMs = 800) {
  // [NOTA-REF] El alias protege registros cuyo primer mensaje cambio al reentregarse.
  const alias = registrationAlias(item);
  return redisJsonCommandWithTimeout<unknown>(timeoutMs,
    'EVAL', ANTICIPATE_SCRIPT, '1', pendingKey(phone), item.id, JSON.stringify(item),
    MAX_PENDING_WRITES, MAX_PENDING_TOTAL, PENDING_WRITE_TTL_S, deliveryKey(item.id), lease, overwrite ? '1' : '0', alias,
  );
}

/** [NOTA-REF] Guarda la nota y su primer intento juntos; sin Upstash sigue en esta instancia. */
export async function anticipateWrite(phone: string, write: PendingWhatsAppWrite, {
  key, ver, sid, noteIds, reserve = true, leaseUntil = Infinity,
}: { key: string; ver: number; sid?: string; noteIds?: string[]; reserve?: boolean; leaseUntil?: number }): Promise<Anticipated> {
  const now = Date.now();
  // [NOTA-REF] Fuera del limite se guarda sin reserva, como una escritura para la cola.
  reserve = reserve && leaseUntil > now;
  const item: QueuedWrite = { id: 'n:' + key, at: now, ver, write, sid, noteIds: noteIds?.slice(0, 60) };
  const lease = reserve ? String(Math.floor(Math.min(now + PENDING_CLAIM_TTL_MS, leaseUntil))) + ':' + String(now) + ':' + randomUUID() : '';
  // [NOTA-REF] 300 ms solo con reserva: sin ella, el relevo de este turno necesita la entrada guardada (800 ms, como main).
  const result = await storeAnticipated(phone, item, lease, false, reserve ? 300 : 800).catch(() => ({ ok: false as const }));
  if (result.ok) {
    const reply = Array.isArray(result.result) ? result.result : [result.result];
    if (Number(reply[0]) === 0) return { status: 'full' };
    if (Number(reply[0]) === 2) {
      const mark = parseDeliveryMark(reply[1]);
      if (mark) return { status: 'delivered', mark };
    }
    if (Number(reply[0]) === 3) {
      const previous = claimedItem(reply[2], String(reply[3] ?? item.id));
      if (previous) {
        queueOf(phone).set(previous.id, { ...entryOf(previous, true), ...parseTry(String(reply[1])) });
        return { status: 'queued', item: previous };
      }
    }
    if (Number(reply[0]) === 1) {
      queueOf(phone).set(item.id, { ...entryOf(item, true), ...parseTry(lease), ...(lease ? { lease } : {}) });
      return { status: 'new', item };
    }
  }
  unavailable('anticipar nota');
  const recent = recentDelivery(phone, item);
  if (recent) return { status: 'delivered', mark: recent };
  const previous = queueOf(phone).get(item.id);
  if (previous) return { status: 'queued', item: previous.item };
  const mark = delivered.get(phone)?.get(item.id);
  if (mark) return { status: 'delivered', mark: JSON.parse(mark) as NoteDeliveryMark };
  if (fullLocally(phone, item, [])) return { status: 'full' };
  const entry = { ...entryOf(item, false), ...parseTry(lease), ...(lease ? { lease } : {}) };
  if (!reserve) markUnconfirmed(entry, now);
  queueOf(phone).set(item.id, entry);
  return { status: 'memory', item: entry.item };
}

/** [NOTA-REF] Plazo local del intento, tambien el que quedo abierto en otra instancia. */
export function pendingLeaseUntil(phone: string, id: string): number {
  return queues.get(phone)?.get(id)?.until ?? 0;
}

async function removeDelivered(phone: string, id: string, mark: string | undefined) {
  return mark === undefined
    ? redisJsonCommand('HDEL', pendingKey(phone), id, 't:' + id)
    : redisJsonCommand('EVAL', DONE_SCRIPT, '1', pendingKey(phone), id, deliveryKey(id), mark,
      Date.now(), CONVERSATION_TTL_S * 1000, PENDING_WRITE_TTL_S);
}

// [NOTA-REF] La lapida tapa la entrada remota durante el borrado, sin repetir el EVAL en vuelo.
async function finishDelivered(phone: string, id: string, mark: string | undefined): Promise<void> {
  const key = phone + ':' + id;
  if (deliveryInFlight.has(key)) return;
  deliveryInFlight.add(key);
  try {
    const del = await removeDelivered(phone, id, mark);
    const tomb = delivered.get(phone);
    if (del.ok) tomb?.delete(id);
    else unavailable('borrar escritura entregada');
    if (tomb && !tomb.size) delivered.delete(phone);
  } finally { deliveryInFlight.delete(key); }
}

/** [NOTA-REF] A lo mas una lapida por turno; el webhook lo llama en segundo plano. */
export async function retryDeliveredWrite(phone: string): Promise<void> {
  for (const [id, mark] of delivered.get(phone) ?? []) {
    if (deliveryInFlight.has(phone + ':' + id)) continue;
    await finishDelivered(phone, id, mark);
    return;
  }
}

/** Las escrituras pendientes que conoce esta instancia, de la mas antigua a la mas nueva. */
export function getPendingWrites(phone: string): PendingWhatsAppWrite[] {
  return sortedQueue(phone).map((q) => q.write);
}

/** Reemplaza la cola en memoria (se guarda en Upstash en la proxima lectura de la cola). */
export function setPendingWrites(phone: string, pending: PendingWhatsAppWrite[]): void {
  const q = queueOf(phone);
  q.clear();
  const now = Date.now();
  pending.forEach((write, i) => { const id = entryId(write); q.set(id, entryOf({ id, at: now + i, write }, false)); });
}

/**
 * Agrega una escritura sin confirmar. false: la nota no entro porque la cola llego a su tope (quien llama
 * conserva la transcripcion, para que la nota siguiente la incluya). Sus campos entran igual, aparte
 * (enqueueFields). Sin Upstash queda solo en la memoria de esta instancia.
 * [REGISTRO] `ver`: el numero de orden del mensaje que armo los campos (sin el, la hora). Los campos que ya
 * supero una escritura confirmada de un mensaje posterior no entran; la nota si.
 */
export async function enqueuePendingWrite(phone: string, write: PendingWhatsAppWrite, ver: number = Date.now() * 2000): Promise<boolean> {
  const w = write.fields && confirmedVersion(phone, write.dealId) >= ver ? withoutFields(write) : write;
  if (w.note === undefined) return w.fields ? enqueueFields(phone, w, ver) : true;
  if (await addEntry(phone, { id: entryId(w), at: Date.now(), ver, write: w })) return true;
  // Sin el telefono ni el contenido: solo el tope y el negocio (para revisarlo a mano si sigue asi).
  console.error(LOG_PREFIX + ' Cola de escrituras pendientes llena (' + MAX_PENDING_WRITES + '); la nota no entra y la transcripcion queda para la nota siguiente (negocio ' + w.dealId + ')');
  if (w.fields) await enqueueFields(phone, { dealId: w.dealId, fields: w.fields }, ver);
  return false;
}

/**
 * [PENDIENTES] Campos del negocio sin confirmar (sin nota). Son la foto completa del negocio, asi que
 * reemplazan a los que esperaban del mismo negocio: una sola escritura de campos por negocio, que no
 * cuenta para el tope de notas. false: el tope duro (MAX_PENDING_TOTAL), con la cola llena de otros negocios.
 * [REGISTRO] Se juntan en el orden de los mensajes que los armaron: queda el valor del mas nuevo, aunque
 * su escritura haya llegado antes a la cola.
 */
async function enqueueFields(phone: string, write: PendingWhatsAppWrite, ver: number): Promise<boolean> {
  const older = [...queueOf(phone).values()]
    .filter((v) => v.item.write.note === undefined && v.item.write.dealId === write.dealId)
    .map((v) => v.item);
  const parts = [...older.map((i) => ({ ver: pendingVersion(i), fields: i.write.fields ?? {} })), { ver, fields: write.fields ?? {} }]
    .sort((a, b) => a.ver - b.ver);
  const fields = Object.assign({}, ...parts.map((p) => p.fields)) as Record<string, string>;
  // Despues de las que reemplaza, tambien si llegan en el mismo milisegundo.
  const at = Math.max(Date.now(), ...older.map((i) => i.at + 1));
  const item: QueuedWrite = { id: entryId({ dealId: write.dealId }), at, ver: Math.max(...parts.map((p) => p.ver)), write: { ...write, fields } };
  if (await addEntry(phone, item)) return true;
  console.error(LOG_PREFIX + ' Cola de escrituras pendientes en su tope duro (' + MAX_PENDING_TOTAL + '); los campos no entran y la transcripcion queda para la nota siguiente (negocio ' + write.dealId + ')');
  return false;
}

// [NOTA-REF] El rastro de otro sid no confirma esta copia: conserva su nota incierta y sus campos.
async function reconcileAnticipated(phone: string, entry: QueueEntry, sid: string | undefined): Promise<boolean> {
  const { write } = entry.item;
  const ver = pendingVersion(entry.item);
  if (sid !== entry.item.sid) {
    if (!(await enqueuePendingWrite(phone, write, ver))) return false;
  } else if (write.fields && !fieldsSuperseded(phone, entry.item)) {
    if (!(await enqueueFields(phone, { dealId: write.dealId, fields: write.fields }, ver))) return false;
  }
  queueOf(phone).delete(entry.item.id);
  return true;
}

// Escrituras de un estado anterior que esta instancia ya vio en la cola (no se vuelven a pasar).
const migrated = new Map<string, Set<string>>();

/**
 * [PENDIENTES] Las de un estado anterior pasan a la cola, con id fijo (el hash de su contenido). La
 * escritura, su marca y el plazo van en un solo EVAL (MIGRATE_SCRIPT): la marca nunca queda sin la
 * escritura, y una ya pasada (quizas ya entregada) no se vuelve a pasar aunque el estado guardado la siga
 * trayendo un rato. Devuelve las que no se pudo confirmar en la cola: siguen en el estado guardado.
 */
async function migrateLegacyPending(phone: string, legacy: unknown): Promise<PendingWhatsAppWrite[]> {
  if (!Array.isArray(legacy) || !legacy.length) return [];
  let done = migrated.get(phone);
  if (!done) { done = new Set(); migrated.set(phone, done); }
  const left: PendingWhatsAppWrite[] = [];
  for (const [i, write] of legacy.entries()) {
    if (!validWrite(write)) continue;
    const hash = 'legacy-' + createHash('sha256').update(JSON.stringify(write)).digest('hex').slice(0, 24);
    if (done.has(hash)) continue;
    const item: QueuedWrite = { id: entryId(write, hash), at: i, write };
    const result = await redisJsonCommand<number>('EVAL', MIGRATE_SCRIPT, '1', pendingKey(phone), item.id, JSON.stringify(item), 'm:' + hash, PENDING_WRITE_TTL_S);
    if (!result.ok) { unavailable('pasar escritura pendiente a la cola'); left.push(write); continue; }
    done.add(hash);
    if (Number(result.result) === 1) queueOf(phone).set(item.id, entryOf(item, true));
  }
  return left;
}

/** Marca de intento guardada en Upstash ('<reservada hasta>:<inicio>:<token>'). */
function parseTry(value: string | undefined): { until: number; last: number } {
  const m = /^(\d+):(\d+)/.exec(value ?? '');
  return m ? { until: Number(m[1]), last: Number(m[2]) } : { until: 0, last: 0 };
}

/**
 * La cola: guarda en Upstash lo que habia quedado solo en memoria (con el tope: si no cabe, sigue en
 * memoria), borra alla lo ya entregado y suma lo que dejaron otras instancias, con sus intentos. Lo
 * guardado que ya no esta alla lo entrego otra instancia (o lo reemplazo una escritura mas nueva).
 */
export async function loadPendingWrites(phone: string): Promise<QueuedWrite[]> {
  const key = pendingKey(phone);
  const tomb = delivered.get(phone);
  // [REGISTRO] Los campos confirmados que no se pudo anotar en la cola.
  const toConfirm = unconfirmed.get(phone);
  for (const [dealId, ver] of [...(toConfirm ?? [])]) if (await storeConfirmed(phone, dealId, ver)) toConfirm!.delete(dealId);
  if (toConfirm && !toConfirm.size) unconfirmed.delete(phone);
  for (const entry of [...queueOf(phone).values()].sort(byAt)) {
    if (entry.stored || queueOf(phone).get(entry.item.id) !== entry) continue;
    if (keyedNote(entry.item.id)) {
      // [NOTA-REF] Un primer envio todavia en curso conserva su reserva: otra instancia no lo repite.
      const held = entry.lease !== undefined && entry.until > Date.now() ? entry.lease : '';
      const result = await storeAnticipated(phone, entry.item, held, true);
      if (!result.ok) continue;
      const reply = Array.isArray(result.result) ? result.result : [result.result];
      if (Number(reply[0]) === 2) {
        const mark = parseDeliveryMark(reply[1]);
        if (mark) await reconcileAnticipated(phone, entry, mark.sid);
      } else if (Number(reply[0]) === 1) entry.stored = true;
      else if (Number(reply[0]) === 3) {
        // [NOTA-REF] El alias conserva el intento remoto; la copia local se reconcilia por sid.
        const previous = claimedItem(reply[2], String(reply[3] ?? entry.item.id));
        if (previous && await reconcileAnticipated(phone, entry, previous.sid)) {
          queueOf(phone).set(previous.id, { ...entryOf(previous, true), ...parseTry(String(reply[1])) });
        }
      }
      continue;
    }
    const replace = replacedBy(phone, entry.item);
    // [NOTA-REF] Las entradas al azar conservan la busqueda si el guardado quedo sin respuesta.
    if ((await storeEntry(phone, entry.item, replace)) !== 'stored') continue;
    entry.stored = true;
    for (const id of replace) queueOf(phone).delete(id);
  }
  const all = await redisJsonCommand<string[] | null>('HGETALL', key);
  const q = queueOf(phone);
  if (all.ok) {
    const remote = new Map<string, QueuedWrite>();
    const tries = new Map<string, string>();
    const flat = Array.isArray(all.result) ? all.result : [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const field = String(flat[i]);
      if (field.startsWith('t:')) { tries.set(field.slice(2), String(flat[i + 1])); continue; }
      if (field.startsWith('v:')) { noteConfirmed(phone, Number(field.slice(2)), Number(flat[i + 1])); continue; }
      if (field.startsWith('m:') || field.startsWith('d:') || field.startsWith('s:')) continue;
      try {
        const item = JSON.parse(String(flat[i + 1])) as QueuedWrite;
        if (item && item.id === field && typeof item.at === 'number' && validWrite(item.write)) remote.set(item.id, item);
      } catch { /* una entrada ilegible no se puede reintentar: queda en Upstash hasta vencer */ }
    }
    for (const [id, v] of q) if (v.stored && !remote.has(id)) q.delete(id);
    for (const [id, item] of remote) {
      const mine = q.get(id);
      // Lo que esta instancia no pudo guardar (lo que falta de un intento) manda sobre lo de alla.
      if (tomb?.has(id) || (mine && !mine.stored)) continue;
      const t = tries.get(id);
      // La reserva de esta instancia sigue: conserva su marca y [NOTA-REF] lo que ella anoto.
      const held = mine?.lease !== undefined && mine.lease === t;
      q.set(id, {
        item, stored: true, ...parseTry(t),
        ...(held ? { lease: mine.lease, ...(mine.unsureSince !== undefined ? { unsureSince: mine.unsureSince } : {}) } : {}),
      });
    }
  } else {
    unavailable('leer escrituras pendientes');
  }
  const out = sortedQueue(phone);
  if (!out.length) queues.delete(phone);
  return out;
}

/**
 * [PENDIENTES] Las que reintenta este mensaje (hasta `max`). Se eligen primero las que llevan mas tiempo
 * sin intentarse (las nunca intentadas, luego las que fallaron hace mas): cinco que siempre fallan no
 * frenan a una posterior. Se mandan en orden de llegada (si caben todas, van todas en orden). Cada una se
 * reserva justo antes de mandarla (claimPendingWrite).
 */
export async function duePendingWrites(phone: string, max: number): Promise<QueuedWrite[]> {
  await loadPendingWrites(phone);
  const q = queueOf(phone);
  const now = Date.now();
  // Los campos que ya reemplazo una escritura mas nueva (aun sin guardar) no se mandan.
  const replaced = new Set([...q.values()].flatMap((v) => replacedBy(phone, v.item)));
  const due = [...q.values()]
    .filter((v) => v.until <= now && !replaced.has(v.item.id))
    .sort((a, b) => a.last - b.last || byAt(a, b))
    .slice(0, Math.max(0, max))
    .sort(byAt);
  if (!q.size) queues.delete(phone);
  return due.map((v) => v.item);
}

/** [NOTA-REF] La escritura que devolvio la reserva, si se lee y es la misma (si no, queda la de la memoria). */
function claimedItem(value: unknown, id: string): QueuedWrite | undefined {
  try {
    const item = JSON.parse(String(value)) as QueuedWrite;
    return item && item.id === id && typeof item.at === 'number' && validWrite(item.write) ? item : undefined;
  } catch {
    return undefined;
  }
}

/**
 * [PENDIENTES] Reserva una escritura justo antes de mandarla, por PENDING_CLAIM_TTL_MS (un intento dura a lo
 * mas tres llamadas a Pipedrive). La reserva vive en Upstash: otra instancia no manda la misma escritura a
 * la vez, aunque haya vencido el candado de la conversacion. false: ya no esta, la tiene otro intento o no
 * se pudo reservar (alla queda a salvo, para otro mensaje). La que solo esta en esta memoria se reserva aqui.
 * [NOTA-REF] La escritura queda como esta en Upstash: otra instancia pudo mandarla y soltarla (con su nota
 * marcada como incierta) despues de la lectura de esta. Si el intento anterior no se cerro (su reserva
 * vencio sin soltarse: la instancia se corto, quizas despues de mandar la nota), se anota su inicio.
 */
export async function claimPendingWrite(phone: string, id: string): Promise<boolean> {
  const entry = queueOf(phone).get(id);
  const now = Date.now();
  if (!entry || entry.until > now) {
    if (!queueOf(phone).size) queues.delete(phone);
    return false;
  }
  const lease = String(now + PENDING_CLAIM_TTL_MS) + ':' + String(now) + ':' + randomUUID();
  // Sin Upstash, el intento anterior de esta instancia (until vuelve a 0 al soltarla).
  let previous = { until: entry.until, last: entry.last };
  let fresh: QueuedWrite | undefined;
  if (entry.stored) {
    const result = await redisJsonCommand<unknown>('EVAL', CLAIM_SCRIPT, '1', pendingKey(phone), now, lease, id);
    if (!result.ok) { unavailable('reservar escritura pendiente'); return false; }
    const reply = Array.isArray(result.result) ? result.result : [result.result];
    if (Number(reply[0]) !== 1) return false;
    previous = parseTry(typeof reply[1] === 'string' ? reply[1] : undefined);
    fresh = claimedItem(reply[2], id);
  }
  const current = queueOf(phone).get(id) ?? entry;
  if (fresh) current.item = fresh;
  current.last = now;
  current.until = now + PENDING_CLAIM_TTL_MS;
  if (previous.until > 0) current.unsureSince = previous.last;
  else delete current.unsureSince;
  if (current.stored) current.lease = lease;
  return true;
}

/**
 * Resultado del reintento: sin `remaining`, se entrego y sale de la cola; si no, queda lo que falta, con
 * la marca de este intento (va al final de la rotacion) y libre para el proximo mensaje.
 */
export async function settlePendingWrite(phone: string, id: string, remaining: PendingWhatsAppWrite | undefined): Promise<void> {
  const entry = queueOf(phone).get(id);
  // [NOTA-REF] Tambien al terminar solo campos: la nota pudo salir en un intento anterior.
  const mark = entry && keyedNote(id) && remaining?.note === undefined
    ? deliveryMark(entry.item) : undefined;
  if (entry && mark) rememberDelivery(phone, entry.item, mark);
  if (!remaining) {
    queueOf(phone).delete(id);
    let tomb = delivered.get(phone);
    if (!tomb) { tomb = new Map(); delivered.set(phone, tomb); }
    tomb.set(id, mark);
    await finishDelivered(phone, id, mark);
    if (!queueOf(phone).size) queues.delete(phone);
    return;
  }
  if (!entry) {
    if (!queueOf(phone).size) queues.delete(phone);
    return;
  }
  const changed = JSON.stringify(entry.item.write) !== JSON.stringify(remaining);
  if (changed) entry.item = { ...entry.item, write: remaining };
  const lease = entry.lease;
  entry.until = 0;
  delete entry.lease;
  // [NOTA-REF] Lo incierto ya va en `remaining` (noteUnsure), que se guarda si cambio.
  delete entry.unsureSince;
  if (lease === undefined) return;
  const at = Date.now();
  const result = await redisJsonCommand<number>(
    'EVAL', SETTLE_SCRIPT, '1', pendingKey(phone), id, lease, '0:' + String(entry.last) + ':', changed ? JSON.stringify(entry.item) : '',
    mark ? deliveryKey(id) : '', mark ?? '',
  );
  if (result.ok && Number(result.result) === 1) {
    entry.stored = true;
    // [NOTA-REF] La marca ya esta a salvo: los campos solos vuelven a juntarse por negocio como antes.
    if (mark && remaining.fields) await enqueueFields(phone, remaining, pendingVersion(entry.item));
  }
  // [NOTA-REF] Si anticipar nunca llego, SETTLE no tiene token remoto: respalda sin pisar otro intento.
  if (result.ok && Number(result.result) === 0 && !entry.stored && keyedNote(id)) {
    const saved = await storeAnticipated(phone, entry.item);
    if (saved.ok) {
      const reply = Array.isArray(saved.result) ? saved.result : [saved.result];
      if (Number(reply[0]) === 1) entry.stored = true;
      if (Number(reply[0]) === 2) {
        const remoteMark = parseDeliveryMark(reply[1]);
        if (remoteMark) await reconcileAnticipated(phone, entry, remoteMark.sid);
      } else if (Number(reply[0]) === 3) {
        const previous = claimedItem(reply[2], String(reply[3] ?? id));
        if (previous) await reconcileAnticipated(phone, entry, previous.sid);
      }
    } else markUnconfirmed(entry, at);
  }
  if (!result.ok) {
    unavailable('liberar escritura pendiente');
    // Lo que falta (una parte ya llego a ventas) se guarda en la proxima lectura de la cola. [NOTA-REF] Otra
    // instancia pudo entregarla mientras tanto (al vencer esta reserva): se busca antes de repetirla.
    if (changed) {
      entry.stored = false;
      markUnconfirmed(entry, at);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// [CONCURRENCIA] Mezcla de tres vias

/** JSON con las claves ordenadas: compara valores sin depender del orden en que se armaron. */
function stable(value: unknown): string {
  if (value === undefined) return 'u';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(obj[k])).join(',') + '}';
}
const eq = (a: unknown, b: unknown) => stable(a) === stable(b);

/** Los mismos datos, sin importar el orden de las claves (webhook.ts: que trajo de nuevo un mensaje). */
export function sameData(a: unknown, b: unknown): boolean {
  return eq(a, b);
}

// Campos que cambian juntos: el resultado del negocio y su id.
const FIELD_GROUPS: string[][] = [['deal', 'dealId']];

/**
 * [CONCURRENCIA] Un lado de la mezcla: su flujo, la marca de cada dato (fieldSeq) y, para un dato sin
 * marca (un estado anterior a este cambio), el numero de orden del ultimo mensaje de ese lado (flowSeq).
 */
interface FlowSide { flow: FlowState; seqs: Record<string, number>; seq: number }

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** El mensaje mas nuevo que dejo estos datos en un lado. */
function stampOf(side: FlowSide, keys: string[]): number {
  const marks = keys.map((k) => side.seqs[k]).filter(isNumber);
  return marks.length ? Math.max(...marks) : side.seq;
}

/** [CONCURRENCIA] El flujo como dato -> valor: los datos capturados van como 'captured.<dato>'. */
function flatFlow(flow: FlowState | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!flow) return out;
  for (const [k, v] of Object.entries(flow)) if (k !== 'captured' && v !== undefined) out[k] = v;
  for (const [k, v] of Object.entries(flow.captured ?? {})) if (v !== undefined) out['captured.' + k] = v;
  return out;
}

/** Las marcas de un lado que se toma entero (otra conversacion): lo que no tenia marca, la de su mensaje. */
function wholeStamps(side: FlowSide): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(flatFlow(side.flow))) out[k] = side.seqs[k] ?? side.seq;
  return out;
}

/**
 * Cada campo: el lado que lo cambio respecto de `base`; si cambio en los dos, el mensaje mas nuevo segun
 * las marcas de ese campo (R1: no el ultimo mensaje del lado, que pudo cambiar otro dato). Deja en
 * `marks.seqs` la marca que queda de cada campo.
 */
function mergeRecord(
  base: object | undefined, mine: object, theirs: object,
  marks: { mine: FlowSide; theirs: FlowSide; prefix: string; seqs: Record<string, number> },
  skip: string[] = [],
): Record<string, unknown> {
  const b = (base ?? {}) as Record<string, unknown>;
  const m = mine as Record<string, unknown>;
  const t = theirs as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(m), ...Object.keys(t)])].filter((k) => !skip.includes(k));
  const groups = FIELD_GROUPS.filter((g) => g.some((k) => keys.includes(k)));
  const grouped = new Set(groups.flat());
  const units: string[][] = [...groups, ...keys.filter((k) => !grouped.has(k)).map((k) => [k])];
  for (const unit of units) {
    const pick = (o: Record<string, unknown>) => unit.map((k) => o[k]);
    const [mv, tv, bv] = [pick(m), pick(t), pick(b)];
    const stampKeys = unit.map((k) => marks.prefix + k);
    // Iguales en los dos lados: quedan las dos marcas (la mas nueva).
    const take: FlowSide[] = eq(mv, tv) ? [marks.mine, marks.theirs]
      : eq(tv, bv) ? [marks.mine]
        : eq(mv, bv) ? [marks.theirs]
          : [stampOf(marks.mine, stampKeys) > stampOf(marks.theirs, stampKeys) ? marks.mine : marks.theirs];
    const from = take[0] === marks.mine ? m : t;
    for (const k of unit) if (from[k] !== undefined) out[k] = from[k];
    for (const key of stampKeys) {
      const kept = take.length === 1 ? [take[0].seqs[key] ?? take[0].seq] : take.map((s) => s.seqs[key]).filter(isNumber);
      if (kept.length) marks.seqs[key] = Math.max(...kept);
    }
  }
  return out;
}

/**
 * [CONCURRENCIA] Listas de solo agregar de los datos capturados, con el tope de flowEngine.ts
 * (MAX_CAMBIOS: las ultimas 10; MAX_COMUNAS_OTRAS: las primeras 5). Dos mensajes que agregan cada uno
 * una linea conservan las dos. rut_ambiguos no es de solo agregar: es lo que falta aclarar segun el
 * ultimo mensaje (se reemplaza entero o se borra con el RUT valido), y se mezcla como un dato mas.
 */
const APPEND_LISTS: Record<string, (list: unknown[]) => unknown[]> = {
  cambios: (list) => list.slice(-10),
  comunas_otras: (list) => list.slice(0, 5),
};

/** Claves de una lista para compararla elemento a elemento (los repetidos, por su numero de aparicion). */
function itemKeys(list: unknown[]): string[] {
  const seen = new Map<string, number>();
  return list.map((v) => {
    const k = stable(v);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return k + '#' + n;
  });
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Lista en tres vias: sale lo de `base` que quito un lado; queda, en el orden del lado del mensaje que
 * llego antes (`older`), lo que conserva y lo que agrego, y al final lo nuevo del que llego despues
 * (`newer`): el orden de llegada. Si un lado no cambio, queda el otro tal cual.
 */
function mergeList(base: unknown[], older: unknown[], newer: unknown[]): unknown[] {
  if (eq(newer, base)) return older;
  if (eq(older, base)) return newer;
  const bk = new Set(itemKeys(base));
  const ok = itemKeys(older);
  const nk = itemKeys(newer);
  const oset = new Set(ok);
  const nset = new Set(nk);
  return [
    ...older.filter((_, i) => nset.has(ok[i]) || !bk.has(ok[i])),
    ...newer.filter((_, i) => !oset.has(nk[i]) && !bk.has(nk[i])),
  ];
}

function setList(out: Record<string, unknown>, key: string, list: unknown[]): void {
  const capped = APPEND_LISTS[key](list);
  if (capped.length) out[key] = capped;
  else delete out[key];
}

/**
 * Flujo de dos lados que partieron de `base`, con la marca que queda de cada dato. Si un lado empezo otra
 * conversacion (un pedido nuevo), gana esa entera: los cambios del otro eran de la conversacion anterior
 * (como recordDealOutcome).
 */
function mergeFlow(base: FlowState | undefined, mine: FlowSide, theirs: FlowSide): { flow: FlowState; seqs: Record<string, number> } {
  if (mine.flow.firstMessageAt !== theirs.flow.firstMessageAt) {
    const restartedMine = !base || mine.flow.firstMessageAt !== base.firstMessageAt;
    const restartedTheirs = !base || theirs.flow.firstMessageAt !== base.firstMessageAt;
    const keep = restartedMine && restartedTheirs
      ? (stampOf(mine, ['firstMessageAt']) > stampOf(theirs, ['firstMessageAt']) ? mine : theirs)
      : restartedMine ? mine : theirs;
    return { flow: keep.flow, seqs: wholeStamps(keep) };
  }
  const seqs: Record<string, number> = {};
  const out = mergeRecord(base, mine.flow, theirs.flow, { mine, theirs, prefix: '', seqs }, ['captured']) as unknown as FlowState;
  const b = (base?.captured ?? {}) as Record<string, unknown>;
  const m = (mine.flow.captured ?? {}) as Record<string, unknown>;
  const t = (theirs.flow.captured ?? {}) as Record<string, unknown>;
  const captured = mergeRecord(b, m, t, { mine, theirs, prefix: 'captured.', seqs }, Object.keys(APPEND_LISTS));
  for (const key of Object.keys(APPEND_LISTS)) {
    if (m[key] === undefined && t[key] === undefined) continue;
    const stampKey = 'captured.' + key;
    // En el orden de llegada: primero lo del lado cuyo ultimo cambio de la lista es mas antiguo.
    const mineNewer = stampOf(mine, [stampKey]) > stampOf(theirs, [stampKey]);
    const [older, newer] = mineNewer ? [t[key], m[key]] : [m[key], t[key]];
    setList(captured, key, mergeList(asList(b[key]), asList(older), asList(newer)));
    const changed = [...(eq(m[key], b[key]) ? [] : [mine.seqs[stampKey] ?? mine.seq]), ...(eq(t[key], b[key]) ? [] : [theirs.seqs[stampKey] ?? theirs.seq])];
    const kept = changed.length ? changed : [mine.seqs[stampKey], theirs.seqs[stampKey]].filter(isNumber);
    if (kept.length) seqs[stampKey] = Math.max(...kept);
  }
  out.captured = captured as FlowState['captured'];
  return { flow: out, seqs };
}

/**
 * [CONCURRENCIA] Marca con `seq` (el numero de orden del mensaje que los cambio) los datos del flujo que
 * cambiaron desde la ultima marca o lectura. webhook.ts la llama despues de lo que cambia el flujo fuera
 * del paso (el resultado del negocio, la respuesta a una foto); el paso se marca en settleFlowStep.
 */
export function stampFlow(phone: string, seq: number): void {
  const now = getFlowState(phone);
  const before = flatFlow(stampedFlows.get(phone));
  const after = flatFlow(now);
  const seqs = { ...(fieldSeqs.get(phone) ?? {}) };
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (!eq(before[k], after[k])) seqs[k] = seq;
  fieldSeqs.set(phone, seqs);
  stampedFlows.set(phone, structuredClone(now));
}

/**
 * [CONCURRENCIA] Numero de orden del mensaje que dejo asi un dato del flujo ('firstMessageAt': el que abrio
 * la conversacion activa). Sin marca (un estado anterior a las marcas), el del ultimo mensaje que paso por
 * el flujo.
 */
export function flowFieldStamp(phone: string, key: string): number {
  return fieldSeqs.get(phone)?.[key] ?? flowSeqs.get(phone) ?? 0;
}

/**
 * [CONCURRENCIA] En una instancia, como entre dos: si un mensaje posterior ya paso por el flujo mientras
 * este esperaba a Claude, el paso de este corre sobre lo que este leyo al empezar (`base`) y despues se
 * mezcla en tres vias con el estado actual (settleFlowStep). Asi el paso se decide como en el orden de
 * llegada (antes, sobre una conversacion que el posterior ya habia cerrado, "Mejor que sean 20 focos"
 * empezaba un pedido nuevo) y ningun dato ni linea de cambios del otro se pierde. Devuelve el estado
 * actual para la mezcla, o nada si este es el mensaje mas nuevo. Sin await hasta settleFlowStep.
 */
export function beginFlowStep(phone: string, seq: number, base: FlowState): FlowState | undefined {
  if ((flowSeqs.get(phone) ?? 0) <= seq) return undefined;
  const current = structuredClone(getFlowState(phone));
  saveFlowState(phone, structuredClone(base));
  return current;
}

/**
 * [CONCURRENCIA] Cierra el paso de beginFlowStep y marca lo que cambio con `seq` (stampFlow). Lo que
 * cambiaron los dos, lo deja el mensaje mas nuevo segun la marca de cada dato (un posterior, o este si lo
 * que tiene el estado actual vino de un mensaje anterior por la mezcla con otra instancia).
 * `conversationId`: la conversacion de este paso (si el otro empezo un pedido nuevo, gana ese y el resultado
 * de este no se anota ahi). `captured`: el estado mezclado, cuando difiere de lo de este paso (el negocio de
 * este mensaje lo usa).
 */
export function settleFlowStep(phone: string, seq: number, base: FlowState, current: FlowState | undefined): {
  conversationId: number;
  captured?: FlowState['captured'];
} {
  const newest = flowSeqs.get(phone) ?? 0;
  flowSeqs.set(phone, Math.max(newest, seq));
  const after = getFlowState(phone);
  const conversationId = after.firstMessageAt;
  if (!current) {
    stampFlow(phone, seq);
    return { conversationId };
  }
  // Lo que cambio este paso lleva su numero; lo del estado actual, sus marcas (sin marca: el mas nuevo).
  const { flow: merged, seqs } = mergeFlow(base, { flow: after, seqs: {}, seq }, { flow: current, seqs: fieldSeqs.get(phone) ?? {}, seq: newest });
  saveFlowState(phone, merged);
  fieldSeqs.set(phone, seqs);
  stampedFlows.set(phone, structuredClone(getFlowState(phone)));
  if (merged.firstMessageAt !== conversationId || eq(merged, after)) return { conversationId };
  console.log(LOG_PREFIX + ' Un mensaje posterior ya paso por el flujo: el paso de este se mezcla con el suyo');
  return { conversationId, captured: getFlowState(phone).captured };
}

function turnKeys(turns: SequencedTurn[]): string[] {
  const seen = new Map<string, number>();
  return turns.map((t) => {
    // Con el texto: dos instancias pueden dar el mismo numero a dos mensajes distintos (la misma hora).
    const k = (t.seq !== undefined ? t.role + ':' + t.seq : 'L:' + t.role) + ':' + t.content;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return k + '#' + n;
  });
}

/** Conjunto en tres vias: queda lo que tienen los dos y lo nuevo de cada lado; lo que uno quito, sale. */
function mergeSet<T>(base: T[], mine: T[], theirs: T[], key: (list: T[]) => string[]): T[] {
  const bk = new Set(key(base));
  const mk = key(mine);
  const tk = key(theirs);
  const mset = new Set(mk);
  const tset = new Set(tk);
  return [
    ...mine.filter((_, i) => tset.has(mk[i]) || !bk.has(mk[i])),
    ...theirs.filter((_, i) => !mset.has(tk[i]) && !bk.has(tk[i])),
  ];
}

function mergeHistory(base: SequencedTurn[] | undefined, mine: SequencedTurn[], theirs: SequencedTurn[]): SequencedTurn[] {
  const all = mergeSet(base ?? [], mine, theirs, turnKeys);
  // Los guardados sin numero van primero, en su orden; los demas, por numero de orden.
  const legacy = all.filter((t) => t.seq === undefined);
  const numbered = all.filter((t) => t.seq !== undefined).sort((a, b) => a.seq! - b.seq! || (a.role === 'user' ? -1 : 1));
  return [...legacy, ...numbered].slice(-MAX_TURNS);
}

function mergeTranscript(base: Transcript | undefined, mine: Transcript | undefined, theirs: Transcript | undefined): Transcript | undefined {
  if (!mine || !theirs) return mine ?? theirs;
  const entries = mergeSet(base?.entries ?? [], mine.entries, theirs.entries, (l) => l.map((e) => e.id))
    .sort((a, b) => a.seq - b.seq);
  const scalar = <K extends 'omitted' | 'partialStart' | 'sinceNote'>(k: K): Transcript[K] =>
    (base && mine[k] === base[k] ? theirs[k] : mine[k]);
  const t: Transcript = { entries, omitted: scalar('omitted'), partialStart: scalar('partialStart'), sinceNote: scalar('sinceNote') };
  capEntries(t);
  return t;
}

function historyOf(s: Snapshot): SequencedTurn[] {
  return s.history.map((t, i) => {
    const seq = s.historySeq?.[i];
    return typeof seq === 'number' ? { ...t, seq } : { ...t };
  });
}

const sideOf = (s: Snapshot): FlowSide => ({ flow: s.flow, seqs: s.fieldSeq ?? {}, seq: s.flowSeq ?? 0 });

const mergeFolded = (a: string[] = [], b: string[] = []): string[] => [...new Set([...a, ...b])].slice(-MAX_FOLDED);

function merge3(base: Snapshot | undefined, mine: Snapshot, theirs: Snapshot): Snapshot {
  const history = mergeHistory(base ? historyOf(base) : undefined, historyOf(mine), historyOf(theirs));
  const transcript = mergeTranscript(base?.transcript, mine.transcript, theirs.transcript);
  const { flow, seqs } = mergeFlow(base?.flow, sideOf(mine), sideOf(theirs));
  const outcomes = mergeOutcomes(mine.outcomes, theirs.outcomes);
  const confirmed = mergeConfirmed(mine.confirmed, theirs.confirmed);
  const folded = mergeFolded(theirs.folded, mine.folded);
  return {
    flow,
    flowSeq: Math.max(mine.flowSeq ?? 0, theirs.flowSeq ?? 0),
    fieldSeq: seqs,
    ...(outcomes.length ? { outcomes } : {}),
    ...(Object.keys(confirmed).length ? { confirmed } : {}),
    ...(folded.length ? { folded } : {}),
    history: history.map((t) => ({ role: t.role, content: t.content })),
    historySeq: history.map((t) => t.seq ?? null),
    privacyShown: mine.privacyShown || theirs.privacyShown,
    pending: [],
    ...(transcript ? { transcript } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Estado en memoria <-> estado guardado

function snapshotOf(phone: string): Snapshot {
  const history = getHistoryEntries(phone);
  const transcript = getTranscript(phone);
  const outcomes = outcomesByPhone.get(phone) ?? [];
  const confirmed = confirmedOf(phone);
  const folded = foldedByPhone.get(phone) ?? [];
  return {
    flow: structuredClone(getFlowState(phone)),
    flowSeq: flowSeqs.get(phone) ?? 0,
    fieldSeq: { ...(fieldSeqs.get(phone) ?? {}) },
    ...(outcomes.length ? { outcomes: [...outcomes] } : {}),
    ...(Object.keys(confirmed).length ? { confirmed } : {}),
    ...(folded.length ? { folded: [...folded] } : {}),
    history: history.map((t) => ({ role: t.role, content: t.content })),
    historySeq: history.map((t) => t.seq ?? null),
    privacyShown: privacyNoticeShown(phone),
    pending: [],
    ...(transcript ? { transcript: structuredClone(transcript) } : {}),
  };
}

function applySnapshot(phone: string, s: Snapshot): void {
  saveFlowState(phone, structuredClone(s.flow));
  if (s.flowSeq) flowSeqs.set(phone, s.flowSeq);
  fieldSeqs.set(phone, { ...(s.fieldSeq ?? {}) });
  // Lo que se restaura no lo cambio ningun mensaje de esta instancia: la marca siguiente parte de aqui.
  stampedFlows.set(phone, structuredClone(getFlowState(phone)));
  outcomesByPhone.set(phone, [...(s.outcomes ?? [])]);
  // [REGISTRO] Se suman a los de la cola y de esta instancia (el mas nuevo por negocio).
  for (const [deal, ver] of Object.entries(s.confirmed ?? {})) noteConfirmed(phone, Number(deal), ver);
  foldedByPhone.set(phone, [...(s.folded ?? [])]);
  restoreHistory(phone, historyOf(s));
  restorePrivacyNotice(phone, s.privacyShown);
  restoreTranscript(phone, s.transcript ? structuredClone(s.transcript) : undefined);
}

const bytesOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v) ?? '');

/**
 * [TOPE] Datos capturados: cada texto hasta MAX_FIELD_TEXT, cada lista hasta MAX_FIELD_ITEMS y el total
 * hasta MAX_CAPTURED_BYTES (se acorta a la mitad el dato mas grande hasta caber: de una lista salen los
 * mas antiguos). Asi un dato enorme no le quita espacio a la transcripcion, que lleva los mensajes del
 * cliente aun no anotados.
 */
function boundCaptured(input: FlowState['captured']): { captured: Record<string, unknown>; trimmed: boolean } {
  const captured: Record<string, unknown> = { ...input };
  for (const [k, v] of Object.entries(captured)) {
    if (typeof v === 'string' && v.length > MAX_FIELD_TEXT) captured[k] = v.slice(0, MAX_FIELD_TEXT);
    else if (Array.isArray(v)) captured[k] = v.slice(-MAX_FIELD_ITEMS).map((x) => (typeof x === 'string' && x.length > MAX_FIELD_TEXT ? x.slice(0, MAX_FIELD_TEXT) : x));
  }
  let trimmed = false;
  while (bytesOf(captured) > MAX_CAPTURED_BYTES) {
    let key: string | undefined;
    let size = 0;
    for (const [k, v] of Object.entries(captured)) {
      const n = bytesOf(v);
      if (n > size) { key = k; size = n; }
    }
    if (key === undefined) break;
    const v = captured[key];
    trimmed = true;
    if (size <= 64) delete captured[key];
    else if (typeof v === 'string') captured[key] = v.slice(0, Math.floor(v.length / 2));
    else if (Array.isArray(v) && v.length > 1) captured[key] = v.slice(Math.floor(v.length / 2));
    else if (Array.isArray(v) && typeof v[0] === 'string') captured[key] = [v[0].slice(0, Math.floor(v[0].length / 2))];
    else delete captured[key];
  }
  return { captured, trimmed };
}

/**
 * [TOPE] Datos capturados acotados y, sobre MAX_STATE_BYTES, menos historial y transcripcion.
 * [PENDIENTES] `legacy`: las escrituras de la version anterior que aun no quedan confirmadas en su cola.
 * Siguen en el estado y cuentan en el tope, pero no se recortan (no llegaron a ventas): si ni recortando
 * lo demas cabe, devuelve undefined y el estado no se guarda.
 */
function bound(s: Snapshot, legacy: PendingWhatsAppWrite[] = []): Snapshot | undefined {
  const { captured, trimmed: capturedTrimmed } = boundCaptured(s.flow.captured);
  const out: Snapshot = { ...s, flow: { ...s.flow, captured: captured as FlowState['captured'] }, history: [...s.history], historySeq: [...(s.historySeq ?? [])], pending: legacy };
  if (s.transcript) out.transcript = { ...s.transcript, entries: [...s.transcript.entries] };
  // Lo que se guarda, con la revision y la hora mas largas posibles.
  const size = () => Buffer.byteLength(serialize(out, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
  if (capturedTrimmed) console.warn(LOG_PREFIX + ' Datos capturados sobre el tope de ' + MAX_CAPTURED_BYTES + ' bytes: se acortan los mas grandes');
  let trimmed = false;
  while (size() > MAX_STATE_BYTES && out.history.length > 2) {
    out.history.splice(0, 2);
    out.historySeq!.splice(0, 2);
    trimmed = true;
  }
  while (size() > MAX_STATE_BYTES && out.transcript && out.transcript.entries.length > 1) {
    out.transcript.entries.splice(Math.min(TRANSCRIPT_HEAD, out.transcript.entries.length - 1), 1);
    out.transcript.omitted++;
    trimmed = true;
  }
  if (legacy.length && size() > MAX_STATE_BYTES) return undefined;
  if (trimmed) console.warn(LOG_PREFIX + ' Estado sobre el tope de ' + MAX_STATE_BYTES + ' bytes: se acortan historial y transcripcion');
  return out;
}

type SharedRead = { ok: false } | { ok: true; rev: number; snap?: Snapshot; invalid?: boolean; held: string[] };

function parseSnapshotValue(value: unknown): Snapshot {
  const state = value as Snapshot;
  if (!state?.flow?.captured || !Array.isArray(state.history)) throw new Error('estado invalido');
  const historySeq = Array.isArray(state.historySeq) && state.historySeq.length === state.history.length ? state.historySeq : undefined;
  const turns = normalizeTurns(state.history.map((t, i): SequencedTurn => {
    const seq = historySeq?.[i];
    const turn: SequencedTurn = { role: t.role, content: String(t.content ?? '') };
    if (typeof seq === 'number') turn.seq = seq;
    return turn;
  }));
  const transcript = normalizeTranscript(state.transcript);
  const fieldSeq = state.fieldSeq && typeof state.fieldSeq === 'object'
    ? Object.fromEntries(Object.entries(state.fieldSeq).filter(([, v]) => isNumber(v)))
    : undefined;
  const outcomes = Array.isArray(state.outcomes)
    ? state.outcomes.filter((o) => o && isNumber(o.id) && (o.deal === 'registered' || o.deal === 'failed'))
    : [];
  const confirmed = state.confirmed && typeof state.confirmed === 'object'
    ? Object.fromEntries(Object.entries(state.confirmed).filter(([deal, ver]) => /^\d+$/.test(deal) && isNumber(ver)))
    : {};
  const folded = Array.isArray(state.folded) ? state.folded.filter((id) => typeof id === 'string') : [];
  return {
    ...(typeof state.rev === 'number' ? { rev: state.rev } : {}),
    updatedAt: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0,
    flow: state.flow,
    flowSeq: typeof state.flowSeq === 'number' && Number.isFinite(state.flowSeq) ? state.flowSeq : 0,
    ...(fieldSeq ? { fieldSeq } : {}),
    ...(outcomes.length ? { outcomes } : {}),
    ...(Object.keys(confirmed).length ? { confirmed } : {}),
    ...(folded.length ? { folded } : {}),
    history: turns.map((t) => ({ role: t.role, content: t.content })),
    historySeq: turns.map((t) => t.seq ?? null),
    privacyShown: state.privacyShown === true,
    pending: Array.isArray(state.pending) ? state.pending : [],
    ...(transcript ? { transcript } : {}),
  };
}

const parseSnapshot = (raw: string): Snapshot => parseSnapshotValue(JSON.parse(raw));

// [CONCURRENCIA] Estado guardado aparte (heldKey): la escritura y su plazo, juntos.
const HOLD_SCRIPT = `-- whatsapp:estado:aparte
redis.call('hset', KEYS[1], ARGV[1], ARGV[2])
redis.call('expire', KEYS[1], tonumber(ARGV[3]))
return 1`;

interface HeldState { id: string; at: number; base?: Snapshot; mine: Snapshot }

/** [CONCURRENCIA] Los estados guardados aparte del numero, del mas antiguo al mas nuevo. */
async function readHeld(phone: string): Promise<HeldState[]> {
  const all = await redisJsonCommand<string[] | null>('HGETALL', heldKey(phone));
  if (!all.ok) { unavailable('leer estado guardado aparte'); return []; }
  const flat = Array.isArray(all.result) ? all.result : [];
  const out: HeldState[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const v = JSON.parse(String(flat[i + 1])) as { at?: unknown; base?: unknown; mine?: unknown };
      out.push({
        id: String(flat[i]),
        at: isNumber(v.at) ? v.at : 0,
        ...(v.base ? { base: parseSnapshotValue(v.base) } : {}),
        mine: parseSnapshotValue(v.mine),
      });
    } catch { /* uno ilegible no se puede mezclar: queda en Upstash hasta vencer */ }
  }
  return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Lee el estado compartido. [CONCURRENCIA] R2: lo que un guardado dejo aparte (otro guardado gano cada
 * intento) se mezcla aqui, en orden, sobre lo guardado; `held` son sus ids (se borran al guardar el
 * estado que ya los trae, y `folded` evita mezclarlos otra vez si ese borrado falla).
 */
async function readShared(phone: string): Promise<SharedRead> {
  const result = await redisJsonCommand<string | null>('GET', conversationKey(phone));
  if (!result.ok) return { ok: false };
  const rev = result.result ? Number(/^\{"rev":(\d+),/.exec(result.result)?.[1] ?? 0) : 0;
  let snap: Snapshot | undefined;
  if (result.result) {
    try {
      snap = parseSnapshot(result.result);
    } catch {
      return { ok: true, rev, invalid: true, held: [] };
    }
  }
  const held = await readHeld(phone);
  for (const h of held) {
    if (snap?.folded?.includes(h.id)) continue;
    snap = snap
      ? {
        ...merge3(h.base, h.mine, snap),
        updatedAt: Math.max(snap.updatedAt ?? 0, h.at),
        // Las escrituras de la version anterior son las del estado guardado (su migracion las lee de aqui).
        pending: snap.pending,
        folded: mergeFolded(snap.folded, [h.id]),
      }
      : { ...h.mine, updatedAt: h.at, pending: [], folded: [h.id] };
  }
  return { ok: true, rev, ...(snap ? { snap } : {}), held: held.map((h) => h.id) };
}

// Escribe solo si la revision guardada sigue siendo la leida (0: sin estado, o uno sin revision).
export const SAVE_IF_REV_SCRIPT = `local cur = redis.call('get', KEYS[1]) `
  + `local rev = 0 `
  + `if cur then rev = tonumber(string.match(cur, '^{"rev":(%d+),') or '0') end `
  + `if rev ~= tonumber(ARGV[1]) then return 0 end `
  + `redis.call('set', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3])) `
  + `return 1`;

function serialize(s: Snapshot, rev: number, updatedAt: number): string {
  const rest: Partial<Snapshot> = { ...s };
  delete rest.rev;
  delete rest.updatedAt;
  return JSON.stringify({ rev, updatedAt, ...rest });
}

/** Un guardado o lectura a la vez por numero en esta instancia. */
function serialized<T>(phone: string, run: () => Promise<T>): Promise<T> {
  const previous = chains.get(phone) ?? Promise.resolve();
  const next = previous.then(run);
  const settled = next.then(() => {}, () => {});
  chains.set(phone, settled);
  void settled.then(() => { if (chains.get(phone) === settled) chains.delete(phone); });
  return next;
}

/**
 * [CONCURRENCIA] Resultado de un guardado: 'saved', en el estado compartido; 'held', aparte en Upstash
 * (otro guardado gano cada intento, o no cabia con las escrituras de la version anterior): la lectura
 * siguiente, de cualquier instancia, lo mezcla; 'memory', solo en la memoria de esta instancia porque
 * Upstash no respondio (decision 9 del dueno: el bot responde igual y lo guarda en el proximo guardado).
 */
export type PersistResult = 'saved' | 'held' | 'memory';

/** [CONCURRENCIA] Guarda aparte lo que esta instancia queria guardar y la base de su mezcla. */
async function holdUnsaved(phone: string, base: Snapshot | undefined, mine: Snapshot, at: number): Promise<boolean> {
  const value = JSON.stringify({ at, ...(base ? { base } : {}), mine });
  const result = await redisJsonCommand<number>('EVAL', HOLD_SCRIPT, '1', heldKey(phone), randomUUID(), value, CONVERSATION_TTL_S);
  if (!result.ok) { unavailable('guardar el estado aparte'); return false; }
  return true;
}

/**
 * Relee Upstash, mezcla con la memoria (tres vias) y escribe con la revision leida; si otro guardo
 * entre medio, vuelve a leer. Upstash caido: queda en memoria (dirty) para el proximo guardado.
 * [CONCURRENCIA] R2: si en los SAVE_ATTEMPTS intentos otro guardado gano, el estado de este mensaje queda
 * aparte (holdUnsaved) antes de volver. Solo vuelve sin dejarlo en Upstash ('memory') si un comando de
 * Upstash fallo (caido o sin respuesta).
 */
async function writeMerged(phone: string, updatedAt: number): Promise<PersistResult> {
  let meta = local.get(phone);
  if (!meta) { meta = { updatedAt, dirty: true }; local.set(phone, meta); }
  meta.updatedAt = updatedAt;
  let last: { base?: Snapshot; merged: Snapshot } | undefined;
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const shared = await readShared(phone);
    if (!shared.ok) { meta.dirty = true; unavailable('guardar estado'); return 'memory'; }
    const legacyLeft = shared.snap ? await migrateLegacyPending(phone, shared.snap.pending) : [];
    // Desde aqui hasta el EVAL no hay await: ningun otro mensaje de esta instancia cambia la memoria.
    const mine = snapshotOf(phone);
    const combined = shared.snap ? merge3(meta.base, mine, shared.snap) : mine;
    const merged = bound(combined, legacyLeft);
    if (!merged) {
      // [PENDIENTES] Las escrituras de la version anterior que no se pudo pasar a su cola no caben con lo
      // demas: no se guarda el estado (Upstash conserva el anterior, con ellas) y se reintenta al guardar
      // otra vez. [CONCURRENCIA] Lo de este mensaje queda aparte, sin ellas.
      meta.dirty = true;
      console.warn(LOG_PREFIX + ' Escrituras pendientes de la version anterior sin pasar a su cola y sobre el tope de ' + MAX_STATE_BYTES + ' bytes: el estado de este mensaje queda aparte');
      return (await holdUnsaved(phone, shared.snap, bound(combined)!, updatedAt)) ? 'held' : 'memory';
    }
    applySnapshot(phone, merged);
    if (shared.snap) meta.base = shared.snap;
    const value = serialize(merged, shared.rev + 1, updatedAt);
    const result = await redisJsonCommand<number>('EVAL', SAVE_IF_REV_SCRIPT, '1', conversationKey(phone), shared.rev, value, CONVERSATION_TTL_S);
    if (!result.ok) {
      meta.dirty = true;
      unavailable('guardar estado');
      return (await holdUnsaved(phone, shared.snap, merged, updatedAt)) ? 'held' : 'memory';
    }
    if (Number(result.result) === 1) {
      meta.base = { ...merged, rev: shared.rev + 1, updatedAt };
      meta.dirty = false;
      // Lo guardado aparte ya va en el estado (y en `folded`): si este borrado falla, no se mezcla otra vez.
      if (shared.held.length) {
        const del = await redisJsonCommand('HDEL', heldKey(phone), ...shared.held);
        if (!del.ok) unavailable('borrar estado guardado aparte');
      }
      return 'saved';
    }
    last = { ...(shared.snap ? { base: shared.snap } : {}), merged };
  }
  meta.dirty = true;
  console.warn(LOG_PREFIX + ' El estado compartido cambio en cada intento; el de este mensaje queda aparte y lo mezcla la proxima lectura');
  return last && (await holdUnsaved(phone, last.base, last.merged, updatedAt)) ? 'held' : 'memory';
}

function clearLocal(phone: string): void {
  clearFlowState(phone);
  clearHistory(phone);
  restorePrivacyNotice(phone, false);
  clearTranscript(phone);
  flowSeqs.delete(phone);
  fieldSeqs.delete(phone);
  stampedFlows.delete(phone);
  outcomesByPhone.delete(phone);
  foldedByPhone.delete(phone);
  local.delete(phone);
  // [PENDIENTES] La cola no se borra: vive aparte y con su propio plazo.
}

/**
 * Trae el estado compartido y lo mezcla con la memoria. Con el candado (`sharedAuthoritative`), lo
 * que esta instancia no habia podido guardar se guarda de inmediato.
 */
export function loadConversation(phone: string, sharedAuthoritative = false): Promise<void> {
  return serialized(phone, async () => {
    const cached = local.get(phone);
    if (cached && Date.now() - cached.updatedAt >= CONVERSATION_TTL_S * 1000) clearLocal(phone);
    const shared = await readShared(phone);
    if (!shared.ok) { unavailable('leer estado'); return; }
    if (shared.invalid) { unavailable('estado ilegible'); return; }
    const meta = local.get(phone);
    if (!shared.snap) {
      // Vencido en Upstash: se olvida, salvo lo que esta instancia no alcanzo a guardar.
      if (!meta?.dirty) clearLocal(phone);
      else if (sharedAuthoritative) await writeMerged(phone, meta.updatedAt);
      return;
    }
    await migrateLegacyPending(phone, shared.snap.pending);
    if (!meta) {
      applySnapshot(phone, shared.snap);
      local.set(phone, { updatedAt: shared.snap.updatedAt || Date.now(), dirty: false, base: shared.snap });
      return;
    }
    applySnapshot(phone, merge3(meta.base, snapshotOf(phone), shared.snap));
    meta.base = shared.snap;
    if (meta.dirty && sharedAuthoritative) await writeMerged(phone, Math.max(meta.updatedAt, shared.snap.updatedAt ?? 0));
  });
}

/** Guarda el estado del numero (ver PersistResult). */
export function persistConversation(phone: string): Promise<PersistResult> {
  const at = Date.now();
  return serialized(phone, () => writeMerged(phone, at));
}

// ---------------------------------------------------------------------------------------------
// MessageSid

type MessageState = { status: 'in_progress' } | { status: 'done'; response: string };

/** Los ultimos MessageSid de esta instancia (los 500 mas recientes). */
function rememberMessage(sid: string, response?: string): void {
  recentMessages.delete(sid);
  recentMessages.set(sid, { at: Date.now(), ...(response !== undefined ? { response } : {}) });
  for (const old of recentMessages.keys()) {
    if (recentMessages.size <= LOCAL_MESSAGES_MAX) break;
    recentMessages.delete(old);
  }
}

/** Respondido hace menos de 10 minutos, o en curso hace menos que la reserva de Upstash. */
function recentMessage(sid: string): { at: number; response?: string; saved?: boolean } | undefined {
  const seen = recentMessages.get(sid);
  if (!seen) return undefined;
  const ttlMs = seen.response === undefined ? MESSAGE_IN_PROGRESS_TTL_S * 1000 : LOCAL_MESSAGE_DONE_MS;
  if (Date.now() - seen.at < ttlMs) return seen;
  recentMessages.delete(sid);
  return undefined;
}

/**
 * La memoria de esta instancia evita procesar dos veces una entrega repetida cuando Upstash no
 * responde, o cuando esta instancia ya atiende o ya respondio el mensaje (Upstash pudo caerse al
 * guardar la respuesta: su reserva queda "en curso" y, al vencer, dejaria reprocesarlo). Con
 * `upstashUp`, la respuesta que Upstash no guardo se vuelve a guardar, para las otras instancias.
 * [CONCURRENCIA] Tambien sin Upstash configurado (desarrollo, o una variable que falta): la misma
 * instancia no registra dos veces el mismo mensaje.
 */
async function claimLocally(sid: string, deadline: number, upstashUp = false): Promise<{ proceed: boolean; response?: string }> {
  for (;;) {
    const seen = recentMessage(sid);
    if (!seen) { rememberMessage(sid); return { proceed: true }; }
    if (seen.response !== undefined) {
      if (upstashUp && !seen.saved) await saveResponse(sid, seen.response, Math.max(1, Math.min(800, deadline - Date.now())));
      return { proceed: false, response: seen.response };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { proceed: false };
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
}

export async function claimMessage(sid: string, maxWaitMs = MESSAGE_RETRY_WAIT_MS): Promise<{ proceed: boolean; response?: string }> {
  if (!sid) return { proceed: true };
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  const timeout = () => Math.max(1, Math.min(800, deadline - Date.now()));
  if (recentMessage(sid)) return claimLocally(sid, deadline, true);
  const result = await redisJsonCommandWithTimeout<string | null>(timeout(), 'SET', messageKey(sid), JSON.stringify({ status: 'in_progress' }), 'NX', 'EX', MESSAGE_IN_PROGRESS_TTL_S);
  if (!result.ok) { unavailable('reservar MessageSid'); return claimLocally(sid, deadline); }
  if (result.result === 'OK') { rememberMessage(sid); return { proceed: true }; }
  for (;;) {
    const saved = await redisJsonCommandWithTimeout<string | null>(timeout(), 'GET', messageKey(sid));
    // Ya existe una reserva: una caída durante la espera no autoriza a duplicarla.
    if (!saved.ok) { unavailable('leer MessageSid'); return { proceed: false }; }
    try {
      const state = JSON.parse(saved.result ?? '{}') as MessageState;
      if (state.status === 'done' && typeof state.response === 'string') return { proceed: false, response: state.response };
    } catch {
      return { proceed: false };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { proceed: false };
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
}

async function saveResponse(sid: string, response: string, timeoutMs?: number): Promise<void> {
  const args = ['SET', messageKey(sid), JSON.stringify({ status: 'done', response }), 'EX', MESSAGE_TTL_S];
  const result = timeoutMs === undefined ? await redisJsonCommand(...args) : await redisJsonCommandWithTimeout(timeoutMs, ...args);
  if (!result.ok) { unavailable('guardar respuesta'); return; }
  const seen = recentMessages.get(sid);
  if (seen) seen.saved = true;
}

export async function completeMessage(sid: string, response: string): Promise<void> {
  if (!sid) return;
  rememberMessage(sid, response);
  await saveResponse(sid, response);
}
