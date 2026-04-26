// api/_lib/whatsapp/pipedriveLead.ts
// Crea o reutiliza deal en Pipedrive para leads de WhatsApp.
// v1: agrega custom fields WA + note estructurada.

import { findOrCreatePerson } from '../pipedrive/persons.js';
import { findExistingDeal, createDeal, updateDeal } from '../pipedrive/deals.js';
import { initFieldOptions } from '../pipedrive/fieldOptions.js';
import { pipedrivePost } from '../pipedrive/client.js';
import type { QuoteCustomer } from '../crm/types.js';
import { TIPO_SERVICIO } from '../crm/tipo-servicio.js';
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

function buildNote(p: WhatsAppLeadParams): string {
    const c = p.captured ?? {};
    const lines = [
          '== Lead WhatsApp eLIGHTS ==',
          'Telefono: ' + p.phone,
          'Nombre/empresa: ' + (c.nombre_o_empresa ?? p.name ?? '-'),
          'RUT empresa: ' + (c.rut_empresa ?? '-'),
          'Correo: ' + (c.correo ?? '-'),
          '---',
          'Producto: ' + (c.producto ?? '-'),
          'Tipo de luz: ' + (c.tipo_de_luz ?? '-'),
          'Cantidad: ' + (c.cantidad ?? '-'),
          'Proyecto/uso: ' + (c.proyecto_o_uso ?? '-'),
          'Comuna/ciudad: ' + (c.comuna_o_ciudad ?? '-'),
          '---',
          'Mensaje original: ' + p.body.substring(0, 300),
          'Resumen bot: ' + p.summary.substring(0, 200),
          'Estado captura: ' + (p.captureStatus ?? 'incomplete'),
          'Pidio ejecutivo: ' + (p.wantsHuman ? 'Si' : 'No'),
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

  const waFieldMap: Array<[string, string | undefined]> = [
        ['PIPEDRIVE_DEAL_FIELD_WA_PRODUCT', captured?.producto],
        ['PIPEDRIVE_DEAL_FIELD_WA_LIGHT_TYPE', captured?.tipo_de_luz],
        ['PIPEDRIVE_DEAL_FIELD_WA_QUANTITY', captured?.cantidad],
        ['PIPEDRIVE_DEAL_FIELD_WA_PROJECT_USE', captured?.proyecto_o_uso],
        ['PIPEDRIVE_DEAL_FIELD_WA_LOCATION', captured?.comuna_o_ciudad],
        ['PIPEDRIVE_DEAL_FIELD_WA_WANTS_HUMAN', wantsHuman ? 'yes' : 'no'],
        ['PIPEDRIVE_DEAL_FIELD_WA_CAPTURE_STATUS', captureStatus ?? 'incomplete'],
        ['PIPEDRIVE_DEAL_FIELD_WA_LAST_MESSAGE', body.substring(0, 255)],
        ['PIPEDRIVE_DEAL_FIELD_WA_BOT_SUMMARY', summary.substring(0, 255)],
        ['PIPEDRIVE_DEAL_FIELD_WA_LEAD_TYPE', resolvedLeadType],
        ['PIPEDRIVE_DEAL_FIELD_WA_CONTACT_NAME', captured?.nombre_o_empresa],
        ['PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', captured?.correo],
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

  const customer: QuoteCustomer = {
        name: name || phone,
        phone,
        email: captured?.correo,
        preferredChannel: 'WhatsApp'
  };

  const { personId, action: personAction } = await findOrCreatePerson(customer);
    console.log(LOG_PREFIX + ' Person ' + personId + ' (' + personAction + ')');

  const quoteReference = 'WA-' + phone.replace(/\D/g, '');
    const existing = await findExistingDeal({ quoteReference, personId, pipelineId });

  const resolvedLeadType = params.leadType ?? detectLeadType(params.body, captured);
    const resolvedPriority: 'Alta' | 'Normal' = wantsHuman ? 'Alta' : (params.priorityTier ?? 'Normal');

  const waCustomFields = buildWaCustomFields(captured, captureStatus, wantsHuman, summary, params.body, resolvedLeadType);

  let dealId: number;
    let dealAction: 'created' | 'found';

  if (existing) {
        // Path FOUND: solo actualizar WA fields si los hay
      console.log(LOG_PREFIX + ' Deal already exists: ' + existing.id + ' — actualizando WA fields');
        if (Object.keys(waCustomFields).length > 0) {
                await updateDeal(existing.id, waCustomFields);
        }
        dealId = existing.id;
        dealAction = 'found';
  } else {
        // Path CREATE: primero crear deal con params tipados, luego update WA fields separado
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
              notes: summary,
              tipoServicio: TIPO_SERVICIO.WHATSAPP,
      });
        dealId = result.dealId;
        dealAction = result.status === 'created' ? 'created' : 'found';

      // Aplicar WA custom fields en updateDeal separado (tipado seguro)
      if (Object.keys(waCustomFields).length > 0) {
              await updateDeal(dealId, waCustomFields);
      }
  }

  // Nota estructurada al deal (siempre, para historial)
  try {
        await pipedrivePost('/notes', { content: buildNote(params), deal_id: dealId, person_id: personId });
        console.log(LOG_PREFIX + ' Nota creada en deal ' + dealId);
  } catch (err) {
        console.error(LOG_PREFIX + ' Error creando nota (non-fatal):', err);
  }

  console.log(LOG_PREFIX + ' Deal ' + dealId + ' (' + dealAction + ') for ' + phone);
    return { dealId, personId, action: dealAction };
}

function detectLeadType(body: string, captured?: CapturedFields): 'B2B' | 'B2C' | 'Unknown' {
    const B2B_RE = /empresa|constructora|obra|factura|licitaci[oó]n|proveedor|s\.a\.|spa|ltda|ingeniería|arquitectura|instalador/i;
    const text = body + ' ' + (captured?.nombre_o_empresa ?? '');
    if (B2B_RE.test(text)) return 'B2B';
    if (body.length > 20) return 'B2C';
  return 'Unknown';
}
