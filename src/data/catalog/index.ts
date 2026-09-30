// src/data/catalog/index.ts
// Catálogo del sitio = base (hoy el catálogo legado; desde el PR 7, el snapshot de
// Jumpseller) + contenido editorial por jumpseller_id.

import { buildCatalog } from './build';
import { legacyBase } from './legacy-base';
import { editorialOverlay } from './overlay/editorial';
import type { Product } from './types';

export const products: Product[] = buildCatalog(legacyBase, editorialOverlay);
