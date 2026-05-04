// scripts/analyze-cross-channel-duplicates.test.ts

import { describe, expect, it } from 'vitest';
import {
  findSubgroupA,
  findSubgroupB,
  findSubgroupC,
  pairsToCsv,
  summarize,
  type PipedriveDeal,
} from './analyze-cross-channel-duplicates.js';

const FIELD = 'quoteRef';

function deal(overrides: Partial<PipedriveDeal> & { id: number }): PipedriveDeal {
  const base: PipedriveDeal = {
    id: overrides.id,
    title: '',
    add_time: '2026-01-01 00:00:00',
    pipeline_id: 2,
    owner_name: null,
    org_id: null,
    organization: null,
    value: 0,
    currency: 'CLP',
    [FIELD]: null,
  };
  return { ...base, ...overrides };
}

// ───────────────────────────────────────────────────────────────────────────
// Subgrupo C
// ───────────────────────────────────────────────────────────────────────────

describe('findSubgroupC', () => {
  it('T1: same org_id, one with quoteRef and one without -> reports a pair', async () => {
    const deals = [
      deal({ id: 1, [FIELD]: 'JS-100', org_id: 42, add_time: '2026-04-01 10:00:00' }),
      deal({ id: 2, [FIELD]: '', org_id: 42, add_time: '2026-04-05 10:00:00' }),
    ];
    const pairs = await findSubgroupC(deals, FIELD, async () => {
      throw new Error('should not fetch emails when org matches');
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].dealWithRefId).toBe(1);
    expect(pairs[0].dealWithoutRefId).toBe(2);
    expect(pairs[0].matchReason).toBe('org');
    expect(pairs[0].matchValue).toBe('42');
    expect(pairs[0].daysBetween).toBe(4);
  });

  it('T2: no overlap -> no pair', async () => {
    const deals = [
      deal({ id: 1, [FIELD]: 'JS-100', org_id: 42 }),
      deal({ id: 2, [FIELD]: '', org_id: 99 }),
    ];
    const pairs = await findSubgroupC(deals, FIELD, async () => []);
    expect(pairs).toHaveLength(0);
  });

  it('T3: shared participant email (case-insensitive, trimmed) -> reports a pair', async () => {
    const deals = [
      deal({ id: 1, [FIELD]: 'JS-100', org_id: 1 }),
      deal({ id: 2, [FIELD]: '', org_id: 2 }),
    ];
    const emails: Record<number, string[]> = {
      1: ['  Admin@ElManzano.cl  '],
      2: ['admin@elmanzano.cl'],
    };
    const pairs = await findSubgroupC(deals, FIELD, async (id) => emails[id] ?? []);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].matchReason).toBe('email');
    expect(pairs[0].matchValue).toBe('admin@elmanzano.cl');
  });

  it('T4: both with quoteRef -> no pair, no email fetch', async () => {
    const deals = [
      deal({ id: 1, [FIELD]: 'JS-100', org_id: 1 }),
      deal({ id: 2, [FIELD]: 'JS-200', org_id: 1 }),
    ];
    const pairs = await findSubgroupC(deals, FIELD, async () => {
      throw new Error('getEmailsForDeal must not be invoked');
    });
    expect(pairs).toHaveLength(0);
  });

  it('T5: both without quoteRef (incl. empty string) -> no pair', async () => {
    const deals = [
      deal({ id: 1, [FIELD]: '', org_id: 1 }),
      deal({ id: 2, [FIELD]: null, org_id: 1 }),
    ];
    const pairs = await findSubgroupC(deals, FIELD, async () => []);
    expect(pairs).toHaveLength(0);
  });

  it('T6: pairsToCsv with empty array -> header only', () => {
    const csv = pairsToCsv([]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^dealWithRefId,/);
  });

  it('T7: pairsToCsv escapes quotes and commas in titles', () => {
    const csv = pairsToCsv([
      {
        dealWithRefId: 1,
        dealWithRefTitle: 'Foo, "bar"',
        dealWithRefAddTime: '2026-01-01 00:00:00',
        dealWithRefQuoteReference: 'JS-1',
        dealWithoutRefId: 2,
        dealWithoutRefTitle: 'plain',
        dealWithoutRefAddTime: '2026-01-02 00:00:00',
        matchReason: 'org',
        matchValue: '42',
        daysBetween: 1,
      },
    ]);
    expect(csv).toContain('"Foo, ""bar"""');
    expect(csv).toContain(',plain,');
  });

  it('T8: summarize buckets pairs by day-difference range', () => {
    const c = [
      {
        dealWithRefId: 1,
        dealWithRefTitle: 't',
        dealWithRefAddTime: 'x',
        dealWithRefQuoteReference: 'JS-1',
        dealWithoutRefId: 10,
        dealWithoutRefTitle: 't',
        dealWithoutRefAddTime: 'x',
        matchReason: 'org' as const,
        matchValue: '1',
        daysBetween: 0,
      },
      {
        dealWithRefId: 2,
        dealWithRefTitle: 't',
        dealWithRefAddTime: 'x',
        dealWithRefQuoteReference: 'JS-2',
        dealWithoutRefId: 20,
        dealWithoutRefTitle: 't',
        dealWithoutRefAddTime: 'x',
        matchReason: 'email' as const,
        matchValue: 'a@b',
        daysBetween: 5,
      },
      {
        dealWithRefId: 3,
        dealWithRefTitle: 't',
        dealWithRefAddTime: 'x',
        dealWithRefQuoteReference: 'JS-3',
        dealWithoutRefId: 30,
        dealWithoutRefTitle: 't',
        dealWithoutRefAddTime: 'x',
        matchReason: 'org' as const,
        matchValue: '2',
        daysBetween: 15,
      },
      {
        dealWithRefId: 4,
        dealWithRefTitle: 't',
        dealWithRefAddTime: 'x',
        dealWithRefQuoteReference: 'JS-4',
        dealWithoutRefId: 40,
        dealWithoutRefTitle: 't',
        dealWithoutRefAddTime: 'x',
        matchReason: 'email' as const,
        matchValue: 'c@d',
        daysBetween: 90,
      },
    ];
    const s = summarize(100, [], null, c);
    expect(s.totalDealsAnalyzed).toBe(100);
    expect(s.subgroupB).toBe('skipped');
    expect(s.subgroupC.count).toBe(4);
    expect(s.subgroupC.byMatchReason).toEqual({ org: 2, email: 2 });
    expect(s.subgroupC.byDayBucket).toEqual({ '0-1': 1, '1-7': 1, '7-30': 1, '30+': 1 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Subgrupo A
// ───────────────────────────────────────────────────────────────────────────

describe('findSubgroupA', () => {
  it('TA1: empty quoteRef + "Cotizacion JS-12345 - Foo" -> match, js="12345"', () => {
    const out = findSubgroupA(
      [deal({ id: 1, title: 'Cotizacion JS-12345 - Foo', [FIELD]: '' })],
      FIELD,
    );
    expect(out).toHaveLength(1);
    expect(out[0].jsCode).toBe('12345');
  });

  it('TA2: populated quoteRef + same title -> no match', () => {
    const out = findSubgroupA(
      [deal({ id: 1, title: 'Cotizacion JS-12345 - Foo', [FIELD]: 'JS-12345' })],
      FIELD,
    );
    expect(out).toHaveLength(0);
  });

  it('TA3: empty quoteRef + "1301-2026" -> no match (belongs to B)', () => {
    const out = findSubgroupA(
      [deal({ id: 1, title: '1301-2026', [FIELD]: '' })],
      FIELD,
    );
    expect(out).toHaveLength(0);
  });

  it('TA4: empty quoteRef + arbitrary title -> no match', () => {
    const out = findSubgroupA(
      [deal({ id: 1, title: 'Otro título cualquiera', [FIELD]: '' })],
      FIELD,
    );
    expect(out).toHaveLength(0);
  });

  it('TA5: case-insensitive and tolerant of internal whitespace', () => {
    const out = findSubgroupA(
      [deal({ id: 1, title: 'COTIZACION  JS-99 - X', [FIELD]: null })],
      FIELD,
    );
    expect(out).toHaveLength(1);
    expect(out[0].jsCode).toBe('99');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Subgrupo B
// ───────────────────────────────────────────────────────────────────────────

describe('findSubgroupB', () => {
  it('TB1: empty quoteRef + "1301-2026" -> match', () => {
    const out = findSubgroupB(
      [deal({ id: 1, title: '1301-2026', [FIELD]: '' })],
      FIELD,
    );
    expect(out).toHaveLength(1);
    expect(out[0].marker).toBe('REQUIERE_CORRELACION_JUMPSELLER');
  });

  it('TB2: empty quoteRef + " 1301 - 2026 " -> match (whitespace tolerant)', () => {
    const out = findSubgroupB(
      [deal({ id: 1, title: ' 1301 - 2026 ', [FIELD]: '' })],
      FIELD,
    );
    expect(out).toHaveLength(1);
  });

  it('TB3: empty quoteRef + "Cotizacion JS-12345 ..." -> no match (belongs to A)', () => {
    const out = findSubgroupB(
      [deal({ id: 1, title: 'Cotizacion JS-12345 - Foo', [FIELD]: '' })],
      FIELD,
    );
    expect(out).toHaveLength(0);
  });

  it('TB4: populated quoteRef + "1301-2026" -> no match', () => {
    const out = findSubgroupB(
      [deal({ id: 1, title: '1301-2026', [FIELD]: 'JS-9' })],
      FIELD,
    );
    expect(out).toHaveLength(0);
  });

  it('TB5: title "abc-1234" -> no match (non-commercial format)', () => {
    const out = findSubgroupB(
      [deal({ id: 1, title: 'abc-1234', [FIELD]: '' })],
      FIELD,
    );
    expect(out).toHaveLength(0);
  });
});
