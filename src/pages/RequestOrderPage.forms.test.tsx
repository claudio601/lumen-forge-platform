// /solicitar-pedido, auditoría UX entrega 2 (2026-10-17):
// - F-01: el total en un solo modo (el del selector del encabezado), también con un carrito
//   mixto guardado antes del cambio (una línea con IVA y otra neta).
// - F-02: validación al salir de cada campo y al enviar, con el mensaje bajo el campo, el
//   foco en el primero con error y el aviso general (role="alert") junto al botón; el correo
//   rechazado por el servidor y el RUT (opcional) con su dígito verificador.
// - F-03: la confirmación con el plazo (por correo, el mismo día hábil), los 3 pasos, "Revisa
//   tu correo" e "Imprimir o guardar resumen", sin WhatsApp ni llamadas.
// «Recordar mis datos en este dispositivo» (especificación del 23-10-2026, §5): al final.
// Datos de prueba inventados (RUT del rango 44 millones, sin asignar; correos example.com).

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider, useApp } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import RequestOrderPage from './RequestOrderPage';
import { products } from '@/data/products';
import { formatCLP, netOfGross } from '@/lib/requestOrder';
import { FIELD_MESSAGES } from '@/lib/formValidation';
import { businessHoursLong, contactEmail, responseTimePromise } from '@/config/business';
import { REMEMBER_TEXTS } from '@/components/forms/RememberContact';
import {
  FIXED_NOW,
  TEST_RUT,
  expectFreshBox,
  expectNothingElseStored,
  expectSavedBox,
  rememberBox,
  rememberStatus,
  seedSaved,
  storedContact,
} from '@/test/rememberContact';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));

// Dos productos sin variantes, con SKU propio, nombres y precios distintos
const simple = products.filter(x => !x.cctVariants?.length && x.price > 1000 && x.sku && !x.sku.startsWith('JS-'));
const a = simple[0];
const b = simple.find(x => x.name !== a.name && x.price !== a.price && netOfGross(x.price) !== netOfGross(a.price))!;
const line = (p: typeof a, over: object) => ({
  productId: p.id, jumpsellerId: p.jumpseller_id, sku: p.sku || `JS-${p.jumpseller_id}`, name: p.name,
  quantity: 1, unitPrice: p.price, url: `/producto/${p.id}`, attributes: {}, ...over,
});

/** El interruptor de precios del encabezado (Header lo muestra en todas las páginas). */
function HeaderToggle() {
  const { toggleB2B } = useApp();
  return <button type="button" onClick={toggleB2B}>Cambiar modo de precios</button>;
}

/** Carrito mixto como los que guardaba el sitio antes del cambio: a con IVA, b neto (modo empresa). */
async function renderPage({ b2b = false, mixed = true } = {}) {
  sessionStorage.setItem('elights_request_cart', JSON.stringify(
    mixed
      ? [line(a, { priceMode: 'iva' }), line(b, { unitPrice: netOfGross(b.price), priceMode: 'neto', quantity: 2 })]
      : [line(a, {})],
  ));
  if (b2b) sessionStorage.setItem('elights_b2b', 'true');
  render(
    <HelmetProvider><AppProvider><RequestCartProvider>
      <HeaderToggle />
      <MemoryRouter initialEntries={['/solicitar-pedido']}><RequestOrderPage /></MemoryRouter>
    </RequestCartProvider></AppProvider></HelmetProvider>,
  );
  await screen.findByLabelText(/Nombre completo/);
}

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const blur = (label: RegExp) => fireEvent.blur(screen.getByLabelText(label));
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const button = () => screen.getByRole('button', { name: /ENVIAR SOLICITUD DE PEDIDO/ });
const submit = () => fireEvent.click(button());
const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
const ok = () => vi.fn(async (_url: string, init: RequestInit) => ({
  ok: true,
  status: 201,
  json: async () => ({ success: true, requestReference: JSON.parse(init.body as string).requestReference, dealId: 1 }),
}));

