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

// ── D.S. N°1/2022 (contaminación lumínica), auditoría UX, entrega 4 (E-03) ──────
// Campo opcional `requiereDs1`. No pasa por api/_lib/crm/** (protegido): ni la etiqueta de
// Pipedrive ni la nota de buildEstudioDealNote lo conocen. Lo agrega create.ts como una sección
// propia de la nota (y del correo, que lleva el mismo texto), después de la de buildEstudioDealNote
// y antes de la constancia de privacidad.

/** Valor del formulario → texto de la nota. El formulario usa las mismas claves. */
export const REQUIERE_DS1_LABELS = {
  si: 'Sí, se lo exigen (bases, mandante o municipio)',
  no_se: 'No lo sabe: pide asesoría',
  no: 'No, es un recinto cerrado con muros',
} as const;
export type RequiereDs1 = keyof typeof REQUIERE_DS1_LABELS;
/** Una de las claves de REQUIERE_DS1_LABELS (sin Object.hasOwn: el formulario compila con ES2020). */
export const isRequiereDs1 = (value: unknown): value is RequiereDs1 =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(REQUIERE_DS1_LABELS, value);
export const DS1_NOTE_HEADING = '--- D.S. N°1/2022 (CONTAMINACIÓN LUMÍNICA) ---';

/**
 * Sección de la nota con la respuesta al D.S. N°1/2022. Vacía si el visitante no respondió (o
 * con un valor que la validación ya habría rechazado): la nota queda igual que antes.
 */
export function ds1NoteLines(body: unknown): string[] {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>).requiereDs1 : undefined;
  if (!isRequiereDs1(value)) return [];
  return [DS1_NOTE_HEADING, '¿Debe cumplirlo?: ' + REQUIERE_DS1_LABELS[value]];
}

// Tope de la descripcion: asi la nota completa (y el correo a ventas, que la lleva)
// cabe siempre bajo el maximo del relay. El textarea del formulario usa el mismo.
export const MAX_DESCRIPCION_PROYECTO = 2000;

// Topes de los demas textos (mismo patron que instalacion). El correo a ventas lleva la
// nota completa y el relay corta el FINAL (8.000 caracteres), donde van la constancia de
// privacidad y el origen de la visita: con estos topes el peor caso cabe sin recorte.
// Los inputs del formulario usan los mismos (maxLength).
export const ESTUDIO_MAX_LENGTHS = {
  nombreCompleto: 120,
  email: 254,
  telefono: 30,
  empresa: 120,
  comunaCiudad: 80,
  dimensionesAproximadas: 200,
  alturaMontaje: 60,
  fecha: 40,
  landingPath: 60,
} as const;

/** Opcional de texto: ausente (undefined/null) o string. Un numero romperia el correo. */
function isOptionalText(val: unknown): boolean {
  return val === undefined || val === null || typeof val === 'string';
}

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

  // Opcionales de texto (van a la nota y al correo)
  if (!isOptionalText(p.empresa)) errors.push('empresa must be a string');
  // fecha y landingPath van a la nota: un valor que no es texto (una lista enorme) saltaria
  // el tope de largo
  if (!isOptionalText(p.fecha)) errors.push('fecha must be a string');
  if (!isOptionalText(p.landingPath)) errors.push('landingPath must be a string');
  if (!isOptionalText(p.descripcionProyecto)) {
    errors.push('descripcionProyecto must be a string');
  } else if (
    typeof p.descripcionProyecto === 'string' &&
    p.descripcionProyecto.length > MAX_DESCRIPCION_PROYECTO
  ) {
    errors.push('descripcionProyecto max ' + MAX_DESCRIPCION_PROYECTO + ' characters');
  }

  // Largos maximos
  for (const [field, max] of Object.entries(ESTUDIO_MAX_LENGTHS)) {
    const value = p[field];
    if (typeof value === 'string' && value.length > max) errors.push(field + ' max ' + max + ' characters');
  }

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
    p.requiereDs1 !== undefined &&
    p.requiereDs1 !== '' &&
    !isRequiereDs1(p.requiereDs1)
  ) {
    errors.push('requiereDs1 must be one of: ' + Object.keys(REQUIERE_DS1_LABELS).join(', '));
  }

  if (
    p.origen !== undefined &&
    !(VALID_ORIGEN as readonly string[]).includes(p.origen as string)
  ) {
    errors.push('origen must be one of: ' + VALID_ORIGEN.join(', '));
  }

  return { valid: errors.length === 0, errors };
}
