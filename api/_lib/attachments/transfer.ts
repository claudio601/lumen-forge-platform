// api/_lib/attachments/transfer.ts
// ─────────────────────────────────────────────────────────────────────────────
// Traspaso de los adjuntos del cotizador: de Vercel Blob (privado, temporal) a la pestaña
// Archivos del negocio en Pipedrive. Lo usa api/project-quotes/create.ts después de
// responder (waitUntil) y el barrido diario (api/cron/blob-sweep.ts) para reintentar.
//
// Cada archivo, de a uno (especificación §2.5):
//   1. head(): que exista, pese 20 MB o menos, tenga menos de 2 horas y sea del tipo de su
//      extensión (create.ts lo hace antes del correo, para listar los pesos);
//   2. get(..., { access: 'private' });
//   3. los primeros bytes corresponden a la extensión (rules.ts, sniffType);
//   4. pipedriveUploadFile (POST /v1/files con `file` y `deal_id`);
//   5. del().
// Si un archivo falla, se borra igual (decisión D3) y la segunda nota y el correo a ventas
// dicen cuál falta. Si no queda tiempo en la función, el archivo queda en Blob con su clave
// «pendiente» y el barrido diario lo reintenta.
//
// Tiempo: cada paso recibe lo que queda hasta el plazo (`deadline`), medido justo antes de
// empezarlo: head() y get() dejan al menos 10 s para Pipedrive, y la subida a Pipedrive
// empieza solo si quedan 10 s. Lo que no alcanza queda «pendiente». Así la función nunca se
// corta a mitad de una subida (un archivo que Pipedrive alcanzó a guardar no se vuelve a subir).
//
// Cada archivo se reserva antes de traspasarlo (clave «pendiente» con SET NX, quota.ts): si
// el cliente reenvía mientras el primer traspaso sigue, el segundo no lo duplica.
//
// Los logs llevan la posición del archivo y un código de motivo: nunca el nombre ni la ruta.
// ─────────────────────────────────────────────────────────────────────────────

import { BlobNotFoundError, del, get, head } from '@vercel/blob';
import { pipedriveUploadFile } from '../pipedrive/client.js';
import { claimPending, markDone } from './quota.js';
import {
  ATTACHMENT_TYPES,
  MAX_FILE_BYTES,
  extLabel,
  formatBytes,
  matchesExtension,
  type AttachmentExt,
  type AttachmentRef,
} from './rules.js';

/**
 * maxDuration de api/project-quotes/create.ts en vercel.json. 60 s: el máximo de Hobby sin
 * Fluid compute (no se pudo confirmar si está activo). Si se activa, subirlo a 120 en los
 * dos lugares (transfer.test.ts revisa que coincidan).
 */
export const CREATE_MAX_DURATION_S = 60;
/** Al final de la función quedan 10 s para la nota y el correo de fallas. */
const END_MARGIN_MS = 10_000;
/** Un archivo empieza solo si quedan al menos 15 s (uno de 20 MB, de Blob a Pipedrive). */
export const MIN_FILE_WINDOW_MS = 15_000;
/** La subida a Pipedrive empieza solo si quedan al menos 10 s; head() y get() se los dejan. */
const MIN_UPLOAD_WINDOW_MS = 10_000;
/** Pipedrive: 60 s por archivo como máximo. */
const UPLOAD_TIMEOUT_MS = 60_000;
const HEAD_TIMEOUT_MS = 4_000;
const GET_TIMEOUT_MS = 20_000;
/** Un archivo subido hace más de 2 horas no se adjunta a una solicitud nueva. */
export const MAX_UPLOAD_AGE_MS = 2 * 3600_000;

/** Hasta cuándo puede seguir el traspaso de una solicitud que llegó en `startedAt`. */
export const transferDeadline = (startedAt: number) => startedAt + CREATE_MAX_DURATION_S * 1000 - END_MARGIN_MS;

