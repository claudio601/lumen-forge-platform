// api/pipedrive/webhook.ts
// Webhook receiver for Pipedrive events.
// Handles deal stage changes and deal status updates (won/lost).
// Can trigger downstream actions: notifications, Jumpseller sync, etc.
//
// Auth: validates HTTP Basic Auth (Authorization header) using
// PIPEDRIVE_WEBHOOK_USER and PIPEDRIVE_WEBHOOK_PASSWORD.
// Configure those same credentials in Pipedrive when registering the webhook
// (http_auth_user / http_auth_password fields).
//
// Cuerpos v1 y v2 (N-05): el webhook configurado manda v2 (`meta.entity`), que antes se ignoraba
// entero («Ignoring undefined event»). api/_lib/pipedrive/webhookEvent.ts los lleva a una forma
// común. Se descartan, con 200, lo que no sea un negocio actualizado, las ediciones masivas y, si
// PIPEDRIVE_COMPANY_ID está definida, otra compañía. No se descarta `change_source: "api"`: la app
// del celular podría llegar así (aviso de despacho, spec §3 paso 3).
//
// Aviso de despacho (spec Nivel 2, §3 paso 3): por ahora solo se detecta el disparador
// («Despacho · Aviso» cambió a una opción en este evento), antes del filtro de embudo, y se registra.
// Todavía no envía nada.
//
// Registros: una línea por evento, solo con metadatos (versión, entidad, acción, id del negocio,
// change_source, si fue masivo y qué se hizo). Nunca el cuerpo, nombres, correos, teléfonos ni
// valores de campos.

import { redact } from '../_lib/logging/redact.js';
import { findDealFieldByName } from '../_lib/pipedrive/fieldOptions.js';
import {
  normalizeWebhookBody,
  optionFieldSetInEvent,
  type NormalizedWebhookEvent,
} from '../_lib/pipedrive/webhookEvent.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const LOG_PREFIX = '[pipedrive/webhook]';

/** Nombre exacto del campo disparador en Pipedrive (spec §4.1). */
export const SHIPPING_TRIGGER_FIELD_NAME = 'Despacho · Aviso';
/**
 * Plazo de la consulta en frío de /dealFields. Pipedrive da 10 s para responder; el 200 inmediato con
 * `waitUntil` llega en la PR del aviso. Si no alcanza, el disparador no se revisa y se reintenta la
 * consulta con el evento siguiente.
 */
export const FIELD_LOOKUP_TIMEOUT_MS = 4_000;

// --- Basic Auth validator ---

function validateBasicAuth(req: VercelRequest): 'ok' | 'unauthorized' | 'misconfigured' {
  const user = process.env.PIPEDRIVE_WEBHOOK_USER;
  const password = process.env.PIPEDRIVE_WEBHOOK_PASSWORD;

  if (!user || !password) {
    return 'misconfigured';
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return 'unauthorized';
  }

  const expected = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  if (authHeader.length !== expected.length) return 'unauthorized';
  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  const valid = crypto.timingSafeEqual(authBuf, expectedBuf);
  return valid ? 'ok' : 'unauthorized';
}

// --- Event processors ---

function handleDealStageChange(change: NonNullable<NormalizedWebhookEvent['stageChange']>): string {
  // TODO: Add logic for specific stage transitions
  // e.g., moving to "proposal sent" stage could trigger an email notification
  // e.g., moving to "negotiation" stage could update Jumpseller order status
  return `etapa(${change.from ?? '-'}->${change.to ?? '-'})`;
}

function handleDealStatusChange(change: NonNullable<NormalizedWebhookEvent['statusChange']>): string {
  const transition = `${change.from ?? '-'}->${change.to ?? '-'}`;
  if (change.to === 'won') {
    // TODO: Trigger order confirmation in Jumpseller, send thank-you email, etc.
    return `ganado(${transition})`;
  }
  if (change.to === 'lost') {
    // TODO: Trigger lost-deal follow-up sequence
    return `perdido(${transition})`;
  }
  return `estado(${transition})`;
}

/**
 * Revisa el disparador del aviso de despacho. Solo consulta /dealFields si en este evento cambió
 * algún campo personalizado. Nunca lanza. Devuelve qué pasó (para el registro) o null si no se revisó.
 */
