// api/quotes/create.ts
// POST /api/quotes/create
// Main endpoint: validate -> map -> dedupe -> create CRM entities.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateQuotePayload } from '../_lib/crm/validation.js';
import { processQuoteToCrm, buildSuccessResponse } from '../_lib/crm/dedupe.js';
import type { QuotePayload, QuoteCreateResponse } from '../_lib/crm/types.js';

// --- Constants ---
const LOG_PREFIX = '[api/quotes/create]';
const ALLOWED_METHODS = ['POST'];

// --- Auth ---

/**
 * Validate the request carries a valid API key.
 * Accepts both `x-api-key` header and `Authorization: Bearer <key>`.
 */
function isAuthorized(req: VercelRequest): boolean {
  const expectedKey = process.env.QUOTES_API_KEY;
  if (!expectedKey) {
    console.warn(`${LOG_PREFIX} QUOTES_API_KEY not set — all requests will be rejected`);
    return false;
  }
  const apiKey = req.headers['x-api-key'];
  if (apiKey === expectedKey) return true;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === expectedKey) {
    return true;
  }
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

  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const body = req.body;
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
