// src/lib/crm/dedupe.ts
// Centralized deduplication orchestration across person, org, and deal.

import type {
  QuotePayload,
  FindOrCreatePersonResult,
  FindOrCreateOrganizationResult,
  CreateDealResult,
  QuoteCreateSuccessResponse,
} from './types';
import { findOrCreatePerson } from '../pipedrive/persons';
import { findOrCreateOrganization } from '../pipedrive/organizations';
import { createDeal } from '../pipedrive/deals';
import { initFieldOptions } from '../pipedrive/fieldOptions';
import {
  mapPayloadToCustomer,
  mapPayloadToOrganization,
  mapPayloadToDealParams,
  computeScoring,
} from './mapping';

// --- Types ---

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
 * Orchestrate the full CRM deduplication flow for a quote:
 *
 *  1. Initialize field options cache (if cold start)
 *  2. Find or create the person (dedupe by email/phone)
 *  3. Find or create the organization (dedupe by name), if provided
 *  4. Create or update the deal (idempotent by quoteRef > orderId > person+pipeline)
 *  5. Return all IDs and scoring metadata
 *
 * This is the main entry point called by the /api/quotes/create endpoint.
 * It does NOT create follow-up activities — that responsibility lives
 * in the cron job (cron/followups.ts).
 */
export async function processQuoteToCrm(
  payload: QuotePayload
): Promise<CrmProcessingResult> {
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
  console.log(`${LOG_PREFIX} Processing deal: ${payload.quoteReference}`);
  const deal = await createDeal(dealParams);

  // 5. Compute scoring
  const { score, priorityTier } = computeScoring(payload);

  console.log(
    `${LOG_PREFIX} CRM processing complete — ` +
    `person: ${person.personId} (${person.action}), ` +
    `org: ${organization?.organizationId ?? 'none'} (${organization?.action ?? 'n/a'}), ` +
    `deal: ${deal.dealId} (${deal.action}), ` +
    `score: ${score}, tier: ${priorityTier}`
  );

  return {
    person,
    organization,
    deal,
    leadScore: score,
    priorityTier,
  };
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
    dealAction: result.deal.action,
    leadScore: result.leadScore,
    priorityTier: result.priorityTier,
  };
}
