// scripts/smoke.ts
// Chequeo de humo del sitio desplegado (Etapa 2): estado HTTP y etiquetas SEO de
// las rutas clave, archivos y funciones de api/. Se corre en cada preview y
// después de cada merge.
//
//   npm run smoke -- https://nuevo.elights.cl
//   npm run smoke -- https://nuevo.elights.cl --all   (además, todas las páginas del sitemap y sus assets)
//   npm run smoke -- <url-preview> --compare https://nuevo.elights.cl
//   npm run smoke -- <url> --json reports/smoke/produccion.json
//
// Solo hace GET. Los webhooks (Jumpseller, WhatsApp, Pipedrive) responden 405
// antes de procesar nada, así que el chequeo no tiene efectos.
//
// Cada fila se juzga según su tipo (PR 05, 404 reales):
//   page      200, HTML con canonical y sin noindex
//   spa       200, HTML con noindex (spa.html: /buscar, /cotizacion, /solicitar-pedido)
//   notfound  404, HTML con noindex y la marca de 404.html
//   redirect  307 al destino de la regla (/carro → /solicitar-pedido)
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

export type Kind = 'page' | 'spa' | 'notfound' | 'redirect' | 'file' | 'api' | 'observe';

export interface Target {
  path: string;
  kind: Kind;
  /** redirect: ruta a la que debe llevar. */
  to?: string;
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
    ...['/no-existe', '/producto/no-existe', '/catalogo/no-existe', '/catalogo/x/y'].map(as('notfound')),
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
    case 'redirect':
      status(307);
      want(!!r.location && new URL(r.location, 'https://x').pathname === r.to, `lleva a "${r.location}", se esperaba ${r.to}`);
      break;
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

export async function runSmoke(base: string, opts: { all?: boolean } = {}): Promise<Row[]> {
  const headers = bypassHeaders(base);
  const assets = new Set<string>();
  const safeRow = async (t: Target): Promise<Row> => {
    try {
      return await fetchRow(base, t, headers, assets);
    } catch (err) {
      return { ...t, ...EMPTY, status: 0, type: `ERROR ${redact((err as Error).message, headers)}`, location: '', xRobots: '', bytes: 0 };
    }
  };
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

function printRows(label: string, rows: Row[], all: boolean) {
  console.log(`\n${label}`);
  const fixed = new Set(buildTargets().map(t => t.path));
  for (const r of rows) {
    const issues = rowIssues(r);
    // Con --all, las páginas del sitemap y los assets que están bien no se listan (se resumen abajo)
    if (all && !issues.length && ((r.kind === 'page' && !fixed.has(r.path)) || r.path.startsWith('/assets/'))) continue;
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
}

async function main() {
  const args = process.argv.slice(2);
  const compareIdx = args.indexOf('--compare');
  const jsonIdx = args.indexOf('--json');
  const all = args.includes('--all');
  const compareBase = compareIdx >= 0 ? args[compareIdx + 1] : undefined;
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
  // La URL a revisar es el único argumento que no es una opción ni el valor de una
  const values = new Set([compareIdx, jsonIdx].filter(i => i >= 0).map(i => i + 1));
  const positional = args.filter((a, i) => !a.startsWith('--') && !values.has(i));
  const base = positional.length === 1 && /^https?:\/\//.test(positional[0]) ? positional[0] : undefined;
  if (!base || (compareIdx >= 0 && !/^https?:\/\//.test(compareBase ?? '')) || (jsonIdx >= 0 && !jsonOut) || base === compareBase) {
    console.error('Uso: npm run smoke -- <url> [--all] [--compare <url>] [--json <archivo>]');
    process.exit(2);
  }

  const rows = await runSmoke(base, { all });
  printRows(base, rows, all);
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
