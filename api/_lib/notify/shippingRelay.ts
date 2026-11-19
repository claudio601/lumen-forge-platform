// api/_lib/notify/shippingRelay.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cliente del relay del aviso de despacho (spec Nivel 2, §3 prerrequisito 3, §7 y §8):
// una aplicación web de Apps Script en la cuenta Workspace del dueño
// (apps-script/aviso-despacho/Code.gs) que envía el correo al cliente, o la vista previa
// solo al dueño.
//
// Protocolo (el mismo que lee Code.gs):
//   - POST a SHIPPING_RELAY_URL (la URL /exec) con un cuerpo JSON `{ ts, payload, sig }`.
//     doPost no lee cabeceras, así que la firma viaja en el cuerpo;
//   - `ts`: segundos Unix (entero). El relay rechaza más de 5 minutos de diferencia;
//   - `payload`: el pedido como texto JSON, solo ASCII (lo que no es ASCII va como \uXXXX):
//     `{ v: 1, action, key, to (solo en despacho), subject, html, text,
//        attachments: [{ name, mimeType, data (base64) }] }`;
//   - `sig`: HMAC-SHA256 en hex de `${ts}.${payload}`, con SHIPPING_RELAY_SECRET como clave.
//   El payload va solo en ASCII para que la firma no dependa de cómo decodifique Apps Script
//   el cuerpo: JSON.parse recupera los caracteres.
//   La vista previa no lleva el correo del cliente: el relay la envía solo a OWNER_EMAIL.
//
// Respuestas del relay: `{ status: 'ok' | 'duplicate' | 'quota' }`, `duplicate` con
// `reason: 'reenvio'` (el mismo cuerpo firmado llegó otra vez), `{ status: 'uncertain',
// reason: 'pendiente' }` (una ejecución anterior reservó la clave y no confirmó el envío) o
// `{ status: 'rejected', reason: <código> }`. Apps Script responde con una redirección 302 a
// script.googleusercontent.com, que fetch sigue (como salesEmail.ts).
//
// Resultado (nunca lanza):
//   - ok / duplicate: el correo salió ahora o ya había salido con esa clave (o con ese mismo
//     cuerpo: `reason` «reenvío del mismo cuerpo firmado»);
//   - quota / rejected / config: no salió (config: faltan las variables del servidor;
//     rejected «el relay no pudo reservar la clave»: almacenamiento del relay lleno);
//   - uncertain: no se sabe. Plazo agotado, error de red, una clave que quedó pendiente en el
//     relay (revisar Enviados) o una respuesta que no es del relay, salvo la página de inicio
//     de sesión de Google o un 401/403/404, que prueban que el script no corrió (rejected).
//     Quien llama no reintenta solo. El relay reserva la clave antes de enviar: si el correo
//     había salido, el reintento del dueño responde `duplicate` (o `uncertain` si la ejecución
//     anterior se cortó en el envío), nunca un segundo correo.
//
// Registros: solo la acción, el resultado, el motivo clasificado y los primeros 8 caracteres
// de la clave, pasados por redact (api/_lib/logging/redact.ts, «Shipping relay: …»). Nunca el
// destinatario, el asunto, el cuerpo, los adjuntos ni el texto que devuelva el relay.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac } from 'node:crypto';
import { sniffType } from '../attachments/rules.js';
import { SHIPPING_RELAY_REASONS, redact } from '../logging/redact.js';
import { SHIPPING_NOTICE_KEY_RE, shortKey } from '../shipping/key.js';

/** Plazo máximo de la llamada al relay (spec §3, paso 5). */
export const SHIPPING_RELAY_TIMEOUT_MS = 30_000;
/** Versión del protocolo: Code.gs rechaza otra. */
export const SHIPPING_RELAY_PROTOCOL_VERSION = 1;
/** Topes que también aplica Code.gs. */
export const MAX_RELAY_ATTACHMENTS = 2;
export const MAX_RELAY_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_RELAY_SUBJECT = 250;
export const MAX_RELAY_BODY_CHARS = 200_000;
/** Un secreto más corto no sirve (openssl rand -hex 32 da 64 caracteres). */
export const MIN_RELAY_SECRET_LENGTH = 32;

const LOG = '[aviso-despacho]';

