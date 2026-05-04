// scripts/analyze-cross-channel-duplicates.ts
//
// Ticket J — Cross-channel duplicate analysis (Pipedrive pipeline 2 / Ventas eLIGHTS).
//
// Detects deals at risk of cross-channel duplication caused by the legacy
// bridge gap documented in docs/incidents/2026-05-04-deal-duplication-legacy-bridge.md.
//
// Three subgroups, each independently togglable:
//
//   A) Legacy deals with the bridge-issued title preserved
//      ("Cotizacion JS-XXXXX ..."). Trivial to bind: the JS-XXXXX is in
//      the title. Reported so a downstream backfill can populate
//      quoteReference. NOT executed here — read-only by design.
//
//   B) Legacy deals renamed to the commercial folio ("1301-2026" style).
//      Detection only: inferring the original JS-XXXXX requires
//      correlation against Jumpseller and is out of scope for this script.
//      Opt-in via --subgroup-b due to false-positive cost.
//
//   C) Active duplicate pairs: one deal with quoteReference populated and
//      another empty, sharing organization or participant email. This is
//      the original logic preserved across the refactor.
//
// Read-only: --confirm-readonly is mandatory to hit the API. Without it,
// the script prints a DRY RUN MODE banner and exits.

import { writeFileSync } from 'node:fs';
import { argv, env, exit, stdout, stderr } from 'node:process';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface PipedriveDeal {
  id: number;
  title: string;
  add_time: string;
  pipeline_id: number;
  owner_name?: string | null;
  org_id?:
    | number
    | { value: number; name?: string | null }
    | null;
  organization?: { id?: number; name?: string | null } | null;
  value?: number | null;
  currency?: string | null;
  // quoteReference custom field is stored under the dynamic field key
  // (PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE) — accessed via index signature.
  [extraKey: string]: unknown;
}

export interface TitleLegacyDeal {
  id: number;
  title: string;
  jsCode: string;
  add_time: string;
  owner_name: string;
}

export interface RenamedLegacyDeal {
  id: number;
  title: string;
  add_time: string;
  organization_name: string;
  contact_email: string;
  value: number;
  currency: string;
  marker: 'REQUIERE_CORRELACION_JUMPSELLER';
}

export interface CrossChannelPair {
  dealWithRefId: number;
  dealWithRefTitle: string;
  dealWithRefAddTime: string;
  dealWithRefQuoteReference: string;
  dealWithoutRefId: number;
  dealWithoutRefTitle: string;
  dealWithoutRefAddTime: string;
  matchReason: 'org' | 'email';
  matchValue: string;
  daysBetween: number;
}

