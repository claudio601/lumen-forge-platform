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
  /** Nombre que mostró el sitio: último recurso para identificar el producto (bundles viejos). */
  name?: unknown;
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
  /** La variante enviada ya no existe: se usó el precio base del producto (revisar). */
  variantUnknown?: boolean;
}

/** Línea que no se pudo identificar en el catálogo: NO se rechaza la solicitud. */
export interface UnresolvedLine {
  index: number;
  sku: string;
  name: string;
  quantity: number;
  reason: string;
}

export interface PricingResult {
  /** Líneas con precio de catálogo (mismo orden que la entrada, sin las no identificadas). */
  lines: PricedLine[];
  /** Posición de cada línea con precio en la entrada. */
  lineIndexes: number[];
  /** Líneas que no se pudieron identificar: se informan para revisión, no bloquean. */
  unresolved: UnresolvedLine[];
  /** Suma CON IVA de las líneas con precio. */
  subtotal: number;
  /** Errores de validación (cantidades inválidas): estos sí invalidan la solicitud. */
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

/** Nombre exacto → jumpseller_id, para nombres que usa un solo producto. */
function buildNameLookup(index: Index): Map<string, number> {
  const seen = new Map<string, number | null>();
  for (const [id, entry] of Object.entries(index)) {
    const key = entry.name.trim();
    seen.set(key, seen.has(key) ? null : Number(id));
  }
  const out = new Map<string, number>();
  for (const [name, id] of seen) if (id) out.set(name, id);
  return out;
}

/**
 * Identifica el producto de cada línea: jumpsellerId (preferido); si falta (carritos o
 * bundles viejos), "JS-<id>", un SKU que use un solo producto o el nombre exacto.
 * Calcula el precio CON IVA desde el índice. Una línea que no se puede identificar NO
 * invalida la solicitud: queda en `unresolved` para que el vendedor la revise.
 */
export function priceItems(items: readonly PricingInput[], index: Index = priceIndex): PricingResult {
  const skuLookup = buildSkuLookup(index);
  const nameLookup = buildNameLookup(index);
  const lines: PricedLine[] = [];
  const lineIndexes: number[] = [];
  const unresolved: UnresolvedLine[] = [];
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
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!jumpsellerId && name) jumpsellerId = nameLookup.get(name);

    const quantity = positiveInt(item.quantity);
    if (!quantity || quantity > MAX_QUANTITY) {
      errors.push(`items[${i}].quantity debe ser un entero entre 1 y ${MAX_QUANTITY}`);
      return;
    }
    const entry = jumpsellerId ? index[String(jumpsellerId)] : undefined;
    if (!entry) {
      unresolved.push({ index: i, sku, name, quantity, reason: `producto no identificado (${jumpsellerId ?? (sku || 'sin id')})` });
      return;
    }
    const variant = variantId ? entry.variants[String(variantId)] : undefined;
    const variantUnknown = Boolean(variantId && !variant);
    const unitPrice = variant?.price ?? entry.price;
    lineIndexes.push(i);
    lines.push({
      jumpsellerId: jumpsellerId!,
      ...(variant ? { variantId } : {}),
      sku: variant?.sku || entry.sku || sku || `JS-${jumpsellerId}`,
      name: entry.name,
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      ...(variantUnknown ? { variantUnknown: true } : {}),
    });
  });

  return { lines, lineIndexes, unresolved, subtotal: lines.reduce((s, l) => s + l.lineTotal, 0), errors };
}

/** Precio neto (sin IVA) redondeado, para comparar con lo que mostró el sitio en modo B2B. */
export const netOf = (gross: number) => Math.round(gross / (1 + IVA));
