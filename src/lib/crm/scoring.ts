// src/lib/crm/scoring.ts
// Lead scoring, type inference, and priority tier computation.

import type {
  LeadType,
  PriorityTier,
  LeadScoreResult,
  QuotePayload,
} from './types';

// --- Constants ---

const BASE_SCORE_B2C = 40;
const BASE_SCORE_B2B = 70;
const BONUS_HIGH_AMOUNT = 20; // quoteAmountClp > 500_000
const BONUS_MANY_PRODUCTS = 10; // products.length > 3
const BONUS_HAS_ORG = 10; // organization present
const BONUS_HAS_PHONE = 5; // valid phone
const AMOUNT_THRESHOLD_CLP = 500_000;
const PRODUCT_COUNT_THRESHOLD = 3;
const HIGH_PRIORITY_SCORE = 80;

// --- Lead type inference ---

/**
 * Infer lead type from payload context.
 * If explicitly provided, use that. Otherwise:
 * - Has organization -> B2B
 * - No organization -> B2C
 */
export function inferLeadType(payload: QuotePayload): LeadType {
  if (payload.leadType) return payload.leadType;
  return payload.organization?.name ? 'B2B' : 'B2C';
}

// --- Phone validation (basic Chilean format) ---

function isValidPhone(phone?: string): boolean {
  if (!phone) return false;
  // Strip spaces, dashes, parens, plus sign
  const cleaned = phone.replace(/[\s\-()\+]/g, '');
  // Chilean mobile: 9 digits starting with 9, or with country code 56
  // Accept anything with at least 8 digits as "valid" for scoring
  return /^\d{8,}$/.test(cleaned);
}

// --- Score computation ---

/**
 * Compute lead score based on business rules:
 *  - B2C base: 40 | B2B base: 70
 *  - amount > 500,000 CLP: +20
 *  - more than 3 products: +10
 *  - has organization: +10
 *  - valid phone: +5
 *  - score >= 80 -> priorityTier = Alta, else Normal
 */
export function computeLeadScore(payload: QuotePayload): LeadScoreResult {
  const leadType = inferLeadType(payload);
  let score = leadType === 'B2B' ? BASE_SCORE_B2B : BASE_SCORE_B2C;

  if (payload.quoteAmountClp > AMOUNT_THRESHOLD_CLP) {
    score += BONUS_HIGH_AMOUNT;
  }

  if (payload.products.length > PRODUCT_COUNT_THRESHOLD) {
    score += BONUS_MANY_PRODUCTS;
  }

  if (payload.organization?.name) {
    score += BONUS_HAS_ORG;
  }

  if (isValidPhone(payload.customer.phone)) {
    score += BONUS_HAS_PHONE;
  }

  // Cap at 100
  score = Math.min(score, 100);

  const priorityTier: PriorityTier = score >= HIGH_PRIORITY_SCORE ? 'Alta' : 'Normal';

  return { score, leadType, priorityTier };
}

/**
 * Convenience: infer priority tier from a pre-computed score.
 */
export function inferPriorityTier(score: number): PriorityTier {
  return score >= HIGH_PRIORITY_SCORE ? 'Alta' : 'Normal';
}
