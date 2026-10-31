// api/_lib/whatsapp/comunas.ts
// [COMUNA] La comuna que el cliente da, solo de la lista oficial (comunas.generated.ts) y solo cuando
// el texto la presenta como lugar: despues de una frase de ubicacion ("en Lampa", "para una bodega en
// Lampa", "soy de Maipu", "despacho a Temuco") o como respuesta a la pregunta por la comuna ("Lampa",
// "Maipu, Region Metropolitana"). Antes cualquier palabra de una lista de 29 ciudades, o la que
// devolviera Claude, pasaba por comuna: "santiago.prueba@...", "Av. Santiago Bueras 1234" o la
// "direccion de retiro" (Retiro es una comuna del Maule).
import { COMUNAS } from './comunas.generated.js';

/** Nombres alternativos que la gente escribe (y los que la fuente traia mal). */
const ALIASES: Record<string, string> = {
  'santiago centro': 'Santiago',
  'santiago de chile': 'Santiago',
  'stgo': 'Santiago',
  'stgo centro': 'Santiago',
  'coihaique': 'Coyhaique',
  'paiguano': 'Paihuano',
  'treguaco': 'Trehuaco',
  'calera': 'La Calera',
  'vichuque': 'Vichuqu\u00e9n',
  'til til': 'Tiltil',
  'llay llay': 'Llaillay',
  'marchigue': 'Marchihue',
  'aisen': 'Ays\u00e9n',
  'puerto aysen': 'Ays\u00e9n',
  'puerto aisen': 'Ays\u00e9n',
  'rapa nui': 'Isla de Pascua',
  'puerto natales': 'Natales',
  'vina': 'Vi\u00f1a del Mar',
  'valpo': 'Valpara\u00edso',
  'conce': 'Concepci\u00f3n',
  'pto montt': 'Puerto Montt',
  'pto varas': 'Puerto Varas',
  'pta arenas': 'Punta Arenas',
  'chol chol': 'Cholchol',
  'san jose de la mariquina': 'Mariquina',
};

// Comunas que tambien son palabras comunes ("la granja", "nogales", "caldera"): fuera de la respuesta
// a la pregunta por la comuna, cuentan solo si llevan alguna mayuscula ("en Victoria", "la Granja").
const COMMON_WORD = new Set([
  'Retiro', 'Primavera', 'Navidad', 'Porvenir', 'Victoria', 'Florida', 'Independencia', 'Recoleta', 'Placilla',
  'Coronel', 'Corral', 'Olivar', 'El Monte', 'La Granja', 'La Estrella', 'La Uni\u00f3n', 'Los Lagos', 'R\u00edo Verde',
  'Laguna Blanca', 'La Cruz', 'Nogales', 'Camarones', 'Pica', 'Mejillones', 'Caldera', 'La Higuera', 'Vicu\u00f1a',
  'Canela', 'Calle Larga', 'Rinconada', 'Cabildo', 'Algarrobo', 'Paredones', 'Constituci\u00f3n', 'Empedrado',
  'Molina', 'Pinto', 'Cabrero', 'Laja', 'Lota', 'Teno', 'El Carmen', 'Sagrada Familia', 'Yerbas Buenas',
  'Villa Alegre', 'Romeral', 'Nacimiento', 'Negrete', 'Portezuelo', 'Lago Verde', 'Cisnes', 'Salamanca',
]);
// Las que casi siempre son otra cosa ("direccion de retiro", "para Navidad", "en primavera"): solo como
// respuesta a la pregunta por la comuna o despues de "comuna de".
const ANSWER_ONLY = new Set(['Retiro', 'Navidad', 'Primavera', 'Porvenir']);
// Alias que tambien son palabras comunes ("una vina", "la calera"): igual que COMMON_WORD.
const COMMON_ALIAS = new Set(['vina', 'calera']);

