// api/_lib/shipping/products.ts
// «Qué va en tu envío» del aviso de despacho (spec Nivel 2, §4.2). Funciones PURAS: la PR 2 decide
// cuándo usar cada fuente (el respaldo de requested_items_json vale solo después de una vista
// previa) y cuándo el aviso sale sin lista («El detalle de los productos va en la factura N° X
// adjunta», como el aviso real del 16-11; sin «adjunta» si no va el PDF, opcional desde el 19-11).
//
// 1. «Despacho · Productos»: hasta 30 líneas «<cantidad> <SKU>», con « — <texto como en la
//    factura>» opcional (también – o -, este último con espacios a los dos lados). El SKU se
//    resuelve con priceIndex sin distinguir mayúsculas ni espacios (lo escribe el dueño desde la
//    factura):
//    - un SKU que usan productos distintos no se resuelve;
//    - uno que comparten variantes del mismo producto da el producto sin etiqueta de variante;
//    - desconocido (o repetido) con texto: sale el texto, sin enlace (hay productos que se compran
//      en plaza y no están en Jumpseller); sin texto, el aviso no sale y la nota nombra la línea.
//    El texto de la línea, si viene, reemplaza el nombre del catálogo.
// 2. requested_items_json: solo la ÚLTIMA línea de una nota del servidor que empieza con
//    «Solicitud de pedido RC-…» o «Reenvío de la solicitud RC-…» (antes, si lo hay, el bloque
//    «Para revisar:» que el servidor pone al comienzo desde el 13-11). Pipedrive guarda la nota como
//    HTML: se parte en saltos de línea y <br> y se decodifican las entidades. Se resuelve por
//    jumpsellerId y variantId; nunca por `name` ni `url`, que manda el navegador.
// Nombre visible y enlace: product-links.generated.ts (id vigente del sitio, nombre de la ficha y
// etiqueta de la variante). Ninguna URL sale de aquí: la plantilla arma SITE_URL + /producto/<id>.
// El nombre y la etiqueta del catálogo van con mayúscula inicial (productName.ts, dueño 18-11-2026):
// «Alumbrado público BESTLED 40W IP66 IK08 – neutra 4000K». El texto del dueño va tal cual.

import { MAX_QUANTITY } from '../catalog/pricing.js';
import { priceIndex } from '../catalog/price-index.generated.js';
import { productLinks } from '../catalog/product-links.generated.js';
import { REVIEW_HEADING } from '../forms/review.js';
import { SHIPPING_FIELD_NAMES, type ShippingProblem } from './fields.js';
import { displayProductName, displayVariantLabel } from './productName.js';

export const MAX_PRODUCT_LINES = 30;
export const MAX_LINE_TEXT = 160;

/** Una fila de «Qué va en tu envío». `siteId`: /producto/<id>, o null si va sin enlace. */
export interface NoticeProductLine {
  quantity: number;
  name: string;
  siteId: string | null;
}

/** Lo mínimo de priceIndex para resolver un SKU (sin precios). */
export type SkuCatalog = Readonly<Record<string, { sku: string; variants: Readonly<Record<string, { sku: string }>> }>>;
/** Lo mínimo de product-links. */
export type LinkCatalog = Readonly<Record<string, { id: string; name: string; variants: Readonly<Record<string, { sku: string; label: string }>> }>>;

export interface Catalogs {
  skus: SkuCatalog;
  links: LinkCatalog;
}

const DEFAULT_CATALOGS: Catalogs = { skus: priceIndex, links: productLinks };

const FIELD = `«${SHIPPING_FIELD_NAMES.products}»`;
const problem = (message: string, field: ShippingProblem['field'] = 'products'): ShippingProblem => ({ field, code: 'invalid', message });
const shown = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

/** SKU para comparar: sin espacios y en mayúsculas. */
export function normalizeSku(sku: string): string {
  return sku.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}

/** Nombre del catálogo para el aviso: «Alumbrado público BESTLED 40W IP66 IK08 – neutra 4000K». */
const lineName = (name: string, label: string) => {
  const shown = displayProductName(name);
  const variant = displayVariantLabel(label);
  return variant ? `${shown} – ${variant}` : shown;
};

