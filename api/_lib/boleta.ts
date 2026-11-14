// api/_lib/boleta.ts
// ─────────────────────────────────────────────────────────────────────────────
// Boleta a personas sobre 135 UF (decisión del dueño, 13-11-2026).
//
// Una persona recibe boleta sin RUT. Si el total de su compra CON IVA supera 135 UF, el SII
// exige identificar al comprador en la boleta: el vendedor le pide RUT y nombre por correo.
// El formulario no cambia; el aviso va bajo «Para revisar» en la nota y en el correo
// (api/_lib/forms/review.ts). El total es siempre el del servidor (api/_lib/catalog/
// pricing.ts), nunca el precio del navegador.
//
// El umbral en pesos usa el valor de la UF de UF_VALUE_DATE (SII, valores y fechas). La UF
// cambia cada día: para un aviso interno basta actualizarla de vez en cuando (sube cerca de
// un 4 % al año). src/config/business.ts reexporta estas constantes para el sitio.
// ─────────────────────────────────────────────────────────────────────────────

/** Desde cuántas UF (total CON IVA, estrictamente mayor) la boleta de una persona lleva RUT y nombre. */
export const BOLETA_ID_THRESHOLD_UF = 135;

/** Valor de la UF usado para el umbral en pesos (SII y mindicador.cl, 13-11-2026). */
export const UF_VALUE_CLP = 41_322.93;

/** Día de UF_VALUE_CLP (AAAA-MM-DD). */
export const UF_VALUE_DATE = '2026-11-13';

/** 135 UF en pesos con el valor de UF_VALUE_DATE: $5.578.596 (el dueño estimó ≈ $5,58 millones con IVA). */
export const BOLETA_ID_THRESHOLD_CLP = Math.round(BOLETA_ID_THRESHOLD_UF * UF_VALUE_CLP);

/** true si una persona con este total CON IVA (del servidor) necesita RUT y nombre en la boleta. */
export function personaNeedsBoletaId(customerType: unknown, totalWithVatClp: unknown): boolean {
  return (
    customerType === 'persona' &&
    typeof totalWithVatClp === 'number' &&
    Number.isFinite(totalWithVatClp) &&
    totalWithVatClp > BOLETA_ID_THRESHOLD_CLP
  );
}
