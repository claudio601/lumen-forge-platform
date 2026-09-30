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
import { priceItems } from '../_lib/catalog/pricing.js';
import { pipedrivePost } from '../_lib/pipedrive/client.js';

// --- Constants ---
const LOG_PREFIX = '[api/quotes/create]';
const ALLOWED_METHODS = ['POST'];

// --- Precios del sitio ---

/**
 * Reemplaza en el lugar precio, nombre y SKU de cada producto por los del catálogo
 * (CON IVA) y recalcula quoteAmountClp. Si un producto no se identifica se deja el
 * precio del navegador (no bloquea: el correo al vendedor ya salió), llevado a CON IVA
 * si el cliente cotizó en modo empresa (neto). Devuelve el detalle para la nota del deal.
 */
function repriceSiteQuote(body: Record<string, unknown>): string[] {
  const products = body.products as Record<string, unknown>[];
  const net = body.leadType === 'B2B'; // el sitio manda precios netos cuando el cliente está en modo empresa
  const detail: string[] = [];
  let total = 0;
  body.products = products.map((p, i) => {
    const { lines, unresolved } = priceItems([{ jumpsellerId: p.jumpsellerId, variantId: p.variantId, sku: p.sku, name: p.name, quantity: p.quantity }]);
    const quantity = typeof p.quantity === 'number' ? p.quantity : Number(p.quantity);
    const line = lines[0];
    if (!line) {
      const shown = Number(p.unitPriceClp) || 0;
      const gross = net ? Math.round(shown * 1.19) : shown;
      console.warn(`${LOG_PREFIX} Producto sin precio de catálogo (se usa el del navegador, CON IVA)`, { index: i, unresolved });
      total += gross * (quantity || 0);
      detail.push(`  REVISAR [${String(p.sku ?? '')}] ${String(p.name ?? '')} x${quantity} @ ${gross} CLP (precio del sitio, por confirmar)`);
      return { sku: p.sku, name: p.name, quantity: p.quantity, unitPriceClp: gross };
    }
    total += line.lineTotal;
    detail.push(
      `  [${line.sku}] ${line.name} x${line.quantity} @ ${line.unitPrice} CLP = ${line.lineTotal} CLP` +
        ` | Jumpseller ${line.jumpsellerId}${line.variantId ? ` variante ${line.variantId}` : ''}` +
        (line.variantUnknown ? ' — REVISAR: variante ya no existe, precio base' : ''),
    );
    return { sku: line.sku, name: line.name, quantity: line.quantity, unitPriceClp: line.unitPrice };
  });
  body.quoteAmountClp = total;
  return detail;
}

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

  // Cotizaciones del sitio: precios CON IVA recalculados desde el catálogo de Jumpseller
  // (el navegador puede mandar precios netos del modo empresa o desactualizados).
  // Llamadas server-to-server (x-api-key) no se tocan.
  let siteQuoteDetail: string[] | undefined;
  if (body && typeof body === 'object' && body.sourceSystem === 'nuevo_elights' && Array.isArray(body.products)) {
    siteQuoteDetail = repriceSiteQuote(body as Record<string, unknown>);
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

    // Cotización del sitio: el detalle de productos (ids de Jumpseller) queda como nota del
    // deal. No bloquea la respuesta.
    if (siteQuoteDetail && result.deal?.status === 'created' && result.deal.dealId) {
      const content = [
        `Cotización web ${payload.quoteReference} (precios CON IVA desde Jumpseller)`,
        ...siteQuoteDetail,
        `TOTAL CON IVA: ${payload.quoteAmountClp} CLP`,
        ...(payload.notes ? [`Comentarios del cliente: ${payload.notes}`] : []),
      ].join('\n');
      try {
        await pipedrivePost('/notes', { content, deal_id: result.deal.dealId });
      } catch (err) {
        console.warn(`${LOG_PREFIX} Nota de productos en Pipedrive FAIL`, err);
      }
    }

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
