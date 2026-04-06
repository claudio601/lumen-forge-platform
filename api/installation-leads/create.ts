// api/installation-leads/create.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/installation-leads/create
//
// Endpoint dedicado para leads del pipeline de Instalacion Profesional.
//
// Flujo:
//  1. Auth (INSTALLATION_API_SECRET server-only, nunca expuesta al cliente)
//  2. Rate limiting por IP (10 req / 15 min por IP)
//  3. Validacion de Origin/Referer (solo nuevo.elights.cl en produccion)h
//  4. Honeypot anti-bot (campo website debe estar vacio)
//  5. Validacion del InstallationLeadPayload
//  6. findOrCreatePerson
//  7. createInstallationDeal
//  8. Retorna IDs para trazabilidad
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { initFieldOptions } from '../_lib/pipedrive/fieldOptions.js';
import { pipedrivePost, pipedriveGet, pipedrivePut } from '../_lib/pipedrive/client.js';
import type { PipedriveDeal } from '../_lib/crm/types.js';
import {
  mapInstallationPayloadToDealParams,
  buildInstallationLeadRef,
} from '../_lib/crm/installation-mapping.js';
import type {
  InstallationLeadPayload,
  InstallationLeadResponse,
  CreateInstallationDealParams,
  InstallationCrmResult,
} from '../_lib/crm/installation-types.js';
import { validateInstallationPayload } from './validation.js';

const LOG_PREFIX = '[api/installation-leads/create]';

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;
const ipHits = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_MAX_REQUESTS - 1 };
  }
  if (entry.count >= RATE_MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }
  entry.count += 1;
  return { allowed: true, remaining: RATE_MAX_REQUESTS - entry.count };
}

const ALLOWED_ORIGINS = ['https://nuevo.elights.cl', 'https://elights.cl'];

function isAllowedOrigin(req: VercelRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const origin = req.headers['origin'] ?? '';
  const referer = req.headers['referer'] ?? '';
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o)) ||
         ALLOWED_ORIGINS.some(o => referer.startsWith(o));
}

function isAuthorized(req: VercelRequest): boolean {
  const installSecret = process.env.INSTALLATION_API_SECRET;
  const quotesKey = process.env.QUOTES_API_KEY;
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  if (apiKey || authHeader) {
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const provided = apiKey ?? bearer;
    if (installSecret && provided === installSecret) return true;
    if (quotesKey && provided === quotesKey) return true;
    return false;
  }
  // Sin header y sin env vars → modo dev/local sin configuración → permitir
  // Sin header pero con env vars → producción sin credencial → rechazar (fix bug: era true)
  if (!installSecret && !quotesKey) return true;
  console.warn(LOG_PREFIX + ' Unauthorized: no API key provided (header required in production)');
  return false;
}

async function findExistingInstallationDeal(leadRef: string, pipelineId: number): Promise<PipedriveDeal | null> {
  const fieldKey = process.env.PIPEDRIVE_INSTALL_FIELD_LEAD_REF;
  if (!fieldKey) { console.warn(LOG_PREFIX + ' PIPEDRIVE_INSTALL_FIELD_LEAD_REF not set — skipping idempotency check'); return null; }
  const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>('/deals/search', { term: leadRef, fields: 'custom_fields', exact_match: 'true', limit: '5' });
  if (!res.success || !res.data?.items) return null;
  for (const { item } of res.data.items) {
    if (item.pipeline_id === pipelineId && item.status === 'open') {
      const full = await pipedriveGet<PipedriveDeal>('/deals/' + item.id);
      if (full.success && full.data && String(full.data[fieldKey]) === leadRef) return full.data;
    }
  }
  return null;
}

async function createInstallationDeal(params: CreateInstallationDealParams): Promise<{ dealId: number; dealAction: 'created' | 'updated' }> {
  const leadRef = params.customFields[process.env.PIPEDRIVE_INSTALL_FIELD_LEAD_REF ?? ''];
  if (typeof leadRef === 'string' && leadRef) {
    const existing = await findExistingInstallationDeal(leadRef, params.pipelineId);
    if (existing) { console.log(LOG_PREFIX + ' Found existing deal: ' + existing.id); await pipedrivePut('/deals/' + existing.id, { title: params.title }); return { dealId: existing.id, dealAction: 'updated' }; }
  }
  const body: Record<string, unknown> = { title: params.title, person_id: params.personId, pipeline_id: params.pipelineId, stage_id: params.stageId, value: 0, currency: 'CLP', ...params.customFields };
  const res = await pipedrivePost<PipedriveDeal>('/deals', body);
  if (!res.success || !res.data) throw new Error(LOG_PREFIX + ' Failed to create deal: ' + (res.error ?? 'unknown'));
  console.log(LOG_PREFIX + ' Created deal: ' + res.data.id);
  return { dealId: res.data.id, dealAction: 'created' };
}

async function processInstallationLead(payload: InstallationLeadPayload): Promise<InstallationCrmResult> {
  await initFieldOptions();
  const person = await findOrCreatePerson({ name: payload.nombre.trim(), email: payload.email.trim() || undefined, phone: payload.telefono.trim() || undefined, preferredChannel: payload.preferenciaContacto === 'whatsapp' ? 'WhatsApp' : payload.preferenciaContacto === 'llamada' ? 'Telefono' : 'Email', commune: payload.comuna.trim() || undefined });
  console.log(LOG_PREFIX + ' Person: ' + person.personId + ' (' + person.action + ')');
  const dealParams = mapInstallationPayloadToDealParams(payload, person.personId);
  const { dealId, dealAction } = await createInstallationDeal(dealParams);
  return { personId: person.personId, personAction: person.action, dealId, dealAction, leadScore: dealParams.leadScore, priorityTier: dealParams.priorityTier };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }

  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
  const rate = checkRateLimit(ip);
  if (!rate.allowed) { console.warn(LOG_PREFIX + ' Rate limit exceeded for IP: ' + ip); res.status(429).json({ success: false, error: 'Too many requests. Try again later.' }); return; }

  if (!isAllowedOrigin(req)) { console.warn(LOG_PREFIX + ' Blocked origin:', req.headers['origin']); res.status(403).json({ success: false, error: 'Forbidden' }); return; }

  if (!isAuthorized(req)) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

  const body = req.body ?? {};
  if (body.website) { console.warn(LOG_PREFIX + ' Honeypot triggered'); res.status(200).json({ success: true }); return; }

  const validation = validateInstallationPayload(body);
  if (!validation.valid) { console.warn(LOG_PREFIX + ' Validation failed:', validation.errors); res.status(400).json({ success: false, error: 'Validation failed', details: { errors: validation.errors } } satisfies InstallationLeadResponse); return; }

  const payload = body as InstallationLeadPayload;
  try {
    console.log(LOG_PREFIX + ' Processing lead: ' + payload.email + ' | ' + payload.tipoProyecto + ' | ' + payload.comuna);
    const result = await processInstallationLead(payload);
    console.log(LOG_PREFIX + ' Done — deal: ' + result.dealId + ' (' + result.dealAction + ') score: ' + result.leadScore);
    res.status(result.dealAction === 'created' ? 201 : 200).json({ success: true, personId: result.personId, dealId: result.dealId, dealAction: result.dealAction, leadScore: result.leadScore, priorityTier: result.priorityTier } satisfies InstallationLeadResponse);
  } catch (err) {
    console.error(LOG_PREFIX + ' Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies InstallationLeadResponse);
  }
}
