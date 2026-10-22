// src/context/listsAnalytics.test.tsx
// Eventos de las listas (Etapa 2 · PR 14, especificación 3.4 y 3.5): «Cotizar» envía
// add_to_quote y «Solicitar pedido» request_cart_add, con los nombres de parámetros que usa el
// contenedor (item_id, quantity, unit_price; nunca sku ni unitPrice). Solo para GA4: no son
// conversiones de Google Ads ni eventos de Meta.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { sendEvent } from '@/lib/analytics';
import { AppProvider, useApp } from './AppContext';
import { RequestCartProvider, useRequestCart } from './RequestCartContext';
import { requestSku } from '@/lib/variantSku';
import { requestLineKey } from '@/lib/requestOrder';
import { products } from '@/data/products';

const p150 = products.find(p => p.id === 'alumbrado-publico-bestled-150w-ip66-ik08')!;
const CALIDA = { cct: 2700, sku: 'APB1507', unitPrice: 189200 };
const plain = products.find(p => !p.cctVariants?.length && p.price > 0)!;

const appWrapper = ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider>;
const cartWrapper = ({ children }: { children: ReactNode }) => <RequestCartProvider>{children}</RequestCartProvider>;

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(sendEvent).mockClear();
});

describe('add_to_quote («Cotizar»)', () => {
  it('uno por clic, con el SKU de la variante elegida y la cantidad', () => {
    const { result } = renderHook(() => useApp(), { wrapper: appWrapper });
    act(() => result.current.addToQuote(p150, 3, undefined, CALIDA));
    expect(vi.mocked(sendEvent).mock.calls).toEqual([['add_to_quote', { item_id: 'APB1507', quantity: 3 }]]);
    act(() => result.current.addToQuote(p150, 1, undefined, CALIDA)); // la misma línea: otro evento
    expect(sendEvent).toHaveBeenCalledTimes(2);
  });

  it('sin variante: el SKU con que va en la cotización (JS-<id> si Jumpseller no tiene SKU)', () => {
    const { result } = renderHook(() => useApp(), { wrapper: appWrapper });
    act(() => result.current.addToQuote(plain));
    expect(vi.mocked(sendEvent).mock.calls).toEqual([['add_to_quote', { item_id: requestSku(plain), quantity: 1 }]]);
  });
});

describe('request_cart_add y request_cart_remove («Solicitar pedido»)', () => {
  it('item_id, quantity y unit_price (con IVA), sin los nombres anteriores', () => {
    const { result } = renderHook(() => useRequestCart(), { wrapper: cartWrapper });
    const line = {
      productId: plain.id,
      jumpsellerId: plain.jumpseller_id,
      sku: requestSku(plain),
      name: plain.name,
      unitPrice: plain.price,
      url: `/producto/${plain.id}`,
      attributes: {},
    };
    act(() => result.current.addItem({ ...line, quantity: 2 }));
    expect(sendEvent).toHaveBeenCalledWith('request_cart_add', { item_id: requestSku(plain), quantity: 2, unit_price: plain.price });
    act(() => result.current.removeItem(requestLineKey(result.current.items[0])));
    expect(sendEvent).toHaveBeenLastCalledWith('request_cart_remove', { item_id: requestSku(plain) });
    const calls = vi.mocked(sendEvent).mock.calls;
    for (const [, params] of calls) {
      expect(Object.keys(params ?? {})).not.toEqual(expect.arrayContaining([expect.stringMatching(/^(sku|unitPrice|itemCount)$/)]));
    }
  });
});
