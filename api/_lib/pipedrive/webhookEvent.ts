// api/_lib/pipedrive/webhookEvent.ts
// Normaliza los cuerpos del webhook de Pipedrive (v1 y v2) a una forma común, sin red ni registros.
//
// v1: `current` y `previous` completos, `meta.object`, `meta.id`, `meta.action` = added | updated |
//     merged | deleted, `meta.is_bulk_update`, y los campos personalizados como claves hash en la raíz
//     de `current` (uno de opción única trae el id de la opción, como texto).
// v2 (versión por defecto de los webhooks nuevos; guía «Webhooks v2» y su guía de migración):
//     `data` con el estado actual y `previous` solo con lo que cambió (un campo que estaba vacío llega
//     como null), `meta.entity`, `meta.entity_id` (texto), `meta.action` = create | change | delete,
//     `meta.is_bulk_edit`, `meta.company_id` (texto) y los campos personalizados en
//     `data.custom_fields`; uno de opción única llega como `{ type: "enum", id }`, sin la etiqueta.
//
// La forma común no guarda texto de los campos (nombres, correos, montos…): solo ids, el estado, la
// etapa, la hora de la modificación (`update_time`) y, de cada campo personalizado, si está vacío, si
// es una opción (con su id) u otro valor. Así nada de lo que se normaliza puede terminar en un
// registro con datos del cliente.

export type WebhookVersion = 'v1' | 'v2';

/** v1 `added`/`updated`/`deleted` y v2 `create`/`change`/`delete`. Lo demás (v1 `merged`), `other`. */
export type WebhookAction = 'create' | 'change' | 'delete' | 'other';

/**
 * Valor de un campo personalizado, sin su contenido:
 * - `null`: vacío;
 * - `{ option }`: opción única. En v2, `{ type: "enum", id }`. En v1 no viene el tipo: un entero (o un
 *   texto de solo dígitos) se toma como id de opción, así que quien lo lee como opción tiene que saber
 *   por /dealFields que el campo es de opción única;
 * - `{ other: true }`: cualquier otro valor (texto, número decimal, fecha, varias opciones…).
 */
export type CustomFieldValue = null | { option: number } | { other: true };

export interface DealSnapshot {
  id: number | null;
  stageId: number | null;
  pipelineId: number | null;
  status: string | null;
}

export interface NormalizedWebhookEvent {
  version: WebhookVersion;
  /** `deal`, `person`… ('' si no viene). */
  entity: string;
  action: WebhookAction;
  /** v1 `meta.id` (o `current.id`); v2 `meta.entity_id` (o `data.id`). */
  entityId: number | null;
  /** Siempre como texto: v1 lo manda como número y v2 como texto. */
  companyId: string | null;
  /** `app` o `api` según Pipedrive; otro valor queda como `otro`. */
  changeSource: string | null;
  /** v1 `meta.is_bulk_update`, v2 `meta.is_bulk_edit`. */
  isBulk: boolean;
  /** v1 `retry` (0-3) + 1; v2 `meta.attempt` (1-4). */
  attempt: number | null;
  /**
   * Hora de la modificación que originó el evento: v1 `current.update_time`, v2 `data.update_time`
   * (guía de migración a v2: «2022-11-24T15:11:55Z»). Un reintento de Pipedrive reenvía el mismo
   * cuerpo, así que la trae igual; una elección nueva del dueño, otra. El aviso de despacho la usa
   * para reconocer las reentregas. null si no viene o no tiene la forma de una fecha.
   */
  updateTime: string | null;
  /** Estado actual (v1 `current`, v2 `data`); null si no viene (p. ej., un borrado). */
  current: DealSnapshot | null;
  /** Solo si la etapa cambió en este evento. */
  stageChange: { from: number | null; to: number | null } | null;
  /** Solo si el estado cambió en este evento. */
  statusChange: { from: string | null; to: string | null } | null;
  /** Claves de los campos personalizados que cambiaron en este evento. */
  changedCustomFields: string[];
  /** Valor actual de cada campo personalizado que trae el cuerpo, sin su contenido. */
  customFields: Record<string, CustomFieldValue>;
}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Clave de un campo personalizado en v1: 40 caracteres hexadecimales en la raíz de `current`. */
const V1_CUSTOM_KEY = /^[0-9a-f]{40}$/;

/** Un id escalar: entero positivo, o texto de solo dígitos. */
function scalarId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value.trim())) {
    const n = Number(value.trim());
    return n > 0 ? n : null;
  }
  return null;
}

