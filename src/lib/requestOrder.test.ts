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

describe('reconcileRequestItems: ids renombrados (PR 07)', () => {
  const nf3 = products.find(p => p.jumpseller_id === 4122715)!; // antes /producto/w-ip66
  const solar150 = products.find(p => p.jumpseller_id === 25888711)!; // antes /producto/control-remoto

  it('una línea con el id viejo y su id de Jumpseller se conserva, con el id y la URL vigentes', () => {
    const r = reconcileRequestItems([item({ productId: 'w-ip66', jumpsellerId: 4122715, sku: nf3.sku, url: '/producto/w-ip66' })], products);
    expect(nf3.id).toBe('campana-led-ufo-nf3-150w-150-lm-w-ip66');
    expect(r.removed).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ productId: nf3.id, url: `/producto/${nf3.id}`, jumpsellerId: 4122715, name: nf3.name });
  });

  it('con el id de Jumpseller basta: un id del sitio que no está en ninguna tabla igual encuentra el producto', () => {
    const r = reconcileRequestItems([item({ productId: 'id-desconocido', jumpsellerId: 4122715, sku: nf3.sku, url: '/producto/id-desconocido' })], products);
    expect(r.removed).toEqual([]);
    expect(r.items[0]).toMatchObject({ productId: nf3.id, url: `/producto/${nf3.id}`, jumpsellerId: 4122715 });
  });

  it('un carrito viejo sin id de Jumpseller pasa al id vigente por la tabla de renombres', () => {
    const r = reconcileRequestItems([item({ productId: 'control-remoto', sku: solar150.sku, url: '/producto/control-remoto' })], products);
    expect(solar150.id).toBe('alumbrado-publico-led-solar-150w-all-in-one-c-control-remoto');
    expect(r.removed).toEqual([]);
    expect(r.items[0]).toMatchObject({ productId: solar150.id, url: `/producto/${solar150.id}`, jumpsellerId: 25888711 });
  });

  it('la línea vieja y la agregada después con el id nuevo se juntan en una', () => {
    const vieja = item({ productId: 'w-ip66', sku: nf3.sku, quantity: 2, url: '/producto/w-ip66' });
    const nueva = item({ productId: nf3.id, jumpsellerId: 4122715, sku: nf3.sku, quantity: 1, url: `/producto/${nf3.id}` });
    const r = reconcileRequestItems([vieja, nueva], products);
    expect(r.removed).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ productId: nf3.id, quantity: 3 });
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
