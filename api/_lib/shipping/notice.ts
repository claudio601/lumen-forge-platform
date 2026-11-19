// api/_lib/shipping/notice.ts
// ─────────────────────────────────────────────────────────────────────────────
// Orquestación del aviso de despacho (spec Nivel 2, §3 pasos 4 a 11, §4.2, §4.4 y §8). La llama
// el webhook de Pipedrive (api/pipedrive/webhook.ts) en waitUntil, después de responder 200,
// cuando en ese evento «Despacho · Aviso» cambió a una opción.
//
// 1. Candado por negocio (SET NX PX 90 s, con un valor propio). Tomado: termina sin tocar nada
//    (reintento, doble guardado o aviso en curso). Al terminar se suelta con compare-and-delete.
//    Redis caído: sigue sin candado, pero solo la vista previa puede salir.
// 2. Relee el negocio y confirma que el disparador sigue con la opción del evento: la fuente de
//    verdad es el negocio, nunca la petición.
// 3. Lee los 15 campos por su nombre (fields.ts). Una opción que no está en las opciones guardadas
//    refresca /dealFields una vez y se vuelve a leer.
// 4. Persona y correo (readPersonContact), productos (products.ts), archivos (files.ts: la lista,
//    la descarga con tope y sniffType) y la plantilla (template.ts). Los productos, por prioridad:
//    «Despacho · Productos»; si no, requested_items_json de la solicitud RC- (en la vista previa,
//    o al enviar si hubo una vista previa de la misma clave en las últimas 24 h); si no, el aviso
//    sale sin lista («El detalle de los productos va en la <documento> adjunta»). Un aviso ya no
//    se detiene por falta de productos (dueño, 18-11-2026), pero un SKU desconocido sin texto sí.
// 5. Vista previa: hasta 5 por negocio por hora (contador en Redis) y, si sale, la marca de 24 h
//    (como hash de la clave).
//    Enviar al cliente: solo con SITE_URL = https://elights.cl y Redis disponible; tres capas
//    contra el envío doble: Redis (`sending` 10 min, `sent:<iso>` 400 días, `uncertain`), el
//    campo «Despacho · Aviso enviado» y la deduplicación del relay.
// 6. Plazo: 60 s de la función menos 10 s de margen = 50 s desde que llegó el webhook. Las
//    lecturas tienen hasta el punto en que el relay todavía puede empezar (quedan 40 s); el relay
//    (hasta 30 s) empieza solo si quedan al menos 40 s; las escrituras, lo que queda hasta los
//    50 s; el ATENCIÓN, los 10 s de margen.
// 7. Toda salida con nota vacía el disparador después de escribirla, releyendo antes que siga con
//    la opción procesada (si el dueño ya eligió otra, no se toca). Al enviar, un solo PUT con
//    «Aviso enviado», el disparador vacío y la etapa «Despachado» del embudo del negocio (por
//    nombre; sin esa etapa, solo la nota). El valor del negocio nunca se toca.
// 8. Si el correo salió y Pipedrive no registró la nota o el PUT: correo ATENCIÓN a ventas@
//    (notifySales) y una tarea al dueño (PIPEDRIVE_OWNER_USER_ID).
//
// Notas: texto interno para el dueño, escapado entero (la nota es HTML). Registros: una línea por
// aviso con el id del negocio, la acción, los 8 primeros caracteres de la clave, el resultado y
// los códigos de los problemas; nunca nombres, correos, teléfonos, nombres de archivo ni textos.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { escapeHtml } from '../html/escape.js';
import { incrementCounter, redisJsonCommandWithTimeout } from '../idempotency/redis.js';
import { notifySales } from '../notify/salesEmail.js';
import { relayReason, sendShippingNotice, type ShippingAttachment, type ShippingRelayResult } from '../notify/shippingRelay.js';
import { createAttentionTask } from '../pipedrive/activities.js';
import { pipedriveGetBinary } from '../pipedrive/client.js';
import { createDealNote, getDeal, listDealFiles, listDealNotes, putDealFields } from '../pipedrive/deals.js';
import { findDealFieldByName, findStageByName, refreshDealFieldsByName, type DealFieldLookup } from '../pipedrive/fieldOptions.js';
import { getPerson } from '../pipedrive/persons.js';
import { SITE_URL } from '../site.js';
import { carrierRef, numberCellLabel } from './carriers.js';
import { documentPhrase, documentTitle } from './documents.js';
import {
  formatSentLog,
  readPersonContact,
  readShippingFields,
  resolveShippingFieldMap,
  sentLogMatches,
  SHIPPING_FIELD_IDS,
  SHIPPING_FIELD_NAMES,
  SHIPPING_OPTIONS,
  type FieldMapResult,
  type ShippingAction,
  type ShippingFieldMap,
  type ShippingFields,
  type ShippingProblem,
} from './fields.js';
import { checkDownloadedFile, selectShippingFiles, type DealFileMeta, type ReadyAttachment, type SelectedFile } from './files.js';
import { chileDateTime, formatClp, formatDateLong, formatDecimal } from './format.js';
import { shippingNoticeKey, shortKey } from './key.js';
import { parseProductLines, productsFromField, readRequestedItems, resolveRequestedItems, type DealNote, type NoticeProductLine } from './products.js';
import { buildShippingNotice, type ShippingNotice } from './template.js';

// ── Plazos y topes ──────────────────────────────────────────────────────────

