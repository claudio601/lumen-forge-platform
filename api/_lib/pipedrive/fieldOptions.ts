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
    jumpsellerOrderId: process.env.PIPEDRIVE_DEAL_FIELD_JUMPSELLER_ORDER_ID,
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
  const option = meta.options.find(
    (o) => o.label.toLowerCase() === label.toLowerCase()
  );
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

/**
 * Force re-initialization (useful for tests or after field changes).
 */
export function resetFieldOptionsCache(): void {
  cache.deal.clear();
  cache.person.clear();
  cache.organization.clear();
  initialized = false;
}
