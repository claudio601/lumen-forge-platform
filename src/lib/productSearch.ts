// src/lib/productSearch.ts
// Búsqueda del sitio (/buscar), auditoría UX, B-03 y B-04.
//
// - Un índice por catálogo, armado una sola vez (la primera búsqueda) con el texto normalizado:
//   sin tildes y en minúsculas. Tres campos, en orden de relevancia: SKU (el del producto y los
//   de sus variantes), nombre, y el resto (marca, categorías y valores de las opciones de las
//   variantes: «Luz Cálida - 2700K», «Negro»).
// - Por palabras, y tienen que estar todas. «luminaria», «led», «de»… no filtran si hay otras
//   (src/data/catalog/search-synonyms.ts).
// - Una palabra encuentra las que empiezan con ella («proyect» → «proyector»), en singular o
//   plural, y con una letra de diferencia si tiene 5 letras o más («proyectr»). Un número solo,
//   el mismo número: «100» encuentra «100W» y «100 mt», pero no «1000W»; «0» no trae nada.
// - Sinónimos de obra en un solo sentido (search-synonyms.ts): «reflector» → «proyector».
// - Orden: primero lo que coincide por SKU, después por nombre y después el resto; a igualdad,
//   lo escrito tal cual antes que por sinónimo o con una letra de diferencia, y luego el orden
//   del catálogo («Relevancia»).
// Sin imports de datos de productos: el catálogo llega como argumento.

import type { Product } from '@/data/catalog/types';
import { categories, popularSearches } from '@/data/catalog/categories.config';
import { GENERIC_SEARCH_WORDS, SEARCH_SYNONYMS } from '@/data/catalog/search-synonyms';
import { contactEmail } from '@/config/business';

// ── Texto ─────────────────────────────────────────────────────────────────────

/** Sin tildes y en minúsculas: «Público» → «publico», «SEÑALÉTICA» → «senaletica». */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const UNITS = new Set(['k', 'w', 'v', 'mm', 'cm', 'm', 'mt', 'mts', 'lm']);
const NUMBER = /^\d+(?:\.\d+)?$/;
const LETTERS = /^[a-z]+$/;

/**
 * Palabras normalizadas de un texto. Junta lo que se escribe separado: «2700 K» → «2700k»,
 * «IP 65» → «ip65», «60 x 60» → «60x60», «14,4W» → «14.4w».
 */
export function searchWords(text: string): string[] {
  const cleaned = normalizeSearchText(text)
    .replace(/(\d),(?=\d)/g, '$1.') // coma decimal
    .replace(/(^|[^0-9])\./g, '$1 ') // punto que no está entre dígitos
    .replace(/\.(?![0-9])/g, ' ');
  const raw = cleaned.split(/[^a-z0-9.]+/).filter(Boolean);
  const words: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const [word, next, after] = [raw[i], raw[i + 1], raw[i + 2]];
    if (next !== undefined && NUMBER.test(word) && UNITS.has(next)) {
      words.push(word + next);
      i += 1;
    } else if (next !== undefined && (word === 'ip' || word === 'ik') && /^\d{2}$/.test(next)) {
      words.push(word + next);
      i += 1;
    } else if (next === 'x' && after !== undefined && NUMBER.test(word) && /^\d/.test(after)) {
      words.push(`${word}x${after}`);
      i += 2;
    } else {
      words.push(word);
    }
  }
  return words;
}

/** Palabras del índice: además, las partes de las medidas («2x18w» → «2», «18w»; «60x60» → «60»). */
function indexWords(text: string): string[] {
  return searchWords(text).flatMap(word => {
    const m = /^(\d+(?:\.\d+)?)x(\d.*)$/.exec(word);
    return m ? [word, m[1], m[2]] : [word];
  });
}

const GENERIC = new Set(GENERIC_SEARCH_WORDS.map(normalizeSearchText));

