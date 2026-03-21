// src/lib/pipedrive/persons.ts
// Find or create a Pipedrive person with deduplication by email/phone.

import { pipedriveGet, pipedrivePost } from './client';
import { getOptionId } from './fieldOptions';
import type {
  QuoteCustomer,
  PipedrivePerson,
  FindOrCreatePersonResult,
} from '../crm/types';

// --- Constants ---

const LOG_PREFIX = '[persons]';

// --- Helpers ---

interface SearchResultItem {
  item: {
    id: number;
    name: string;
    emails: string[];
    phones: string[];
    organization?: { id: number; name: string } | null;
    custom_fields?: string[];
  };
}

/**
 * Search persons in Pipedrive using the /persons/search endpoint.
 * Always uses exact_match=true to avoid false positives.
 */
async function searchPersons(
  term: string,
  fields: 'email' | 'phone'
): Promise<SearchResultItem[]> {
  const res = await pipedriveGet<{ items: SearchResultItem[] }>(
    '/persons/search',
    { term, fields, exact_match: 'true', limit: '10' }
  );

  if (!res.success || !res.data?.items) return [];
  return res.data.items;
}

/**
 * Pick the best match when multiple persons are found.
 * Returns the person with the highest ID (most recently created).
 */
function pickBestMatch(items: SearchResultItem[]): {
  personId: number;
  conflictDetected: boolean;
} {
  const sorted = [...items].sort((a, b) => b.item.id - a.item.id);
  return {
    personId: sorted[0].item.id,
    conflictDetected: items.length > 1,
  };
}

// --- Main export ---

/**
 * Find an existing person by email (primary) or phone (fallback),
 * or create a new one if no match is found.
 *
 * Deduplication strategy:
 *  1. Search by email with exact_match=true
 *  2. If no match and phone is available, search by phone with exact_match=true
 *  3. If still no match, create a new person
 *
 * When multiple matches are found, the most recently created is used
 * and conflictDetected is set to true.
 */
export async function findOrCreatePerson(
  customer: QuoteCustomer
): Promise<FindOrCreatePersonResult> {
  // 1. Search by email
  if (customer.email) {
    const emailResults = await searchPersons(customer.email, 'email');

    if (emailResults.length > 0) {
      const { personId, conflictDetected } = pickBestMatch(emailResults);
      console.log(
        `${LOG_PREFIX} Found person by email: ${personId}` +
          (conflictDetected ? ' (conflict detected)' : '')
      );
      return { personId, action: 'found', conflictDetected };
    }
  }

  // 2. Fallback: search by phone
  if (customer.phone) {
    const phoneResults = await searchPersons(customer.phone, 'phone');

    if (phoneResults.length > 0) {
      const { personId, conflictDetected } = pickBestMatch(phoneResults);
      console.log(
        `${LOG_PREFIX} Found person by phone: ${personId}` +
          (conflictDetected ? ' (conflict detected)' : '')
      );
      return { personId, action: 'found', conflictDetected };
    }
  }

  // 3. Create new person
  const body: Record<string, unknown> = {
    name: customer.name,
  };

  if (customer.email) {
    body.email = [{ value: customer.email, primary: true, label: 'work' }];
  }
  if (customer.phone) {
    body.phone = [{ value: customer.phone, primary: true, label: 'work' }];
  }

  // Custom fields (resolved at runtime via fieldOptions cache)
  const customerTypeKey = process.env.PIPEDRIVE_PERSON_FIELD_CUSTOMER_TYPE;
  if (customerTypeKey && customer.preferredChannel) {
    const optionId = getOptionId('person', customerTypeKey, customer.preferredChannel);
    if (optionId !== undefined) {
      body[customerTypeKey] = optionId;
    }
  }

  const preferredChannelKey = process.env.PIPEDRIVE_PERSON_FIELD_PREFERRED_CHANNEL;
  if (preferredChannelKey && customer.preferredChannel) {
    const optionId = getOptionId('person', preferredChannelKey, customer.preferredChannel);
    if (optionId !== undefined) {
      body[preferredChannelKey] = optionId;
    }
  }

  const res = await pipedrivePost<PipedrivePerson>('/persons', body);

  if (!res.success || !res.data) {
    throw new Error(
      `${LOG_PREFIX} Failed to create person: ${res.error ?? 'unknown error'}`
    );
  }

  console.log(`${LOG_PREFIX} Created person: ${res.data.id}`);
  return { personId: res.data.id, action: 'created' };
}
