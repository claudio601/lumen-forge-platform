// scripts/smoke.ts
// Chequeo de humo del sitio desplegado (Etapa 2): estado HTTP y etiquetas SEO de
// las rutas clave, archivos y funciones de api/. Se corre en cada preview y
// después de cada merge.
//
//   npm run smoke -- https://nuevo.elights.cl
//   npm run smoke -- https://nuevo.elights.cl --all   (además, todas las páginas del sitemap y sus assets)
//   npm run smoke -- <url-preview> --compare https://nuevo.elights.cl
//   npm run smoke -- <url> --json reports/smoke/produccion.json
//   npm run smoke -- https://nuevo.elights.cl --legacy   (cada fila de scripts/redirects/legacy-urls.json
//                                                         y cada destino, de a una cada 500 ms: ~7 min)
//
// Solo hace GET. Los webhooks (Jumpseller, WhatsApp, Pipedrive) responden 405
// antes de procesar nada, así que el chequeo no tiene efectos. Nunca sigue redirecciones.
//
// Cada fila se juzga según su tipo (PR 05, 404 reales):
//   page      200, HTML con canonical y sin noindex
//   spa       200, HTML con noindex (spa.html: /buscar, /cotizacion, /solicitar-pedido)
//   notfound  404, HTML con noindex y la marca de 404.html
//   redirect  307 al destino de la regla (/carro → /solicitar-pedido); 301 en los ids de
//             producto renombrados (PR 07) y en las URLs de elights.cl (PR 08). Con '?' en la
//             URL, Location conserva la consulta
//   file      200, no HTML
//   api       405
//   observe   se informa sin juzgar (salvo un 5xx): variantes de URL a mirar a mano
// Cualquier 5xx o falta de respuesta también falla.
//
// Las vistas previas de Vercel piden inicio de sesión y responden 302 a vercel.com: el
// chequeo lo marca como falla. Para pasar, el dueño puede crear en Vercel el secreto
// "Protection Bypass for Automation" y dejarlo en VERCEL_AUTOMATION_BYPASS_SECRET (entorno
// o .env.local); se manda solo a *.vercel.app y nunca se imprime. Sin él, la vista previa
// se prueba desde el navegador integrado.
//
// Código de salida: 0 ok · 1 si una fila no cumple lo esperado, o si con --compare una
// fila de api/ o de archivos cambia de estado o de tipo · 2 uso incorrecto.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { products } from '../src/data/catalog/index';
import { categories } from '../src/data/catalog/categories.config';
import { NOT_FOUND_ATTR } from '../src/lib/notFound';
import { RENAMED_SITE_IDS } from '../src/data/catalog/renamed-ids';
import { NOINDEX_ROUTES } from '../src/lib/seo/routes';
import { LEGACY_URLS, legacyDestination, type LegacyUrl } from './redirects/build';

export type Kind = 'page' | 'spa' | 'notfound' | 'redirect' | 'file' | 'api' | 'observe';

export interface Target {
  path: string;
  kind: Kind;
  /** redirect: ruta a la que debe llevar. */
  to?: string;
  /** redirect: estado esperado (307 si no se indica). No se llama `status`: Row lo usa para el recibido. */
  expectedStatus?: number;
}

/** Productos renombrados que revisa el chequeo (PR 07): la campana NF3 ("w-ip66") y el alumbrado solar 150W ("control-remoto"). */
const RENAMED_SMOKE_IDS = [4122715, 25888711];

/**
 * URLs de elights.cl que revisa el chequeo (PR 08), con el destino de legacy-urls.json: una
 * ficha con el mismo id (y la consulta de Google Ads), una categoría (con barra final), fichas
 * renombradas con %C3%BA, con coma y con puntos, /home y /search (conserva ?q=).
 */
const LEGACY_SMOKE = [
  '/alumbrado-publico-bestled-120w-ip66-ik08?gclid=smoke',
  '/campana_led',
  '/campana_led/',
  '/alumbrado-p%C3%BAblico-led-solar-150w-all-in-one-c/control-remoto',
  '/cinta-led-led-verde-14,4w/m-72-leds/m-ip67-100-mt-220v',
  '/tubo-led-opal-vidrio-18w-120cm.-220v.-c/sensor-6500k',
  '/home',
  '/search?q=panel',
];
/** URLs de elights.cl sin regla a propósito (404): un producto de prueba y el blog. */
const LEGACY_SMOKE_NOT_FOUND = ['/producto-test-checkout', '/blog'];

