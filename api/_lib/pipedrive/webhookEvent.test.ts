// api/_lib/pipedrive/webhookEvent.test.ts
// Normalización de los cuerpos v1 y v2 del webhook de Pipedrive y la regla del disparador del aviso
// de despacho (spec Nivel 2, §3 paso 3). Cuerpos inventados con la forma de la guía de webhooks v2 y
// su guía de migración: sin datos reales (claves hash, ids y nombres de prueba).

import { describe, expect, it } from 'vitest';
import { normalizeWebhookBody, optionFieldSetInEvent } from './webhookEvent.js';

const TRIGGER = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

function v2(overrides: { meta?: Record<string, unknown>; data?: Record<string, unknown> | null; previous?: Record<string, unknown> | null } = {}) {
  return {
    meta: {
      action: 'change',
      entity: 'deal',
      entity_id: '501',
      company_id: '777001',
      user_id: '9001',
      id: '00000000-0000-4000-8000-000000000001',
      correlation_id: '00000000-0000-4000-8000-000000000002',
      is_bulk_edit: false,
      timestamp: '2026-11-18T12:00:00.000Z',
      type: 'general',
      version: '2.0',
      webhook_id: '42',
      webhook_owner_id: '9001',
      change_source: 'app',
      attempt: 1,
      host: 'prueba.pipedrive.com',
      ...overrides.meta,
    },
    data: overrides.data === null ? null : {
      id: 501,
      title: 'PRUEBA Juana Pérez',
      status: 'open',
      stage_id: 11,
      pipeline_id: 2,
      person_id: 61,
      value: 123456,
      currency: 'CLP',
      custom_fields: {},
      ...overrides.data,
    },
    previous: overrides.previous === undefined ? {} : overrides.previous,
  };
}

function v1(current: Record<string, unknown> | null, previous: Record<string, unknown> | null, meta: Record<string, unknown> = {}) {
  const base = { id: 501, title: 'PRUEBA Juana Pérez', status: 'open', stage_id: 11, pipeline_id: 2, person_id: 61, value: 123456, currency: 'CLP' };
  return {
    v: 1,
    event: 'updated.deal',
    retry: 0,
    current: current === null ? null : { ...base, ...current },
    previous: previous === null ? null : { ...base, ...previous },
    meta: { action: 'updated', object: 'deal', id: 501, company_id: 777001, user_id: 9001, change_source: 'app', is_bulk_update: false, ...meta },
  };
}

describe('normalizeWebhookBody: v2', () => {
  it('lee meta.entity, meta.entity_id (texto), change, la compañía y el intento', () => {
    const event = normalizeWebhookBody(v2());
    expect(event).toMatchObject({
      version: 'v2', entity: 'deal', action: 'change', entityId: 501, companyId: '777001',
      changeSource: 'app', isBulk: false, attempt: 1,
      current: { id: 501, stageId: 11, pipelineId: 2, status: 'open' },
      stageChange: null, statusChange: null, changedCustomFields: [],
    });
  });

  it('previous parcial: solo lo que cambió (etapa, estado o los dos)', () => {
    expect(normalizeWebhookBody(v2({ previous: { stage_id: 10, stage_change_time: '2026-11-17' } }))?.stageChange)
      .toEqual({ from: 10, to: 11 });
    const both = normalizeWebhookBody(v2({ data: { status: 'won' }, previous: { status: 'open', stage_id: 10 } }));
    expect(both?.statusChange).toEqual({ from: 'open', to: 'won' });
    expect(both?.stageChange).toEqual({ from: 10, to: 11 });
    // Sin esas claves en previous, no cambiaron (aunque data las traiga).
    const none = normalizeWebhookBody(v2({ previous: { title: 'otro' } }));
    expect(none?.stageChange).toBeNull();
    expect(none?.statusChange).toBeNull();
  });

  it('campos personalizados en data.custom_fields; opción única como { type: "enum", id }', () => {
    const event = normalizeWebhookBody(v2({
      data: { custom_fields: {
        [TRIGGER]: { type: 'enum', id: 88 },
        [OTHER]: { type: 'varchar', value: 'texto de prueba' },
        ['c'.repeat(40)]: null,
        ['d'.repeat(40)]: { type: 'set', values: [] },
      } },
      previous: { custom_fields: { [TRIGGER]: null } },
    }));
    expect(event?.customFields).toEqual({
      [TRIGGER]: { option: 88 },
      [OTHER]: { other: true },
      ['c'.repeat(40)]: null,
      ['d'.repeat(40)]: null,
    });
    expect(event?.changedCustomFields).toEqual([TRIGGER]);
  });

  it('is_bulk_edit, create/delete y otras entidades', () => {
    expect(normalizeWebhookBody(v2({ meta: { is_bulk_edit: true } }))?.isBulk).toBe(true);
    expect(normalizeWebhookBody(v2({ meta: { action: 'create' } }))?.action).toBe('create');
    expect(normalizeWebhookBody(v2({ meta: { action: 'delete' }, data: null }))).toMatchObject({ action: 'delete', current: null, entityId: 501 });
    expect(normalizeWebhookBody(v2({ meta: { entity: 'person' } }))?.entity).toBe('person');
    expect(normalizeWebhookBody(v2({ meta: { change_source: 'api' } }))?.changeSource).toBe('api');
    expect(normalizeWebhookBody(v2({ meta: { change_source: 'algo raro <x>' } }))?.changeSource).toBe('otro');
  });

  it('la forma común no guarda texto de los campos (título, montos, valores)', () => {
    const event = normalizeWebhookBody(v2({
      data: { custom_fields: { [OTHER]: { type: 'varchar', value: 'juana@example.com' } } },
      previous: { custom_fields: { [OTHER]: { type: 'varchar', value: 'otra@example.com' } }, title: 'PRUEBA Juana' },
    }));
    const text = JSON.stringify(event);
    for (const secret of ['Juana', 'example.com', '123456', 'CLP']) expect(text).not.toContain(secret);
  });
});

