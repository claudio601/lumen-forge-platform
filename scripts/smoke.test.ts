import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetRefs, buildTargets, bypassHeaders, compareStable, inspectHtml, legacyTargets, newFunctions, rowIssues, runSmoke, inspectSitemap, robotsIssues, parseOrigin, type Row } from './smoke';
import { LEGACY_URLS } from './redirects/build';
import { SITE_URL } from '../src/config/site';
import { indexableRoutes } from '../src/lib/seo/routes';
import { buildRobots, buildSitemap } from './generate-sitemap';

const row = (path: string, kind: Row['kind'], status: number, type = 'application/json', extra: Partial<Row> = {}): Row => ({
  path, kind, status, type, location: '', xRobots: new URL(SITE_URL).hostname === 'nuevo.elights.cl' ? 'noindex' : '', bytes: 0, body: '',
  title: '', canonical: '', ogUrl: '', robots: '', ogImage: '', h1: 0, jsonLd: 0, notFoundMark: false,
  ...extra,
});

describe('chequeo de humo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lee título, canonical, og:url, robots, og:image, h1, JSON-LD y la marca de 404.html', () => {
    const html = `<html><head><title> Panel LED | eLIGHTS </title>
      <link rel="canonical" href="https://elights.cl/producto/x">
      <meta property="og:url" content="https://elights.cl/producto/x">
      <meta name="robots" content="noindex, follow">
      <meta property="og:image" content="https://cdn/x.png">
      <script type="application/ld+json">{}</script></head>
      <body><div id="root"><h1 class="t">Panel</h1></div></body></html>`;
    expect(inspectHtml(html)).toEqual({
      title: 'Panel LED | eLIGHTS',
      canonical: 'https://elights.cl/producto/x',
      ogUrl: 'https://elights.cl/producto/x',
      robots: 'noindex, follow',
      ogImage: 'https://cdn/x.png',
      h1: 1,
      jsonLd: 1,
      notFoundMark: false,
    });
    expect(inspectHtml('<div id="root" data-not-found=""><h1>404</h1></div>').notFoundMark).toBe(true);
  });

  it('revisa páginas, rutas sin prerender (con y sin barra final), /carro, ids renombrados, URLs de elights.cl, 404, archivos y las funciones de api/ (solo GET)', () => {
    const t = buildTargets();
    const paths = (k: string) => t.filter(x => x.kind === k).map(x => x.path);
    expect(paths('page')).toHaveLength(20); // /catalogo/ y 13 fijas (STATIC_ROUTES, con /guias), 3 fichas y 3 categorías
    expect(paths('page')).toEqual(expect.arrayContaining(['/empresa', '/medios-de-pago', '/politica-de-privacidad', '/guias']));
    // Guías «publicadas sin indexar» (plan del blog, §2.2): con su noindex, aparte de las páginas
    expect(paths('unindexed')).toEqual(['/guias/norma-luminica-ds-1-2022']);
    expect(paths('spa')).toEqual(expect.arrayContaining(['/cotizacion', '/cotizacion/', '/solicitar-pedido', '/solicitar-pedido/', '/buscar']));
    const nf3 = '/producto/campana-led-ufo-nf3-150w-150-lm-w-ip66';
    const solar = '/producto/alumbrado-publico-led-solar-150w-all-in-one-c-control-remoto';
    expect(t.filter(x => x.kind === 'redirect')).toEqual([
      { path: '/carro', kind: 'redirect', to: '/solicitar-pedido' },
      { path: '/carro/', kind: 'redirect', to: '/solicitar-pedido' },
      { path: '/carro?origen=prueba', kind: 'redirect', to: '/solicitar-pedido' },
      // PR 07: 301 de ids renombrados, con barra final y con la consulta de Google Ads
      { path: '/producto/w-ip66', kind: 'redirect', to: nf3, expectedStatus: 301 },
      { path: '/producto/w-ip66/', kind: 'redirect', to: nf3, expectedStatus: 301 },
      { path: '/producto/w-ip66?gclid=smoke', kind: 'redirect', to: nf3, expectedStatus: 301 },
      { path: '/producto/control-remoto', kind: 'redirect', to: solar, expectedStatus: 301 },
      { path: '/producto/control-remoto/', kind: 'redirect', to: solar, expectedStatus: 301 },
      { path: '/producto/control-remoto?gclid=smoke', kind: 'redirect', to: solar, expectedStatus: 301 },
      // PR 08: URLs de elights.cl, con el destino de legacy-urls.json (ficha con el mismo id, categoría,
      // fichas renombradas con %C3%BA, coma y puntos, /home y /search, que conserva ?q=)
      { path: '/alumbrado-publico-bestled-120w-ip66-ik08?gclid=smoke', kind: 'redirect', to: '/producto/alumbrado-publico-bestled-120w-ip66-ik08', expectedStatus: 301 },
      { path: '/campana_led', kind: 'redirect', to: '/catalogo/campanas-led', expectedStatus: 301 },
      { path: '/campana_led/', kind: 'redirect', to: '/catalogo/campanas-led', expectedStatus: 301 },
      { path: '/alumbrado-p%C3%BAblico-led-solar-150w-all-in-one-c/control-remoto', kind: 'redirect', to: solar, expectedStatus: 301 },
      {
        path: '/cinta-led-led-verde-14,4w/m-72-leds/m-ip67-100-mt-220v',
        kind: 'redirect',
        to: '/producto/cinta-led-exterior-verde-14-4w-m-72-leds-m-ip67-100-mt-220v',
        expectedStatus: 301,
      },
      {
        path: '/tubo-led-opal-vidrio-18w-120cm.-220v.-c/sensor-6500k',
        kind: 'redirect',
        to: '/producto/tubo-led-opal-vidrio-18w-120cm-220v-c-sensor-6500k',
        expectedStatus: 301,
      },
      { path: '/home', kind: 'redirect', to: '/', expectedStatus: 301 },
      { path: '/search?q=panel', kind: 'redirect', to: '/buscar', expectedStatus: 301 },
      // PR 12: página legal de Jumpseller a su página nueva
      { path: '/terms-and-conditions', kind: 'redirect', to: '/terminos-y-condiciones', expectedStatus: 301 },
      // El blog de Jumpseller, al índice de las guías (decisión del dueño, 2026-10-23)
      { path: '/blog', kind: 'redirect', to: '/guias', expectedStatus: 301 },
    ]);
    const luzFria = '/la-luz-fria-led-puede-danar-los-ojos-y-enturbiar-el-sueno';
    expect(paths('notfound')).toEqual(['/cart', '/checkout', '/customer', '/orders', '/admin', '/attachments', '/quote', '/Catalogo', '/no-existe', '/producto/no-existe', '/catalogo/no-existe', '/catalogo/x/y', '/guias/no-existe', '/producto-test-checkout', luzFria]);
    // Las dos últimas no tienen regla a propósito: 404 definitivo
    for (const path of ['/producto-test-checkout', luzFria]) {
      const row = LEGACY_URLS.find(u => u.source === path);
      expect(row?.gone, path).toBeTruthy();
    }
    expect(paths('api')).toHaveLength(9);
    expect(paths('api')).toContain('/api/project-quotes/create');
    expect(paths('api')).toContain('/api/project-quotes/upload');
    expect(paths('api')).not.toContain('/api/cron/followups'); // responde 501: no es una falla
    expect(paths('api')).not.toContain('/api/cron/blob-sweep'); // 401 sin CRON_SECRET: tampoco
    expect(paths('file')).toEqual(expect.arrayContaining(['/robots.txt', '/sitemap.xml', '/og-default.jpg', '/favicon.ico']));
    expect(new Set(t.map(x => x.path)).size).toBe(t.length);
  });

  it('--legacy: cada fila de legacy-urls.json según lo que declara, y cada destino una vez', () => {
    const t = legacyTargets();
    const kinds = (k: string) => t.filter(x => x.kind === k);
    const rules = LEGACY_URLS.filter(u => u.product !== undefined || u.category !== undefined || u.path !== undefined);
    expect(kinds('redirect')).toHaveLength(rules.length);
    for (const r of kinds('redirect')) expect(r.expectedStatus, r.path).toBe(301);
    expect(kinds('notfound').map(x => x.path)).toEqual(LEGACY_URLS.filter(u => u.gone || u.pending).map(u => u.source));
    expect(t.slice(0, LEGACY_URLS.length).map(x => x.path)).toEqual(LEGACY_URLS.map(u => u.source));
    // Cada destino se revisa una vez: '/' y '/catalogo' ya están como filas servidas; /buscar es spa.html
    const checked = new Map(t.map(x => [x.path, x.kind]));
    for (const r of kinds('redirect')) expect(['page', 'spa'], `${r.path} → ${r.to}`).toContain(checked.get(r.to!));
    expect(checked.get('/buscar')).toBe('spa');
    expect(checked.get('/')).toBe('page');
    expect(new Set(t.map(x => x.path)).size).toBe(t.length);
    // Con un archivo mínimo
    expect(legacyTargets([{ source: '/', served: true }, { source: '/home', path: '/' }, { source: '/search', path: '/buscar' }, { source: '/blog', pending: 'blog' }])).toEqual([
      { path: '/', kind: 'page' },
      { path: '/home', kind: 'redirect', to: '/', expectedStatus: 301 },
      { path: '/search', kind: 'redirect', to: '/buscar', expectedStatus: 301 },
      { path: '/blog', kind: 'notfound' },
      { path: '/buscar', kind: 'spa' },
    ]);
  });

  it('juzga cada fila según su tipo', () => {
    const page = { canonical: `${SITE_URL}/`, ogUrl: `${SITE_URL}/`, robots: '' };
    expect(rowIssues(row('/', 'page', 200, 'text/html', page))).toEqual([]);
    expect(rowIssues(row('/', 'page', 404, 'text/html', { ...page, notFoundMark: true }))).toEqual(['estado 404, se esperaba 200', 'es la página 404']);
    expect(rowIssues(row('/', 'page', 200, 'text/html', { robots: 'noindex, follow' }))).toEqual(['sin canonical', `og:url (vacío) no es la de esta URL (se esperaba ${SITE_URL}/)`, 'tiene noindex']);
    // Otra página en esta URL (p. ej. la portada servida en lugar de la ficha)
    expect(rowIssues(row('/producto/x', 'page', 200, 'text/html', page))).toEqual([
      `canonical ${SITE_URL}/ no es la de esta URL (se esperaba ${SITE_URL}/producto/x)`,
      `og:url ${SITE_URL}/ no es la de esta URL (se esperaba ${SITE_URL}/producto/x)`,
    ]);
    expect(rowIssues(row('/cotizacion/', 'spa', 200, 'text/html', { robots: 'noindex, follow' }))).toEqual([]);
    // Guía publicada sin indexar: 200 con noindex, sin canonical y con su h1
    const guide = '/guias/norma-luminica-ds-1-2022';
    expect(rowIssues(row(guide, 'unindexed', 200, 'text/html', { robots: 'noindex, follow', h1: 1 }))).toEqual([]);
    expect(rowIssues(row(guide, 'unindexed', 200, 'text/html', { canonical: `https://nuevo.elights.cl${guide}`, h1: 1 }))).toEqual([
      'sin noindex',
      `canonical https://nuevo.elights.cl${guide} en una guía sin indexar`,
    ]);
    expect(rowIssues(row(guide, 'unindexed', 404, 'text/html', { robots: 'noindex, follow', notFoundMark: true }))).toEqual([
      'estado 404, se esperaba 200',
      '0 h1 (debe haber uno)',
      'es la página 404',
    ]);
    expect(rowIssues(row('/cotizacion/', 'spa', 404, 'text/html', { robots: 'noindex, follow', notFoundMark: true }))).toEqual([
      'estado 404, se esperaba 200',
      'es la página 404',
    ]);
    const notFound = { robots: 'noindex, follow', notFoundMark: true };
    expect(rowIssues(row('/no-existe', 'notfound', 404, 'text/html', notFound))).toEqual([]);
    // Lo que pasaba antes de la PR 05: spa.html con 200
    expect(rowIssues(row('/no-existe', 'notfound', 200, 'text/html', { robots: 'noindex, follow' }))).toEqual(['estado 200, se esperaba 404', 'no es 404.html']);
    // La 404 genérica de Vercel (sin 404.html)
    expect(rowIssues(row('/no-existe', 'notfound', 404, 'text/plain'))).toEqual(['tipo text/plain, se esperaba HTML', 'sin noindex', 'no es 404.html']);
    expect(rowIssues(row('/carro', 'redirect', 307, '', { to: '/solicitar-pedido', location: '/solicitar-pedido' }))).toEqual([]);
    expect(rowIssues(row('/carro', 'redirect', 307, '', { to: '/solicitar-pedido', location: `${SITE_URL}/solicitar-pedido` }))).toEqual([]);
    expect(rowIssues(row('/carro', 'redirect', 200, 'text/html', { to: '/solicitar-pedido' }))).toEqual([
      'estado 200, se esperaba 307',
      'lleva a "", se esperaba /solicitar-pedido',
    ]);
    // Ids renombrados (PR 07): 301 al id vigente, conservando la consulta
    const moved = { to: '/producto/nuevo', expectedStatus: 301 };
    expect(rowIssues(row('/producto/viejo', 'redirect', 301, '', { ...moved, location: '/producto/nuevo' }))).toEqual([]);
    expect(rowIssues(row('/producto/viejo/', 'redirect', 301, '', { ...moved, location: `${SITE_URL}/producto/nuevo` }))).toEqual([]);
    expect(rowIssues(row('/producto/viejo?gclid=smoke', 'redirect', 301, '', { ...moved, location: '/producto/nuevo?gclid=smoke' }))).toEqual([]);
    // Lo que da producción antes de la PR 07: la ficha vieja con 200
    expect(rowIssues(row('/producto/viejo', 'redirect', 200, 'text/html', moved))).toEqual(['estado 200, se esperaba 301', 'lleva a "", se esperaba /producto/nuevo']);
    // permanent: true en vercel.json daría 308
    expect(rowIssues(row('/producto/viejo', 'redirect', 308, '', { ...moved, location: '/producto/nuevo' }))).toEqual(['estado 308, se esperaba 301']);
    expect(rowIssues(row('/producto/viejo?gclid=smoke', 'redirect', 301, '', { ...moved, location: '/producto/nuevo' }))).toEqual([
      '"/producto/nuevo" no conserva la consulta ?gclid=smoke',
    ]);
    // URLs de elights.cl (PR 08): /search conserva ?q=; antes del merge, nuevo responde 404
    const search = { to: '/buscar', expectedStatus: 301 };
    expect(rowIssues(row('/search?q=panel', 'redirect', 301, '', { ...search, location: '/buscar?q=panel' }))).toEqual([]);
    expect(rowIssues(row('/search?q=panel', 'redirect', 404, 'text/html', search))).toEqual([
      'estado 404, se esperaba 301',
      'lleva a "", se esperaba /buscar',
      '"" no conserva la consulta ?q=panel',
    ]);
    expect(rowIssues(row('/robots.txt', 'file', 200, 'text/plain', { body: buildRobots() }))).toEqual([]);
    expect(rowIssues(row('/fichas/x.pdf', 'file', 200, 'text/html'))).toEqual(['devuelve HTML en vez del archivo']);
    expect(rowIssues(row('/api/quotes/create', 'api', 405))).toEqual([]);
    expect(rowIssues(row('/api/quotes/create', 'api', 404, 'text/html'))).toEqual(['estado 404, se esperaba 405']);
    expect(rowIssues(row('/Catalogo', 'observe', 404, 'text/html'))).toEqual([]);
    expect(rowIssues(row('/Catalogo', 'observe', 500, 'text/html'))).toEqual(['error 500']);
  });

  it('las variantes actuales y las rutas de sistema tienen expectativas explícitas', () => {
    const targets = buildTargets();
    for (const path of ['/cart', '/checkout', '/customer', '/orders', '/admin', '/attachments', '/quote', '/Catalogo']) {
      const target = targets.find(t => t.path === path)!;
      expect(target.kind, path).toBe('notfound');
      expect(rowIssues(row(path, target.kind, 200, 'text/html', { robots: 'noindex', notFoundMark: true }))).toContain('estado 200, se esperaba 404');
    }
    expect(targets.find(t => t.path === '/catalogo/')?.kind).toBe('page');
    const page = row('/catalogo/', 'page', 200, 'text/html', { canonical: `${SITE_URL}/catalogo`, ogUrl: `${SITE_URL}/catalogo` });
    expect(rowIssues(page)).toEqual([]);
    expect(rowIssues({ ...page, status: 308 })).toContain('estado 308, se esperaba 200');
    expect(rowIssues({ ...page, canonical: `${SITE_URL}/catalogo/` }).join(' ')).toMatch(/canonical/);
  });

  it('canonical y og:url exigen la URL pública completa, configurable e independiente de la preview', () => {
    const opts = { base: 'https://rama.vercel.app', expectedOrigin: 'https://elights.cl' };
    const good = row('/catalogo', 'page', 200, 'text/html', { canonical: 'https://elights.cl/catalogo', ogUrl: 'https://elights.cl/catalogo' });
    expect(rowIssues(good, opts)).toEqual([]);
    for (const key of ['canonical', 'ogUrl'] as const) {
      for (const value of ['https://nuevo.elights.cl/catalogo', 'https://rama.vercel.app/catalogo', 'http://elights.cl/catalogo', 'https://elights.cl:444/catalogo', '/catalogo', 'https://elights.cl/catalogo?x=1', 'https://elights.cl/catalogo#x', 'basura', '']) {
        expect(rowIssues({ ...good, [key]: value }, opts).length, `${key}: ${value}`).toBeGreaterThan(0);
      }
    }
    expect(parseOrigin('https://elights.cl/')).toBe('https://elights.cl');
    for (const value of ['', '--all', 'ftp://elights.cl', 'https://elights.cl/ruta', 'https://usuario@elights.cl', 'https://elights.cl/?x=1', 'https://elights.cl/#x']) {
      expect(() => parseOrigin(value), value).toThrow(/origen inválido/);
    }
  });

  it('regresión: canonical a nuevo y noindex HTTP fallan en raíz y www', () => {
    const bad = row('/catalogo', 'page', 200, 'text/html', {
      canonical: 'https://nuevo.elights.cl/catalogo', ogUrl: 'https://nuevo.elights.cl/catalogo', xRobots: 'noindex',
    });
    for (const base of ['https://elights.cl', 'https://www.elights.cl']) {
      const opts = { base, expectedOrigin: 'https://elights.cl' };
      const issues = rowIssues(bad, opts);
      expect(issues).toHaveLength(3);
      expect(issues.join(' ')).toMatch(/canonical.*og:url.*X-Robots-Tag/);
      const good = { ...bad, canonical: 'https://elights.cl/catalogo', ogUrl: 'https://elights.cl/catalogo', xRobots: '' };
      expect(rowIssues(good, opts)).toEqual([]);
      expect(rowIssues({ ...good, xRobots: 'googlebot: NOINDEX, follow' }, opts).join(' ')).toMatch(/X-Robots-Tag/);
    }
  });

  it('nuevo exige noindex HTTP fuera de API; las previews conservan su política', () => {
    for (const kind of ['page', 'spa', 'notfound', 'redirect', 'file'] as const) {
      const r = row('/prueba', kind, 200, 'text/html', { xRobots: '' });
      expect(rowIssues(r, { base: 'https://nuevo.elights.cl' }).join(' ')).toMatch(/sin X-Robots-Tag/);
      expect(rowIssues({ ...r, xRobots: 'NOINDEX' }, { base: 'https://nuevo.elights.cl' }).join(' ')).not.toMatch(/sin X-Robots-Tag/);
    }
    for (const path of ['/api', '/api?prueba=1', '/api/', '/api/jumpseller/webhook']) {
      expect(rowIssues(row(path, 'api', 405, 'application/json', { xRobots: '' }))).toEqual([]);
    }
    for (const xRobots of ['', 'noindex']) {
      expect(rowIssues(row('/', 'page', 200, 'text/html', { canonical: `${SITE_URL}/`, ogUrl: `${SITE_URL}/`, xRobots }), { base: 'https://rama.vercel.app' })).toEqual([]);
    }
  });

  it('Location exige el mismo origen consultado, ruta y consulta exactas; un valor inválido falla sin lanzar', () => {
    const opts = { base: 'https://rama.vercel.app' };
    const redirect = row('/search?q=panel', 'redirect', 301, '', { to: '/buscar', expectedStatus: 301, location: '/buscar?q=panel' });
    for (const location of ['/buscar?q=panel', 'https://rama.vercel.app/buscar?q=panel', '//rama.vercel.app/buscar?q=panel']) {
      expect(rowIssues({ ...redirect, location }, opts)).toEqual([]);
    }
    for (const location of ['https://otro.cl/buscar?q=panel', 'https://nuevo.elights.cl/buscar?q=panel', '//otro.cl/buscar?q=panel', 'http://rama.vercel.app/buscar?q=panel', 'https://rama.vercel.app:444/buscar?q=panel', 'https://usuario@rama.vercel.app/buscar?q=panel', 'https://[', '/otra?q=panel', '/buscar?q=otro', '/buscar', '/buscar?q=panel#x']) {
      expect(rowIssues({ ...redirect, location }, opts).length, location).toBeGreaterThan(0);
    }
    expect(rowIssues({ ...redirect, path: '/search', location: '/buscar?agregada=1' }, opts).join(' ')).toMatch(/consulta/);
    expect(rowIssues({ ...redirect, path: '/producto/viejo', to: '/producto/nuevo', location: 'nuevo' }, opts)).toEqual([]);
  });

  it('sitemap exige XML válido, origen público, todas las páginas indexables y ninguna extra ni duplicada', () => {
    const origin = 'https://elights.cl';
    const routes = ['/', '/catalogo'];
    expect(inspectSitemap(buildSitemap(routes, origin), origin, routes)).toEqual({ paths: routes, issues: [] });
    for (const xml of ['', '<html>404</html>', '<urlset><url><loc>/</loc></url></urlset>', buildSitemap([], origin), buildSitemap(['/'], origin), buildSitemap([...routes, '/catalogo'], origin), buildSitemap([...routes, '/buscar'], origin), buildSitemap([...routes, '/no-existe'], origin), buildSitemap(routes, 'https://nuevo.elights.cl'), buildSitemap(routes, 'http://elights.cl'), buildSitemap(routes, 'https://elights.cl:444'), buildSitemap(['/', '/catalogo?x=1'], origin), buildSitemap(routes, origin).replace('</urlset>', '<roto></urlset>'), buildSitemap(routes, origin).replace('0.9">', "0.9'>"), buildSitemap(routes, origin).replace('version="1.0"', 'version="roto"')]) {
      const inspected = inspectSitemap(xml, origin, routes);
      expect(inspected.issues.length, xml).toBeGreaterThan(0);
      expect(inspected.paths).toEqual([]);
    }
    const valid = row('/sitemap.xml', 'file', 200, 'application/xml', { body: buildSitemap(indexableRoutes()) });
    expect(rowIssues(valid)).toEqual([]);
    expect(rowIssues({ ...valid, type: 'text/plain' }).join(' ')).toMatch(/se esperaba XML/);
    expect(rowIssues({ ...valid, body: '' }).join(' ')).toMatch(/sitemap/);
  });

  it('robots exige permiso del sitio, exclusión de API y sitemap en el origen público', () => {
    const origin = 'https://elights.cl';
    const good = buildRobots(origin);
    expect(robotsIssues(good.replace(/\n/g, '\r\n'), origin)).toEqual([]);
    for (const body of ['', '<html>robots</html>', buildRobots('https://nuevo.elights.cl'), buildRobots('http://elights.cl'), good.replace('Disallow: /api/', 'Disallow: /'), good.replace('Disallow: /api/', ''), good.replace('Allow: /', ''), good.replace('User-agent: *', 'User-agent: Googlebot'), good.replace('/sitemap.xml', '/otro.xml'), `${good}Sitemap: https://otro.cl/sitemap.xml\n`]) {
      expect(robotsIssues(body, origin).length, body).toBeGreaterThan(0);
    }
    const valid = row('/robots.txt', 'file', 200, 'text/plain', { body: good });
    const opts = { base: 'https://rama.vercel.app', expectedOrigin: origin };
    expect(rowIssues(valid, opts)).toEqual([]);
    expect(rowIssues({ ...valid, type: 'application/json' }, opts).join(' ')).toMatch(/text\/plain/);
    expect(rowIssues({ ...valid, body: '' }, opts).join(' ')).toMatch(/robots/);
  });

  it.each([false, true])('recoge contenido SEO y --all solo amplía un sitemap válido (host incorrecto: %s)', async wrongHost => {
    const base = 'https://elights.cl'; // fetch simulado; no red ni archivos de entorno
    const xml = buildSitemap(indexableRoutes(), wrongHost ? 'https://otro.cl' : base);
    const fetchMock = vi.fn(async (input: URL, init: RequestInit) => {
      expect(input.origin).toBe(base);
      expect(init.redirect).toBe('manual');
      if (input.pathname === '/sitemap.xml') return new Response(xml, { headers: { 'content-type': 'application/xml' } });
      if (input.pathname === '/robots.txt') return new Response(buildRobots(base), { headers: { 'content-type': 'text/plain' } });
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rows = await runSmoke(base, { all: true, expectedOrigin: base });
    const sitemap = rows.find(r => r.path === '/sitemap.xml')!;
    expect(sitemap.body).toBe(xml);
    expect(rows.find(r => r.path === '/robots.txt')?.body).toBe(buildRobots(base));
    expect(rowIssues(sitemap, { base, expectedOrigin: base }).length > 0).toBe(wrongHost);
    const fixed = new Set(buildTargets().map(t => t.path));
    const extra = rows.filter(r => !fixed.has(r.path));
    expect(extra.length > 0).toBe(!wrongHost);
    if (!wrongHost) expect(rows.map(r => r.path)).toEqual(expect.arrayContaining(indexableRoutes()));
  });

  it('una vista previa protegida (302 a vercel.com) es una falla, no un verde', () => {
    const sso = { location: 'https://vercel.com/sso-api?url=https%3A%2F%2Fx.vercel.app%2F&nonce=1' };
    for (const kind of ['page', 'api', 'file', 'observe'] as const) {
      expect(rowIssues(row('/', kind, 302, 'text/plain', sso))[0]).toMatch(/vista previa protegida/);
    }
  });

  it('el secreto para saltar la protección de Vercel solo va a *.vercel.app', () => {
    const root = mkdtempSync(join(tmpdir(), 'smoke-'));
    const env = { VERCEL_AUTOMATION_BYPASS_SECRET: 'secretoDePrueba0123456789' } as NodeJS.ProcessEnv;
    expect(bypassHeaders('https://x-git-rama.vercel.app', env, root)).toEqual({ 'x-vercel-protection-bypass': 'secretoDePrueba0123456789' });
    expect(bypassHeaders('https://nuevo.elights.cl', env, root)).toEqual({});
    expect(bypassHeaders('https://x.vercel.app.evil.com', env, root)).toEqual({});
    expect(bypassHeaders('https://x.vercel.app', {}, root)).toEqual({});
    writeFileSync(join(root, '.env.local'), 'VERCEL_AUTOMATION_BYPASS_SECRET=deArchivo-0123456789\n');
    expect(bypassHeaders('https://x.vercel.app', {}, root)).toEqual({ 'x-vercel-protection-bypass': 'deArchivo-0123456789' });
    // Un valor con otro formato no se manda, y el error no lo muestra
    const bad = { VERCEL_AUTOMATION_BYPASS_SECRET: 'no es un secreto válido' } as NodeJS.ProcessEnv;
    expect(() => bypassHeaders('https://x.vercel.app', bad, root)).toThrow(/formato esperado/);
    try {
      bypassHeaders('https://x.vercel.app', bad, root);
    } catch (err) {
      expect(String(err)).not.toContain('no es un secreto');
    }
  });

  it('encuentra los assets con hash que carga una página', () => {
    const html = '<script type="module" src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/p.js"><link rel="stylesheet" href="/assets/x.css"><img src="https://cdn/y.png"><script src="/assets/index-a.js"></script>';
    expect(assetRefs(html)).toEqual(['/assets/index-a.js', '/assets/p.js', '/assets/x.css']);
  });

  it('marca cambios de estado o tipo en api/ y archivos, pero no en páginas ni assets con hash', () => {
    const prod = [row('/api/whatsapp/webhook', 'api', 405), row('/', 'page', 200, 'text/html'), row('/assets/a.js', 'file', 200)];
    const prev = [row('/api/whatsapp/webhook', 'api', 404, 'text/html'), row('/', 'page', 404, 'text/html'), row('/assets/a.js', 'file', 404)];
    expect(compareStable(prev, prod)).toEqual(['/api/whatsapp/webhook: 405 application/json -> 404 text/html']);
  });

  it('una función nueva (404 en producción, 405 en la preview) se informa sin fallar; una que desaparece, falla', () => {
    const prod = [row('/api/project-quotes/upload', 'api', 404, 'text/plain; charset=utf-8'), row('/api/cron/followups', 'api', 405)];
    const preview = [row('/api/project-quotes/upload', 'api', 405), row('/api/cron/followups', 'api', 404, 'text/plain; charset=utf-8')];
    expect(compareStable(preview, prod)).toEqual(['/api/cron/followups: 405 application/json -> 404 text/plain; charset=utf-8']);
    expect(newFunctions(preview, prod)).toEqual(['/api/project-quotes/upload']);
    // Un archivo que pasa de 404 a 405 no es una función nueva
    expect(compareStable([row('/robots.txt', 'file', 405)], [row('/robots.txt', 'file', 404)])).toHaveLength(1);
  });
});
