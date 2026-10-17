// api/estudio-luminico/create.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/estudio-luminico/create
//
// Endpoint dedicado para leads de Estudio Luminico DIALux.
//
// Flujo (orden critico — no modificar):
// 1. Validar metodo HTTP
// 2. Rate limiting por IP
// 3. Validar Origin/Referer (VERCEL_ENV fix — no NODE_ENV)
// 4. Honeypot anti-bot
// 4b. Privacidad (clave `consent`, api/_lib/forms/consent.ts): sin la casilla obligatoria,
//     400 con code 'consent_required' antes del correo y de Pipedrive, también con
//     INSTALLATION_API_SECRET. La hora de la constancia es la del servidor (payload.fecha
//     no cuenta).
// 5. Validar payload (server-side estricto, con topes de largo: validation.ts)
// 6. Referencia ESTL- unica: la misma en el correo, la nota y el deal
// 7. Correo a ventas via GAS ANTES de Pipedrive (waitUntil, no bloquea)
// 8. Crear/actualizar deal en Pipedrive + nota estructurada
//    -> Nota fallida: console.error con dealId y ref (no bloquea: el correo ya lleva los datos)
//    -> Pipedrive falla y el correo salio: 200 { success, dealId: null, leadRef, crm: 'failed' }
//       + segundo correo "ATENCIÓN ... Crear el negocio a mano."
//    -> Fallan ambos: 502 con error visible al usuario
// 9. Retornar 201/200 { success, personId, dealId, dealAction, leadRef }
//
// La nota (y el correo, que lleva el mismo texto) termina con la constancia "PRIVACIDAD Y
// AUTORIZACIONES" y el origen de la visita (clave `attribution`, distinta del campo `origen`
// del formulario; api/_lib/forms/attribution.ts), agregados después de buildEstudioDealNote
// (protegido). El origen es informativo: un origen raro se descarta, nunca da 400, y no
// entra en la referencia ni en el log. Los topes de validation.ts hacen que todo quepa en
// el correo sin recorte (el relay corta el final, donde van la constancia y el origen).
//
// DECISION V1: Reutiliza PIPEDRIVE_PIPELINE_ID + PIPEDRIVE_STAGE_NEW_LEAD_ID
// (pipeline "Ventas eLIGHTS" existente). El campo tipo_servicio = "Estudio Luminico"
// diferencia este flujo. Ver TODO en estudio-luminico-mapping.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { initFieldOptions } from '../_lib/pipedrive/fieldOptions.js';
import { pipedrivePost, pipedriveGet, pipedrivePut } from '../_lib/pipedrive/client.js';
import type { PipedriveDeal } from '../_lib/crm/types.js';
import {
  mapEstudioPayloadToDealParams,
  buildEstudioLeadRef,
  buildEstudioDealNote,
} from '../_lib/crm/estudio-luminico-mapping.js';
import type {
  EstudioLuminicoPayload,
  EstudioLuminicoResponse,
  EstudioLuminicoSuccessResponse,
  CreateEstudioDealParams,
} from '../_lib/crm/estudio-luminico-types.js';
import {
  isAllowedOrigin,
  checkRateLimit,
  isHoneypotTriggered,
  getClientIp,
} from '../_lib/auth.js';
import { notifySales, type SalesEmail } from '../_lib/notify/salesEmail.js';
import { validateEstudioPayload } from './validation.js';
import { origenFromBody } from '../_lib/forms/attribution.js';
import { CONSENT_ERROR_CODE, resolveConsent } from '../_lib/forms/consent.js';

const LOG = '[api/estudio-luminico/create]';

// ── Auth (sin header + origin permitido = formulario web legitimo) ────────────

function isAuthorized(req: VercelRequest): boolean {
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  if (apiKey || authHeader) {
    const installSecret = process.env.INSTALLATION_API_SECRET;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const provided = apiKey ?? bearer;
    if (installSecret && provided === installSecret) return true;
    return false;
  }

  if (isAllowedOrigin(req)) return true;
  if (!process.env.INSTALLATION_API_SECRET) return true;
  console.warn(LOG + ' Unauthorized: no header and untrusted origin');
  return false;
}

