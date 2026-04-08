// api/_lib/pipedrive/deals.ts
// Create, update, and find Pipedrive deals with idempotency.
// Implements 4-step deduplication for Jumpseller->Pipedrive to prevent
// duplicate deals when Jumpseller re-fires webhooks days after the original.

import { pipedriveGet, pipedrivePost, pipedrivePut } from './client.js';
import { getOptionId } from './fieldOptions.js';
import type {
  PipedriveDeal,
  CreateDealResult,
  LeadType,
  PriorityTier,
  SourceSystem,
} from '../crm/types.js';

// --- Constants ---
const LOG_PREFIX = '[deals]';

// --- DJB2 in-memory anti-bounce (Step 1) ---
// Maps hash -> expiry timestamp (ms). Prevents duplicate processing within 1h.
const _recentHashes = new Map<string, number>();
const HASH_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash;
}

function makePayloadHash(params: CreateDealParams): string {
  const key = [
    params.jumpsellerOrderId ?? '',
    params.quoteReference,
    String(params.quoteAmountClp),
    params.sourceSystem,
  ].join('|');
  return String(djb2(key));
}

/** Returns true if this payload was already seen within the last hour. */
function checkAndSetHash(params: CreateDealParams): boolean {
  const now = Date.now();
  for (const [h, exp] of _recentHashes) {
    if (exp < now) _recentHashes.delete(h);
  }
  const hash = makePayloadHash(params);
  if (_recentHashes.has(hash)) {
    console.log(`${LOG_PREFIX} [step1-hash] Anti-bounce hit -- payload already processed within 1h (hash=${hash})`);
    return true;
  }
  _recentHashes.set(hash, now + HASH_WINDOW_MS);
  return false;
}
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
  jumpsellerOrderId?: string; // Always "JS-{id}" format, never raw number
  jumpsellerEventType?: string; // e.g. "order_created", "order_paid"
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractId(field: { value: number } | number | null | undefined): number | null {
  if (field === null || field === undefined) return null;
  if (typeof field === 'number') return field;
  return field.value ?? null;
}

/** Pick the best deal from a list: open wins, then most-recently-updated. */
function pickBestDeal(deals: PipedriveDeal[]): PipedriveDeal {
  const open = deals.filter((d) => d.status === 'open');
  const pool = open.length > 0 ? open : deals;
  return pool.sort(
    (a, b) => new Date(b.update_time).getTime() - new Date(a.update_time).getTime()
  )[0];
}
// --- Step 2: Search by custom field jumpseller_order_id ---
async function findDealsByJumpsellerCustomField(
  jsOrderId: string,
  pipelineId: number
): Promise<PipedriveDeal[]> {
  const fieldKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (!fieldKey) return [];

  const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
    '/deals/search',
    { term: jsOrderId, fields: 'custom_fields', exact_match: 'true', limit: '10' }
  );
  if (!res.success || !res.data?.items) return [];

  const matched: PipedriveDeal[] = [];
  for (const { item } of res.data.items) {
    if (item.pipeline_id !== pipelineId) continue;
    const full = await pipedriveGet<PipedriveDeal>(`/deals/${item.id}`);
    if (full.success && full.data && String(full.data[fieldKey]) === jsOrderId) {
      matched.push(full.data);
    }
  }
  return matched;
}

