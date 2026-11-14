// api/_lib/rut.ts
// Dígito verificador del RUT chileno (módulo 11): una sola fuente para el sitio y las funciones
// de api/. src/lib/rut.ts lo reexporta (formularios /cotizacion y /solicitar-pedido) y el bot de
// WhatsApp lo usa para validar el RUT (api/_lib/whatsapp/rutCapture.ts). Mismo patrón que
// api/_lib/site.ts: el código de api/ no importa nada desde src/ (con "type": "module", una
// función que lo hace no carga en Vercel). Sin imports.
// Desde el 13-11-2026 también viven aquí cleanRut y rutProblem (antes en src/lib/rut.ts, que
// los reexporta): los formularios los usan para avisar junto al campo y el servidor, para el
// aviso «RUT por revisar» de la nota (api/_lib/forms/review.ts), sin rechazar la solicitud.

/** Dígito verificador (módulo 11) de un cuerpo de solo dígitos: '0' a '9' o 'K'. */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  if (rest === 11) return '0';
  if (rest === 10) return 'K';
  return String(rest);
}

/**
 * Caracteres que puede traer un RUT escrito a mano: dígitos, K y separadores (también los
 * guiones tipográficos del celular y el signo menos U+2212 de un RUT copiado de un PDF).
 */
const RUT_CHARS = /^[0-9kK.\-‐‑–—−\s]*$/;

/** Cuerpo de 6 a 8 dígitos (sin ceros a la izquierda) seguido del dígito verificador. */
const CLEAN_RUT = /^([1-9]\d{5,7})([0-9K])$/;

/**
 * Solo el cuerpo agrupado con puntos, sin guion ni dígito verificador ("11.111.111"): falta el
 * dígito verificador. Sin esta regla, el último dígito del cuerpo se leería como el
 * verificador y, en 1 de cada 11 casos, pasaría como otro RUT válido ("76.543.216" → 7.654.321-6).
 */
export const DOTTED_BODY_ONLY = /^\d{1,3}(\.\d{3})+$/;

/**
 * Deja solo los dígitos y la K (en mayúscula), sin puntos, guiones, espacios ni ceros a la
 * izquierda: "44.444.407-k" → "44444407K". Con otros caracteres (letras que no son K),
 * devuelve '' porque no es un RUT. No mira dónde van los puntos: eso lo revisan formatRut y
 * rutProblem.
 */
export function cleanRut(input: string): string {
  if (!RUT_CHARS.test(input)) return '';
  return input.replace(/[^0-9kK]/g, '').toUpperCase().replace(/^0+/, '');
}

/**
 * Por qué un RUT no sirve: vacío, mal escrito (también si le falta el dígito verificador) o
 * con un dígito verificador que no calza.
 */
export type RutProblem = 'empty' | 'format' | 'check_digit';

export function rutProblem(input: string): RutProblem | null {
  if (!input.trim()) return 'empty';
  if (DOTTED_BODY_ONLY.test(input.trim())) return 'format';
  const m = cleanRut(input).match(CLEAN_RUT);
  if (!m) return 'format';
  return rutCheckDigit(m[1]) === m[2] ? null : 'check_digit';
}
