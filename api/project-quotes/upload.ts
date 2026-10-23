// api/project-quotes/upload.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/project-quotes/upload
//
// Permiso de subida de un archivo del cotizador (/cotizador) directo a Vercel Blob
// (especificación «Adjuntar archivos», §2.3). El navegador sube después de validateForm y
// de la casilla de privacidad, de a un archivo, con @vercel/blob/client; nunca si el
// honeypot tiene texto. El archivo pasa a Pipedrive en create.ts (transfer.ts).
//
// Revisiones, en orden:
//   1. Método (405 con Allow: POST) y origen (403 en producción, isAllowedOrigin).
//   2. Tipo de evento. Tres:
//      - 'blob.generate-presigned-url' (uploadPresigned → handleUploadPresigned, OIDC y sin
//        secretos: el método elegido);
//      - 'blob.generate-client-token' (upload → handleUpload, con BLOB_READ_WRITE_TOKEN:
//        la vuelta atrás si el presignado falla en la preview; cambia solo el navegador);
//      - 'elights.upload-status': consulta, sin sumar a los topes, si caben `files`
//        archivos y `bytes` hoy. El SDK del navegador no deja ver la respuesta del permiso,
//        así que el formulario pregunta antes para mostrar el mensaje del tope diario.
//   3. 15 permisos (y 15 consultas) por IP por hora (checkRateLimit, en memoria): 429.
//   4. El permiso vale solo para esa ruta (`cotizador/<uuid>.<ext>`, UPLOAD_PATHNAME_RE),
//      el tipo exacto de la extensión y como máximo el peso que declaró el navegador en
//      clientPayload ({"size": n}, nunca más de 20 MB); sin multipart: 400.
//   5. Sin almacén Blob configurado: 503 'unavailable' (el formulario sigue sin archivos).
//   6. Topes del sitio (D2, quota.ts): techo de lo guardado en Blob y 200 archivos / 1 GB
//      por día: 429 'daily_limit'. Redis caído: 503 'unavailable'.
//   7. Permiso con addRandomSuffix y validUntil a 10 minutos. El CDN de Blob rechaza lo
//      que no lo cumpla. Sin onUploadCompleted: ese aviso no llega a localhost ni a las
//      previews con SSO, y create.ts no lo necesita.
//
// Los logs llevan solo la extensión y el motivo: nunca el nombre del archivo, la ruta ni
// datos del cliente.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleUpload, handleUploadPresigned } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { checkRateLimit, getClientIp, isAllowedOrigin } from '../_lib/auth.js';
import { ATTACHMENT_TYPES, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, UPLOAD_PATHNAME_RE, type AttachmentExt } from '../_lib/attachments/rules.js';
import { blobStoreConfigured, checkCapacity, reserveUpload, type UnavailableCode } from '../_lib/attachments/quota.js';

const LOG = '[AttachmentUpload]';
const ALLOWED_METHODS = ['POST'];

export const PRESIGNED_EVENT = 'blob.generate-presigned-url';
export const CLIENT_TOKEN_EVENT = 'blob.generate-client-token';
export const STATUS_EVENT = 'elights.upload-status';

/** El permiso vence a los 10 minutos. */
export const PERMIT_TTL_MS = 10 * 60_000;
const RATE_LIMIT = { windowMs: 3600_000, maxRequests: 15 };

type Json = Record<string, unknown>;

function reply(res: VercelResponse, status: number, code: string, error: string) {
  res.status(status).json({ success: false, error, code });
}

function readBody(req: VercelRequest): Json | null {
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Json) : null;
}

/** Peso declarado por el navegador en clientPayload: {"size": n}. null si no es válido. */
function declaredSize(clientPayload: unknown): number | null {
  if (typeof clientPayload !== 'string' || clientPayload.length > 200) return null;
  try {
    const size = (JSON.parse(clientPayload) as { size?: unknown })?.size;
    return typeof size === 'number' && Number.isInteger(size) && size > 0 && size <= MAX_FILE_BYTES ? size : null;
  } catch {
    return null;
  }
}

