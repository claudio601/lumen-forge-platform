// Cotizador (/cotizador): el formulario va al servidor (/api/project-quotes/create), que
// manda el correo a ventas y crea el negocio en Pipedrive; ya no se usa EmailJS. La
// confirmación y la conversión solo llegan cuando el servidor responde { success: true }.
// Cualquier otra respuesta muestra un aviso junto al botón (role="alert") y deja los datos
// escritos para reintentar.
// PR 13: la casilla de privacidad es obligatoria y la de novedades, opcional y sin marcar.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import SmartQuotePage from './SmartQuotePage';
import { ILLUMINATION_LEVELS, PROJECT_TYPES } from '../../api/_lib/forms/projectQuote';
import { CONSENT_ERRORS, LEGAL_VERSION, parseConsent } from '../../api/_lib/forms/consent';
import { businessHoursLong, contactEmail, responseTimePromise } from '@/config/business';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
// La subida a Vercel Blob (attachments.ts la carga con import() al enviar)
vi.mock('@vercel/blob/client', () => ({ uploadPresigned: vi.fn() }));
import { toast } from 'sonner';
import { sendEvent, trackLead } from '@/lib/analytics';
import { uploadPresigned } from '@vercel/blob/client';
import { STORED_PATHNAME_RE, UPLOAD_PATHNAME_RE } from '../../api/_lib/attachments/rules';

const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

const page = () => (
  <HelmetProvider context={{}}>
    <MemoryRouter initialEntries={['/cotizador']}><SmartQuotePage /></MemoryRouter>
  </HelmetProvider>
);
const renderPage = () => render(page());

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const marketingBox = () => screen.getByLabelText(/Quiero recibir novedades/) as HTMLInputElement;

function fillForm(telefono = '+56 9 0000 0904', m2 = '1200', { consent = true } = {}) {
  type(/Tipo de proyecto/, 'Bodega');
  type(/m2 aproximados/, m2);
  type(/Nombre y Apellido/, 'PRUEBA ETAPA 2 (09d)');
  type(/Email/, 'prueba-etapa2-09d@example.com');
  type(/Teléfono/, telefono);
  if (consent) fireEvent.click(privacyBox());
}

const submitButton = () => screen.getByRole('button', { name: /Solicitar propuesta/ });
const sentBodies = () =>
  (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));