function fillForm({ consent = true } = {}) {
  type(/Nombre completo/, 'PRUEBA UX 02 - borrar');
  type(/Correo electrónico/, 'prueba-ux02@example.com');
  type(/Teléfono/, '+56 9 0000 0912');
  type(/Comuna/, 'Santiago');
  if (consent) fireEvent.click(privacyBox());
}

/** La fila del total, como texto. */
const totalRow = () => screen.getByText('Total con IVA:').parentElement!.textContent!.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('/solicitar-pedido: total en un solo modo (F-01)', () => {
  const gross = a.price + 2 * b.price;
  const net = netOfGross(a.price) + 2 * netOfGross(b.price);
  const mixedOld = a.price + 2 * netOfGross(b.price); // lo que sumaba antes

  it('con IVA: cada línea y el total CON IVA; nunca la suma mezclada', async () => {
    await renderPage();
    await waitFor(() => expect(totalRow()).toBe(`Total con IVA: ${formatCLP(gross)}`));
    expect(screen.queryByText(formatCLP(mixedOld))).not.toBeInTheDocument();
    expect(screen.getByText(formatCLP(b.price))).toBeInTheDocument();
    expect(screen.getAllByText('Precio c/IVA')).toHaveLength(2);
    expect(screen.queryByText(/\(neto /)).not.toBeInTheDocument();
  });

  it('modo empresa: cada línea neta, "Total con IVA $X" y "(neto $Y)"', async () => {
    await renderPage({ b2b: true });
    await waitFor(() => expect(totalRow()).toBe(`Total con IVA: ${formatCLP(gross)} (neto ${formatCLP(net)})`));
    expect(screen.getByText(formatCLP(netOfGross(a.price)))).toBeInTheDocument();
    expect(screen.getByText(formatCLP(netOfGross(b.price)))).toBeInTheDocument();
    expect(screen.getAllByText('Precio neto (sin IVA)')).toHaveLength(2);
  });

  it('al cambiar el selector del encabezado cambian todas las líneas juntas, y el total CON IVA no cambia', async () => {
    await renderPage();
    await waitFor(() => expect(totalRow()).toBe(`Total con IVA: ${formatCLP(gross)}`));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar modo de precios' }));
    expect(totalRow()).toBe(`Total con IVA: ${formatCLP(gross)} (neto ${formatCLP(net)})`);
    expect(screen.queryAllByText('Precio c/IVA')).toHaveLength(0);
  });

  it.each([
    [false, 'iva'],
    [true, 'neto'],
  ] as const)('el envío (modo empresa %s) lleva todas las líneas en un solo modo: %s', async (b2b, mode) => {
    vi.stubGlobal('fetch', ok());
    await renderPage({ b2b });
    fillForm();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    const body = sentBody();
    const unit = (p: typeof a) => (mode === 'neto' ? netOfGross(p.price) : p.price);
    expect(body.items).toEqual([
      expect.objectContaining({ jumpsellerId: a.jumpseller_id, priceMode: mode, unitPrice: unit(a), quantity: 1, lineTotal: unit(a) }),
      expect.objectContaining({ jumpsellerId: b.jumpseller_id, priceMode: mode, unitPrice: unit(b), quantity: 2, lineTotal: 2 * unit(b) }),
    ]);
    expect(body.subtotal).toBe(unit(a) + 2 * unit(b));
  });
});

describe('/solicitar-pedido: validación por campo (F-02)', () => {
  it('al salir de un campo obligatorio vacío: el mensaje debajo, con aria-invalid y aria-describedby; al corregirlo se va', async () => {
    await renderPage({ mixed: false });
    const name = screen.getByLabelText(/Nombre completo/);
    expect(name).not.toHaveAttribute('aria-invalid');
    blur(/Nombre completo/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Escribe tu nombre completo.');
    // El mensaje del campo no es un aviso aparte: el aviso general solo aparece al enviar
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    type(/Nombre completo/, 'PRUEBA UX 02');
    expect(name).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Escribe tu nombre completo.')).not.toBeInTheDocument();
  });

  it('el correo se revisa con la regla del servidor al salir del campo', async () => {
    await renderPage({ mixed: false });
    type(/Correo electrónico/, 'prueba-ux02@example');
    blur(/Correo electrónico/);
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveAccessibleDescription(FIELD_MESSAGES.emailInvalid);
    type(/Correo electrónico/, 'prueba-ux02@example.com');
    expect(screen.getByLabelText(/Correo electrónico/)).not.toHaveAttribute('aria-invalid');
  });

  it('al enviar con errores: no llama al servidor, el foco va al primero, cada mensaje bajo su campo y el aviso junto al botón', async () => {
    vi.stubGlobal('fetch', ok());
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await renderPage({ mixed: false });
    type(/Correo electrónico/, 'correo-sin-arroba');
    type(/Teléfono/, '212 345');
    fireEvent.click(privacyBox());
    submit();
    const alert = await screen.findByRole('alert');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Nombre completo/)).toHaveFocus();
    expect(alert).toHaveTextContent('Revisa estos 4 datos antes de enviar:');
    expect(within(alert).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Escribe tu nombre completo.',
      FIELD_MESSAGES.emailInvalid,
      'Ingresa un teléfono válido con al menos 8 dígitos.',
      'Escribe tu comuna.',
    ]);
    expect(screen.getByLabelText(/Teléfono/)).toHaveAccessibleDescription('Ingresa un teléfono válido con al menos 8 dígitos.');
    expect(screen.getByLabelText(/Comuna/)).toHaveAttribute('aria-invalid', 'true');
    // Junto al botón, después de las casillas, y la página no sube al tope
    expect(alert.nextElementSibling).toBe(button());
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' }).compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scroll).not.toHaveBeenCalled();
    // Al corregir, el aviso se achica y desaparece con el último error
    fillForm({ consent: false });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
  });

  it('si el servidor rechaza el correo: el mensaje va junto al campo, con el foco en él, y el botón vuelve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Validation failed', details: { errors: ['email has invalid format'] } }),
    })));
    await renderPage({ mixed: false });
    fillForm();
    submit();
    const message = `No pudimos validar tu correo. Revísalo; si sigue fallando, escríbenos a ${contactEmail}.`;
    await waitFor(() => expect(screen.getByLabelText(/Correo electrónico/)).toHaveAccessibleDescription(message));
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(/No pudimos enviar tu solicitud/)).not.toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it('otro error del servidor: el aviso general junto al botón, con salida por correo, sin subir la página', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ success: false }) })));
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await renderPage({ mixed: false });
    fillForm();
    submit();
    const alert = await screen.findByRole('alert');
    // Junto al botón no se ofrece WhatsApp: la salida es el correo (dueño, 2026-10-17)
    expect(alert).toHaveTextContent(`No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos a ${contactEmail}.`);
    expect(alert.textContent).not.toMatch(/whatsapp|llam|tel[eé]fono/i);
    expect(alert.nextElementSibling).toBe(button());
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('/solicitar-pedido: RUT de empresa (opcional) con dígito verificador (F-02)', () => {
  const empresa = () => {
    fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'empresa' } });
    type(/Nombre de empresa/, 'PRUEBA UX 02 SpA (no procesar)');
  };

  it('toma formato al salir del campo; con K minúscula también', async () => {
    await renderPage({ mixed: false });
    empresa();
    type(/RUT empresa/, '444444444');
    blur(/RUT empresa/);
    expect(screen.getByLabelText(/RUT empresa/)).toHaveValue('44.444.444-4');
    expect(screen.getByLabelText(/RUT empresa/)).not.toHaveAttribute('aria-invalid');
    type(/RUT empresa/, '44444407k');
    blur(/RUT empresa/);
    expect(screen.getByLabelText(/RUT empresa/)).toHaveValue('44.444.407-K');
    expect(screen.getByLabelText(/RUT empresa/)).not.toHaveAttribute('aria-invalid');
  });

  it('un dígito verificador que no calza: el mensaje bajo el campo y no se envía', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage({ mixed: false });
    fillForm();
    empresa();
    type(/RUT empresa/, '44.444.444-5');
    blur(/RUT empresa/);
    expect(screen.getByLabelText(/RUT empresa/)).toHaveAccessibleDescription(FIELD_MESSAGES.rutCheckDigit);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(FIELD_MESSAGES.rutCheckDigit);
    expect(screen.getByLabelText(/RUT empresa/)).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('vacío se envía sin RUT; escrito sin formato, se envía con formato aunque no se salga del campo', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage({ mixed: false });
    fillForm();
    empresa();
    type(/RUT empresa/, '444444444');
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).toMatchObject({ customerType: 'empresa', rut: '44.444.444-4', companyName: 'PRUEBA UX 02 SpA (no procesar)' });
  });

  it('sin RUT (opcional): se envía igual, sin la clave rut', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage({ mixed: false });
    fillForm();
    empresa();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).not.toHaveProperty('rut');
  });

  it('si vuelve a persona, el RUT escrito (aunque esté mal) ni se revisa ni se envía', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage({ mixed: false });
    fillForm();
    empresa();
    type(/RUT empresa/, '44.444.444-5');
    blur(/RUT empresa/);
    fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'persona' } });
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody()).not.toHaveProperty('rut');
    expect(sentBody()).not.toHaveProperty('companyName');
  });
});

