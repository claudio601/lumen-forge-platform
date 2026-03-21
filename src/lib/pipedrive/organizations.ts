// src/lib/pipedrive/organizations.ts
// Find or create a Pipedrive organization with deduplication by name.

import { pipedriveGet, pipedrivePost } from './client';
import { getOptionId, getBooleanOptionId } from './fieldOptions';
import type {
  QuoteOrganization,
  PipedriveOrganization,
  FindOrCreateOrganizationResult,
} from '../crm/types';

// --- Constants ---

const LOG_PREFIX = '[organizations]';

// --- Helpers ---

interface OrgSearchResultItem {
  item: {
    id: number;
    name: string;
    address?: string;
    custom_fields?: string[];
  };
}

/**
 * Search organizations by name using the /organizations/search endpoint.
 * Uses fields=name and exact_match=true to match only by organization name.
 */
async function searchOrganizations(
  name: string
): Promise<OrgSearchResultItem[]> {
  const res = await pipedriveGet<{ items: OrgSearchResultItem[] }>(
    '/organizations/search',
    { term: name, fields: 'name', exact_match: 'true', limit: '10' }
  );

  if (!res.success || !res.data?.items) return [];
  return res.data.items;
}

/**
 * Pick the best match when multiple organizations are found.
 * Returns the organization with the highest ID (most recently created).
 */
function pickBestMatch(items: OrgSearchResultItem[]): {
  organizationId: number;
  conflictDetected: boolean;
} {
  const sorted = [...items].sort((a, b) => b.item.id - a.item.id);
  return {
    organizationId: sorted[0].item.id,
    conflictDetected: items.length > 1,
  };
}

// --- Main export ---

/**
 * Find an existing organization by exact name match,
 * or create a new one if no match is found.
 *
 * Deduplication strategy:
 *  1. Search by name with fields=name and exact_match=true
 *  2. If multiple matches, select the most recently created and flag conflict
 *  3. If no match, create with custom fields (segment, isB2BPriority, billingCommune)
 */
export async function findOrCreateOrganization(
  org: QuoteOrganization
): Promise<FindOrCreateOrganizationResult> {
  // 1. Search by exact name
  const results = await searchOrganizations(org.name);

  if (results.length > 0) {
    const { organizationId, conflictDetected } = pickBestMatch(results);
    console.log(
      `${LOG_PREFIX} Found organization by name: ${organizationId}` +
        (conflictDetected ? ' (conflict detected)' : '')
    );
    return { organizationId, action: 'found', conflictDetected };
  }

  // 2. Create new organization
  const body: Record<string, unknown> = {
    name: org.name,
  };

  // Custom field: segment (enum resolved via fieldOptions)
  const segmentKey = process.env.PIPEDRIVE_ORG_FIELD_SEGMENT;
  if (segmentKey && org.segment) {
    const optionId = getOptionId('organization', segmentKey, org.segment);
    if (optionId !== undefined) {
      body[segmentKey] = optionId;
    } else {
      console.warn(
        `${LOG_PREFIX} Could not resolve segment option for "${org.segment}"`
      );
    }
  }

  // Custom field: isB2BPriority (boolean enum → Sí/No)
  const isB2BKey = process.env.PIPEDRIVE_ORG_FIELD_IS_B2B_PRIORITY;
  if (isB2BKey && org.isB2BPriority !== undefined) {
    const optionId = getBooleanOptionId('organization', isB2BKey, org.isB2BPriority);
    if (optionId !== undefined) {
      body[isB2BKey] = optionId;
    }
  }

  // Custom field: billingCommune (text field mapped to custom field, NOT native address)
  const communeKey = process.env.PIPEDRIVE_ORG_FIELD_BILLING_COMMUNE;
  if (communeKey && org.billingCommune) {
    body[communeKey] = org.billingCommune;
  }

  const res = await pipedrivePost<PipedriveOrganization>('/organizations', body);

  if (!res.success || !res.data) {
    throw new Error(
      `${LOG_PREFIX} Failed to create organization: ${res.error ?? 'unknown error'}`
    );
  }

  console.log(`${LOG_PREFIX} Created organization: ${res.data.id}`);
  return { organizationId: res.data.id, action: 'created' };
}
