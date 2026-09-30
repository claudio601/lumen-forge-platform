// scripts/jumpseller/normalize.ts
// Convierte productos/categorías crudos de Jumpseller en el snapshot del sitio.
// Lista blanca estricta: solo se copian los campos de SnapshotProduct. Campos como
// cost_per_item (costo), stock o description jamás llegan al snapshot.

import type { SnapshotImage, SnapshotProduct, SnapshotVariant } from '../../src/data/catalog/jumpseller.types';
import type { RawCategory, RawProduct } from './schema';

export type ExclusionReason = 'no-disponible' | 'lista-de-exclusion' | 'producto-de-prueba' | 'sin-categoria';

export interface Exclusion {
  jumpseller_id: number;
  name: string;
  reason: ExclusionReason;
}

export interface NormalizeConfig {
  /** id de categoría principal de Jumpseller → slug del sitio. */
  topCategoryToSlug: Readonly<Record<number, string>>;
  /** Categorías principales ignoradas a propósito (p. ej. "Ofertas Flash"). */
  ignoredTopCategoryIds: readonly number[];
  /** Productos que nunca se publican (p. ej. PRODUCTO TEST CHECKOUT). */
  denylist: readonly number[];
}

export interface NormalizeResult {
  products: SnapshotProduct[];
  excluded: Exclusion[];
  /** Categorías principales de Jumpseller que no están en el mapa ni ignoradas. */
  unmappedTopCategories: { id: number; name: string; productIds: number[] }[];
}

const TEST_NAME = /PRODUCTO\s+TEST/i;

/** Quita espacios de ancho cero y BOM (vistos en SKUs de Jumpseller) y recorta. */
export function cleanSku(sku: string | null | undefined): string {
  return (sku ?? '').replace(/[\u200B\uFEFF]/g, '').trim();
}

const byPositionThenId = <T extends { id: number; position?: number | null }>(a: T, b: T) =>
  (a.position ?? 0) - (b.position ?? 0) || a.id - b.id;

export function normalizeCatalog(
  rawProducts: RawProduct[],
  rawCategories: RawCategory[],
  config: NormalizeConfig,
): NormalizeResult {
  const parentOf = new Map<number, number | null>();
  const nameOf = new Map<number, string>();
  for (const c of rawCategories) {
    parentOf.set(c.id, c.parent_id ?? null);
    nameOf.set(c.id, c.name);
  }

  /** Sube por parent_id hasta la categoría principal (resguardo contra ciclos). */
  function topOf(categoryId: number, fallbackParent?: number | null): number {
    let id = categoryId;
    let parent = parentOf.has(id) ? parentOf.get(id)! : (fallbackParent ?? null);
    for (let depth = 0; parent !== null && depth < 20; depth++) {
      id = parent;
      parent = parentOf.get(id) ?? null;
    }
    return id;
  }

  const denied = new Set(config.denylist);
  const ignored = new Set(config.ignoredTopCategoryIds);
  const products: SnapshotProduct[] = [];
  const excluded: Exclusion[] = [];
  const unmapped = new Map<number, { id: number; name: string; productIds: number[] }>();

  for (const p of rawProducts) {
    const name = p.name.trim();
    if (p.status !== 'available') { excluded.push({ jumpseller_id: p.id, name, reason: 'no-disponible' }); continue; }
    if (denied.has(p.id)) { excluded.push({ jumpseller_id: p.id, name, reason: 'lista-de-exclusion' }); continue; }
    if (TEST_NAME.test(name)) { excluded.push({ jumpseller_id: p.id, name, reason: 'producto-de-prueba' }); continue; }

    const slugs: string[] = [];
    for (const c of p.categories ?? []) {
      const top = topOf(c.id, c.parent_id);
      if (ignored.has(top)) continue;
      const slug = config.topCategoryToSlug[top];
      if (slug) {
        if (!slugs.includes(slug)) slugs.push(slug);
      } else {
        const entry = unmapped.get(top) ?? { id: top, name: nameOf.get(top) ?? '(desconocida)', productIds: [] };
        entry.productIds.push(p.id);
        unmapped.set(top, entry);
      }
    }
    if (slugs.length === 0) { excluded.push({ jumpseller_id: p.id, name, reason: 'sin-categoria' }); continue; }

    const images: SnapshotImage[] = [...(p.images ?? [])]
      .sort(byPositionThenId)
      .map(i => ({ id: i.id, url: i.url, position: i.position ?? 0 }));

    const variants: SnapshotVariant[] = [...(p.variants ?? [])]
      .sort(byPositionThenId)
      .map(v => ({
        id: v.id,
        sku: cleanSku(v.sku),
        price: Number(v.price),
        options: (v.options ?? []).map(o => ({ name: (o.name ?? '').trim(), value: (o.value ?? '').trim() })),
      }));

    products.push({
      jumpseller_id: p.id,
      name,
      permalink: p.permalink.trim(),
      sku: cleanSku(p.sku),
      price: Number(p.price),
      brand: p.brand?.trim() || null,
      featured: p.featured === true,
      categories: slugs,
      images,
      variants,
    });
  }

  products.sort((a, b) => a.jumpseller_id - b.jumpseller_id);
  excluded.sort((a, b) => a.jumpseller_id - b.jumpseller_id);
  return {
    products,
    excluded,
    unmappedTopCategories: [...unmapped.values()].sort((a, b) => a.id - b.id),
  };
}
