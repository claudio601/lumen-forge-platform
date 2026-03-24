// api/jumpseller/webhook.ts
// Webhook receiver for Jumpseller order events.
// Transforms incoming Jumpseller payload into a QuotePayload
// and processes it through the CRM pipeline.
//
// Auth: validates Jumpseller-Hmac-Sha256 header using HMAC-SHA256
// with JUMPSELLER_HOOKS_TOKEN and raw body (bodyParser disabled).
//
// Event routing: reads Jumpseller-Event header (e.g. "order_created"),
// NOT body.event. The JSON payload contains only the resource object.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import type { QuotePayload, SourceSystem, LeadType } from '../_lib/crm/types.js';
import { validateQuotePayload } from '../_lib/crm/validation.js';
import { processQuoteToCrm } from '../_lib/crm/dedupe.js';
import { initFieldOptions } from '../_lib/pipedrive/fieldOptions.js';

const LOG_PREFIX = '[jumpseller/webhook]';

// Jumpseller sends the event name in the Jumpseller-Event header.
// Values match the format: order_created, order_paid, order_updated, etc.
const ALLOWED_EVENTS = ['order_created', 'order_paid', 'order_updated'];

// --- Jumpseller types (subset) ---

interface JumpsellerProduct {
  name: string;
  qty: number;
  price: number;
  sku?: string;
}

interface JumpsellerCustomer {
  fullname: string;
  email: string;
  phone?: string;
}

interface JumpsellerOrder {
  id: number;
  status: string;
  total: number;
  customer: JumpsellerCustomer;
  products: JumpsellerProduct[];
  created_at: string;
  billing_address?: {
    municipality?: string;
    region?: string;
    address?: string;
  };
}

// Jumpseller payload: the JSON body is the resource directly, e.g. { order: {...} }
interface JumpsellerWebhookPayload {
  order: JumpsellerOrder;
}

// --- Raw body reader ---

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// --- HMAC verifier ---

function verifyJumpsellerHmac(rawBody: Buffer, hmacHeader: string, token: string): boolean {
  const digest = crypto
    .createHmac('sha256', token)
    .update(rawBody)
    .digest('base64');
  const digestBuf = Buffer.from(digest);
  const headerBuf = Buffer.from(hmacHeader.trim());
  if (digestBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(digestBuf, headerBuf);
}

// --- Mapping ---

function mapToQuotePayload(order: JumpsellerOrder): QuotePayload {
  const customer = order.customer;

  return {
    sourceSystem: 'jumpseller' as SourceSystem,
    quoteReference: `JS-${order.id}`,
    jumpsellerOrderId: String(order.id),
    leadType: 'B2C' as LeadType,
    quoteAmountClp: order.total,
    customer: {
      name: customer.fullname ?? '',
      email: customer.email,
      phone: customer.phone || undefined,
      billingCommune: order.billing_address?.municipality,
      billingRegion: order.billing_address?.region,
    },
    organization: undefined,
    products: order.products.map((p) => ({
      name: p.name,
      sku: p.sku || '',
      quantity: p.qty,
      unitPriceClp: p.price,
    })),
  };
}

// --- Handler ---

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 1. Read raw body first (bodyParser is disabled)
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch {
    res.status(400).json({ error: 'Failed to read request body' });
    return;
  }

  // 2. Validate HMAC-SHA256 signature
  const hooksToken = process.env.JUMPSELLER_HOOKS_TOKEN;
  const hmacHeader = req.headers['jumpseller-hmac-sha256'] as string | undefined;

  if (!hmacHeader) {
    console.warn(`${LOG_PREFIX} Missing Jumpseller-Hmac-Sha256 header`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!hooksToken) {
    console.error(`${LOG_PREFIX} JUMPSELLER_HOOKS_TOKEN is not configured`);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  if (!verifyJumpsellerHmac(rawBody, hmacHeader, hooksToken)) {
    console.warn(`${LOG_PREFIX} Invalid HMAC signature`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // 3. Read event from header (Jumpseller-Event), not from body
  const event = (req.headers['jumpseller-event'] as string | undefined)?.trim();

  if (!event) {
    console.warn(`${LOG_PREFIX} Missing Jumpseller-Event header`);
    res.status(400).json({ error: 'Missing Jumpseller-Event header' });
    return;
  }

  if (!ALLOWED_EVENTS.includes(event)) {
    console.log(`${LOG_PREFIX} Ignoring event: ${event}`);
    res.status(200).json({ success: true, action: 'ignored', reason: `Event ${event} not handled` });
    return;
  }

  // 4. Parse JSON body (resource object: { order: {...} })
  let body: JumpsellerWebhookPayload;
  try {
    body = JSON.parse(rawBody.toString('utf-8')) as JumpsellerWebhookPayload;
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  if (!body.order) {
    res.status(400).json({ error: 'Missing order in payload' });
    return;
  }

  // 5. Map and process through CRM
  try {
    const payload = mapToQuotePayload(body.order);

    const validation = validateQuotePayload(payload);
    if (!validation.valid) {
      console.warn(`${LOG_PREFIX} Validation failed:`, validation.errors);
      res.status(400).json({ success: false, errors: validation.errors });
      return;
    }

    await initFieldOptions();
    const result = await processQuoteToCrm(payload);

    console.log(
      `${LOG_PREFIX} Order ${body.order.id} [${event}] -> deal ${result.deal.id} (${result.deal.action})`,
    );

    res.status(result.deal.action === 'created' ? 201 : 200).json({
      success: true,
      event,
      orderId: body.order.id,
      dealId: result.deal.id,
      dealAction: result.deal.action,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} Error processing webhook:`, err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