export type ShippingRelayAction = 'preview' | 'despacho';
export type ShippingAttachmentMimeType = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface ShippingAttachment {
  /** Nombre que ve el cliente, con la extensión del tipo (p. ej. «Factura-1234.pdf»). */
  name: string;
  mimeType: ShippingAttachmentMimeType;
  data: Buffer;
}

export interface ShippingNoticeRequest {
  action: ShippingRelayAction;
  /** shippingNoticeKey (api/_lib/shipping/key.ts): 64 caracteres hex. */
  key: string;
  /** Correo del cliente. Solo en `despacho`: la vista previa va a OWNER_EMAIL y no lo lleva. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Hasta 2: la factura y, si hay, el comprobante. */
  attachments: ShippingAttachment[];
}

export interface ShippingRelayOptions {
  /** Plazo de quien llama; se usa el menor entre este y 30 s. */
  timeoutMs?: number;
  /** Corte de quien llama (p. ej. el plazo de la función). */
  signal?: AbortSignal;
  /** Reloj en ms (pruebas). */
  now?: () => number;
}

type FixedReason = (typeof SHIPPING_RELAY_REASONS)[number];

export type ShippingRelayResult =
  | { status: 'ok' | 'quota' }
  /** `reason` solo si el relay lo dice (el mismo cuerpo firmado otra vez): igual ya había salido. */
  | { status: 'duplicate'; reason?: string }
  /** `reason`: motivo clasificado (lista de redact.ts), apto para el log y la nota. */
  | { status: 'rejected' | 'uncertain' | 'config'; reason: string };

const ACTIONS: readonly ShippingRelayAction[] = ['preview', 'despacho'];

/** Extensión y primeros bytes de cada tipo (sniffType, api/_lib/attachments/rules.ts). */
const ATTACHMENT_RULES: Record<ShippingAttachmentMimeType, { ext: RegExp; sniffed: string }> = {
  'application/pdf': { ext: /\.pdf$/i, sniffed: 'pdf' },
  'image/jpeg': { ext: /\.jpe?g$/i, sniffed: 'jpg' },
  'image/png': { ext: /\.png$/i, sniffed: 'png' },
};

/** Códigos que responde Code.gs en `reason`, con su motivo. Lo demás: «motivo no reconocido». */
const RELAY_REASONS = new Map<string, FixedReason>([
  ['reenvio', 'reenvío del mismo cuerpo firmado'],
  ['pendiente', 'clave pendiente en el relay (revisar Enviados)'],
  ['almacenamiento', 'el relay no pudo reservar la clave'],
  ['json', 'cuerpo no válido'],
  ['firma', 'firma no válida'],
  ['hora', 'hora fuera de rango'],
  ['version', 'versión no soportada'],
  ['accion', 'acción no válida'],
  ['clave', 'clave no válida'],
  ['para', 'destinatario no válido'],
  ['asunto', 'asunto no válido'],
  ['texto', 'texto del correo no válido'],
  ['adjuntos', 'adjuntos no válidos'],
  ['config', 'falta configuración en el relay'],
  ['ocupado', 'relay ocupado'],
  ['envio', 'Gmail no aceptó el envío'],
  ['interno', 'error interno del relay'],
]);

/** Un solo correo, sin nombre visible ni separadores (coma, punto y coma, espacios). */
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** Nombre de adjunto: sin caracteres de control ni separadores de ruta. */
const ATTACHMENT_NAME_RE = /^[^\p{Cc}\\/:*?"<>|]{1,120}$/u;
/**
 * Google pidió iniciar sesión: fetch siguió la redirección a accounts.google.com, así que el
 * script no corrió (el acceso no es «Cualquier persona»). Se mira la URL final y no el HTML:
 * una página de error de Google también puede traer un enlace para iniciar sesión.
 */
const GOOGLE_LOGIN_URL_RE = /^https:\/\/accounts\.google\.com\//;

const rejected = (reason: FixedReason | string): ShippingRelayResult => ({ status: 'rejected', reason });

export function isValidRelayEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

/** JSON solo en ASCII: lo demás como \uXXXX (también cada mitad de un par sustituto). */
export function asciiJson(value: unknown): string {
  // JSON.stringify ya escribe los caracteres de control como \n, \t...: basta lo imprimible.
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** HMAC-SHA256 en hex de `${ts}.${payload}`: el mismo cálculo que `firmar` en Code.gs. */
export function signShippingPayload(secret: string, ts: number, payload: string): string {
  return createHmac('sha256', secret).update(`${ts}.${payload}`, 'utf8').digest('hex');
}

/** El pedido como lo lee Code.gs. La vista previa no lleva `to`. */
export function buildShippingPayload(req: ShippingNoticeRequest): string {
  return asciiJson({
    v: SHIPPING_RELAY_PROTOCOL_VERSION,
    action: req.action,
    key: req.key,
    ...(req.action === 'despacho' ? { to: req.to } : {}),
    subject: req.subject,
    html: req.html,
    text: req.text,
    attachments: req.attachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      // Sin copiar los bytes (hasta 10 MB): una vista del mismo búfer.
      data: Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength).toString('base64'),
    })),
  });
}