export interface BlobMeta {
  url: string;
  size: number;
  uploadedAt: Date;
  contentType: string;
}

export interface InspectedAttachment extends AttachmentRef {
  /** Metadatos de Blob; null si no existe; undefined si Blob no respondió. */
  blob: BlobMeta | null | undefined;
}

/**
 * attached: quedó en Archivos; missing: ya no está en Blob; failed: no se pudo (se borró, D3);
 * pending: sin tiempo, queda en Blob para el barrido; busy: otro traspaso lo tiene reservado.
 */
export type OutcomeStatus = 'attached' | 'missing' | 'failed' | 'pending' | 'busy';

export type FailureCode =
  | 'too_big'
  | 'too_old'
  | 'bad_type'
  | 'bad_content'
  | 'read_failed'
  | 'pipedrive_size'
  | 'pipedrive'
  | 'not_retried';

export interface TransferOutcome {
  nombre: string;
  ext: AttachmentExt;
  status: OutcomeStatus;
  code?: FailureCode;
}

const errorName = (err: unknown) => (err instanceof Error ? err.constructor.name || err.name : typeof err);

async function headMeta(pathname: string, timeoutMs = HEAD_TIMEOUT_MS): Promise<BlobMeta | null | undefined> {
  try {
    const h = await head(pathname, { abortSignal: AbortSignal.timeout(timeoutMs) });
    return { url: h.url, size: h.size, uploadedAt: new Date(h.uploadedAt), contentType: h.contentType };
  } catch (err) {
    return err instanceof BlobNotFoundError ? null : undefined;
  }
}

/** head() de cada referencia, en paralelo: existencia, peso, fecha y tipo. Nunca lanza. */
export async function inspectAttachments(refs: AttachmentRef[]): Promise<InspectedAttachment[]> {
  return Promise.all(refs.map(async (ref) => ({ ...ref, blob: await headMeta(ref.pathname) })));
}

/** Lista de la nota principal y del correo: nombre y peso (si Blob respondió). */
export function attachmentListLines(items: InspectedAttachment[], discarded = 0): string[] {
  const lines: string[] = [];
  if (items.length) {
    const names = items.map((i) => (i.blob ? `${i.nombre} (${formatBytes(i.blob.size)})` : i.nombre));
    lines.push(
      `Archivos que envió el cliente (${items.length}): ${names.join(', ')}. Quedan en la pestaña Archivos del negocio.`
    );
  }
  if (discarded > 0) {
    lines.push(
      discarded === 1
        ? 'Se descartó 1 referencia de archivo no válida.'
        : `Se descartaron ${discarded} referencias de archivo no válidas.`
    );
  }
  return lines;
}

