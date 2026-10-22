// /cotizacion: persona o empresa (los datos de facturación solo para empresa), un solo
// envío a /api/quotes/create (el correo a ventas sale desde el servidor) y "Solicitud
// enviada" solo cuando el servidor confirma { success: true }. Cualquier otra respuesta
// muestra un error junto al botón (role="alert") y deja la lista para reintentar.
// El modo empresa del encabezado solo preselecciona el tipo de cliente.
// PR 13: la casilla de privacidad es obligatoria y la de novedades, opcional y sin marcar.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider, useApp } from '@/context/AppContext';
import QuoteCartPage from './QuoteCartPage';
import { products } from '@/data/products';
import { CONSENT_ERRORS, LEGAL_VERSION, parseConsent } from '../../api/_lib/forms/consent';

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
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const marketingBox = () => screen.getByLabelText(/Quiero recibir novedades/) as HTMLInputElement;

function fillContact(telefono = '+56 9 0000 0902', { consent = true } = {}) {
  type(/Nombre y Apellido/, 'PRUEBA ETAPA 2 (09b) - borrar');
  type(/Email/, 'prueba-etapa2-09b@example.com');
  type(/Teléfono/, telefono);
  type(/Comentarios/, 'PRUEBA ETAPA 2 (09b) - no cotizar');
  if (consent) fireEvent.click(privacyBox());
}

function fillCompany() {
  type(/RUT Empresa/, '44.444.444-4'); // inventado, con dígito verificador válido
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

  it('antes del botón, el aviso: no es una compra, derecho a retracto, garantía legal y los textos en otra pestaña (PR 12)', async () => {
    await renderPage();
    const notice = screen.getByRole('note', { name: 'Información antes de enviar' });
    const button = screen.getByRole('button', { name: /ENVIAR SOLICITUD/ });
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice).toHaveTextContent('Esta solicitud de presupuesto no es una compra y no genera ningún cobro.');
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
  });

  it('con el aviso, el error sigue justo antes del botón (donde el visitante está mirando)', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage();
    fillContact('212 3456');
    submit();
    const alert = await screen.findByRole('alert');
    const notice = screen.getByRole('note', { name: 'Información antes de enviar' });
    expect(alert.nextElementSibling).toBe(screen.getByRole('button', { name: /ENVIAR SOLICITUD/ }));
    expect(notice.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

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
      company: { rut: '44.444.444-4', giro: 'Prueba', address: 'Prueba 123, Santiago' },
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
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":77,"quoteReference":"NE-x"}'));
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
    ['502', reply(502, '{"success":false}'), 502, /No pudimos registrar tu solicitud en este momento\. Inténtalo de nuevo o escríbenos a ventas@elights\.cl/],
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
    expect(sendEvent).toHaveBeenCalledWith('cotizacion_form_submit_error', expect.objectContaining({ http_status: httpStatus }));
    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(savedQuote()).toHaveLength(1);
    expect(screen.getByLabelText(/Nombre y Apellido/)).toHaveValue('PRUEBA ETAPA 2 (09b) - borrar');
    await waitFor(() => expect(screen.getByRole('button', { name: /ENVIAR SOLICITUD/ })).toBeEnabled());
  });

  it('generate_lead solo con la referencia NE- en la respuesta: { success: true } sin ella (trampa contra bots) no cuenta', async () => {
    vi.stubGlobal('fetch', reply(200, '{"success":true}'));
    await renderPage();
    fillContact();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(trackLead).not.toHaveBeenCalled();
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
    expect(screen.getByLabelText(/RUT Empresa/)).toHaveValue('44.444.444-4');
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).toMatchObject({
      customerType: 'empresa',
      leadType: 'B2B',
      priceMode: 'iva',
      organization: { name: 'PRUEBA ETAPA 2 (no procesar)' },
      company: { rut: '44.444.444-4', giro: 'Prueba', address: 'Prueba 123, Santiago' },
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

// Origen de la visita (Etapa 2 · PR 10): lo guarda src/lib/attribution.ts en la sesión y la
// cotización lo manda como `attribution`.
describe('/cotizacion: origen de la visita', () => {
  const ATTRIBUTION = { gclid: 'Cj0KCQjwEJEMPLO123', utm_source: 'google', utm_medium: 'cpc', landing: '/catalogo/campanas-led', referrer: 'https://www.google.com' };
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('con un origen guardado en la sesión, el envío lo lleva en attribution', async () => {
    sessionStorage.setItem('elights_attribution', JSON.stringify(ATTRIBUTION));
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":77,"quoteReference":"NE-x"}'));
    await renderPage();
    fillContact();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody().attribution).toEqual(ATTRIBUTION);
  });

  it('sin origen guardado, la clave attribution no viaja', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":77,"quoteReference":"NE-x"}'));
    await renderPage();
    fillContact();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).not.toHaveProperty('attribution');
  });
});

