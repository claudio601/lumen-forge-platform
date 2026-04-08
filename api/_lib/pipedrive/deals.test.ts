// api/_lib/pipedrive/deals.test.ts
// Pruebas obligatorias — deduplicación deals Jumpseller→Pipedrive (v3)
// Run: vitest --config vitest.api.config.ts
//
// These tests cover all 5 mandatory scenarios defined in the spec.
// The Pipedrive HTTP client is fully mocked — no real API calls are made.

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

import { pipedriveGet, pipedrivePost, pipedrivePut } from '../pipedrive/client.js';
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
  jumpsellerOrderId: 'JS-12753',
  jumpsellerEventType: 'order_paid',
};

/** Fabricates a minimal PipedriveDeal-like response object. */
function makeDeal(
  id: number,
  status: 'open' | 'won' | 'lost' = 'open',
  updatedAt = '2026-04-01T10:00:00.000Z',
  customFieldValue?: string,
): Record<string, unknown> {
  const deal: Record<string, unknown> = {
    id,
    title: `Cotizacion JS-12753 - Cliente Test`,
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

/** Clears the in-memory DJB2 hash map between tests by calling with a dummy deal. */
async function flushHashCache(): Promise<void> {
  // We can't directly reset the private Map, but we can advance time past 1h
  // In tests we rely on the fact that each unique payload hashes differently
  // (we vary jumpsellerOrderId across test cases to avoid cross-test pollution)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createDeal — 4-step Jumpseller deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set required env vars
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
  // TEST 1 — Webhook repetido dentro de 1 hora: lo frena el hash djb2
  // =========================================================================
  it('TEST 1: repeated webhook within 1h is stopped by djb2 hash anti-bounce', async () => {
    // Use a unique orderId so this test is isolated from hash cache
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      quoteReference: 'JS-99001',
      jumpsellerOrderId: 'JS-99001',
      title: 'Cotizacion JS-99001 - Cliente Test',
    };

    // First call: no deal found by custom field → no deal found by title → create
    (pipedriveGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { items: [] },
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 501, title: params.title, status: 'open', pipeline_id: 2 },
    });

    const first = await createDeal(params);
    expect(first.action).toBe('created');
    expect(first.dealId).toBe(501);

    // Second call with IDENTICAL params within the same process (< 1h):
    // must be stopped by hash before any API call
    const apiCallsBefore = (pipedriveGet as ReturnType<typeof vi.fn>).mock.calls.length;
    const second = await createDeal(params);

    expect(second.action).toBe('updated');
    expect(second.dealId).toBe(-1); // sentinel value for hash hit
    // No new API calls should have been made
    const apiCallsAfter = (pipedriveGet as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(apiCallsAfter).toBe(apiCallsBefore);
  });

  // =========================================================================
  // TEST 2 — Webhook repetido días después con custom field existente
  //          → no crea duplicado, agrega nota
  // =========================================================================
  it('TEST 2: webhook re-fired days later, deal found by custom field → no duplicate, note added', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      quoteReference: 'JS-99002',
      jumpsellerOrderId: 'JS-99002',
      title: 'Cotizacion JS-99002 - Cliente Test',
    };

    const existingDeal = makeDeal(42, 'open', '2026-04-01T10:00:00.000Z', 'JS-99002');

    // Step 2: custom field search returns a hit
    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, params?: Record<string, string>) => {
        if (path === '/deals/search' && params?.fields === 'custom_fields') {
          return Promise.resolve({
            success: true,
            data: { items: [{ item: existingDeal }] },
          });
        }
        if (path.startsWith('/deals/42')) {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      },
    );

    // Note POST
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 999 },
    });

    const result = await createDeal(params);

    expect(result.action).toBe('updated');
    expect(result.dealId).toBe(42);

    // Must have added a re-dispatch note
    const noteCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/notes',
    );
    expect(noteCall).toBeDefined();
    const noteBody = noteCall![1] as Record<string, unknown>;
    expect(String(noteBody.content)).toContain('Webhook Jumpseller re-disparado');
    expect(String(noteBody.content)).toContain('order_paid');
    expect(noteBody.deal_id).toBe(42);

    // Must NOT have called pipedrivePost to create a new deal
    const dealCreateCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals',
    );
    expect(dealCreateCall).toBeUndefined();
  });

  // =========================================================================
  // TEST 3 — Caso histórico real: deal renombrado, sin custom field.
  //          Search por custom field no encuentra.
  //          Search por título sí encuentra.
  //          Backfill del custom field.
  //          Nota agregada.
  //          No crea duplicado.
  // =========================================================================
  it('TEST 3 (caso real JS-12753): renamed deal, no custom field, title fallback + backfill + note', async () => {
    // Use a slightly different title to simulate the "renamed" deal
    const renamedDeal = {
      id: 77,
      title: 'Cotizacion JS-12753 - María González (renombrado)',
      status: 'open',
      pipeline_id: 2,
      stage_id: 10,
      update_time: '2026-04-01T09:00:00.000Z',
      add_time: '2026-04-01T08:00:00.000Z',
      // No custom field value set
    };

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, queryParams?: Record<string, string>) => {
        // Step 2: custom field search — returns nothing (no exact match)
        if (path === '/deals/search' && queryParams?.fields === 'custom_fields') {
          return Promise.resolve({ success: true, data: { items: [] } });
        }
        // Step 3: title search — returns the renamed deal
        if (path === '/deals/search' && queryParams?.fields === 'title') {
          return Promise.resolve({
            success: true,
            data: { items: [{ item: renamedDeal }] },
          });
        }
        // Full deal fetch
        if (path === '/deals/77') {
          return Promise.resolve({ success: true, data: renamedDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      },
    );

    // PUT for backfill + POST for note
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 77 },
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 888 },
    });

    const result = await createDeal(BASE_PARAMS);

    expect(result.action).toBe('updated');
    expect(result.dealId).toBe(77);

    // Custom field must have been backfilled via PUT
    const backfillCall = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals/77',
    );
    expect(backfillCall).toBeDefined();
    const backfillBody = backfillCall![1] as Record<string, unknown>;
    expect(backfillBody['cf_js_order_id']).toBe('JS-12753');

    // Re-dispatch note must have been added
    const noteCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/notes',
    );
    expect(noteCall).toBeDefined();
    const noteBody = noteCall![1] as Record<string, unknown>;
    expect(String(noteBody.content)).toContain('Webhook Jumpseller re-disparado');
    expect(noteBody.deal_id).toBe(77);

    // No new deal should have been created
    const dealCreateCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals',
    );
    expect(dealCreateCall).toBeUndefined();
  });

  // =========================================================================
  // TEST 4 — Múltiples resultados: aplica criterio open > most-recent y
  //          loggea warning con todos los IDs
  // =========================================================================
  it('TEST 4: multiple deals found → open wins over closed, most-recent among open wins, warning logged', async () => {
    const params: CreateDealParams = {
      ...BASE_PARAMS,
      quoteReference: 'JS-99004',
      jumpsellerOrderId: 'JS-99004',
      title: 'Cotizacion JS-99004 - Cliente Test',
    };

    const oldOpen = makeDeal(10, 'open', '2026-03-01T10:00:00.000Z', 'JS-99004');
    const newerOpen = makeDeal(11, 'open', '2026-04-05T15:00:00.000Z', 'JS-99004');
    const wonDeal = makeDeal(12, 'won', '2026-04-07T20:00:00.000Z', 'JS-99004');

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, queryParams?: Record<string, string>) => {
        if (path === '/deals/search' && queryParams?.fields === 'custom_fields') {
          return Promise.resolve({
            success: true,
            data: {
              items: [
                { item: oldOpen },
                { item: newerOpen },
                { item: wonDeal },
              ],
            },
          });
        }
        if (path === '/deals/10') return Promise.resolve({ success: true, data: oldOpen });
        if (path === '/deals/11') return Promise.resolve({ success: true, data: newerOpen });
        if (path === '/deals/12') return Promise.resolve({ success: true, data: wonDeal });
        return Promise.resolve({ success: true, data: { items: [] } });
      },
    );

    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 999 },
    });

    const warnSpy = vi.spyOn(console, 'warn');

    const result = await createDeal(params);

    // Should pick deal 11 (open + most recently updated)
    expect(result.dealId).toBe(11);
    expect(result.action).toBe('updated');

    // Warning must include all IDs
    const warnCalls = warnSpy.mock.calls.map((c) => c.join(' '));
    const multipleWarn = warnCalls.find((msg) => msg.includes('Multiple deals found') || msg.includes('WARNING'));
    expect(multipleWarn).toBeDefined();
    // All three IDs should appear in the warning
    expect(multipleWarn).toContain('10');
    expect(multipleWarn).toContain('11');
    expect(multipleWarn).toContain('12');

    warnSpy.mockRestore();
  });

  // =========================================================================
  // TEST 5 — Falta env var del custom field:
  //          log de degradación + fallback por título + no crea duplicado
  // =========================================================================
  it('TEST 5: missing PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID → degraded log + title fallback + no duplicate', async () => {
    // Remove the env var to simulate missing configuration
    delete process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;

    const params: CreateDealParams = {
      ...BASE_PARAMS,
      quoteReference: 'JS-99005',
      jumpsellerOrderId: 'JS-99005',
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

    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, queryParams?: Record<string, string>) => {
        // Step 3 title fallback should be invoked
        if (path === '/deals/search' && queryParams?.fields === 'title') {
          return Promise.resolve({
            success: true,
            data: { items: [{ item: existingDeal }] },
          });
        }
        if (path === '/deals/200') {
          return Promise.resolve({ success: true, data: existingDeal });
        }
        return Promise.resolve({ success: true, data: { items: [] } });
      },
    );

    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 999 },
    });
    // pipedrivePut for backfill attempt (will warn since key missing)
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 200 },
    });

    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');

    const result = await createDeal(params);

    // Should find deal via title fallback, not create a new one
    expect(result.action).toBe('updated');
    expect(result.dealId).toBe(200);

    // Must log the degradation error
    const errorCalls = errorSpy.mock.calls.map((c) => c.join(' '));
    const degradedLog = errorCalls.find(
      (msg) =>
        msg.includes('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID') &&
        (msg.includes('deduplication degraded') || msg.includes('not set')),
    );
    expect(degradedLog).toBeDefined();

    // Backfill should warn that field key is missing (cannot backfill)
    const warnCalls = warnSpy.mock.calls.map((c) => c.join(' '));
    const backfillWarn = warnCalls.find(
      (msg) => msg.includes('jumpseller_order_id') || msg.includes('backfill') || msg.includes('PIPEDRIVE_FIELD'),
    );
    expect(backfillWarn).toBeDefined();

    // No new deal should have been created
    const dealCreateCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals',
    );
    expect(dealCreateCall).toBeUndefined();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
