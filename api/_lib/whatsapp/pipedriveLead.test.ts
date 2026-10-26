// api/_lib/whatsapp/pipedriveLead.test.ts
// Bot de WhatsApp, PR 1: lo que ensureWhatsAppDeal escribe en Pipedrive.
// - Instalación: el correo y el nombre (install_*) llegan a la persona, a la nota y a los campos.
// - La nota y los campos nunca escriben un objeto, aunque llegue uno.
// - Un dato raro no deja una persona sin negocio: la nota y los campos se arman antes.
// - Si Pipedrive rechaza los campos del negocio, la nota se escribe igual.
// Pipedrive está simulado (sin red); solo datos inventados.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn() }));
vi.mock('../pipedrive/deals.js', () => ({ createDeal: vi.fn(), updateDeal: vi.fn() }));
vi.mock('../pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../pipedrive/client.js', () => ({ pipedrivePost: vi.fn() }));

import { ensureWhatsAppDeal, WA_DEDUP_WINDOW_DAYS } from './pipedriveLead';
import type { WhatsAppLeadParams } from './pipedriveLead';
import { findOrCreatePerson } from '../pipedrive/persons.js';
import { createDeal, updateDeal } from '../pipedrive/deals.js';
import { pipedrivePost } from '../pipedrive/client.js';

const PHONE = '+56900000201';

function noteContent(): string {
  const call = vi.mocked(pipedrivePost).mock.calls.find(([path]) => path === '/notes');
  return String((call?.[1] as { content?: string } | undefined)?.content ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_wa_correo');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_NAME', 'cf_wa_nombre');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_PROJECT_USE', 'cf_wa_proyecto');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_QUANTITY', 'cf_wa_cantidad');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_BOT_SUMMARY', 'cf_wa_resumen');
  vi.mocked(findOrCreatePerson).mockResolvedValue({ personId: 7001, action: 'created' } as Awaited<ReturnType<typeof findOrCreatePerson>>);
  vi.mocked(createDeal).mockResolvedValue({ dealId: 9001, status: 'created' } as Awaited<ReturnType<typeof createDeal>>);
  vi.mocked(updateDeal).mockResolvedValue(undefined as Awaited<ReturnType<typeof updateDeal>>);
  vi.mocked(pipedrivePost).mockResolvedValue({ success: true, data: { id: 1 } } as Awaited<ReturnType<typeof pipedrivePost>>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('instalación', () => {
  const params: WhatsAppLeadParams = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: 'Pide instalación de luces en su casa.',
    body: 'Quiero instalar luces en mi casa',
    captured: { install_nombre: 'Ana Prueba', install_correo: 'ana.prueba@example.com', install_comuna: 'Maipú', install_tipo_proyecto: 'casa' },
    captureStatus: 'complete',
  };

  it('el correo y el nombre llegan a la persona', async () => {
    const result = await ensureWhatsAppDeal(params);
    expect(result).toEqual({ dealId: 9001, personId: 7001, action: 'created' });
    expect(vi.mocked(findOrCreatePerson).mock.calls[0][0]).toMatchObject({ name: 'Ana Prueba', email: 'ana.prueba@example.com', phone: PHONE });
  });

  it('la nota trae el correo, el nombre, la comuna y el proyecto, y dice que es de instalación', async () => {
    await ensureWhatsAppDeal(params);
    const note = noteContent();
    expect(note).toContain('Correo: ana.prueba@example.com');
    expect(note).toContain('Nombre/empresa: Ana Prueba');
    expect(note).toContain('Comuna/ciudad: Maipú');
    expect(note).toContain('Proyecto/uso: casa');
    expect(note).toContain('Solicitud de instalacion: Si');
  });

  it('los campos del negocio llevan el correo y el nombre', async () => {
    await ensureWhatsAppDeal(params);
    expect(vi.mocked(updateDeal).mock.calls[0][1]).toMatchObject({ cf_wa_correo: 'ana.prueba@example.com', cf_wa_nombre: 'Ana Prueba' });
  });

  it('un nombre de instalación que no es un nombre ("de Maipu") no llega a la persona ni a la nota', async () => {
    await ensureWhatsAppDeal({ ...params, captured: { ...params.captured, install_nombre: 'de Maipu' } });
    expect(vi.mocked(findOrCreatePerson).mock.calls[0][0]).toMatchObject({ name: 'Perfil Prueba', email: 'ana.prueba@example.com' });
    expect(noteContent()).toContain('Nombre/empresa: Perfil Prueba');
    expect(vi.mocked(updateDeal).mock.calls[0][1]).not.toHaveProperty('cf_wa_nombre');
  });

  it('un pedido de productos no dice "Solicitud de instalacion"', async () => {
    await ensureWhatsAppDeal({ ...params, captured: { producto: 'focos LED', correo: 'ana.prueba@example.com' } });
    expect(noteContent()).not.toContain('instalacion');
  });
});

