// api/_lib/crm/installation-mapping.ts
// ─────────────────────────────────────────────────────────────────────────────
// Transforma un InstallationLeadPayload en los parametros que
// createInstallationDeal() necesita.
//
// Separado de mapping.ts (cotizaciones) para mantener independencia total
// entre pipelines. Los cambios en este archivo no afectan el flujo existente.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InstallationLeadPayload,
  CreateInstallationDealParams,
} from './installation-types.js';
import { scoreInstallationLead } from './installation-scoring.js';

const LOG_PREFIX = '[installation-mapping]';

// ── Config del pipeline de instalacion ───────────────────────────────────────

/**
 * Lee los IDs del pipeline de instalacion desde env vars.
 *
 * PENDIENTE DE CONFIGURAR:
 *   PIPEDRIVE_INSTALL_PIPELINE_ID         -> ID del pipeline "Instalacion Profesional"
 *   PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID   -> ID del stage "Nuevo lead"
 *   PIPEDRIVE_OWNER_USER_ID               -> Reutilizado del pipeline existente (mismo owner)
 *
 * Como obtenerlos:
 *   GET https://api.pipedrive.com/v1/pipelines?api_token=TU_TOKEN
 *   GET https://api.pipedrive.com/v1/stages?pipeline_id=ID&api_token=TU_TOKEN
 */
function getInstallationPipelineConfig(): {
  pipelineId: number;
  stageId: number;
  userId: number;
} {
  const pipelineId = Number(process.env.PIPEDRIVE_INSTALL_PIPELINE_ID);
  const stageId = Number(process.env.PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID);
  const userId = Number(process.env.PIPEDRIVE_OWNER_USER_ID);

  if (!pipelineId || !stageId || !userId) {
    throw new Error(
      '[installation-mapping] Missing env vars: ' +
        'PIPEDRIVE_INSTALL_PIPELINE_ID, ' +
        'PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID, ' +
        'PIPEDRIVE_OWNER_USER_ID'
    );
  }

  return { pipelineId, stageId, userId };
}

// ── Titulo del deal ───────────────────────────────────────────────────────────

/**
 * Construye el titulo del deal.
 * Formato: "Instalacion [tipoProyecto] — [nombre] — [comuna]"
 * Ejemplo: "Instalacion Casa / departamento — Juan Perez — Las Condes"
 */
export function buildInstallationDealTitle(payload: InstallationLeadPayload): string {
  const tipo = payload.tipoProyecto?.trim() || 'Proyecto';
  const nombre = payload.nombre?.trim() || payload.email?.trim() || 'Sin nombre';
  const comuna = payload.comuna?.trim() || 'Sin comuna';
  return 'Instalacion ' + tipo + ' — ' + nombre + ' — ' + comuna;
}

// ── Custom fields del deal ────────────────────────────────────────────────────

/**
 * Construye el mapa de custom fields para el deal de instalacion.
 *
 * Cada clave es un field key de Pipedrive (formato hash como "abc123def456").
 * Los valores undefined/null/empty son omitidos automaticamente.
 *
 * CAMPOS PENDIENTES DE CREAR EN PIPEDRIVE (pipeline Instalacion):
 *
 *   Var env                              Tipo en PD   Descripcion
 *   ─────────────────────────────────────────────────────────────
 *   PIPEDRIVE_INSTALL_FIELD_SOURCE       Enum         Origen del lead
 *   PIPEDRIVE_INSTALL_FIELD_PROJECT_TYPE Enum         Tipo de proyecto
 *   PIPEDRIVE_INSTALL_FIELD_CLIENT_TYPE  Enum         Tipo de cliente
 *   PIPEDRIVE_INSTALL_FIELD_COMMUNE      Text         Comuna
 *   PIPEDRIVE_INSTALL_FIELD_DESCRIPTION  Text (Long)  Descripcion
 *   PIPEDRIVE_INSTALL_FIELD_NEEDS_VISIT  Boolean      true para leads web
 *   PIPEDRIVE_INSTALL_FIELD_CONTACT_PREF Enum         Preferencia de contacto
 *   PIPEDRIVE_INSTALL_FIELD_LEAD_REF     Text         Referencia interna
 *
 * Como crearlos:
 *   Pipedrive > Settings > Data Fields > Deals > Add Field
 *   Copiar el "key" generado y pegarlo en la variable de entorno.
 */
function buildInstallationCustomFields(
  payload: InstallationLeadPayload,
  leadRef: string
): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {};

  const setField = (envKey: string, value: string | number | boolean | undefined | null) => {
    const key = process.env[envKey];
    if (key && value !== undefined && value !== null && value !== '') {
      fields[key] = value;
    }
  };

  setField('PIPEDRIVE_INSTALL_FIELD_SOURCE', payload.origen);
  setField('PIPEDRIVE_INSTALL_FIELD_PROJECT_TYPE', payload.tipoProyecto);
  setField('PIPEDRIVE_INSTALL_FIELD_CLIENT_TYPE', payload.tipoCliente || undefined);
  setField('PIPEDRIVE_INSTALL_FIELD_COMMUNE', payload.comuna);
  setField('PIPEDRIVE_INSTALL_FIELD_DESCRIPTION', payload.descripcion);
  setField('PIPEDRIVE_INSTALL_FIELD_NEEDS_VISIT', true);
  setField('PIPEDRIVE_INSTALL_FIELD_CONTACT_PREF', payload.preferenciaContacto || undefined);
  setField('PIPEDRIVE_INSTALL_FIELD_LEAD_REF', leadRef);

  return fields;
}

// ── Referencia unica del lead ─────────────────────────────────────────────────

/**
 * Genera una referencia unica para idempotencia.
 * Formato: "INST-{hash5}" — corto y legible.
 * Ventana de 1h: dos envios del mismo email+comuna+tipo en la misma hora
 * producen la misma referencia (evita duplicados por doble click).
 */
export function buildInstallationLeadRef(payload: InstallationLeadPayload): string {
  const djb2 = (s: string) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  };
  const win = Math.floor(Date.now() / 3_600_000);
  const key = [
    payload.email.toLowerCase().trim(),
    payload.comuna.toLowerCase().trim(),
    payload.tipoProyecto.toLowerCase().trim(),
    win,
  ].join('|');
  return 'INST-' + djb2(key);
}

// ── Mapper principal ──────────────────────────────────────────────────────────

/**
 * Convierte un InstallationLeadPayload en CreateInstallationDealParams.
 * Punto de entrada unico para installation-processing.ts.
 */
export function mapInstallationPayloadToDealParams(
  payload: InstallationLeadPayload,
  personId: number
): CreateInstallationDealParams {
  const { pipelineId, stageId } = getInstallationPipelineConfig();
  const { score, priorityTier } = scoreInstallationLead(payload);
  const leadRef = buildInstallationLeadRef(payload);

  console.log(
    LOG_PREFIX + ' Mapping deal: ' + leadRef +
    ' score=' + score + ' tier=' + priorityTier
  );

  return {
    personId,
    pipelineId,
    stageId,
    title: buildInstallationDealTitle(payload),
    leadScore: score,
    priorityTier,
    customFields: buildInstallationCustomFields(payload, leadRef),
  };
}
