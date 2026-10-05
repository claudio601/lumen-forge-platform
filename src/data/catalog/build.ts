// src/data/catalog/build.ts
// Arma el catálogo del sitio uniendo:
//   - la base: datos que controla Jumpseller (hoy: el catálogo legado; en el PR 7,
//     el snapshot sincronizado), y
//   - el contenido editorial (fichas, FAQ, SEO, variantes CCT…), asociado por
//     jumpseller_id y mantenido a mano en ./overlay.
// Solo imports relativos: lo usan también scripts/ (tsx y vitest).

import type { Product } from './types';
import type { SnapshotProduct } from './jumpseller.types';

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

// ── Base desde el snapshot de Jumpseller ───────────────────────────────────


/**
 * Valores del catálogo legado que Jumpseller no tiene y que se conservan:
 * SKU (187 productos sin SKU en Jumpseller), marca (Jumpseller null) y lúmenes
 * (solo BESTLED). Generado por scripts/migrate/extract-overrides.ts.
 */
export interface BaseOverrides {
  sku?: string;
  brand?: string;
  lumens?: number;
}

/** Potencia desde el nombre: "PROYECTOR LED 200W", "CINTA 14,4W/m" → 14.4. */
export function parseWatts(name: string): number {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*W\b/i);
  return m ? Number(m[1].replace(',', '.')) : 0;
}

/** Temperatura de color desde el nombre: "... 4000K" → 4000. */
export function parseKelvin(name: string): number {
  const m = name.match(/(\d{4})\s*K\b/);
  return m ? Number(m[1]) : 0;
}

/** Grado de protección desde el nombre: "... IP66 IK08" → "IP66". */
export function parseIp(name: string): string | undefined {
  const m = name.match(/\bIP\s?(\d{2})\b/i);
  return m ? `IP${m[1]}` : undefined;
}

/**
 * Texto → id del sitio: sin %XX, sin tildes, en minúsculas y solo [a-z0-9] separados por '-'.
 * "alumbrado-p%C3%BAblico-led-14.4w/control-remoto" → "alumbrado-publico-led-14-4w-control-remoto".
 * Un id con '%', '.' o ',' fallaría: React Router decodifica :id y no lo encontraría.
 */
export function slugifySiteId(text: string): string {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // '%' suelto: se deja como está (luego pasa a '-')
  }
  return decoded
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Id de sitio para un producto nuevo: desde el permalink, sin repetir ids existentes.
 * `taken` incluye los ids retirados (renamed-ids.ts): su 301 taparía la página nueva.
 */
export function newSiteId(permalink: string, jumpsellerId: number, taken: ReadonlySet<string>): string {
  const id = slugifySiteId(permalink) || `producto-${jumpsellerId}`;
  return taken.has(id) ? `${id}-${jumpsellerId}` : id;
}

/** SKU → productos que lo usan (SKU propio o de alguna de sus variantes). */
/**
 * SKU que muestra el sitio: el de Jumpseller; si no tiene, el del catálogo legado; si
 * tampoco, el de su única variante (cuando ningún otro producto lo usa).
 */
export function siteSku(s: SnapshotProduct, ov: BaseOverrides, owners: Map<string, Set<number>>): string {
  const single = s.variants.length === 1 ? s.variants[0] : undefined;
  const variantSku = single?.sku && owners.get(single.sku)?.size === 1 ? single.sku : '';
  return s.sku || ov.sku || variantSku;
}

export function skuOwners(snapshot: readonly SnapshotProduct[]): Map<string, Set<number>> {
  const owners = new Map<string, Set<number>>();
  const add = (sku: string, id: number) => {
    if (!sku) return;
    const set = owners.get(sku) ?? new Set<number>();
    set.add(id);
    owners.set(sku, set);
  };
  for (const s of snapshot) {
    add(s.sku, s.jumpseller_id);
    for (const v of s.variants) add(v.sku, s.jumpseller_id);
  }
  return owners;
}

/**
 * Arma la base del catálogo desde el snapshot de Jumpseller.
 * - id: el registrado para el producto (legado, asignado por la sincronización la
 *   primera vez que se publicó, o renombrado a mano con su 301 en renamed-ids.ts): las
 *   URLs /producto/:id no cambian solas.
 * - SKU: el de Jumpseller; si no tiene, el legado; si no, el de su única variante,
 *   pero solo si ningún otro producto usa ese SKU (en Jumpseller hay SKUs repetidos).
 * - orden: el del catálogo legado ("Relevancia"); los productos nuevos van al final.
 * alsoReserved: ids que ya no están en siteIds pero nunca se reutilizan (los retirados).
 */
export function baseFromSnapshot(
  snapshot: readonly SnapshotProduct[],
  overrides: Readonly<Record<number, BaseOverrides>>,
  siteIds: Readonly<Record<number, string>>,
  legacyOrder: readonly number[],
  alsoReserved: ReadonlySet<string> = new Set(),
): BaseProduct[] {
  const rank = new Map(legacyOrder.map((id, i) => [id, i]));
  const ordered = [...snapshot].sort(
    (a, b) => (rank.get(a.jumpseller_id) ?? Infinity) - (rank.get(b.jumpseller_id) ?? Infinity) || a.jumpseller_id - b.jumpseller_id,
  );
  const reserved = new Set([...Object.values(siteIds), ...alsoReserved]);
  const used = new Set<string>();
  const owners = skuOwners(snapshot);

  return ordered.map(s => {
    const ov = overrides[s.jumpseller_id] ?? {};
    // Sin id registrado solo si aún no se sincronizó (la sincronización lo registra).
    const id = siteIds[s.jumpseller_id] ?? newSiteId(s.permalink, s.jumpseller_id, new Set([...reserved, ...used]));
    used.add(id);
    const ip = parseIp(s.name);
    const singleVariant = s.variants.length === 1 ? s.variants[0] : undefined;
    return {
      id,
      sku: siteSku(s, ov, owners),
      name: s.name,
      permalink: s.permalink,
      price: s.price,
      category: s.categories[0],
      categories: [...s.categories],
      watts: parseWatts(s.name),
      kelvin: parseKelvin(s.name),
      lumens: ov.lumens ?? 0,
      ...(ip ? { ip } : {}),
      image: s.images[0]?.url ?? '',
      images: s.images.map(i => i.url),
      imageRefs: s.images.map(({ id: imageId, url }) => ({ id: imageId, url })),
      featured: s.featured,
      brand: s.brand ?? ov.brand ?? '',
      jumpseller_id: s.jumpseller_id,
      ...(singleVariant ? { jumpseller_variant_id: singleVariant.id } : {}),
    };
  });
}

/**
 * Precio y SKU de las variantes CCT (contenido editorial) salen de Jumpseller:
 * se actualizan por jumpseller_variant_id. Nunca se modifica el overlay original.
 */
export function refreshCctVariants(
  products: Product[],
  variants: ReadonlyMap<number, { price: number; sku: string }>,
): Product[] {
  return products.map(p => {
    if (!p.cctVariants) return p;
    return {
      ...p,
      cctVariants: p.cctVariants.map(v => {
        const live = v.jumpseller_variant_id ? variants.get(v.jumpseller_variant_id) : undefined;
        return live ? { ...v, price: live.price, sku: live.sku || v.sku } : v;
      }),
    };
  });
}
