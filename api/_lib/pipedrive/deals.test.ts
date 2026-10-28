// api/_lib/pipedrive/deals.test.ts
// Pruebas de deduplicación deals Jumpseller->Pipedrive
// Run: vitest --config vitest.api.config.ts
//
// These tests cover the 5 mandatory deduplication scenarios.
// The Pipedrive HTTP client and the idempotency/redis module are fully mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Mock the Pipedrive client before importing deals.ts
// ---------------------------------------------------------------------------
vi.mock('../pipedrive/client.js', () => ({
  pipedriveGet: vi.fn(),
  pipedrivePost: vi.fn(),
  pipedrivePut: vi.fn(),
}));

vi.mock('../pipedrive/fieldOptions.js', () => ({
  getOptionId: vi.fn().mockReturnValue(undefined),
}));

// Mock the Redis idempotency module — default: Redis always available, no existing mapping
vi.mock('../idempotency/redis.js', () => ({
  checkIdempotencyForCreate: vi.fn(),
  readMapping: vi.fn(),
  writeMapping: vi.fn().mockResolvedValue({ ok: true }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  acquireQuoteReferenceLock: vi.fn().mockResolvedValue({ acquired: true }),
  releaseQuoteReferenceLock: vi.fn().mockResolvedValue(undefined),
  readQuoteReferenceMapping: vi.fn().mockResolvedValue({ ok: true, dealId: null }),
  writeQuoteReferenceMapping: vi.fn().mockResolvedValue({ ok: true }),
  QUOTE_LOCK_TTL_MS: 60_000,
  LOCK_RETRY_CHECK_MS: 300,
}));

import { pipedriveGet, pipedrivePost, pipedrivePut } from '../pipedrive/client.js';
import {
  checkIdempotencyForCreate,
  readMapping,
  writeMapping,
} from '../idempotency/redis.js';
import { createDeal } from './deals.js';
import type { CreateDealParams } from './deals.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_PARAMS: CreateDealParams = {
  personId: 1,
  pipelineId: 2,
  stageId: 10,
  title: 'Cotizacion JS-12753 - Cliente Test',
  quoteAmountClp: 150_000,
  sourceSystem: 'jumpseller',
  leadType: 'B2C',
  priorityTier: 'Normal',
  quoteReference: 'JS-12753',
  jumpsellerOrderId: '12753',
  sourceRef: 'jumpseller:12753',
  jumpsellerEventType: 'order_created',
  allowCreate: true,
};

function makeDeal(
  id: number,
  status: 'open' | 'won' | 'lost' = 'open',
  updatedAt = '2026-04-01T10:00:00.000Z',
  customFieldValue?: string
): Record<string, unknown> {
  const deal: Record<string, unknown> = {
    id,
    title: 'Cotizacion JS-12753 - Cliente Test',
    status,
    pipeline_id: 2,
    stage_id: 10,
    update_time: updatedAt,
    add_time: '2026-04-01T08:00:00.000Z',
  };
  const fieldKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (fieldKey && customFieldValue !== undefined) {
    deal[fieldKey] = customFieldValue;
  }
  return deal;
}

