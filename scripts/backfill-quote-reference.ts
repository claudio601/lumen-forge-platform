// scripts/backfill-quote-reference.ts
//
// One-off admin script: backfill `quoteReference` on canonical human deals
// in Pipedrive that were created BEFORE the field existed (or manually,
// without the field set). Required to close gap H2 (PR #14 post-mortem):
// the Jumpseller bridge looks up canonical deals by `quoteReference`, so
// deals where the field is empty cause duplicate creation when an order
// webhook arrives.
//
// Strategy:
//   1. List deals in pipeline with `quoteReference` empty AND title not
//      matching any known automated source prefix.
//   2. For each candidate, fetch mailMessages and parse order IDs from
//      subject lines matching /\(#(\d+)\)/g. Jumpseller's order
//      notifications include this pattern.
//   3. Decide:
//      - 0 messages         → skip (no-emails)
//      - 0 order IDs        → skip (no-orderid-in-emails)
//      - 1 order ID, no preexisting jumpseller_order_id mismatch → backfill
//      - 1 order ID, mismatch with existing jumpseller_order_id → ambiguous
//      - 2+ order IDs       → ambiguous (multiple_orderids)
//   4. In --execute mode, write `JS-{orderId}` to quoteReference using
//      the same field key the Jumpseller webhook writes (so future
//      bridge lookups match).
//
// Modes:
//   --dry-run   Read-only. Generates JSON reports for review. REQUIRED if not --execute.
//   --execute   Write changes. REQUIRED if not --dry-run.
//   --limit N   Process at most N eligible deals (testing).
//   --verbose   Per-deal log line.
//   --help      Print usage.
//
// Idempotent: re-runs naturally skip deals already backfilled (the
// quoteReference filter excludes them).
//
// Rate limiting: ~750ms between deals (~80 req/min, well under
// Pipedrive's 100/10s burst limit).
//
// Reports written to ./reports/backfill-quote-reference/{timestamp}/
// (gitignored).

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipedriveGet, pipedriveGetAll } from '../api/_lib/pipedrive/client.js';
import { updateDeal } from '../api/_lib/pipedrive/deals.js';
import type { PipedriveDeal } from '../api/_lib/crm/types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EligibleDeal {
  id: number;
  title: string;
  status: string;
  stageId: number;
  quoteReference: string | null;
  jumpsellerOrderId: string | null;
  personId: number | null;
}

export interface MailMessageItem {
  object: string;
  timestamp: string;
  data: {
    subject?: string;
    from?: Array<{ email_address?: string; name?: string }>;
    message_time?: string;
    deal_id?: number;
    [key: string]: unknown;
  };
}

export interface SourceEmailRef {
  subject: string;
  from: string;
  timestamp: string;
}

export interface EmailParseResult {
  orderIds: string[];
  firstEmailFor: Record<string, SourceEmailRef>;
}

export type Action =
  | { type: 'backfill'; orderId: string; sourceEmail: SourceEmailRef }
  | {
      type: 'ambiguous';
      orderIds: string[];
      emailCount: number;
      reason: 'multiple_orderids' | 'jumpseller_order_id_mismatch';
      existingJumpsellerOrderId?: string;
    }
  | {
      type: 'skip';
      reason: 'no-emails' | 'no-orderid-in-emails' | 'already-set';
    };

export interface ReportEntry {
  dealId: number;
  title: string;
  action: Action;
  processedAt: string;
}

interface Reports {
  backfilled: ReportEntry[];
  ambiguous: ReportEntry[];
  skipped: ReportEntry[];
}

