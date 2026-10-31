// Estado compartido del bot; ante una caida de Upstash conserva la memoria de la instancia.
// [CONCURRENCIA] Dos mensajes del mismo numero pueden atenderse a la vez (en dos instancias de Vercel, o
// en una cuando el anterior pasa los 10 s de espera). Ninguno pisa el estado del otro:
// - cada guardado relee el estado compartido y mezcla en tres vias (lo que esta instancia leyo, lo
//   suyo y lo de Upstash): un dato que cambio solo un lado queda; si cambio en los dos, gana el mensaje
//   que llego despues (flowSeq). La transcripcion y el historial se mezclan por id y numero de orden,
//   sin perder entradas. La escritura es atomica (EVAL con la revision del estado): si otro guardo
//   entre medio, se vuelve a leer y mezclar;
// - dentro de una instancia, el paso del flujo de un mensaje anterior corre sobre lo que ese mensaje
//   leyo y se mezcla igual con lo que ya cambio uno posterior (beginFlowStep y settleFlowStep);
// - las listas de solo agregar de los datos capturados (cambios, comunas_otras) se mezclan elemento a
//   elemento, en el orden de llegada: los dos mensajes conservan su linea (APPEND_LISTS);
// - el registro de un negocio nuevo es uno a la vez por numero, tambien entre instancias
//   (claimRegistration): el que llega mientras otro registra espera su resultado y no lo repite.
// [PENDIENTES] Las escrituras a Pipedrive sin confirmar van en su propia cola (un hash de Upstash por
// numero, con 30 dias de plazo), fuera del estado: nunca se descarta una que no llego a ventas. Con la
// cola llena no entra otra nota, y webhook.ts conserva la transcripcion para la nota siguiente; los
// campos del negocio (una foto completa) se juntan en una sola escritura por negocio y si entran.
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
// Presupuesto solicitado: 60 s de función + 15 s de margen. vercel.json aún no declara
// maxDuration para este webhook; mantener alineado al configurar el despliegue.
export const MESSAGE_IN_PROGRESS_TTL_S = 60 + 15;
export const CONVERSATION_LOCK_TTL_MS = 25_000;
export const MESSAGE_RETRY_WAIT_MS = 3_000;
// [PENDIENTES] Tope de la cola por numero (cada escritura lleva a lo mas una nota de 90.000 bytes) y
// cuantas se reintentan por mensaje (Twilio espera 15 s). Una escritura no confirmada no se descarta.
export const MAX_PENDING_WRITES = 10;
export const MAX_PENDING_RETRIES_PER_TURN = 5;
export const PENDING_WRITE_TTL_S = 30 * 86400;
// [PENDIENTES] Tope duro de la cola (notas y campos): sobre el, ni los campos entran (se avisa).
export const MAX_PENDING_TOTAL = 2 * MAX_PENDING_WRITES;
// [TOPE] Bytes del estado guardado (flujo, historial y transcripcion), de los datos capturados y largo
// de cada dato capturado.
export const MAX_STATE_BYTES = 256 * 1024;
export const MAX_CAPTURED_BYTES = 64 * 1024;
const MAX_FIELD_TEXT = 4096;
const MAX_FIELD_ITEMS = 20;
// [REGISTRO] Plazo de la reserva del registro de un negocio: el de la funcion mas su margen.
export const REGISTRATION_TTL_MS = MESSAGE_IN_PROGRESS_TTL_S * 1000;
const SAVE_ATTEMPTS = 3;
// Respaldo en memoria de los MessageSid para cuando Upstash no responde (solo en esta instancia).
const LOCAL_MESSAGES_MAX = 500;
const LOCAL_MESSAGE_DONE_MS = 10 * 60_000;
const LOG_PREFIX = '[whatsapp/stateStore]';

