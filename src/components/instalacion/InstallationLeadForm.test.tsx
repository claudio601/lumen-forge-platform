// Formulario de instalación: el navegador ya no llama al relay de correo; el servidor
// manda el correo a ventas y crea el negocio. "Solicitud recibida" y la conversión solo
// cuando el servidor confirma { success: true }. Cualquier otra respuesta muestra un error
// junto al botón (role="alert") y deja los datos escritos para reintentar.
// PR 13: la casilla anterior («Acepto que eLIGHTS me contacte…») pasa a ser la casilla común
// de privacidad, con la nota aprobada debajo; aceptaContacto sigue viajando, igual a ella.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import InstallationLeadForm from './InstallationLeadForm';
import { CONSENT_ERRORS, CONSENT_TEXTS, LEGACY_INSTALLATION_CHECKBOX, LEGAL_VERSION, parseConsent } from '../../../api/_lib/forms/consent';

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { sendEvent, trackLead } from '@/lib/analytics';

const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

const NAME = 'PRUEBA ETAPA 2 (09c) - borrar';
const EMAIL = 'prueba-etapa2-09c@example.com';
const DESCRIPCION = 'PRUEBA ETAPA 2 (09c) - no contactar; borrar';

// Los textos de las casillas enlazan a las páginas legales (<Link>): necesitan un Router
const form = () => <MemoryRouter><InstallationLeadForm /></MemoryRouter>;
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const marketingBox = () => screen.getByLabelText(/Quiero recibir novedades/) as HTMLInputElement;

function fillForm({ telefono = '+56 9 0000 0903', email = EMAIL, consent = true } = {}) {
  const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type(/Nombre completo/, NAME);
  type(/Teléfono/, telefono);
  type(/Correo electrónico/, email);
  type(/Comuna/, 'Santiago');
  type(/Tipo de proyecto/, 'Oficina');
  type(/Descripción breve/, DESCRIPCION);
  type(/Tipo de cliente/, 'empresa');
  type(/Preferencia de contacto/, 'email');
  if (consent) fireEvent.click(privacyBox());
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /SOLICITAR EVALUACIÓN/ }));
const fetchUrls = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([url]) => String(url));
const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

