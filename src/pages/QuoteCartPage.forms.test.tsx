// /cotizacion, auditoría UX entrega 2 (2026-10-17):
// - F-02: el RUT de empresa toma formato al salir del campo y se revisa su dígito
//   verificador; cada campo obligatorio se revisa al salir y al enviar, con el mensaje bajo
//   el campo, el foco en el primero con error y el aviso general junto al botón.
// - F-03: la confirmación con el plazo (por correo, el mismo día hábil), los 3 pasos, "Revisa
//   tu correo" e "Imprimir o guardar resumen", sin WhatsApp ni llamadas.
// «Recordar mis datos en este dispositivo» (especificación del 23-10-2026, §5): al final.
// RUT inventados (rango 44 millones, sin asignar) y correos example.com.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import QuoteCartPage from './QuoteCartPage';
import { products } from '@/data/products';
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

const product = products.find(x => !x.cctVariants?.length && x.price > 1000)!;
const reply = (status: number, text: string) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));

async function renderPage({ b2b = false } = {}) {
  sessionStorage.setItem('elights_quote', JSON.stringify([{ product, quantity: 3 }]));
  if (b2b) sessionStorage.setItem('elights_b2b', 'true');
  render(
    <HelmetProvider><AppProvider>
      <MemoryRouter initialEntries={['/cotizacion']}><QuoteCartPage /></MemoryRouter>
    </AppProvider></HelmetProvider>,
  );
  await screen.findByText(product.name);
}

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const blur = (label: RegExp) => fireEvent.blur(screen.getByLabelText(label));
const button = () => screen.getByRole('button', { name: /ENVIAR SOLICITUD/ });
const submit = () => fireEvent.click(button());
const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

function fillContact() {
  type(/Nombre y Apellido/, 'PRUEBA UX 02 - borrar');
  type(/Email/, 'prueba-ux02@example.com');
  type(/Teléfono/, '+56 9 0000 0913');
  fireEvent.click(screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/));
}

