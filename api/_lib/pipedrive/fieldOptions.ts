// src/lib/pipedrive/fieldOptions.ts
// Resolve and cache Pipedrive enum option IDs from field metadata.
// NEVER hardcode option IDs — always resolve from the API at runtime.

import { pipedriveGet } from './client.js';
import type { PipedriveField, PipedriveFieldOption } from '../crm/types.js';

// --- Types ---

type EntityType = 'deal' | 'person' | 'organization';

interface FieldMeta {
  key: string;
  options: PipedriveFieldOption[];
}

// --- Cache ---

const cache: Record<string, Map<string, FieldMeta>> = {
  deal: new Map(),
  person: new Map(),
  organization: new Map(),
};

let initialized = false;

// --- Endpoints per entity ---

const ENDPOINTS: Record<EntityType, string> = {
  deal: '/dealFields',
  person: '/personFields',
  organization: '/organizationFields',
};

// --- Fields we care about (env var name -> field key at runtime) ---

const TRACKED_FIELDS: Record<EntityType, Record<string, string | undefined>> = {
  deal: {
    sourceSystem: process.env.PIPEDRIVE_DEAL_FIELD_SOURCE_SYSTEM,
    leadType: process.env.PIPEDRIVE_DEAL_FIELD_LEAD_TYPE,
    priorityTier: process.env.PIPEDRIVE_DEAL_FIELD_PRIORITY_TIER,
    followup24Created: process.env.PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24,
    followup72Created: process.env.PIPEDRIVE_DEAL_FIELD_FOLLOWUP_72,
    quoteReference: process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE,
    jumpsellerOrderId: process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID,
  },
  person: {
    customerType: process.env.PIPEDRIVE_PERSON_FIELD_CUSTOMER_TYPE,
    preferredChannel: process.env.PIPEDRIVE_PERSON_FIELD_PREFERRED_CHANNEL,
  },
  organization: {
    segment: process.env.PIPEDRIVE_ORG_FIELD_SEGMENT,
    isB2BPriority: process.env.PIPEDRIVE_ORG_FIELD_IS_B2B_PRIORITY,
    billingCommune: process.env.PIPEDRIVE_ORG_FIELD_BILLING_COMMUNE,
  },
};

// --- Initialization ---

/**
 * Fetch field metadata from Pipedrive for all tracked entities and populate cache.
 * Call once at function cold start or before first use.
 */
export async function initFieldOptions(): Promise<void> {
  if (initialized) return;

  for (const entity of Object.keys(TRACKED_FIELDS) as EntityType[]) {
    const trackedKeys = Object.values(TRACKED_FIELDS[entity]).filter(Boolean) as string[];
    if (trackedKeys.length === 0) continue;

    const res = await pipedriveGet<PipedriveField[]>(ENDPOINTS[entity], { limit: '500' });
    if (!res.success || !res.data) {
      console.error(`[fieldOptions] Failed to fetch ${entity} fields`);
      continue;
    }

    for (const field of res.data) {
      if (trackedKeys.includes(field.key) && field.options) {
        cache[entity].set(field.key, {
          key: field.key,
          options: field.options,
        });
      }
    }
  }

  initialized = true;
}

// --- Public API ---

