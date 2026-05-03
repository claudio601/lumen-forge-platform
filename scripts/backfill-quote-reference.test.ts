// scripts/backfill-quote-reference.test.ts
// Unit tests for pure helpers of the backfill script.
// Run: npx vitest run --config vitest.api.config.ts scripts/backfill-quote-reference.test.ts

import { describe, it, expect } from 'vitest';
import {
  parseOrderIdsFromMessages,
  decideAction,
  isKnownBotTitle,
  isEligible,
  normalizeDeal,
  parseArgs,
  KNOWN_BOT_PREFIXES,
  type MailMessageItem,
  type EligibleDeal,
} from './backfill-quote-reference.js';
import type { PipedriveDeal } from '../api/_lib/crm/types.js';

function mailMessage(
  subject: string,
  opts: { from?: string; messageTime?: string; timestamp?: string } = {},
): MailMessageItem {
  return {
    object: 'mailMessage',
    timestamp: opts.timestamp ?? '2026-04-01T10:00:00Z',
    data: {
      subject,
      from: [{ email_address: opts.from ?? 'noreply@jumpseller.com', name: 'Jumpseller' }],
      message_time: opts.messageTime ?? '2026-04-01T10:00:00Z',
      deal_id: 26888,
    },
  };
}

describe('parseOrderIdsFromMessages', () => {
  it('returns empty arrays for empty messages', () => {
    expect(parseOrderIdsFromMessages([])).toEqual({
      orderIds: [],
      firstEmailFor: {},
    });
  });

  it('returns empty when subject lacks (#NNN) pattern', () => {
    const result = parseOrderIdsFromMessages([
      mailMessage('Re: Cotizacion sin numero'),
      mailMessage('Hola, consulta sobre productos'),
    ]);
    expect(result.orderIds).toEqual([]);
  });

  it('extracts single orderId from one message', () => {
    const result = parseOrderIdsFromMessages([
      mailMessage('Nueva orden Jumpseller (#12954)'),
    ]);
    expect(result.orderIds).toEqual(['12954']);
    expect(result.firstEmailFor['12954'].subject).toBe('Nueva orden Jumpseller (#12954)');
    expect(result.firstEmailFor['12954'].from).toBe('noreply@jumpseller.com');
  });

  it('deduplicates same orderId across threaded replies', () => {
    const result = parseOrderIdsFromMessages([
      mailMessage('Nueva orden (#12954)'),
      mailMessage('Re: Nueva orden (#12954)'),
      mailMessage('RE: RE: Nueva orden (#12954)'),
      mailMessage('Fwd: Nueva orden (#12954)'),
    ]);
    expect(result.orderIds).toEqual(['12954']);
    expect(Object.keys(result.firstEmailFor)).toEqual(['12954']);
  });

  it('returns multiple orderIds when present in different subjects', () => {
    const result = parseOrderIdsFromMessages([
      mailMessage('Orden (#12954)', { messageTime: '2026-04-01T10:00:00Z' }),
      mailMessage('Otra orden (#13001)', { messageTime: '2026-04-02T10:00:00Z' }),
    ]);
    expect(result.orderIds.sort()).toEqual(['12954', '13001']);
  });

  it('captures multiple orderIds in same subject', () => {
    const result = parseOrderIdsFromMessages([
      mailMessage('Comparativa (#12954) vs (#13001)'),
    ]);
    expect(result.orderIds.sort()).toEqual(['12954', '13001']);
  });

  it('handles missing data.subject gracefully', () => {
    const broken: MailMessageItem = {
      object: 'mailMessage',
      timestamp: '2026-04-01T10:00:00Z',
      data: { from: [{ email_address: 'x@y.com' }] },
    };
    const result = parseOrderIdsFromMessages([broken]);
    expect(result.orderIds).toEqual([]);
  });

  it('handles missing from field in source email reference', () => {
    const noFrom: MailMessageItem = {
      object: 'mailMessage',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'Orden (#999)' },
    };
    const result = parseOrderIdsFromMessages([noFrom]);
    expect(result.orderIds).toEqual(['999']);
    expect(result.firstEmailFor['999'].from).toBe('');
  });

  it('preserves first occurrence email for duplicated orderId', () => {
    const result = parseOrderIdsFromMessages([
      mailMessage('Original (#42)', { messageTime: '2026-04-01T10:00:00Z' }),
      mailMessage('Re: Original (#42)', { messageTime: '2026-04-02T10:00:00Z' }),
    ]);
    expect(result.firstEmailFor['42'].subject).toBe('Original (#42)');
  });
});