/** Cuerpo del POST: `{ ts, payload, sig }`. */
export function buildRelayBody(req: ShippingNoticeRequest, secret: string, ts: number): string {
  const payload = buildShippingPayload(req);
  return JSON.stringify({ ts, payload, sig: signShippingPayload(secret, ts, payload) });
}

/** Lo mismo que revisa Code.gs, para no llamar al relay con un pedido que va a rechazar. */
export function validateShippingRequest(req: unknown): FixedReason | null {
  if (!req || typeof req !== 'object') return 'acción no válida';
  const r = req as Partial<Record<keyof ShippingNoticeRequest, unknown>>;
  if (!ACTIONS.includes(r.action as ShippingRelayAction)) return 'acción no válida';
  if (typeof r.key !== 'string' || !SHIPPING_NOTICE_KEY_RE.test(r.key)) return 'clave no válida';
  if (r.action === 'despacho' && !isValidRelayEmail(r.to)) return 'destinatario no válido';
  if (typeof r.subject !== 'string' || !r.subject.trim() || r.subject.length > MAX_RELAY_SUBJECT || /[\r\n]/.test(r.subject)) {
    return 'asunto no válido';
  }
  for (const body of [r.html, r.text]) {
    if (typeof body !== 'string' || !body.trim() || body.length > MAX_RELAY_BODY_CHARS) return 'texto del correo no válido';
  }
  if (!Array.isArray(r.attachments) || r.attachments.length > MAX_RELAY_ATTACHMENTS) return 'adjuntos no válidos';
  let total = 0;
  for (const a of r.attachments as unknown[]) {
    const att = a as Partial<ShippingAttachment> | null;
    const rule = att && Object.hasOwn(ATTACHMENT_RULES, att.mimeType as string)
      ? ATTACHMENT_RULES[att.mimeType as ShippingAttachmentMimeType]
      : undefined;
    if (!rule || typeof att.name !== 'string' || !ATTACHMENT_NAME_RE.test(att.name) || !rule.ext.test(att.name)) {
      return 'adjuntos no válidos';
    }
    if (!(att.data instanceof Uint8Array) || att.data.length === 0 || sniffType(att.data) !== rule.sniffed) {
      return 'adjuntos no válidos';
    }
    total += att.data.length;
  }
  if (total > MAX_RELAY_ATTACHMENT_BYTES) return 'adjuntos no válidos';
  return null;
}

/** URL y secreto del relay, o el motivo por el que faltan. */
function relayConfig(): { url: string; secret: string } | { reason: FixedReason } {
  const url = (process.env.SHIPPING_RELAY_URL ?? '').trim();
  if (!url) return { reason: 'falta SHIPPING_RELAY_URL' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reason: 'SHIPPING_RELAY_URL no válida' };
  }
  // https siempre; http solo hacia la propia máquina (las pruebas usan un puerto muerto).
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return { reason: 'SHIPPING_RELAY_URL no válida' };
  const secret = (process.env.SHIPPING_RELAY_SECRET ?? '').trim();
  if (!secret) return { reason: 'falta SHIPPING_RELAY_SECRET' };
  if (secret.length < MIN_RELAY_SECRET_LENGTH) return { reason: 'SHIPPING_RELAY_SECRET demasiado corto' };
  return { url: parsed.href, secret };
}

/** Plazo agotado o error de red: motivo sin detalles del servidor (como failureReason de salesEmail.ts). */
function transportReason(err: unknown, signal: AbortSignal): string {
  const name = err instanceof Error ? err.name : typeof err;
  if (signal.aborted || name === 'TimeoutError' || name === 'AbortError') return 'sin respuesta a tiempo';
  // fetch de Node: TypeError('fetch failed') con un código en la causa (ECONNREFUSED…)
  const code = err instanceof Error ? (err.cause as { code?: unknown } | undefined)?.code : undefined;
  const codeLabel = typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code) ? ', ' + code : '';
  const nameLabel = ['Error', 'TypeError', 'SyntaxError'].includes(name) ? name : 'error';
  return 'error de red (' + nameLabel + codeLabel + ')';
}

