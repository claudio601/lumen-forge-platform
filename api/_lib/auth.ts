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
// Rate-limit state is module-level on purpose: the three endpoints share a
// single bucket so an attacker cannot round-robin them to multiply quota.
// In-memory store is per serverless instance — acceptable for V1, TODO migrar
// a Upstash Redis cuando el volumen lo justifique.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest } from '@vercel/node';

// ── Origin check ──────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_ORIGINS = [
  'https://nuevo.elights.cl',
  'https://elights.cl',
];

/**
 * Allow when:
 *  - we are not on Vercel production (covers preview + local dev), OR
 *  - Origin or Referer starts with one of the allowed origins.
 */
export function isAllowedOrigin(
  req: VercelRequest,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS
): boolean {
  if (process.env.VERCEL_ENV !== 'production') return true;
  const origin = (req.headers['origin'] as string | undefined) ?? '';
  const referer = (req.headers['referer'] as string | undefined) ?? '';
  return (
    allowedOrigins.some((o) => origin.startsWith(o)) ||
    allowedOrigins.some((o) => referer.startsWith(o))
  );
}

// ── Rate limit (shared across all endpoints that import this module) ──────────

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
