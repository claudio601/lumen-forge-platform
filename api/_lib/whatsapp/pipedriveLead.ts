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
import { isBusinessRut } from './rutCapture.js';

const LOG_PREFIX = '[pipedriveLead]';

/**
 * Ventana de deduplicacion (decision del dueno, 2026-10-26): una conversacion nueva se junta con
 * el negocio WA- abierto del mismo numero si tuvo movimiento en estos dias. Si el negocio esta
 * ganado, perdido o quieto por mas tiempo, se crea uno nuevo, que ventas ve como lead nuevo.
 */
export const WA_DEDUP_WINDOW_DAYS = 7;

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
    existingDealId?: number;
}

export interface WhatsAppDealResult {
    dealId?: number;
    personId?: number;
    action: 'created' | 'found' | 'skipped';
    pendingWrite?: PendingWhatsAppWrite;
}

/** Solo las operaciones sin confirmar se guardan para el mensaje siguiente. */
export interface PendingWhatsAppWrite {
    dealId: number;
    personId?: number;
    fields?: Record<string, string>;
    note?: string;
}

export async function retryWhatsAppWrite(write: PendingWhatsAppWrite): Promise<PendingWhatsAppWrite | undefined> {
    const pending = { ...write };
    if (pending.fields) {
          try {
                  await updateDeal(pending.dealId, pending.fields);
                  delete pending.fields;
          } catch {
                  console.error(LOG_PREFIX + ' Campos pendientes en deal ' + pending.dealId);
          }
    }
    if (pending.note) {
          try {
                  const result = await pipedrivePost('/notes', {
                          content: pending.note, deal_id: pending.dealId,
                          ...(pending.personId ? { person_id: pending.personId } : {}),
                  });
                  if (result.success) {
                          delete pending.note;
                          console.log(LOG_PREFIX + ' Nota creada en deal ' + pending.dealId);
                  } else {
                          console.error(LOG_PREFIX + ' Nota pendiente en deal ' + pending.dealId);
                  }
          } catch {
                  console.error(LOG_PREFIX + ' Nota pendiente en deal ' + pending.dealId);
          }
    }
    return pending.fields || pending.note ? pending : undefined;
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

const RUT_TIPO_LABEL: Record<NonNullable<CapturedFields['rut_tipo']>, string> = {
    empresa: 'empresa',
    persona: 'persona',
    organismo_publico: 'organismo publico',
    comunidad: 'comunidad',
};

/** [RUT-VALIDO] El RUT con su tipo, o marcado si el digito verificador no calza. */
function rutLine(c: CapturedFields): string {
    const rut = fmt(c.rut);
    if (!rut) return '-';
    if (c.rut_valido === false) return rut + ' (INVALIDO: no calza el digito verificador)';
    return c.rut_tipo ? rut + ' (' + RUT_TIPO_LABEL[c.rut_tipo] + ')' : rut;
}

function buildNote(p: WhatsAppLeadParams): string {
    const c = p.captured ?? {};
    const lead = resolveLead(c);
    const lines = [
          '== Lead WhatsApp eLIGHTS ==',
          'Telefono: ' + p.phone,
          'Nombre/empresa: ' + (lead.nombre ?? fmt(p.name) ?? '-'),
          'RUT: ' + rutLine(c),
          ...(c.rut_ambiguos?.length ? ['varios RUT en el mensaje: revisar', ...c.rut_ambiguos] : []),
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

  if (!params.existingDealId && (!pipelineId || !stageId)) {
        console.warn(LOG_PREFIX + ' PIPEDRIVE_PIPELINE_ID or PIPEDRIVE_STAGE_NEW_LEAD_ID not set — skipping');
        return { action: 'skipped' };
  }

  if (!params.existingDealId) await initFieldOptions();

  // [CIERRE-HONESTO] Lo que se arma aqui (campos y nota) va antes de crear la persona: un dato
  // raro ya no deja una persona sin negocio. El correo y el nombre de instalacion llegan a la persona.
  const quoteReference = 'WA-' + phone.replace(/\D/g, '');

  const resolvedLeadType = params.leadType ?? detectLeadType(params.body, captured);
    const resolvedPriority: 'Alta' | 'Normal' = wantsHuman ? 'Alta' : (params.priorityTier ?? 'Normal');

  const waCustomFields = buildWaCustomFields(captured, captureStatus, wantsHuman, summary, params.body, resolvedLeadType);
    const noteContent = buildNote(params);

  // La correccion tardia usa el negocio guardado, sin buscar abiertos ni crear otro.
  if (params.existingDealId) {
        const pendingWrite = await retryWhatsAppWrite({ dealId: params.existingDealId, fields: waCustomFields, note: noteContent });
        return { dealId: params.existingDealId, action: 'found', ...(pendingWrite ? { pendingWrite } : {}) };
  }

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
        dedupOpenWithinDays: WA_DEDUP_WINDOW_DAYS,
        notes: fmt(summary),
        tipoServicio: TIPO_SERVICIO.WHATSAPP,
  });

  const dealId: number = result.dealId;
    const dealAction: 'created' | 'found' = result.status === 'created' ? 'created' : 'found';

  if (result.status !== 'created') {
        console.log(LOG_PREFIX + ' dedup_quote_reference_hit dealId=' + dealId);
  }

  const pendingWrite = await retryWhatsAppWrite({
        dealId, personId,
        ...(Object.keys(waCustomFields).length ? { fields: waCustomFields } : {}),
        note: noteContent,
  });

  console.log(LOG_PREFIX + ' Deal ' + dealId + ' (' + dealAction + ') for ' + phone);
    return { dealId, personId, action: dealAction, ...(pendingWrite ? { pendingWrite } : {}) };
}

function detectLeadType(body: string, captured?: CapturedFields): 'B2B' | 'B2C' | 'Unknown' {
    const B2B_RE = /empresa|constructora|obra|factura|licitaci[oó]n|proveedor|s\.a\.|spa|ltda|ingeniería|arquitectura|instalador/i;
    const text = body + ' ' + (fmt(captured?.nombre_o_empresa) ?? '');
    if (B2B_RE.test(text)) return 'B2B';
    // [RUT-VALIDO] Un RUT valido de empresa, organismo o comunidad (no de persona) es B2B.
    if (isBusinessRut({ valido: captured?.rut_valido === true, tipo: captured?.rut_tipo })) return 'B2B';
    if (body.length > 20) return 'B2C';
  return 'Unknown';
}
