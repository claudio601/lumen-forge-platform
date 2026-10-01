// src/lib/seo/routes.ts
// Qué rutas se indexan. Es la única lista: la usan el sitemap y, desde la PR 04, el
// prerender. scripts/site-routes.test.ts verifica que cada <Route> de App.tsx esté
// clasificada aquí.

import { products } from '../../data/catalog/index';
import { categories } from '../../data/catalog/categories.config';

/** Páginas fijas que van a Google. */
export const STATIC_ROUTES = ['/', '/catalogo', '/instalacion', '/estudio-luminico', '/instaladores', '/cotizador'] as const;

/** Páginas que dependen de la sesión o de una búsqueda: noindex, sin sitemap. */
export const NOINDEX_ROUTES = ['/buscar', '/cotizacion', '/solicitar-pedido'] as const;

/** Rutas que solo redirigen a otra. */
export const REDIRECT_ROUTES = ['/carro'] as const;

/** Patrones de App.tsx con páginas generadas desde el catálogo. */
export const DYNAMIC_ROUTE_PATTERNS = ['/catalogo/:categorySlug', '/catalogo/:categorySlug/:subSlug', '/producto/:id'] as const;

export const categoryPath = (slug: string) => `/catalogo/${encodeURIComponent(slug)}`;
export const productPath = (id: string) => `/producto/${id}`;

/** Todas las URLs indexables: fijas, categorías y productos (sin parámetros). */
export function indexableRoutes(): string[] {
  return [...STATIC_ROUTES, ...categories.map(c => categoryPath(c.slug)), ...products.map(p => productPath(p.id))];
}