describe('datos con otra forma', () => {
  // Llegan como objeto aunque el tipo diga texto (por ejemplo, desde una versión vieja del parseo).
  const odd = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: { resumen: 'Pide paneles', prioridad: 'media' },
    body: 'Necesito 20 paneles y 10 focos',
    captured: { producto: 'paneles', cantidad: { paneles: 20, focos: 10 }, proyecto_o_uso: { tipo: 'bodega' }, correo: 'pedro.prueba@example.com' },
    captureStatus: 'partial',
  } as unknown as WhatsAppLeadParams;

  it('no lanza, crea el negocio y la nota nunca escribe "[object Object]"', async () => {
    await expect(ensureWhatsAppDeal(odd)).resolves.toMatchObject({ action: 'created', dealId: 9001 });
    expect(findOrCreatePerson).toHaveBeenCalledTimes(1);
    expect(createDeal).toHaveBeenCalledTimes(1);
    // Ventana de 7 dias (decision del dueno, 2026-10-26): solo cuenta un negocio abierto con movimiento.
    expect(vi.mocked(createDeal).mock.calls[0][0]).toMatchObject({ quoteReference: 'WA-' + PHONE.replace(/\D/g, ''), dedupOpenWithinDays: WA_DEDUP_WINDOW_DAYS });
    expect(WA_DEDUP_WINDOW_DAYS).toBe(7);
    const note = noteContent();
    expect(note).not.toContain('[object Object]');
    expect(note).toContain('Cantidad: -');
    expect(note).toContain('Proyecto/uso: -');
    expect(note).toContain('Resumen bot: -');
  });

  it('los campos del negocio solo llevan texto', async () => {
    await ensureWhatsAppDeal(odd);
    for (const value of Object.values(vi.mocked(updateDeal).mock.calls[0][1])) expect(typeof value).toBe('string');
    expect(vi.mocked(createDeal).mock.calls[0][0].notes).toBeUndefined();
  });
});

describe('fallas de Pipedrive', () => {
  const params: WhatsAppLeadParams = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: 'Pide focos LED.',
    body: 'Necesito 10 focos LED, pedro.prueba@example.com',
    captured: { producto: 'focos LED', cantidad: '10', correo: 'pedro.prueba@example.com' },
  };

  it('si rechaza los campos del negocio, la nota se escribe igual y el negocio cuenta como creado', async () => {
    vi.mocked(updateDeal).mockRejectedValueOnce(new Error('Pipedrive 400 (simulado)'));
    await expect(ensureWhatsAppDeal(params)).resolves.toMatchObject({ action: 'created', dealId: 9001 });
    expect(noteContent()).toContain('Correo: pedro.prueba@example.com');
  });

  it('si falla la creación del negocio, lanza (el webhook responde el texto B)', async () => {
    vi.mocked(createDeal).mockRejectedValueOnce(new Error('Pipedrive 500 (simulado)'));
    await expect(ensureWhatsAppDeal(params)).rejects.toThrow('Pipedrive 500');
  });
});
