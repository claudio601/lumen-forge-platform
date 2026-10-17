// api/_lib/whatsapp/pipedriveLead.ts
// Crea o reutiliza deal en Pipedrive para leads de WhatsApp.
// v1: agrega custom fields WA + note estructurada.

import { findOrCreatePerson } from '../pipedrive/persons.js';
import { createDeal, updateDeal } from '../pipedrive/deals.js';
import { initFieldOptions } from '../pipedrive/fieldOptions.js';
import { pipedrivePost } from '../pipedrive/client.js';
import type { QuoteCustomer } from '../crm/types.js';
import { TIPO_SERVICIO } from '../crm/tipo-servicio.js';
import { looksLikePersonName } from './flowEngine.js';
import type { CapturedFields, CaptureStatus } from './flowEngine.js';

const LOG_PREFIX = '[pipedriveLead]';

export interface WhatsAppLeadParams {
    phone: string;
    name: string;
    summary: string;
    body: string;
    captured?: CapturedFields;
    captureStatus?: CaptureStatus;
    wantsHuman?: boolean;
    leadType?: 'B2B' | 'B2C' | 'Unknown';
    priorityTier?: 'Alta' | 'Normal';
}

export interface WhatsAppDealResult {
    dealId?: number;
    personId?: number;
    action: 'created' | 'found' | 'skipped';
}

function waField(key: string): string | undefined {
    return process.env[key];
}

