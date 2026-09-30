// api/request-orders/create.ts
// POST /api/request-orders/create
//
// Flujo de Solicitud de Pedido (Request Order) — Fase 1
//
// Orden de ejecucion (CRITICO — no modificar):
//   0. Rate limit (429), origen (403) y honeypot (200 sin crear nada)
//   1. Validar payload  -> 400 si falla
//   1b. Recalcular precios CON IVA desde el catálogo de Jumpseller -> 400 si hay
//       productos que ya no existen. Los precios del navegador se ignoran.
//   2. Crear deal en Pipedrive -> BLOQUEANTE. 502 si falla.
//   3. Enviar email GAS -> FIRE-AND-FORGET. Log warn si falla.
//   4. Retornar 201 { success, requestReference, dealId }
//
// El deal en Pipedrive es la fuente de verdad.
// Si solo llega el email sin deal, la solicitud se pierde operativamente.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { findOrCreateOrganization } from '../_lib/pipedrive/organizations.js';
import { createDeal } from '../_lib/pipedrive/deals.js';
import { initFieldOptions } from '../_lib/pipedrive/fieldOptions.js';
import { computeLeadScore } from '../_lib/crm/scoring.js';
import { TIPO_SERVICIO } from '../_lib/crm/tipo-servicio.js';
import type { QuotePayload, SourceSystem } from '../_lib/crm/types.js';
import { checkRateLimit, getClientIp, isAllowedOrigin, isHoneypotTriggered } from '../_lib/auth.js';
import { netOf, priceItems } from '../_lib/catalog/pricing.js';

const LOG = '[RequestOrder]';
const ALLOWED_METHODS = ['POST'];

// ── Tipos propios del endpoint ────────────────────────────────────────────────
interface RequestOrderItem {
  /** Id del producto en Jumpseller (identifica la línea; el precio sale del servidor). */
  jumpsellerId?: number;
  /** Id de la variante en Jumpseller (p. ej. color de luz de BESTLED). */
  variantId?: number;
  sku: string;
  name: string;
  quantity: number;
  /** Precio unitario CON IVA calculado en el servidor (el del navegador se ignora). */
  unitPrice: number;
  currency: 'CLP';
  lineTotal: number;
  /** Cómo veía el precio el cliente al agregarlo: 'neto' (modo empresa) o 'iva'. */
  priceMode?: 'neto' | 'iva';
  url: string;
  attributes: {
    potencia?: string;
    colorLuz?: string;
    terminacion?: string;
  };
}

interface RequestOrderPayload {
  items: RequestOrderItem[];
  subtotal: number;
  fullName: string;
  email: string;
  phone: string;
  customerType: 'empresa' | 'persona';
  companyName?: string;
  rut?: string;
  commune: string;
  region: string;
  notes?: string;
  requestReference: string;
}

// ── Validacion del payload ────────────────────────────────────────────────────
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && v > 0 && Number.isFinite(v);
}

function isValidEmail(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

const REQUEST_REF_REGEX = /^RC-[a-z0-9]{5,8}$/i;

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validatePayload(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }
  const p = body as Record<string, unknown>;

  if (!isNonEmptyString(p.requestReference)) {
    errors.push('requestReference is required');
  } else if (!REQUEST_REF_REGEX.test(p.requestReference as string)) {
    errors.push('requestReference must match /^RC-[a-z0-9]{5,8}$/i');
  }

  if (!isNonEmptyString(p.fullName)) errors.push('fullName is required');
  if (!isNonEmptyString(p.email)) errors.push('email is required');
  else if (!isValidEmail(p.email)) errors.push('email has invalid format');

  if (!isNonEmptyString(p.phone)) errors.push('phone is required');
  if (!isNonEmptyString(p.commune)) errors.push('commune is required');
  if (!isNonEmptyString(p.region)) errors.push('region is required');

  if (p.customerType !== 'empresa' && p.customerType !== 'persona') {
    errors.push('customerType must be empresa or persona');
  }
  if (p.customerType === 'empresa' && !isNonEmptyString(p.companyName)) {
    errors.push('companyName is required for empresa');
  }

  if (!Array.isArray(p.items) || (p.items as unknown[]).length === 0) {
    errors.push('items must be a non-empty array');
  } else {
    (p.items as unknown[]).forEach((item, idx) => {
      if (!item || typeof item !== 'object') {
        errors.push(`items[${idx}] must be an object`);
        return;
      }
      const it = item as Record<string, unknown>;
      // Precio, nombre y SKU se recalculan en el servidor: aquí solo se exige poder
      // identificar el producto (jumpsellerId o SKU) y una cantidad válida.
      if (it.jumpsellerId === undefined && !isNonEmptyString(it.sku)) {
        errors.push(`items[${idx}] requires jumpsellerId or sku`);
      }
      if (!isPositiveNumber(it.quantity)) errors.push(`items[${idx}].quantity must be a positive number`);
    });
  }

  return { valid: errors.length === 0, errors };
}

