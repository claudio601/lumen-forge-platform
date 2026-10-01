// scripts/smoke.ts
// Chequeo de humo del sitio desplegado (Etapa 2): estado HTTP y etiquetas SEO de
// las rutas clave, archivos y funciones de api/. Se corre en cada preview y
// después de cada merge.
//
//   npm run smoke -- https://nuevo.elights.cl
//   npm run smoke -- <url-preview> --compare https://nuevo.elights.cl
//   npm run smoke -- <url> --json reports/smoke/produccion.json
//
// Solo hace GET. Los webhooks (Jumpseller, WhatsApp, Pipedrive) responden 405
// antes de procesar nada, así que el chequeo no tiene efectos.
// Código de salida: 0 ok · 1 si una ruta responde 5xx, o si con --compare una
// fila de api/ o de archivos cambia de estado o de tipo · 2 uso incorrecto.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { products } from '../src/data/catalog/index';
import { categories } from '../src/data/catalog/categories.config';

export type Kind = 'page' | 'spa' | 'notfound' | 'file' | 'api';

export interface Target {
  path: string;
  kind: Kind;
}

export interface PageInfo {
  title: string;
  canonical: string;
  robots: string;
  ogImage: string;
  h1: number;
  jsonLd: number;
}

export interface Row extends Target, PageInfo {
  status: number;
  type: string;
  location: string;
  xRobots: string;
  bytes: number;
}

/** Rutas a revisar: las mismas en cada ejecución para poder comparar. */
export function buildTargets(): Target[] {
  const pages = ['/', '/catalogo', '/instalacion', '/estudio-luminico', '/instaladores', '/cotizador'];
  const productPaths = products.slice(0, 3).map(p => `/producto/${p.id}`);
  const categoryPaths = categories.slice(0, 3).map(c => `/catalogo/${c.slug}`);
  const datasheet = products.find(p => p.datasheetUrl)?.datasheetUrl;
  return [
    ...[...pages, ...productPaths, ...categoryPaths].map(path => ({ path, kind: 'page' as const })),
    ...['/buscar', '/cotizacion', '/solicitar-pedido', '/carro'].map(path => ({ path, kind: 'spa' as const })),
    ...['/no-existe', '/producto/no-existe', '/catalogo/x/y'].map(path => ({ path, kind: 'notfound' as const })),
    ...['/robots.txt', '/sitemap.xml', ...(datasheet ? [new URL(datasheet, 'https://x').pathname] : [])].map(path => ({
      path,
      kind: 'file' as const,
    })),
    ...[
      '/api/jumpseller/webhook',
      '/api/whatsapp/webhook',
      '/api/pipedrive/webhook',
      '/api/request-orders/create',
      '/api/quotes/create',
    ].map(path => ({ path, kind: 'api' as const })),
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
  };
}

const EMPTY: PageInfo = { title: '', canonical: '', robots: '', ogImage: '', h1: 0, jsonLd: 0 };

async function fetchRow(base: string, target: Target): Promise<Row> {
  const res = await fetch(new URL(target.path, base), {
    redirect: 'manual',
    headers: { 'User-Agent': 'eLIGHTS-smoke/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const body = target.kind === 'file' && type !== 'text/html' ? '' : await res.text();
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

/** Un recurso con hash de la build (el JS principal), tomado del HTML del inicio. */
async function hashedAsset(base: string): Promise<Target[]> {
  const html = await (await fetch(new URL('/', base), { signal: AbortSignal.timeout(20_000) })).text();
  const src = html.match(/src=["'](\/assets\/[^"']+\.js)["']/)?.[1];
  return src ? [{ path: src, kind: 'file' }] : [];
}

export async function runSmoke(base: string): Promise<Row[]> {
  const targets = [...buildTargets(), ...(await hashedAsset(base))];
  const rows: Row[] = [];
  for (const t of targets) {
    try {
      rows.push(await fetchRow(base, t));
    } catch (err) {
      rows.push({ ...t, ...EMPTY, status: 0, type: `ERROR ${(err as Error).message}`, location: '', xRobots: '', bytes: 0 });
    }
  }
  return rows;
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

function printRows(label: string, rows: Row[]) {
  console.log(`\n${label}`);
  for (const r of rows) {
    const seo = r.type === 'text/html'
      ? ` · title="${r.title.slice(0, 50)}" h1=${r.h1} jsonld=${r.jsonLd}` +
        (r.canonical ? ` canonical=${r.canonical}` : '') +
        (r.robots ? ` robots=${r.robots}` : '') +
        (r.ogImage ? ` og=${r.ogImage.slice(0, 60)}` : '')
      : '';
    const extra = (r.location ? ` -> ${r.location}` : '') + (r.xRobots ? ` [X-Robots-Tag: ${r.xRobots}]` : '');
    console.log(`  ${String(r.status).padEnd(4)} ${r.kind.padEnd(8)} ${r.path}${extra} · ${r.type} ${r.bytes}B${seo}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const base = args.find(a => /^https?:\/\//.test(a));
  const compareIdx = args.indexOf('--compare');
  const jsonIdx = args.indexOf('--json');
  const compareBase = compareIdx >= 0 ? args[compareIdx + 1] : undefined;
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
  if (!base || (compareIdx >= 0 && !compareBase) || (jsonIdx >= 0 && !jsonOut)) {
    console.error('Uso: npm run smoke -- <url> [--compare <url>] [--json <archivo>]');
    process.exit(2);
  }

  const rows = await runSmoke(base);
  printRows(base, rows);
  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, JSON.stringify({ base, at: new Date().toISOString(), rows }, null, 2));
  }

  let failed = rows.filter(r => r.status >= 500 || r.status === 0).map(r => `${r.path}: ${r.status} ${r.type}`);
  if (compareBase) {
    const other = await runSmoke(compareBase);
    const diffs = compareStable(rows, other);
    console.log(`\nComparado con ${compareBase}: ${diffs.length ? diffs.length + ' diferencias en api/ o archivos' : 'api/ y archivos iguales'}`);
    diffs.forEach(d => console.log(`  ${d}`));
    failed = [...failed, ...diffs];
  }
  if (failed.length) {
    console.error(`\nFALLA: ${failed.length} problema(s).`);
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
