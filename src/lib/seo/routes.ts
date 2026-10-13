// src/lib/seo/routes.ts
// Qué rutas se indexan. Es la única lista: de STATIC_ROUTES salen el sitemap, el prerender
// (desde la PR 04), check-prerender, la prueba de hidratación, el chequeo de humo, los
// destinos `path` de las URLs de elights.cl y los primeros segmentos reservados
// (scripts/redirects/build.ts). scripts/site-routes.test.ts verifica que cada ruta de
// src/routes.tsx esté clasificada aquí.

import { products } from '../../data/catalog/index';
import { categories } from '../../data/catalog/categories.config';

/** Páginas fijas que van a Google. */
export const STATIC_ROUTES = [
  '/',
  '/catalogo',
  '/instalacion',
  '/estudio-luminico',
  '/instaladores',
  '/cotizador',
  // Páginas legales y de compra (PR 12, LEGAL_PAGES en src/config/legal.ts)
  '/empresa',
  '/terminos-y-condiciones',
  '/cambios-devoluciones-y-garantia',
  '/despacho',
  '/medios-de-pago',
  '/politica-de-privacidad',
] as const;

/** Páginas que dependen de la sesión o de una búsqueda: noindex, sin sitemap. */
export const NOINDEX_ROUTES = ['/buscar', '/cotizacion', '/solicitar-pedido'] as const;

/** Rutas que solo redirigen a otra. */
export const REDIRECT_ROUTES = ['/carro'] as const;

/** Patrones de App.tsx con páginas generadas desde el catálogo. */
export const DYNAMIC_ROUTE_PATTERNS = ['/catalogo/:categorySlug', '/producto/:id'] as const;

export const categoryPath = (slug: string) => `/catalogo/${encodeURIComponent(slug)}`;
export const productPath = (id: string) => `/producto/${id}`;

/** Todas las URLs indexables: fijas, categorías y productos (sin parámetros). */
export function indexableRoutes(): string[] {
  return [...STATIC_ROUTES, ...categories.map(c => categoryPath(c.slug)), ...products.map(p => productPath(p.id))];
}