/** Case- and accent-insensitive label: 'Telefono' matches the "Teléfono" option. */
function normalizeLabel(label: string): string {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Get the numeric option ID for a given entity field key and label.
 * Returns undefined if not found (caller should handle gracefully).
 *
 * Example: getOptionId('deal', process.env.PIPEDRIVE_DEAL_FIELD_SOURCE_SYSTEM!, 'nuevo_elights')
 */
export function getOptionId(
  entity: EntityType,
  fieldKey: string,
  label: string
): number | undefined {
  const meta = cache[entity].get(fieldKey);
  if (!meta) {
    console.warn(`[fieldOptions] No cached metadata for ${entity}/${fieldKey}`);
    return undefined;
  }
  const wanted = normalizeLabel(label);
  const option = meta.options.find((o) => normalizeLabel(o.label) === wanted);
  if (!option) {
    console.warn(
      `[fieldOptions] Option "${label}" not found for ${entity}/${fieldKey}. Available: ${meta.options.map((o) => o.label).join(', ')}`
    );
  }
  return option?.id;
}

/**
 * Get all options for a given entity field key.
 */
export function getOptions(
  entity: EntityType,
  fieldKey: string
): PipedriveFieldOption[] {
  return cache[entity].get(fieldKey)?.options ?? [];
}

/**
 * Convenience: resolve a "Si/No" enum field to the correct option ID.
 * Handles common label variants: "Si", "Sí", "No".
 */
export function getBooleanOptionId(
  entity: EntityType,
  fieldKey: string,
  value: boolean
): number | undefined {
  const label = value ? 'Sí' : 'No';
  let id = getOptionId(entity, fieldKey, label);
  // Fallback: try "Si" without accent
  if (id === undefined && value) {
    id = getOptionId(entity, fieldKey, 'Si');
  }
  return id;
}

// --- Campos del negocio por nombre (aviso de despacho, spec §4.1) ---
// Los campos «Despacho · …» se buscan por su nombre en /dealFields: así sus claves hash no llegan al
// repo ni a variables de entorno. Caché propia, aparte de la de arriba (que solo guarda las claves de
// variables de entorno y queda lista aunque la consulta falle): si la consulta falla, no se guarda
// nada y la próxima llamada vuelve a consultar. Si un nombre no está, se vuelve a consultar como
// mucho una vez por minuto (el dueño pudo crear o renombrar el campo después).

export interface DealFieldMeta {
  key: string;
  name: string;
  fieldType: string;
  options: PipedriveFieldOption[];
}

export type DealFieldLookup =
  | { status: 'ok'; field: DealFieldMeta }
  /** No hay un campo con ese nombre exacto. */
  | { status: 'missing' }
  /** Hay dos o más campos con ese nombre: no se adivina cuál es. */
  | { status: 'duplicate' }
  /** /dealFields no respondió (o falta el token): se reintenta en la próxima llamada. */
  | { status: 'unavailable' };

const MISSING_NAME_REFRESH_MS = 60_000;

/** Nombre exacto (con el «·»), sin espacios en los extremos y en la misma forma Unicode. */
function exactName(name: string): string {
  return name.trim().normalize('NFC');
}

let dealFieldsByName: { fields: Map<string, DealFieldMeta[]>; fetchedAt: number } | null = null;
let dealFieldsInFlight: Promise<boolean> | null = null;

function loadDealFieldsByName(timeoutMs?: number): Promise<boolean> {
  if (dealFieldsInFlight) return dealFieldsInFlight;
  dealFieldsInFlight = (async () => {
    try {
      const res = await pipedriveGet<PipedriveField[]>(ENDPOINTS.deal, { limit: '500' }, timeoutMs);
      if (!res.success || !Array.isArray(res.data)) {
        console.error('[fieldOptions] Failed to fetch deal fields by name');
        return false;
      }
      const fields = new Map<string, DealFieldMeta[]>();
      for (const field of res.data) {
        if (typeof field?.name !== 'string' || typeof field.key !== 'string') continue;
        const name = exactName(field.name);
        const meta: DealFieldMeta = {
          key: field.key,
          name,
          fieldType: typeof field.field_type === 'string' ? field.field_type : '',
          options: Array.isArray(field.options) ? field.options : [],
        };
        fields.set(name, [...(fields.get(name) ?? []), meta]);
      }
      dealFieldsByName = { fields, fetchedAt: Date.now() };
      return true;
    } catch {
      // getConfig lanza si falta PIPEDRIVE_API_TOKEN; el mensaje no lleva datos, pero no hace falta.
      console.error('[fieldOptions] Failed to fetch deal fields by name (request error)');
      return false;
    } finally {
      dealFieldsInFlight = null;
    }
  })();
  return dealFieldsInFlight;
}

/**
 * Busca un campo del negocio por su nombre exacto. Nunca lanza. `timeoutMs` acota la consulta en
 * frío (el webhook tiene que responder a Pipedrive en menos de 10 s).
 */
export async function findDealFieldByName(
  name: string,
  options: { timeoutMs?: number } = {},
): Promise<DealFieldLookup> {
  const wanted = exactName(name);
  let fresh = false;
  if (!dealFieldsByName) {
    if (!(await loadDealFieldsByName(options.timeoutMs))) return { status: 'unavailable' };
    fresh = true;
  }
  let found = dealFieldsByName?.fields.get(wanted);
  if (!found && !fresh && dealFieldsByName && Date.now() - dealFieldsByName.fetchedAt >= MISSING_NAME_REFRESH_MS) {
    if (await loadDealFieldsByName(options.timeoutMs)) found = dealFieldsByName?.fields.get(wanted);
  }
  if (!found || found.length === 0) return { status: 'missing' };
  if (found.length > 1) return { status: 'duplicate' };
  return { status: 'ok', field: found[0] };
}

/**
 * Force re-initialization (useful for tests or after field changes).
 */
export function resetFieldOptionsCache(): void {
  cache.deal.clear();
  cache.person.clear();
  cache.organization.clear();
  initialized = false;
  dealFieldsByName = null;
  dealFieldsInFlight = null;
}
