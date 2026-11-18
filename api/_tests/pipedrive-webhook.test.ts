// api/_tests/pipedrive-webhook.test.ts
// Webhook de Pipedrive (N-05): Basic Auth, cuerpos v1 y v2, filtros (masivo, compañía, entidad,
// acción, embudo), etapa y estado por separado, y la detección del disparador del aviso de despacho
// (spec Nivel 2, §3 paso 3), que por ahora solo se registra. Pipedrive está simulado (solo
// /dealFields); cuerpos inventados, sin datos reales. Vive en api/_tests/ para que Vercel no lo
// despliegue como función.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/pipedrive/client.js', () => ({ pipedriveGet: vi.fn() }));

import handler, { FIELD_LOOKUP_TIMEOUT_MS, SHIPPING_TRIGGER_FIELD_NAME } from '../pipedrive/webhook';
import { pipedriveGet } from '../_lib/pipedrive/client.js';
import { resetFieldOptionsCache } from '../_lib/pipedrive/fieldOptions.js';

const USER = 'usuario-prueba';
const PASSWORD = 'clave-prueba';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
const TRIGGER = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const PIPELINE = 2;
const COMPANY = '777001';
// Datos de cliente ficticios: nunca deben llegar a los registros.
const PERSONAL = ['Juana Pérez', 'juana.prueba@example.com', '+56 9 1111 2222', '123456', 'Calle Falsa'];

const DEAL_FIELDS = [
  { key: TRIGGER, name: SHIPPING_TRIGGER_FIELD_NAME, field_type: 'enum', options: [{ id: 71, label: 'Vista previa' }, { id: 72, label: 'Enviar al cliente' }] },
  { key: OTHER, name: 'Despacho · Orden de flete', field_type: 'varchar' },
];

function call(body: unknown, opts: { method?: string; auth?: string | null } = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const auth = opts.auth === undefined ? AUTH : opts.auth;
  if (auth !== null) headers.authorization = auth;
  const req = { method: opts.method ?? 'POST', headers, body };
  return handler(req as never, res as never).then(() => res);
}

function v2(overrides: { meta?: Record<string, unknown>; data?: Record<string, unknown>; previous?: Record<string, unknown> } = {}) {
  return {
    meta: {
      action: 'change', entity: 'deal', entity_id: '501', company_id: COMPANY, user_id: '9001',
      id: '00000000-0000-4000-8000-000000000001', is_bulk_edit: false, version: '2.0',
      change_source: 'app', attempt: 1, timestamp: '2026-11-18T12:00:00.000Z',
      ...overrides.meta,
    },
    data: {
      id: 501, title: 'PRUEBA Juana Pérez', status: 'open', stage_id: 11, pipeline_id: PIPELINE,
      person_id: { id: 61, name: 'Juana Pérez', email: [{ value: 'juana.prueba@example.com' }] },
      value: 123456, currency: 'CLP',
      custom_fields: { [OTHER]: { type: 'varchar', value: 'Calle Falsa 123' } },
      ...overrides.data,
    },
    previous: overrides.previous ?? {},
  };
}

function v1(current: Record<string, unknown>, previous: Record<string, unknown> | null, meta: Record<string, unknown> = {}) {
  const base = { id: 501, title: 'PRUEBA Juana Pérez', status: 'open', stage_id: 11, pipeline_id: PIPELINE, person_name: 'Juana Pérez', value: 123456, [OTHER]: 'Calle Falsa 123' };
  return {
    v: 1, event: 'updated.deal', retry: 0,
    current: { ...base, ...current },
    previous: previous === null ? null : { ...base, ...previous },
    meta: { action: 'updated', object: 'deal', id: 501, company_id: Number(COMPANY), user_id: 9001, change_source: 'app', is_bulk_update: false, ...meta },
  };
}

/** Lo que el disparador recibe al elegirse en v2. */
const triggerChosen = (meta: Record<string, unknown> = {}) => v2({
  meta,
  data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 71 } } },
  previous: { custom_fields: { [TRIGGER]: null } },
});

let logs: string[];

function allLogs(): string {
  return logs.join('\n');
}

