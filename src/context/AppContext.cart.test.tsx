import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, useApp, quoteLineKey, type CartItem } from './AppContext';
import { resolveVariantId } from '@/services/jumpsellerCart';
import { products } from '@/data/products';

const p150 = products.find(p => p.id === 'alumbrado-publico-bestled-150w-ip66-ik08')!;
const NEUTRA = { cct: 4000, sku: 'APB150N', unitPrice: 172000 };
const CALIDA = { cct: 2700, sku: 'APB150C', unitPrice: 189200 };

const wrapper = ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider>;

describe('cart con variantes CCT', () => {
  beforeEach(() => sessionStorage.clear());

  it('dos CCT distintas del mismo producto son dos líneas y el total suma por unitPrice', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.addToCart(p150, 1, NEUTRA);
      result.current.addToCart(p150, 1, CALIDA);
    });
    expect(result.current.cart).toHaveLength(2);
    expect(result.current.cartTotal).toBe(361200);
  });

  it('la misma CCT agregada dos veces se mergea en una línea con quantity 2', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => { result.current.addToCart(p150, 1, CALIDA); });
    act(() => { result.current.addToCart(p150, 1, CALIDA); });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].quantity).toBe(2);
  });

  it('updateCartQty(lineKey, 0) elimina solo esa línea', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.addToCart(p150, 1, NEUTRA);
      result.current.addToCart(p150, 1, CALIDA);
    });
    act(() => { result.current.updateCartQty(quoteLineKey(p150.id, CALIDA.cct), 0); });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].cct).toBe(NEUTRA.cct);
  });

  it('resolveVariantId usa el jumpseller_variant_id de la variante CCT seleccionada', () => {
    const item: CartItem = { product: p150, quantity: 1, cct: 2700, variantSku: 'APB150C', unitPrice: 189200 };
    expect(resolveVariantId(item)).toBe(113961236);
  });

  it('resolveVariantId cae al jumpseller_id del producto cuando no hay CCT seleccionada', () => {
    const item: CartItem = { product: p150, quantity: 1 };
    expect(resolveVariantId(item)).toBe(p150.jumpseller_id);
  });
});
