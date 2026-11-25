// api/_lib/shipping/fields.test.ts
// Campos «Despacho · …» (spec Nivel 2, §4.1 y §10): resolución por nombre, faltantes, opcionales
// (orden, entrega, agencia o comuna, flete y kilos: dueño, 24-11-2026), opciones como id,
// normalización de la orden, fechas en hora de Chile, persona y referencia.
// Claves, ids y datos inventados.

import { describe, expect, it } from 'vitest';
import type { DealFieldLookup, DealFieldMeta } from '../pipedrive/fieldOptions';
import {
  formatSentLog,
  normalizeOrder,
  parseSentLog,
  readPersonContact,
  readShippingFields,
  referenceLabel,
  resolveShippingFieldMap,
  sentLogMatches,
  sentLogProblemMessage,
  SHIPPING_FIELD_IDS,
  SHIPPING_FIELD_NAMES,
  type ShippingFieldId,
  type ShippingFieldMap,
} from './fields';
import { carrierFromLabel } from './carriers';
import type { ShippingDocument } from './documents';
import { selectShippingFiles } from './files';

const OPTIONS: Partial<Record<ShippingFieldId, string[]>> = {
  carrier: ['Starken', 'Cruz del Sur', 'ECOEx', 'Varmontt', 'Samex', 'PDQ', 'Pullman Cargo', 'Chilexpress', 'Transportes Mena', 'Rapid Cargo'],
  delivery: ['Retiro en agencia', 'A domicilio'],
  freight: ['Por pagar', 'Pagado por eLIGHTS.cl'],
  documentType: ['Factura', 'Guía de despacho'],
  trigger: ['Vista previa', 'Enviar al cliente'],
};

/** Id de opción inventado: 100 × posición del campo + posición de la opción. */
const optionId = (field: ShippingFieldId, optionLabel: string) =>
  100 * (SHIPPING_FIELD_IDS.indexOf(field) + 1) + OPTIONS[field]!.indexOf(optionLabel) + 1;

const key = (field: ShippingFieldId) => `k${String(SHIPPING_FIELD_IDS.indexOf(field)).padStart(2, '0')}${'a'.repeat(37)}`;

function meta(field: ShippingFieldId): DealFieldMeta {
  const options = OPTIONS[field];
  return {
    key: key(field),
    name: SHIPPING_FIELD_NAMES[field],
    fieldType: options ? 'enum' : field === 'products' ? 'text' : 'varchar',
    options: (options ?? []).map((l) => ({ id: optionId(field, l), label: l })),
  };
}

const FIELDS = Object.fromEntries(SHIPPING_FIELD_IDS.map((f) => [f, meta(f)])) as ShippingFieldMap;

const lookups = (override: Partial<Record<ShippingFieldId, DealFieldLookup>> = {}) =>
  Object.fromEntries(
    SHIPPING_FIELD_IDS.map((f): [string, DealFieldLookup] => [SHIPPING_FIELD_NAMES[f], override[f] ?? { status: 'ok', field: FIELDS[f] }]),
  );

/** 18-11-2026 a las 14:05 de Chile. */
const NOW = new Date('2026-11-18T17:05:00Z');

function deal(values: Partial<Record<ShippingFieldId, unknown>> = {}, extra: Record<string, unknown> = {}) {
  const base: Partial<Record<ShippingFieldId, unknown>> = {
    trigger: String(optionId('trigger', 'Vista previa')),
    carrier: String(optionId('carrier', 'Starken')),
    order: '123.456.789',
    delivery: String(optionId('delivery', 'Retiro en agencia')),
    place: 'La Serena',
    freight: String(optionId('freight', 'Por pagar')),
    freightAmount: 14460,
    packages: 1,
    kilos: 3.2,
    shipDate: '2026-11-18',
    eta: '2026-11-20',
    documentType: null,
    documentNumber: '1234',
    products: '10 APB401',
    sentLog: null,
    ...values,
  };
  return {
    id: 1,
    person_id: { value: 77, name: 'Ana Prueba' },
    ...Object.fromEntries(Object.entries(base).map(([f, v]) => [key(f as ShippingFieldId), v])),
    ...extra,
  };
}

