// src/lib/formValidation.ts
// Reglas y mensajes de los campos de /cotizacion y /solicitar-pedido (auditoría UX, F-02):
// se revisan al salir de cada campo y al enviar, y el mensaje va debajo del campo.
//
// El correo usa la misma regla que el servidor (api/request-orders/create.ts y
// api/_lib/crm/validation.ts, que usa api/quotes/create.ts): formValidation.test.ts revisa
// que sigan siendo iguales. El RUT solo se revisa aquí: el servidor nunca rechaza por él.

import { rutProblem } from './rut';

/** Misma expresión que isValidEmail en el servidor. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FIELD_MESSAGES = {
  emailInvalid: 'Revisa el correo: le falta la @ o el dominio (ej.: nombre@empresa.cl).',
  rutFormat: 'Revisa el RUT: escríbelo completo, con su dígito verificador (ej.: 12.345.678-9).',
  rutCheckDigit: 'Revisa el RUT: el dígito verificador no corresponde.',
} as const;

/** Un texto obligatorio: el mensaje si está vacío (solo espacios cuenta como vacío). */
export function requiredMessage(value: string, message: string): string | null {
  return value.trim() ? null : message;
}

/** Correo obligatorio con la regla del servidor (se revisa sin espacios a los lados). */
export function emailMessage(value: string, emptyMessage: string): string | null {
  const v = value.trim();
  if (!v) return emptyMessage;
  return EMAIL_RE.test(v) ? null : FIELD_MESSAGES.emailInvalid;
}

/** Dígitos de un teléfono escrito con espacios, +, guiones o paréntesis. */
export const phoneDigitCount = (value: string) => value.replace(/\D/g, '').length;

/**
 * RUT: con `required`, vacío es un error; sin él (campo opcional), vacío está bien. Escrito,
 * tiene que tener el formato y el dígito verificador correctos.
 */
export function rutMessage(value: string, { required, emptyMessage }: { required: boolean; emptyMessage: string }): string | null {
  const problem = rutProblem(value);
  if (problem === 'empty') return required ? emptyMessage : null;
  if (problem === 'format') return FIELD_MESSAGES.rutFormat;
  if (problem === 'check_digit') return FIELD_MESSAGES.rutCheckDigit;
  return null;
}
