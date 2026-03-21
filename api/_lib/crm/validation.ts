// src/lib/crm/validation.ts
// Validate QuotePayload before CRM processing.

import type { QuotePayload } from './types';

// --- Types ---

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// --- Helpers ---

const VALID_SOURCE_SYSTEMS = ['nuevo_elights', 'jumpseller', 'whatsapp', 'manual'] as const;
const VALID_LEAD_TYPES = ['B2B', 'B2C'] as const;

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isPositiveNumber(val: unknown): val is number {
  return typeof val === 'number' && val > 0 && Number.isFinite(val);
}

/**
 * Validate an email address (basic format check).
 * Not exhaustive — just enough to reject clearly invalid strings.
 */
function isValidEmail(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
}

/**
 * Validate a Chilean phone number.
 * Accepts: +56XXXXXXXXX, 56XXXXXXXXX, 9XXXXXXXX, etc.
 * After stripping non-digits, must be 8-12 digits.
 */
function isValidPhone(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const digits = val.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 12;
}

/**
 * Normalize a Chilean phone number.
 * Strips spaces, hyphens, dots, and parentheses.
 * Ensures +56 prefix for 9-digit numbers starting with 9.
 */
export function normalizePhone(val: string): string {
  const cleaned = val.replace(/[^\d+]/g, "");
  // If it is 9 digits starting with 9, add +56
  if (/^9\d{8}$/.test(cleaned)) return `+56${cleaned}`;
  // If it starts with 56 (no +), add +
  if (/^56\d{9}$/.test(cleaned)) return `+${cleaned}`;
  // Already has + or other format, return cleaned
  return cleaned;
}
// --- Main export ---

/**
 * Validate a QuotePayload before it enters the CRM pipeline.
 *
 * Validates:
 *  - Required fields: sourceSystem, quoteReference, customer.name
 *  - At least one contact method: customer.email or customer.phone
 *  - Format validations: email format, phone format
 *  - Enum validations: sourceSystem, leadType
 *  - Numeric validations: quoteAmountClp > 0, products non-empty
 *
 * Returns { valid: true, errors: [] } if all checks pass,
 * or { valid: false, errors: [...] } with human-readable error messages.
 */
export function validateQuotePayload(payload: unknown): ValidationResult {
  const errors: string[] = [];

  // Must be an object
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = payload as Record<string, unknown>;

  // --- Required fields ---

  if (!isNonEmptyString(p.sourceSystem)) {
    errors.push('sourceSystem is required');
  } else if (!(VALID_SOURCE_SYSTEMS as readonly string[]).includes(p.sourceSystem as string)) {
    errors.push(`sourceSystem must be one of: ${VALID_SOURCE_SYSTEMS.join(', ')}`);
  }

  if (!isNonEmptyString(p.quoteReference)) {
    errors.push('quoteReference is required');
  }

  // --- Customer validation ---

  if (!p.customer || typeof p.customer !== 'object') {
    errors.push('customer object is required');
  } else {
    const customer = p.customer as Record<string, unknown>;

    if (!isNonEmptyString(customer.name)) {
      errors.push('customer.name is required');
    }

    // At least one contact method
    const hasEmail = isNonEmptyString(customer.email);
    const hasPhone = isNonEmptyString(customer.phone);

    if (!hasEmail && !hasPhone) {
      errors.push('At least one contact method required: customer.email or customer.phone');
    }

    // Format validations (only if provided)
    if (hasEmail && !isValidEmail(customer.email)) {
      errors.push('customer.email has invalid format');
    }
    if (hasPhone && !isValidPhone(customer.phone)) {
      errors.push('customer.phone has invalid format');
    }
  }

  // --- Products validation ---

  if (!Array.isArray(p.products) || p.products.length === 0) {
    errors.push('products array must contain at least one item');
  }

  // --- Amount validation ---

  if (p.quoteAmountClp !== undefined && !isPositiveNumber(p.quoteAmountClp)) {
    errors.push('quoteAmountClp must be a positive number');
  }

  // --- Optional enum validations ---

  if (p.leadType !== undefined && !(VALID_LEAD_TYPES as readonly string[]).includes(p.leadType as string)) {
    errors.push(`leadType must be one of: ${VALID_LEAD_TYPES.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Type guard: assert payload is QuotePayload after validation.
 * Throws if validation fails.
 */
export function assertValidQuotePayload(payload: unknown): asserts payload is QuotePayload {
  const result = validateQuotePayload(payload);
  if (!result.valid) {
    throw new Error(`Invalid QuotePayload: ${result.errors.join('; ')}`);
  }
}
