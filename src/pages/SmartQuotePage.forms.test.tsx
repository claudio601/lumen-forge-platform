// /cotizador: «Recordar mis datos en este dispositivo» (especificación del 23-10-2026, §5).
// Guarda nombre, correo, teléfono y la empresa como bloque (razón social, giro, dirección y el
// RUT solo si es válido: este formulario no revisa el dígito verificador). Con razón social el
// tipo pasa a 'empresa'; sin ella, nunca a 'persona'. La ciudad es del proyecto: no se guarda.
// Datos inventados (correos example.com y el RUT de prueba de los tests de /cotizacion).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import SmartQuotePage from './SmartQuotePage';
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ uploadPresigned: vi.fn() }));

const reply = (status: number, text: string) =>
  vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: status >= 200 && status < 300, status, text: async () => text }));
const OK = () => reply(201, JSON.stringify({ success: true, reference: 'PY-rec1', dealId: 1 }));

const CONTACT = { nombre: 'PRUEBA Cotizador (rec) - borrar', email: 'prueba-recordar-cotizador@example.com', telefono: '+56 9 0000 0933' };
const COMPANY = { empresa: 'PRUEBA Cotizador SpA (no procesar)', giro: 'Prueba', direccion: 'Prueba 123, Santiago', rut: TEST_RUT };
const COMENTARIO = 'PRUEBA comentario del proyecto - borrar';

const page = () => (
  <HelmetProvider context={{}}>
    <MemoryRouter initialEntries={['/cotizador']}><SmartQuotePage /></MemoryRouter>
  </HelmetProvider>
);
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Solicitar propuesta/ }));
const bodies = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));
const confirmed = () => screen.findByRole('heading', { name: /Propuesta solicitada/ });

async function renderPage() {
  render(page());
  await waitFor(() => expect(field(/Nombre y Apellido/)).toBeEnabled());
}

function fillContact({ company = true, rut = COMPANY.rut } = {}) {
  type(/Nombre y Apellido/, CONTACT.nombre);
  type(/Email/, CONTACT.email);
  type(/Teléfono/, CONTACT.telefono);
  if (company) {
    type(/RUT Empresa/, rut);
    type(/Razon Social/, COMPANY.empresa);
    type(/Giro/, COMPANY.giro);
    type(/^Dirección$/, COMPANY.direccion);
  }
}