const read = (values?: Partial<Record<ShippingFieldId, unknown>>, extra?: Record<string, unknown>) =>
  readShippingFields(deal(values, extra), FIELDS, { now: NOW });

const problems = (values?: Partial<Record<ShippingFieldId, unknown>>, extra?: Record<string, unknown>) => {
  const r = read(values, extra);
  return r.ok === false ? r.problems : [];
};

describe('nombres de los campos', () => {
  it('son 15, exactos y con el «·»', () => {
    expect(Object.values(SHIPPING_FIELD_NAMES)).toEqual([
      'Despacho · Operador',
      'Despacho · Orden de flete',
      'Despacho · Entrega',
      'Despacho · Agencia o comuna',
      'Despacho · Flete',
      'Despacho · Flete por pagar',
      'Despacho · Bultos',
      'Despacho · Kilos',
      'Despacho · Fecha de envío',
      'Despacho · Entrega estimada',
      'Despacho · Documento',
      'Despacho · N° de documento',
      'Despacho · Productos',
      'Despacho · Aviso',
      'Despacho · Aviso enviado',
    ]);
  });
});

describe('resolveShippingFieldMap', () => {
  it('con todos los campos, el mapa listo', () => {
    const r = resolveShippingFieldMap(lookups());
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.fields.carrier.key).toBe(key('carrier'));
  });

  it('nombra cada campo que falta o está repetido', () => {
    const r = resolveShippingFieldMap(lookups({ documentNumber: { status: 'missing' }, order: { status: 'duplicate' } }));
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') return;
    expect(r.problems.map((p) => p.message)).toEqual([
      'Hay dos o más campos «Despacho · Orden de flete» en Pipedrive: deja uno.',
      'Falta el campo «Despacho · N° de documento» en Pipedrive (el nombre tiene que ser exacto, con el «·»).',
    ]);
  });

  it('si /dealFields no respondió para alguno: unavailable (no se afirma que falte)', () => {
    expect(resolveShippingFieldMap(lookups({ kilos: { status: 'unavailable' } })).status).toBe('unavailable');
    const partial = lookups();
    delete partial[SHIPPING_FIELD_NAMES.trigger];
    expect(resolveShippingFieldMap(partial).status).toBe('unavailable');
  });

  it('un campo de opción que no es de opción, o sin una opción fija, va a la lista', () => {
    const notEnum = { ...FIELDS.freight, fieldType: 'varchar' };
    const noGuide = { ...FIELDS.documentType, options: FIELDS.documentType.options.filter((o) => o.label === 'Factura') };
    const r = resolveShippingFieldMap(lookups({ freight: { status: 'ok', field: notEnum }, documentType: { status: 'ok', field: noGuide } }));
    expect(r.status === 'invalid' && r.problems.map((p) => p.code)).toEqual(['field_type', 'missing_option']);
    expect(r.status === 'invalid' && r.problems[1].message).toBe('Al campo «Despacho · Documento» le falta la opción «Guía de despacho».');
  });

  it('el Operador acepta opciones nuevas (Rapid Cargo)', () => {
    expect(resolveShippingFieldMap(lookups()).status).toBe('ok');
  });
});

