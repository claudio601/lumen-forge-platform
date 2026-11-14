// api/_lib/forms/review.ts
// ─────────────────────────────────────────────────────────────────────────────
// Avisos internos «Para revisar» de las solicitudes web (decisiones del dueño, 13-11-2026).
// Van juntos al comienzo de la nota del negocio en Pipedrive, para que el dueño los vea
// primero, y en el correo a ventas justo después de la primera línea (la que identifica el
// flujo y la referencia). Nunca rechazan una solicitud ni la cambian: solo avisan.
//
//   - RUT por revisar: el RUT de empresa no tiene forma de RUT o su dígito verificador
//     (módulo 11, api/_lib/rut.ts) no calza. El servidor no rechaza por el RUT a propósito
//     (perder un lead es peor).
//
// Los avisos nunca van al log: llevan datos del cliente (y el RUT no se escribe en el log).
// ─────────────────────────────────────────────────────────────────────────────

import { rutProblem } from '../rut.js';

/** Encabezado del bloque, en la nota y en el correo. */
export const REVIEW_HEADING = 'Para revisar:';

/**
 * El bloque «Para revisar» con una línea por aviso y una línea en blanco al final, o nada si
 * no hay avisos (la nota y el correo quedan como antes).
 */
export function reviewSection(items: readonly (string | null | undefined)[]): string[] {
  const lines = items.filter((item): item is string => Boolean(item));
  return lines.length ? [REVIEW_HEADING, ...lines.map((line) => `- ${line}`), ''] : [];
}

/**
 * «RUT por revisar: …» si el RUT de empresa vino escrito y no sirve; null si calza o si no
 * vino (en /solicitar-pedido y /cotizador es opcional).
 */
export function rutReviewItem(rut: unknown): string | null {
  if (typeof rut !== 'string' || !rut.trim()) return null;
  const problem = rutProblem(rut);
  if (problem === 'check_digit') return 'RUT por revisar: dígito verificador no calza';
  if (problem === 'format') return 'RUT por revisar: no tiene formato de RUT (12.345.678-9)';
  return null;
}

/**
 * Inserta el bloque después de la primera línea de un texto de correo (la referencia), con
 * una línea en blanco antes. Sin avisos devuelve las líneas tal cual.
 */
export function afterFirstLine(lines: readonly string[], section: readonly string[]): string[] {
  if (!section.length || !lines.length) return [...lines];
  return [lines[0], '', ...section, ...lines.slice(1)];
}