/** [CIERRE-HONESTO] Solo texto o numeros llegan a la nota y a los campos: nunca un objeto. */
function fmt(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * [CIERRE-HONESTO] Nombre de instalacion solo si tiene forma de nombre de persona: la regla que lo
 * saca del texto tambien toma "de Maipu" o "instalador electrico" (soy de..., soy instalador...).
 * Si no la tiene, queda el nombre del perfil de WhatsApp, como antes.
 */
function installName(c: CapturedFields | undefined): string | undefined {
    const value = fmt(c?.install_nombre);
    return looksLikePersonName(value) ? value : undefined;
}

/** [CIERRE-HONESTO] Contacto y proyecto del flujo de productos o, si no, del de instalacion (install_*). */
function resolveLead(c: CapturedFields) {
    return {
          nombre: fmt(c.nombre_o_empresa) ?? installName(c),
          correo: fmt(c.correo) ?? fmt(c.install_correo),
          proyecto: fmt(c.proyecto_o_uso) ?? fmt(c.install_tipo_proyecto),
          comuna: fmt(c.comuna_o_ciudad) ?? fmt(c.install_comuna),
          instalacion: Boolean(c.install_nombre || c.install_correo || c.install_comuna || c.install_tipo_proyecto),
    };
}

function buildNote(p: WhatsAppLeadParams): string {
    const c = p.captured ?? {};
    const lead = resolveLead(c);
    const lines = [
          '== Lead WhatsApp eLIGHTS ==',
          'Telefono: ' + p.phone,
          'Nombre/empresa: ' + (lead.nombre ?? fmt(p.name) ?? '-'),
          'RUT empresa: ' + (fmt(c.rut_empresa) ?? '-'),
          'Correo: ' + (lead.correo ?? '-'),
          '---',
          'Producto: ' + (fmt(c.producto) ?? '-'),
          'Tipo de luz: ' + (fmt(c.tipo_de_luz) ?? '-'),
          'Cantidad: ' + (fmt(c.cantidad) ?? '-'),
          'Proyecto/uso: ' + (lead.proyecto ?? '-'),
          'Comuna/ciudad: ' + (lead.comuna ?? '-'),
          '---',
          'Mensaje original: ' + (fmt(p.body) ?? '').substring(0, 300),
          'Resumen bot: ' + (fmt(p.summary) ?? '-').substring(0, 200),
          'Estado captura: ' + (p.captureStatus ?? 'incomplete'),
          'Pidio ejecutivo: ' + (p.wantsHuman ? 'Si' : 'No'),
          ...(lead.instalacion ? ['Solicitud de instalacion: Si'] : []),
          'Canal: WhatsApp',
        ];
    return lines.join('\n');
}

function buildWaCustomFields(
    captured: CapturedFields | undefined,
    captureStatus: CaptureStatus | undefined,
    wantsHuman: boolean | undefined,
    summary: string,
    body: string,
    resolvedLeadType: string,
  ): Record<string, string> {
    const waCustomFields: Record<string, string> = {};
    const lead = resolveLead(captured ?? {});

  const waFieldMap: Array<[string, string | undefined]> = [
        ['PIPEDRIVE_DEAL_FIELD_WA_PRODUCT', fmt(captured?.producto)],
        ['PIPEDRIVE_DEAL_FIELD_WA_LIGHT_TYPE', fmt(captured?.tipo_de_luz)],
        ['PIPEDRIVE_DEAL_FIELD_WA_QUANTITY', fmt(captured?.cantidad)],
        ['PIPEDRIVE_DEAL_FIELD_WA_PROJECT_USE', lead.proyecto],
        ['PIPEDRIVE_DEAL_FIELD_WA_LOCATION', lead.comuna],
        ['PIPEDRIVE_DEAL_FIELD_WA_WANTS_HUMAN', wantsHuman ? 'yes' : 'no'],
        ['PIPEDRIVE_DEAL_FIELD_WA_CAPTURE_STATUS', captureStatus ?? 'incomplete'],
        ['PIPEDRIVE_DEAL_FIELD_WA_LAST_MESSAGE', (fmt(body) ?? '').substring(0, 255)],
        ['PIPEDRIVE_DEAL_FIELD_WA_BOT_SUMMARY', (fmt(summary) ?? '').substring(0, 255)],
        ['PIPEDRIVE_DEAL_FIELD_WA_LEAD_TYPE', resolvedLeadType],
        ['PIPEDRIVE_DEAL_FIELD_WA_CONTACT_NAME', lead.nombre],
        ['PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', lead.correo],
      ];

  for (const [envKey, val] of waFieldMap) {
        const fieldKey = waField(envKey);
        if (fieldKey && val !== undefined && val !== null && val !== '') {
                waCustomFields[fieldKey] = val;
        }
  }

  return waCustomFields;
}

export async function ensureWhatsAppDeal(params: WhatsAppLeadParams): Promise<WhatsAppDealResult> {
    const { phone, name, summary, captured, captureStatus, wantsHuman } = params;

  const pipelineId = parseInt(process.env.PIPEDRIVE_PIPELINE_ID ?? '0', 10);
    const stageId = parseInt(process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID ?? '0', 10);

  if (!pipelineId || !stageId) {
        console.warn(LOG_PREFIX + ' PIPEDRIVE_PIPELINE_ID or PIPEDRIVE_STAGE_NEW_LEAD_ID not set — skipping');
        return { action: 'skipped' };
  }

  await initFieldOptions();

  // [CIERRE-HONESTO] Lo que se arma aqui (campos y nota) va antes de crear la persona: un dato
  // raro ya no deja una persona sin negocio. El correo y el nombre de instalacion llegan a la persona.
  const quoteReference = 'WA-' + phone.replace(/\D/g, '');

  const resolvedLeadType = params.leadType ?? detectLeadType(params.body, captured);
    const resolvedPriority: 'Alta' | 'Normal' = wantsHuman ? 'Alta' : (params.priorityTier ?? 'Normal');

  const waCustomFields = buildWaCustomFields(captured, captureStatus, wantsHuman, summary, params.body, resolvedLeadType);
    const noteContent = buildNote(params);

  const customer: QuoteCustomer = {
        name: installName(captured) ?? (name || phone),
        phone,
        email: resolveLead(captured ?? {}).correo,
        preferredChannel: 'WhatsApp'
  };

  const { personId, action: personAction } = await findOrCreatePerson(customer);
    console.log(LOG_PREFIX + ' Person ' + personId + ' (' + personAction + ')');

  const result = await createDeal({
        personId,
        pipelineId,
        stageId,
        title: 'WhatsApp Lead — ' + (name || phone),
        quoteAmountClp: 0,
        sourceSystem: 'whatsapp',
        leadType: resolvedLeadType === 'Unknown' ? 'B2C' : resolvedLeadType,
        priorityTier: resolvedPriority,
        quoteReference,
        notes: fmt(summary),
        tipoServicio: TIPO_SERVICIO.WHATSAPP,
  });

  const dealId: number = result.dealId;
    const dealAction: 'created' | 'found' = result.status === 'created' ? 'created' : 'found';

  if (result.status !== 'created') {
        console.log(LOG_PREFIX + ' dedup_quote_reference_hit dealId=' + dealId);
  }

  // [CIERRE-HONESTO] En su propio try: si Pipedrive rechaza los campos, la nota se escribe igual.
  if (Object.keys(waCustomFields).length > 0) {
        try {
                await updateDeal(dealId, waCustomFields);
        } catch (err) {
                console.error(LOG_PREFIX + ' Error actualizando campos del deal (non-fatal):', err);
        }
  }

  // Nota estructurada al deal (siempre, para historial)
  try {
        await pipedrivePost('/notes', { content: noteContent, deal_id: dealId, person_id: personId });
        console.log(LOG_PREFIX + ' Nota creada en deal ' + dealId);
  } catch (err) {
        console.error(LOG_PREFIX + ' Error creando nota (non-fatal):', err);
  }

  console.log(LOG_PREFIX + ' Deal ' + dealId + ' (' + dealAction + ') for ' + phone);
    return { dealId, personId, action: dealAction };
}

function detectLeadType(body: string, captured?: CapturedFields): 'B2B' | 'B2C' | 'Unknown' {
    const B2B_RE = /empresa|constructora|obra|factura|licitaci[oó]n|proveedor|s\.a\.|spa|ltda|ingeniería|arquitectura|instalador/i;
    const text = body + ' ' + (fmt(captured?.nombre_o_empresa) ?? '');
    if (B2B_RE.test(text)) return 'B2B';
    if (body.length > 20) return 'B2C';
  return 'Unknown';
}
