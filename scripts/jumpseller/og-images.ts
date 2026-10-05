// scripts/jumpseller/og-images.ts
// Imagen para compartir (WhatsApp, Facebook): revisa la primera foto de cada producto
// publicado y guarda su formato real, su peso y sus medidas. La regla que decide si la
// ficha usa su foto o la imagen de la marca está en src/lib/seo/ogImage.ts.
// - Un solo GET por foto, con Range de 64 KB: el peso sale de Content-Range y el formato
//   y las medidas de los primeros bytes (no de Content-Type: hay PNG servidos como JPEG).
// - Solo a https://images.jumpseller.com, sin credenciales (son fotos públicas).
// - Guardado por URL: una foto que no cambió no se vuelve a pedir. Una que no se pudo
//   revisar no deja dato (la ficha usa la imagen de la marca) y se reintenta la próxima
//   vez. Nunca bloquea la sincronización.

import type { ProductImageFacts, SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import { encodeImageUrl, ogImageIssue, OG_MAX_BYTES } from '../../src/lib/seo/ogImage';

/** Bytes que se piden de cada foto: alcanzan para las medidas de todos los JPEG del catálogo (el más lejano, a 25.607). */
export const PROBE_BYTES = 65_536;
export const IMAGE_HOST = 'images.jumpseller.com';
const USER_AGENT = 'eLIGHTS-catalog-sync (+https://nuevo.elights.cl)';

/** fetch mínimo para las fotos (el de client.ts no tiene cuerpo binario y no se toca). */
export type ImageFetch = (
  input: string,
  init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type ImageFormat = ProductImageFacts['format'];

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Medidas de un JPEG: recorre los segmentos hasta el SOF (SOF0–SOF15 salvo C4, C8 y CC). */
function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // relleno
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // sin largo
    if (marker === 0xd9 || marker === 0xda) return undefined; // fin o comienzo de la imagen: ya no hay SOF
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) return undefined;
      return { height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + be16(b, i + 2);
  }
  return undefined;
}

/** Formato real y medidas (si están en los bytes recibidos) a partir del comienzo del archivo. */
export function sniffImage(b: Uint8Array): { format: ImageFormat; width?: number; height?: number } {
  let format: ImageFormat = 'other';
  let size: { width: number; height: number } | undefined;
  if (startsWith(b, PNG_SIGNATURE)) {
    format = 'png';
    if (b.length >= 24 && startsWith(b, ascii('IHDR'), 12)) size = { width: be32(b, 16), height: be32(b, 20) };
  } else if (startsWith(b, [0xff, 0xd8, 0xff])) {
    format = 'jpeg';
    size = jpegSize(b);
  } else if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) {
    format = 'webp';
  } else if (startsWith(b, ascii('GIF8'))) {
    format = 'gif';
  }
  return size && size.width > 0 && size.height > 0 ? { format, ...size } : { format };
}

export type ProbeResult = { ok: true; facts: Omit<ProductImageFacts, 'url'> } | { ok: false; reason: string };

export interface ProbeOptions {
  fetchImpl: ImageFetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  retries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Peso total del archivo según la respuesta, o undefined si no se puede saber. */
function totalBytes(status: number, headers: { get(name: string): string | null }, bodyLength: number): number | undefined {
  if (status === 206) {
    const m = /^bytes 0-\d+\/(\d+)$/.exec(headers.get('Content-Range')?.trim() ?? '');
    return m ? Number(m[1]) : undefined;
  }
  const length = Number(headers.get('Content-Length'));
  return headers.get('Content-Length') !== null && Number.isInteger(length) && length > 0 ? length : bodyLength || undefined;
}

/** Revisa una foto (URL sin codificar, como en el snapshot): pide la misma URL que irá en og:image. */
export function createImageProbe(opts: ProbeOptions) {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const retries = opts.retries ?? 2;
  const backoff = (attempt: number) => Math.round(500 * 2 ** attempt + random() * 250);

  return async function probe(rawUrl: string): Promise<ProbeResult> {
    const url = encodeImageUrl(rawUrl);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: 'URL inválida' };
    }
    if (parsed.protocol !== 'https:' || parsed.host !== IMAGE_HOST) return { ok: false, reason: 'servidor no permitido' };

