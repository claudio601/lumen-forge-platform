// api/_lib/shipping/fields.ts
// Campos «Despacho · …» del negocio en Pipedrive (spec Nivel 2, §4.1) y su lectura PURA: recibe
// el negocio (GET /v1/deals/{id}) y el mapa de campos que entrega findDealFieldByName
// (api/_lib/pipedrive/fieldOptions.ts), y devuelve el dato listo o la lista exacta de lo que falta
// o no sirve, con mensajes en español para la nota del negocio. No llama a Pipedrive ni lee la hora
// del sistema: la hora llega en `now`. La orquestación (PR 2) consulta, escapa los mensajes en la
// nota y decide.
//
// - Los campos se buscan por su nombre exacto (con el «·»): sus claves hash no llegan al repo.
// - Los de opción (Operador, Entrega, Flete, Documento y Aviso) llegan como id de la opción, en
//   número o en texto; aquí se comparan ids, resueltos por etiqueta con las opciones del campo.
//   Un id que no está en las opciones da `unknown_option`: la PR 2 refresca /dealFields una vez
//   (p. ej., un operador recién agregado).
// - Documento (requisito del dueño del 18-11-2026): factura o guía de despacho; vacío = factura.
//   El número va en «Despacho · N° de documento» (antes «Despacho · Factura N°»).
// - Fechas en hora de Chile. Nunca «hoy»: una «Fecha de envío» vacía es la fecha del aviso y una
//   futura detiene el aviso (el texto diría que ya se entregó).
// Los mensajes pueden traer lo que escribió el dueño: en la nota (HTML) van con escapeHtml.

import type { DealFieldLookup, DealFieldMeta } from '../pipedrive/fieldOptions.js';
import { carrierFromLabel, type Carrier } from './carriers.js';
import { DEFAULT_DOCUMENT_TYPE, DOCUMENT_TYPES, type DocumentTypeId, type ShippingDocument } from './documents.js';
import { chileDateTime, chileLocalToUtc, chileToday, formatDateLong, isIsoDate } from './format.js';

// ── Nombres y opciones ──────────────────────────────────────────────────────

export const SHIPPING_FIELD_NAMES = {
  carrier: 'Despacho · Operador',
  order: 'Despacho · Orden de flete',
  delivery: 'Despacho · Entrega',
  place: 'Despacho · Agencia o comuna',
  freight: 'Despacho · Flete',
  freightAmount: 'Despacho · Flete por pagar',
  packages: 'Despacho · Bultos',
  kilos: 'Despacho · Kilos',
  shipDate: 'Despacho · Fecha de envío',
  eta: 'Despacho · Entrega estimada',
  /** Opción única «Factura» / «Guía de despacho»; vacío = factura (dueño, 18-11-2026). */
  documentType: 'Despacho · Documento',
  /** Solo dígitos. Antes «Despacho · Factura N°». */
  documentNumber: 'Despacho · N° de documento',
  products: 'Despacho · Productos',
  trigger: 'Despacho · Aviso',
  sentLog: 'Despacho · Aviso enviado',
} as const;

export type ShippingFieldId = keyof typeof SHIPPING_FIELD_NAMES;

export const SHIPPING_FIELD_IDS = Object.keys(SHIPPING_FIELD_NAMES) as ShippingFieldId[];

/** Opciones fijas de los campos de opción (el Operador acepta cualquier opción: carriers.ts). */
export const SHIPPING_OPTIONS = {
  delivery: { pickup: 'Retiro en agencia', home: 'A domicilio' },
  freight: { due: 'Por pagar', paid: 'Pagado por eLIGHTS.cl' },
  trigger: { preview: 'Vista previa', send: 'Enviar al cliente' },
  documentType: { factura: DOCUMENT_TYPES.factura.option, guia: DOCUMENT_TYPES.guia.option },
} as const;

const OPTION_FIELDS: readonly ShippingFieldId[] = ['carrier', 'delivery', 'freight', 'documentType', 'trigger'];

