// api/installation-leads/validation.ts
// ─────────────────────────────────────────────────────────────────────────────
// Validacion del InstallationLeadPayload antes de entrar al pipeline CRM.
// Espeja las reglas de validacion del formulario frontend (InstallationLeadForm).
// ─────────────────────────────────────────────────────────────────────────────

import type { InstallationLeadPayload } from '../_lib/crm/installation-types.js';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface InstallationValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_SOURCES = ['instalacion_web', 'whatsapp_bot', 'manual'] as const;

const VALID_PROJECT_TYPES = [
  'Casa / departamento',
  'Oficina',
  'Local comercial',
  'Bodega',
  'Condominio / edificio',
  'Proyecto industrial',
  'Paneles solares',
  'Otro',
] as const;

const VALID_CLIENT_TYPES = ['hogar', 'empresa', 'condominio', ''] as const;
const VALID_CONTACT_PREFS = ['whatsapp', 'llamada', 'email', ''] as const;

function isStr(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isEmail(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^[^s@]+@[^s@]+.[^s@]+$/.test(val.trim());
}

function isPhone(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const digits = val.replace(/D/g, '');
  return digits.length >= 8 && digits.length <= 12;
}

// ── Validador principal ────────────────────────────────────────────────────────

/**
 * Valida un InstallationLeadPayload.
 *
 * Campos requeridos: nombre, telefono, email, comuna, tipoProyecto, descripcion, aceptaContacto.
 * Campos opcionales validados si presentes: tipoCliente, preferenciaContacto, origen.
 */
export function validateInstallationPayload(payload: unknown): InstallationValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = payload as Record<string, unknown>;

  // Campos requeridos
  if (!isStr(p.nombre)) errors.push('nombre is required');
  if (!isStr(p.telefono)) errors.push('telefono is required');
  else if (!isPhone(p.telefono)) errors.push('telefono format invalid (min 8 digits)');
  if (!isStr(p.email)) errors.push('email is required');
  else if (!isEmail(p.email)) errors.push('email format invalid');
  if (!isStr(p.comuna)) errors.push('comuna is required');
  if (!isStr(p.tipoProyecto)) errors.push('tipoProyecto is required');
  if (!isStr(p.descripcion)) errors.push('descripcion is required');
  if (p.aceptaContacto !== true) errors.push('aceptaContacto must be true');

  // Enum validations
  if (p.origen !== undefined && !(VALID_SOURCES as readonly string[]).includes(p.origen as string)) {
    errors.push('origen must be one of: ' + VALID_SOURCES.join(', '));
  }
  if (p.tipoProyecto !== undefined && !(VALID_PROJECT_TYPES as readonly string[]).includes(p.tipoProyecto as string)) {
    errors.push('tipoProyecto must be one of: ' + VALID_PROJECT_TYPES.join(', '));
  }
  if (p.tipoCliente !== undefined && !(VALID_CLIENT_TYPES as readonly string[]).includes(p.tipoCliente as string)) {
    errors.push('tipoCliente must be one of: ' + VALID_CLIENT_TYPES.join(', '));
  }
  if (p.preferenciaContacto !== undefined && !(VALID_CONTACT_PREFS as readonly string[]).includes(p.preferenciaContacto as string)) {
    errors.push('preferenciaContacto must be one of: ' + VALID_CONTACT_PREFS.join(', '));
  }

  return { valid: errors.length === 0, errors };
}
