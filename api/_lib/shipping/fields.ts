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
// - Opcionales (dueño, 24-11-2026): Orden de flete, Entrega, Agencia o comuna, Flete y Kilos. Vacíos
//   quedan en null (la orden normalizada, en ''), y el correo omite esas líneas (template.ts). Con un
//   valor, siguen sus validaciones (largo, opción desconocida, monto mal escrito, kilos ≤ 0).
//   «Por pagar» sin monto sirve (dueño, 25-11-2026: el comprobante de PDQ no lo trae): el correo
//   dice que el flete va por pagar, sin cifra.
//   Nada se descarta sin avisar: «Agencia o comuna» sin «Entrega» y «Flete por pagar» con monto
//   sin «Flete» detienen el aviso. Siguen obligatorios el Operador, los Bultos y el N° de
//   documento. Sin orden, el documento identifica el aviso (key.ts y «Aviso enviado»).
// Los mensajes pueden traer lo que escribió el dueño: en la nota (HTML) van con escapeHtml.

import type { DealFieldLookup, DealFieldMeta } from '../pipedrive/fieldOptions.js';
import { carrierFromLabel, type Carrier } from './carriers.js';
import { DEFAULT_DOCUMENT_TYPE, DOCUMENT_TYPE_IDS, DOCUMENT_TYPES, MAX_DOCUMENT_DIGITS, type DocumentTypeId, type ShippingDocument } from './documents.js';
import { chileToday, formatChileTimestamp, formatDateLong, isIsoDate, parseChileTimestamp } from './format.js';

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
/** «Por pagar» sin monto (amountClp null): el comprobante no lo trae, como el de PDQ (dueño, 25-11-2026). */
export type Freight = { kind: 'paid' } | { kind: 'due'; amountClp: number | null };

export interface SentLog {
  /** Instante del último aviso (UTC). */
  at: Date;
  /** Operador y orden normalizada, si el texto los trae como los escribe formatSentLog. */
  carrierLabel: string | null;
  /** '' si el aviso salió sin orden («· sin orden»); null si el texto no la trae. */
  order: string | null;
  /** Sin orden, el documento que identifica ese aviso («· sin orden · factura 8459»); si no, null. */
  document: ShippingDocument | null;
}

