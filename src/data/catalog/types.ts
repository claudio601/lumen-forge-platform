// src/data/catalog/types.ts
// Tipos del catálogo. Sin datos: se puede importar desde cualquier parte (incluido
// el bundle principal y scripts/) sin arrastrar el arreglo de productos.

export interface Product {
  id: string;
  sku: string;
  name: string;
  permalink: string;
  price: number;
  /** Categoría principal (breadcrumb, productos relacionados). */
  category: string;
  /** Todas las categorías del sitio a las que pertenece (filtros del catálogo). */
  categories: string[];
  watts: number;
  kelvin: number;
  lumens: number;
  ip?: string;
  image: string;
  images: string[];
  /** Fotos con su id de Jumpseller (para pedir tamaños reducidos al CDN). */
  imageRefs?: { id: number; url: string }[];
  featured: boolean;
  brand: string;
  jumpseller_id: number;
  jumpseller_variant_id?: number;
  cri?: number;
  voltage?: string;
  beamAngle?: number;
  lifetime?: number;
  warranty?: string;
  installationType?: string;
  tags?: string[];
  applications?: string[];

  // SEO content (optional, populated per-product over time)
  metaTitle?: string;
  metaDescription?: string;
  description?: string;
  shortDescription?: string;
  faq?: Array<{
    question: string;
    answer: string;
  }>;
  keyBenefits?: string[];
  technicalDetails?: string;
  certifications?: Array<{
    name: string;
    description: string;
    issuer?: string;
  }>;
  installationInfo?: string;
  useCases?: string[];

  // URL pública absoluta del PDF de ficha técnica. Debe ser servible desde
  // otros dominios (Jumpseller legacy enlaza al mismo archivo).
  datasheetUrl?: string;

  // Variantes CCT disponibles para selección al momento de cotizar/pedir
  availableCCT?: number[];

  // Specs agrupadas por categoría (cada array es una sub-tabla en el PDP)
  specsElectricos?: Array<{ label: string; value: string }>;
  specsConstruccion?: Array<{ label: string; value: string }>;
  specsComponentes?: Array<{ label: string; value: string }>;

  // Variantes CCT con visualización de color (preview block en el PDP)
  cctVariants?: Array<{
    kelvin: number;
    name: string;
    sku: string;
    colorHex: string;
    // Precio CON IVA de la variante. Si está ausente, se usa product.price como fallback.
    price?: number;
    // ID de variante en Jumpseller para esta CCT. Identifica la variante exacta en
    // solicitudes/cotizaciones (link de pago); si falta, cae a product.jumpseller_id.
    jumpseller_variant_id?: number;
  }>;

  // Familia de potencias para cross-sell (tabla con highlight del actual)
  productFamily?: {
    title: string;
    items: Array<{
      watts: number;
      lumens: number;
      eficacia: string;
      sku: string;
      productId?: string;
    }>;
  };
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  productCount: number;
  subcategories: { slug: string; name: string }[];
}
