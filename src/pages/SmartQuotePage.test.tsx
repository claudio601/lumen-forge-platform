// Cotizador (/cotizador): el formulario va al servidor (/api/project-quotes/create), que
// manda el correo a ventas y crea el negocio en Pipedrive; ya no se usa EmailJS. La
// confirmación y la conversión solo llegan cuando el servidor responde { success: true }.
// Cualquier otra respuesta muestra un aviso junto al botón (role="alert") y deja los datos
// escritos para reintentar.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import SmartQuotePage from './SmartQuotePage';
import { ILLUMINATION_LEVELS, PROJECT_TYPES } from '../../api/_lib/forms/projectQuote';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { toast } from 'sonner';
import { sendEvent, trackLead } from '@/lib/analytics';

const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

const page = () => (
  <HelmetProvider context={{}}>
    <MemoryRouter initialEntries={['/cotizador']}><SmartQuotePage /></MemoryRouter>
  </HelmetProvider>
);
const renderPage = () => render(page());

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillForm(telefono = '+56 9 0000 0904', m2 = '1200') {
  type(/Tipo de proyecto/, 'Bodega');
  type(/m2 aproximados/, m2);
  type(/Nombre y Apellido/, 'PRUEBA ETAPA 2 (09d)');
  type(/Email/, 'prueba-etapa2-09d@example.com');
  type(/Teléfono/, telefono);
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
    // m2 y altura como números; los opcionales vacíos no viajan; el campo trampa va vacío
    expect(sentBodies()[0]).toEqual({
      tipoProyecto: 'Bodega',
      m2: 1200,
      altura: 8,
      ciudad: 'Santiago',
      nombre: 'PRUEBA ETAPA 2 (09d)',
      email: 'prueba-etapa2-09d@example.com',
      telefono: '+56 9 0000 0904',
      website: '',
    });
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('emailjs'))).toBe(false);

    expect(trackLead).toHaveBeenCalledTimes(1);
    expect(trackLead).toHaveBeenCalledWith('cotizador', { project_type: 'Bodega' });
    expect(toast.success).toHaveBeenCalledTimes(1);
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
    ['502', reply(502, '{"success":false}'), 502, /No pudimos enviar tu solicitud.*WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
    ['504 con HTML', reply(504, '<!DOCTYPE html><html>An error occurred</html>'), 504, /WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
    ['200 { success: false }', reply(200, '{"success":false}'), 200, /WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
    ['200 sin JSON', reply(200, '<html>ok?</html>'), 200, /WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
    ['red caída', vi.fn(async () => { throw new TypeError('Failed to fetch'); }), 0, /WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
    ['403', reply(403, '{"success":false,"error":"Forbidden"}'), 403, /WhatsApp al \+56 9 9127 3128 o a ventas@elights\.cl/],
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
    expect(sendEvent).toHaveBeenCalledWith('cotizador_submit_error', expect.objectContaining({ httpStatus }));
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
    'comentarios', 'nombre', 'email', 'telefono', 'rutEmpresa', 'razonSocial', 'giro', 'direccion', 'website',
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