// ── Deduplicacion (busca deal existente por leadRef en el campo custom) ───────

async function findExistingEstudioDeal(
  leadRef: string,
  pipelineId: number
): Promise<PipedriveDeal | null> {
  const fieldKey = process.env.PIPEDRIVE_ESTUDIO_FIELD_LEAD_REF;
  if (!fieldKey) {
    // Sin campo configurado: skip dedup silencioso (no bloquea la creacion)
    return null;
  }

  try {
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
  } catch (err) {
    console.warn(LOG + ' Dedup search failed (non-blocking):', err);
  }

  return null;
}

// ── Crear o actualizar deal en Pipedrive ──────────────────────────────────────

async function createEstudioDeal(
  params: CreateEstudioDealParams
): Promise<{ dealId: number; dealAction: 'created' | 'updated' }> {
  const leadRef = params.customFields[process.env.PIPEDRIVE_ESTUDIO_FIELD_LEAD_REF ?? ''];

  if (typeof leadRef === 'string' && leadRef) {
    const existing = await findExistingEstudioDeal(leadRef, params.pipelineId);
    if (existing) {
      console.log(LOG + ' Found existing deal: ' + existing.id + ' — updating title');
      await pipedrivePut('/deals/' + existing.id, { title: params.title });
      return { dealId: existing.id, dealAction: 'updated' };
    }
  }

  const body: Record<string, unknown> = {
    title: params.title,
    person_id: params.personId,
    pipeline_id: params.pipelineId,
    stage_id: params.stageId,
    user_id: params.ownerId,
    value: 0,
    currency: 'CLP',
    ...params.customFields,
  };

  const res = await pipedrivePost<PipedriveDeal>('/deals', body);
  if (!res.success || !res.data) {
    throw new Error(LOG + ' Failed to create deal: ' + (res.error ?? 'unknown'));
  }

  console.log(LOG + ' Created deal: ' + res.data.id);
  return { dealId: res.data.id, dealAction: 'created' };
}

// ── Adjuntar nota al deal (no bloquea: el correo ya lleva los mismos datos) ───