/** Lee todo el archivo, hasta `max` bytes; null si pesa más. */
async function readAll(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/**
 * Borra de Blob sin lanzar (un error queda en el log, sin rutas; el barrido limpia después).
 * true si Blob confirmó el borrado.
 */
export async function deleteFromBlob(urlsOrPathnames: string[], log: string): Promise<boolean> {
  if (!urlsOrPathnames.length) return true;
  try {
    await del(urlsOrPathnames);
    return true;
  } catch (err) {
    console.warn(`${log} Blob del() FAIL (${urlsOrPathnames.length}) | ${errorName(err)}`);
    return false;
  }
}

function checkMeta(meta: BlobMeta, ext: AttachmentExt, maxAgeMs: number, now: number): FailureCode | null {
  if (meta.size > MAX_FILE_BYTES) return 'too_big';
  if (now - meta.uploadedAt.getTime() > maxAgeMs) return 'too_old';
  if (meta.contentType !== ATTACHMENT_TYPES[ext]) return 'bad_type';
  return null;
}

/**
 * Traspasa un archivo y lo borra de Blob (adjuntado o no). Antes de borrar, marca su clave
 * «pendiente» como terminada, así el barrido no lo reintenta. Si no alcanza el tiempo hasta
 * `deadline` (o algo falla cuando ya no queda tiempo), no lo borra: queda «pendiente» para el
 * barrido. Nunca lanza.
 */
export async function transferOne(
  item: InspectedAttachment,
  {
    dealId,
    deadline,
    maxAgeMs = MAX_UPLOAD_AGE_MS,
    now = Date.now(),
  }: { dealId: number; deadline: number; maxAgeMs?: number; now?: number }
): Promise<TransferOutcome> {
  const outcome = (status: OutcomeStatus, code?: FailureCode): TransferOutcome =>
    code ? { nombre: item.nombre, ext: item.ext, status, code } : { nombre: item.nombre, ext: item.ext, status };
  /** Lo que queda hasta el plazo, medido ahora. */
  const left = () => deadline - Date.now();

  let meta = item.blob;
  if (meta === undefined) {
    const headMs = Math.min(HEAD_TIMEOUT_MS, left() - MIN_UPLOAD_WINDOW_MS);
    if (headMs < 1_000) return outcome('pending');
    meta = await headMeta(item.pathname, headMs);
  }
  if (meta === null) return outcome('missing');

  let result: TransferOutcome;
  try {
    const invalid = meta === undefined ? 'read_failed' : checkMeta(meta, item.ext, maxAgeMs, now);
    if (invalid) {
      result = outcome('failed', invalid);
    } else {
      const getMs = Math.min(GET_TIMEOUT_MS, left() - MIN_UPLOAD_WINDOW_MS);
      if (getMs < 1_000) return outcome('pending');
      const got = await get(item.pathname, { access: 'private', abortSignal: AbortSignal.timeout(getMs) });
      if (!got || got.statusCode !== 200 || !got.stream) {
        result = got === null ? outcome('missing') : outcome('failed', 'read_failed');
      } else {
        const data = await readAll(got.stream, MAX_FILE_BYTES);
        if (!data) {
          result = outcome('failed', 'too_big');
        } else if (!matchesExtension(data, item.ext)) {
          result = outcome('failed', 'bad_content');
        } else {
          // El tiempo de Pipedrive se mide recién ahora, después de leer el archivo
          const uploadMs = Math.min(UPLOAD_TIMEOUT_MS, left());
          if (uploadMs < MIN_UPLOAD_WINDOW_MS) return outcome('pending');
          const up = await pipedriveUploadFile({
            dealId,
            fileName: item.nombre,
            contentType: ATTACHMENT_TYPES[item.ext],
            data,
            timeoutMs: uploadMs,
          });
          result = up.success
            ? outcome('attached')
            : outcome('failed', /^HTTP 413\b/.test(up.error ?? '') ? 'pipedrive_size' : 'pipedrive');
        }
      }
    }
  } catch {
    // La lectura se cortó: si ya no queda tiempo, lo más probable es el límite de la función
    // (queda pendiente para el barrido); si queda, es una falla de Blob.
    if (left() < MIN_FILE_WINDOW_MS) return outcome('pending');
    result = outcome('failed', 'read_failed');
  }

  await markDone(item.pathname);
  if (result.status !== 'missing') await deleteFromBlob([meta?.url ?? item.pathname], '[Adjuntos]');
  return result;
}

/**
 * Traspasa los archivos de una solicitud al negocio, de a uno. Antes reserva todos (clave
 * «pendiente» con el negocio, SET NX): lo que otro traspaso ya tiene reservado no se toca
 * ('busy'), y lo que no alcance a terminar queda para el barrido. Un archivo que ya no cabe
 * en el tiempo de la función queda en Blob como pendiente. Nunca lanza.
 */
export async function transferAttachments(
  items: InspectedAttachment[],
  { dealId, deadline, log }: { dealId: number; deadline: number; log: string }
): Promise<TransferOutcome[]> {
  const present = items.filter((i) => i.blob !== null).map((i) => i.pathname);
  const claims = present.length ? await claimPending(present, dealId) : new Map<string, string>();
  if ([...claims.values()].includes('error')) {
    console.warn(`${log} Adjuntos: Redis no guardó las claves pendientes (sin reintento del barrido)`);
  }

  const outcomes: TransferOutcome[] = [];
  for (const [index, item] of items.entries()) {
    const label = `${log} Adjunto ${index + 1}/${items.length}`;
    if (claims.get(item.pathname) === 'taken') {
      outcomes.push({ nombre: item.nombre, ext: item.ext, status: 'busy' });
      console.warn(`${label} busy: reservado por otro envío | dealId: ${dealId}`);
      continue;
    }
    if (item.blob !== null && deadline - Date.now() < MIN_FILE_WINDOW_MS) {
      outcomes.push({ nombre: item.nombre, ext: item.ext, status: 'pending' });
      console.warn(`${label} pendiente: sin tiempo en la función (lo reintenta el barrido)`);
      continue;
    }
    const result = await transferOne(item, { dealId, deadline });
    outcomes.push(result);
    if (result.status === 'attached') console.log(`${label} OK | dealId: ${dealId}`);
    else console.warn(`${label} ${result.status}${result.code ? ': ' + result.code : ''} | dealId: ${dealId}`);
  }
  return outcomes;
}

/** Motivo de una falla, para la nota y el correo a ventas. */
export function failureText(code: FailureCode, ext: AttachmentExt): string {
  switch (code) {
    case 'too_big':
      return 'pesa más de 20 MB';
    case 'too_old':
      return 'venció: se subió hace más de 2 horas';
    case 'bad_type':
      return 'no es un tipo de archivo permitido';
    case 'bad_content':
      return `no es un ${extLabel(ext)} válido`;
    case 'pipedrive_size':
      return 'Pipedrive lo rechazó por su tamaño';
    case 'pipedrive':
      return 'Pipedrive no lo aceptó';
    case 'not_retried':
      return 'quedó pendiente y venció antes de poder reintentarlo';
    case 'read_failed':
    default:
      return 'no se pudo leer del almacenamiento temporal';
  }
}

/**
 * Segunda nota (y correo a ventas) cuando no todo quedó en Archivos; null si todo quedó.
 *   «Adjuntos: 2 de 3 quedaron en Archivos.»
 *   «No se pudo adjuntar "plano.dwg" (no es un DWG válido). Pedirlo al cliente por correo.»
 */
export function transferReport(outcomes: TransferOutcome[]): { lines: string[]; needsFollowUp: boolean } | null {
  if (!outcomes.length || outcomes.every((o) => o.status === 'attached')) return null;
  const attached = outcomes.filter((o) => o.status === 'attached').length;
  const failed = outcomes.filter((o) => o.status === 'failed');
  const pending = outcomes.filter((o) => o.status === 'pending');
  const missing = outcomes.filter((o) => o.status === 'missing');
  const busy = outcomes.filter((o) => o.status === 'busy');

  const lines = [`Adjuntos: ${attached} de ${outcomes.length} quedaron en Archivos.`];
  const failures = failed.map((o) => `No se pudo adjuntar "${o.nombre}" (${failureText(o.code ?? 'read_failed', o.ext)}).`);
  if (failures.length === 1) lines.push(failures[0] + ' Pedirlo al cliente por correo.');
  else if (failures.length > 1) lines.push(...failures, 'Pedirlos al cliente por correo.');
  for (const o of pending) {
    lines.push(
      `"${o.nombre}" quedó pendiente (no alcanzó el tiempo de la solicitud): el barrido diario lo reintenta. ` +
        'Si mañana no aparece en Archivos, pedirlo al cliente por correo.'
    );
  }
  for (const o of missing) lines.push(`"${o.nombre}": ya adjuntado en el envío anterior o vencido.`);
  for (const o of busy) lines.push(`"${o.nombre}": ya adjuntado en el envío anterior o en curso.`);
  return { lines, needsFollowUp: failed.length > 0 || pending.length > 0 };
}
