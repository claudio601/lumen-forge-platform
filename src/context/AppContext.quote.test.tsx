import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from './AppContext';
import { quoteItemKey, quoteLineKey } from '@/lib/quoteLine';
import { buildVariantSku } from '@/lib/variantSku';
import { products } from '@/data/products';

const p150 = products.find(p => p.id === 'alumbrado-publico-bestled-150w-ip66-ik08')!;
const NEUTRA = { cct: 4000, sku: 'APB150N', unitPrice: 172000 };
const CALIDA = { cct: 2700, sku: 'APB1507', unitPrice: 189200 };

const wrapper = ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider>;

describe('cotización con variantes CCT', () => {
  beforeEach(() => sessionStorage.clear());

  it('dos CCT distintas del mismo producto son dos líneas', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.addToQuote(p150, 1, undefined, NEUTRA);
      result.current.addToQuote(p150, 1, undefined, CALIDA);
    });
    expect(result.current.quoteCart).toHaveLength(2);
    expect(result.current.quoteCount).toBe(2);
    expect(result.current.quoteCart.map(i => i.unitPrice)).toEqual([172000, 189200]);
  });

  it('la misma CCT agregada dos veces se mergea en una línea con quantity 2', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => { result.current.addToQuote(p150, 1, undefined, CALIDA); });
    act(() => { result.current.addToQuote(p150, 1, undefined, CALIDA); });
    expect(result.current.quoteCart).toHaveLength(1);
    expect(result.current.quoteCart[0].quantity).toBe(2);
  });

  it('updateQuoteQty(lineKey, 0) elimina solo esa línea', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.addToQuote(p150, 1, undefined, NEUTRA);
      result.current.addToQuote(p150, 1, undefined, CALIDA);
    });
    act(() => { result.current.updateQuoteQty(quoteLineKey(p150.id, CALIDA.cct), 0); });
    expect(result.current.quoteCart).toHaveLength(1);
    expect(result.current.quoteCart[0].cct).toBe(NEUTRA.cct);
  });
});

describe('cotización con variantes de Jumpseller (selector genérico, D-01)', () => {
  beforeEach(() => sessionStorage.clear());
  const flyhawk = products.find(p => p.jumpseller_id === 11521285)!;
  const v40 = { cct: 2200, sku: 'JS-11521285', unitPrice: 442800, variantId: 118197717, label: '40W · Ámbar 2200K' };
  const v80 = { cct: 2200, sku: 'JS-11521285', unitPrice: 514800, variantId: 118197864, label: '80W · Ámbar 2200K' };

  it('dos variantes con la misma temperatura (Flyhawk 40W y 80W, 2200K) son dos líneas, cada una con su precio', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.addToQuote(flyhawk, 1, undefined, v40);
      result.current.addToQuote(flyhawk, 1, undefined, v80);
      result.current.addToQuote(flyhawk, 2, undefined, v80);
    });
    expect(result.current.quoteCart.map(i => [i.variantId, i.unitPrice, i.quantity, i.variantLabel])).toEqual([
      [118197717, 442800, 1, '40W · Ámbar 2200K'],
      [118197864, 514800, 3, '80W · Ámbar 2200K'],
    ]);
    act(() => { result.current.updateQuoteQty(quoteItemKey(result.current.quoteCart[0]), 0); });
    expect(result.current.quoteCart.map(i => i.variantId)).toEqual([118197864]);
  });

  it('una línea BESTLED guardada antes (solo con su CCT) se junta con la misma variante agregada después', async () => {
    const v2700 = p150.cctVariants!.find(v => v.kelvin === 2700)!;
    sessionStorage.setItem('elights_quote', JSON.stringify([{ product: p150, quantity: 2, cct: 2700, variantSku: 'APB1507', unitPrice: 189200 }]));
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.quoteCart[0].variantId).toBe(v2700.jumpseller_variant_id);
    act(() => {
      result.current.addToQuote(p150, 1, undefined, { ...CALIDA, variantId: v2700.jumpseller_variant_id, label: 'Cálida 2700K' });
    });
    expect(result.current.quoteCart).toHaveLength(1);
    expect(result.current.quoteCount).toBe(3);
  });
});

