// api/_lib/pipedrive/crossChannel.test.ts
// Posibles duplicados entre la web y WhatsApp (decisión del dueño, 13-11-2026): una sola
// consulta a los negocios abiertos de la persona, el canal de cada negocio, la ventana de 7
// días y fail-open. Pipedrive simulado: nunca llamadas reales.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({ pipedriveGet: vi.fn() }));

import { pipedriveGet } from './client.js';
import {
  CROSS_CHANNEL_TIMEOUT_MS,
  dealChannel,
  duplicateItem,
  findCrossChannelDuplicates,
  newDealChannel,
} from './crossChannel';
import { TIPO_SERVICIO } from '../crm/tipo-servicio';
import type { PipedriveDeal } from '../crm/types';

const NOW = Date.parse('2026-11-13T15:00:00Z');
const DAY = 86_400_000;
/** Fecha v1 de Pipedrive ('YYYY-MM-DD HH:MM:SS', UTC) de hace `days` días. */
const v1 = (days: number) => new Date(NOW - days * DAY).toISOString().slice(0, 19).replace('T', ' ');
const deal = (id: number, extra: Record<string, unknown> = {}): PipedriveDeal => ({
  id, title: 'Negocio de prueba', status: 'open', pipeline_id: 1, stage_id: 2, person_id: 11, org_id: null, owner_id: 1,
  add_time: v1(1), update_time: v1(1), ...extra,
} as PipedriveDeal);
const ok = (data: unknown) => ({ success: true, data } as never);