export interface ShippingFields {
  /** null si el disparador está vacío (la PR 2 decide). */
  action: ShippingAction | null;
  carrier: Carrier;
  /** La orden como la escribió el dueño (para mostrar), o null si va vacía (opcional). */
  order: string | null;
  /** Solo letras y dígitos, en mayúsculas (clave de idempotencia y enlace); '' sin orden. */
  orderNormalized: string;
  /** null: sin la línea «Entrega» y con el cierre neutro («Al recibirlo»). */
  delivery: DeliveryKind | null;
  /** Agencia (retiro) o comuna (domicilio), o null. */
  place: string | null;
  /** null: sin la línea «Flete». */
  freight: Freight | null;
  packages: number;
  /** null: «5 bultos», sin los kilos. */
  kilos: number | null;
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

/** Lo que va en lugar de la orden en «Aviso enviado» cuando el aviso salió sin ella. */
export const SENT_LOG_NO_ORDER = 'sin orden';
/** «· <operador> · sin orden · <documento> <número>», después de la marca de hora. */
const SENT_LOG_NO_ORDER_RE = new RegExp(`^\\s*·\\s*(.*?)\\s*·\\s*${SENT_LOG_NO_ORDER}(?:\\s*·\\s*(\\D*?)\\s*(\\d+))?\\s*$`);

/** «factura 8459» / «guía de despacho 123»: el documento de un aviso sin orden. */
function sentLogDocument(document: ShippingDocument): string {
  return `${DOCUMENT_TYPES[document.type].noun} ${document.number}`;
}

/**
 * Lo único que escribe «Despacho · Aviso enviado» (la PR del envío lo usa tal cual):
 * «aaaa-mm-dd hh:mm -03:00 · <operador> <orden normalizada>», en hora de Chile y con el desfase
 * (formatChileTimestamp), para que la hora releída sea la misma también en el cambio de horario.
 * Sin orden, el documento identifica el aviso: «… · <operador> · sin orden · factura 8459» (o
 * «guía de despacho 123»). Con «<operador> » y nada más, un operador de dos palabras
 * («Transportes TVP») se releería como el operador «Transportes» con la orden «TVP».
 */
export function formatSentLog(at: Date, carrier: Pick<Carrier, 'label'>, orderNormalized: string, document: ShippingDocument): string {
  const ref = orderNormalized || `· ${SENT_LOG_NO_ORDER} · ${sentLogDocument(document)}`;
  return `${formatChileTimestamp(at)} · ${carrier.label} ${ref}`;
}

export type SentLogResult =
  | { status: 'empty' }
  | { status: 'ok'; log: SentLog }
  /** `format`: no empieza con una marca; `no_offset`: sin desfase; `time`: la hora no existe con ese desfase. */
  | { status: 'invalid'; reason: 'format' | 'no_offset' | 'time' };

/**
 * Lo único que lee «Despacho · Aviso enviado» (el par de formatSentLog). Vacío: nunca hubo aviso.
 * Una marca ilegible, sin desfase (en el cambio de horario sería ambigua) o con una hora que no
 * existe da `invalid` y detiene el aviso: sin la hora exacta, una factura anterior al último aviso
 * contaría como nueva. Nunca elige entre dos horas posibles.
 */
export function parseSentLog(raw: unknown): SentLogResult {
  const text = textValue(raw);
  if (!text) return { status: 'empty' };
  const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: [+-]\d{2}:\d{2})?)(?=\s|$)(.*)$/.exec(text);
  if (!m) return { status: 'invalid', reason: 'format' };
  const stamp = parseChileTimestamp(m[1]);
  if (stamp.ok === false) return { status: 'invalid', reason: stamp.reason };
  const noOrder = SENT_LOG_NO_ORDER_RE.exec(m[2]);
  if (noOrder) {
    const type = noOrder[2] === undefined ? undefined : DOCUMENT_TYPE_IDS.find((t) => normalizeLabel(DOCUMENT_TYPES[t].noun) === normalizeLabel(noOrder[2]));
    const number = noOrder[3]?.replace(/^0+/, '');
    const document = type && number ? { type, number } : null;
    return { status: 'ok', log: { at: stamp.at, carrierLabel: noOrder[1].trim() || null, order: '', document } };
  }
  const rest = /^\s*·\s*(.*?)\s+([A-Za-z0-9]+)$/.exec(m[2]);
  return { status: 'ok', log: { at: stamp.at, carrierLabel: rest?.[1].trim() || null, order: rest ? normalizeOrder(rest[2]) : null, document: null } };
}

/** Mensaje de la nota para un «Aviso enviado» que no se puede usar. */
export function sentLogProblemMessage(reason: 'format' | 'no_offset' | 'time'): string {
  const example = '«aaaa-mm-dd hh:mm -03:00 · <operador> <orden>» (-04:00 en invierno)';
  if (reason === 'no_offset') {
    return `${label('sentLog')} no trae el desfase horario después de la hora: sin él, la hora del último aviso puede ser ambigua (cambio de horario). Escríbelo como ${example}.`;
  }
  if (reason === 'time') {
    return `${label('sentLog')} tiene una hora que no existe en Chile con ese desfase (cambio de horario): corrígela como ${example}.`;
  }
  return `${label('sentLog')} no se puede leer: tiene que empezar como ${example}, como lo dejó el último aviso.`;
}

/**
 * El último aviso registrado fue para este mismo despacho (segunda capa contra el envío doble):
 * el mismo operador y la misma orden o, sin orden, un aviso «sin orden» del mismo operador con
 * el mismo documento (tipo y número).
 */
