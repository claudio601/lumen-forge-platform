// scripts/check-prerender.ts
// Revisa el HTML que escribió scripts/prerender.ts (dist/) antes de publicarlo.
//
// Estructura (siempre bloquea):
//   - cada página indexable existe, en español, con un solo título y un solo h1 visible;
//   - canonical igual a su URL, sin noindex, e imagen para compartir JPEG o PNG https, ya
//     codificada, igual a la que da src/lib/seo/ogImage.ts (la foto de la ficha o la de la
//     marca), con sus medidas y su texto alternativo, y la misma en twitter:image;
//   - el JSON-LD se lee, y en las fichas el precio coincide con el catálogo;
//   - nada quedó "para dibujar en el navegador";
//   - spa.html y 404.html llevan noindex, y el sitemap lista justo las páginas generadas;
//   - solo 404.html lleva la marca de "no encontrada" en #root, y su h1 es "404";
//   - ningún id retirado (src/data/catalog/renamed-ids.ts) tiene página: Vercel aplica su
//     301 antes que los archivos, así que nunca se vería. Un 301 que llega a un producto no
//     publicado (da 404) solo se informa;
//   - URLs de elights.cl (scripts/redirects/legacy-urls.json, PR 08): ninguna fuente con regla
//     es un archivo de dist/ (su 301 lo taparía), y cada destino de categoría o página fija
//     se generó (o es /buscar, que sirve spa.html).
// Avisos (nunca bloquean): un 301 de elights.cl que llega a un producto no publicado (da 404:
// cambiar su fila a la categoría), y un producto publicado cuyo permalink de Jumpseller no
// tiene fila en legacy-urls.json (agregarla antes de la Etapa 3). Sin red: solo datos locales.
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
import { RENAMED_FROM } from '../src/data/catalog/renamed-ids';
import { productImageFacts } from '../src/data/catalog/og-images.generated';
import { DEFAULT_OG, ogImageUrl, productOgImage, type OgImage } from '../src/lib/seo/ogImage';
import { indexableRoutes, productPath } from '../src/lib/seo/routes';
import { findPolicyBreaking } from './jumpseller/descriptions';
import { NOT_FOUND_ATTR } from '../src/lib/notFound';
import { NOT_FOUND_URL, outputPath } from './prerender';
import { LEGACY_TARGET_KEYS, LEGACY_URLS, legacyDestination, type LegacyUrl } from './redirects/build';

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
  ogImageWidths: string[];
  ogImageHeights: string[];
  ogImageAlts: string[];
  twitterImages: string[];
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
    ogImageWidths: [],
    ogImageHeights: [],
    ogImageAlts: [],
    twitterImages: [],
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
    if (tag === 'meta') {
      const content = attr(n, 'content') ?? '';
      const property = attr(n, 'property');
      if (property === 'og:image') facts.ogImages.push(content);
      if (property === 'og:image:width') facts.ogImageWidths.push(content);
      if (property === 'og:image:height') facts.ogImageHeights.push(content);
      if (property === 'og:image:alt') facts.ogImageAlts.push(content);
      if (attr(n, 'name') === 'twitter:image') facts.twitterImages.push(content);
    }
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

const RASTER = /\.(jpe?g|png)$/i;

/** Imagen para compartir esperada: URL absoluta y codificada, con sus medidas (si se conocen). */
export interface ExpectedOg {
  url: string;
  width?: number;
  height?: number;
}

/** La que da la regla de src/lib/seo/ogImage.ts (la misma que usa la ficha). */
export function expectedOg(img: OgImage): ExpectedOg {
  return { url: ogImageUrl(img), ...(img.width && img.height ? { width: img.width, height: img.height } : {}) };
}