export interface Summary {
  totalDealsAnalyzed: number;
  subgroupA: { count: number; oldestAddTime: string | null; newestAddTime: string | null };
  subgroupB:
    | { count: number; oldestAddTime: string | null; newestAddTime: string | null }
    | 'skipped';
  subgroupC: {
    count: number;
    byMatchReason: { org: number; email: number };
    byDayBucket: { '0-1': number; '1-7': number; '7-30': number; '30+': number };
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

const TITLE_LEGACY_REGEX = /Cotizacion\s+JS-(\d+)/i;
const RENAMED_FOLIO_REGEX = /^\s*\d{1,4}\s*-\s*\d{4}\s*$/;

export function isQuoteRefEmpty(deal: PipedriveDeal, fieldKey: string): boolean {
  const raw = deal[fieldKey];
  if (raw == null) return true;
  if (typeof raw !== 'string') return false;
  return raw.trim().length === 0;
}

export function getQuoteRef(deal: PipedriveDeal, fieldKey: string): string {
  const raw = deal[fieldKey];
  return typeof raw === 'string' ? raw : '';
}

function getOrgId(deal: PipedriveDeal): number | null {
  const o = deal.org_id;
  if (o == null) return null;
  if (typeof o === 'number') return o;
  if (typeof o === 'object' && typeof o.value === 'number') return o.value;
  return null;
}

function getOrgName(deal: PipedriveDeal): string {
  const o = deal.org_id;
  if (o && typeof o === 'object' && typeof o.name === 'string') return o.name;
  if (deal.organization && typeof deal.organization.name === 'string') {
    return deal.organization.name;
  }
  return '';
}

function normalizeEmail(s: string): string {
  return s.toLowerCase().trim();
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function bucketDays(days: number): '0-1' | '1-7' | '7-30' | '30+' {
  if (days <= 1) return '0-1';
  if (days <= 7) return '1-7';
  if (days <= 30) return '7-30';
  return '30+';
}

// ───────────────────────────────────────────────────────────────────────────
// Subgrupo A
// ───────────────────────────────────────────────────────────────────────────

export function findSubgroupA(
  deals: PipedriveDeal[],
  fieldKey: string,
): TitleLegacyDeal[] {
  const out: TitleLegacyDeal[] = [];
  for (const d of deals) {
    if (!isQuoteRefEmpty(d, fieldKey)) continue;
    const m = d.title.match(TITLE_LEGACY_REGEX);
    if (!m) continue;
    out.push({
      id: d.id,
      title: d.title,
      jsCode: m[1],
      add_time: d.add_time,
      owner_name: d.owner_name ?? '',
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Subgrupo B
// ───────────────────────────────────────────────────────────────────────────

export function findSubgroupB(
  deals: PipedriveDeal[],
  fieldKey: string,
): RenamedLegacyDeal[] {
  const out: RenamedLegacyDeal[] = [];
  for (const d of deals) {
    if (!isQuoteRefEmpty(d, fieldKey)) continue;
    if (TITLE_LEGACY_REGEX.test(d.title)) continue; // belongs to A
    if (!RENAMED_FOLIO_REGEX.test(d.title)) continue;
    out.push({
      id: d.id,
      title: d.title,
      add_time: d.add_time,
      organization_name: getOrgName(d),
      contact_email: '', // populated by caller if needed; opt-in fetch
      value: d.value ?? 0,
      currency: d.currency ?? '',
      marker: 'REQUIERE_CORRELACION_JUMPSELLER',
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Subgrupo C
// ───────────────────────────────────────────────────────────────────────────

export async function findSubgroupC(
  deals: PipedriveDeal[],
  fieldKey: string,
  getEmailsForDeal: (dealId: number) => Promise<string[]>,
): Promise<CrossChannelPair[]> {
  const withRef: PipedriveDeal[] = [];
  const withoutRef: PipedriveDeal[] = [];
  for (const d of deals) {
    if (isQuoteRefEmpty(d, fieldKey)) withoutRef.push(d);
    else withRef.push(d);
  }

  // Memoize email lookups per dealId.
  const emailCache = new Map<number, Promise<string[]>>();
  const fetchEmails = (dealId: number): Promise<string[]> => {
    let p = emailCache.get(dealId);
    if (!p) {
      p = getEmailsForDeal(dealId).then((arr) =>
        Array.from(new Set(arr.map(normalizeEmail).filter((e) => e.length > 0))),
      );
      emailCache.set(dealId, p);
    }
    return p;
  };

  const out: CrossChannelPair[] = [];

  for (const a of withRef) {
    const aOrgId = getOrgId(a);
    let aEmails: string[] | null = null;

    for (const b of withoutRef) {
      let matchReason: 'org' | 'email' | null = null;
      let matchValue = '';

      // Try org_id first — semantically stronger and free (no fetch).
      const bOrgId = getOrgId(b);
      if (aOrgId != null && bOrgId != null && aOrgId === bOrgId) {
        matchReason = 'org';
        matchValue = String(aOrgId);
      } else {
        // Fall back to email intersection.
        if (aEmails == null) aEmails = await fetchEmails(a.id);
        if (aEmails.length > 0) {
          const bEmails = await fetchEmails(b.id);
          const overlap = aEmails.find((e) => bEmails.includes(e));
          if (overlap) {
            matchReason = 'email';
            matchValue = overlap;
          }
        }
      }

      if (matchReason) {
        out.push({
          dealWithRefId: a.id,
          dealWithRefTitle: a.title,
          dealWithRefAddTime: a.add_time,
          dealWithRefQuoteReference: getQuoteRef(a, fieldKey),
          dealWithoutRefId: b.id,
          dealWithoutRefTitle: b.title,
          dealWithoutRefAddTime: b.add_time,
          matchReason,
          matchValue,
          daysBetween: daysBetween(a.add_time, b.add_time),
        });
      }
    }
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// CSV
// ───────────────────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n') + '\n';
}

export function pairsToCsv(pairs: CrossChannelPair[]): string {
  const header = [
    'dealWithRefId',
    'dealWithRefTitle',
    'dealWithRefAddTime',
    'dealWithRefQuoteReference',
    'dealWithoutRefId',
    'dealWithoutRefTitle',
    'dealWithoutRefAddTime',
    'matchReason',
    'matchValue',
    'daysBetween',
  ];
  return rowsToCsv(
    header,
    pairs.map((p) => [
      p.dealWithRefId,
      p.dealWithRefTitle,
      p.dealWithRefAddTime,
      p.dealWithRefQuoteReference,
      p.dealWithoutRefId,
      p.dealWithoutRefTitle,
      p.dealWithoutRefAddTime,
      p.matchReason,
      p.matchValue,
      p.daysBetween,
    ]),
  );
}

export function subgroupAToCsv(items: TitleLegacyDeal[]): string {
  return rowsToCsv(
    ['id', 'title', 'jsCode', 'add_time', 'owner_name'],
    items.map((d) => [d.id, d.title, d.jsCode, d.add_time, d.owner_name]),
  );
}

export function subgroupBToCsv(items: RenamedLegacyDeal[]): string {
  return rowsToCsv(
    [
      'id',
      'title',
      'add_time',
      'organization_name',
      'contact_email',
      'value',
      'currency',
      'marker',
    ],
    items.map((d) => [
      d.id,
      d.title,
      d.add_time,
      d.organization_name,
      d.contact_email,
      d.value,
      d.currency,
      d.marker,
    ]),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Summary
// ───────────────────────────────────────────────────────────────────────────

function rangeOf<T extends { add_time: string }>(items: T[]): {
  oldestAddTime: string | null;
  newestAddTime: string | null;
} {
  if (items.length === 0) return { oldestAddTime: null, newestAddTime: null };
  let oldest = items[0].add_time;
  let newest = items[0].add_time;
  for (const x of items) {
    if (x.add_time < oldest) oldest = x.add_time;
    if (x.add_time > newest) newest = x.add_time;
  }
  return { oldestAddTime: oldest, newestAddTime: newest };
}

export function summarize(
  totalDealsAnalyzed: number,
  a: TitleLegacyDeal[],
  b: RenamedLegacyDeal[] | null,
  c: CrossChannelPair[],
): Summary {
  const buckets = { '0-1': 0, '1-7': 0, '7-30': 0, '30+': 0 };
  const reasons = { org: 0, email: 0 };
  for (const p of c) {
    buckets[bucketDays(p.daysBetween)]++;
    reasons[p.matchReason]++;
  }
  return {
    totalDealsAnalyzed,
    subgroupA: { count: a.length, ...rangeOf(a) },
    subgroupB: b == null ? 'skipped' : { count: b.length, ...rangeOf(b) },
    subgroupC: { count: c.length, byMatchReason: reasons, byDayBucket: buckets },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// IO — Pipedrive client (local recreation, intentionally not importing api/_lib)
// ───────────────────────────────────────────────────────────────────────────

interface PipedriveResponse<T> {
  success: boolean;
  data: T | null;
  additional_data?: {
    pagination?: {
      start?: number;
      limit?: number;
      more_items_in_collection?: boolean;
      next_start?: number;
    };
  };
  error?: string;
}

function sanitizeUrlForLog(u: string): string {
  return u.replace(/api_token=[^&]*/g, 'api_token=REDACTED');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildClient() {
  const token = env.PIPEDRIVE_API_TOKEN;
  const baseUrl = env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN is not set');

  return async function pipedriveGet<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<PipedriveResponse<T>> {
    const url = new URL(
      path.startsWith('/') ? path.slice(1) : path,
      baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    );
    url.searchParams.set('api_token', token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    await sleep(110);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      stderr.write(
        `[pipedrive] GET ${sanitizeUrlForLog(url.toString())} -> ${res.status}: ${body.slice(0, 200)}\n`,
      );
      return { success: false, data: null, error: `HTTP ${res.status}` };
    }
    return (await res.json()) as PipedriveResponse<T>;
  };
}

async function fetchAllDeals(
  pipedriveGet: ReturnType<typeof buildClient>,
  pipelineId: number,
): Promise<PipedriveDeal[]> {
  const all: PipedriveDeal[] = [];
  let start = 0;
  const limit = 500;
  while (true) {
    const res = await pipedriveGet<PipedriveDeal[]>('/deals', {
      pipeline_id: String(pipelineId),
      start: String(start),
      limit: String(limit),
    });
    if (!res.success || !res.data) break;
    all.push(...res.data);
    const pag = res.additional_data?.pagination;
    if (!pag?.more_items_in_collection) break;
    start = pag.next_start ?? start + limit;
  }
  return all;
}

function makeEmailFetcher(pipedriveGet: ReturnType<typeof buildClient>) {
  return async (dealId: number): Promise<string[]> => {
    const res = await pipedriveGet<
      Array<{ email?: Array<{ value?: string }> }>
    >(`/deals/${dealId}/persons`, { limit: '500' });
    if (!res.success || !res.data) return [];
    const out: string[] = [];
    for (const p of res.data) {
      for (const e of p.email ?? []) {
        if (typeof e.value === 'string') out.push(e.value);
      }
    }
    return out;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

interface CliFlags {
  skipA: boolean;
  skipB: boolean;
  skipC: boolean;
  subgroupB: boolean; // opt-in
  confirmReadonly: boolean;
}

function parseFlags(args: string[]): CliFlags {
  return {
    skipA: args.includes('--skip-a'),
    skipB: args.includes('--skip-b'),
    skipC: args.includes('--skip-c'),
    subgroupB: args.includes('--subgroup-b'),
    confirmReadonly: args.includes('--confirm-readonly'),
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const flags = parseFlags(argv.slice(2));

  if (!flags.confirmReadonly) {
    stdout.write('═══════════════════════════════════════════════════════════════\n');
    stdout.write('  DRY RUN MODE — read-only safety guard active\n');
    stdout.write('  Pass --confirm-readonly to query the live Pipedrive API.\n');
    stdout.write('  This script never writes; the flag is required to confirm\n');
    stdout.write('  intent and avoid accidental rate-limit consumption.\n');
    stdout.write('═══════════════════════════════════════════════════════════════\n');
    return;
  }

  const fieldKey = env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
  if (!fieldKey) throw new Error('PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE is not set');

  const pipelineId = Number(env.PIPEDRIVE_VENTAS_PIPELINE_ID || '2');

  const pipedriveGet = buildClient();
  const deals = await fetchAllDeals(pipedriveGet, pipelineId);
  stderr.write(`[analyze] fetched ${deals.length} deals from pipeline ${pipelineId}\n`);

  const date = todayIso();

  const a = flags.skipA ? [] : findSubgroupA(deals, fieldKey);
  if (!flags.skipA) {
    writeFileSync(`subgroup-a-title-legacy-${date}.csv`, subgroupAToCsv(a));
  }

  let b: RenamedLegacyDeal[] | null = null;
  if (!flags.skipB && flags.subgroupB) {
    b = findSubgroupB(deals, fieldKey);
    writeFileSync(`subgroup-b-renamed-legacy-${date}.csv`, subgroupBToCsv(b));
  }

  const c = flags.skipC
    ? []
    : await findSubgroupC(deals, fieldKey, makeEmailFetcher(pipedriveGet));
  if (!flags.skipC) {
    writeFileSync(`subgroup-c-active-pairs-${date}.csv`, pairsToCsv(c));
  }

  const summary = summarize(deals.length, a, b, c);
  stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  typeof argv[1] === 'string' &&
  /analyze-cross-channel-duplicates\.(ts|js|mjs)$/.test(argv[1]);

if (invokedDirectly) {
  main().catch((err) => {
    stderr.write(`[analyze] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
  });
}
