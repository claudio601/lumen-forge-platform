// Puerta «Pedido (n)» del encabezado. Auditoría UX, F-01: el total va en el modo del selector de
// precios (con IVA, o neto en modo empresa) y nunca suma precios con IVA y netos, tampoco con un
// carrito guardado antes del cambio con una línea de cada modo. F-04 (entrega 3): se nombra con
// palabras y se ve siempre, también con la solicitud vacía.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import RequestCartDrawer from './RequestCartDrawer';

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn() }));

const line = (over: object) => ({
  productId: 'alumbrado-publico-bestled-150w-ip66-ik08',
  sku: 'APB1507',
  name: 'ALUMBRADO PÚBLICO BESTLED 150W IP66 IK08',
  quantity: 1,
  unitPrice: 130400,
  url: '/producto/alumbrado-publico-bestled-150w-ip66-ik08',
  attributes: {},
  ...over,
});

/** Una línea agregada con IVA y otra agregada en modo empresa (neto), como antes del cambio. */
function seedMixedCart({ b2b }: { b2b: boolean }) {
  sessionStorage.setItem('elights_request_cart', JSON.stringify([
    line({ variantId: 1002, priceMode: 'iva' }),
    line({ sku: 'APB150N', variantId: 1001, unitPrice: 99580, priceMode: 'neto' }),
  ]));
  if (b2b) sessionStorage.setItem('elights_b2b', 'true');
}

const renderPill = () =>
  render(
    <AppProvider><RequestCartProvider>
      <MemoryRouter><RequestCartDrawer /></MemoryRouter>
    </RequestCartProvider></AppProvider>,
  );

describe('RequestCartDrawer: total en un solo modo', () => {
  beforeEach(() => sessionStorage.clear());

  it('con IVA: los dos precios CON IVA (130.400 + 118.500), no 229.980', async () => {
    seedMixedCart({ b2b: false });
    renderPill();
    expect(await screen.findByText(/Pedido \(2\)/)).toHaveTextContent(/^Pedido \(2\) · \$248\.900$/);
    expect(screen.queryByText(/229\.980/)).not.toBeInTheDocument();
  });

  it('modo empresa: los dos netos (109.580 + 99.580), con la palabra neto', async () => {
    seedMixedCart({ b2b: true });
    renderPill();
    expect(await screen.findByText(/Pedido \(2\)/)).toHaveTextContent(/^Pedido \(2\) · \$209\.160 neto$/);
  });
});

describe('RequestCartDrawer: puerta «Pedido (n)» (F-04)', () => {
  beforeEach(() => sessionStorage.clear());

  it('con la solicitud vacía se ve igual, «Pedido (0)» sin total, y lleva a /solicitar-pedido', () => {
    renderPill();
    const door = screen.getByRole('link', { name: 'Pedido (0)' });
    expect(door).toHaveAttribute('href', '/solicitar-pedido');
    expect(door).not.toHaveTextContent('$');
  });

  it('con productos, el número es la suma de las cantidades', async () => {
    sessionStorage.setItem('elights_request_cart', JSON.stringify([line({ variantId: 1002, priceMode: 'iva', quantity: 3 })]));
    renderPill();
    expect(await screen.findByRole('link', { name: /^Pedido \(3\)/ })).toHaveAttribute('href', '/solicitar-pedido');
  });
});