describe('InstallationLeadForm', () => {
  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('201 { success: true }: "Solicitud recibida", un solo envío al endpoint y la conversión una vez', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":777,"dealAction":"created","leadRef":"INST-x"}'));
    render(form());
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(fetchUrls()).toEqual(['/api/installation-leads/create']);
    expect(fetchUrls().some((u) => u.includes('script.google.com'))).toBe(false);
    expect(trackLead).toHaveBeenCalledTimes(1);
    // Sin la comuna (PR 13): a Google Analytics no va nada que ayude a identificar a la persona
    expect(trackLead).toHaveBeenCalledWith('instalacion', { tipo_proyecto: 'Oficina' });
    expect(sendEvent).toHaveBeenCalledWith('instalacion_form_submit_attempt', { tipo_proyecto: 'Oficina' });

    const body = sentBody();
    expect(body).toMatchObject({
      nombre: NAME, email: EMAIL, telefono: '+56 9 0000 0903', comuna: 'Santiago', tipoProyecto: 'Oficina',
      descripcion: DESCRIPCION, tipoCliente: 'empresa', preferenciaContacto: 'email', aceptaContacto: true,
      origen: 'instalacion_web', website: '',
      consent: { privacy: true, marketing: false, version: LEGAL_VERSION },
    });
    // La fecha la pone el servidor (hora de Chile)
    expect(body).not.toHaveProperty('fecha');
  });

  it.each([
    ['400', reply(400, '{"success":false,"error":"Validation failed"}'), 400, /Revisa los datos/],
    ['403', reply(403, '{"success":false,"error":"Forbidden"}'), 403, /WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
    ['429', reply(429, '{"success":false}'), 429, /Espera unos minutos/],
    ['500', reply(500, '{"success":false}'), 500, /No pudimos registrar/],
    ['502', reply(502, '{"success":false}'), 502, /No pudimos registrar/],
    ['504 con HTML', reply(504, '<!DOCTYPE html><html>An error occurred</html>'), 504, /No pudimos registrar/],
    ['200 { success: false }', reply(200, '{"success":false}'), 200, /No pudimos registrar/],
    ['200 sin JSON', reply(200, '<html>ok?</html>'), 200, /No pudimos registrar/],
    ['red caída', vi.fn(async () => { throw new TypeError('Failed to fetch'); }), 0, /No pudimos registrar/],
  ])('%s: error junto al botón, sin éxito ni conversión, y los datos quedan', async (_name, fetchImpl, httpStatus, message) => {
    vi.stubGlobal('fetch', fetchImpl);
    render(form());
    fillForm();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByText('Solicitud recibida')).not.toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue(NAME);
    expect(screen.getByLabelText(/Descripción breve/)).toHaveValue(DESCRIPCION);
    expect(privacyBox()).toBeChecked();
    expect(sendEvent).toHaveBeenCalledWith('instalacion_form_submit_failure', { tipo_proyecto: 'Oficina', error_message: 'http_' + httpStatus });
    await waitFor(() => expect(screen.getByRole('button', { name: /SOLICITAR EVALUACIÓN/ })).toBeEnabled());
  });

  it('preferencia de contacto: correo o teléfono, sin WhatsApp; la confirmación dice por dónde', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":777,"dealAction":"created","leadRef":"INST-x"}'));
    render(form());
    const options = within(screen.getByLabelText(/Preferencia de contacto/)).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Sin preferencia', 'Llamada telefónica', 'Correo electrónico']);
    fillForm();
    submit();
    expect(await screen.findByText(/te contactará por correo o por teléfono/)).toBeInTheDocument();
  });

  it('el campo trampa oculto se envía con lo que tenga; la respuesta { success: true } sin referencia no es conversión', async () => {
    vi.stubGlobal('fetch', reply(200, '{"success":true}'));
    render(form());
    fillForm();
    fireEvent.change(screen.getByLabelText(/No completar/), { target: { value: 'http://spam.example' } });
    submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(sentBody().website).toBe('http://spam.example');
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
  });

  it.each([
    ['un teléfono de 7 dígitos', { telefono: '212 3456' }, /entre 8 y 12 dígitos/],
    ['un teléfono de 13 dígitos', { telefono: '+56 9 1234 5678 90' }, /entre 8 y 12 dígitos/],
    ['un correo sin dominio (a@b)', { email: 'a@b' }, /correo electrónico válido/],
    ['sin marcar la casilla de privacidad', { consent: false }, CONSENT_ERRORS.solicitud],
  ])('%s se rechaza en el navegador, sin llamar al servidor', async (_name, opts, message) => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    fillForm(opts);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(fetch).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
  });

  it('los campos tienen los mismos topes que el servidor', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    expect(screen.getByLabelText(/Nombre completo/)).toHaveAttribute('maxLength', '120');
    expect(screen.getByLabelText(/Teléfono/)).toHaveAttribute('maxLength', '30');
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveAttribute('maxLength', '254');
    expect(screen.getByLabelText(/Comuna/)).toHaveAttribute('maxLength', '80');
    const desc = screen.getByLabelText(/Descripción breve/);
    expect(desc).toHaveAttribute('maxLength', '2000');
    fillForm();
    // jsdom no aplica maxLength a un cambio por código: lo frena la validación del formulario
    fireEvent.change(desc, { target: { value: 'd'.repeat(2001) } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('hasta 2000 caracteres');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('la casilla común de privacidad reemplaza a la anterior; la nota aprobada nombra a Vercel, Google y Pipedrive', () => {
    const { container } = render(form());
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/No compartiremos/i);
    expect(text).not.toContain(LEGACY_INSTALLATION_CHECKBOX);
    expect(screen.queryByLabelText(/Acepto que eLIGHTS/)).not.toBeInTheDocument();
    expect(privacyBox().closest('label')).toHaveTextContent('Leí la Política de privacidad y autorizo a eLIGHTS a usar mis datos para responder esta solicitud. *');
    expect(text).toContain('Usamos estos datos para responder y dar seguimiento a tu solicitud. Quedan registrados en los servicios con que trabajamos: Vercel (sitio web), Google (correo) y Pipedrive (gestión de clientes).');
    expect(text).toContain(CONSENT_TEXTS.installationNote);
  });

  it('la nota de datos se lee junto a la casilla y tiene contraste suficiente (gray-600, no gray-400)', () => {
    render(form());
    const consent = privacyBox();
    expect(consent).toHaveAccessibleDescription(/Usamos estos datos para responder y dar seguimiento a tu solicitud\..*Pipedrive \(gestión de clientes\)\./);
    const note = document.getElementById(consent.getAttribute('aria-describedby')!)!;
    // gray-400 sobre blanco da 2,54:1 (WCAG AA pide 4,5:1 en texto de 12 px); gray-600 da 7,56:1
    expect(note).toHaveClass('text-gray-600');
    expect(note).not.toHaveClass('text-gray-400');
  });
});