// What /deals/search really returns for a deal: not the full deal and no pipeline_id (the
// pipeline comes as `pipeline: { id }`). These mocks used to return full deals with pipeline_id,
// which hid that every lookup discarded what it found.
function searchItem(deal: Record<string, unknown>): Record<string, unknown> {
  return {
    id: deal.id,
    type: 'deal',
    title: deal.title,
    status: deal.status,
    pipeline: { id: deal.pipeline_id },
    stage: { id: deal.stage_id },
    custom_fields: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDeal — Jumpseller deduplication with Redis + Pipedrive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID = 'cf_js_order_id';
    process.env.PIPEDRIVE_DEAL_FIELD_SOURCE_SYSTEM = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_LEAD_TYPE = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_PRIORITY_TIER = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE = undefined as unknown as string;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // TEST 1 — Redis mapping hit: skipped_duplicate returned immediately
  // =========================================================================
  it('TEST 1: Redis mapping hit -> skipped_duplicate, no API calls', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99001',
      sourceRef: 'jumpseller:99001',
      quoteReference: 'JS-99001',
      title: 'Cotizacion JS-99001 - Cliente Test',
    };

    // Redis mapping found -> checkIdempotencyForCreate returns 'duplicate'
    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'duplicate',
      dealId: 501,
    });

    const result = await createDeal(params);

    expect(result.status).toBe('skipped_duplicate');
    expect(result.dealId).toBe(501);

    // No Pipedrive API calls should have been made
    expect((pipedriveGet as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // =========================================================================
  // TEST 2 — Proceed from idempotency, custom field hit -> updated, no duplicate
  // =========================================================================
  it('TEST 2: idempotency proceed, deal found by custom field -> updated + note added', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99002',
      sourceRef: 'jumpseller:99002',
      quoteReference: 'JS-99002',
      title: 'Cotizacion JS-99002 - Cliente Test',
    };

    const existingDeal = makeDeal(42, 'open', '2026-04-01T10:00:00.000Z', '99002');

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-42',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(existingDeal) }] } });
        }
        if (path === '/deals/42') {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );

    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 999 },
    });

    const result = await createDeal(params);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(42);

    // Note must have been added
    const noteCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/notes'
    );
    expect(noteCall).toBeDefined();

    // writeMapping must have been called before lock release
    expect((writeMapping as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);

    // No new deal should have been created
    const dealCreate = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals'
    );
    expect(dealCreate).toBeUndefined();
  });

  // =========================================================================
  // TEST 3 — Title fallback (legacy deal, no custom field) + backfill + note
  // =========================================================================
  it('TEST 3: title fallback on legacy deal -> backfill custom field + note + no duplicate', async () => {
    const renamedDeal = {
      id: 77,
      title: 'Cotizacion JS-12753 - María González (renombrado)',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T09:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
    };

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-77',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [] } });
        }
        if (path === '/deals/search' && qp?.fields === 'title') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(renamedDeal) }] } });
        }
        if (path === '/deals/77') {
          return Promise.resolve({ success: true, data: renamedDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );

    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 77 } });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 888 } });

    const result = await createDeal(BASE_PARAMS);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(77);

    // Custom field must have been backfilled
    const backfillCall = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals/77'
    );
    expect(backfillCall).toBeDefined();
    const backfillBody = backfillCall![1] as Record<string, unknown>;
    expect(backfillBody['cf_js_order_id']).toBe('12753');

    // Note must have been added
    const noteCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/notes'
    );
    expect(noteCall).toBeDefined();

    // No new deal should have been created
    const dealCreate = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals'
    );
    expect(dealCreate).toBeUndefined();
  });

  // =========================================================================
  // TEST 4 — Multiple deals found: open wins, most-recent among open wins
  // =========================================================================
  it('TEST 4: multiple deals found -> open + most-recent wins, warning logged', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99004',
      sourceRef: 'jumpseller:99004',
      quoteReference: 'JS-99004',
      title: 'Cotizacion JS-99004 - Cliente Test',
    };

    const oldOpen   = makeDeal(10, 'open', '2026-03-01T10:00:00.000Z', '99004');
    const newerOpen = makeDeal(11, 'open', '2026-04-05T15:00:00.000Z', '99004');
    const wonDeal   = makeDeal(12, 'won',  '2026-04-07T20:00:00.000Z', '99004');

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-multi',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({
            success: true,
            data: { items: [{ item: searchItem(oldOpen) }, { item: searchItem(newerOpen) }, { item: searchItem(wonDeal) }] },
          });
        }
        if (path === '/deals/10') return Promise.resolve({ success: true, data: oldOpen });
        if (path === '/deals/11') return Promise.resolve({ success: true, data: newerOpen });
        if (path === '/deals/12') return Promise.resolve({ success: true, data: wonDeal });
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const warnSpy = vi.spyOn(console, 'warn');
    const result = await createDeal(params);

    // Should pick deal 11 (open + most recently updated)
    expect(result.dealId).toBe(11);
    expect(result.status).toBe('updated');

    // Warning must reference multiple IDs
    const warnMsgs = warnSpy.mock.calls.map((c) => c.join(' '));
    const multiWarn = warnMsgs.find((m) => m.includes('10') && m.includes('11') && m.includes('12'));
    expect(multiWarn).toBeDefined();

    warnSpy.mockRestore();
  });

  // =========================================================================
  // TEST 5 — Missing PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID: degraded log + title fallback
  // =========================================================================
  it('TEST 5: missing PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID -> degraded log + title fallback', async () => {
    delete process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;

    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99005',
      sourceRef: 'jumpseller:99005',
      quoteReference: 'JS-99005',
      title: 'Cotizacion JS-99005 - Cliente Test',
    };

    const existingDeal = {
      id: 200,
      title: 'Cotizacion JS-99005 - Cliente Test',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T10:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
    };

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-99005',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        // Custom field search skipped (no fieldKey) -> falls through to title
        if (path === '/deals/search' && qp?.fields === 'title') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(existingDeal) }] } });
        }
        if (path === '/deals/200') {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 200 } });

    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy  = vi.spyOn(console, 'warn');

    const result = await createDeal(params);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(200);

    // Must log degradation error
    const errMsgs = errorSpy.mock.calls.map((c) => c.join(' '));
    const degraded = errMsgs.find((m) => m.includes('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID'));
    expect(degraded).toBeDefined();

    // Backfill should warn (field key missing)
    const warnMsgs = warnSpy.mock.calls.map((c) => c.join(' '));
    const backfillWarn = warnMsgs.find(
      (m) =>
        m.includes('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID') ||
        m.includes('backfill') ||
        m.includes('jumpseller_order_id')
    );
    expect(backfillWarn).toBeDefined();

    // No new deal created
    const dealCreate = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals'
    );
    expect(dealCreate).toBeUndefined();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Defensive quote_reference backfill (Ticket H — Fix C)
