// api/jumpseller/webhook.ts
// Webhook receiver for Jumpseller order events.
// Transforms incoming Jumpseller payload into a QuotePayload
// and processes it through the CRM pipeline.
//
// Auth: validates Jumpseller-Hmac-Sha256 header (HMAC-SHA256 with JUMPSELLER_HOOKS_TOKEN).
// Event routing: reads Jumpseller-Event header, NOT body.event.
//
// HTTP status mapping:
//   created                       -> 201
//   updated                       -> 200
//   skipped_duplicate             -> 200
//   skipped_lock_contention       -> 200
//   skipped_update_without_existing -> 200
//   blocked_idempotency_unavailable -> 503  (triggers Jumpseller retry)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import type { QuotePayload, SourceSystem, LeadType, DealResultStatus } from '../_lib/crm/types.js';
import { validateQuotePayload } from '../_lib/crm/validation.js';
import { processQuoteToCrm } from '../_lib/crm/dedupe.js';
import { initFieldOptions } from '../_lib/pipedrive/fieldOptions.js';
import { getEventPolicy, HANDLED_EVENTS } from '../_lib/jumpseller/eventPolicy.js';

const LOG_PREFIX = '[jumpseller/webhook]';

// --- Jumpseller types (subset) ---

interface JumpsellerProduct {
  name: string;
  qty: number;
  price: number;
  sku?: string;
}

interface JumpsellerAddress {
  name?: string;
  surname?: string;
  municipality?: string;
  region?: string;
  address?: string;
}

interface JumpsellerCustomer {
  fullname?: string;
  email?: string;
  phone?: string;
  phone_prefix?: string;
  ip?: string;
}

interface JumpsellerOrder {
  id: number;
  status: string;
  total: number;
  customer: JumpsellerCustomer;
  billing_address?: JumpsellerAddress;
  shipping_address?: JumpsellerAddress;
  products: JumpsellerProduct[];
  created_at: string;
}

interface JumpsellerWebhookPayload {
  order: JumpsellerOrder;
}

// --- HTTP status code mapping ---

function httpStatusForResult(status: DealResultStatus): number {
  switch (status) {
    case 'created':
      return 201;
    case 'updated':
    case 'skipped_duplicate':
    case 'skipped_lock_contention':
    case 'skipped_update_without_existing':
      return 200;
    case 'blocked_idempotency_unavailable':
      return 503;
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 200;
    }
  }
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

function verifyJumpsellerHmac(
  rawBody: Buffer,
  hmacHeader: string,
  token: string
): boolean {
  const digest = crypto
    .createHmac('sha256', token)
    .update(rawBody)
    .digest('base64');
  const digestBuf = Buffer.from(digest);
  const headerBuf = Buffer.from(hmacHeader.trim());
  if (digestBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(digestBuf, headerBuf);
}

// --- Customer name resolution ---

function resolveJumpsellerCustomerName(order: JumpsellerOrder): string {
  const fullname = order.customer?.fullname?.trim();
  if (fullname) return fullname;
  const billingName = [
    order.billing_address?.name,
    order.billing_address?.surname,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (billingName) return billingName;
  const shippingName = [
    order.shipping_address?.name,
    order.shipping_address?.surname,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (shippingName) return shippingName;
  const email = order.customer?.email?.trim();
  if (email) return email;
  return `Cliente Jumpseller ${order.id}`;
}

// --- Mapping ---

function mapToQuotePayload(order: JumpsellerOrder, eventType: string): QuotePayload {
  const customerName = resolveJumpsellerCustomerName(order);
  return {
    sourceSystem: 'jumpseller' as SourceSystem,
    // quoteReference is always "JS-{id}"
    quoteReference: `JS-${order.id}`,
    // jumpsellerOrderId is ALWAYS the raw id string, e.g. "12765"
    // Never reconstructed from quoteReference — read directly from order.id
    jumpsellerOrderId: String(order.id),
    leadType: 'B2C' as LeadType,
    quoteAmountClp: order.total,
    customer: {
      name: customerName,
      email: order.customer?.email,
      phone: order.customer?.phone || undefined,
      commune: order.billing_address?.municipality,
    },
    organization: undefined,
    products: (order.products ?? []).map((p) => ({
      name: p.name,
      sku: p.sku || '',
      quantity: p.qty,
      unitPriceClp: p.price,
    })),
    jumpsellerEventType: eventType,
  };
}

// --- Handler ---

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 1. Read raw body (bodyParser disabled for HMAC verification)
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

  // 4. Event policy check
  if (!HANDLED_EVENTS.includes(event)) {
    console.log(`${LOG_PREFIX} Ignoring unhandled event: ${event}`);
    res.status(200).json({
      success: true,
      action: 'ignored',
      reason: `Event ${event} not handled`,
    });
    return;
  }

  const policy = getEventPolicy(event);

  // 5. Parse JSON body
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

  const orderId = String(body.order.id);
  const sourceRef = `jumpseller:${orderId}`;

  console.log(JSON.stringify({
    level: 'info',
    event: 'webhook_received',
    sourceRef,
    orderId,
    jumpsellerEvent: event,
    policy: { canCreate: policy.canCreate, canUpdate: policy.canUpdate },
  }));

  // 6. Map to QuotePayload and process
  try {
    const payload = mapToQuotePayload(body.order, event);
    const validation = validateQuotePayload(payload);
    if (!validation.valid) {
      console.warn(`${LOG_PREFIX} Validation failed:`, validation.errors);
      res.status(400).json({ success: false, errors: validation.errors });
      return;
    }

    await initFieldOptions();

    // Pass event policy canCreate down through the processing chain
    // dedupe.ts reads this from payload.jumpsellerEventType + the policy
    const result = await processQuoteToCrm(payload, { allowCreate: policy.canCreate });

    const dealResult = result.deal;
    const httpStatus = httpStatusForResult(dealResult.status);

    console.log(JSON.stringify({
      level: 'info',
      event: 'webhook_processed',
      sourceRef,
      orderId,
      jumpsellerEvent: event,
      dealStatus: dealResult.status,
      dealId: dealResult.dealId,
      httpStatus,
    }));

    res.status(httpStatus).json({
      success: true,
      event,
      orderId,
      dealId: dealResult.dealId,
      dealStatus: dealResult.status,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} Error processing webhook:`, err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
