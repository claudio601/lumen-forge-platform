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
//   1. Paginated Pipedrive search by exact quoteReference; retry query failure once
//   2. Shared quoteReference + pipeline lock, then short Redis mapping and search recheck
//      (save the created deal for 10 minutes to bridge search indexing lag)
//   3. Search/Redis failure: create anyway; warn and annotate uncertain searches
//      (dedupOpenWithinDays: only an open deal that moved in the last N days counts)
//
// /deals/search items are not full deals and carry no pipeline_id: every lookup checks the
// pipeline (and status) on the full deal from GET /deals/{id}.
import { randomUUID } from 'node:crypto';
import { pipedriveGet, pipedrivePost, pipedrivePut } from './client.js';
import { getOptionId } from './fieldOptions.js';
import {
    checkIdempotencyForCreate,
    writeMapping,
    releaseLock,
    readMapping,
    acquireQuoteReferenceLock,
    releaseQuoteReferenceLock,
    readQuoteReferenceMapping,
    writeQuoteReferenceMapping,
    LOCK_RETRY_CHECK_MS,
} from '../idempotency/redis.js';
import type {
    PipedriveDeal,
    PipedriveDealSearchItem,
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
    /** Non-Jumpseller path: only an open deal with the same quoteReference that moved in the last N days is a duplicate. */
    dedupOpenWithinDays?: number;
    notes?: string;
    tipoServicio?: number;
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
    const best = pool.sort(
          (a, b) => new Date(b.update_time).getTime() - new Date(a.update_time).getTime()
        )[0];
    if (deals.length > 1) {
          console.warn(`${LOG_PREFIX} multiple deals found (${deals.map((d) => d.id).join(', ')}); picked ${best.id}`);
    }
    return best;
}

// --- Search by exact Jumpseller custom field ---
async function findDealsByJumpsellerCustomField(
    rawOrderId: string,
    pipelineId: number,
    options: { deadline: number }
): Promise<DealSearchResult> {
    const fieldKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
    if (!fieldKey) return { status: 'absent' }; // title fallback remains available
    return findDealsWithRetry(rawOrderId, pipelineId, options, 'custom_fields',
        (d) => String(d[fieldKey]) === rawOrderId);
}