/** Sin las palabras genéricas, salvo que no quede ninguna. */
function meaningful(words: string[]): string[] {
  const kept = words.filter(w => !GENERIC.has(w));
  return kept.length ? kept : words;
}

/** La palabra y su singular: «paneles» → «panel», «focos» → «foco» (sin bajar de 4 letras). */
function forms(word: string): string[] {
  if (!LETTERS.test(word)) return [word];
  const out = [word];
  for (const end of ['es', 's']) {
    if (word.endsWith(end) && word.length - end.length >= 4) out.push(word.slice(0, -end.length));
  }
  return out;
}

/** Distancia de edición con transposición (OSA), cortada en 2: solo interesa si es ≤ 1. */
function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const [ra, rb] = [a.slice(i), b.slice(i)];
  return (
    ra.slice(1) === rb.slice(1) || // cambio de una letra
    ra.slice(1) === rb || // sobra una letra
    ra === rb.slice(1) || // falta una letra
    (ra.length >= 2 && ra[0] === rb[1] && ra[1] === rb[0] && ra.slice(2) === rb.slice(2)) // dos letras al revés
  );
}

/** Con una letra de diferencia (palabras de solo letras, de 5 o más). */
function closeEnough(token: string, word: string): boolean {
  return LETTERS.test(word) && forms(token).some(f => f.length >= 5 && editDistanceAtMost1(f, word));
}

const leadingNumber = (word: string) => /^\d+(?:\.\d+)?/.exec(word)?.[0];

/** Calidad de una coincidencia: 0 tal cual (o empieza así), 1 con una letra de diferencia o por sinónimo. */
export type Quality = 0 | 1;

function wordMatch(token: string, word: string): Quality | null {
  if (NUMBER.test(token)) return leadingNumber(word) === token ? 0 : null;
  if (forms(token).some(f => word.startsWith(f))) return 0;
  return closeEnough(token, word) ? 1 : null;
}

// ── Sinónimos ─────────────────────────────────────────────────────────────────

interface SynonymKey {
  words: string[];
  means: string;
  meansWords: string[];
}

const SYNONYM_KEYS: SynonymKey[] = SEARCH_SYNONYMS.flatMap(s =>
  s.busca.map(key => ({ words: meaningful(searchWords(key)), means: s.encuentra, meansWords: meaningful(searchWords(s.encuentra)) })),
)
  .filter(k => k.words.length > 0)
  .sort((a, b) => b.words.length - a.words.length); // las frases antes que las palabras sueltas

/** Una palabra del cliente es la de un sinónimo: igual, en plural o con una letra de diferencia. */
const sameKeyWord = (token: string, key: string) => forms(token).includes(key) || (LETTERS.test(token) && key.length >= 5 && closeEnough(token, key));

// ── Consulta ──────────────────────────────────────────────────────────────────

interface Alternative {
  words: string[];
  quality: Quality;
  /** Solo la palabra exacta: un sinónimo corto («ex») no busca «exterior». */
  exact?: boolean;
  /** Texto para las sugerencias (solo sinónimos). */
  suggestion?: string;
}

/** Una parte de la consulta (una palabra o una frase de sinónimo): basta una de sus alternativas. */
interface Clause {
  text: string;
  alternatives: Alternative[];
}

function parseQuery(query: string): Clause[] {
  const tokens = meaningful(searchWords(query));
  const clauses: Clause[] = [];
  for (let i = 0; i < tokens.length; ) {
    // La frase de sinónimo más larga que empieza aquí («recinto deportivo» antes que «deportivo»)
    const length = SYNONYM_KEYS.find(k => k.words.every((w, j) => tokens[i + j] !== undefined && sameKeyWord(tokens[i + j], w)))?.words.length ?? 1;
    const words = tokens.slice(i, i + length);
    const matched = SYNONYM_KEYS.filter(k => k.words.length === length && k.words.every((w, j) => sameKeyWord(words[j], w)));
    // Un «encuentra» por sinónimo, aunque lo pidan dos palabras del diccionario
    const synonyms = [...new Map(matched.map(k => [k.means, k])).values()];
    clauses.push({
      text: words.join(' '),
      alternatives: [
        { words, quality: 0, exact: synonyms.length > 0 && words.join('').length < 3 },
        ...synonyms.map(k => ({ words: k.meansWords, quality: 1 as const, suggestion: k.means })),
      ],
    });
    i += length;
  }
  return clauses;
}