describe('readShippingFields: datos completos', () => {
  it('devuelve el dato listo', () => {
    const r = read();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      action: 'preview',
      order: '123.456.789',
      orderNormalized: '123456789',
      delivery: 'pickup',
      place: 'La Serena',
      freight: { kind: 'due', amountClp: 14460 },
      packages: 1,
      kilos: 3.2,
      shipDate: '2026-11-18',
      shipDateFromNotice: false,
      eta: '2026-11-20',
      document: { type: 'factura', number: '1234' },
      productsText: '10 APB401',
      personId: 77,
      lastNotice: null,
    });
    expect(r.data.carrier.id).toBe('starken');
  });

  it('las opciones llegan como id en número o en texto', () => {
    const r = read({ carrier: optionId('carrier', 'Pullman Cargo'), trigger: optionId('trigger', 'Enviar al cliente'), delivery: optionId('delivery', 'A domicilio') });
    expect(r.ok && [r.data.carrier.id, r.data.action, r.data.delivery]).toEqual(['pullman-cargo', 'send', 'home']);
  });

  it('un operador sin fila sale con su etiqueta', () => {
    const r = read({ carrier: String(optionId('carrier', 'Rapid Cargo')) });
    expect(r.ok && r.data.carrier).toMatchObject({ id: null, label: 'Rapid Cargo', trackingUrl: null });
  });

  it('Documento vacío es factura; «Guía de despacho» es guía', () => {
    expect(read().ok && (read() as { data: { document: unknown } }).data.document).toEqual({ type: 'factura', number: '1234' });
    const guia = read({ documentType: String(optionId('documentType', 'Guía de despacho')), documentNumber: '291' });
    expect(guia.ok && guia.data.document).toEqual({ type: 'guia', number: '291' });
  });

  it('pagado por eLIGHTS.cl no pide monto', () => {
    const r = read({ freight: String(optionId('freight', 'Pagado por eLIGHTS.cl')), freightAmount: null });
    expect(r.ok && r.data.freight).toEqual({ kind: 'paid' });
  });

  it('números que llegan como texto', () => {
    const r = read({ packages: '2', kilos: '4,5', freightAmount: '5880' });
    expect(r.ok && [r.data.packages, r.data.kilos, r.data.freight]).toEqual([2, 4.5, { kind: 'due', amountClp: 5880 }]);
  });

  it('sin fecha de envío, la del aviso en hora de Chile (nunca «hoy»)', () => {
    // 02:30 UTC del 19-11 = 23:30 del 18-11 en Chile
    const r = readShippingFields(deal({ shipDate: null, eta: null }), FIELDS, { now: new Date('2026-11-19T02:30:00Z') });
    expect(r.ok && [r.data.shipDate, r.data.shipDateFromNotice, r.data.eta]).toEqual(['2026-11-18', true, null]);
  });

  it('el disparador vacío no es un problema (la PR 2 decide)', () => {
    const r = read({ trigger: null });
    expect(r.ok && r.data.action).toBeNull();
  });
});