// El HTML de /instalacion es estático (prerender). Hasta que React hidrata, el formulario no
// tiene onSubmit: un envío nativo con GET pondría nombre, teléfono y correo en la URL y la
// solicitud se perdería sin aviso.
describe('InstallationLeadForm antes de hidratar (HTML del prerender)', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const serverContainer = () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(form());
    document.body.appendChild(container);
    return container;
  };

  it('el formulario usa method="post" (nunca GET con los datos en la URL) y todo está deshabilitado', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // aviso de useLayoutEffect (MemoryRouter), solo en jsdom
    const container = serverContainer();
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.hasAttribute('action')).toBe(false);
    expect(container.querySelector('fieldset')).toHaveAttribute('disabled');
    const button = within(container).getByRole('button', { name: /SOLICITAR EVALUACIÓN/ });
    expect(button).toHaveAttribute('disabled');
    expect(button).toBeDisabled();
    const controls = [...form.querySelectorAll('input, select, textarea')];
    expect(controls.map((c) => c.getAttribute('name'))).toEqual(expect.arrayContaining(['nombre', 'telefono', 'email', 'comuna', 'descripcion', 'consentPrivacy', 'consentMarketing', 'website']));
    expect(controls.map((c) => c.getAttribute('name'))).not.toContain('aceptaContacto');
    for (const control of controls) expect(control).toBeDisabled();
    // Las casillas, sin marcar en el HTML estático, y el contenedor marcado para la etiqueta de Google
    for (const name of ['consentPrivacy', 'consentMarketing']) expect(form.querySelector(`input[name="${name}"]`)).not.toBeChecked();
    expect(form.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'instalacion');
  });

  it('al hidratar se habilita, sin descartar el HTML del servidor', async () => {
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = serverContainer();
    // En jsdom, MemoryRouter usa useLayoutEffect en el render del servidor y React avisa (en Node,
    // donde corre el prerender, no). Solo cuentan los avisos de la hidratación.
    consoleErrors.mockClear();
    const serverButton = container.querySelector('button[type="submit"]');
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, form(), { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(consoleErrors.mock.calls.map((args) => args.map(String).join(' ')).filter((m) => /did not match|server HTML|hydrat/i.test(m))).toEqual([]);
    expect(container.contains(serverButton)).toBe(true); // React reutilizó el nodo
    expect(container.querySelector('fieldset')).not.toHaveAttribute('disabled');
    expect(within(container).getByRole('button', { name: /SOLICITAR EVALUACIÓN/ })).toBeEnabled();
    expect(within(container).getByLabelText(/Nombre completo/)).toBeEnabled();
    expect(within(container).getByLabelText(/autorizo a eLIGHTS a usar mis datos/)).toBeEnabled();
    expect(within(container).getByLabelText(/autorizo a eLIGHTS a usar mis datos/)).not.toBeChecked();
    act(() => root?.unmount());
  });
});

// Origen de la visita (Etapa 2 · PR 10): lo guarda src/lib/attribution.ts en la sesión y el
// formulario lo manda como `attribution`, aparte de su campo `origen` (instalacion_web).
describe('InstallationLeadForm: origen de la visita', () => {
  const ATTRIBUTION = { gclid: 'Cj0KCQjwEJEMPLO123', utm_source: 'google', utm_medium: 'cpc', landing: '/catalogo/campanas-led', referrer: 'https://www.google.com' };
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('con un origen guardado en la sesión, el envío lo lleva en attribution y origen sigue igual', async () => {
    sessionStorage.setItem('elights_attribution', JSON.stringify(ATTRIBUTION));
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":777,"dealAction":"created","leadRef":"INST-x"}'));
    render(form());
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(sentBody()).toMatchObject({ origen: 'instalacion_web', attribution: ATTRIBUTION });
  });

  it('sin origen guardado, la clave attribution no viaja', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":777,"dealAction":"created","leadRef":"INST-x"}'));
    render(form());
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(sentBody()).not.toHaveProperty('attribution');
  });
});