async function checkShippingTrigger(event: NormalizedWebhookEvent): Promise<string | null> {
  if (event.changedCustomFields.length === 0) return null;
  const lookup = await findDealFieldByName(SHIPPING_TRIGGER_FIELD_NAME, { timeoutMs: FIELD_LOOKUP_TIMEOUT_MS });
  if (lookup.status === 'unavailable') return 'campos_no_disponibles';
  if (lookup.status === 'missing') return 'campo_no_existe';
  if (lookup.status === 'duplicate') return 'campo_repetido';
  if (lookup.field.fieldType !== 'enum') return 'campo_no_es_opcion';
  const result = optionFieldSetInEvent(event, lookup.field.key);
  if (result.fired === false) return result.reason;
  console.log(`${LOG_PREFIX} aviso de despacho: disparador en negocio ${event.entityId} (todavía sin envío)`);
  return 'disparador';
}

type Outcome =
  | { kind: 'ignored'; reason: string }
  | { kind: 'processed'; dealId: number; actions: string[]; aviso: string | null };

async function processEvent(event: NormalizedWebhookEvent | null): Promise<Outcome> {
  if (!event) return { kind: 'ignored', reason: 'formato_desconocido' };

  const company = process.env.PIPEDRIVE_COMPANY_ID?.trim();
  if (company && event.companyId !== company) return { kind: 'ignored', reason: 'otra_compania' };
  if (event.isBulk) return { kind: 'ignored', reason: 'masivo' };
  if (event.entity !== 'deal') return { kind: 'ignored', reason: 'entidad' };
  if (event.action !== 'change') return { kind: 'ignored', reason: 'accion' };
  if (event.entityId === null || !event.current) return { kind: 'ignored', reason: 'sin_datos' };

  // El disparador va antes del filtro de embudo: el aviso sirve a los negocios de los dos embudos.
  const aviso = await checkShippingTrigger(event);

  // Etapa y estado: solo los negocios del embudo de los formularios (si está definido).
  const pipelineId = Number(process.env.PIPEDRIVE_PIPELINE_ID);
  if (pipelineId && event.current.pipelineId !== pipelineId) {
    return { kind: 'processed', dealId: event.entityId, actions: ['otro_embudo'], aviso };
  }

  // Estado y etapa por separado: un mismo evento puede cambiar los dos (p. ej., ganar y mover).
  const actions: string[] = [];
  if (event.statusChange) actions.push(handleDealStatusChange(event.statusChange));
  if (event.stageChange) actions.push(handleDealStageChange(event.stageChange));
  if (actions.length === 0) actions.push('sin_cambio_de_etapa_ni_estado');
  return { kind: 'processed', dealId: event.entityId, actions, aviso };
}

/** La línea del evento: solo metadatos. */
function logEvent(event: NormalizedWebhookEvent | null, outcome: Outcome): void {
  const parts = [
    `version=${event?.version ?? 'desconocida'}`,
    `entidad=${event?.entity ? event.entity.replace(/[^a-z_]/g, '').slice(0, 20) || 'otra' : '-'}`,
    `accion=${event?.action ?? '-'}`,
    `negocio=${event?.entity === 'deal' && event.entityId !== null ? event.entityId : '-'}`,
    `origen=${event?.changeSource ?? '-'}`,
    `masivo=${event?.isBulk ? 'si' : 'no'}`,
    `intento=${event?.attempt ?? '-'}`,
  ];
  if (outcome.kind === 'ignored') {
    parts.push(`hecho=ignorado(${outcome.reason})`);
  } else {
    parts.push(`hecho=${outcome.actions.join(',')}`);
    if (outcome.aviso) parts.push(`aviso=${outcome.aviso}`);
  }
  console.log(`${LOG_PREFIX} evento ${parts.join(' ')}`);
}

// --- Main handler ---

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Validate HTTP Basic Auth
  const authResult = validateBasicAuth(req);
  if (authResult === 'misconfigured') {
    console.error(`${LOG_PREFIX} PIPEDRIVE_WEBHOOK_USER or PIPEDRIVE_WEBHOOK_PASSWORD not configured`);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (authResult === 'unauthorized') {
    console.warn(`${LOG_PREFIX} Unauthorized request`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const event = normalizeWebhookBody(req.body);
    const outcome = await processEvent(event);
    logEvent(event, outcome);

    // Todo lo que no se usa responde 200: un error repetido haría que Pipedrive reintente, acumule
    // fallas y, tras 3 días sin entregas exitosas, borre el webhook.
    if (outcome.kind === 'ignored') {
      res.status(200).json({ success: true, action: 'ignored', reason: outcome.reason });
      return;
    }
    res.status(200).json({ success: true, dealId: outcome.dealId, actions: outcome.actions });
  } catch (err) {
    console.error(`${LOG_PREFIX} Error processing webhook:`, redact(err, 'error'));
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
