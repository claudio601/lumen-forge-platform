// scripts/legal-archive.ts
// ─────────────────────────────────────────────────────────────────────────────
// Archivo permanente de los textos legales (Etapa 2 · PR 13). Escribe
// public/legal/<página>-v<LEGAL_VERSION>.html para Términos y condiciones, Política de
// privacidad y Cambios, devoluciones y garantía: el mismo texto que dibuja la página, en un
// HTML autónomo (CSS mínimo en línea, sin scripts, noindex) que se puede guardar o imprimir.
// Así se sabe qué texto aceptó cada quien (consent_json guarda la versión) y se cumple
// Términos §3.6 (copia de los términos vigentes al pagar; Ley 19.496, art. 12 A).
//
//   npm run legal:archive               escribe los archivos de la versión vigente
//   npm run legal:archive -- --check    solo compara; sale con 1 si falta o difiere alguno
//
// Las versiones de LEGAL_ARCHIVE (anteriores) nunca se tocan. Al cambiar un texto legal:
// sube las constantes de api/_lib/forms/consent.ts (la versión anterior pasa a
// LEGAL_ARCHIVE) y corre este script. scripts/legal-archive.test.ts falla si la página
// cambia sin regenerar el archivo de su versión.
//
// Las páginas se cargan con el servidor de Vite (alias @/ y JSX de vite.config.ts) y se
// dibujan con renderToStaticMarkup, como en el prerender (StaticRouter). Sin red.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import {
  LEGAL_ARCHIVE,
  LEGAL_UPDATED,
  LEGAL_UPDATED_LABEL,
  LEGAL_VERSION,
  LEGAL_VERSIONED_PATHS,
  legalArchiveHref,
  type LegalVersionedPath,
} from '../api/_lib/forms/consent';
import { legalPage } from '../src/config/legal';
import { LEGAL_NAME, SITE_NAME } from '../src/config/site';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Módulo (ruta de Vite) de cada página con versión. */
const PAGE_MODULES: Record<LegalVersionedPath, string> = {
  '/terminos-y-condiciones': '/src/pages/TerminosPage.tsx',
  '/politica-de-privacidad': '/src/pages/PrivacidadPage.tsx',
  '/cambios-devoluciones-y-garantia': '/src/pages/CambiosGarantiaPage.tsx',
};

