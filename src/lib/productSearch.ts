// src/lib/productSearch.ts
// Búsqueda del sitio (/buscar), auditoría UX, B-03 y B-04.
//
// - Un índice por catálogo, armado una sola vez (la primera búsqueda) con el texto normalizado:
//   sin tildes y en minúsculas. Tres campos, en orden de relevancia: SKU (el del producto y los
//   de sus variantes, también el de una variante única), nombre, y el resto (marca, temperaturas,
//   categorías y valores de las opciones de las variantes: «Luz Cálida - 2700K», «Negro»).
//   «TRI-PROOF» se indexa también junto («triproof»).
// - Por palabras, y tienen que estar todas. «luminaria», «led», «luz», «de»… no filtran si hay
//   otras, tampoco en plural («luminarias», «luces») (src/data/catalog/search-synonyms.ts); si
//   todas son de esas, se buscan las que están en el catálogo («luces led» busca «led»).
// - Una palabra encuentra las que empiezan con ella («proyect» → «proyector»), en singular o
//   plural. Un número solo, el mismo número: «100» encuentra «100W» y «100 mt», pero no «1000W»;
//   «0» no trae nada. «100 watts» y «2700 kelvin» son «100w» y «2700k».
// - Una letra de diferencia («proyectr»), solo como respaldo: si la palabra (de 5 letras o más)
//   no está en el catálogo ni es un sinónimo, y con la misma primera letra. Así «salida» no trae
//   «Luz Cálida», «estanca» no trae «estaca» y «puente» no trae «fuente».
// - Sinónimos de obra en un solo sentido (search-synonyms.ts): «reflector» → «proyector». Una
//   fila puede limitarse a una categoría: «plafón» → los paneles, sin los «panel solar».
// - Orden: lo que llega con una letra de diferencia va al final. Antes, lo que coincide por SKU
//   (el SKU completo antes que el que solo empieza igual), después por nombre y después el resto;
//   a igualdad, lo escrito tal cual antes que por sinónimo, la potencia pedida («100w», «100»)
//   antes que un accesorio que la nombra entre otras, y luego el orden del catálogo
//   («Relevancia»).
// Sin imports de datos de productos: el catálogo llega como argumento.

import type { Product } from '@/data/catalog/types';
import { categories, popularSearches } from '@/data/catalog/categories.config';
import { GENERIC_SEARCH_WORDS, SEARCH_SYNONYMS } from '@/data/catalog/search-synonyms';

// ── Texto ─────────────────────────────────────────────────────────────────────

