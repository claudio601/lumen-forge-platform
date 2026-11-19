// scripts/jumpseller/product-links.ts
// Escribe api/_lib/catalog/product-links.generated.ts: por jumpseller_id, el id vigente del sitio
// (/producto/<id>), el nombre que muestra la ficha y la etiqueta de cada variante con su SKU
// («Fría 6500K», la misma de src/lib/variants.ts). Lo usa el aviso de despacho
// (api/_lib/shipping/products.ts): api/ no puede importar src/ (api/_lib/apiImports.test.ts).
//
// Dos caminos, el mismo resultado:
// - la sincronización (scripts/sync-jumpseller.ts) lo arma con el snapshot NUEVO, en el mismo
//   paso que los demás generados (OUTPUT_PATHS);
// - `npm run product-links:write`, sin credenciales: lo arma con el snapshot generado y los ids
//   de src/data/catalog. Hace falta después de editar a mano renamed-ids.ts u overrides.ts, sin
//   esperar a la sincronización (scripts/product-links.test.ts falla si quedó desfasado).
// Los ids se resuelven como src/data/catalog/index.ts: renombrado > sincronización > legado.
// Solo productos publicados (los del snapshot, igual que priceIndex). Sin precios.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import type { Product } from '../../src/data/catalog/types';
import { baseFromSnapshot, buildCatalog, refreshCctVariants } from '../../src/data/catalog/build';
import { LEGACY_ORDER, LEGACY_SITE_IDS } from '../../src/data/catalog/legacy-ids';
import { RENAMED_SITE_IDS, RETIRED_SITE_IDS } from '../../src/data/catalog/renamed-ids';
import { baseOverrides } from '../../src/data/catalog/overlay/overrides';
import { editorialOverlay } from '../../src/data/catalog/overlay/editorial';
import { variantLabel } from '../../src/lib/variants';
import { findForbiddenKeys, OUTPUT_PATHS, snapshotHash, writeFilesAtomically } from './write';

export interface ProductLinkEntry {
  /** Id vigente del sitio: /producto/<id>. */
  id: string;
  /** Nombre que muestra la ficha. */
  name: string;
  /** Por id de variante: su SKU ('' si no tiene) y su etiqueta ('' con una sola variante). */
  variants: Record<string, { sku: string; label: string }>;
}

/** Catálogo del sitio desde un snapshot, como src/data/catalog/index.ts. */
export function catalogFromSnapshot(
  snapshot: readonly SnapshotProduct[],
  generatedSiteIds: Readonly<Record<number, string>>,
): Product[] {
  const variantIndex = new Map(snapshot.flatMap((p) => p.variants.map((v) => [v.id, { price: v.price, sku: v.sku }] as const)));
  const renamedIds = Object.fromEntries(Object.entries(RENAMED_SITE_IDS).map(([jid, r]) => [jid, r.id]));
  const siteIds: Readonly<Record<number, string>> = { ...LEGACY_SITE_IDS, ...generatedSiteIds, ...renamedIds };
  return refreshCctVariants(
    buildCatalog(baseFromSnapshot(snapshot, baseOverrides, siteIds, LEGACY_ORDER, RETIRED_SITE_IDS), editorialOverlay),
    variantIndex,
  );
}

export function buildProductLinks(
  snapshot: readonly SnapshotProduct[],
  generatedSiteIds: Readonly<Record<number, string>>,
): Record<string, ProductLinkEntry> {
  const byId = new Map(snapshot.map((p) => [p.jumpseller_id, p]));
  const links: Record<string, ProductLinkEntry> = {};
  const products = catalogFromSnapshot(snapshot, generatedSiteIds).sort((a, b) => a.jumpseller_id - b.jumpseller_id);
  for (const product of products) {
    const variants = byId.get(product.jumpseller_id)?.variants ?? [];
    links[String(product.jumpseller_id)] = {
      id: product.id,
      name: product.name,
      variants: Object.fromEntries(
        [...variants].sort((a, b) => a.id - b.id).map((v) => [String(v.id), { sku: v.sku, label: variants.length > 1 ? variantLabel(product, v) : '' }]),
      ),
    };
  }
  return links;
}

export function renderProductLinksFile(links: Record<string, ProductLinkEntry>, hash: string): string {
  const ids = Object.keys(links).map(Number).sort((a, b) => a - b);
  const body = ids.map((id) => `  "${id}": ${JSON.stringify(links[id])},`).join('\n');
  return `// AUTO-GENERADO por scripts/jumpseller/product-links.ts. NO EDITAR A MANO.
// Por producto publicado: id vigente del sitio (/producto/<id>), nombre de la ficha y etiqueta de
// cada variante con su SKU, para el aviso de despacho (api/_lib/shipping/products.ts). Sin dependencias de src/.
// Fuente: snapshot de Jumpseller y src/data/catalog (renamed-ids.ts, site-ids.generated.ts, legacy-ids.ts).
// Regenerar: npm run product-links:write (también lo escribe npm run sync:catalog -- --write)

export interface ProductLinkEntry {
  /** Id vigente del sitio: /producto/<id>. */
  id: string;
  /** Nombre que muestra la ficha. */
  name: string;
  /** Por id de variante: su SKU ('' si no tiene) y su etiqueta ('' con una sola variante). */
  variants: Record<string, { sku: string; label: string }>;
}

export const SNAPSHOT_HASH = '${hash}';

export const productLinks: Readonly<Record<string, ProductLinkEntry>> = {
${body}
};
`;
}

/** `npm run product-links:write`: arma el archivo con el snapshot y los ids generados (sin credenciales). */
export async function writeProductLinks(root: string, log: (m: string) => void = console.log): Promise<number> {
  const snapshotMod = (await import(pathToFileURL(resolve(root, OUTPUT_PATHS.snapshot)).href)) as { jumpsellerSnapshot: SnapshotProduct[] };
  const siteIdsMod = (await import(pathToFileURL(resolve(root, OUTPUT_PATHS.siteIds)).href)) as { SITE_IDS: Record<number, string> };
  const snapshot = snapshotMod.jumpsellerSnapshot;
  const content = renderProductLinksFile(buildProductLinks(snapshot, siteIdsMod.SITE_IDS), snapshotHash(snapshot));
  const forbidden = findForbiddenKeys([content]);
  if (forbidden.length) {
    log(`Abortado: campos prohibidos en la salida: ${forbidden.join(', ')}`);
    return 1;
  }
  writeFilesAtomically(root, { [OUTPUT_PATHS.productLinks]: content });
  log(`${OUTPUT_PATHS.productLinks}: ${snapshot.length} productos.`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  writeProductLinks(process.cwd()).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.log(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
