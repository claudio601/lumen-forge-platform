// api/_lib/crm/dedupe.ts
// Centralized deduplication orchestration across person, org, and deal.

import type {
  QuotePayload,
  FindOrCreatePersonResult,
  FindOrCreateOrganizationResult,
  CreateDealResult,
  QuoteCreateSuccessResponse,
  DealResultStatus,
} from './types.js';
import { findOrCreatePerson } from '../pipedrive/persons.js';
import { findOrCreateOrganization } from '../pipedrive/organizations.js';
import { createDeal } from '../pipedrive/deals.js';
import { initFieldOptions } from '../pipedrive/fieldOptions.js';
import {
  mapPayloadToCustomer,
  mapPayloadToOrganization,
  mapPayloadToDealParams,
  computeScoring,
} from './mapping.js';

// --- Types ---

export interface ProcessOptions {
  /**
   * Whether the current event is allowed to create a new deal.
   * Defaults to true. Set to false for order_paid / order_updated.
   */
  allowCreate?: boolean;
}

export interface CrmProcessingResult {
  person: FindOrCreatePersonResult;
  organization: FindOrCreateOrganizationResult | null;
  deal: CreateDealResult;
  leadScore: number;
  priorityTier: 'Alta' | 'Normal';
}

// --- Main export ---

const LOG_PREFIX = '[dedupe]';

/**
 * Orchestrate the full CRM deduplication flow for a quote.
 *
 * 1. Initialize field options cache (cold start)
 * 2. Find or create person (dedupe by email/phone)
 * 3. Find or create organization (dedupe by name), if provided
 * 4. Create or update the deal (idempotent via Redis + Pipedrive search)
 * 5. Return all IDs and scoring metadata
 */
export async function processQuoteToCrm(
  payload: QuotePayload,
  options: ProcessOptions = {}
): Promise<CrmProcessingResult> {
  const allowCreate = options.allowCreate !== false;

  // 1. Ensure field options are loaded
  await initFieldOptions();

  // 2. Find or create person
  const customer = mapPayloadToCustomer(payload);
  console.log(`${LOG_PREFIX} Processing person: ${customer.name}`);
  const person = await findOrCreatePerson(customer);

  // 3. Find or create organization (if present in payload)
  let organization: FindOrCreateOrganizationResult | null = null;
  const orgData = mapPayloadToOrganization(payload);
  if (orgData) {
    console.log(`${LOG_PREFIX} Processing organization: ${orgData.name}`);
    organization = await findOrCreateOrganization(orgData);
  }

  // 4. Create or update deal (with idempotency)
  const dealParams = mapPayloadToDealParams(
    payload,
    person.personId,
    organization?.organizationId
  );

  // Propagate allowCreate to the deals layer
  dealParams.allowCreate = allowCreate;

  console.log(`${LOG_PREFIX} Processing deal: ${payload.quoteReference} (allowCreate=${allowCreate})`);
  const deal = await createDeal(dealParams);

  // 5. Compute scoring
  const { score, priorityTier } = computeScoring(payload);

  console.log(
    `${LOG_PREFIX} CRM processing complete — ` +
    `person: ${person.personId} (${person.action}), ` +
    `org: ${organization?.organizationId ?? 'none'} (${organization?.action ?? 'n/a'}), ` +
    `deal: ${deal.dealId} (${deal.status}), ` +
    `score: ${score}, tier: ${priorityTier}`
  );

  return { person, organization, deal, leadScore: score, priorityTier };
}

/**
 * Build the API success response from the CRM processing result.
 */
export function buildSuccessResponse(
  result: CrmProcessingResult
): QuoteCreateSuccessResponse {
  return {
    success: true,
    personId: result.person.personId,
    organizationId: result.organization?.organizationId ?? null,
    dealId: result.deal.dealId,
    dealStatus: result.deal.status,
    leadScore: result.leadScore,
    priorityTier: result.priorityTier,
  };
}
