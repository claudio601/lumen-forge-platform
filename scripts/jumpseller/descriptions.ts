// scripts/jumpseller/descriptions.ts
// Descripciones de producto para el sitio, a partir de lo que trae Jumpseller:
// limpias (sanitize-description.ts), separadas en texto y tabla de especificaciones,
// la tabla ordenada en los grupos de las fichas BESTLED (spec-groups.ts), sin lo que
// ya cubre el contenido editorial (BESTLED), y con un informe de cambios y de textos
// que contradicen las reglas del sitio. Una descripción problemática se omite y se
// informa: nunca bloquea la sincronización de precios y productos.

import { roundTripsInBrowser, sanitizeDescription, splitDescription, unsafeHtmlReasons } from './sanitize-description';
import { groupSpecs } from './spec-groups';
import type { ProductDescription } from './write';

export interface EditorialCoverage {
  description?: unknown;
  specsElectricos?: readonly unknown[];
  specsConstruccion?: readonly unknown[];
  specsComponentes?: readonly unknown[];
}

export interface DescriptionsResult {
  descriptions: Record<number, ProductDescription>;
  /** Omitidas: HTML que el navegador leería distinto o que no pasó la verificación final. */
  skipped: { id: number; reason: string }[];
  /** Textos que contradicen las reglas del sitio (para corregir en Jumpseller). */
  warnings: { id: number; phrase: string }[];
  /** false si los datos no traen el campo description (respaldo anterior al 2026-10-01). */
  available: boolean;
  /** Etiquetas de la tabla sin regla en spec-groups.ts (quedan en Construcción y operación). */
  unknownLabels: string[];
}

const hasGroupedSpecs = (e?: EditorialCoverage) =>
  !!(e?.specsElectricos?.length || e?.specsConstruccion?.length || e?.specsComponentes?.length);

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * Frases que contradicen las reglas del dueño: nunca hablar de stock, el despacho se
 * promete solo como "hasta 2 días hábiles", y los precios viven en Jumpseller (no en el texto).
 */
/** Bordes de palabra que entienden tildes ("\b" de JavaScript no reconoce "Ú" como letra). */
const W = String.raw`(?<![\p{L}\p{N}])`;
const WE = String.raw`(?![\p{L}\p{N}])`;
const STOCK = new RegExp(`${W}(?:stock|existencias?|[uú]ltimas unidades|agotad[oa]s?)${WE}`, 'iu');
const IMMEDIATE = new RegExp(`${W}(?:despacho|entrega|disponibilidad)\\s+inmediat[oa]${WE}`, 'iu');
// Toda mención de despacho, entrega o envío junto a un plazo. "Entrega 410 lm y hasta 3 horas
// de autonomía" habla de la batería, no del despacho.
const DELIVERY = new RegExp(
  `${W}(?:despach|entreg|env[ií])\\p{L}*[^.;]{0,40}?${W}\\d+(?:\\s*(?:-|a)\\s*\\d+)?\\s*(?:h|hrs?|horas|d[ií]as?(?:\\s+h[aá]biles)?)${WE}` +
    String.raw`(?!\.?\s+(?:de\s+)?(?:autonom|carga|respaldo|funcionamiento|uso|trabajo|iluminaci|encendido|operaci|duraci))`,
  'giu',
);

/** Stock, despacho "inmediato" o un plazo distinto de "hasta 2 días hábiles" (texto plano). */
export function findPolicyBreaking(t: string): string | null {
  const stock = t.match(STOCK);
  if (stock) return stock[0];
  const immediate = t.match(IMMEDIATE);
  if (immediate) return immediate[0];
  // Todas las menciones, no solo la primera: "hasta 2 días hábiles" no autoriza un "24 horas" después
  for (const m of t.matchAll(DELIVERY)) if (!/hasta\s+2\s+d[ií]as\s+h[aá]biles/i.test(m[0])) return m[0];
  return null;
}

/** Lo anterior, en HTML, y además precios escritos en el texto (los precios viven en Jumpseller). */
export function findRuleBreaking(text: string): string | null {
  const t = plain(text);
  const policy = findPolicyBreaking(t);
  if (policy) return policy;
  const price = t.match(/\$\s?\d[\d.]*/);
  if (price) return price[0];
  return null;
}

export function buildDescriptions(
  raws: readonly { id?: number; description?: string | null }[],
  published: ReadonlySet<number>,
  editorial: Readonly<Record<number, EditorialCoverage>>,
): DescriptionsResult {
  const result: DescriptionsResult = {
    descriptions: {},
    skipped: [],
    warnings: [],
    available: raws.some(r => r.description !== undefined),
    unknownLabels: [],
  };
  const unknown = new Set<string>();
  for (const raw of raws) {
    if (!raw.id || !published.has(raw.id)) continue;
    try {
      addDescription(result, { id: raw.id, description: raw.description }, editorial[raw.id], unknown);
    } catch (err) {
      // Una descripción imposible de procesar (p. ej. anidada miles de niveles) se omite y se informa
      result.skipped.push({ id: raw.id, reason: `no se pudo procesar: ${(err as Error).message.slice(0, 80)}` });
    }
  }
  result.unknownLabels = [...unknown].sort();
  return result;
}