// ── «Despacho · Productos» ──────────────────────────────────────────────────

export interface ParsedProductLine {
  /** Número de la línea en el campo (desde 1, contando las vacías). */
  line: number;
  raw: string;
  quantity: number;
  sku: string;
  /** Texto «como en la factura», o null. */
  text: string | null;
}

/** Separador del texto: — o – (con o sin espacios) o un guion con espacios a los dos lados. */
const TEXT_SEPARATOR = /\s*[—–]\s*|\s+-\s+/;

export function parseProductLines(fieldText: string): { lines: ParsedProductLine[]; problems: ShippingProblem[] } {
  const all = fieldText.split(/\r\n|\r|\n/);
  const filled = all.map((raw, i) => ({ raw: raw.replace(/\s+/g, ' ').trim(), line: i + 1 })).filter((l) => l.raw);
  if (filled.length > MAX_PRODUCT_LINES) {
    return { lines: [], problems: [problem(`${FIELD} tiene ${filled.length} líneas: el máximo es ${MAX_PRODUCT_LINES}.`)] };
  }
  const lines: ParsedProductLine[] = [];
  const problems: ShippingProblem[] = [];
  for (const { raw, line } of filled) {
    const where = `${FIELD}, línea ${line} («${shown(raw)}»)`;
    const sep = TEXT_SEPARATOR.exec(raw);
    const head = sep ? raw.slice(0, sep.index) : raw;
    const text = sep ? raw.slice(sep.index + sep[0].length).trim() : '';
    // «10 APB401», «10 x APB401» o «10x APB401». Sin espacio entre la cantidad y el SKU no vale:
    // «10» solo se leería como 1 unidad del SKU «0».
    const m = /^(\d+)(?:\s+[xX×]\s+|[xX×]\s+|\s+)(.+)$/.exec(head.trim());
    if (!m || !normalizeSku(m[2])) {
      problems.push(problem(`${where}: tiene que ser «<cantidad> <SKU>», con « — <texto como en la factura>» si hace falta.`));
      continue;
    }
    const quantity = Number(m[1]);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      problems.push(problem(`${where}: la cantidad tiene que ser un entero de 1 a ${MAX_QUANTITY}.`));
      continue;
    }
    if (sep && !text) {
      problems.push(problem(`${where}: después del guion falta el texto.`));
      continue;
    }
    if (text.length > MAX_LINE_TEXT) {
      problems.push(problem(`${where}: el texto tiene más de ${MAX_LINE_TEXT} caracteres.`));
      continue;
    }
    lines.push({ line, raw, quantity, sku: m[2].trim(), text: text || null });
  }
  return { lines, problems };
}

type SkuHit = { jumpsellerId: string; variantId: string | null };

function skuLookup(skus: SkuCatalog): Map<string, SkuHit[]> {
  const map = new Map<string, SkuHit[]>();
  const add = (sku: string, hit: SkuHit) => {
    const key = normalizeSku(sku);
    if (key) map.set(key, [...(map.get(key) ?? []), hit]);
  };
  for (const [jumpsellerId, entry] of Object.entries(skus)) {
    add(entry.sku, { jumpsellerId, variantId: null });
    for (const [variantId, v] of Object.entries(entry.variants)) add(v.sku, { jumpsellerId, variantId });
  }
  return map;
}

type SkuResolution = { status: 'ok'; jumpsellerId: string; variantId: string | null } | { status: 'unknown' } | { status: 'ambiguous' };

/**
 * SKU → producto (y variante, si la identifica). «JS-<id>» (los productos sin SKU en las
 * solicitudes) es el id de Jumpseller. Repetido entre productos: `ambiguous`. Compartido por varias
 * variantes del mismo producto: el producto, sin variante.
 */