interface Snapshot {
  // [CONCURRENCIA] Revision del estado: va primero en el JSON, asi el EVAL la lee sin decodificarlo.
  rev?: number;
  updatedAt?: number; // Los estados anteriores a esta versión no tienen la marca.
  flow: FlowState;
  /** Numero de orden del ultimo mensaje que paso por el flujo: decide quien gana si los dos cambiaron un dato. */
  flowSeq?: number;
  history: ConversationTurn[];
  /** Numero de orden de cada turno del historial (null: turno guardado antes de este cambio). */
  historySeq?: (number | null)[];
  privacyShown: boolean;
  // [PENDIENTES] Hasta esta version las escrituras pendientes iban aqui; ahora van en su cola. Se
  // guarda vacio para las instancias de la version anterior, y lo que traiga uno antiguo pasa a la cola.
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

// Borra la reserva solo si sigue siendo de quien la tomo.
const RELEASE_SCRIPT = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;

/**
 * La fila local sigue vigente. Contencion o caida: continuar como antes, con aviso.
 * `contended`: otro mensaje del numero tiene el candado (no es que Upstash este caido): este no
 * reintenta las escrituras pendientes, para no duplicarlas.
 */
export async function acquireConversationLock(phone: string, maxWaitMs: number): Promise<{
  acquired: boolean;
  contended: boolean;
  release: () => Promise<void>;
}> {
  const key = conversationLockKey(phone);
  const token = randomUUID();
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  while (Date.now() < deadline) {
    const result = await redisJsonCommandWithTimeout<string | null>(
      Math.min(800, deadline - Date.now()), 'SET', key, token, 'NX', 'PX', CONVERSATION_LOCK_TTL_MS,
    );
    if (!result.ok) { unavailable('candado de conversaci\u00f3n'); return { acquired: false, contended: false, release: async () => {} }; }
    if (result.result === 'OK') {
      return { acquired: true, contended: false, release: async () => {
        const released = await redisJsonCommand('EVAL', RELEASE_SCRIPT, '1', key, token);
        if (!released.ok) unavailable('liberar candado de conversación');
      } };
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
  console.warn(LOG_PREFIX + ' Espera del candado agotada; contin\u00faa sin candado');
  return { acquired: false, contended: true, release: async () => {} };
}

// ---------------------------------------------------------------------------------------------
// [REGISTRO] Un registro de negocio nuevo a la vez por numero
// webhook.ts guarda la conversacion (ya cerrada, aun sin negocio) antes de la llamada lenta a Pipedrive.
// Sin esta reserva, otro mensaje del numero que entra mientras tanto (en otra instancia, o en esta al
// vencer la espera) veia "cerrada con correo y sin negocio" y registraba de nuevo: un segundo negocio o
// nota y un segundo aviso a ventas. La reserva vive en Upstash (entre instancias) y en la memoria (sin
// Upstash); vence sola si la instancia que la tomo se corta.

const registrations = new Map<string, { token: string; until: number }>();

export interface RegistrationClaim {
  /** false: otro mensaje del numero esta registrando el negocio ('local': en esta instancia). */
  claimed: boolean;
  heldBy?: 'local' | 'remote';
  /** Libera la reserva (una vez; despues de guardar el resultado del negocio). */
  release: () => Promise<void>;
}

export async function claimRegistration(phone: string): Promise<RegistrationClaim> {
  const none = async () => {};
  const held = registrations.get(phone);
  if (held && held.until > Date.now()) return { claimed: false, heldBy: 'local', release: none };
  const key = registrationKey(phone);
  const token = randomUUID();
  const set = await redisJsonCommandWithTimeout<string | null>(800, 'SET', key, token, 'NX', 'PX', REGISTRATION_TTL_MS);
  if (set.ok && set.result !== 'OK') return { claimed: false, heldBy: 'remote', release: none };
  if (!set.ok) unavailable('reservar registro del negocio');
  registrations.set(phone, { token, until: Date.now() + REGISTRATION_TTL_MS });
  let released = false;
  return {
    claimed: true,
    release: async () => {
      if (released) return;
      released = true;
      // Primero Upstash: quien espera en esta instancia, al ver libre la memoria, ya no la ve alla.
      if (set.ok) {
        const del = await redisJsonCommand('EVAL', RELEASE_SCRIPT, '1', key, token);
        if (!del.ok) unavailable('liberar registro del negocio');
      }
      if (registrations.get(phone)?.token === token) registrations.delete(phone);
    },
  };
}

/**
 * Espera, hasta `deadline`, a que termine el registro que tiene otro mensaje del numero. true: termino;
 * si era de otra instancia, lo que guardo (el resultado del negocio) ya se mezclo en la memoria.
 */
export async function awaitRegistration(phone: string, heldBy: 'local' | 'remote', deadline: number): Promise<boolean> {
  let remote = heldBy === 'remote';
  for (;;) {
    const held = registrations.get(phone);
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

export function messageKey(sid: string): string {
  return 'whatsapp:message:' + sid;
}

function unavailable(op: string): void {
  console.warn(LOG_PREFIX + ' Upstash no disponible; respaldo en memoria (' + op + ')');
}

// ---------------------------------------------------------------------------------------------
// [PENDIENTES] Cola de escrituras a Pipedrive sin confirmar

export interface QueuedWrite { id: string; at: number; write: PendingWhatsAppWrite }
// En memoria: lo de Upstash mas lo que todavia no se pudo guardar alla (stored: false).
const queues = new Map<string, Map<string, { item: QueuedWrite; stored: boolean }>>();
// Entregadas cuyo borrado en Upstash fallo: se reintenta borrarlas y no se vuelven a enviar.
const delivered = new Map<string, Set<string>>();

function queueOf(phone: string): Map<string, { item: QueuedWrite; stored: boolean }> {
  let q = queues.get(phone);
  if (!q) { q = new Map(); queues.set(phone, q); }
  return q;
}

function sortedQueue(phone: string): QueuedWrite[] {
  return [...queueOf(phone).values()].map((v) => v.item).sort((a, b) => a.at - b.at);
}

function validWrite(w: unknown): w is PendingWhatsAppWrite {
  const v = w as PendingWhatsAppWrite | undefined;
  return Boolean(v && typeof v === 'object' && typeof v.dealId === 'number' && (v.note === undefined || typeof v.note === 'string'));
}

async function storeQueued(phone: string, item: QueuedWrite): Promise<void> {
  const set = await redisJsonCommand('HSET', pendingKey(phone), item.id, JSON.stringify(item));
  if (!set.ok) { unavailable('guardar escritura pendiente'); return; }
  await redisJsonCommand('EXPIRE', pendingKey(phone), PENDING_WRITE_TTL_S);
  const entry = queueOf(phone).get(item.id);
  if (entry && entry.item === item) entry.stored = true;
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
  pending.forEach((write, i) => { const id = randomUUID(); q.set(id, { item: { id, at: now + i, write }, stored: false }); });
}

/**
 * Agrega una escritura sin confirmar. false: la nota no entro porque la cola llego a su tope (quien llama
 * conserva la transcripcion, para que la nota siguiente la incluya). Sus campos entran igual, aparte
 * (enqueueFields). Sin Upstash queda en memoria.
 */
export async function enqueuePendingWrite(phone: string, write: PendingWhatsAppWrite): Promise<boolean> {
  const q = queueOf(phone);
  const len = await redisJsonCommand<number>('HLEN', pendingKey(phone));
  const count = Math.max(q.size, len.ok ? Number(len.result) || 0 : 0);
  if (write.note === undefined) return enqueueFields(phone, write, count);
  if (count >= MAX_PENDING_WRITES) {
    // Sin el telefono ni el contenido: solo el tope y el negocio (para revisarlo a mano si sigue asi).
    console.error(LOG_PREFIX + ' Cola de escrituras pendientes llena (' + MAX_PENDING_WRITES + '); la nota no entra y la transcripcion queda para la nota siguiente (negocio ' + write.dealId + ')');
    if (write.fields) await enqueueFields(phone, { dealId: write.dealId, fields: write.fields }, count);
    return false;
  }
  const item: QueuedWrite = { id: randomUUID(), at: Date.now(), write };
  q.set(item.id, { item, stored: false });
  await storeQueued(phone, item);
  return true;
}

/**
 * [PENDIENTES] Campos del negocio sin confirmar (sin nota). Son la foto completa del negocio, asi que
 * reemplazan a los que esperaban del mismo negocio: una sola escritura de campos por negocio, que no
 * cuenta para el tope de notas. Lo anterior sale de la cola solo cuando la nueva ya quedo guardada.
 * false: el tope duro (MAX_PENDING_TOTAL), con la cola llena de otros negocios.
 */
async function enqueueFields(phone: string, write: PendingWhatsAppWrite, count: number): Promise<boolean> {
  const q = queueOf(phone);
  const older = [...q.values()]
    .filter((v) => v.item.write.note === undefined && v.item.write.dealId === write.dealId)
    .sort((a, b) => a.item.at - b.item.at);
  if (!older.length && count >= MAX_PENDING_TOTAL) {
    console.error(LOG_PREFIX + ' Cola de escrituras pendientes en su tope duro (' + MAX_PENDING_TOTAL + '); los campos no entran y la transcripcion queda para la nota siguiente (negocio ' + write.dealId + ')');
    return false;
  }
  const fields = Object.assign({}, ...older.map((v) => v.item.write.fields ?? {}), write.fields ?? {}) as Record<string, string>;
  const item: QueuedWrite = { id: randomUUID(), at: Date.now(), write: { ...write, fields } };
  q.set(item.id, { item, stored: false });
  await storeQueued(phone, item);
  const stored = Boolean(q.get(item.id)?.stored);
  for (const old of older) {
    // Una guardada en Upstash sale cuando la nueva tambien quedo alla; una solo en memoria, ya.
    if (!old.stored) { q.delete(old.item.id); continue; }
    if (!stored) continue;
    q.delete(old.item.id);
    const del = await redisJsonCommand('HDEL', pendingKey(phone), old.item.id);
    if (!del.ok) unavailable('reemplazar campos pendientes');
  }
  return true;
}

// Escrituras de un estado anterior ya pasadas a la cola por esta instancia (no se vuelven a pasar).
const migrated = new Map<string, Set<string>>();

/**
 * Las de un estado anterior a la cola, con id fijo. Cada una se pasa a la cola una sola vez, tambien
 * entre instancias (una reserva SET NX en Upstash): el estado guardado puede seguir trayendola un rato.
 * Devuelve las que no quedaron guardadas en la cola: siguen en el estado guardado hasta lograrlo.
 */
async function migrateLegacyPending(phone: string, legacy: unknown): Promise<PendingWhatsAppWrite[]> {
  if (!Array.isArray(legacy) || !legacy.length) return [];
  const q = queueOf(phone);
  let done = migrated.get(phone);
  if (!done) { done = new Set(); migrated.set(phone, done); }
  const left: PendingWhatsAppWrite[] = [];
  for (const [i, write] of legacy.entries()) {
    if (!validWrite(write)) continue;
    const id = 'legacy-' + createHash('sha256').update(JSON.stringify(write)).digest('hex').slice(0, 24);
    if (!done.has(id)) {
      const claim = await redisJsonCommand<string | null>('SET', pendingKey(phone) + ':migrada:' + id, '1', 'NX', 'EX', PENDING_WRITE_TTL_S);
      if (!claim.ok) { unavailable('pasar escritura pendiente a la cola'); left.push(write); continue; }
      done.add(id);
      if (claim.result === 'OK') {
        const item: QueuedWrite = { id, at: i, write };
        q.set(id, { item, stored: false });
        await storeQueued(phone, item);
      }
    }
    const entry = q.get(id);
    if (entry && !entry.stored) left.push(write);
  }
  return left;
}

/**
 * La cola para reintentar: guarda en Upstash lo que habia quedado solo en memoria, borra alla lo ya
 * entregado y suma lo que dejaron otras instancias. Lo guardado que ya no esta alla lo entrego otra.
 */
export async function loadPendingWrites(phone: string): Promise<QueuedWrite[]> {
  const q = queueOf(phone);
  const tomb = delivered.get(phone);
  for (const id of [...(tomb ?? [])]) {
    const del = await redisJsonCommand('HDEL', pendingKey(phone), id);
    if (del.ok) tomb!.delete(id);
  }
  for (const { item, stored } of [...q.values()]) if (!stored) await storeQueued(phone, item);
  const all = await redisJsonCommand<string[] | null>('HGETALL', pendingKey(phone));
  if (all.ok) {
    const remote = new Map<string, QueuedWrite>();
    const flat = Array.isArray(all.result) ? all.result : [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      try {
        const item = JSON.parse(String(flat[i + 1])) as QueuedWrite;
        if (item && item.id === flat[i] && typeof item.at === 'number' && validWrite(item.write)) remote.set(item.id, item);
      } catch { /* una entrada ilegible no se puede reintentar: queda en Upstash hasta vencer */ }
    }
    for (const [id, v] of q) if (v.stored && !remote.has(id)) q.delete(id);
    for (const [id, item] of remote) if (!q.has(id) && !tomb?.has(id)) q.set(id, { item, stored: true });
  } else {
    unavailable('leer escrituras pendientes');
  }
  const out = sortedQueue(phone);
  if (!out.length) queues.delete(phone);
  return out;
}

/** Resultado del reintento: sin `remaining`, se entrego y sale de la cola; si no, queda lo que falta. */
export async function settlePendingWrite(phone: string, id: string, remaining: PendingWhatsAppWrite | undefined): Promise<void> {
  const q = queueOf(phone);
  const entry = q.get(id);
  if (!remaining) {
    q.delete(id);
    let tomb = delivered.get(phone);
    if (!tomb) { tomb = new Set(); delivered.set(phone, tomb); }
    tomb.add(id);
    const del = await redisJsonCommand('HDEL', pendingKey(phone), id);
    if (del.ok) tomb.delete(id);
    else unavailable('borrar escritura entregada');
    if (!tomb.size) delivered.delete(phone);
    if (!q.size) queues.delete(phone);
    return;
  }
  if (!entry || JSON.stringify(entry.item.write) === JSON.stringify(remaining)) return;
  const item = { ...entry.item, write: remaining };
  q.set(id, { item, stored: false });
  await storeQueued(phone, item);
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

// Campos que cambian juntos: el resultado del negocio y su id.
const FIELD_GROUPS: string[][] = [['deal', 'dealId']];

/** Cada campo: el lado que lo cambio respecto de `base`; si cambio en los dos, `mineWins` decide. */
function mergeRecord(base: object | undefined, mine: object, theirs: object, mineWins: boolean, skip: string[] = []): Record<string, unknown> {
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
    const from = eq(mv, tv) || eq(tv, bv) ? m : eq(mv, bv) ? t : mineWins ? m : t;
    for (const k of unit) if (from[k] !== undefined) out[k] = from[k];
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
 * Flujo de dos lados que partieron de `base`. Si un lado empezo otra conversacion (un pedido nuevo),
 * gana esa entera: los cambios del otro eran de la conversacion anterior (como recordDealOutcome).
 */
function mergeFlow(base: FlowState | undefined, mine: FlowState, theirs: FlowState, mineWins: boolean): FlowState {
  if (mine.firstMessageAt !== theirs.firstMessageAt) {
    const restartedMine = !base || mine.firstMessageAt !== base.firstMessageAt;
    const restartedTheirs = !base || theirs.firstMessageAt !== base.firstMessageAt;
    if (restartedMine && restartedTheirs) return mineWins ? mine : theirs;
    return restartedMine ? mine : theirs;
  }
  const out = mergeRecord(base, mine, theirs, mineWins, ['captured']) as unknown as FlowState;
  const b = (base?.captured ?? {}) as Record<string, unknown>;
  const m = (mine.captured ?? {}) as Record<string, unknown>;
  const t = (theirs.captured ?? {}) as Record<string, unknown>;
  const captured = mergeRecord(b, m, t, mineWins, Object.keys(APPEND_LISTS));
  for (const key of Object.keys(APPEND_LISTS)) {
    if (m[key] === undefined && t[key] === undefined) continue;
    const [older, newer] = mineWins ? [t[key], m[key]] : [m[key], t[key]];
    setList(captured, key, mergeList(asList(b[key]), asList(older), asList(newer)));
  }
  out.captured = captured as FlowState['captured'];
  return out;
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
 * [CONCURRENCIA] Cierra el paso de beginFlowStep. Lo que cambiaron los dos, lo deja el mensaje posterior
 * (llego despues). `conversationId`: la conversacion de este paso (si el otro empezo un pedido nuevo, gana
 * ese y el resultado de este no se anota ahi). `captured`: el estado mezclado, cuando difiere de lo de este
 * paso (el negocio de este mensaje lo usa).
 */
export function settleFlowStep(phone: string, seq: number, base: FlowState, current: FlowState | undefined): {
  conversationId: number;
  captured?: FlowState['captured'];
} {
  flowSeqs.set(phone, Math.max(flowSeqs.get(phone) ?? 0, seq));
  const after = getFlowState(phone);
  const conversationId = after.firstMessageAt;
  if (!current) return { conversationId };
  const merged = mergeFlow(base, after, current, false);
  saveFlowState(phone, merged);
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

function merge3(base: Snapshot | undefined, mine: Snapshot, theirs: Snapshot): Snapshot {
  const mineWins = (mine.flowSeq ?? 0) > (theirs.flowSeq ?? 0);
  const history = mergeHistory(base ? historyOf(base) : undefined, historyOf(mine), historyOf(theirs));
  const transcript = mergeTranscript(base?.transcript, mine.transcript, theirs.transcript);
  return {
    flow: mergeFlow(base?.flow, mine.flow, theirs.flow, mineWins),
    flowSeq: Math.max(mine.flowSeq ?? 0, theirs.flowSeq ?? 0),
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
  return {
    flow: structuredClone(getFlowState(phone)),
    flowSeq: flowSeqs.get(phone) ?? 0,
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

/** [TOPE] Datos capturados acotados y, sobre MAX_STATE_BYTES, menos historial y transcripcion. */
function bound(s: Snapshot): Snapshot {
  const { captured, trimmed: capturedTrimmed } = boundCaptured(s.flow.captured);
  const out: Snapshot = { ...s, flow: { ...s.flow, captured: captured as FlowState['captured'] }, history: [...s.history], historySeq: [...(s.historySeq ?? [])] };
  if (s.transcript) out.transcript = { ...s.transcript, entries: [...s.transcript.entries] };
  const size = () => Buffer.byteLength(JSON.stringify(out));
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
  if (trimmed) console.warn(LOG_PREFIX + ' Estado sobre el tope de ' + MAX_STATE_BYTES + ' bytes: se acortan historial y transcripcion');
  return out;
}

type SharedRead = { ok: false } | { ok: true; rev: number; snap?: Snapshot; invalid?: boolean };

function parseSnapshot(raw: string): Snapshot {
  const state = JSON.parse(raw) as Snapshot;
  if (!state.flow?.captured || !Array.isArray(state.history)) throw new Error('estado invalido');
  const historySeq = Array.isArray(state.historySeq) && state.historySeq.length === state.history.length ? state.historySeq : undefined;
  const turns = normalizeTurns(state.history.map((t, i): SequencedTurn => {
    const seq = historySeq?.[i];
    const turn: SequencedTurn = { role: t.role, content: String(t.content ?? '') };
    if (typeof seq === 'number') turn.seq = seq;
    return turn;
  }));
  const transcript = normalizeTranscript(state.transcript);
  return {
    ...(typeof state.rev === 'number' ? { rev: state.rev } : {}),
    updatedAt: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0,
    flow: state.flow,
    flowSeq: typeof state.flowSeq === 'number' && Number.isFinite(state.flowSeq) ? state.flowSeq : 0,
    history: turns.map((t) => ({ role: t.role, content: t.content })),
    historySeq: turns.map((t) => t.seq ?? null),
    privacyShown: state.privacyShown === true,
    pending: Array.isArray(state.pending) ? state.pending : [],
    ...(transcript ? { transcript } : {}),
  };
}

async function readShared(phone: string): Promise<SharedRead> {
  const result = await redisJsonCommand<string | null>('GET', conversationKey(phone));
  if (!result.ok) return { ok: false };
  if (!result.result) return { ok: true, rev: 0 };
  const rev = Number(/^\{"rev":(\d+),/.exec(result.result)?.[1] ?? 0);
  try {
    return { ok: true, rev, snap: parseSnapshot(result.result) };
  } catch {
    return { ok: true, rev, invalid: true };
  }
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
function serialized(phone: string, run: () => Promise<void>): Promise<void> {
  const previous = chains.get(phone) ?? Promise.resolve();
  const next = previous.then(run);
  const settled = next.catch(() => {});
  chains.set(phone, settled);
  void settled.then(() => { if (chains.get(phone) === settled) chains.delete(phone); });
  return next;
}

/**
 * Relee Upstash, mezcla con la memoria (tres vias) y escribe con la revision leida; si otro guardo
 * entre medio, vuelve a leer. Upstash caido: queda en memoria (dirty) para el proximo guardado.
 */
async function writeMerged(phone: string, updatedAt: number): Promise<void> {
  let meta = local.get(phone);
  if (!meta) { meta = { updatedAt, dirty: true }; local.set(phone, meta); }
  meta.updatedAt = updatedAt;
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const shared = await readShared(phone);
    if (!shared.ok) { meta.dirty = true; unavailable('guardar estado'); return; }
    const legacyLeft = shared.snap ? await migrateLegacyPending(phone, shared.snap.pending) : [];
    // Desde aqui hasta el EVAL no hay await: ningun otro mensaje de esta instancia cambia la memoria.
    const mine = snapshotOf(phone);
    const merged = bound(shared.snap ? merge3(meta.base, mine, shared.snap) : mine);
    merged.pending = legacyLeft;
    applySnapshot(phone, merged);
    if (shared.snap) meta.base = shared.snap;
    const value = serialize(merged, shared.rev + 1, updatedAt);
    const result = await redisJsonCommand<number>('EVAL', SAVE_IF_REV_SCRIPT, '1', conversationKey(phone), shared.rev, value, CONVERSATION_TTL_S);
    if (!result.ok) { meta.dirty = true; unavailable('guardar estado'); return; }
    if (Number(result.result) === 1) {
      meta.base = { ...merged, rev: shared.rev + 1, updatedAt };
      meta.dirty = false;
      return;
    }
  }
  meta.dirty = true;
  console.warn(LOG_PREFIX + ' El estado compartido cambio en cada intento; se guarda en el proximo mensaje');
}

function clearLocal(phone: string): void {
  clearFlowState(phone);
  clearHistory(phone);
  restorePrivacyNotice(phone, false);
  clearTranscript(phone);
  flowSeqs.delete(phone);
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

export function persistConversation(phone: string): Promise<void> {
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
