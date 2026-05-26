import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RequestCartProvider, useRequestCart } from './RequestCartContext';
import type { RequestCartItem } from '@/types/request-order';

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