// Privacidad y novedades (Etapa 2 · PR 13): useConsentFields('solicitud') con la nota aprobada.
describe('InstallationLeadForm: casillas de privacidad y novedades', () => {
  const CONSENT_400 = JSON.stringify({ success: false, error: 'Validation failed', code: 'consent_required', details: { errors: ['consent is required'] } });
  const button = () => screen.getByRole('button', { name: /SOLICITAR EVALUACIÓN/ });

  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('las dos casillas sin marcar ocupan las dos columnas de la grilla, con la nota bajo la obligatoria', () => {
    render(form());
    const group = screen.getByRole('group', { name: 'Privacidad y novedades' });
    expect(group).toHaveClass('sm:col-span-2');
    expect(group.parentElement).toHaveClass('grid');
    expect(within(group).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/politica-de-privacidad']);
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
    expect(privacyBox()).toHaveAttribute('name', 'consentPrivacy');
    expect(within(group).getByText(CONSENT_TEXTS.installationNote)).toBeInTheDocument();
  });

  it('con el resto inválido, solo el error del resto: el de la casilla no aparece', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    fillForm({ telefono: '212 3456', consent: false });
    submit();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('entre 8 y 12 dígitos');
    expect(screen.queryByText(CONSENT_ERRORS.solicitud)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('con el resto válido y sin marcar: no envía, el mensaje junto a la casilla y el foco en ella', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    fillForm({ consent: false });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CONSENT_ERRORS.solicitud);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' })).toContainElement(alert);
    expect(privacyBox()).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
    fireEvent.click(privacyBox());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([false, true])('marcada (novedades %s): aceptaContacto es igual a la casilla, consent con el estado real y el servidor lo acepta', async (marketing) => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":777,"dealAction":"created","leadRef":"INST-x"}'));
    render(form());
    fillForm();
    if (marketing) fireEvent.click(marketingBox());
    const checked = privacyBox().checked;
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    const body = sentBody();
    expect(body.consent).toEqual({ privacy: true, marketing, version: LEGAL_VERSION });
    expect(body.consent.privacy).toBe(checked);
    expect(body.aceptaContacto).toBe(checked);
    expect(body.consent).not.toHaveProperty('terms');
    // Contrato con el servidor (api/installation-leads/create.ts)
    expect(parseConsent(body.consent, { requireTerms: false }).ok).toBe(true);
  });

  it('400 con code consent_required: el aviso de la casilla (no el del teléfono) y el botón vuelve', async () => {
    vi.stubGlobal('fetch', reply(400, CONSENT_400));
    render(form());
    fillForm();
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(CONSENT_ERRORS.solicitud));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Revisa los datos/)).not.toBeInTheDocument();
    expect(privacyBox()).toHaveFocus();
    expect(trackLead).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue(NAME);
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('después de un envío confirmado, «Enviar otra solicitud» vuelve con las casillas sin marcar', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    fillForm();
    fireEvent.click(marketingBox());
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar otra solicitud' }));
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('el formulario y la confirmación llevan data-elights-form="instalacion"; Analytics sin comuna', async () => {
    vi.stubGlobal('fetch', reply(502, '{"success":false}'));
    render(form());
    expect(button().closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'instalacion');
    fillForm();
    submit();
    await screen.findByRole('alert');
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    submit();
    const heading = await screen.findByText('Solicitud recibida');
    expect(heading.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'instalacion');
    const params = [...vi.mocked(sendEvent).mock.calls, ...vi.mocked(trackLead).mock.calls].map(([, p]) => p ?? {});
    expect(params.length).toBeGreaterThanOrEqual(4); // vista, 2 intentos, falla y conversión
    for (const p of params) {
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining([expect.stringMatching(/commune|comuna/i)]));
      expect(JSON.stringify(p)).not.toContain('Santiago');
    }
  });
});
