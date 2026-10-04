// scripts/prerender.ts
// Páginas estáticas (Etapa 2, PR 04): escribe el HTML completo de cada página indexable
// en dist/<ruta>/index.html, para que Google y las vistas previas de enlaces (WhatsApp,
// Facebook) lean el título, la descripción, el JSON-LD y el contenido sin ejecutar JS.
// El navegador "hidrata" ese HTML (src/main.tsx).
//
// Corre al final de `npm run build`, después de:
//   vite build                                         → dist/ (con .vite/manifest.json)
//   vite build --ssr src/entry-server.tsx --outDir dist-ssr
// Además escribe:
//   dist/spa.html: la app vacía, para las páginas que dependen de la sesión o de la
//     búsqueda (/buscar, /cotizacion, /solicitar-pedido; reescritura en vercel.json).
//   dist/404.html: la página "no encontrada". Vercel la sirve con estado 404 en toda URL
//     sin archivo ni regla (PR 05). Lleva NOT_FOUND_ATTR en #root (ver src/lib/notFound.ts).
// Las dos llevan noindex. Si una página falla al dibujarse, el build falla: Vercel
// mantiene el despliegue anterior.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NOT_FOUND_ATTR, NOT_FOUND_URL } from '../src/lib/notFound';

export { NOT_FOUND_URL };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const HEAD_MARK = '<!--app-head-->';
export const HTML_MARK = '<!--app-html-->';

export interface ManifestChunk {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
}
export type Manifest = Record<string, ManifestChunk>;

interface ServerEntry {
  render(url: string): Promise<{ html: string; head: string; files: string[] }>;
  indexableRoutes(): string[];
  SPA_HEAD: string;
}

/** Archivo de salida de una ruta: '/' → index.html, '/catalogo' → catalogo/index.html. */
export function outputPath(route: string): string {
  if (!/^\/[A-Za-z0-9._~%/-]*$/.test(route) || route.split('/').some(s => s === '..' || s === '.')) {
    throw new Error(`Ruta inválida para un archivo: ${route}`);
  }
  return join(decodeURIComponent(route).replace(/^\/+|\/+$/g, ''), 'index.html');
}

/** Archivos (JS y CSS) de un trozo y de los que importa, sin repetir. */
function chunkFiles(manifest: Manifest, key: string, seen = new Set<string>()): { js: string[]; css: string[] } {
  const out = { js: [] as string[], css: [] as string[] };
  if (seen.has(key) || !manifest[key]) return out;
  seen.add(key);
  const chunk = manifest[key];
  out.js.push(chunk.file);
  out.css.push(...(chunk.css ?? []));
  for (const dep of chunk.imports ?? []) {
    const sub = chunkFiles(manifest, dep, seen);
    out.js.push(...sub.js);
    out.css.push(...sub.css);
  }
  return out;
}

/**
 * <link> para precargar el trozo de la página y sus datos (por ejemplo el contenido de
 * la ficha), sin los que index.html ya carga. Así el navegador los pide junto con el
 * JS principal y no después.
 */
export function preloadLinks(manifest: Manifest, files: string[]): string {
  const entryKey = Object.keys(manifest).find(k => manifest[k].isEntry);
  const loaded = entryKey ? chunkFiles(manifest, entryKey) : { js: [], css: [] };
  const skip = new Set([...loaded.js, ...loaded.css]);
  const js = new Set<string>();
  const css = new Set<string>();
  for (const file of files) {
    if (!manifest[file]) throw new Error(`${file} no está en el manifiesto de Vite`);
    const f = chunkFiles(manifest, file);
    f.js.filter(x => !skip.has(x)).forEach(x => js.add(x));
    f.css.filter(x => !skip.has(x)).forEach(x => css.add(x));
  }
  return [
    ...[...css].map(f => `<link rel="stylesheet" crossorigin href="/${f}">`),
    ...[...js].map(f => `<link rel="modulepreload" crossorigin href="/${f}">`),
  ].join('');
}

/** Inserta la cabecera, el HTML de la app y las precargas en la plantilla de Vite. */
export function fillTemplate(template: string, head: string, html: string, preload = ''): string {
  for (const mark of [HEAD_MARK, HTML_MARK]) {
    if (template.split(mark).length !== 2) throw new Error(`La plantilla debe tener ${mark} exactamente una vez`);
  }
  if (!template.includes('</head>')) throw new Error('La plantilla no tiene </head>');
  // Funciones como reemplazo: el HTML puede traer "$&" o "$1", que replace() interpretaría.
  return template
    .replace(HEAD_MARK, () => head)
    .replace(HTML_MARK, () => html)
    .replace('</head>', () => `${preload}</head>`);
}

/** Marca el HTML de 404.html para que el navegador hidrate la página "no encontrada". */
export function markNotFound(html: string): string {
  const tag = '<div id="root">';
  const count = html.split(tag).length - 1;
  if (count !== 1) throw new Error(`404.html: se esperaba un ${tag} y hay ${count}`);
  return html.replace(tag, () => `<div id="root" ${NOT_FOUND_ATTR}="">`);
}

async function main() {
  const dist = resolve(ROOT, process.argv[2] ?? 'dist');
  const ssrEntry = resolve(ROOT, process.argv[3] ?? 'dist-ssr/entry-server.js');
  const templatePath = join(dist, 'index.html');
  const manifestPath = join(dist, '.vite/manifest.json');
  if (!existsSync(manifestPath) || !existsSync(ssrEntry)) {
    throw new Error('Falta el build: corre `vite build` y `vite build --ssr src/entry-server.tsx --outDir dist-ssr` antes');
  }
  const template = readFileSync(templatePath, 'utf8');
  if (!template.includes(HTML_MARK)) throw new Error('dist/index.html ya es una página generada: vuelve a correr `vite build`');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const { render, indexableRoutes, SPA_HEAD } = (await import(pathToFileURL(ssrEntry).href)) as ServerEntry;

  const write = (file: string, content: string) => {
    const path = join(dist, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  };
  const page = async (url: string) => {
    const { html, head, files } = await render(url);
    return fillTemplate(template, head, html, preloadLinks(manifest, files));
  };

  const started = Date.now();
  // spa.html antes que nada: index.html se sobrescribe con la portada.
  write('spa.html', fillTemplate(template, SPA_HEAD, ''));
  write('404.html', markNotFound(await page(NOT_FOUND_URL)));
  const routes = indexableRoutes();
  for (const route of routes) {
    try {
      write(outputPath(route), await page(route));
    } catch (err) {
      throw new Error(`No se pudo generar ${route}: ${err instanceof Error ? err.stack : err}`);
    }
  }
  rmSync(join(dist, '.vite'), { recursive: true, force: true });
  console.log(`[prerender] ${routes.length} páginas + spa.html + 404.html en ${Date.now() - started} ms`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(err => {
    console.error(`[prerender] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