describe('decideAction', () => {
  const empty = { orderIds: [], firstEmailFor: {} };

  it('skips when 0 messages', () => {
    expect(decideAction(empty, 0, null)).toEqual({ type: 'skip', reason: 'no-emails' });
  });

  it('skips when 0 orderIds parsed (had emails but no pattern match)', () => {
    expect(decideAction(empty, 5, null)).toEqual({
      type: 'skip',
      reason: 'no-orderid-in-emails',
    });
  });

  it('backfills when exactly 1 orderId and no preexisting jumpsellerOrderId', () => {
    const parsed = {
      orderIds: ['12954'],
      firstEmailFor: {
        '12954': { subject: 'Orden (#12954)', from: 'x@y.com', timestamp: 'T' },
      },
    };
    const action = decideAction(parsed, 5, null);
    expect(action.type).toBe('backfill');
    if (action.type === 'backfill') {
      expect(action.orderId).toBe('12954');
      expect(action.sourceEmail.subject).toBe('Orden (#12954)');
    }
  });

  it('backfills when 1 orderId matches preexisting jumpsellerOrderId', () => {
    const parsed = {
      orderIds: ['12954'],
      firstEmailFor: {
        '12954': { subject: 'Orden (#12954)', from: 'x@y.com', timestamp: 'T' },
      },
    };
    const action = decideAction(parsed, 5, '12954');
    expect(action.type).toBe('backfill');
  });

  it('marks ambiguous when 1 orderId mismatches preexisting jumpsellerOrderId', () => {
    const parsed = {
      orderIds: ['12954'],
      firstEmailFor: {
        '12954': { subject: 'Orden (#12954)', from: 'x@y.com', timestamp: 'T' },
      },
    };
    const action = decideAction(parsed, 3, '99999');
    expect(action.type).toBe('ambiguous');
    if (action.type === 'ambiguous') {
      expect(action.reason).toBe('jumpseller_order_id_mismatch');
      expect(action.existingJumpsellerOrderId).toBe('99999');
      expect(action.orderIds).toEqual(['12954']);
    }
  });

  it('marks ambiguous when 2+ orderIds', () => {
    const parsed = {
      orderIds: ['12954', '13001'],
      firstEmailFor: {
        '12954': { subject: 'A (#12954)', from: '', timestamp: '' },
        '13001': { subject: 'B (#13001)', from: '', timestamp: '' },
      },
    };
    const action = decideAction(parsed, 8, null);
    expect(action.type).toBe('ambiguous');
    if (action.type === 'ambiguous') {
      expect(action.reason).toBe('multiple_orderids');
      expect(action.orderIds.sort()).toEqual(['12954', '13001']);
      expect(action.emailCount).toBe(8);
    }
  });
});

describe('isKnownBotTitle', () => {
  it('matches Jumpseller webhook title', () => {
    expect(isKnownBotTitle('Cotizacion JS-12954 - Juan Perez')).toBe(true);
  });

  it('matches Jumpseller webhook title with accent (defensive)', () => {
    expect(isKnownBotTitle('Cotización JS-12954 - Juan Perez')).toBe(true);
  });

  it('matches WhatsApp Lead title', () => {
    expect(isKnownBotTitle('WhatsApp Lead — Juan Perez')).toBe(true);
  });

  it('matches Estudio DIALux title', () => {
    expect(isKnownBotTitle('Estudio DIALux Estadio — Juan Perez — Tome')).toBe(true);
  });

  it('matches Solicitud RC- title', () => {
    expect(isKnownBotTitle('Solicitud RC-abc12345 - Juan Perez')).toBe(true);
  });

  it('does NOT match canonical human deal title', () => {
    expect(isKnownBotTitle('Iluminacion bodega Constanza Ltda')).toBe(false);
    expect(isKnownBotTitle('Cotizacion luminarias industriales')).toBe(false); // no "JS-"
  });

  it('exposes 5 known prefixes', () => {
    expect(KNOWN_BOT_PREFIXES).toHaveLength(5);
  });
});