describe('/solicitar-pedido: plazo y confirmación (F-03)', () => {
  /** Nada de WhatsApp, llamadas ni teléfono: el equipo responde siempre por correo. */
  const NO_OTHER_CHANNEL = /whatsapp|wa\.me|llam(?:ar|amos|aremos|ada)|tel[eé]fono|\+56/i;

  it('junto al botón: "Te respondemos por correo el mismo día hábil", el horario y sin cobro automático', async () => {
    await renderPage({ mixed: false });
    const note = screen.getByText(/Te respondemos por correo el mismo día hábil/);
    expect(note).toHaveTextContent(`${responseTimePromise} Sin cobro automático.`);
    expect(button().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.nextElementSibling).toHaveTextContent(`Atendemos de ${businessHoursLong}`);
    expect(`${note.textContent} ${note.nextElementSibling!.textContent}`).not.toMatch(NO_OTHER_CHANNEL);
  });

  it('la confirmación: plazo, horario, referencia, 3 pasos, revisa tu correo, resumen e imprimir; sin WhatsApp ni llamadas', async () => {
    vi.stubGlobal('fetch', ok());
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderPage({ b2b: true });
    fillForm();
    submit();
    const heading = await screen.findByRole('heading', { name: 'Solicitud enviada' });
    await waitFor(() => expect(heading).toHaveFocus());
    const ref = sentBody().requestReference;
    expect(heading).toHaveAccessibleDescription(`${responseTimePromise} Referencia: ${ref}`);

    const page = heading.closest('[data-elights-form]') as HTMLElement;
    expect(page).toHaveAttribute('data-elights-form', 'solicitar-pedido');
    expect(page).toHaveAttribute('data-print-summary');
    const text = page.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Te respondemos por correo el mismo día hábil.');
    expect(text).toContain(`Atendemos de ${businessHoursLong} Si tu solicitud llegó fuera de ese horario, te respondemos el día hábil siguiente.`);
    expect(screen.getByText(ref)).toBeInTheDocument();

    const steps = within(screen.getByRole('region', { name: 'Próximos pasos' })).getAllByRole('listitem');
    expect(steps.map(li => li.textContent)).toEqual([
      'Confirmamos la disponibilidad de tus productos.',
      'Te enviamos por correo la cotización con el link de pago.',
      'Despachamos en hasta 2 días hábiles desde que tu pago está confirmado.',
    ]);
    expect(steps[0].closest('ol')).not.toBeNull();
    expect(text).toContain('Revisa tu correo, también la carpeta de spam');

    // Resumen: lo que se envió, en el modo en que lo veía (empresa: neto), con el total CON IVA
    const summary = screen.getByRole('region', { name: 'Resumen de tu solicitud' });
    expect(summary).toHaveTextContent(a.name);
    expect(summary).toHaveTextContent(b.name);
    expect(summary).toHaveTextContent(`2 × ${formatCLP(netOfGross(b.price))} neto`);
    expect(summary).toHaveTextContent(`Total con IVA: ${formatCLP(a.price + 2 * b.price)} (neto ${formatCLP(netOfGross(a.price) + 2 * netOfGross(b.price))})`);

    const mail = screen.getByRole('link', { name: contactEmail });
    expect(mail).toHaveAttribute('href', `mailto:${contactEmail}?subject=${encodeURIComponent(`Solicitud ${ref}`)}`);
    expect(text).toContain(`citando tu referencia ${ref}.`);

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir o guardar resumen' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Seguir explorando' })).toHaveAttribute('href', '/catalogo');

    // Siempre por correo: sin WhatsApp, llamadas ni teléfono; y sin prometer una copia al cliente
    expect(text).not.toMatch(NO_OTHER_CHANNEL);
    expect(text).not.toMatch(/copia/i);
    expect(page.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull();
  });
});