/** Sin tildes y en minúsculas: «Público» → «publico», «SEÑALÉTICA» → «senaletica». */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Unidades que se juntan con el número de antes, en su forma corta: «100 watts» → «100w». */
const UNITS = new Map([
  ['k', 'k'], ['kelvin', 'k'], ['kelvins', 'k'],
  ['w', 'w'], ['watt', 'w'], ['watts', 'w'],
  ['lm', 'lm'], ['lumen', 'lm'], ['lumenes', 'lm'],
  ['v', 'v'], ['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['mt', 'mt'], ['mts', 'mts'],
]);
/** Las unidades largas escritas junto al número: «100watts», «2700kelvin». */
const GLUED_UNIT = /^(\d+(?:\.\d+)?)(kelvins?|watts?|lumen(?:es)?)$/;
const NUMBER = /^\d+(?:\.\d+)?$/;
const LETTERS = /^[a-z]+$/;

/** Coma decimal a punto, y el punto que no está entre dígitos a espacio (sin cambiar el largo). */
const cleanNumbers = (normalized: string) =>
  normalized
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(/(^|[^0-9])\./g, '$1 ')
    .replace(/\.(?![0-9])/g, ' ');

interface Joined {
  word: string;
  /** Primera y última parte de donde sale la palabra. */
  first: number;
  last: number;
}

/** Junta las partes que se escriben separadas: «2700» «k» → «2700k». */
function joinParts(raw: readonly string[]): Joined[] {
  const words: Joined[] = [];
  for (let i = 0; i < raw.length; i++) {
    const [word, next, after] = [raw[i], raw[i + 1], raw[i + 2]];
    const glued = GLUED_UNIT.exec(word);
    if (glued) {
      words.push({ word: glued[1] + UNITS.get(glued[2]), first: i, last: i });
    } else if (next !== undefined && NUMBER.test(word) && UNITS.has(next)) {
      words.push({ word: word + UNITS.get(next), first: i, last: i + 1 });
      i += 1;
    } else if (next !== undefined && (word === 'ip' || word === 'ik') && /^\d{2}$/.test(next)) {
      words.push({ word: word + next, first: i, last: i + 1 });
      i += 1;
    } else if (next === 'x' && after !== undefined && NUMBER.test(word) && /^\d/.test(after)) {
      words.push({ word: `${word}x${after}`, first: i, last: i + 2 });
      i += 2;
    } else {
      words.push({ word, first: i, last: i });
    }
  }
  return words;
}

/**
 * Palabras normalizadas de un texto. Junta lo que se escribe separado: «2700 K» → «2700k»,
 * «IP 65» → «ip65», «60 x 60» → «60x60», «14,4W» → «14.4w», «100 watts» → «100w».
 */
export function searchWords(text: string): string[] {
  const raw = cleanNumbers(normalizeSearchText(text)).split(/[^a-z0-9.]+/).filter(Boolean);
  return joinParts(raw).map(w => w.word);
}

/** Palabra de la consulta y dónde está en el texto original (para mostrarla como se escribió). */
interface WordSpan {
  word: string;
  start: number;
  end: number;
}

/** Como searchWords, con la posición de cada palabra en el texto original. */
function searchWordSpans(text: string): WordSpan[] {
  // Normalizado carácter a carácter, con la posición de cada uno en el original
  let normalized = '';
  const origin: number[] = [];
  let at = 0;
  for (const ch of text) {
    const n = normalizeSearchText(ch);
    normalized += n;
    for (let j = 0; j < n.length; j++) origin.push(at);
    at += ch.length;
  }
  origin.push(text.length);
  const parts = [...cleanNumbers(normalized).matchAll(/[a-z0-9.]+/g)].map(m => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
  return joinParts(parts.map(p => p.text)).map(w => ({ word: w.word, start: origin[parts[w.first].start], end: origin[parts[w.last].end] }));
}

/**
 * Palabras del índice: además, las partes de las medidas («2x18w» → «2», «18w»; «60x60» → «60»)
 * y lo unido por guion, junto («TRI-PROOF» → «triproof»).
 */
function indexWords(text: string): string[] {
  const words = searchWords(text).flatMap(word => {
    const m = /^(\d+(?:\.\d+)?)x(\d.*)$/.exec(word);
    return m ? [word, m[1], m[2]] : [word];
  });
  for (const m of normalizeSearchText(text).matchAll(/[a-z]+(?:-[a-z]+)+/g)) words.push(m[0].replace(/-/g, ''));
  return words;
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

const GENERIC = new Set(GENERIC_SEARCH_WORDS.map(normalizeSearchText));

/** Palabra genérica, también en plural: «luminarias», «lámparas». */
const isGeneric = (word: string) => forms(word).some(f => GENERIC.has(f));

/** Sin las palabras genéricas, salvo que no quede ninguna. */
function meaningful<T>(items: T[], word: (item: T) => string): T[] {
  const kept = items.filter(item => !isGeneric(word(item)));
  return kept.length ? kept : items;
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

/** Con una letra de diferencia: palabras de solo letras, de 5 o más, que empiezan con la misma letra. */
function closeEnough(token: string, word: string): boolean {
  return LETTERS.test(token) && LETTERS.test(word) && forms(token).some(f => f.length >= 5 && f[0] === word[0] && editDistanceAtMost1(f, word));
}

const leadingNumber = (word: string) => /^\d+(?:\.\d+)?/.exec(word)?.[0];

/** Calidad de una coincidencia: 0 tal cual (o empieza así), 1 por sinónimo, 2 con una letra de diferencia. */
export type Quality = 0 | 1 | 2;

/** Cómo se busca una palabra: igual, tal cual o como comienzo, o con una letra de diferencia. */
type Mode = 'exact' | 'prefix' | 'typo';

function wordMatch(token: string, word: string, mode: Mode): Quality | null {
  if (mode === 'exact') return word === token ? 0 : null;
  if (mode === 'typo') return closeEnough(token, word) ? 2 : null;
  if (NUMBER.test(token)) return leadingNumber(word) === token ? 0 : null;
  return forms(token).some(f => word.startsWith(f)) ? 0 : null;
}

// ── Sinónimos ─────────────────────────────────────────────────────────────────

interface SynonymKey {
  words: string[];
  means: string;
  meansWords: string[];
  category?: string;
}

const SYNONYM_KEYS: SynonymKey[] = SEARCH_SYNONYMS.flatMap(s =>
  s.busca.flatMap(key =>
    [s.encuentra].flat().map(means => ({
      words: meaningful(searchWords(key), w => w),
      means,
      meansWords: meaningful(searchWords(means), w => w),
      category: s.categoria,
    })),
  ),
)
  .filter(k => k.words.length > 0)
  .sort((a, b) => b.words.length - a.words.length); // las frases antes que las palabras sueltas

/**
 * Una palabra del cliente es la de un sinónimo: igual o en plural; con una letra de diferencia,
 * solo si la palabra no está en el catálogo («faros» no es «farol»).
 */
const sameKeyWord = (token: string, key: string, typo: boolean) =>
  forms(token).includes(key) || (typo && key.length >= 5 && closeEnough(token, key));

// ── Índice ────────────────────────────────────────────────────────────────────

/** Campo donde coincide: 0 SKU, 1 nombre, 2 el resto. */
export type Field = 0 | 1 | 2;

export interface Hit {
  field: Field;
  quality: Quality;
  /** La palabra del producto es la de la consulta, completa (para ordenar primero el SKU completo). */
  exact: boolean;
}

export interface SearchIndex {
  products: readonly Product[];
  /** Palabra → producto (posición en el catálogo) → el mejor campo donde aparece. */
  vocabulary: Map<string, Map<number, Field>>;
  /** Coincidencias ya calculadas por palabra de la consulta (se escribe letra a letra). */
  cache: Map<string, Map<number, Hit>>;
  /** Si cada palabra de la consulta está en el catálogo (tal cual, en singular o como comienzo). */
  known: Map<string, boolean>;
  /**
   * Por producto, la potencia de su nombre si nombra una sola: el «TRIPODE PARA PROYECTOR LED
   * 10W / 20W/ … 200W» no es un producto de 10 W ni de 100 W.
   */
  power: (number | null)[];
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
  const power = products.map(p => {
    const named = new Set(searchWords(p.name).flatMap(w => /^(\d+(?:\.\d+)?)w$/.exec(w)?.[1] ?? []).map(Number));
    return named.size === 1 ? [...named][0] : null;
  });
  products.forEach((p, position) => {
    // Las variantes para elegir y la única, que el producto guarda aparte
    const variants = [...(p.variants ?? []), ...(p.singleVariant ? [p.singleVariant] : [])];
    const skus = [p.sku, ...variants.map(v => v.sku)].filter(Boolean);
    for (const sku of skus) for (const w of searchWords(sku)) add(w, position, 0);
    for (const w of indexWords(p.name)) add(w, position, 1);
    const rest = [
      p.brand,
      ...p.kelvins.map(k => `${k}K`),
      ...p.categories.map(c => categoryNames.get(c) ?? c),
      ...variants.flatMap(v => v.options.map(o => o.value)),
    ];
    for (const text of rest) for (const w of indexWords(text)) add(w, position, 2);
  });
  return { products, vocabulary, cache: new Map(), known: new Map(), power };
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

/** La palabra (o su singular) está en el catálogo, tal cual o como comienzo de otra. Un número, siempre. */
function known(index: SearchIndex, token: string): boolean {
  const cached = index.known.get(token);
  if (cached !== undefined) return cached;
  if (index.known.size >= 500) index.known.clear();
  const prefixes = forms(token);
  let found = NUMBER.test(token);
  for (const word of index.vocabulary.keys()) {
    if (found) break;
    found = prefixes.some(f => word.startsWith(f));
  }
  index.known.set(token, found);
  return found;
}

const better = (a: Hit, b: Hit) =>
  a.field < b.field || (a.field === b.field && (a.quality < b.quality || (a.quality === b.quality && a.exact && !b.exact)));

/** Productos donde aparece una palabra de la consulta, con el mejor campo y calidad. */
function wordHits(index: SearchIndex, token: string, mode: Mode): Map<number, Hit> {
  const key = `${mode}:${token}`;
  const cached = index.cache.get(key);
  if (cached) return cached;
  if (index.cache.size >= 500) index.cache.clear();
  const hits = new Map<number, Hit>();
  for (const [word, owners] of index.vocabulary) {
    const quality = wordMatch(token, word, mode);
    if (quality === null) continue;
    for (const [position, field] of owners) {
      const hit = { field, quality, exact: word === token };
      const current = hits.get(position);
      if (!current || better(hit, current)) hits.set(position, hit);
    }
  }
  index.cache.set(key, hits);
  return hits;
}

// ── Consulta ──────────────────────────────────────────────────────────────────

interface Alternative {
  words: string[];
  quality: Quality;
  /**
   * 'exact': solo la palabra exacta (un sinónimo corto, «ex», no busca «exterior»). 'prefix': tal
   * cual o como comienzo. 'auto': como 'prefix' y, si la palabra no está en el catálogo, con una
   * letra de diferencia.
   */
  mode: 'exact' | 'prefix' | 'auto';
  /** Solo los productos de esta categoría (un sinónimo limitado a una). */
  category?: string;
  /** Texto para las sugerencias (solo sinónimos). */
  suggestion?: string;
}

/** Una parte de la consulta (una palabra o una frase de sinónimo): basta una de sus alternativas. */
interface Clause {
  /** Como la escribió el cliente, con sus tildes (para las sugerencias). */
  text: string;
  alternatives: Alternative[];
}

/**
 * Palabras de la consulta sin las genéricas. Si todas lo son, las que están en el catálogo
 * («luces led» busca «led»); si ninguna está, todas.
 */
function queryWords(index: SearchIndex, query: string): WordSpan[] {
  const spans = searchWordSpans(query);
  const kept = spans.filter(t => !isGeneric(t.word));
  if (kept.length) return kept;
  const inCatalog = spans.filter(t => known(index, t.word));
  return inCatalog.length ? inCatalog : spans;
}

function parseQuery(index: SearchIndex, query: string): Clause[] {
  const tokens = queryWords(index, query);
  const fits = (k: SynonymKey, i: number) =>
    k.words.every((w, j) => tokens[i + j] !== undefined && sameKeyWord(tokens[i + j].word, w, !known(index, tokens[i + j].word)));
  const clauses: Clause[] = [];
  for (let i = 0; i < tokens.length; ) {
    // La frase de sinónimo más larga que empieza aquí («recinto deportivo» antes que «deportivo»)
    const length = SYNONYM_KEYS.find(k => fits(k, i))?.words.length ?? 1;
    const part = tokens.slice(i, i + length);
    const words = part.map(t => t.word);
    const matched = SYNONYM_KEYS.filter(k => k.words.length === length && fits(k, i));
    // Una búsqueda por «encuentra», aunque la pidan dos palabras del diccionario
    const synonyms = [...new Map(matched.map(k => [`${k.means}|${k.category ?? ''}`, k])).values()];
    // Con sinónimo, lo escrito se busca sin letras de diferencia: ya se sabe qué quiso decir
    const mode = !synonyms.length ? 'auto' : words.join('').length < 3 ? 'exact' : 'prefix';
    clauses.push({
      text: query.slice(part[0].start, part[part.length - 1].end).trim(),
      alternatives: [
        { words, quality: 0, mode },
        ...synonyms.map(k => ({ words: k.meansWords, quality: 1 as const, mode: 'prefix' as const, category: k.category, suggestion: k.means })),
      ],
    });
    i += length;
  }
  return clauses;
}

/** Todas las palabras de una alternativa en el mismo producto: cuenta el peor campo y la peor calidad. */
function alternativeHits(index: SearchIndex, alternative: Alternative): Map<number, Hit> {
  let result: Map<number, Hit> | null = null;
  for (const token of alternative.words) {
    const mode: Mode = alternative.mode === 'auto' ? (known(index, token) ? 'prefix' : 'typo') : alternative.mode;
    const next = new Map<number, Hit>();
    for (const [position, hit] of wordHits(index, token, mode)) {
      if (alternative.category && !index.products[position].categories.includes(alternative.category)) continue;
      const previous: Hit | undefined = result ? result.get(position) : { field: 0, quality: alternative.quality, exact: true };
      if (!previous) continue;
      next.set(position, {
        field: Math.max(previous.field, hit.field) as Field,
        quality: Math.max(previous.quality, hit.quality, alternative.quality) as Quality,
        exact: previous.exact && hit.exact,
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

interface Rank {
  tier: Field;
  quality: Quality;
  sku: boolean;
  skuExact: boolean;
}

function runClauses(index: SearchIndex, clauses: Clause[]): Product[] {
  if (!clauses.length) return [];
  // Potencias pedidas («100w», o el número solo): a igualdad, primero los productos de esa
  // potencia (la única que nombran), antes que un accesorio que la nombra entre otras
  const powers = new Set(
    clauses
      .flatMap(c => c.alternatives[0].words)
      .map(w => Number(/^(\d+(?:\.\d+)?)w?$/.exec(w)?.[1]))
      .filter(n => n > 0),
  );
  let ranked: Map<number, Rank> | null = null;
  for (const clause of clauses) {
    const next = new Map<number, Rank>();
    for (const [position, hit] of clauseHits(index, clause)) {
      const previous: Rank | undefined = ranked ? ranked.get(position) : { tier: 0, quality: 0, sku: false, skuExact: false };
      if (!previous) continue;
      next.set(position, {
        tier: Math.max(previous.tier, hit.field) as Field,
        quality: Math.max(previous.quality, hit.quality) as Quality,
        sku: previous.sku || hit.field === 0,
        skuExact: previous.skuExact || (hit.field === 0 && hit.exact),
      });
    }
    ranked = next;
  }
  const flag = (b: boolean) => (b ? 1 : 0);
  return [...ranked!]
    .map(([position, r]) => ({
      position,
      typo: r.quality === 2,
      tier: r.sku ? 0 : r.tier,
      skuExact: r.skuExact,
      quality: r.quality,
      power: powers.has(index.power[position] ?? NaN),
    }))
    .sort(
      (a, b) =>
        flag(a.typo) - flag(b.typo) ||
        a.tier - b.tier ||
        flag(b.skuExact) - flag(a.skuExact) ||
        a.quality - b.quality ||
        flag(b.power) - flag(a.power) ||
        a.position - b.position,
    )
    .map(r => index.products[r.position]);
}

/** Productos que coinciden con la consulta, en orden de relevancia. Consulta vacía: []. */
export function searchProducts(products: readonly Product[], query: string): Product[] {
  const index = searchIndex(products);
  return runClauses(index, parseQuery(index, query));
}

// ── Sugerencias del encabezado ────────────────────────────────────────────────

/** Un trozo de texto y si coincide con lo escrito (para mostrarlo en negrita). */
export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * El texto (el nombre de un producto) en trozos, con lo que coincide con las palabras de la
 * consulta marcado: cada palabra escrita, al comienzo de una palabra del texto, sin tildes ni
 * mayúsculas («antiva» marca «ANTIVA» en «ANTIVANDÁLICO»). Un número solo marca el mismo número
 * («100» no marca «1000W»). Lo que llegó por sinónimo o con una letra de diferencia no se marca.
 */
export function highlightMatches(text: string, query: string): HighlightPart[] {
  // Normalizado carácter a carácter, con la posición de cada uno en el original
  let normalized = '';
  const origin: number[] = [];
  let at = 0;
  for (const ch of text) {
    const n = normalizeSearchText(ch);
    normalized += n;
    for (let j = 0; j < n.length; j++) origin.push(at);
    at += ch.length;
  }
  origin.push(text.length);
  const marked = new Array<boolean>(text.length).fill(false);
  for (const word of new Set(searchWords(query))) {
    const lone = NUMBER.test(word);
    for (let p = normalized.indexOf(word); p !== -1; p = normalized.indexOf(word, p + 1)) {
      const end = p + word.length;
      if (p > 0 && /[a-z0-9]/.test(normalized[p - 1])) continue;
      if (lone && /[0-9.]/.test(normalized[end] ?? '')) continue;
      marked.fill(true, origin[p], origin[end]);
    }
  }
  const parts: HighlightPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], match: marked[i] });
  }
  return parts;
}

// ── La 404 (B-10) ─────────────────────────────────────────────────────────────

/**
 * Lo que de una consulta larga sí encuentra productos, para precargar el buscador de la 404 con
 * las palabras de la URL (auditoría UX, B-10): la búsqueda exige todas las palabras, y la URL de
 * un producto dado de baja trae su potencia, su medida o su IP, que ya no están. En orden, cada
 * palabra se queda si con ella la búsqueda sigue trayendo productos. Como se escribieron (con
 * tildes) y con las medidas juntas («120 cm»). Sin palabras de una letra, y sin empezar por una de
 * menos de 3 («no» trae cualquier cosa). '' si ninguna encuentra nada o si solo quedan genéricas
 * («led»).
 */
export function searchThatFinds(products: readonly Product[], query: string): string {
  const index = searchIndex(products);
  let kept: string[] = [];
  let specific = false;
  for (const span of searchWordSpans(query)) {
    if (span.word.length < 2 || (!kept.length && span.word.length < 3)) continue;
    const next = [...kept, query.slice(span.start, span.end)];
    if (!runClauses(index, parseQuery(index, next.join(' '))).length) continue;
    kept = next;
    specific ||= !isGeneric(span.word);
  }
  return specific ? kept.join(' ') : '';
}

// ── Sin resultados (B-04) ─────────────────────────────────────────────────────

/**
 * Hasta `max` búsquedas que sí dan resultados, para cuando la consulta no da ninguno: primero lo
 * que dicen los sinónimos de sus palabras («proyector de estadio»), después cada palabra sola
 * (como la escribió el cliente, con sus tildes) y, para completar, las búsquedas populares. Sin
 * repetir búsquedas que traen lo mismo.
 */
export function searchSuggestions(products: readonly Product[], query: string, max = 3): string[] {
  const index = searchIndex(products);
  const clauses = parseQuery(index, query);
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
    const results = runClauses(index, parseQuery(index, candidate));
    const signature = results.map(p => p.id).join('|');
    if (!results.length || resultSets.has(signature)) continue;
    resultSets.add(signature);
    out.push(candidate);
  }
  return out;
}

// El correo prellenado vive en su propio módulo (sin el índice de búsqueda): lo usa también la
// página 404, que va en el trozo de las guías y del catálogo.
export { searchRequestMailto } from './searchMailto';