    let last = 'sin respuesta';
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) await sleep(backoff(attempt - 1));
      // El timeout cubre también la lectura del cuerpo (mismo patrón que client.ts)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await opts.fetchImpl(url, {
          method: 'GET',
          headers: { Range: `bytes=0-${PROBE_BYTES - 1}`, 'User-Agent': USER_AGENT },
          signal: controller.signal,
          // Sin seguir redirecciones: la lista de servidores permitidos vale para la foto que se mide
          redirect: 'manual',
        });
        if (res.status === 429 || res.status >= 500) {
          last = `HTTP ${res.status}`;
        } else if (res.status !== 200 && res.status !== 206) {
          return { ok: false, reason: `HTTP ${res.status}` };
        } else {
          const body = new Uint8Array(await res.arrayBuffer());
          const bytes = totalBytes(res.status, res.headers, body.length);
          if (!bytes) return { ok: false, reason: 'sin tamaño' };
          return { ok: true, facts: { ...sniffImage(body.subarray(0, PROBE_BYTES)), bytes } };
        }
      } catch {
        last = 'sin respuesta';
      } finally {
        clearTimeout(timer);
      }
      if (attempt >= retries) return { ok: false, reason: last };
    }
  };
}

export type ImageProbe = ReturnType<typeof createImageProbe>;

export interface OgImagesResult {
  /** Por jumpseller_id, ordenado por id. */
  facts: Record<number, ProductImageFacts>;
  probed: number;
  reused: number;
  /** Fotos que no se pudieron revisar (o que quedaron sin revisar por tiempo). */
  failed: { id: number; reason: string }[];
}

export interface BuildOptions {
  concurrency?: number;
  /** Vuelve a pedir todas las fotos (--recheck-images); si una falla, se mantiene su dato anterior. */
  recheck?: boolean;
  /** Pasado este tiempo no se piden más fotos: la tarea programada nunca llega a su límite de 15 min. */
  deadlineMs?: number;
  now?: () => number;
}

export const DEADLINE_REASON = 'sin revisar: se acabó el tiempo de la sincronización';

export async function buildOgImageFacts(
  next: readonly SnapshotProduct[],
  previous: Readonly<Record<number, ProductImageFacts>> | null,
  probe: ImageProbe,
  opts: BuildOptions = {},
): Promise<OgImagesResult> {
  const concurrency = opts.concurrency ?? 4;
  const deadlineMs = opts.deadlineMs ?? 300_000;
  const now = opts.now ?? Date.now;
  const facts: Record<number, ProductImageFacts> = {};
  const failed: OgImagesResult['failed'] = [];
  let reused = 0;
  let probed = 0;

  // Solo la primera foto de cada producto publicado (las demás no van en og:image)
  const jobs: { id: number; url: string; kept?: ProductImageFacts }[] = [];
  for (const p of next) {
    const url = p.images[0]?.url;
    if (!url) continue;
    const prev = previous?.[p.jumpseller_id];
    const same = prev && prev.url === url ? prev : undefined;
    if (same && !opts.recheck) {
      facts[p.jumpseller_id] = same;
      reused++;
    } else jobs.push({ id: p.jumpseller_id, url, kept: same });
  }

  const started = now();
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const keep = (reason: string) => {
        failed.push({ id: job.id, reason: job.kept ? `${reason}; se mantiene el dato anterior` : reason });
        if (job.kept) facts[job.id] = job.kept;
      };
      if (now() - started >= deadlineMs) {
        keep(DEADLINE_REASON);
        continue;
      }
      probed++;
      const r = await probe(job.url);
      if ('facts' in r) facts[job.id] = { url: job.url, ...r.facts };
      else keep(r.reason);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  failed.sort((a, b) => a.id - b.id);
  return { facts: sortFacts(facts), probed, reused, failed };
}

