// /solicitar-pedido: el envío va a /api/request-orders/create con los productos del carrito
// y, si la visita lo tiene, el origen (Etapa 2 · PR 10: src/lib/attribution.ts lo guarda en
// la sesión y el formulario lo manda como `attribution`, sin tocar la referencia RC-).

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import RequestOrderPage from './RequestOrderPage';
import { products } from '@/data/products';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));

const ATTRIBUTION = { gclid: 'Cj0KCQjwEJEMPLO123', utm_source: 'google', utm_medium: 'cpc', landing: '/catalogo/campanas-led', referrer: 'https://www.google.com' };
const product = products.find(x => !x.cctVariants?.length && x.price > 1000)!;

async function renderPage() {
  sessionStorage.setItem('elights_request_cart', JSON.stringify([
    { productId: product.id, jumpsellerId: product.jumpseller_id, sku: product.sku || `JS-${product.jumpseller_id}`, name: product.name, quantity: 1, unitPrice: product.price, priceMode: 'iva', url: `/producto/${product.id}`, attributes: {} },
  ]));
  render(
    <HelmetProvider><AppProvider><RequestCartProvider>
      <MemoryRouter initialEntries={['/solicitar-pedido']}><RequestOrderPage /></MemoryRouter>
    </RequestCartProvider></AppProvider></HelmetProvider>,
  );
  // El carrito guardado se lee de la sesión después de montar
  await screen.findByLabelText(/Nombre completo/);
}

function fillForm() {
  const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type(/Nombre completo/, 'PRUEBA ETAPA 2 (10) - borrar');
  type(/Correo electronico/, 'prueba-etapa2-10@example.com');
  type(/Teléfono/, '+56 9 0000 0910');
  type(/Comuna/, 'Santiago');
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /ENVIAR SOLICITUD DE PEDIDO/ }));
const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
const ok = () => vi.fn(async (_url: string, init: RequestInit) => ({
  ok: true,
  status: 201,
  json: async () => ({ success: true, requestReference: JSON.parse(init.body as string).requestReference, dealId: 1 }),
}));

describe('/solicitar-pedido: envío y origen de la visita', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('con un origen guardado en la sesión, el envío lo lleva en attribution', async () => {
    sessionStorage.setItem('elights_attribution', JSON.stringify(ATTRIBUTION));
    vi.stubGlobal('fetch', ok());
    await renderPage();
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    const [url] = vi.mocked(fetch).mock.calls[0] as unknown as [string];
    expect(url).toBe('/api/request-orders/create');
    const body = sentBody();
    expect(body.attribution).toEqual(ATTRIBUTION);
    expect(body.requestReference).toMatch(/^RC-[a-z0-9]{5,8}$/i);
    expect(body.items).toEqual([expect.objectContaining({ jumpsellerId: product.jumpseller_id, quantity: 1 })]);
  });

  it('sin origen guardado, la clave attribution no viaja', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage();
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).not.toHaveProperty('attribution');
  });
});