/** Motivo de un código de rechazo de Code.gs; uno desconocido no se repite. */
export function relayReason(code: unknown): FixedReason {
  return (typeof code === 'string' && RELAY_REASONS.get(code)) || 'motivo no reconocido';
}

/** Clasifica la respuesta. Nunca supone que el correo salió si no lo dice el relay. */
function classify(response: Response, text: string): ShippingRelayResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const { status, reason } = parsed as { status?: unknown; reason?: unknown };
    if (status === 'ok' || status === 'quota') return { status };
    if (status === 'duplicate') return reason === undefined ? { status } : { status, reason: relayReason(reason) };
    if (status === 'rejected') return rejected(relayReason(reason));
    // El relay no sabe si salió (clave pendiente de una ejecución que se cortó): no se reintenta.
    if (status === 'uncertain') return { status, reason: relayReason(reason) };
    // JSON que no es del protocolo (otra versión del script, un proxy): no se sabe si salió.
    return { status: 'uncertain', reason: 'status no reconocido' };
  }

  if (GOOGLE_LOGIN_URL_RE.test(response.url ?? '')) return rejected('página de inicio de sesión de Google');
  const code = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 500;
  const reason = 'respuesta no JSON (HTTP ' + code + ')';
  // 401, 403 y 404: sin acceso o sin esa implementación, el script no corrió. Lo demás (una
  // página de error del script, un 302 sin seguir, un 5xx) puede llegar después del envío.
  return [401, 403, 404].includes(code) ? rejected(reason) : { status: 'uncertain', reason };
}

async function callRelay(req: ShippingNoticeRequest, opts: ShippingRelayOptions): Promise<ShippingRelayResult> {
  const config = relayConfig();
  if ('reason' in config) return { status: 'config', reason: config.reason };

  const invalid = validateShippingRequest(req);
  if (invalid) return rejected(invalid);

  const timeoutMs = Math.min(SHIPPING_RELAY_TIMEOUT_MS, opts.timeoutMs ?? SHIPPING_RELAY_TIMEOUT_MS);
  if (!(timeoutMs > 0) || opts.signal?.aborted) return rejected('sin plazo para llamar al relay');
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;

  const ts = Math.floor((opts.now ?? Date.now)() / 1000);
  const body = buildRelayBody(req, config.secret, ts);

  let response: Response;
  let text: string;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      // Apps Script responde 302 a script.googleusercontent.com con el resultado.
      redirect: 'follow',
      signal,
    });
    text = await response.text();
  } catch (err) {
    return { status: 'uncertain', reason: transportReason(err, signal) };
  }
  return classify(response, text);
}

/** Línea de log: acción, clave corta, estado y motivo, pasados por redact. */
function logResult(req: unknown, result: ShippingRelayResult): void {
  const r = (req && typeof req === 'object' ? req : {}) as Partial<ShippingNoticeRequest>;
  const action = ACTIONS.includes(r.action as ShippingRelayAction) ? r.action : 'acción-desconocida';
  const message = 'Shipping relay: status ' + result.status + ('reason' in result ? ': ' + result.reason : '');
  const line = LOG + ' ' + action + ' ' + shortKey(r.key) + ' ' + redact(message, 'error');
  if (result.status === 'ok' || result.status === 'duplicate') console.log(line);
  else console.warn(line);
}

/**
 * Envía el aviso (o la vista previa) por el relay de Apps Script. Nunca lanza: devuelve el
 * resultado clasificado y deja una línea en el log sin datos del cliente.
 */
export async function sendShippingNotice(
  req: ShippingNoticeRequest,
  opts: ShippingRelayOptions = {},
): Promise<ShippingRelayResult> {
  let result: ShippingRelayResult;
  try {
    result = await callRelay(req, opts);
  } catch {
    // No debería pasar (todo lo anterior está validado). Por las dudas, no se supone nada.
    result = { status: 'uncertain', reason: 'motivo no reconocido' };
  }
  logResult(req, result);
  return result;
}
