// api/quotes/create.ts
// POST /api/quotes/create
// Main endpoint: validate -> map -> dedupe -> create CRM entities.
//
// Auth model (alineado con installation-leads y estudio-luminico):
//   1. Rate limit in-memory por IP (shared bucket en _lib/auth.ts)
//   2. Origin / Referer allow-list
//   3. Header x-api-key / Authorization: Bearer con QUOTES_API_KEY
//      se acepta para llamadas server-to-server (cron, integraciones futuras).
//      El frontend NO manda header — se valida por Origin.
//   4. Honeypot anti-bot (campo `website`)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateQuotePayload } from '../_lib/crm/validation.js';
import { processQuoteToCrm, buildSuccessResponse } from '../_lib/crm/dedupe.js';
import type { QuotePayload, QuoteCreateResponse } from '../_lib/crm/types.js';
import {
  isAllowedOrigin,
  checkRateLimit,
  isHoneypotTriggered,
  getClientIp,
} from '../_lib/auth.js';

// --- Constants ---
const LOG_PREFIX = '[api/quotes/create]';
const ALLOWED_METHODS = ['POST'];

// --- Auth ---

/**
 * Autoriza cuando:
 *  - Origin/Referer está en la allow-list (flujo web legítimo), o
 *  - Header `x-api-key` / `Authorization: Bearer` coincide con QUOTES_API_KEY
 *    (server-to-server — cron, integraciones programáticas).
 *
 * Si no hay header y no hay QUOTES_API_KEY configurada, se permite (dev/local).
 */
function isAuthorized(req: VercelRequest): boolean {
  const quotesKey = process.env.QUOTES_API_KEY;
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  if (apiKey || authHeader) {
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const provided = apiKey ?? bearer;
    if (quotesKey && provided === quotesKey) return true;
    return false;
  }

  if (isAllowedOrigin(req)) return true;
  if (!quotesKey) return true;
  console.warn(`${LOG_PREFIX} Unauthorized: no header and untrusted origin`);
  return false;
}

// --- Handler ---

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!ALLOWED_METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    console.warn(`${LOG_PREFIX} Rate limit exceeded for IP: ${ip}`);
    res.status(429).json({ success: false, error: 'Too many requests. Try again later.' });
    return;
  }

  if (!isAllowedOrigin(req)) {
    console.warn(`${LOG_PREFIX} Blocked origin:`, req.headers['origin']);
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const body = req.body;

  if (isHoneypotTriggered(body)) {
    console.warn(`${LOG_PREFIX} Honeypot triggered from IP: ${ip}`);
    res.status(200).json({ success: true });
    return;
  }

  const validation = validateQuotePayload(body);
  if (!validation.valid) {
    console.warn(`${LOG_PREFIX} Validation failed:`, validation.errors);
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: { errors: validation.errors },
    } satisfies QuoteCreateResponse);
    return;
  }

  const payload = body as QuotePayload;

  try {
    console.log(
      `${LOG_PREFIX} Processing quote: ${payload.quoteReference} ` +
      `(source: ${payload.sourceSystem}, customer: ${payload.customer.name})`
    );

    const result = await processQuoteToCrm(payload);
    const response = buildSuccessResponse(result);

    console.log(
      `${LOG_PREFIX} Quote processed successfully — ` +
      `deal: ${response.dealId} (${response.dealStatus}), score: ${response.leadScore}`
    );

    // 201 for new deals, 200 for all other outcomes
    const httpStatus = result.deal.status === 'created' ? 201 : 200;
    res.status(httpStatus).json(response);
  } catch (err) {
    console.error(`${LOG_PREFIX} Error processing quote:`, err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } satisfies QuoteCreateResponse);
  }
}