/** Un id escalar o, como mucho un nivel, un objeto `{ id }` (v2, entidades relacionadas). */
function toId(value: unknown): number | null {
  if (isObj(value) && Object.prototype.hasOwnProperty.call(value, 'id')) return scalarId(value.id);
  return scalarId(value);
}

/** La acción del cuerpo solo si es texto conocido: nunca se convierte un objeto a texto. */
function mapAction(table: Record<string, WebhookAction>, value: unknown): WebhookAction {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value) ? table[value] : 'other';
}

/** Fecha y hora de Pipedrive (v1 «2026-11-18 15:00:00», v2 «2026-11-18T15:00:00Z»), tal cual. */
const UPDATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$/;

function toUpdateTime(value: unknown): string | null {
  return typeof value === 'string' && UPDATE_TIME.test(value.trim()) ? value.trim() : null;
}

function toStatus(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z_]{1,20}$/.test(value) ? value : null;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Para comparar el antes y el después de un campo, sin guardar el valor. */
function token(value: unknown): string {
  if (isEmpty(value)) return '∅';
  if (typeof value === 'object') {
    try {
      return 'o:' + JSON.stringify(value);
    } catch {
      // Un valor que no se puede comparar (p. ej., anidado de más) cuenta como «sin cambio»: falla cerrado.
      return 'o:sin_comparar';
    }
  }
  return 'p:' + String(value);
}

function v1Value(value: unknown): CustomFieldValue {
  if (isEmpty(value)) return null;
  if (typeof value === 'number' || typeof value === 'string') {
    const id = toId(value);
    return id === null ? { other: true } : { option: id };
  }
  return { other: true };
}

function v2Value(value: unknown): CustomFieldValue {
  if (isEmpty(value)) return null;
  if (isObj(value)) {
    if (value.type === 'enum') {
      const id = toId(value.id);
      return id === null ? { other: true } : { option: id };
    }
    // Varias opciones sin ninguna elegida, o un valor vacío con su tipo.
    if (value.type === 'set' && Array.isArray(value.values) && value.values.length === 0) return null;
    if ('value' in value && isEmpty(value.value) && !('from' in value)) return null;
  }
  return { other: true };
}

function changeSource(meta: Obj): string | null {
  const source = meta.change_source;
  if (typeof source !== 'string' || source === '') return null;
  return source === 'app' || source === 'api' ? source : 'otro';
}

function companyId(meta: Obj): string | null {
  const id = meta.company_id;
  if (typeof id === 'number' && Number.isSafeInteger(id)) return String(id);
  if (typeof id === 'string' && /^\d{1,15}$/.test(id.trim())) return id.trim();
  return null;
}

const isTrue = (value: unknown) => value === true || value === 'true';

function snapshot(data: Obj | null): DealSnapshot | null {
  if (!data) return null;
  return {
    id: toId(data.id),
    stageId: toId(data.stage_id),
    pipelineId: toId(data.pipeline_id),
    status: toStatus(data.status),
  };
}

const V1_ACTIONS: Record<string, WebhookAction> = { added: 'create', updated: 'change', deleted: 'delete' };
const V2_ACTIONS: Record<string, WebhookAction> = { create: 'create', change: 'change', delete: 'delete' };

function normalizeV1(body: Obj, meta: Obj): NormalizedWebhookEvent {
  const current = isObj(body.current) ? body.current : null;
  const previous = isObj(body.previous) ? body.previous : null;
  const now = snapshot(current);
  const before = snapshot(previous);

  const customFields: Record<string, CustomFieldValue> = Object.create(null);
  for (const [key, value] of Object.entries(current ?? {})) {
    if (V1_CUSTOM_KEY.test(key)) customFields[key] = v1Value(value);
  }
  // v1 trae el objeto anterior completo: cambió lo que es distinto. Sin `previous`, nada cambió.
  const changedCustomFields = current && previous
    ? [...new Set([...Object.keys(current), ...Object.keys(previous)])]
      .filter((key) => V1_CUSTOM_KEY.test(key) && token(current[key]) !== token(previous[key]))
    : [];

  const retry = typeof body.retry === 'number' && Number.isInteger(body.retry) ? body.retry : null;
  return {
    version: 'v1',
    entity: typeof meta.object === 'string' ? meta.object : '',
    action: mapAction(V1_ACTIONS, meta.action),
    entityId: toId(meta.id) ?? now?.id ?? null,
    companyId: companyId(meta),
    changeSource: changeSource(meta),
    isBulk: isTrue(meta.is_bulk_update),
    attempt: retry === null ? null : retry + 1,
    updateTime: toUpdateTime(current?.update_time),
    current: now,
    stageChange: now && before && now.stageId !== before.stageId ? { from: before.stageId, to: now.stageId } : null,
    statusChange: now && before && now.status !== before.status ? { from: before.status, to: now.status } : null,
    changedCustomFields,
    customFields,
  };
}

