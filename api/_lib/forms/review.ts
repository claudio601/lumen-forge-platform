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
//   - Revisar cantidad: el comentario menciona una cantidad distinta de las elegidas
//     (api/_lib/forms/quantityMentions.ts; /solicitar-pedido y /cotizacion).
//   - Persona sobre 135 UF: el total CON IVA del servidor supera BOLETA_ID_THRESHOLD_CLP
//     (api/_lib/boleta.ts) y la boleta debe llevar RUT y nombre del comprador.
//   - Posible duplicado: la misma persona tiene un negocio abierto del otro canal (web o
//     WhatsApp) creado en los últimos 7 días (api/_lib/pipedrive/crossChannel.ts). Solo en la
//     nota y antes de los demás: el correo de /cotizacion y /cotizador sale antes de Pipedrive.
//
// Los avisos nunca van al log: llevan datos del cliente (y el RUT no se escribe en el log).
// ─────────────────────────────────────────────────────────────────────────────

import { BOLETA_ID_THRESHOLD_UF, personaNeedsBoletaId } from '../boleta.js';
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
 * «Persona sobre 135 UF: …» si el comprador es una persona y el total CON IVA calculado en
 * el servidor supera el umbral; null si no (empresa, sin tipo o sin total).
 */
export function boletaReviewItem(customerType: unknown, totalWithVatClp: unknown): string | null {
  return personaNeedsBoletaId(customerType, totalWithVatClp)
    ? `Persona sobre ${BOLETA_ID_THRESHOLD_UF} UF: pedir RUT y nombre por correo para la boleta`
    : null;
}

/**
 * Inserta el bloque después de la primera línea de un texto de correo (la referencia), con
 * una línea en blanco antes. Sin avisos devuelve las líneas tal cual.
 */
export function afterFirstLine(lines: readonly string[], section: readonly string[]): string[] {
  if (!section.length || !lines.length) return [...lines];
  return [lines[0], '', ...section, ...lines.slice(1)];
}