describe('SmartQuotePage (/cotizador)', () => {
  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('201 { success: true }: un solo POST al servidor, la referencia PY- en pantalla y la conversión una vez', async () => {
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-test1', dealId: 1 })));
    renderPage();
    fillForm();
    type(/Altura del espacio/, '8');
    type(/Ciudad/, '  Santiago ');
    type(/Comentarios adicionales/, '   ');
    fireEvent.click(submitButton());

    expect(await screen.findByRole('heading', { name: /Propuesta solicitada/ })).toBeInTheDocument();
    expect(screen.getByText('PY-test1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Propuesta solicitada/ })).toHaveFocus();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/project-quotes/create');
    expect(init.method).toBe('POST');
    // m2 y altura como números; los opcionales vacíos no viajan; el campo trampa va vacío;
    // consent con la casilla marcada y novedades sin marcar
    expect(sentBodies()[0]).toEqual({
      tipoProyecto: 'Bodega',
      m2: 1200,
      altura: 8,
      ciudad: 'Santiago',
      nombre: 'PRUEBA ETAPA 2 (09d)',
      email: 'prueba-etapa2-09d@example.com',
      telefono: '+56 9 0000 0904',
      website: '',
      consent: { privacy: true, marketing: false, version: LEGAL_VERSION },
    });
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('emailjs'))).toBe(false);

    expect(trackLead).toHaveBeenCalledTimes(1);
    expect(trackLead).toHaveBeenCalledWith('cotizador', { project_type: 'Bodega' });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('generate_lead solo con la referencia PY- en la respuesta: { success: true } sin ella (trampa contra bots) no cuenta', async () => {
    vi.stubGlobal('fetch', reply(200, JSON.stringify({ success: true })));
    renderPage();
    fillForm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole('heading', { name: /Propuesta solicitada/ })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(trackLead).not.toHaveBeenCalled();
  });

  it('envía los datos de empresa recortados', async () => {
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-test2', dealId: 2 })));
    renderPage();
    fillForm();
    type(/Razon Social/, ' PRUEBA EMPRESA ');
    type(/Giro/, 'PRUEBA giro');
    type(/Dirección/, 'PRUEBA dirección 123');
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-test2')).toBeInTheDocument();
    expect(sentBodies()[0]).toMatchObject({ razonSocial: 'PRUEBA EMPRESA', giro: 'PRUEBA giro', direccion: 'PRUEBA dirección 123' });
    expect(sentBodies()[0]).not.toHaveProperty('rutEmpresa');
  });

  it.each([
    ['502', reply(502, '{"success":false}'), 502, /No pudimos enviar tu solicitud\. Inténtalo de nuevo o escríbenos a ventas@elights\.cl\./],
    ['504 con HTML', reply(504, '<!DOCTYPE html><html>An error occurred</html>'), 504, /Inténtalo de nuevo o escríbenos a ventas@elights\.cl\./],
    ['200 { success: false }', reply(200, '{"success":false}'), 200, /Inténtalo de nuevo o escríbenos a ventas@elights\.cl\./],
    ['200 sin JSON', reply(200, '<html>ok?</html>'), 200, /Inténtalo de nuevo o escríbenos a ventas@elights\.cl\./],
    ['red caída', vi.fn(async () => { throw new TypeError('Failed to fetch'); }), 0, /Inténtalo de nuevo o escríbenos a ventas@elights\.cl\./],
    ['403', reply(403, '{"success":false,"error":"Forbidden"}'), 403, /Inténtalo de nuevo o escríbenos a ventas@elights\.cl\./],
    ['429', reply(429, '{"success":false}'), 429, /Espera unos minutos/],
    ['400', reply(400, '{"success":false,"error":"Validation failed"}'), 400, /Revisa email y teléfono \(8 a 12 dígitos\)/],
  ])('%s: aviso junto al botón, sin confirmación ni conversión, y los datos quedan', async (_name, fetchImpl, httpStatus, message) => {
    vi.stubGlobal('fetch', fetchImpl);
    renderPage();
    fillForm();
    fireEvent.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByRole('heading', { name: /Propuesta solicitada/ })).not.toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(sendEvent).toHaveBeenCalledWith('cotizador_submit_error', expect.objectContaining({ http_status: httpStatus }));
    expect(screen.getByLabelText(/Nombre y Apellido/)).toHaveValue('PRUEBA ETAPA 2 (09d)');
    expect(screen.getByLabelText(/m2 aproximados/)).toHaveValue('1200');
    expect(screen.getByLabelText(/Tipo de proyecto/)).toHaveValue('Bodega');
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it.each([
    ['7 dígitos', '212 3456'],
    ['13 dígitos', '+56 9 0000 090455'],
  ])('un teléfono de %s se rechaza en el navegador, sin llamar al servidor', async (_name, telefono) => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    renderPage();
    fillForm(telefono);
    fireEvent.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 8 y 12 dígitos');
    expect(fetch).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
  });

  it('los comentarios tienen el mismo tope que el servidor (2000 caracteres)', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    renderPage();
    const comentarios = screen.getByLabelText(/Comentarios adicionales/);
    expect(comentarios).toHaveAttribute('maxLength', '2000');
    fillForm();
    // jsdom no aplica maxLength a un cambio por código: lo frena la validación del formulario
    fireEvent.change(comentarios, { target: { value: 'c'.repeat(2001) } });
    fireEvent.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('hasta 2000 caracteres');
    expect(fetch).not.toHaveBeenCalled();
  });

  // Con type="number", Chrome en español deja "12.000" como 12 sin avisar: el campo es de
  // texto y el punto se lee como separador de miles, igual que en el servidor.
  it.each([
    ['12.000', 12000],
    ['1.200', 1200],
    ['100.000', 100000],
    [' 5000 ', 5000],
  ])("m2 '%s' viaja como %i", async (m2, expected) => {
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-m2', dealId: 3 })));
    renderPage();
    fillForm(undefined, m2);
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-m2')).toBeInTheDocument();
    expect(sentBodies()[0].m2).toBe(expected);
  });

  it.each(['12,5', '1,200', '12.5', '12 000', '1.2000'])(
    "m2 '%s' es ambiguo: se pide de nuevo sin llamar al servidor y el valor queda",
    async (m2) => {
      vi.stubGlobal('fetch', reply(201, '{"success":true}'));
      renderPage();
      fillForm(undefined, m2);
      fireEvent.click(submitButton());
      expect(await screen.findByRole('alert')).toHaveTextContent('Escribe los m2 solo con números (ej: 12000)');
      expect(fetch).not.toHaveBeenCalled();
      expect(trackLead).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/m2 aproximados/)).toHaveValue(m2);
    },
  );

  it('m2 es un campo de texto con teclado numérico (no type="number")', () => {
    renderPage();
    const m2 = screen.getByLabelText(/m2 aproximados/);
    expect(m2).toHaveAttribute('type', 'text');
    expect(m2).toHaveAttribute('inputMode', 'numeric');
  });

  it('las listas usan las mismas opciones que acepta el servidor', () => {
    renderPage();
    const options = (label: RegExp) =>
      Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value);
    expect(options(/Tipo de proyecto/)).toEqual(['', ...PROJECT_TYPES]);
    expect(options(/Nivel de iluminación/)).toEqual(['', ...ILLUMINATION_LEVELS]);
  });

  it('el campo trampa está fuera de la vista, sin tabulación ni autocompletado', () => {
    const { container } = renderPage();
    const trap = container.querySelector('input[name="website"]')!;
    expect(trap).toHaveAttribute('tabIndex', '-1');
    expect(trap).toHaveAttribute('autoComplete', 'off');
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

// El HTML de /cotizador es estático (prerender) y ahí llegan /contact y /contactos. Hasta que
// React hidrata (JS lento o bloqueado), el formulario no tiene onSubmit: un envío nativo con
// GET pondría nombre, correo, teléfono y RUT en la URL y la solicitud se perdería sin aviso.
describe('SmartQuotePage antes de hidratar (HTML del prerender)', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  // El mismo filtro que src/ssr-hydration.test.tsx
  const MISMATCH = /did not match|did not expect server HTML|Expected server HTML|received an update before it finished hydrating|switch to client rendering/i;

  const CONTROLS = [
    'tipoProyecto', 'm2', 'altura', 'aplicacion', 'nivelIluminacion', 'ciudad', 'plazo',
    'comentarios', 'archivos', 'nombre', 'email', 'telefono', 'rutEmpresa', 'razonSocial', 'giro', 'direccion',
    // «Recordar mis datos en este dispositivo» (especificación del 23-10-2026): al final de los datos de contacto
    'recordarDatos',
    'consentPrivacy', 'consentMarketing', 'website',
  ];

  const serverContainer = () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(page());
    document.body.appendChild(container);
    return container;
  };

  it('el formulario usa method="post" (nunca GET con los datos en la URL) y todo está deshabilitado', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // aviso de useLayoutEffect, solo en jsdom
    const html = renderToString(page());
    expect(html).toMatch(/<form[^>]*\smethod="post"/);
    expect(html).not.toMatch(/<form[^>]*\smethod="get"/i);

    const container = serverContainer();
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.hasAttribute('action')).toBe(false);
    const fieldset = form.querySelector('fieldset')!;
    expect(fieldset).toHaveAttribute('disabled');
    const button = within(container).getByRole('button', { name: /Solicitar propuesta/ });
    expect(button).toHaveAttribute('disabled');
    expect(button).toBeDisabled();
    const controls = [...form.querySelectorAll('input, select, textarea')];
    expect(controls.map((c) => c.getAttribute('name'))).toEqual(CONTROLS);
    // Todos los campos y el botón están dentro del fieldset deshabilitado
    for (const el of [...controls, ...form.querySelectorAll('button')]) expect(fieldset.contains(el)).toBe(true);
    for (const control of controls) expect(control).toBeDisabled();
    // Las casillas, sin marcar en el HTML estático (PR 13), y el contenedor marcado para la etiqueta de Google
    for (const name of ['consentPrivacy', 'consentMarketing']) {
      expect(form.querySelector(`input[name="${name}"]`)).not.toBeChecked();
      expect(form.querySelector(`input[name="${name}"]`)).not.toHaveAttribute('checked');
    }
    expect(html).toContain('data-elights-form="cotizador"');
    expect(form.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'cotizador');
  });

  // space-y-6 da margen arriba a todo hijo que tenga un hermano antes. Con el campo trampa
  // (oculto, posición absoluta) como primer hijo, el primer bloque quedaba 24 px más abajo.
  it('el primer bloque del formulario no recibe el margen de space-y: el campo trampa va al final', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // aviso de useLayoutEffect, solo en jsdom
    const fieldset = serverContainer().querySelector('form fieldset')!;
    expect(fieldset.className).toContain('space-y-6');
    const first = fieldset.firstElementChild!;
    expect(first).not.toHaveAttribute('aria-hidden');
    expect(first.querySelector('h2')).toHaveTextContent('Información del proyecto');
    const trap = fieldset.querySelector('input[name="website"]')!.closest('[aria-hidden="true"]')!;
    expect(trap.parentElement).toBe(fieldset);
    expect(fieldset.lastElementChild).toBe(trap);
  });

  it('al hidratar se habilita, sin descartar el HTML del servidor', async () => {
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = serverContainer();
    // En jsdom, MemoryRouter usa useLayoutEffect en el render del servidor y React avisa (en Node,
    // donde corre el prerender, no). Solo cuentan los avisos de la hidratación.
    consoleErrors.mockClear();
    const serverButton = container.querySelector('button[type="submit"]');
    const serverForm = container.querySelector('form');
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, page(), { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(consoleErrors.mock.calls.map((args) => args.map(String).join(' ')).filter((m) => MISMATCH.test(m))).toEqual([]);
    expect(container.contains(serverButton)).toBe(true); // React reutilizó los nodos
    expect(container.contains(serverForm)).toBe(true);
    expect(container.querySelector('form')!.getAttribute('method')).toBe('post');
    expect(container.querySelector('fieldset')).not.toHaveAttribute('disabled');
    expect(within(container).getByRole('button', { name: /Solicitar propuesta/ })).toBeEnabled();
    for (const control of container.querySelectorAll('form input, form select, form textarea')) expect(control).toBeEnabled();
    expect(within(container).getByLabelText(/Nombre y Apellido/)).toBeEnabled();
    expect(within(container).getByLabelText(/m2 aproximados/)).toBeEnabled();
    act(() => root?.unmount());
  });
});