export function resolveSku(sku: string, catalogs: Catalogs = DEFAULT_CATALOGS, lookup = skuLookup(catalogs.skus)): SkuResolution {
  const key = normalizeSku(sku);
  const js = /^JS-?(\d+)$/.exec(key);
  if (js && catalogs.links[js[1]]) return { status: 'ok', jumpsellerId: js[1], variantId: null };
  const hits = lookup.get(key) ?? [];
  const productIds = [...new Set(hits.map((h) => h.jumpsellerId))];
  if (productIds.length === 0) return { status: 'unknown' };
  if (productIds.length > 1) return { status: 'ambiguous' };
  const variants = [...new Set(hits.flatMap((h) => (h.variantId ? [h.variantId] : [])))];
  return { status: 'ok', jumpsellerId: productIds[0], variantId: variants.length === 1 ? variants[0] : null };
}

/** Líneas de «Despacho · Productos» → filas del aviso, o la lista de lo que hay que corregir. */
export function resolveProductLines(
  lines: readonly ParsedProductLine[],
  catalogs: Catalogs = DEFAULT_CATALOGS,
): { items: NoticeProductLine[]; problems: ShippingProblem[] } {
  const lookup = skuLookup(catalogs.skus);
  const items: NoticeProductLine[] = [];
  const problems: ShippingProblem[] = [];
  for (const l of lines) {
    const where = `${FIELD}, línea ${l.line} («${shown(l.raw)}»)`;
    const hit = resolveSku(l.sku, catalogs, lookup);
    const entry = hit.status === 'ok' ? catalogs.links[hit.jumpsellerId] : undefined;
    if (hit.status === 'ok' && entry) {
      const label = hit.variantId ? (entry.variants[hit.variantId]?.label ?? '') : '';
      items.push({ quantity: l.quantity, name: l.text ?? lineName(entry.name, label), siteId: entry.id });
    } else if (l.text) {
      // Desconocido o repetido entre productos, con texto: sin enlace a la ficha.
      items.push({ quantity: l.quantity, name: l.text, siteId: null });
    } else if (hit.status === 'ambiguous') {
      problems.push(problem(`${where}: el SKU ${l.sku} lo usan varios productos del catálogo. Agrega « — <texto como en la factura>».`));
    } else {
      problems.push(problem(`${where}: el SKU ${l.sku} no está en el catálogo publicado. Corrígelo o agrega « — <texto como en la factura>».`));
    }
  }
  return { items, problems };
}

/** «Despacho · Productos» completo: leer y resolver. */
export function productsFromField(fieldText: string, catalogs: Catalogs = DEFAULT_CATALOGS): { items: NoticeProductLine[]; problems: ShippingProblem[] } {
  const parsed = parseProductLines(fieldText);
  const resolved = resolveProductLines(parsed.lines, catalogs);
  return { items: resolved.items, problems: [...parsed.problems, ...resolved.problems] };
}

// ── requested_items_json (solicitudes RC-) ──────────────────────────────────

export interface DealNote {
  id?: unknown;
  content?: unknown;
  /** 'aaaa-mm-dd hh:mm:ss' en UTC, como lo entrega Pipedrive. */
  add_time?: unknown;
}

export interface RequestedItem {
  jumpsellerId: number;
  variantId: number | null;
  quantity: number;
}

export type RequestedItemsResult =
  | { status: 'none' }
  | { status: 'ok'; reference: string; noteId: number | null; items: RequestedItem[] }
  | { status: 'invalid'; problem: ShippingProblem };

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Nota de Pipedrive (HTML) → líneas de texto. */
function noteLines(content: string): string[] {
  return content
    .split(/<br\s*\/?>|<\/p>|<\/div>|\r\n|\r|\n/i)
    .map((line) => decodeEntities(line.replace(/<[^>]*>/g, '')).replace(/\u00a0/g, ' ').trim());
}

const HEADER = /^(?:Solicitud de pedido|Reenvío de la solicitud) (RC-[A-Za-z0-9]{5,8})(?:\s|$)/;
const ITEMS_PREFIX = 'requested_items_json: ';

