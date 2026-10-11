// api/_lib/forms/projectQuote.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reglas del cotizador de proyecto que comparten el formulario (src/pages/SmartQuotePage.tsx)
// y el servidor (api/project-quotes/create.ts): las opciones de las listas, los topes y
// cómo se leen los m². Sin imports: lo usan el navegador y la función. La carpeta _lib
// hace que Vercel no lo despliegue como función.
// ─────────────────────────────────────────────────────────────────────────────

/** Opciones de "Tipo de proyecto". El servidor solo acepta una de estas, exacta. */
export const PROJECT_TYPES = ['Oficina', 'Retail', 'Bodega', 'Industria', 'Exterior', 'Vial', 'Hogar', 'Otro'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Opciones de "Nivel de iluminación" (opcional). El servidor solo acepta una de estas, exacta. */
export const ILLUMINATION_LEVELS = ['Basico', 'Estandar', 'Alto rendimiento', 'Especializado'] as const;
export type IlluminationLevel = (typeof ILLUMINATION_LEVELS)[number];

export const MAX_M2 = 10_000_000;
export const MAX_ALTURA = 200;

/** Aviso cuando los m² no se pueden leer sin adivinar. */
export const M2_FORMAT_MESSAGE = 'Escribe los m2 solo con números (ej: 12000).';

const M2_TEXT = /^(?:\d+|\d{1,3}(?:\.\d{3})+)$/;

/**
 * m² escritos por una persona: un entero, con o sin punto de miles ("12000", "12.000",
 * "1.200", "100.000"). NaN para todo lo demás: "12,5", "1,200", "12.5" o "12 000" son
 * ambiguos y se piden de nuevo en vez de adivinar. Con un input type="number" el
 * navegador leía "12.000" como 12; por eso el campo es de texto y se lee aquí.
 */
export function parseM2(text: string): number {
  const value = text.trim();
  return M2_TEXT.test(value) ? Number(value.replace(/\./g, '')) : NaN;
}
