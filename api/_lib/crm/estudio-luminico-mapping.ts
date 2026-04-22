// api/_lib/crm/estudio-luminico-mapping.ts
// ─────────────────────────────────────────────────────────────────────────────
// Transforma un EstudioLuminicoPayload en los parametros que
// createEstudioDeal() necesita.
//
// DECISION V1: Se reutiliza el pipeline existente "Ventas eLIGHTS"
// (PIPEDRIVE_PIPELINE_ID + PIPEDRIVE_STAGE_NEW_LEAD_ID) para no bloquear
// el deploy por configuracion nueva de CRM. El campo tipo_servicio distingue
// este flujo de los demas.
//
// Si falta alguna env var de custom field, el dato va a la nota estructurada
// del deal. El formulario funciona correctamente en cualquier caso.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  EstudioLuminicoPayload,
  CreateEstudioDealParams,
} from './estudio-luminico-types.js';
import { TIPO_SERVICIO } from './tipo-servicio.js';

const LOG_PREFIX = '[estudio-luminico-mapping]';

// ── Etiquetas legibles para selects ──────────────────────────────────────────

const TIPO_PROYECTO_LABELS: Record<string, string> = {
  cancha_deportiva: 'Estadio / Cancha deportiva',
  industria_bodega: 'Industria / Bodega',
  estacionamiento: 'Estacionamiento',
  edificio_comercial: 'Edificio comercial',
  vialidad_exterior: 'Vialidad / Exterior',
  proyecto_especial: 'Proyecto especial (otro)',
};

const OBJETIVO_LABELS: Record<string, string> = {
  entrenamiento: 'Entrenamiento deportivo',
  competencia: 'Competencia / Partido oficial',
  operacion_industrial: 'Operacion industrial',
  seguridad: 'Seguridad / Vigilancia',
  licitacion: 'Licitacion / Ingenieria',
  no_definido: 'No definido',
};

const NORMATIVA_LABELS: Record<string, string> = {
  criterios_fifa: 'Criterios FIFA aplicables',
  en_12193: 'EN 12193 (deportivo)',
  en_12464: 'EN 12464 (industria/comercial)',
  en_13201: 'EN 13201 (vialidad)',
  sec_chile: 'SEC / RIC Chile',
  no_seguro: 'No seguro',
};

const URGENCIA_LABELS: Record<string, string> = {
  urgente: 'Urgente (menos de 1 semana)',
  este_mes: 'Este mes',
  evaluando: 'Evaluando opciones',
  futura_licitacion: 'Licitacion futura',
};

const PLANOS_LABELS: Record<string, string> = {
  si_dwg_listo: 'Si, los tengo listos',
  si_preparar: 'Si, pero necesito prepararlos',
  no_tengo: 'No, necesito orientacion',
};

function label(map: Record<string, string>, key: string | undefined): string {
  if (!key) return '-';
  return map[key] ?? key;
}

// ── Config del pipeline (reutiliza el pipeline existente "Ventas eLIGHTS") ───

/**
 * Lee los IDs del pipeline existente desde env vars.
 *
 * V1: usa PIPEDRIVE_PIPELINE_ID + PIPEDRIVE_STAGE_NEW_LEAD_ID + PIPEDRIVE_OWNER_USER_ID
 * porque ya estan configurados en produccion. El tipo_servicio distingue el flujo.
 *
 * TODO (V2): cuando el volumen lo justifique, crear pipeline dedicado
 * "Estudio Luminico" y migrar a PIPEDRIVE_ESTUDIO_PIPELINE_ID + PIPEDRIVE_ESTUDIO_STAGE_NEW_LEAD_ID.
 */
function getEstudioPipelineConfig(): {
  pipelineId: number;
  stageId: number;
  ownerId: number;
} {
  const pipelineId = Number(process.env.PIPEDRIVE_PIPELINE_ID);
  const stageId = Number(process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID);
  const ownerId = Number(process.env.PIPEDRIVE_OWNER_USER_ID);

  if (!pipelineId || !stageId || !ownerId) {
    throw new Error(
      LOG_PREFIX +
        ' Missing required env vars: ' +
        'PIPEDRIVE_PIPELINE_ID, PIPEDRIVE_STAGE_NEW_LEAD_ID, PIPEDRIVE_OWNER_USER_ID'
    );
  }

  return { pipelineId, stageId, ownerId };
}

// ── Titulo del deal ───────────────────────────────────────────────────────────

/**
 * Formato: "Estudio DIALux [TipoProyecto] — [Nombre] — [ComunaCiudad]"
 * Ejemplo: "Estudio DIALux Estadio / Cancha deportiva — Juan Perez — Tome"
 */
export function buildEstudioDealTitle(payload: EstudioLuminicoPayload): string {
  const tipo = label(TIPO_PROYECTO_LABELS, payload.tipoProyecto);
  const nombre = payload.nombreCompleto?.trim() || payload.email?.trim() || 'Sin nombre';
  const comuna = payload.comunaCiudad?.trim() || 'Sin ubicacion';
  return 'Estudio DIALux ' + tipo + ' — ' + nombre + ' — ' + comuna;
}

// ── Referencia unica del lead (fingerprint para deduplicacion) ────────────────

/**
 * Formato: "ESTL-{hash5}"
 * Ventana de 1h: mismo email + telefono + tipoProyecto + comunaCiudad
 * en la misma hora producen la misma referencia (anti doble click).
 */
export function buildEstudioLeadRef(payload: EstudioLuminicoPayload): string {
  const djb2 = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  };

  const win = Math.floor(Date.now() / 3_600_000);
  const key = [
    payload.email.toLowerCase().trim(),
    payload.telefono.replace(/\D/g, ''),
    payload.tipoProyecto.toLowerCase().trim(),
    payload.comunaCiudad.toLowerCase().trim(),
    win,
  ].join('|');

  return 'ESTL-' + djb2(key);
}

