// src/data/merchant/google-categories.ts
// google_product_category del feed de Merchant (CLAUDE.md §18; especificación del feed, §2.1).
// IDs de la taxonomía oficial de Google, versión 2021-09-21
// (https://www.google.com/basepages/producttype/taxonomy-with-ids.es-ES.txt), revisados uno por
// uno contra ese archivo el 19-11-2026: GOOGLE_CATEGORY_PATHS copia la ruta en español de cada ID.
// Es opcional (Google asigna una categoría sola); la tabla evita que clasifique mal un poste, una
// fuente de poder o un sensor. Para corregir un producto: una fila en PRODUCT_GOOGLE_CATEGORY.
// Sin imports de datos: lo usan scripts/merchant-feed.ts y sus pruebas.

export const GOOGLE_TAXONOMY_VERSION = '2021-09-21';

/** Cada ID que usa el feed, con su ruta en la taxonomía oficial (es-ES). Solo IDs revisados. */
export const GOOGLE_CATEGORY_PATHS: Readonly<Record<number, string>> = {
  1436: 'Casa y jardín > Iluminación > Alumbrado de emergencia',
  1546: 'Casa y jardín > Iluminación > Focos y reflectores',
  2161: 'Casa y jardín > Seguridad empresarial y del hogar > Sensores de movimiento',
  2524: 'Casa y jardín > Iluminación > Lámparas Fijas > Apliques de techo',
  2608: 'Casa y jardín > Iluminación > Mangueras y guirnaldas de luces',
  2956: 'Casa y jardín > Accesorios de iluminación',
  3006: 'Casa y jardín > Iluminación > Lámparas Fijas',
  3329: 'Casa y jardín > Iluminación > Bombillas > Bombillas con diodos led',
  4932: 'Casa y jardín > Iluminación > Iluminación en rieles > Dispositivos de iluminación en rieles',
  6272: 'Casa y jardín > Iluminación > Iluminación en rieles > Accesorios de iluminación en rieles',
  6273: 'Casa y jardín > Iluminación > Iluminación en rieles > Rieles para iluminación',
  7447: 'Casa y jardín > Accesorios de iluminación > Soportes para farolas',
  505318: 'Bricolaje > Suministros eléctricos > Reguladores y transformadores de voltaje',
};

/** Rieles, focos y accesorios de focos-a-riel (por el nombre de Jumpseller). */
export const TRACK_RAIL = 6273;
export const TRACK_FIXTURE = 4932;
export const TRACK_ACCESSORY = 6272;
/** Brazos y postes de la categoría poste. */
export const POLE_ARM = 7447;
export const POLE = 2956;

/**
 * Categoría principal del sitio (categories.config.ts) → ID. focos-a-riel y poste se deciden por
 * producto (googleCategoryFor); aquí, su valor por defecto.
 */
export const CATEGORY_GOOGLE_ID: Readonly<Record<string, number>> = {
  'proyectores-led': 1546,
  'paneles-led': 2524,
  'campanas-led': 2524,
  'lineales-led': 2524,
  'iluminacion-exterior': 3006,
  'alumbrado-publico': 3006,
  solar: 3006,
  'iluminacion-antiexplosiva': 3006,
  'ampolletas-led': 3329,
  'tubos-led': 3329,
  'cinta-led': 2608,
  'emergencia-led': 1436,
  'focos-a-riel': TRACK_FIXTURE,
  'fuentes-de-poder': 505318,
  poste: POLE,
  sensores: 2161,
};

/** Correcciones a mano, por jumpseller_id (ganan sobre todo lo demás). Vacía por ahora. */
export const PRODUCT_GOOGLE_CATEGORY: Readonly<Record<number, number>> = {};

/**
 * ID de la taxonomía de un producto: la corrección a mano; si no, en focos-a-riel el riel, el foco
 * o el accesorio según el nombre, y en poste el brazo o el poste; si no, el de su categoría.
 * undefined si la categoría no tiene ID (scripts/merchant-feed.test.ts exige que todas tengan).
 */
export function googleCategoryFor(product: { jumpseller_id: number; category: string; name: string }): number | undefined {
  const manual = PRODUCT_GOOGLE_CATEGORY[product.jumpseller_id];
  if (manual !== undefined) return manual;
  if (product.category === 'focos-a-riel') {
    if (/^\s*riel\b/i.test(product.name)) return TRACK_RAIL;
    return /\bfoco\b/i.test(product.name) ? TRACK_FIXTURE : TRACK_ACCESSORY;
  }
  if (product.category === 'poste') return /\bbrazo\b/i.test(product.name) ? POLE_ARM : POLE;
  return CATEGORY_GOOGLE_ID[product.category];
}
