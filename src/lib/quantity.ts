// src/lib/quantity.ts
// Cantidad de una línea (auditoría UX, D-03): la ficha, /cotizacion y /solicitar-pedido dejan
// escribirla además de cambiarla con − y +. El servidor recalcula los precios desde el catálogo
// y acepta de 1 a MAX_QUANTITY unidades por línea (api/_lib/catalog/pricing.ts): el sitio no
// deja pasar de ahí, para que una solicitud nunca vuelva con un error por la cantidad.
// Sin imports: lo usan AppContext y RequestCartContext, que van en el bundle principal.

/** Unidades máximas por línea: las mismas del servidor (src/lib/quantity.test.ts lo compara). */
export const MAX_LINE_QUANTITY = 9999;

/** Una cantidad entera de 1 a MAX_LINE_QUANTITY (redondea hacia abajo y corta en los bordes; NaN da 1). */
export function clampQuantity(n: number): number {
  if (Number.isNaN(n)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.floor(n)));
}

/**
 * Lo escrito en el campo → cantidad, o null si no es un entero positivo (vacío, 0, «-», «2,5»,
 * «1e3»). Más de MAX_LINE_QUANTITY queda en el tope.
 */
export function parseQuantity(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 ? Math.min(MAX_LINE_QUANTITY, n) : null;
}
