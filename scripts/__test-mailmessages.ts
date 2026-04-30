// scripts/__test-mailmessages.ts
//
// TEMPORARY probe (DO NOT MERGE).
// Validates Pipedrive endpoint shapes for the quoteReference backfill script.
// Targets deal 26888 (Constanza) — known to have 5 emails containing orderId 12954
// in the subject pattern "(#12954)".
//
// Run:  npx tsx scripts/__test-mailmessages.ts
// Requires: .env.local with PIPEDRIVE_API_TOKEN at repo root.

import 'dotenv/config';
import { pipedriveGet } from '../api/_lib/pipedrive/client.js';

const DEAL_ID = 26888;

interface ProbeResult {
  endpoint: string;
  ok: boolean;
  status: string;
  error?: string;
  itemCount?: number;
  firstItemKeys?: string[];
  sample?: unknown;
  subjectMatches?: Array<{ subject: string; orderIds: string[] }>;
}

function inspectKeys(obj: unknown, depth = 0): string[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj as Record<string, unknown>);
}

function extractOrderIds(subject: string): string[] {
  const matches = [...subject.matchAll(/\(#(\d+)\)/g)];
  return matches.map((m) => m[1]);
}

async function probe(endpoint: string, scanSubjects = false): Promise<ProbeResult> {
  console.log(`\n--- Probing ${endpoint} ---`);
  const res = await pipedriveGet<unknown>(endpoint);

  const result: ProbeResult = {
    endpoint,
    ok: !!res.success,
    status: res.success ? 'success' : 'error',
  };

  if (!res.success) {
    result.error = res.error ?? 'unknown';
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  const data = res.data;
  if (Array.isArray(data)) {
    result.itemCount = data.length;
    if (data.length > 0) {
      result.firstItemKeys = inspectKeys(data[0]);
      // Sample: first item, redacted body if too large
      const firstItem = { ...(data[0] as Record<string, unknown>) };
      if (typeof firstItem.body === 'string' && firstItem.body.length > 200) {
        firstItem.body = `${firstItem.body.substring(0, 200)}... [truncated, ${firstItem.body.length} chars]`;
      }
      if (typeof firstItem.snippet === 'string' && firstItem.snippet.length > 200) {
        firstItem.snippet = `${firstItem.snippet.substring(0, 200)}... [truncated]`;
      }
      result.sample = firstItem;
    }

    if (scanSubjects) {
      const matches: Array<{ subject: string; orderIds: string[] }> = [];
      for (const item of data) {
        const rec = item as Record<string, unknown>;
        // Try common subject keys: subject, title, note. Mail messages usually 'subject'.
        const subject =
          (typeof rec.subject === 'string' && rec.subject) ||
          (typeof rec.title === 'string' && rec.title) ||
          '';
        if (subject) {
          const orderIds = extractOrderIds(subject);
          if (orderIds.length > 0 || matches.length < 3) {
            matches.push({ subject, orderIds });
          }
        }
      }
      result.subjectMatches = matches;
    }
  } else {
    result.firstItemKeys = inspectKeys(data);
    result.sample = data;
  }

  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  if (!process.env.PIPEDRIVE_API_TOKEN) {
    console.error('ERROR: PIPEDRIVE_API_TOKEN not set. Create .env.local at repo root.');
    process.exit(1);
  }

  console.log(`Probing Pipedrive endpoints for deal ${DEAL_ID}...`);
  console.log(`Expected: 5 emails with subject containing "(#12954)"`);

  const results: ProbeResult[] = [];

  // Primary: mailMessages
  results.push(await probe(`/deals/${DEAL_ID}/mailMessages`, true));

  // Fallback 1: activities (in case mailMessages is unavailable)
  results.push(await probe(`/deals/${DEAL_ID}/activities`, true));

  // Fallback 2: flow (full activity stream, includes emails)
  results.push(await probe(`/deals/${DEAL_ID}/flow`, true));

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(
      `${r.endpoint}: ${r.ok ? 'OK' : 'FAIL'}` +
        (r.itemCount !== undefined ? ` (${r.itemCount} items)` : '') +
        (r.error ? ` — ${r.error}` : ''),
    );
    if (r.subjectMatches && r.subjectMatches.length > 0) {
      const withOrderId = r.subjectMatches.filter((m) => m.orderIds.length > 0);
      console.log(`  └─ ${withOrderId.length} subjects matched (#NNN) regex`);
      for (const m of withOrderId.slice(0, 3)) {
        console.log(`     • "${m.subject.substring(0, 80)}" → orderIds=${JSON.stringify(m.orderIds)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
