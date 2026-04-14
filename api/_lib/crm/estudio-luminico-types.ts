// api/_lib/crm/estudio-luminico-types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Types exclusivos para el pipeline de Estudio Luminico DIALux de eLIGHTS.
// Separados intencionalmente para evitar acoplamiento con instalacion y cotizacion.
// ─────────────────────────────────────────────────────────────────────────────

// ── Enums de dominio ──────────────────────────────────────────────────────────

export type EstudioTipoProyecto =
  | 'cancha_deportiva'
  | 'industria_bodega'
  | 'estacionamiento'
  | 'edificio_comercial'
  | 'vialidad_exterior'
  | 'proyecto_especial';

export type EstudioTienePlanos =
  | 'si_dwg_listo'
  | 'si_preparar'
  | 'no_tengo';

export type EstudioObjetivoProyecto =
  | 'entrenamiento'
  | 'competencia'
  | 'operacion_industrial'
  | 'seguridad'
  | 'licitacion'
  | 'no_definido';

export type EstudioNormativaObjetivo =
  | 'criterios_fifa'
  | 'en_12193'
  | 'en_12464'
  | 'en_13201'
  | 'sec_chile'
  | 'no_seguro';

export type EstudioUrgencia =
  | 'urgente'
  | 'este_mes'
  | 'evaluando'
  | 'futura_licitacion';

export type EstudioLeadSource = 'estudio_luminico_web' | 'manual';

// ── Payload entrante ──────────────────────────────────────────────────────────

/**
 * Payload que llega al endpoint POST /api/estudio-luminico/create.
 * Refleja exactamente los campos del EstudioLuminicoLeadForm del frontend
 * mas metadata de origen.
 *
 * Campos requeridos en el formulario -> requeridos aqui.
 * Campos opcionales del formulario -> opcionales aqui.
 */
export interface EstudioLuminicoPayload {
  // Contacto (requeridos)
  nombreCompleto: string;
  email: string;
  telefono: string;

  // Proyecto (requeridos)
  tipoProyecto: EstudioTipoProyecto | string;
  comunaCiudad: string;
  tienePlanos: EstudioTienePlanos | string;
  dimensionesAproximadas: string;
  alturaMontaje: string;
  objetivoProyecto: EstudioObjetivoProyecto | string;

  // Opcionales del formulario
  empresa?: string;
  normativaObjetivo?: EstudioNormativaObjetivo | string;
  urgenciaProyecto?: EstudioUrgencia | string;
  descripcionProyecto?: string;

  // Honeypot (nunca enviado por usuarios reales)
  website?: string;

  // Metadata
  origen: EstudioLeadSource;
  fecha?: string;
  landingPath?: string;
}

// ── Resultado de procesamiento CRM ────────────────────────────────────────────

export interface EstudioLuminicoResult {
  personId: number;
  personAction: 'found' | 'created';
  dealId: number;
  dealAction: 'created' | 'updated';
}

// ── Respuestas de la API ──────────────────────────────────────────────────────

export interface EstudioLuminicoSuccessResponse {
  success: true;
  personId: number;
  dealId: number;
  dealAction: 'created' | 'updated';
}

export interface EstudioLuminicoErrorResponse {
  success: false;
  error: string;
  details?: Record<string, unknown>;
}

export type EstudioLuminicoResponse =
  | EstudioLuminicoSuccessResponse
  | EstudioLuminicoErrorResponse;

// ── Parametros internos para createEstudioDeal ────────────────────────────────

export interface CreateEstudioDealParams {
  personId: number;
  pipelineId: number;
  stageId: number;
  ownerId: number;
  title: string;
  customFields: Record<string, string | number | boolean>;
  noteContent: string;
}
