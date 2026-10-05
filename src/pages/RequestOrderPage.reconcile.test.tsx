// /solicitar-pedido como primera página de la visita: el carrito guardado se lee
// después de montar, y la puesta al día con el catálogo tiene que correr igual.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import RequestOrderPage from './RequestOrderPage';
import { products } from '@/data/products';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

describe('/solicitar-pedido como primera página', () => {
  beforeEach(() => sessionStorage.clear());

  it('actualiza al precio vigente un carrito guardado con un precio viejo', async () => {
    const p = products.find(x => !x.cctVariants?.length && x.price > 1000)!;
    sessionStorage.setItem('elights_request_cart', JSON.stringify([
      { productId: p.id, jumpsellerId: p.jumpseller_id, sku: p.sku || `JS-${p.jumpseller_id}`, name: p.name, quantity: 1, unitPrice: 1, priceMode: 'iva', url: `/producto/${p.id}`, attributes: {} },
    ]));
    render(
      <HelmetProvider><AppProvider><RequestCartProvider>
        <MemoryRouter initialEntries={['/solicitar-pedido']}><RequestOrderPage /></MemoryRouter>
      </RequestCartProvider></AppProvider></HelmetProvider>,
    );
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('elights_request_cart')!)[0].unitPrice).toBe(p.price));
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('un carrito guardado con un id renombrado (PR 07) no avisa "ya no están disponibles": pasa al id vigente', async () => {
    vi.mocked(toast.warning).mockClear();
    const p = products.find(x => x.jumpseller_id === 4122715)!; // antes /producto/w-ip66
    sessionStorage.setItem('elights_request_cart', JSON.stringify([
      { productId: 'w-ip66', jumpsellerId: 4122715, sku: p.sku, name: p.name, quantity: 1, unitPrice: p.price, priceMode: 'iva', url: '/producto/w-ip66', attributes: {} },
    ]));
    render(
      <HelmetProvider><AppProvider><RequestCartProvider>
        <MemoryRouter initialEntries={['/solicitar-pedido']}><RequestOrderPage /></MemoryRouter>
      </RequestCartProvider></AppProvider></HelmetProvider>,
    );
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('elights_request_cart')!)[0]).toMatchObject({ productId: p.id, url: `/producto/${p.id}` }));
    expect(JSON.parse(sessionStorage.getItem('elights_request_cart')!)).toHaveLength(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