// Privacidad y novedades (Etapa 2 · PR 13): useConsentFields('solicitud'), sin los términos.
describe('/cotizacion: casillas de privacidad y novedades', () => {
  const CONSENT_400 = JSON.stringify({ success: false, error: 'Validation failed', code: 'consent_required', details: { errors: ['consent.privacy must be true'] } });
  const button = () => screen.getByRole('button', { name: /ENVIAR SOLICITUD/ });
  const gaParams = () => [...vi.mocked(sendEvent).mock.calls, ...vi.mocked(trackLead).mock.calls].map(([, params]) => params ?? {});

  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('las dos casillas sin marcar, después del aviso (fuera de él) y antes del botón; solo enlazan la privacidad', async () => {
    await renderPage();
    const group = screen.getByRole('group', { name: 'Privacidad y novedades' });
    const notice = screen.getByRole('note', { name: 'Información antes de enviar' });
    expect(notice.contains(group)).toBe(false);
    expect(notice.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
    expect(within(group).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/politica-de-privacidad']);
  });

  it('con el resto inválido, solo el error del resto: el de la casilla no aparece', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage();
    fillContact('212 3456', { consent: false });
    submit();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('entre 8 y 12 dígitos');
    expect(screen.queryByText(CONSENT_ERRORS.solicitud)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('con el resto válido y sin marcar: no envía, el mensaje junto a la casilla y el foco en ella', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage();
    fillContact(undefined, { consent: false });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CONSENT_ERRORS.solicitud);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' })).toContainElement(alert);
    expect(privacyBox()).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
    // Marcarla borra el aviso y el envío sigue
    fireEvent.click(privacyBox());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
  });

  it.each([false, true])('marcada (novedades %s): consent viaja con el estado real, sin terms, y el servidor lo acepta', async (marketing) => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage();
    fillContact();
    if (marketing) fireEvent.click(marketingBox());
    const checked = privacyBox().checked;
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    const { consent } = sentBody();
    expect(consent).toEqual({ privacy: true, marketing, version: LEGAL_VERSION });
    expect(consent.privacy).toBe(checked);
    expect(consent).not.toHaveProperty('terms');
    // Contrato con el servidor (api/quotes/create.ts)
    expect(parseConsent(consent, { requireTerms: false }).ok).toBe(true);
  });

  it('400 con code consent_required: el aviso de la casilla (no el del teléfono) y el botón vuelve', async () => {
    vi.stubGlobal('fetch', reply(400, CONSENT_400));
    await renderPage();
    fillContact();
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(CONSENT_ERRORS.solicitud));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Revisa los datos|teléfono de 8 a 12/)).not.toBeInTheDocument();
    expect(privacyBox()).toHaveFocus();
    expect(screen.queryByText('Solicitud enviada')).not.toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
    expect(savedQuote()).toHaveLength(1);
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('el formulario y la confirmación llevan data-elights-form="cotizacion"; Analytics sin comuna', async () => {
    vi.stubGlobal('fetch', reply(400, '{"success":false}'));
    await renderPage();
    expect(button().closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'cotizacion');
    expect(privacyBox().closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'cotizacion');
    fillContact();
    submit();
    await screen.findByRole('alert');
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    submit();
    const heading = await screen.findByRole('heading', { name: 'Solicitud enviada' });
    expect(heading.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'cotizacion');
    expect(gaParams().length).toBeGreaterThan(0);
    for (const params of gaParams()) expect(Object.keys(params)).not.toEqual(expect.arrayContaining([expect.stringMatching(/commune|comuna/i)]));
  });
});

describe('/cotizacion: botones de cada fila con nombre propio', () => {
  afterEach(() => sessionStorage.clear());

  it('restar, sumar y quitar dicen de qué producto son, distintos en cada fila', async () => {
    const other = products.find(x => !x.cctVariants?.length && x.price > 1000 && x.id !== product.id && x.name !== product.name)!;
    sessionStorage.setItem('elights_quote', JSON.stringify([{ product, quantity: 2 }, { product: other, quantity: 1 }]));
    render(
      <HelmetProvider><AppProvider>
        <MemoryRouter initialEntries={['/cotizacion']}><QuoteCartPage /></MemoryRouter>
      </AppProvider></HelmetProvider>,
    );
    await screen.findByText(other.name);
    for (const p of [product, other]) {
      expect(screen.getByRole('button', { name: `Restar una unidad de ${p.name}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Sumar una unidad de ${p.name}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Quitar ${p.name} de la cotización` })).toBeInTheDocument();
    }
    const names = screen.getAllByRole('button', { name: /^(Restar una unidad|Sumar una unidad|Quitar) / }).map(b => b.getAttribute('aria-label'));
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });
});
