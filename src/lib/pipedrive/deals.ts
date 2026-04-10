// src/lib/pipedrive/deals.ts
// Create, update, and find Pipedrive deals with idempotency.

import { pipedriveGet, pipedrivePost, pipedrivePut } from './client';
import { getOptionId } from './fieldOptions';
import type {
  PipedriveDeal,
  CreateDealResult,
  LeadType,
  PriorityTier,
  SourceSystem,
} from '../crm/types';

// --- Constants ---

const LOG_PREFIX = '[deals]';

// --- Types ---

export interface CreateDealParams {
  personId: number;
  orgId?: number;
  pipelineId: number;
  stageId: number;
  title: string;
  quoteAmountClp: number;
  sourceSystem: SourceSystem;
  leadType: LeadType;
  priorityTier: PriorityTier;
  quoteReference: string;
  jumpsellerOrderId?: string;
  notes?: string;
}

export interface DealUpdateFields {
  stageId?: number;
  value?: number;
  title?: string;
  status?: 'open' | 'won' | 'lost';
  [key: string]: unknown;
}

// --- Helpers ---

/**
 * Extract the numeric value from person_id / org_id which can be
 * { value: number } | number | null in the Pipedrive API response.
 */
function extractId(field: { value: number } | number | null | undefined): number | null {
  if (field === null || field === undefined) return null;
  if (typeof field === 'number') return field;
  return field.value ?? null;
}

// --- Idempotency: find existing deal ---

/**
 * Primary idempotency strategy:
 * Search deals by quoteReference custom field value.
 * This is the most reliable way to avoid duplicates.
 */
async function findDealByQuoteReference(
  quoteReference: string,
  pipelineId: number
): Promise<PipedriveDeal | null> {
  const quoteRefKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
  if (!quoteRefKey) {
    console.warn(`${LOG_PREFIX} PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE not configured, skipping quoteRef search`);
    return null;
  }

  // Use the deals search endpoint to find by custom field value
  const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
    '/deals/search',
    { term: quoteReference, fields: 'custom_fields', exact_match: 'true', limit: '5' }
  );

  if (!res.success || !res.data?.items) return null;

  // Filter results: must match pipeline and the custom field value exactly
  for (const { item } of res.data.items) {
    if (item.pipeline_id === pipelineId && item.status === 'open') {
      // Verify the custom field matches (search may return partial matches)
      const fullDeal = await pipedriveGet<PipedriveDeal>(`/deals/${item.id}`);
      if (
        fullDeal.success &&
        fullDeal.data &&
        String(fullDeal.data[quoteRefKey]) === quoteReference
      ) {
        return fullDeal.data;
      }
    }
  }

  return null;
}

/**
 * Secondary idempotency strategy:
 * Search deals by jumpsellerOrderId custom field value.
 * Used for orders coming from Jumpseller.
 */
async function findDealByJumpsellerOrderId(
  orderId: string,
  pipelineId: number
): Promise<PipedriveDeal | null> {
  const orderIdKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (!orderIdKey) {
    console.warn(`${LOG_PREFIX} PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not configured, skipping orderId search`);
    return null;
  }

  const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
    '/deals/search',
    { term: orderId, fields: 'custom_fields', exact_match: 'true', limit: '5' }
  );

  if (!res.success || !res.data?.items) return null;

  for (const { item } of res.data.items) {
    if (item.pipeline_id === pipelineId && item.status === 'open') {
      const fullDeal = await pipedriveGet<PipedriveDeal>(`/deals/${item.id}`);
      if (
        fullDeal.success &&
        fullDeal.data &&
        String(fullDeal.data[orderIdKey]) === orderId
      ) {
        return fullDeal.data;
      }
    }
  }

  return null;
}

/**
 * Tertiary fallback: find any open deal for a person in a given pipeline.
 * Only used when custom field searches return no results.
 */
async function findOpenDealByPerson(
  personId: number,
  pipelineId: number
): Promise<PipedriveDeal | null> {
  const res = await pipedriveGet<PipedriveDeal[]>(
    `/persons/${personId}/deals`,
    { status: 'open' }
  );

  if (!res.success || !res.data) return null;

  // Filter by pipeline — Pipedrive returns all pipelines
  const matching = res.data.filter((d) => d.pipeline_id === pipelineId);

  if (matching.length === 0) return null;

  // Return the most recently updated
  return matching.sort(
    (a, b) => new Date(b.update_time).getTime() - new Date(a.update_time).getTime()
  )[0];
}

/**
 * Combined idempotency check. Priority order:
 *  1. quoteReference custom field (most specific)
 *  2. jumpsellerOrderId custom field (for Jumpseller orders)
 *  3. personId + pipeline + open status (broad fallback)
 */
