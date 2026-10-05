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

/**
 * Primera foto de un producto, revisada en la sincronización (scripts/jumpseller/og-images.ts)
 * para decidir si sirve como imagen para compartir (src/lib/seo/ogImage.ts).
 */
export interface ProductImageFacts {
  /** URL de la primera foto tal como viene en el snapshot (sin codificar). */
  url: string;
  /** Formato según los primeros bytes del archivo (no según Content-Type ni la extensión). */
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'other';
  /** Peso del archivo original en bytes. */
  bytes: number;
  /** Medidas en píxeles, cuando se pudieron leer del comienzo del archivo. */
  width?: number;
  height?: number;
}

/** Fila de especificación técnica: etiqueta y valor en texto plano (los saltos de línea van como \n). */
export interface SpecRow {
  label: string;
  value: string;
}

/**
 * Descripción de un producto en Jumpseller, limpia y ordenada en la sincronización
 * (scripts/jumpseller/descriptions.ts): el texto y la tabla de especificaciones, esta
 * última en los mismos grupos de las fichas BESTLED.
 */
export interface ProductDescription {
  /** Texto descriptivo (HTML limpio), sin las tablas. */
  text?: string;
  /** Eléctrico y fotométrico. */
  electricos?: SpecRow[];
  /** Construcción y operación. */
  construccion?: SpecRow[];
  /** Componentes y control. */
  componentes?: SpecRow[];
  /** Usos declarados en la fila "Aplicación". */
  applications?: string[];
  /** Tablas que no son "etiqueta | valor" (p. ej. la comparativa de una familia), en HTML limpio. */
  tables?: string;
}
