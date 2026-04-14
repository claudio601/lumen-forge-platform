// api/estudio-luminico/validation.ts
// ─────────────────────────────────────────────────────────────────────────────
// Validacion server-side del EstudioLuminicoPayload.
// Espeja las reglas de validacion del formulario frontend.
// ─────────────────────────────────────────────────────────────────────────────

import type { EstudioLuminicoPayload } from '../_lib/crm/estudio-luminico-types.js';

export interface EstudioValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_TIPO_PROYECTO = [
  'cancha_deportiva',
  'industria_bodega',
  'estacionamiento',
  'edificio_comercial',
  'vialidad_exterior',
  'proyecto_especial',
] as const;

const VALID_TIENE_PLANOS = ['si_dwg_listo', 'si_preparar', 'no_tengo'] as const;

const VALID_OBJETIVO = [
  'entrenamiento',
  'competencia',
  'operacion_industrial',
  'seguridad',
  'licitacion',
  'no_definido',
] as const;

const VALID_NORMATIVA = [
  'criterios_fifa',
  'en_12193',
  'en_12464',
  'en_13201',
  'sec_chile',
  'no_seguro',
] as const;

const VALID_URGENCIA = [
  'urgente',
  'este_mes',
  'evaluando',
  'futura_licitacion',
] as const;

const VALID_ORIGEN = ['estudio_luminico_web', 'manual'] as const;

function isStr(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isEmail(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

function isPhone(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const digits = val.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

// ── Validador principal ────────────────────────────────────────────────────────

export function validateEstudioPayload(payload: unknown): EstudioValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = payload as Record<string, unknown>;

  // Campos requeridos de contacto
  if (!isStr(p.nombreCompleto)) errors.push('nombreCompleto is required');
  if (!isStr(p.email)) errors.push('email is required');
  else if (!isEmail(p.email)) errors.push('email format invalid');
  if (!isStr(p.telefono)) errors.push('telefono is required');
  else if (!isPhone(p.telefono)) errors.push('telefono format invalid (min 8 digits)');

  // Campos requeridos del proyecto
  if (!isStr(p.tipoProyecto)) errors.push('tipoProyecto is required');
  if (!isStr(p.comunaCiudad)) errors.push('comunaCiudad is required');
  if (!isStr(p.tienePlanos)) errors.push('tienePlanos is required');
  if (!isStr(p.dimensionesAproximadas)) errors.push('dimensionesAproximadas is required');
  if (!isStr(p.alturaMontaje)) errors.push('alturaMontaje is required');
  if (!isStr(p.objetivoProyecto)) errors.push('objetivoProyecto is required');

  // Enum validations (requeridos)
  if (
    p.tipoProyecto !== undefined &&
    !(VALID_TIPO_PROYECTO as readonly string[]).includes(p.tipoProyecto as string)
  ) {
    errors.push('tipoProyecto must be one of: ' + VALID_TIPO_PROYECTO.join(', '));
  }

  if (
    p.tienePlanos !== undefined &&
    !(VALID_TIENE_PLANOS as readonly string[]).includes(p.tienePlanos as string)
  ) {
    errors.push('tienePlanos must be one of: ' + VALID_TIENE_PLANOS.join(', '));
  }

  if (
    p.objetivoProyecto !== undefined &&
    !(VALID_OBJETIVO as readonly string[]).includes(p.objetivoProyecto as string)
  ) {
    errors.push('objetivoProyecto must be one of: ' + VALID_OBJETIVO.join(', '));
  }

  // Enum validations (opcionales — validar solo si presentes)
  if (
    p.normativaObjetivo !== undefined &&
    p.normativaObjetivo !== '' &&
    !(VALID_NORMATIVA as readonly string[]).includes(p.normativaObjetivo as string)
  ) {
    errors.push('normativaObjetivo must be one of: ' + VALID_NORMATIVA.join(', '));
  }

  if (
    p.urgenciaProyecto !== undefined &&
    p.urgenciaProyecto !== '' &&
    !(VALID_URGENCIA as readonly string[]).includes(p.urgenciaProyecto as string)
  ) {
    errors.push('urgenciaProyecto must be one of: ' + VALID_URGENCIA.join(', '));
  }

  if (
    p.origen !== undefined &&
    !(VALID_ORIGEN as readonly string[]).includes(p.origen as string)
  ) {
    errors.push('origen must be one of: ' + VALID_ORIGEN.join(', '));
  }

  return { valid: errors.length === 0, errors };
}
