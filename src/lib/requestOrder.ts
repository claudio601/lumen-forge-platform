// src/lib/requestOrder.ts
// Utilidades para el flujo de Solicitud de Pedido.
// buildRequestRef: genera referencia idempotente RC-xxxxx (hash djb2, ventana 1h).

import type { RequestCartItem, RequestOrderItem } from '@/types/request-order';
import type { Product } from '@/data/catalog/types';

// ── Hash djb2 ────────────────────────────────────────────────────────────────
/** Genera un hash djb2 del string input y retorna en base36 */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ── Referencia de solicitud ───────────────────────────────────────────────────
/**
 * Genera una referencia idempotente para la solicitud de pedido.
 * Formato: RC-xxxxx (5-8 chars, base36)
 * Ventana de dedup: 1 hora (igual que buildQuoteRef)
 * Regex valido: /^RC-[a-z0-9]{5,8}$/i
 */
export function buildRequestRef(email: string, items: RequestCartItem[]): string {
  // productId además del SKU: en Jumpseller hay SKUs repetidos entre productos distintos.
  const skus = items
    .map((i) => i.productId + ':' + i.sku + 'x' + i.quantity)
    .sort()
    .join(',');
  const win = Math.floor(Date.now() / 3_600_000); // ventana de 1 hora
  const raw = [email.toLowerCase(), skus, win].join('|');
  return 'RC-' + djb2(raw);
}

// ── Mapeo de RequestCartItem a RequestOrderItem ──────────────────────────────
/**
 * Convierte un RequestCartItem del frontend al formato RequestOrderItem
 * que espera el endpoint. Calcula lineTotal = quantity * unitPrice.
 */
export function cartItemToOrderItem(item: RequestCartItem): RequestOrderItem {
  return {
    jumpsellerId: item.jumpsellerId,
    variantId: item.variantId,
    priceMode: item.priceMode,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    currency: 'CLP',
    lineTotal: item.quantity * item.unitPrice,
    url: item.url,
    attributes: item.attributes,
  };
}

// ── Líneas del Request Cart ─────────────────────────────────────────────────
/** Identidad de una línea: el mismo producto en dos colores de luz son dos líneas. */
export function requestLineKey(item: Pick<RequestCartItem, 'productId' | 'variantId' | 'sku'>): string {
  return `${item.productId}::${item.variantId ?? item.sku}`;
}

export interface ReconcileResult {
  items: RequestCartItem[];
  /** Nombres de productos que ya no se publican (se quitan del carrito). */
  removed: string[];
  /** Líneas cuyo precio cambió respecto del guardado. */
  repriced: number;
  changed: boolean;
}

/**
 * Pone al día un carrito guardado en la sesión contra el catálogo vigente: quita
 * productos que ya no se publican, completa ids de Jumpseller (carritos viejos) y
 * actualiza precio y nombre. El precio se muestra en el modo en que se agregó
 * (neto = sin IVA, como en el toggle de empresa). El servidor igual recalcula.
 */
export function reconcileRequestItems(items: RequestCartItem[], catalog: readonly Product[]): ReconcileResult {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const removed: string[] = [];
  let repriced = 0;
  let changed = false;
  const next: RequestCartItem[] = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      removed.push(item.name);
      changed = true;
      continue;
    }
    const variant = product.cctVariants?.find(
      (v) => (item.variantId && v.jumpseller_variant_id === item.variantId) || v.sku === item.sku,
    );
    const gross = variant?.price ?? product.price;
    const unitPrice = item.priceMode === 'neto' ? Math.round(gross / 1.19) : gross;
    const updated: RequestCartItem = {
      ...item,
      jumpsellerId: product.jumpseller_id,
      variantId: variant?.jumpseller_variant_id ?? item.variantId ?? product.jumpseller_variant_id,
      name: product.name,
      unitPrice,
    };
    if (unitPrice !== item.unitPrice) repriced++;
    if (JSON.stringify(updated) !== JSON.stringify(item)) changed = true;
    next.push(updated);
  }
  return { items: next, removed, repriced, changed };
}

// ── Formato de precio CLP ────────────────────────────────────────────────────
export function formatCLP(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
  }).format(amount);
}
