// api/cron/blob-sweep.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cron/blob-sweep — barrido diario de los adjuntos del cotizador en Vercel Blob
// (especificación «Adjuntar archivos», §2.8, y decisión D2 del dueño).
//
// Lo llama el cron de Vercel una vez al día (vercel.json → crons), solo en producción. Exige
// `Authorization: Bearer <CRON_SECRET>` (Vercel lo manda solo si CRON_SECRET existe); sin el
// secreto configurado responde 401 a todo. El almacén es el mismo para las previews y
// producción, así que también limpia las pruebas. El cron de Vercel puede llamar dos veces la
// misma ejecución: un candado en Redis (5 minutos) deja correr solo una.
//
// Orden (lo que protege la cuota y el plazo de la Política va primero, los reintentos al final):
//   1. Lista cotizador/ (de a 1.000, con cursor) y lee las claves «pendiente» (ruta → negocio,
//      quota.ts) de lo que tenga más de 1 hora, con MGET de a 50 en paralelo.
//   2. Borra lo que tenga 23 h o más. Con la hora variable del cron de Hobby (±59 min), un
//      huérfano vive menos de 48 h. Un pendiente que llega a esa edad sin reintento se borra
//      igual y la nota del negocio lo dice (D3).
//   3. Suma lo que queda, más lo que no se pudo borrar, y lo deja en Redis
//      (STORED_BYTES_KEY). Es el techo del permiso de subida (700 MB) y su señal de que
//      el barrido corre (en producción, sin esa clave no hay permisos).
//   4. Reintenta los pendientes de 1 h a 23 h (la función de create.ts se cortó): hasta 3, y
//      cada uno solo si quedan 30 s; cada paso recibe lo que queda hasta el plazo (60 s del
//      maxDuration menos 10 s para las notas y el correo). Pipedrive lo recibe con el nombre
//      «archivo-<8 caracteres>.<ext>»: el nombre original está en la nota principal (no se
//      guarda en Redis, porque podría traer datos del cliente). Lo que no alcanza se borra en
//      el barrido siguiente, con su nota.
//   5. Una nota por negocio dice cómo terminó. Un correo a ventas avisa si un reintento falló,
//      si el almacén llegó al techo, si algo no se pudo borrar o si Redis no guardó el total.
//      Si el barrido entero falla (500), también avisa.
//
// Los logs llevan solo cantidades y pesos: nunca rutas ni nombres de archivo.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { list, type ListBlobResultBlob } from '@vercel/blob';
import { pipedrivePost } from '../_lib/pipedrive/client.js';
import { notifySales } from '../_lib/notify/salesEmail.js';
import { SITE_URL } from '../_lib/site.js';
import { UPLOAD_PREFIX, pathnameExt, type AttachmentExt } from '../_lib/attachments/rules.js';
import {
  PENDING_TTL_S,
  STORED_CEILING_BYTES,
  acquireSweepLock,
  blobStoreConfigured,
  markDone,
  readPendingMany,
  recordStoredBytes,
} from '../_lib/attachments/quota.js';
import { deleteFromBlob, transferOne, transferReport, type TransferOutcome } from '../_lib/attachments/transfer.js';

const LOG = '[BlobSweep]';

/** 23 h: con la hora variable del cron de Hobby (±59 min), un huérfano vive menos de 48 h. */
export const DELETE_AFTER_MS = 23 * 3600_000;
export const RETRY_AFTER_MS = 3600_000;
export const MAX_RETRIES_PER_RUN = 3;
/** maxDuration del barrido en vercel.json (blob-sweep.test.ts revisa que coincidan). */
export const SWEEP_MAX_DURATION_S = 60;
/** Al final quedan 10 s para las notas y el correo. */
const END_MARGIN_MS = 10_000;
/** Un reintento empieza solo si quedan al menos 30 s hasta el plazo. */
export const MIN_RETRY_WINDOW_MS = 30_000;
/** El candado dura más que la función: una llamada repetida del cron no corre de nuevo. */
const LOCK_TTL_S = 300;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 20;
const DELETE_BATCH = 100;

const SITE_HOST = new URL(SITE_URL).host;

/** «700 MB» */
const gb = (bytes: number) => Math.round(bytes / 1024 ** 2).toLocaleString('es-CL') + ' MB';