/** Problemas de estructura de una página indexable (o de spa.html / 404.html). */
export function structuralIssues(
  route: string,
  f: PageFacts,
  expect: { indexable: boolean; price?: number; siteUrl?: string; og?: ExpectedOg },
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
    if (!RASTER.test(path)) issues.push(`og:image no es JPEG ni PNG https: ${img}`);
    else if (img !== new URL(img).href) issues.push(`og:image sin codificar: ${img}`);
  }
  if (f.twitterImages.length !== 1 || f.twitterImages[0] !== f.ogImages[0]) {
    issues.push(`twitter:image ${JSON.stringify(f.twitterImages)} distinta de og:image`);
  }
  if (f.ogImageAlts.length !== 1 || !f.ogImageAlts[0].trim()) issues.push('og:image:alt falta o está vacío');
  if (expect.og) {
    if (f.ogImages.length === 1 && f.ogImages[0] !== expect.og.url) issues.push(`og:image ${f.ogImages[0]} en vez de ${expect.og.url}`);
    // Las dos medidas o ninguna, iguales a las esperadas
    const got = f.ogImageWidths.length || f.ogImageHeights.length ? `${f.ogImageWidths.join(',')}×${f.ogImageHeights.join(',')}` : 'sin medidas';
    const want = expect.og.width && expect.og.height ? `${expect.og.width}×${expect.og.height}` : 'sin medidas';
    if (got !== want) issues.push(`og:image:width/height ${got} en vez de ${want}`);
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

/**
 * La marca de 404.html (src/lib/notFound.ts): el navegador la usa para hidratar la página
 * "no encontrada". Solo 404.html la lleva, una vez y en #root, y su h1 es "404".
 */
export function notFoundMarkerIssues(html: string, isNotFoundPage: boolean, h1s: { text: string }[] = []): string[] {
  const marks = html.split(`${NOT_FOUND_ATTR}=`).length - 1;
  if (!isNotFoundPage) return marks ? ['lleva la marca de la página 404'] : [];
  const issues: string[] = [];
  if (marks !== 1 || !html.includes(`<div id="root" ${NOT_FOUND_ATTR}=""`)) issues.push(`la marca ${NOT_FOUND_ATTR} debe estar una vez, en #root`);
  if (h1s.map(h => h.text.trim()).join('|') !== '404') issues.push(`el h1 debería ser "404" (es ${JSON.stringify(h1s.map(h => h.text))})`);
  return issues;
}

/** Revisión de las URLs de elights.cl (PR 08) contra la build. */
export interface LegacyCheck {
  /** Bloquea: una fuente tapa un archivo, o falta la página de un destino fijo. */
  blocking: string[];
  /** Solo avisa: destinos en productos no publicados y permalinks publicados sin fila. */
  warnings: string[];
  summary: string;
}

/**
 * Cruza legacy-urls.json con los productos publicados y los archivos de la build (`exists`
 * recibe una ruta relativa a dist/). Los productos no publicados solo avisan: las reglas no
 * dependen del catálogo y la PR del robot de Jumpseller nunca falla por ellas.
 */
export function legacyRedirectIssues(
  urls: readonly LegacyUrl[],
  published: readonly { id: string; jumpseller_id: number; permalink: string }[],
  exists: (file: string) => boolean,
): LegacyCheck {
  const blocking: string[] = [];
  const toUnpublished: string[] = [];
  const publishedPaths = new Set(published.map(p => productPath(p.id)));
  const counts: Record<(typeof LEGACY_TARGET_KEYS)[number], number> = { product: 0, category: 0, path: 0, served: 0, gone: 0, pending: 0 };
  for (const u of urls) {
    counts[LEGACY_TARGET_KEYS.find(k => u[k] !== undefined)]++; // el esquema exige exactamente uno
    const destination = legacyDestination(u);
    if (!destination) continue;
    // Vercel aplica las redirecciones antes que los archivos: el archivo no se vería nunca.
    // (No se usa outputPath(): rechaza las ',' que traen algunas URLs de Jumpseller.)
    const file = decodeURI(u.source).slice(1);
    for (const f of [file, `${file}/index.html`]) if (exists(f)) blocking.push(`${u.source}: su 301 tapa el archivo dist/${f}`);
    if (u.product !== undefined) {
      if (!publishedPaths.has(destination)) toUnpublished.push(`${u.source} → ${destination}`);
    } else if (!exists(destination === '/buscar' ? 'spa.html' : outputPath(destination))) {
      blocking.push(`${u.source} → ${destination}: esa página no se generó`);
    }
  }
  const sources = new Set(urls.map(u => u.source));
  const withoutRow = published.filter(p => !sources.has(`/${p.permalink}`));
  const warnings = [
    ...toUnpublished.map(t => `${t}: llega a un producto no publicado (da 404); cambiar su fila de legacy-urls.json a la categoría del producto`),
    ...withoutRow.map(p => `/${p.permalink} (Jumpseller ${p.jumpseller_id}): permalink publicado sin fila en legacy-urls.json; agregarla antes de la Etapa 3`),
  ];
  const rules = counts.product + counts.category + counts.path;
  const summary =
    `URLs de elights.cl: ${rules} redirecciones 301 (${counts.product} a fichas, ${counts.category} a categorías, ${counts.path} a páginas), ` +
    `${counts.served} servidas, ${counts.gone} 404 definitivas, ${counts.pending} pendientes; ` +
    `${toUnpublished.length} llegan a productos no publicados; ${withoutRow.length} permalinks publicados sin fila`;
  return { blocking, warnings, summary };
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
  // Imagen para compartir de cada ficha, con la misma regla que la página; el resto, la de la marca
  const productOg = new Map<string, OgImage | undefined>(
    products.map(p => [`/producto/${p.id}`, productOgImage(p.images?.[0], productImageFacts[p.jumpseller_id], p.name)]),
  );
  const ownPhotos = [...productOg.values()].filter(Boolean).length;

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
    const og = expectedOg(productOg.get(route) ?? DEFAULT_OG);
    for (const issue of structuralIssues(route, facts, { indexable: true, price: prices.get(route), og })) blocking.push(`${route}: ${issue}`);
    for (const issue of notFoundMarkerIssues(html, false)) blocking.push(`${route}: ${issue}`);
  }
  for (const [file, url] of [['spa.html', '/buscar'], ['404.html', NOT_FOUND_URL]] as const) {
    const html = read(file);
    if (!html) {
      blocking.push(`${file}: no se generó`);
      continue;
    }
    const facts = inspectHtml(html);
    for (const issue of structuralIssues(url, facts, { indexable: false })) blocking.push(`${file}: ${issue}`);
    for (const issue of notFoundMarkerIssues(html, file === '404.html', facts.h1s)) blocking.push(`${file}: ${issue}`);
  }
  if (read('spa.html') && !inspectHtml(read('spa.html')!).rootEmpty) blocking.push('spa.html: la app debería venir vacía');

  const sitemap = read('sitemap.xml') ?? '';
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(SITE_URL, ''));
  const missing = routes.filter(r => !locs.includes(r));
  const extra = locs.filter(l => !pageFacts.has(l));
  if (missing.length || extra.length) blocking.push(`sitemap: faltan ${JSON.stringify(missing)}, sobran ${JSON.stringify(extra)}`);

  // Ids renombrados (PR 07)
  const published = new Set(products.map(p => p.id));
  for (const old of RENAMED_FROM.keys()) {
    if (read(outputPath(productPath(old)))) blocking.push(`${productPath(old)}: tiene página, pero su 301 (id retirado) la tapa`);
  }
  const toUnpublished = [...RENAMED_FROM].filter(([, id]) => !published.has(id));

  // URLs de elights.cl (PR 08)
  const legacy = legacyRedirectIssues(LEGACY_URLS, products, file => existsSync(join(dist, file)));
  blocking.push(...legacy.blocking);

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
  console.log(`[check-prerender] Imagen para compartir: ${ownPhotos} fichas con su foto, ${productOg.size - ownPhotos} con la imagen de la marca`);
  console.log(
    `[check-prerender] Ids renombrados: ${RENAMED_FROM.size} redirecciones 301; ${toUnpublished.length} llegan a productos no publicados (dan 404)` +
      (toUnpublished.length ? `: ${toUnpublished.map(([old, id]) => `${old} → ${id}`).join(', ')}` : ''),
  );
  console.log(`[check-prerender] ${legacy.summary}`);
  for (const k of known) console.log(`  permitida: ${k}`);
  for (const w of warnings) console.log(`::warning title=Contenido de la página::${w}`);
  for (const w of legacy.warnings) console.log(`::warning title=URLs de elights.cl::${w}`);
  if (blocking.length) {
    for (const b of blocking) console.log(`::error title=Página estática::${b}`);
    console.error(`[check-prerender] ${blocking.length} problema(s)`);
    process.exit(1);
  }
  console.log('[check-prerender] OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