/** maxDuration de api/pipedrive/webhook.ts en vercel.json (notice.test.ts revisa que coincidan). */
export const NOTICE_MAX_DURATION_S = 60;
/** Margen al final de la función: el ATENCIÓN a ventas@ (10 s) cabe aquí. */
export const NOTICE_END_MARGIN_MS = 10_000;
/** El relay (hasta 30 s) empieza solo si quedan al menos 40 s hasta el plazo de 50 s. */
export const MIN_RELAY_WINDOW_MS = 40_000;
/** Plazo de cada lectura o escritura de Pipedrive (como el cliente). */
const PIPEDRIVE_STEP_MS = 15_000;
const REDIS_TIMEOUT_MS = 2_000;
/** El ATENCIÓN y la tarea al dueño no esperan más que esto. */
const ATTENTION_TIMEOUT_MS = 8_000;

export const NOTICE_LOCK_TTL_MS = 90_000;
export const SENDING_TTL_S = 10 * 60;
export const SENT_TTL_S = 400 * 86_400;
export const PREVIEW_MARK_TTL_S = 24 * 3_600;
export const PREVIEW_LIMIT = 5;
export const PREVIEW_WINDOW_S = 3_600;

/** Etapa a la que pasa el negocio al enviar, buscada por nombre en su embudo. */
export const DISPATCHED_STAGE_NAME = 'Despachado';
/** El envío al cliente exige que los enlaces vayan al dominio público (spec §3, paso 9). */
export const PUBLIC_SITE_URL = 'https://elights.cl';

/** Hasta cuándo puede seguir el aviso de un webhook que llegó en `startedAt` (50 s). */
export const noticeDeadline = (startedAt: number) => startedAt + NOTICE_MAX_DURATION_S * 1000 - NOTICE_END_MARGIN_MS;

const LOG = '[aviso-despacho]';

// ── Claves de Redis ─────────────────────────────────────────────────────────
// El candado y el contador de vistas previas llevan el id del negocio (duran 90 s y 1 h). El
// estado del envío y la marca de 24 h van con el hash de la clave (key.ts): ni el negocio ni la
// orden quedan legibles en Upstash. Los valores solo llevan el estado y la fecha.

export const noticeLockKey = (dealId: number) => `aviso-despacho:lock:${dealId}`;
export const noticeStateKey = (key: string) => `aviso-despacho:v1:${key}`;
export const previewMarkKey = (key: string) => `aviso-despacho:v1:vista-previa:${key}`;
export const previewCountKey = (dealId: number) => `aviso-despacho:v1:vistas-previas:${dealId}`;

const COMPARE_AND_DELETE = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;

type RedisReply<T> = { ok: true; result: T } | { ok: false };

async function redis<T>(...args: (string | number)[]): Promise<RedisReply<T>> {
  try {
    const res = await redisJsonCommandWithTimeout<T>(REDIS_TIMEOUT_MS, ...args);
    return res.ok === false ? { ok: false } : { ok: true, result: res.result };
  } catch {
    return { ok: false };
  }
}

type NoticeState = { kind: 'none' } | { kind: 'sending' } | { kind: 'uncertain' } | { kind: 'sent'; at: Date | null };

function parseState(raw: unknown): NoticeState {
  if (raw === null || raw === undefined) return { kind: 'none' };
  const value = String(raw);
  if (value === 'sending') return { kind: 'sending' };
  if (value === 'uncertain') return { kind: 'uncertain' };
  if (value.startsWith('sent:')) {
    const at = new Date(value.slice(5));
    return { kind: 'sent', at: Number.isFinite(at.getTime()) ? at : null };
  }
  // Un valor que no es de este código: no se puede afirmar que no salió.
  return { kind: 'sending' };
}

// ── Entrada ─────────────────────────────────────────────────────────────────

export interface ShippingNoticeInput {
  dealId: number;
  /** Clave de «Despacho · Aviso» (la resolvió el webhook por nombre). */
  triggerKey: string;
  /** Opción que el evento dejó en el disparador. */
  triggerOptionId: number;
  /** Cuándo llegó el webhook (ms): de ahí sale el plazo. */
  startedAt: number;
}

/**
 * Resultado (para el registro y las pruebas): `candado_tomado`, `disparador_cambio`,
 * `vista_previa_enviada`, `enviado`, `ya_enviado`, `datos_incompletos`, `reintentar`, …
 */
export type NoticeOutcome = string;

interface Run {
  dealId: number;
  triggerKey: string;
  triggerOptionId: number;
  deadline: number;
  /** Último momento en que el relay todavía puede empezar. */
  relayCutoff: number;
  redisUp: boolean;
  action: ShippingAction | null;
  key: string | null;
  /** Para la línea del registro: solo códigos. */
  facts: string[];
}

const clampMs = (ms: number, max = PIPEDRIVE_STEP_MS) => Math.max(1, Math.min(max, Math.floor(ms)));
/** Lecturas: hasta el último momento en que el relay puede empezar. */
const readBudget = (run: Run) => clampMs(run.relayCutoff - Date.now());
/** Escrituras: hasta el plazo de 50 s. */
const writeBudget = (run: Run) => clampMs(run.deadline - Date.now());

/**
 * Procesa el aviso de despacho de un negocio. Nunca lanza: devuelve el resultado y deja una línea
 * en el registro, sin datos del cliente.
 */
