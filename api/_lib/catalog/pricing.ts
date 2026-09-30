// api/_lib/catalog/pricing.ts
// Precios calculados en el SERVIDOR desde el índice generado por la sincronización con
// Jumpseller (price-index.generated.ts). Nunca se confía en el precio que manda el
// navegador: puede estar desactualizado (carrito guardado en la sesión), en modo neto
// (toggle B2B) o alterado a mano.
//
// Todos los montos son CON IVA (decisión del dueño, 2026-09-30): coinciden con lo que
// cobra el link de pago de Jumpseller.

import { priceIndex, type PriceIndexEntry } from './price-index.generated.js';

export const IVA = 0.19;
export const MAX_QUANTITY = 9999;

export interface PricingInput {
  jumpsellerId?: unknown;
  variantId?: unknown;
  sku?: unknown;
  quantity?: unknown;
}

export interface PricedLine {
  jumpsellerId: number;
  variantId?: number;
  sku: string;
  name: string;
  quantity: number;
  /** Precio unitario CON IVA (CLP). */
  unitPrice: number;
  /** quantity × unitPrice, CON IVA (CLP). */
  lineTotal: number;
}

export interface PricingResult {
  lines: PricedLine[];
  /** Suma CON IVA. */
  subtotal: number;
  errors: string[];
}

type Index = Readonly<Record<string, PriceIndexEntry>>;

/** SKU → [jumpseller_id, variant_id?] para SKUs que usa un solo producto. */
function buildSkuLookup(index: Index): Map<string, { jumpsellerId: number; variantId?: number }> {
  const seen = new Map<string, { jumpsellerId: number; variantId?: number } | null>();
  const add = (sku: string, value: { jumpsellerId: number; variantId?: number }) => {
    if (!sku) return;
    const prev = seen.get(sku);
    if (prev === undefined) seen.set(sku, value);
    else if (prev && prev.jumpsellerId !== value.jumpsellerId) seen.set(sku, null); // ambiguo
  };
  for (const [id, entry] of Object.entries(index)) {
    add(entry.sku, { jumpsellerId: Number(id) });
    for (const [vid, v] of Object.entries(entry.variants)) add(v.sku, { jumpsellerId: Number(id), variantId: Number(vid) });
  }
  const out = new Map<string, { jumpsellerId: number; variantId?: number }>();
  for (const [sku, v] of seen) if (v) out.set(sku, v);
  return out;
}

const positiveInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined;

/**
 * Identifica el producto de cada línea: jumpsellerId (preferido); si falta (carritos
 * viejos), "JS-<id>" o un SKU que use un solo producto. Valida cantidad y variante y
 * calcula el precio CON IVA desde el índice.
 */
export function priceItems(items: readonly PricingInput[], index: Index = priceIndex): PricingResult {
  const skuLookup = buildSkuLookup(index);
  const lines: PricedLine[] = [];
  const errors: string[] = [];

  items.forEach((item, i) => {
    const sku = typeof item.sku === 'string' ? item.sku.trim() : '';
    let jumpsellerId = positiveInt(item.jumpsellerId);
    let variantId = positiveInt(item.variantId);
    if (!jumpsellerId && /^JS-\d+$/.test(sku)) jumpsellerId = Number(sku.slice(3));
    if (!jumpsellerId && sku) {
      const hit = skuLookup.get(sku);
      if (hit) {
        jumpsellerId = hit.jumpsellerId;
        variantId ??= hit.variantId;
      }
    }

    const quantity = positiveInt(item.quantity);
    if (!quantity || quantity > MAX_QUANTITY) {
      errors.push(`items[${i}].quantity debe ser un entero entre 1 y ${MAX_QUANTITY}`);
      return;
    }
    const entry = jumpsellerId ? index[String(jumpsellerId)] : undefined;
    if (!entry) {
      errors.push(`items[${i}]: producto no disponible (${jumpsellerId ?? (sku || 'sin id')})`);
      return;
    }
    const variant = variantId ? entry.variants[String(variantId)] : undefined;
    if (variantId && !variant) {
      errors.push(`items[${i}]: variante no disponible (${jumpsellerId}/${variantId})`);
      return;
    }
    const unitPrice = variant?.price ?? entry.price;
    lines.push({
      jumpsellerId: jumpsellerId!,
      ...(variant ? { variantId } : {}),
      sku: variant?.sku || entry.sku || sku || `JS-${jumpsellerId}`,
      name: entry.name,
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
    });
  });

  return { lines, subtotal: lines.reduce((s, l) => s + l.lineTotal, 0), errors };
}

/** Precio neto (sin IVA) redondeado, para comparar con lo que mostró el sitio en modo B2B. */
export const netOf = (gross: number) => Math.round(gross / (1 + IVA));
