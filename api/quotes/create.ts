// api/quotes/create.ts
// POST /api/quotes/create
// Main endpoint: validate → map → dedupe → create CRM entities.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateQuotePayload } from '../../src/lib/crm/validation';
import { processQuoteToCrm, buildSuccessResponse } from '../../src/lib/crm/dedupe';
import type { QuotePayload, QuoteCreateResponse } from '../../src/lib/crm/types';

// --- Constants ---

const LOG_PREFIX = '[api/quotes/create]';
const ALLOWED_METHODS = ['POST'];

// --- Auth ---

/**
 * Validate the request carries a valid API key.
 * The key is compared against QUOTES_API_KEY env var.
 * Accepts both `x-api-key` header and `Authorization: Bearer <key>`.
 */
function isAuthorized(req: VercelRequest): boolean {
  const expectedKey = process.env.QUOTES_API_KEY;
  if (!expectedKey) {
    console.warn(`${LOG_PREFIX} QUOTES_API_KEY not set — all requests will be rejected`);
    return false;
  }

  // Check x-api-key header
  const apiKey = req.headers['x-api-key'];
  if (apiKey === expectedKey) return true;

  // Check Authorization: Bearer <key>
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
  // Method check
  if (!ALLOWED_METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  // Auth check
  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  // Parse body
  const body = req.body;

  // Validate payload
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

  // At this point the payload is validated
  const payload = body as QuotePayload;

  try {
    console.log(
      `${LOG_PREFIX} Processing quote: ${payload.quoteReference} ` +
      `(source: ${payload.sourceSystem}, customer: ${payload.customer.name})`
    );

    // Run the full CRM pipeline: person → org → deal
    const result = await processQuoteToCrm(payload);

    // Build and send success response
    const response = buildSuccessResponse(result);

    console.log(
      `${LOG_PREFIX} Quote processed successfully — ` +
      `deal: ${response.dealId} (${response.dealAction}), score: ${response.leadScore}`
    );

    res.status(result.deal.action === 'created' ? 201 : 200).json(response);
  } catch (err) {
    console.error(`${LOG_PREFIX} Error processing quote:`, err);

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } satisfies QuoteCreateResponse);
  }
}