// ── Índice ────────────────────────────────────────────────────────────────────

/** Campo donde coincide: 0 SKU, 1 nombre, 2 el resto. */
export type Field = 0 | 1 | 2;

export interface Hit {
  field: Field;
  quality: Quality;
}

export interface SearchIndex {
  products: readonly Product[];
  /** Palabra → producto (posición en el catálogo) → el mejor campo donde aparece. */
  vocabulary: Map<string, Map<number, Field>>;
  /** Coincidencias ya calculadas por palabra de la consulta (se escribe letra a letra). */
  cache: Map<string, Map<number, Hit>>;
}

const categoryNames = new Map(categories.map(c => [c.id, c.name]));

function buildIndex(products: readonly Product[]): SearchIndex {
  const vocabulary = new Map<string, Map<number, Field>>();
  const add = (word: string, position: number, field: Field) => {
    const owners = vocabulary.get(word) ?? new Map<number, Field>();
    const current = owners.get(position);
    if (current === undefined || field < current) owners.set(position, field);
    vocabulary.set(word, owners);
  };
  products.forEach((p, position) => {
    const skus = [p.sku, ...(p.variants ?? []).map(v => v.sku)].filter(Boolean);
    for (const sku of skus) for (const w of searchWords(sku)) add(w, position, 0);
    for (const w of indexWords(p.name)) add(w, position, 1);
    const rest = [
      p.brand,
      // Las temperaturas de todas sus variantes (también la de una variante única, que el producto no guarda)
      ...p.kelvins.map(k => `${k}K`),
      ...p.categories.map(c => categoryNames.get(c) ?? c),
      ...(p.variants ?? []).flatMap(v => v.options.map(o => o.value)),
    ];
    for (const text of rest) for (const w of indexWords(text)) add(w, position, 2);
  });
  return { products, vocabulary, cache: new Map() };
}

const indexes = new WeakMap<readonly Product[], SearchIndex>();

/** El índice del catálogo: se arma la primera vez y se reutiliza. */
export function searchIndex(products: readonly Product[]): SearchIndex {
  let index = indexes.get(products);
  if (!index) {
    index = buildIndex(products);
    indexes.set(products, index);
  }
  return index;
}

const better = (a: Hit, b: Hit) => a.field < b.field || (a.field === b.field && a.quality < b.quality);

/** Productos donde aparece una palabra de la consulta, con el mejor campo y calidad. */
function wordHits(index: SearchIndex, token: string, exact = false): Map<number, Hit> {
  const key = exact ? `=${token}` : token;
  const cached = index.cache.get(key);
  if (cached) return cached;
  if (index.cache.size >= 500) index.cache.clear();
  const hits = new Map<number, Hit>();
  for (const [word, owners] of index.vocabulary) {
    const quality = exact ? (word === token ? 0 : null) : wordMatch(token, word);
    if (quality === null) continue;
    for (const [position, field] of owners) {
      const hit = { field, quality };
      const current = hits.get(position);
      if (!current || better(hit, current)) hits.set(position, hit);
    }
  }
  index.cache.set(key, hits);
  return hits;
}

