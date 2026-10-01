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
});