// ── Límites ─────────────────────────────────────────────────────────────────

export const MAX_PLACE_LENGTH = 80;
export const MAX_ORDER_LENGTH = 30;
export const MAX_PACKAGES = 99;
export const MAX_KILOS = 100_000;
/** Tope de cordura del flete por pagar (CLP): más que esto es casi seguro un error de tipeo. */
export const MAX_FREIGHT_CLP = 10_000_000;
export const MAX_DOCUMENT_DIGITS = 10;

// ── Tipos ───────────────────────────────────────────────────────────────────

export type ShippingProblemCode =
  | 'missing_field'
  | 'duplicate_field'
  | 'field_type'
  | 'missing_option'
  | 'required'
  | 'invalid'
  | 'unknown_option'
  | 'future_date'
  | 'no_person'
  | 'no_email';

export interface ShippingProblem {
  field: ShippingFieldId | null;
  code: ShippingProblemCode;
  /** Para la nota «Aviso de despacho NO enviado» (texto plano: se escapa al escribir la nota). */
  message: string;
}

export type ShippingFieldMap = Readonly<Record<ShippingFieldId, DealFieldMeta>>;

export type FieldMapResult =
  | { status: 'ok'; fields: ShippingFieldMap }
  /** /dealFields no respondió: «reintenta en unos minutos». */
  | { status: 'unavailable' }
  | { status: 'invalid'; problems: ShippingProblem[] };

export type ShippingAction = 'preview' | 'send';
export type DeliveryKind = 'pickup' | 'home';
export type Freight = { kind: 'paid' } | { kind: 'due'; amountClp: number };

export interface SentLog {
  /** Instante del último aviso (UTC). */
  at: Date;
  /** Operador y orden normalizada, si el texto los trae como los escribe formatSentLog. */
  carrierLabel: string | null;
  order: string | null;
}

export interface ShippingFields {
  /** null si el disparador está vacío (la PR 2 decide). */
  action: ShippingAction | null;
  carrier: Carrier;
  /** La orden como la escribió el dueño (para mostrar). */
  order: string;
  /** Solo letras y dígitos, en mayúsculas (clave de idempotencia y enlace). */
  orderNormalized: string;
  delivery: DeliveryKind;
  place: string;
  freight: Freight;
  packages: number;
  kilos: number;
  /** 'aaaa-mm-dd'. */
  shipDate: string;
  /** La fecha de envío venía vacía y se usó la del aviso (hoy en Chile). */
  shipDateFromNotice: boolean;
  /** 'aaaa-mm-dd' o null (se omite la línea; nunca se inventa un plazo). */
  eta: string | null;
  document: ShippingDocument;
  /** «Despacho · Productos» tal cual (lo lee products.ts) o null si va vacío. */
  productsText: string | null;
  personId: number;
  /** «Despacho · Aviso enviado» leído, o null si nunca hubo aviso. */
  lastNotice: SentLog | null;
}

export type ShippingFieldsResult =
  | { ok: true; data: ShippingFields }
  | { ok: false; problems: ShippingProblem[] };

// ── Utilidades ──────────────────────────────────────────────────────────────

/** Sin mayúsculas, tildes ni espacios de más (para comparar etiquetas de opciones). */
function normalizeLabel(label: string): string {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Orden de flete para la clave y el enlace: solo letras y dígitos, en mayúsculas. «282.022.397» → «282022397». */
export function normalizeOrder(value: string): string {
  return value.normalize('NFKC').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

const label = (id: ShippingFieldId) => `«${SHIPPING_FIELD_NAMES[id]}»`;

/** Texto de un campo: sin espacios de más; vacío si no hay valor. */
function textValue(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** Número de un campo numérico de Pipedrive (llega como número o como texto). */
function numberValue(raw: unknown): number | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 'invalid';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) return 'invalid';
    return Number(s.replace(',', '.'));
  }
  return 'invalid';
}

