// api/_lib/whatsapp/rutCapture.ts
// Bot de WhatsApp, PR 6 del plan (B12): cuando un texto trae un RUT, y de que tipo es.
//
// Antes cualquier numero de 8 o 9 digitos pasaba como RUT, aunque viniera dentro de un correo
// (prueba.20261026@...), fuera un celular o un numero de pedido, y sin revisar el digito
// verificador. Ademas, ese "RUT" marcaba el lead como empresa (B2B).
//
// Ahora un RUT se reconoce solo:
//   1. si trae guion y digito verificador ("76.123.456-0", "76123456-0", "76 123 456-0");
//   2. si viene despues de la palabra "RUT", aunque traiga espacios ("RUT 77 431 900 K");
//   3. si responde a la pregunta por el RUT (asked): ahi basta el numero solo ("761234560").
// En los tres casos el cuerpo tiene que tener la forma de un RUT: con puntos o espacios, agrupado
// como NN.NNN.NNN ("76.543.216" sin digito verificador no es "7.654.321-6"); seguido, de 7 u 8
// digitos. No cuentan los rangos de montos ("1.000.000-2.000.000"), el ID de una licitacion
// ("1057501-9-LE24"), lo que sigue a "$" o "+56", ni (con asked) un numero que se anuncia como
// celular, pedido o monto. Los correos y enlaces se sacan del texto antes de buscar. Lo reconoce
// el codigo, no Claude: el RUT no se agrega a lo que extrae Claude (politica de privacidad,
// datos que se piden).

import { rutCheckDigit } from '../rut.js';

export type RutTipo = 'empresa' | 'persona' | 'organismo_publico' | 'comunidad';

export interface RutFound {
  /** Con formato NN.NNN.NNN-D (K mayuscula). */
  rut: string;
  /** El digito verificador calza (modulo 11). */
  valido: boolean;
  /** Solo si es valido. */
  tipo?: RutTipo;
}

/**
 * El ejemplo de la repregunta (MSG_RUT_INVALID en flowEngine.ts). Calza el digito verificador:
 * si el cliente lo copia, no se toma como su RUT.
 */
export const RUT_EXAMPLE = '12.345.678-5';

// Mensajes de WhatsApp de hasta 4.096 caracteres; lo que sigue no se revisa.
const MAX_TEXT = 4096;

// Guion comun y los tipograficos del celular o de un PDF (los de src/lib/rut.ts, mas U+2012).
const DASH = '[-‐‑‒–—−]';
const SPACE = '[ \\u00a0]';
// Cuerpo de 7 u 8 digitos: agrupado con puntos, espacios o comas (76.123.456, 76 123 456),
// siempre como NN.NNN.NNN, o seguido.
const BODY = `\\d{1,2}(?:\\.\\d{3}){2}|\\d{1,2}(?:${SPACE}\\d{3}){2}|\\d{1,2}(?:,\\d{3}){2}|\\d{7,8}`;
// Antes del cuerpo no puede venir otro digito, punto o coma (es parte de otro numero), un guion
// (un codigo: "LE24-1057501-9") ni "$" o "+" (un monto o un telefono).
const NOT_AFTER = `(?<![\\d.,$+]|${DASH}|[$+]${SPACE}*)`;
// Lo mismo y, para el numero solo, tampoco el codigo de pais ("+56 912345678").
const NOT_AFTER_BARE = `(?<![\\d.,$+]|${DASH}|[$+]${SPACE}*|\\+?56${SPACE}+)`;
// Despues del digito verificador no puede venir otra letra o digito, un punto o una coma con
// mas digitos ("1.000.000-2.000.000"), otro guion ("1057501-9-LE24") ni "millones" o "pesos".
const END = `(?![0-9a-z]|[.,]\\d|${DASH}|\\s*(?:mill|lucas|pesos|clp\\b|uf\\b|mm\\b))`;

const WITH_DASH_RE = new RegExp(
  `${NOT_AFTER}(${BODY})(${SPACE}{0,2}${DASH}${SPACE}{0,2})([0-9k])${END}`,
  'gi',
);
// Despues de "RUT" (o "R.U.T."), con un relleno corto de palabras conocidas ("es", "de la
// empresa", ":", "n°"). Una palabra que no esta en la lista corta el relleno: en "Rut Perez, cel
// 912345678" (un nombre y su celular) no hay RUT.
const FILLER =
  'es|era|ser[ií]a|el|la|los|las|de|del|mi|mis|nuestra|nuestro|su|sus|para|empresa|' +
  'compa[ñn][ií]a|sociedad|constructora|instituci[oó]n|municipalidad|cliente|' +
  'facturaci[oó]n|factura|n[°º.]|nro\\.?';
const SEP = '[\\s:#,]*';
const KEYWORD_RE = new RegExp(
  `\\b(R\\.?U\\.?T)\\b(\\.?(?:${SEP}(?:${FILLER})(?![a-zà-ÿ]))*${SEP})` +
    `(${BODY})(${SPACE}{0,2}${DASH}?${SPACE}{0,2})([0-9k])${END}`,
  'gi',
);
// Solo cuando el bot pidio el RUT: el numero solo, con o sin puntos.
const BARE_RE = new RegExp(`${NOT_AFTER_BARE}(${BODY})(${SPACE}?)([0-9k])${END}`, 'gi');

