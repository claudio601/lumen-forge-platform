// api/_lib/whatsapp/notify.test.ts
// Idempotency contract for followup_24h activity creation in WhatsApp path.
// Ticket A — H1 fix.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the Pipedrive client and field options before importing notify.ts
// ---------------------------------------------------------------------------
vi.mock('../pipedrive/client.js', () => ({
  pipedriveGet: vi.fn(),
  pipedrivePost: vi.fn(),
  pipedrivePut: vi.fn(),
}));

vi.mock('../pipedrive/fieldOptions.js', () => ({
  getBooleanOptionId: vi.fn(),
}));

import { pipedriveGet, pipedrivePost, pipedrivePut } from '../pipedrive/client.js';
import { getBooleanOptionId } from '../pipedrive/fieldOptions.js';
import { notifyTeam } from './notify.js';
import type { NotifyParams } from './notify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIELD_KEY = 'cf_followup_24';
const YES_ID = 52;
const NO_ID = 53;

const BASE_PARAMS: NotifyParams = {
  phone: '+56911112222',
  name: 'Cliente Test',
  message: 'Hola, necesito una cotización',
  summary: 'Lead WhatsApp eLIGHTS',
  dealId: 4242,
  personId: 1010,
};

function makeDeal(flagValue?: number | string | null): Record<string, unknown> {
  const deal: Record<string, unknown> = {
    id: 4242,
    title: 'WhatsApp Lead — Cliente Test',
    status: 'open',
    pipeline_id: 1,
    stage_id: 1,
  };
  if (flagValue !== undefined) {
    deal[FIELD_KEY] = flagValue;
  }
  return deal;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notifyTeam — followup_24h idempotency (Ticket A H1 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24 = FIELD_KEY;
    process.env.PIPEDRIVE_OWNER_USER_ID = '777';
    process.env.PIPEDRIVE_ACTIVITY_TYPE = 'task';

    (getBooleanOptionId as ReturnType<typeof vi.fn>).mockImplementation(
      (_entity: string, _key: string, value: boolean) => (value ? YES_ID : NO_ID)
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // TEST 1 — flag empty -> activity created + flag written
  // =========================================================================
  it('TEST 1: flag null -> createActivity called + markFollowup24Created PUT', async () => {
    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/deals/4242') {
        return Promise.resolve({ success: true, data: makeDeal(null) });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 9001 },
    });
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 4242 },
    });

    await notifyTeam(BASE_PARAMS);

    // Activity created
    const activityCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/activities'
    );
    expect(activityCall).toBeDefined();

    // Flag written with YES_ID
    const markCall = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals/4242'
    );
    expect(markCall).toBeDefined();
    expect((markCall![1] as Record<string, unknown>)[FIELD_KEY]).toBe(YES_ID);
  });

  // =========================================================================
  // TEST 2 — flag already "Sí" -> skip + dedup log + no PUT, no activity
  // =========================================================================
  it('TEST 2: flag = YES_ID -> skip createActivity + dedup_followup_24h_skipped log', async () => {
    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/deals/4242') {
        return Promise.resolve({ success: true, data: makeDeal(YES_ID) });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 0 } });
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { id: 4242 } });

    const logSpy = vi.spyOn(console, 'log');
    await notifyTeam(BASE_PARAMS);

    // No activity POST
    const activityCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/activities'
    );
    expect(activityCall).toBeUndefined();

    // No mark PUT (already marked)
    const markCall = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals/4242'
    );
    expect(markCall).toBeUndefined();

    // Dedup log
    const logMsgs = logSpy.mock.calls.map((c) => c.join(' '));
    const dedupLog = logMsgs.find(
      (m) => m.includes('dedup_followup_24h_skipped') && m.includes('4242')
    );
    expect(dedupLog).toBeDefined();

    logSpy.mockRestore();
  });

  // =========================================================================
  // TEST 3 — flag = "No" (NO_ID) -> activity created + flag written
  // =========================================================================
  it('TEST 3: flag = NO_ID -> createActivity called + flag written to YES_ID', async () => {
    (pipedriveGet as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/deals/4242') {
        return Promise.resolve({ success: true, data: makeDeal(NO_ID) });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 9003 },
    });
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 4242 },
    });

    await notifyTeam(BASE_PARAMS);

    const activityCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/activities'
    );
    expect(activityCall).toBeDefined();

    const markCall = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals/4242'
    );
    expect(markCall).toBeDefined();
    expect((markCall![1] as Record<string, unknown>)[FIELD_KEY]).toBe(YES_ID);
  });

  // =========================================================================
  // TEST 4 — env var missing -> fail-open: warn + activity created
  // =========================================================================
  it('TEST 4: PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24 missing -> fail-open warn + activity created', async () => {
    delete process.env.PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24;

    (pipedriveGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: makeDeal(null),
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 9004 },
    });
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 4242 },
    });

    const warnSpy = vi.spyOn(console, 'warn');
    await notifyTeam(BASE_PARAMS);

    // Activity created (fail-open)
    const activityCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/activities'
    );
    expect(activityCall).toBeDefined();

    // Two fail-open warns expected: one from hasFollowup24Created and one from
    // markFollowup24Created (both detect the missing env var).
    const warnMsgs = warnSpy.mock.calls.map((c) => c.join(' '));
    const failOpenWarn = warnMsgs.find(
      (m) => m.includes('missing_env_var') && m.includes('4242')
    );
    expect(failOpenWarn).toBeDefined();

    warnSpy.mockRestore();
  });

  // =========================================================================
  // TEST 5 — getBooleanOptionId returns undefined -> fail-open
  // =========================================================================
  it('TEST 5: option id unresolved -> fail-open warn + activity created', async () => {
    (getBooleanOptionId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    (pipedriveGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: makeDeal(null),
    });
    (pipedrivePost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 9005 },
    });
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 4242 },
    });

    const warnSpy = vi.spyOn(console, 'warn');
    await notifyTeam(BASE_PARAMS);

    const activityCall = (pipedrivePost as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/activities'
    );
    expect(activityCall).toBeDefined();

    const warnMsgs = warnSpy.mock.calls.map((c) => c.join(' '));
    const failOpenWarn = warnMsgs.find(
      (m) => m.includes('option_unresolved') && m.includes('4242')
    );
    expect(failOpenWarn).toBeDefined();

    warnSpy.mockRestore();
  });

  // =========================================================================
  // TEST 6 — createActivity throws -> flag NOT written (rollback semantics)
  // =========================================================================
  it('TEST 6: createActivity throws -> markFollowup24Created NOT called', async () => {
    (pipedriveGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: makeDeal(null),
    });
    // /activities POST fails -> createActivity throws
    (pipedrivePost as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/activities') {
        return Promise.resolve({ success: false, error: 'pipedrive 500' });
      }
      return Promise.resolve({ success: true, data: { id: 0 } });
    });
    (pipedrivePut as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 4242 },
    });

    const errorSpy = vi.spyOn(console, 'error');
    await notifyTeam(BASE_PARAMS);

    // Mark PUT must NOT have been called (createActivity threw before it)
    const markCall = (pipedrivePut as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === '/deals/4242'
    );
    expect(markCall).toBeUndefined();

    // Error logged but not re-thrown
    const errMsgs = errorSpy.mock.calls.map((c) => c.join(' '));
    const activityErr = errMsgs.find((m) => m.includes('Error creando actividad'));
    expect(activityErr).toBeDefined();

    errorSpy.mockRestore();
  });
});
