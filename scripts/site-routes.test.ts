// La lista de rutas indexables (src/lib/seo/routes.ts) es la única fuente del
// sitemap y, desde la PR 04, del prerender: cada <Route> de App.tsx tiene que estar
// clasificada ahí, para que ninguna página nueva quede fuera de Google sin querer.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_ROUTE_PATTERNS,
  indexableRoutes,
  NOINDEX_ROUTES,
  REDIRECT_ROUTES,
  STATIC_ROUTES,
} from '../src/lib/seo/routes';
import { buildRobots, buildSitemap } from './generate-sitemap';
import { SITE_URL } from '../src/config/site';
import { products } from '../src/data/catalog/index';
import { categories } from '../src/data/catalog/categories.config';

const appRoutes = [...readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf-8').matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]);

describe('rutas del sitio', () => {
  it('cada <Route> de App.tsx está clasificada (indexable, noindex, redirección o dinámica)', () => {
    const known = new Set<string>([...STATIC_ROUTES, ...NOINDEX_ROUTES, ...REDIRECT_ROUTES, ...DYNAMIC_ROUTE_PATTERNS, '*']);
    expect(appRoutes.length).toBeGreaterThan(10);
    expect(appRoutes.filter(r => !known.has(r))).toEqual([]);
  });

  it('indexables: 6 fijas + todas las categorías + todos los productos, sin duplicados ni parámetros', () => {
    const routes = indexableRoutes();
    expect(routes).toHaveLength(STATIC_ROUTES.length + categories.length + products.length);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes.some(r => r.includes('?'))).toBe(false);
    for (const r of NOINDEX_ROUTES) expect(routes).not.toContain(r);
  });

  it('sitemap y robots apuntan a la dirección del sitio, sin las páginas noindex', () => {
    const xml = buildSitemap(indexableRoutes());
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/cotizador</loc>`);
    expect(xml).not.toContain('/buscar');
    expect(xml.match(/<loc>/g)).toHaveLength(indexableRoutes().length);
    expect(buildRobots()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    expect(buildRobots()).toContain('Disallow: /api/');
  });
});