// ── Mapeo de payload a QuotePayload compatible con el pipeline CRM ────────────
function toQuotePayload(p: RequestOrderPayload): QuotePayload {
  return {
    sourceSystem: 'nuevo_elights' as SourceSystem,
    quoteReference: p.requestReference,
    leadType: p.customerType === 'empresa' ? 'B2B' : 'B2C',
    customer: {
      name: p.fullName,
      email: p.email,
      phone: p.phone,
      commune: p.commune,
    },
    organization:
      p.customerType === 'empresa' && p.companyName
        ? { name: p.companyName }
        : undefined,
    products: p.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPriceClp: i.unitPrice,
    })),
    quoteAmountClp: p.subtotal,
    notes: buildNotes(p),
  };
}

function buildNotes(p: RequestOrderPayload): string {
  const lines: string[] = [
    `Solicitud de pedido ${p.requestReference}`,
    `Region: ${p.region} | Comuna: ${p.commune}`,
  ];
  if (p.rut) lines.push(`RUT: ${p.rut}`);
  if (p.notes) lines.push(`Notas del cliente: ${p.notes}`);
  lines.push('--- Items solicitados (precios CON IVA desde Jumpseller) ---');
  p.items.forEach((i) => {
    const cct = i.attributes?.colorLuz ? ` — ${i.attributes.colorLuz}` : '';
    lines.push(
      `  [${i.sku}] ${i.name}${cct} x${i.quantity} @ ${i.unitPrice} CLP = ${i.lineTotal} CLP` +
        ` | Jumpseller ${i.jumpsellerId}${i.variantId ? ` variante ${i.variantId}` : ''}`
    );
  });
  lines.push(`TOTAL CON IVA: ${p.subtotal} CLP`);
  if (p.items.some((i) => i.priceMode === 'neto')) {
    lines.push('Nota: el cliente veía precios netos (modo empresa) en el sitio.');
  }
  lines.push(`requested_items_json: ${JSON.stringify(p.items)}`);
  return lines.join('\n');
}

