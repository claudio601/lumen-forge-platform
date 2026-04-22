// api/_lib/crm/mapping.ts
// Transform QuotePayload into Pipedrive-ready parameters.

import type {
  QuotePayload,
  QuoteCustomer,
  QuoteOrganization,
  LeadType,
  PriorityTier,
  SourceSystem,
} from './types.js';
import { computeLeadScore } from './scoring.js';
import type { CreateDealParams } from '../pipedrive/deals.js';
import type { CreateActivityParams } from '../pipedrive/activities.js';
import { normalizePhone } from './validation.js';
import { TIPO_SERVICIO } from './tipo-servicio.js';

// --- Config ---

function getPipelineConfig() {
  const pipelineId = Number(process.env.PIPEDRIVE_PIPELINE_ID);
  const stageId = Number(process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID);
  const userId = Number(process.env.PIPEDRIVE_OWNER_USER_ID);
  if (!pipelineId || !stageId || !userId) {
    throw new Error(
      '[mapping] Missing required env vars: PIPEDRIVE_PIPELINE_ID, PIPEDRIVE_STAGE_NEW_LEAD_ID, PIPEDRIVE_OWNER_USER_ID'
    );
  }
  return { pipelineId, stageId, userId };
}

// --- Main exports ---

/**
 * Build a deal title from the payload.
 * Format: "Cotizacion {quoteReference} - {customerName}"
 */
export function buildDealTitle(payload: QuotePayload): string {
  const quoteRef = payload.quoteReference?.trim() || 'SIN-REF';
  const customerName =
    payload.customer?.name?.trim() ||
    payload.customer?.email?.trim() ||
    'Cliente sin nombre';
  return `Cotizacion ${quoteRef} - ${customerName}`;
}

/**
 * Map a QuotePayload to the parameters needed by createDeal().
 *
 * For Jumpseller orders:
 * - jumpsellerOrderId is the raw order id string, e.g. "12765"
 *   Read directly from payload.jumpsellerOrderId — never reconstructed from quoteReference.
 * - quoteReference is always "JS-{orderId}", e.g. "JS-12765"
 * - sourceRef is always "jumpseller:{orderId}", e.g. "jumpseller:12765"
 * - allowCreate reflects the event policy (set by the webhook handler)
 */
export function mapPayloadToDealParams(
  payload: QuotePayload,
  personId: number,
  orgId?: number
): CreateDealParams {
  const { pipelineId, stageId } = getPipelineConfig();
  const { score, leadType, priorityTier } = computeLeadScore(payload);
  void score;

  // Raw order id string — e.g. "12765" — never "JS-12765"
  // Always comes from payload.jumpsellerOrderId (set in webhook.ts from order.id)
  const jumpsellerOrderId =
    payload.sourceSystem === 'jumpseller' && payload.jumpsellerOrderId
      ? payload.jumpsellerOrderId
      : undefined;

  // Canonical idempotency key: "jumpseller:{rawOrderId}"
  const sourceRef =
    payload.sourceSystem === 'jumpseller' && jumpsellerOrderId
      ? `jumpseller:${jumpsellerOrderId}`
      : undefined;

  const tipoServicio =
    payload.sourceSystem === 'jumpseller'
      ? TIPO_SERVICIO.JUMPSELLER
      : TIPO_SERVICIO.COTIZACION_WEB;

  return {
    personId,
    orgId,
    pipelineId,
    stageId,
    title: buildDealTitle(payload),
    quoteAmountClp: payload.quoteAmountClp,
    sourceSystem: payload.sourceSystem,
    leadType,
    priorityTier,
    quoteReference: payload.quoteReference,
    jumpsellerOrderId,
    sourceRef,
    jumpsellerEventType: payload.jumpsellerEventType,
    notes: payload.notes,
    tipoServicio,
  };
}

/**
 * Map payload to activity parameters for follow-up scheduling.
 */
export function mapToActivityParams(
  dealId: number,
  personId: number,
  orgId: number | undefined,
  type: 'followup_24h' | 'followup_72h',
  quoteReference: string
): CreateActivityParams {
  const { userId } = getPipelineConfig();
  return {
    dealId,
    personId,
    orgId,
    userId,
    type,
    quoteReference,
  };
}

/**
 * Extract the customer object from the payload.
 */
export function mapPayloadToCustomer(payload: QuotePayload): QuoteCustomer {
  return {
    name:
      payload.customer?.name?.trim() ||
      payload.customer?.email?.trim() ||
      'Cliente sin nombre',
    email: payload.customer?.email?.trim() || undefined,
    phone: payload.customer?.phone
      ? normalizePhone(payload.customer.phone)
      : undefined,
    preferredChannel: payload.customer?.preferredChannel,
    commune: payload.customer?.commune?.trim() || undefined,
  };
}

/**
 * Extract the organization from the payload, if present.
 */
export function mapPayloadToOrganization(
  payload: QuotePayload
): QuoteOrganization | undefined {
  if (!payload.organization?.name) return undefined;
  return {
    name: payload.organization.name.trim(),
    segment: payload.organization.segment,
    billingCommune: payload.organization.billingCommune?.trim(),
    isB2BPriority: payload.organization.isB2BPriority,
  };
}

/**
 * Compute lead score and return scoring metadata.
 */
export function computeScoring(payload: QuotePayload) {
  return computeLeadScore(payload);
}
