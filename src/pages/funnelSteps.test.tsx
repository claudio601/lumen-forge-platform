// Las dos puertas (auditoría UX, F-04, entrega 3): /cotizacion y /solicitar-pedido dicen sus
// 3 pasos bajo el título (textos de 5.2 y 5.3 del informe), también con la lista vacía, porque
// «Cotización (0)» y «Pedido (0)» se ven siempre en el encabezado. La cotización vacía ofrece
// además la asesoría técnica.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { products } from '@/data/products';
import { ADVISORY_LINK } from '@/config/navigation';
import QuoteCartPage from './QuoteCartPage';
import RequestOrderPage from './RequestOrderPage';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));

const product = products.find(p => !p.cctVariants?.length && p.price > 1000)!;

function renderAt(path: '/cotizacion' | '/solicitar-pedido') {
  render(
    <HelmetProvider><AppProvider><RequestCartProvider>
      <MemoryRouter initialEntries={[path]}>{path === '/cotizacion' ? <QuoteCartPage /> : <RequestOrderPage />}</MemoryRouter>
    </RequestCartProvider></AppProvider></HelmetProvider>,
  );
}

const steps = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem').map(li => li.textContent);

const QUOTE = ['1Envías tu lista', '2Confirmamos disponibilidad y precio', '3Recibes la cotización por correo'];
const ORDER = ['1Envías tu solicitud', '2Confirmamos disponibilidad', '3Pagas con el link y despachamos'];

beforeEach(() => sessionStorage.clear());

describe('/cotizacion: franja de 3 pasos', () => {
  it('vacía: los 3 pasos, "Ver catálogo" y "Asesoría técnica"', () => {
    renderAt('/cotizacion');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tu lista de cotización está vacía');
    expect(steps('Cómo funciona la cotización')).toEqual(QUOTE);
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/catalogo');
    expect(screen.getByRole('link', { name: ADVISORY_LINK.label })).toHaveAttribute('href', ADVISORY_LINK.to);
  });

  it('con productos: los 3 pasos bajo el título, antes de la lista', async () => {
    sessionStorage.setItem('elights_quote', JSON.stringify([{ product, quantity: 2 }]));
    renderAt('/cotizacion');
    const name = await screen.findByText(product.name);
    expect(steps('Cómo funciona la cotización')).toEqual(QUOTE);
    const strip = screen.getByRole('list', { name: 'Cómo funciona la cotización' });
    expect(strip.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('/solicitar-pedido: franja de 3 pasos', () => {
  it('vacía: los 3 pasos y el nombre de la puerta en el título', () => {
    renderAt('/solicitar-pedido');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tu solicitud de pedido está vacía');
    expect(steps('Cómo funciona la solicitud de pedido')).toEqual(ORDER);
  });

  it('con productos: los 3 pasos bajo el título', async () => {
    sessionStorage.setItem('elights_request_cart', JSON.stringify([
      { productId: product.id, jumpsellerId: product.jumpseller_id, sku: product.sku || `JS-${product.jumpseller_id}`, name: product.name, quantity: 1, unitPrice: product.price, priceMode: 'iva', url: `/producto/${product.id}`, attributes: {} },
    ]));
    renderAt('/solicitar-pedido');
    await screen.findByLabelText(/Nombre completo/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Solicitud de pedido');
    expect(steps('Cómo funciona la solicitud de pedido')).toEqual(ORDER);
  });
});