// ── Custom fields (si la env var no existe, el dato va a la nota) ────────────

function buildEstudioCustomFields(
  payload: EstudioLuminicoPayload,
  leadRef: string
): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {};

  const setField = (
    envKey: string,
    value: string | number | boolean | undefined | null
  ) => {
    const key = process.env[envKey];
    if (key && value !== undefined && value !== null && value !== '') {
      fields[key] = value;
    }
  };

  // tipo_servicio: campo clave para distinguir este flujo en el pipeline compartido
  // TODO: crear custom field "Tipo de Servicio" (Enum) en Pipedrive y configurar
  // PIPEDRIVE_ESTUDIO_FIELD_SERVICE_TYPE con su key. Valores: Estudio Luminico.
  setField('PIPEDRIVE_ESTUDIO_FIELD_SERVICE_TYPE', 'Estudio Luminico');

  // Campo global "Tipo de Servicio" (enum, option ID numerico) compartido con el resto de endpoints.
  setField('PIPEDRIVE_FIELD_TIPO_SERVICIO', TIPO_SERVICIO.ESTUDIO_LUMINICO);

  setField('PIPEDRIVE_ESTUDIO_FIELD_SOURCE', payload.origen);
  setField('PIPEDRIVE_ESTUDIO_FIELD_PROJECT_TYPE', label(TIPO_PROYECTO_LABELS, payload.tipoProyecto));
  setField('PIPEDRIVE_ESTUDIO_FIELD_COMMUNE', payload.comunaCiudad);
  setField('PIPEDRIVE_ESTUDIO_FIELD_HAS_PLANS', label(PLANOS_LABELS, payload.tienePlanos));
  setField('PIPEDRIVE_ESTUDIO_FIELD_DIMENSIONS', payload.dimensionesAproximadas);
  setField('PIPEDRIVE_ESTUDIO_FIELD_MOUNT_HEIGHT', payload.alturaMontaje);
  setField('PIPEDRIVE_ESTUDIO_FIELD_OBJECTIVE', label(OBJETIVO_LABELS, payload.objetivoProyecto));
  setField('PIPEDRIVE_ESTUDIO_FIELD_NORM', label(NORMATIVA_LABELS, payload.normativaObjetivo));
  setField('PIPEDRIVE_ESTUDIO_FIELD_URGENCY', label(URGENCIA_LABELS, payload.urgenciaProyecto));
  setField('PIPEDRIVE_ESTUDIO_FIELD_COMPANY', payload.empresa);
  setField('PIPEDRIVE_ESTUDIO_FIELD_LEAD_REF', leadRef);
  setField('PIPEDRIVE_ESTUDIO_FIELD_DESCRIPTION', payload.descripcionProyecto);

  return fields;
}

// ── Nota estructurada (fallback y complemento a custom fields) ────────────────

/**
 * Genera una nota estructurada que siempre se adjunta al deal.
 * Contiene TODOS los datos del formulario, incluyendo los que no tienen
 * custom field configurado. Garantiza que no se pierde informacion.
 */
export function buildEstudioDealNote(
  payload: EstudioLuminicoPayload,
  leadRef: string
): string {
  const lines: string[] = [
    '=== SOLICITUD ESTUDIO LUMINICO DIALux ===',
    'Referencia: ' + leadRef,
    'Servicio: Estudio Luminico DIALux',
    'Origen: ' + payload.origen,
    'Fecha: ' + (payload.fecha ?? new Date().toLocaleDateString('es-CL')),
    '',
    '--- DATOS DE CONTACTO ---',
    'Nombre: ' + payload.nombreCompleto,
    'Email: ' + payload.email,
    'Telefono: ' + payload.telefono,
    'Empresa: ' + (payload.empresa || '-'),
    '',
    '--- DATOS DEL PROYECTO ---',
    'Tipo de proyecto: ' + label(TIPO_PROYECTO_LABELS, payload.tipoProyecto),
    'Comuna / Ciudad: ' + payload.comunaCiudad,
    'Tiene planos DWG: ' + label(PLANOS_LABELS, payload.tienePlanos),
    'Dimensiones aproximadas: ' + payload.dimensionesAproximadas,
    'Altura de montaje: ' + payload.alturaMontaje,
    'Objetivo del proyecto: ' + label(OBJETIVO_LABELS, payload.objetivoProyecto),
    'Normativa objetivo: ' + label(NORMATIVA_LABELS, payload.normativaObjetivo),
    'Urgencia: ' + label(URGENCIA_LABELS, payload.urgenciaProyecto),
    '',
    '--- DESCRIPCION ---',
    payload.descripcionProyecto || '(sin descripcion adicional)',
    '',
    '--- METADATA ---',
    'source: estudio_luminico',
    'landingPath: ' + (payload.landingPath ?? '/estudio-luminico'),
    'leadRef: ' + leadRef,
  ];

  return lines.join('\n');
}

// ── Mapper principal ──────────────────────────────────────────────────────────

export function mapEstudioPayloadToDealParams(
  payload: EstudioLuminicoPayload,
  personId: number
): CreateEstudioDealParams {
  const { pipelineId, stageId, ownerId } = getEstudioPipelineConfig();
  const leadRef = buildEstudioLeadRef(payload);

  console.log(LOG_PREFIX + ' Mapping deal: ' + leadRef);

  return {
    personId,
    pipelineId,
    stageId,
    ownerId,
    title: buildEstudioDealTitle(payload),
    customFields: buildEstudioCustomFields(payload, leadRef),
    noteContent: buildEstudioDealNote(payload, leadRef),
  };
}