/** Minusculas, sin tildes, sin apostrofes ni puntos, y con un espacio entre palabras. */
export function comunaKey(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['\u2019\u00b4`]/g, '').replace(/[.-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const BY_KEY = new Map<string, string>();
for (const [, name] of COMUNAS) BY_KEY.set(comunaKey(name), name);
for (const [alias, name] of Object.entries(ALIASES)) BY_KEY.set(alias, name);

/** El nombre oficial de una comuna escrita sola ("nunoa", "Santiago Centro", "Til Til"), o undefined. */
export function officialComuna(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 60) return undefined;
  return BY_KEY.get(comunaKey(value));
}

// Una alternativa por nombre, de la mas larga a la mas corta: "San Pedro de la Paz" antes que "San
// Pedro" y "La Florida" antes que "Florida". Entre palabras acepta espacios, puntos o guiones ("Pto.
// Montt", "Llay-Llay"), y el apostrofe es opcional ("OHiggins").
const PATTERN = [...BY_KEY.keys()]
  .sort((a, b) => b.length - a.length)
  .map((key) => key.split(' ').map((w) => w.replace(/^o(higgins)$/, "o['\u2019]?$1")).join('[\\s.\\-]+'))
  .join('|');
const COMUNA_RE = new RegExp('(?<![\\p{L}\\p{N}@._/])(?:' + PATTERN + ')(?![\\p{L}\\p{N}@_/]|\\.[\\p{L}\\p{N}])', 'giu');

// La palabra que presenta un lugar justo antes de la comuna ("en", "de", "para", "desde", "comuna de",
// "ciudad:", "despacho a", "enviar a").
const LOCATION_BEFORE_RE = /(?:(?<![\p{L}])(?:en|de|del|para|desde|hacia|sector)|(?:comuna|ciudad|localidad)\s*(?::|\ba\b|\bes\b)?|(?:despach|envi|env\u00ed|mand|llev)[\p{L}]*\s+(?:(?:el|los|las|la|lo|pedido|productos?)\s+){0,2}a)\s+$/iu;
const COMUNA_DE_RE = /comuna\s*(?::|de|\ba\b|\bes\b)?\s*$/i;
// Lo que puede ir antes de la comuna cuando contesta la pregunta ("Lampa", "Soy de Maipu", "En la comuna de Lampa").
const ANSWER_LEAD_RE = /^(?:(?:hola|ok|si|s\u00ed|bueno|y|soy|somos|estoy|estamos|es|ser[i\u00ed]a|queda|quedar[i\u00ed]a|vivo|desde|en|de|del|la|el|comuna|ciudad|para)\s+)*$/iu;
// Calle o direccion: "Av. Santiago Bueras", "calle Providencia", "pasaje Lampa".
const STREET_BEFORE_RE = /(?<![\p{L}])(?:av|avda|avenida|calle|pasaje|psje|pje|camino|ruta|villa|poblaci[o\u00f3]n|pobl|condominio|parcela|plaza|paseo|esquina|esq)\b\.?\s+(?:(?!(?:en|para|desde|hacia|comuna)\s)[\p{L}'.]+\s+){0,3}$/iu;
// "Providencia 1234", "Santiago Bueras 1234, Lampa", "Lampa #120": el numero de una direccion, no una cantidad.
const STREET_AFTER_RE = /^(?:\s+[\p{Lu}][\p{L}'.]*){0,2}\s*(?:#|n[\u00b0\u00ba.]|nro\.?|n[u\u00fa]mero)?\s*\d{1,5}(?=\s*(?:$|[,;.\n)]|-|(?:depto|dpto|departamento|of|oficina|piso|casa|local|block|torre|villa|comuna)\b))/iu;
// "Region de Valparaiso", "Provincia de Santiago", "Gran Santiago": no son la comuna.
const REGION_BEFORE_RE = /(?:regi[o\u00f3]n|provincia|gran)\s+(?:(?:de|del)\s+)?(?:la\s+)?$/i;
// Retirar en la bodega o la sucursal de la tienda no es el lugar del cliente: "retiro en Quinta Normal",
// "tienen sucursal en Concepcion?", "hay tienda en Maipu?".
const PICKUP_BEFORE_RE = /retir[\p{L}]*\s+(?:(?:el|los|la|las|en\s+la|en\s+su)\s+)?(?:bodega\s+)?(?:en|de|desde)\s+$/iu;
const BRANCH_RE = /(?:sucursal|showroom|sala\s+de\s+ventas|(?:tienen|tiene|tendr[a\u00e1]n|hay)\s+(?:una?\s+|alg[u\u00fa]n[ao]?\s+)?(?:tienda|local|oficina|bodega)s?)(?![\p{L}])/iu;

// La comuna de la factura o de la casa matriz ("la facturacion en Vina del Mar", "factura a nombre de la
// empresa de Las Condes"): es otra comuna mencionada, no la de la instalacion.
const BILLING_BEFORE_RE = /(?:factur[\p{L}]*|boleta|domicilio(?:\s+comercial)?|casa\s+matriz|oficina\s+central)\s*(?::|(?:(?:es|va|sale|ser[a\u00e1]|queda)\s+)?(?:a\s+nombre\s+de\s+(?:[\p{L}.]+\s+){0,5}?)?(?:en|de|desde|a|para))\s+$/iu;

/** El tramo de `text` desde el ultimo corte de clausula antes de `index`. */
function clauseBefore(text: string, index: number): string {
  const head = text.slice(Math.max(0, index - 80), index);
  const cut = Math.max(...[',', '.', ';', ':', '\n', '!', '?', '\u00bf', '\u00a1', '(', ')'].map((c) => head.lastIndexOf(c)));
  return head.slice(cut + 1);
}
/** La oracion que contiene `index` es una pregunta ("?" antes del punto siguiente o "" antes). */
function inQuestion(text: string, index: number): boolean {
  const start = Math.max(text.lastIndexOf('.', index), text.lastIndexOf('\n', index), text.lastIndexOf('!', index));
  const ends = [text.indexOf('.', index), text.indexOf('\n', index), text.indexOf('!', index)].filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  const sentence = text.slice(start + 1, end);
  return sentence.includes('?') || sentence.includes('\u00bf');
}

export interface ComunaMention {
  name: string;
  /** La comuna de la factura o la casa matriz, no la de la instalacion. */
  billing: boolean;
}

export interface ComunaOptions {
  /** El bot acaba de preguntar la comuna: tambien vale el nombre solo, al inicio de una clausula. */
  answering?: boolean;
}

/** [COMUNA] Los nombres de findComunaMentions. */
export function findComunas(text: string, opts: ComunaOptions = {}): string[] {
  return findComunaMentions(text, opts).map((m) => m.name);
}

/**
 * [COMUNA] Las comunas que el texto presenta como lugar, con su nombre oficial y sin repetir, en el
 * orden en que aparecen. El texto debe venir sin correos ni razon social (factsText).
 */
export function findComunaMentions(text: string, opts: ComunaOptions = {}): ComunaMention[] {
  const found: ComunaMention[] = [];
  const bare = [...text].map((c) => {
    const b = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return b.length === c.length ? b : c;
  }).join('');
  for (const m of bare.matchAll(COMUNA_RE)) {
    const key = comunaKey(m[0]);
    const name = BY_KEY.get(key);
    if (!name || found.some((f) => f.name === name)) continue;
    const start = m.index;
    const written = text.slice(start, start + m[0].length);
    const before = text.slice(Math.max(0, start - 80), start);
    const clause = clauseBefore(text, start);
    const after = text.slice(start + m[0].length, start + m[0].length + 60);
    if (STREET_BEFORE_RE.test(clause) || STREET_AFTER_RE.test(after)) continue;
    if (REGION_BEFORE_RE.test(before) || PICKUP_BEFORE_RE.test(before)) continue;
    if (inQuestion(text, start) && BRANCH_RE.test(clause)) continue;
    const answer = Boolean(opts.answering) && ANSWER_LEAD_RE.test(clause.trimStart());
    const anchored = LOCATION_BEFORE_RE.test(before);
    if (ANSWER_ONLY.has(name) ? !answer && !COMUNA_DE_RE.test(before) : !answer && !anchored) continue;
    if (!answer && (COMMON_WORD.has(name) || COMMON_ALIAS.has(key)) && !/\p{Lu}/u.test(written)) continue;
    found.push({ name, billing: BILLING_BEFORE_RE.test(before) });
  }
  return found;
}