/** Fila de una URL de elights.cl: 301 al destino que le da legacy-urls.json. */
function legacyRedirectTarget(path: string): Target {
  const source = path.split('?')[0].replace(/(.)\/$/, '$1');
  const entry = LEGACY_URLS.find(u => u.source === source);
  const to = entry ? legacyDestination(entry) : null;
  if (!to) throw new Error(`smoke: ${source} no tiene regla en scripts/redirects/legacy-urls.json`);
  return { path, kind: 'redirect', to, expectedStatus: 301 };
}

const pageKind = (path: string): Kind => ((NOINDEX_ROUTES as readonly string[]).includes(path) ? 'spa' : 'page');

/**
 * --legacy: cada fila de legacy-urls.json según lo que declara (301 a su destino, la página
 * que ya se sirve o 404) y después cada destino una vez (200).
 */
export function legacyTargets(urls: readonly LegacyUrl[] = LEGACY_URLS): Target[] {
  const rows = urls.map((u): Target => {
    const to = legacyDestination(u);
    if (to) return { path: u.source, kind: 'redirect', to, expectedStatus: 301 };
    return { path: u.source, kind: u.served ? pageKind(u.source) : 'notfound' };
  });
  const listed = new Set(rows.map(r => r.path));
  const destinations = [...new Set(rows.flatMap(r => (r.to ? [r.to] : [])))].filter(d => !listed.has(d)).sort();
  return [...rows, ...destinations.map((path): Target => ({ path, kind: pageKind(path) }))];
}

export interface PageInfo {
  title: string;
  canonical: string;
  robots: string;
  ogImage: string;
  h1: number;
  jsonLd: number;
  /** Es 404.html (#root con la marca de src/lib/notFound.ts). */
  notFoundMark: boolean;
}

export interface Row extends Target, PageInfo {
  status: number;
  type: string;
  location: string;
  xRobots: string;
  bytes: number;
}

/** Funciones de api/ que responden 405 a un GET. api/cron/followups no: responde 501. */
export const API_FUNCTIONS = [
  '/api/jumpseller/webhook',
  '/api/whatsapp/webhook',
  '/api/pipedrive/webhook',
  '/api/request-orders/create',
  '/api/quotes/create',
  '/api/installation-leads/create',
  '/api/estudio-luminico/create',
];

/** Rutas a revisar: las mismas en cada ejecución para poder comparar. */
export function buildTargets(): Target[] {
  const pages = ['/', '/catalogo', '/instalacion', '/estudio-luminico', '/instaladores', '/cotizador'];
  const productPaths = products.slice(0, 3).map(p => `/producto/${p.id}`);
  const categoryPaths = categories.slice(0, 3).map(c => `/catalogo/${c.slug}`);
  const datasheet = products.find(p => p.datasheetUrl)?.datasheetUrl;
  const as = (kind: Kind) => (path: string): Target => ({ path, kind });
  return [
    ...[...pages, ...productPaths, ...categoryPaths].map(as('page')),
    // Con y sin barra final: la regla de vercel.json acepta las dos (son los formularios de venta)
    ...['/buscar', '/buscar?q=panel', '/cotizacion', '/solicitar-pedido', '/cotizacion/', '/solicitar-pedido/'].map(as('spa')),
    ...['/carro', '/carro/'].map(path => ({ path, kind: 'redirect' as const, to: '/solicitar-pedido' })),
    // Ids renombrados: 301 al id vigente, con o sin barra final, y la consulta (gclid) se conserva
    ...RENAMED_SMOKE_IDS.flatMap(jid => {
      const { id, previous } = RENAMED_SITE_IDS[jid];
      const old = `/producto/${previous[0]}`;
      return [old, `${old}/`, `${old}?gclid=smoke`].map(path => ({ path, kind: 'redirect' as const, to: `/producto/${id}`, expectedStatus: 301 }));
    }),
    // URLs de elights.cl (PR 08): 301 al destino de legacy-urls.json, conservando la consulta
    ...LEGACY_SMOKE.map(legacyRedirectTarget),
    ...['/no-existe', '/producto/no-existe', '/catalogo/no-existe', '/catalogo/x/y', ...LEGACY_SMOKE_NOT_FOUND].map(as('notfound')),
    ...['/robots.txt', '/sitemap.xml', '/og-default.jpg', '/favicon.ico', ...(datasheet ? [new URL(datasheet, 'https://x').pathname] : [])].map(
      as('file'),
    ),
    ...API_FUNCTIONS.map(as('api')),
    ...['/carro?origen=prueba', '/catalogo/', `${productPaths[0]}/`, '/Catalogo', '/index.html', '/api/no-existe'].map(as('observe')),
  ];
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))?.[1] ?? '';

