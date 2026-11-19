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
// Respuesta inmediata (spec Nivel 2, §3 paso 3): con Basic Auth válido responde 200 de inmediato y
// todo lo demás corre en waitUntil (maxDuration de 60 s en vercel.json), incluida la consulta en frío
// de /dealFields. Pipedrive da 10 s y, si no le llega respuesta, reintenta el mismo evento.
//
// Aviso de despacho: si en este evento «Despacho · Aviso» cambió a una opción (antes del filtro de
// embudo), se llama a processShippingNotice (api/_lib/shipping/notice.ts), que relee el negocio y
// decide. El flujo de estado y etapa sigue igual, en el mismo segundo plano.
//
// Registros: una línea por evento, solo con metadatos (versión, entidad, acción, id del negocio,
// change_source, si fue masivo y qué se hizo). Nunca el cuerpo, nombres, correos, teléfonos ni
// valores de campos.

import { redact } from '../_lib/logging/redact.js';
import { findDealFieldByName } from '../_lib/pipedrive/fieldOptions.js';
import { SHIPPING_FIELD_NAMES } from '../_lib/shipping/fields.js';
import { processShippingNotice } from '../_lib/shipping/notice.js';
import {
  normalizeWebhookBody,
  optionFieldSetInEvent,
  type NormalizedWebhookEvent,
} from '../_lib/pipedrive/webhookEvent.js';
import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const LOG_PREFIX = '[pipedrive/webhook]';

/** Nombre exacto del campo disparador en Pipedrive (spec §4.1). */
export const SHIPPING_TRIGGER_FIELD_NAME = SHIPPING_FIELD_NAMES.trigger;
/**
 * Plazo de la consulta en frío de /dealFields. Corre después de responder (waitUntil): no compite
 * con los 10 s de Pipedrive, pero sí con el plazo del aviso (50 s desde que llegó el webhook). Si no
 * alcanza, el disparador no se revisa: el dueño lo vacía y lo vuelve a elegir.
 */
export const FIELD_LOOKUP_TIMEOUT_MS = 8_000;

// --- Basic Auth validator ---

/**
 * Nunca lanza (auditoría de la #196): la cabecera tiene que ser texto y se comparan los largos en
 * bytes, que es lo que exige timingSafeEqual (con una «é» el largo en caracteres coincidía y
 * lanzaba RangeError en vez de responder 401).
 */
function validateBasicAuth(req: VercelRequest): 'ok' | 'unauthorized' | 'misconfigured' {
  const user = process.env.PIPEDRIVE_WEBHOOK_USER;
  const password = process.env.PIPEDRIVE_WEBHOOK_PASSWORD;

  if (!user || !password) {
    return 'misconfigured';
  }

  try {
    const authHeader: unknown = req.headers?.['authorization'];
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) {
      return 'unauthorized';
    }

    const expected = 'Basic ' + Buffer.from(`${user}:${password}`, 'utf8').toString('base64');
    const authBuf = Buffer.from(authHeader, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (authBuf.length !== expectedBuf.length) return 'unauthorized';
    return crypto.timingSafeEqual(authBuf, expectedBuf) ? 'ok' : 'unauthorized';
  } catch {
    return 'unauthorized';
  }
}