/** Nombre con que el reintento sube el archivo: «archivo-1a2b3c4d.dwg». */
export const retryFileName = (pathname: string, ext: AttachmentExt) =>
  `archivo-${pathname.slice(UPLOAD_PREFIX.length, UPLOAD_PREFIX.length + 8)}.${ext}`;

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers['authorization'];
  if (!secret || typeof header !== 'string') return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function listAll(): Promise<ListBlobResultBlob[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await list({ prefix: UPLOAD_PREFIX, limit: PAGE_LIMIT, cursor });
    blobs.push(...result.blobs);
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return blobs;
}

/** Nota del barrido en el negocio. */
function sweepNoteLines(outcomes: TransferOutcome[]): string[] {
  const report = transferReport(outcomes);
  return [
    'Barrido diario de adjuntos (archivos que quedaron pendientes en el envío):',
    ...(report ? report.lines : [`Adjuntos: ${outcomes.length} de ${outcomes.length} quedaron en Archivos.`]),
    'El nombre original de cada archivo está en la nota principal.',
  ];
}

/** Aviso del sitio a ventas@elights.cl (sin datos de clientes). */
function alertSales(lines: string[], asunto: string): Promise<boolean> {
  return notifySales(
    {
      modo: 'Aviso del sitio: archivos adjuntos',
      nombre: `Sitio ${SITE_HOST} (aviso automático)`,
      email: 'ventas@elights.cl',
      telefono: '-',
      cuerpo: [`Barrido diario de adjuntos del cotizador (${SITE_HOST})`, ...lines].join('\n'),
      total: '-',
      asunto,
    },
    LOG
  );
}

export interface SweepSummary {
  listed: number;
  deleted: number;
  undeleted: number;
  retried: number;
  storedBytes: number;
  ceilingReached: boolean;
}

