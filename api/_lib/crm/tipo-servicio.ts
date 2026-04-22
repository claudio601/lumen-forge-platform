// api/_lib/crm/tipo-servicio.ts
// Option IDs del custom field "Tipo de Servicio" en Pipedrive (enum single option).
// Field key: 3662a6c51449226a5623a079aa0f6bd9e8fb8300
// Env var: PIPEDRIVE_FIELD_TIPO_SERVICIO

export const TIPO_SERVICIO = {
  COTIZACION_WEB: 89,
  INSTALACION: 90,
  ESTUDIO_LUMINICO: 91,
  WHATSAPP: 92,
  JUMPSELLER: 93,
} as const;

export type TipoServicioValue = (typeof TIPO_SERVICIO)[keyof typeof TIPO_SERVICIO];
