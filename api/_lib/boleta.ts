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
// El umbral en pesos es fijo por año: 135 UF con la UF del 31 de diciembre del año anterior
// (Res. Ex. SII N° 44 de 2025, resolutivo 3°; el SII lo informa cada diciembre). Cada enero se
// cambian UF_VALUE_CLP y UF_VALUE_DATE (SII, valores y fechas, UF del 31-12): desde el 1 de
// enero api/_lib/boleta.test.ts falla con la UF del año anterior (salvo en el robot del
// catálogo). src/config/business.ts reexporta estas constantes para el sitio.
// ─────────────────────────────────────────────────────────────────────────────

/** Desde cuántas UF (total CON IVA, estrictamente mayor) la boleta de una persona lleva RUT y nombre. */
export const BOLETA_ID_THRESHOLD_UF = 135;

/** UF del 31-12-2025 (sii.cl/valores_y_fechas/uf/uf2025.htm): el umbral de todo 2026. */
export const UF_VALUE_CLP = 39_727.96;

/** Día de UF_VALUE_CLP (AAAA-MM-DD): siempre el 31 de diciembre del año anterior. */
export const UF_VALUE_DATE = '2025-12-31';

/** 135 UF en pesos con la UF de UF_VALUE_DATE: $5.363.275 en 2026. */
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
