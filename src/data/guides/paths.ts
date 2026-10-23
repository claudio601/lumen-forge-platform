// src/data/guides/paths.ts
// URLs de las guías (plan del blog, §1.2), sin importar el catálogo ni la lista de guías: lo
// pueden usar la cabecera, el pie y los scripts sin sumar peso al bundle principal.

/** El índice de las guías. */
export const GUIDES_PATH = '/guias';

/** La URL de una guía: /guias/<slug>, sin el pilar (así no cambia si la guía cambia de pilar). */
export const guidePath = (slug: string) => `${GUIDES_PATH}/${slug}`;

/**
 * Los slugs de las 8 guías del plan (§1.2, aprobadas por el dueño el 23-10-2026), publicadas o
 * no. Un enlace a una de ellas se esconde solo mientras no esté publicada (plan §1.5); un slug
 * fuera de esta lista es un error de tipeo (lo revisa guides.test.ts).
 */
export const PLANNED_GUIDE_SLUGS = [
  'norma-luminica-ds-1-2022',
  'cuantos-lux-necesita-una-bodega',
  'como-verificar-certificado-norma-luminica',
  'luz-calida-o-fria-en-exteriores',
  'como-iluminar-una-cancha-o-multicancha',
  'deslumbramiento-led-ugr',
  'iluminacion-de-patios-de-carga',
  'antes-de-cotizar-un-proyecto-led',
] as const;