describe('readShippingFields: campos opcionales (dueño, 24-11-2026)', () => {
  const EMPTY_OPTIONAL = { order: '', delivery: null, place: '  ', freight: null, freightAmount: null, kilos: null } as const;

  it('sin orden, entrega, agencia o comuna, flete ni kilos: el dato listo, con null', () => {
    const r = read(EMPTY_OPTIONAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ order: null, orderNormalized: '', delivery: null, place: null, freight: null, kilos: null, packages: 1 });
    expect(r.data.document).toEqual({ type: 'factura', number: '1234' });
  });

  it('cada uno por separado', () => {
    const noOrder = read({ order: null });
    expect(noOrder.ok && [noOrder.data.order, noOrder.data.orderNormalized]).toEqual([null, '']);
    const noPlace = read({ place: '' });
    expect(noPlace.ok && [noPlace.data.delivery, noPlace.data.place]).toEqual(['pickup', null]);
    const noDelivery = read({ delivery: null, place: '' });
    expect(noDelivery.ok && [noDelivery.data.delivery, noDelivery.data.place]).toEqual([null, null]);
    const noFreight = read({ freight: null, freightAmount: null });
    expect(noFreight.ok && noFreight.data.freight).toBeNull();
    const noKilos = read({ kilos: '' });
    expect(noKilos.ok && noKilos.data.kilos).toBeNull();
  });

  it('con un valor, siguen las validaciones de formato', () => {
    expect(problems({ ...EMPTY_OPTIONAL, order: '---' }).map((p) => [p.field, p.code])).toEqual([['order', 'invalid']]);
    expect(problems({ order: 'A'.repeat(31) }).map((p) => p.message)).toEqual(['«Despacho · Orden de flete» tiene más de 30 letras y dígitos.']);
    expect(problems({ ...EMPTY_OPTIONAL, delivery: String(optionId('delivery', 'A domicilio')), place: 'x'.repeat(81) }).map((p) => p.field)).toEqual(['place']);
    expect(problems({ ...EMPTY_OPTIONAL, kilos: 0 }).map((p) => p.field)).toEqual(['kilos']);
    expect(problems({ ...EMPTY_OPTIONAL, delivery: '999999' }).map((p) => [p.field, p.code])).toEqual([['delivery', 'unknown_option']]);
    expect(problems({ ...EMPTY_OPTIONAL, freight: '999999' }).map((p) => [p.field, p.code])).toEqual([['freight', 'unknown_option']]);
    // «Por pagar» sin el monto sirve desde el 25-11-2026 (el comprobante de PDQ no lo trae).
    const dueNoAmount = read({ ...EMPTY_OPTIONAL, freight: String(optionId('freight', 'Por pagar')) });
    expect(dueNoAmount.ok && dueNoAmount.data.freight).toEqual({ kind: 'due', amountClp: null });
  });

  it('nada se descarta sin avisar: un lugar sin «Entrega» o un monto sin «Flete» detienen el aviso', () => {
    expect(problems({ delivery: null }).map((p) => [p.field, p.code, p.message])).toEqual([
      ['place', 'invalid', '«Despacho · Agencia o comuna» tiene texto, pero «Despacho · Entrega» está vacía: elige «Retiro en agencia» o «A domicilio», o borra el lugar.'],
    ]);
    expect(problems({ freight: null }).map((p) => [p.field, p.code, p.message])).toEqual([
      ['freightAmount', 'invalid', '«Despacho · Flete por pagar» tiene monto, pero «Despacho · Flete» está vacío: elige «Por pagar» o borra el monto.'],
    ]);
    // Los dos juntos, en el orden de los campos; un monto como texto o mal escrito también cuenta.
    expect(problems({ delivery: null, freight: null }).map((p) => p.field)).toEqual(['place', 'freightAmount']);
    expect(problems({ freight: null, freightAmount: '14460' }).map((p) => p.field)).toEqual(['freightAmount']);
    expect(problems({ freight: null, freightAmount: 'abc' }).map((p) => p.field)).toEqual(['freightAmount']);
    // Con el lugar o el monto vacíos, no hay problema.
    expect(read({ delivery: null, place: '  ' }).ok).toBe(true);
    expect(read({ freight: null, freightAmount: null }).ok).toBe(true);
    expect(read({ freight: null, freightAmount: '' }).ok).toBe(true);
    // Una opción que no existe ya es un problema: no se suma otro por el lugar o el monto.
    expect(problems({ delivery: '999999' }).map((p) => [p.field, p.code])).toEqual([['delivery', 'unknown_option']]);
    expect(problems({ freight: '999999' }).map((p) => [p.field, p.code])).toEqual([['freight', 'unknown_option']]);
  });
});

