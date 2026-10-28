// Uses the real Pipedrive client and Redis module with fetch intercepted at the boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeal, findDealByQuoteReference, type CreateDealParams } from './deals.js';
import {
  acquireQuoteReferenceLock, quoteReferenceLockKey, releaseQuoteReferenceLock,
  quoteReferenceMappingKey, writeQuoteReferenceMapping, QUOTE_MAPPING_TTL_S,
} from '../idempotency/redis.js';
import { createFakeRedis, fakeFetch, UPSTASH_URL, type FakeRedis } from '../../_tests/fakeUpstash.js';

vi.mock('./fieldOptions.js', () => ({ getOptionId: vi.fn().mockReturnValue(undefined) }));

const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 86_400_000;
const NOTE = 'Posible duplicado: la búsqueda de duplicados falló; revisar';
const PARAMS: CreateDealParams = {
  personId: 1, pipelineId: 2, stageId: 10, title: 'Pedido de prueba', quoteAmountClp: 1000,
  sourceSystem: 'whatsapp', leadType: 'B2C', priorityTier: 'Normal',
  quoteReference: 'WA-56900000000', dedupOpenWithinDays: 7,
};
const deal = (extra: Record<string, unknown> = {}) => ({
  id: 101, status: 'open', pipeline_id: 2, stage_id: 10, title: PARAMS.title,
  update_time: new Date(Date.now()).toISOString(), cf_quote_ref: PARAMS.quoteReference, ...extra,
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = (ids: number[], more = false, next = 10) => response({
  success: true, data: { items: ids.map((id) => ({ item: { id, type: 'deal' } })) },
  additional_data: { pagination: { more_items_in_collection: more, next_start: next } },
});

describe('quoteReference — query failures, pagination and shared locks', () => {
  let redis: FakeRedis;
  let redisFetch: ReturnType<typeof fakeFetch>;
  let deals: ReturnType<typeof deal>[];
  let notes: unknown[];
  let search: (url: URL, init: RequestInit) => Response | Promise<Response>;
  let detail: (id: number, init: RequestInit) => Response | Promise<Response>;
  let postFails: boolean;
  let searchCalls: number;
  let createCalls: number;

  beforeEach(() => {
    vi.stubEnv('PIPEDRIVE_API_TOKEN', 'invented-test-token');
    vi.stubEnv('PIPEDRIVE_BASE_URL', 'https://pipedrive.example/v1');
    vi.stubEnv('PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE', 'cf_quote_ref');
    vi.stubEnv('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID', '');
    vi.stubEnv('PIPEDRIVE_DEAL_FIELD_SOURCE_SYSTEM', '');
    vi.stubEnv('PIPEDRIVE_DEAL_FIELD_LEAD_TYPE', '');
    vi.stubEnv('PIPEDRIVE_DEAL_FIELD_PRIORITY_TIER', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'invented-test-token');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    redis = createFakeRedis();
    redisFetch = fakeFetch(redis);
    deals = [];
    notes = [];
    postFails = false;
    searchCalls = createCalls = 0;
    search = () => page(deals.map((d) => d.id));
    detail = (id) => response({ success: true, data: deals.find((d) => d.id === id) });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      if (url.origin === UPSTASH_URL) return redisFetch(input, init);
      if (url.origin !== 'https://pipedrive.example') throw new Error('Unexpected network request');
      if (url.pathname === '/v1/deals/search') {
        searchCalls++;
        return search(url, init);
      }
      if (url.pathname === '/v1/deals' && init.method === 'POST') {
        createCalls++;
        if (postFails) return response({ success: false }, 503);
        const created = deal({ ...JSON.parse(String(init.body)), id: 999 });
        deals.push(created);
        return response({ success: true, data: created });
      }
      if (url.pathname === '/v1/notes' && init.method === 'POST') {
        notes.push(JSON.parse(String(init.body)));
        return response({ success: true, data: { id: 44 } });
      }
      if (/^\/v1\/deals\/\d+$/.test(url.pathname)) return detail(Number(url.pathname.split('/').pop()), init);
      throw new Error('Unexpected Pipedrive path');
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const warning = (event: string) => expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(event));
  const uncertainCreated = () => {
    expect(createCalls).toBe(1);
    expect(notes).toEqual([{ deal_id: 999, content: NOTE }]);
    warning('quote_dedup_uncertain_created');
  };

  it('search failure: retry once per search, then create with the warning note', async () => {
    search = () => response({ success: false, error: 'test failure' }, 503);
    expect(await findDealByQuoteReference(PARAMS.quoteReference, 2)).toEqual({ status: 'failed', reason: 'search_request_failed' });
    expect(searchCalls).toBe(2);
    searchCalls = 0;
    expect(await createDeal(PARAMS)).toEqual({ dealId: 999, status: 'created' });
    expect(searchCalls).toBe(4); // initial search + mandatory recheck inside the lock
    uncertainCreated();
  });

  it('a failed detail is uncertainty, not absence', async () => {
    deals = [deal()];
    detail = () => response({ success: false }, 503);
    await createDeal(PARAMS);
    expect(searchCalls).toBe(4);
    uncertainCreated();
  });

  it('retry succeeds with a duplicate: reuse it with no POST or warning note', async () => {
    deals = [deal()];
    search = () => searchCalls === 1 ? response({ success: false }, 503) : page([101]);
    expect(await createDeal(PARAMS)).toEqual({ dealId: 101, status: 'skipped_duplicate' });
    expect(searchCalls).toBe(2);
    expect(createCalls).toBe(0);
    expect(notes).toEqual([]);
  });

  it('detail retry succeeds and reuses the deal', async () => {
    deals = [deal()];
    detail = () => searchCalls === 1 ? response({ success: false }, 503) : response({ success: true, data: deals[0] });
    expect(await createDeal(PARAMS)).toEqual({ dealId: 101, status: 'skipped_duplicate' });
    expect(searchCalls).toBe(2);
    expect(createCalls).toBe(0);
    expect(notes).toEqual([]);
  });

  it('retry succeeds with absence: create without an uncertainty note', async () => {
    search = () => searchCalls === 1 ? response({ success: false }, 503) : page([]);
    await createDeal(PARAMS);
    expect(searchCalls).toBe(3);
    expect(createCalls).toBe(1);
    expect(notes).toEqual([]);
  });

  it('real HTTP timeout: abort, retry and create with a note', async () => {
    vi.useFakeTimers();
    search = (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const pending = createDeal(PARAMS);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ dealId: 999, status: 'created' });
    expect(searchCalls).toBe(2); // 15 s first attempt, 5 s remaining for its retry
    uncertainCreated();
    expect(redis.data.has(quoteReferenceLockKey(PARAMS.quoteReference, 2))).toBe(false);
    expect(redis.data.get(quoteReferenceMappingKey(PARAMS.quoteReference, 2))?.value).toBe('999');
  });

  it('the 15 s budget covers the whole search, not each page separately', async () => {
    vi.useFakeTimers();
    search = (url, init) => {
      if (url.searchParams.get('start') === '0') {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(page([], true)), 10_000);
          init.signal!.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    const pending = createDeal(PARAMS);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ dealId: 999, status: 'created' });
    expect(searchCalls).toBe(3); // 10 s page one, 5 s page two, 5 s retry before total budget expires
    uncertainCreated();
    expect(redis.data.has(quoteReferenceLockKey(PARAMS.quoteReference, 2))).toBe(false);
    expect(redis.data.get(quoteReferenceMappingKey(PARAMS.quoteReference, 2))?.value).toBe('999');
  });

  it('two simultaneous creates: both initially see absence, but only one POST under the shared lock', async () => {
    let unblock!: () => void;
    const bothSearching = new Promise<void>((resolve) => { unblock = resolve; });
    search = async () => {
      if (searchCalls <= 2) {
        const captured = page([]);
        if (searchCalls === 2) unblock();
        await bothSearching;
        return captured;
      }
      // Every later search must hold the reference/pipeline lock.
      expect(redis.data.has(quoteReferenceLockKey(PARAMS.quoteReference, 2))).toBe(true);
      return page(deals.map((d) => d.id));
    };
    const results = await Promise.all([createDeal(PARAMS), createDeal(PARAMS)]);
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'skipped_duplicate']);
    expect(results.map((r) => r.dealId)).toEqual([999, 999]);
    expect(createCalls).toBe(1);
    expect(redis.data.has(quoteReferenceLockKey(PARAMS.quoteReference, 2))).toBe(false);
    expect(redis.data.get(quoteReferenceMappingKey(PARAMS.quoteReference, 2))?.value).toBe('999');
    expect(notes).toEqual([]);
  });

  it.each(['whatsapp', 'nuevo_elights'] as const)('sequential %s requests with stale search create only once', async (sourceSystem) => {
    const params = { ...PARAMS, sourceSystem, dedupOpenWithinDays: sourceSystem === 'whatsapp' ? 7 : undefined };
    search = () => page([]); // Newly created deals never appear in search.
    const workingFetch = fakeFetch(redis);
    redisFetch.mockImplementation(async (input, init) => {
      const [cmd, key] = new URL(String(input)).pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (key === quoteReferenceMappingKey(params.quoteReference, 2) && (cmd === 'GET' || cmd === 'SET')) {
        expect(redis.data.has(quoteReferenceLockKey(params.quoteReference, 2))).toBe(true);
      }
      return workingFetch(input, init);
    });
    const mappedDetail = vi.fn((id: number) => {
      expect(redis.data.has(quoteReferenceLockKey(params.quoteReference, 2))).toBe(true);
      return response({ success: true, data: deals.find((d) => d.id === id) });
    });
    detail = mappedDetail;
    expect(await createDeal(params)).toEqual({ dealId: 999, status: 'created' });
    expect(await createDeal(params)).toEqual({ dealId: 999, status: 'skipped_duplicate' });
    expect(createCalls).toBe(1);
    expect(searchCalls).toBe(3); // Two for the first call; only the initial search for the second.
    expect(mappedDetail).toHaveBeenCalledTimes(sourceSystem === 'whatsapp' ? 1 : 0);
    expect(notes).toEqual([]);
    const commands = redisFetch.mock.calls.map(([input]) => new URL(String(input)).pathname.split('/').filter(Boolean).map(decodeURIComponent));
    const mappingKey = quoteReferenceMappingKey(params.quoteReference, 2);
    const savedAt = commands.findIndex(([cmd, key]) => cmd === 'SET' && key === mappingKey);
    const releasedAt = commands.findIndex(([cmd]) => cmd === 'EVAL');
    expect(savedAt).toBeGreaterThan(-1);
    expect(savedAt).toBeLessThan(releasedAt);
    expect(commands[savedAt]).toEqual(['SET', mappingKey, '999', 'EX', '600']);
    const mappedRead = commands.findIndex(([cmd, key], i) => i > releasedAt && cmd === 'GET' && key === mappingKey);
    expect(mappedRead).toBeGreaterThan(releasedAt);
  });

  it('an expired mapping no longer prevents creation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    search = () => page([]);
    await createDeal(PARAMS);
    await vi.advanceTimersByTimeAsync(QUOTE_MAPPING_TTL_S * 1000 - 1);
    expect(await createDeal(PARAMS)).toEqual({ dealId: 999, status: 'skipped_duplicate' });
    await vi.advanceTimersByTimeAsync(1);
    expect(await createDeal(PARAMS)).toEqual({ dealId: 999, status: 'created' });
    expect(createCalls).toBe(2);
  });

  it.each([
    { status: 'won' }, { status: 'lost' }, { pipeline_id: 3 },
    { cf_quote_ref: 'WA-56900000001' }, { update_time: new Date(NOW - 8 * DAY).toISOString() },
  ])('WhatsApp mapping does not reuse an ineligible deal: %o', async (extra) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    search = () => page([]);
    deals = [deal(extra)];
    await writeQuoteReferenceMapping(PARAMS.quoteReference, 2, 101);
    expect(await createDeal(PARAMS)).toEqual({ dealId: 999, status: 'created' });
    expect(createCalls).toBe(1);
    expect(redis.data.get(quoteReferenceMappingKey(PARAMS.quoteReference, 2))?.value).toBe('999');
    expect(notes).toEqual([]);
  });

  it.each([
    ['read', 'network'], ['write', 'network'], ['read', 'HTTP'], ['write', 'HTTP'],
  ])('mapping %s %s error fails open, logs and releases the lock', async (op, kind) => {
    const workingFetch = fakeFetch(redis);
    redisFetch.mockImplementation(async (input, init) => {
      const [cmd, key] = new URL(String(input)).pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (key === quoteReferenceMappingKey(PARAMS.quoteReference, 2) && cmd === (op === 'read' ? 'GET' : 'SET')) {
        if (kind === 'HTTP') return response({ error: 'test unavailable' }, 503);
        throw new TypeError('fetch failed');
      }
      return workingFetch(input, init);
    });
    expect(await createDeal(PARAMS)).toEqual({ dealId: 999, status: 'created' });
    expect(createCalls).toBe(1);
    warning(`quote_mapping_${op}_failed`);
    expect(redis.data.has(quoteReferenceLockKey(PARAMS.quoteReference, 2))).toBe(false);
    expect(notes).toEqual([]);
    const logs = vi.mocked(console.warn).mock.calls.map(([entry]) => String(entry)).join('\n');
    expect(logs).not.toContain(PARAMS.quoteReference.slice(3));
  });

  it('WhatsApp mapped detail timeout shares the remaining dedup budget and creates with a note', async () => {
    vi.useFakeTimers();
    await writeQuoteReferenceMapping(PARAMS.quoteReference, 2, 101);
    search = () => new Promise((resolve) => setTimeout(() => resolve(page([])), 5_000));
    detail = (_id, init) => {
      expect(redis.data.has(quoteReferenceLockKey(PARAMS.quoteReference, 2))).toBe(true);
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    const pending = createDeal(PARAMS);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ dealId: 999, status: 'created' });
    expect(searchCalls).toBe(1); // Initial search took 5 s; GET used the remaining 15 s.
    warning('quote_mapping_detail_failed');
    uncertainCreated();
    expect(redis.data.has(quoteReferenceLockKey(PARAMS.quoteReference, 2))).toBe(false);
  });

  it('mapping and lock share the digest, isolate pipelines and omit the raw reference', () => {
    const key = quoteReferenceMappingKey(PARAMS.quoteReference, 2);
    expect(key).toBe(quoteReferenceLockKey(PARAMS.quoteReference, 2).replace('lock:', 'idempotency:'));
    expect(key).not.toContain(PARAMS.quoteReference.slice(3));
    expect(key).not.toBe(quoteReferenceMappingKey(PARAMS.quoteReference, 3));
    expect(key).not.toBe(quoteReferenceMappingKey('WA-56900000001', 2));
  });

  it.each(['network', 'HTTP', 'unconfigured'])('Redis %s error: create anyway and log it', async (kind) => {
    if (kind === 'network') redis.down = true;
    if (kind === 'HTTP') redisFetch.mockImplementation(async () => response({ error: 'test unavailable' }, 503));
    if (kind === 'unconfigured') vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    expect(await createDeal(PARAMS)).toEqual({ dealId: 999, status: 'created' });
    expect(createCalls).toBe(1);
    warning('quote_lock_unavailable');
    expect(notes).toEqual([]);
  });

  it('valid candidate on page two, after old or irrelevant candidates on page one', async () => {
    deals = [deal({ id: 100, update_time: new Date(Date.now() - 10 * DAY).toISOString() }), deal()];
    search = (url) => url.searchParams.get('start') === '0' ? page([100], true) : page([101]);
    expect(await createDeal(PARAMS)).toEqual({ dealId: 101, status: 'skipped_duplicate' });
    expect(searchCalls).toBe(2);
    expect(createCalls).toBe(0);
  });

  it('page cap: incomplete, create with note, without treating it as absence or retrying the cap', async () => {
    search = (url) => page([], true, Number(url.searchParams.get('start')) + 10);
    expect(await findDealByQuoteReference(PARAMS.quoteReference, 2)).toEqual({ status: 'incomplete', reason: 'page_limit' });
    expect(searchCalls).toBe(10);
    searchCalls = 0;
    await createDeal(PARAMS);
    expect(searchCalls).toBe(20);
    uncertainCreated();
  });

  it('failure on page two retries from page one and finds the candidate', async () => {
    deals = [deal()];
    search = (url) => {
      if (url.searchParams.get('start') === '0') return page([], true);
      return searchCalls === 2 ? response({ success: false }, 503) : page([101]);
    };
    expect(await createDeal(PARAMS)).toEqual({ dealId: 101, status: 'skipped_duplicate' });
    expect(searchCalls).toBe(4);
    expect(createCalls).toBe(0);
  });

  it('a valid match remains a duplicate even if a different detail fails', async () => {
    deals = [deal()];
    search = () => page([101, 102]);
    expect(await createDeal(PARAMS)).toEqual({ dealId: 101, status: 'skipped_duplicate' });
    expect(createCalls).toBe(0);
  });

  it('non-advancing pagination is incomplete', async () => {
    search = () => page([], true, 0);
    await createDeal(PARAMS);
    expect(searchCalls).toBe(2);
    uncertainCreated();
  });

  it('missing quote field configuration is failed, and creation gets the note', async () => {
    vi.stubEnv('PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE', '');
    await createDeal(PARAMS);
    uncertainCreated();
  });

  it.each([
    { status: 'won' }, { status: 'lost' }, { pipeline_id: 3 },
    { cf_quote_ref: PARAMS.quoteReference + '1' },
    { update_time: new Date(NOW - 7 * DAY - 1).toISOString() },
  ])('preserves WhatsApp exclusions: %o', async (extra) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    deals = [deal(extra)];
    expect(await createDeal(PARAMS)).toEqual({ dealId: 999, status: 'created' });
    expect(notes).toEqual([]);
  });

  it('exactly seven days, Pipedrive v1 UTC: duplicate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    deals = [deal({ update_time: new Date(NOW - 7 * DAY).toISOString().slice(0, 19).replace('T', ' ') })];
    expect(await createDeal(PARAMS)).toEqual({ dealId: 101, status: 'skipped_duplicate' });
    expect(createCalls).toBe(0);
  });

  it('POST failure releases the lock and propagates the creation failure', async () => {
    postFails = true;
    await expect(createDeal(PARAMS)).rejects.toThrow('Failed to create deal');
    expect(redis.data.size).toBe(0);
    expect(notes).toEqual([]);
  });

  it('a stuck lock has a bounded wait and creation continues with a fresh search', async () => {
    vi.useFakeTimers();
    redis.data.set(quoteReferenceLockKey(PARAMS.quoteReference, 2), { value: 'stuck-owner' });
    const pending = createDeal(PARAMS);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ dealId: 999, status: 'created' });
    expect(searchCalls).toBe(1); // no budget remains for another HTTP request
    expect(createCalls).toBe(1);
    expect(notes).toEqual([{ deal_id: 999, content: NOTE }]);
    warning('quote_lock_wait_timeout');
    expect(redis.data.get(quoteReferenceLockKey(PARAMS.quoteReference, 2))?.value).toBe('stuck-owner');
  });

  const jsParams: CreateDealParams = {
    ...PARAMS, sourceSystem: 'jumpseller', jumpsellerOrderId: '42', quoteReference: 'JS-42',
    sourceRef: 'jumpseller:42', dedupOpenWithinDays: undefined,
  };

  it.each(['custom_fields', 'title'])('Jumpseller %s: candidate on the second page', async (fields) => {
    vi.stubEnv('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID', fields === 'custom_fields' ? 'cf_js_order' : '');
    deals = [deal({ title: 'Cotizacion JS-42', cf_js_order: '42', cf_quote_ref: 'JS-42' })];
    search = (url) => {
      const term = fields === 'title' ? 'JS-42' : '42';
      if (url.searchParams.get('fields') !== fields || url.searchParams.get('term') !== term) return page([]);
      return url.searchParams.get('start') === '0' ? page([], true) : page([101]);
    };
    expect(await createDeal(jsParams)).toEqual({ dealId: 101, status: 'updated' });
    expect(createCalls).toBe(0);
    expect(notes).not.toContainEqual({ deal_id: 101, content: NOTE });
  });

  it.each(['custom_fields', 'title'])('Jumpseller %s: page cap creates with uncertainty note', async (fields) => {
    vi.stubEnv('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID', fields === 'custom_fields' ? 'cf_js_order' : '');
    search = (url) => {
      const term = fields === 'title' ? 'JS-42' : '42';
      if (url.searchParams.get('fields') !== fields || url.searchParams.get('term') !== term) return page([]);
      return page([], true, Number(url.searchParams.get('start')) + 10);
    };
    expect(await createDeal(jsParams)).toEqual({ dealId: 999, status: 'created' });
    uncertainCreated();
  });

  it('Jumpseller custom-field failure is remembered even when later searches return absence', async () => {
    vi.stubEnv('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID', 'cf_js_order');
    search = (url) => url.searchParams.get('term') === '42' ? response({ success: false }, 503) : page([]);
    expect(await createDeal(jsParams)).toEqual({ dealId: 999, status: 'created' });
    expect(searchCalls).toBe(4); // failed search + retry, quote search, title search
    uncertainCreated();
    // A mapping was written and the lock released before posting the warning note.
    expect(redis.data.get('idempotency:jumpseller:42')?.value).toBe('999');
    expect(redis.data.has('lock:jumpseller:42')).toBe(false);
  });

  it('Jumpseller timeout retries once within the shared search budget, then creates with note', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID', 'cf_js_order');
    search = (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const pending = createDeal(jsParams);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ dealId: 999, status: 'created' });
    expect(searchCalls).toBe(2);
    uncertainCreated();
  });

  it('Jumpseller still blocks creation with Redis unconfigured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    expect(await createDeal(jsParams)).toEqual({ dealId: null, status: 'blocked_idempotency_unavailable' });
    expect(createCalls).toBe(0);
    expect(searchCalls).toBe(0);
  });

  it('lock keys use the full SHA-256 digest and contain no WhatsApp phone digits', async () => {
    const key = quoteReferenceLockKey(PARAMS.quoteReference, 2);
    expect(key).toMatch(/^lock:quote-reference:2:[a-f0-9]{64}$/);
    expect(key).not.toContain(PARAMS.quoteReference);
    expect(key).not.toContain(PARAMS.quoteReference.slice(3));
    // Known SHA-256 vector: prevents a different hash from satisfying the shape check.
    expect(quoteReferenceLockKey('abc', 2)).toBe(
      'lock:quote-reference:2:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    await acquireQuoteReferenceLock(PARAMS.quoteReference, 2, 'owner');
    expect([...redis.data.keys()]).toEqual([key]);
    const redisRequests = redisFetch.mock.calls.map(([input]) => decodeURIComponent(String(input))).join('\n');
    expect(redisRequests).not.toContain(PARAMS.quoteReference.slice(3));
  });

  it('different references produce different lock keys', () => {
    expect(quoteReferenceLockKey(PARAMS.quoteReference, 2)).not.toBe(
      quoteReferenceLockKey('WA-56900000001', 2)
    );
  });

  it('the same reference and pipeline always produce the same lock key', () => {
    expect(quoteReferenceLockKey(PARAMS.quoteReference, 2)).toBe(
      quoteReferenceLockKey(PARAMS.quoteReference, 2)
    );
  });

  it('new retry, unavailable-lock and uncertain-create logs omit the WhatsApp reference', async () => {
    redis.down = true;
    search = () => response({ success: false, error: 'test failure' }, 503);
    await createDeal(PARAMS);
    for (const event of ['quote_search_retry', 'quote_lock_unavailable', 'quote_dedup_uncertain_created']) {
      const logs = vi.mocked(console.warn).mock.calls
        .map(([entry]) => String(entry)).filter((entry) => entry.includes(event));
      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        expect(log).not.toContain(PARAMS.quoteReference);
        expect(log).not.toContain(PARAMS.quoteReference.slice(3));
      }
    }
  });

  it('locks separate pipelines/references, expire after PX, and release only their own token', async () => {
    vi.useFakeTimers();
    expect(await acquireQuoteReferenceLock(PARAMS.quoteReference, 2, 'owner')).toEqual({ acquired: true });
    expect(await acquireQuoteReferenceLock(PARAMS.quoteReference, 2, 'other')).toEqual({ acquired: false });
    expect(await acquireQuoteReferenceLock(PARAMS.quoteReference, 3, 'other')).toEqual({ acquired: true });
    expect(await acquireQuoteReferenceLock(PARAMS.quoteReference + '1', 2, 'other')).toEqual({ acquired: true });
    await releaseQuoteReferenceLock(PARAMS.quoteReference, 2, 'other');
    expect(redis.data.get(quoteReferenceLockKey(PARAMS.quoteReference, 2))?.value).toBe('owner');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await acquireQuoteReferenceLock(PARAMS.quoteReference, 2, 'new-owner')).toEqual({ acquired: true });
    await releaseQuoteReferenceLock(PARAMS.quoteReference, 2, 'owner');
    expect(redis.data.get(quoteReferenceLockKey(PARAMS.quoteReference, 2))?.value).toBe('new-owner');
  });
});
