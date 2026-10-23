// La lista de rutas indexables (src/lib/seo/routes.ts) es la única fuente del
// sitemap y del prerender: cada ruta de la app (src/routes.tsx) tiene que estar
// clasificada ahí, para que ninguna página nueva quede fuera de Google sin querer.

import { existsSync, readFileSync } from 'node:fs';
import { matchPath } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_ROUTE_PATTERNS,
  indexableGuideRoutes,
  indexableRoutes,
  NOINDEX_ROUTES,
  noindexGuideRoutes,
  prerenderedRoutes,
  REDIRECT_ROUTES,
  STATIC_ROUTES,
} from '../src/lib/seo/routes';
import { GUIDES, guidePath } from '../src/data/guides/index';
import { buildRobots, buildSitemap } from './generate-sitemap';
import { SITE_URL } from '../src/config/site';
import { products } from '../src/data/catalog/index';
import { categories } from '../src/data/catalog/categories.config';
import { LEGAL_PAGES } from '../src/config/legal';

const routesSource = readFileSync(new URL('../src/routes.tsx', import.meta.url), 'utf-8');
const appRoutes = [...routesSource.matchAll(/\{ path: '([^']+)', element:/g)].map(m => m[1]);

describe('rutas del sitio', () => {
  it('cada ruta de src/routes.tsx está clasificada (indexable, noindex, redirección o dinámica)', () => {
    const known = new Set<string>([...STATIC_ROUTES, ...NOINDEX_ROUTES, ...REDIRECT_ROUTES, ...DYNAMIC_ROUTE_PATTERNS, '*']);
    expect(appRoutes.length).toBeGreaterThan(10);
    expect(appRoutes.filter(r => !known.has(r))).toEqual([]);
  });

  it('indexables: las páginas fijas + todas las categorías + las guías indexables + todos los productos, sin duplicados ni parámetros', () => {
    const routes = indexableRoutes();
    expect(routes).toHaveLength(STATIC_ROUTES.length + categories.length + indexableGuideRoutes().length + products.length);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes.some(r => r.includes('?'))).toBe(false);
    for (const r of NOINDEX_ROUTES) expect(routes).not.toContain(r);
  });

  it('sitemap y robots apuntan a la dirección del sitio, sin las páginas noindex', () => {
    const xml = buildSitemap(indexableRoutes());
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/cotizador</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/terminos-y-condiciones</loc>`);
    expect(xml).not.toContain('/buscar');
    expect(xml.match(/<loc>/g)).toHaveLength(indexableRoutes().length);
    expect(buildRobots()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    expect(buildRobots()).toContain('Disallow: /api/');
  });

  it('guías (plan del blog, §5.2): cada guía publicada es indexable o «publicada sin indexar», nunca las dos; las sin indexar se prerenderizan pero quedan fuera del sitemap', () => {
    expect(GUIDES.length).toBeGreaterThan(0);
    const indexable = new Set(indexableRoutes());
    const unindexed = noindexGuideRoutes();
    for (const g of GUIDES) {
      const path = guidePath(g.slug);
      expect(indexable.has(path), path).toBe(g.index);
      expect(unindexed.includes(path), path).toBe(!g.index);
    }
    expect(prerenderedRoutes()).toEqual([...indexableRoutes(), ...unindexed]);
    const xml = buildSitemap(indexableRoutes());
    for (const path of unindexed) expect(xml, path).not.toContain(`<loc>${SITE_URL}${path}</loc>`);
    // G1 sale «publicada sin indexar» hasta el OK del dueño (decisión 16 del plan)
    expect(unindexed).toContain('/guias/norma-luminica-ds-1-2022');
    expect(STATIC_ROUTES).toContain('/guias');
  });

  it('cada ruta dinámica tiene sus páginas generadas: sin la regla comodín (PR 05), una ruta sin página da 404', () => {
    // Una ruta con parámetros nueva (p. ej. un panel de pedidos) necesita prerender o una regla
    // revisada en vercel.json: vercel-config.test.ts solo acepta fuentes de un segmento fijo y
    // los 301 de ids de producto renombrados ('/producto/<id literal>{/}?', generados). Las
    // guías sin indexar también se generan (prerenderedRoutes).
    const routes = prerenderedRoutes();
    for (const pattern of DYNAMIC_ROUTE_PATTERNS) {
      expect(routes.some(r => matchPath(pattern, r)), `${pattern} no tiene páginas generadas`).toBe(true);
    }
  });

  it('las páginas legales y de compra (LEGAL_PAGES: pie, aviso de los formularios) son páginas fijas indexables', () => {
    expect(LEGAL_PAGES).toHaveLength(6);
    for (const { path } of LEGAL_PAGES) expect(STATIC_ROUTES as readonly string[], path).toContain(path);
  });

  it('las listas no se pisan: una ruta es indexable, noindex o redirección, nunca dos (vercel.json se arma con ellas)', () => {
    const all = [...STATIC_ROUTES, ...NOINDEX_ROUTES, ...REDIRECT_ROUTES];
    expect(new Set(all).size).toBe(all.length);
  });

  it('cada página carga su propio archivo (el prerender lo precarga por ese nombre)', () => {
    const pages = [...routesSource.matchAll(/lazyPage\('(\w+)', \(\) => import\('\.\/pages\/(\w+)'\)\)/g)];
    expect(pages.length).toBeGreaterThan(10);
    for (const [, name, file] of pages) {
      expect(file).toBe(name);
      expect(existsSync(new URL(`../src/pages/${name}.tsx`, import.meta.url)), name).toBe(true);
    }
  });
});