function addDescription(
  result: DescriptionsResult,
  raw: { id: number; description?: string | null },
  ed: EditorialCoverage | undefined,
  unknown: Set<string>,
): void {
  const html = sanitizeDescription(raw.description);
  if (!html) return;
  const unsafe = unsafeHtmlReasons(html);
  if (unsafe.length) {
    result.skipped.push({ id: raw.id, reason: unsafe.join(', ') });
    return;
  }
  let { text, specs } = splitDescription(html);
  if (ed?.description) text = ''; // texto editorial del prototipo (BESTLED)
  if (hasGroupedSpecs(ed)) specs = ''; // especificaciones editoriales agrupadas
  const grouped = specs ? groupSpecs(specs) : null;
  const bad = [text, grouped?.specs.tables].find(part => part && !roundTripsInBrowser(part));
  if (bad) {
    result.skipped.push({ id: raw.id, reason: 'el navegador leería el HTML distinto' });
    return;
  }
  const entry: ProductDescription = { ...(text ? { text } : {}), ...grouped?.specs };
  if (!Object.keys(entry).length) return;
  result.descriptions[raw.id] = entry;
  grouped?.unknownLabels.forEach(l => unknown.add(l));
  const phrase = findRuleBreaking(descriptionText(entry));
  if (phrase) result.warnings.push({ id: raw.id, phrase });
}

/** Todo el texto visible de una descripción (para buscar frases que rompen las reglas). */
function descriptionText(d: ProductDescription): string {
  const rows = [...(d.electricos ?? []), ...(d.construccion ?? []), ...(d.componentes ?? [])];
  return [d.text ?? '', ...rows.map(r => `${r.label}: ${r.value}.`), ...(d.applications ?? []), d.tables ?? ''].join(' ');
}

export function diffDescriptions(
  prev: Readonly<Record<number, ProductDescription>>,
  next: Readonly<Record<number, ProductDescription>>,
): { added: number[]; changed: number[]; removed: number[] } {
  const same = (a: ProductDescription, b: ProductDescription) => JSON.stringify(a) === JSON.stringify(b);
  const ids = (o: object) => Object.keys(o).map(Number);
  return {
    added: ids(next).filter(id => !prev[id]),
    changed: ids(next).filter(id => prev[id] && !same(prev[id], next[id])),
    removed: ids(prev).filter(id => !next[id]),
  };
}

/** Sección "Descripciones" del informe de la sincronización (va en la PR del robot). */
export function renderDescriptionsReport(
  r: DescriptionsResult,
  diff: ReturnType<typeof diffDescriptions> | null,
  names: ReadonlyMap<number, string>,
  previousCount: number,
): string {
  const label = (id: number) => `${id} ${names.get(id) ?? ''}`.trim();
  const list = (ids: number[]) => (ids.length ? ids.map(label).join('; ') : 'ninguna');
  const all = Object.values(r.descriptions);
  const lines = ['## Descripciones (Jumpseller)', ''];
  if (!r.available) {
    lines.push('- Los datos no traen descripciones (respaldo anterior al 2026-10-01): se mantienen las del sitio.');
    return lines.join('\n');
  }
  const withSpecs = all.filter(d => d.electricos || d.construccion || d.componentes || d.tables).length;
  lines.push(`- Con texto: ${all.filter(d => d.text).length} · con especificaciones: ${withSpecs} · total: ${all.length}`);
  if (diff) {
    lines.push(`- Nuevas: ${list(diff.added)}`, `- Cambiadas: ${list(diff.changed)}`, `- Eliminadas: ${list(diff.removed)}`);
  }
  if (previousCount > 0 && all.length < previousCount * 0.85) {
    lines.push(`- ⚠️ Bajaron de ${previousCount} a ${all.length}: revisar en Jumpseller si se borraron descripciones.`);
  }
  if (r.skipped.length) lines.push(`- ⚠️ Omitidas: ${r.skipped.map(s => `${label(s.id)} (${s.reason})`).join('; ')}`);
  if (r.unknownLabels.length) {
    lines.push(`- Etiquetas de la tabla sin grupo (quedaron en "Construcción y operación"): ${r.unknownLabels.join('; ')}`);
  }
  if (r.warnings.length) {
    lines.push(`- ⚠️ Textos a corregir en Jumpseller: ${r.warnings.map(w => `${label(w.id)} ("${w.phrase}")`).join('; ')}`);
  }
  return lines.join('\n');
}
