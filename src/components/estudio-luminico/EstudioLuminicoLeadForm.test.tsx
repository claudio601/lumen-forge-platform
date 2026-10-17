// Formulario de estudio lumínico: "Solicitud recibida" y la conversión solo cuando el
// servidor confirma { success: true }. Cualquier otra respuesta muestra un error junto al
// botón (role="alert") y deja los datos escritos para reintentar.
// PR 13: casilla de privacidad obligatoria, novedades opcional y topes de largo del servidor.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import EstudioLuminicoLeadForm from './EstudioLuminicoLeadForm';
import { CONSENT_ERRORS, LEGAL_VERSION, parseConsent } from '../../../api/_lib/forms/consent';

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { sendEvent, trackLead } from '@/lib/analytics';

const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

// Los textos de las casillas enlazan a las páginas legales (<Link>): necesitan un Router
const form = () => <MemoryRouter><EstudioLuminicoLeadForm /></MemoryRouter>;
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const marketingBox = () => screen.getByLabelText(/Quiero recibir novedades/) as HTMLInputElement;

function fillForm(telefono = '+56 9 0000 0901', { consent = true } = {}) {
  const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type(/Nombre completo/, 'PRUEBA ETAPA 2 (09a)');
  type(/Correo electrónico/, 'prueba-etapa2-09a@example.com');
  type(/Teléfono/, telefono);
  type(/Tipo de proyecto/, 'industria_bodega');
  type(/Comuna \/ Ciudad/, 'Santiago');
  type(/Tienes planos/, 'no_tengo');
  type(/Dimensiones aproximadas/, 'PRUEBA 10x20 m');
  type(/Altura de montaje/, '6 m');
  type(/Objetivo del proyecto/, 'operacion_industrial');
  if (consent) fireEvent.click(privacyBox());
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /SOLICITAR COTIZACION/ }));

