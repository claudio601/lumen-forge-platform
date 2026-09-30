// scripts/migrate/extract-overrides.ts
// Migración única (Etapa 1, PR 7): compara el catálogo legado (fixture del 2026-09-30)
// con el snapshot de Jumpseller y genera
//   - src/data/catalog/overlay/overrides.ts  valores legados que Jumpseller no tiene
//                                             (SKU vacío, marca null, lúmenes)
//   - src/data/catalog/legacy-ids.ts         ids históricos + orden legado ("Relevancia")
//
//   npx tsx scripts/migrate/extract-overrides.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { cleanSku } from '../jumpseller/normalize';
import { jumpsellerSnapshot } from '../../src/data/catalog/jumpseller-snapshot.generated';
import type { BaseOverrides } from '../../src/data/catalog/build';

interface LegacyProduct {
  id: string;
  jumpseller_id: number;
  sku: string;
  brand: string;
  lumens: number;
}

const legacy = JSON.parse(readFileSync('scripts/fixtures/catalog-legacy-2026-09-30.json', 'utf8')) as LegacyProduct[];
const snapshot = new Map(jumpsellerSnapshot.map(p => [p.jumpseller_id, p]));

const overrides: Record<number, BaseOverrides> = {};
for (const l of legacy) {
  const s = snapshot.get(l.jumpseller_id);
  if (!s) continue; // ya no se publica
  const o: BaseOverrides = {};
  const sku = cleanSku(l.sku);
  if (!s.sku && sku) o.sku = sku;
  if (!s.brand && l.brand) o.brand = l.brand;
  if (l.lumens > 0) o.lumens = l.lumens;
  if (Object.keys(o).length) overrides[l.jumpseller_id] = o;
}

const banner = (what: string) =>
  `// ${what}\n// Generado una vez por scripts/migrate/extract-overrides.ts (2026-09-30).\n`;

writeFileSync(
  'src/data/catalog/overlay/overrides.ts',
  `${banner('Valores del catálogo legado que Jumpseller no tiene (SKU vacío, marca null, lúmenes). Si Jumpseller los completa, gana Jumpseller.')}
import type { BaseOverrides } from '../build';

export const baseOverrides: Readonly<Record<number, BaseOverrides>> = ${JSON.stringify(overrides, null, 2)};
`,
  'utf8',
);

writeFileSync(
  'src/data/catalog/legacy-ids.ts',
  `${banner('jumpseller_id → id (slug) del sitio, congelado para no romper URLs /producto/:id ya publicadas, y orden\n// del catálogo legado (orden "Relevancia"; los productos nuevos van al final).')}
export const LEGACY_SITE_IDS: Readonly<Record<number, string>> = ${JSON.stringify(Object.fromEntries(legacy.map(l => [l.jumpseller_id, l.id])), null, 2)};

export const LEGACY_ORDER: readonly number[] = ${JSON.stringify(legacy.map(l => l.jumpseller_id))};
`,
  'utf8',
);

const count = (k: keyof BaseOverrides) => Object.values(overrides).filter(o => o[k] !== undefined).length;
console.log(`overrides: ${Object.keys(overrides).length} productos (sku ${count('sku')}, marca ${count('brand')}, lúmenes ${count('lumens')})`);