export async function processShippingNotice(input: ShippingNoticeInput): Promise<NoticeOutcome> {
  const deadline = noticeDeadline(input.startedAt);
  const run: Run = {
    dealId: input.dealId,
    triggerKey: input.triggerKey,
    triggerOptionId: input.triggerOptionId,
    deadline,
    relayCutoff: deadline - MIN_RELAY_WINDOW_MS,
    redisUp: true,
    action: null,
    key: null,
    facts: [],
  };
  const token = randomUUID();
  const lock = await redis<string | null>('SET', noticeLockKey(input.dealId), token, 'NX', 'PX', NOTICE_LOCK_TTL_MS);
  if (lock.ok && lock.result !== 'OK') {
    logOutcome(run, 'candado_tomado');
    return 'candado_tomado';
  }
  run.redisUp = lock.ok;
  if (!lock.ok) run.facts.push('redis=caido');

  let outcome: NoticeOutcome;
  try {
    outcome = await execute(run);
  } catch {
    // No debería pasar: cada paso devuelve su resultado. Sin nota (no se sabe en qué quedó).
    outcome = 'error_interno';
  } finally {
    if (lock.ok) {
      const released = await redis<number>('EVAL', COMPARE_AND_DELETE, 1, noticeLockKey(input.dealId), token);
      if (!released.ok) run.facts.push('candado=sin_soltar');
    }
  }
  logOutcome(run, outcome);
  return outcome;
}

function logOutcome(run: Run, outcome: NoticeOutcome): void {
  const parts = [
    `negocio=${run.dealId}`,
    `accion=${run.action ?? '-'}`,
    `clave=${shortKey(run.key)}`,
    `resultado=${outcome}`,
    ...run.facts,
  ];
  console.log(`${LOG} ${parts.join(' ')}`);
}

/** Id de una opción tal como la devuelve GET /deals/{id} (número o texto) o, por las dudas, `{ id }`. */
function optionIdOf(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && /^\d{1,15}$/.test(raw.trim())) return Number(raw.trim());
  if (raw && typeof raw === 'object' && 'id' in raw) return optionIdOf((raw as { id?: unknown }).id);
  return null;
}

const actionLabel = (action: ShippingAction | null) =>
  action === 'send' ? SHIPPING_OPTIONS.trigger.send : action === 'preview' ? SHIPPING_OPTIONS.trigger.preview : null;

const normalized = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** La acción que eligió el dueño, leída de la opción del disparador (también cuando faltan datos). */
function actionOf(deal: Readonly<Record<string, unknown>>, fields: Pick<ShippingFieldMap, 'trigger'>): ShippingAction | null {
  const id = optionIdOf(deal[fields.trigger.key]);
  const option = fields.trigger.options.find((o) => Number(o.id) === id);
  if (!option) return null;
  if (normalized(option.label) === normalized(SHIPPING_OPTIONS.trigger.preview)) return 'preview';
  if (normalized(option.label) === normalized(SHIPPING_OPTIONS.trigger.send)) return 'send';
  return null;
}

async function loadFieldMap(timeoutMs: number): Promise<FieldMapResult> {
  const lookups: Record<string, DealFieldLookup> = {};
  for (const id of SHIPPING_FIELD_IDS) {
    const name = SHIPPING_FIELD_NAMES[id];
    const lookup = await findDealFieldByName(name, { timeoutMs });
    lookups[name] = lookup;
    // Sin /dealFields no se sigue preguntando: cada nombre volvería a consultar.
    if (lookup.status === 'unavailable') return { status: 'unavailable' };
  }
  return resolveShippingFieldMap(lookups);
}