function fillCompany(rut: string) {
  type(/RUT Empresa/, rut);
  type(/Razón Social/, 'PRUEBA UX 02 SpA (no procesar)');
  type(/Giro/, 'Prueba');
  type(/Dirección Comercial/, 'Prueba 123, Santiago');
}

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('/cotizacion: RUT de empresa con formato y dígito verificador (F-02)', () => {
  it('toma formato con puntos y guion al salir del campo (K mayúscula o minúscula)', async () => {
    await renderPage({ b2b: true });
    type(/RUT Empresa/, '444444444');
    blur(/RUT Empresa/);
    expect(screen.getByLabelText(/RUT Empresa/)).toHaveValue('44.444.444-4');
    expect(screen.getByLabelText(/RUT Empresa/)).not.toHaveAttribute('aria-invalid');
    type(/RUT Empresa/, '44.444.407-k');
    blur(/RUT Empresa/);
    expect(screen.getByLabelText(/RUT Empresa/)).toHaveValue('44.444.407-K');
    expect(screen.getByLabelText(/RUT Empresa/)).not.toHaveAttribute('aria-invalid');
  });

  it('un dígito verificador que no calza: "Revisa el RUT…" bajo el campo, el foco en él y no se envía', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage({ b2b: true });
    fillContact();
    fillCompany('44.444.444-5');
    blur(/RUT Empresa/);
    const rut = screen.getByLabelText(/RUT Empresa/);
    expect(rut).toHaveAttribute('aria-invalid', 'true');
    expect(rut).toHaveAccessibleDescription('Revisa el RUT: el dígito verificador no corresponde.');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa el RUT: el dígito verificador no corresponde.');
    expect(rut).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    // Al corregirlo, el mensaje se va y la solicitud sale con el RUT con formato
    type(/RUT Empresa/, '444444444');
    expect(rut).not.toHaveAttribute('aria-invalid');
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody().company).toEqual({ rut: '44.444.444-4', giro: 'Prueba', address: 'Prueba 123, Santiago' });
  });

  it('obligatorio en modo empresa: vacío o mal escrito no se envía', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage({ b2b: true });
    fillContact();
    fillCompany('');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe el RUT de la empresa.');
    type(/RUT Empresa/, 'RUT-PRUEBA');
    blur(/RUT Empresa/);
    expect(screen.getByLabelText(/RUT Empresa/)).toHaveAccessibleDescription(FIELD_MESSAGES.rutFormat);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('con puntos pero sin dígito verificador: queda como se escribió, se pide el RUT completo y no se envía', async () => {
    // Leído como cuerpo + DV, "44.444.445" pasaría como otro RUT válido (4.444.444-5)
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage({ b2b: true });
    fillContact();
    fillCompany('44.444.445');
    blur(/RUT Empresa/);
    const rut = screen.getByLabelText(/RUT Empresa/);
    expect(rut).toHaveValue('44.444.445');
    expect(rut).toHaveAccessibleDescription(FIELD_MESSAGES.rutFormat);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(FIELD_MESSAGES.rutFormat);
    expect(rut).toHaveFocus();
    expect(rut).toHaveValue('44.444.445');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('/cotizacion: validación por campo (F-02)', () => {
  it('al salir de cada campo: el mensaje debajo, con aria-invalid y aria-describedby', async () => {
    await renderPage();
    blur(/Nombre y Apellido/);
    expect(screen.getByLabelText(/Nombre y Apellido/)).toHaveAccessibleDescription('Escribe tu nombre y apellido.');
    type(/Email/, 'prueba-ux02.example.com');
    blur(/Email/);
    expect(screen.getByLabelText(/Email/)).toHaveAccessibleDescription(FIELD_MESSAGES.emailInvalid);
    type(/Teléfono/, '212 3456');
    blur(/Teléfono/);
    expect(screen.getByLabelText(/Teléfono/)).toHaveAccessibleDescription('El teléfono debe tener entre 8 y 12 dígitos.');
    // Sin aviso general hasta que se intenta enviar
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('al enviar: el foco va al primer campo con error y el aviso lista todos, justo antes del botón', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true}'));
    await renderPage({ b2b: true });
    type(/Email/, 'prueba-ux02@example.com');
    submit();
    const alert = await screen.findByRole('alert');
    expect(screen.getByLabelText(/Nombre y Apellido/)).toHaveFocus();
    expect(within(alert).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Escribe tu nombre y apellido.',
      'Escribe tu teléfono.',
      'Escribe el RUT de la empresa.',
      'Escribe la razón social.',
      'Escribe el giro de la empresa.',
      'Escribe la dirección comercial.',
    ]);
    expect(alert.nextElementSibling).toBe(button());
    expect(fetch).not.toHaveBeenCalled();
    // Al pasar a persona, los datos de empresa dejan de contar
    fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'persona' } });
    expect(within(screen.getByRole('alert')).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Escribe tu nombre y apellido.',
      'Escribe tu teléfono.',
    ]);
  });
});

