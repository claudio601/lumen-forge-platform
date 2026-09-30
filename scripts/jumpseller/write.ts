// scripts/jumpseller/write.ts
// Genera los archivos *.generated.ts (deterministas: ordenados, sin fechas) y los
// escribe de forma atómica (archivo temporal + rename).

import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SnapshotProduct } from '../../src/data/catalog/jumpseller.types';

export const OUTPUT_PATHS = {
  snapshot: 'src/data/catalog/jumpseller-snapshot.generated.ts',
  categories: 'src/data/catalog/categories.generated.ts',
  priceIndex: 'api/_lib/catalog/price-index.generated.ts',
} as const;

/** Claves que nunca pueden aparecer en un archivo generado (defensa en profundidad). */
export const FORBIDDEN_KEYS = ['cost_per_item', 'stock', 'stock_unlimited', 'description', 'barcode'] as const;

const HEADER = (what: string) =>
  `// AUTO-GENERADO por scripts/sync-jumpseller.ts. NO EDITAR A MANO.\n// ${what}\n// Fuente: API de Jumpseller (productos disponibles). Regenerar: npm run sync:catalog -- --write\n`;

export function snapshotHash(products: SnapshotProduct[]): string {
  return createHash('sha256').update(JSON.stringify(products)).digest('hex').slice(0, 12);
}

export function categoryCounts(products: SnapshotProduct[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of products) for (const slug of p.categories) counts[slug] = (counts[slug] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export interface PriceIndexEntry {
  name: string;
  sku: string;
  price: number;
  variants: Record<string, { sku: string; price: number }>;
}

export function buildPriceIndex(products: SnapshotProduct[]): Record<string, PriceIndexEntry> {
  const index: Record<string, PriceIndexEntry> = {};
  for (const p of products) {
    index[String(p.jumpseller_id)] = {
      name: p.name,
      sku: p.sku,
      price: p.price,
      variants: Object.fromEntries(p.variants.map(v => [String(v.id), { sku: v.sku, price: v.price }])),
    };
  }
  return index;
}

export function renderSnapshotFile(products: SnapshotProduct[], hash: string): string {
  return `${HEADER('Snapshot del catálogo: precios, nombres, fotos, categorías y variantes.')}
import type { SnapshotProduct } from './jumpseller.types';

export const SNAPSHOT_HASH = '${hash}';

export const jumpsellerSnapshot: SnapshotProduct[] = ${JSON.stringify(products, null, 2)};
`;
}

export function renderCategoriesFile(products: SnapshotProduct[], hash: string): string {
  return `${HEADER('Cantidad de productos publicados por categoría del sitio.')}
export const SNAPSHOT_HASH = '${hash}';

/** Productos publicados (un producto en 2 categorías cuenta una vez). */
export const PUBLISHED_PRODUCT_COUNT = ${products.length};

export const CATEGORY_PRODUCT_COUNTS: Readonly<Record<string, number>> = ${JSON.stringify(categoryCounts(products), null, 2)};
`;
}

export function renderPriceIndexFile(products: SnapshotProduct[], hash: string): string {
  return `${HEADER('Índice de precios CON IVA para recalcular en el servidor (api/). Sin dependencias de src/.')}
export interface PriceIndexEntry {
  name: string;
  sku: string;
  price: number;
  variants: Record<string, { sku: string; price: number }>;
}

export const SNAPSHOT_HASH = '${hash}';

export const priceIndex: Readonly<Record<string, PriceIndexEntry>> = ${JSON.stringify(buildPriceIndex(products), null, 2)};
`;
}

/** Devuelve las claves prohibidas que aparecen en algún archivo generado. */
export function findForbiddenKeys(files: string[]): string[] {
  const found = new Set<string>();
  for (const content of files) {
    for (const key of FORBIDDEN_KEYS) if (content.includes(`"${key}"`)) found.add(key);
  }
  return [...found];
}

/** Escribe todos los archivos o ninguno: primero los temporales, después los rename. */
export function writeFilesAtomically(root: string, files: Record<string, string>): void {
  const temps: [string, string][] = [];
  try {
    for (const [rel, content] of Object.entries(files)) {
      const target = `${root}/${rel}`;
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${process.pid}`;
      writeFileSync(tmp, content, 'utf8');
      temps.push([tmp, target]);
    }
    for (const [tmp, target] of temps) renameSync(tmp, target);
  } catch (err) {
    for (const [tmp] of temps) rmSync(tmp, { force: true });
    throw err;
  }
}
