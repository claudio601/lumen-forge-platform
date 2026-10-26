// api/_lib/whatsapp/rutCapture.ts
// Bot de WhatsApp, PR 6 del plan (B12): cuando un texto trae un RUT, y de que tipo es.
//
// Antes cualquier numero de 8 o 9 digitos pasaba como RUT, aunque viniera dentro de un correo
// (prueba.20261026@...), fuera un celular o un numero de pedido, y sin revisar el digito
// verificador. Ademas, ese "RUT" marcaba el lead como empresa (B2B).
//
// Ahora un RUT se reconoce solo:
//   1. si trae guion y digito verificador ("76.123.456-0", "76123456-0");
//   2. si viene despues de la palabra "RUT", aunque traiga espacios ("RUT 77 431 900 K");
//   3. si responde a la pregunta por el RUT (asked): ahi basta el numero solo ("761234560").
// Los correos y enlaces se sacan del texto antes de buscar. Lo reconoce el codigo, no Claude:
// el RUT no se agrega a lo que extrae Claude (politica de privacidad, datos que se piden).

import { formatRut, rutCheckDigit } from '../../../src/lib/rut';

export type RutTipo = 'empresa' | 'persona' | 'organismo_publico' | 'comunidad';

export interface RutFound {
  /** Con formato NN.NNN.NNN-D (K mayuscula). */
  rut: string;
  /** El digito verificador calza (modulo 11). */
  valido: boolean;
  /** Solo si es valido. */
  tipo?: RutTipo;
}

// Guion comun y los tipograficos del celular o de un PDF (igual que src/lib/rut.ts).
const DASH = '[-‐‑–—−]';
// Cuerpo de 7 u 8 digitos, con puntos (76.123.456, 7.654.321) o sin ellos.
const BODY = '\\d{1,2}(?:\\.\\d{3}){2}|\\d{7,8}';
const WITH_DASH_RE = new RegExp(`(?<![\\d.])(${BODY})\\s?${DASH}\\s?([0-9kK])(?![0-9a-zA-Z])`, 'g');
// Despues de "RUT" (o "R.U.T."), con relleno opcional ("es", "de la empresa", ":", "n°").
const KEYWORD_RE = new RegExp(
  `\\bR\\.?U\\.?T\\b\\.?(?:\\s*(?:es|de\\s+la\\s+empresa|empresa|:|#|n[°º.]?|nro\\.?))*\\s*` +
    `([0-9][0-9.\\s]{5,12}[0-9])\\s*${DASH}?\\s*([0-9kK])(?![0-9a-zA-Z])`,
  'gi',
);
// Solo cuando el bot pidio el RUT: el numero solo, con o sin puntos.
const BARE_RE = /(?<![\d.+])(\d{1,2}(?:\.\d{3}){2}|\d{7,8})\s?([0-9kK])(?![0-9a-zA-Z])/g;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

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
  return { rut: formatRut(body + dv), valido, ...(valido ? { tipo: rutTipo(Number(body)) } : {}) };
}

function candidates(text: string, re: RegExp): RutFound[] {
  return [...text.matchAll(re)].map((m) => toFound(m[1], m[2])).filter((f): f is RutFound => Boolean(f));
}

/**
 * El RUT que trae el texto, o undefined. Si hay varios, gana el primero valido y, si ninguno lo
 * es, el primero. `asked`: el ultimo mensaje del bot pidio el RUT.
 */
export function findRut(text: string, options: { asked?: boolean } = {}): RutFound | undefined {
  const clean = text.replace(EMAIL_RE, ' ').replace(URL_RE, ' ');
  for (const re of [WITH_DASH_RE, KEYWORD_RE, ...(options.asked ? [BARE_RE] : [])]) {
    const found = candidates(clean, re);
    if (found.length > 0) return found.find((f) => f.valido) ?? found[0];
  }
  return undefined;
}

/** Solo un RUT valido de empresa (no de persona) convierte el lead en B2B. */
export function isBusinessRut(found: Pick<RutFound, 'valido' | 'tipo'> | undefined): boolean {
  return Boolean(found?.valido && found.tipo && found.tipo !== 'persona');
}
