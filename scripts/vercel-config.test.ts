// scripts/vercel-config.test.ts
// vercel.json gobierna también las funciones de producción que viven en este
// proyecto (webhook de Jumpseller, bot de WhatsApp, webhook de Pipedrive,
// formularios). Estas reglas impiden que un cambio de SEO (prerender, 404,
// redirecciones) las rompa. Ver CLAUDE.md §15.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexableRoutes, NOINDEX_ROUTES, REDIRECT_ROUTES } from '../src/lib/seo/routes';

interface Rule {
  source: string;
  destination?: string;
  permanent?: boolean;
  statusCode?: number;
  has?: { type: string; value?: string }[];
  headers?: { key: string; value: string }[];
}

const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf-8')) as {
  regions?: string[];
  rewrites?: Rule[];
  redirects?: Rule[];
  headers?: Rule[];
  cleanUrls?: boolean;
  trailingSlash?: boolean;
};

// Una regla "literal" empieza con un segmento fijo que no es api (ni '/api' seguido de un
// comodín como '/api(.*)'); las de sourcePaths ('/x', '/(a|b)', con '{/}?') no pueden nombrar
// /api. Las fuentes con comodín solo se aceptan si excluyen api/ con un lookahead negativo.
const excludesApi = (source: string) => {
  const paths = sourcePaths(source);
  if (paths) return !paths.includes('/api');
  return (/^\/(?!api(\/|$))[A-Za-z0-9._~%-]/.test(source) && !/^\/api(?![A-Za-z0-9_-])/.test(source)) || source.startsWith('/((?!api/)');
};

/**
 * Rutas que cubre una fuente sin comodín: '/x' o '/(a|b|c)', con '{/}?' opcional al final
 * (Vercel compara en modo estricto: sin él, '/cotizacion/' no coincide). null si no es así.
 */
function sourcePaths(source: string): string[] | null {
  const m = source.match(/^\/(?:([a-z0-9-]+)|\(([a-z0-9-]+(?:\|[a-z0-9-]+)*)\))(?:\{\/\}\?)?$/);
  if (!m) return null;
  return (m[1] ? [m[1]] : m[2].split('|')).map(p => `/${p}`);
}

const routesSource = readFileSync(new URL('../src/routes.tsx', import.meta.url), 'utf-8');

describe('vercel.json', () => {
  it('la reescritura de /api es la primera y no cambia', () => {
    expect(cfg.rewrites?.[0]).toEqual({ source: '/api/(.*)', destination: '/api/$1' });
  });

  it('la región sigue siendo iad1', () => {
    expect(cfg.regions).toEqual(['iad1']);
  });

  it('sin cleanUrls ni trailingSlash (convertirían los POST de los webhooks en redirecciones)', () => {
    expect(cfg.cleanUrls).toBeUndefined();
    expect(cfg.trailingSlash).toBeUndefined();
  });

  it('la guarda de /api reconoce las fuentes que alcanzan las funciones', () => {
    for (const source of ['/api/(.*)', '/api(.*)', '/api{/}?', '/api:path*', '/api', '/(.*)', '/:path*']) expect(excludesApi(source), source).toBe(false);
    for (const source of ['/carro{/}?', '/(buscar|cotizacion){/}?', '/((?!api/).*)', '/apiario']) expect(excludesApi(source), source).toBe(true);
  });

  it('ninguna redirección o cabecera alcanza /api, y no hay redirecciones por dominio', () => {
    for (const r of cfg.redirects ?? []) {
      expect(excludesApi(r.source), `redirección ${r.source}`).toBe(true);
      expect(r.has?.some(h => h.type === 'host') ?? false, `redirección por dominio ${r.source}`).toBe(false);
    }
    for (const h of cfg.headers ?? []) expect(excludesApi(h.source), `cabecera ${h.source}`).toBe(true);
    for (const r of (cfg.rewrites ?? []).slice(1)) expect(r.source.startsWith('/api')).toBe(false);
  });

  it('sin comodín fuera de /api: una URL sin archivo ni regla recibe 404.html con estado 404', () => {
    // PR 05: antes un '/(.*)' mandaba todo a spa.html con 200. Ahora cada regla nombra sus rutas.
    for (const r of [...(cfg.rewrites ?? []).slice(1), ...(cfg.redirects ?? [])]) {
      expect(sourcePaths(r.source), `fuente con comodín: ${r.source}`).not.toBeNull();
    }
    for (const r of cfg.rewrites ?? []) {
      expect(r.destination).not.toBe('/index.html'); // la portada en otra URL
      expect(r.destination).not.toBe('/404.html'); // respondería 200, no 404
    }
  });

  it('las páginas que dependen de la sesión o de la búsqueda (NOINDEX_ROUTES) van a spa.html, con o sin barra final', () => {
    const spa = (cfg.rewrites ?? []).filter(r => r.destination === '/spa.html');
    expect(spa.flatMap(r => sourcePaths(r.source) ?? []).sort()).toEqual([...NOINDEX_ROUTES].sort());
    for (const r of spa) expect(r.source.endsWith('{/}?'), r.source).toBe(true);
  });

  it('cada ruta que solo redirige (REDIRECT_ROUTES) tiene una redirección temporal al mismo destino que la app', () => {
    const navigate = new Map([...routesSource.matchAll(/\{ path: '([^']+)', element: <Navigate to="([^"]+)"/g)].map(m => [m[1], m[2]]));
    expect(cfg.redirects ?? []).toHaveLength(REDIRECT_ROUTES.length); // la PR 07 sumará los 301 de los ids renombrados
    for (const route of REDIRECT_ROUTES) {
      const rules = (cfg.redirects ?? []).filter(r => sourcePaths(r.source)?.includes(route));
      expect(rules, route).toHaveLength(1);
      expect(rules[0].destination).toBe(navigate.get(route));
      expect(rules[0].permanent).toBe(false); // 307: el sitio todavía no es el dominio principal
      expect(rules[0].statusCode).toBeUndefined();
      expect(rules[0].source.endsWith('{/}?'), rules[0].source).toBe(true);
    }
  });

  it('ninguna regla tapa una página indexable, y cada redirección llega a una página que existe', () => {
    const indexable = new Set(indexableRoutes());
    for (const r of [...(cfg.rewrites ?? []).slice(1), ...(cfg.redirects ?? [])]) {
      for (const path of sourcePaths(r.source) ?? []) expect(indexable.has(path), `${r.source} tapa ${path}`).toBe(false);
    }
    const served = new Set<string>([...indexable, ...NOINDEX_ROUTES]);
    for (const r of cfg.redirects ?? []) expect(served.has(r.destination ?? ''), `${r.source} → ${r.destination}`).toBe(true);
  });

  it('nuevo.elights.cl queda fuera de Google hasta el cambio de dominio (solo ese dominio)', () => {
    const rule = (cfg.headers ?? []).find(h => h.headers?.some(x => x.key === 'X-Robots-Tag'));
    expect(rule?.has).toEqual([{ type: 'host', value: 'nuevo.elights.cl' }]);
    expect(rule?.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);
  });
});
