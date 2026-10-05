import { describe, expect, it } from 'vitest';
import {
  contentIssues,
  expectedOg,
  inspectHtml,
  isSyncBotBranch,
  legacyRedirectIssues,
  notFoundMarkerIssues,
  structuralIssues,
  type ExpectedOg,
} from './check-prerender';
import { DEFAULT_OG } from '../src/lib/seo/ogImage';

const SITE = 'https://sitio.test';
const ROUTE = '/producto/x';
// Foto con tilde en el nombre, ya codificada (como la emite <Seo>)
const OG = 'https://images.jumpseller.com/store/elights-cl/1/Foto_%C3%81rea.png?1582811881';
const EXPECTED_OG: ExpectedOg = { url: OG, width: 600, height: 600 };

function page(opts: { head?: string; body?: string; lang?: string } = {}) {
  const head =
    opts.head ??
    `<title>Proyector | eLIGHTS</title><link rel="canonical" href="${SITE}${ROUTE}"/>` +
      `<meta property="og:image" content="${OG}"/><meta property="og:image:width" content="600"/>` +
      `<meta property="og:image:height" content="600"/><meta property="og:image:alt" content="PROYECTOR LED"/>` +
      `<meta name="twitter:image" content="${OG}"/>` +
      `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":19900}}</script>`;
  const body = opts.body ?? '<header>eLIGHTS</header><main><h1>PROYECTOR LED</h1><p>Despacho en hasta 2 días hábiles.</p></main><footer>Pie</footer>';
  return `<!doctype html><html lang="${opts.lang ?? 'es'}"><head>${head}</head><body><div id="root">${body}</div></body></html>`;
}

const check = (html: string, price: number | undefined = 19900, og: ExpectedOg = EXPECTED_OG) =>
  structuralIssues(ROUTE, inspectHtml(html), { indexable: true, price, siteUrl: SITE, og });

