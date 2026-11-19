// api/_tests/pipedrive-webhook.test.ts
// Webhook de Pipedrive (N-05): Basic Auth, cuerpos v1 y v2, filtros (masivo, compañía, entidad,
// acción, embudo), etapa y estado por separado, la respuesta 200 inmediata (lo demás va en
// waitUntil) y la detección del disparador del aviso de despacho (spec Nivel 2, §3 paso 3), que
// llama a processShippingNotice (simulado aquí; el aviso completo se prueba en
// shipping-notice.test.ts). Pipedrive está simulado (solo /dealFields); cuerpos inventados, sin
// datos reales. Vive en api/_tests/ para que Vercel no lo despliegue como función.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// waitUntil guarda la promesa: call() la espera, como Vercel mantiene viva la función.
const { pending } = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => { pending.push(p); }) }));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedriveGet: vi.fn() }));
vi.mock('../_lib/shipping/notice.js', () => ({ processShippingNotice: vi.fn(async () => 'simulado') }));

import handler, { FIELD_LOOKUP_TIMEOUT_MS, SHIPPING_TRIGGER_FIELD_NAME } from '../pipedrive/webhook';
import { pipedriveGet } from '../_lib/pipedrive/client.js';
import { resetFieldOptionsCache } from '../_lib/pipedrive/fieldOptions.js';
import { SHIPPING_FIELD_NAMES } from '../_lib/shipping/fields.js';
import { processShippingNotice } from '../_lib/shipping/notice.js';
import { waitUntil } from '@vercel/functions';

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

/** Espera lo que quedó en waitUntil (también lo que se registre mientras tanto). */
async function flush(): Promise<void> {
  while (pending.length) await Promise.all(pending.splice(0));
}

/** `hecho=` de la última línea de evento. */
function lastDone(): string | null {
  const line = [...logs].reverse().find((l) => l.startsWith('[pipedrive/webhook] evento '));
  return line ? (/ hecho=(\S+)/.exec(line)?.[1] ?? null) : null;
}

function newRes() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    /** `hecho=` del evento, después de esperar el segundo plano. */
    done: null as string | null,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
}

async function call(body: unknown, opts: { method?: string; auth?: string | null } = {}) {
  const res = newRes();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const auth = opts.auth === undefined ? AUTH : opts.auth;
  if (auth !== null) headers.authorization = auth;
  const req = { method: opts.method ?? 'POST', headers, body };
  const before = logs.length;
  await handler(req as never, res as never);
  await flush();
  res.done = logs.length > before ? lastDone() : null;
  return res;
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
  pending.length = 0;
  vi.mocked(waitUntil).mockReset().mockImplementation((p: Promise<unknown>) => { pending.push(p); });
  vi.mocked(processShippingNotice).mockReset().mockResolvedValue('simulado');
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
    expect(vi.mocked(processShippingNotice)).not.toHaveBeenCalled();
  });

  it('con las credenciales correctas responde 200', async () => {
    expect((await call(v2())).statusCode).toBe(200);
  });

  // Hallazgo 4 de la auditoría de Codex (#196): timingSafeEqual exige el mismo largo en bytes. Con
  // una «é» el largo en caracteres coincidía y el handler rechazaba su promesa sin responder.
  it('una cabecera del mismo largo en caracteres pero no en bytes («é») responde 401 sin lanzar', async () => {
    const tampered = AUTH.slice(0, -2) + 'é' + AUTH.slice(-1);
    expect(tampered.length).toBe(AUTH.length);
    expect(Buffer.byteLength(tampered)).not.toBe(Buffer.byteLength(AUTH));
    const res = await call(triggerChosen(), { auth: tampered });
    expect(res.statusCode).toBe(401);
  });

  it('una cabecera que no es texto (lista) o sin cabeceras responde 401 sin lanzar', async () => {
    const res = { statusCode: 0, status(code: number) { this.statusCode = code; return this; }, json() { return this; } };
    await handler({ method: 'POST', headers: { authorization: [AUTH, AUTH] }, body: v2() } as never, res as never);
    expect(res.statusCode).toBe(401);
    await handler({ method: 'POST', body: v2() } as never, res as never);
    expect(res.statusCode).toBe(401);
  });

  it('con usuario y clave con tildes, la cabecera correcta pasa y otra del mismo largo no', async () => {
    vi.stubEnv('PIPEDRIVE_WEBHOOK_USER', 'usuário');
    vi.stubEnv('PIPEDRIVE_WEBHOOK_PASSWORD', 'contraseña');
    const good = 'Basic ' + Buffer.from('usuário:contraseña', 'utf8').toString('base64');
    expect((await call(v2(), { auth: good })).statusCode).toBe(200);
    expect((await call(v2(), { auth: good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A') })).statusCode).toBe(401);
  });
});

describe('200 de inmediato; lo demás en waitUntil (spec §3 paso 3)', () => {
  it('con la caché de /dealFields vacía y Pipedrive sin responder, el 200 sale antes de procesar', async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(pipedriveGet).mockImplementation(() => new Promise((resolve) => { answer = resolve; }) as never);
    const res = newRes();
    await handler({ method: 'POST', headers: { authorization: AUTH }, body: triggerChosen() } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(vi.mocked(waitUntil)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processShippingNotice)).not.toHaveBeenCalled();
    expect(lastDone()).toBeNull();
    // Pipedrive responde después: el aviso sigue en segundo plano.
    answer({ success: true, data: DEAL_FIELDS });
    await flush();
    expect(vi.mocked(processShippingNotice)).toHaveBeenCalledTimes(1);
    expect(lastDone()).toBe('sin_cambio_de_etapa_ni_estado');
  });

  it('el cuerpo de la respuesta es siempre { success: true }, también lo que se ignora', async () => {
    for (const body of [v2({ previous: { stage_id: 10 } }), v2({ meta: { is_bulk_edit: true } }), undefined]) {
      const res = await call(body);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true });
    }
  });

  it('sin Basic Auth válido no queda nada en segundo plano', async () => {
    await call(triggerChosen(), { auth: 'Bearer abc' });
    await call(undefined, { method: 'GET' });
    expect(vi.mocked(waitUntil)).not.toHaveBeenCalled();
  });

  it('si el aviso lanza, el segundo plano no rechaza y el error se registra sin detalles', async () => {
    vi.mocked(processShippingNotice).mockRejectedValue(new Error('falla con juana.prueba@example.com'));
    const res = await call(triggerChosen());
    expect(res.statusCode).toBe(200);
    expect(allLogs()).toContain('[pipedrive/webhook] Error processing webhook:');
    expect(allLogs()).not.toContain('juana.prueba@example.com');
  });

  it('el nombre del disparador es el de fields.ts', () => {
    expect(SHIPPING_TRIGGER_FIELD_NAME).toBe(SHIPPING_FIELD_NAMES.trigger);
  });
});