/** La nota es del servidor: la referencia RC- de su encabezado, o null. */
function serverNoteReference(lines: readonly string[]): string | null {
  let i = 0;
  while (i < lines.length && !lines[i]) i++;
  if (lines[i] === REVIEW_HEADING) {
    // Bloque «Para revisar:», una línea «- …» por aviso y una línea en blanco (api/_lib/forms/review.ts)
    i++;
    while (i < lines.length && lines[i]) {
      if (!lines[i].startsWith('- ')) return null;
      i++;
    }
    while (i < lines.length && !lines[i]) i++;
  }
  const m = HEADER.exec(lines[i] ?? '');
  return m ? m[1] : null;
}

const positiveInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/**
 * Productos que pidió el cliente, de la nota más reciente del servidor (por add_time y, a igual
 * hora, por id). Con `reference`, solo una nota de esa misma solicitud RC-.
 */
export function readRequestedItems(notes: readonly DealNote[], { reference }: { reference?: string | null } = {}): RequestedItemsResult {
  const wanted = reference ? reference.trim().toUpperCase() : null;
  const sorted = [...notes].sort((a, b) => {
    const ta = typeof a.add_time === 'string' ? a.add_time : '';
    const tb = typeof b.add_time === 'string' ? b.add_time : '';
    return tb.localeCompare(ta) || (Number(b.id) || 0) - (Number(a.id) || 0);
  });
  for (const note of sorted) {
    if (typeof note.content !== 'string') continue;
    const lines = noteLines(note.content);
    const ref = serverNoteReference(lines);
    if (!ref || (wanted && ref.toUpperCase() !== wanted)) continue;
    const invalid = (why: string): RequestedItemsResult => ({
      status: 'invalid',
      problem: problem(`La nota de la solicitud ${ref} no trae los productos en la forma esperada (${why}): llena ${FIELD}.`, null),
    });
    const last = [...lines].reverse().find(Boolean) ?? '';
    if (!last.startsWith(ITEMS_PREFIX)) return invalid('falta requested_items_json al final');
    let parsed: unknown;
    try {
      parsed = JSON.parse(last.slice(ITEMS_PREFIX.length));
    } catch {
      return invalid('el JSON no se puede leer');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return invalid('sin productos');
    if (parsed.length > MAX_PRODUCT_LINES) return invalid(`más de ${MAX_PRODUCT_LINES} productos`);
    const items: RequestedItem[] = [];
    for (const raw of parsed) {
      const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const jumpsellerId = positiveInt(item.jumpsellerId);
      const quantity = positiveInt(item.quantity);
      if (!jumpsellerId) return invalid('un producto sin id de Jumpseller');
      if (!quantity || quantity > MAX_QUANTITY) return invalid('una cantidad inválida');
      const variantId = item.variantId === undefined || item.variantId === null ? null : positiveInt(item.variantId);
      if (variantId === null && item.variantId !== undefined && item.variantId !== null) return invalid('una variante inválida');
      items.push({ jumpsellerId, variantId, quantity });
    }
    const noteId = positiveInt(note.id) ?? (typeof note.id === 'string' && /^\d+$/.test(note.id) ? Number(note.id) : null);
    return { status: 'ok', reference: ref, noteId, items };
  }
  return { status: 'none' };
}

/** Productos de la solicitud → filas del aviso (por id; el nombre y el enlace, del catálogo publicado). */
export function resolveRequestedItems(
  items: readonly RequestedItem[],
  catalogs: Catalogs = DEFAULT_CATALOGS,
): { items: NoticeProductLine[]; problems: ShippingProblem[] } {
  const out: NoticeProductLine[] = [];
  const problems: ShippingProblem[] = [];
  for (const item of items) {
    const entry = catalogs.links[String(item.jumpsellerId)];
    if (!entry) {
      problems.push(problem(`El producto ${item.jumpsellerId} de la solicitud ya no está en el catálogo publicado: llena ${FIELD}.`, null));
      continue;
    }
    const label = item.variantId ? (entry.variants[String(item.variantId)]?.label ?? '') : '';
    out.push({ quantity: item.quantity, name: lineName(entry.name, label), siteId: entry.id });
  }
  return { items: out, problems };
}
