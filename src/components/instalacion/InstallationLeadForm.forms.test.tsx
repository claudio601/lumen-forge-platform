// /instalacion: «Recordar mis datos en este dispositivo» (especificación del 23-10-2026, §5).
// Guarda nombre, correo y teléfono; la comuna (la de la obra) solo se lee y nunca se guarda
// desde aquí, y la empresa guardada no se borra. Datos inventados (correos example.com).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InstallationLeadForm from './InstallationLeadForm';
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
const OK = () => reply(201, '{"success":true,"dealId":777,"leadRef":"INST-x"}');

const CONTACT = { nombre: 'PRUEBA Recordar (inst) - borrar', email: 'prueba-recordar-inst@example.com', telefono: '+56 9 0000 0931' };
const DESCRIPCION = 'PRUEBA recordar - no contactar; borrar';

const form = () => <MemoryRouter><InstallationLeadForm /></MemoryRouter>;
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const privacyBox = () => screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: /SOLICITAR EVALUACIÓN/ }));
const bodies = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));

async function renderForm() {
  render(form());
  // El fieldset se habilita al hidratar, en el mismo efecto que lee lo guardado
  await waitFor(() => expect(field(/Nombre completo/)).toBeEnabled());
}

function fillContact() {
  type(/Nombre completo/, CONTACT.nombre);
  type(/Teléfono/, CONTACT.telefono);
  type(/Correo electrónico/, CONTACT.email);
}

function fillProject() {
  type(/Comuna/, 'Maipú');
  type(/Tipo de proyecto/, 'Oficina');
  type(/Descripción breve/, DESCRIPCION);
  type(/Tipo de cliente/, 'condominio');
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

describe('/instalacion: recordar mis datos', () => {
  it('sin datos guardados, la casilla empieza desmarcada, después de la comuna y antes del tipo de proyecto', async () => {
    await renderForm();
    expectFreshBox();
    expect(field(/Nombre completo/).value).toBe('');
    const box = rememberBox();
    expect(field(/Comuna/).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(field(/Tipo de proyecto/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(privacyBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['getItem', 'setItem'] as const)('si %s lanza (almacenamiento bloqueado), la casilla se quita y el formulario sigue', async (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('bloqueado'); });
    vi.stubGlobal('fetch', OK());
    await renderForm();
    expect(screen.queryByRole('checkbox', { name: /mis datos en este dispositivo/ })).toBeNull();
    expect(screen.queryByText(REMEMBER_TEXTS.hint)).toBeNull();
    fillContact();
    fillProject();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
  });

  it('con datos, completa los vacíos (también la comuna) y muestra la casilla marcada con «Seguir recordando…» y el aviso', async () => {
    seedSaved({ ...CONTACT, comuna: 'Maipú', empresa: 'PRUEBA SpA', tipoCliente: 'empresa' });
    await renderForm();
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
    expect(field(/Correo electrónico/).value).toBe(CONTACT.email);
    expect(field(/Teléfono/).value).toBe(CONTACT.telefono);
    expect(field(/Comuna/).value).toBe('Maipú');
    // El tipo de cliente de aquí (hogar, empresa o condominio) no se toca
    expect(field(/Tipo de cliente/).value).toBe('');
    expectSavedBox();
  });

  it('desmarcar borra al instante sin vaciar los campos', async () => {
    seedSaved(CONTACT);
    await renderForm();
    fireEvent.click(rememberBox());
    expect(storedContact()).toBeNull();
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.cleared);
    expectFreshBox();
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
    expect(field(/Correo electrónico/).value).toBe(CONTACT.email);
  });

  it('cambiar el correo desmarca y borra, con su aviso', async () => {
    seedSaved(CONTACT);
    await renderForm();
    type(/Correo electrónico/, 'prueba-otra-persona@example.com');
    expect(storedContact()).toBeNull();
    expect(rememberBox().checked).toBe(false);
    expect(rememberStatus()).toHaveTextContent(REMEMBER_TEXTS.emailChanged);
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
  });

  it('un envío confirmado con la casilla marcada guarda solo nombre, correo y teléfono (ni la comuna de la obra ni la descripción)', async () => {
    vi.stubGlobal('fetch', OK());
    await renderForm();
    fillContact();
    fillProject();
    fireEvent.click(rememberBox());
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual(CONTACT);
    expect(Object.keys(storedContact()!.data)).toEqual(['nombre', 'email', 'telefono']);
    expectNothingElseStored([DESCRIPCION, 'Maipú', 'Oficina', 'condominio']);
  });

  it('con el mismo correo, no borra la empresa guardada ni la comuna, y actualiza el teléfono', async () => {
    vi.stubGlobal('fetch', OK());
    const saved = { ...CONTACT, tipoCliente: 'empresa' as const, empresa: 'PRUEBA SpA', giro: 'Prueba', rut: TEST_RUT, comuna: 'Santiago' };
    seedSaved(saved);
    await renderForm();
    type(/Teléfono/, '+56 9 0000 0939');
    fillProject();
    submit();
    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(storedContact()?.data).toEqual({ ...saved, telefono: '+56 9 0000 0939' });
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
      if (withSaved) type(/Teléfono/, '+56 9 0000 0939'); // mismo correo: la casilla sigue marcada
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
    expect(field(/Comuna/).value).toBe('');
    expect(field(/Descripción breve/).value).toBe('');
    expectSavedBox();
  });

  it('el cuerpo que va al servidor es idéntico con y sin datos guardados', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal('fetch', OK());
    // Sin datos guardados: todo escrito a mano
    const first = render(form());
    await waitFor(() => expect(field(/Nombre completo/)).toBeEnabled());
    fillContact();
    fillProject();
    submit();
    await screen.findByText('Solicitud recibida');
    first.unmount();
    // Con los mismos datos guardados: el contacto llega completado
    seedSaved(CONTACT);
    await renderForm();
    expect(field(/Nombre completo/).value).toBe(CONTACT.nombre);
    fillProject();
    submit();
    await screen.findByText('Solicitud recibida');
    const [without, withSaved] = bodies();
    expect(withSaved).toEqual(without);
    expect(JSON.stringify(withSaved)).not.toMatch(/recordarDatos|elights_contact|remember/i);
  });
});