describe('normalizeDeal + isEligible', () => {
  const QR_KEY = 'abc123quotehash';
  const OID_KEY = 'def456orderhash';

  function rawDeal(overrides: Partial<PipedriveDeal>): PipedriveDeal {
    return {
      id: 1,
      title: 'Iluminacion bodega Constanza',
      status: 'open',
      pipeline_id: 1,
      stage_id: 1,
      person_id: 100,
      org_id: null,
      owner_id: 1,
      add_time: '',
      update_time: '',
      ...overrides,
    } as PipedriveDeal;
  }

  it('normalizes raw deal with empty quoteReference', () => {
    const raw = rawDeal({ id: 26888, [QR_KEY]: '', [OID_KEY]: null });
    const norm = normalizeDeal(raw, QR_KEY, OID_KEY);
    expect(norm.quoteReference).toBe(null);
    expect(norm.jumpsellerOrderId).toBe(null);
    expect(norm.id).toBe(26888);
    expect(norm.personId).toBe(100);
  });

  it('normalizes raw deal with set quoteReference', () => {
    const raw = rawDeal({ [QR_KEY]: 'JS-12954', [OID_KEY]: '12954' });
    const norm = normalizeDeal(raw, QR_KEY, OID_KEY);
    expect(norm.quoteReference).toBe('JS-12954');
    expect(norm.jumpsellerOrderId).toBe('12954');
  });

  it('handles person_id as object form', () => {
    const raw = rawDeal({ person_id: { value: 200 } });
    const norm = normalizeDeal(raw, QR_KEY, OID_KEY);
    expect(norm.personId).toBe(200);
  });

  it('handles person_id null', () => {
    const raw = rawDeal({ person_id: null });
    const norm = normalizeDeal(raw, QR_KEY, OID_KEY);
    expect(norm.personId).toBe(null);
  });

  it('isEligible: passes canonical human deal with empty quoteReference', () => {
    const deal: EligibleDeal = {
      id: 1,
      title: 'Iluminacion bodega',
      status: 'open',
      stageId: 1,
      quoteReference: null,
      jumpsellerOrderId: null,
      personId: 100,
    };
    expect(isEligible(deal)).toBe(true);
  });

  it('isEligible: rejects deal with quoteReference set', () => {
    const deal: EligibleDeal = {
      id: 1,
      title: 'Iluminacion bodega',
      status: 'open',
      stageId: 1,
      quoteReference: 'JS-12954',
      jumpsellerOrderId: '12954',
      personId: 100,
    };
    expect(isEligible(deal)).toBe(false);
  });

  it('isEligible: rejects Jumpseller bot title even with empty quoteReference', () => {
    const deal: EligibleDeal = {
      id: 1,
      title: 'Cotizacion JS-12954 - Juan',
      status: 'open',
      stageId: 1,
      quoteReference: null,
      jumpsellerOrderId: null,
      personId: 100,
    };
    expect(isEligible(deal)).toBe(false);
  });

  it('isEligible: rejects all known bot title prefixes', () => {
    const titles = [
      'Cotizacion JS-1',
      'Cotización JS-1',
      'WhatsApp Lead — x',
      'Estudio DIALux Bodega — x — y',
      'Solicitud RC-abc123 - x',
    ];
    for (const t of titles) {
      const deal: EligibleDeal = {
        id: 1,
        title: t,
        status: 'open',
        stageId: 1,
        quoteReference: null,
        jumpsellerOrderId: null,
        personId: 100,
      };
      expect(isEligible(deal)).toBe(false);
    }
  });
});

describe('parseArgs', () => {
  it('accepts --dry-run alone', () => {
    expect(parseArgs(['--dry-run'])).toEqual({
      dryRun: true,
      execute: false,
      verbose: false,
    });
  });

  it('accepts --execute alone', () => {
    expect(parseArgs(['--execute'])).toEqual({
      dryRun: false,
      execute: true,
      verbose: false,
    });
  });

  it('rejects both --dry-run and --execute', () => {
    expect(() => parseArgs(['--dry-run', '--execute'])).toThrow(/mutually exclusive/);
  });

  it('rejects neither --dry-run nor --execute', () => {
    expect(() => parseArgs([])).toThrow(/required/);
  });

  it('accepts --limit N', () => {
    expect(parseArgs(['--dry-run', '--limit', '5'])).toEqual({
      dryRun: true,
      execute: false,
      verbose: false,
      limit: 5,
    });
  });

  it('rejects --limit with non-positive value', () => {
    expect(() => parseArgs(['--dry-run', '--limit', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--dry-run', '--limit', '-1'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--dry-run', '--limit', 'abc'])).toThrow(/positive integer/);
  });

  it('accepts --verbose', () => {
    expect(parseArgs(['--dry-run', '--verbose'])).toEqual({
      dryRun: true,
      execute: false,
      verbose: true,
    });
  });

  it('rejects unknown args', () => {
    expect(() => parseArgs(['--dry-run', '--bogus'])).toThrow(/Unknown argument/);
  });
});
