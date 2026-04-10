// api/_lib/crm/types.ts
// Shared TypeScript types for eLights CRM integration

export interface QuoteProduct {
  sku?: string;
  name: string;
  quantity: number;
  unitPriceClp?: number;
}

export interface QuoteCustomer {
  name: string;
  email?: string;
  phone?: string;
  preferredChannel?: 'Email' | 'WhatsApp' | 'Telefono';
  commune?: string;
}

export interface QuoteOrganization {
  name: string;
  segment?: 'Constructora' | 'Arquitectura' | 'Instalador' | 'Intermediario' | 'Otro';
  billingCommune?: string;
  isB2BPriority?: boolean;
}

export type SourceSystem = 'nuevo_elights' | 'jumpseller' | 'whatsapp' | 'manual';
export type LeadType = 'B2B' | 'B2C';
export type PriorityTier = 'Alta' | 'Normal';

export interface QuotePayload {
  sourceSystem: SourceSystem;
  /**
   * Human-readable quote reference.
   * For Jumpseller: always "JS-{orderId}" e.g. "JS-12765".
   */
  quoteReference: string;
  /**
   * Raw Jumpseller order ID string, e.g. "12765".
   * Present only when sourceSystem === 'jumpseller'.
   * Never reconstructed from quoteReference.
   */
  jumpsellerOrderId?: string;
  leadType?: LeadType;
  customer: QuoteCustomer;
  organization?: QuoteOrganization;
  products: QuoteProduct[];
  quoteAmountClp: number;
  notes?: string;
  /**
   * Jumpseller webhook event type, e.g. "order_created", "order_paid".
   * Drives the event policy (canCreate / canUpdate).
   */
  jumpsellerEventType?: string;
}

export interface JumpsellerWebhookPayload {
  event: string;
  order?: {
    id: number;
    status: string;
    customer: {
      name?: string;
      email?: string;
      phone?: string;
      billing_address?: { commune?: string; company?: string; };
    };
    products?: Array<{ sku?: string; name: string; qty: number; price: number; }>;
    total?: number;
  };
}

export interface PipedriveWebhookPayload {
  v: number;
  matches_filters?: { current: number[] };
  meta: {
    action: 'added' | 'updated' | 'deleted' | 'merged';
    object: 'deal' | 'person' | 'organization' | 'activity';
    id: number;
    company_id: number;
    user_id: number;
    host: string;
    timestamp: number;
    timestamp_micro: number;
    permitted_user_ids: number[];
    trans_pending: boolean;
    is_bulk_update: boolean;
    pipedrive_service_name?: string;
    change_source?: string;
  };
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
  event: string;
}

export interface LeadScoreResult {
  score: number;
  leadType: LeadType;
  priorityTier: PriorityTier;
}

export interface FindOrCreatePersonResult {
  personId: number;
  action: 'found' | 'created';
  conflictDetected?: boolean;
}

export interface FindOrCreateOrganizationResult {
  organizationId: number;
  action: 'found' | 'created';
  conflictDetected?: boolean;
}

/**
 * Explicit result states for deal operations.
 * - created: new deal created in Pipedrive
 * - updated: existing deal updated
 * - skipped_duplicate: Redis mapping confirmed deal already exists
 * - skipped_lock_contention: lock contested, no mapping appeared after wait
 * - skipped_update_without_existing: update-only event, no existing deal found
 * - blocked_idempotency_unavailable: Redis down on creator event — return 503
 */
export type DealResultStatus =
  | 'created'
  | 'updated'
  | 'skipped_duplicate'
  | 'skipped_lock_contention'
  | 'skipped_update_without_existing'
  | 'blocked_idempotency_unavailable';

export interface CreateDealResult {
  /** Pipedrive deal ID, or null for skipped/blocked statuses. */
  dealId: number | null;
  status: DealResultStatus;
}

export interface CreateActivityResult {
  activityId: number;
  type: 'followup_24h' | 'followup_72h';
}

export interface QuoteCreateSuccessResponse {
  success: true;
  personId: number;
  organizationId: number | null;
  dealId: number | null;
  dealStatus: DealResultStatus;
  leadScore: number;
  priorityTier: PriorityTier;
}

export interface QuoteCreateErrorResponse {
  success: false;
  error: string;
  details?: Record<string, unknown>;
}

export type QuoteCreateResponse = QuoteCreateSuccessResponse | QuoteCreateErrorResponse;

export interface FollowupCronResponse {
  success: true;
  processedDeals: number;
  created24h: number;
  created72h: number;
  skipped: number;
}

export interface PipedriveApiResponse<T> {
  success: boolean;
  data: T | null;
  additional_data?: {
    pagination?: {
      start: number;
      limit: number;
      more_items_in_collection: boolean;
      next_start?: number;
    };
  };
  error?: string;
  error_info?: string;
}

export interface PipedrivePerson {
  id: number;
  name: string;
  email: Array<{ value: string; primary: boolean; label: string }>;
  phone: Array<{ value: string; primary: boolean; label: string }>;
  org_id?: { value: number } | number | null;
  owner_id: { id: number } | number;
  add_time: string;
  update_time: string;
  [key: string]: unknown;
}

export interface PipedriveOrganization {
  id: number;
  name: string;
  owner_id: { id: number } | number;
  add_time: string;
  update_time: string;
  [key: string]: unknown;
}

export interface PipedriveDeal {
  id: number;
  title: string;
  status: 'open' | 'won' | 'lost' | 'deleted';
  pipeline_id: number;
  stage_id: number;
  person_id: { value: number } | number | null;
  org_id: { value: number } | number | null;
  owner_id: { id: number } | number;
  add_time: string;
  update_time: string;
  [key: string]: unknown;
}

export interface PipedriveActivity {
  id: number;
  subject: string;
  done: boolean;
  type: string;
  due_date: string;
  due_time?: string;
  deal_id: number | null;
  person_id: number | null;
  org_id: number | null;
  user_id: number;
  [key: string]: unknown;
}

export interface PipedriveFieldOption {
  id: number;
  label: string;
}

export interface PipedriveField {
  id: number;
  key: string;
  name: string;
  field_type: string;
  options?: PipedriveFieldOption[];
}
