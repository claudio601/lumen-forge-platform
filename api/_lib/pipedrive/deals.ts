// api/_lib/pipedrive/deals.ts
// Create, update, and find Pipedrive deals with full idempotency.
//
// Deduplication order for Jumpseller events:
//   1. Redis mapping check (idempotency:jumpseller:{orderId} -> dealId)
//   2. Distributed lock (lock:jumpseller:{orderId} SET NX PX 30000)
//   3. Redis re-check post-lock (race guard)
//   4. Pipedrive custom field search (exact match by PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID)
//   5. Pipedrive title fallback (legacy deals without custom field)
//   6. Create only if: allowCreate=true AND lock held AND no duplicate found
//
// Deduplication for nuevo_elights (NON-JUMPSELLER) events:
//   1. Pipedrive custom field search by PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE (exact match)
//   2. Create only if no existing deal found with that quoteReference
import { pipedriveGet, pipedrivePost, pipedrivePut } from './client.js';
import { getOptionId } from './fieldOptions.js';
import {
    checkIdempotencyForCreate,
    writeMapping,
    releaseLock,
    readMapping,
} from '../idempotency/redis.js';
import type {
    PipedriveDeal,
    CreateDealResult,
    DealResultStatus,
    LeadType,
    PriorityTier,
    SourceSystem,
} from '../crm/types.js';

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
    sourceRef?: string;
    jumpsellerEventType?: string;
    allowCreate?: boolean;
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
function extractId(field: { value: number } | number | null | undefined): number | null {
    if (field === null || field === undefined) return null;
    if (typeof field === 'number') return field;
    return field.value ?? null;
}

void extractId;

function pickBestDeal(deals: PipedriveDeal[]): PipedriveDeal {
    const open = deals.filter((d) => d.status === 'open');
    const pool = open.length > 0 ? open : deals;
    return pool.sort(
          (a, b) => new Date(b.update_time).getTime() - new Date(a.update_time).getTime()
        )[0];
}

// --- Step A: Search by custom field jumpseller_order_id (exact match) ---
async function findDealsByJumpsellerCustomField(
    rawOrderId: string,
    pipelineId: number
  ): Promise<PipedriveDeal[]> {
    const fieldKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
    if (!fieldKey) return [];
    const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
          '/deals/search',
      { term: rawOrderId, fields: 'custom_fields', exact_match: 'true', limit: '10' }
        );
    if (!res.success || !res.data?.items) return [];
    const matched: PipedriveDeal[] = [];
    for (const { item } of res.data.items) {
          if (item.pipeline_id !== pipelineId) continue;
          const full = await pipedriveGet<PipedriveDeal>(`/deals/${item.id}`);
          if (full.success && full.data && String(full.data[fieldKey]) === rawOrderId) {
                  matched.push(full.data);
          }
    }
    return matched;
}

// --- Step B: Fallback search by title (legacy deals, pre-custom-field) ---
async function findDealsByTitle(
    rawOrderId: string,
    pipelineId: number
  ): Promise<PipedriveDeal[]> {
    const searchTerm = `JS-${rawOrderId}`;
    const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
          '/deals/search',
      { term: searchTerm, fields: 'title', exact_match: 'false', limit: '10' }
        );
    if (!res.success || !res.data?.items) return [];
    const matched: PipedriveDeal[] = [];
    for (const { item } of res.data.items) {
          if (item.pipeline_id !== pipelineId) continue;
          const full = await pipedriveGet<PipedriveDeal>(`/deals/${item.id}`);
          if (
                  full.success &&
                  full.data &&
                  typeof full.data.title === 'string' &&
                  full.data.title.includes(searchTerm)
                ) {
                  matched.push(full.data);
          }
    }
    return matched;
}

// --- Fix 1: Search by quoteReference custom field (nuevo_elights dedup) ---
async function findDealByQuoteReference(
    quoteReference: string,
    pipelineId: number
  ): Promise<PipedriveDeal | null> {
    const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
    if (!fieldKey) return null;
    const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
          '/deals/search',
      { term: quoteReference, fields: 'custom_fields', exact_match: 'true', limit: '5' }
        );
    if (!res.success || !res.data?.items) return null;
    for (const { item } of res.data.items) {
          if (item.pipeline_id !== pipelineId) continue;
          const full = await pipedriveGet<PipedriveDeal>(`/deals/${item.id}`);
          if (
                  full.success &&
                  full.data &&
                  String(full.data[fieldKey]) === quoteReference
                ) {
                  return full.data;
          }
    }
    return null;
}

// --- Add a note to a deal ---
async function addDealNote(dealId: number, content: string): Promise<void> {
    try {
          const res = await pipedrivePost<{ id: number }>('/notes', { content, deal_id: dealId });
          if (!res.success) {
                  console.warn(`${LOG_PREFIX} Failed to add note to deal ${dealId}: ${res.error ?? 'unknown'}`);
          } else {
                  console.log(`${LOG_PREFIX} Added re-dispatch note to deal ${dealId}`);
          }
    } catch (err) {
          console.warn(`${LOG_PREFIX} Error adding note to deal ${dealId}:`, err);
    }
}

