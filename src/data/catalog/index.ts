// src/data/catalog/index.ts
// Catálogo del sitio = base desde Jumpseller (snapshot sincronizado) + valores legados
// que Jumpseller no tiene + contenido editorial por jumpseller_id.
// Precios, nombres, fotos, categorías y productos activos: siempre de Jumpseller.

import { baseFromSnapshot, buildCatalog, refreshCctVariants } from './build';
import { jumpsellerSnapshot } from './jumpseller-snapshot.generated';
import { LEGACY_ORDER, LEGACY_SITE_IDS } from './legacy-ids';
import { SITE_IDS } from './site-ids.generated';
import { baseOverrides } from './overlay/overrides';
import { editorialOverlay } from './overlay/editorial';
import type { Product } from './types';

const variantIndex = new Map(
  jumpsellerSnapshot.flatMap(p => p.variants.map(v => [v.id, { price: v.price, sku: v.sku }] as const)),
);

export const products: Product[] = refreshCctVariants(
  buildCatalog(baseFromSnapshot(jumpsellerSnapshot, baseOverrides, { ...LEGACY_SITE_IDS, ...SITE_IDS }, LEGACY_ORDER), editorialOverlay),
  variantIndex,
);