export async function sweep(now: number = Date.now(), startedAt: number = Date.now()): Promise<SweepSummary> {
  const deadline = startedAt + SWEEP_MAX_DURATION_S * 1000 - END_MARGIN_MS;
  const blobs = await listAll();
  const ageOf = (blob: ListBlobResultBlob) => now - new Date(blob.uploadedAt).getTime();

  // 1. Claves «pendiente» de lo que tenga más de 1 hora
  const candidates = blobs.filter((b) => pathnameExt(b.pathname) && ageOf(b) >= RETRY_AFTER_MS);
  const pending = await readPendingMany(candidates.map((b) => b.pathname));
  if (!pending.ok) console.warn(`${LOG} Redis no respondió al leer los pendientes (sin reintentos)`);

  const byDeal = new Map<number, TransferOutcome[]>();
  const record = (dealId: number, outcome: TransferOutcome) => {
    const outcomes = byDeal.get(dealId) ?? [];
    outcomes.push(outcome);
    byDeal.set(dealId, outcomes);
  };

  // 2. Borrar lo de 23 h o más (un pendiente sin reintento: la nota lo dice)
  const old = blobs.filter((b) => ageOf(b) >= DELETE_AFTER_MS);
  const expired: string[] = [];
  for (const blob of old) {
    const dealId = pending.deals.get(blob.pathname);
    const ext = pathnameExt(blob.pathname);
    if (!dealId || !ext) continue;
    record(dealId, { nombre: retryFileName(blob.pathname, ext), ext, status: 'failed', code: 'not_retried' });
    expired.push(blob.pathname);
  }
  let deleted = 0;
  let undeleted = 0;
  let undeletedBytes = 0;
  for (let i = 0; i < old.length; i += DELETE_BATCH) {
    const batch = old.slice(i, i + DELETE_BATCH);
    if (await deleteFromBlob(batch.map((b) => b.url), LOG)) {
      deleted += batch.length;
    } else {
      undeleted += batch.length;
      undeletedBytes += batch.reduce((sum, b) => sum + b.size, 0);
    }
  }
  // Su nota sale una sola vez, aunque el borrado haya fallado
  await Promise.all(expired.map((p) => markDone(p)));

  // 3. Total guardado: lo nuevo y lo que no se pudo borrar
  const young = blobs.filter((b) => ageOf(b) < DELETE_AFTER_MS);
  const stored = young.reduce((sum, b) => sum + b.size, 0) + undeletedBytes;
  const recorded = await recordStoredBytes(stored);
  if (!recorded) console.warn(`${LOG} Redis no guardó el total (el permiso no ve el techo)`);
  const ceilingReached = stored >= STORED_CEILING_BYTES;

  // 4. Reintentos, con lo que quede de tiempo
  let retried = 0;
  for (const blob of young) {
    const dealId = pending.deals.get(blob.pathname);
    const ext = pathnameExt(blob.pathname);
    if (!dealId || !ext) continue;
    if (retried >= MAX_RETRIES_PER_RUN || deadline - Date.now() < MIN_RETRY_WINDOW_MS) break;
    retried++;
    // head() lo hace transferOne (blob: undefined): list() no trae el tipo.
    const outcome = await transferOne(
      { pathname: blob.pathname, nombre: retryFileName(blob.pathname, ext), ext, blob: undefined },
      { dealId, deadline, maxAgeMs: PENDING_TTL_S * 1000 }
    );
    // Sin tiempo: sigue pendiente y el barrido siguiente lo borra con su nota
    if (outcome.status !== 'pending') record(dealId, outcome);
  }

  // 5. Notas de cada negocio y aviso a ventas
  const followUp: string[] = [];
  for (const [dealId, outcomes] of byDeal) {
    const lines = sweepNoteLines(outcomes);
    try {
      const note = await pipedrivePost('/notes', { content: lines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), deal_id: dealId });
      if (!note.success) console.warn(`${LOG} Nota en Pipedrive FAIL | dealId: ${dealId}`);
    } catch {
      console.warn(`${LOG} Nota en Pipedrive FAIL | dealId: ${dealId}`);
    }
    if (transferReport(outcomes)?.needsFollowUp) followUp.push('', `Negocio ${dealId} en Pipedrive:`, ...lines.slice(1));
  }

  const alert: string[] = [];
  if (ceilingReached) {
    alert.push(
      `ALERTA: el almacenamiento temporal de archivos del cotizador tiene ${gb(stored)} (techo: ${gb(STORED_CEILING_BYTES)}).`,
      'Mientras siga sobre el techo, el sitio no recibe archivos adjuntos: las solicitudes llegan sin archivos y el formulario pide mandarlos a ventas@elights.cl.',
      'Revisar el almacén Blob en Vercel (Storage) y avisar a quien mantiene el sitio.'
    );
  }
  if (undeleted) {
    alert.push(
      `No se pudieron borrar ${undeleted} archivo(s) de más de 23 horas del almacenamiento temporal. El barrido de mañana lo reintenta; si se repite, avisar a quien mantiene el sitio.`
    );
  }
  if (!recorded) {
    alert.push(
      'Redis (Upstash) no guardó el total del almacenamiento temporal: si se repite 3 días seguidos, el sitio deja de recibir archivos adjuntos. Avisar a quien mantiene el sitio.'
    );
  }
  if (alert.length || followUp.length) {
    await alertSales(
      [...alert, ...followUp],
      ceilingReached ? 'ALERTA: adjuntos del sitio sobre el techo' : alert.length ? 'Adjuntos del sitio: revisar el barrido' : 'Adjuntos del sitio: revisar reintentos'
    );
  }

  const summary = { listed: blobs.length, deleted, undeleted, retried, storedBytes: stored, ceilingReached };
  console.log(
    `${LOG} Listados: ${summary.listed} | borrados: ${deleted}` + (undeleted ? ` | sin borrar: ${undeleted}` : '') +
      ` | reintentos: ${retried} | guardado: ${gb(stored)}` + (ceilingReached ? ' | SOBRE EL TECHO' : '')
  );
  return summary;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const startedAt = Date.now();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  if (!blobStoreConfigured()) {
    console.warn(`${LOG} Sin almacén Blob configurado: nada que barrer`);
    res.status(200).json({ ok: true, skipped: 'no_store' });
    return;
  }
  // Sin Redis el barrido corre igual (borrar es lo importante); con el candado tomado, no.
  if ((await acquireSweepLock(LOCK_TTL_S)) === 'busy') {
    console.warn(`${LOG} Otro barrido está corriendo: nada que hacer`);
    res.status(200).json({ ok: true, skipped: 'running' });
    return;
  }
  try {
    res.status(200).json({ ok: true, ...(await sweep(Date.now(), startedAt)) });
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name || err.name : typeof err;
    console.error(`${LOG} FAIL | ${name}`);
    await alertSales(
      [
        `ALERTA: el barrido diario de archivos adjuntos falló (${name}).`,
        'Los archivos que los clientes adjuntan pueden quedar más de 48 horas en el almacenamiento temporal. Revisar el registro de la función en Vercel y avisar a quien mantiene el sitio.',
      ],
      'ALERTA: falló el barrido de adjuntos del sitio'
    );
    res.status(500).json({ ok: false, error: 'Sweep failed' });
  }
}
