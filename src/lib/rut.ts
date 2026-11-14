// src/lib/rut.ts
// RUT chileno: limpiar, dar formato (12.345.678-9) y revisar el dígito verificador
// (módulo 11). Lo usan /cotizacion y /solicitar-pedido en modo empresa (auditoría UX, F-02).
//
// El navegador lo revisa para avisar junto al campo. El servidor nunca rechaza una solicitud
// por el RUT (perder un lead es peor): api/quotes/create.ts solo lo exige presente y
// api/request-orders/create.ts y api/project-quotes/create.ts lo aceptan opcional, tal como
// llega. Si no calza, la nota del negocio y el correo a ventas lo dicen bajo «Para revisar»
// (api/_lib/forms/review.ts, 13-11-2026).

import { DOTTED_BODY_ONLY, cleanRut, rutCheckDigit, rutProblem, type RutProblem } from '../../api/_lib/rut';

/**
 * Limpieza, dígito verificador (módulo 11) y motivo: una sola fuente, en api/_lib/rut.ts (también
 * la usan el bot y el aviso «RUT por revisar» de las notas de Pipedrive).
 */
export { cleanRut, rutCheckDigit, rutProblem, type RutProblem };

/**
 * Formato de presentación: "111111111" o "11.111.111-1" → "11.111.111-1"; la k pasa a K.
 * Lo que no se puede leer como RUT (letras, muy corto, una K al medio, o puntos sin el dígito
 * verificador) vuelve tal como se escribió, sin espacios a los lados, para que la persona lo
 * corrija.
 */
export function formatRut(input: string): string {
  if (DOTTED_BODY_ONLY.test(input.trim())) return input.trim();
  const clean = cleanRut(input);
  const m = clean.match(/^(\d+)([0-9K])$/);
  if (!m) return input.trim();
  const body = m[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${m[2]}`;
}

/** true si el RUT está bien escrito y su dígito verificador calza (K mayúscula o minúscula). */
export function isValidRut(input: string): boolean {
  return rutProblem(input) === null;
}