// Origen de la visita (Etapa 2 · PR 10): lo guarda src/lib/attribution.ts en la sesión y el
// cotizador lo manda como `attribution` (sin origen, el cuerpo queda exacto como arriba).
describe('SmartQuotePage: origen de la visita', () => {
  const ATTRIBUTION = { gclid: 'Cj0KCQjwEJEMPLO123', utm_source: 'google', utm_medium: 'cpc', landing: '/catalogo/campanas-led', referrer: 'https://www.google.com' };
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('con un origen guardado en la sesión, el envío lo lleva en attribution', async () => {
    sessionStorage.setItem('elights_attribution', JSON.stringify(ATTRIBUTION));
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-test9', dealId: 9 })));
    renderPage();
    fillForm();
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-test9')).toBeInTheDocument();
    expect(sentBodies()[0].attribution).toEqual(ATTRIBUTION);
  });
});

// Privacidad y novedades (Etapa 2 · PR 13): useConsentFields('solicitud'), dentro del fieldset.
describe('SmartQuotePage: casillas de privacidad y novedades', () => {
  const CONSENT_400 = JSON.stringify({ success: false, error: 'Validation failed', code: 'consent_required', details: { errors: ['consent is required'] } });

  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('las dos casillas sin marcar, dentro del fieldset y antes del botón; solo enlazan la privacidad', () => {
    const { container } = renderPage();
    const group = screen.getByRole('group', { name: 'Privacidad y novedades' });
    expect(container.querySelector('form > fieldset')!.contains(group)).toBe(true);
    expect(group.compareDocumentPosition(submitButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/politica-de-privacidad']);
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
  });

  it('con el resto inválido, solo el error del resto: el de la casilla no aparece', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    renderPage();
    fillForm('212 3456', undefined, { consent: false });
    fireEvent.click(submitButton());
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('entre 8 y 12 dígitos');
    expect(screen.queryByText(CONSENT_ERRORS.solicitud)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('con el resto válido y sin marcar: no envía, el mensaje junto a la casilla y el foco en ella', async () => {
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-c1', dealId: 1 })));
    renderPage();
    fillForm(undefined, undefined, { consent: false });
    fireEvent.click(submitButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CONSENT_ERRORS.solicitud);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' })).toContainElement(alert);
    expect(privacyBox()).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
    expect(submitButton()).toBeEnabled();
    fireEvent.click(privacyBox());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-c1')).toBeInTheDocument();
  });

  it.each([false, true])('marcada (novedades %s): consent viaja con el estado real, sin terms, y el servidor lo acepta', async (marketing) => {
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-c2', dealId: 2 })));
    renderPage();
    fillForm();
    if (marketing) fireEvent.click(marketingBox());
    const checked = privacyBox().checked;
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-c2')).toBeInTheDocument();
    const { consent } = sentBodies()[0];
    expect(consent).toEqual({ privacy: true, marketing, version: LEGAL_VERSION });
    expect(consent.privacy).toBe(checked);
    // Contrato con el servidor (api/project-quotes/create.ts)
    expect(parseConsent(consent, { requireTerms: false }).ok).toBe(true);
  });

  it('400 con code consent_required: el aviso de la casilla (no el de email y teléfono) y el botón vuelve', async () => {
    vi.stubGlobal('fetch', reply(400, CONSENT_400));
    renderPage();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(CONSENT_ERRORS.solicitud));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Revisa email y teléfono/)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/Revisa email y teléfono/));
    expect(privacyBox()).toHaveFocus();
    expect(trackLead).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Nombre y Apellido/)).toHaveValue('PRUEBA ETAPA 2 (09d)');
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it('el formulario y la confirmación llevan data-elights-form="cotizador"; Analytics sin comuna ni ciudad', async () => {
    vi.stubGlobal('fetch', reply(502, '{"success":false}'));
    renderPage();
    expect(submitButton().closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'cotizador');
    fillForm();
    type(/Ciudad/, 'Santiago');
    fireEvent.click(submitButton());
    await screen.findByRole('alert');
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-c3', dealId: 3 })));
    fireEvent.click(submitButton());
    const heading = await screen.findByRole('heading', { name: /Propuesta solicitada/ });
    expect(heading.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'cotizador');
    const params = [...vi.mocked(sendEvent).mock.calls, ...vi.mocked(trackLead).mock.calls].map(([, p]) => p ?? {});
    expect(params.length).toBeGreaterThan(0);
    for (const p of params) {
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining([expect.stringMatching(/commune|comuna|ciudad/i)]));
      expect(JSON.stringify(p)).not.toContain('Santiago');
    }
  });
});

