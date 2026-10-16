// scripts/legal-archive.test.ts
// Archivo permanente de los textos legales (Etapa 2 · PR 13): para cada página con versión
// existe public/legal/<página>-v<LEGAL_VERSION>.html, sin scripts y con noindex, y su texto
// es el mismo que dibuja hoy la página. Cambiar un texto legal sin subir la versión y
// regenerar (npm run legal:archive) hace fallar esta prueba. Las versiones de
// LEGAL_ARCHIVE siguen publicadas.

import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
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
import {
  archiveFile,
  archivedArticle,
  buildArchiveHtml,
  extractArticle,
  normalizeText,
  renderLegalArticles,
} from './legal-archive';

describe('funciones puras', () => {
  it('normalizeText: sin etiquetas, entidades resueltas y espacios juntos', () => {
    expect(normalizeText('<p>Hola&nbsp;<strong>Ana</strong></p>\n<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &#8212;</p>')).toBe(
      "Hola Ana a & b <c> \"d\" 'e' —"
    );
  });

  it('extractArticle: solo el <article>, sin la navegación, sin lo marcado omit y sin clases', () => {
    const markup =
      '<div class="container"><article class="max-w-3xl"><h1 class="t">Título</h1>' +
      '<p class="x" data-legal-archive="omit">Guardar o imprimir</p><p>Texto</p>' +
      '<nav aria-label="Más información" class="mt-10"><ul><li><a href="/despacho">Despacho</a></li></ul></nav></article></div>';
    expect(extractArticle(markup)).toBe('<h1>Título</h1><p>Texto</p>');
    expect(() => extractArticle('<div>sin artículo</div>')).toThrow();
  });

  it('extractArticle: un botón (sin scripts no haría nada) queda como texto en negrita, con el mismo texto visible', () => {
    const markup = '<article><p>Con el botón <button type="button" class="font-medium">Configurar cookies</button>, aquí.</p></article>';
    const article = extractArticle(markup);
    expect(article).toBe('<p>Con el botón <strong>Configurar cookies</strong>, aquí.</p>');
    expect(normalizeText(article)).toBe(normalizeText(markup));
  });

  it('buildArchiveHtml: encabezado de copia permanente, enlace a la vigente, noindex y sin scripts', () => {
    const html = buildArchiveHtml({
      pagePath: '/terminos-y-condiciones',
      article: '<h1>T</h1><p>Texto</p>',
      version: '9.9',
      updated: '2030-01-02',
      updatedLabel: '2 de enero de 2030',
      previous: [],
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(
      '<header class="archivo"><p><strong>Términos y condiciones — versión 9.9, vigente desde el <time datetime="2030-01-02">2 de enero de 2030</time>.</strong>' +
        ' Copia permanente de eLIGHTS.CL SpA para guardar o imprimir.' +
        ' La versión vigente está en la página <a href="/terminos-y-condiciones">Términos y condiciones</a>.</p></header>'
    );
    expect(html).toContain('<title>Términos y condiciones — versión 9.9 | eLIGHTS.cl</title>');
    expect(archivedArticle(html)).toBe('<h1>T</h1><p>Texto</p>');
  });

  it('buildArchiveHtml: el encabezado enlaza las versiones anteriores (por defecto, las de LEGAL_ARCHIVE más antiguas)', () => {
    const input = { pagePath: '/politica-de-privacidad' as const, article: '<p>x</p>', version: '2.0', updated: '2030-01-02', updatedLabel: '2 de enero de 2030' };
    expect(buildArchiveHtml({ ...input, previous: ['1.0', '1.1'] })).toContain(
      ' La versión vigente está en la página <a href="/politica-de-privacidad">Política de privacidad</a>.' +
        ' Versiones anteriores: <a href="/legal/politica-de-privacidad-v1.0.html">1.0</a>, <a href="/legal/politica-de-privacidad-v1.1.html">1.1</a>.</p></header>'
    );
    const byDefault = buildArchiveHtml(input);
    for (const v of LEGAL_ARCHIVE) expect(byDefault).toContain(`<a href="/legal/politica-de-privacidad-v${v}.html">${v}</a>`);
    // La primera versión no tiene anteriores
    expect(buildArchiveHtml({ ...input, version: '0.9' })).not.toContain('Versiones anteriores');
  });

  it('archiveFile: public/legal/<página>-v<versión>.html', () => {
    expect(archiveFile('/politica-de-privacidad', '1.0').replace(/\\/g, '/')).toMatch(/\/public\/legal\/politica-de-privacidad-v1\.0\.html$/);
  });
});

describe(`archivo de la versión vigente (${LEGAL_VERSION})`, () => {
  let rendered: Record<LegalVersionedPath, string>;

  // Carga las páginas con el servidor de Vite (sin red): unos segundos.
  beforeAll(async () => {
    rendered = await renderLegalArticles();
  }, 60_000);

  it.each(LEGAL_VERSIONED_PATHS)('%s: el archivo existe y su texto es el de la página', pagePath => {
    const file = archiveFile(pagePath);
    expect(existsSync(file), `falta ${file}: corre npm run legal:archive`).toBe(true);
    const html = readFileSync(file, 'utf-8');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`versión ${LEGAL_VERSION}, vigente desde el <time datetime="${LEGAL_UPDATED}">${LEGAL_UPDATED_LABEL}</time>`);
    expect(html).toContain(`<a href="${pagePath}">${legalPage(pagePath).label}</a>`);
    // Política §12: al comienzo, los enlaces a las versiones anteriores; y ningún botón sin función
    for (const v of LEGAL_ARCHIVE) expect(html).toContain(`<a href="${legalArchiveHref(pagePath, v)}">${v}</a>`);
    expect(html).not.toMatch(/<button/i);

    const page = normalizeText(rendered[pagePath]);
    expect(page.length).toBeGreaterThan(1000);
    expect(page).toContain(`Versión ${LEGAL_VERSION}.`);
    expect(
      normalizeText(archivedArticle(html)),
      `${pagePath} cambió y su archivo v${LEGAL_VERSION} no: sube LEGAL_VERSION (api/_lib/forms/consent.ts) y corre npm run legal:archive`
    ).toBe(page);
    // El archivo es exactamente lo que escribe el script (sin ediciones a mano).
    expect(html).toBe(buildArchiveHtml({ pagePath, article: rendered[pagePath] }));
  });
});

describe('versiones anteriores (LEGAL_ARCHIVE)', () => {
  it.each(LEGAL_ARCHIVE.flatMap(version => LEGAL_VERSIONED_PATHS.map(pagePath => [version, pagePath] as const)))(
    'v%s de %s sigue publicada, con noindex',
    (version, pagePath) => {
      const file = archiveFile(pagePath, version);
      expect(existsSync(file), `falta ${file}`).toBe(true);
      const html = readFileSync(file, 'utf-8');
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain(`versión ${version}, vigente desde el`);
      expect(html).not.toMatch(/<script/i);
    }
  );

  it('la versión vigente no está entre las anteriores', () => {
    expect(LEGAL_ARCHIVE).not.toContain(LEGAL_VERSION);
  });
});
