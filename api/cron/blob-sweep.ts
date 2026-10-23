// api/cron/blob-sweep.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cron/blob-sweep — barrido diario de los adjuntos del cotizador en Vercel Blob
// (especificación «Adjuntar archivos», §2.8, y decisión D2 del dueño).
//
// Lo llama el cron de Vercel una vez al día (vercel.json → crons), solo en producción. Exige
// `Authorization: Bearer <CRON_SECRET>` (Vercel lo manda solo si CRON_SECRET existe); sin el
// secreto configurado responde 401 a todo. El almacén es el mismo para las previews y
// producción, así que también limpia las pruebas.
//
//   1. Lista cotizador/ (de a 1.000, con cursor).
//   2. Reintento: un archivo de más de 1 hora que todavía tiene su clave «pendiente» (ruta →
//      negocio, quota.ts) quedó a medio traspasar porque la función se cortó. Se vuelve a
//      pasar a Pipedrive (transfer.ts), hasta 3 por barrido y dentro de los primeros 25 s, y
//      una nota en el negocio dice cómo terminó. Pipedrive lo recibe con el nombre
//      «archivo-<8 caracteres>.<ext>»: el nombre original está en la nota principal (no se
//      guarda en Redis, porque podría traer datos del cliente).
//   3. Borra lo que tenga más de 24 h (un huérfano vive como máximo unas 48 h). Un
//      pendiente que no alcanzó a reintentarse se borra igual y la nota lo dice (D3).
//   4. Suma lo que queda y lo deja en Redis (STORED_BYTES_KEY): el permiso de subida no
//      entrega permisos si llega al techo (unos 8 GB). Al llegar, avisa a ventas.
//   5. Si un reintento falló o el almacén llegó al techo, un correo a ventas lo dice.
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
  blobStoreConfigured,
  readPending,
  recordStoredBytes,
} from '../_lib/attachments/quota.js';
import { deleteFromBlob, transferOne, transferReport, type TransferOutcome } from '../_lib/attachments/transfer.js';

const LOG = '[BlobSweep]';

export const DELETE_AFTER_MS = 24 * 3600_000;
export const RETRY_AFTER_MS = 3600_000;
export const MAX_RETRIES_PER_RUN = 3;
export const RETRY_BUDGET_MS = 25_000;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 20;
const DELETE_BATCH = 100;

const SITE_HOST = new URL(SITE_URL).host;

/** «8,1 GB» */
const gb = (bytes: number) => String(Math.round((bytes / 1024 ** 3) * 10) / 10).replace('.', ',') + ' GB';

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

/** Nota del reintento en el negocio. */
function retryNoteLines(outcomes: TransferOutcome[]): string[] {
  const report = transferReport(outcomes);
  return [
    'Reintento del barrido diario (adjuntos que quedaron pendientes en el envío):',
    ...(report ? report.lines : [`Adjuntos: ${outcomes.length} de ${outcomes.length} quedaron en Archivos.`]),
    'El nombre original de cada archivo está en la nota principal.',
  ];
}

export interface SweepSummary {
  listed: number;
  deleted: number;
  retried: number;
  storedBytes: number;
  ceilingReached: boolean;
}

export async function sweep(now: number = Date.now()): Promise<SweepSummary> {
  const startedAt = Date.now();
  const blobs = await listAll();
  const toDelete: string[] = [];
  const byDeal = new Map<number, TransferOutcome[]>();
  let stored = 0;
  let retried = 0;

  for (const blob of blobs) {
    const age = now - new Date(blob.uploadedAt).getTime();
    const ext = pathnameExt(blob.pathname);
    if (ext && age >= RETRY_AFTER_MS) {
      const dealId = await readPending(blob.pathname);
      if (dealId) {
        const nombre = retryFileName(blob.pathname, ext);
        const outcomes = byDeal.get(dealId) ?? [];
        byDeal.set(dealId, outcomes);
        if (retried < MAX_RETRIES_PER_RUN && Date.now() - startedAt < RETRY_BUDGET_MS) {
          retried++;
          // head() lo hace transferOne (blob: undefined): list() no trae el tipo.
          outcomes.push(
            await transferOne(
              { pathname: blob.pathname, nombre, ext, blob: undefined },
              { dealId, maxAgeMs: PENDING_TTL_S * 1000 }
            )
          );
          continue; // transferOne ya lo borró
        }
        if (age >= DELETE_AFTER_MS) outcomes.push({ nombre, ext, status: 'failed', code: 'not_retried' });
      }
    }
    if (age >= DELETE_AFTER_MS) toDelete.push(blob.url);
    else stored += blob.size;
  }

  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    await deleteFromBlob(toDelete.slice(i, i + DELETE_BATCH), LOG);
  }

  // Notas de los reintentos, una por negocio.
  const followUp: string[] = [];
  for (const [dealId, outcomes] of byDeal) {
    if (!outcomes.length) continue;
    const lines = retryNoteLines(outcomes);
    try {
      const note = await pipedrivePost('/notes', { content: lines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), deal_id: dealId });
      if (!note.success) console.warn(`${LOG} Nota en Pipedrive FAIL | dealId: ${dealId}`);
    } catch {
      console.warn(`${LOG} Nota en Pipedrive FAIL | dealId: ${dealId}`);
    }
    if (transferReport(outcomes)?.needsFollowUp) followUp.push('', `Negocio ${dealId} en Pipedrive:`, ...lines.slice(1));
  }

  if (!(await recordStoredBytes(stored))) console.warn(`${LOG} Redis no guardó el total (el permiso no ve el techo)`);
  const ceilingReached = stored >= STORED_CEILING_BYTES;

  if (ceilingReached || followUp.length) {
    const alert = ceilingReached
      ? [
          `ALERTA: el almacenamiento temporal de archivos del cotizador tiene ${gb(stored)} (techo: ${gb(STORED_CEILING_BYTES)}).`,
          'Mientras siga sobre el techo, el sitio no recibe archivos adjuntos: las solicitudes llegan sin archivos y el formulario pide mandarlos a ventas@elights.cl.',
          'Revisar el almacén Blob en Vercel (Storage) y avisar a quien mantiene el sitio.',
        ]
      : [];
    await notifySales(
      {
        modo: 'Aviso del sitio: archivos adjuntos',
        nombre: `Sitio ${SITE_HOST} (aviso automático)`,
        email: 'ventas@elights.cl',
        telefono: '-',
        cuerpo: [`Barrido diario de adjuntos del cotizador (${SITE_HOST})`, ...alert, ...followUp].join('\n'),
        total: '-',
        asunto: ceilingReached ? 'ALERTA: adjuntos del sitio sobre el techo' : 'Adjuntos del sitio: revisar reintentos',
      },
      LOG
    );
  }

  const summary = { listed: blobs.length, deleted: toDelete.length, retried, storedBytes: stored, ceilingReached };
  console.log(
    `${LOG} Listados: ${summary.listed} | borrados: ${summary.deleted} | reintentos: ${retried} | ` +
      `guardado: ${gb(stored)}` + (ceilingReached ? ' | SOBRE EL TECHO' : '')
  );
  return summary;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
  try {
    res.status(200).json({ ok: true, ...(await sweep()) });
  } catch (err) {
    console.error(`${LOG} FAIL | ${err instanceof Error ? err.constructor.name || err.name : typeof err}`);
    res.status(500).json({ ok: false, error: 'Sweep failed' });
  }
}
