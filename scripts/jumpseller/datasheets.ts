// scripts/jumpseller/datasheets.ts
// Fichas técnicas en PDF: los adjuntos de cada producto publicado en Jumpseller
// (GET products/<id>/attachments.json). La ficha de producto muestra un botón «Ficha
// técnica» por PDF, como elights.cl, donde el dueño manda a los clientes a descargarla.
// - Solo PDF del CDN de Jumpseller de la tienda; cualquier otro adjunto se informa y no se publica.
// - Una consulta por producto, de a una (el cliente de la API espacia las solicitudes),
//   con un tiempo límite. Primero los productos sin ficha guardada; los demás, desde un
//   punto que cambia cada día, para que un día lento no deje siempre sin revisar a los mismos.
// - Un producto que no se pudo consultar conserva sus fichas anteriores y se reintenta la
//   próxima vez. Nunca bloquea la sincronización.

import { z } from 'zod';
import type { SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import { JumpsellerApiError } from './client';

/**
 * PDF de la tienda en el CDN de Jumpseller (adjunto del producto o archivo de la tienda en
 * `assets/`), ya codificado: sin espacios ni caracteres fuera de ASCII.
 */
export const DATASHEET_URL_RE =
  /^https:\/\/images\.jumpseller\.com\/store\/elights-cl\/(\d+\/attachments\/[0-9a-f]+|assets)\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+\.pdf(\?\d+)?$/i;

const attachmentsSchema = z.array(
  z.object({ attachment: z.object({ id: z.number().int().positive(), customer_url: z.string() }) }),
);

export type FetchAttachments = (id: number) => Promise<unknown>;

/** Forma canónica (la que manda el navegador) o null si no es un PDF de la tienda. */
export function datasheetUrl(raw: string): string | null {
  let href: string;
  try {
    href = new URL(raw).href;
  } catch {
    return null;
  }
  return DATASHEET_URL_RE.test(href) ? href : null;
}

export interface DatasheetsResult {
  /** URLs de PDF por jumpseller_id (solo productos con al menos una), ordenado por id. */
  datasheets: Record<number, string[]>;
  /** false con --from-dir: no se consultó la API y se mantiene el archivo anterior. */
  checked: boolean;
  queried: number;
  /** No se pudieron consultar: conservan sus fichas anteriores, si tenían. */
  failed: { id: number; reason: string }[];
  /** Adjuntos que no son un PDF de la tienda: no se publican. */
  rejected: { id: number; url: string }[];
}

export const DATASHEETS_DEADLINE_MS = 300_000;
const DAY_MS = 86_400_000;

export interface DatasheetOptions {
  /** Pasado este tiempo no se consultan más productos: la tarea programada nunca llega a su límite de 15 min. */
  deadlineMs?: number;
  now?: () => number;
}

export const DEADLINE_REASON = 'sin consultar: se acabó el tiempo de la sincronización';

export async function buildDatasheets(
  next: readonly SnapshotProduct[],
  previous: Readonly<Record<number, readonly string[]>> | null,
  fetchAttachments: FetchAttachments | null,
  opts: DatasheetOptions = {},
): Promise<DatasheetsResult> {
  const deadlineMs = opts.deadlineMs ?? DATASHEETS_DEADLINE_MS;
  const now = opts.now ?? Date.now;
  const datasheets: Record<number, string[]> = {};
  const failed: DatasheetsResult['failed'] = [];
  const rejected: DatasheetsResult['rejected'] = [];
  const keep = (id: number) => {
    const prev = previous?.[id];
    if (prev?.length) datasheets[id] = [...prev];
  };

  if (!fetchAttachments) {
    for (const p of next) keep(p.jumpseller_id);
    return { datasheets: sortDatasheets(datasheets), checked: false, queried: 0, failed, rejected };
  }

  const started = now();
  const pending = next.filter(p => !previous?.[p.jumpseller_id]?.length);
  const known = next.filter(p => previous?.[p.jumpseller_id]?.length);
  const shift = known.length ? Math.floor(started / DAY_MS) % known.length : 0;
  const queue = [...pending, ...known.slice(shift), ...known.slice(0, shift)];
  let queried = 0;
  // Credenciales rechazadas o bloqueo por exceso de solicitudes: las consultas que faltan
  // fallarían igual, así que no se hacen.
  let stopped: string | undefined;
  for (const p of queue) {
    const id = p.jumpseller_id;
    const fail = (reason: string) => {
      failed.push({ id, reason: previous?.[id]?.length ? `${reason}; se mantienen las fichas anteriores` : reason });
      keep(id);
    };
    if (stopped) { fail(stopped); continue; }
    if (now() - started >= deadlineMs) { fail(DEADLINE_REASON); continue; }
    queried++;
    let body: unknown;
    try {
      body = await fetchAttachments(id);
    } catch (err) {
      const api = err instanceof JumpsellerApiError ? err : undefined;
      const reason = api?.kind === 'deadline' ? DEADLINE_REASON : (api?.message ?? 'error inesperado');
      if (api && (api.kind === 'auth' || api.kind === 'rate' || api.kind === 'deadline')) stopped = reason;
      fail(reason);
      continue;
    }
    const parsed = attachmentsSchema.safeParse(body);
    if (!parsed.success) { fail('respuesta con otra forma'); continue; }
    const urls: string[] = [];
    for (const { attachment } of [...parsed.data].sort((a, b) => a.attachment.id - b.attachment.id)) {
      const url = datasheetUrl(attachment.customer_url);
      if (url) { if (!urls.includes(url)) urls.push(url); } else rejected.push({ id, url: attachment.customer_url });
    }
    if (urls.length) datasheets[id] = urls;
  }

  failed.sort((a, b) => a.id - b.id);
  rejected.sort((a, b) => a.id - b.id);
  return { datasheets: sortDatasheets(datasheets), checked: true, queried, failed, rejected };
}

/** Mismo contenido, en orden de id. */
export function sortDatasheets(map: Readonly<Record<number, readonly string[]>>): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const id of Object.keys(map).map(Number).sort((a, b) => a - b)) out[id] = [...map[id]];
  return out;
}