describe('EstudioLuminicoLeadForm', () => {
  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('201 { success: true }: muestra "Solicitud recibida" y registra la conversión una vez', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":555,"leadRef":"ESTL-x"}'));
    render(form());
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(trackLead).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/estudio-luminico/create');
    const body = JSON.parse(init.body as string);
    expect(body.website).toBe('');
    expect(body.telefono).toBe('+56 9 0000 0901');
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
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('PRUEBA ETAPA 2 (09a)');
    expect(screen.getByLabelText(/Dimensiones aproximadas/)).toHaveValue('PRUEBA 10x20 m');
    expect(sendEvent).toHaveBeenCalledWith('estudio_luminico_form_submit_error', expect.objectContaining({ httpStatus }));
    await waitFor(() => expect(screen.getByRole('button', { name: /SOLICITAR COTIZACION/ })).toBeEnabled());
  });

  it('la descripción tiene el mismo tope que el servidor (2000 caracteres)', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    const desc = screen.getByLabelText(/Descripción del proyecto/);
    expect(desc).toHaveAttribute('maxLength', '2000');
    fillForm();
    // jsdom no aplica maxLength a un cambio por código: lo frena la validación del formulario
    fireEvent.change(desc, { target: { value: 'd'.repeat(2001) } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('hasta 2000 caracteres');
    expect(fetch).not.toHaveBeenCalled();
  });

  // Los mismos topes que el servidor (ESTUDIO_MAX_LENGTHS, api/estudio-luminico/validation.ts).
  // Cada valor largo pasa las demás reglas (el correo sigue siendo un correo y el teléfono
  // tiene 11 dígitos): solo lo frena el tope.
  it.each([
    [/Nombre completo/, 120, 'El nombre', 'x'.repeat(121)],
    [/Correo electrónico/, 254, 'El correo', 'a'.repeat(243) + '@example.com'],
    [/Teléfono/, 30, 'El teléfono', '+56 9' + ' '.repeat(30) + '1234 5678'],
    [/Empresa/, 120, 'La empresa', 'x'.repeat(121)],
    [/Comuna \/ Ciudad/, 80, 'La comuna o ciudad', 'x'.repeat(81)],
    [/Dimensiones aproximadas/, 200, 'Las dimensiones', 'x'.repeat(201)],
    [/Altura de montaje/, 60, 'La altura de montaje', 'x'.repeat(61)],
  ])('%s tiene maxLength %i y un texto más largo se frena en el navegador', async (label, max, name, long) => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute('maxLength', String(max));
    fillForm();
    // jsdom no aplica maxLength a un cambio por código: lo frena la validación del formulario
    fireEvent.change(input, { target: { value: long } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(name + ' admite hasta ' + max + ' caracteres.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un teléfono de 7 dígitos se rechaza en el navegador, sin llamar al servidor', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    fillForm('212 3456');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 8 y 15 dígitos');
    expect(fetch).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
  });
});

// El HTML de /estudio-luminico es estático (prerender). Hasta que React hidrata, el formulario
// no tiene onSubmit: un envío nativo con GET pondría nombre, teléfono y correo en la URL y la
// solicitud se perdería sin aviso.
describe('EstudioLuminicoLeadForm antes de hidratar (HTML del prerender)', () => {
  let root: ReturnType<typeof hydrateRoot> | undefined;
  afterEach(() => {
    act(() => root?.unmount()); // también si una aserción falló a mitad de la prueba
    root = undefined;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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
    const button = within(container).getByRole('button', { name: /SOLICITAR COTIZACION/ });
    expect(button).toHaveAttribute('disabled');
    expect(button).toBeDisabled();
    const controls = [...form.querySelectorAll('input, select, textarea')];
    expect(controls.map((c) => c.getAttribute('name'))).toEqual(expect.arrayContaining([
      'nombreCompleto', 'email', 'telefono', 'empresa', 'tipoProyecto', 'comunaCiudad', 'tienePlanos',
      'dimensionesAproximadas', 'alturaMontaje', 'objetivoProyecto', 'normativaObjetivo', 'urgenciaProyecto',
      'descripcionProyecto', 'consentPrivacy', 'consentMarketing', 'website',
    ]));
    for (const control of controls) expect(control).toBeDisabled();
    // Las casillas, sin marcar en el HTML estático, y el contenedor marcado para la etiqueta de Google
    for (const name of ['consentPrivacy', 'consentMarketing']) expect(form.querySelector(`input[name="${name}"]`)).not.toBeChecked();
    expect(form.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'estudio-luminico');
  });

  it('al hidratar se habilita, sin descartar el HTML del servidor', async () => {
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = serverContainer();
    // En jsdom, MemoryRouter usa useLayoutEffect en el render del servidor y React avisa (en Node,
    // donde corre el prerender, no). Solo cuentan los avisos de la hidratación.
    consoleErrors.mockClear();
    const serverButton = container.querySelector('button[type="submit"]');
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, form(), { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(consoleErrors.mock.calls.map((args) => args.map(String).join(' ')).filter((m) => /did not match|server HTML|hydrat/i.test(m))).toEqual([]);
    expect(container.contains(serverButton)).toBe(true); // React reutilizó el nodo
    expect(container.querySelector('fieldset')).not.toHaveAttribute('disabled');
    expect(within(container).getByRole('button', { name: /SOLICITAR COTIZACION/ })).toBeEnabled();
    expect(within(container).getByLabelText(/Nombre completo/)).toBeEnabled();
    expect(within(container).getByLabelText(/Tipo de proyecto/)).toBeEnabled();
    expect(within(container).getByLabelText(/Descripción del proyecto/)).toBeEnabled();
    expect(within(container).getByLabelText(/autorizo a eLIGHTS a usar mis datos/)).toBeEnabled();
    expect(within(container).getByLabelText(/autorizo a eLIGHTS a usar mis datos/)).not.toBeChecked();
  });

  it('ya hidratado, el envío va por fetch (React) y no por el navegador', async () => {
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    const container = serverContainer();
    await act(async () => { root = hydrateRoot(container, form()); });
    const urlBefore = window.location.href;
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/estudio-luminico/create');
    expect(window.location.href).toBe(urlBefore); // sin datos en la URL
    // jsdom avisa "Not implemented: HTMLFormElement.prototype.requestSubmit" si el envío nativo no se frena
    expect(consoleErrors.mock.calls.map((args) => args.map(String).join(' ')).filter((m) => /Not implemented/i.test(m))).toEqual([]);
  });
});

// Origen de la visita (Etapa 2 · PR 10): lo guarda src/lib/attribution.ts en la sesión y el
// formulario lo manda como `attribution`, aparte de su campo `origen` (estudio_luminico_web).
describe('EstudioLuminicoLeadForm: origen de la visita', () => {
  const ATTRIBUTION = { gclid: 'Cj0KCQjwEJEMPLO123', utm_source: 'google', utm_medium: 'cpc', landing: '/catalogo/campanas-led', referrer: 'https://www.google.com' };
  const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('con un origen guardado en la sesión, el envío lo lleva en attribution y origen sigue igual', async () => {
    sessionStorage.setItem('elights_attribution', JSON.stringify(ATTRIBUTION));
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":555,"leadRef":"ESTL-x"}'));
    render(form());
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(sentBody()).toMatchObject({ origen: 'estudio_luminico_web', attribution: ATTRIBUTION });
  });

  it('sin origen guardado, la clave attribution no viaja', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":555,"leadRef":"ESTL-x"}'));
    render(form());
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(sentBody()).not.toHaveProperty('attribution');
  });
});

// Privacidad y novedades (Etapa 2 · PR 13): useConsentFields('solicitud'), dentro del fieldset.
describe('EstudioLuminicoLeadForm: casillas de privacidad y novedades', () => {
  const CONSENT_400 = JSON.stringify({ success: false, error: 'Validation failed', code: 'consent_required', details: { errors: ['consent is required'] } });
  const button = () => screen.getByRole('button', { name: /SOLICITAR COTIZACION/ });
  const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
    vi.mocked(trackLead).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('las dos casillas sin marcar, dentro del fieldset, en las dos columnas y antes del botón', () => {
    const { container } = render(form());
    const group = screen.getByRole('group', { name: 'Privacidad y novedades' });
    expect(container.querySelector('form > fieldset')!.contains(group)).toBe(true);
    expect(group).toHaveClass('sm:col-span-2');
    expect(group.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/politica-de-privacidad']);
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
  });

  it('con el resto inválido, solo el error del resto: el de la casilla no aparece', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    fillForm('212 3456', { consent: false });
    submit();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('entre 8 y 15 dígitos');
    expect(screen.queryByText(CONSENT_ERRORS.solicitud)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('con el resto válido y sin marcar: no envía, el mensaje junto a la casilla y el foco en ella', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    fillForm(undefined, { consent: false });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CONSENT_ERRORS.solicitud);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' })).toContainElement(alert);
    expect(privacyBox()).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    expect(sendEvent).not.toHaveBeenCalledWith('estudio_luminico_form_submit', expect.anything());
    expect(button()).toBeEnabled();
    fireEvent.click(privacyBox());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([false, true])('marcada (novedades %s): consent viaja con el estado real, sin terms, y el servidor lo acepta', async (marketing) => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":555,"leadRef":"ESTL-x"}'));
    render(form());
    fillForm();
    if (marketing) fireEvent.click(marketingBox());
    const checked = privacyBox().checked;
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    const { consent } = sentBody();
    expect(consent).toEqual({ privacy: true, marketing, version: LEGAL_VERSION });
    expect(consent.privacy).toBe(checked);
    // Contrato con el servidor (api/estudio-luminico/create.ts)
    expect(parseConsent(consent, { requireTerms: false }).ok).toBe(true);
  });

  it('400 con code consent_required: el aviso de la casilla (no el del teléfono) y el botón vuelve', async () => {
    vi.stubGlobal('fetch', reply(400, CONSENT_400));
    render(form());
    fillForm();
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(CONSENT_ERRORS.solicitud));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Revisa los datos|Ocurrió un error/)).not.toBeInTheDocument();
    expect(privacyBox()).toHaveFocus();
    expect(trackLead).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('PRUEBA ETAPA 2 (09a)');
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

  it('el formulario y la confirmación llevan data-elights-form="estudio-luminico"; Analytics sin comuna', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(form());
    expect(button().closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'estudio-luminico');
    fillForm();
    submit();
    const heading = await screen.findByText('Solicitud recibida');
    expect(heading.closest('[data-elights-form]')).toHaveAttribute('data-elights-form', 'estudio-luminico');
    const params = [...vi.mocked(sendEvent).mock.calls, ...vi.mocked(trackLead).mock.calls].map(([, p]) => p ?? {});
    expect(params.length).toBeGreaterThan(0);
    for (const p of params) {
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining([expect.stringMatching(/commune|comuna/i)]));
      expect(JSON.stringify(p)).not.toContain('Santiago');
    }
  });
});
