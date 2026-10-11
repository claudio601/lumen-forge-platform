// Formulario de estudio lumínico: "Solicitud recibida" y la conversión solo cuando el
// servidor confirma { success: true }. Cualquier otra respuesta muestra un error junto al
// botón (role="alert") y deja los datos escritos para reintentar.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import EstudioLuminicoLeadForm from './EstudioLuminicoLeadForm';

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { sendEvent, trackLead } from '@/lib/analytics';

const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

function fillForm(telefono = '+56 9 0000 0901') {
  const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type(/Nombre completo/, 'PRUEBA ETAPA 2 (09a)');
  type(/Correo electronico/, 'prueba-etapa2-09a@example.com');
  type(/Teléfono/, telefono);
  type(/Tipo de proyecto/, 'industria_bodega');
  type(/Comuna \/ Ciudad/, 'Santiago');
  type(/Tienes planos/, 'no_tengo');
  type(/Dimensiones aproximadas/, 'PRUEBA 10x20 m');
  type(/Altura de montaje/, '6 m');
  type(/Objetivo del proyecto/, 'operacion_industrial');
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
    render(<EstudioLuminicoLeadForm />);
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
    render(<EstudioLuminicoLeadForm />);
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
    render(<EstudioLuminicoLeadForm />);
    const desc = screen.getByLabelText(/Descripción del proyecto/);
    expect(desc).toHaveAttribute('maxLength', '2000');
    fillForm();
    // jsdom no aplica maxLength a un cambio por código: lo frena la validación del formulario
    fireEvent.change(desc, { target: { value: 'd'.repeat(2001) } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('hasta 2000 caracteres');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un teléfono de 7 dígitos se rechaza en el navegador, sin llamar al servidor', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    render(<EstudioLuminicoLeadForm />);
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
    container.innerHTML = renderToString(<EstudioLuminicoLeadForm />);
    document.body.appendChild(container);
    return container;
  };

  it('el formulario usa method="post" (nunca GET con los datos en la URL) y todo está deshabilitado', () => {
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
      'descripcionProyecto', 'website',
    ]));
    for (const control of controls) expect(control).toBeDisabled();
  });

  it('al hidratar se habilita, sin descartar el HTML del servidor', async () => {
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = serverContainer();
    const serverButton = container.querySelector('button[type="submit"]');
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, <EstudioLuminicoLeadForm />, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(consoleErrors.mock.calls.map((args) => args.map(String).join(' ')).filter((m) => /did not match|server HTML|hydrat/i.test(m))).toEqual([]);
    expect(container.contains(serverButton)).toBe(true); // React reutilizó el nodo
    expect(container.querySelector('fieldset')).not.toHaveAttribute('disabled');
    expect(within(container).getByRole('button', { name: /SOLICITAR COTIZACION/ })).toBeEnabled();
    expect(within(container).getByLabelText(/Nombre completo/)).toBeEnabled();
    expect(within(container).getByLabelText(/Tipo de proyecto/)).toBeEnabled();
    expect(within(container).getByLabelText(/Descripción del proyecto/)).toBeEnabled();
  });

  it('ya hidratado, el envío va por fetch (React) y no por el navegador', async () => {
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    const container = serverContainer();
    await act(async () => { root = hydrateRoot(container, <EstudioLuminicoLeadForm />); });
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