describe('modelo cotización → link de pago: sin carro con checkout', () => {
  beforeEach(() => sessionStorage.clear());

  it('el contexto ya no expone el carro viejo', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    expect(result.current).not.toHaveProperty('addToCart');
    expect(result.current).not.toHaveProperty('cart');
  });

  it('limpia el carro viejo que haya quedado en la sesión', () => {
    sessionStorage.setItem('elights_cart', JSON.stringify([{ quantity: 1 }]));
    renderHook(() => useApp(), { wrapper });
    expect(sessionStorage.getItem('elights_cart')).toBeNull();
  });
});

describe('SKU de variante CCT (convención Jumpseller 1/7)', () => {
  it('2700K Cálida → APB1507', () => {
    expect(buildVariantSku(p150.sku, 2700)).toBe('APB1507');
  });
  it('2200K Ámbar → APB1501', () => {
    expect(buildVariantSku(p150.sku, 2200)).toBe('APB1501');
  });
  it('5000K Fría → APB150F', () => {
    expect(buildVariantSku(p150.sku, 5000)).toBe('APB150F');
  });
});

describe('cctVariants[].sku no diverge del generador', () => {
  const conVariantes = products.filter(p => p.cctVariants && p.cctVariants.length > 0);
  for (const p of conVariantes) {
    for (const v of p.cctVariants!) {
      it(`${p.sku} ${v.kelvin}K → ${buildVariantSku(p.sku, v.kelvin)}`, () => {
        expect(v.sku).toBe(buildVariantSku(p.sku, v.kelvin));
      });
    }
  }
});

describe('sesión leída después de montar (páginas estáticas)', () => {
  beforeEach(() => sessionStorage.clear());

  it('al recargar, la cotización y el modo empresa se cargan y no se borran', () => {
    sessionStorage.setItem('elights_b2b', 'true');
    sessionStorage.setItem('elights_quote', JSON.stringify([{ product: p150, quantity: 2, cct: 4000 }]));
    const { result, unmount } = renderHook(() => useApp(), { wrapper });
    expect(result.current.isB2B).toBe(true);
    expect(result.current.quoteCount).toBe(2);
    expect(result.current.displayPrice(119000)).toBe(100000);
    unmount();
    expect(sessionStorage.getItem('elights_b2b')).toBe('true');
    expect(JSON.parse(sessionStorage.getItem('elights_quote')!)).toHaveLength(1);
  });

  it('una cotización guardada con un id renombrado (PR 07) se carga con el id vigente', async () => {
    const nf3 = products.find(p => p.jumpseller_id === 4122715)!; // antes /producto/w-ip66
    sessionStorage.setItem('elights_quote', JSON.stringify([{ product: { ...nf3, id: 'w-ip66' }, quantity: 2 }]));
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.quoteCart.map(i => i.product.id)).toEqual([nf3.id]);
    // El mismo producto agregado después de la PR 07 se suma a esa línea, no abre otra
    act(() => { result.current.addToQuote(nf3, 1); });
    expect(result.current.quoteCart).toHaveLength(1);
    expect(result.current.quoteCount).toBe(3);
    expect(JSON.parse(sessionStorage.getItem('elights_quote')!)[0].product.id).toBe(nf3.id);
  });

  it('las líneas con el id viejo y el nuevo del mismo producto se juntan al cargar', async () => {
    const nf3 = products.find(p => p.jumpseller_id === 4122715)!;
    sessionStorage.setItem('elights_quote', JSON.stringify([
      { product: { ...nf3, id: 'w-ip66' }, quantity: 2 },
      { product: nf3, quantity: 1 },
    ]));
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.quoteCart).toHaveLength(1);
    expect(result.current.quoteCart[0]).toMatchObject({ quantity: 3, product: { id: nf3.id } });
  });
});
