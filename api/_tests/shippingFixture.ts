// api/_tests/shippingFixture.ts
// Datos ficticios y montaje común de las pruebas del aviso de despacho (shipping-notice*.test.ts):
// los 15 campos «Despacho · …» con claves inventadas, un negocio, su persona, las etapas de tres
// embudos, el catálogo simulado (product-links y priceIndex, con productos que no existen) y el
// fetch con Upstash, Pipedrive y el relay simulados. Nada de esto sale a la red ni es de un cliente.
// No es una prueba ni una función: vive en api/_tests/ para que Vercel no lo despliegue.

import { vi } from 'vitest';
import { resetFieldOptionsCache } from '../_lib/pipedrive/fieldOptions.js';
import { SHIPPING_FIELD_IDS, SHIPPING_FIELD_NAMES, type ShippingFieldId } from '../_lib/shipping/fields.js';
import { createFakePipedrive, createFakeRelay, fakeNoticeFetch, jpgBytes, pdfBytes, pipedriveTime, PIPEDRIVE_URL, RELAY_SECRET, RELAY_URL, type FakeFile, type FakePipedrive, type FakeRelay } from './fakePipedrive.js';
import { createFakeRedis, UPSTASH_URL, type FakeRedis } from './fakeUpstash.js';

export const DEAL_ID = 501;
export const PERSON_ID = 61;
export const OWNER_USER_ID = 9001;
// Datos de cliente ficticios: nunca deben llegar a los registros.
export const NAME = 'Juana Pérez';
export const EMAIL = 'juana.prueba@example.com';
export const PHONE = '+56 9 1111 2222';
export const PERSONAL = [NAME, 'Juana', 'Pérez', EMAIL, PHONE, '1111 2222', 'Temuco', '123.456.789', 'factura-1234.pdf', 'voucher-starken.jpg'];

/** Clave inventada de cada campo (40 caracteres, como las de Pipedrive). */
export const K = Object.fromEntries(SHIPPING_FIELD_IDS.map((id, i) => [id, `${String(i).padStart(2, '0')}${'c'.repeat(38)}`])) as Record<ShippingFieldId, string>;
/** PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE. */
export const QREF_KEY = 'd'.repeat(40);

export const OPT = {
  starken: 101, chilexpress: 102, mena: 109,
  pickup: 201, home: 202,
  due: 301, paid: 302,
  factura: 401, guia: 402,
  preview: 71, send: 72,
} as const;

/** Etapas: «Despachado» en los embudos 1 y 2 (ids distintos); el 3 (Instalación) no la tiene. */
export const STAGES = [
  { id: 20, name: 'Ganado pagado', pipeline_id: 1 },
  { id: 24, name: 'Despachado', pipeline_id: 1 },
  { id: 21, name: 'Ganado pagado', pipeline_id: 2 },
  { id: 25, name: 'Despachado', pipeline_id: 2 },
  { id: 99, name: 'Despachado', pipeline_id: 2, active_flag: false },
  { id: 30, name: 'Instalación', pipeline_id: 3 },
];

export function dealFields({ withMena = false } = {}): Record<string, unknown>[] {
  const enumField = (id: ShippingFieldId, options: { id: number; label: string }[]) => ({ key: K[id], name: SHIPPING_FIELD_NAMES[id], field_type: 'enum', options });
  const plain = (id: ShippingFieldId, type: string) => ({ key: K[id], name: SHIPPING_FIELD_NAMES[id], field_type: type });
  return [
    enumField('carrier', [{ id: OPT.starken, label: 'Starken' }, { id: OPT.chilexpress, label: 'Chilexpress' }, ...(withMena ? [{ id: OPT.mena, label: 'Transportes Mena' }] : [])]),
    plain('order', 'varchar'),
    enumField('delivery', [{ id: OPT.pickup, label: 'Retiro en agencia' }, { id: OPT.home, label: 'A domicilio' }]),
    plain('place', 'varchar'),
    enumField('freight', [{ id: OPT.due, label: 'Por pagar' }, { id: OPT.paid, label: 'Pagado por eLIGHTS.cl' }]),
    plain('freightAmount', 'monetary'),
    plain('packages', 'double'),
    plain('kilos', 'double'),
    plain('shipDate', 'date'),
    plain('eta', 'date'),
    enumField('documentType', [{ id: OPT.factura, label: 'Factura' }, { id: OPT.guia, label: 'Guía de despacho' }]),
    plain('documentNumber', 'varchar'),
    plain('products', 'text'),
    enumField('trigger', [{ id: OPT.preview, label: 'Vista previa' }, { id: OPT.send, label: 'Enviar al cliente' }]),
    plain('sentLog', 'varchar'),
    { key: QREF_KEY, name: 'Referencia de cotización', field_type: 'varchar' },
    { key: 'e'.repeat(40), name: 'Otro campo', field_type: 'varchar' },
  ];
}