describe('readShippingFields: faltantes e inválidos', () => {
  it('lista exacta de lo que falta, en el orden de los campos: el operador, los bultos y el N° de documento', () => {
    const p = problems({ carrier: null, order: '', delivery: null, place: '  ', freight: null, freightAmount: null, packages: null, kilos: null, documentNumber: null });
    expect(p.map((x) => x.message)).toEqual([
      'Falta «Despacho · Operador».',
      'Falta «Despacho · Bultos».',
      'Falta «Despacho · N° de documento».',
    ]);
  });

  it('por pagar sin monto sirve (25-11-2026); con un monto con decimales (14.460 escrito con punto), no', () => {
    for (const freightAmount of [null, '', '  ']) {
      const r = read({ freightAmount });
      expect(r.ok && r.data.freight, String(freightAmount)).toEqual({ kind: 'due', amountClp: null });
    }
    expect(problems({ freightAmount: 14.46 }).map((p) => [p.field, p.code])).toEqual([['freightAmount', 'invalid']]);
    expect(problems({ freightAmount: 0 }).map((p) => p.code)).toEqual(['invalid']);
  });

  it('bultos de 1 a 99 enteros; kilos mayores que 0', () => {
    expect(problems({ packages: 0 }).map((p) => p.field)).toEqual(['packages']);
    expect(problems({ packages: 100 }).map((p) => p.field)).toEqual(['packages']);
    expect(problems({ packages: 1.5 }).map((p) => p.field)).toEqual(['packages']);
    expect(problems({ kilos: 0 }).map((p) => p.field)).toEqual(['kilos']);
    expect(problems({ kilos: 'tres' }).map((p) => p.field)).toEqual(['kilos']);
  });

  it('una fecha de envío futura (en Chile) detiene el aviso', () => {
    const p = problems({ shipDate: '2026-11-19', eta: '2026-11-20' });
    expect(p.map((x) => x.code)).toEqual(['future_date']);
    expect(p[0].message).toBe('«Despacho · Fecha de envío» (jueves 19 de noviembre) es posterior a hoy: el aviso diría que ya se entregó.');
  });

  it('la entrega estimada no puede ser anterior al envío', () => {
    expect(problems({ shipDate: '2026-11-17', eta: '2026-11-16' }).map((p) => p.field)).toEqual(['eta']);
    expect(read({ shipDate: '2026-11-17', eta: '2026-11-17' }).ok).toBe(true);
  });

  it('el N° de documento lleva solo dígitos', () => {
    expect(problems({ documentNumber: 'F-1234' }).map((p) => p.message)).toEqual(['«Despacho · N° de documento» lleva solo dígitos (tiene «F-1234»).']);
    expect(problems({ documentNumber: '0' }).map((p) => p.field)).toEqual(['documentNumber']);
    const r = read({ documentNumber: ' 01234 ' });
    expect(r.ok && r.data.document.number).toBe('1234');
  });

  it('agencia o comuna de más de 80 caracteres', () => {
    expect(problems({ place: 'x'.repeat(81) }).map((p) => p.field)).toEqual(['place']);
  });

  it('orden sin letras ni dígitos', () => {
    expect(problems({ order: '---' }).map((p) => [p.field, p.code])).toEqual([['order', 'invalid']]);
  });

  it('una opción que no está en el campo da unknown_option (la PR 2 refresca /dealFields)', () => {
    expect(problems({ carrier: '999999' }).map((p) => [p.field, p.code])).toEqual([['carrier', 'unknown_option']]);
    expect(problems({ delivery: 'A domicilio' }).map((p) => [p.field, p.code])).toEqual([['delivery', 'invalid']]);
  });

  it('un negocio sin persona da la nota', () => {
    expect(problems({}, { person_id: null }).map((p) => p.message)).toEqual([
      'El negocio no tiene persona: agrega la persona del cliente, con su correo.',
    ]);
    expect(read({}, { person_id: 55 }).ok).toBe(true);
  });

  it('«Aviso enviado» ilegible, sin desfase o con una hora que no existe detiene el aviso', () => {
    expect(problems({ sentLog: 'enviado el martes' }).map((p) => [p.field, p.code])).toEqual([['sentLog', 'invalid']]);
    expect(problems({ sentLog: '2026-13-40 10:00 -03:00 · Starken 1' }).map((p) => p.field)).toEqual(['sentLog']);
    const noOffset = problems({ sentLog: '2026-11-18 14:05 · Starken 123456789' });
    expect(noOffset.map((p) => [p.field, p.code])).toEqual([['sentLog', 'invalid']]);
    expect(noOffset[0].message).toMatch(/no trae el desfase horario/);
    const skipped = problems({ sentLog: '2026-09-06 00:30 -04:00 · Starken 123456789' });
    expect(skipped[0].message).toMatch(/hora que no existe en Chile/);
    expect(problems({ sentLog: '2026-11-18 11:05 -03:00 · Starken 123456789' })).toEqual([]);
    const ok = read({ sentLog: '2026-11-18 11:05 -03:00 · Starken 123456789' });
    expect(ok.ok === true && ok.data.lastNotice?.at.toISOString()).toBe('2026-11-18T14:05:00.000Z');
  });
});

describe('normalizeOrder', () => {
  it('solo letras y dígitos, en mayúsculas', () => {
    expect(normalizeOrder('123.456.789')).toBe('123456789');
    expect(normalizeOrder(' b-065 958 ')).toBe('B065958');
    expect(normalizeOrder('010-23-453352')).toBe('01023453352');
    expect(normalizeOrder('１２３')).toBe('123');
  });
});

