// src/lib/pipedrive/activities.ts
// Create Pipedrive activities for follow-up scheduling (24h / 72h), and the owner's attention task
// of the shipping notice (createAttentionTask: the notice went out but Pipedrive did not record it).

import { escapeHtml } from '../html/escape.js';
import { redact } from '../logging/redact.js';
import { pipedriveGet, pipedrivePost, pipedrivePut } from './client.js';
import { pipedriveErrorCode } from './errorCode.js';
import { getBooleanOptionId } from './fieldOptions.js';
import type {
  PipedriveActivity,
  PipedriveDeal,
  CreateActivityResult,
} from '../crm/types.js';

// --- Constants ---

const LOG_PREFIX = '[activities]';

/**
 * Activity type to use when creating follow-ups.
 * Configurable via PIPEDRIVE_ACTIVITY_TYPE env var.
 *
 * Pipedrive accounts come with default types (call, meeting, task, etc.)
 * but custom types can be added. This env var allows matching whatever
 * type key is configured in the target account.
 *
 * Falls back to 'task' only if not configured.
 */
function getActivityType(): string {
  const configured = process.env.PIPEDRIVE_ACTIVITY_TYPE;
  if (!configured) {
    console.warn(
      `${LOG_PREFIX} PIPEDRIVE_ACTIVITY_TYPE not set, falling back to "task". ` +
      'Set this env var to match an activity type key in your Pipedrive account.'
    );
    return 'task';
  }
  return configured;
}

// --- Types ---

export interface CreateActivityParams {
  dealId: number;
  personId: number;
  orgId?: number;
  userId: number;
  type: 'followup_24h' | 'followup_72h';
  quoteReference: string;
}

// --- Helpers ---

/**
 * Compute the due date and time based on the follow-up type.
 * - followup_24h: now + 24 hours
 * - followup_72h: now + 72 hours
 *
 * Returns { due_date: 'YYYY-MM-DD', due_time: 'HH:MM' } in local time.
 */
function computeDueDateTime(type: 'followup_24h' | 'followup_72h'): {
  due_date: string;
  due_time: string;
} {
  const now = new Date();
  const hoursToAdd = type === 'followup_24h' ? 24 : 72;
  const dueDate = new Date(now.getTime() + hoursToAdd * 60 * 60 * 1000);

  const yyyy = dueDate.getFullYear();
  const mm = String(dueDate.getMonth() + 1).padStart(2, '0');
  const dd = String(dueDate.getDate()).padStart(2, '0');
  const hh = String(dueDate.getHours()).padStart(2, '0');
  const min = String(dueDate.getMinutes()).padStart(2, '0');

  return {
    due_date: `${yyyy}-${mm}-${dd}`,
    due_time: `${hh}:${min}`,
  };
}

/**
 * Build a human-readable subject line for the follow-up activity.
 */
function buildSubject(
  type: 'followup_24h' | 'followup_72h',
  quoteReference: string
): string {
  const label = type === 'followup_24h' ? 'Seguimiento 24h' : 'Seguimiento 72h';
  return `${label} - ${quoteReference}`;
}

// --- Main export ---

/**
 * Create a follow-up activity associated with a deal, person, and (optionally) org.
 *
 * The activity type is read from PIPEDRIVE_ACTIVITY_TYPE env var to ensure
 * it matches a valid type key in the Pipedrive account. Falls back to 'task'
 * with a warning if not configured.
 *
 * Due date/time is computed as:
 *  - followup_24h → current time + 24 hours
 *  - followup_72h → current time + 72 hours
 *
 * IMPORTANT: This function always creates a new activity — it does NOT
 * check for existing duplicates. The caller (typically cron/followups.ts)
 * MUST verify that no duplicate activity exists for the deal before calling
 * this function. Use the deal custom fields followup24Created / followup72Created
 * as flags to track whether follow-ups have already been scheduled.
 */
export async function createActivity(
  params: CreateActivityParams
): Promise<CreateActivityResult> {
  const { due_date, due_time } = computeDueDateTime(params.type);
  const subject = buildSubject(params.type, params.quoteReference);
  const activityType = getActivityType();

  const body: Record<string, unknown> = {
    subject,
    type: activityType,
    due_date,
    due_time,
    deal_id: params.dealId,
    person_id: params.personId,
    user_id: params.userId,
    done: 0, // Pipedrive uses 0/1 for boolean on activities
  };

  if (params.orgId) {
    body.org_id = params.orgId;
  }

  const res = await pipedrivePost<PipedriveActivity>('/activities', body);

  if (!res.success || !res.data) {
    throw new Error(
      `${LOG_PREFIX} Failed to create ${params.type} activity: ${res.error ?? 'unknown error'}`
    );
  }

  console.log(
    `${LOG_PREFIX} Created ${params.type} activity: ${res.data.id} (due: ${due_date} ${due_time})`
  );

  return {
    activityId: res.data.id,
    type: params.type,
  };
}

// --- Idempotency helpers (Ticket A — H1 fix) ---

