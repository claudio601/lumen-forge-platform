// src/lib/quoteLine.ts
// Identidad de una línea de la cotización (AppContext): un mismo producto en dos variantes
// distintas son líneas separadas. La variante se identifica por su id de Jumpseller (v…) o,
// en las líneas guardadas antes del selector genérico (2026-10-21), por su temperatura de color.
// Aparte del contexto: un archivo de componentes solo exporta componentes (Fast Refresh).

export const quoteLineKey = (productId: string, cct?: number, variantId?: number) =>
  `${productId}::${variantId != null ? `v${variantId}` : (cct ?? '')}`;

/** Identidad de una línea de la cotización (ver quoteLineKey). */
export const quoteItemKey = (item: { product?: { id?: string }; cct?: number; variantId?: number }) =>
  quoteLineKey(item.product?.id ?? '', item.cct, item.variantId);