async function addNoteToDeal(dealId: number, leadRef: string, noteContent: string): Promise<void> {
  try {
    const res = await pipedrivePost<{ id: number }>('/notes', {
      content: noteContent,
      deal_id: dealId,
    });
    if (!res.success) {
      console.error(LOG + ' Note FAIL | dealId: ' + dealId + ' | ref: ' + leadRef + ' | ' + res.error);
    } else {
      console.log(LOG + ' Note added to deal ' + dealId);
    }
  } catch (err) {
    console.error(LOG + ' Note FAIL | dealId: ' + dealId + ' | ref: ' + leadRef + ' | ' + errorMessage(err));
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  // Rate limiting
  const ip = getClientIp(req);

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    console.warn(LOG + ' Rate limit exceeded for IP: ' + ip);
    res.status(429).json({ success: false, error: 'Too many requests. Try again later.' });
    return;
  }

  // Origin check
  if (!isAllowedOrigin(req)) {
    console.warn(LOG + ' Blocked origin:', req.headers['origin']);
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  // Auth check
  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const body = req.body ?? {};

  // Honeypot
  if (isHoneypotTriggered(body)) {
    console.warn(LOG + ' Honeypot triggered from IP: ' + ip);
    res.status(200).json({ success: true });
    return;
  }

  // Privacidad, antes del correo y de Pipedrive (sin excepción por la API key). Un solo reloj
  // por solicitud: la hora de la constancia es la del servidor.
  const at = new Date();
  const consent = resolveConsent(body, { form: 'estudio-luminico', requireTerms: false, at });
  // `=== false`: con strictNullChecks apagado, `if (!consent.ok)` no estrecha el tipo.
  if (consent.ok === false) {
    console.warn(LOG + ' Consent missing');
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: CONSENT_ERROR_CODE,
      details: { errors: consent.errors },
    });
    return;
  }

  // Validacion server-side
  const validation = validateEstudioPayload(body);
  if (!validation.valid) {
    console.warn(LOG + ' Validation failed:', validation.errors);
    res
      .status(400)
      .json({
        success: false,
        error: 'Validation failed',
        details: { errors: validation.errors },
      } satisfies EstudioLuminicoResponse);
    return;
  }

  const payload = body as EstudioLuminicoPayload;

  // Una sola referencia para el correo, la nota y el campo del deal: calcularla
  // dos veces podria separarlas si cambia la hora entre ambas.
  const leadRef = buildEstudioLeadRef(payload);
  // Los textos del cliente quedan antes de la constancia; después solo va el origen (saneado).
  const note = [buildEstudioDealNote(payload, leadRef), '', ...consent.section, '', ...origenFromBody(body)].join('\n');
  const ref = LOG + ' ' + leadRef;

  // Solo un campo de lista cerrada: la comuna es texto libre y podría traer datos personales
  console.log(ref + ' Processing | tipo: ' + payload.tipoProyecto);

  // ── PASO 1: correo a ventas ANTES de Pipedrive (si el CRM falla, el lead no se pierde) ──
  const email: SalesEmail = {
    modo: 'Estudio lumínico DIALux',
    nombre: payload.nombreCompleto,
    email: payload.email,
    telefono: payload.telefono,
    razonSocial: payload.empresa,
    cuerpo: note,
    asunto: 'Estudio lumínico ' + leadRef,
  };
  const mail = notifySales(email, ref);

  // ── PASO 2: Pipedrive ─────────────────────────────────────────────────────
  let dealId: number;
  let dealAction: 'created' | 'updated';
  let personId: number;

  try {
    await initFieldOptions();

    // Ojo: persons.ts (protegido) escribe el nombre en el log cuando corrige uno malo
    // en Pipedrive ("Patched person name"). Pendiente, con OK del dueño: dejar solo el id.
    const person = await findOrCreatePerson({
      name: payload.nombreCompleto.trim(),
      email: payload.email.trim(),
      phone: payload.telefono.trim(),
    });

    console.log(ref + ' Person: ' + person.personId + ' (' + person.action + ')');

    // La nota y el campo de referencia llevan la misma ESTL- que el correo
    const mapped = mapEstudioPayloadToDealParams(payload, person.personId);
    const refField = process.env.PIPEDRIVE_ESTUDIO_FIELD_LEAD_REF;
    const dealParams: CreateEstudioDealParams = {
      ...mapped,
      customFields: refField ? { ...mapped.customFields, [refField]: leadRef } : mapped.customFields,
      noteContent: note,
    };
    const result = await createEstudioDeal(dealParams);
    dealId = result.dealId;
    dealAction = result.dealAction;
    personId = person.personId;

    // Adjuntar nota estructurada (datos completos, incluso los sin custom field)
    await addNoteToDeal(dealId, leadRef, dealParams.noteContent);

    console.log(ref + ' Deal: ' + dealId + ' (' + dealAction + ')');
  } catch (err) {
    console.error(LOG + ' LEAD SIN CRM ' + leadRef + ' | Pipedrive FAIL: ' + errorMessage(err));

    if (await mail) {
      // El correo salio: el lead no se pierde. Segundo correo para crear el negocio a mano.
      notifySales(
        {
          ...email,
          cuerpo:
            'ATENCIÓN: la solicitud ' + leadRef + ' NO quedó en Pipedrive. Crear el negocio a mano.\n\n' + note,
          asunto: 'ATENCIÓN ' + leadRef + ' sin Pipedrive',
        },
        ref
      );
      res.status(200).json({ success: true, dealId: null, leadRef, crm: 'failed' });
      return;
    }

    res.status(502).json({
      success: false,
      error:
        'No se pudo registrar tu solicitud en el sistema. Por favor, inténtalo de nuevo o escríbenos por WhatsApp.',
    } satisfies EstudioLuminicoResponse);
    return;
  }

  // ── PASO 3: Respuesta exitosa ─────────────────────────────────────────────
  res.status(dealAction === 'created' ? 201 : 200).json({
    success: true,
    personId,
    dealId,
    dealAction,
    leadRef,
  } satisfies EstudioLuminicoSuccessResponse & { leadRef: string });
}
