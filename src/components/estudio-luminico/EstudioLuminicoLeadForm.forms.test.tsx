// /estudio-luminico: «Recordar mis datos en este dispositivo» (especificación del 23-10-2026,
// §5). Guarda nombre, correo, teléfono y la empresa (con ella, el tipo pasa a 'empresa'; sin
// ella, nunca a 'persona'). La comuna o ciudad es del proyecto: ni se lee ni se guarda.
// Datos inventados (correos example.com).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EstudioLuminicoLeadForm from './EstudioLuminicoLeadForm';
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

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));

const reply = (status: number, text: string) =>
  vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: status >= 200 && status < 300, status, text: async () => text }));
const OK = () => reply(201, '{"success":true,"dealId":555,"leadRef":"ESTL-x"}');

const CONTACT = { nombre: 'PRUEBA Estudio (rec) - borrar', email: 'prueba-recordar-estudio@example.com', telefono: '+56 9 0000 0932' };
const EMPRESA = 'PRUEBA Estudio SpA (no procesar)';
const DESCRIPCION = 'PRUEBA descripción del proyecto - borrar';

const form = () => <MemoryRouter><EstudioLuminicoLeadForm /></MemoryRouter>;
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: /SOLICITAR COTIZACION/ }));
const bodies = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));

async function renderForm() {
  render(form());
  await waitFor(() => expect(field(/Nombre completo/)).toBeEnabled());
}

function fillContact({ empresa = true } = {}) {
  type(/Nombre completo/, CONTACT.nombre);
  type(/Correo electrónico/, CONTACT.email);
  type(/Teléfono/, CONTACT.telefono);
  if (empresa) type(/^Empresa/, EMPRESA);
}

function fillProject() {
  type(/Tipo de proyecto/, 'industria_bodega');
  type(/Comuna \/ Ciudad/, 'Tomé, Región del Biobío');
  type(/Tienes planos/, 'no_tengo');
  type(/Dimensiones aproximadas/, 'PRUEBA 10x20 m');
  type(/Altura de montaje/, '6 m');
  type(/Objetivo del proyecto/, 'operacion_industrial');
  type(/Descripción del proyecto/, DESCRIPCION);
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

describe('/estudio-luminico: recordar mis datos', () => {
  it('sin datos guardados, la casilla empieza desmarcada, después de la empresa y antes del proyecto', async () => {
    await renderForm();
    expectFreshBox();
    const box = rememberBox();
    expect(field(/^Empresa/).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(field(/Tipo de proyecto/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(privacyBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('con datos, completa los vacíos (la empresa también, no la comuna del proyecto) y muestra la casilla marcada', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA, giro: 'Prueba', rut: TEST_RUT, comuna: 'Maipú', region: 'Valparaiso' });
    await renderForm();
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
    expect(field(/Correo electrónico/).value).toBe(CONTACT.email);
    expect(field(/Teléfono/).value).toBe(CONTACT.telefono);
    expect(field(/^Empresa/).value).toBe(EMPRESA);
    expect(field(/Comuna \/ Ciudad/).value).toBe('');
    expectSavedBox();
  });

  it('una empresa guardada más larga que el tope de este formulario (120) no se completa aquí', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: 'E'.repeat(150) });
    await renderForm();
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
    expect(field(/^Empresa/).value).toBe('');
  });

  it('desmarcar borra al instante sin vaciar los campos', async () => {
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA });
    await renderForm();
    fireEvent.click(rememberBox());
    expect(storedContact()).toBeNull();
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.cleared);
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
    expect(field(/^Empresa/).value).toBe(EMPRESA);
    expectFreshBox();
  });

  it('cambiar el correo completado desmarca y borra, con su aviso', async () => {
    seedSaved(CONTACT);
    await renderForm();
    type(/Correo electrónico/, 'prueba-otra@example.com');
    expect(storedContact()).toBeNull();
    expect(rememberBox().checked).toBe(false);
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.emailChanged);
    expect(field(/Teléfono/).value).toBe(CONTACT.telefono);
  });

  it('un envío confirmado con la casilla marcada guarda lo enviado con la empresa y el tipo empresa; nada del proyecto', async () => {
    vi.stubGlobal('fetch', OK());
    await renderForm();
    fillContact();
    fillProject();
    fireEvent.click(rememberBox());
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual({ ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA });
    expectNothingElseStored([DESCRIPCION, 'Tomé', 'PRUEBA 10x20 m', 'industria_bodega', 'operacion_industrial', 'no_tengo']);
  });

  it('sin empresa no pasa el tipo a persona: lo guardado como empresa (mismo correo) queda', async () => {
    vi.stubGlobal('fetch', OK());
    const saved = { ...CONTACT, tipoCliente: 'empresa' as const, empresa: EMPRESA, giro: 'Prueba', direccion: 'Prueba 123', rut: TEST_RUT };
    seedSaved(saved);
    await renderForm();
    type(/^Empresa/, ''); // la persona borra la empresa de este envío
    fillProject();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual(saved);
  });

  it('otra empresa borra el RUT, el giro y la dirección guardados', async () => {
    vi.stubGlobal('fetch', OK());
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA, giro: 'Prueba', direccion: 'Prueba 123', rut: TEST_RUT });
    await renderForm();
    type(/^Empresa/, 'PRUEBA Otra Ltda.');
    fillProject();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual({ ...CONTACT, tipoCliente: 'empresa', empresa: 'PRUEBA Otra Ltda.' });
  });

  it('un envío confirmado con la casilla desmarcada no guarda nada', async () => {
    vi.stubGlobal('fetch', OK());
    await renderForm();
    fillContact();
    fillProject();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
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
      await renderForm();
      if (withSaved) type(/^Empresa/, EMPRESA);
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

  it('«Enviar otra solicitud» vuelve a completar con lo guardado y la casilla al día', async () => {
    vi.stubGlobal('fetch', OK());
    await renderForm();
    fillContact();
    fillProject();
    fireEvent.click(rememberBox());
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar otra solicitud' }));
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
    expect(field(/^Empresa/).value).toBe(EMPRESA);
    expect(field(/Descripción del proyecto/).value).toBe('');
    expectSavedBox();
  });

  it('el cuerpo que va al servidor es idéntico con y sin datos guardados', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal('fetch', OK());
    const first = render(form());
    await waitFor(() => expect(field(/Nombre completo/)).toBeEnabled());
    fillContact();
    fillProject();
    submit();
    await screen.findByText('Solicitud recibida');
    first.unmount();
    seedSaved({ ...CONTACT, tipoCliente: 'empresa', empresa: EMPRESA });
    await renderForm();
    expect(field(/^Empresa/).value).toBe(EMPRESA);
    fillProject();
    submit();
    await screen.findByText('Solicitud recibida');
    const [without, withSaved] = bodies();
    expect(withSaved).toEqual(without);
    expect(JSON.stringify(withSaved)).not.toMatch(/recordarDatos|elights_contact|remember/i);
  });
});