// ── Handler principal ─────────────────────────────────────────────────────────
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
  if (!checkRateLimit(ip).allowed) {
    console.warn(`${LOG} Rate limit excedido`);
    res.status(429).json({ success: false, error: 'Too many requests. Try again later.' });
    return;
  }
  if (!isAllowedOrigin(req)) {
    console.warn(`${LOG} Origen bloqueado:`, req.headers['origin']);
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const body = req.body;

  // Campo oculto "website": solo lo llenan bots. Se responde OK sin crear nada.
  if (isHoneypotTriggered(body)) {
    console.warn(`${LOG} Honeypot activado`);
    res.status(200).json({ success: true });
    return;
  }

  // ── LOG: Payload recibido (sin PII) ────────────────────────────
  const safeLog = {
    itemCount: Array.isArray(body?.items) ? body.items.length : 0,
    subtotal: body?.subtotal,
    customerType: body?.customerType,
    commune: body?.commune,
    requestReference: body?.requestReference,
  };
  console.log(`${LOG} Payload recibido`, safeLog);

  // ── Paso 1: Validacion ─────────────────────────────────────────
  const validation = validatePayload(body);
  if (!validation.valid) {
    console.warn(`${LOG} Validacion FAIL | errors:`, validation.errors);
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: { errors: validation.errors },
    });
    return;
  }

  const raw = body as RequestOrderPayload;
  const requestReference = raw.requestReference;
  console.log(`${LOG} Validacion OK | requestReference: ${requestReference}`);

  // ── Paso 1b: Precios CON IVA desde el catálogo (se ignoran los del navegador) ──
  const pricing = priceItems(raw.items);
  if (pricing.errors.length) {
    console.warn(`${LOG} Productos no disponibles | ref: ${requestReference}`, pricing.errors);
    res.status(400).json({
      success: false,
      error: 'Products unavailable',
      details: { errors: pricing.errors },
    });
    return;
  }
  const payload: RequestOrderPayload = {
    ...raw,
    items: pricing.lines.map((line, idx) => {
      const client = raw.items[idx];
      const shown = client.unitPrice;
      if (typeof shown === 'number' && shown !== line.unitPrice && shown !== netOf(line.unitPrice)) {
        console.warn(`${LOG} Precio del navegador distinto al del catálogo | ref: ${requestReference}`, {
          jumpsellerId: line.jumpsellerId,
          variantId: line.variantId,
          navegador: shown,
          catalogo: line.unitPrice,
        });
      }
      return {
        ...line,
        currency: 'CLP' as const,
        priceMode: client.priceMode,
        url: client.url,
        attributes: client.attributes ?? {},
      };
    }),
    subtotal: pricing.subtotal,
  };

  // ── Paso 2: Crear deal en Pipedrive (BLOQUEANTE) ───────────────
  let dealId: number;
  try {
    console.log(`${LOG} Pipedrive createDeal iniciado | ref: ${requestReference}`);

    await initFieldOptions();

    const quotePayload = toQuotePayload(payload);
    const { score, leadType, priorityTier } = computeLeadScore(quotePayload);

    // Crear persona
    const personResult = await findOrCreatePerson({
      name: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      commune: payload.commune,
    });

    // Crear org si aplica
    let orgId: number | undefined;
    if (payload.customerType === 'empresa' && payload.companyName) {
      const orgResult = await findOrCreateOrganization({ name: payload.companyName });
      orgId = orgResult.organizationId;
    }

    // Construir parametros del deal
    const pipelineId = Number(process.env.PIPEDRIVE_PIPELINE_ID);
    const stageId = Number(process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID);
    if (!pipelineId || !stageId) {
      throw new Error('PIPEDRIVE_PIPELINE_ID or PIPEDRIVE_STAGE_NEW_LEAD_ID not set');
    }

    const dealResult = await createDeal({
      personId: personResult.personId,
      orgId,
      pipelineId,
      stageId,
      title: `Solicitud ${requestReference} - ${payload.fullName}`,
      quoteAmountClp: payload.subtotal,
      sourceSystem: 'nuevo_elights',
      leadType,
      priorityTier,
      quoteReference: requestReference,
      notes: buildNotes(payload),
      tipoServicio: TIPO_SERVICIO.COTIZACION_WEB,
    });

    if (!dealResult.dealId) {
      throw new Error(`createDeal returned null dealId (status: ${dealResult.status})`);
    }

    dealId = dealResult.dealId;
    console.log(
      `${LOG} Pipedrive createDeal OK | dealId: ${dealId} | score: ${score} | tier: ${priorityTier} | leadType: ${leadType}`
    );
  } catch (err) {
    console.error(`${LOG} Pipedrive createDeal FAIL | error:`, err);
    res.status(502).json({
      success: false,
      error: 'Failed to create deal in CRM. Please try again.',
    });
    return;
  }

  // ── Paso 3: Enviar email GAS (extended via waitUntil para sobrevivir el shutdown del contenedor serverless) ─────────────────
  console.log(`${LOG} GAS relay iniciado`);
  waitUntil(
    sendGasEmail(payload, requestReference)
      .then(() => {
        console.log(`${LOG} GAS relay OK`);
      })
      .catch((err: unknown) => {
        console.warn(`${LOG} GAS relay FAIL | error:`, err);
      })
  );

  // ── Paso 4: Respuesta 201 ──────────────────────────────────────
  console.log(`${LOG} Respuesta 201 | ref: ${requestReference} | dealId: ${dealId}`);
  res.status(201).json({
    success: true,
    requestReference,
    dealId,
  });
}

// ── GAS Relay (igual que QuoteCartPage / InstallationLeadForm) ────────────────
const GAS_URL =
  'https://script.google.com/macros/s/AKfycbwn2Qv3nJsNrUfBvzdpB9X70NmQfAVXgBKVw8bdmG-CXMXGsL-2IUcJaKX0mpO4kNwfOw/exec';

async function sendGasEmail(
  payload: RequestOrderPayload,
  ref: string
): Promise<void> {
  console.log(`${LOG} GAS email starting for ${payload.email} | ref: ${ref}`);
  const itemsText = payload.items
    .map(
      (i) =>
        `\u2022 ${i.sku} \u2014 ${i.name} x${i.quantity} = ${formatCLP(i.lineTotal)} CLP con IVA` +
        ` (Jumpseller ${i.jumpsellerId}${i.variantId ? `, variante ${i.variantId}` : ''})`
    )
    .join('\n');

  const ventas = process.env.SALES_EMAIL ?? 'ventas@elights.cl';

  const response = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      to_email: ventas,
      reply_to: payload.email,
      from_name: payload.fullName,
      subject_override: `Nueva solicitud de pedido \u2014 ${ref}`,
      nombre: payload.fullName,
      telefono: payload.phone,
      comuna: payload.commune,
      region: payload.region,
      tipo_cliente: payload.customerType,
      razon_social: payload.companyName ?? '-',
      rut: payload.rut ?? '-',
      items_lista: itemsText,
      total: formatCLP(payload.subtotal),
      notas: payload.notes ?? '-',
      fecha: new Date().toLocaleDateString('es-CL', { dateStyle: 'long' }),
    }),
  });

  const result = await response.json() as { status: string; message?: string };
  if (result.status !== 'ok') {
    throw new Error(result.message ?? 'GAS relay: status not ok');
  }
}

function formatCLP(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
  }).format(amount);
}