/** Todas las palabras de una alternativa en el mismo producto: cuenta el peor campo y la peor calidad. */
function alternativeHits(index: SearchIndex, alternative: Alternative): Map<number, Hit> {
  let result: Map<number, Hit> | null = null;
  for (const token of alternative.words) {
    const hits = wordHits(index, token, alternative.exact);
    const next = new Map<number, Hit>();
    for (const [position, hit] of hits) {
      const previous = result ? result.get(position) : { field: 0 as Field, quality: alternative.quality };
      if (!previous) continue;
      next.set(position, {
        field: Math.max(previous.field, hit.field) as Field,
        quality: Math.max(previous.quality, hit.quality, alternative.quality) as Quality,
      });
    }
    result = next;
  }
  return result ?? new Map();
}

function clauseHits(index: SearchIndex, clause: Clause): Map<number, Hit> {
  const hits = new Map<number, Hit>();
  for (const alternative of clause.alternatives) {
    for (const [position, hit] of alternativeHits(index, alternative)) {
      const current = hits.get(position);
      if (!current || better(hit, current)) hits.set(position, hit);
    }
  }
  return hits;
}

function runClauses(index: SearchIndex, clauses: Clause[]): Product[] {
  if (!clauses.length) return [];
  let ranked: Map<number, { tier: Field; quality: Quality; sku: boolean }> | null = null;
  for (const clause of clauses) {
    const hits = clauseHits(index, clause);
    const next = new Map<number, { tier: Field; quality: Quality; sku: boolean }>();
    for (const [position, hit] of hits) {
      const previous = ranked ? ranked.get(position) : { tier: 0 as Field, quality: 0 as Quality, sku: false };
      if (!previous) continue;
      next.set(position, {
        tier: Math.max(previous.tier, hit.field) as Field,
        quality: Math.max(previous.quality, hit.quality) as Quality,
        sku: previous.sku || hit.field === 0,
      });
    }
    ranked = next;
  }
  return [...ranked!]
    .map(([position, r]) => ({ position, tier: r.sku ? 0 : r.tier, quality: r.quality }))
    .sort((a, b) => a.tier - b.tier || a.quality - b.quality || a.position - b.position)
    .map(r => index.products[r.position]);
}

/** Productos que coinciden con la consulta, en orden de relevancia. Consulta vacía: []. */
export function searchProducts(products: readonly Product[], query: string): Product[] {
  return runClauses(searchIndex(products), parseQuery(query));
}

// ── Sin resultados (B-04) ─────────────────────────────────────────────────────

/**
 * Hasta `max` búsquedas que sí dan resultados, para cuando la consulta no da ninguno: primero lo
 * que dicen los sinónimos de sus palabras («proyector de estadio»), después cada palabra sola y,
 * para completar, las búsquedas populares. Sin repetir búsquedas que traen lo mismo.
 */
export function searchSuggestions(products: readonly Product[], query: string, max = 3): string[] {
  const index = searchIndex(products);
  const clauses = parseQuery(query);
  const candidates = [
    ...clauses.flatMap(c => c.alternatives.flatMap(a => (a.suggestion ? [a.suggestion] : []))),
    ...(clauses.length > 1 ? clauses.map(c => c.text) : []),
    ...popularSearches,
  ];
  const own = searchWords(query).join(' ');
  const texts = new Set<string>([own]);
  const resultSets = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    if (out.length >= max) break;
    const text = searchWords(candidate).join(' ');
    if (texts.has(text)) continue;
    texts.add(text);
    const results = runClauses(index, parseQuery(candidate));
    const signature = results.map(p => p.id).join('|');
    if (!results.length || resultSets.has(signature)) continue;
    resultSets.add(signature);
    out.push(candidate);
  }
  return out;
}

/** Largo máximo de la consulta en el correo prellenado. */
const MAIL_QUERY_MAX = 120;

/** Correo prellenado a ventas: asunto «Busco: {consulta}» y el mismo texto en el cuerpo. */
export function searchRequestMailto(query: string): string {
  const q = query.trim().replace(/\s+/g, ' ').slice(0, MAIL_QUERY_MAX);
  const subject = `Busco: ${q}`;
  const body = `Hola, busco: ${q}\r\n\r\nCantidad aproximada:\r\nComuna de despacho:\r\n`;
  return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