describe('/solicitar-pedido: recordar mis datos', () => {
  const CONTACT = { nombre: 'PRUEBA Pedido (rec) - borrar', email: 'prueba-recordar-pedido@example.com', telefono: '+56 9 0000 0935' };
  const EMPRESA = 'PRUEBA Pedido SpA (no procesar)';
  const NOTAS = 'PRUEBA notas del pedido - borrar';
  const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
  const bodies = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));
  const fails = (status: number) => vi.fn(async () => ({ ok: false, status, json: async () => ({ success: false }) }));
  const trap = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));

  function fillAll({ empresa = true } = {}) {
    type(/Nombre completo/, CONTACT.nombre);
    type(/Correo electrónico/, CONTACT.email);
    type(/Teléfono/, CONTACT.telefono);
    if (empresa) {
      fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'empresa' } });
      type(/Nombre de empresa/, EMPRESA);
      type(/RUT empresa/, TEST_RUT);
    }
    type(/Comuna/, 'Maipú');
    fireEvent.change(screen.getByLabelText(/Región/), { target: { value: 'Valparaiso' } });
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it('sin datos guardados, la casilla empieza desmarcada, después de la región y antes de las notas', async () => {
    await renderPage({ mixed: false });
    expectFreshBox();
    const box = rememberBox();
    expect(field(/Región/).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(field(/Notas adicionales/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(privacyBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('comuna y región con su autocompletado del navegador', async () => {
    await renderPage({ mixed: false });
    expect(field(/Comuna/)).toHaveAttribute('autocomplete', 'address-level2');
    expect(field(/Región/)).toHaveAttribute('autocomplete', 'address-level1');
  });

  it('con datos, completa los vacíos, y la región y el tipo que estaban en su valor inicial', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA, giro: 'Prueba', rut: '444444444', comuna: 'Maipú', region: 'Valparaiso' });
    await renderPage({ mixed: false });
    await waitFor(() => expect(field(/Nombre completo/).value).toBe(CONTACT.nombre));
    expect(field(/Correo electrónico/).value).toBe(CONTACT.email);
    expect(field(/Teléfono/).value).toBe(CONTACT.telefono);
    expect(field(/Tipo de cliente/).value).toBe('empresa');
    expect(field(/Nombre de empresa/).value).toBe(EMPRESA);
    expect(field(/RUT empresa/).value).toBe(TEST_RUT);
    expect(field(/Comuna/).value).toBe('Maipú');
    expect(field(/Región/).value).toBe('Valparaiso');
    expectSavedBox();
  });

  it('desmarcar borra al instante sin vaciar los campos', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'persona', comuna: 'Maipú', region: 'Valparaiso' });
    await renderPage({ mixed: false });
    await waitFor(() => expect(rememberBox().checked).toBe(true));
    fireEvent.click(rememberBox());
    expect(storedContact()).toBeNull();
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.cleared);
    expect(field(/Comuna/).value).toBe('Maipú');
    expect(field(/Región/).value).toBe('Valparaiso');
    expectFreshBox();
  });

  it('cambiar el correo completado desmarca y borra, con su aviso', async () => {
    seedSaved(CONTACT);
    await renderPage({ mixed: false });
    await waitFor(() => expect(rememberBox().checked).toBe(true));
    type(/Correo electrónico/, 'prueba-otra@example.com');
    expect(storedContact()).toBeNull();
    expect(rememberBox().checked).toBe(false);
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.emailChanged);
  });

  it('un envío confirmado con la casilla marcada guarda exactamente lo enviado, con comuna y región; ni notas ni productos', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage({ mixed: false });
    fillAll();
    type(/Notas adicionales/, NOTAS);
    fireEvent.click(rememberBox());
    fireEvent.click(privacyBox());
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual({
      ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA, rut: TEST_RUT, comuna: 'Maipú', region: 'Valparaiso',
    });
    expectNothingElseStored([NOTAS, a.name, a.sku!, 'RC-']);
  });

  it('un envío confirmado con la casilla desmarcada no guarda nada', async () => {
    vi.stubGlobal('fetch', ok());
    await renderPage({ mixed: false });
    fillAll();
    fireEvent.click(privacyBox());
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(storedContact()).toBeNull();
  });

  it.each([
    ['sin referencia (la trampa contra bots)', trap, false],
    ['sin referencia (la trampa contra bots)', trap, true],
    ['400', () => fails(400), false],
    ['400', () => fails(400), true],
    ['500', () => fails(500), false],
    ['500', () => fails(500), true],
  ])('%s (con datos guardados: %s): no guarda nada y lo guardado no cambia', async (_, server, withSaved) => {
    vi.stubGlobal('fetch', server());
    if (withSaved) seedSaved({ ...CONTACT, tipoCliente: 'persona', comuna: 'Maipú', region: 'Valparaiso' });
    const before = localStorage.getItem('elights_contact');
    await renderPage({ mixed: false });
    if (withSaved) {
      await waitFor(() => expect(rememberBox().checked).toBe(true));
      type(/Teléfono/, '+56 9 0000 0939');
    } else {
      fillAll({ empresa: false });
      fireEvent.click(rememberBox());
    }
    fireEvent.click(privacyBox());
    submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(localStorage.getItem('elights_contact')).toBe(before);
  });

  it('el cuerpo que va al servidor es idéntico con y sin datos guardados', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal('fetch', ok());
    await renderPage({ mixed: false });
    fillAll();
    fireEvent.click(privacyBox());
    submit();
    await screen.findByText('Solicitud enviada');
    cleanup();
    sessionStorage.clear();
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA, rut: TEST_RUT, comuna: 'Maipú', region: 'Valparaiso' });
    await renderPage({ mixed: false });
    await waitFor(() => expect(field(/Región/).value).toBe('Valparaiso'));
    fireEvent.click(privacyBox());
    submit();
    await screen.findByText('Solicitud enviada');
    const [without, withSaved] = bodies();
    expect(withSaved).toEqual(without);
    expect(JSON.stringify(withSaved)).not.toMatch(/recordarDatos|elights_contact|remember/i);
  });
});