describe('«Despacho · Aviso enviado»', () => {
  const F1234: ShippingDocument = { type: 'factura', number: '1234' };
  const F8459: ShippingDocument = { type: 'factura', number: '8459' };

  it('se escribe y se lee en hora de Chile, con el desfase', () => {
    const text = formatSentLog(new Date('2026-11-18T17:05:30Z'), { label: 'Pullman Cargo' }, '23501234567', F1234);
    expect(text).toBe('2026-11-18 14:05 -03:00 · Pullman Cargo 23501234567');
    expect(formatSentLog(new Date('2026-07-01T16:00:00Z'), { label: 'Starken' }, '123', F1234)).toBe('2026-07-01 12:00 -04:00 · Starken 123');
    const parsed = parseSentLog(text);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.log.at.toISOString()).toBe('2026-11-18T17:05:00.000Z');
    expect(parsed.log).toMatchObject({ carrierLabel: 'Pullman Cargo', order: '23501234567' });
    expect(sentLogMatches(parsed.log, carrierFromLabel('pullman cargo'), '23501234567', F1234)).toBe(true);
    expect(sentLogMatches(parsed.log, carrierFromLabel('Starken'), '23501234567', F1234)).toBe(false);
    expect(sentLogMatches(parsed.log, carrierFromLabel('Pullman Cargo'), '1', F1234)).toBe(false);
  });

  it('sin orden: «· sin orden · <documento>», que se relee con el operador completo y el documento', () => {
    const tvp = carrierFromLabel('Transportes TVP');
    const text = formatSentLog(new Date('2026-11-18T17:05:30Z'), { label: 'Transportes TVP' }, '', F8459);
    expect(text).toBe('2026-11-18 14:05 -03:00 · Transportes TVP · sin orden · factura 8459');
    const guide = formatSentLog(new Date('2026-11-18T17:05:30Z'), { label: 'Starken' }, '', { type: 'guia', number: '123' });
    expect(guide).toBe('2026-11-18 14:05 -03:00 · Starken · sin orden · guía de despacho 123');
    expect(parseSentLog(guide)).toMatchObject({ status: 'ok', log: { carrierLabel: 'Starken', order: '', document: { type: 'guia', number: '123' } } });
    const parsed = parseSentLog(text);
    expect(parsed.status === 'ok' && parsed.log).toMatchObject({ carrierLabel: 'Transportes TVP', order: '', document: F8459 });
    if (parsed.status !== 'ok') return;
    // El mismo despacho sin orden (operador y documento) calza: no se repite.
    expect(sentLogMatches(parsed.log, tvp, '', F8459)).toBe(true);
    // Otro número, otro tipo de documento, la orden u otro operador: otro despacho.
    expect(sentLogMatches(parsed.log, tvp, '', { type: 'factura', number: '8460' })).toBe(false);
    expect(sentLogMatches(parsed.log, tvp, '', { type: 'guia', number: '8459' })).toBe(false);
    expect(sentLogMatches(parsed.log, tvp, 'ABC123', F8459)).toBe(false);
    expect(sentLogMatches(parsed.log, carrierFromLabel('Starken'), '', F8459)).toBe(false);
    const withOrder = parseSentLog(formatSentLog(new Date('2026-11-18T17:05:30Z'), tvp, 'ABC123', F8459));
    expect(withOrder.status === 'ok' && withOrder.log).toMatchObject({ carrierLabel: 'Transportes TVP', order: 'ABC123', document: null });
    expect(withOrder.status === 'ok' && sentLogMatches(withOrder.log, tvp, '', F8459)).toBe(false);
    // Corregido a mano (sin tilde, con mayúsculas o ceros a la izquierda): se lee igual.
    const byHand = parseSentLog('2026-11-18 14:05 -03:00 · Starken · sin orden · Guia de Despacho 0123');
    expect(byHand.status === 'ok' && byHand.log.document).toEqual({ type: 'guia', number: '123' });
    // Sin documento, o con uno que no existe, la capa 2 no calza: siguen Redis y el relay.
    for (const raw of ['2026-11-18 14:05 -03:00 · Transportes TVP · sin orden', '2026-11-18 14:05 -03:00 · Transportes TVP · sin orden · boleta 8459']) {
      const p = parseSentLog(raw);
      expect(p.status === 'ok' && p.log, raw).toMatchObject({ carrierLabel: 'Transportes TVP', order: '', document: null });
      expect(p.status === 'ok' && sentLogMatches(p.log, tvp, '', F8459), raw).toBe(false);
    }
    // Solo la marca (sin operador ni orden) nunca calza con un envío sin orden.
    const onlyTime = parseSentLog('2026-11-18 14:05 -03:00');
    expect(onlyTime.status === 'ok' && sentLogMatches(onlyTime.log, tvp, '', F8459)).toBe(false);
  });

  it('con orden, los valores escritos antes de este cambio se leen igual (el documento no cuenta)', () => {
    const old = parseSentLog('2026-11-18 12:01 -03:00 · Starken 123456789');
    expect(old).toEqual({ status: 'ok', log: { at: new Date('2026-11-18T15:01:00Z'), carrierLabel: 'Starken', order: '123456789', document: null } });
    if (old.status !== 'ok') return;
    const starken = carrierFromLabel('Starken');
    expect(sentLogMatches(old.log, starken, '123456789', F8459)).toBe(true);
    expect(sentLogMatches(old.log, starken, '123456789', { type: 'guia', number: '1' })).toBe(true);
    expect(sentLogMatches(old.log, starken, '', F8459)).toBe(false);
    // Con orden, lo que se escribe no cambia.
    expect(formatSentLog(new Date('2026-11-18T15:01:00Z'), { label: 'Starken' }, '123456789', F8459)).toBe('2026-11-18 12:01 -03:00 · Starken 123456789');
  });

  it('vacío: nunca hubo aviso; con solo la marca (sin operador ni orden) también sirve', () => {
    expect(parseSentLog(null)).toEqual({ status: 'empty' });
    expect(parseSentLog('  ')).toEqual({ status: 'empty' });
    const onlyTime = parseSentLog('2026-11-18 14:05 -03:00');
    expect(onlyTime.status === 'ok' && onlyTime.log.order).toBeNull();
  });

  it('fin del horario de verano (5-4-2026): la hora repetida se relee exacta y no vuelve a admitir un PDF anterior', () => {
    // Codex, 18-11: el aviso real salió a las 03:30:30Z (23:30 -04:00 del 4-4); sin el desfase se
    // releía como 02:30Z y un PDF agregado a las 03:29Z volvía a contar.
    const sentAt = new Date('2026-04-05T03:30:30Z');
    const text = formatSentLog(sentAt, { label: 'Starken' }, '123', F1234);
    expect(text).toBe('2026-04-04 23:30 -04:00 · Starken 123');
    const parsed = parseSentLog(text);
    expect(parsed.status === 'ok' && parsed.log.at.toISOString()).toBe('2026-04-05T03:30:00.000Z');
    const pdfBefore = { id: 9, file_name: 'factura 1234.pdf', add_time: '2026-04-05 03:29:00', file_size: 1000, active_flag: true, inline_flag: false, remote_location: 's3', mail_message_id: null };
    const files = selectShippingFiles([pdfBefore], {
      document: { type: 'factura', number: '1234' },
      lastNoticeAt: parsed.status === 'ok' ? parsed.log.at : null,
      now: new Date('2026-04-05T12:00:00Z'),
    });
    expect(files.ok).toBe(false);
    // La misma hora con el desfase de verano es otro instante, una hora antes.
    const summer = parseSentLog('2026-04-04 23:30 -03:00 · Starken 123');
    expect(summer.status === 'ok' && summer.log.at.toISOString()).toBe('2026-04-05T02:30:00.000Z');
    expect(parseSentLog('2026-04-04 23:30 · Starken 123')).toEqual({ status: 'invalid', reason: 'no_offset' });
  });

  it('inicio del horario de verano (6-9-2026): la hora que no existe detiene el aviso', () => {
    expect(parseSentLog('2026-09-06 00:30 -04:00 · Starken 123')).toEqual({ status: 'invalid', reason: 'time' });
    expect(parseSentLog('2026-09-06 00:30 -03:00 · Starken 123')).toEqual({ status: 'invalid', reason: 'time' });
    expect(parseSentLog('2026-09-06 00:30 · Starken 123')).toEqual({ status: 'invalid', reason: 'no_offset' });
    const text = formatSentLog(new Date('2026-09-06T04:00:00Z'), { label: 'Starken' }, '123', F1234);
    expect(text).toBe('2026-09-06 01:00 -03:00 · Starken 123');
    const parsed = parseSentLog(text);
    expect(parsed.status === 'ok' && parsed.log.at.toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('el mensaje de la nota dice qué corregir', () => {
    expect(sentLogProblemMessage('format')).toMatch(/^«Despacho · Aviso enviado» no se puede leer/);
    expect(sentLogProblemMessage('no_offset')).toMatch(/desfase horario/);
    expect(sentLogProblemMessage('time')).toMatch(/no existe en Chile/);
    for (const r of ['format', 'no_offset', 'time'] as const) expect(sentLogProblemMessage(r)).toContain('-03:00');
  });
});

describe('readPersonContact', () => {
  it('first_name o la primera palabra de name, con mayúscula inicial', () => {
    expect(readPersonContact({ first_name: 'ana', name: 'ana prueba', email: [{ value: 'ana@example.com', primary: true }] })).toEqual({
      ok: true,
      greetingName: 'Ana',
      email: 'ana@example.com',
    });
    const r = readPersonContact({ first_name: '', name: 'josé ficticio', email: [{ value: 'j@example.com', primary: false }] });
    expect(r.ok && r.greetingName).toBe('José');
    const none = readPersonContact({ name: '', email: [{ value: 'x@example.com', primary: true }] });
    expect(none.ok && none.greetingName).toBeNull();
  });

  it('el correo primary o, si ninguno lo es, el primero de la lista', () => {
    const p = readPersonContact({ name: 'Ana', email: [{ value: 'a@example.com', primary: false }, { value: 'b@example.com', primary: true }] });
    expect(p.ok && p.email).toBe('b@example.com');
    const first = readPersonContact({ name: 'Ana', email: [{ value: 'uno@example.com', primary: false }, { value: 'dos@example.com', primary: false }] });
    expect(first.ok && first.email).toBe('uno@example.com');
  });

  it('si el elegido no es válido, el aviso no sale: nunca pasa a otro correo de la lista', () => {
    // Codex, 18-11: con el principal inválido, el aviso iba al secundario.
    const r = readPersonContact({
      name: 'Ana',
      email: [
        { value: 'correo-invalido', primary: true },
        { value: 'secundario@example.com', primary: false },
      ],
    });
    expect(r).toEqual({
      ok: false,
      problem: { field: null, code: 'no_email', message: 'El correo principal de la persona del negocio no es válido: corrígelo en la persona (el aviso no se manda a otro correo).' },
    });
    const firstInvalid = readPersonContact({ name: 'Ana', email: [{ value: 'no-es-correo', primary: false }, { value: 'dos@example.com', primary: false }] });
    expect(firstInvalid).toMatchObject({ ok: false, problem: { code: 'no_email' } });
    // un principal vacío tampoco pasa al siguiente
    expect(readPersonContact({ name: 'Ana', email: [{ value: '', primary: true }, { value: 'b@example.com', primary: false }] })).toMatchObject({
      ok: false,
      problem: { code: 'no_email' },
    });
  });

  it('sin persona o sin correo, el aviso no sale', () => {
    expect(readPersonContact(null)).toMatchObject({ ok: false, problem: { code: 'no_person' } });
    expect(readPersonContact({ name: 'Ana', email: [] })).toMatchObject({ ok: false, problem: { code: 'no_email' } });
    expect(readPersonContact({ name: 'Ana', email: [{ value: '', primary: true }] })).toMatchObject({ ok: false });
  });
});

describe('referenceLabel', () => {
  it('RC- y NE- con el formato del servidor; nunca WA- ni PY-', () => {
    expect(referenceLabel('RC-ab12c')).toBe('Pedido RC-ab12c');
    expect(referenceLabel('NE-1a2')).toBe('Cotización NE-1a2');
    expect(referenceLabel('WA-56911112222')).toBeNull();
    expect(referenceLabel('PY-abc123')).toBeNull();
    expect(referenceLabel('RC-<script>')).toBeNull();
    expect(referenceLabel('NE-ABC')).toBeNull();
    expect(referenceLabel(null)).toBeNull();
  });
});
