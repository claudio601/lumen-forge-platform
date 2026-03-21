// src/lib/crm/mapping.ts
// Transform QuotePayload into Pipedrive-ready parameters.

import type {
  QuotePayload,
  QuoteCustomer,
  QuoteOrganization,
  LeadType,
  PriorityTier,
  SourceSystem,
} from './types';
import { computeLeadScore } from './scoring';
import type { CreateDealParams } from '../pipedrive/deals';
import type { CreateActivityParams } from '../pipedrive/activities';
import { normalizePhone } from './validation';

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
 * Format: "Cotización {quoteReference} - {customerName}"
 */
export function buildDealTitle(payload: QuotePayload): string {
  return `Cotización ${payload.quoteReference} - ${payload.customer.name}`;
}

/**
 * Map a QuotePayload to the parameters needed by createDeal().
 *
 * Computes the lead score and priority tier, then maps all fields
 * to the CreateDealParams interface expected by the deals module.
 */
export function mapPayloadToDealParams(
  payload: QuotePayload,
  personId: number,
  orgId?: number
): CreateDealParams {
  const { pipelineId, stageId } = getPipelineConfig();
  const { score, leadType, priorityTier } = computeLeadScore(payload);

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
    jumpsellerOrderId: payload.sourceSystem === 'jumpseller'
      ? payload.quoteReference
      : undefined,
    notes: payload.notes,
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
 * Trims whitespace from string fields.
 */
export function mapPayloadToCustomer(payload: QuotePayload): QuoteCustomer {
  return {
    name: payload.customer.name.trim(),
    email: payload.customer.email?.trim(),
    phone: payload.customer.phone ? normalizePhone(payload.customer.phone) : undefined,
    preferredChannel: payload.customer.preferredChannel,
    commune: payload.customer.commune?.trim(),
  };
}

/**
 * Extract the organization from the payload, if present.
 * Returns undefined if no organization data is provided.
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
 * Convenience re-export that wraps the scoring module.
 */
export function computeScoring(payload: QuotePayload) {
  return computeLeadScore(payload);
}