// 'JS-1423' must not match a title with JS-14236: the reference ends where the digits end.
function titleHasReference(title: string, reference: string): boolean {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}(?!\\d)`).test(title);
}

// Empty field (or no field configured) or already this value.
function fieldEmptyOr(deal: PipedriveDeal, key: string | undefined, expected: string): boolean {
    if (!key) return true;
    const raw = deal[key];
    return raw === null || raw === undefined || String(raw).trim() === '' || String(raw) === expected;
}

// --- Step B: Fallback search by title (legacy deals, pre-custom-field) ---
// Only a legacy deal qualifies: one that carries another order id or quoteReference is another
// request whose title happens to contain JS-<id> (titles include names typed by customers).
async function findDealsByTitle(
    rawOrderId: string,
    pipelineId: number,
    options: { deadline: number }
): Promise<DealSearchResult> {
    const searchTerm = `JS-${rawOrderId}`;
    return findDealsWithRetry(searchTerm, pipelineId, options, 'title', (d) =>
        typeof d.title === 'string' &&
        titleHasReference(d.title, searchTerm) &&
        fieldEmptyOr(d, process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID, rawOrderId) &&
        fieldEmptyOr(d, process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE, searchTerm));
}

// Pipedrive v1 dates come as 'YYYY-MM-DD HH:MM:SS' in UTC (v2: ISO 8601). NaN if unreadable.
function pipedriveTime(value: unknown): number {
    if (typeof value !== 'string') return NaN;
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
    return Date.parse(iso);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEAL_SEARCH_PAGE_SIZE = 10;
const DEAL_SEARCH_MAX_PAGES = 10;
const DEAL_SEARCH_TIMEOUT_MS = 15_000;
const QUOTE_DEDUP_BUDGET_MS = 20_000;
const POSSIBLE_DUPLICATE_NOTE = 'Posible duplicado: la búsqueda de duplicados falló; revisar';

export type DealSearchResult =
    | { status: 'found'; deal: PipedriveDeal }
    | { status: 'absent' }
    | { status: 'failed' | 'incomplete'; reason: string };

// Every attempt has a total budget, including all pages and parallel detail requests.
async function searchDeals(
    quoteReference: string,
    pipelineId: number,
    options: { openWithinDays?: number; deadline?: number; timeoutMs?: number },
    fields: 'custom_fields' | 'title',
    matches: (deal: PipedriveDeal) => boolean
): Promise<DealSearchResult> {
    const deadline = Math.min(Date.now() + (options.timeoutMs ?? DEAL_SEARCH_TIMEOUT_MS), options.deadline ?? Infinity);
    const openOnly = options.openWithinDays !== undefined;
    let start = 0;
    const matched: PipedriveDeal[] = [];
    let detailFailed = false;
    for (let page = 0; page < DEAL_SEARCH_MAX_PAGES; page++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { status: 'failed', reason: 'search_timeout' };
        const query: Record<string, string> = {
            term: quoteReference, fields, exact_match: fields === 'title' ? 'false' : 'true',
            limit: String(DEAL_SEARCH_PAGE_SIZE), start: String(start),
        };
        if (openOnly) query.status = 'open';
        const res = await pipedriveGet<{ items: Array<{ item: PipedriveDealSearchItem }> }>(
            '/deals/search', query, remaining
        );
        if (!res.success || !Array.isArray(res.data?.items)) {
            return { status: 'failed', reason: 'search_request_failed' };
        }
        if (res.data.items.length > 0 && Date.now() >= deadline) {
            return { status: 'failed', reason: 'search_timeout' };
        }
        const fulls = await Promise.all(res.data.items.map(({ item }) =>
            pipedriveGet<PipedriveDeal>(`/deals/${item.id}`, undefined, Math.max(1, deadline - Date.now()))
        ));
        for (const full of fulls) {
            if (!full.success || !full.data) {
                detailFailed = true;
                continue;
            }
            const d = full.data;
            if (d.pipeline_id === pipelineId && matches(d)) matched.push(d);
        }
        const cutoff = Date.now() - (options.openWithinDays ?? 0) * DAY_MS;
        const recent = openOnly
            ? matched.filter((d) => d.status === 'open' && pipedriveTime(d.update_time) >= cutoff)
            : matched;
        if (recent.length > 0) return { status: 'found', deal: pickBestDeal(recent) };
        const pagination = res.additional_data?.pagination;
        if (!pagination?.more_items_in_collection) {
            if (detailFailed) return { status: 'failed', reason: 'detail_request_failed' };
            if (openOnly && matched.length > 0) {
                console.log(JSON.stringify({
                    level: 'info', event: 'dedup_quote_reference_not_counted', quoteReference,
                    dealIds: matched.map((d) => d.id), openWithinDays: options.openWithinDays,
                }));
            }
            return { status: 'absent' };
        }
        const next = pagination.next_start ?? start + DEAL_SEARCH_PAGE_SIZE;
        if (!Number.isInteger(next) || next <= start) return { status: 'incomplete', reason: 'invalid_pagination' };
        start = next;
    }
    return { status: 'incomplete', reason: 'page_limit' };
}

// Retry failed queries once. A page cap is incomplete, never proof of absence.
async function findDealsWithRetry(
    term: string,
    pipelineId: number,
    options: { openWithinDays?: number; deadline?: number; timeoutMs?: number },
    fields: 'custom_fields' | 'title',
    matches: (deal: PipedriveDeal) => boolean
): Promise<DealSearchResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
        let result: DealSearchResult;
        try {
            result = await searchDeals(term, pipelineId, options, fields, matches);
        } catch {
            result = { status: 'failed', reason: 'search_exception' };
        }
        if (result.status !== 'failed' || attempt === 1) return result;
        console.warn(JSON.stringify({ level: 'warn', event: 'quote_search_retry', pipelineId, reason: result.reason }));
    }
    return { status: 'failed', reason: 'search_exception' };
}

export async function findDealByQuoteReference(
    quoteReference: string,
    pipelineId: number,
    options: { openWithinDays?: number; deadline?: number; timeoutMs?: number } = {}
): Promise<DealSearchResult> {
    const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
    if (!fieldKey) return { status: 'failed', reason: 'missing_quote_reference_field' };
    return findDealsWithRetry(quoteReference, pipelineId, options, 'custom_fields',
        (d) => String(d[fieldKey]) === quoteReference);
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

// --- Defensive backfill: quote_reference on canonical deal located via non-quoteRef lookup ---
// Invoked when createDeal locates an existing canonical deal via either
// jumpseller_order_id custom field OR title fallback, AND that deal currently
// has an empty quoteReference. Never overwrites a non-empty existing value
// (preserves audit trail). Logs warning on mismatch instead of overwriting.
async function backfillQuoteReference(
    dealId: number,
    quoteReference: string,
    existingDeal: PipedriveDeal
): Promise<void> {
    const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
    if (!fieldKey) {
          console.warn(`${LOG_PREFIX} quote_ref_backfill_skipped reason=missing_field_key dealId=${dealId}`);
          return;
    }
    if (!quoteReference) {
          console.warn(`${LOG_PREFIX} quote_ref_backfill_skipped reason=empty_quote_reference dealId=${dealId}`);
          return;
    }
    const existingRaw = (existingDeal as Record<string, unknown>)[fieldKey];
    const existingStr =
          existingRaw === null || existingRaw === undefined ? '' : String(existingRaw).trim();
    if (existingStr === quoteReference) {
          return;
    }
    if (existingStr !== '') {
          console.warn(
                  `${LOG_PREFIX} quote_ref_mismatch dealId=${dealId} existing=${existingStr} new=${quoteReference}`
          );
          return;
    }
    try {
          const res = await pipedrivePut<PipedriveDeal>(`/deals/${dealId}`, {
                  [fieldKey]: quoteReference,
          });
          if (!res.success) {
                  console.warn(
                          `${LOG_PREFIX} Failed to backfill quote_reference on deal ${dealId}: ${res.error ?? 'unknown'}`
                  );
          } else {
                  console.log(
                          `${LOG_PREFIX} quote_ref_backfill dealId=${dealId} quoteReference=${quoteReference}`
                  );
          }
    } catch (err) {
          console.warn(`${LOG_PREFIX} Error backfilling quote_reference on deal ${dealId}:`, err);
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
                const searchOptions = { deadline: Date.now() + 10_000, timeoutMs: 5_000 };
                if (fieldKeyConfigured) {
                          const deals = await findDealsByJumpsellerCustomField(rawOrderId!, params.pipelineId, searchOptions);
                          if (deals.status === 'found') {
                                      existingDeal = deals.deal;
                                      await backfillQuoteReference(existingDeal.id, params.quoteReference, existingDeal);
                          }
                }
                if (!existingDeal) {
                          const refDeal = await findDealByQuoteReference(params.quoteReference, params.pipelineId, searchOptions);
                          if (refDeal.status === 'found') {
                                      existingDeal = refDeal.deal;
                                      await backfillJumpsellerOrderId(existingDeal.id, rawOrderId!);
                          }
                }
                if (!existingDeal) {
                          const titleDeals = await findDealsByTitle(rawOrderId!, params.pipelineId, searchOptions);
                          if (titleDeals.status === 'found') {
                                      existingDeal = titleDeals.deal;
                                      await backfillJumpsellerOrderId(existingDeal.id, rawOrderId!);
                                      await backfillQuoteReference(existingDeal.id, params.quoteReference, existingDeal);
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
      let uncertainDealId: number | undefined;
        try {
                // Leave time for the POST and mapping within the existing Jumpseller lease.
                const searchOptions = { deadline: Date.now() + 10_000, timeoutMs: 5_000 };
                const uncertainSearches: string[] = [];
                if (fieldKeyConfigured) {
                          const deals = await findDealsByJumpsellerCustomField(rawOrderId!, params.pipelineId, searchOptions);
                          if (deals.status === 'failed' || deals.status === 'incomplete') uncertainSearches.push(deals.reason);
                          if (deals.status === 'found') {
                                      const best = deals.deal;
                                      console.log(JSON.stringify({ level: 'info', event: 'custom_field_hit', sourceRef, dealId: best.id }));
                                      await backfillQuoteReference(best.id, params.quoteReference, best);
                                      await addDealNote(best.id, `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`);
                                      await writeMapping(rawOrderId!, best.id);
                                      return { dealId: best.id, status: 'updated' };
                          }
                }
                const refDeal = await findDealByQuoteReference(params.quoteReference, params.pipelineId, searchOptions);
                if (refDeal.status === 'failed' || refDeal.status === 'incomplete') uncertainSearches.push(refDeal.reason);
                if (refDeal.status === 'found') {
                          console.log(JSON.stringify({ level: 'info', event: 'quote_ref_hit', sourceRef, dealId: refDeal.deal.id }));
                          await backfillJumpsellerOrderId(refDeal.deal.id, rawOrderId!);
                          await addDealNote(refDeal.deal.id, `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`);
                          await writeMapping(rawOrderId!, refDeal.deal.id);
                          return { dealId: refDeal.deal.id, status: 'updated' };
                }
                const titleDeals = await findDealsByTitle(rawOrderId!, params.pipelineId, searchOptions);
                if (titleDeals.status === 'failed' || titleDeals.status === 'incomplete') uncertainSearches.push(titleDeals.reason);
                if (titleDeals.status === 'found') {
                          const best = titleDeals.deal;
                          console.log(JSON.stringify({ level: 'info', event: 'title_fallback_hit', sourceRef, dealId: best.id }));
                          await backfillJumpsellerOrderId(best.id, rawOrderId!);
                          await backfillQuoteReference(best.id, params.quoteReference, best);
                          await addDealNote(best.id, `Webhook Jumpseller re-disparado: ${new Date().toISOString()}, evento: ${eventType}`);
                          await writeMapping(rawOrderId!, best.id);
                          return { dealId: best.id, status: 'updated' };
                }
                const dealId = await createDealInPipedrive(params, rawOrderId!, sourceRef!);
                await writeMapping(rawOrderId!, dealId);
                if (uncertainSearches.length > 0) {
                    console.warn(JSON.stringify({ level: 'warn', event: 'quote_dedup_uncertain_created', dealId,
                        reasons: uncertainSearches }));
                    uncertainDealId = dealId;
                }
                console.log(JSON.stringify({ level: 'info', event: 'deal_created', sourceRef, dealId, eventType }));
                return { dealId, status: 'created' };
        } finally {
                await releaseLock(rawOrderId!, lockValue);
                if (uncertainDealId !== undefined) await addDealNote(uncertainDealId, POSSIBLE_DUPLICATE_NOTE);
        }
  }

  // =========================================================================
  // NON-JUMPSELLER PATH: search, then serialize and search again before creating.
  // =========================================================================
  // Shared across the initial read, contention and the read under the lock, leaving
  // time for the POST and warning note even when Pipedrive is slow.
  const deadline = Date.now() + QUOTE_DEDUP_BUDGET_MS;
  const options = { openWithinDays: params.dedupOpenWithinDays, deadline };
  const initial = await findDealByQuoteReference(params.quoteReference, params.pipelineId, options);
  if (initial.status === 'found') {
        console.log(JSON.stringify({ level: 'info', event: 'dedup_quote_reference_hit', dealId: initial.deal.id }));
        return { dealId: initial.deal.id, status: 'skipped_duplicate' };
  }

  const lockValue = randomUUID();
  let locked = false;
  while (!locked) {
        const lock = await acquireQuoteReferenceLock(params.quoteReference, params.pipelineId, lockValue);
        if ('unavailable' in lock) {
            console.warn(JSON.stringify({ level: 'warn', event: 'quote_lock_unavailable', pipelineId: params.pipelineId }));
            break;
        }
        locked = lock.acquired;
        if (!locked) {
            if (Date.now() >= deadline) {
                // Fail open rather than lose the order, including a stuck lock.
                console.warn(JSON.stringify({ level: 'warn', event: 'quote_lock_wait_timeout', pipelineId: params.pipelineId }));
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(LOCK_RETRY_CHECK_MS, deadline - Date.now()))));
        }
  }

  let result: DealSearchResult;
  let dealId: number;
  let mappingCheckFailed = false;
  try {
        if (locked) {
            const mapping = await readQuoteReferenceMapping(params.quoteReference, params.pipelineId);
            if (mapping.ok === false) {
                console.warn(JSON.stringify({ level: 'warn', event: 'quote_mapping_read_failed', pipelineId: params.pipelineId }));
            } else if (mapping.dealId !== null) {
                // WhatsApp must still be open/recent: a cached ID alone cannot establish that.
                let reusable = params.dedupOpenWithinDays === undefined;
                if (!reusable) {
                    const remaining = deadline - Date.now();
                    const full = remaining > 0
                        ? await pipedriveGet<PipedriveDeal>(`/deals/${mapping.dealId}`, undefined, remaining)
                        : null;
                    if (!full?.success || !full.data) {
                        mappingCheckFailed = true;
                        console.warn(JSON.stringify({ level: 'warn', event: 'quote_mapping_detail_failed', pipelineId: params.pipelineId, dealId: mapping.dealId }));
                    } else {
                        const d = full.data;
                        const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
                        reusable = d.id === mapping.dealId && d.pipeline_id === params.pipelineId &&
                            !!fieldKey && String(d[fieldKey]) === params.quoteReference && d.status === 'open' &&
                            pipedriveTime(d.update_time) >= Date.now() - params.dedupOpenWithinDays! * DAY_MS;
                    }
                }
                if (reusable) {
                    console.log(JSON.stringify({ level: 'info', event: 'dedup_quote_mapping_hit', dealId: mapping.dealId }));
                    return { dealId: mapping.dealId, status: 'skipped_duplicate' };
                }
            }
        }
        // The initial read may predate another request's POST, especially after contention.
        // Recheck even if Redis went down while waiting and we must proceed unlocked.
        result = await findDealByQuoteReference(params.quoteReference, params.pipelineId, options);
        if (result.status === 'found') {
            console.log(JSON.stringify({ level: 'info', event: 'dedup_quote_reference_hit', dealId: result.deal.id }));
            return { dealId: result.deal.id, status: 'skipped_duplicate' };
        }
        dealId = await createDealInPipedrive(params, undefined, undefined);
        const saved = await writeQuoteReferenceMapping(params.quoteReference, params.pipelineId, dealId);
        if (saved.ok === false) {
            console.warn(JSON.stringify({ level: 'warn', event: 'quote_mapping_write_failed', pipelineId: params.pipelineId, dealId }));
        }
  } finally {
        if (locked) await releaseQuoteReferenceLock(params.quoteReference, params.pipelineId, lockValue);
  }
  if (result.status === 'failed' || result.status === 'incomplete' || mappingCheckFailed) {
        console.warn(JSON.stringify({
            level: 'warn', event: 'quote_dedup_uncertain_created', dealId,
            searchStatus: result.status, reason: result.status === 'failed' || result.status === 'incomplete'
                ? result.reason : 'mapping_detail_request_failed',
        }));
        await addDealNote(dealId, POSSIBLE_DUPLICATE_NOTE);
  }
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
    const tipoServicioKey = process.env.PIPEDRIVE_FIELD_TIPO_SERVICIO;
    if (tipoServicioKey && params.tipoServicio !== undefined) {
          body[tipoServicioKey] = params.tipoServicio;
    }
    const res = await pipedrivePost<PipedriveDeal>('/deals', body);
    if (!res.success || !res.data) {
          throw new Error(`${LOG_PREFIX} Failed to create deal: ${res.error ?? 'unknown error'}`);
    }
    return res.data.id;
}
