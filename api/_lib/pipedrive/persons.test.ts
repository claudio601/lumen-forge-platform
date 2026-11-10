// api/_lib/pipedrive/persons.test.ts
// Campos de una persona nueva: customerType (B2B/B2C) sale del tipo de cliente y preferredChannel
// del canal. Antes, customerType se buscaba con el canal ('WhatsApp'), que nunca calza con B2B/B2C,
// y quedaba vacío en todas las personas nuevas.
// Pipedrive está simulado (sin red); solo datos inventados.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({ pipedriveGet: vi.fn(), pipedrivePost: vi.fn(), pipedrivePut: vi.fn() }));

// Opciones con los mismos nombres que en la cuenta (ids inventados).
const OPTIONS: Record<string, Record<string, number>> = {
  cf_tipo_cliente: { B2B: 901, B2C: 902 },
  cf_canal: { Email: 911, WhatsApp: 912, Telefono: 913 },
};
vi.mock('./fieldOptions.js', () => ({
  getOptionId: vi.fn((_entity: string, key: string, label: string) => OPTIONS[key]?.[label]),
}));

import { pipedriveGet, pipedrivePost } from './client.js';
import { findOrCreatePerson } from './persons.js';

const PHONE = '+56900000301';

function createdBody(): Record<string, unknown> {
  const call = vi.mocked(pipedrivePost).mock.calls.find(([path]) => path === '/persons');
  expect(call).toBeDefined();
  return call![1] as Record<string, unknown>;
}

describe('findOrCreatePerson: campos de una persona nueva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PIPEDRIVE_PERSON_FIELD_CUSTOMER_TYPE', 'cf_tipo_cliente');
    vi.stubEnv('PIPEDRIVE_PERSON_FIELD_PREFERRED_CHANNEL', 'cf_canal');
    vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: { items: [] } } as never);
    vi.mocked(pipedrivePost).mockResolvedValue({ success: true, data: { id: 7101 } } as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('empresa por WhatsApp: tipo de cliente B2B y canal WhatsApp', async () => {
    const res = await findOrCreatePerson({ name: 'Persona Prueba', phone: PHONE, preferredChannel: 'WhatsApp', customerType: 'B2B' });
    expect(res).toEqual({ personId: 7101, action: 'created' });
    expect(createdBody()).toMatchObject({ cf_tipo_cliente: 901, cf_canal: 912 });
  });

  it('persona sin canal (pedido del sitio): tipo de cliente B2C y sin canal', async () => {
    await findOrCreatePerson({ name: 'Persona Prueba', email: 'persona.prueba@example.com', customerType: 'B2C' });
    const body = createdBody();
    expect(body.cf_tipo_cliente).toBe(902);
    expect(body).not.toHaveProperty('cf_canal');
  });

  it('sin tipo de cliente: el campo queda vacío (no se llena con el canal)', async () => {
    await findOrCreatePerson({ name: 'Persona Prueba', phone: PHONE, preferredChannel: 'WhatsApp' });
    const body = createdBody();
    expect(body).not.toHaveProperty('cf_tipo_cliente');
    expect(body.cf_canal).toBe(912);
  });

  it('sin la variable del campo: no escribe el tipo de cliente', async () => {
    vi.stubEnv('PIPEDRIVE_PERSON_FIELD_CUSTOMER_TYPE', '');
    await findOrCreatePerson({ name: 'Persona Prueba', phone: PHONE, customerType: 'B2B' });
    expect(Object.values(createdBody())).not.toContain(901);
  });

  it('persona que ya existe: no se crea ni se le cambian los campos', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue({
      success: true,
      data: { items: [{ item: { id: 7100, name: 'Persona Prueba', emails: [], phones: [PHONE] } }] },
    } as never);
    const res = await findOrCreatePerson({ name: 'Persona Prueba', phone: PHONE, preferredChannel: 'WhatsApp', customerType: 'B2C' });
    expect(res.action).toBe('found');
    expect(pipedrivePost).not.toHaveBeenCalled();
  });
});
