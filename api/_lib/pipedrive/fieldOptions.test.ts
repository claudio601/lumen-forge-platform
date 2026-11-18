// api/_lib/pipedrive/fieldOptions.test.ts
// Las opciones se comparan sin mayúsculas ni tildes: 'Telefono' (formulario de instalación)
// encuentra la opción "Teléfono" de preferredChannel. Antes no calzaba y el campo quedaba vacío.
// Pipedrive está simulado (sin red); ids inventados.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({ pipedriveGet: vi.fn() }));

import { pipedriveGet } from './client.js';

// TRACKED_FIELDS lee process.env al cargar el módulo: primero las variables, después el import.
async function loadWithFields() {
  vi.resetModules();
  vi.stubEnv('PIPEDRIVE_PERSON_FIELD_PREFERRED_CHANNEL', 'cf_canal');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24', 'cf_followup_24');
  vi.mocked(pipedriveGet).mockImplementation((async (path: string) => {
    if (path === '/personFields') {
      return {
        success: true,
        data: [{ key: 'cf_canal', options: [{ id: 911, label: 'Email' }, { id: 912, label: 'WhatsApp' }, { id: 913, label: 'Teléfono' }] }],
      };
    }
    if (path === '/dealFields') {
      return { success: true, data: [{ key: 'cf_followup_24', options: [{ id: 921, label: 'Sí' }, { id: 922, label: 'No' }] }] };
    }
    return { success: true, data: [] };
  }) as never);
  const mod = await import('./fieldOptions.js');
  await mod.initFieldOptions();
  return mod;
}

describe('getOptionId: nombres de opción', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("'Telefono' encuentra la opción \"Teléfono\"", async () => {
    const { getOptionId } = await loadWithFields();
    expect(getOptionId('person', 'cf_canal', 'Telefono')).toBe(913);
  });

  it('sin importar mayúsculas ni tildes, en los dos sentidos', async () => {
    const { getOptionId } = await loadWithFields();
    expect(getOptionId('person', 'cf_canal', 'whatsapp')).toBe(912);
    expect(getOptionId('person', 'cf_canal', 'TELÉFONO')).toBe(913);
    expect(getOptionId('person', 'cf_canal', 'Émail')).toBe(911);
  });

  it('"Sí" y "No" de las tareas de seguimiento siguen igual', async () => {
    const { getBooleanOptionId } = await loadWithFields();
    expect(getBooleanOptionId('deal', 'cf_followup_24', true)).toBe(921);
    expect(getBooleanOptionId('deal', 'cf_followup_24', false)).toBe(922);
  });

  it('una opción que no existe sigue sin id (y avisa en el log)', async () => {
    const { getOptionId } = await loadWithFields();
    expect(getOptionId('person', 'cf_canal', 'Fax')).toBeUndefined();
    expect(getOptionId('person', 'cf_canal', 'Telefonos')).toBeUndefined();
    expect(vi.mocked(console.warn)).toHaveBeenCalled();
  });
});

// Aviso de despacho (spec §4.1): los campos «Despacho · …» se buscan por su nombre exacto, con una
// caché propia que vuelve a consultar si /dealFields falló. Claves e ids inventados.
describe('findDealFieldByName', () => {
  const FIELDS = [
    { key: 'f'.repeat(40), name: 'Despacho · Aviso', field_type: 'enum', options: [{ id: 71, label: 'Vista previa' }, { id: 72, label: 'Enviar al cliente' }] },
    { key: 'e'.repeat(40), name: 'Despacho · Orden de flete', field_type: 'varchar' },
    { key: 'title', name: 'Título', field_type: 'varchar' },
  ];

  async function load() {
    vi.resetModules();
    return import('./fieldOptions.js');
  }

  beforeEach(() => {
    vi.mocked(pipedriveGet).mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('encuentra el campo por su nombre exacto (con «·»), con su tipo y opciones, y pasa el plazo', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: FIELDS } as never);
    const { findDealFieldByName } = await load();
    const result = await findDealFieldByName('Despacho · Aviso', { timeoutMs: 1234 });
    expect(result).toEqual({ status: 'ok', field: { key: 'f'.repeat(40), name: 'Despacho · Aviso', fieldType: 'enum', options: FIELDS[0].options } });
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledWith('/dealFields', { limit: '500' }, 1234);
    // Otro nombre no calza: ni sin «·», ni con otra mayúscula.
    expect(await findDealFieldByName('Despacho Aviso')).toEqual({ status: 'missing' });
    expect(await findDealFieldByName('despacho · aviso')).toEqual({ status: 'missing' });
    // La caché responde sin volver a consultar (dentro del minuto).
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(1);
  });

  it('si la consulta falla, no guarda nada y la siguiente llamada vuelve a consultar', async () => {
    vi.mocked(pipedriveGet)
      .mockResolvedValueOnce({ success: false, data: null, error: 'Request timeout' } as never)
      .mockRejectedValueOnce(new Error('[Pipedrive] PIPEDRIVE_API_TOKEN is not set'))
      .mockResolvedValue({ success: true, data: FIELDS } as never);
    const { findDealFieldByName } = await load();
    expect(await findDealFieldByName('Despacho · Aviso')).toEqual({ status: 'unavailable' });
    expect(await findDealFieldByName('Despacho · Aviso')).toEqual({ status: 'unavailable' });
    expect((await findDealFieldByName('Despacho · Aviso')).status).toBe('ok');
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(3);
  });

  it('dos llamadas a la vez hacen una sola consulta', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: FIELDS } as never);
    const { findDealFieldByName } = await load();
    const [a, b] = await Promise.all([findDealFieldByName('Despacho · Aviso'), findDealFieldByName('Despacho · Orden de flete')]);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(1);
  });

  it('un nombre que falta se vuelve a buscar, como mucho una vez por minuto', async () => {
    vi.useFakeTimers();
    vi.mocked(pipedriveGet)
      .mockResolvedValueOnce({ success: true, data: FIELDS.slice(1) } as never)
      .mockResolvedValue({ success: true, data: FIELDS } as never);
    const { findDealFieldByName } = await load();
    expect(await findDealFieldByName('Despacho · Aviso')).toEqual({ status: 'missing' });
    expect(await findDealFieldByName('Despacho · Aviso')).toEqual({ status: 'missing' });
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect((await findDealFieldByName('Despacho · Aviso')).status).toBe('ok');
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(2);
  });

  it('dos campos con el mismo nombre: no se adivina cuál', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: [...FIELDS, { ...FIELDS[0], key: '0'.repeat(40) }] } as never);
    const { findDealFieldByName } = await load();
    expect(await findDealFieldByName('Despacho · Aviso')).toEqual({ status: 'duplicate' });
  });

  it('resetFieldOptionsCache también vacía esta caché', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: FIELDS } as never);
    const { findDealFieldByName, resetFieldOptionsCache } = await load();
    await findDealFieldByName('Despacho · Aviso');
    resetFieldOptionsCache();
    await findDealFieldByName('Despacho · Aviso');
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(2);
  });
});