const shown = (value: unknown) => String(value).replace(/\s+/g, ' ').trim().slice(0, 40);

// ── Mapa de campos ──────────────────────────────────────────────────────────

/**
 * Junta lo que devolvió findDealFieldByName para cada nombre de SHIPPING_FIELD_NAMES. Un campo que
 * falta, repetido, que no es de opción cuando debe serlo o sin una opción fija, va a la lista.
 * Si /dealFields no respondió para alguno, `unavailable` (no se afirma que falte).
 */
export function resolveShippingFieldMap(lookups: Readonly<Record<string, DealFieldLookup | undefined>>): FieldMapResult {
  const problems: ShippingProblem[] = [];
  const fields: Partial<Record<ShippingFieldId, DealFieldMeta>> = {};
  for (const id of SHIPPING_FIELD_IDS) {
    const lookup = lookups[SHIPPING_FIELD_NAMES[id]];
    if (!lookup || lookup.status === 'unavailable') return { status: 'unavailable' };
    if (lookup.status === 'missing') {
      problems.push({ field: id, code: 'missing_field', message: `Falta el campo ${label(id)} en Pipedrive (el nombre tiene que ser exacto, con el «·»).` });
      continue;
    }
    if (lookup.status === 'duplicate') {
      problems.push({ field: id, code: 'duplicate_field', message: `Hay dos o más campos ${label(id)} en Pipedrive: deja uno.` });
      continue;
    }
    const field = lookup.field;
    if (OPTION_FIELDS.includes(id) && field.fieldType !== 'enum') {
      problems.push({ field: id, code: 'field_type', message: `El campo ${label(id)} tiene que ser de opción única.` });
      continue;
    }
    const fixed = (SHIPPING_OPTIONS as Record<string, Record<string, string>>)[id];
    if (fixed) {
      const have = new Set(field.options.map((o) => normalizeLabel(o.label)));
      for (const wanted of Object.values(fixed)) {
        if (!have.has(normalizeLabel(wanted))) {
          problems.push({ field: id, code: 'missing_option', message: `Al campo ${label(id)} le falta la opción «${wanted}».` });
        }
      }
    }
    fields[id] = field;
  }
  return problems.length ? { status: 'invalid', problems } : { status: 'ok', fields: fields as ShippingFieldMap };
}

// ── Lectura de opciones ─────────────────────────────────────────────────────

type OptionRead = { status: 'empty' } | { status: 'ok'; label: string } | { status: 'unknown' } | { status: 'invalid' };

function optionValue(raw: unknown, field: DealFieldMeta): OptionRead {
  if (raw === null || raw === undefined || raw === '') return { status: 'empty' };
  let id: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) id = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) id = Number(raw.trim());
  if (id === null) return { status: 'invalid' };
  const option = field.options.find((o) => Number(o.id) === id);
  return option ? { status: 'ok', label: option.label } : { status: 'unknown' };
}

/** Etiqueta → clave de las opciones fijas («Por pagar» → 'due'). */
function fixedKey<K extends string>(options: Readonly<Record<K, string>>, optionLabel: string): K | null {
  const wanted = normalizeLabel(optionLabel);
  return (Object.keys(options) as K[]).find((k) => normalizeLabel(options[k]) === wanted) ?? null;
}

// ── «Despacho · Aviso enviado» ──────────────────────────────────────────────

/** «aaaa-mm-dd hh:mm · <operador> <orden normalizada>», en hora de Chile. */
export function formatSentLog(at: Date, carrier: Pick<Carrier, 'label'>, orderNormalized: string): string {
  const { date, time } = chileDateTime(at);
  return `${date} ${time} · ${carrier.label} ${orderNormalized}`;
}

/**
 * Lee «Despacho · Aviso enviado». Vacío: nunca hubo aviso. Si no empieza con una fecha y hora
 * válidas (alguien lo editó), `invalid`: sin esa fecha, una factura vieja contaría como nueva.
 */