// Palabras que anuncian otra cosa justo antes del numero (sin digitos entre medio).
const BEFORE = (words: string) => new RegExp(`(?:(?<![a-zà-ÿ])(?:${words})(?![a-zà-ÿ])|\\$)[^\\d\\n;]{0,15}$`, 'i');
// Un monto ("presupuesto 1.500.000-2.000.000"), para el RUT con guion.
const AMOUNT_BEFORE = BEFORE('presupuesto|monto|pesos|clp');
// Para el numero solo: ademas un telefono, un pedido o un precio.
const NOT_RUT_BEFORE = BEFORE(
  'presupuesto|monto|pesos|clp|uf|total|valor|precio|cel|celu|celular|fono|tel|tel[eé]fono|' +
    'whats?app|wsp|wasap|m[oó]vil|ll[aá]m[ae]me|llamar|pedido|orden|oc|folio|boleta|cotizaci[oó]n',
);

/**
 * Tipo segun el numero (especificacion del bot, §4.5): menos de 50.000.000 es persona; 60, 61 y
 * 69 millones, organismo publico; 53 y 56 millones, comunidad; el resto, empresa.
 */
export function rutTipo(body: number): RutTipo {
  if (body < 50_000_000) return 'persona';
  const millones = Math.floor(body / 1_000_000);
  if (millones === 60 || millones === 61 || millones === 69) return 'organismo_publico';
  if (millones === 53 || millones === 56) return 'comunidad';
  return 'empresa';
}

function toFound(rawBody: string, rawDv: string): RutFound | undefined {
  const body = rawBody.replace(/\D/g, '').replace(/^0+/, '');
  if (body.length < 7 || body.length > 8) return undefined;
  const dv = rawDv.toUpperCase();
  const valido = rutCheckDigit(body) === dv;
  const rut = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
  return { rut, valido, ...(valido ? { tipo: rutTipo(Number(body)) } : {}) };
}

/**
 * Sin correos ni enlaces, por palabra (sin expresiones que retrocedan: un mensaje largo sin
 * espacios no se demora). En "77.123.456-9,compras@x.cl" solo se borra el correo.
 */
function withoutContacts(text: string): string {
  return text
    .slice(0, MAX_TEXT)
    .split(/(\s+)/)
    .map((word) => {
      const noUrl = word.replace(/(?:https?:\/\/|www\.)\S*/gi, ' ');
      if (!noUrl.includes('@')) return noUrl;
      return noUrl
        .split(/([^a-zA-Z0-9._%+@-]+)/)
        .map((part) => (part.includes('@') ? ' ' : part))
        .join('');
    })
    .join('');
}

/** Un celular escrito seguido: 9 digitos que empiezan con 9 ("912345678"). */
function mobileShaped(body: string, sep: string): boolean {
  return sep === '' && /^9\d{7}$/.test(body);
}

type Source = 'dash' | 'keyword' | 'bare';
interface Candidate extends RutFound {
  source: Source;
  index: number;
}

function candidates(clean: string, asked: boolean): Candidate[] {
  const out: Candidate[] = [];
  const add = (source: Source, index: number, found: RutFound | undefined) => {
    if (found && found.rut !== RUT_EXAMPLE) out.push({ ...found, source, index });
  };
  for (const m of clean.matchAll(WITH_DASH_RE)) {
    if (AMOUNT_BEFORE.test(clean.slice(Math.max(0, m.index - 40), m.index))) continue;
    add('dash', m.index, toFound(m[1], m[3]));
  }
  for (const m of clean.matchAll(KEYWORD_RE)) {
    // "Rut 987654321": el nombre Rut y un celular. Un RUT que empieza con 9 y va seguido se
    // acepta con "RUT" en mayusculas o con algo entre medio ("Rut: 965432107", "rut es ...").
    const explicit = m[1] === 'RUT' || m[1].includes('.') || m[2].trim() !== '';
    if (!explicit && mobileShaped(m[3], m[4])) continue;
    add('keyword', m.index, toFound(m[3], m[5]));
  }
  if (asked) {
    for (const m of clean.matchAll(BARE_RE)) {
      if (NOT_RUT_BEFORE.test(clean.slice(Math.max(0, m.index - 40), m.index))) continue;
      // Un celular escrito seguido solo pasa por RUT si es todo el mensaje (sin el correo).
      if (mobileShaped(m[1], m[2])) {
        const rest = clean.slice(0, m.index) + clean.slice(m.index + m[0].length);
        if (/[0-9a-zà-ÿ]/i.test(rest)) continue;
      }
      add('bare', m.index, toFound(m[1], m[3]));
    }
  }
  return out;
}

const SOURCE_ORDER: Record<Source, number> = { keyword: 0, dash: 1, bare: 2 };

/**
 * El RUT que trae el texto, o undefined. Si hay varios, gana el primero valido que no es de
 * persona, despues el primero valido y, si ninguno lo es, el que viene despues de la palabra
 * "RUT", el que trae guion y el numero solo, en ese orden. `asked`: el ultimo mensaje del bot
 * pidio el RUT.
 */
export function findRut(text: string, options: { asked?: boolean } = {}): RutFound | undefined {
  const all = candidates(withoutContacts(text), Boolean(options.asked));
  const rank = (c: Candidate) => (isBusinessRut(c) ? 0 : c.valido ? 1 : 2 + SOURCE_ORDER[c.source]);
  const best = all.sort((a, b) => rank(a) - rank(b) || a.index - b.index)[0];
  if (!best) return undefined;
  return { rut: best.rut, valido: best.valido, ...(best.tipo ? { tipo: best.tipo } : {}) };
}

/** Solo un RUT valido de empresa (no de persona) convierte el lead en B2B. */
export function isBusinessRut(found: Pick<RutFound, 'valido' | 'tipo'> | undefined): boolean {
  return Boolean(found?.valido && found.tipo && found.tipo !== 'persona');
}
