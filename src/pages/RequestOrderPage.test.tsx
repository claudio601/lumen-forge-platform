// /solicitar-pedido: el envío va a /api/request-orders/create con los productos del carrito
// y, si la visita lo tiene, el origen (Etapa 2 · PR 10: src/lib/attribution.ts lo guarda en
// la sesión y el formulario lo manda como `attribution`, sin tocar la referencia RC-).
// PR 13: la casilla obligatoria incluye los términos y condiciones; novedades, opcional.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import RequestOrderPage from './RequestOrderPage';
import { products } from '@/data/products';
import { CONSENT_ERRORS, LEGAL_VERSION, parseConsent } from '../../api/_lib/forms/consent';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { sendEvent, trackLead } from '@/lib/analytics';

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

const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const marketingBox = () => screen.getByLabelText(/Quiero recibir novedades/) as HTMLInputElement;

function fillForm({ consent = true, comuna = 'Santiago' } = {}) {
  const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type(/Nombre completo/, 'PRUEBA ETAPA 2 (10) - borrar');
  type(/Correo electronico/, 'prueba-etapa2-10@example.com');
  type(/Teléfono/, '+56 9 0000 0910');
  type(/Comuna/, comuna);
  if (consent) fireEvent.click(privacyBox());
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

// Privacidad, términos y novedades (Etapa 2 · PR 13): useConsentFields('pedido').
describe('/solicitar-pedido: casillas de privacidad, términos y novedades', () => {
  const button = () => screen.getByRole('button', { name: /ENVIAR SOLICITUD DE PEDIDO/ });
  const consent400 = () => vi.fn(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ success: false, error: 'Validation failed', code: 'consent_required', details: { errors: ['consent.terms must be true'] } }),
  }));

  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('la obligatoria acepta los términos y la privacidad; las dos sin marcar, fuera del aviso y antes del botón', async () => {
    await renderPage();
    const group = screen.getByRole('group', { name: 'Privacidad y novedades' });
    const notice = screen.getByRole('note', { name: 'Información antes de enviar' });
    expect(notice.contains(group)).toBe(false);
    expect(notice.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(privacyBox().closest('label')).toHaveTextContent(/^Acepto los Términos y condiciones, leí la Política de privacidad y autorizo/);
    expect(within(group).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/terminos-y-condiciones', '/politica-de-privacidad']);
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
  });

  it('con el resto inválido, solo el error del resto: el de la casilla no aparece', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await renderPage();
    fillForm({ consent: false, comuna: '' });
    submit();
    expect(await screen.findByText('Por favor completa todos los campos requeridos (*).')).toBeInTheDocument();
    expect(screen.queryByText(CONSENT_ERRORS.pedido)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('con el resto válido y sin marcar: no envía, el mensaje junto a la casilla y el foco en ella', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage();
    fillForm({ consent: false });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CONSENT_ERRORS.pedido);
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' })).toContainElement(alert);
    expect(privacyBox()).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    expect(sendEvent).not.toHaveBeenCalledWith('request_form_start', expect.anything());
    expect(button()).toBeEnabled();
  });

  it.each([false, true])('marcada (novedades %s): consent lleva terms y el estado real, y el servidor lo acepta', async (marketing) => {
    vi.stubGlobal('fetch', ok());
    await renderPage();
    fillForm();
    if (marketing) fireEvent.click(marketingBox());
    const checked = privacyBox().checked;
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    const { consent } = sentBody();
    expect(consent).toEqual({ privacy: true, terms: true, marketing, version: LEGAL_VERSION });
    expect(consent.privacy).toBe(checked);
    // Contrato con el servidor (api/request-orders/create.ts exige los términos)
    expect(parseConsent(consent, { requireTerms: true }).ok).toBe(true);
  });

  it('400 con code consent_required: el aviso de la casilla, sin mensaje general, y el botón vuelve (status idle)', async () => {
    vi.stubGlobal('fetch', consent400());
    await renderPage();
    fillForm();
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(CONSENT_ERRORS.pedido));
    expect(privacyBox()).toHaveFocus();
    expect(screen.queryByText(/No pudimos enviar tu solicitud/)).not.toBeInTheDocument();
    expect(screen.queryByText('Solicitud enviada')).not.toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent('ENVIAR SOLICITUD DE PEDIDO');
    // El carrito queda para reintentar
    expect(JSON.parse(sessionStorage.getItem('elights_request_cart') ?? '[]')).toHaveLength(1);
  });

  it('el formulario y la confirmación llevan data-elights-form="solicitar-pedido"; Analytics sin comuna ni referencia', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage();
    expect(button().closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'solicitar-pedido');
    expect(privacyBox().closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'solicitar-pedido');
    fillForm();
    submit();
    const heading = await screen.findByRole('heading', { name: 'Solicitud enviada' });
    expect(heading.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'solicitar-pedido');
    expect(sendEvent).toHaveBeenCalledWith('request_form_start', { customerType: 'persona' });
    const params = [...vi.mocked(sendEvent).mock.calls, ...vi.mocked(trackLead).mock.calls].map(([, p]) => p ?? {});
    for (const p of params) {
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining([expect.stringMatching(/commune|comuna|reference/i)]));
      expect(JSON.stringify(p)).not.toContain('Santiago');
      expect(JSON.stringify(p)).not.toMatch(/RC-/);
    }
    // El lead es solo el tipo de formulario y cuántos productos: nada que lo una al negocio en Pipedrive
    expect(trackLead).toHaveBeenCalledWith('solicitud_pedido', { item_count: 1 });
  });
});

describe('/solicitar-pedido: botones de cada fila con nombre propio', () => {
  afterEach(() => sessionStorage.clear());

  it('restar, sumar y quitar dicen de qué producto son, distintos en cada fila', async () => {
    const other = products.find(x => !x.cctVariants?.length && x.price > 1000 && x.id !== product.id && x.name !== product.name)!;
    const line = (p: typeof product) => ({ productId: p.id, jumpsellerId: p.jumpseller_id, sku: p.sku || `JS-${p.jumpseller_id}`, name: p.name, quantity: 1, unitPrice: p.price, priceMode: 'iva', url: `/producto/${p.id}`, attributes: {} });
    sessionStorage.setItem('elights_request_cart', JSON.stringify([line(product), line(other)]));
    render(
      <HelmetProvider><AppProvider><RequestCartProvider>
        <MemoryRouter initialEntries={['/solicitar-pedido']}><RequestOrderPage /></MemoryRouter>
      </RequestCartProvider></AppProvider></HelmetProvider>,
    );
    await screen.findByLabelText(/Nombre completo/);
    for (const p of [product, other]) {
      const label = `${p.name}, ${line(p).sku}`;
      expect(screen.getByRole('button', { name: `Restar una unidad de ${label}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Sumar una unidad de ${label}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Quitar ${label} de la solicitud` })).toBeInTheDocument();
    }
    const names = screen.getAllByRole('button', { name: /^(Restar una unidad|Sumar una unidad|Quitar) / }).map(b => b.getAttribute('aria-label'));
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });
});