export function sentLogMatches(
  log: SentLog | null,
  carrier: Pick<Carrier, 'label'>,
  orderNormalized: string,
  document: ShippingDocument,
): boolean {
  if (!log || !log.carrierLabel || typeof log.order !== 'string') return false;
  if (normalizeLabel(log.carrierLabel) !== normalizeLabel(carrier.label)) return false;
  if (orderNormalized) return log.order === orderNormalized;
  return log.order === '' && !!log.document && log.document.type === document.type && log.document.number === document.number;
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

  // Orden de flete (opcional: sin ella, el correo va sin seguimiento ni la nombra)
  const order = textValue(raw('order'));
  const orderNormalized = normalizeOrder(order);
  if (order && !orderNormalized) add('order', 'invalid', `${label('order')} no trae letras ni dígitos.`);
  else if (orderNormalized.length > MAX_ORDER_LENGTH) add('order', 'invalid', `${label('order')} tiene más de ${MAX_ORDER_LENGTH} letras y dígitos.`);

  // Entrega y lugar (opcionales)
  let delivery: DeliveryKind | null = null;
  const deliveryOption = option('delivery');
  if (deliveryOption.status === 'ok') {
    delivery = fixedKey(SHIPPING_OPTIONS.delivery, deliveryOption.label);
    if (!delivery) add('delivery', 'unknown_option', `${label('delivery')} trae «${shown(deliveryOption.label)}», que no es «Retiro en agencia» ni «A domicilio».`);
  }
  const place = textValue(raw('place'));
  if (place.length > MAX_PLACE_LENGTH) add('place', 'invalid', `${label('place')} tiene más de ${MAX_PLACE_LENGTH} caracteres.`);
  // Un lugar sin «Entrega» no se sabe si es la agencia o la comuna: no se descarta sin avisar.
  if (place && deliveryOption.status === 'empty') {
    add('place', 'invalid', `${label('place')} tiene texto, pero ${label('delivery')} está vacía: elige «${SHIPPING_OPTIONS.delivery.pickup}» o «${SHIPPING_OPTIONS.delivery.home}», o borra el lugar.`);
  }

  // Flete (opcional; con «Por pagar», el monto también: sin él, el correo no da la cifra)
  let freight: Freight | null = null;
  const freightOption = option('freight');
  if (freightOption.status === 'ok') {
    const kind = fixedKey(SHIPPING_OPTIONS.freight, freightOption.label);
    if (!kind) add('freight', 'unknown_option', `${label('freight')} trae «${shown(freightOption.label)}», que no es «Por pagar» ni «Pagado por eLIGHTS.cl».`);
    if (kind === 'paid') freight = { kind: 'paid' };
    if (kind === 'due') {
      const amount = numberValue(raw('freightAmount'));
      if (amount === null) {
        freight = { kind: 'due', amountClp: null };
      } else if (amount === 'invalid' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_FREIGHT_CLP) {
        add('freightAmount', 'invalid', `${label('freightAmount')} tiene que ser el monto en pesos, entero y sin puntos (tiene «${shown(raw('freightAmount'))}»).`);
      } else {
        freight = { kind: 'due', amountClp: amount };
      }
    }
  }
  // Un monto sin «Flete»: el cliente no se enteraría de que paga el flete. No se descarta sin avisar.
  if (freightOption.status === 'empty' && numberValue(raw('freightAmount')) !== null) {
    add('freightAmount', 'invalid', `${label('freightAmount')} tiene monto, pero ${label('freight')} está vacío: elige «${SHIPPING_OPTIONS.freight.due}» o borra el monto.`);
  }

  // Bultos (obligatorio) y kilos (opcional)
  const packages = numberValue(raw('packages'));
  if (packages === null) required('packages');
  else if (packages === 'invalid' || !Number.isInteger(packages) || packages < 1 || packages > MAX_PACKAGES) {
    add('packages', 'invalid', `${label('packages')} tiene que ser un número entero de 1 a ${MAX_PACKAGES}.`);
  }
  const kilos = numberValue(raw('kilos'));
  if (kilos !== null && (kilos === 'invalid' || !(kilos > 0) || kilos >= MAX_KILOS)) {
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
  if (sent.status === 'invalid') add('sentLog', 'invalid', sentLogProblemMessage(sent.reason));

  // Persona
  const personId = personIdOf(deal);
  if (!personId) add(null, 'no_person', 'El negocio no tiene persona: agrega la persona del cliente, con su correo.');

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    data: {
      action,
      carrier: carrier!,
      order: order || null,
      orderNormalized,
      delivery,
      place: place || null,
      freight,
      packages: packages as number,
      kilos: kilos === null ? null : (kilos as number),
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
 * palabra de `name`, con mayúscula inicial. El destinatario es el correo `primary` o, si ninguno lo
 * es, el primero de la lista (spec §4.2), y solo ese se valida: si no es un correo válido, el aviso
 * no sale. Nunca se pasa a otro correo de la lista (la factura y el voucher irían a una dirección
 * que nadie eligió).
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
  const chosen = list.find((e) => e.primary) ?? list[0];
  if (!chosen?.value) return { ok: false, problem: { field: null, code: 'no_email', message: 'La persona del negocio no tiene correo: agrégalo en la persona.' } };
  if (!EMAIL_RE.test(chosen.value)) {
    return {
      ok: false,
      problem: { field: null, code: 'no_email', message: 'El correo principal de la persona del negocio no es válido: corrígelo en la persona (el aviso no se manda a otro correo).' },
    };
  }
  return { ok: true, greetingName, email: chosen.value };
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