/** Mismo contenido, en orden de id y con las claves siempre en el mismo orden. */
export function sortFacts(facts: Readonly<Record<number, ProductImageFacts>>): Record<number, ProductImageFacts> {
  const out: Record<number, ProductImageFacts> = {};
  for (const id of Object.keys(facts).map(Number).sort((a, b) => a - b)) {
    const f = facts[id];
    out[id] = {
      url: f.url,
      format: f.format,
      bytes: f.bytes,
      ...(f.width !== undefined && f.height !== undefined ? { width: f.width, height: f.height } : {}),
    };
  }
  return out;
}

export interface OgImagesSummary {
  own: number;
  fallback: number;
  probed: number;
  reused: number;
  failed: { id: number; reason: string }[];
  /** PNG o JPEG de 600 KB o más. */
  heavy: number[];
  /** WebP, GIF u otro formato. */
  otherFormat: number[];
  /** Con foto pero sin dato (no se pudo revisar). */
  unchecked: number[];
}

/** Cuántas fichas usan su foto y por qué las demás usan la imagen de la marca (con la regla de ogImage.ts). */
export function summarizeOgImages(next: readonly SnapshotProduct[], r: OgImagesResult): OgImagesSummary {
  const s: OgImagesSummary = { own: 0, fallback: 0, probed: r.probed, reused: r.reused, failed: r.failed, heavy: [], otherFormat: [], unchecked: [] };
  for (const p of next) {
    const issue = ogImageIssue(p.images[0]?.url, r.facts[p.jumpseller_id]);
    if (!issue) { s.own++; continue; }
    s.fallback++;
    if (issue === 'peso') s.heavy.push(p.jumpseller_id);
    else if (issue === 'formato') s.otherFormat.push(p.jumpseller_id);
    else if (issue === 'sin-revisar') s.unchecked.push(p.jumpseller_id);
  }
  return s;
}

const FORMAT_LABEL: Record<ImageFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF', other: 'otro formato' };
const kb = (bytes: number) => `${Math.round(bytes / 1000).toLocaleString('es-CL')} KB`;

/** Sección "Imagen para compartir" del informe de la sincronización (va en la PR del robot). */
export function renderOgImagesReport(
  next: readonly SnapshotProduct[],
  r: OgImagesResult,
  names: ReadonlyMap<number, string>,
): string {
  const s = summarizeOgImages(next, r);
  const label = (id: number) => `${id} ${names.get(id) ?? ''}`.trim();
  const others = s.fallback - s.heavy.length - s.otherFormat.length - s.unchecked.length;
  const lines = ['## Imagen para compartir (WhatsApp, Facebook)', ''];
  lines.push(
    `- Foto propia: ${s.own} · imagen de la marca: ${s.fallback} (${s.heavy.length} de ${OG_MAX_BYTES / 1000} KB o más, ` +
      `${s.otherFormat.length} en otro formato, ${s.unchecked.length} sin revisar${others ? `, ${others} sin foto o con medidas insuficientes` : ''})`,
    `- Revisadas hoy: ${s.probed} · reutilizadas: ${s.reused}`,
  );
  if (s.failed.length) lines.push(`- ⚠️ No se pudieron revisar: ${s.failed.map(f => `${label(f.id)} (${f.reason})`).join('; ')}`);
  const toFix = [...s.heavy, ...s.otherFormat].sort((a, b) => a - b);
  if (toFix.length) {
    lines.push(
      '',
      `<details><summary>${toFix.length} productos con la imagen de la marca: para usar su foto, subir en Jumpseller un PNG o JPG de menos de ${OG_MAX_BYTES / 1000} KB como primera foto</summary>`,
      '',
      ...toFix.map(id => {
        const f = r.facts[id];
        return `- ${label(id)} (${FORMAT_LABEL[f.format]}, ${kb(f.bytes)})`;
      }),
      '',
      '</details>',
    );
  }
  return lines.join('\n');
}
