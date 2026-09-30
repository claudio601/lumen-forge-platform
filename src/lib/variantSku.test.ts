import { describe, it, expect } from 'vitest';
import { buildVariantSku, requestSku } from './variantSku';

describe('requestSku: toda solicitud lleva un SKU', () => {
  it('usa el SKU del producto cuando existe', () => {
    expect(requestSku({ sku: 'CHIPX200', jumpseller_id: 2254290 })).toBe('CHIPX200');
  });
  it('sin SKU en Jumpseller usa JS-<id>, que el endpoint acepta y sirve para el link de pago', () => {
    expect(requestSku({ sku: '', jumpseller_id: 3921249 })).toBe('JS-3921249');
  });
  it('las variantes CCT de BESTLED siguen usando su SKU de variante', () => {
    expect(buildVariantSku(requestSku({ sku: 'APB150', jumpseller_id: 4156930 }), 2700)).toBe('APB1507');
  });
});
