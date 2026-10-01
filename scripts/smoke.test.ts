import { describe, expect, it } from 'vitest';
import { buildTargets, compareStable, inspectHtml, type Row } from './smoke';

describe('chequeo de humo', () => {
  it('lee título, canonical, robots, og:image, h1 y JSON-LD del HTML', () => {
    const html = `<html><head><title> Panel LED | eLIGHTS </title>
      <link rel="canonical" href="https://elights.cl/producto/x">
      <meta name="robots" content="noindex, follow">
      <meta property="og:image" content="https://cdn/x.png">
      <script type="application/ld+json">{}</script></head>
      <body><h1 class="t">Panel</h1></body></html>`;
    expect(inspectHtml(html)).toEqual({
      title: 'Panel LED | eLIGHTS',
      canonical: 'https://elights.cl/producto/x',
      robots: 'noindex, follow',
      ogImage: 'https://cdn/x.png',
      h1: 1,
      jsonLd: 1,
    });
  });

  it('revisa páginas, rutas sin prerender, 404, archivos y las funciones de api/ (solo GET)', () => {
    const t = buildTargets();
    const kinds = (k: string) => t.filter(x => x.kind === k).length;
    expect(kinds('page')).toBe(12);
    expect(kinds('notfound')).toBe(3);
    expect(t.filter(x => x.kind === 'api').map(x => x.path)).toContain('/api/whatsapp/webhook');
    expect(t.some(x => x.path === '/robots.txt')).toBe(true);
  });

  it('marca cambios de estado o tipo en api/ y archivos, pero no en páginas ni assets con hash', () => {
    const row = (path: string, kind: Row['kind'], status: number, type = 'application/json'): Row => ({
      path, kind, status, type, location: '', xRobots: '', bytes: 0,
      title: '', canonical: '', robots: '', ogImage: '', h1: 0, jsonLd: 0,
    });
    const prod = [row('/api/whatsapp/webhook', 'api', 405), row('/', 'page', 200, 'text/html'), row('/assets/a.js', 'file', 200)];
    const prev = [row('/api/whatsapp/webhook', 'api', 404, 'text/html'), row('/', 'page', 404, 'text/html'), row('/assets/a.js', 'file', 404)];
    expect(compareStable(prev, prod)).toEqual(['/api/whatsapp/webhook: 405 application/json -> 404 text/html']);
  });
});