// Auditoría UX F-03 (entrega 2, 2026-10-17): plazo de respuesta por correo, 3 pasos y resumen
// para imprimir; sin WhatsApp ni llamadas (el equipo responde siempre por correo).
describe('SmartQuotePage: plazo y confirmación', () => {
  const NO_OTHER_CHANNEL = /whatsapp|wa\.me|llam(?:ar|amos|aremos|ada)|tel[eé]fono|\+56/i;
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('junto al botón: "Te respondemos por correo el mismo día hábil" y el horario, también en el HTML del prerender', () => {
    renderPage();
    const note = screen.getByText(responseTimePromise);
    expect(submitButton().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.nextElementSibling).toHaveTextContent(`Atendemos de ${businessHoursLong}`);
    const html = renderToString(page());
    expect(html).toContain(responseTimePromise);
  });

  it('la confirmación: plazo, horario, referencia, 3 pasos, revisa tu correo, resumen del proyecto e imprimir; sin WhatsApp', async () => {
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true, reference: 'PY-ux02', dealId: 9 })));
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderPage();
    fillForm();
    type(/Ciudad/, 'Santiago');
    fireEvent.click(submitButton());
    const heading = await screen.findByRole('heading', { name: 'Propuesta solicitada' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(`${responseTimePromise} Referencia: PY-ux02`);
    expect(toast.success).toHaveBeenCalledWith('Propuesta solicitada', { description: responseTimePromise });

    const container = heading.closest('[data-elights-form]') as HTMLElement;
    expect(container).toHaveAttribute('data-elights-form', 'cotizador');
    const text = container.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(`Atendemos de ${businessHoursLong} Si tu solicitud llegó fuera de ese horario, te respondemos el día hábil siguiente.`);
    expect(within(screen.getByRole('region', { name: 'Próximos pasos' })).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Revisamos los datos de tu proyecto.',
      'Te enviamos por correo la propuesta técnica, con la cotización formal.',
      'Si la aceptas, pagas con el link de pago: la compra se hace solo cuando pagas.',
    ]);
    expect(text).toContain('Revisa tu correo, también la carpeta de spam');
    // El resumen lleva los datos del proyecto, no los de contacto
    const summary = screen.getByRole('region', { name: 'Resumen de tu solicitud' });
    expect(summary).toHaveTextContent('Tipo de proyectoBodega');
    expect(summary).toHaveTextContent('1200');
    expect(summary).not.toHaveTextContent('prueba-etapa2-09d@example.com');
    expect(summary).not.toHaveTextContent('0904');
    expect(screen.getByRole('link', { name: contactEmail })).toHaveAttribute('href', `mailto:${contactEmail}?subject=${encodeURIComponent('Solicitud PY-ux02')}`);

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir o guardar resumen' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');

    expect(text).not.toMatch(NO_OTHER_CHANNEL);
    expect(text).not.toMatch(/te contactar|copia/i);
    expect(container.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull();
  });

  it('sin referencia en la respuesta: la confirmación igual da el plazo y los pasos, sin "Referencia"', async () => {
    vi.stubGlobal('fetch', reply(201, JSON.stringify({ success: true })));
    renderPage();
    fillForm();
    fireEvent.click(submitButton());
    const heading = await screen.findByRole('heading', { name: 'Propuesta solicitada' });
    expect(heading).toHaveAccessibleDescription(responseTimePromise);
    expect(screen.queryByText(/Referencia:/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3); // los 3 pasos
  });
});