/** Lee del HTML lo que ve un buscador o una vista previa de enlace. */
export function inspectHtml(html: string): PageInfo {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
  const canonicalTag = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? '';
  const robotsTag = html.match(/<meta[^>]+name=["']robots["'][^>]*>/i)?.[0] ?? '';
  const ogTag = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i)?.[0] ?? '';
  return {
    title,
    canonical: attr(canonicalTag, 'href'),
    robots: attr(robotsTag, 'content'),
    ogImage: attr(ogTag, 'content'),
    h1: (html.match(/<h1[\s>]/gi) ?? []).length,
    jsonLd: (html.match(/application\/ld\+json/gi) ?? []).length,
    notFoundMark: html.includes(`<div id="root" ${NOT_FOUND_ATTR}=`),
  };
}

/** Assets con hash de la build que carga una página (JS, CSS, precargas). */
export function assetRefs(html: string): string[] {
  return [...new Set([...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(m => m[1]))];
}

const canonicalPath = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** Qué no cumple una fila según su tipo. Vacío: está bien. */
export function rowIssues(r: Row): string[] {
  if (r.status === 0) return [`sin respuesta (${r.type})`];
  if (r.location.startsWith('https://vercel.com/sso-api')) {
    return ['vista previa protegida por Vercel: usar VERCEL_AUTOMATION_BYPASS_SECRET o el navegador integrado'];
  }
  if (r.status >= 500) return [`error ${r.status}`];
  const html = r.type === 'text/html';
  const noindex = /noindex/i.test(r.robots);
  const issues: string[] = [];
  const want = (ok: boolean, msg: string) => {
    if (!ok) issues.push(msg);
  };
  const status = (code: number) => want(r.status === code, `estado ${r.status}, se esperaba ${code}`);
  switch (r.kind) {
    case 'page':
      status(200);
      want(html, `tipo ${r.type || '(vacío)'}, se esperaba HTML`);
      want(!!r.canonical, 'sin canonical');
      want(!r.canonical || canonicalPath(r.canonical) === r.path.split('?')[0], `canonical ${r.canonical} no es la de esta URL`);
      want(!noindex, 'tiene noindex');
      want(!r.notFoundMark, 'es la página 404');
      break;
    case 'spa':
      status(200);
      want(html, `tipo ${r.type || '(vacío)'}, se esperaba HTML`);
      want(noindex, 'sin noindex');
      want(!r.notFoundMark, 'es la página 404');
      break;
    case 'notfound':
      status(404);
      want(html, `tipo ${r.type || '(vacío)'}, se esperaba HTML`);
      want(noindex, 'sin noindex');
      want(r.notFoundMark, 'no es 404.html');
      break;
    case 'redirect': {
      status(r.expectedStatus ?? 307);
      const location = r.location ? new URL(r.location, 'https://x') : undefined;
      want(location?.pathname === r.to, `lleva a "${r.location}", se esperaba ${r.to}`);
      const query = r.path.includes('?') ? r.path.slice(r.path.indexOf('?')) : '';
      if (query) want(location?.search === query, `"${r.location}" no conserva la consulta ${query}`);
      break;
    }
    case 'file':
      status(200);
      want(!html, 'devuelve HTML en vez del archivo');
      break;
    case 'api':
      status(405);
      break;
    case 'observe':
      break;
  }
  return issues;
}

/**
 * Cabecera para saltar la protección de las vistas previas de Vercel, solo en *.vercel.app
 * y solo si existe VERCEL_AUTOMATION_BYPASS_SECRET (entorno o .env.local). Nunca se imprime.
 */
export function bypassHeaders(
  base: string,
  env: NodeJS.ProcessEnv = process.env,
  root = fileURLToPath(new URL('..', import.meta.url)),
): Record<string, string> {
  if (!new URL(base).hostname.endsWith('.vercel.app')) return {};
  let secret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const file = join(root, '.env.local');
  if (!secret && existsSync(file)) secret = parseDotenv(readFileSync(file)).VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) return {};
  // Se valida el formato para no mandar (ni mostrar en un error) cualquier cosa; el valor nunca se imprime
  if (!/^[A-Za-z0-9_-]{16,}$/.test(secret)) throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET no tiene el formato esperado (letras y números)');
  return { 'x-vercel-protection-bypass': secret };
}

/** Quita el secreto de un texto (mensajes de error). */
const redact = (text: string, headers: Record<string, string>) =>
  Object.values(headers).reduce((t, secret) => t.split(secret).join('***'), text);

const EMPTY: PageInfo = { title: '', canonical: '', robots: '', ogImage: '', h1: 0, jsonLd: 0, notFoundMark: false };

async function fetchRow(base: string, target: Target, headers: Record<string, string>, assets?: Set<string>): Promise<Row> {
  const res = await fetch(new URL(target.path, base), {
    redirect: 'manual',
    headers: { 'User-Agent': 'eLIGHTS-smoke/1.0', ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const body = target.kind === 'file' && type !== 'text/html' ? '' : await res.text();
  if (assets && type === 'text/html') for (const a of assetRefs(body)) assets.add(a);
  return {
    ...target,
    status: res.status,
    type,
    location: res.headers.get('location') ?? '',
    xRobots: res.headers.get('x-robots-tag') ?? '',
    bytes: body.length,
    ...(type === 'text/html' ? inspectHtml(body) : EMPTY),
  };
}

/** Rutas de todas las páginas del sitemap del despliegue. */
async function sitemapPaths(base: string, headers: Record<string, string>): Promise<string[]> {
  const res = await fetch(new URL('/sitemap.xml', base), { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status !== 200) throw new Error(`--all: no se pudo leer ${base}/sitemap.xml (estado ${res.status})`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
}

/** Corre fn sobre cada elemento, de a `size` en paralelo, conservando el orden. */
async function inPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

/** --legacy: pausa entre una URL y la siguiente (2 por segundo como máximo). */
const LEGACY_DELAY_MS = 500;

export async function runSmoke(base: string, opts: { all?: boolean; legacy?: boolean } = {}): Promise<Row[]> {
  const headers = bypassHeaders(base);
  const assets = new Set<string>();
  const safeRow = async (t: Target): Promise<Row> => {
    try {
      return await fetchRow(base, t, headers, assets);
    } catch (err) {
      return { ...t, ...EMPTY, status: 0, type: `ERROR ${redact((err as Error).message, headers)}`, location: '', xRobots: '', bytes: 0 };
    }
  };
  if (opts.legacy) {
    // De a una URL, sin sitemap ni assets: son unas 800 (las filas de legacy-urls.json y sus destinos)
    const rows: Row[] = [];
    for (const t of legacyTargets()) {
      rows.push(await safeRow(t));
      await new Promise(resolve => setTimeout(resolve, LEGACY_DELAY_MS));
    }
    return rows;
  }
  let targets = buildTargets();
  if (opts.all) {
    const known = new Set(targets.map(t => t.path));
    const pages = (await sitemapPaths(base, headers)).filter(p => !known.has(p)).map(path => ({ path, kind: 'page' as const }));
    targets = [...targets, ...pages];
  }
  const rows = await inPool(targets, 8, safeRow);
  // Assets con hash: el JS principal siempre; con --all, todos los que cargan las páginas.
  const assetTargets = [...assets]
    .filter(a => opts.all || /\/assets\/index-[^/]+\.js$/.test(a))
    .slice(0, opts.all ? undefined : 1)
    .map(path => ({ path, kind: 'file' as const }));
  return [...rows, ...(await inPool(assetTargets, 8, safeRow))];
}

/** Filas de api/ y archivos que cambian de estado o tipo entre dos despliegues. */
export function compareStable(a: Row[], b: Row[]): string[] {
  const byPath = new Map(b.map(r => [r.path, r]));
  const diffs: string[] = [];
  for (const r of a) {
    if (r.kind !== 'api' && r.kind !== 'file') continue;
    if (r.path.startsWith('/assets/')) continue; // el hash cambia en cada build
    const o = byPath.get(r.path);
    if (!o) continue;
    if (r.status !== o.status || r.type !== o.type) {
      diffs.push(`${r.path}: ${o.status} ${o.type} -> ${r.status} ${r.type}`);
    }
  }
  return diffs;
}

function printRows(label: string, rows: Row[], all: boolean, legacy = false) {
  console.log(`\n${label}`);
  const fixed = new Set(buildTargets().map(t => t.path));
  for (const r of rows) {
    const issues = rowIssues(r);
    // Con --all, las páginas del sitemap y los assets que están bien no se listan (se resumen abajo)
    if (all && !issues.length && ((r.kind === 'page' && !fixed.has(r.path)) || r.path.startsWith('/assets/'))) continue;
    // Con --legacy, solo las filas que fallan
    if (legacy && !issues.length) continue;
    const seo =
      r.type === 'text/html'
        ? ` · title="${r.title.slice(0, 50)}" h1=${r.h1} jsonld=${r.jsonLd}` +
          (r.canonical ? ` canonical=${r.canonical}` : '') +
          (r.robots ? ` robots=${r.robots}` : '') +
          (r.notFoundMark ? ' [404.html]' : '') +
          (r.ogImage ? ` og=${r.ogImage.slice(0, 60)}` : '')
        : '';
    const extra = (r.location ? ` -> ${r.location}` : '') + (r.xRobots ? ` [X-Robots-Tag: ${r.xRobots}]` : '');
    const mark = issues.length ? `  ✗ ${issues.join('; ')}` : '';
    console.log(`  ${String(r.status).padEnd(4)} ${r.kind.padEnd(8)} ${r.path}${extra} · ${r.type} ${r.bytes}B${seo}${mark}`);
  }
  if (all) {
    const pages = rows.filter(r => r.kind === 'page').length;
    const assets = rows.filter(r => r.path.startsWith('/assets/')).length;
    console.log(`  (--all: ${pages} páginas y ${assets} assets revisados; arriba, las filas fijas y las que fallan)`);
  }
  if (legacy) {
    const count = (kind: Kind) => rows.filter(r => r.kind === kind).length;
    console.log(
      `  (--legacy: ${rows.length} URLs revisadas: ${count('redirect')} redirecciones 301, ${count('notfound')} 404, ` +
        `${count('page') + count('spa')} páginas servidas o de destino; arriba, solo las que fallan)`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const compareIdx = args.indexOf('--compare');
  const jsonIdx = args.indexOf('--json');
  const all = args.includes('--all');
  const legacy = args.includes('--legacy');
  const compareBase = compareIdx >= 0 ? args[compareIdx + 1] : undefined;
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
  // La URL a revisar es el único argumento que no es una opción ni el valor de una
  const values = new Set([compareIdx, jsonIdx].filter(i => i >= 0).map(i => i + 1));
  const positional = args.filter((a, i) => !a.startsWith('--') && !values.has(i));
  const base = positional.length === 1 && /^https?:\/\//.test(positional[0]) ? positional[0] : undefined;
  const badCombo = legacy && (all || compareIdx >= 0);
  if (!base || (compareIdx >= 0 && !/^https?:\/\//.test(compareBase ?? '')) || (jsonIdx >= 0 && !jsonOut) || base === compareBase || badCombo) {
    console.error('Uso: npm run smoke -- <url> [--all] [--compare <url>] [--json <archivo>]');
    console.error('     npm run smoke -- <url> --legacy [--json <archivo>]');
    process.exit(2);
  }

  const rows = await runSmoke(base, { all, legacy });
  printRows(base, rows, all, legacy);
  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, JSON.stringify({ base, at: new Date().toISOString(), rows }, null, 2));
  }

  let failed = rows.flatMap(r => rowIssues(r).map(i => `${r.path} (${r.kind}): ${i}`));
  if (compareBase) {
    const other = await runSmoke(compareBase);
    const diffs = compareStable(rows, other);
    console.log(`\nComparado con ${compareBase}: ${diffs.length ? diffs.length + ' diferencias en api/ o archivos' : 'api/ y archivos iguales'}`);
    diffs.forEach(d => console.log(`  ${d}`));
    failed = [...failed, ...diffs];
  }
  if (failed.length) {
    console.error(`\nFALLA: ${failed.length} problema(s).`);
    failed.slice(0, 40).forEach(f => console.error(`  ${f}`));
    process.exit(1);
  }
  console.log('\nOK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