export function parseSentLog(raw: unknown): { status: 'empty' } | { status: 'ok'; log: SentLog } | { status: 'invalid' } {
  const text = textValue(raw);
  if (!text) return { status: 'empty' };
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?:\s*·\s*(.*?)\s+([A-Za-z0-9]+))?$/.exec(text) ??
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?:\s.*)?$/.exec(text);
  if (!m || !isIsoDate(m[1])) return { status: 'invalid' };
  let at: Date;
  try {
    at = chileLocalToUtc(m[1], m[2]);
  } catch {
    return { status: 'invalid' };
  }
  return { status: 'ok', log: { at, carrierLabel: m[3]?.trim() || null, order: m[4] ? normalizeOrder(m[4]) : null } };
}

/** El último aviso registrado fue para este mismo operador y orden (segunda capa contra el envío doble). */
export function sentLogMatches(log: SentLog | null, carrier: Pick<Carrier, 'label'>, orderNormalized: string): boolean {
  return Boolean(log?.order && log.carrierLabel && log.order === orderNormalized && normalizeLabel(log.carrierLabel) === normalizeLabel(carrier.label));
}

// ── Lectura del negocio ─────────────────────────────────────────────────────

function personIdOf(deal: Readonly<Record<string, unknown>>): number | null {
  const raw = deal.person_id;
  const id = raw && typeof raw === 'object' ? (raw as { value?: unknown }).value : raw;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : null;
}

/**
 * Lee y valida los campos del despacho del negocio. `now` es la hora del aviso: define «hoy» en
 * Chile (fecha de envío vacía o futura). Devuelve todos los problemas juntos, en el orden de los
 * campos.
 */
