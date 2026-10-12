// /solicitar-pedido como primera página de la visita: el carrito guardado se lee
// después de montar, y la puesta al día con el catálogo tiene que correr igual.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('antes del botón, el aviso: no es una compra, derecho a retracto, garantía legal y los textos en otra pestaña (PR 12)', async () => {
    const p = products.find(x => !x.cctVariants?.length && x.price > 1000)!;
    sessionStorage.setItem('elights_request_cart', JSON.stringify([
      { productId: p.id, jumpsellerId: p.jumpseller_id, sku: p.sku || `JS-${p.jumpseller_id}`, name: p.name, quantity: 1, unitPrice: p.price, priceMode: 'iva', url: `/producto/${p.id}`, attributes: {} },
    ]));
    render(
      <HelmetProvider><AppProvider><RequestCartProvider>
        <MemoryRouter initialEntries={['/solicitar-pedido']}><RequestOrderPage /></MemoryRouter>
      </RequestCartProvider></AppProvider></HelmetProvider>,
    );
    const notice = await screen.findByRole('note', { name: 'Información antes de enviar' });
    const button = screen.getByRole('button', { name: /ENVIAR SOLICITUD DE PEDIDO/ });
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice).toHaveTextContent('Esta solicitud no es una compra y no genera ningún cobro. Te confirmaremos disponibilidad');
    expect(notice).toHaveTextContent(/derecho a retracto/i);
    expect(notice).toHaveTextContent('10 días corridos');
    expect(notice).toHaveTextContent('6 meses');
    // Párrafo 2 con el texto exacto del diseño (exclusiones del DS 52), en letra no más chica que el total (DS 52 art. 6)
    const retracto = within(notice).getByText('Derecho a retracto:').closest('p')!;
    expect(retracto).toHaveTextContent('Derecho a retracto: puedes arrepentirte de tu compra dentro de 10 días corridos desde que recibes el producto. No aplica a productos ya instalados o usados más allá de lo necesario para revisarlos, ni a los fabricados o adaptados según tus especificaciones; si tu pedido incluye alguno, la cotización lo indicará junto a su precio, antes de que pagues.');
    expect(retracto).toHaveClass('text-base');
    expect(screen.getByText('Total referencial:').nextElementSibling!.className).not.toMatch(/\btext-(?:lg|\d?xl)\b/);
    const links = within(notice).getAllByRole('link');
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/terminos-y-condiciones', '/cambios-devoluciones-y-garantia', '/politica-de-privacidad']);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    // La nota de siempre sigue debajo del botón
    expect(button.compareDocumentPosition(screen.getByText(/Sin cobro automático/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
