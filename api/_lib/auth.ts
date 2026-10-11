// api/_lib/auth.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared request-authorization helpers for Vercel serverless endpoints.
//
// Three primitives reused by /api/quotes, /api/installation-leads and
// /api/estudio-luminico:
//   - isAllowedOrigin(req, origins?)   -> Origin / Referer allow-list
//   - checkRateLimit(ip, opts?)        -> in-memory rolling-window limiter
//   - isHoneypotTriggered(body, field?) -> bot trap on a hidden form field
//
// Rate-limit state is module-level, but each api/ file deploys as its own
// Vercel function: the bucket is per function and per warm instance (it is
// NOT shared across endpoints) and starts empty on a cold start — acceptable
// for V1, TODO migrar a Upstash Redis cuando el volumen lo justifique.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest } from '@vercel/node';

// ── Origin check ──────────────────────────────────────────────────────────────

/**
 * The site's exact origins. www.elights.cl is where Google Ads land, and after
 * the Stage 3 domain switch the site is served from elights.cl and www.
 */
export const SITE_ORIGINS: readonly string[] = [
  'https://nuevo.elights.cl',
  'https://elights.cl',
  'https://www.elights.cl',
];

/**
 * scheme://host[:port] of an https URL; null for anything else ('', 'null',
 * other schemes, values that do not parse). URL parsing lowercases the host,
 * drops the default port and turns 'https://elights.cl@evil.com' into
 * 'https://evil.com', so look-alike hosts cannot pass.
 */
function toOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Allow when:
 *  - we are not on Vercel production (covers preview + local dev), OR
 *  - the request's origin is exactly one of the allowed origins.
 *
 * A sent Origin header decides alone, whatever the Referer says: a foreign,
 * http:, extension or unparsable Origin (Node joins a repeated Origin header
 * with ', ') is rejected. The Referer counts only when Origin is missing,
 * empty or 'null'.
 */
export function isAllowedOrigin(
  req: VercelRequest,
  allowedOrigins: readonly string[] = SITE_ORIGINS
): boolean {
  if (process.env.VERCEL_ENV !== 'production') return true;
  const header = req.headers['origin'];
  const originSent =
    typeof header === 'string' ? !['', 'null'].includes(header.trim()) : header !== undefined;
  const origin = toOrigin(originSent ? header : req.headers['referer']);
  if (origin !== null && allowedOrigins.includes(origin)) return true;
  // Parsed origin only: never the raw header nor the Referer's path or query string.
  console.warn('[auth] Origen rechazado:', origin ?? (originSent ? 'origen no válido' : 'sin origen'));
  return false;
}

// ── Rate limit (per function and per warm instance, see header) ───────────────

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 10;

const ipHits = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(
  ip: string,
  { windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS }: RateLimitOptions = {}
): RateLimitResult {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }
  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count };
}

/** Extract the best-effort client IP from a Vercel request. */
export function getClientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  return (
    forwarded?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress ??
    'unknown'
  );
}

// ── Honeypot ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the hidden honeypot field was filled by a bot.
 * Default field is `website` (consistent across all lead endpoints).
 */
export function isHoneypotTriggered(
  body: unknown,
  fieldName = 'website'
): boolean {
  if (!body || typeof body !== 'object') return false;
  const value = (body as Record<string, unknown>)[fieldName];
  return typeof value === 'string' && value.trim().length > 0;
}
