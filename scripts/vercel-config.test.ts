// scripts/vercel-config.test.ts
// vercel.json gobierna también las funciones de producción que viven en este
// proyecto (webhook de Jumpseller, bot de WhatsApp, webhook de Pipedrive,
// formularios). Estas reglas impiden que un cambio de SEO (prerender, 404,
// redirecciones) las rompa. Ver CLAUDE.md §15.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Rule {
  source: string;
  destination?: string;
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

// Una regla "literal" empieza con un segmento fijo que no es api. Las fuentes con
// comodín solo se aceptan si excluyen api/ con un lookahead negativo.
const excludesApi = (source: string) => /^\/(?!api(\/|$))[A-Za-z0-9._~%-]/.test(source) || source.startsWith('/((?!api/)');

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

  it('ninguna redirección o cabecera alcanza /api, y no hay redirecciones por dominio', () => {
    for (const r of cfg.redirects ?? []) {
      expect(excludesApi(r.source), `redirección ${r.source}`).toBe(true);
      expect(r.has?.some(h => h.type === 'host') ?? false, `redirección por dominio ${r.source}`).toBe(false);
    }
    for (const h of cfg.headers ?? []) expect(excludesApi(h.source), `cabecera ${h.source}`).toBe(true);
    for (const r of (cfg.rewrites ?? []).slice(1)) expect(r.source.startsWith('/api')).toBe(false);
  });

  it('lo que no es un archivo ni una página estática va a spa.html (noindex), no a la portada', () => {
    // dist/index.html es la portada generada: servirla en otra URL mostraría la portada
    // antes de que la app dibuje la página correcta. La PR 05 cambia esto por 404 reales.
    expect(cfg.rewrites?.at(-1)).toEqual({ source: '/(.*)', destination: '/spa.html' });
    expect((cfg.rewrites ?? []).some(r => r.destination === '/index.html')).toBe(false);
  });

  it('nuevo.elights.cl queda fuera de Google hasta el cambio de dominio (solo ese dominio)', () => {
    const rule = (cfg.headers ?? []).find(h => h.headers?.some(x => x.key === 'X-Robots-Tag'));
    expect(rule?.has).toEqual([{ type: 'host', value: 'nuevo.elights.cl' }]);
    expect(rule?.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);
  });
});
