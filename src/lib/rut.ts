// src/lib/rut.ts
// RUT chileno: limpiar, dar formato (12.345.678-9) y revisar el dígito verificador
// (módulo 11). Lo usan /cotizacion y /solicitar-pedido en modo empresa (auditoría UX, F-02).
//
// Solo el navegador lo revisa, para avisar junto al campo. El servidor nunca rechaza una
// solicitud por el RUT (perder un lead es peor): api/quotes/create.ts solo lo exige presente
// y api/request-orders/create.ts lo acepta opcional, tal como llega.

import { rutCheckDigit } from '../../api/_lib/rut';

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
const DOTTED_BODY_ONLY = /^\d{1,3}(\.\d{3})+$/;

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

/** Dígito verificador (módulo 11). Una sola fuente, en api/_lib/rut.ts (también la usa el bot). */
export { rutCheckDigit };

/**
 * Formato de presentación: "111111111" o "11.111.111-1" → "11.111.111-1"; la k pasa a K.
 * Lo que no se puede leer como RUT (letras, muy corto, una K al medio, o puntos sin el dígito
 * verificador) vuelve tal como se escribió, sin espacios a los lados, para que la persona lo
 * corrija.
 */
export function formatRut(input: string): string {
  if (DOTTED_BODY_ONLY.test(input.trim())) return input.trim();
  const clean = cleanRut(input);
  const m = clean.match(/^(\d+)([0-9K])$/);
  if (!m) return input.trim();
  const body = m[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${m[2]}`;
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

/** true si el RUT está bien escrito y su dígito verificador calza (K mayúscula o minúscula). */
export function isValidRut(input: string): boolean {
  return rutProblem(input) === null;
}