// --- Backfill custom field on legacy deal ---
async function backfillJumpsellerOrderId(dealId: number, rawOrderId: string): Promise<void> {
    const fieldKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
    if (!fieldKey) {
          console.warn(JSON.stringify({ level: 'warn', event: 'backfill_skipped', reason: 'PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not set', dealId }));
          return;
    }
    try {
          const res = await pipedrivePut<PipedriveDeal>(`/deals/${dealId}`, { [fieldKey]: rawOrderId });
          if (!res.success) {
                  console.warn(`${LOG_PREFIX} Failed to backfill jumpseller_order_id on deal ${dealId}: ${res.error ?? 'unknown'}`);
          } else {
                  console.log(JSON.stringify({ level: 'info', event: 'title_fallback_hit_backfill', dealId, rawOrderId, fieldKey }));
          }
    } catch (err) {
          console.warn(`${LOG_PREFIX} Error backfilling deal ${dealId}:`, err);
    }
}

// --- Update deal ---
export async function updateDeal(dealId: number, updates: DealUpdateFields): Promise<void> {
    const body: Record<string, unknown> = {};
    if (updates.stageId !== undefined) body.stage_id = updates.stageId;
    if (updates.value !== undefined) body.value = updates.value;
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.status !== undefined) body.status = updates.status;
    for (const [key, value] of Object.entries(updates)) {
          if (!['stageId', 'value', 'title', 'status'].includes(key) && value !== undefined && value !== null && value !== '') {
                  body[key] = value;
          }
    }
    if (Object.keys(body).length === 0) {
          console.log(`${LOG_PREFIX} No fields to update for deal ${dealId}, skipping`);
          return;
    }
    const res = await pipedrivePut<PipedriveDeal>(`/deals/${dealId}`, body);
    if (!res.success) {
          throw new Error(`${LOG_PREFIX} Failed to update deal ${dealId}: ${res.error ?? 'unknown error'}`);
    }
    console.log(`${LOG_PREFIX} Updated deal: ${dealId}`);
}