/** Archivo en disco de una página en una versión (public/legal/<página>-v<versión>.html). */
export function archiveFile(pagePath: LegalVersionedPath, version: string = LEGAL_VERSION): string {
  return join(ROOT, 'public', legalArchiveHref(pagePath, version));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Texto visible de un trozo de HTML: sin etiquetas, con las entidades resueltas y los espacios juntos. */
export function normalizeText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
      if (ref[0] === '#') {
        const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[ref.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Contenido del <article> de una página legal, listo para el archivo: sin la navegación
 * («Más información», enlaces del sitio y no texto legal), sin lo marcado con
 * data-legal-archive="omit", sin clases (Tailwind no existe en el archivo) y con los
 * botones como texto en negrita: el archivo no tiene scripts, así que un botón (como
 * «Configurar cookies» de la Política §10) no haría nada. El texto visible no cambia.
 */
export function extractArticle(markup: string): string {
  const match = markup.match(/<article\b[^>]*>([\s\S]*)<\/article>/);
  if (!match) throw new Error('La página no tiene <article>');
  return match[1]
    .replace(/<nav\b[\s\S]*?<\/nav>/g, '')
    .replace(/<(\w+)\b[^>]*\sdata-legal-archive="omit"[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/\sclass="[^"]*"/g, '')
    .replace(/<button\b[^>]*>([\s\S]*?)<\/button>/g, '<strong>$1</strong>')
    .trim();
}

type Loader = (id: string) => Promise<Record<string, unknown>>;

/** Corre fn con un servidor de Vite (sin HTTP ni recarga) que carga módulos de src/ como en el prerender. */
async function withViteLoader<T>(fn: (load: Loader) => Promise<T>): Promise<T> {
  const { createServer } = await import('vite');
  // Caché propia y temporal: el optimizador de dependencias del navegador (que el plugin de
  // React activa) no escribe en node_modules/.vite, compartida con `npm run dev`.
  const cacheDir = mkdtempSync(join(tmpdir(), 'legal-archive-vite-'));
  try {
    const server = await createServer({
      root: ROOT,
      configFile: join(ROOT, 'vite.config.ts'),
      // 'production': sin el etiquetador de componentes de desarrollo (agrega atributos).
      mode: 'production',
      logLevel: 'error',
      appType: 'custom',
      cacheDir,
      server: { middlewareMode: true, hmr: false, watch: null },
      // Solo ssrLoadModule: nada que descubrir para el navegador.
      optimizeDeps: { noDiscovery: true },
    });
    try {
      return await fn(id => server.ssrLoadModule(id));
    } finally {
      await server.close();
    }
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

/** Dibuja cada página con versión y devuelve el contenido de su <article> (extractArticle). */
export async function renderLegalArticles(): Promise<Record<LegalVersionedPath, string>> {
  return withViteLoader(async load => {
    // El mismo react-helmet-async que usa <Seo> (vite.config lo incluye en el SSR).
    const { HelmetProvider } = (await load('react-helmet-async')) as {
      HelmetProvider: ComponentType<{ context?: object; children?: ReactNode }>;
    };
    const out = {} as Record<LegalVersionedPath, string>;
    for (const path of LEGAL_VERSIONED_PATHS) {
      const page = (await load(PAGE_MODULES[path])).default as ComponentType;
      const markup = renderToStaticMarkup(
        createElement(HelmetProvider, { context: {} }, createElement(StaticRouter, { location: path }, createElement(page)))
      );
      out[path] = extractArticle(markup);
    }
    return out;
  });
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = [
  'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.6;color:#1a1a1a;background:#fff;max-width:46rem;margin:0 auto;padding:1.5rem 1rem 3rem}',
  '.archivo{border:1px solid #c8c8c8;background:#f5f5f5;padding:.75rem 1rem;margin:0 0 2rem;font-size:.9rem}',
  'h1{font-size:1.75rem;line-height:1.25;margin:0 0 .75rem}h2{font-size:1.25rem;margin-top:2rem}h3{font-size:1.05rem}',
  'a{color:#0b57d0}table{border-collapse:collapse;width:100%;font-size:.9rem}',
  'th,td{border:1px solid #c8c8c8;padding:.4rem .5rem;text-align:left;vertical-align:top}',
  '@media print{body{max-width:none;padding:0}.archivo{background:none}a{color:inherit}}',
].join('');

export interface ArchiveInput {
  pagePath: LegalVersionedPath;
  /** Contenido del <article> (extractArticle). */
  article: string;
  version?: string;
  updated?: string;
  updatedLabel?: string;
  /** Versiones anteriores que enlaza el encabezado; por defecto, las de LEGAL_ARCHIVE más antiguas que `version`. */
  previous?: readonly string[];
}

/** a es anterior a b (versiones X.Y). */
function olderVersion(a: string, b: string): boolean {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 < b1 || (a1 === b1 && a2 < b2);
}

/** HTML autónomo del archivo permanente de una página en una versión. */
export function buildArchiveHtml({
  pagePath,
  article,
  version = LEGAL_VERSION,
  updated = LEGAL_UPDATED,
  updatedLabel = LEGAL_UPDATED_LABEL,
  previous = LEGAL_ARCHIVE.filter(v => olderVersion(v, version)),
}: ArchiveInput): string {
  const label = escapeHtml(legalPage(pagePath).label);
  // Política §12: «desde el enlace al comienzo de esta página, donde también están las anteriores»
  const previousLinks = previous.length
    ? ` Versiones anteriores: ${previous.map(v => `<a href="${legalArchiveHref(pagePath, v)}">${escapeHtml(v)}</a>`).join(', ')}.`
    : '';
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${label} — versión ${escapeHtml(version)} | ${escapeHtml(SITE_NAME)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<header class="archivo"><p><strong>${label} — versión ${escapeHtml(version)}, vigente desde el <time datetime="${escapeHtml(updated)}">${escapeHtml(updatedLabel)}</time>.</strong> Copia permanente de ${escapeHtml(LEGAL_NAME)} para guardar o imprimir. La versión vigente está en la página <a href="${pagePath}">${label}</a>.${previousLinks}</p></header>`,
    `<main id="texto-legal" data-version="${escapeHtml(version)}">`,
    `<article>${article}</article>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** El <article> de un archivo ya escrito (para comparar su texto con la página). */
export function archivedArticle(html: string): string {
  const match = html.match(/<main id="texto-legal"[^>]*>\s*<article>([\s\S]*)<\/article>\s*<\/main>/);
  if (!match) throw new Error('El archivo no tiene <main id="texto-legal"><article>');
  return match[1];
}

export interface ArchiveStatus {
  pagePath: LegalVersionedPath;
  file: string;
  /** 'ok': igual; 'missing': no existe; 'stale': el texto de la página cambió. */
  status: 'ok' | 'missing' | 'stale';
  html: string;
}

/** Compara (sin escribir) el archivo de la versión vigente de cada página con la página dibujada. */
export async function legalArchiveStatus(): Promise<ArchiveStatus[]> {
  if (LEGAL_ARCHIVE.includes(LEGAL_VERSION)) {
    throw new Error(`LEGAL_VERSION ${LEGAL_VERSION} también está en LEGAL_ARCHIVE: sube la versión vigente`);
  }
  const articles = await renderLegalArticles();
  return LEGAL_VERSIONED_PATHS.map(pagePath => {
    const file = archiveFile(pagePath);
    const html = buildArchiveHtml({ pagePath, article: articles[pagePath] });
    if (!existsSync(file)) return { pagePath, file, status: 'missing' as const, html };
    const current = readFileSync(file, 'utf-8');
    return { pagePath, file, status: current === html ? ('ok' as const) : ('stale' as const), html };
  });
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const statuses = await legalArchiveStatus();
  let failed = false;
  for (const s of statuses) {
    const rel = s.file.slice(ROOT.length + 1);
    if (s.status === 'ok') {
      console.log(`igual      ${rel}`);
    } else if (check) {
      failed = true;
      console.error(`${s.status === 'missing' ? 'falta     ' : 'distinto  '} ${rel}`);
    } else {
      mkdirSync(dirname(s.file), { recursive: true });
      writeFileSync(s.file, s.html, 'utf-8');
      console.log(`${s.status === 'missing' ? 'creado    ' : 'actualizado'} ${rel}`);
    }
  }
  for (const version of LEGAL_ARCHIVE) {
    for (const pagePath of LEGAL_VERSIONED_PATHS) {
      if (!existsSync(archiveFile(pagePath, version))) {
        failed = true;
        console.error(`falta la versión anterior ${version}: ${legalArchiveHref(pagePath, version)}`);
      }
    }
  }
  if (failed) {
    console.error(check ? 'Corre npm run legal:archive y revisa la versión.' : 'Faltan archivos de versiones anteriores.');
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