/**
 * Check whether the followup_24h activity has already been created for a deal,
 * by reading the deal's followup24Created custom field flag.
 *
 * Fail-open semantics: if the env var is missing, the option ID cannot be
 * resolved, or the deal fetch fails, returns false. Better to risk an
 * eventual duplicate than to never create the activity.
 *
 * Returns true only when the field's current value matches the resolved
 * "Sí" option ID for that field.
 */
export async function hasFollowup24Created(dealId: number): Promise<boolean> {
  const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24;
  if (!fieldKey) {
    console.warn(
      `${LOG_PREFIX} hasFollowup24Created fail-open reason=missing_env_var dealId=${dealId}`
    );
    return false;
  }
  const yesId = getBooleanOptionId('deal', fieldKey, true);
  if (yesId === undefined) {
    console.warn(
      `${LOG_PREFIX} hasFollowup24Created fail-open reason=option_unresolved dealId=${dealId}`
    );
    return false;
  }
  const res = await pipedriveGet<PipedriveDeal>(`/deals/${dealId}`);
  if (!res.success || !res.data) {
    console.warn(
      `${LOG_PREFIX} hasFollowup24Created fail-open reason=fetch_failed dealId=${dealId}`
    );
    return false;
  }
  const value = (res.data as Record<string, unknown>)[fieldKey];
  if (value === null || value === undefined || value === '') return false;
  return String(value) === String(yesId);
}

/**
 * Mark the followup_24h flag on a deal as "Sí". Best-effort: any failure
 * is logged but never thrown, so a successfully-created activity does not
 * cascade into a webhook 500.
 */
export async function markFollowup24Created(dealId: number): Promise<void> {
  const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24;
  if (!fieldKey) {
    console.warn(
      `${LOG_PREFIX} markFollowup24Created skipped reason=missing_env_var dealId=${dealId}`
    );
    return;
  }
  const yesId = getBooleanOptionId('deal', fieldKey, true);
  if (yesId === undefined) {
    console.warn(
      `${LOG_PREFIX} markFollowup24Created skipped reason=option_unresolved dealId=${dealId}`
    );
    return;
  }
  try {
    const res = await pipedrivePut<PipedriveDeal>(`/deals/${dealId}`, {
      [fieldKey]: yesId,
    });
    if (!res.success) {
      console.warn(
        `${LOG_PREFIX} markFollowup24Created failed dealId=${dealId} error=${pipedriveErrorCode(res.error)}`
      );
    } else {
      console.log(`${LOG_PREFIX} followup24Created marked dealId=${dealId}`);
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} markFollowup24Created error dealId=${dealId}:`, redact(err, 'error'));
  }
}

// --- Tarea de atención al dueño (aviso de despacho, spec Nivel 2 §3 paso 11) ---

export interface AttentionTaskParams {
  dealId: number;
  /** La persona del negocio, si se conoce. */
  personId?: number | null;
  /** PIPEDRIVE_OWNER_USER_ID. */
  userId: number;
  /** Asunto de la tarea, sin datos del cliente («ATENCIÓN aviso de despacho: …»). */
  subject: string;
  /** Texto plano de la nota de la tarea: se escapa aquí (Pipedrive la guarda como HTML). */
  note: string;
  /** Plazo de quien llama (lo que le queda a la función). */
  timeoutMs: number;
  /** Vence ahora: la tarea es para hoy. */
  now?: Date;
}

/**
 * Tarea para el dueño, que vence ahora, con el tipo de PIPEDRIVE_ACTIVITY_TYPE (el mismo de los
 * seguimientos, que ya existe en la cuenta). La usa el aviso de despacho cuando el correo salió y
 * Pipedrive no registró la nota o los campos. A diferencia de createActivity, no lanza, acepta un
 * plazo y no exige persona. Pipedrive lee due_date y due_time en UTC.
 */
export async function createAttentionTask(
  params: AttentionTaskParams
): Promise<{ ok: true; activityId: number | null } | { ok: false; error: string }> {
  const now = params.now ?? new Date();
  const iso = now.toISOString();
  const body: Record<string, unknown> = {
    subject: params.subject.slice(0, 200),
    type: getActivityType(),
    due_date: iso.slice(0, 10),
    due_time: iso.slice(11, 16),
    deal_id: params.dealId,
    user_id: params.userId,
    note: escapeHtml(params.note).replace(/\n/g, '<br>'),
    done: 0,
  };
  if (params.personId) body.person_id = params.personId;
  try {
    const res = await pipedrivePost<PipedriveActivity>('/activities', body, undefined, Math.max(1, params.timeoutMs));
    if (!res.success) {
      const error = pipedriveErrorCode(res.error);
      console.warn(`${LOG_PREFIX} attention task failed dealId=${params.dealId} error=${error}`);
      return { ok: false, error };
    }
    console.log(`${LOG_PREFIX} attention task created dealId=${params.dealId}`);
    return { ok: true, activityId: typeof res.data?.id === 'number' ? res.data.id : null };
  } catch {
    console.warn(`${LOG_PREFIX} attention task failed dealId=${params.dealId} error=otro`);
    return { ok: false, error: 'otro' };
  }
}
