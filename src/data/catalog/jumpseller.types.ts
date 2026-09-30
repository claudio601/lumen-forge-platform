// src/data/catalog/jumpseller.types.ts
// Forma del snapshot que genera scripts/sync-jumpseller.ts a partir de la API de
// Jumpseller. Solo datos que Jumpseller controla (precio, nombre, fotos, categorías,
// variantes); el contenido editorial vive aparte, asociado por jumpseller_id.
// Sin datos ni imports con alias: lo usan también scripts/ y api/.

export interface SnapshotImage {
  id: number;
  url: string;
  position: number;
}

export interface SnapshotVariantOption {
  name: string;
  value: string;
}

export interface SnapshotVariant {
  id: number;
  /** '' cuando Jumpseller no tiene SKU para la variante. */
  sku: string;
  /** Precio CON IVA en CLP. */
  price: number;
  options: SnapshotVariantOption[];
}

export interface SnapshotProduct {
  jumpseller_id: number;
  name: string;
  permalink: string;
  /** '' cuando Jumpseller no tiene SKU para el producto. */
  sku: string;
  /** Precio CON IVA en CLP (el de la variante más barata cuando hay variantes). */
  price: number;
  brand: string | null;
  featured: boolean;
  /** Slugs de categoría del sitio (categorías principales de Jumpseller), sin repetir. */
  categories: string[];
  images: SnapshotImage[];
  variants: SnapshotVariant[];
}