interface CliArgs {
  dryRun: boolean;
  execute: boolean;
  limit?: number;
  verbose: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const KNOWN_BOT_PREFIXES = [
  'Cotizacion JS-',
  'Cotización JS-',
  'WhatsApp Lead',
  'Estudio DIALux ',
  'Solicitud RC-',
];

const ORDER_ID_REGEX = /\(#(\d+)\)/g;
const RATE_LIMIT_MS = 750;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;
const HELP_TEXT = `Usage: tsx scripts/backfill-quote-reference.ts [options]

Required (mutually exclusive):
  --dry-run         Read-only. Generates reports without writing changes.
  --execute         Apply backfill writes to Pipedrive.

Optional:
  --limit N         Process at most N eligible deals.
  --verbose         Print one line per processed deal.
  --help            Show this message.
`;

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export function isKnownBotTitle(title: string): boolean {
  return KNOWN_BOT_PREFIXES.some((p) => title.startsWith(p));
}

export function parseOrderIdsFromMessages(
  messages: MailMessageItem[],
): EmailParseResult {
  const orderIds: string[] = [];
  const firstEmailFor: Record<string, SourceEmailRef> = {};

  for (const msg of messages) {
    const subject = msg.data?.subject;
    if (typeof subject !== 'string' || subject.length === 0) continue;

    const matches = [...subject.matchAll(ORDER_ID_REGEX)];
    for (const m of matches) {
      const id = m[1];
      if (!orderIds.includes(id)) {
        orderIds.push(id);
        firstEmailFor[id] = {
          subject,
          from: msg.data?.from?.[0]?.email_address ?? '',
          timestamp: msg.data?.message_time ?? msg.timestamp ?? '',
        };
      }
    }
  }

  return { orderIds, firstEmailFor };
}

export function decideAction(
  parsed: EmailParseResult,
  messageCount: number,
  existingJumpsellerOrderId: string | null,
): Action {
  if (messageCount === 0) {
    return { type: 'skip', reason: 'no-emails' };
  }
  if (parsed.orderIds.length === 0) {
    return { type: 'skip', reason: 'no-orderid-in-emails' };
  }
  if (parsed.orderIds.length > 1) {
    return {
      type: 'ambiguous',
      orderIds: parsed.orderIds,
      emailCount: messageCount,
      reason: 'multiple_orderids',
    };
  }

  const orderId = parsed.orderIds[0];
  if (
    existingJumpsellerOrderId &&
    existingJumpsellerOrderId !== orderId
  ) {
    return {
      type: 'ambiguous',
      orderIds: [orderId],
      emailCount: messageCount,
      reason: 'jumpseller_order_id_mismatch',
      existingJumpsellerOrderId,
    };
  }

  return {
    type: 'backfill',
    orderId,
    sourceEmail: parsed.firstEmailFor[orderId],
  };
}

export function normalizeDeal(
  raw: PipedriveDeal,
  quoteRefKey: string,
  orderIdKey: string,
): EligibleDeal {
  const qr = raw[quoteRefKey];
  const oid = raw[orderIdKey];
  const personField = raw.person_id;
  let personId: number | null = null;
  if (typeof personField === 'number') personId = personField;
  else if (personField && typeof personField === 'object' && 'value' in personField) {
    personId = (personField as { value: number }).value;
  }

  return {
    id: raw.id,
    title: raw.title ?? '',
    status: raw.status,
    stageId: raw.stage_id,
    quoteReference: typeof qr === 'string' && qr.length > 0 ? qr : null,
    jumpsellerOrderId: typeof oid === 'string' && oid.length > 0 ? oid : null,
    personId,
  };
}

export function isEligible(deal: EligibleDeal): boolean {
  if (deal.quoteReference !== null) return false;
  if (isKnownBotTitle(deal.title)) return false;
  return true;
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, execute: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--execute') args.execute = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (a === '--limit') {
      const next = argv[i + 1];
      const n = Number(next);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit requires positive integer, got: ${next}`);
      }
      args.limit = n;
      i++;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (args.dryRun && args.execute) {
    throw new Error('--dry-run and --execute are mutually exclusive');
  }
  if (!args.dryRun && !args.execute) {
    throw new Error('One of --dry-run or --execute is required');
  }
  return args;
}

// ── Retry wrapper ────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes('429') ||
        msg.includes('timeout') ||
        msg.includes('FETCH_ERROR') ||
        msg.includes('ECONNRESET');
      if (!transient || attempt === MAX_RETRIES) throw err;
      const delay = BACKOFF_BASE_MS * 2 ** attempt;
      console.warn(
        `[retry] ${label} attempt ${attempt + 1} failed (${msg}), backing off ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ── Pipedrive interactions ──────────────────────────────────────────────────

async function listEligibleDeals(): Promise<EligibleDeal[]> {
  const pipelineId = process.env.PIPEDRIVE_PIPELINE_ID;
  const quoteRefKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
  const orderIdKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (!pipelineId) throw new Error('PIPEDRIVE_PIPELINE_ID not set');
  if (!quoteRefKey) throw new Error('PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE not set');
  if (!orderIdKey) throw new Error('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not set');

  const raw = await withRetry('listDeals', () =>
    pipedriveGetAll<PipedriveDeal>('/deals', {
      pipeline_id: pipelineId,
      status: 'open',
      // Sort newest activity first so --limit N samples recent deals,
      // where bridge patterns and orderId references are most likely
      // present. Pipedrive v1 API uses single `sort` param with format
      // `field DIRECTION`. Full runs (no --limit) process all deals
      // regardless of order — only sampling order changes.
      sort: 'update_time DESC',
    }),
  );

  const normalized = raw.map((d) => normalizeDeal(d, quoteRefKey, orderIdKey));
  return normalized.filter(isEligible);
}

async function getDealMailMessages(dealId: number): Promise<MailMessageItem[]> {
  return withRetry(`mailMessages:${dealId}`, async () => {
    const items = await pipedriveGetAll<MailMessageItem>(
      `/deals/${dealId}/mailMessages`,
    );
    return items;
  });
}

async function readDealJumpsellerOrderId(
  dealId: number,
  orderIdKey: string,
): Promise<string | null> {
  // Defensive re-read just before write — guards against stale list view.
  const res = await withRetry(`dealRead:${dealId}`, () =>
    pipedriveGet<PipedriveDeal>(`/deals/${dealId}`),
  );
  if (!res.success || !res.data) return null;
  const v = res.data[orderIdKey];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function executeBackfill(dealId: number, orderId: string): Promise<void> {
  const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
  if (!fieldKey) {
    throw new Error('PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE not configured');
  }
  const value = `JS-${orderId}`;
  await withRetry(`updateDeal:${dealId}`, () =>
    updateDeal(dealId, { [fieldKey]: value }),
  );
}

// ── Reports ──────────────────────────────────────────────────────────────────

function fsTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeReports(
  outDir: string,
  reports: Reports,
  args: CliArgs,
  eligibleSnapshot: EligibleDeal[],
  durationSec: number,
): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const writeJson = (file: string, data: unknown) =>
    writeFile(join(outDir, file), JSON.stringify(data, null, 2), 'utf8');

  await writeJson('eligible.json', eligibleSnapshot);
  await writeJson('backfilled.json', reports.backfilled);
  await writeJson('ambiguous.json', reports.ambiguous);
  await writeJson('skipped.json', reports.skipped);
  await writeJson('args.json', { ...args, runAt: new Date().toISOString() });

  const totalProcessed =
    reports.backfilled.length + reports.ambiguous.length + reports.skipped.length;
  const summary = [
    `Mode:                  ${args.execute ? 'execute' : 'dry-run'}`,
    `Eligible (snapshot):   ${eligibleSnapshot.length}`,
    `Processed:             ${totalProcessed}`,
    `Backfilled:            ${reports.backfilled.length}`,
    `Ambiguous (review):    ${reports.ambiguous.length}`,
    `Skipped:               ${reports.skipped.length}`,
    `Limit:                 ${args.limit ?? '(none)'}`,
    `Duration:              ${durationSec.toFixed(1)}s`,
    `Reports dir:           ${outDir}`,
  ].join('\n');
  await writeFile(join(outDir, 'summary.txt'), summary + '\n', 'utf8');
  console.log('\n=== SUMMARY ===\n' + summary);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  if (!process.env.PIPEDRIVE_API_TOKEN) {
    throw new Error('PIPEDRIVE_API_TOKEN not set (check .env.local)');
  }

  const orderIdKey = process.env.PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID;
  if (!orderIdKey) throw new Error('PIPEDRIVE_FIELD_JUMPSELLER_ORDER_ID not set');

  console.log(
    `[backfill] mode=${args.execute ? 'EXECUTE' : 'dry-run'} ` +
      `limit=${args.limit ?? 'none'} verbose=${args.verbose}`,
  );

  console.log('[backfill] listing eligible deals...');
  const eligible = await listEligibleDeals();
  console.log(`[backfill] eligible deals: ${eligible.length}`);

  const reports: Reports = { backfilled: [], ambiguous: [], skipped: [] };
  const targetCount = args.limit ? Math.min(args.limit, eligible.length) : eligible.length;
  let processed = 0;

  for (const deal of eligible) {
    if (args.limit && processed >= args.limit) break;
    processed++;

    let action: Action;
    try {
      const messages = await getDealMailMessages(deal.id);
      const parsed = parseOrderIdsFromMessages(messages);
      action = decideAction(parsed, messages.length, deal.jumpsellerOrderId);

      if (action.type === 'backfill' && args.execute) {
        // Defensive re-check: another process may have backfilled between
        // listing and now. Skip with warn instead of overwriting.
        const liveOrderId = await readDealJumpsellerOrderId(deal.id, orderIdKey);
        if (liveOrderId && liveOrderId !== action.orderId) {
          console.warn(
            `[backfill] guard: deal ${deal.id} jumpseller_order_id changed ` +
              `(${liveOrderId} != ${action.orderId}), skipping`,
          );
          action = {
            type: 'ambiguous',
            orderIds: [action.orderId],
            emailCount: messages.length,
            reason: 'jumpseller_order_id_mismatch',
            existingJumpsellerOrderId: liveOrderId,
          };
        } else {
          await executeBackfill(deal.id, action.orderId);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] deal ${deal.id} failed: ${msg}`);
      action = { type: 'skip', reason: 'no-emails' };
      // Note: failure is recorded as skip with no-emails for accounting.
      // We do NOT abort the batch; one bad deal shouldn't stop 500.
    }

    const entry: ReportEntry = {
      dealId: deal.id,
      title: deal.title,
      action,
      processedAt: new Date().toISOString(),
    };
    if (action.type === 'backfill') reports.backfilled.push(entry);
    else if (action.type === 'ambiguous') reports.ambiguous.push(entry);
    else reports.skipped.push(entry);

    if (args.verbose) {
      const tail =
        action.type === 'backfill'
          ? `→ JS-${action.orderId}`
          : action.type === 'ambiguous'
            ? `(${action.reason}: ${action.orderIds.join(', ')})`
            : `(${action.reason})`;
      console.log(
        `[${processed}/${targetCount}] deal=${deal.id} action=${action.type} ${tail}`,
      );
    }

    await sleep(RATE_LIMIT_MS);
  }

  const outDir = join('reports', 'backfill-quote-reference', fsTimestamp());
  const durationSec = (Date.now() - startedAt) / 1000;
  await writeReports(outDir, reports, args, eligible, durationSec);
}

// ESM entry guard
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /backfill-quote-reference\.(ts|js|mjs)$/.test(process.argv[1]);

if (isDirectRun) {
  main().catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
}
