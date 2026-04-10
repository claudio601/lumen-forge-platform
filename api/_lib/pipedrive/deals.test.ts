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
          return Promise.resolve({ success: true, data: { items: [{ item: existingDeal }] } });
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
          return Promise.resolve({ success: true, data: { items: [{ item: renamedDeal }] } });
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
            data: { items: [{ item: oldOpen }, { item: newerOpen }, { item: wonDeal }] },
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
          return Promise.resolve({ success: true, data: { items: [{ item: existingDeal }] } });
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