beforeEach(() => {
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE', 'cf_ref');
  vi.stubEnv('PIPEDRIVE_FIELD_TIPO_SERVICIO', 'cf_tipo');
  vi.mocked(pipedriveGet).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('dealChannel', () => {
  it.each([
    ['referencia WA-', { cf_ref: 'WA-56900000000' }, 'whatsapp'],
    ['referencia NE-', { cf_ref: 'NE-abc123' }, 'web'],
    ['referencia RC-', { cf_ref: 'RC-abc12' }, 'web'],
    ['referencia PY-', { cf_ref: 'PY-1x2y3z' }, 'web'],
    ['Jumpseller (JS-)', { cf_ref: 'JS-12753' }, null],
    ['Tipo de Servicio WhatsApp (texto)', { cf_tipo: String(TIPO_SERVICIO.WHATSAPP) }, 'whatsapp'],
    ['Tipo de Servicio cotización web (número)', { cf_tipo: TIPO_SERVICIO.COTIZACION_WEB }, 'web'],
    ['Tipo de Servicio instalación', { cf_tipo: TIPO_SERVICIO.INSTALACION }, null],
    ['Tipo de Servicio estudio lumínico', { cf_tipo: TIPO_SERVICIO.ESTUDIO_LUMINICO }, null],
    ['solo el título del bot', { title: 'WhatsApp Lead — Ana' }, 'whatsapp'],
    ['solo el título de un pedido', { title: 'Solicitud RC-abc12 - Ana' }, 'web'],
    ['sin nada que lo diga', {}, null],
  ])('%s → %s', (_name, extra, expected) => {
    expect(dealChannel(deal(1, extra))).toBe(expected);
  });
});

describe('newDealChannel', () => {
  it('solo los formularios web (cotización web) y el bot (WhatsApp) se revisan', () => {
    expect(newDealChannel({ sourceSystem: 'nuevo_elights', tipoServicio: TIPO_SERVICIO.COTIZACION_WEB })).toBe('web');
    expect(newDealChannel({ sourceSystem: 'whatsapp', tipoServicio: TIPO_SERVICIO.WHATSAPP })).toBe('whatsapp');
    expect(newDealChannel({ sourceSystem: 'nuevo_elights', tipoServicio: TIPO_SERVICIO.INSTALACION })).toBeNull();
    expect(newDealChannel({ sourceSystem: 'jumpseller', tipoServicio: TIPO_SERVICIO.JUMPSELLER })).toBeNull();
    expect(newDealChannel({ sourceSystem: 'whatsapp' })).toBeNull();
    expect(newDealChannel({ sourceSystem: 'manual', tipoServicio: TIPO_SERVICIO.COTIZACION_WEB })).toBeNull();
  });
});

describe('findCrossChannelDuplicates', () => {
  it('una sola consulta: los negocios abiertos de la persona, de los más nuevos a los más antiguos, con tope de tiempo', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue(ok([]));
    await findCrossChannelDuplicates({ personId: 11, channel: 'web', now: NOW });
    expect(pipedriveGet).toHaveBeenCalledTimes(1);
    expect(pipedriveGet).toHaveBeenCalledWith(
      '/persons/11/deals', { status: 'open', sort: 'add_time DESC', start: '0', limit: '50' }, CROSS_CHANNEL_TIMEOUT_MS,
    );
  });

  it('web: avisa del negocio abierto de WhatsApp creado en los últimos 7 días, con su número, canal y fecha de Chile', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue(ok([
      deal(999, { cf_ref: 'NE-nuevo1' }), // el negocio recién creado
      deal(501, { cf_ref: 'WA-56911111111', add_time: '2026-11-12 02:30:00' }), // 11-11 en Chile
      deal(502, { cf_ref: 'RC-otro1', add_time: v1(1) }), // otro de la web: no es del otro canal
      deal(503, { cf_ref: 'WA-56911111111', add_time: v1(8) }), // fuera de la ventana
      deal(504, { cf_ref: 'WA-56911111111', status: 'won' }), // cerrado
      deal(505, { cf_ref: 'WA-56911111111', add_time: 'ilegible' }),
    ]));
    const items = await findCrossChannelDuplicates({ personId: 11, channel: 'web', newDealId: 999, now: NOW });
    expect(items).toEqual(['Posible duplicado: revisar el negocio #501 (WhatsApp, 11-11-2026)']);
  });

  it('WhatsApp: avisa de los formularios web, el más nuevo primero y hasta 3', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue(ok([
      deal(601, { cf_ref: 'PY-a1', add_time: v1(6) }),
      deal(602, { cf_ref: 'NE-a2', add_time: v1(1) }),
      deal(603, { cf_ref: 'RC-a3', add_time: v1(2) }),
      deal(604, { cf_ref: 'RC-a4', add_time: v1(3) }),
      deal(605, { cf_ref: 'WA-569', add_time: v1(0) }),
    ]));
    const items = await findCrossChannelDuplicates({ personId: 11, channel: 'whatsapp', now: NOW });
    expect(items.map((i) => i.match(/#(\d+) \(web,/)?.[1])).toEqual(['602', '603', '604']);
  });

  it.each([
    ['Pipedrive responde con error', () => vi.mocked(pipedriveGet).mockResolvedValue({ success: false, data: null, error: 'HTTP 500' } as never)],
    ['la consulta lanza', () => vi.mocked(pipedriveGet).mockRejectedValue(new Error('caída'))],
    ['el cuerpo no es una lista', () => vi.mocked(pipedriveGet).mockResolvedValue(ok({ id: 1 }))],
  ])('fail-open: %s → sin avisos, sin lanzar y el log solo lleva el motivo', async (_name, setup) => {
    setup();
    await expect(findCrossChannelDuplicates({ personId: 11, channel: 'web', now: NOW })).resolves.toEqual([]);
    const warned = vi.mocked(console.warn).mock.calls.flat().map(String).join('\n');
    expect(warned).toMatch(/cross_channel_lookup_failed/);
  });

  it('la persona sin negocios abiertos (data: null) o un personId inválido: sin avisos', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue(ok(null));
    await expect(findCrossChannelDuplicates({ personId: 11, channel: 'web', now: NOW })).resolves.toEqual([]);
    vi.mocked(pipedriveGet).mockClear();
    await expect(findCrossChannelDuplicates({ personId: 0, channel: 'web', now: NOW })).resolves.toEqual([]);
    expect(pipedriveGet).not.toHaveBeenCalled();
  });

  it('duplicateItem: el texto del aviso', () => {
    expect(duplicateItem(77, 'web', Date.parse('2026-11-13T12:00:00Z'))).toBe('Posible duplicado: revisar el negocio #77 (web, 13-11-2026)');
  });
});