describe('check-prerender: estructura', () => {
  it('una ficha completa no tiene problemas', () => {
    expect(check(page())).toEqual([]);
  });

  it('lee el texto de <main>, la cabecera y el pie aparte, y el JSON-LD sin tocarlo', () => {
    const f = inspectHtml(page());
    expect(f.mainText).toBe('PROYECTOR LED Despacho en hasta 2 días hábiles.');
    expect(f.chromeText).toBe('eLIGHTS Pie');
    expect(JSON.parse(f.jsonLd[0])).toEqual({ '@type': 'Product', offers: { '@type': 'Offer', price: 19900 } });
  });

  it('detecta título, idioma, h1, canonical, noindex e imagen para compartir', () => {
    expect(check(page({ lang: 'en' }))).toEqual(['idioma "en" en vez de "es"']);
    expect(check(page({ head: page().match(/<head>(.*)<\/head>/)![1].replace(/<title>.*?<\/title>/, '') }))).toEqual([
      '0 títulos (debe haber uno, con texto)',
    ]);
    expect(check(page({ body: '<main><h1>A</h1><h1>B</h1></main>' }))[0]).toMatch(/^2 h1/);
    expect(check(page({ body: '<main><div class="sr-only"><h1>A</h1></div></main>' }))[0]).toMatch(/^1 h1 \(0 visibles/);
    expect(check(page({ body: '<main><h1 class="hidden md:block">A</h1></main>' }))[0]).toMatch(/^1 h1 \(0 visibles/);
    const head = page().match(/<head>(.*)<\/head>/)![1];
    expect(check(page({ head: head.replace(ROUTE, '/producto/y') }))[0]).toMatch(/^canonical/);
    expect(check(page({ head: head + '<meta name="robots" content="noindex, follow"/>' }))).toEqual(['tiene noindex']);
    expect(check(page({ head: head.replace(/Foto_%C3%81rea\.png\?1582811881/, 'logo.svg') }))[0]).toMatch(/^og:image no es JPEG ni PNG https/);
    expect(check(page({ head: head.replace('https://images', 'http://images') }))[0]).toMatch(/^og:image no es JPEG ni PNG https/);
  });

  it('imagen para compartir: JPEG o PNG https, ya codificada, la esperada, con sus medidas, texto alternativo y la misma en twitter:image', () => {
    const head = page().match(/<head>(.*)<\/head>/)![1];
    const withOg = (url: string) => page({ head: head.split(OG).join(url) });
    const webp = OG.replace('.png', '.webp');
    expect(check(withOg(webp), 19900, { ...EXPECTED_OG, url: webp })).toEqual([`og:image no es JPEG ni PNG https: ${webp}`]);
    const raw = OG.replace('%C3%81', 'Á');
    expect(check(withOg(raw), 19900, { ...EXPECTED_OG, url: raw })).toEqual([`og:image sin codificar: ${raw}`]);
    // distinta de la que da la regla (p. ej. la foto pesada en vez de la imagen de la marca)
    const brand = expectedOg(DEFAULT_OG);
    expect(check(page(), 19900, brand)).toEqual([`og:image ${OG} en vez de ${brand.url}`, 'og:image:width/height 600×600 en vez de 1200×630']);
    expect(check(page(), 19900, { url: OG })).toEqual(['og:image:width/height 600×600 en vez de sin medidas']);
    expect(check(page({ head: head.replace(/<meta property="og:image:(width|height)"[^>]*>/g, '') }))).toEqual([
      'og:image:width/height sin medidas en vez de 600×600',
    ]);
    expect(check(page({ head: head.replace(/<meta property="og:image:height"[^>]*>/, '') }))).toEqual(['og:image:width/height 600× en vez de 600×600']);
    expect(check(page({ head: head.replace(`name="twitter:image" content="${OG}"`, 'name="twitter:image" content="https://otra.test/x.png"') }))).toEqual([
      'twitter:image ["https://otra.test/x.png"] distinta de og:image',
    ]);
    expect(check(page({ head: head.replace(/<meta property="og:image:alt"[^>]*>/, '') }))).toEqual(['og:image:alt falta o está vacío']);
    expect(check(page({ head: head.replace('content="PROYECTOR LED"', 'content=" "') }))).toEqual(['og:image:alt falta o está vacío']);
  });

  it('detecta JSON-LD que no se lee y precios distintos del catálogo', () => {
    const head = page().match(/<head>(.*)<\/head>/)![1];
    expect(check(page({ head: head.replace('"price":19900}}', '"price":19900}') }))).toEqual([
      'JSON-LD que no se lee: {"@type":"Product","offers":{"@type":"Offer","price":19900}',
      'ficha sin JSON-LD de producto',
    ]);
    expect(check(page(), 21900)).toEqual(['precio del JSON-LD 19900 y en el catálogo 21900']);
  });

  it('detecta una página vacía o con partes sin dibujar', () => {
    expect(check(page({ body: '' }))).toContain('la app está vacía');
    expect(check(page({ body: '<main><h1>A</h1><!--$!--><div>cargando</div><!--/$--></main>' }))).toContain(
      'una parte quedó sin dibujar en el servidor',
    );
  });

  it('spa.html y 404.html deben llevar noindex', () => {
    const noindex = page({ head: '<title>x</title><meta name="robots" content="noindex, follow"/>', body: '' });
    expect(structuralIssues('/buscar', inspectHtml(noindex), { indexable: false })).toEqual([]);
    expect(structuralIssues('/buscar', inspectHtml(page()), { indexable: false })).toEqual(['sin noindex']);
  });
});

describe('check-prerender: marca de 404.html', () => {
  const marked = (h1 = '404') => `<html><body><div id="root" data-not-found=""><main><h1>${h1}</h1></main></div></body></html>`;

  it('404.html lleva la marca en #root y su h1 es "404"', () => {
    expect(notFoundMarkerIssues(marked(), true, inspectHtml(marked()).h1s)).toEqual([]);
    expect(notFoundMarkerIssues(page(), true, inspectHtml(page()).h1s)).toEqual([
      'la marca data-not-found debe estar una vez, en #root',
      'el h1 debería ser "404" (es ["PROYECTOR LED"])',
    ]);
  });

  it('ninguna otra página la lleva (se hidrataría como "no encontrada")', () => {
    expect(notFoundMarkerIssues(page(), false)).toEqual([]);
    expect(notFoundMarkerIssues(marked('Panel'), false)).toEqual(['lleva la marca de la página 404']);
  });
});

describe('check-prerender: contenido', () => {
  it('stock, despacho inmediato y plazos distintos de "hasta 2 días hábiles"', () => {
    expect(contentIssues('Producto en stock. Despacho inmediato. Envío en 24 horas a regiones.')).toEqual([
      'stock',
      'Despacho inmediato',
      'Envío en 24 horas',
    ]);
  });

  it('mira el contexto: "hasta 2 días hábiles", la autonomía de una batería y un ensayo de 48 horas no cuentan', () => {
    expect(
      contentIssues(
        'Despacho en hasta 2 días hábiles. Entrega 410 lm y hasta 3 horas de autonomía. Ensayo de niebla salina de 48 horas. Consultar disponibilidad.',
      ),
    ).toEqual([]);
  });

  it('la PR diaria del robot solo avisa (también cuando la PR se actualiza a mano)', () => {
    expect(isSyncBotBranch({ GITHUB_REF_NAME: 'bot/jumpseller-sync' })).toBe(true);
    expect(isSyncBotBranch({ GITHUB_REF_NAME: '61/merge', GITHUB_HEAD_REF: 'bot/jumpseller-sync' })).toBe(true);
    expect(isSyncBotBranch({ GITHUB_REF_NAME: '61/merge', GITHUB_HEAD_REF: 'stage2/04-prerender' })).toBe(false);
    expect(isSyncBotBranch({})).toBe(false);
  });
});

describe('check-prerender: URLs de elights.cl (PR 08)', () => {
  // Productos reales de las tablas congeladas: 2251059 (id del catálogo legado) y 4122715 (renombrado en la PR 07)
  const bola = { id: 'ampolleta-led-bola-9w-e27', jumpseller_id: 2251059, permalink: 'ampolleta-led-bola-9w-e27' };
  const nf3 = { id: 'campana-led-ufo-nf3-150w-150-lm-w-ip66', jumpseller_id: 4122715, permalink: 'campana-led-ufo-nf3-150w-150-lm/w-ip66' };
  const urls = [
    { source: '/', served: true as const },
    { source: '/ampolleta-led-bola-9w-e27', product: 2251059 },
    { source: '/campana-led-ufo-nf3-150w-150-lm/w-ip66', product: 4122715 },
    { source: '/campana_led', category: 'campanas-led' },
    { source: '/search', path: '/buscar' },
    { source: '/blog', pending: 'blog' },
    { source: '/pagina-basica', gone: 'relleno' },
  ];
  const built = new Set(['index.html', 'spa.html', 'catalogo/campanas-led/index.html']);
  const exists = (file: string) => built.has(file);

  it('todo en orden: sin bloqueos ni avisos, y el resumen cuenta cada tipo de fila', () => {
    const r = legacyRedirectIssues(urls, [bola, nf3], exists);
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.summary).toBe(
      'URLs de elights.cl: 4 redirecciones 301 (2 a fichas, 1 a categorías, 1 a páginas), 1 servidas, 1 404 definitivas, 1 pendientes; ' +
        '0 llegan a productos no publicados; 0 permalinks publicados sin fila',
    );
  });

  it('un producto que sale del catálogo solo avisa (también en la PR del robot): su fila pasa a la categoría a mano', () => {
    const r = legacyRedirectIssues(urls, [bola], exists);
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([
      '/campana-led-ufo-nf3-150w-150-lm/w-ip66 → /producto/campana-led-ufo-nf3-150w-150-lm-w-ip66: llega a un producto no publicado (da 404); cambiar su fila de legacy-urls.json a la categoría del producto',
    ]);
  });

  it('avisa de un producto publicado cuyo permalink de Jumpseller no tiene fila', () => {
    const nuevo = { id: 'panel-nuevo', jumpseller_id: 1, permalink: 'panel-nuevo' };
    expect(legacyRedirectIssues(urls, [bola, nf3, nuevo], exists).warnings).toEqual([
      '/panel-nuevo (Jumpseller 1): permalink publicado sin fila en legacy-urls.json; agregarla antes de la Etapa 3',
    ]);
  });

  it('bloquea si una fuente tapa un archivo de la build o si falta la página de un destino fijo', () => {
    const r = legacyRedirectIssues(urls, [bola, nf3], f => (f === 'campana_led/index.html' ? true : f === 'spa.html' ? false : exists(f)));
    expect(r.blocking).toEqual(['/campana_led: su 301 tapa el archivo dist/campana_led/index.html', '/search → /buscar: esa página no se generó']);
    // Una fuente con %XX se busca decodificada, como sirve Vercel los archivos
    const encoded = [{ source: '/p%C3%BAblico', category: 'solar' }];
    expect(legacyRedirectIssues(encoded, [], f => f === 'público' || f === 'catalogo/solar/index.html').blocking).toEqual([
      '/p%C3%BAblico: su 301 tapa el archivo dist/público',
    ]);
  });
});