// --- Step 3: Fallback search by title ---
async function findDealsByTitle(
  jsOrderId: string,
  pipelineId: number
): Promise<PipedriveDeal[]> {
  const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
    '/deals/search',
    { term: jsOrderId, fields: 'title', exact_match: 'false', limit: '10' }
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
      full.data.title.includes(jsOrderId)
    ) {
      matched.push(full.data);
    }
  }
  return matched;
}
// --- Post a note on a deal ---
async function addDealNote(dealId: number, content: string): Promise<void> {
  try {
    const res = await pipedrivePost<{ id: number }>(
      '/notes',
      { content, deal_id: dealId }
    );
    if (!res.success) {
      console.warn(`${LOG_PREFIX} Failed to add note to deal ${dealId}: ${res.error ?? 'unknown'}`);
    } else {
      console.log(`${LOG_PREFIX} Added re-dispatch note to deal ${dealId}`);
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error adding note to deal ${dealId}:`, err);
  }
}

// --- Backfill custom field on existing deal ---
async function backfillJumpsellerOrderId(dealId: number, jsOrderId: string): Promise<void> {
  const fieldKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (!fieldKey) {
    console.warn(`${LOG_PREFIX} Cannot backfill jumpseller_order_id: PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not set`);
    return;
  }
  try {
    const res = await pipedrivePut<PipedriveDeal>(`/deals/${dealId}`, { [fieldKey]: jsOrderId });
    if (!res.success) {
      console.warn(`${LOG_PREFIX} Failed to backfill jumpseller_order_id on deal ${dealId}: ${res.error ?? 'unknown'}`);
    } else {
      console.log(`${LOG_PREFIX} [step3-backfill] Set ${fieldKey}=${jsOrderId} on deal ${dealId}`);
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
// --- Main entry: createDeal with 4-step Jumpseller deduplication ---
export async function createDeal(params: CreateDealParams): Promise<CreateDealResult> {
  const jsOrderId = params.jumpsellerOrderId; // Always "JS-{id}" or undefined
  const isJumpseller = params.sourceSystem === 'jumpseller' && !!jsOrderId;
  const eventType = params.jumpsellerEventType ?? 'unknown_event';
  const fieldKeyConfigured = !!process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;

  // STEP 1: DJB2 hash anti-bounce (immediate duplicate within 1h)
  if (isJumpseller) {
    const isDuplicate = checkAndSetHash(params);
    if (isDuplicate) {
      console.log(`${LOG_PREFIX} [step1-hash] Returning early -- anti-bounce within 1h`);
      return { dealId: -1, action: 'updated' };
    }
  }

  // STEP 2: Search by custom field jumpseller_order_id (exact match)
  if (isJumpseller) {
    if (!fieldKeyConfigured) {
      console.error(
        `${LOG_PREFIX} [step2-custom-field] PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not set -- deduplication degraded, falling back to title search`
      );
    } else {
      const deals = await findDealsByJumpsellerCustomField(jsOrderId!, params.pipelineId);
      if (deals.length > 0) {
        if (deals.length > 1) {
          const ids = deals.map((d) => d.id).join(', ');
          console.warn(
            `${LOG_PREFIX} [step2-custom-field] WARNING: Multiple deals found for ${jsOrderId} -- IDs: [${ids}]. Applying priority: open > most recent.`
          );
        }
        const best = pickBestDeal(deals);
        console.log(`${LOG_PREFIX} [step2-custom-field] Found existing deal ${best.id} by jumpseller_order_id=${jsOrderId}`);
        const noteContent = `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`;
        await addDealNote(best.id, noteContent);
        return { dealId: best.id, action: 'updated' };
      }
    }
  }

  // STEP 3: Fallback by title (transitional -- deals before custom field existed)
  if (isJumpseller) {
    const deals = await findDealsByTitle(jsOrderId!, params.pipelineId);
    if (deals.length > 0) {
      if (deals.length > 1) {
        const ids = deals.map((d) => d.id).join(', ');
        console.warn(
          `${LOG_PREFIX} [step3-title-fallback] WARNING: Multiple deals found for ${jsOrderId} in title -- IDs: [${ids}]. Applying priority: open > most recent.`
        );
      }
      const best = pickBestDeal(deals);
      console.log(`${LOG_PREFIX} [step3-title-fallback] Found existing deal ${best.id} by title containing ${jsOrderId}`);
      await backfillJumpsellerOrderId(best.id, jsOrderId!);
      const noteContent = `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`;
      await addDealNote(best.id, noteContent);
      return { dealId: best.id, action: 'updated' };
    }
  }
  // STEP 4: No existing deal found -- create new deal
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

  // jumpseller_order_id custom field -- always JS-{id} format
  const orderIdKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (isJumpseller && jsOrderId) {
    if (orderIdKey) {
      body[orderIdKey] = jsOrderId;
      console.log(`${LOG_PREFIX} [step4-create] Setting ${orderIdKey}=${jsOrderId} on new deal`);
    } else {
      console.error(
        `${LOG_PREFIX} [step4-create] PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not set -- creating deal without jumpseller_order_id field (deduplication degraded)`
      );
    }
  }

  const res = await pipedrivePost<PipedriveDeal>('/deals', body);
  if (!res.success || !res.data) {
    throw new Error(`${LOG_PREFIX} Failed to create deal: ${res.error ?? 'unknown error'}`);
  }

  console.log(`${LOG_PREFIX} [step4-create] Created deal: ${res.data.id} (${jsOrderId ?? params.quoteReference})`);
  return { dealId: res.data.id, action: 'created' };
}

// --- Legacy exports for compatibility ---
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
