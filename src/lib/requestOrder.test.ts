import { describe, it, expect } from 'vitest';
import { buildRequestRef, cartItemToOrderItem, reconcileRequestItems } from './requestOrder';
import { products } from '@/data/products';
import type { RequestCartItem } from '@/types/request-order';

const ar111 = products.find(p => p.jumpseller_id === 3305420)!;
const bestled = products.find(p => p.jumpseller_id === 4156930)!;
const item = (over: Partial<RequestCartItem>): RequestCartItem => ({
  productId: ar111.id, sku: 'AR111', name: 'viejo', quantity: 1, unitPrice: 100000, priceMode: 'iva', url: '/x', attributes: {}, ...over,
});

describe('reconcileRequestItems: carritos guardados antes de una sincronización', () => {
  it('actualiza precio (AR111 $100.000 → $16.200), nombre e ids de Jumpseller', () => {
    const r = reconcileRequestItems([item({})], products);
    expect(r.changed).toBe(true);
    expect(r.repriced).toBe(1);
    expect(r.items[0]).toMatchObject({ unitPrice: 16200, name: ar111.name, jumpsellerId: 3305420 });
  });

  it('respeta el modo neto en que se agregó (precio sin IVA)', () => {
    const r = reconcileRequestItems([item({ priceMode: 'neto' })], products);
    expect(r.items[0].unitPrice).toBe(Math.round(16200 / 1.19));
  });

  it('usa el precio de la variante CCT (BESTLED 150W 2700K)', () => {
    const v2700 = bestled.cctVariants!.find(v => v.kelvin === 2700)!;
    const r = reconcileRequestItems([item({ productId: bestled.id, sku: v2700.sku, unitPrice: 1 })], products);
    expect(r.items[0]).toMatchObject({ unitPrice: v2700.price, variantId: v2700.jumpseller_variant_id });
  });

  it('quita productos que ya no se publican', () => {
    const r = reconcileRequestItems([item({ productId: 'campana-led-ufo-150w-ip65-light-negra', name: 'UFO 150W' }), item({})], products);
    expect(r.removed).toEqual(['UFO 150W']);
    expect(r.items).toHaveLength(1);
  });

  it('descarta un id de variante que el producto ya no tiene', () => {
    const r = reconcileRequestItems([item({ variantId: 1 })], products);
    expect(r.items[0].variantId).toBe(ar111.jumpseller_variant_id);
  });

  it('junta líneas que quedan iguales al completar ids (línea vieja + agregada después)', () => {
    const v4000 = bestled.cctVariants!.find(v => v.kelvin === 4000)!;
    const vieja = item({ productId: bestled.id, sku: v4000.sku, quantity: 2 });
    const nueva = item({ productId: bestled.id, sku: v4000.sku, variantId: v4000.jumpseller_variant_id, quantity: 1 });
    const r = reconcileRequestItems([vieja, nueva], products);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].quantity).toBe(3);
  });

  it('un carrito al día no cambia', () => {
    const fresh = reconcileRequestItems([item({})], products).items;
    expect(reconcileRequestItems(fresh, products).changed).toBe(false);
  });
});

describe('payload y referencia', () => {
  it('el payload lleva los ids de Jumpseller y el modo de precio', () => {
    const o = cartItemToOrderItem(item({ jumpsellerId: 3305420, variantId: 7, priceMode: 'neto' }));
    expect(o).toMatchObject({ jumpsellerId: 3305420, variantId: 7, priceMode: 'neto' });
  });

  it('dos productos con el mismo SKU de Jumpseller no generan la misma referencia', () => {
    const a = buildRequestRef('x@y.cl', [item({ productId: 'panel-24w', sku: 'DLRO40N' })]);
    const b = buildRequestRef('x@y.cl', [item({ productId: 'panel-6w', sku: 'DLRO40N' })]);
    expect(a).not.toBe(b);
  });
});