/** Referencia del negocio (PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE) tal cual, o null. */
function quoteReferenceOf(deal: Readonly<Record<string, unknown>>): string | null {
  const key = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
  const raw = key ? deal[key] : null;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

const RC_REFERENCE = /^RC-[a-z0-9]{5,8}$/i;

// ── Notas ───────────────────────────────────────────────────────────────────

const TRIGGER = `«${SHIPPING_FIELD_NAMES.trigger}»`;
const PRODUCTS_FIELD = `«${SHIPPING_FIELD_NAMES.products}»`;
const SENT_CHECK = 'Revisa Enviados (el asunto sin «[Vista previa]»)';

/** «2026-11-18 14:05», en hora de Chile (para leer en la nota; el campo usa formatSentLog). */
function chileStamp(at: Date): string {
  const { date, time } = chileDateTime(at);
  return `${date} ${time}`;
}

function retryLine(action: ShippingAction | null): string {
  const label = actionLabel(action);
  return label
    ? `Cuando esté listo, vuelve a elegir «${label}» en ${TRIGGER}.`
    : `Cuando esté listo, vuelve a elegir «${SHIPPING_OPTIONS.trigger.preview}» o «${SHIPPING_OPTIONS.trigger.send}» en ${TRIGGER}.`;
}

function headline(action: ShippingAction | null): string {
  const label = actionLabel(action);
  return `Aviso de despacho NO enviado${label ? ` («${label}»)` : ''}`;
}

function problemsNote(action: ShippingAction | null, problems: readonly ShippingProblem[]): string[] {
  return [`${headline(action)}. Falta o hay que corregir:`, ...problems.map((p) => `- ${p.message}`), retryLine(action)];
}

function transientNote(action: ShippingAction | null, reason: string): string[] {
  const label = actionLabel(action) ?? SHIPPING_OPTIONS.trigger.preview;
  return [`${headline(action)}: ${reason}.`, `Reintenta en unos minutos: vuelve a elegir «${label}» en ${TRIGGER}.`];
}

function alreadySentNote(at: Date | null, data: ShippingFields): string[] {
  return [
    `Aviso de despacho NO enviado: ya se envió${at ? ` el ${chileStamp(at)} (hora de Chile)` : ''} con ${data.carrier.label} ${data.order}.`,
    'Para corregir algo, escríbele desde Gmail.',
  ];
}

const SENDING_NOTE = [
  'Aviso de despacho NO enviado: hay un envío en curso o sin confirmar.',
  `${SENT_CHECK} en 10 minutos; si no está, vuelve a elegir «${SHIPPING_OPTIONS.trigger.send}». Si ya había salido, el relay no lo repite.`,
];

const DOMAIN_NOTE = [
  'Aviso de despacho NO enviado: el envío al cliente queda disponible después del cambio de dominio (los enlaces a las fichas tienen que ir a elights.cl).',
  `Mientras tanto funciona «${SHIPPING_OPTIONS.trigger.preview}».`,
];

function uncertainNote(reason: string): string[] {
  return [
    `Aviso de despacho: no sé si salió (${reason}).`,
    `${SENT_CHECK}; si no está, vuelve a elegir «${SHIPPING_OPTIONS.trigger.send}». Si ya había salido, el relay no lo repite.`,
  ];
}

function reasonOf(result: ShippingRelayResult): string {
  return 'reason' in result && typeof result.reason === 'string' ? result.reason : '';
}

/**
 * Vista previa rechazada con el motivo `reenvio` o `cache` del relay (el cliente los entrega ya
 * traducidos, con relayReason): no salió y se reintenta en unos minutos, sin ATENCIÓN.
 */
const PREVIEW_RETRY_REASONS: ReadonlySet<string> = new Set([relayReason('reenvio'), relayReason('cache')]);

function previewRetryable(result: ShippingRelayResult): boolean {
  return result.status === 'rejected' && PREVIEW_RETRY_REASONS.has(reasonOf(result));
}

function refusedText(result: ShippingRelayResult): string {
  const reason = reasonOf(result);
  if (result.status === 'quota') return 'se acabó la cuota diaria de correos de Gmail; reintenta mañana';
  if (result.status === 'config') return `falta configuración en el servidor (${reason})`;
  return `el relay rechazó el pedido (${reason}); hay que revisar su configuración (secreto, URL o propiedades del script)`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${formatDecimal(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}

type ProductSource = { kind: 'field'; skus: string[] } | { kind: 'request'; reference: string } | { kind: 'none' };

function productLines(products: readonly NoticeProductLine[], source: ProductSource, data: ShippingFields): string[] {
  if (!products.length) return [`Productos: sin lista (el correo dice que el detalle va en ${documentPhrase(data.document)} adjunta).`];
  const from = source.kind === 'field' ? `de ${PRODUCTS_FIELD}` : source.kind === 'request' ? `de la solicitud ${source.reference}` : '';
  return [
    `Productos${from ? ` (${from})` : ''}:`,
    ...products.map((p, i) => {
      const sku = source.kind === 'field' ? source.skus[i] : null;
      return `- ${p.quantity} x ${sku ? `${sku} ` : ''}${p.name}`;
    }),
  ];
}

function attachmentsLine(attachments: readonly ReadyAttachment[]): string {
  return `Adjuntos: ${attachments.map((a) => `${a.fileName} (${formatSize(a.bytes.length)})`).join(', ')}`;
}

function sentNote(args: {
  at: Date;
  data: ShippingFields;
  products: readonly NoticeProductLine[];
  source: ProductSource;
  attachments: readonly ReadyAttachment[];
  stage: string;
  key: string;
}): string[] {
  const { data } = args;
  const delivery = data.delivery === 'pickup' ? SHIPPING_OPTIONS.delivery.pickup : SHIPPING_OPTIONS.delivery.home;
  const freight =
    data.freight.kind === 'due'
      ? `${SHIPPING_OPTIONS.freight.due}, ${formatClp(data.freight.amountClp)} (lo cobra el operador; no es parte del negocio)`
      : SHIPPING_OPTIONS.freight.paid;
  return [
    `Aviso de despacho enviado (${chileStamp(args.at)}, hora de Chile)`,
    `Operador: ${data.carrier.label} | ${numberCellLabel(data.carrier)}: ${data.order}`,
    `Entrega: ${delivery}, ${data.place} | Estimada: ${data.eta ? formatDateLong(data.eta) : 'sin fecha'}`,
    `Flete: ${freight}`,
    `Bultos: ${data.packages} | Kilos: ${formatDecimal(data.kilos)} | ${documentTitle(data.document)}`,
    ...productLines(args.products, args.source, data),
    attachmentsLine(args.attachments),
    'Enviado al correo principal de la persona del negocio (o al primero de su lista, si ninguno es principal).',
    args.stage,
    `aviso_despacho_key: ${args.key}`,
  ];
}

// ── Escrituras en Pipedrive ─────────────────────────────────────────────────

async function writeNote(run: Run, lines: readonly string[]): Promise<boolean> {
  const res = await createDealNote(run.dealId, escapeHtml(lines.join('\n')), writeBudget(run));
  run.facts.push(`nota=${res.ok ? 'ok' : 'fallo'}`);
  return res.ok;
}

/**
 * Relee el negocio y arma el PUT final: `extra` siempre y el disparador en null solo si sigue con
 * la opción procesada (si el dueño ya eligió otra, no se toca). Devuelve si el PUT quedó.
 */
async function finalPut(run: Run, extra: Record<string, unknown> = {}): Promise<boolean> {
  const fresh = await getDeal(run.dealId, writeBudget(run));
  const fields: Record<string, unknown> = { ...extra };
  if (fresh.ok && optionIdOf(fresh.deal[run.triggerKey]) === run.triggerOptionId) fields[run.triggerKey] = null;
  else run.facts.push(fresh.ok ? 'disparador=cambio' : 'disparador=sin_releer');
  if ('stage_id' in fields && fresh.ok && Number(fresh.deal.stage_id) === Number(fields.stage_id)) delete fields.stage_id;
  if (Object.keys(fields).length === 0) return true;
  const res = await putDealFields(run.dealId, fields, writeBudget(run));
  run.facts.push(`put=${res.ok ? 'ok' : 'fallo'}`);
  return res.ok;
}

const LATE = 'no alcanzó el tiempo de la función para enviarlo';

/**
 * Nota «reintenta en unos minutos» y el disparador vacío. Si ya pasó el último momento en que el
 * relay podía empezar, la causa es el plazo (una lectura cortada por el plazo también falla).
 */
function retryLater(run: Run, reason: string): Promise<NoticeOutcome> {
  const late = Date.now() > run.relayCutoff;
  if (late) run.facts.push('plazo=agotado');
  return stop(run, transientNote(run.action, late ? LATE : reason), 'reintentar');
}

/** Nota y disparador vacío: el final de toda salida que no envió el correo. */
async function stop(run: Run, lines: readonly string[], outcome: NoticeOutcome): Promise<NoticeOutcome> {
  await writeNote(run, lines);
  await finalPut(run);
  return outcome;
}

async function stopWithProblems(run: Run, problems: readonly ShippingProblem[]): Promise<NoticeOutcome> {
  run.facts.push(`problemas=${problems.map((p) => `${p.field ?? '-'}:${p.code}`).join(',')}`);
  return stop(run, problemsNote(run.action, problems), 'datos_incompletos');
}

// ── ATENCIÓN a ventas@ y tarea al dueño ─────────────────────────────────────

interface AttentionArgs {
  /** Primera línea del correo (la que lee ventas@; el relay de hoy ignora el asunto). */
  headline: string;
  details: string[];
  email: string;
  /** Tarea al dueño: solo si el correo salió y Pipedrive no lo registró. */
  task?: { personId: number | null; subject: string };
}

async function attention(run: Run, args: AttentionArgs): Promise<void> {
  const body = [args.headline, '', `Negocio ${run.dealId} en Pipedrive.`, ...args.details].join('\n');
  const mail = notifySales(
    { modo: 'Aviso de despacho', nombre: `Negocio ${run.dealId}`, email: args.email, telefono: '-', cuerpo: body, asunto: `ATENCIÓN aviso de despacho, negocio ${run.dealId}` },
    `${LOG} ATENCIÓN negocio=${run.dealId}`,
  );
  const userId = Number(process.env.PIPEDRIVE_OWNER_USER_ID);
  const task = args.task && Number.isSafeInteger(userId) && userId > 0
    ? createAttentionTask({
        dealId: run.dealId,
        personId: args.task.personId,
        userId,
        subject: args.task.subject,
        note: body,
        timeoutMs: clampMs(run.deadline + NOTICE_END_MARGIN_MS - 1_000 - Date.now(), ATTENTION_TIMEOUT_MS),
      })
    : Promise.resolve(null);
  const [sent, created] = await Promise.all([mail, task]);
  run.facts.push(`atencion=${sent ? 'ok' : 'fallo'}`);
  if (args.task) run.facts.push(`tarea=${created && created.ok ? 'ok' : created ? 'fallo' : 'sin_usuario'}`);
}

// ── El aviso ────────────────────────────────────────────────────────────────

interface Prepared {
  deal: Readonly<Record<string, unknown>>;
  fields: ShippingFieldMap;
  data: ShippingFields;
  key: string;
  email: string;
  greetingName: string | null;
  products: NoticeProductLine[];
  source: ProductSource;
  /** Por qué no se usó la lista de la solicitud RC-, para la nota de la vista previa. */
  requestIssue: string | null;
  attachments: ReadyAttachment[];
  notice: ShippingNotice;
}

async function execute(run: Run): Promise<NoticeOutcome> {
  // 2. El negocio, releído: el disparador tiene que seguir con la opción del evento. Esta lectura
  // tiene el plazo de las escrituras: sin ella no hay nota posible (tampoco la de «sin plazo»).
  const dealRes = await getDeal(run.dealId, writeBudget(run));
  if (dealRes.ok === false) return dealRes.reason === 'not_found' ? 'negocio_no_existe' : 'negocio_no_disponible';
  const deal = dealRes.deal as Readonly<Record<string, unknown>>;
  if (optionIdOf(deal[run.triggerKey]) !== run.triggerOptionId) return 'disparador_cambio';

  // 3. Los campos por nombre.
  const map = await loadFieldMap(readBudget(run));
  if (map.status === 'unavailable') return retryLater(run, 'Pipedrive no entregó la lista de campos');
  if (map.status === 'invalid') return stopWithProblems(run, map.problems);
  let fields = map.fields;
  run.action = actionOf(deal, fields);
  // Sin plazo para el relay, no se sigue leyendo (/dealFields suele estar en caché: el webhook lo
  // consultó para reconocer el disparador, y así la nota nombra la opción elegida).
  if (Date.now() > run.relayCutoff) return retryLater(run, LATE);
  let read = readShippingFields(deal, fields, { now: new Date() });
  if (read.ok === false && read.problems.some((p) => p.code === 'unknown_option')) {
    // Una opción recién agregada (p. ej., un operador nuevo): /dealFields una vez más.
    run.facts.push('campos=refresco');
    if (await refreshDealFieldsByName({ timeoutMs: readBudget(run) })) {
      const again = await loadFieldMap(readBudget(run));
      if (again.status === 'ok') {
        fields = again.fields;
        run.action = actionOf(deal, fields);
        read = readShippingFields(deal, fields, { now: new Date() });
      }
    }
  }

  // Enviar al cliente: antes que nada, el dominio y Redis (sin ellos no sale, falten datos o no).
  if (run.action === 'send') {
    if (SITE_URL !== PUBLIC_SITE_URL) return stop(run, DOMAIN_NOTE, 'dominio');
    if (!run.redisUp) return retryLater(run, 'el registro contra el envío doble (Redis) no respondió');
  }
  if (read.ok === false) return stopWithProblems(run, read.problems);
  const data = read.data;
  if (!run.action) return stopWithProblems(run, [{ field: 'trigger', code: 'unknown_option', message: `${TRIGGER} no es «${SHIPPING_OPTIONS.trigger.preview}» ni «${SHIPPING_OPTIONS.trigger.send}».` }]);

  let key: string;
  try {
    key = shippingNoticeKey(run.dealId, data.carrier.slug, data.orderNormalized);
  } catch {
    return stopWithProblems(run, [{ field: 'carrier', code: 'invalid', message: `El nombre del operador «${data.carrier.label}» no sirve para el registro del envío: usa una opción más corta.` }]);
  }
  run.key = key;

  // Enviar al cliente: ¿ya salió? Capa 2 (el campo) y capa 1 (Redis).
  let previewMark = false;
  if (run.action === 'send') {
    if (sentLogMatches(data.lastNotice, data.carrier, data.orderNormalized)) return stop(run, alreadySentNote(data.lastNotice.at, data), 'ya_enviado');
    const state = await redis<string | null>('GET', noticeStateKey(key));
    if (state.ok === false) return retryLater(run, 'el registro contra el envío doble (Redis) no respondió');
    const parsed = parseState(state.result);
    run.facts.push(`estado=${parsed.kind}`);
    if (parsed.kind === 'sent') return stop(run, alreadySentNote(parsed.at, data), 'ya_enviado');
    if (parsed.kind === 'sending') return stop(run, SENDING_NOTE, 'en_curso');
    // `uncertain` sigue: si el correo había salido, el relay responde `duplicate`.
    const mark = await redis<string | null>('GET', previewMarkKey(key));
    previewMark = mark.ok && mark.result !== null && mark.result !== undefined;
  }

  const prepared = await prepare(run, deal, fields, data, key, previewMark);
  if (typeof prepared === 'string') return prepared;

  // Vista previa: hasta 5 por negocio por hora (sin Redis, sin contador).
  if (run.action === 'preview' && run.redisUp) {
    const count = await incrementCounter(previewCountKey(run.dealId), 1, PREVIEW_WINDOW_S);
    if (count.ok && count.value > PREVIEW_LIMIT) {
      return stop(run, [
        `Vista previa NO enviada: ya van ${PREVIEW_LIMIT} vistas previas de este negocio en la última hora.`,
        `Espera un rato y vuelve a elegir «${SHIPPING_OPTIONS.trigger.preview}» en ${TRIGGER}.`,
      ], 'limite_vistas_previas');
    }
  }

  // El relay empieza solo si quedan al menos 40 s hasta el plazo.
  if (Date.now() > run.relayCutoff) return retryLater(run, LATE);
  return run.action === 'preview' ? sendPreview(run, prepared) : sendToCustomer(run, prepared);
}

/** Persona, productos, archivos y plantilla. Devuelve el aviso listo o el resultado de la nota. */
async function prepare(
  run: Run,
  deal: Readonly<Record<string, unknown>>,
  fields: ShippingFieldMap,
  data: ShippingFields,
  key: string,
  previewMark: boolean,
): Promise<Prepared | NoticeOutcome> {
  const problems: ShippingProblem[] = [];

  // Persona y correo.
  let email = '';
  let greetingName: string | null = null;
  const person = await getPerson(data.personId, readBudget(run));
  if (person.ok === false) {
    if (person.reason === 'failed') return retryLater(run, 'Pipedrive no entregó la persona del negocio');
    problems.push({ field: null, code: 'no_person', message: 'La persona del negocio ya no existe en Pipedrive: agrega la persona del cliente, con su correo.' });
  } else {
    const contact = readPersonContact(person.person as Readonly<Record<string, unknown>>);
    if (contact.ok === false) problems.push(contact.problem);
    else {
      email = contact.email;
      greetingName = contact.greetingName;
    }
  }

  // Productos.
  let products: NoticeProductLine[] = [];
  let source: ProductSource = { kind: 'none' };
  let requestIssue: string | null = null;
  if (data.productsText) {
    const resolved = productsFromField(data.productsText);
    problems.push(...resolved.problems);
    products = resolved.items;
    source = { kind: 'field', skus: parseProductLines(data.productsText).lines.map((l) => l.sku) };
  } else if (run.action === 'preview' || previewMark) {
    const reference = quoteReferenceOf(deal);
    if (reference && RC_REFERENCE.test(reference)) {
      const notes = await listDealNotes<DealNote>(run.dealId, { deadline: Date.now() + readBudget(run) });
      if (notes.ok === false) return retryLater(run, 'Pipedrive no entregó las notas del negocio');
      const requested = readRequestedItems(notes.notes, { reference });
      if (requested.status === 'ok') {
        const resolved = resolveRequestedItems(requested.items);
        if (resolved.problems.length) requestIssue = resolved.problems[0].message;
        else {
          products = resolved.items;
          source = { kind: 'request', reference: requested.reference };
        }
      } else if (requested.status === 'invalid') requestIssue = requested.problem.message;
    }
  }

  // Archivos: la lista y la elección (sin descargar).
  const list = await listDealFiles<DealFileMeta>(run.dealId, { deadline: Date.now() + readBudget(run) });
  if (list.ok === false) return retryLater(run, 'Pipedrive no entregó la lista de archivos del negocio');
  const selection = selectShippingFiles(list.files, { document: data.document, lastNoticeAt: data.lastNotice?.at ?? null, now: new Date() });
  if (selection.ok === false) problems.push(...selection.problems);
  if (problems.length || selection.ok === false) return stopWithProblems(run, problems);

  // Descargas, con tope y tipo por los primeros bytes.
  const attachments: ReadyAttachment[] = [];
  const downloads: SelectedFile[] = selection.voucher ? [selection.document, selection.voucher] : [selection.document];
  for (const file of downloads) {
    const what = file.role === 'document' ? `El PDF «${file.fileName}»` : `La foto del comprobante «${file.fileName}»`;
    const got = await pipedriveGetBinary(`/files/${file.id}/download`, file.maxBytes, readBudget(run));
    if (got.ok === false) {
      if (got.reason === 'not_found') problems.push({ field: null, code: 'invalid', message: `${what} ya no está en el negocio: vuelve a adjuntarlo.` });
      else if (got.reason === 'too_big') problems.push({ field: null, code: 'invalid', message: `${what} pesa más de ${formatSize(file.maxBytes)}.` });
      else return retryLater(run, `Pipedrive no entregó el archivo ${file.role === 'document' ? 'del documento' : 'del comprobante'}`);
      continue;
    }
    const checked = checkDownloadedFile(file, got.bytes, { document: data.document, carrier: data.carrier, orderNormalized: data.orderNormalized });
    if (checked.ok === false) problems.push(checked.problem);
    else attachments.push(checked.attachment);
  }
  if (problems.length) return stopWithProblems(run, problems);

  // La plantilla.
  let notice: ShippingNotice;
  try {
    notice = buildShippingNotice({
      preview: run.action === 'preview',
      greetingName,
      reference: quoteReferenceOf(deal),
      carrier: carrierRef(data.carrier),
      order: data.order,
      delivery: data.delivery,
      place: data.place,
      freight: data.freight,
      packages: data.packages,
      kilos: data.kilos,
      shipDate: data.shipDate,
      eta: data.eta,
      document: data.document,
      products,
      hasVoucher: attachments.length > 1,
    });
  } catch {
    run.facts.push('plantilla=error');
    return stopWithProblems(run, [{ field: null, code: 'invalid', message: 'No se pudo armar el correo con estos datos (error interno del aviso): avísale a Claude.' }]);
  }
  run.facts.push(`productos=${source.kind}:${products.length}`, `adjuntos=${attachments.length}`);
  return { deal, fields, data, key, email, greetingName, products, source, requestIssue, attachments, notice };
}

function relayAttachments(attachments: readonly ReadyAttachment[]): ShippingAttachment[] {
  return attachments.map((a) => ({
    name: a.fileName,
    mimeType: a.contentType,
    data: Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength),
  }));
}

const relayTimeout = (run: Run) => Math.max(1, run.deadline - NOTICE_END_MARGIN_MS - Date.now());

async function sendPreview(run: Run, p: Prepared): Promise<NoticeOutcome> {
  const result = await sendShippingNotice(
    { action: 'preview', key: p.key, to: '', subject: p.notice.subject, html: p.notice.html, text: p.notice.text, attachments: relayAttachments(p.attachments) },
    { timeoutMs: relayTimeout(run) },
  );
  run.facts.push(`relay=${result.status}`);

  if (result.status === 'ok' || result.status === 'duplicate') {
    const marked = run.redisUp ? await redis<string>('SET', previewMarkKey(p.key), '1', 'EX', PREVIEW_MARK_TTL_S) : { ok: false as const };
    if (!marked.ok) run.facts.push('marca=sin_guardar');
    const summary = p.products.length
      ? p.source.kind === 'request'
        ? `los de la solicitud ${p.source.reference} (sin ${PRODUCTS_FIELD})`
        : `${p.products.length} de ${PRODUCTS_FIELD}`
      : `sin lista (el correo dice que el detalle va en ${documentPhrase(p.data.document)} adjunta)`;
    const lines = [
      `Vista previa enviada a tu correo (${chileStamp(new Date())}, hora de Chile): es el aviso de despacho tal como le llegaría al cliente.`,
      `${p.data.carrier.label}, ${numberCellLabel(p.data.carrier).toLowerCase()} ${p.data.order} · ${documentTitle(p.data.document)} · Productos: ${summary}.`,
      attachmentsLine(p.attachments),
    ];
    if (p.requestIssue) lines.push(`No se usó la lista de la solicitud: ${p.requestIssue}`);
    if (p.source.kind === 'request' && !marked.ok) {
      lines.push(`No se guardó la marca de la vista previa: «${SHIPPING_OPTIONS.trigger.send}» saldría sin la lista de la solicitud. Vuelve a pedir la vista previa o llena ${PRODUCTS_FIELD}.`);
    } else if (p.source.kind === 'request') {
      lines.push(`La lista de la solicitud vale para «${SHIPPING_OPTIONS.trigger.send}» durante 24 horas (después, sin ${PRODUCTS_FIELD}, el aviso sale sin lista).`);
    }
    lines.push(`Para enviarlo al cliente, elige «${SHIPPING_OPTIONS.trigger.send}» en ${TRIGGER}.`);
    return stop(run, lines, 'vista_previa_enviada');
  }
  if (result.status === 'uncertain') {
    return stop(run, [
      `Vista previa: no se confirmó el envío (${reasonOf(result)}).`,
      `Revisa tu correo en unos minutos; si no llegó, vuelve a elegir «${SHIPPING_OPTIONS.trigger.preview}» en ${TRIGGER}.`,
    ], 'vista_previa_incierta');
  }
  if (previewRetryable(result)) {
    // El relay no la armó ahora (otra vista previa en curso o su caché): no salió y no es una falla
    // de configuración. Después del relay ya pasó el corte, así que va directo a la nota.
    return stop(run, transientNote('preview', `el relay no la envió ahora (${reasonOf(result)})`), 'reintentar');
  }
  const text = refusedText(result);
  await writeNote(run, [`Vista previa NO enviada: ${text}. Se avisó a ventas@.`, `Cuando esté resuelto, vuelve a elegir «${SHIPPING_OPTIONS.trigger.preview}» en ${TRIGGER}.`]);
  await finalPut(run);
  await attention(run, { headline: `ATENCIÓN: la vista previa del aviso de despacho NO salió: ${text}.`, details: [], email: p.email });
  return 'vista_previa_rechazada';
}

async function sendToCustomer(run: Run, p: Prepared): Promise<NoticeOutcome> {
  const stateKey = noticeStateKey(p.key);
  // Capa 1: «enviando», 10 minutos. Sin Redis no sale.
  const marked = await redis<string>('SET', stateKey, 'sending', 'EX', SENDING_TTL_S);
  if (!marked.ok) return retryLater(run, 'el registro contra el envío doble (Redis) no respondió');

  const result = await sendShippingNotice(
    { action: 'despacho', key: p.key, to: p.email, subject: p.notice.subject, html: p.notice.html, text: p.notice.text, attachments: relayAttachments(p.attachments) },
    { timeoutMs: relayTimeout(run) },
  );
  run.facts.push(`relay=${result.status}`);

  if (result.status === 'ok' || result.status === 'duplicate') return recordSent(run, p, new Date());

  if (result.status === 'uncertain') {
    // Sin reintento automático: el dueño revisa Enviados y vuelve a elegir; el relay deduplica.
    const saved = await redis<string>('SET', stateKey, 'uncertain', 'EX', SENT_TTL_S);
    if (!saved.ok) run.facts.push('estado=sin_guardar');
    return stop(run, uncertainNote(reasonOf(result)), 'incierto');
  }

  // quota, rejected o config: no salió. Se quita «enviando» (si sigue siendo el de este intento).
  await redis<number>('EVAL', COMPARE_AND_DELETE, 1, stateKey, 'sending');
  const text = refusedText(result);
  await writeNote(run, [`Aviso de despacho NO enviado: ${text}. Se avisó a ventas@.`, `Cuando esté resuelto, vuelve a elegir «${SHIPPING_OPTIONS.trigger.send}» en ${TRIGGER}.`]);
  await finalPut(run);
  await attention(run, {
    headline: `ATENCIÓN: el aviso de despacho NO salió: ${text}.`,
    details: [`${p.data.carrier.label} ${p.data.order}, ${documentTitle(p.data.document)}.`],
    email: p.email,
  });
  return 'rechazado';
}

/** El correo salió: Redis, la nota completa y un solo PUT; si Pipedrive falla, el ATENCIÓN. */
async function recordSent(run: Run, p: Prepared, at: Date): Promise<NoticeOutcome> {
  const saved = await redis<string>('SET', noticeStateKey(p.key), `sent:${at.toISOString()}`, 'EX', SENT_TTL_S);
  if (!saved.ok) run.facts.push('estado=sin_guardar');

  const pipelineId = Number(p.deal.pipeline_id);
  const stage = await findStageByName(pipelineId, DISPATCHED_STAGE_NAME, { timeoutMs: writeBudget(run) });
  run.facts.push(`etapa=${stage.status}`);
  const stageLine =
    stage.status === 'ok'
      ? `Etapa: «${DISPATCHED_STAGE_NAME}».`
      : stage.status === 'unavailable'
        ? `Etapa: sin cambio (Pipedrive no entregó las etapas del embudo).`
        : `Etapa: sin cambio (este embudo no tiene una etapa «${DISPATCHED_STAGE_NAME}»).`;

  const noted = await writeNote(run, sentNote({ at, data: p.data, products: p.products, source: p.source, attachments: p.attachments, stage: stageLine, key: p.key }));
  const extra: Record<string, unknown> = { [p.fields.sentLog.key]: sentLogValue(at, p.data) };
  if (stage.status === 'ok') extra.stage_id = stage.stageId;
  const put = await finalPut(run, extra);

  if (!noted || !put) {
    const missing = [!noted ? 'la nota del aviso' : null, !put ? `«${SHIPPING_FIELD_NAMES.sentLog}», la etapa y vaciar ${TRIGGER}` : null].filter(Boolean);
    await attention(run, {
      headline: 'ATENCIÓN: el aviso salió, pero no quedó en Pipedrive.',
      details: [
        `Enviado el ${chileStamp(at)} (hora de Chile): ${p.data.carrier.label} ${p.data.order}, ${documentTitle(p.data.document)}.`,
        `Falta registrar a mano: ${missing.join(' y ')}.`,
        `En «${SHIPPING_FIELD_NAMES.sentLog}» va: ${sentLogValue(at, p.data)}`,
        'No vuelvas a elegir «Enviar al cliente» para esta orden: el correo ya salió.',
      ],
      email: p.email,
      task: { personId: p.data.personId, subject: 'ATENCIÓN aviso de despacho: registrar el envío en el negocio' },
    });
    return 'enviado_sin_registro';
  }
  return 'enviado';
}

/** Lo único que arma el valor de «Despacho · Aviso enviado» (formatSentLog, fields.ts). */
function sentLogValue(at: Date, data: ShippingFields): string {
  return formatSentLog(at, data.carrier, data.orderNormalized);
}