function normalizeV2(body: Obj, meta: Obj): NormalizedWebhookEvent {
  const data = isObj(body.data) ? body.data : null;
  const previous = isObj(body.previous) ? body.previous : null;
  const now = snapshot(data);

  const dataCustom = data && isObj(data.custom_fields) ? data.custom_fields : {};
  const previousCustom = previous && isObj(previous.custom_fields) ? previous.custom_fields : {};
  const customFields: Record<string, CustomFieldValue> = Object.create(null);
  for (const [key, value] of Object.entries(dataCustom)) customFields[key] = v2Value(value);
  // v2 trae en `previous` solo lo que cambió: un campo cambió si su clave está ahí (y el valor es otro).
  const changedCustomFields = Object.keys(previousCustom)
    .filter((key) => token(previousCustom[key]) !== token(dataCustom[key]));

  const has = (key: string) => previous !== null && Object.prototype.hasOwnProperty.call(previous, key);
  const stageFrom = has('stage_id') ? toId(previous?.stage_id) : undefined;
  const statusFrom = has('status') ? toStatus(previous?.status) : undefined;

  const attempt = typeof meta.attempt === 'number' && Number.isInteger(meta.attempt) ? meta.attempt : null;
  return {
    version: 'v2',
    entity: typeof meta.entity === 'string' ? meta.entity : '',
    action: mapAction(V2_ACTIONS, meta.action),
    entityId: toId(meta.entity_id) ?? now?.id ?? null,
    companyId: companyId(meta),
    changeSource: changeSource(meta),
    isBulk: isTrue(meta.is_bulk_edit),
    attempt,
    updateTime: toUpdateTime(data?.update_time),
    current: now,
    stageChange: now && stageFrom !== undefined && stageFrom !== now.stageId ? { from: stageFrom, to: now.stageId } : null,
    statusChange: now && statusFrom !== undefined && statusFrom !== now.status ? { from: statusFrom, to: now.status } : null,
    changedCustomFields,
    customFields,
  };
}

/**
 * La forma común de un cuerpo del webhook, o null si no es un cuerpo de Pipedrive que se reconozca
 * (sin `meta`, o sin `meta.entity` ni `meta.object`). Acepta el cuerpo ya leído o como texto JSON.
 * Nunca lanza (auditoría de la #196): ningún valor se convierte a texto sin comprobar su tipo y, si
 * algo inesperado falla igual, el cuerpo cuenta como no reconocido. El webhook responde 200: un 5xx
 * repetido hace que Pipedrive borre el webhook.
 */
export function normalizeWebhookBody(body: unknown): NormalizedWebhookEvent | null {
  try {
    let parsed = body;
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (!isObj(parsed) || !isObj(parsed.meta)) return null;
    const meta = parsed.meta;
    const v2 = typeof meta.entity === 'string' || (typeof meta.version === 'string' && meta.version.startsWith('2'));
    if (v2) return normalizeV2(parsed, meta);
    if (typeof meta.object === 'string') return normalizeV1(parsed, meta);
    return null;
  } catch {
    return null;
  }
}

export type OptionFieldChange =
  | { fired: true; optionId: number }
  | { fired: false; reason: 'sin_cambio' | 'vaciado' | 'no_es_opcion' };

/**
 * ¿En ESTE evento el campo de opción única `fieldKey` cambió a una opción? Es la regla del disparador
 * del aviso de despacho (spec §3, paso 3):
 * - v1: `current[clave]` tiene valor y es distinto de `previous[clave]`;
 * - v2: la clave está en `previous.custom_fields` y `data.custom_fields[clave]` trae una opción.
 * Un campo que ya tenía valor no se activa cuando se edita otro campo; uno vaciado tampoco.
 * `fieldKey` tiene que ser de un campo de opción única (en v1 el cuerpo no dice el tipo).
 */
export function optionFieldSetInEvent(event: NormalizedWebhookEvent, fieldKey: string): OptionFieldChange {
  if (!event.changedCustomFields.includes(fieldKey)) return { fired: false, reason: 'sin_cambio' };
  const value = event.customFields[fieldKey] ?? null;
  if (value === null) return { fired: false, reason: 'vaciado' };
  if ('option' in value) return { fired: true, optionId: value.option };
  return { fired: false, reason: 'no_es_opcion' };
}