export function readShippingFields(
  deal: Readonly<Record<string, unknown>>,
  fields: ShippingFieldMap,
  { now }: { now: Date },
): ShippingFieldsResult {
  const problems: ShippingProblem[] = [];
  const add = (field: ShippingFieldId | null, code: ShippingProblemCode, message: string) => problems.push({ field, code, message });
  const raw = (id: ShippingFieldId) => deal[fields[id].key];
  const required = (id: ShippingFieldId) => add(id, 'required', `Falta ${label(id)}.`);
  const option = (id: ShippingFieldId): OptionRead => {
    const read = optionValue(raw(id), fields[id]);
    if (read.status === 'unknown') add(id, 'unknown_option', `${label(id)} trae una opción que no está en Pipedrive: vuelve a elegirla.`);
    if (read.status === 'invalid') add(id, 'invalid', `${label(id)} trae un valor que no es una opción: vuelve a elegirla.`);
    return read;
  };

  // Disparador
  let action: ShippingAction | null = null;
  const trigger = option('trigger');
  if (trigger.status === 'ok') {
    action = fixedKey(SHIPPING_OPTIONS.trigger, trigger.label);
    if (!action) add('trigger', 'unknown_option', `${label('trigger')} trae «${shown(trigger.label)}», que no es «Vista previa» ni «Enviar al cliente».`);
  }

  // Operador
  let carrier: Carrier | null = null;
  const carrierOption = option('carrier');
  if (carrierOption.status === 'empty') required('carrier');
  if (carrierOption.status === 'ok') carrier = carrierFromLabel(carrierOption.label);

  // Orden de flete
  const order = textValue(raw('order'));
  const orderNormalized = normalizeOrder(order);
  if (!order) required('order');
  else if (!orderNormalized) add('order', 'invalid', `${label('order')} no trae letras ni dígitos.`);
  else if (orderNormalized.length > MAX_ORDER_LENGTH) add('order', 'invalid', `${label('order')} tiene más de ${MAX_ORDER_LENGTH} letras y dígitos.`);

  // Entrega y lugar
  let delivery: DeliveryKind | null = null;
  const deliveryOption = option('delivery');
  if (deliveryOption.status === 'empty') required('delivery');
  if (deliveryOption.status === 'ok') {
    delivery = fixedKey(SHIPPING_OPTIONS.delivery, deliveryOption.label);
    if (!delivery) add('delivery', 'unknown_option', `${label('delivery')} trae «${shown(deliveryOption.label)}», que no es «Retiro en agencia» ni «A domicilio».`);
  }
  const place = textValue(raw('place'));
  if (!place) required('place');
  else if (place.length > MAX_PLACE_LENGTH) add('place', 'invalid', `${label('place')} tiene más de ${MAX_PLACE_LENGTH} caracteres.`);

  // Flete
  let freight: Freight | null = null;
  const freightOption = option('freight');
  if (freightOption.status === 'empty') required('freight');
  if (freightOption.status === 'ok') {
    const kind = fixedKey(SHIPPING_OPTIONS.freight, freightOption.label);
    if (!kind) add('freight', 'unknown_option', `${label('freight')} trae «${shown(freightOption.label)}», que no es «Por pagar» ni «Pagado por eLIGHTS.cl».`);
    if (kind === 'paid') freight = { kind: 'paid' };
    if (kind === 'due') {
      const amount = numberValue(raw('freightAmount'));
      if (amount === null) {
        add('freightAmount', 'required', `Falta ${label('freightAmount')}: con «Por pagar» va el monto del comprobante del operador.`);
      } else if (amount === 'invalid' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_FREIGHT_CLP) {
        add('freightAmount', 'invalid', `${label('freightAmount')} tiene que ser el monto en pesos, entero y sin puntos (tiene «${shown(raw('freightAmount'))}»).`);
      } else {
        freight = { kind: 'due', amountClp: amount };
      }
    }
  }

  // Bultos y kilos
  const packages = numberValue(raw('packages'));
  if (packages === null) required('packages');
  else if (packages === 'invalid' || !Number.isInteger(packages) || packages < 1 || packages > MAX_PACKAGES) {
    add('packages', 'invalid', `${label('packages')} tiene que ser un número entero de 1 a ${MAX_PACKAGES}.`);
  }
  const kilos = numberValue(raw('kilos'));
  if (kilos === null) required('kilos');
  else if (kilos === 'invalid' || !(kilos > 0) || kilos >= MAX_KILOS) {
    add('kilos', 'invalid', `${label('kilos')} tiene que ser un número mayor que 0 (tiene «${shown(raw('kilos'))}»).`);
  }

  // Fechas (hora de Chile)
  const today = chileToday(now);
  const shipText = textValue(raw('shipDate'));
  let shipDate: string | null = shipText ? null : today;
  if (shipText) {
    if (!isIsoDate(shipText)) add('shipDate', 'invalid', `${label('shipDate')} no es una fecha.`);
    else if (shipText > today) {
      add('shipDate', 'future_date', `${label('shipDate')} (${formatDateLong(shipText)}) es posterior a hoy: el aviso diría que ya se entregó.`);
    } else shipDate = shipText;
  }
  const etaText = textValue(raw('eta'));
  let eta: string | null = null;
  if (etaText) {
    if (!isIsoDate(etaText)) add('eta', 'invalid', `${label('eta')} no es una fecha.`);
    else if (shipDate && etaText < shipDate) add('eta', 'invalid', `${label('eta')} (${formatDateLong(etaText)}) es anterior a la fecha de envío.`);
    else eta = etaText;
  }

  // Documento
  let documentType: DocumentTypeId | null = DEFAULT_DOCUMENT_TYPE;
  const documentOption = option('documentType');
  if (documentOption.status === 'ok') {
    documentType = fixedKey(SHIPPING_OPTIONS.documentType, documentOption.label);
    if (!documentType) add('documentType', 'unknown_option', `${label('documentType')} trae «${shown(documentOption.label)}», que no es «Factura» ni «Guía de despacho».`);
  } else if (documentOption.status !== 'empty') documentType = null;
  const docText = textValue(raw('documentNumber'));
  let documentNumber: string | null = null;
  if (!docText) required('documentNumber');
  else if (!new RegExp(`^\\d{1,${MAX_DOCUMENT_DIGITS}}$`).test(docText) || /^0+$/.test(docText)) {
    add('documentNumber', 'invalid', `${label('documentNumber')} lleva solo dígitos (tiene «${shown(docText)}»).`);
  } else documentNumber = String(Number(docText));

  // Productos (los lee products.ts) y último aviso
  const productsRaw = raw('products');
  const productsText = typeof productsRaw === 'string' && productsRaw.trim() ? productsRaw : null;
  const sent = parseSentLog(raw('sentLog'));
  if (sent.status === 'invalid') {
    add('sentLog', 'invalid', `${label('sentLog')} no se puede leer (tiene que empezar con «aaaa-mm-dd hh:mm», como lo dejó el último aviso): corrígelo.`);
  }

  // Persona
  const personId = personIdOf(deal);
  if (!personId) add(null, 'no_person', 'El negocio no tiene persona: agrega la persona del cliente, con su correo.');

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    data: {
      action,
      carrier: carrier!,
      order,
      orderNormalized,
      delivery: delivery!,
      place,
      freight: freight!,
      packages: packages as number,
      kilos: kilos as number,
      shipDate: shipDate!,
      shipDateFromNotice: !shipText,
      eta,
      document: { type: documentType!, number: documentNumber! },
      productsText,
      personId: personId!,
      lastNotice: sent.status === 'ok' ? sent.log : null,
    },
  };
}