function fillProject() {
  type(/Tipo de proyecto/, 'Bodega');
  type(/m2 aproximados/, '1200');
  type(/Ciudad/, 'Tomé');
  type(/Plazo del proyecto/, '3 meses');
  type(/Comentarios adicionales/, COMENTARIO);
  fireEvent.click(privacyBox());
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/cotizador: recordar mis datos', () => {
  it('sin datos guardados, la casilla empieza desmarcada, al final de «Datos de contacto»', async () => {
    await renderPage();
    expectFreshBox();
    const box = rememberBox();
    const contact = screen.getByRole('heading', { name: 'Datos de contacto' }).parentElement!;
    expect(contact.contains(box)).toBe(true);
    expect(field(/^Dirección$/).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contact.contains(privacyBox())).toBe(false);
  });

  it('con datos, completa los vacíos (la empresa con el RUT con formato, no la ciudad) y muestra la casilla marcada', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY, rut: '444444444', comuna: 'Maipú', region: 'Valparaiso' });
    await renderPage();
    expect(field(/Nombre y Apellido/).value).toBe(CONTACT.nombre);
    expect(field(/Email/).value).toBe(CONTACT.email);
    expect(field(/Teléfono/).value).toBe(CONTACT.telefono);
    expect(field(/RUT Empresa/).value).toBe(TEST_RUT);
    expect(field(/Razon Social/).value).toBe(COMPANY.empresa);
    expect(field(/Giro/).value).toBe(COMPANY.giro);
    expect(field(/^Dirección$/).value).toBe(COMPANY.direccion);
    expect(field(/Ciudad/).value).toBe('');
    expectSavedBox();
  });

  it('una razón social guardada más larga que el tope de este formulario (150) no se completa aquí', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: 'E'.repeat(180), giro: 'Prueba' });
    await renderPage();
    expect(field(/Razon Social/).value).toBe('');
    expect(field(/Giro/).value).toBe('Prueba');
  });

  it('desmarcar borra al instante sin vaciar los campos', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY });
    await renderPage();
    fireEvent.click(rememberBox());
    expect(storedContact()).toBeNull();
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.cleared);
    expect(field(/Razon Social/).value).toBe(COMPANY.empresa);
    expect(field(/RUT Empresa/).value).toBe(TEST_RUT);
    expectFreshBox();
  });

  it('cambiar el correo completado desmarca y borra, con su aviso', async () => {
    seedSaved(CONTACT);
    await renderPage();
    type(/Email/, 'prueba-otra@example.com');
    expect(storedContact()).toBeNull();
    expect(rememberBox().checked).toBe(false);
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.emailChanged);
  });

  it('un envío confirmado con la casilla marcada guarda lo enviado, con el tipo empresa; nada del proyecto', async () => {
    vi.stubGlobal('fetch', OK());
    await renderPage();
    fillContact();
    fillProject();
    fireEvent.click(rememberBox());
    submit();
    await confirmed();
    expect(storedContact()?.data).toEqual({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY });
    expect(Object.keys(storedContact()!.data)).toEqual(['nombre', 'email', 'telefono', 'tipoCliente', 'empresa', 'giro', 'direccion', 'rut']);
    expectNothingElseStored([COMENTARIO, 'Tomé', 'Bodega', '1200', '3 meses']);
  });

  it('un RUT con un dígito verificador que no calza no se guarda (este formulario no lo revisa)', async () => {
    vi.stubGlobal('fetch', OK());
    await renderPage();
    fillContact({ rut: '44.444.444-5' });
    fillProject();
    fireEvent.click(rememberBox());
    submit();
    await confirmed();
    expect(bodies()[0].rutEmpresa).toBe('44.444.444-5'); // viaja como se escribió
    expect(storedContact()?.data).toEqual({ ...CONTACT, tipoCliente: 'empresa', empresa: COMPANY.empresa, giro: COMPANY.giro, direccion: COMPANY.direccion });
  });

  it('sin razón social: no pasa el tipo a persona ni borra la empresa guardada (mismo correo)', async () => {
    vi.stubGlobal('fetch', OK());
    const saved = { ...CONTACT, tipoCliente: 'empresa' as const, ...COMPANY };
    seedSaved(saved);
    await renderPage();
    type(/Razon Social/, '');
    type(/Giro/, '');
    fillProject();
    submit();
    await confirmed();
    expect(storedContact()?.data).toEqual(saved);
  });

  it('un envío confirmado con la casilla desmarcada no guarda nada', async () => {
    vi.stubGlobal('fetch', OK());
    await renderPage();
    fillContact();
    fillProject();
    submit();
    await confirmed();
    expect(storedContact()).toBeNull();
  });

  const FAILED: [string, () => ReturnType<typeof reply>][] = [
    ['sin referencia (la trampa contra bots)', () => reply(200, '{"success":true}')],
    ['400', () => reply(400, '{"success":false,"error":"Validation failed"}')],
    ['500', () => reply(500, '{"success":false}')],
  ];
  it.each(FAILED.flatMap(([name, server]) => [[`${name}, sin datos guardados`, server, false], [`${name}, con datos guardados`, server, true]] as const))(
    '%s: no guarda nada y lo guardado no cambia',
    async (_, server, withSaved) => {
      vi.stubGlobal('fetch', server());
      if (withSaved) seedSaved(CONTACT);
      const before = localStorage.getItem('elights_contact');
      await renderPage();
      if (withSaved) type(/Teléfono/, '+56 9 0000 0939');
      else {
        fillContact();
        fireEvent.click(rememberBox());
      }
      fillProject();
      expect(rememberBox().checked).toBe(true);
      submit();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(localStorage.getItem('elights_contact')).toBe(before);
    },
  );

  it('el cuerpo que va al servidor es idéntico con y sin datos guardados', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal('fetch', OK());
    const first = render(page());
    await waitFor(() => expect(field(/Nombre y Apellido/)).toBeEnabled());
    fillContact();
    fillProject();
    submit();
    await confirmed();
    first.unmount();
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', ...COMPANY });
    await renderPage();
    expect(field(/RUT Empresa/).value).toBe(TEST_RUT);
    fillProject();
    submit();
    await confirmed();
    const [without, withSaved] = bodies();
    expect(withSaved).toEqual(without);
    expect(JSON.stringify(withSaved)).not.toMatch(/recordarDatos|elights_contact|remember/i);
  });
});