export async function findExistingDeal(
  params: Pick<CreateDealParams, 'quoteReference' | 'jumpsellerOrderId' | 'personId' | 'pipelineId'>
): Promise<PipedriveDeal | null> {
  // 1. Primary: by quoteReference
  if (params.quoteReference) {
    const deal = await findDealByQuoteReference(params.quoteReference, params.pipelineId);
    if (deal) {
      console.log(`${LOG_PREFIX} Found existing deal by quoteReference: ${deal.id}`);
      return deal;
    }
  }

  // 2. Secondary: by jumpsellerOrderId
  if (params.jumpsellerOrderId) {
    const deal = await findDealByJumpsellerOrderId(params.jumpsellerOrderId, params.pipelineId);
    if (deal) {
      console.log(`${LOG_PREFIX} Found existing deal by jumpsellerOrderId: ${deal.id}`);
      return deal;
    }
  }

  // 3. Fallback: by personId + pipeline + open
  const deal = await findOpenDealByPerson(params.personId, params.pipelineId);
  if (deal) {
    console.log(`${LOG_PREFIX} Found existing open deal by person fallback: ${deal.id}`);
    return deal;
  }

  return null;
}

// --- Update deal ---

/**
 * Update an existing deal with partial fields.
 */
export async function updateDeal(
  dealId: number,
  updates: DealUpdateFields
): Promise<void> {
  const body: Record<string, unknown> = {};

  if (updates.stageId !== undefined) body.stage_id = updates.stageId;
  if (updates.value !== undefined) body.value = updates.value;
  if (updates.title !== undefined) body.title = updates.title;
  if (updates.status !== undefined) body.status = updates.status;

  // Pass through any custom field keys (skip undefined/null/empty values)
  for (const [key, value] of Object.entries(updates)) {
    if (!["stageId", "value", "title", "status"].includes(key) && value !== undefined && value !== null && value !== "") {
      body[key] = value;
    }
  }


  // Guard: skip API call if no fields to update
  if (Object.keys(body).length === 0) {
    console.log(`${LOG_PREFIX} No fields to update for deal ${dealId}, skipping`);
    return;
  }
  const res = await pipedrivePut<PipedriveDeal>(`/deals/${dealId}`, body);

  if (!res.success) {
    throw new Error(
      `${LOG_PREFIX} Failed to update deal ${dealId}: ${res.error ?? 'unknown error'}`
    );
  }

  console.log(`${LOG_PREFIX} Updated deal: ${dealId}`);
}

// --- Create deal (with idempotency) ---

/**
 * Create a new deal or update an existing one if found by idempotency checks.
 *
 * Idempotency priority:
 *  1. quoteReference custom field match
 *  2. jumpsellerOrderId custom field match
 *  3. personId + pipeline + open deal fallback
 *
 * If an existing deal is found, it is updated with the new values.
 * Returns { dealId, action: 'created' | 'updated' }.
 */
export async function createDeal(
  params: CreateDealParams
): Promise<CreateDealResult> {
  // Check for existing deal (idempotency)
  const existingDeal = await findExistingDeal(params);

  if (existingDeal) {
    // Update the existing deal
    await updateDeal(existingDeal.id, {
      value: params.quoteAmountClp,
      title: params.title,
      stageId: params.stageId,
    });
    return { dealId: existingDeal.id, action: 'updated' };
  }

  // Build request body for new deal
  const body: Record<string, unknown> = {
    title: params.title,
    person_id: params.personId,
    pipeline_id: params.pipelineId,
    stage_id: params.stageId,
    value: params.quoteAmountClp,
    currency: 'CLP',
  };

  if (params.orgId) {
    body.org_id = params.orgId;
  }

  // Custom fields (resolved at runtime via fieldOptions)
  const sourceKey = process.env.PIPEDRIVE_DEAL_FIELD_SOURCE_SYSTEM;
  if (sourceKey) {
    const optionId = getOptionId('deal', sourceKey, params.sourceSystem);
    if (optionId !== undefined) body[sourceKey] = optionId;
  }

  const leadTypeKey = process.env.PIPEDRIVE_DEAL_FIELD_LEAD_TYPE;
  if (leadTypeKey) {
    const optionId = getOptionId('deal', leadTypeKey, params.leadType);
    if (optionId !== undefined) body[leadTypeKey] = optionId;
  }

  const tierKey = process.env.PIPEDRIVE_DEAL_FIELD_PRIORITY_TIER;
  if (tierKey) {
    const optionId = getOptionId('deal', tierKey, params.priorityTier);
    if (optionId !== undefined) body[tierKey] = optionId;
  }

  // Store quoteReference and jumpsellerOrderId as custom field values (text fields)
  const quoteRefKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
  if (quoteRefKey && params.quoteReference) {
    body[quoteRefKey] = params.quoteReference;
  }

  const orderIdKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (orderIdKey && params.jumpsellerOrderId) {
    body[orderIdKey] = params.jumpsellerOrderId;
  }

  const res = await pipedrivePost<PipedriveDeal>('/deals', body);

  if (!res.success || !res.data) {
    throw new Error(
      `${LOG_PREFIX} Failed to create deal: ${res.error ?? 'unknown error'}`
    );
  }

  console.log(`${LOG_PREFIX} Created deal: ${res.data.id}`);
  return { dealId: res.data.id, action: 'created' };
}
