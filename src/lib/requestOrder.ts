// src/lib/requestOrder.ts
// Utilidades para el flujo de Solicitud de Pedido.
// buildRequestRef: genera referencia idempotente RC-xxxxx (hash djb2, ventana 1h).

import type { RequestCartItem, RequestOrderItem } from '@/types/request-order';
import type { Product } from '@/data/catalog/types';
// Tabla chica y sin imports: este archivo va en el bundle principal (no importar el catálogo)
import { RENAMED_FROM } from '@/data/catalog/renamed-ids';

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

// ── Precios en el modo del selector ─────────────────────────────────────────
/** IVA de Chile: el modo empresa muestra el precio sin IVA (÷1,19), como el toggle del encabezado. */
const IVA_FACTOR = 1.19;

/** Precio neto (sin IVA) de un precio CON IVA, redondeado como en el toggle (AppContext.displayPrice). */
export const netOfGross = (gross: number) => Math.round(gross / IVA_FACTOR);

/** Modo del selector de precios del encabezado: 'neto' = empresa (sin IVA), 'iva' = con IVA. */
export type PriceMode = 'neto' | 'iva';

/**
 * Totales de la solicitud. Cada línea guarda su precio CON IVA del catálogo; el neto se
 * calcula al mostrar, línea por línea (la suma calza con los precios unitarios que se ven).
 * Nunca se suman precios con IVA y netos (auditoría UX, F-01).
 */
export function requestTotals(items: readonly Pick<RequestCartItem, 'unitPrice' | 'quantity'>[]): { gross: number; net: number } {
  let gross = 0;
  let net = 0;
  for (const i of items) {
    gross += i.unitPrice * i.quantity;
    net += netOfGross(i.unitPrice) * i.quantity;
  }
  return { gross, net };
}

/**
 * Una línea guardada antes del 2026-10-17 podía traer el precio neto (priceMode 'neto'):
 * pasa a CON IVA (aproximado; la puesta al día con el catálogo deja el exacto) y pierde
 * priceMode. Una línea nueva queda igual.
 */
export function normalizeStoredLine<T extends Pick<RequestCartItem, 'unitPrice' | 'priceMode'>>(item: T): T {
  if (item.priceMode === undefined) return item;
  const { priceMode, ...rest } = item;
  return { ...rest, unitPrice: priceMode === 'neto' ? Math.round(item.unitPrice * IVA_FACTOR) : item.unitPrice } as T;
}

// ── Mapeo de RequestCartItem a RequestOrderItem ──────────────────────────────
/**
 * Convierte una línea del carrito al formato que espera el endpoint, con el precio que veía
 * el cliente en el modo del selector al enviar (`mode`): neto o con IVA. El servidor ignora
 * ese precio y recalcula CON IVA desde el catálogo; priceMode solo deja la nota "el cliente
 * veía precios netos" en Pipedrive.
 */
export function cartItemToOrderItem(item: RequestCartItem, mode: PriceMode): RequestOrderItem {
  const unitPrice = mode === 'neto' ? netOfGross(item.unitPrice) : item.unitPrice;
  return {
    jumpsellerId: item.jumpsellerId,
    variantId: item.variantId,
    priceMode: mode,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPrice,
    currency: 'CLP',
    lineTotal: item.quantity * unitPrice,
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
 * productos que ya no se publican, completa ids de Jumpseller (carritos viejos),
 * pasa al id vigente del sitio (ids renombrados, PR 07) y actualiza precio y nombre.
 * El precio queda siempre CON IVA (también el de una línea vieja guardada en modo neto,
 * que pierde priceMode): la página muestra el neto según el selector. El servidor igual
 * recalcula.
 */
export function reconcileRequestItems(items: RequestCartItem[], catalog: readonly Product[]): ReconcileResult {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const byJumpsellerId = new Map(catalog.map((p) => [p.jumpseller_id, p]));
  const removed: string[] = [];
  let repriced = 0;
  let changed = false;
  const next: RequestCartItem[] = [];
  for (const item of items) {
    // Primero por el id de Jumpseller (no cambia); los carritos de antes de 2026-10 no lo
    // traen: por el id del sitio, también si es uno anterior a un renombre.
    const product =
      (item.jumpsellerId !== undefined ? byJumpsellerId.get(item.jumpsellerId) : undefined) ??
      byId.get(item.productId) ??
      byId.get(RENAMED_FROM.get(item.productId) ?? '');
    if (!product) {
      removed.push(item.name);
      changed = true;
      continue;
    }
    const variant = product.cctVariants?.find(
      (v) => (item.variantId && v.jumpseller_variant_id === item.variantId) || v.sku === item.sku,
    );
    const unitPrice = variant?.price ?? product.price;
    // Solo ids de variante que el producto tiene hoy (una variante vieja haría fallar el precio).
    const validVariantIds = new Set(
      [product.jumpseller_variant_id, ...(product.cctVariants ?? []).map((v) => v.jumpseller_variant_id)].filter(Boolean),
    );
    const keptVariantId = item.variantId && validVariantIds.has(item.variantId) ? item.variantId : undefined;
    const updated: RequestCartItem = {
      ...item,
      productId: product.id,
      url: `/producto/${product.id}`,
      jumpsellerId: product.jumpseller_id,
      variantId: variant?.jumpseller_variant_id ?? keptVariantId ?? product.jumpseller_variant_id,
      name: product.name,
      unitPrice,
    };
    if (updated.variantId === undefined) delete updated.variantId;
    delete updated.priceMode;
    if (unitPrice !== item.unitPrice) repriced++;
    if (JSON.stringify(updated) !== JSON.stringify(item)) changed = true;
    // Al completar ids (o pasar al id vigente), una línea vieja puede quedar igual a otra nueva: se juntan.
    const twin = next.find((i) => requestLineKey(i) === requestLineKey(updated));
    if (twin) {
      twin.quantity += updated.quantity;
      changed = true;
      continue;
    }
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