describe('normalizeWebhookBody: v1', () => {
  it('lee meta.object, meta.id, updated → change, is_bulk_update y retry', () => {
    const event = normalizeWebhookBody(v1({}, {}, { is_bulk_update: true }));
    expect(event).toMatchObject({
      version: 'v1', entity: 'deal', action: 'change', entityId: 501, companyId: '777001',
      changeSource: 'app', isBulk: true, attempt: 1,
    });
    expect(normalizeWebhookBody(v1({}, null, { action: 'added' }))?.action).toBe('create');
    expect(normalizeWebhookBody(v1({}, {}, { action: 'merged' }))?.action).toBe('other');
  });

  it('etapa y estado: compara current con previous completo', () => {
    const event = normalizeWebhookBody(v1({ stage_id: 12, status: 'won' }, { stage_id: 11, status: 'open' }));
    expect(event?.stageChange).toEqual({ from: 11, to: 12 });
    expect(event?.statusChange).toEqual({ from: 'open', to: 'won' });
    const same = normalizeWebhookBody(v1({}, {}));
    expect(same?.stageChange).toBeNull();
    expect(same?.statusChange).toBeNull();
  });

  it('campos personalizados: claves hash en la raíz; la opción viene como id en texto', () => {
    const event = normalizeWebhookBody(v1(
      { [TRIGGER]: '88', [OTHER]: 'texto', [`${OTHER}_currency`]: 'CLP' },
      { [TRIGGER]: null, [OTHER]: 'texto' },
    ));
    expect(event?.customFields).toEqual({ [TRIGGER]: { option: 88 }, [OTHER]: { other: true } });
    expect(event?.changedCustomFields).toEqual([TRIGGER]);
  });

  it('sin previous no hay cambios (falla cerrado)', () => {
    const event = normalizeWebhookBody(v1({ [TRIGGER]: '88' }, null));
    expect(event?.changedCustomFields).toEqual([]);
    expect(event?.stageChange).toBeNull();
  });
});