// ── Persona y referencia ────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/**
 * Saludo y correo de la persona (GET /v1/persons/{id}): `first_name` o, si viene vacío, la primera
 * palabra de `name`, con mayúscula inicial; el correo `primary` o, si no hay, el primero. Sin
 * correo válido, el aviso no sale.
 */
export function readPersonContact(
  person: Readonly<Record<string, unknown>> | null | undefined,
): { ok: true; greetingName: string | null; email: string } | { ok: false; problem: ShippingProblem } {
  if (!person) return { ok: false, problem: { field: null, code: 'no_person', message: 'El negocio no tiene persona: agrega la persona del cliente, con su correo.' } };
  const first = textValue(person.first_name);
  const word = first ? first.split(' ')[0] : textValue(person.name).split(' ')[0] ?? '';
  const greetingName = word ? word.charAt(0).toLocaleUpperCase('es-CL') + word.slice(1) : null;
  const raw = person.email;
  const list: { value: string; primary: boolean }[] = Array.isArray(raw)
    ? raw.flatMap((e) => (e && typeof e === 'object' ? [{ value: textValue((e as { value?: unknown }).value), primary: (e as { primary?: unknown }).primary === true }] : []))
    : typeof raw === 'string'
      ? [{ value: textValue(raw), primary: true }]
      : [];
  const valid = list.filter((e) => EMAIL_RE.test(e.value));
  const email = (valid.find((e) => e.primary) ?? valid[0])?.value;
  if (!email) return { ok: false, problem: { field: null, code: 'no_email', message: 'La persona del negocio no tiene un correo válido.' } };
  return { ok: true, greetingName, email };
}

/** Formatos que exige el servidor (api/request-orders/create.ts y api/quotes/create.ts). */
const RC_REFERENCE = /^RC-[a-z0-9]{5,8}$/i;
const NE_REFERENCE = /^NE-[0-9a-z]{1,7}$/;

/**
 * Referencia del encabezado: «Pedido RC-…» o «Cotización NE-…», solo si calza con el formato del
 * servidor (el campo se puede editar a mano). Nunca WA- (lleva el teléfono del cliente) ni PY-.
 */
export function referenceLabel(raw: unknown): string | null {
  const ref = textValue(raw);
  if (RC_REFERENCE.test(ref)) return `Pedido ${ref}`;
  if (NE_REFERENCE.test(ref)) return `Cotización ${ref}`;
  return null;
}
