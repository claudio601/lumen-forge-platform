import { describe, expect, it } from 'vitest';
import { contentIssues, inspectHtml, isSyncBotBranch, structuralIssues } from './check-prerender';

const SITE = 'https://sitio.test';
const ROUTE = '/producto/x';

function page(opts: { head?: string; body?: string; lang?: string } = {}) {
  const head =
    opts.head ??
    `<title>Proyector | eLIGHTS</title><link rel="canonical" href="${SITE}${ROUTE}"/>` +
      `<meta property="og:image" content="https://images.jumpseller.com/store/elights-cl/1/Foto_Área.png?1582811881"/>` +
      `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":19900}}</script>`;
  const body = opts.body ?? '<header>eLIGHTS</header><main><h1>PROYECTOR LED</h1><p>Despacho en hasta 2 días hábiles.</p></main><footer>Pie</footer>';
  return `<!doctype html><html lang="${opts.lang ?? 'es'}"><head>${head}</head><body><div id="root">${body}</div></body></html>`;
}

const check = (html: string, price: number | undefined = 19900) =>
  structuralIssues(ROUTE, inspectHtml(html), { indexable: true, price, siteUrl: SITE });

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
    expect(check(page({ head: head.replace(/Foto_Área\.png\?1582811881/, 'logo.svg') }))[0]).toMatch(/^og:image no es una foto/);
    expect(check(page({ head: head.replace('https://images', 'http://images') }))[0]).toMatch(/^og:image no es una foto/);
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