describe('cuerpos v2 (los que manda hoy el webhook configurado)', () => {
  it('cambio de etapa: se registra (antes se ignoraba como «undefined event»)', async () => {
    const res = await call(v2({ previous: { stage_id: 10 } }));
    expect(res.statusCode).toBe(200);
    expect(res.done).toBe('etapa(10->11)');
    expect(allLogs()).toContain('[pipedrive/webhook] evento version=v2 entidad=deal accion=change negocio=501 origen=app masivo=no intento=1 hecho=etapa(10->11)');
    expect(allLogs()).not.toContain('undefined');
  });

  it('cambio de estado: ganado y perdido', async () => {
    const won = await call(v2({ data: { status: 'won' }, previous: { status: 'open' } }));
    expect(won.done).toBe('ganado(open->won)');
    const lost = await call(v2({ data: { status: 'lost' }, previous: { status: 'open' } }));
    expect(lost.done).toBe('perdido(open->lost)');
  });

  it('estado y etapa en el mismo evento: se tratan los dos (antes, solo el estado)', async () => {
    const res = await call(v2({ data: { status: 'won' }, previous: { status: 'open', stage_id: 10 } }));
    expect(res.done).toBe('ganado(open->won),etapa(10->11)');
  });

  it('otro cambio (sin etapa ni estado) responde 200 y no consulta Pipedrive', async () => {
    const res = await call(v2({ previous: { title: 'PRUEBA anterior' } }));
    expect(res.done).toBe('sin_cambio_de_etapa_ni_estado');
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
  });

  it('negocio de otro embudo: no registra etapa ni estado', async () => {
    const res = await call(v2({ data: { pipeline_id: 1 }, previous: { stage_id: 3 } }));
    expect(res.statusCode).toBe(200);
    expect(res.done).toBe('otro_embudo');
  });
});

describe('cuerpos v1', () => {
  it('cambio de etapa y de estado, por separado', async () => {
    const stage = await call(v1({ stage_id: 12 }, { stage_id: 11 }));
    expect(stage.done).toBe('etapa(11->12)');
    const both = await call(v1({ stage_id: 12, status: 'won' }, { stage_id: 11, status: 'open' }));
    expect(both.done).toBe('ganado(open->won),etapa(11->12)');
    expect(allLogs()).toContain('evento version=v1 entidad=deal accion=change negocio=501 origen=app masivo=no intento=1');
  });

  it('negocio de otro embudo: no registra etapa ni estado', async () => {
    const res = await call(v1({ pipeline_id: 1, stage_id: 3 }, { pipeline_id: 1, stage_id: 2 }));
    expect(res.done).toBe('otro_embudo');
  });
});

