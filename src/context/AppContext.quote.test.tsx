import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, useApp, quoteLineKey } from './AppContext';
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
});
