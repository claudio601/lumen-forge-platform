import { describe, it, expect } from 'vitest';
import { priceItems, netOf } from './pricing';
import type { PriceIndexEntry } from './price-index.generated';

const index: Record<string, PriceIndexEntry> = {
  '2301098': { name: 'ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08', sku: '', price: 108500, variants: { '95224064': { sku: 'APB40N', price: 108500 }, '111887368': { sku: 'APB407', price: 119400 } } },
  '3921249': { name: 'LINEAL LED FLAT 54W 120 CM. IP44', sku: '', price: 10520, variants: {} },
  '3305420': { name: 'AMPOLLETA LED AR111', sku: 'AR111OPC', price: 16200, variants: {} },
  '9000001': { name: 'A', sku: 'DUP', price: 1000, variants: {} },
  '9000002': { name: 'B', sku: 'DUP', price: 2000, variants: {} },
};

describe('precios en el servidor (CON IVA, desde el catálogo)', () => {
  it('usa el precio del catálogo, nunca el del navegador', () => {
    const r = priceItems([{ jumpsellerId: 3305420, quantity: 2, sku: 'lo-que-sea' }], index);
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({ jumpsellerId: 3305420, sku: 'AR111OPC', name: 'AMPOLLETA LED AR111', unitPrice: 16200, lineTotal: 32400 });
    expect(r.subtotal).toBe(32400);
  });

  it('precio y SKU de la variante elegida (BESTLED 2700K)', () => {
    const r = priceItems([{ jumpsellerId: 2301098, variantId: 111887368, quantity: 1 }], index);
    expect(r.lines[0]).toMatchObject({ variantId: 111887368, sku: 'APB407', unitPrice: 119400 });
  });

  it('producto sin SKU: queda JS-<id>', () => {
    expect(priceItems([{ jumpsellerId: 3921249, quantity: 1 }], index).lines[0].sku).toBe('JS-3921249');
  });

  it('carritos viejos sin id: se identifica por "JS-<id>" o por un SKU que use un solo producto', () => {
    expect(priceItems([{ sku: 'JS-3921249', quantity: 1 }], index).lines[0].jumpsellerId).toBe(3921249);
    expect(priceItems([{ sku: 'APB407', quantity: 1 }], index).lines[0]).toMatchObject({ jumpsellerId: 2301098, variantId: 111887368, unitPrice: 119400 });
    expect(priceItems([{ sku: 'DUP', quantity: 1 }], index).unresolved[0].reason).toContain('no identificado');
  });

  it('bundle viejo: SKU base de BESTLED que no está en el índice → se identifica por el nombre exacto', () => {
    const r = priceItems([{ sku: 'APB40', name: 'ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08', quantity: 1 }], index);
    expect(r.lines[0]).toMatchObject({ jumpsellerId: 2301098, unitPrice: 108500 });
  });

  it('un producto que no se identifica NO invalida la solicitud: queda para revisión', () => {
    const r = priceItems([{ jumpsellerId: 1, sku: 'X', name: 'Viejo', quantity: 2 }, { jumpsellerId: 3305420, quantity: 1 }], index);
    expect(r.errors).toEqual([]);
    expect(r.unresolved).toEqual([{ index: 0, sku: 'X', name: 'Viejo', quantity: 2, reason: 'producto no identificado (1)' }]);
    expect(r.lineIndexes).toEqual([1]);
    expect(r.subtotal).toBe(16200);
  });

  it('una variante que ya no existe usa el precio base y se marca para revisar', () => {
    const r = priceItems([{ jumpsellerId: 2301098, variantId: 5, quantity: 1 }], index);
    expect(r.lines[0]).toMatchObject({ unitPrice: 108500, variantUnknown: true });
    expect(r.lines[0]).not.toHaveProperty('variantId');
  });

  it('cantidades inválidas sí son un error de validación', () => {
    for (const quantity of [0, -1, 1.5, 10000, 'abc']) {
      expect(priceItems([{ jumpsellerId: 3305420, quantity }], index).errors[0]).toContain('quantity');
    }
  });

  it('neto = con IVA / 1,19 redondeado (lo que muestra el modo empresa)', () => {
    expect(netOf(119000)).toBe(100000);
    expect(netOf(16200)).toBe(13613);
  });

  it('el índice real generado desde Jumpseller tiene precio para el AR111', () => {
    expect(priceItems([{ jumpsellerId: 3305420, quantity: 1 }]).lines[0].unitPrice).toBe(16200);
  });
});
