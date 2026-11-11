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
