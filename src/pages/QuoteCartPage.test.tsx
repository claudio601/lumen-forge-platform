// /cotizacion: persona o empresa (los datos de facturación solo para empresa), un solo
// envío a /api/quotes/create (el correo a ventas sale desde el servidor) y "Solicitud
// enviada" solo cuando el servidor confirma { success: true }. Cualquier otra respuesta
// muestra un error junto al botón (role="alert") y deja la lista para reintentar.
// El modo empresa del encabezado solo preselecciona el tipo de cliente.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider, useApp } from '@/context/AppContext';
import QuoteCartPage from './QuoteCartPage';
import { products } from '@/data/products';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { sendEvent, trackLead } from '@/lib/analytics';

const product = products.find(x => !x.cctVariants?.length && x.price > 1000)!;
const COMPANY_LABELS = [/RUT Empresa/, /Razón Social/, /Giro/, /Dirección Comercial/];

const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

/** El interruptor de precios del encabezado (Header lo muestra en todas las páginas). */
function HeaderToggle() {
  const { toggleB2B } = useApp();
  return <button type="button" onClick={toggleB2B}>Cambiar modo de precios</button>;
}

async function renderPage({ b2b = false } = {}) {
  sessionStorage.setItem('elights_quote', JSON.stringify([{ product, quantity: 2 }]));
  if (b2b) sessionStorage.setItem('elights_b2b', 'true');
  render(
    <HelmetProvider><AppProvider>
      <HeaderToggle />
      <MemoryRouter initialEntries={['/cotizacion']}><QuoteCartPage /></MemoryRouter>
    </AppProvider></HelmetProvider>,
  );
  // La cotización guardada se lee de la sesión después de montar
  await screen.findByText(product.name);
}

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillContact(telefono = '+56 9 0000 0902') {
  type(/Nombre y Apellido/, 'PRUEBA ETAPA 2 (09b) - borrar');
  type(/Email/, 'prueba-etapa2-09b@example.com');
  type(/Teléfono/, telefono);
  type(/Comentarios/, 'PRUEBA ETAPA 2 (09b) - no cotizar');
}

function fillCompany() {
  type(/RUT Empresa/, 'RUT-PRUEBA');
  type(/Razón Social/, 'PRUEBA ETAPA 2 (no procesar)');
  type(/Giro/, 'Prueba');
  type(/Dirección Comercial/, 'Prueba 123, Santiago');
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /ENVIAR SOLICITUD/ }));
const toggleHeader = () => fireEvent.click(screen.getByRole('button', { name: 'Cambiar modo de precios' }));
const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
const savedQuote = () => JSON.parse(sessionStorage.getItem('elights_quote') ?? '[]');

