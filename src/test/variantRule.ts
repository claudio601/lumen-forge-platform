// Regla del SKU de la variante, escrita desde el snapshot de Jumpseller y no desde
// src/lib/variants.ts, para que las pruebas del selector la comparen con lo que hace el sitio
// sin fijar SKU ni precios del catálogo (el dueño los corrige en Jumpseller y la
// sincronización diaria los trae). Lo usan src/lib/variants.test.ts y
// src/pages/ProductDetail.variants.test.tsx.
// Regla: la línea (solicitud, cotización, WhatsApp) lleva el SKU propio de la variante; si no
// tiene, «JS-<id del producto>». Nunca el SKU del producto ni el de otra variante.

import { jumpsellerSnapshot } from '@/data/catalog/jumpseller-snapshot.generated';
import type { SnapshotProduct, SnapshotVariant } from '@/data/catalog/jumpseller.types';

const byId = new Map(jumpsellerSnapshot.map(s => [s.jumpseller_id, s]));

/** El producto tal como viene de Jumpseller (snapshot). */
export function snapshotProduct(jumpsellerId: number): SnapshotProduct {
  const s = byId.get(jumpsellerId);
  if (!s) throw new Error(`${jumpsellerId} no está en el snapshot`);
  return s;
}

/** La variante tal como viene de Jumpseller (snapshot). */
export function snapshotVariant(jumpsellerId: number, variantId: number): SnapshotVariant {
  const v = snapshotProduct(jumpsellerId).variants.find(x => x.id === variantId);
  if (!v) throw new Error(`${jumpsellerId}: la variante ${variantId} no está en el snapshot`);
  return v;
}

/** SKU de la línea: el propio de la variante en Jumpseller o, si no tiene, «JS-<id del producto>». */
export function expectedLineSku(jumpsellerId: number, variantId: number): string {
  return snapshotVariant(jumpsellerId, variantId).sku || `JS-${jumpsellerId}`;
}

/** La variante tiene SKU propio y ninguna otra variante del producto lo comparte. */
export function expectedSkuIsDistinct(jumpsellerId: number, variantId: number): boolean {
  const { sku } = snapshotVariant(jumpsellerId, variantId);
  return sku !== '' && snapshotProduct(jumpsellerId).variants.filter(v => v.sku === sku).length === 1;
}