/** Negocio listo para avisar: Starken, retiro en agencia, por pagar, factura 1234 y 10 PAN60. */
export function baseDeal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DEAL_ID,
    title: `PRUEBA ${NAME}`,
    status: 'open',
    value: 123456,
    currency: 'CLP',
    pipeline_id: 2,
    stage_id: 21,
    person_id: { value: PERSON_ID, name: NAME, email: [{ value: EMAIL, primary: true }], phone: [{ value: PHONE }] },
    [K.carrier]: String(OPT.starken),
    [K.order]: '123.456.789',
    [K.delivery]: OPT.pickup,
    [K.place]: 'Temuco',
    [K.freight]: OPT.due,
    [K.freightAmount]: 14460,
    [K.packages]: 1,
    [K.kilos]: 3.2,
    [K.shipDate]: null,
    [K.eta]: null,
    [K.documentType]: null,
    [K.documentNumber]: '1234',
    [K.products]: '10 PAN60',
    [K.trigger]: null,
    [K.sentLog]: null,
    [QREF_KEY]: 'RC-ab12c',
    ...over,
  };
}

export function basePerson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PERSON_ID,
    name: NAME,
    first_name: 'Juana',
    active_flag: true,
    email: [{ label: 'work', value: EMAIL, primary: true }],
    phone: [{ label: 'mobile', value: PHONE, primary: true }],
    ...over,
  };
}

/** Catálogo simulado: productos inventados (el aviso nunca usa precios). */
export const PRODUCT_LINKS = {
  '1001': { id: 'panel-prueba-60x60', name: 'PANEL PRUEBA 60X60', variants: {} },
  '1002': { id: 'proyector-prueba-50w', name: 'PROYECTOR PRUEBA 50W', variants: { '501': { sku: 'PRY50C', label: 'Cálida 3000K' } } },
};
export const PRICE_INDEX = {
  '1001': { name: 'PANEL PRUEBA 60X60', sku: 'PAN60', price: 1, variants: {} },
  '1002': { name: 'PROYECTOR PRUEBA 50W', sku: '', price: 1, variants: { '501': { sku: 'PRY50C', price: 1 } } },
};

/** Nota del servidor de una solicitud RC- con requested_items_json (como request-orders/create.ts). */
export function requestNote(reference = 'RC-ab12c', items: unknown = [{ jumpsellerId: 1002, variantId: 501, quantity: 3, name: 'IGNORADO', url: 'https://otro.example' }]): string {
  return `Solicitud de pedido ${reference}<br>Cliente: ${NAME}<br>Correo: ${EMAIL}<br><br>requested_items_json: ${JSON.stringify(items).replace(/</g, '\\u003c')}`;
}

export interface NoticeWorld {
  redis: FakeRedis;
  pd: FakePipedrive;
  relay: FakeRelay;
  logs: string[];
  deal: () => Record<string, unknown>;
  /** Texto de las notas del negocio, en orden de creación (sin escapar). */
  notes: () => string[];
  /** Agrega un archivo al negocio (por defecto, agregado hace una hora). */
  addFile: (name: string, bytes: Uint8Array, over?: Partial<FakeFile>) => FakeFile;
}

const unescape = (html: string) =>
  html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Hora fija de las pruebas: miércoles 18-11-2026, 12:00 en Chile (-03:00). */
export const NOW = new Date('2026-11-18T15:00:00.000Z');

/**
 * Monta Upstash, Pipedrive y el relay simulados, las variables de entorno de prueba y el reloj fijo
 * (solo Date: los plazos de fetch siguen con el reloj real). Con la factura y el voucher.
 */
export function setupNoticeWorld(): NoticeWorld {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetFieldOptionsCache();
  const redis = createFakeRedis();
  const pd = createFakePipedrive();
  const relay = createFakeRelay();
  pd.dealFields = dealFields();
  pd.stages = STAGES.map((s) => ({ ...s }));
  pd.deals.set(DEAL_ID, baseDeal());
  pd.persons.set(PERSON_ID, basePerson());
  vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-de-prueba');
  vi.stubEnv('PIPEDRIVE_API_TOKEN', 'token-ficticio-pipedrive');
  vi.stubEnv('PIPEDRIVE_BASE_URL', PIPEDRIVE_URL);
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE', QREF_KEY);
  vi.stubEnv('PIPEDRIVE_OWNER_USER_ID', String(OWNER_USER_ID));
  vi.stubEnv('PIPEDRIVE_ACTIVITY_TYPE', 'task');
  vi.stubEnv('SHIPPING_RELAY_URL', RELAY_URL);
  vi.stubEnv('SHIPPING_RELAY_SECRET', RELAY_SECRET);
  vi.stubGlobal('fetch', fakeNoticeFetch(redis, pd, relay));

  const logs: string[] = [];
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);

  const addFile = (name: string, bytes: Uint8Array, over: Partial<FakeFile> = {}) => {
    const file: FakeFile = {
      id: pd.nextId++,
      deal_id: DEAL_ID,
      file_name: name,
      add_time: pipedriveTime(new Date(Date.now() - 3_600_000)),
      file_size: bytes.length,
      active_flag: true,
      inline_flag: false,
      remote_location: 's3',
      mail_message_id: null,
      bytes,
      ...over,
    };
    pd.files.push(file);
    return file;
  };
  addFile('factura-1234.pdf', pdfBytes());
  addFile('voucher-starken.jpg', jpgBytes());

  return {
    redis,
    pd,
    relay,
    logs,
    deal: () => pd.deals.get(DEAL_ID)!,
    notes: () => pd.notes.filter((n) => n.deal_id === DEAL_ID).map((n) => unescape(n.content)),
    addFile,
  };
}

export function teardownNoticeWorld(): void {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetFieldOptionsCache();
}
