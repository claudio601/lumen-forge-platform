// src/data/catalog/index.ts
// Catálogo del sitio = base desde Jumpseller (snapshot sincronizado) + valores legados
// que Jumpseller no tiene + contenido editorial por jumpseller_id.
// Precios, nombres, fotos, categorías y productos activos: siempre de Jumpseller.

import { baseFromSnapshot, buildCatalog, refreshCctVariants } from './build';
import { jumpsellerSnapshot } from './jumpseller-snapshot.generated';
import { LEGACY_ORDER, LEGACY_SITE_IDS } from './legacy-ids';
import { SITE_IDS } from './site-ids.generated';
import { RENAMED_SITE_IDS, RETIRED_SITE_IDS } from './renamed-ids';
import { baseOverrides } from './overlay/overrides';
import { editorialOverlay } from './overlay/editorial';
import type { Product } from './types';

const variantIndex = new Map(
  jumpsellerSnapshot.flatMap(p => p.variants.map(v => [v.id, { price: v.price, sku: v.sku }] as const)),
);

// Id de cada producto: el renombrado (con su 301) gana sobre el de la sincronización y el legado.
const renamedIds = Object.fromEntries(Object.entries(RENAMED_SITE_IDS).map(([jid, r]) => [jid, r.id]));
const siteIds: Readonly<Record<number, string>> = { ...LEGACY_SITE_IDS, ...SITE_IDS, ...renamedIds };

export const products: Product[] = refreshCctVariants(
  buildCatalog(baseFromSnapshot(jumpsellerSnapshot, baseOverrides, siteIds, LEGACY_ORDER, RETIRED_SITE_IDS), editorialOverlay),
  variantIndex,
);