describe('lo que se descarta (siempre con 200, para que Pipedrive no reintente ni borre el webhook)', () => {
  const ignored = (reason: string) => `ignorado(${reason})`;

  it('ediciones masivas: v2 is_bulk_edit y v1 is_bulk_update, sin consultar Pipedrive', async () => {
    const a = await call(triggerChosen({ is_bulk_edit: true }));
    expect(a.statusCode).toBe(200);
    expect(a.done).toBe(ignored('masivo'));
    const b = await call(v1({ stage_id: 12, [TRIGGER]: '71' }, { stage_id: 11, [TRIGGER]: null }, { is_bulk_update: true }));
    expect(b.done).toBe(ignored('masivo'));
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
    expect(vi.mocked(processShippingNotice)).not.toHaveBeenCalled();
    expect(allLogs()).toContain('masivo=si intento=1 hecho=ignorado(masivo)');
  });

  it('otra compañía, solo si PIPEDRIVE_COMPANY_ID está definida', async () => {
    vi.stubEnv('PIPEDRIVE_COMPANY_ID', COMPANY);
    expect((await call(triggerChosen({ company_id: '999999' }))).done).toBe(ignored('otra_compania'));
    expect((await call(v1({}, {}, { company_id: 999999 }))).done).toBe(ignored('otra_compania'));
    const noCompany = triggerChosen();
    delete (noCompany.meta as Record<string, unknown>).company_id;
    expect((await call(noCompany)).done).toBe(ignored('otra_compania'));
    expect(vi.mocked(processShippingNotice)).not.toHaveBeenCalled();
    // La misma compañía pasa, en v2 (texto) y en v1 (número).
    expect((await call(v2({ previous: { stage_id: 10 } }))).done).toBe('etapa(10->11)');
    expect((await call(v1({ stage_id: 12 }, { stage_id: 11 }))).done).toBe('etapa(11->12)');
    // Sin la variable, no se filtra por compañía.
    vi.stubEnv('PIPEDRIVE_COMPANY_ID', '');
    expect((await call(v2({ meta: { company_id: '999999' }, previous: { stage_id: 10 } }))).done).toBe('etapa(10->11)');
  });

  it('otra entidad (persona, actividad) en v2 y en v1', async () => {
    expect((await call(v2({ meta: { entity: 'person' } }))).done).toBe(ignored('entidad'));
    expect((await call(v1({}, {}, { object: 'activity' }))).done).toBe(ignored('entidad'));
    expect(vi.mocked(pipedriveGet)).not.toHaveBeenCalled();
  });

  it('negocio creado o borrado (no es una actualización)', async () => {
    expect((await call(v2({ meta: { action: 'create' } }))).done).toBe(ignored('accion'));
    expect((await call(v2({ meta: { action: 'delete' } }))).done).toBe(ignored('accion'));
    expect((await call(v1({}, null, { action: 'added' }))).done).toBe(ignored('accion'));
    expect((await call(v1({}, {}, { action: 'deleted' }))).done).toBe(ignored('accion'));
  });

  it('un cuerpo que no se reconoce no rompe (antes, un cuerpo sin meta daba 500)', async () => {
    for (const body of [undefined, null, 'no es json', {}, { meta: {} }]) {
      const res = await call(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(200);
      expect(res.done).toBe(ignored('formato_desconocido'));
    }
    expect(allLogs()).toContain('evento version=desconocida');
  });

  // Hallazgo 2 de la auditoría de Codex (#196): este cuerpo daba 500.
  it('JSON válido con tipos raros (acción {"toString":null}) responde 200 y se ignora', async () => {
    const res = await call(JSON.parse('{"meta":{"entity":"deal","action":{"toString":null}}}'));
    expect(res.statusCode).toBe(200);
    expect(res.done).toBe(ignored('accion'));
    const asText = await call('{"meta":{"object":"deal","action":{"toString":null}},"current":{"id":{"toString":null}}}');
    expect(asText.statusCode).toBe(200);
    expect(asText.done).toBe(ignored('accion'));
  });

  it('si leer req.body lanza (JSON inválido en Vercel), responde 200 y se ignora', async () => {
    const res = newRes();
    const req = { method: 'POST', headers: { authorization: AUTH }, get body(): unknown { throw new Error('Invalid JSON'); } };
    await handler(req as never, res as never);
    await flush();
    expect(res.statusCode).toBe(200);
    expect(lastDone()).toBe(ignored('formato_desconocido'));
  });
});

describe('aviso de despacho: el disparador llama a processShippingNotice', () => {
  const fired = (optionId = 71) => expect(vi.mocked(processShippingNotice)).toHaveBeenCalledWith({
    dealId: 501, triggerKey: TRIGGER, triggerOptionId: optionId, startedAt: expect.any(Number),
  });
  const notFired = () => expect(vi.mocked(processShippingNotice)).not.toHaveBeenCalled();

  it('v2: «Despacho · Aviso» elegido en este evento: aviso con la clave, la opción y la hora de llegada', async () => {
    const before = Date.now();
    const res = await call(triggerChosen());
    expect(res.statusCode).toBe(200);
    expect(res.done).toBe('sin_cambio_de_etapa_ni_estado');
    fired();
    const { startedAt } = vi.mocked(processShippingNotice).mock.calls[0][0];
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(Date.now());
    expect(allLogs()).toContain('aviso=disparador');
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledWith('/dealFields', { limit: '500' }, FIELD_LOOKUP_TIMEOUT_MS);
  });

  it('v2: con change_source "api" también se registra (no se filtra por origen)', async () => {
    await call(triggerChosen({ change_source: 'api' }));
    fired();
    expect(allLogs()).toContain('origen=api');
  });

  it('antes del filtro de embudo: un negocio del embudo 1 también llega al aviso', async () => {
    const body = triggerChosen();
    body.data.pipeline_id = 1;
    const res = await call(body);
    expect(res.done).toBe('otro_embudo');
    fired();
  });

  it('v2: vaciado (previous con el valor, data en null) no se activa', async () => {
    await call(v2({ data: { custom_fields: { [TRIGGER]: null } }, previous: { custom_fields: { [TRIGGER]: { type: 'enum', id: 71 } } } }));
    notFired();
    expect(allLogs()).toContain('aviso=vaciado');
  });

  it('v2: ya puesto y se edita otro campo: no se activa', async () => {
    await call(v2({
      data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 72 }, [OTHER]: { type: 'varchar', value: 'Calle Falsa 456' } } },
      previous: { custom_fields: { [OTHER]: { type: 'varchar', value: 'Calle Falsa 123' } } },
    }));
    notFired();
    expect(allLogs()).toContain('aviso=sin_cambio');
  });

  it('v1: elegido llega al aviso; ya puesto con otro campo editado y vaciado, no', async () => {
    await call(v1({ [TRIGGER]: '71' }, { [TRIGGER]: null }));
    fired();
    vi.mocked(processShippingNotice).mockClear();
    logs.length = 0;
    await call(v1({ [TRIGGER]: '72', [OTHER]: 'Calle Falsa 456' }, { [TRIGGER]: '72', [OTHER]: 'Calle Falsa 123' }));
    notFired();
    expect(allLogs()).toContain('aviso=sin_cambio');
    logs.length = 0;
    await call(v1({ [TRIGGER]: null }, { [TRIGGER]: '72' }));
    notFired();
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
    expect(vi.mocked(processShippingNotice)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(1);
  });

  // Pipedrive no reintenta un evento que recibió 200: la selección de ese evento se pierde. El segundo
  // cuerpo es el del dueño que vacía el disparador y lo vuelve a elegir (la señal de la spec §3: «si el
  // disparador no se vació en 2 minutos, el aviso no se procesó»).
  it('si /dealFields falla, responde 200 sin revisar el disparador; al volver a elegirlo, se detecta', async () => {
    vi.mocked(pipedriveGet)
      .mockResolvedValueOnce({ success: false, data: null, error: 'Request timeout' } as never)
      .mockResolvedValue({ success: true, data: DEAL_FIELDS } as never);
    const first = await call(triggerChosen());
    expect(first.statusCode).toBe(200);
    expect(allLogs()).toContain('aviso=campos_no_disponibles');
    notFired();
    await call(triggerChosen());
    fired();
    expect(vi.mocked(pipedriveGet)).toHaveBeenCalledTimes(2);
  });

  it('límite conocido: si después solo se edita otro campo, la selección perdida no se recupera', async () => {
    vi.mocked(pipedriveGet)
      .mockResolvedValueOnce({ success: false, data: null, error: 'Request timeout' } as never)
      .mockResolvedValue({ success: true, data: DEAL_FIELDS } as never);
    await call(triggerChosen());
    await call(v2({
      data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 71 }, [OTHER]: { type: 'varchar', value: 'Calle Falsa 456' } } },
      previous: { custom_fields: { [OTHER]: { type: 'varchar', value: 'Calle Falsa 123' } } },
    }));
    notFired();
    expect(allLogs()).toContain('aviso=sin_cambio');
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
    notFired();
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
