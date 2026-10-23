import { describe, expect, it } from 'vitest';
import {
  PRERENDERED_FORMS,
  consentFacts,
  consentSummary,
  consentIssues,
  contentIssues,
  expectedOg,
  inspectHtml,
  isGuideRoute,
  isSyncBotBranch,
  legacyRedirectIssues,
  notFoundMarkerIssues,
  renamedRedirectIssues,
  structuralIssues,
  type ExpectedOg,
} from './check-prerender';
import { RENAMED_SITE_IDS } from '../src/data/catalog/renamed-ids';
import { DEFAULT_OG } from '../src/lib/seo/ogImage';
import { COOKIE_TEXTS } from '../src/lib/cookieTexts';
import { CONSENT_FORMS } from '../api/_lib/forms/consent';
import { STATIC_ROUTES } from '../src/lib/seo/routes';

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

describe('check-prerender: guías (plan del blog, §2.2 y §5.6)', () => {
  const GUIDE = '/guias/norma-luminica-ds-1-2022';
  const brand = expectedOg(DEFAULT_OG);
  const H1 = 'Norma lumínica (D.S. N°1/2022): qué revisar en un proyecto de alumbrado exterior';
  const ld = (...docs: object[]) => docs.map(d => `<script type="application/ld+json">${JSON.stringify(d)}</script>`).join('');
  const article = { '@type': 'Article', headline: H1 };
  const crumbs = { '@type': 'BreadcrumbList', itemListElement: [] };
  const guideHead = (extra: string, docs: object[] = [crumbs, article]) =>
    `<title>Norma lumínica | eLIGHTS</title>${extra}` +
    `<meta property="og:image" content="${brand.url}"/><meta property="og:image:width" content="1200"/>` +
    `<meta property="og:image:height" content="630"/><meta property="og:image:alt" content="eLIGHTS.cl"/>` +
    `<meta name="twitter:image" content="${brand.url}"/>${ld(...docs)}`;
  const guide = (extra: string, docs?: object[]) => inspectHtml(page({ head: guideHead(extra, docs), body: `<main><h1>${H1}</h1><p>Texto.</p></main>` }));
  const NOINDEX = '<meta name="robots" content="noindex, follow"/>';
  const CANONICAL = `<link rel="canonical" href="${SITE}${GUIDE}"/>`;
  const unindexed = (f: ReturnType<typeof guide>) =>
    structuralIssues(GUIDE, f, { indexable: false, unindexed: true, article: true, siteUrl: SITE, og: brand });

  it('una guía publicada sin indexar: estructura completa, con noindex y sin canonical', () => {
    expect(unindexed(guide(NOINDEX))).toEqual([]);
    expect(unindexed(guide(''))).toEqual(['guía sin indexar sin noindex']);
    expect(unindexed(guide(NOINDEX + CANONICAL))).toEqual([`guía sin indexar con canonical ["${SITE}${GUIDE}"]`]);
    // Igual que una indexable: un h1, la imagen de la marca y la app dibujada
    expect(unindexed(inspectHtml(page({ head: guideHead(NOINDEX), body: '' })))).toEqual(['la app está vacía', '0 h1 (0 visibles con texto); debe haber uno']);
  });

  it('la regla de siempre no cambia: una guía indexable con noindex bloquea', () => {
    const indexable = (f: ReturnType<typeof guide>) => structuralIssues(GUIDE, f, { indexable: true, article: true, siteUrl: SITE, og: brand });
    expect(indexable(guide(CANONICAL))).toEqual([]);
    expect(indexable(guide(CANONICAL + NOINDEX))).toEqual(['tiene noindex']);
  });

  it('toda guía trae un JSON-LD Article con el h1 como headline y sus migas, sin FAQPage', () => {
    expect(unindexed(guide(NOINDEX, [crumbs]))).toEqual(['0 JSON-LD Article (la guía debe tener uno)']);
    expect(unindexed(guide(NOINDEX, [crumbs, { ...article, headline: 'Otro título' }]))).toEqual([
      `el headline del JSON-LD Article ("Otro título") no es el h1 (${JSON.stringify(H1)})`,
    ]);
    expect(unindexed(guide(NOINDEX, [article]))).toEqual(['guía sin JSON-LD BreadcrumbList']);
    expect(unindexed(guide(NOINDEX, [crumbs, article, { '@type': 'FAQPage', mainEntity: [] }]))).toEqual(['guía con FAQPage (plan del blog, §1.6: no se emite)']);
  });

  it('reconoce las rutas de las guías', () => {
    expect(isGuideRoute(GUIDE)).toBe(true);
    for (const r of ['/guias', '/guias/', '/guias/a/b', '/catalogo/x']) expect(isGuideRoute(r), r).toBe(false);
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

describe('check-prerender: ids renombrados (PR 07) de productos no publicados', () => {
  // Las tablas reales (renamed-ids.ts y UNPUBLISHED_RENAMED); el catálogo y la build se simulan
  const all = Object.entries(RENAMED_SITE_IDS).map(([jid, r]) => ({ id: r.id, jumpseller_id: Number(jid) }));
  const total = Object.values(RENAMED_SITE_IDS).reduce((n, r) => n + r.previous.length, 0);
  const ufoNf8 = [24031164, 24040212, 24040292, 24043701];
  const published = all.filter(p => !ufoNf8.includes(p.jumpseller_id));
  const built = new Set(['catalogo/index.html', 'catalogo/campanas-led/index.html']);
  const exists = (file: string) => built.has(file);

  it('las UFO NF8 no publicadas van a su categoría: sin bloqueos ni avisos', () => {
    const r = renamedRedirectIssues(published, exists);
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.summary).toBe(
      `Ids renombrados: ${total} redirecciones 301 (${total - 4} a fichas, 4 a categorías o al catálogo); ` +
        '0 llegan a productos no publicados (dan 404); 0 productos publicados van a su categoría',
    );
  });

  it('sin la tabla (como antes), los 4 llegan a una ficha que no existe y avisan', () => {
    const r = renamedRedirectIssues(published, exists, {});
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toHaveLength(4);
    expect(r.warnings[0]).toBe(
      '/producto/w-ip65-24031164 → /producto/campana-led-ufo-nf8-100w-110lm-w-ip65 (Jumpseller 24031164): llega a un producto no publicado (da 404); ' +
        'agregarlo a UNPUBLISHED_RENAMED (scripts/redirects/build.ts) con su categoría y correr npm run redirects:write',
    );
    expect(r.summary).toContain('4 llegan a productos no publicados (dan 404)');
  });

  it('avisa si un producto de la tabla vuelve a publicarse (su 301 debe volver a la ficha)', () => {
    const r = renamedRedirectIssues([...published, all.find(p => p.jumpseller_id === 24031164)!], exists);
    expect(r.warnings).toEqual([
      '/producto/w-ip65-24031164 → /catalogo/campanas-led (Jumpseller 24031164): el producto se publica otra vez; ' +
        'quitarlo de UNPUBLISHED_RENAMED (scripts/redirects/build.ts) para que vuelva a su ficha y correr npm run redirects:write',
    ]);
  });

  it('bloquea si falta la página de la categoría o del catálogo de destino', () => {
    expect(renamedRedirectIssues(published, () => false, { 24031164: 'campanas-led', 24040212: null, 24040292: 'campanas-led', 24043701: 'campanas-led' }).blocking).toEqual([
      '/producto/w-ip65-24031164 → /catalogo/campanas-led (Jumpseller 24031164): esa página no se generó',
      '/producto/w-ip65-24040212 → /catalogo (Jumpseller 24040212): esa página no se generó',
      '/producto/w-ip65-24040292 → /catalogo/campanas-led (Jumpseller 24040292): esa página no se generó',
      '/producto/w-ip65-24043701 → /catalogo/campanas-led (Jumpseller 24043701): esa página no se generó',
    ]);
  });
});

describe('check-prerender: consentimiento (PR 13)', () => {
  const footer = `<footer><h3>Ayuda</h3><button type="button" class="text-left">${COOKIE_TEXTS.footerButton}</button></footer>`;
  const boxes = (checked = { privacy: false, marketing: false }) =>
    `<fieldset disabled=""><fieldset class="mb-5"><legend class="sr-only">Privacidad y novedades</legend>` +
    `<label><input id=":r1:" type="checkbox" name="consentPrivacy" aria-required="true"${checked.privacy ? ' checked=""' : ''}/> Leí la política</label>` +
    `<label><input id=":r2:" type="checkbox" name="consentMarketing"${checked.marketing ? ' checked=""' : ''}/> Novedades</label></fieldset></fieldset>`;
  const formPage = (inner = boxes(), form = 'cotizador') =>
    `<!doctype html><html lang="es"><head><title>x</title></head><body><div id="root"><header>eLIGHTS</header>` +
    `<main><h1>Cotizador</h1><div data-elights-form="${form}"><form>${inner}</form></div></main>${footer}</div></body></html>`;
  const plain = (head = '', body = '<main><h1>Inicio</h1></main>') =>
    `<!doctype html><html lang="es"><head><title>x</title>${head}</head><body><div id="root"><header>eLIGHTS</header>${body}${footer}</div></body></html>`;

  it('una página sin aviso, Google ni Meta, con el botón del pie, no tiene problemas', () => {
    const f = consentFacts(plain());
    expect(f).toEqual({ banners: 0, bannerText: false, google: [], meta: [], footerCookieButtons: 1, consentBoxes: [], forms: [] });
    expect(consentIssues(f, { footer: true })).toEqual([]);
  });

  it('un formulario con las dos casillas sin marcar dentro de su data-elights-form pasa', () => {
    const f = consentFacts(formPage());
    expect(f.consentBoxes).toEqual([
      { name: 'consentPrivacy', checked: false, form: 'cotizador' },
      { name: 'consentMarketing', checked: false, form: 'cotizador' },
    ]);
    expect(consentIssues(f, { footer: true, form: 'cotizador' })).toEqual([]);
  });

  it('detecta el aviso en el HTML (por su etiqueta o por su texto)', () => {
    const byLabel = plain('', `<section role="region" aria-label="${COOKIE_TEXTS.bannerLabel}"></section><main><h1>x</h1></main>`);
    const byText = plain('', `<div><p>${COOKIE_TEXTS.banner} <a href="/politica-de-privacidad">Política</a></p></div><main><h1>x</h1></main>`);
    for (const html of [byLabel, byText]) {
      expect(consentIssues(consentFacts(html), { footer: true })).toEqual([
        'trae el aviso de cookies en el HTML (debe aparecer solo en el navegador, después de hidratar)',
      ]);
    }
    // Hablar del aviso en minúscula (Política de privacidad §10) no es el aviso
    expect(consentIssues(consentFacts(plain('', '<main><h1>x</h1><p>Usa el aviso de cookies para decidir.</p></main>')), { footer: true })).toEqual([]);
  });

  it('detecta Google Analytics antes del consentimiento (script, preconexión o dataLayer)', () => {
    const tag = plain('<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script><script>window.dataLayer=[];function gtag(){dataLayer.push(arguments)}</script>');
    expect(consentIssues(consentFacts(tag), { footer: true })).toEqual([
      'trae Google Analytics antes del consentimiento: googletagmanager, gtag/js, dataLayer, gtag(',
    ]);
    const preconnect = plain('<link rel="preconnect" href="https://www.google-analytics.com"/>');
    expect(consentIssues(consentFacts(preconnect), { footer: true })).toEqual(['trae Google Analytics antes del consentimiento: google-analytics.com']);
  });

  it('detecta el píxel de Meta antes del consentimiento: su snippet, su <noscript> con la imagen o una llamada a fbq', () => {
    const snippet = plain(
      "<script>!function(f,b,e,v,n,t,s){n=f.fbq=function(){};t=b.createElement(e);t.src=v}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','590822921694460');fbq('track','PageView');</script>",
    );
    expect(consentIssues(consentFacts(snippet), { footer: true })).toEqual([
      'trae el píxel de Meta antes del consentimiento: connect.facebook.net, fbevents, fbq(',
    ]);
    const noscript = plain('<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=590822921694460&ev=PageView&noscript=1"/></noscript>');
    expect(consentIssues(consentFacts(noscript), { footer: true })).toEqual(['trae el píxel de Meta antes del consentimiento: facebook.com/tr']);
    // Nombrar a Meta, Facebook o el píxel en el texto (Política de privacidad, aviso) no es un rastro
    const text = plain('', '<main><h1>Privacidad</h1><p>Publicidad en Meta: el píxel de Meta mide nuestros anuncios en Facebook e Instagram (fbclid).</p></main>');
    expect(consentFacts(text).meta).toEqual([]);
    expect(consentIssues(consentFacts(text), { footer: true })).toEqual([]);
  });

  it('el botón «Configurar cookies» debe estar una vez en el pie (spa.html no lo exige)', () => {
    const noFooter = '<!doctype html><html lang="es"><head><title>x</title></head><body><div id="root"></div></body></html>';
    expect(consentIssues(consentFacts(noFooter), { footer: true })).toEqual(['0 botones «Configurar cookies» en el pie (debe haber uno)']);
    expect(consentIssues(consentFacts(noFooter), { footer: false })).toEqual([]);
    // El de la Política de privacidad §10 está en <main>: no cuenta como el del pie
    const inMain = plain('', `<main><h1>Privacidad</h1><button type="button">${COOKIE_TEXTS.footerButton}</button></main>`);
    expect(consentFacts(inMain).footerCookieButtons).toBe(1);
    const twice = plain().replace('</footer>', `<button type="button">${COOKIE_TEXTS.footerButton}</button></footer>`);
    expect(consentIssues(consentFacts(twice), { footer: true })).toEqual(['2 botones «Configurar cookies» en el pie (debe haber uno)']);
  });

  it('una casilla marcada, una que falta o un formulario sin data-elights-form bloquean', () => {
    expect(consentIssues(consentFacts(formPage(boxes({ privacy: true, marketing: false }))), { footer: true, form: 'cotizador' })).toEqual([
      'la casilla consentPrivacy viene marcada',
    ]);
    expect(consentIssues(consentFacts(formPage(boxes({ privacy: false, marketing: true }))), { footer: true, form: 'cotizador' })).toEqual([
      'la casilla consentMarketing viene marcada',
    ]);
    const onlyPrivacy = formPage(boxes().replace(/<label><input id=":r2:"[^]*?<\/label>/, ''));
    expect(consentIssues(consentFacts(onlyPrivacy), { footer: true, form: 'cotizador' })).toEqual([
      '0 casillas consentMarketing en el formulario cotizador (debe haber una)',
    ]);
    expect(consentIssues(consentFacts(formPage()), { footer: true, form: 'instalacion' })).toEqual([
      'sin data-elights-form="instalacion"',
      '0 casillas consentPrivacy en el formulario instalacion (debe haber una)',
      '0 casillas consentMarketing en el formulario instalacion (debe haber una)',
    ]);
    const outside = plain('', `<main><h1>x</h1>${boxes()}</main>`);
    expect(consentIssues(consentFacts(outside), { footer: true })).toEqual([
      'la casilla consentPrivacy está fuera de un data-elights-form',
      'la casilla consentMarketing está fuera de un data-elights-form',
    ]);
  });

  it('los formularios con página estática son páginas fijas y formularios del consentimiento', () => {
    expect(Object.keys(PRERENDERED_FORMS)).toEqual(['/cotizador', '/instalacion', '/estudio-luminico']);
    for (const [route, form] of Object.entries(PRERENDERED_FORMS)) {
      expect(STATIC_ROUTES).toContain(route);
      expect(CONSENT_FORMS).toContain(form);
    }
    // Los otros dos usan spa.html (dependen de la sesión)
    expect(STATIC_ROUTES).not.toContain('/solicitar-pedido');
    expect(STATIC_ROUTES).not.toContain('/cotizacion');
  });

  it('el resumen del registro dice «todo bien» solo si no hubo problemas de consentimiento', () => {
    const ok = consentSummary(0);
    expect(ok).toBe(
      `[check-prerender] Consentimiento: sin aviso de cookies, Google ni Meta en el HTML; «${COOKIE_TEXTS.footerButton}» en el pie; ` +
        'casillas sin marcar en /cotizador, /instalacion, /estudio-luminico',
    );
    // Con el aviso en el HTML (lo que encontró la mutación del aviso en el servidor): solo el conteo
    const withBanner = `<html><body><div id="root"><section role="region" aria-label="${COOKIE_TEXTS.bannerLabel}"></section><main><h1>x</h1></main></div></body></html>`;
    const problems = consentIssues(consentFacts(withBanner), { footer: true }).length;
    expect(problems).toBeGreaterThan(0);
    const bad = consentSummary(problems);
    expect(bad).toBe(`[check-prerender] Consentimiento: ${problems} problema(s)`);
    expect(bad).not.toMatch(/sin aviso|en el pie|sin marcar/);
  });
});
