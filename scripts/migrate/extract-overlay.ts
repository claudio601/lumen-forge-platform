// scripts/migrate/extract-overlay.ts
// Migración única (Etapa 1, PR 6): separa src/data/products.ts en
//   - src/data/catalog/legacy-base.ts        base sin contenido editorial (temporal: el PR 7
//                                             la reemplaza por el snapshot de Jumpseller)
//   - src/data/catalog/overlay/editorial.ts  contenido editorial por jumpseller_id
//   - src/data/catalog/legacy-ids.ts         jumpseller_id → id del sitio (mantiene las URLs)
// La prueba scripts/catalog-parity.test.ts verifica que no se pierde ningún dato.
//
//   npx tsx scripts/migrate/extract-overlay.ts

import { writeFileSync } from 'node:fs';
import { products } from '../../src/data/products';
import { EDITORIAL_KEYS, type BaseProduct, type EditorialFields } from '../../src/data/catalog/build';

const editorialSet = new Set<string>(EDITORIAL_KEYS);
const base: BaseProduct[] = [];
const overlay: Record<number, EditorialFields> = {};
const ids: Record<number, string> = {};

for (const p of products) {
  const b: Record<string, unknown> = {};
  const e: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    (editorialSet.has(k) ? e : b)[k] = v;
  }
  base.push(b as BaseProduct);
  if (Object.keys(e).length) overlay[p.jumpseller_id] = e as EditorialFields;
  ids[p.jumpseller_id] = p.id;
}

const banner = (what: string) =>
  `// ${what}\n// Generado una vez por scripts/migrate/extract-overlay.ts a partir de src/data/products.ts (2026-09-30).\n`;

writeFileSync(
  'src/data/catalog/legacy-base.ts',
  `${banner('Base legada del catálogo (sin contenido editorial). TEMPORAL: el PR 7 la reemplaza por el snapshot de Jumpseller.')}
import type { BaseProduct } from './build';

export const legacyBase: BaseProduct[] = [
${base.map(p => `  ${JSON.stringify(p)},`).join('\n')}
];
`,
  'utf8',
);

writeFileSync(
  'src/data/catalog/overlay/editorial.ts',
  `${banner('Contenido editorial del catálogo, por jumpseller_id. Se edita a mano: Jumpseller no lo sobrescribe.')}
import type { EditorialFields } from '../build';

export const editorialOverlay: Readonly<Record<number, EditorialFields>> = ${JSON.stringify(overlay, null, 2)};
`,
  'utf8',
);

writeFileSync(
  'src/data/catalog/legacy-ids.ts',
  `${banner('jumpseller_id → id (slug) del sitio. Congelado para no romper URLs /producto/:id ya publicadas.')}
export const LEGACY_SITE_IDS: Readonly<Record<number, string>> = ${JSON.stringify(ids, null, 2)};
`,
  'utf8',
);

console.log(`base: ${base.length} · editorial: ${Object.keys(overlay).length} productos · ids: ${Object.keys(ids).length}`);
