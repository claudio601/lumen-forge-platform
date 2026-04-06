// api/installation-leads/create.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/installation-leads/create
//
// Endpoint dedicado para leads del pipeline de Instalacion Profesional.
// Completamente independiente de /api/quotes/create — no comparte pipeline,
// stages, ni custom fields. Los cambios en uno no afectan al otro.
//
// Flujo:
//   1. Auth (misma QUOTES_API_KEY, endpoint distinto)
//   2. Validacion del InstallationLeadPayload
//   3. findOrCreatePerson (reutiliza la capa existente — misma persona, distintos deals)
//   4. createInstallationDeal (pipeline instalacion, con sus propios custom fields)
//   5. Retorna IDs para trazabilidad
//
// ESTADO: Scaffold listo para conectar.
//   - Los pasos 1, 2, 3 y 5 funcionan sin configuracion adicional.
//   - El paso 4 requiere que las env vars del pipeline instalacion esten
//     configuradas en Vercel (ver lista al final de este archivo y en .env.example).
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

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Reutiliza QUOTES_API_KEY (mismo token, endpoint distinto).
 * Acepta x-api-key header o Authorization: Bearer <key>.
 */
function isAuthorized(req: VercelRequest): boolean {
  const expectedKey = process.env.QUOTES_API_KEY;
  if (!expectedKey) {
    console.warn(LOG_PREFIX + ' QUOTES_API_KEY not set');
    return false;
  }
  const apiKey = req.headers['x-api-key'];
  if (apiKey === expectedKey) return true;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ') && auth.slice(7) === expectedKey) return true;
  return false;
}

// ── Deal creation (installation pipeline) ────────────────────────────────────

/**
 * Idempotencia por PIPEDRIVE_INSTALL_FIELD_LEAD_REF.
 * Si el campo no esta configurado, crea siempre (sin idempotencia).
 */
async function findExistingInstallationDeal(
  leadRef: string,
  pipelineId: number
): Promise<PipedriveDeal | null> {
  const fieldKey = process.env.PIPEDRIVE_INSTALL_FIELD_LEAD_REF;
  if (!fieldKey) {
    console.warn(LOG_PREFIX + ' PIPEDRIVE_INSTALL_FIELD_LEAD_REF not set — skipping idempotency check');
    return null;
  }

  const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
    '/deals/search',
    { term: leadRef, fields: 'custom_fields', exact_match: 'true', limit: '5' }
  );

  if (!res.success || !res.data?.items) return null;

  for (const { item } of res.data.items) {
    if (item.pipeline_id === pipelineId && item.status === 'open') {
      const full = await pipedriveGet<PipedriveDeal>('/deals/' + item.id);
      if (full.success && full.data && String(full.data[fieldKey]) === leadRef) {
        return full.data;
      }
    }
  }
  return null;
}

async function createInstallationDeal(
  params: CreateInstallationDealParams
): Promise<{ dealId: number; dealAction: 'created' | 'updated' }> {
  // Idempotency: check by leadRef custom field
  const leadRef = params.customFields[process.env.PIPEDRIVE_INSTALL_FIELD_LEAD_REF ?? ''];
  if (typeof leadRef === 'string' && leadRef) {
    const existing = await findExistingInstallationDeal(leadRef, params.pipelineId);
    if (existing) {
      console.log(LOG_PREFIX + ' Found existing deal: ' + existing.id);
      // Update title (in case data changed)
      await pipedrivePut('/deals/' + existing.id, { title: params.title });
      return { dealId: existing.id, dealAction: 'updated' };
    }
  }

  // Build deal body
  const body: Record<string, unknown> = {
    title: params.title,
    person_id: params.personId,
    pipeline_id: params.pipelineId,
    stage_id: params.stageId,
    value: 0,           // sin monto inicial en leads de instalacion
    currency: 'CLP',
    ...params.customFields,
  };

  const res = await pipedrivePost<PipedriveDeal>('/deals', body);
  if (!res.success || !res.data) {
    throw new Error(LOG_PREFIX + ' Failed to create deal: ' + (res.error ?? 'unknown'));
  }

  console.log(LOG_PREFIX + ' Created deal: ' + res.data.id);
  return { dealId: res.data.id, dealAction: 'created' };
}

// ── CRM processing ────────────────────────────────────────────────────────────