// ---------------------------------------------------------------------------

describe('createDeal — defensive quote_reference backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID = 'cf_js_order_id';
    process.env.PIPEDRIVE_DEAL_FIELD_SOURCE_SYSTEM = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_LEAD_TYPE = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_PRIORITY_TIER = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE = 'cf_quote_ref';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // TEST 6 — Custom field HIT, deal has empty quoteReference -> backfill PUT
  // =========================================================================
  it('TEST 6: custom field hit on deal with empty quoteReference -> quote_ref_backfill PUT', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99006',
      sourceRef: 'jumpseller:99006',
      quoteReference: 'JS-99006',
      title: 'Cotizacion JS-99006 - Cliente Test',
    };

    const existingDeal = {
      id: 600,
      title: '1301-2026',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T10:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
      cf_js_order_id: '99006',
      // cf_quote_ref intentionally absent (the bug scenario)
    };

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-600',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(existingDeal) }] } });
        }
        if (path === '/deals/600') {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );

    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 600 } });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const logSpy = vi.spyOn(console, 'log');
    const result = await createDeal(params);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(600);

    // Backfill PUT must have happened with the quote_reference field
    const backfillCalls = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === '/deals/600'
    );
    const quoteRefBackfill = backfillCalls.find(
      (c) => (c[1] as Record<string, unknown>)['cf_quote_ref'] === 'JS-99006'
    );
    expect(quoteRefBackfill).toBeDefined();

    // Success log must be emitted
    const logMsgs = logSpy.mock.calls.map((c) => c.join(' '));
    const backfillLog = logMsgs.find((m) => m.includes('quote_ref_backfill') && m.includes('600'));
    expect(backfillLog).toBeDefined();

    logSpy.mockRestore();
  });

  // =========================================================================
  // TEST 7 — Custom field HIT, deal already has matching quoteReference -> no PUT
  // =========================================================================
  it('TEST 7: custom field hit, deal already has matching quoteReference -> no backfill PUT', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99007',
      sourceRef: 'jumpseller:99007',
      quoteReference: 'JS-99007',
      title: 'Cotizacion JS-99007 - Cliente Test',
    };

    const existingDeal = {
      id: 700,
      title: 'Cotizacion JS-99007 - Cliente Test',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T10:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
      cf_js_order_id: '99007',
      cf_quote_ref: 'JS-99007', // already matches
    };

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-700',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(existingDeal) }] } });
        }
        if (path === '/deals/700') {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );

    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 700 } });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const result = await createDeal(params);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(700);

    // No PUT should target /deals/700 with cf_quote_ref (already matches → no-op)
    const quoteRefBackfill = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) =>
        c[0] === '/deals/700' &&
        Object.prototype.hasOwnProperty.call(c[1] as Record<string, unknown>, 'cf_quote_ref')
    );
    expect(quoteRefBackfill).toBeUndefined();
  });

  // =========================================================================
  // TEST 8 — Custom field HIT, deal has DIFFERENT quoteReference -> warn + no PUT
  // =========================================================================
  it('TEST 8: custom field hit, existing quote_ref differs -> mismatch warn, no overwrite', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99008',
      sourceRef: 'jumpseller:99008',
      quoteReference: 'JS-99008',
      title: 'Cotizacion JS-99008 - Cliente Test',
    };

    const existingDeal = {
      id: 800,
      title: 'manually edited',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T10:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
      cf_js_order_id: '99008',
      cf_quote_ref: 'WSP-555', // human-edited to a different ref
    };

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-800',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(existingDeal) }] } });
        }
        if (path === '/deals/800') {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );

    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 800 } });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const warnSpy = vi.spyOn(console, 'warn');
    const result = await createDeal(params);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(800);

    // No PUT should overwrite the cf_quote_ref field
    const quoteRefBackfill = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) =>
        c[0] === '/deals/800' &&
        Object.prototype.hasOwnProperty.call(c[1] as Record<string, unknown>, 'cf_quote_ref')
    );
    expect(quoteRefBackfill).toBeUndefined();

    // Mismatch warn must be logged with both values
    const warnMsgs = warnSpy.mock.calls.map((c) => c.join(' '));
    const mismatchWarn = warnMsgs.find(
      (m) => m.includes('quote_ref_mismatch') && m.includes('WSP-555') && m.includes('JS-99008')
    );
    expect(mismatchWarn).toBeDefined();

    warnSpy.mockRestore();
  });

  // =========================================================================
  // TEST 9 — Title fallback HIT -> both backfills (jumpsellerOrderId + quote_ref)
  // =========================================================================
  it('TEST 9: title fallback hit -> backfills both jumpsellerOrderId AND quote_reference', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99009',
      sourceRef: 'jumpseller:99009',
      quoteReference: 'JS-99009',
      title: 'Cotizacion JS-99009 - Cliente Test',
    };

    const renamedDeal = {
      id: 900,
      title: 'Cotizacion JS-99009 - María González (renombrado)',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T09:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
      // no cf_js_order_id, no cf_quote_ref — pure legacy
    };

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-900',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [] } });
        }
        if (path === '/deals/search' && qp?.fields === 'title') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(renamedDeal) }] } });
        }
        if (path === '/deals/900') {
          return Promise.resolve({ success: true, data: renamedDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );

    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 900 } });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const result = await createDeal(params);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(900);

    const putsTo900 = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === '/deals/900'
    );

    // jumpsellerOrderId backfill PUT
    const orderIdBackfill = putsTo900.find(
      (c) => (c[1] as Record<string, unknown>)['cf_js_order_id'] === '99009'
    );
    expect(orderIdBackfill).toBeDefined();

    // quote_reference backfill PUT
    const quoteRefBackfill = putsTo900.find(
      (c) => (c[1] as Record<string, unknown>)['cf_quote_ref'] === 'JS-99009'
    );
    expect(quoteRefBackfill).toBeDefined();
  });

  // =========================================================================
  // TEST 10 — PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE not set -> skip + warn
  // =========================================================================
  it('TEST 10: missing PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE -> backfill skipped + warn', async () => {
    delete process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;

    const params: CreateDealParams = {
      ...BASE_PARAMS,
      jumpsellerOrderId: '99010',
      sourceRef: 'jumpseller:99010',
      quoteReference: 'JS-99010',
      title: 'Cotizacion JS-99010 - Cliente Test',
    };

    const existingDeal = {
      id: 1000,
      title: 'Cotizacion JS-99010 - Cliente Test',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T10:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
      cf_js_order_id: '99010',
    };

    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-1000',
    });

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(existingDeal) }] } });
        }
        if (path === '/deals/1000') {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );

    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 1000 } });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const warnSpy = vi.spyOn(console, 'warn');
    const result = await createDeal(params);

    expect(result.status).toBe('updated');
    expect(result.dealId).toBe(1000);

    // No PUT should have written cf_quote_ref (env was missing)
    const quoteRefBackfill = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) =>
        c[0] === '/deals/1000' &&
        Object.prototype.hasOwnProperty.call(c[1] as Record<string, unknown>, 'cf_quote_ref')
    );
    expect(quoteRefBackfill).toBeUndefined();

    // Warn must include missing_field_key reason
    const warnMsgs = warnSpy.mock.calls.map((c) => c.join(' '));
    const skipWarn = warnMsgs.find(
      (m) => m.includes('quote_ref_backfill_skipped') && m.includes('missing_field_key')
    );
    expect(skipWarn).toBeDefined();

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// quoteReference dedup on the real /deals/search shape (nuevo_elights and WhatsApp)
// ---------------------------------------------------------------------------