/** Credenciales que necesita cada método del SDK (sin ellas, el SDK lanza). */
function methodConfigured(type: string): boolean {
  if (!blobStoreConfigured()) return false;
  if (type === PRESIGNED_EVENT) return Boolean(process.env.BLOB_WEBHOOK_PUBLIC_KEY);
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

const unavailableText = (code: UnavailableCode) =>
  code === 'daily_limit' ? 'Upload limit reached for today' : 'Uploads unavailable';

async function handleStatus(req: VercelRequest, res: VercelResponse, payload: Json): Promise<void> {
  if (!checkRateLimit('status:' + getClientIp(req), RATE_LIMIT).allowed) {
    reply(res, 429, 'rate_limited', 'Too many requests. Try again later.');
    return;
  }
  const files = payload.files;
  const bytes = payload.bytes;
  if (
    typeof files !== 'number' || !Number.isInteger(files) || files < 1 || files > MAX_FILES ||
    typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > MAX_TOTAL_BYTES
  ) {
    reply(res, 400, 'invalid_request', 'files must be 1 to 5 and bytes 1 to 100 MB');
    return;
  }
  if (!blobStoreConfigured()) {
    res.status(200).json({ available: false, code: 'unavailable' });
    return;
  }
  const capacity = await checkCapacity({ files, bytes });
  if (capacity.ok === false) {
    console.warn(`${LOG} Consulta: sin subida (${capacity.code})`);
    res.status(200).json({ available: false, code: capacity.code });
    return;
  }
  res.status(200).json({ available: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!ALLOWED_METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }
  if (!isAllowedOrigin(req)) {
    reply(res, 403, 'forbidden', 'Forbidden');
    return;
  }

  const body = readBody(req);
  const type = typeof body?.type === 'string' ? body.type : '';
  const payload = body?.payload && typeof body.payload === 'object' ? (body.payload as Json) : null;
  if (!payload || ![PRESIGNED_EVENT, CLIENT_TOKEN_EVENT, STATUS_EVENT].includes(type)) {
    reply(res, 400, 'invalid_request', 'Invalid request');
    return;
  }
  if (type === STATUS_EVENT) {
    await handleStatus(req, res, payload);
    return;
  }

  if (!checkRateLimit(getClientIp(req), RATE_LIMIT).allowed) {
    console.warn(`${LOG} Rate limit excedido`);
    reply(res, 429, 'rate_limited', 'Too many requests. Try again later.');
    return;
  }

  const pathname = typeof payload.pathname === 'string' ? payload.pathname : '';
  const match = UPLOAD_PATHNAME_RE.exec(pathname);
  if (!match) {
    reply(res, 400, 'invalid_pathname', 'pathname must be cotizador/<uuid>.<pdf|jpg|png|dwg|dxf|xlsx>');
    return;
  }
  const ext = match[1] as AttachmentExt;
  if (payload.multipart === true) {
    reply(res, 400, 'invalid_request', 'multipart uploads are not allowed');
    return;
  }
  const size = declaredSize(payload.clientPayload);
  if (size === null) {
    reply(res, 400, 'invalid_size', 'clientPayload must be {"size": n} with n from 1 byte to 20 MB');
    return;
  }

  if (!methodConfigured(type)) {
    console.warn(`${LOG} Sin almacén Blob configurado`);
    reply(res, 503, 'unavailable', unavailableText('unavailable'));
    return;
  }

  const capacity = await reserveUpload(size);
  if (capacity.ok === false) {
    console.warn(`${LOG} Permiso negado: ${capacity.code}`);
    reply(res, capacity.code === 'daily_limit' ? 429 : 503, capacity.code, unavailableText(capacity.code));
    return;
  }

  // El permiso: esa ruta, ese tipo y como máximo ese peso, por 10 minutos.
  const validUntil = Date.now() + PERMIT_TTL_MS;
  const constraints = { allowedContentTypes: [ATTACHMENT_TYPES[ext]], maximumSizeInBytes: size, validUntil };
  try {
    const result =
      type === PRESIGNED_EVENT
        ? await handleUploadPresigned({
            body: body as never,
            request: req,
            getSignedToken: async () => ({
              token: await issueSignedToken({ pathname, operations: ['put'], ...constraints }),
              urlOptions: { ...constraints, addRandomSuffix: true },
            }),
          })
        : await handleUpload({
            body: body as never,
            request: req,
            onBeforeGenerateToken: async () => ({ ...constraints, addRandomSuffix: true }),
          });
    console.log(`${LOG} Permiso OK | ${ext} | ${type === PRESIGNED_EVENT ? 'presignado' : 'token de cliente'}`);
    res.status(200).json(result);
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name || err.name : typeof err;
    console.error(`${LOG} Permiso FAIL | ${ext} | ${name}`);
    reply(res, 503, 'unavailable', unavailableText('unavailable'));
  }
}
