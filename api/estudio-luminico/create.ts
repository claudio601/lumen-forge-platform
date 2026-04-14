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
// 5. Validar payload (server-side estricto)
// 6. Crear/actualizar deal en Pipedrive (BLOQUEANTE — source of truth)
//    -> Si falla: retornar 502 con error visible al usuario
// 7. Adjuntar nota estructurada al deal (BLOQUEANTE — misma importancia)
// 8. Enviar email GAS (FIRE-AND-FORGET — no bloquea la respuesta)
//    -> Si falla: loggear warn, retornar exito al usuario
// 9. Retornar 201 { success, dealId, dealAction }
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
} from '../_lib/crm/estudio-luminico-mapping.js';
import type {
  EstudioLuminicoPayload,
  EstudioLuminicoResponse,
  CreateEstudioDealParams,
} from '../_lib/crm/estudio-luminico-types.js';
import { validateEstudioPayload } from './validation.js';

const LOG = '[api/estudio-luminico/create]';

// ── Rate limiting (in-memory, igual que installation-leads) ───────────────────

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
  // TODO (V2): implementar rate limit distribuido con Upstash Redis
  // cuando el volumen lo justifique. Ya configurado en el proyecto para request-orders.
}

// ── Origin check (usa VERCEL_ENV, no NODE_ENV — fix historico) ────────────────

const ALLOWED_ORIGINS = ['https://nuevo.elights.cl', 'https://elights.cl'];

function isAllowedOrigin(req: VercelRequest): boolean {
  if (process.env.VERCEL_ENV !== 'production') return true;
  const origin = req.headers['origin'] ?? '';
  const referer = req.headers['referer'] ?? '';
  return (
    ALLOWED_ORIGINS.some((o) => origin.startsWith(o)) ||
    ALLOWED_ORIGINS.some((o) => referer.startsWith(o))
  );
}

// ── Auth (sin header + origin permitido = formulario web legitimo) ────────────

function isAuthorized(req: VercelRequest): boolean {
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  if (apiKey || authHeader) {
    const installSecret = process.env.INSTALLATION_API_SECRET;
    const quotesKey = process.env.QUOTES_API_KEY;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const provided = apiKey ?? bearer;
    if (installSecret && provided === installSecret) return true;
    if (quotesKey && provided === quotesKey) return true;
    return false;
  }

  if (isAllowedOrigin(req)) return true;
  if (!process.env.INSTALLATION_API_SECRET && !process.env.QUOTES_API_KEY) return true;
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

// ── Adjuntar nota al deal (siempre, para garantizar trazabilidad) ─────────────

async function addNoteToDeal(dealId: number, noteContent: string): Promise<void> {
  const res = await pipedrivePost<{ id: number }>('/notes', {
    content: noteContent,
    deal_id: dealId,
  });
  if (!res.success) {
    console.warn(LOG + ' Failed to add note to deal ' + dealId + ': ' + res.error);
  } else {
    console.log(LOG + ' Note added to deal ' + dealId);
  }
}

// ── GAS email relay (fire-and-forget) ────────────────────────────────────────

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbwn2Qv3nJsNrUfBvzdpB9X70NmQfAVXgBKVw8bdmG-CXMXGsL-2IUcJaKX0mpO4kNwfOw/exec';

async function sendGasEmail(payload: EstudioLuminicoPayload): Promise<void> {
  const ventas = process.env.SALES_EMAIL ?? 'ventas@elights.cl';

  const response = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      to_email: ventas,
      reply_to: payload.email,
      from_name: payload.nombreCompleto,
      subject_override:
        'Nueva solicitud Estudio Luminico DIALux — ' +
        payload.tipoProyecto +
        ' — ' +
        payload.comunaCiudad,
      nombre: payload.nombreCompleto,
      telefono: payload.telefono,
      comuna: payload.comunaCiudad,
      tipo_proyecto: payload.tipoProyecto,
      tiene_planos: payload.tienePlanos,
      dimensiones: payload.dimensionesAproximadas,
      altura_montaje: payload.alturaMontaje,
      objetivo: payload.objetivoProyecto,
      normativa: payload.normativaObjetivo ?? '-',
      urgencia: payload.urgenciaProyecto ?? '-',
      empresa: payload.empresa ?? '-',
      descripcion: payload.descripcionProyecto ?? '-',
      fecha: payload.fecha ?? new Date().toLocaleDateString('es-CL', { dateStyle: 'long' }),
      items_lista:
        'Estudio Luminico DIALux | ' +
        payload.tipoProyecto +
        ' | ' +
        payload.comunaCiudad,
      total: '-',
    }),
  });

  const result = (await response.json()) as { status: string; message?: string };
  if (result.status !== 'ok') {
    throw new Error(result.message ?? 'GAS relay: status not ok');
  }
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
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress ??
    'unknown';

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
  if (body.website) {
    console.warn(LOG + ' Honeypot triggered from IP: ' + ip);
    res.status(200).json({ success: true });
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

  console.log(
    LOG +
      ' Processing: ' +
      payload.email +
      ' | ' +
      payload.tipoProyecto +
      ' | ' +
      payload.comunaCiudad
  );

  // ── PASO 1: Pipedrive (BLOQUEANTE) ────────────────────────────────────────
  let dealId: number;
  let dealAction: 'created' | 'updated';

  try {
    await initFieldOptions();

    const person = await findOrCreatePerson({
      name: payload.nombreCompleto.trim(),
      email: payload.email.trim(),
      phone: payload.telefono.trim(),
    });

    console.log(LOG + ' Person: ' + person.personId + ' (' + person.action + ')');

    const dealParams = mapEstudioPayloadToDealParams(payload, person.personId);
    const result = await createEstudioDeal(dealParams);
    dealId = result.dealId;
    dealAction = result.dealAction;

    // Adjuntar nota estructurada (datos completos, incluso los sin custom field)
    await addNoteToDeal(dealId, dealParams.noteContent);

    console.log(LOG + ' Deal: ' + dealId + ' (' + dealAction + ')');
  } catch (err) {
    console.error(LOG + ' Pipedrive FAIL:', err);
    res.status(502).json({
      success: false,
      error:
        'No se pudo registrar tu solicitud en el sistema. Por favor intentalo de nuevo o escribenos por WhatsApp.',
    } satisfies EstudioLuminicoResponse);
    return;
  }

  // ── PASO 2: GAS email (FIRE-AND-FORGET) ──────────────────────────────────
  sendGasEmail(payload)
    .then(() => {
      console.log(LOG + ' GAS email OK');
    })
    .catch((err: unknown) => {
      console.warn(LOG + ' GAS email FAIL (non-blocking):', err);
    });

  // ── PASO 3: Respuesta exitosa ─────────────────────────────────────────────
  res.status(dealAction === 'created' ? 201 : 200).json({
    success: true,
    dealId,
    dealAction,
  } satisfies EstudioLuminicoResponse);
}
