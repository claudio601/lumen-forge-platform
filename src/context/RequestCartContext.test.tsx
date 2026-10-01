import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RequestCartProvider, useRequestCart } from './RequestCartContext';
import type { RequestCartItem } from '@/types/request-order';
import { requestLineKey } from '@/lib/requestOrder';

const KEY = 'elights_request_cart';
const wrapper = ({ children }: { children: ReactNode }) => <RequestCartProvider>{children}</RequestCartProvider>;

const sampleItem: Omit<RequestCartItem, 'quantity'> = {
  productId: 'alumbrado-publico-bestled-150w-ip66-ik08',
  sku: 'APB1507',
  name: 'ALUMBRADO PÚBLICO BESTLED 150W IP66 IK08',
  unitPrice: 189200,
  priceMode: 'iva',
  url: '/producto/alumbrado-publico-bestled-150w-ip66-ik08',
  attributes: {},
};

describe('RequestCart: estado de UI en sessionStorage, no localStorage', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('ignora un snapshot viejo en localStorage y limpia la key legacy', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { productId: 'old', sku: 'APB120A', name: 'viejo', unitPrice: 162000, quantity: 1, priceMode: 'iva', url: '/x', attributes: {} },
    ]));
    const { result } = renderHook(() => useRequestCart(), { wrapper });
    expect(result.current.itemCount).toBe(0);
    expect(result.current.subtotal).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('persiste en sessionStorage al agregar (no en localStorage)', () => {
    const { result } = renderHook(() => useRequestCart(), { wrapper });
    act(() => { result.current.addItem({ ...sampleItem, quantity: 2 }); });
    expect(result.current.itemCount).toBe(2);
    expect(result.current.subtotal).toBe(378400);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('hidrata desde sessionStorage', () => {
    sessionStorage.setItem(KEY, JSON.stringify([{ ...sampleItem, quantity: 1 }]));
    const { result } = renderHook(() => useRequestCart(), { wrapper });
    expect(result.current.itemCount).toBe(1);
    expect(result.current.subtotal).toBe(189200);
  });
});

describe('RequestCart: líneas por producto + variante', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('dos colores de luz del mismo BESTLED son dos líneas; la misma variante suma cantidad', () => {
    const { result } = renderHook(() => useRequestCart(), { wrapper });
    const neutra = { ...sampleItem, sku: 'APB150N', variantId: 1001, unitPrice: 172000 };
    const calida = { ...sampleItem, sku: 'APB1507', variantId: 1002, unitPrice: 189200 };
    act(() => { result.current.addItem(neutra); result.current.addItem(calida); });
    act(() => { result.current.addItem(calida); });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.find(i => i.variantId === 1002)!.quantity).toBe(2);
    act(() => { result.current.removeItem(requestLineKey(neutra)); });
    expect(result.current.items.map(i => i.variantId)).toEqual([1002]);
    act(() => { result.current.updateQty(requestLineKey(calida), 5); });
    expect(result.current.items[0].quantity).toBe(5);
  });
});


describe('RequestCart: la sesión se lee después de montar (páginas estáticas)', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('al recargar con un carrito guardado lo carga y no lo borra con el carrito vacío inicial', () => {
    sessionStorage.setItem(KEY, JSON.stringify([{ ...sampleItem, quantity: 3 }]));
    const { result, unmount } = renderHook(() => useRequestCart(), { wrapper });
    expect(result.current.loaded).toBe(true);
    expect(result.current.itemCount).toBe(3);
    unmount();
    expect(JSON.parse(sessionStorage.getItem(KEY)!)[0].quantity).toBe(3);
  });
});