beforeEach(() => {
  resetFieldOptionsCache();
  vi.mocked(pipedriveGet).mockReset();
  vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: DEAL_FIELDS } as never);
  vi.stubEnv('PIPEDRIVE_WEBHOOK_USER', USER);
  vi.stubEnv('PIPEDRIVE_WEBHOOK_PASSWORD', PASSWORD);
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', String(PIPELINE));
  vi.stubEnv('PIPEDRIVE_COMPANY_ID', '');
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('método y Basic Auth', () => {
  it('GET responde 405', async () => {
    expect((await call(undefined, { method: 'GET' })).statusCode).toBe(405);
  });

  it('sin las credenciales configuradas responde 500', async () => {
    vi.stubEnv('PIPEDRIVE_WEBHOOK_PASSWORD', '');
    const res = await call(v2());
    expect(res.statusCode).toBe(500);
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
  });

  it('sin cabecera, con otro esquema o con otra clave responde 401', async () => {
    for (const auth of [null, 'Bearer abc', 'Basic ' + Buffer.from(`${USER}:otra-clave`).toString('base64'), 'Basic ' + Buffer.from(`${USER}:${PASSWORD}x`).toString('base64')]) {
      const res = await call(triggerChosen(), { auth });
      expect(res.statusCode, String(auth)).toBe(401);
    }
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
    expect(allLogs()).not.toContain('aviso de despacho');
  });

  it('con las credenciales correctas responde 200', async () => {
    expect((await call(v2())).statusCode).toBe(200);
  });
});

