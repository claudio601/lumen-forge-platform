// Formulario de instalación: el navegador ya no llama al relay de correo; el servidor
// manda el correo a ventas y crea el negocio. "Solicitud recibida" y la conversión solo
// cuando el servidor confirma { success: true }. Cualquier otra respuesta muestra un error
// junto al botón (role="alert") y deja los datos escritos para reintentar.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import InstallationLeadForm from './InstallationLeadForm';

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { sendEvent, trackLead } from '@/lib/analytics';

const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

const NAME = 'PRUEBA ETAPA 2 (09c) - borrar';
const EMAIL = 'prueba-etapa2-09c@example.com';
const DESCRIPCION = 'PRUEBA ETAPA 2 (09c) - no contactar; borrar';

function fillForm({ telefono = '+56 9 0000 0903', email = EMAIL, consent = true } = {}) {
  const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type(/Nombre completo/, NAME);
  type(/Telefono/, telefono);
  type(/Correo electronico/, email);
  type(/Comuna/, 'Santiago');
  type(/Tipo de proyecto/, 'Oficina');
  type(/Descripcion breve/, DESCRIPCION);
  type(/Tipo de cliente/, 'empresa');
  type(/Preferencia de contacto/, 'email');
  if (consent) fireEvent.click(screen.getByLabelText(/Acepto que eLIGHTS/));
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /SOLICITAR EVALUACION/ }));
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
    render(<InstallationLeadForm />);
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(fetchUrls()).toEqual(['/api/installation-leads/create']);
    expect(fetchUrls().some((u) => u.includes('script.google.com'))).toBe(false);
    expect(trackLead).toHaveBeenCalledTimes(1);
    expect(trackLead).toHaveBeenCalledWith('instalacion', expect.objectContaining({ tipo_proyecto: 'Oficina', comuna: 'Santiago' }));

    const body = sentBody();
    expect(body).toMatchObject({
      nombre: NAME, email: EMAIL, telefono: '+56 9 0000 0903', comuna: 'Santiago', tipoProyecto: 'Oficina',
      descripcion: DESCRIPCION, tipoCliente: 'empresa', preferenciaContacto: 'email', aceptaContacto: true,
      origen: 'instalacion_web', website: '',
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
    render(<InstallationLeadForm />);
    fillForm();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByText('Solicitud recibida')).not.toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue(NAME);
    expect(screen.getByLabelText(/Descripcion breve/)).toHaveValue(DESCRIPCION);
    expect(screen.getByLabelText(/Acepto que eLIGHTS/)).toBeChecked();
    expect(sendEvent).toHaveBeenCalledWith('instalacion_form_submit_failure', expect.objectContaining({ error_message: 'http_' + httpStatus }));
    await waitFor(() => expect(screen.getByRole('button', { name: /SOLICITAR EVALUACION/ })).toBeEnabled());
  });

  it('el campo trampa oculto se envía con lo que tenga', async () => {
    vi.stubGlobal('fetch', reply(200, '{"success":true}'));
    render(<InstallationLeadForm />);
    fillForm();
    fireEvent.change(screen.getByLabelText(/No completar/), { target: { value: 'http://spam.example' } });
    submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(sentBody().website).toBe('http://spam.example');
  });

  it.each([
    ['un teléfono de 7 dígitos', { telefono: '212 3456' }, /entre 8 y 12 dígitos/],
    ['un teléfono de 13 dígitos', { telefono: '+56 9 1234 5678 90' }, /entre 8 y 12 dígitos/],
    ['un correo sin dominio (a@b)', { email: 'a@b' }, /correo electrónico válido/],
    ['sin aceptar el contacto', { consent: false }, /Debes aceptar/],
  ])('%s se rechaza en el navegador, sin llamar al servidor', async (_name, opts, message) => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(<InstallationLeadForm />);
    fillForm(opts);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(fetch).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
  });

  it('los campos tienen los mismos topes que el servidor', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(<InstallationLeadForm />);
    expect(screen.getByLabelText(/Nombre completo/)).toHaveAttribute('maxLength', '120');
    expect(screen.getByLabelText(/Telefono/)).toHaveAttribute('maxLength', '30');
    expect(screen.getByLabelText(/Correo electronico/)).toHaveAttribute('maxLength', '254');
    expect(screen.getByLabelText(/Comuna/)).toHaveAttribute('maxLength', '80');
    const desc = screen.getByLabelText(/Descripcion breve/);
    expect(desc).toHaveAttribute('maxLength', '2000');
    fillForm();
    // jsdom no aplica maxLength a un cambio por código: lo frena la validación del formulario
    fireEvent.change(desc, { target: { value: 'd'.repeat(2001) } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('hasta 2000 caracteres');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('el consentimiento nombra a Vercel, Google y Pipedrive y ya no promete "No compartiremos"', () => {
    const { container } = render(<InstallationLeadForm />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/No compartiremos/i);
    expect(screen.getByLabelText(/Acepto que eLIGHTS me contacte por teléfono, WhatsApp o correo para responder esta solicitud\./)).toBeInTheDocument();
    expect(text).toContain('Usamos estos datos para responder y dar seguimiento a tu solicitud. Quedan registrados en los servicios con que trabajamos: Vercel (sitio web), Google (correo) y Pipedrive (gestión de clientes).');
  });

  it('la nota de datos se lee junto a la casilla y tiene contraste suficiente (gray-600, no gray-400)', () => {
    render(<InstallationLeadForm />);
    const consent = screen.getByLabelText(/Acepto que eLIGHTS/);
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
    container.innerHTML = renderToString(<InstallationLeadForm />);
    document.body.appendChild(container);
    return container;
  };

  it('el formulario usa method="post" (nunca GET con los datos en la URL) y todo está deshabilitado', () => {
    const container = serverContainer();
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.hasAttribute('action')).toBe(false);
    expect(container.querySelector('fieldset')).toHaveAttribute('disabled');
    const button = within(container).getByRole('button', { name: /SOLICITAR EVALUACION/ });
    expect(button).toHaveAttribute('disabled');
    expect(button).toBeDisabled();
    const controls = [...form.querySelectorAll('input, select, textarea')];
    expect(controls.map((c) => c.getAttribute('name'))).toEqual(expect.arrayContaining(['nombre', 'telefono', 'email', 'comuna', 'descripcion', 'aceptaContacto', 'website']));
    for (const control of controls) expect(control).toBeDisabled();
  });

  it('al hidratar se habilita, sin descartar el HTML del servidor', async () => {
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = serverContainer();
    const serverButton = container.querySelector('button[type="submit"]');
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <InstallationLeadForm />, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(consoleErrors.mock.calls.map((args) => args.map(String).join(' ')).filter((m) => /did not match|server HTML|hydrat/i.test(m))).toEqual([]);
    expect(container.contains(serverButton)).toBe(true); // React reutilizó el nodo
    expect(container.querySelector('fieldset')).not.toHaveAttribute('disabled');
    expect(within(container).getByRole('button', { name: /SOLICITAR EVALUACION/ })).toBeEnabled();
    expect(within(container).getByLabelText(/Nombre completo/)).toBeEnabled();
    expect(within(container).getByLabelText(/Acepto que eLIGHTS/)).toBeEnabled();
    act(() => root?.unmount());
  });
});
