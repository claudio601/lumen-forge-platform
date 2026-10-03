// scripts/check-prerender.ts
// Revisa el HTML que escribió scripts/prerender.ts (dist/) antes de publicarlo.
//
// Estructura (siempre bloquea):
//   - cada página indexable existe, en español, con un solo título y un solo h1 visible;
//   - canonical igual a su URL, sin noindex, e imagen para compartir en formato de foto
//     (las redes no muestran SVG);
//   - el JSON-LD se lee, y en las fichas el precio coincide con el catálogo;
//   - nada quedó "para dibujar en el navegador";
//   - spa.html y 404.html llevan noindex, y el sitemap lista justo las páginas generadas.
// Contenido (bloquea, salvo en la PR diaria del robot de Jumpseller, donde solo avisa):
//   - frases de stock o plazos de despacho distintos de "hasta 2 días hábiles" en el texto
//     visible. Las reglas miran el contexto: "48 horas" de un ensayo de niebla salina no
//     es un plazo de despacho.
//
// Uso: npm run check:prerender [-- dist]

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { SITE_URL } from '../src/config/site';
import { products } from '../src/data/catalog/index';
import { indexableRoutes } from '../src/lib/seo/routes';
import { findPolicyBreaking } from './jumpseller/descriptions';
import { NOT_FOUND_URL, outputPath } from './prerender';

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  value?: string;
}

export interface PageFacts {
  lang: string | undefined;
  titles: string[];
  /** Texto de cada h1 y si se ve (ni él ni sus padres con hidden o sr-only). */
  h1s: { text: string; visible: boolean }[];
  canonicals: string[];
  robots: string[];
  ogImages: string[];
  jsonLd: string[];
  /** Texto de <main> (incluye las respuestas de las preguntas frecuentes, cerradas). */
  mainText: string;
  /** Texto de la cabecera y el pie del sitio (iguales en todas las páginas). */
  chromeText: string;
  rootEmpty: boolean;
  clientRendered: boolean;
}

const attr = (n: HtmlNode, name: string) => n.attrs?.find(a => a.name === name)?.value;