async function processInstallationLead(
  payload: InstallationLeadPayload
): Promise<InstallationCrmResult> {
  // 1. Init field options (shared cache with quotes pipeline)
  await initFieldOptions();

  // 2. Find or create person (reutiliza el modulo existente)
  const person = await findOrCreatePerson({
    name: payload.nombre.trim(),
    email: payload.email.trim() || undefined,
    phone: payload.telefono.trim() || undefined,
    preferredChannel: payload.preferenciaContacto === 'whatsapp'
      ? 'WhatsApp'
      : payload.preferenciaContacto === 'llamada'
      ? 'Telefono'
      : 'Email',
    commune: payload.comuna.trim() || undefined,
  });

  console.log(
    LOG_PREFIX + ' Person: ' + person.personId + ' (' + person.action + ')'
  );

  // 3. Map payload to deal params
  const dealParams = mapInstallationPayloadToDealParams(payload, person.personId);

  // 4. Create or update deal in installation pipeline
  const { dealId, dealAction } = await createInstallationDeal(dealParams);

  return {
    personId: person.personId,
    personAction: person.action,
    dealId,
    dealAction,
    leadScore: dealParams.leadScore,
    priorityTier: dealParams.priorityTier,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const validation = validateInstallationPayload(req.body);
  if (!validation.valid) {
    console.warn(LOG_PREFIX + ' Validation failed:', validation.errors);
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: { errors: validation.errors },
    } satisfies InstallationLeadResponse);
    return;
  }

  const payload = req.body as InstallationLeadPayload;

  try {
    console.log(
      LOG_PREFIX + ' Processing lead: ' + payload.email +
      ' | ' + payload.tipoProyecto +
      ' | ' + payload.comuna
    );

    const result = await processInstallationLead(payload);

    console.log(
      LOG_PREFIX + ' Done — deal: ' + result.dealId +
      ' (' + result.dealAction + ')' +
      ' score: ' + result.leadScore
    );

    res.status(result.dealAction === 'created' ? 201 : 200).json({
      success: true,
      personId: result.personId,
      dealId: result.dealId,
      dealAction: result.dealAction,
      leadScore: result.leadScore,
      priorityTier: result.priorityTier,
    } satisfies InstallationLeadResponse);

  } catch (err) {
    console.error(LOG_PREFIX + ' Error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } satisfies InstallationLeadResponse);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENV VARS REQUERIDAS PARA ESTE ENDPOINT
// (ademas de las ya existentes: PIPEDRIVE_API_TOKEN, QUOTES_API_KEY, etc.)
//
// Variable                              Estado       Descripcion
// ────────────────────────────────────────────────────────────────────────────
// PIPEDRIVE_INSTALL_PIPELINE_ID         PENDIENTE    ID del pipeline "Instalacion Profesional"
// PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID   PENDIENTE    ID del stage "Nuevo lead" en ese pipeline
//
// PIPEDRIVE_INSTALL_FIELD_SOURCE        PENDIENTE    Field key (Enum): origen del lead
// PIPEDRIVE_INSTALL_FIELD_PROJECT_TYPE  PENDIENTE    Field key (Enum): tipo de proyecto
// PIPEDRIVE_INSTALL_FIELD_CLIENT_TYPE   PENDIENTE    Field key (Enum): tipo de cliente
// PIPEDRIVE_INSTALL_FIELD_COMMUNE       PENDIENTE    Field key (Text): comuna
// PIPEDRIVE_INSTALL_FIELD_DESCRIPTION   PENDIENTE    Field key (Text large): descripcion
// PIPEDRIVE_INSTALL_FIELD_NEEDS_VISIT   PENDIENTE    Field key (Boolean): requiere visita
// PIPEDRIVE_INSTALL_FIELD_CONTACT_PREF  PENDIENTE    Field key (Enum): preferencia contacto
// PIPEDRIVE_INSTALL_FIELD_LEAD_REF      PENDIENTE    Field key (Text): ref INST-xxxxx (idempotencia)
//
// Reutilizadas sin cambio:
// PIPEDRIVE_OWNER_USER_ID               EXISTENTE    ID del usuario responsable
// QUOTES_API_KEY                        EXISTENTE    API key del endpoint
// PIPEDRIVE_API_TOKEN                   EXISTENTE    Token de la API de Pipedrive
// ─────────────────────────────────────────────────────────────────────────────