/** El cuerpo, sin lanzar: en Vercel `req.body` es un getter que lanza si el JSON no es válido. */
function readBody(req: VercelRequest): unknown {
  try {
    return req.body;
  } catch {
    return undefined;
  }
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

/** Disparador elegido en este evento: la clave del campo y la opción que dejó. */
interface TriggerFired {
  key: string;
  optionId: number;
}

/**
 * Revisa el disparador del aviso de despacho. Solo consulta /dealFields si en este evento cambió
 * algún campo personalizado. Nunca lanza. Devuelve qué pasó (para el registro) o null si no se
 * revisó y, si se eligió una opción, la clave y la opción.
 */
async function checkShippingTrigger(event: NormalizedWebhookEvent): Promise<{ code: string | null; fired: TriggerFired | null }> {
  const skip = (code: string | null) => ({ code, fired: null });
  if (event.changedCustomFields.length === 0) return skip(null);
  const lookup = await findDealFieldByName(SHIPPING_TRIGGER_FIELD_NAME, { timeoutMs: FIELD_LOOKUP_TIMEOUT_MS });
  if (lookup.status === 'unavailable') return skip('campos_no_disponibles');
  if (lookup.status === 'missing') return skip('campo_no_existe');
  if (lookup.status === 'duplicate') return skip('campo_repetido');
  if (lookup.field.fieldType !== 'enum') return skip('campo_no_es_opcion');
  const result = optionFieldSetInEvent(event, lookup.field.key);
  if (result.fired === false) return skip(result.reason);
  return { code: 'disparador', fired: { key: lookup.field.key, optionId: result.optionId } };
}

type Outcome =
  | { kind: 'ignored'; reason: string }
  | { kind: 'processed'; dealId: number; actions: string[]; aviso: string | null; trigger: TriggerFired | null };

async function processEvent(event: NormalizedWebhookEvent | null): Promise<Outcome> {
  if (!event) return { kind: 'ignored', reason: 'formato_desconocido' };

  const company = process.env.PIPEDRIVE_COMPANY_ID?.trim();
  if (company && event.companyId !== company) return { kind: 'ignored', reason: 'otra_compania' };
  if (event.isBulk) return { kind: 'ignored', reason: 'masivo' };
  if (event.entity !== 'deal') return { kind: 'ignored', reason: 'entidad' };
  if (event.action !== 'change') return { kind: 'ignored', reason: 'accion' };
  if (event.entityId === null || !event.current) return { kind: 'ignored', reason: 'sin_datos' };

  // El disparador va antes del filtro de embudo: el aviso sirve a los negocios de los dos embudos.
  const { code: aviso, fired: trigger } = await checkShippingTrigger(event);

  // Etapa y estado: solo los negocios del embudo de los formularios (si está definido).
  const pipelineId = Number(process.env.PIPEDRIVE_PIPELINE_ID);
  if (pipelineId && event.current.pipelineId !== pipelineId) {
    return { kind: 'processed', dealId: event.entityId, actions: ['otro_embudo'], aviso, trigger };
  }

  // Estado y etapa por separado: un mismo evento puede cambiar los dos (p. ej., ganar y mover).
  const actions: string[] = [];
  if (event.statusChange) actions.push(handleDealStatusChange(event.statusChange));
  if (event.stageChange) actions.push(handleDealStageChange(event.stageChange));
  if (actions.length === 0) actions.push('sin_cambio_de_etapa_ni_estado');
  return { kind: 'processed', dealId: event.entityId, actions, aviso, trigger };
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

/**
 * Todo lo que va después del 200: normaliza, filtra, registra el evento y, si se eligió el
 * disparador, procesa el aviso. Nunca rechaza (waitUntil no tiene a quién avisar).
 */
export async function processWebhook(body: unknown, startedAt: number): Promise<void> {
  try {
    const event = normalizeWebhookBody(body);
    const outcome = await processEvent(event);
    logEvent(event, outcome);
    if (outcome.kind === 'processed' && outcome.trigger) {
      await processShippingNotice({
        dealId: outcome.dealId,
        triggerKey: outcome.trigger.key,
        triggerOptionId: outcome.trigger.optionId,
        startedAt,
      });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Error processing webhook:`, redact(err, 'error'));
  }
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

  // 200 de inmediato; lo demás, en segundo plano. Todo evento responde 200 (también los que se
  // ignoran): un error repetido haría que Pipedrive reintente, acumule fallas y, tras 3 días sin
  // entregas exitosas, borre el webhook.
  waitUntil(processWebhook(readBody(req), Date.now()));
  res.status(200).json({ success: true });
}