export interface DatasheetsSummary {
  withPdf: number;
  without: number[];
  previousWithPdf: number | null;
  failed: DatasheetsResult['failed'];
  rejected: DatasheetsResult['rejected'];
}

export function summarizeDatasheets(
  next: readonly SnapshotProduct[],
  r: DatasheetsResult,
  previous: Readonly<Record<number, readonly string[]>> | null,
): DatasheetsSummary {
  const without = next.map(p => p.jumpseller_id).filter(id => !r.datasheets[id]).sort((a, b) => a - b);
  return {
    withPdf: next.length - without.length,
    without,
    previousWithPdf: previous ? Object.keys(previous).length : null,
    failed: r.failed,
    rejected: r.rejected,
  };
}

/** Sección "Fichas técnicas (PDF)" del informe de la sincronización (va en la PR del robot). */
export function renderDatasheetsReport(
  next: readonly SnapshotProduct[],
  r: DatasheetsResult,
  previous: Readonly<Record<number, readonly string[]>> | null,
  names: ReadonlyMap<number, string>,
): string {
  const s = summarizeDatasheets(next, r, previous);
  const label = (id: number) => `${id} ${names.get(id) ?? ''}`.trim();
  const lines = ['## Fichas técnicas (PDF)', ''];
  if (!r.checked) lines.push('- No se consultó la API (páginas guardadas): se mantienen las fichas anteriores.');
  lines.push(
    `- Con ficha: ${s.withPdf} · sin ficha: ${s.without.length}` +
      (s.previousWithPdf !== null ? ` (antes, ${s.previousWithPdf} con ficha)` : ''),
  );
  if (s.previousWithPdf && s.withPdf < s.previousWithPdf * 0.85) {
    lines.push(`- ⚠️ Bajan las fichas de ${s.previousWithPdf} a ${s.withPdf}: revisar los adjuntos en Jumpseller antes de fusionar.`);
  }
  if (previous) {
    const added = Object.keys(r.datasheets).map(Number).filter(id => !previous[id]?.length);
    const changed = Object.keys(r.datasheets).map(Number).filter(id => previous[id]?.length && previous[id].join('\n') !== r.datasheets[id].join('\n'));
    const gone = next.map(p => p.jumpseller_id).filter(id => previous[id]?.length && !r.datasheets[id]);
    if (added.length) lines.push(`- Ficha nueva: ${added.map(label).join('; ')}`);
    if (changed.length) lines.push(`- Ficha cambiada: ${changed.map(label).join('; ')}`);
    if (gone.length) lines.push(`- ⚠️ Pierden su ficha: ${gone.map(label).join('; ')}`);
  }
  if (s.failed.length) lines.push(`- ⚠️ No se pudieron consultar: ${s.failed.map(f => `${label(f.id)} (${f.reason})`).join('; ')}`);
  if (s.rejected.length) lines.push(`- Adjuntos que no son PDF de la tienda (no se publican): ${s.rejected.map(x => `${label(x.id)} (${x.url})`).join('; ')}`);
  if (s.without.length) {
    lines.push(
      '',
      `<details><summary>${s.without.length} productos sin ficha técnica: para mostrarla, adjuntar el PDF al producto en Jumpseller</summary>`,
      '',
      ...s.without.map(id => `- ${label(id)}`),
      '',
      '</details>',
    );
  }
  return lines.join('\n');
}