describe('/cotizacion: plazo y confirmación (F-03)', () => {
  const NO_OTHER_CHANNEL = /whatsapp|wa\.me|llam(?:ar|amos|aremos|ada)|tel[eé]fono|\+56/i;

  it('junto al botón: "Te respondemos por correo el mismo día hábil" y el horario', async () => {
    await renderPage();
    const note = screen.getByText(responseTimePromise);
    expect(button().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.nextElementSibling).toHaveTextContent(`Atendemos de ${businessHoursLong}`);
  });

  it('la confirmación: plazo, horario, referencia, 3 pasos, revisa tu correo, resumen e imprimir; sin WhatsApp ni llamadas', async () => {
    vi.stubGlobal('fetch', reply(201, '{"success":true,"dealId":77}'));
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderPage();
    fillContact();
    submit();
    const heading = await screen.findByRole('heading', { name: 'Solicitud enviada' });
    await waitFor(() => expect(heading).toHaveFocus());
    const ref = sentBody().quoteReference;
    expect(heading).toHaveAccessibleDescription(`${responseTimePromise} Referencia: ${ref}`);

    const page = heading.closest('[data-elights-form]') as HTMLElement;
    expect(page).toHaveAttribute('data-elights-form', 'cotizacion');
    const text = page.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(`Atendemos de ${businessHoursLong} Si tu solicitud llegó fuera de ese horario, te respondemos el día hábil siguiente.`);
    expect(within(screen.getByRole('region', { name: 'Próximos pasos' })).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Revisamos tu solicitud y confirmamos disponibilidad y precio.',
      'Te enviamos por correo la cotización formal, con el link de pago.',
      'Si la aceptas, pagas con el link de pago: la compra se hace solo cuando pagas.',
    ]);
    expect(text).toContain('Revisa tu correo, también la carpeta de spam');
    const summary = screen.getByRole('region', { name: 'Resumen de tu solicitud' });
    expect(summary).toHaveTextContent(product.name);
    expect(summary).toHaveTextContent(`3 × $${product.price.toLocaleString('es-CL')}`);
    expect(summary).toHaveTextContent('Total referencial:');
    expect(screen.getByRole('link', { name: contactEmail })).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(ref)));

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir o guardar resumen' }));
    expect(print).toHaveBeenCalledTimes(1);

    expect(text).not.toMatch(NO_OTHER_CHANNEL);
    expect(text).not.toMatch(/a la brevedad|te contactar[áa]|copia/i);
  });
});