// --- Main entry: createDeal with full idempotency ---
export async function createDeal(params: CreateDealParams): Promise<CreateDealResult> {
    const rawOrderId = params.jumpsellerOrderId;
    const sourceRef = params.sourceRef;
    const isJumpseller = params.sourceSystem === 'jumpseller' && !!rawOrderId;
    const eventType = params.jumpsellerEventType ?? 'unknown_event';
    const allowCreate = params.allowCreate !== false;
    const fieldKeyConfigured = !!process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;

  if (!fieldKeyConfigured && isJumpseller) {
        console.error(JSON.stringify({ level: 'error', event: 'custom_field_missing', sourceRef, message: 'PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not set' }));
  }

  // =========================================================================
  // JUMPSELLER PATH: Full Redis + Distributed Lock + Pipedrive dedup
  // =========================================================================
  if (isJumpseller) {
        if (!allowCreate) {
                let existingDeal: PipedriveDeal | null = null;
                const mapping = await readMapping(rawOrderId!);
                if ('unavailable' in mapping) {
                          console.warn(JSON.stringify({ level: 'warn', event: 'redis_unavailable_on_update_event', sourceRef, eventType }));
                          return { dealId: null, status: 'skipped_update_without_existing' };
                }
                if (mapping.found) {
                          const dealId = Number(mapping.dealId);
                          await addDealNote(dealId, `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`);
                          console.log(JSON.stringify({ level: 'info', event: 'updated', sourceRef, dealId, eventType }));
                          return { dealId, status: 'updated' };
                }
                if (fieldKeyConfigured) {
                          const deals = await findDealsByJumpsellerCustomField(rawOrderId!, params.pipelineId);
                          if (deals.length > 0) existingDeal = pickBestDeal(deals);
                }
                if (!existingDeal) {
                          const titleDeals = await findDealsByTitle(rawOrderId!, params.pipelineId);
                          if (titleDeals.length > 0) {
                                      existingDeal = pickBestDeal(titleDeals);
                                      await backfillJumpsellerOrderId(existingDeal.id, rawOrderId!);
                          }
                }
                if (!existingDeal) {
                          console.log(JSON.stringify({ level: 'info', event: 'skipped_update_without_existing', sourceRef, eventType }));
                          return { dealId: null, status: 'skipped_update_without_existing' };
                }
                await addDealNote(existingDeal.id, `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`);
                await writeMapping(rawOrderId!, existingDeal.id);
                console.log(JSON.stringify({ level: 'info', event: 'updated', sourceRef, dealId: existingDeal.id, eventType }));
                return { dealId: existingDeal.id, status: 'updated' };
        }

      const idemResult = await checkIdempotencyForCreate(rawOrderId!);
        switch (idemResult.status) {
          case 'duplicate':
          case 'contention_resolved_duplicate':
                    console.log(JSON.stringify({ level: 'info', event: 'duplicate_skipped', sourceRef, dealId: idemResult.dealId, reason: idemResult.status }));
                    return { dealId: idemResult.dealId!, status: 'skipped_duplicate' };
          case 'contention_unresolved':
                    console.log(JSON.stringify({ level: 'info', event: 'skipped_lock_contention', sourceRef }));
                    return { dealId: null, status: 'skipped_lock_contention' };
          case 'blocked':
                    console.error(JSON.stringify({ level: 'error', event: 'blocked_idempotency_unavailable', sourceRef, error: idemResult.error }));
                    return { dealId: null, status: 'blocked_idempotency_unavailable' };
          case 'proceed':
                    break;
        }

      const lockValue = idemResult.lockValue!;
        try {
                if (fieldKeyConfigured) {
                          const deals = await findDealsByJumpsellerCustomField(rawOrderId!, params.pipelineId);
                          if (deals.length > 0) {
                                      const best = pickBestDeal(deals);
                                      console.log(JSON.stringify({ level: 'info', event: 'custom_field_hit', sourceRef, dealId: best.id }));
                                      await addDealNote(best.id, `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`);
                                      await writeMapping(rawOrderId!, best.id);
                                      return { dealId: best.id, status: 'updated' };
                          }
                }
                const titleDeals = await findDealsByTitle(rawOrderId!, params.pipelineId);
                if (titleDeals.length > 0) {
                          const best = pickBestDeal(titleDeals);
                          console.log(JSON.stringify({ level: 'info', event: 'title_fallback_hit', sourceRef, dealId: best.id }));
                          await backfillJumpsellerOrderId(best.id, rawOrderId!);
                          await addDealNote(best.id, `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`);
                          await writeMapping(rawOrderId!, best.id);
                          return { dealId: best.id, status: 'updated' };
                }
                const dealId = await createDealInPipedrive(params, rawOrderId!, sourceRef!);
                await writeMapping(rawOrderId!, dealId);
                console.log(JSON.stringify({ level: 'info', event: 'deal_created', sourceRef, dealId, eventType }));
                return { dealId, status: 'created' };
        } finally {
                await releaseLock(rawOrderId!, lockValue);
        }
  }

  // =========================================================================
  // NON-JUMPSELLER PATH (nuevo_elights): Pipedrive-only dedup by quoteReference
  // Fix 1: search for existing deal by quoteReference before creating.
  // =========================================================================
  const existingDeal = await findDealByQuoteReference(params.quoteReference, params.pipelineId);
    if (existingDeal) {
          console.log(JSON.stringify({
                  level: 'info',
                  event: 'dedup_quote_reference_hit',
                  quoteReference: params.quoteReference,
                  dealId: existingDeal.id,
                  message: 'Deal with this quoteReference already exists — skipping create',
          }));
          return { dealId: existingDeal.id, status: 'skipped_duplicate' };
    }

  const dealId = await createDealInPipedrive(params, undefined, undefined);
    console.log(`${LOG_PREFIX} Created deal: ${dealId} (${params.quoteReference})`);
    return { dealId, status: 'created' };
}

// --- Internal: create a deal in Pipedrive (shared by both paths) ---
async function createDealInPipedrive(
    params: CreateDealParams,
    rawOrderId: string | undefined,
    sourceRef: string | undefined
  ): Promise<number> {
    const body: Record<string, unknown> = {
          title: params.title,
          person_id: params.personId,
          pipeline_id: params.pipelineId,
          stage_id: params.stageId,
          value: params.quoteAmountClp,
          currency: 'CLP',
    };
    if (params.orgId) body.org_id = params.orgId;
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
    const quoteRefKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
    if (quoteRefKey && params.quoteReference) {
          body[quoteRefKey] = params.quoteReference;
    }
    const orderIdKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
    if (rawOrderId) {
          if (orderIdKey) {
                  body[orderIdKey] = rawOrderId;
                  console.log(JSON.stringify({ level: 'info', event: 'create_with_custom_field', sourceRef, rawOrderId, fieldKey: orderIdKey }));
          } else {
                  console.error(JSON.stringify({ level: 'error', event: 'custom_field_missing_on_create', sourceRef }));
          }
    }
    const res = await pipedrivePost<PipedriveDeal>('/deals', body);
    if (!res.success || !res.data) {
          throw new Error(`${LOG_PREFIX} Failed to create deal: ${res.error ?? 'unknown error'}`);
    }
    return res.data.id;
}

// --- Legacy export for compatibility ---
export async function findExistingDeal(
    params: Pick<CreateDealParams, 'quoteReference' | 'jumpsellerOrderId' | 'personId' | 'pipelineId'>
  ): Promise<PipedriveDeal | null> {
    if (params.jumpsellerOrderId) {
          const deals = await findDealsByJumpsellerCustomField(params.jumpsellerOrderId, params.pipelineId);
          if (deals.length > 0) return pickBestDeal(deals);
          const titleDeals = await findDealsByTitle(params.jumpsellerOrderId, params.pipelineId);
          if (titleDeals.length > 0) return pickBestDeal(titleDeals);
    }
    return null;
}
