// api/_lib/crm/installation-types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Types exclusivos para el pipeline de Instalacion Profesional de eLIGHTS.
// Separados intencionalmente de types.ts para evitar acoplamiento con el
// flujo de cotizacion de productos.
// ─────────────────────────────────────────────────────────────────────────────

// ── Enums de dominio ──────────────────────────────────────────────────────────

export type InstallationProjectType =
  | 'Casa / departamento'
  | 'Oficina'
  | 'Local comercial'
  | 'Bodega'
  | 'Condominio / edificio'
  | 'Proyecto industrial'
  | 'Paneles solares'
  | 'Otro';

export type InstallationClientType =
  | 'hogar'
  | 'empresa'
  | 'condominio'
  | '';

export type InstallationContactPreference =
  | 'whatsapp'
  | 'llamada'
  | 'email'
  | '';

export type InstallationLeadSource =
  | 'instalacion_web'   // formulario /instalacion
  | 'whatsapp_bot'      // futuro bot de WhatsApp
  | 'manual';           // carga manual / back-office

// ── Payload entrante ──────────────────────────────────────────────────────────

/**
 * Payload que llega al endpoint POST /api/installation-leads/create.
 * Refleja exactamente los campos del InstallationLeadForm del frontend
 * mas metadata de origen.
 *
 * Todos los campos requeridos en el formulario son requeridos aqui tambien.
 * Los campos opcionales del formulario son opcionales aqui.
 */
export interface InstallationLeadPayload {
  // Contacto (requeridos)
  nombre: string;
  telefono: string;
  email: string;

  // Proyecto (requeridos)
  comuna: string;
  tipoProyecto: InstallationProjectType | string; // string permite valores futuros sin romper
  descripcion: string;

  // Opcionales del formulario
  tipoCliente?: InstallationClientType;
  preferenciaContacto?: InstallationContactPreference;
  aceptaContacto: boolean;           // siempre presente (checkbox obligatorio)

  // Metadata
  origen: InstallationLeadSource;
  fecha?: string;                    // ISO o locale string, se usa para el titulo
}

// ── Resultado de procesamiento CRM ───────────────────────────────────────────

export interface InstallationCrmResult {
  personId: number;
  personAction: 'found' | 'created';
  dealId: number;
  dealAction: 'created' | 'updated';
  leadScore: number;
  priorityTier: 'Alta' | 'Normal';
}

// ── Respuestas de la API ──────────────────────────────────────────────────────

export interface InstallationLeadSuccessResponse {
  success: true;
  personId: number;
  dealId: number;
  dealAction: 'created' | 'updated';
  leadScore: number;
  priorityTier: 'Alta' | 'Normal';
}

export interface InstallationLeadErrorResponse {
  success: false;
  error: string;
  details?: Record<string, unknown>;
}

export type InstallationLeadResponse =
  | InstallationLeadSuccessResponse
  | InstallationLeadErrorResponse;

// ── Parametros internos para createDeal ─────────────────────────────────────

/**
 * Parametros que installation-mapping.ts produce y que
 * installation-processing.ts pasa a createInstallationDeal().
 */
export interface CreateInstallationDealParams {
  personId: number;
  pipelineId: number;
  stageId: number;
  title: string;
  leadScore: number;
  priorityTier: 'Alta' | 'Normal';
  // Custom fields — claves resueltas desde env vars en mapping
  customFields: Record<string, string | number | boolean>;
}
