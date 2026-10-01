// scripts/generate-sitemap.ts
// Genera dist/sitemap.xml y dist/robots.txt desde la lista única de rutas indexables
// (src/lib/seo/routes.ts) y la dirección del sitio (src/config/site.ts).
// Corre después de `vite build` (npm run build): vite vacía dist/ al empezar.
// Sin <lastmod>: no hay una fecha confiable por página, y Google ignora las fechas
// que no corresponden a cambios reales.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_URL } from '../src/config/site';
import { indexableRoutes } from '../src/lib/seo/routes';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, process.argv[2] ?? 'dist');

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function buildSitemap(routes: string[], site = SITE_URL): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...routes.map(path => `  <url><loc>${escapeXml(site + path)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

export function buildRobots(site = SITE_URL): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${site}/sitemap.xml`, ''].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const routes = indexableRoutes();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'sitemap.xml'), buildSitemap(routes), 'utf8');
  writeFileSync(resolve(OUT_DIR, 'robots.txt'), buildRobots(), 'utf8');
  console.log(`[sitemap] ${routes.length} URLs y robots.txt en ${OUT_DIR}`);
}
