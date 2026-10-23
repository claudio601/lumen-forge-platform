import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetRefs, buildTargets, bypassHeaders, compareStable, inspectHtml, legacyTargets, newFunctions, rowIssues, type Row } from './smoke';
import { LEGACY_URLS } from './redirects/build';

const row = (path: string, kind: Row['kind'], status: number, type = 'application/json', extra: Partial<Row> = {}): Row => ({
  path, kind, status, type, location: '', xRobots: '', bytes: 0,
  title: '', canonical: '', robots: '', ogImage: '', h1: 0, jsonLd: 0, notFoundMark: false,
  ...extra,
});

describe('chequeo de humo', () => {
  it('lee título, canonical, robots, og:image, h1, JSON-LD y la marca de 404.html', () => {
    const html = `<html><head><title> Panel LED | eLIGHTS </title>
      <link rel="canonical" href="https://elights.cl/producto/x">
      <meta name="robots" content="noindex, follow">
      <meta property="og:image" content="https://cdn/x.png">
      <script type="application/ld+json">{}</script></head>
      <body><div id="root"><h1 class="t">Panel</h1></div></body></html>`;
    expect(inspectHtml(html)).toEqual({
      title: 'Panel LED | eLIGHTS',
      canonical: 'https://elights.cl/producto/x',
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
    expect(paths('page')).toHaveLength(19); // 13 fijas (STATIC_ROUTES, con /guias), 3 fichas y 3 categorías
    expect(paths('page')).toEqual(expect.arrayContaining(['/empresa', '/medios-de-pago', '/politica-de-privacidad', '/guias']));
    // Guías «publicadas sin indexar» (plan del blog, §2.2): con su noindex, aparte de las páginas
    expect(paths('unindexed')).toEqual(['/guias/norma-luminica-ds-1-2022']);
    expect(paths('spa')).toEqual(expect.arrayContaining(['/cotizacion', '/cotizacion/', '/solicitar-pedido', '/solicitar-pedido/', '/buscar']));
    const nf3 = '/producto/campana-led-ufo-nf3-150w-150-lm-w-ip66';
    const solar = '/producto/alumbrado-publico-led-solar-150w-all-in-one-c-control-remoto';
    expect(t.filter(x => x.kind === 'redirect')).toEqual([
      { path: '/carro', kind: 'redirect', to: '/solicitar-pedido' },
      { path: '/carro/', kind: 'redirect', to: '/solicitar-pedido' },
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
    expect(paths('notfound')).toEqual(['/no-existe', '/producto/no-existe', '/catalogo/no-existe', '/catalogo/x/y', '/guias/no-existe', '/producto-test-checkout', luzFria]);
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
    const page = { canonical: 'https://nuevo.elights.cl/', robots: '' };
    expect(rowIssues(row('/', 'page', 200, 'text/html', page))).toEqual([]);
    expect(rowIssues(row('/', 'page', 404, 'text/html', { ...page, notFoundMark: true }))).toEqual(['estado 404, se esperaba 200', 'es la página 404']);
    expect(rowIssues(row('/', 'page', 200, 'text/html', { robots: 'noindex, follow' }))).toEqual(['sin canonical', 'tiene noindex']);
    // Otra página en esta URL (p. ej. la portada servida en lugar de la ficha)
    expect(rowIssues(row('/producto/x', 'page', 200, 'text/html', page))).toEqual(['canonical https://nuevo.elights.cl/ no es la de esta URL']);
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
    expect(rowIssues(row('/carro', 'redirect', 307, '', { to: '/solicitar-pedido', location: 'https://nuevo.elights.cl/solicitar-pedido?x=1' }))).toEqual([]);
    expect(rowIssues(row('/carro', 'redirect', 200, 'text/html', { to: '/solicitar-pedido' }))).toEqual([
      'estado 200, se esperaba 307',
      'lleva a "", se esperaba /solicitar-pedido',
    ]);
    // Ids renombrados (PR 07): 301 al id vigente, conservando la consulta
    const moved = { to: '/producto/nuevo', expectedStatus: 301 };
    expect(rowIssues(row('/producto/viejo', 'redirect', 301, '', { ...moved, location: '/producto/nuevo' }))).toEqual([]);
    expect(rowIssues(row('/producto/viejo/', 'redirect', 301, '', { ...moved, location: 'https://nuevo.elights.cl/producto/nuevo' }))).toEqual([]);
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
    expect(rowIssues(row('/robots.txt', 'file', 200, 'text/plain'))).toEqual([]);
    expect(rowIssues(row('/fichas/x.pdf', 'file', 200, 'text/html'))).toEqual(['devuelve HTML en vez del archivo']);
    expect(rowIssues(row('/api/quotes/create', 'api', 405))).toEqual([]);
    expect(rowIssues(row('/api/quotes/create', 'api', 404, 'text/html'))).toEqual(['estado 404, se esperaba 405']);
    expect(rowIssues(row('/Catalogo', 'observe', 404, 'text/html'))).toEqual([]);
    expect(rowIssues(row('/Catalogo', 'observe', 500, 'text/html'))).toEqual(['error 500']);
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