describe('/cotizacion', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('persona por defecto: no pide RUT, razón social, giro ni dirección', async () => {
    await renderPage();
    expect(screen.getByLabelText(/Tipo de cliente/)).toHaveValue('persona');
    for (const label of COMPANY_LABELS) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  });

  it('al elegir Empresa aparecen los datos de facturación, requeridos', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'empresa' } });
    for (const label of COMPANY_LABELS) expect(screen.getByLabelText(label)).toBeRequired();
  });

  it('con el modo empresa del encabezado parte en Empresa y manda priceMode neto con los datos de la empresa', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":77,"quoteReference":"NE-x"}'));
    await renderPage({ b2b: true });
    expect(screen.getByLabelText(/Tipo de cliente/)).toHaveValue('empresa');
    fillContact();
    fillCompany();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).toMatchObject({
      customerType: 'empresa',
      leadType: 'B2B',
      priceMode: 'neto',
      organization: { name: 'PRUEBA ETAPA 2 (no procesar)' },
      company: { rut: 'RUT-PRUEBA', giro: 'Prueba', address: 'Prueba 123, Santiago' },
    });
  });

  it('el cliente puede cambiar a Persona aunque esté en modo empresa: sin datos de empresa, precios netos', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage({ b2b: true });
    fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'persona' } });
    for (const label of COMPANY_LABELS) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    fillContact();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    const body = sentBody();
    expect(body).toMatchObject({ customerType: 'persona', leadType: 'B2C', priceMode: 'neto' });
    expect(body).not.toHaveProperty('organization');
    expect(body).not.toHaveProperty('company');
  });

  it('persona: un solo envío a /api/quotes/create, nunca al relay de correo, y la referencia en pantalla', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":77}'));
    await renderPage();
    fillContact();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();

    expect(fetch).toHaveBeenCalledTimes(1);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['/api/quotes/create']);
    expect(urls.some(u => u.includes('script.google.com'))).toBe(false);

    const body = sentBody();
    expect(body).toMatchObject({
      sourceSystem: 'nuevo_elights',
      customerType: 'persona',
      leadType: 'B2C',
      priceMode: 'iva',
      website: '',
      customer: { name: 'PRUEBA ETAPA 2 (09b) - borrar', email: 'prueba-etapa2-09b@example.com', phone: '+56 9 0000 0902' },
      notes: 'PRUEBA ETAPA 2 (09b) - no cotizar',
    });
    expect(body).not.toHaveProperty('organization');
    expect(body).not.toHaveProperty('company');
    expect(body.products).toEqual([expect.objectContaining({ jumpsellerId: product.jumpseller_id, quantity: 2 })]);
    expect(body.quoteReference).toMatch(/^NE-[0-9a-z]{1,7}$/);
    expect(screen.getByText(body.quoteReference)).toBeInTheDocument();

    expect(trackLead).toHaveBeenCalledTimes(1);
    expect(trackLead).toHaveBeenCalledWith('cotizacion', { lead_type: 'B2C', item_count: 1 });
    await waitFor(() => expect(savedQuote()).toEqual([]));
  });

  it('un teléfono de 7 dígitos se rechaza en el navegador, sin llamar al servidor', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage();
    fillContact('212 3456');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 8 y 12 dígitos');
    expect(fetch).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
  });

  it.each([
    ['502', reply(502, '{"success":false}'), 502, /No pudimos registrar.*WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
    ['429', reply(429, '{"success":false}'), 429, /Espera unos minutos/],
    ['400', reply(400, '{"success":false,"error":"Validation failed"}'), 400, /Revisa los datos/],
    ['200 { success: false }', reply(200, '{"success":false}'), 200, /No pudimos registrar/],
    ['504 con HTML', reply(504, '<!DOCTYPE html><html>An error occurred</html>'), 504, /No pudimos registrar/],
    ['red caída', vi.fn(async () => { throw new TypeError('Failed to fetch'); }), 0, /No pudimos registrar/],
  ])('%s: error junto al botón, sin éxito ni conversión, y la lista queda', async (_name, fetchImpl, httpStatus, message) => {
    vi.stubGlobal('fetch', fetchImpl);
    await renderPage();
    fillContact();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Solicitud enviada')).not.toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
    expect(sendEvent).toHaveBeenCalledWith('cotizacion_form_submit_error', expect.objectContaining({ httpStatus }));
    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(savedQuote()).toHaveLength(1);
    expect(screen.getByLabelText(/Nombre y Apellido/)).toHaveValue('PRUEBA ETAPA 2 (09b) - borrar');
    await waitFor(() => expect(screen.getByRole('button', { name: /ENVIAR SOLICITUD/ })).toBeEnabled());
  });

  it('200 { success: true, dealId: null } (Pipedrive falló pero el correo salió): solicitud enviada', async () => {
    vi.stubGlobal('fetch', reply(200, '{"success":true,"quoteReference":"NE-x","dealId":null,"crm":"failed"}'));
    await renderPage();
    fillContact();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(trackLead).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('el modo empresa solo preselecciona: si después cambia el encabezado, sigue Empresa con sus datos', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage({ b2b: true });
    expect(screen.getByLabelText(/Tipo de cliente/)).toHaveValue('empresa');
    fillContact();
    fillCompany();
    toggleHeader(); // el cliente pasa a ver precios con IVA
    expect(await screen.findAllByText('Precio c/IVA')).not.toHaveLength(0);
    expect(screen.getByLabelText(/Tipo de cliente/)).toHaveValue('empresa');
    expect(screen.getByLabelText(/RUT Empresa/)).toHaveValue('RUT-PRUEBA');
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).toMatchObject({
      customerType: 'empresa',
      leadType: 'B2B',
      priceMode: 'iva',
      organization: { name: 'PRUEBA ETAPA 2 (no procesar)' },
      company: { rut: 'RUT-PRUEBA', giro: 'Prueba', address: 'Prueba 123, Santiago' },
    });
  });

  it('una persona que activa el modo empresa a mitad del formulario sigue como persona, sin campos nuevos', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage();
    fillContact();
    toggleHeader(); // el cliente pasa a ver precios netos
    expect(await screen.findAllByText('Precio neto (sin IVA)')).not.toHaveLength(0);
    expect(screen.getByLabelText(/Tipo de cliente/)).toHaveValue('persona');
    for (const label of COMPANY_LABELS) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    const body = sentBody();
    expect(body).toMatchObject({ customerType: 'persona', leadType: 'B2C', priceMode: 'neto' });
    expect(body).not.toHaveProperty('company');
  });

  it('éxito: el foco pasa al título "Solicitud enviada", que lee también la referencia', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage();
    fillContact();
    submit();
    const heading = await screen.findByRole('heading', { name: 'Solicitud enviada' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(new RegExp('Referencia: ' + sentBody().quoteReference + '$'));
  });
});