describe('/cotizacion: recordar mis datos', () => {
  const CONTACT = { nombre: 'PRUEBA Cotización (rec) - borrar', email: 'prueba-recordar-cotizacion@example.com', telefono: '+56 9 0000 0934' };
  const COMPANY = { empresa: 'PRUEBA Cotización SpA (no procesar)', giro: 'Prueba', direccion: 'Prueba 123, Santiago', rut: TEST_RUT };
  const COMENTARIO = 'PRUEBA comentario de la cotización - borrar';
  /** El servidor confirma con la referencia que recibió (api/quotes/create.ts). */
  const confirms = () => vi.fn(async (_url: string, init: RequestInit) => ({
    ok: true,
    status: 201,
    text: async () => JSON.stringify({ success: true, quoteReference: JSON.parse(init.body as string).quoteReference, dealId: 1 }),
  }));
  const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
  const bodies = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));
  const privacy = () => fireEvent.click(screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/));

  function fillAll({ empresa = true } = {}) {
    type(/Nombre y Apellido/, CONTACT.nombre);
    type(/Email/, CONTACT.email);
    type(/Teléfono/, CONTACT.telefono);
    if (empresa) {
      fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'empresa' } });
      fillCompany(COMPANY.rut);
      type(/Razón Social/, COMPANY.empresa);
      type(/Dirección Comercial/, COMPANY.direccion);
    }
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it('sin datos guardados, la casilla empieza desmarcada, después de la empresa y antes de los comentarios', async () => {
    await renderPage({ b2b: true });
    expectFreshBox();
    const box = rememberBox();
    expect(field(/Dirección Comercial/).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(field(/Comentarios/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('con datos, completa los vacíos y el tipo guardado gana sobre el modo del encabezado; después manda el selector', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY, comuna: 'Maipú', region: 'Valparaiso' });
    await renderPage(); // modo persona en el encabezado
    await waitFor(() => expect(field(/Nombre y Apellido/).value).toBe(CONTACT.nombre));
    expect(field(/Email/).value).toBe(CONTACT.email);
    expect(field(/Teléfono/).value).toBe(CONTACT.telefono);
    expect(field(/Tipo de cliente/).value).toBe('empresa');
    expect(field(/RUT Empresa/).value).toBe(TEST_RUT);
    expect(field(/Razón Social/).value).toBe(COMPANY.empresa);
    expect(field(/Giro/).value).toBe(COMPANY.giro);
    expect(field(/Dirección Comercial/).value).toBe(COMPANY.direccion);
    expectSavedBox();
    fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'persona' } });
    expect(field(/Tipo de cliente/).value).toBe('persona');
    expect(screen.queryByLabelText(/Razón Social/)).toBeNull();
  });

  it('guardado como persona, en modo empresa del encabezado aparece como persona', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'persona' });
    await renderPage({ b2b: true });
    await waitFor(() => expect(field(/Tipo de cliente/).value).toBe('persona'));
    expect(field(/Nombre y Apellido/).value).toBe(CONTACT.nombre);
  });

  it('desmarcar borra al instante sin vaciar los campos; cambiar el correo desmarca y borra', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY });
    await renderPage();
    await waitFor(() => expectSavedBox());
    fireEvent.click(rememberBox());
    expect(storedContact()).toBeNull();
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.cleared);
    expect(field(/Razón Social/).value).toBe(COMPANY.empresa);
    expectFreshBox();
  });

  it('cambiar el correo completado desmarca y borra, con su aviso', async () => {
    seedSaved(CONTACT);
    await renderPage();
    await waitFor(() => expect(rememberBox().checked).toBe(true));
    type(/Email/, 'prueba-otra@example.com');
    expect(storedContact()).toBeNull();
    expect(rememberBox().checked).toBe(false);
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.emailChanged);
  });

  it('un envío confirmado como empresa con la casilla marcada guarda exactamente lo enviado; ni comentarios ni productos', async () => {
    vi.stubGlobal('fetch', confirms());
    await renderPage();
    fillAll();
    type(/Comentarios/, COMENTARIO);
    fireEvent.click(rememberBox());
    privacy();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY });
    expectNothingElseStored([COMENTARIO, product.name, String(product.jumpseller_id), 'NE-']);
  });

  it('como persona guarda el tipo persona y no la empresa (aunque se haya escrito antes de cambiar)', async () => {
    vi.stubGlobal('fetch', confirms());
    await renderPage({ b2b: true });
    fillAll();
    fireEvent.change(screen.getByLabelText(/Tipo de cliente/), { target: { value: 'persona' } });
    fireEvent.click(rememberBox());
    privacy();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual({ ...CONTACT, tipoCliente: 'persona' });
  });

  it('un envío confirmado con la casilla desmarcada no guarda nada', async () => {
    vi.stubGlobal('fetch', confirms());
    await renderPage();
    fillAll();
    privacy();
    submit();
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(storedContact()).toBeNull();
  });

  it.each([
    ['sin referencia (la trampa contra bots)', () => reply(201, '{"success":true}'), false],
    ['sin referencia (la trampa contra bots)', () => reply(201, '{"success":true}'), true],
    ['400', () => reply(400, '{"success":false}'), false],
    ['400', () => reply(400, '{"success":false}'), true],
    ['500', () => reply(500, '{"success":false}'), false],
    ['500', () => reply(500, '{"success":false}'), true],
  ])('%s (con datos guardados: %s): no guarda nada y lo guardado no cambia', async (_, server, withSaved) => {
    vi.stubGlobal('fetch', server());
    if (withSaved) seedSaved(CONTACT);
    const before = localStorage.getItem('elights_contact');
    await renderPage();
    if (withSaved) {
      await waitFor(() => expect(rememberBox().checked).toBe(true));
      type(/Teléfono/, '+56 9 0000 0939');
    } else {
      fillAll({ empresa: false });
      fireEvent.click(rememberBox());
    }
    privacy();
    submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(localStorage.getItem('elights_contact')).toBe(before);
  });

  it('el cuerpo que va al servidor es idéntico con y sin datos guardados', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal('fetch', confirms());
    await renderPage();
    fillAll();
    privacy();
    submit();
    await screen.findByText('Solicitud enviada');
    cleanup();
    sessionStorage.clear();
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY });
    await renderPage();
    await waitFor(() => expect(field(/RUT Empresa/).value).toBe(TEST_RUT));
    privacy();
    submit();
    await screen.findByText('Solicitud enviada');
    const [without, withSaved] = bodies();
    expect(withSaved).toEqual(without);
    expect(JSON.stringify(withSaved)).not.toMatch(/recordarDatos|elights_contact|remember/i);
  });
});
