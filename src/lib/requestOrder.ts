// src/lib/requestOrder.ts
// Utilidades para el flujo de Solicitud de Pedido.
// buildRequestRef: genera referencia idempotente RC-xxxxx (hash djb2, ventana 1h).

import type { RequestCartItem, RequestOrderItem } from '@/types/request-order';

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
  const skus = items
    .map((i) => i.sku + 'x' + i.quantity)
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

// ── Formato de precio CLP ────────────────────────────────────────────────────
export function formatCLP(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
  }).format(amount);
}