// Adjuntar archivos (especificación «Adjuntar archivos», 22-10-2026, §1, §2 y §6). D1: se suben
// AL ENVIAR, después de validateForm y de la casilla, nunca con el campo trampa lleno; de a
// uno, directo a Vercel Blob (uploadPresigned, simulado). D2: consulta previa y tope diario.
describe('SmartQuotePage: adjuntar archivos', () => {
  const MB = 1024 * 1024;
  const UPLOAD_URL = '/api/project-quotes/upload';
  const CREATE_URL = '/api/project-quotes/create';
  const FIELD_HELP = 'Bases de licitación, fichas técnicas, planos o planillas. PDF, JPG, PNG, DWG, DXF o XLSX; hasta 5 archivos de 20 MB cada uno.';
  const FAILED = (name: string) => `No pudimos subir "${name}". Reintenta o envía la solicitud sin ese archivo.`;
  const DAILY_LIMIT = 'Hoy no podemos recibir más archivos por el sitio. Envía tu solicitud y mándanos los archivos a ventas@elights.cl con tu número de solicitud.';
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

  /** Un archivo de `size` bytes sin reservar la memoria (el peso es lo que se revisa). */
  const file = (name: string, size: number, type = '') => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  const fileInput = () => screen.getByLabelText('Elegir archivos') as HTMLInputElement;
  const choose = (...files: File[]) => fireEvent.change(fileInput(), { target: { files } });
  const errorsRegion = () => document.getElementById('sq-archivos-errors')!;

  type Call = [string, RequestInit];
  const calls = () => vi.mocked(fetch).mock.calls as unknown as Call[];
  const bodiesTo = (url: string) => calls().filter(([u]) => u === url).map(([, init]) => JSON.parse(init.body as string));

  /** fetch: la consulta previa responde `status`; el envío, `create` (en orden, el último se repite). */
  function stubServer({ status = { available: true } as unknown, create = [[201, { success: true, reference: 'PY-adj1', dealId: 7 }]] as [number, unknown][] } = {}) {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === UPLOAD_URL) {
        if (status instanceof Error) throw status;
        return { ok: true, status: 200, text: async () => JSON.stringify(status) };
      }
      const [code, body] = create[Math.min(n++, create.length - 1)];
      return { ok: code >= 200 && code < 300, status: code, text: async () => JSON.stringify(body) };
    }));
  }

  /** uploadPresigned simulado: avanza la mitad, después todo, y devuelve la ruta con el sufijo de Blob. */
  const blobOk = async (pathname: string, body: unknown, opts: { onUploadProgress?: (e: { loaded: number; total: number; percentage: number }) => void }) => {
    const size = (body as File).size;
    opts.onUploadProgress?.({ loaded: size / 2, total: size, percentage: 50 });
    opts.onUploadProgress?.({ loaded: size, total: size, percentage: 100 });
    const stored = pathname.replace(/\.(\w+)$/, '-Ab12Cd34Ef.$1');
    return { pathname: stored, url: 'https://blob.example/' + stored, downloadUrl: '', contentType: '', contentDisposition: '', etag: '' };
  };

  beforeEach(() => {
    vi.mocked(trackLead).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(uploadPresigned).mockReset();
    vi.mocked(uploadPresigned).mockImplementation(blobOk as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('el campo va después de los comentarios, con título, ayuda y «Elegir archivos»; en el prerender, igual y deshabilitado', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // aviso de useLayoutEffect, solo en jsdom
    const html = renderToString(page());
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      const group = within(container).getByRole('group', { name: 'Adjuntar archivos (opcional)' });
      expect(group).toHaveAccessibleDescription(FIELD_HELP);
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).toBeDisabled(); // dentro del fieldset deshabilitado hasta hidratar
      expect(input.closest('fieldset')).toHaveAttribute('disabled');
      expect(input).toHaveAttribute('multiple');
      expect(input.getAttribute('accept')).toBe('.pdf,.jpg,.png,.dwg,.dxf,.xlsx,.jpeg');
      expect(within(group).getByText('Elegir archivos').tagName).toBe('LABEL');
      const comentarios = container.querySelector('textarea[name="comentarios"]')!;
      expect(comentarios.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // En el mismo bloque «Información del proyecto»
      expect(group.closest('.border')!.querySelector('h2')).toHaveTextContent('Información del proyecto');
    } finally {
      container.remove();
    }
    renderPage();
    expect(screen.getByRole('group', { name: 'Adjuntar archivos (opcional)' })).toHaveAccessibleDescription(FIELD_HELP);
    expect(fileInput()).toBeEnabled();
    expect(errorsRegion()).toHaveAttribute('aria-live', 'polite');
  });

  it('al elegir: formato, peso, vacío y más de 5, bajo el campo; la lista con nombre, peso y «Quitar»; no sube nada', async () => {
    stubServer();
    renderPage();
    choose(file('bases.doc', 1000), file('plano.dwg', 34 * MB), file('ficha.pdf', 0), file('bases.pdf', 2.1 * MB), file('foto.JPEG', 85 * 1024));
    const region = errorsRegion();
    expect([...region.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      '"bases.doc" no se puede adjuntar. Usa PDF, JPG, PNG, DWG, DXF o XLSX.',
      '"plano.dwg" pesa 34 MB y el máximo es 20 MB. Mándalo a ventas@elights.cl cuando tengas tu número de solicitud.',
      '"ficha.pdf" está vacío.',
    ]);
    // El campo lleva los errores en su descripción
    expect(fileInput().getAttribute('aria-describedby')).toBe('sq-archivos-help sq-archivos-errors');
    const list = screen.getByRole('list', { name: 'Archivos elegidos' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'bases.pdf2,1 MBQuitar bases.pdf',
      'foto.JPEG85 KBQuitar foto.JPEG',
    ]);
    // Apenas pasa el máximo: nunca «pesa 20 MB y el máximo es 20 MB»
    choose(file('justo.pdf', 20 * MB + 1));
    expect(region).toHaveTextContent('"justo.pdf" pesa 20,1 MB y el máximo es 20 MB.');
    // Hasta 5: entran 3 más y el resto se avisa una vez
    choose(file('a.pdf', 10), file('b.png', 10), file('c.xlsx', 10), file('d.dxf', 10), file('e.dwg', 10));
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect([...region.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Puedes adjuntar hasta 5 archivos. Los demás, mándalos a ventas@elights.cl cuando tengas tu número de solicitud.',
    ]);
    // Quitar saca el archivo y el aviso
    fireEvent.click(screen.getByRole('button', { name: 'Quitar bases.pdf' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).queryByText('bases.pdf')).not.toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadPresigned).not.toHaveBeenCalled();
  });

  it('la subida empieza solo con el formulario válido y la casilla marcada (D1)', async () => {
    stubServer();
    renderPage();
    choose(file('bases.pdf', 1000));
    fillForm('212 3456'); // teléfono de 7 dígitos
    fireEvent.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 8 y 12 dígitos');
    type(/Teléfono/, '+56 9 0000 0904');
    fireEvent.click(privacyBox()); // desmarca la casilla
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(CONSENT_ERRORS.solicitud));
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadPresigned).not.toHaveBeenCalled();
    fireEvent.click(privacyBox());
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-adj1')).toBeInTheDocument();
    expect(uploadPresigned).toHaveBeenCalledTimes(1);
    // Primero la consulta previa, después el envío
    expect(calls().map(([u]) => u)).toEqual([UPLOAD_URL, CREATE_URL]);
  });

  it('con el campo trampa lleno no se sube nada y el envío va sin archivos', async () => {
    stubServer({ create: [[200, { success: true }]] });
    const { container } = renderPage();
    choose(file('bases.pdf', 1000));
    fillForm();
    fireEvent.change(container.querySelector('input[name="website"]')!, { target: { value: 'http://spam.example' } });
    fireEvent.click(submitButton());
    expect(await screen.findByRole('heading', { name: /Propuesta solicitada/ })).toBeInTheDocument();
    expect(uploadPresigned).not.toHaveBeenCalled();
    expect(calls().map(([u]) => u)).toEqual([CREATE_URL]);
    expect(bodiesTo(CREATE_URL)[0]).not.toHaveProperty('archivos');
    expect(screen.queryByText(/archivo/)).not.toBeInTheDocument();
  });

  it('sube de a uno (ruta, tipo, peso y privado), muestra «Subiendo archivos… 40 %» y luego «Enviando…», y confirma la cantidad', async () => {
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    let releaseCreate: () => void = () => {};
    vi.mocked(uploadPresigned)
      .mockImplementationOnce((async (pathname: string, body: unknown, opts: { onUploadProgress: (e: object) => void }) => {
        opts.onUploadProgress({ loaded: 200, total: 400, percentage: 50 });
        await new Promise<void>((r) => { releaseFirst = r; });
        return blobOk(pathname, body, opts);
      }) as never)
      .mockImplementationOnce((async (pathname: string, body: unknown, opts: never) => {
        await new Promise<void>((r) => { releaseSecond = r; });
        return blobOk(pathname, body, opts);
      }) as never);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === UPLOAD_URL) return { ok: true, status: 200, text: async () => '{"available":true}' };
      n++;
      await new Promise<void>((r) => { releaseCreate = r; });
      return { ok: true, status: 201, text: async () => JSON.stringify({ success: true, reference: 'PY-adj2', dealId: 8 }) };
    }));
    renderPage();
    choose(file('bases.pdf', 400), file('plano.dwg', 600));
    fillForm();
    fireEvent.click(submitButton());

    // Va la mitad del primero (200 de 1000 bytes) y el segundo todavía no empieza: de a uno
    expect(await screen.findByRole('button', { name: /Subiendo archivos… 20\u00a0%/ })).toBeDisabled();
    // El lector de pantalla oye la etapa, y el avance solo cada 25 % (no en cada evento). Es la
    // última región role="status": la primera es la de «Recordar mis datos», vacía
    const sendingStatus = () => {
      const regions = screen.getAllByRole('status');
      expect(regions).toHaveLength(2);
      expect(regions[0]).toBeEmptyDOMElement();
      return regions[1];
    };
    expect(sendingStatus()).toHaveTextContent(/^Subiendo archivos…$/);
    expect(uploadPresigned).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Quitar bases.pdf' })).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    // El primero terminó (400 de 1000 bytes) y el segundo espera: 40 %
    await act(async () => { releaseFirst(); });
    expect(await screen.findByRole('button', { name: /Subiendo archivos… 40\u00a0%/ })).toBeDisabled();
    expect(sendingStatus()).toHaveTextContent(/^Subiendo archivos… 25\s%$/); // con espacio duro
    expect(uploadPresigned).toHaveBeenCalledTimes(2);
    await act(async () => { releaseSecond(); });
    expect(await screen.findByRole('button', { name: /Enviando…/ })).toBeDisabled();
    expect(sendingStatus()).toHaveTextContent(/^Enviando…$/);
    expect(n).toBe(1);
    await act(async () => { releaseCreate(); });

    const heading = await screen.findByRole('heading', { name: 'Propuesta solicitada' });
    const line = 'Recibimos tu solicitud PY-adj2 y tus 2 archivos. Si te falta alguno, envíalo a ventas@elights.cl con tu número de solicitud.';
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(heading).toHaveAccessibleDescription(`${responseTimePromise} Referencia: PY-adj2 ${line}`);

    // La consulta previa: cuántos y cuánto, sin nombres
    expect(bodiesTo(UPLOAD_URL)).toEqual([{ type: 'elights.upload-status', payload: { files: 2, bytes: 1000 } }]);
    // Cada subida: cotizador/<uuid>.<ext>, privada, el tipo de la extensión y el peso declarado
    const uploads = vi.mocked(uploadPresigned).mock.calls as unknown as [string, File, Record<string, unknown>][];
    expect(uploads.map(([path]) => path)).toEqual([expect.stringMatching(new RegExp(`^cotizador/${UUID}\\.pdf$`)), expect.stringMatching(new RegExp(`^cotizador/${UUID}\\.dwg$`))]);
    for (const [path] of uploads) expect(path).toMatch(UPLOAD_PATHNAME_RE);
    expect(uploads[0][1].name).toBe('bases.pdf');
    expect(uploads[0][2]).toMatchObject({ access: 'private', handleUploadUrl: UPLOAD_URL, contentType: 'application/pdf', clientPayload: '{"size":400}' });
    expect(uploads[1][2]).toMatchObject({ access: 'private', handleUploadUrl: UPLOAD_URL, contentType: 'image/vnd.dwg', clientPayload: '{"size":600}' });
    expect(uploads[0][2]).not.toHaveProperty('multipart');
    // El envío lleva las rutas guardadas en Blob (las que acepta create.ts) y los nombres
    const { archivos } = bodiesTo(CREATE_URL)[0];
    expect(archivos).toEqual([
      { pathname: uploads[0][0].replace('.pdf', '-Ab12Cd34Ef.pdf'), nombre: 'bases.pdf' },
      { pathname: uploads[1][0].replace('.dwg', '-Ab12Cd34Ef.dwg'), nombre: 'plano.dwg' },
    ]);
    for (const a of archivos) expect(a.pathname).toMatch(STORED_PATHNAME_RE);
    expect(trackLead).toHaveBeenCalledTimes(1);
  });

  it('si falla un archivo: aviso con «Reintentar» y «Enviar sin ese archivo»; Reintentar no vuelve a subir lo que ya subió', async () => {
    stubServer();
    vi.mocked(uploadPresigned)
      .mockImplementationOnce(blobOk as never)
      .mockImplementationOnce(async () => { throw new Error('Failed to retrieve the presigned URL'); });
    renderPage();
    choose(file('bases.pdf', 400), file('plano.dwg', 600));
    fillForm();
    fireEvent.click(submitButton());

    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    expect(errorsRegion()).toHaveTextContent(FAILED('plano.dwg'));
    expect(screen.getByRole('button', { name: 'Enviar sin ese archivo' })).toBeEnabled();
    await waitFor(() => expect(retry).toHaveFocus());
    // No se envió nada y los datos quedan
    expect(calls().map(([u]) => u)).toEqual([UPLOAD_URL]);
    expect(screen.queryByRole('heading', { name: /Propuesta solicitada/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre y Apellido/)).toHaveValue('PRUEBA ETAPA 2 (09d)');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(submitButton()).toBeEnabled();
    // Nunca el nombre del archivo en la consola
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/plano|bases/);

    fireEvent.click(retry);
    expect(await screen.findByText('PY-adj1')).toBeInTheDocument();
    const uploads = vi.mocked(uploadPresigned).mock.calls as unknown as [string, File][];
    expect(uploads.map(([, f]) => f.name)).toEqual(['bases.pdf', 'plano.dwg', 'plano.dwg']);
    // La segunda consulta previa cuenta solo lo que faltaba
    expect(bodiesTo(UPLOAD_URL).map((b) => b.payload)).toEqual([{ files: 2, bytes: 1000 }, { files: 1, bytes: 600 }]);
    expect(bodiesTo(CREATE_URL)[0].archivos.map((a: { nombre: string }) => a.nombre)).toEqual(['bases.pdf', 'plano.dwg']);
    expect(screen.getByText(/y tus 2 archivos\./)).toBeInTheDocument();
  });

  it('«Enviar sin ese archivo» envía con los demás; con uno solo, «y tu archivo»', async () => {
    stubServer();
    vi.mocked(uploadPresigned)
      .mockImplementationOnce(blobOk as never)
      .mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    renderPage();
    choose(file('bases.pdf', 400), file('plano.dwg', 600));
    fillForm();
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar sin ese archivo' }));
    expect(await screen.findByText('PY-adj1')).toBeInTheDocument();
    expect(uploadPresigned).toHaveBeenCalledTimes(2);
    expect(bodiesTo(CREATE_URL)).toHaveLength(1);
    expect(bodiesTo(CREATE_URL)[0].archivos.map((a: { nombre: string }) => a.nombre)).toEqual(['bases.pdf']);
    expect(
      screen.getByText('Recibimos tu solicitud PY-adj1 y tu archivo. Si te falta alguno, envíalo a ventas@elights.cl con tu número de solicitud.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['tope diario', { available: false, code: 'daily_limit' }],
    ['subida no disponible (sin almacén o Redis caído)', { available: false, code: 'unavailable' }],
  ])('%s (D2): el aviso con «Enviar sin archivos», nada se sube y el formulario sigue', async (_name, status) => {
    stubServer({ status });
    renderPage();
    choose(file('bases.pdf', 400));
    fillForm();
    fireEvent.click(submitButton());
    const without = await screen.findByRole('button', { name: 'Enviar sin archivos' });
    expect(errorsRegion()).toHaveTextContent(DAILY_LIMIT);
    await waitFor(() => expect(without).toHaveFocus());
    expect(uploadPresigned).not.toHaveBeenCalled();
    expect(calls().map(([u]) => u)).toEqual([UPLOAD_URL]);
    fireEvent.click(without);
    expect(await screen.findByText('PY-adj1')).toBeInTheDocument();
    expect(bodiesTo(CREATE_URL)[0]).not.toHaveProperty('archivos');
    expect(screen.queryByText(/Recibimos tu solicitud/)).not.toBeInTheDocument();
  });

  it('si la consulta previa no responde, se intenta subir igual', async () => {
    stubServer({ status: new TypeError('Failed to fetch') });
    renderPage();
    choose(file('bases.pdf', 400));
    fillForm();
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-adj1')).toBeInTheDocument();
    expect(uploadPresigned).toHaveBeenCalledTimes(1);
    expect(bodiesTo(CREATE_URL)[0].archivos).toHaveLength(1);
  });

  it('400 después de subir: el reintento reenvía las mismas rutas sin volver a subir', async () => {
    stubServer({ create: [[400, { success: false, error: 'Validation failed' }], [201, { success: true, reference: 'PY-adj3', dealId: 9 }]] });
    renderPage();
    choose(file('bases.pdf', 400));
    fillForm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/Revisa email y teléfono/);
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-adj3')).toBeInTheDocument();
    expect(uploadPresigned).toHaveBeenCalledTimes(1);
    const [first, second] = bodiesTo(CREATE_URL);
    expect(second.archivos).toEqual(first.archivos);
    expect(bodiesTo(UPLOAD_URL)).toHaveLength(1);
  });

  it("crm: 'failed' (el servidor borró los adjuntos): la confirmación no los cuenta", async () => {
    stubServer({ create: [[200, { success: true, reference: 'PY-adj4', dealId: null, crm: 'failed' }]] });
    renderPage();
    choose(file('bases.pdf', 400));
    fillForm();
    fireEvent.click(submitButton());
    expect(await screen.findByText('PY-adj4')).toBeInTheDocument();
    expect(bodiesTo(CREATE_URL)[0].archivos).toHaveLength(1);
    expect(screen.queryByText(/Recibimos tu solicitud/)).not.toBeInTheDocument();
  });
});
