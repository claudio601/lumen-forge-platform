// api/installation-leads/create.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/installation-leads/create
//
// Endpoint dedicado para leads del pipeline de Instalacion Profesional.
//
// Flujo:
//  1. Rate limiting por IP (10 req / 15 min por IP)
//  2. Validacion de Origin/Referer (solo nuevo.elights.cl en produccion)
//  3. Auth (INSTALLATION_API_SECRET server-only, nunca expuesta al cliente)
//  4. Honeypot anti-bot (campo website debe estar vacio)
//  4b. Privacidad (clave `consent`, api/_lib/forms/consent.ts): sin la casilla obligatoria,
//      400 con code 'consent_required' antes del correo y de Pipedrive, también con
//      INSTALLATION_API_SECRET. aceptaContacto sigue siendo obligatorio (_lib/forms/installationLeadValidation.ts).
//  5. Validacion del InstallationLeadPayload
//  6. Referencia INST- unica: la misma en el correo, la nota y el campo del deal
//  7. Correo a ventas via GAS ANTES de Pipedrive (waitUntil, no bloquea)
//  8. findOrCreatePerson + createInstallationDeal + nota con todos los datos
//     -> Pipedrive falla y el correo salio: 200 { success, dealId: null, leadRef, crm: 'failed' }
//        + segundo correo "ATENCIÓN ... Crear el negocio a mano."
//     -> Fallan ambos: 502 con error visible al usuario
//  9. Retorna 201/200 con los IDs y la referencia para trazabilidad
//
// El correo y la nota terminan con la constancia "PRIVACIDAD Y AUTORIZACIONES" y el origen
// de la visita (clave `attribution`, distinta del campo `origen` del formulario;
// api/_lib/forms/attribution.ts). El origen es informativo: un origen raro se descarta,
// nunca da 400, y no entra en la referencia ni en el log.
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
  InstallationLeadSuccessResponse,
  InstallationLeadErrorResponse,
  CreateInstallationDealParams,
  InstallationCrmResult,
} from '../_lib/crm/installation-types.js';
import {
  isAllowedOrigin,
  checkRateLimit,
  isHoneypotTriggered,
  getClientIp,
} from '../_lib/auth.js';
import { notifySales, type SalesEmail } from '../_lib/notify/salesEmail.js';
import { validateInstallationPayload } from '../_lib/forms/installationLeadValidation.js';
import { origenFromBody } from '../_lib/forms/attribution.js';
import { CONSENT_ERROR_CODE, resolveConsent } from '../_lib/forms/consent.js';

const LOG_PREFIX = '[api/installation-leads/create]';

/** Respuestas del endpoint (installation-types.ts está protegido: aquí se agregan leadRef y crm). */
type InstallationLeadApiResponse =
  | (InstallationLeadSuccessResponse & { leadRef: string })
  | { success: true; dealId: null; leadRef: string; crm: 'failed' }
  | InstallationLeadErrorResponse;

function isAuthorized(req: VercelRequest): boolean {
  const installSecret = process.env.INSTALLATION_API_SECRET;
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  if (apiKey || authHeader) {
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const provided = apiKey ?? bearer;
    if (installSecret && provided === installSecret) return true;
    return false;
  }
  // Sin header + origin permitido → formulario web legítimo → permitir
  // Sin header + origin no permitido + sin env var → dev/local → permitir
  // Sin header + origin no permitido + con env var → atacante externo → rechazar
  if (isAllowedOrigin(req)) return true;
  if (!installSecret) return true;
  console.warn(LOG_PREFIX + ' Unauthorized: no header and untrusted origin');
  return false;
}

