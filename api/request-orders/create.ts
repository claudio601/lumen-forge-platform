// api/request-orders/create.ts
// POST /api/request-orders/create
//
// Flujo de Solicitud de Pedido (Request Order) — Fase 1
//
// Orden de ejecucion (CRITICO — no modificar):
//   1. Validar payload  -> 400 si falla
//   2. Crear deal en Pipedrive -> BLOQUEANTE. 502 si falla.
//   3. Enviar email GAS -> FIRE-AND-FORGET. Log warn si falla.
//   4. Retornar 201 { success, requestReference, dealId }
//
// El deal en Pipedrive es la fuente de verdad.
// Si solo llega el email sin deal, la solicitud se pierde operativamente.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { findOrCreateOrganization } from '../_lib/pipedrive/organizations.js';
import { createDeal } from '../_lib/pipedrive/deals.js';
import { initFieldOptions } from '../_lib/pipedrive/fieldOptions.js';
import { computeLeadScore } from '../_lib/crm/scoring.js';
import type { QuotePayload, SourceSystem } from '../_lib/crm/types.js';

const LOG = '[RequestOrder]';
const ALLOWED_METHODS = ['POST'];

// ── Tipos propios del endpoint ────────────────────────────────────────────────
interface RequestOrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  currency: 'CLP';
  lineTotal: number;
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
      if (!isNonEmptyString(it.sku)) errors.push(`items[${idx}].sku is required`);
      if (!isNonEmptyString(it.name)) errors.push(`items[${idx}].name is required`);
      if (!isPositiveNumber(it.quantity)) errors.push(`items[${idx}].quantity must be a positive number`);
      if (!isPositiveNumber(it.unitPrice)) errors.push(`items[${idx}].unitPrice must be a positive number`);
      if (it.currency !== 'CLP') errors.push(`items[${idx}].currency must be CLP`);
      if (typeof it.lineTotal !== 'number') errors.push(`items[${idx}].lineTotal is required`);
    });
  }

  if (p.subtotal !== undefined && !isPositiveNumber(p.subtotal)) {
    errors.push('subtotal must be a positive number');
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
  lines.push('--- Items solicitados ---');
  p.items.forEach((i) => {
    lines.push(
      `  [${i.sku}] ${i.name} x${i.quantity} @ ${i.unitPrice} CLP = ${i.lineTotal} CLP`
    );
  });
  lines.push(`TOTAL: ${p.subtotal} CLP`);
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

  const body = req.body;

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

  const payload = body as RequestOrderPayload;
  const requestReference = payload.requestReference;
  console.log(`${LOG} Validacion OK | requestReference: ${requestReference}`);

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

  // ── Paso 3: Enviar email GAS (FIRE-AND-FORGET) ─────────────────
  console.log(`${LOG} GAS relay iniciado`);
  sendGasEmail(payload, requestReference)
    .then(() => {
      console.log(`${LOG} GAS relay OK`);
    })
    .catch((err: unknown) => {
      console.warn(`${LOG} GAS relay FAIL (non-blocking) | error:`, err);
    });

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
  const itemsText = payload.items
    .map(
      (i) =>
        `\u2022 ${i.sku} \u2014 ${i.name} x${i.quantity} = ${formatCLP(i.lineTotal)} CLP`
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