describe('createDeal — quoteReference dedup with the real search result', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Pipedrive v1 date: 'YYYY-MM-DD HH:MM:SS' in UTC.
  const v1Time = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 19).replace('T', ' ');

  const WA_REF = 'WA-56900000000';
  const WA_PARAMS: CreateDealParams = {
    personId: 1,
    pipelineId: 2,
    stageId: 10,
    title: 'WhatsApp Lead — Test',
    quoteAmountClp: 0,
    sourceSystem: 'whatsapp',
    leadType: 'B2C',
    priorityTier: 'Normal',
    quoteReference: WA_REF,
    dedupOpenWithinDays: 7,
  };

  function fullDeal(
    id: number,
    status: 'open' | 'won' | 'lost',
    updateTime: string,
    pipelineId = 2,
    ref = WA_REF
  ): Record<string, unknown> {
    return {
      id,
      title: 'WhatsApp Lead — Test',
      status,
      pipeline_id: pipelineId,
      stage_id: 10,
      update_time: updateTime,
      add_time: updateTime,
      cf_quote_ref: ref,
    };
  }

  function mockPipedrive(deals: Array<Record<string, unknown>>) {
    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/deals/search') {
        return Promise.resolve({ success: true, data: { items: deals.map((d) => ({ result_score: 1, item: searchItem(d) })) } });
      }
      const deal = deals.find((d) => path === `/deals/${d.id}`);
      return Promise.resolve(deal ? { success: true, data: deal } : { success: false, data: null });
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });
  }

  const createdDeal = () =>
    (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/deals');
  const searchQuery = () =>
    (pipedriveGet as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/deals/search')?.[1] as
      | Record<string, string>
      | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
    process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE = 'cf_quote_ref';
    process.env.PIPEDRIVE_DEAL_FIELD_SOURCE_SYSTEM = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_LEAD_TYPE = undefined as unknown as string;
    process.env.PIPEDRIVE_DEAL_FIELD_PRIORITY_TIER = undefined as unknown as string;
  });

  it('TEST 11: a form reference already in Pipedrive -> skipped_duplicate (the search item has no pipeline_id)', async () => {
    const existing = fullDeal(31459, 'open', v1Time(0), 2, 'NE-abc1234');
    mockPipedrive([existing]);

    const result = await createDeal({ ...WA_PARAMS, sourceSystem: 'nuevo_elights', quoteReference: 'NE-abc1234', dedupOpenWithinDays: undefined });

    expect(result).toEqual({ dealId: 31459, status: 'skipped_duplicate' });
    expect(createdDeal()).toBeUndefined();
    expect(searchQuery()?.status).toBeUndefined();
  });

  it('TEST 12: same reference in another pipeline -> a new deal is created', async () => {
    mockPipedrive([fullDeal(500, 'open', v1Time(0), 3)]);

    const result = await createDeal(WA_PARAMS);

    expect(result).toEqual({ dealId: 999, status: 'created' });
    expect(createdDeal()).toBeDefined();
  });

  it('TEST 13: WhatsApp, open deal that moved 2 days ago -> joined to it, searching only open deals', async () => {
    mockPipedrive([fullDeal(31651, 'open', v1Time(2))]);

    const result = await createDeal(WA_PARAMS);

    expect(result).toEqual({ dealId: 31651, status: 'skipped_duplicate' });
    expect(createdDeal()).toBeUndefined();
    expect(searchQuery()).toMatchObject({ term: WA_REF, fields: 'custom_fields', exact_match: 'true', status: 'open' });
  });

  it('TEST 14: WhatsApp, open deal without movement for 10 days -> new deal, and the log says why', async () => {
    mockPipedrive([fullDeal(30328, 'open', v1Time(10))]);
    const logSpy = vi.spyOn(console, 'log');

    const result = await createDeal(WA_PARAMS);

    expect(result).toEqual({ dealId: 999, status: 'created' });
    const notCounted = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('dedup_quote_reference_not_counted'));
    expect(notCounted).toBeDefined();
    expect(JSON.parse(notCounted!)).toMatchObject({ dealIds: [30328], openWithinDays: 7 });
    logSpy.mockRestore();
  });

  it('TEST 15: WhatsApp, won deal from yesterday -> new deal (a won deal is never reused)', async () => {
    mockPipedrive([fullDeal(31774, 'won', v1Time(1))]);

    const result = await createDeal(WA_PARAMS);

    expect(result).toEqual({ dealId: 999, status: 'created' });
  });

  it('TEST 16: WhatsApp, two open deals in the window -> the one that moved last', async () => {
    mockPipedrive([fullDeal(31687, 'open', v1Time(5)), fullDeal(32012, 'open', v1Time(1))]);

    const result = await createDeal(WA_PARAMS);

    expect(result).toEqual({ dealId: 32012, status: 'skipped_duplicate' });
  });

  it('TEST 17: Jumpseller title fallback, order 1423 does not take the deal titled JS-14236', async () => {
    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-1423',
    });
    const other = { ...makeDeal(300, 'open'), title: 'Cotizacion JS-14236 - Otro cliente' };
    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'title') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(other) }] } });
        }
        if (path === '/deals/300') return Promise.resolve({ success: true, data: other });
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const result = await createDeal({
      ...BASE_PARAMS,
      jumpsellerOrderId: '1423',
      sourceRef: 'jumpseller:1423',
      quoteReference: 'JS-1423',
      title: 'Cotizacion JS-1423 - Cliente Test',
    });

    expect(result).toEqual({ dealId: 999, status: 'created' });
  });

  it('TEST 18: Jumpseller title fallback skips a deal whose title has JS-1423 but whose quoteReference is another request', async () => {
    (checkIdempotencyForCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'proceed',
      lockValue: 'lock-token-1423',
    });
    // A form request whose customer typed "JS-1423" in the company name.
    const other = { ...makeDeal(301, 'open'), title: 'Cotizacion web - Empresa JS-1423', cf_quote_ref: 'NE-abc1234' };
    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, qp?: Record<string, string>) => {
        if (path === '/deals/search' && qp?.fields === 'title') {
          return Promise.resolve({ success: true, data: { items: [{ item: searchItem(other) }] } });
        }
        if (path === '/deals/301') return Promise.resolve({ success: true, data: other });
        return Promise.resolve({ success: true, data: { items: [] } });
      }
    );
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 999 } });

    const result = await createDeal({
      ...BASE_PARAMS,
      jumpsellerOrderId: '1423',
      sourceRef: 'jumpseller:1423',
      quoteReference: 'JS-1423',
      title: 'Cotizacion JS-1423 - Cliente Test',
    });

    expect(result).toEqual({ dealId: 999, status: 'created' });
    expect(
      (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/deals/301')
    ).toBeUndefined();
  });
});