function textOf(n: HtmlNode): string {
  if (n.nodeName === '#text') return n.value ?? '';
  if (n.tagName === 'script' || n.tagName === 'style') return '';
  return (n.childNodes ?? []).map(textOf).join(' ');
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const hides = (n: HtmlNode) =>
  attr(n, 'hidden') !== undefined || (attr(n, 'class') ?? '').split(/\s+/).some(c => c === 'hidden' || c === 'sr-only');

export function inspectHtml(html: string): PageFacts {
  const facts: PageFacts = {
    lang: undefined,
    titles: [],
    h1s: [],
    canonicals: [],
    robots: [],
    ogImages: [],
    jsonLd: [],
    mainText: '',
    chromeText: '',
    rootEmpty: true,
    clientRendered: html.includes('<!--$!-->'),
  };
  const chrome: string[] = [];
  const walk = (n: HtmlNode, hidden: boolean, inMain: boolean) => {
    const tag = n.tagName;
    const hiddenHere = hidden || hides(n);
    if (tag === 'html') facts.lang = attr(n, 'lang');
    if (tag === 'title') facts.titles.push(squash(textOf(n)));
    if (tag === 'h1') facts.h1s.push({ text: squash(textOf(n)), visible: !hiddenHere });
    if (tag === 'link' && attr(n, 'rel') === 'canonical') facts.canonicals.push(attr(n, 'href') ?? '');
    if (tag === 'meta' && attr(n, 'name') === 'robots') facts.robots.push(attr(n, 'content') ?? '');
    if (tag === 'meta' && attr(n, 'property') === 'og:image') facts.ogImages.push(attr(n, 'content') ?? '');
    if (tag === 'script' && attr(n, 'type') === 'application/ld+json') facts.jsonLd.push((n.childNodes ?? []).map(c => c.value ?? '').join(''));
    if (tag === 'div' && attr(n, 'id') === 'root') facts.rootEmpty = !(n.childNodes ?? []).some(c => c.tagName);
    if (tag === 'main') facts.mainText = squash(textOf(n));
    if (tag === 'header' || tag === 'footer') chrome.push(squash(textOf(n)));
    for (const c of n.childNodes ?? []) walk(c, hiddenHere, inMain || tag === 'main');
  };
  walk(parse(html) as unknown as HtmlNode, false, false);
  facts.chromeText = chrome.join(' ');
  return facts;
}

const RASTER = /\.(jpe?g|png|webp|gif)$/i;

/** Problemas de estructura de una página indexable (o de spa.html / 404.html). */
export function structuralIssues(
  route: string,
  f: PageFacts,
  expect: { indexable: boolean; price?: number; siteUrl?: string },
): string[] {
  const issues: string[] = [];
  const site = expect.siteUrl ?? SITE_URL;
  if (f.lang !== 'es') issues.push(`idioma "${f.lang ?? ''}" en vez de "es"`);
  if (f.titles.length !== 1 || !f.titles[0]) issues.push(`${f.titles.length} títulos (debe haber uno, con texto)`);
  if (f.clientRendered) issues.push('una parte quedó sin dibujar en el servidor');
  const noindex = f.robots.some(r => /noindex/i.test(r));
  if (!expect.indexable) {
    if (!noindex) issues.push('sin noindex');
    return issues;
  }
  if (f.rootEmpty) issues.push('la app está vacía');
  const visible = f.h1s.filter(h => h.visible && h.text);
  if (f.h1s.length !== 1 || visible.length !== 1) issues.push(`${f.h1s.length} h1 (${visible.length} visibles con texto); debe haber uno`);
  if (noindex) issues.push('tiene noindex');
  const url = site + route;
  if (f.canonicals.length !== 1 || f.canonicals[0] !== url) issues.push(`canonical ${JSON.stringify(f.canonicals)} en vez de ${url}`);
  if (f.ogImages.length !== 1) issues.push(`${f.ogImages.length} og:image (debe haber una)`);
  for (const img of f.ogImages) {
    let path = '';
    try {
      const u = new URL(img);
      path = u.protocol === 'https:' ? decodeURIComponent(u.pathname) : '';
    } catch {
      /* no es una URL absoluta */
    }
    if (!RASTER.test(path)) issues.push(`og:image no es una foto https (JPEG, PNG, WebP o GIF): ${img}`);
  }
  const parsed: unknown[] = [];
  for (const raw of f.jsonLd) {
    try {
      parsed.push(JSON.parse(raw));
    } catch {
      issues.push(`JSON-LD que no se lee: ${raw.slice(0, 80)}`);
    }
  }
  if (expect.price !== undefined) {
    const product = parsed.find((d): d is { offers?: { price?: unknown } } => (d as { '@type'?: string })?.['@type'] === 'Product');
    if (!product) issues.push('ficha sin JSON-LD de producto');
    else if (product.offers?.price !== expect.price) issues.push(`precio del JSON-LD ${String(product.offers?.price)} y en el catálogo ${expect.price}`);
  }
  return issues;
}

/**
 * Frases que la regla marca pero son correctas en esa página: se informan, sin bloquear.
 * Cada una con su motivo.
 */
export const KNOWN_PHRASES: { routes: string[]; phrase: RegExp; reason: string }[] = [
  {
    routes: ['/', '/estudio-luminico'],
    phrase: /^entrega en 48 horas$/i,
    reason: 'plazo del informe del estudio DIALux, no de despacho; confirmado por el dueño el 2026-10-03',
  },
];

/** Frases que contradicen las reglas del sitio en un texto visible (cada una una vez). */
export function contentIssues(text: string): string[] {
  const found: string[] = [];
  let rest = text;
  for (let phrase = findPolicyBreaking(rest); phrase; phrase = findPolicyBreaking(rest)) {
    found.push(phrase);
    rest = rest.split(phrase).join(' ');
  }
  return found;
}

export const isSyncBotBranch = (env: NodeJS.ProcessEnv = process.env) =>
  [env.GITHUB_HEAD_REF, env.GITHUB_REF_NAME].includes('bot/jumpseller-sync');

function main() {
  const dist = resolve(fileURLToPath(new URL('..', import.meta.url)), process.argv[2] ?? 'dist');
  const read = (file: string) => (existsSync(join(dist, file)) ? readFileSync(join(dist, file), 'utf8') : undefined);
  const blocking: string[] = [];
  const warnings: string[] = [];
  const contentOnlyWarns = isSyncBotBranch();
  const prices = new Map(products.map(p => [`/producto/${p.id}`, p.price]));

  const routes = indexableRoutes();
  const pageFacts = new Map<string, PageFacts>();
  for (const route of routes) {
    const html = read(outputPath(route));
    if (!html) {
      blocking.push(`${route}: no se generó`);
      continue;
    }
    const facts = inspectHtml(html);
    pageFacts.set(route, facts);
    for (const issue of structuralIssues(route, facts, { indexable: true, price: prices.get(route) })) blocking.push(`${route}: ${issue}`);
  }
  for (const [file, url] of [['spa.html', '/buscar'], ['404.html', NOT_FOUND_URL]] as const) {
    const html = read(file);
    if (!html) blocking.push(`${file}: no se generó`);
    else for (const issue of structuralIssues(url, inspectHtml(html), { indexable: false })) blocking.push(`${file}: ${issue}`);
  }
  if (read('spa.html') && !inspectHtml(read('spa.html')!).rootEmpty) blocking.push('spa.html: la app debería venir vacía');

  const sitemap = read('sitemap.xml') ?? '';
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(SITE_URL, ''));
  const missing = routes.filter(r => !locs.includes(r));
  const extra = locs.filter(l => !pageFacts.has(l));
  if (missing.length || extra.length) blocking.push(`sitemap: faltan ${JSON.stringify(missing)}, sobran ${JSON.stringify(extra)}`);

  // Contenido: el texto de cada página, y una vez la cabecera y el pie (se repiten en todas)
  const content: string[] = [];
  const known: string[] = [];
  const texts: [string, string][] = [...pageFacts].map(([route, f]) => [route, f.mainText]);
  const home = pageFacts.get('/');
  if (home) texts.push(['cabecera y pie', home.chromeText]);
  for (const [route, text] of texts) {
    for (const phrase of contentIssues(text)) {
      const k = KNOWN_PHRASES.find(x => x.routes.includes(route) && x.phrase.test(phrase));
      if (k) known.push(`${route}: "${phrase}" (${k.reason})`);
      else content.push(`${route}: "${phrase}"`);
    }
  }
  if (contentOnlyWarns) warnings.push(...content);
  else blocking.push(...content.map(c => `${c}: contradice las reglas del sitio (stock o plazos de despacho)`));

  console.log(`[check-prerender] ${pageFacts.size} de ${routes.length} páginas revisadas, más spa.html y 404.html`);
  for (const k of known) console.log(`  permitida: ${k}`);
  for (const w of warnings) console.log(`::warning title=Contenido de la página::${w}`);
  if (blocking.length) {
    for (const b of blocking) console.log(`::error title=Página estática::${b}`);
    console.error(`[check-prerender] ${blocking.length} problema(s)`);
    process.exit(1);
  }
  console.log('[check-prerender] OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
