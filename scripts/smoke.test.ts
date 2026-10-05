import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetRefs, buildTargets, bypassHeaders, compareStable, inspectHtml, rowIssues, type Row } from './smoke';

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

  it('revisa páginas, rutas sin prerender (con y sin barra final), /carro, 404, archivos y las funciones de api/ (solo GET)', () => {
    const t = buildTargets();
    const paths = (k: string) => t.filter(x => x.kind === k).map(x => x.path);
    expect(paths('page')).toHaveLength(12);
    expect(paths('spa')).toEqual(expect.arrayContaining(['/cotizacion', '/cotizacion/', '/solicitar-pedido', '/solicitar-pedido/', '/buscar']));
    expect(t.filter(x => x.kind === 'redirect')).toEqual([
      { path: '/carro', kind: 'redirect', to: '/solicitar-pedido' },
      { path: '/carro/', kind: 'redirect', to: '/solicitar-pedido' },
    ]);
    expect(paths('notfound')).toEqual(['/no-existe', '/producto/no-existe', '/catalogo/no-existe', '/catalogo/x/y']);
    expect(paths('api')).toHaveLength(7);
    expect(paths('api')).not.toContain('/api/cron/followups'); // responde 501: no es una falla
    expect(paths('file')).toEqual(expect.arrayContaining(['/robots.txt', '/sitemap.xml', '/og-default.jpg', '/favicon.ico']));
    expect(new Set(t.map(x => x.path)).size).toBe(t.length);
  });

  it('juzga cada fila según su tipo', () => {
    const page = { canonical: 'https://nuevo.elights.cl/', robots: '' };
    expect(rowIssues(row('/', 'page', 200, 'text/html', page))).toEqual([]);
    expect(rowIssues(row('/', 'page', 404, 'text/html', { ...page, notFoundMark: true }))).toEqual(['estado 404, se esperaba 200', 'es la página 404']);
    expect(rowIssues(row('/', 'page', 200, 'text/html', { robots: 'noindex, follow' }))).toEqual(['sin canonical', 'tiene noindex']);
    // Otra página en esta URL (p. ej. la portada servida en lugar de la ficha)
    expect(rowIssues(row('/producto/x', 'page', 200, 'text/html', page))).toEqual(['canonical https://nuevo.elights.cl/ no es la de esta URL']);
    expect(rowIssues(row('/cotizacion/', 'spa', 200, 'text/html', { robots: 'noindex, follow' }))).toEqual([]);
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
});