async function findExistingInstallationDeal(leadRef: string, pipelineId: number): Promise<PipedriveDeal | null> {
  const fieldKey = process.env.PIPEDRIVE_INSTALL_FIELD_LEAD_REF;
  if (!fieldKey) { console.warn(LOG_PREFIX + ' PIPEDRIVE_INSTALL_FIELD_LEAD_REF not set — skipping idempotency check'); return null; }
  const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>('/deals/search', { term: leadRef, fields: 'custom_fields', exact_match: 'true', limit: '5' });
  if (!res.success || !res.data?.items) return null;
  for (const { item } of res.data.items) {
    // /deals/search no trae pipeline_id: el pipeline y el estado se miran en el deal completo
    const full = await pipedriveGet<PipedriveDeal>('/deals/' + item.id);
    if (full.success && full.data && full.data.pipeline_id === pipelineId && full.data.status === 'open' && String(full.data[fieldKey]) === leadRef) return full.data;
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

// ── Correo y nota: los mismos datos, con la referencia en la primera línea ────

const CLIENT_TYPE_LABELS: Record<string, string> = { hogar: 'Hogar / Particular', empresa: 'Empresa', condominio: 'Condominio / Edificio' };
const CONTACT_PREF_LABELS: Record<string, string> = { whatsapp: 'WhatsApp', llamada: 'Llamada telefónica', email: 'Correo electrónico' };

function installationDetailLines(payload: InstallationLeadPayload): string[] {
  return [
    'Tipo de proyecto: ' + payload.tipoProyecto,
    'Tipo de cliente: ' + (CLIENT_TYPE_LABELS[payload.tipoCliente ?? ''] ?? 'No indicado'),
    'Comuna: ' + payload.comuna.trim(),
    'Preferencia de contacto: ' + (CONTACT_PREF_LABELS[payload.preferenciaContacto ?? ''] ?? 'Sin preferencia'),
    'Teléfono: ' + payload.telefono.trim(),
    'Correo: ' + payload.email.trim(),
    '',
    'Descripción:',
    payload.descripcion.trim(),
  ];
}

/** Líneas de la constancia de privacidad, con la línea en blanco que la separa de lo anterior. */
const consentLines = (consent: string[]) => (consent.length ? ['', ...consent] : []);

/**
 * Bloque PRODUCTOS SOLICITADOS del correo a ventas; `consent`: constancia PRIVACIDAD Y
 * AUTORIZACIONES; `origen`: sección ORIGEN DE LA VISITA, al final.
 */
function buildInstallationEmailBody(payload: InstallationLeadPayload, leadRef: string, consent: string[], origen: string[]): string {
  return ['Solicitud de instalación ' + leadRef + ' (buscar la referencia en Pipedrive)', '', ...installationDetailLines(payload), ...consentLines(consent), '', ...origen].join('\n');
}

/** Nota del deal: todos los datos, incluso los que no tienen campo propio en Pipedrive, la constancia y el origen. */
function buildInstallationNote(payload: InstallationLeadPayload, leadRef: string, score: number, tier: string, consent: string[], origen: string[]): string {
  return ['Solicitud de instalación ' + leadRef, '', ...installationDetailLines(payload), '', 'Puntaje: ' + score + ' / 100 (prioridad ' + tier + ')', ...consentLines(consent), '', ...origen].join('\n');
}

/** La nota no bloquea: el correo a ventas ya lleva los mismos datos. */
async function addNoteToDeal(dealId: number, leadRef: string, content: string): Promise<void> {
  try {
    const res = await pipedrivePost<{ id: number }>('/notes', { content, deal_id: dealId });
    if (!res.success) console.warn(LOG_PREFIX + ' Note FAIL | dealId: ' + dealId + ' | ref: ' + leadRef + ' | ' + res.error);
    else console.log(LOG_PREFIX + ' Note added to deal ' + dealId);
  } catch (err) {
    console.warn(LOG_PREFIX + ' Note FAIL | dealId: ' + dealId + ' | ref: ' + leadRef + ' | ' + errorMessage(err));
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function processInstallationLead(payload: InstallationLeadPayload, leadRef: string, consent: string[], origen: string[]): Promise<InstallationCrmResult> {
  await initFieldOptions();
  const person = await findOrCreatePerson({ name: payload.nombre.trim(), email: payload.email.trim() || undefined, phone: payload.telefono.trim() || undefined, preferredChannel: payload.preferenciaContacto === 'whatsapp' ? 'WhatsApp' : payload.preferenciaContacto === 'llamada' ? 'Telefono' : 'Email', commune: payload.comuna.trim() || undefined });
  console.log(LOG_PREFIX + ' ' + leadRef + ' Person: ' + person.personId + ' (' + person.action + ')');
  const mapped = mapInstallationPayloadToDealParams(payload, person.personId);
  // El campo de referencia lleva la misma INST- que el correo y la nota
  const refField = process.env.PIPEDRIVE_INSTALL_FIELD_LEAD_REF;
  const dealParams: CreateInstallationDealParams = refField ? { ...mapped, customFields: { ...mapped.customFields, [refField]: leadRef } } : mapped;
  const { dealId, dealAction } = await createInstallationDeal(dealParams);
  await addNoteToDeal(dealId, leadRef, buildInstallationNote(payload, leadRef, dealParams.leadScore, dealParams.priorityTier, consent, origen));
  return { personId: person.personId, personAction: person.action, dealId, dealAction, leadScore: dealParams.leadScore, priorityTier: dealParams.priorityTier };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }

  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) { console.warn(LOG_PREFIX + ' Rate limit exceeded for IP: ' + ip); res.status(429).json({ success: false, error: 'Too many requests. Try again later.' }); return; }

  if (!isAllowedOrigin(req)) { console.warn(LOG_PREFIX + ' Blocked origin:', req.headers['origin']); res.status(403).json({ success: false, error: 'Forbidden' }); return; }

  if (!isAuthorized(req)) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

  const body = req.body ?? {};
  if (isHoneypotTriggered(body)) { console.warn(LOG_PREFIX + ' Honeypot triggered'); res.status(200).json({ success: true }); return; }

  // Privacidad, antes del correo y de Pipedrive (sin excepción por la API key). Un solo reloj
  // por solicitud: la hora de la constancia es la del servidor.
  const at = new Date();
  const consent = resolveConsent(body, { form: 'instalacion', requireTerms: false, at });
  // `=== false`: con strictNullChecks apagado, `if (!consent.ok)` no estrecha el tipo.
  if (consent.ok === false) {
    console.warn(LOG_PREFIX + ' Consent missing');
    res.status(400).json({ success: false, error: 'Validation failed', code: CONSENT_ERROR_CODE, details: { errors: consent.errors } });
    return;
  }

  const validation = validateInstallationPayload(body);
  if (!validation.valid) { console.warn(LOG_PREFIX + ' Validation failed:', validation.errors); res.status(400).json({ success: false, error: 'Validation failed', details: { errors: validation.errors } } satisfies InstallationLeadApiResponse); return; }

  const payload = body as InstallationLeadPayload;
  // Origen de la visita (clave attribution): informativo, nunca rechaza ni va al log
  const origen = origenFromBody(body);

  // Una sola referencia para el correo, la nota y el campo del deal: calcularla
  // dos veces podría separarlas si cambia la hora entre ambas.
  const leadRef = buildInstallationLeadRef(payload);
  const ref = LOG_PREFIX + ' ' + leadRef;
  console.log(ref + ' Processing | tipo: ' + payload.tipoProyecto + ' | comuna: ' + payload.comuna);

  // Correo a ventas ANTES de Pipedrive: si el CRM falla, el lead no se pierde
  const cuerpo = buildInstallationEmailBody(payload, leadRef, consent.section, origen);
  const email: SalesEmail = {
    modo: 'Instalación profesional (sin monto)',
    nombre: payload.nombre,
    email: payload.email,
    telefono: payload.telefono,
    cuerpo,
    total: '-',
    asunto: 'Nueva solicitud de instalación — ' + leadRef,
  };
  const mail = notifySales(email, ref);

  try {
    const result = await processInstallationLead(payload, leadRef, consent.section, origen);
    console.log(ref + ' Done — deal: ' + result.dealId + ' (' + result.dealAction + ') score: ' + result.leadScore);
    res.status(result.dealAction === 'created' ? 201 : 200).json({ success: true, personId: result.personId, dealId: result.dealId, dealAction: result.dealAction, leadScore: result.leadScore, priorityTier: result.priorityTier, leadRef } satisfies InstallationLeadApiResponse);
  } catch (err) {
    console.error(LOG_PREFIX + ' LEAD SIN CRM ' + leadRef + ' | Pipedrive FAIL: ' + errorMessage(err));

    if (await mail) {
      // El correo salió: el lead no se pierde. Segundo correo para crear el negocio a mano.
      notifySales({ ...email, cuerpo: 'ATENCIÓN: la solicitud ' + leadRef + ' NO quedó en Pipedrive. Crear el negocio a mano.\n\n' + cuerpo, asunto: 'ATENCIÓN ' + leadRef + ' sin Pipedrive' }, ref);
      res.status(200).json({ success: true, dealId: null, leadRef, crm: 'failed' } satisfies InstallationLeadApiResponse);
      return;
    }

    res.status(502).json({ success: false, error: 'No se pudo registrar tu solicitud en el sistema. Por favor inténtalo de nuevo o escríbenos por WhatsApp.' } satisfies InstallationLeadApiResponse);
  }
}
