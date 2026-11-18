// scripts/product-links.test.ts
// api/_lib/catalog/product-links.generated.ts (aviso de despacho) resuelve igual que el sitio
// (src/data/catalog/index.ts): el id vigente (renamed-ids.ts gana), el nombre de la ficha y la
// etiqueta de cada variante (src/lib/variants.ts). Si falla después de editar renamed-ids.ts u
// overrides.ts: `npm run product-links:write` (sin credenciales) y commit del generado.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { products } from '../src/data/catalog/index';
import { jumpsellerSnapshot, SNAPSHOT_HASH } from '../src/data/catalog/jumpseller-snapshot.generated';
import { SITE_IDS } from '../src/data/catalog/site-ids.generated';
import { RENAMED_SITE_IDS } from '../src/data/catalog/renamed-ids';
import { variantLabel } from '../src/lib/variants';
import { productLinks } from '../api/_lib/catalog/product-links.generated';
import { priceIndex } from '../api/_lib/catalog/price-index.generated';
import { buildProductLinks, renderProductLinksFile } from './jumpseller/product-links';
import { findForbiddenKeys, OUTPUT_PATHS } from './jumpseller/write';

const root = join(__dirname, '..');
const file = readFileSync(join(root, OUTPUT_PATHS.productLinks), 'utf8');

describe('product-links.generated.ts', () => {
  it('está al día con el snapshot y los ids (si no: npm run product-links:write)', () => {
    expect(file).toBe(renderProductLinksFile(buildProductLinks(jumpsellerSnapshot, SITE_IDS), SNAPSHOT_HASH));
  });

  it('trae los mismos productos que el sitio y que priceIndex (solo publicados)', () => {
    const ids = Object.keys(productLinks).sort();
    expect(ids).toEqual(products.map((p) => String(p.jumpseller_id)).sort());
    expect(ids).toEqual(Object.keys(priceIndex).sort());
  });

  it('el id y el nombre son los de la ficha del sitio', () => {
    for (const p of products) {
      const link = productLinks[String(p.jumpseller_id)];
      expect(link.id, String(p.jumpseller_id)).toBe(p.id);
      expect(link.name, String(p.jumpseller_id)).toBe(p.name);
    }
  });

  it('un id renombrado a mano gana, y nunca aparece un id anterior', () => {
    const previous = new Set(Object.values(RENAMED_SITE_IDS).flatMap((r) => r.previous));
    for (const [jid, r] of Object.entries(RENAMED_SITE_IDS)) {
      const link = productLinks[jid];
      if (link) expect(link.id, jid).toBe(r.id);
    }
    expect(Object.values(productLinks).filter((l) => previous.has(l.id))).toEqual([]);
  });

  it('la etiqueta de cada variante es la del sitio, con su SKU', () => {
    for (const p of products) {
      const link = productLinks[String(p.jumpseller_id)];
      const snapshot = jumpsellerSnapshot.find((s) => s.jumpseller_id === p.jumpseller_id)!;
      expect(Object.keys(link.variants).sort(), String(p.jumpseller_id)).toEqual(snapshot.variants.map((v) => String(v.id)).sort());
      for (const v of snapshot.variants) {
        const expected = snapshot.variants.length > 1 ? variantLabel(p, v) : '';
        expect(link.variants[String(v.id)], `${p.jumpseller_id}/${v.id}`).toEqual({ sku: v.sku, label: expected });
      }
    }
  });

  it('sin precios ni campos prohibidos', () => {
    expect(file).not.toMatch(/"price"\s*:/);
    expect(findForbiddenKeys([file])).toEqual([]);
  });
});