describe('normalizeWebhookBody: cuerpos que no se reconocen', () => {
  it('null, texto que no es JSON, sin meta o sin entity/object', () => {
    for (const body of [null, undefined, 'no es json', 42, [], {}, { meta: null }, { meta: { action: 'change' } }]) {
      expect(normalizeWebhookBody(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('acepta el cuerpo como texto JSON', () => {
    expect(normalizeWebhookBody(JSON.stringify(v2()))?.version).toBe('v2');
  });

  // Hallazgo 2 de la auditoría de Codex (#196): un JSON válido con tipos raros no puede hacer lanzar.
  it('nunca lanza con tipos raros: acción como objeto o nombre del prototipo, ids anidados, __proto__', () => {
    const weird: unknown[] = [
      JSON.parse('{"meta":{"entity":"deal","action":{"toString":null}}}'),
      JSON.parse('{"meta":{"object":"deal","action":{"toString":null,"valueOf":null}},"current":{},"previous":{}}'),
      { meta: { entity: 'deal', action: 'toString', entity_id: { id: { id: { id: 5 } } } }, data: { id: { toString: null } } },
      { meta: { object: 'deal', action: '__proto__', id: [1] }, current: { stage_id: { id: { id: 1 } } }, previous: null },
      JSON.parse(`{"meta":{"entity":"deal","action":"change","entity_id":"501"},"data":{"custom_fields":{"__proto__":{"type":"enum","id":1},"${TRIGGER}":{"type":"enum","id":{"toString":null}}}},"previous":{"custom_fields":{"__proto__":null,"${TRIGGER}":null}}}`),
      { meta: { entity: 'deal', action: 'change', version: { startsWith: null }, company_id: { toString: null }, change_source: { toString: null }, attempt: { valueOf: null } }, data: { status: { toString: null } }, previous: { status: [] } },
    ];
    for (const body of weird) {
      expect(() => normalizeWebhookBody(body), JSON.stringify(body)).not.toThrow();
      const event = normalizeWebhookBody(body);
      if (event) {
        expect(['create', 'change', 'delete', 'other']).toContain(event.action);
        expect(() => optionFieldSetInEvent(event, TRIGGER)).not.toThrow();
      }
    }
    expect(normalizeWebhookBody(weird[0])?.action).toBe('other');
    expect(normalizeWebhookBody(weird[2])).toMatchObject({ action: 'other', entityId: null });
    expect(normalizeWebhookBody(weird[3])?.action).toBe('other');
    // Un id de opción que no es un id: no se toma como opción.
    expect(optionFieldSetInEvent(normalizeWebhookBody(weird[4])!, TRIGGER)).toEqual({ fired: false, reason: 'no_es_opcion' });
  });

  it('nunca lanza con un valor anidado de más (no se puede comparar: cuenta como sin cambio)', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 200_000; i++) deep = [deep];
    const body = { meta: { entity: 'deal', action: 'change', entity_id: '501' }, data: { custom_fields: { [TRIGGER]: deep } }, previous: { custom_fields: { [TRIGGER]: deep } } };
    expect(() => normalizeWebhookBody(body)).not.toThrow();
    const event = normalizeWebhookBody(body);
    if (event) expect(optionFieldSetInEvent(event, TRIGGER).fired).toBe(false);
  });

  it('meta.version "2.0" sin entity sigue siendo v2 (y no se confunde con v1)', () => {
    expect(normalizeWebhookBody({ meta: { version: '2.0', action: 'change' }, data: {} })).toMatchObject({ version: 'v2', entity: '' });
  });
});

describe('optionFieldSetInEvent: el disparador cambió a un valor en ESTE evento', () => {
  const fired = (body: unknown) => optionFieldSetInEvent(normalizeWebhookBody(body)!, TRIGGER);

  it('v2: elegido (antes vacío)', () => {
    expect(fired(v2({ data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 88 } } }, previous: { custom_fields: { [TRIGGER]: null } } })))
      .toEqual({ fired: true, optionId: 88 });
  });

  it('v2: cambiado de una opción a otra', () => {
    expect(fired(v2({ data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 89 } } }, previous: { custom_fields: { [TRIGGER]: { type: 'enum', id: 88 } } } })))
      .toEqual({ fired: true, optionId: 89 });
  });

  it('v2: vaciado (previous con el valor, data en null)', () => {
    expect(fired(v2({ data: { custom_fields: { [TRIGGER]: null } }, previous: { custom_fields: { [TRIGGER]: { type: 'enum', id: 88 } } } })))
      .toEqual({ fired: false, reason: 'vaciado' });
  });

  it('v2: ya puesto y se edita otro campo: no se activa', () => {
    expect(fired(v2({
      data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 88 }, [OTHER]: { type: 'varchar', value: 'nueva' } } },
      previous: { custom_fields: { [OTHER]: { type: 'varchar', value: 'vieja' } } },
    }))).toEqual({ fired: false, reason: 'sin_cambio' });
  });

  it('v2: un valor que no es opción no se activa', () => {
    expect(fired(v2({ data: { custom_fields: { [TRIGGER]: { type: 'varchar', value: 'x' } } }, previous: { custom_fields: { [TRIGGER]: null } } })))
      .toEqual({ fired: false, reason: 'no_es_opcion' });
  });

  it('v1: elegido, ya puesto con otro campo editado, y vaciado', () => {
    expect(fired(v1({ [TRIGGER]: '88' }, { [TRIGGER]: null }))).toEqual({ fired: true, optionId: 88 });
    expect(fired(v1({ [TRIGGER]: '88' }, { [TRIGGER]: '' }))).toEqual({ fired: true, optionId: 88 });
    expect(fired(v1({ [TRIGGER]: '88', [OTHER]: 'nueva' }, { [TRIGGER]: '88', [OTHER]: 'vieja' }))).toEqual({ fired: false, reason: 'sin_cambio' });
    expect(fired(v1({ [TRIGGER]: null }, { [TRIGGER]: '88' }))).toEqual({ fired: false, reason: 'vaciado' });
  });

  it('change_source "api" no cambia la regla', () => {
    expect(fired(v2({ meta: { change_source: 'api' }, data: { custom_fields: { [TRIGGER]: { type: 'enum', id: 88 } } }, previous: { custom_fields: { [TRIGGER]: null } } })))
      .toEqual({ fired: true, optionId: 88 });
  });
});