describe('cuerpos v2 (los que manda hoy el webhook configurado)', () => {
  it('cambio de etapa: se registra (antes se ignoraba como «undefined event»)', async () => {
    const res = await call(v2({ previous: { stage_id: 10 } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, dealId: 501, actions: ['etapa(10->11)'] });
    expect(allLogs()).toContain('[pipedrive/webhook] evento version=v2 entidad=deal accion=change negocio=501 origen=app masivo=no intento=1 hecho=etapa(10->11)');
    expect(allLogs()).not.toContain('undefined');
  });

  it('cambio de estado: ganado y perdido', async () => {
    const won = await call(v2({ data: { status: 'won' }, previous: { status: 'open' } }));
    expect(won.body).toMatchObject({ actions: ['ganado(open->won)'] });
    const lost = await call(v2({ data: { status: 'lost' }, previous: { status: 'open' } }));
    expect(lost.body).toMatchObject({ actions: ['perdido(open->lost)'] });
  });

  it('estado y etapa en el mismo evento: se tratan los dos (antes, solo el estado)', async () => {
    const res = await call(v2({ data: { status: 'won' }, previous: { status: 'open', stage_id: 10 } }));
    expect(res.body).toMatchObject({ actions: ['ganado(open->won)', 'etapa(10->11)'] });
  });

  it('otro cambio (sin etapa ni estado) responde 200 y no consulta Pipedrive', async () => {
    const res = await call(v2({ previous: { title: 'PRUEBA anterior' } }));
    expect(res.body).toMatchObject({ actions: ['sin_cambio_de_etapa_ni_estado'] });
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
  });

  it('negocio de otro embudo: no registra etapa ni estado', async () => {
    const res = await call(v2({ data: { pipeline_id: 1 }, previous: { stage_id: 3 } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ actions: ['otro_embudo'] });
  });
});

describe('cuerpos v1', () => {
  it('cambio de etapa y de estado, por separado', async () => {
    const stage = await call(v1({ stage_id: 12 }, { stage_id: 11 }));
    expect(stage.body).toEqual({ success: true, dealId: 501, actions: ['etapa(11->12)'] });
    const both = await call(v1({ stage_id: 12, status: 'won' }, { stage_id: 11, status: 'open' }));
    expect(both.body).toMatchObject({ actions: ['ganado(open->won)', 'etapa(11->12)'] });
    expect(allLogs()).toContain('evento version=v1 entidad=deal accion=change negocio=501 origen=app masivo=no intento=1');
  });

  it('negocio de otro embudo: no registra etapa ni estado', async () => {
    const res = await call(v1({ pipeline_id: 1, stage_id: 3 }, { pipeline_id: 1, stage_id: 2 }));
    expect(res.body).toMatchObject({ actions: ['otro_embudo'] });
  });
});

describe('lo que se descarta (siempre con 200, para que Pipedrive no reintente ni borre el webhook)', () => {
  const ignored = (reason: string) => ({ success: true, action: 'ignored', reason });

  it('ediciones masivas: v2 is_bulk_edit y v1 is_bulk_update, sin consultar Pipedrive', async () => {
    const a = await call(triggerChosen({ is_bulk_edit: true }));
    expect(a.statusCode).toBe(200);
    expect(a.body).toEqual(ignored('masivo'));
    const b = await call(v1({ stage_id: 12, [TRIGGER]: '71' }, { stage_id: 11, [TRIGGER]: null }, { is_bulk_update: true }));
    expect(b.body).toEqual(ignored('masivo'));
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
    expect(allLogs()).not.toContain('aviso de despacho');
    expect(allLogs()).toContain('masivo=si intento=1 hecho=ignorado(masivo)');
  });

  it('otra compañía, solo si PIPEDRIVE_COMPANY_ID está definida', async () => {
    vi.stubEnv('PIPEDRIVE_COMPANY_ID', COMPANY);
    expect((await call(triggerChosen({ company_id: '999999' }))).body).toEqual(ignored('otra_compania'));
    expect((await call(v1({}, {}, { company_id: 999999 }))).body).toEqual(ignored('otra_compania'));
    const noCompany = triggerChosen();
    delete (noCompany.meta as Record<string, unknown>).company_id;
    expect((await call(noCompany)).body).toEqual(ignored('otra_compania'));
    expect(allLogs()).not.toContain('aviso de despacho');
    // La misma compañía pasa, en v2 (texto) y en v1 (número).
    expect((await call(v2({ previous: { stage_id: 10 } }))).body).toMatchObject({ actions: ['etapa(10->11)'] });
    expect((await call(v1({ stage_id: 12 }, { stage_id: 11 }))).body).toMatchObject({ actions: ['etapa(11->12)'] });
    // Sin la variable, no se filtra por compañía.
    vi.stubEnv('PIPEDRIVE_COMPANY_ID', '');
    expect((await call(v2({ meta: { company_id: '999999' }, previous: { stage_id: 10 } }))).body).toMatchObject({ actions: ['etapa(10->11)'] });
  });

  it('otra entidad (persona, actividad) en v2 y en v1', async () => {
    expect((await call(v2({ meta: { entity: 'person' } }))).body).toEqual(ignored('entidad'));
    expect((await call(v1({}, {}, { object: 'activity' }))).body).toEqual(ignored('entidad'));
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
  });

  it('negocio creado o borrado (no es una actualización)', async () => {
    expect((await call(v2({ meta: { action: 'create' } }))).body).toEqual(ignored('accion'));
    expect((await call(v2({ meta: { action: 'delete' } }))).body).toEqual(ignored('accion'));
    expect((await call(v1({}, null, { action: 'added' }))).body).toEqual(ignored('accion'));
    expect((await call(v1({}, {}, { action: 'deleted' }))).body).toEqual(ignored('accion'));
  });

  it('un cuerpo que no se reconoce no rompe (antes, un cuerpo sin meta daba 500)', async () => {
    for (const body of [undefined, null, 'no es json', {}, { meta: {} }]) {
      const res = await call(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(200);
      expect(res.body).toEqual(ignored('formato_desconocido'));
    }
    expect(allLogs()).toContain('evento version=desconocida');
  });
});

describe('aviso de despacho: el disparador (todavía sin envío)', () => {
  const FIRED = '[pipedrive/webhook] aviso de despacho: disparador en negocio 501 (todavía sin envío)';

  it('v2: «Despacho · Aviso» elegido en este evento se registra, y responde igual', async () => {
    const res = await call(triggerChosen());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, dealId: 501, actions: ['sin_cambio_de_etapa_ni_estado'] });
    expect(logs).toContain(FIRED);
    expect(allLogs()).toContain('aviso=disparador');
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledWith('/dealFields', { limit: '500' }, FIELD_LOOKUP_TIMEOUT_MS);
  });

  it('v2: con change_source "api" también se registra (no se filtra por origen)', async () => {
    await call(triggerChosen({ change_source: 'api' }));
    expect(logs).toContain(FIRED);
    expect(allLogs()).toContain('origen=api');
  });

  it('antes del filtro de embudo: un negocio del embudo 1 también se registra', async () => {
    const body = triggerChosen();
    body.data.pipeline_id = 1;
    const res = await call(body);
    expect(res.body).toMatchObject({ actions: ['otro_embudo'] });
    expect(logs).toContain(FIRED);
  });

  it('v2: vaciado (previous con el valor, data en null) no se activa', async () => {
    await call(v2({ data: { custom_fields: { [TRIGGER]: null } }, previous: { custom_fields: { [TRIGGER]: { type: 'enum', id: 71 } } } }));
    expect(allLogs()).not.toContain('aviso de despacho');
    expect(allLogs()).toContain('aviso=vaciado');
  });

  it('v2: ya puesto y se edita otro campo: no se activa', async () => {
    await call(v2({
      data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 72 }, [OTHER]: { type: 'varchar', value: 'Calle Falsa 456' } } },
      previous: { custom_fields: { [OTHER]: { type: 'varchar', value: 'Calle Falsa 123' } } },
    }));
    expect(allLogs()).not.toContain('aviso de despacho');
    expect(allLogs()).toContain('aviso=sin_cambio');
  });

  it('v1: elegido se registra; ya puesto con otro campo editado y vaciado, no', async () => {
    await call(v1({ [TRIGGER]: '71' }, { [TRIGGER]: null }));
    expect(logs).toContain(FIRED);
    logs.length = 0;
    await call(v1({ [TRIGGER]: '72', [OTHER]: 'Calle Falsa 456' }, { [TRIGGER]: '72', [OTHER]: 'Calle Falsa 123' }));
    expect(allLogs()).not.toContain('aviso de despacho');
    expect(allLogs()).toContain('aviso=sin_cambio');
    logs.length = 0;
    await call(v1({ [TRIGGER]: null }, { [TRIGGER]: '72' }));
    expect(allLogs()).not.toContain('aviso de despacho');
    expect(allLogs()).toContain('aviso=vaciado');
  });

  it('sin cambios en campos personalizados no consulta /dealFields', async () => {
    await call(v2({ previous: { stage_id: 10 } }));
    await call(v1({ stage_id: 12 }, { stage_id: 11 }));
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
  });

  it('/dealFields en caché: un segundo evento no vuelve a consultar', async () => {
    await call(triggerChosen());
    await call(triggerChosen());
    expect(logs.filter((l) => l === FIRED)).toHaveLength(2);
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(1);
  });

  it('si /dealFields falla, responde 200 sin revisar el disparador y reintenta con el evento siguiente', async () => {
    vi.mocked(pipedriveGet)
      .mockResolvedValueOnce({ success: false, data: null, error: 'Request timeout' } as never)
      .mockResolvedValue({ success: true, data: DEAL_FIELDS } as never);
    const first = await call(triggerChosen());
    expect(first.statusCode).toBe(200);
    expect(allLogs()).toContain('aviso=campos_no_disponibles');
    expect(allLogs()).not.toContain('aviso de despacho');
    await call(triggerChosen());
    expect(logs).toContain(FIRED);
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(2);
  });

  it('si /dealFields lanza (p. ej., falta el token), responde 200', async () => {
    vi.mocked(pipedriveGet).mockRejectedValue(new Error('[Pipedrive] PIPEDRIVE_API_TOKEN is not set'));
    const res = await call(triggerChosen());
    expect(res.statusCode).toBe(200);
    expect(allLogs()).toContain('aviso=campos_no_disponibles');
  });

  it('sin el campo en Pipedrive, o si no es de opción única, no se activa', async () => {
    vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: [DEAL_FIELDS[1]] } as never);
    await call(triggerChosen());
    expect(allLogs()).toContain('aviso=campo_no_existe');
    resetFieldOptionsCache();
    vi.mocked(pipedriveGet).mockResolvedValue({ success: true, data: [{ ...DEAL_FIELDS[0], field_type: 'varchar' }] } as never);
    await call(triggerChosen());
    expect(allLogs()).toContain('aviso=campo_no_es_opcion');
    expect(allLogs()).not.toContain('aviso de despacho');
  });
});

describe('registros: solo metadatos', () => {
  it('una línea por evento, sin título, persona, correo, teléfono, monto ni valores de campos', async () => {
    const bodies: unknown[] = [
      triggerChosen(),
      v2({ data: { status: 'won' }, previous: { status: 'open', stage_id: 10 } }),
      v2({ meta: { is_bulk_edit: true } }),
      v2({ meta: { entity: 'person' }, data: { name: 'Juana Pérez', phone: [{ value: '+56 9 1111 2222' }] } }),
      v1({ [TRIGGER]: '71', stage_id: 12 }, { [TRIGGER]: null, stage_id: 11 }),
    ];
    for (const body of bodies) await call(body);
    const eventLines = logs.filter((l) => l.startsWith('[pipedrive/webhook] evento '));
    expect(eventLines).toHaveLength(bodies.length);
    const text = allLogs();
    for (const secret of [...PERSONAL, 'PRUEBA', 'CLP', 'Vista previa', TRIGGER, OTHER]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
