// scripts/generate-sitemap.ts
// Genera public/sitemap.xml a partir de src/data/products.ts.
// Se ejecuta como parte de `npm run build` via tsx.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { products, categories } from '../src/data/products';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(ROOT, 'public', 'sitemap.xml');

const SITE = 'https://nuevo.elights.cl';
const today = new Date().toISOString().slice(0, 10);

type Url = {
  loc: string;
  priority: string;
  changefreq?: string;
  lastmod?: string;
};

const urls: Url[] = [
  { loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly', lastmod: today },
  { loc: `${SITE}/catalogo`, priority: '0.9', changefreq: 'weekly', lastmod: today },
  { loc: `${SITE}/instalacion`, priority: '0.8', changefreq: 'monthly', lastmod: today },
  { loc: `${SITE}/estudio-luminico`, priority: '0.8', changefreq: 'monthly', lastmod: today },
];

for (const product of products) {
  urls.push({
    loc: `${SITE}/producto/${product.id}`,
    priority: '0.7',
    changefreq: 'monthly',
    lastmod: today,
  });
}

for (const cat of categories) {
  urls.push({
    loc: `${SITE}/catalogo?categoria=${encodeURIComponent(cat.slug)}`,
    priority: '0.6',
    changefreq: 'monthly',
    lastmod: today,
  });
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(u => {
    const parts = [
      `    <loc>${escapeXml(u.loc)}</loc>`,
      u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : '',
      u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>` : '',
      `    <priority>${u.priority}</priority>`,
    ].filter(Boolean);
    return ['  <url>', ...parts, '  </url>'].join('\n');
  }),
  '</urlset>',
  '',
].join('\n');

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, xml, 'utf8');

console.log(`[sitemap] Wrote ${urls.length} URLs to ${OUT_PATH}`);
