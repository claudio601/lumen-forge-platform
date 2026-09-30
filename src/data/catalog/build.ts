// src/data/catalog/build.ts
// Arma el catálogo del sitio uniendo:
//   - la base: datos que controla Jumpseller (hoy: el catálogo legado; en el PR 7,
//     el snapshot sincronizado), y
//   - el contenido editorial (fichas, FAQ, SEO, variantes CCT…), asociado por
//     jumpseller_id y mantenido a mano en ./overlay.
// Solo imports relativos: lo usan también scripts/ (tsx y vitest).

import type { Product } from './types';

/** Campos que escribe el equipo (no vienen de Jumpseller). */
export const EDITORIAL_KEYS = [
  'cri',
  'voltage',
  'lifetime',
  'warranty',
  'availableCCT',
  'datasheetUrl',
  'metaTitle',
  'metaDescription',
  'shortDescription',
  'description',
  'keyBenefits',
  'technicalDetails',
  'certifications',
  'installationInfo',
  'useCases',
  'faq',
  'specsElectricos',
  'specsConstruccion',
  'specsComponentes',
  'cctVariants',
  'productFamily',
] as const satisfies readonly (keyof Product)[];

export type EditorialKey = (typeof EDITORIAL_KEYS)[number];
export type EditorialFields = Partial<Pick<Product, EditorialKey>>;
export type BaseProduct = Omit<Product, EditorialKey>;

/** Une base + contenido editorial. El editorial nunca pisa campos de la base. */
export function buildCatalog(
  base: readonly BaseProduct[],
  overlay: Readonly<Record<number, EditorialFields>>,
): Product[] {
  return base.map(p => {
    const editorial = overlay[p.jumpseller_id];
    return editorial ? { ...p, ...editorial } : { ...p };
  });
}
