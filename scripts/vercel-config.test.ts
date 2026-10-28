// scripts/vercel-config.test.ts
// vercel.json gobierna también las funciones de producción que viven en este
// proyecto (webhook de Jumpseller, bot de WhatsApp, webhook de Pipedrive,
// formularios). Estas reglas impiden que un cambio de SEO (prerender, 404,
// redirecciones) las rompa. Ver CLAUDE.md §15.
//
// Corren también en la sincronización diaria con Jumpseller: ninguna depende de qué
// productos se publican (las redirecciones salen de tablas congeladas o a mano).

import { readdirSync, readFileSync } from 'node:fs';
import { pathToRegexp as pathToRegexp61, type Key } from 'path-to-regexp';
import { pathToRegexp as pathToRegexp63 } from 'path-to-regexp-updated';
import { describe, expect, it } from 'vitest';
import { categoryPath, indexableRoutes, NOINDEX_ROUTES, productPath, REDIRECT_ROUTES, STATIC_ROUTES } from '../src/lib/seo/routes';
import { categories } from '../src/data/catalog/categories.config';
import { products } from '../src/data/catalog/index';
import { LEGACY_SITE_IDS } from '../src/data/catalog/legacy-ids';
import { SITE_IDS } from '../src/data/catalog/site-ids.generated';
import { RENAMED_SITE_IDS, RETIRED_SITE_IDS } from '../src/data/catalog/renamed-ids';
import {
  buildRedirects,
  currentSiteId,
  firstSegment,
  LEGACY_PAGE_DESTINATIONS,
  LEGACY_URLS,
  legacyDestination,
  legacyRedirects,
  loadLegacyUrls,
  MAX_REDIRECTS,
  renamedIdRedirects,
  RESERVED_FIRST_SEGMENTS,
  UNPUBLISHED_RENAMED,
} from './redirects/build';

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
  functions?: Record<string, Record<string, unknown>>;
  crons?: { path: string; schedule: string }[];
};

// Una regla "literal" empieza con un segmento fijo que no es api (ni '/api' seguido de un
// comodín como '/api(.*)'); las de sourcePaths no pueden nombrar /api ni nada bajo /api/.
// Las fuentes con comodín solo se aceptan si excluyen /api y /api/ con un lookahead negativo.
const excludesApi = (source: string) => {
  const paths = sourcePaths(source);
  if (paths) return paths.every(p => p !== '/api' && !p.startsWith('/api/'));
  return (/^\/(?!api(\/|$))[A-Za-z0-9._~%-]/.test(source) && !/^\/api(?![A-Za-z0-9_-])/.test(source)) || source === '/((?!api(?:/|$)).*)';
};

/** URL vieja de elights.cl tal como la manda el navegador: segmentos de [a-z0-9._,-] o bytes no ASCII en %XX mayúscula. */
const LEGACY_PATH = /^(?:\/(?:[a-z0-9._,-]|%[89A-F][0-9A-F])+)+$/;

/** Sin segmentos '.' ni '..', y codificada igual que lo haría el navegador (rechaza %c3%ba, %2D o un %C3 suelto). */
function isBrowserPath(path: string): boolean {
  if (path.split('/').some(s => s === '.' || s === '..')) return false;
  try {
    return encodeURI(decodeURI(path)) === path;
  } catch {
    return false; // UTF-8 incompleto
  }
}

const isLegacyPath = (path: string) => LEGACY_PATH.test(path) && isBrowserPath(path);

/**
 * Rutas que cubre una fuente sin comodín, siempre con '{/}?' al final (Vercel compara en modo
 * estricto: sin él, '/cotizacion/' no coincide). null si no es así.
 *   - '/x' o '/(a|b|c)': rutas de la app.
 *   - '/producto/<id>': los 301 de ids renombrados (PR 07), un id literal en minúsculas.
 *   - URLs de elights.cl (PR 08): uno o más segmentos de LEGACY_PATH, exactamente como los
 *     manda el navegador, y que no empiezan por un segmento reservado (api, producto,
 *     catalogo, archivos de public/…: RESERVED_FIRST_SEGMENTS).
 */
function sourcePaths(source: string): string[] | null {
  const m = source.match(/^\/(?:([a-z0-9-]+)|\(([a-z0-9-]+(?:\|[a-z0-9-]+)*)\))\{\/\}\?$/);
  if (m) return (m[1] ? [m[1]] : m[2].split('|')).map(p => `/${p}`);
  const product = source.match(/^\/producto\/([a-z0-9]+(?:-[a-z0-9]+)*)\{\/\}\?$/);
  if (product) return [`/producto/${product[1]}`];
  const legacy = source.match(/^(\/.+)\{\/\}\?$/)?.[1];
  return legacy && isLegacyPath(legacy) && !RESERVED_FIRST_SEGMENTS.has(legacy.split('/')[1]) ? [legacy] : null;
}

/** Una ruta como la vería una persona: decodificada, en minúsculas y sin barra final. */
const normalized = (path: string) => decodeURI(path).toLowerCase().replace(/\/+$/, '') || '/';

const repeated = (items: string[]) => items.filter((x, i) => items.indexOf(x) !== i);

/** Los 301 de ids de producto renombrados (todas las demás redirecciones son de REDIRECT_ROUTES o de elights.cl). */
const isProductRule = (r: Rule) => r.source.startsWith('/producto/');

const routesSource = readFileSync(new URL('../src/routes.tsx', import.meta.url), 'utf-8');
const redirects = cfg.redirects ?? [];
const legacyRules = legacyRedirects();
/** Reglas generadas desde tablas (PR 07 y PR 08); las demás son las de REDIRECT_ROUTES. */
const generated = new Set([...renamedIdRedirects(), ...legacyRules].map(r => r.source));

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

  // Adjuntos del cotizador: `functions` solo fija maxDuration de funciones que existen (hasta 60 s,
  // el máximo de Hobby sin Fluid compute: si se activa, revisar este tope) y `crons` solo llama
  // funciones de api/cron/, una vez al día (lo que permite Hobby).
  it('functions y crons: solo maxDuration de funciones existentes y crons diarios de api/cron/', () => {
    const isFunction = (file: string) => {
      try {
        return /^api\/(?!_)[^/]+\/[^/]+\.ts$/.test(file) && !file.endsWith('.test.ts') && readFileSync(new URL('../' + file, import.meta.url)).length > 0;
      } catch {
        return false;
      }
    };
    for (const [file, options] of Object.entries(cfg.functions ?? {})) {
      expect(isFunction(file), file).toBe(true);
      expect(Object.keys(options), file).toEqual(['maxDuration']);
      expect(options.maxDuration, file).toBeGreaterThan(0);
      expect(options.maxDuration, file).toBeLessThanOrEqual(60);
    }
    expect(cfg.functions?.['api/project-quotes/create.ts']?.maxDuration).toBe(60);
    for (const cron of cfg.crons ?? []) {
      expect(cron.path, cron.path).toMatch(/^\/api\/cron\/[a-z0-9-]+$/);
      expect(isFunction(cron.path.slice(1) + '.ts'), cron.path).toBe(true);
      expect(cron.schedule, cron.path).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    }
    expect(cfg.crons).toEqual([{ path: '/api/cron/blob-sweep', schedule: '0 9 * * *' }]);
  });

  it('la guarda de /api reconoce las fuentes que alcanzan las funciones', () => {
    for (const source of ['/api/(.*)', '/api(.*)', '/api{/}?', '/api:path*', '/api', '/api/x{/}?', '/(.*)', '/:path*', '/((?!api/).*)', '/((?!api(?:/|$)).*)/api']) {
      expect(excludesApi(source), source).toBe(false);
    }
    for (const source of ['/carro{/}?', '/(buscar|cotizacion){/}?', '/((?!api(?:/|$)).*)', '/apiario', '/producto/w-ip66{/}?', '/campana_led{/}?', '/apiario/x{/}?']) {
      expect(excludesApi(source), source).toBe(true);
    }
  });

  it('la guarda de fuentes sin comodín acepta solo rutas literales, con {/}?', () => {
    expect(sourcePaths('/producto/w-ip66{/}?')).toEqual(['/producto/w-ip66']);
    expect(sourcePaths('/carro{/}?')).toEqual(['/carro']);
    expect(sourcePaths('/(buscar|cotizacion){/}?')).toEqual(['/buscar', '/cotizacion']);
    // URLs de elights.cl (PR 08): varios segmentos, '_', '.', ',' y bytes no ASCII en %XX mayúscula
    for (const path of [
      '/x/y',
      '/campana_led/ufo-nf8',
      '/tubo-led-opal-vidrio-18w-120cm.-220v.-c/sensor-6500k',
      '/cinta-led-led-verde-14,4w/m-72-leds/m-ip67-100-mt-220v',
      '/alumbrado-p%C3%BAblico-led-solar-150w-all-in-one-c/control-remoto',
    ]) {
      expect(sourcePaths(`${path}{/}?`), path).toEqual([path]);
    }
    for (const source of [
      '/producto/:id',
      '/producto/:id{/}?',
      '/producto/(.*)',
      '/producto/w-ip66*',
      '/producto/w-ip66', // sin {/}?: /producto/w-ip66/ seguiría sirviendo la página vieja
      '/producto/(a|b){/}?',
      '/producto/a/b{/}?',
      '/producto/W-IP66{/}?',
      '/producto/w.ip66{/}?',
      '/api/x{/}?',
      '/campana', // sin {/}?
      '/campana_led',
      '/Campana{/}?', // Vercel distingue mayúsculas: el navegador manda minúsculas
      '/a:b{/}?', // ':' abre un parámetro de path-to-regexp
      '/a%2Fb{/}?', // una '/' codificada: el navegador nunca la manda así
      '/p%c3%ba{/}?', // %XX en minúsculas: Vercel no decodifica antes de comparar
      '/p%C3{/}?', // UTF-8 incompleto
      '/p%2D{/}?', // ASCII codificado
      '/p%C3%BA%{/}?',
      '/a/../b{/}?',
      '/a/./b{/}?',
      '/x//y{/}?',
      '/x/{/}?',
      '/x y{/}?',
      '/x(.*){/}?',
      '/x+{/}?',
      '/catalogo/x{/}?', // segmentos reservados: páginas, archivos de public/ y de la build
      '/fichas/a.pdf{/}?',
      '/robots.txt{/}?',
      '/assets/index.js{/}?',
    ]) {
      expect(sourcePaths(source), source).toBeNull();
    }
  });

  it('ninguna redirección o cabecera alcanza /api, y no hay redirecciones por dominio', () => {
    for (const r of redirects) {
      expect(excludesApi(r.source), `redirección ${r.source}`).toBe(true);
      expect(r.has?.some(h => h.type === 'host') ?? false, `redirección por dominio ${r.source}`).toBe(false);
    }
    for (const h of cfg.headers ?? []) expect(excludesApi(h.source), `cabecera ${h.source}`).toBe(true);
    for (const r of (cfg.rewrites ?? []).slice(1)) expect(r.source.startsWith('/api')).toBe(false);
  });

  it.each([
    ['6.1.0', pathToRegexp61],
    ['6.3.0', pathToRegexp63],
  ] as const)('la cabecera excluye /api completo y cubre las páginas (compilador %s)', (_version, compile) => {
    const header = cfg.headers?.find(h => h.headers?.some(v => v.key === 'X-Robots-Tag'));
    expect(header?.source).toBe('/((?!api(?:/|$)).*)');
    const re = compile(header!.source, [], { strict: true, sensitive: true, delimiter: '/' });
    for (const path of ['/api', '/api/', '/api/jumpseller/webhook', '/api/whatsapp/webhook', '/api/pipedrive/webhook', '/api/quotes/create']) {
      expect(re.test(path), path).toBe(false);
    }
    for (const path of ['/', '/catalogo', '/catalogo/', '/producto/panel-led', '/Catalogo', '/apiario', '/robots.txt']) {
      expect(re.test(path), path).toBe(true);
    }
  });

  it('sin comodín fuera de /api: una URL sin archivo ni regla recibe 404.html con estado 404', () => {
    // PR 05: antes un '/(.*)' mandaba todo a spa.html con 200. Ahora cada regla nombra sus rutas.
    for (const r of [...(cfg.rewrites ?? []).slice(1), ...redirects]) {
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

  it('las redirecciones son exactamente las que genera scripts/redirects/build.ts', () => {
    expect(cfg.redirects, 'corre npm run redirects:write').toEqual(buildRedirects());
  });

  it('cada ruta que solo redirige (REDIRECT_ROUTES) tiene una redirección temporal al mismo destino que la app', () => {
    const navigate = new Map([...routesSource.matchAll(/\{ path: '([^']+)', element: <Navigate to="([^"]+)"/g)].map(m => [m[1], m[2]]));
    // Las demás salen de tablas: ids renombrados (PR 07) y URLs de elights.cl (PR 08)
    expect(redirects.filter(r => !generated.has(r.source))).toHaveLength(REDIRECT_ROUTES.length);
    for (const route of REDIRECT_ROUTES) {
      const rules = redirects.filter(r => sourcePaths(r.source)?.includes(route));
      expect(rules, route).toHaveLength(1);
      expect(rules[0].destination).toBe(navigate.get(route));
      expect(rules[0].permanent).toBe(false); // 307: el sitio todavía no es el dominio principal
      expect(rules[0].statusCode).toBeUndefined();
      expect(rules[0].source.endsWith('{/}?'), rules[0].source).toBe(true);
    }
  });

  it('ninguna regla tapa una página indexable, y cada redirección llega a una página que existe', () => {
    const indexable = new Set(indexableRoutes());
    for (const r of [...(cfg.rewrites ?? []).slice(1), ...redirects]) {
      for (const path of sourcePaths(r.source) ?? []) expect(indexable.has(path), `${r.source} tapa ${path}`).toBe(false);
    }
    // Las que llevan a una ficha no dependen de qué productos se publican (si no, la PR del
    // robot del catálogo fallaría al despublicar uno): se revisan contra las tablas, abajo.
    const served = new Set<string>([...indexable, ...NOINDEX_ROUTES]);
    for (const r of redirects.filter(r => !r.destination?.startsWith('/producto/'))) {
      expect(served.has(r.destination ?? ''), `${r.source} → ${r.destination}`).toBe(true);
    }
  });

  it('ids renombrados: un 301 por id viejo, al id vigente (o a su categoría si ya no se publica), sin cadenas', () => {
    const idRules = redirects.filter(isProductRule);
    const renamed = Object.entries(RENAMED_SITE_IDS).map(([jid, r]) => ({ jid: Number(jid), ...r }));
    // Id vigente de cada producto registrado, publicado o no (sin mirar el catálogo)
    const current = new Map<number, string>(Object.entries({ ...LEGACY_SITE_IDS, ...SITE_IDS }).map(([jid, id]) => [Number(jid), id]));
    for (const r of renamed) current.set(r.jid, r.id);
    const currentPaths = new Set([...current.values()].map(productPath));
    // Los que ya no se publican están en UNPUBLISHED_RENAMED (a mano): a su categoría o a /catalogo
    const slugs = new Set(categories.map(c => c.slug));
    const destinationOf = (jid: number, id: string) => {
      if (!Object.hasOwn(UNPUBLISHED_RENAMED, jid)) return productPath(id);
      const slug = UNPUBLISHED_RENAMED[jid];
      if (slug !== null) expect(slugs.has(slug), `UNPUBLISHED_RENAMED: ${jid} → ${slug}`).toBe(true);
      return slug === null ? '/catalogo' : categoryPath(slug);
    };

    const previous = renamed.flatMap(r => r.previous.map(old => ({ old, to: destinationOf(r.jid, r.id) })));
    expect(previous.length).toBeGreaterThanOrEqual(50); // PR 07
    expect(idRules).toHaveLength(previous.length);
    for (const { old, to } of previous) {
      const rules = idRules.filter(r => r.source === `${productPath(old)}{/}?`);
      expect(rules, old).toHaveLength(1);
      // 301 exacto: con `permanent` Vercel respondería 307/308 e ignoraría statusCode
      expect(Object.keys(rules[0]).sort(), old).toEqual(['destination', 'source', 'statusCode']);
      expect(rules[0].statusCode, old).toBe(301);
      expect(rules[0].destination, old).toBe(to);
    }

    const sources = idRules.map(r => sourcePaths(r.source)?.[0]);
    expect(new Set(sources).size).toBe(sources.length);
    for (const r of idRules) {
      const source = sourcePaths(r.source)?.[0] ?? r.source;
      expect(currentPaths.has(source), `${r.source} tapa la URL vigente de un producto`).toBe(false);
      // A una ficha, solo la del id vigente (las de categoría se revisan arriba: páginas que existen)
      if (r.destination?.startsWith('/producto/')) expect(currentPaths.has(r.destination), `${r.source} → ${r.destination}`).toBe(true);
      expect(sources, `${r.destination} es a su vez una redirección`).not.toContain(r.destination);
      // Sin barra final, '?' ni '#': Vercel agrega la consulta original (?gclid=…)
      expect(r.destination).toMatch(/^\/(producto\/[a-z0-9]+(-[a-z0-9]+)*|catalogo(\/[a-z0-9]+(-[a-z0-9]+)*)?)$/);
    }
    expect(redirects.length).toBeLessThanOrEqual(MAX_REDIRECTS);
  });

  it('nuevo.elights.cl queda fuera de Google hasta el cambio de dominio (solo ese dominio)', () => {
    const rule = (cfg.headers ?? []).find(h => h.headers?.some(x => x.key === 'X-Robots-Tag'));
    expect(rule?.has).toEqual([{ type: 'host', value: 'nuevo.elights.cl' }]);
    expect(rule?.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);
  });
});

describe('URLs de elights.cl (PR 08): scripts/redirects/legacy-urls.json', () => {
  const file = readFileSync(new URL('./redirects/legacy-urls.json', import.meta.url), 'utf-8');
  const urls = LEGACY_URLS;
  const appRoutes = new Set<string>([...STATIC_ROUTES, ...NOINDEX_ROUTES, ...REDIRECT_ROUTES]);

  it('una fila por URL y por línea, ordenadas por fuente', () => {
    const sources = urls.map(u => u.source);
    for (let i = 1; i < sources.length; i++) expect(sources[i - 1] < sources[i], `${sources[i - 1]} va antes que ${sources[i]}`).toBe(true);
    expect(file.split('\n').filter(line => line.startsWith('    {"source": '))).toHaveLength(urls.length);
  });

  it('solo crece: las 473 URLs de la PR 08 siguen ahí, y las que tenían regla la conservan', () => {
    const baseline = readFileSync(new URL('./redirects/legacy-sources.baseline.txt', import.meta.url), 'utf-8')
      .split('\n')
      .filter(line => line && !line.startsWith('#'));
    expect(baseline).toHaveLength(473);
    const bySource = new Map(urls.map(u => [u.source, u]));
    // Las únicas sin regla (el 2026-10-05 eran 25; la PR 12 dio regla a 6 páginas legales y
    // /medios-de-pago pasó a served; el 2026-10-23 el dueño dio destino a 10 pendientes del blog
    // y de proveedores, y la entrada oculta sobre la luz fría pasó a gone). Una pendiente puede
    // ganar regla, nunca al revés.
    const withoutRule = new Set([
      ...['/', '/catalogo', '/medios-de-pago'], // served
      ...['/pagina-basica', '/producto-test-checkout', '/producto-test-checkout-1', '/producto-test-checkout-2', '/test-search'], // gone
      ...['/la-luz-fria-led-puede-danar-los-ojos-y-enturbiar-el-sueno'], // gone: decisión del dueño (2026-10-23)
    ]);
    expect(withoutRule.size).toBe(9);
    for (const source of baseline) {
      const row = bySource.get(source);
      expect(row, `${source} desapareció de legacy-urls.json`).toBeDefined();
      if (!withoutRule.has(source)) expect(legacyDestination(row!), `${source} perdió su regla`).not.toBeNull();
    }
    expect(legacyRules.length).toBeGreaterThanOrEqual(448);
    // Decisiones del dueño (2026-10-05)
    for (const source of ['/contact', '/contactos']) expect(legacyDestination(bySource.get(source)!), source).toBe('/cotizador');
    expect(legacyDestination(bySource.get('/puzzle-led-simple-embutido-12w-integrado-blanco-ip33')!)).toBe(categoryPath('paneles-led'));
    // Páginas legales y de compra (PR 12): cada URL vieja a su página nueva; /medios-de-pago es la misma URL
    const legalPages: Record<string, string> = {
      '/cambios-y-devoluciones': '/cambios-devoluciones-y-garantia',
      '/refund-policy': '/cambios-devoluciones-y-garantia',
      '/metodos-y-costos-de-envio': '/despacho',
      '/nuestra-empresa': '/empresa',
      '/privacy-policy': '/politica-de-privacidad',
      '/terms-and-conditions': '/terminos-y-condiciones',
    };
    for (const [source, destination] of Object.entries(legalPages)) expect(legacyDestination(bySource.get(source)!), source).toBe(destination);
    expect(bySource.get('/medios-de-pago')?.served).toBe(true);
  });

  it('decisiones del dueño (2026-10-23): el blog y proveedores con destino (plan del blog §2.5), y sin pendientes', () => {
    const bySource = new Map(urls.map(u => [u.source, u]));
    const decided: Record<string, string> = {
      '/blog': '/guias',
      '/blog-post-1': '/empresa',
      '/las-ventajas-de-comprar-en-elightscl': '/empresa',
      '/quieres-ser-nuestro-proveedor': '/empresa',
      '/trabaja-con-nosotros': '/empresa',
      '/como-comprar-en-elights': '/cotizador',
      '/como-comprar-en-nuestro-e-commerce': '/cotizador',
      '/virginia-implementara-cambios-al-alumbrado-publico-introduciendo-iluminacion-led-luz-calida': categoryPath('alumbrado-publico'),
      '/5-tips-para-iluminar-una-oficina': categoryPath('paneles-led'),
      '/5-tips-para-iluminar-tus-noches-de-verano': categoryPath('iluminacion-exterior'),
      // Historial del panel: Jumpseller las manda a esas páginas; el mismo destino
      '/5-consejos-para-iluminar-tus-noches-de-verano': categoryPath('iluminacion-exterior'),
      '/7-ideas-para-iluminar-tus-noches-de-verano': categoryPath('iluminacion-exterior'),
      '/ilumina-tus-noches-de-verano-para-que-sean-inolvidables': categoryPath('iluminacion-exterior'),
      '/5-tips-para-iluminar-una-oficina-y-orientarla-a-la-produccion': categoryPath('paneles-led'),
      '/el-incorrecto-uso-de-iluminacion-en-oficinas-puede-causar-fatiga-visual-irritacion-de-ojos-dolores-de-cabeza-y-trastornos-en-el-sueno': categoryPath('paneles-led'),
      '/blog-post': '/cotizador',
      '/blog/como-comprar-en-elights': '/cotizador',
      '/proveedores': '/empresa',
    };
    for (const [source, destination] of Object.entries(decided)) expect(legacyDestination(bySource.get(source)!), source).toBe(destination);
    // Las páginas fijas de destino son de LEGACY_PAGE_DESTINATIONS (STATIC_ROUTES)
    for (const path of ['/guias', '/empresa', '/cotizador']) expect(LEGACY_PAGE_DESTINATIONS.has(path), path).toBe(true);
    // Ficha reutilizada por Jumpseller para otro producto: a su categoría, no a ese producto
    const reused: Record<string, string> = {
      '/ampolleta-led-c35-vela-filamentos-e14-4w-1': 'ampolletas-led',
      '/aplique-decorativo-bidireccional-cube-10w-luz-fria-ip65-negro-4': 'iluminacion-exterior',
      '/kit-de-emergencia-fluorescente-36w-90-minutos-tubo-8-36w': 'emergencia-led',
      '/kit-de-emergencia-led-50w-90-minutos-autonomia-para-ampolleta-y-tubo-led': 'emergencia-led',
      '/luminaria-lineal-led-flat-40w-120-cm-caccesorios-para-suspender-2': 'lineales-led',
      '/luminaria-lineal-led-suspendida-supermarket-40w-120mm': 'lineales-led',
      '/panel-led-concentrico-opal-7w-ip33-2': 'paneles-led',
      '/proyector-led-antivandalico-50w-ip66-ik10-1': 'proyectores-led',
    };
    for (const [source, slug] of Object.entries(reused)) expect(bySource.get(source)?.category, source).toBe(slug);
    // 404 definitivos: la entrada oculta sobre la luz fría y las dos URL de la luminaria de cultivo
    // (Jumpseller 2557187: la del historial y su permalink actual)
    for (const source of [
      '/la-luz-fria-led-puede-danar-los-ojos-y-enturbiar-el-sueno',
      '/led-de-cultivo-sunset-200w-cree-cxb3590-regulable-c-pantalla-lcd-y-temporizador-2',
      '/luminaria-de-cultivo-indoor-ngen-mawida-240w-cob-luminus-cxm32-3500k-ip44',
    ]) {
      expect(bySource.get(source)?.gone, source).toBeDefined();
    }
    // Compuerta de la Etapa 3: ninguna fila pending
    expect(urls.filter(u => u.pending !== undefined).map(u => u.source)).toEqual([]);
  });

  it('URL finales de Google Ads que daban 404 (lista de la agencia, 2026-10-26): cada una va a su categoría', () => {
    const bySource = new Map(urls.map(u => [u.source, u]));
    const adsFinalUrls: Record<string, string> = {
      'https://elights.cl/alumbrado-publico-mini-cross-200w-ip66-ik08': 'alumbrado-publico',
      'https://elights.cl/ilumin-exterior/alumbrado-vial': 'alumbrado-publico',
      'https://elights.cl/amp-de-bajo-consumo-200w-e40-luz-fria': 'ampolletas-led',
      'https://elights.cl/ampolleta-led-alta-potencia-100w-e40-luz-fria': 'ampolletas-led',
      'https://elights.cl/ampolletas_led/alta-potencia': 'ampolletas-led',
      'https://elights.cl/ampolletas_led/ampolleta-led-bola': 'ampolletas-led',
      'https://elights.cl/ampolletas_led/cfl-ahorro-de-energia': 'ampolletas-led',
      'https://elights.cl/canoa-antiexplosiva-fluorescente-hermética-2x36w-ip66-ik08-120-cm.-c/tubos-c/kit-de-emergencia': 'iluminacion-antiexplosiva',
      'https://elights.cl/iluminacion-antiexplosiva/estancos-hermeticos-fluorescentes-antiexplosivos': 'iluminacion-antiexplosiva',
      'https://elights.cl/luminaria-led-tri-proof-a-prueba-de-explosion-atex-20w': 'iluminacion-antiexplosiva',
      'https://elights.cl/proyector-led-a-prueba-de-explosion-200w': 'iluminacion-antiexplosiva',
      'https://elights.cl/proyector-led-ultra-thin-50w-ip66-negro': 'proyectores-led',
      'https://elights.cl/proyector-led-ultra-thin-100w-ip66-negro': 'proyectores-led',
      'https://elights.cl/proyector-led-ultra-thin-150w-ip66-negro': 'proyectores-led',
      'https://elights.cl/proyector-led-ultra-thin-300w-ip66-negro': 'proyectores-led',
      // La subcategoría «Solar» de PROYECTOR LED, como /proyector-solar
      'https://elights.cl/proyector_led/solar': 'proyectores-led',
      'https://elights.cl/cinta_led/perfiles-de-aluminio': 'cinta-led',
      'https://elights.cl/emergencia-led/lum-emergencia': 'emergencia-led',
      'https://elights.cl/ilumin-interior/puzzle-led': 'paneles-led',
      // Búsquedas de Jumpseller: a la categoría con más resultados
      'https://elights.cl/search/aplique': 'iluminacion-exterior',
      'https://elights.cl/search/embutido': 'paneles-led',
      'https://elights.cl/search/sobrepuesto': 'paneles-led',
    };
    for (const [url, slug] of Object.entries(adsFinalUrls)) {
      // La ruta que manda el navegador (é → %C3%A9)
      const row = bySource.get(new URL(url).pathname);
      expect(row, url).toBeDefined();
      expect(legacyDestination(row!), url).toBe(categoryPath(slug));
    }
  });

  it('URL viejas que la 404 de elights.cl redirige con un script del tema (52, copiadas el 2026-10-26): todas tienen destino', () => {
    const bySource = new Map(urls.map(u => [u.source, u]));
    // Las 46 que no tenían fila. Los productos que ya no se venden van a su categoría, no a la
    // ficha que elige el script (criterio del dueño, 2026-10-23)
    const toCategory: Record<string, string> = {
      '/alumbrado-publico-led-solar-200w-all-in-one': 'solar',
      '/alumbrado-publico-led-solar-200w-con-panel-solar': 'solar',
      '/alumbrado-publico-led-solar-60w-all-in-one-ip65': 'solar',
      '/alumbrado-publico-mini-cross-50w-ip66-ik08': 'alumbrado-publico',
      '/alumbrado-publico/mini-cross': 'alumbrado-publico',
      '/aplique-decorativo-bidireccional-cilindrico-2xe27-ip65-blanco': 'iluminacion-exterior',
      '/aplique-led-bidireccional-rectangular-16w-ip54-gris': 'iluminacion-exterior',
      '/campana-led-ufo-nf4-100w-ip66': 'campanas-led',
      '/campana-led-ufo-nf4-150w-110lm/w-ip66': 'campanas-led',
      '/campana-led-ufo-nf4-200w-110lm/w-ip66': 'campanas-led',
      '/campana-led-ufo-nf4-300w-110lmw-ip66': 'campanas-led',
      '/campana-led-ufo-nf5-150w': 'campanas-led',
      '/campana-led-ufo-nf7-150w-140lmw-ip65': 'campanas-led',
      '/campana-led-ufo-nf8-100w-ip65/w': 'campanas-led',
      '/campana-led-ufo-nf8-150w-ip65/w': 'campanas-led',
      '/campana-led-ufo-nf8-200w-ip65/w': 'campanas-led',
      '/campana-led-ufo-nf8-240w-ip65/w': 'campanas-led',
      '/campana-led-ufo-nf8-300w-ip65/w': 'campanas-led',
      '/foco-dicroico-led-embutido-smd-3w-niquel': 'paneles-led',
      '/foco-dicroico-led-embutido-smd-5w-blanco': 'paneles-led',
      '/foco-dicroico-led-embutido-smd-5w-niquel': 'paneles-led',
      '/foco-dicroico-led-embutido-smd-7w-blanco': 'paneles-led',
      '/foco-dicroico-led-embutido-smd-7w-niquel-2': 'paneles-led',
      '/foco-exterior-empotrado-en-muro-con-rejilla-e27-max-60w': 'iluminacion-exterior',
      '/foco-led-cob-basculante-codo-20w-6000k-ip33': 'paneles-led',
      '/foco-led-dirigible-sobrepuesto-10w-luz-calida-ip20': 'focos-a-riel',
      '/foco-led-solar': 'solar',
      '/iluminacion_antiexplosiva/canopy': 'iluminacion-antiexplosiva',
      '/led-wall-washer-12w-ip65-1': 'lineales-led',
      '/luminaria-industrial-wallpack-led-30w-ip65': 'iluminacion-exterior',
      '/pagoda-led-solar-ufo-90w-all-in-one': 'solar',
      '/panel-led-concentrico-opal-12w-ip20': 'paneles-led',
      '/panel-led-concentrico-opal-25w-ip33': 'paneles-led',
      '/panel-led-luna-18w-ip65': 'paneles-led',
      '/panel-led-redondo-embutido-4w-ip44': 'paneles-led',
      '/proyector-led-cob-20w-gris-ip65-con-sensor-movimiento': 'proyectores-led',
      '/proyector-led-solar-200w-6500k-ip67': 'proyectores-led',
      '/proyector-led-solar-200w-light-ip65': 'proyectores-led',
      '/proyector-led-solar-20w-6500k-ip67': 'proyectores-led',
      '/proyector-led-solar-60w-6500k-ip67': 'proyectores-led',
      '/proyector-led-ultra-thin-200w-ip66-negro': 'proyectores-led',
      '/tortuga-aluminio-redonda-c-rejilla-e27-ip54-blanca': 'iluminacion-exterior',
      '/tubo-led/24v': 'tubos-led',
    };
    const toPage: Record<string, string> = {
      '/catalogos': '/catalogo',
      '/mas-elights': '/empresa',
      '/servicio-al-cliente': '/cotizador',
    };
    // Las 6 que ya tenían fila
    const before = [
      '/alumbrado-publico-led-solar-90w-all-in-one',
      '/foco-dicroico-led-embutido-smd-7w-niquel',
      '/foco-led-codo-basculante-30w-luz-fria-ip33-1',
      '/iluminacion-antiexplosiva/estancos-hermeticos-fluorescentes-antiexplosivos',
      '/proyector-led-ultra-thin-150w-ip66-negro',
      '/proyector-led-ultra-thin-50w-ip66-negro',
    ];
    expect(Object.keys(toCategory).length + Object.keys(toPage).length + before.length).toBe(52);
    const destination = (source: string) => {
      const row = bySource.get(source);
      expect(row, source).toBeDefined();
      return legacyDestination(row!);
    };
    for (const [source, slug] of Object.entries(toCategory)) {
      expect(destination(source), source).toBe(categoryPath(slug));
    }
    for (const [source, path] of Object.entries(toPage)) {
      expect(destination(source), source).toBe(path);
    }
    for (const source of before) {
      expect(destination(source), source).not.toBeNull();
    }
  });

  it('el esquema exige exactamente un destino por fila, sin campos desconocidos ni motivos vacíos', () => {
    const load = (...rows: unknown[]) => () => loadLegacyUrls(JSON.stringify({ urls: rows }));
    expect(load({ source: '/x', product: 1 }, { source: '/y', gone: 'motivo', note: 'nota' })).not.toThrow();
    for (const row of [
      { source: '/x' },
      { source: '/x', product: 1, category: 'solar' },
      { source: '/x', served: false },
      { source: '/x', gone: ' ' },
      { source: '/x', pending: 'motivo', destination: '/' },
      { source: '/x', product: '2251059' },
      { source: '/x', product: 1.5 },
    ]) {
      expect(load(row), JSON.stringify(row)).toThrow(/legacy-urls.json no es válido/);
    }
    expect(() => loadLegacyUrls(JSON.stringify({ urls: [], extra: 1 }))).toThrow(/no es válido/);
  });

  it('cada fuente es la ruta exacta que manda el navegador: minúsculas, sin barra final, no ASCII en %XX mayúscula', () => {
    for (const { source } of urls) expect(source === '/' || isLegacyPath(source), source).toBe(true);
    // Las que llevan regla pasan, además, la guarda de fuentes sin comodín de vercel.json
    for (const r of legacyRules) expect(sourcePaths(r.source), r.source).toEqual([r.source.slice(0, -'{/}?'.length)]);
  });

  it('sin duplicados al normalizar mayúsculas, codificación y barra final (filas, redirecciones y reescrituras)', () => {
    expect(repeated(urls.map(u => normalized(u.source)))).toEqual([]);
    const covered = [...redirects, ...(cfg.rewrites ?? []).slice(1)].flatMap(r => sourcePaths(r.source) ?? [r.source]);
    expect(repeated(covered.map(normalized))).toEqual([]);
  });

  it('ninguna regla empieza por un segmento reservado: api, la app (también las páginas legales), public/, la build o Jumpseller', () => {
    for (const segment of ['api', 'producto', 'catalogo', 'assets', '.well-known', 'fichas', 'robots.txt', 'sitemap.xml', 'spa.html', '404.html']) {
      expect(RESERVED_FIRST_SEGMENTS.has(segment), segment).toBe(true);
    }
    for (const segment of ['buscar', 'carro', 'cotizador', 'empresa', 'medios-de-pago', 'checkout', 'cart', 'customer', 'attachments']) {
      expect(RESERVED_FIRST_SEGMENTS.has(segment), segment).toBe(true);
    }
    for (const f of readdirSync(new URL('../public', import.meta.url))) expect(RESERVED_FIRST_SEGMENTS.has(f), `public/${f}`).toBe(true);
    for (const r of legacyRules) {
      const first = firstSegment(r.source.slice(0, -'{/}?'.length));
      expect(RESERVED_FIRST_SEGMENTS.has(first), `${r.source} empieza por /${first}`).toBe(false);
    }
    // La guarda también vale para las de un solo segmento ('/checkout{/}?' no es 'checkout{')
    expect(firstSegment('/checkout')).toBe('checkout');
    for (const source of ['/checkout', '/fichas', '/producto', '/fichas/a.pdf', '/api', '/cotizador', '/empresa']) {
      expect(() => legacyRedirects([{ source, path: '/' }]), source).toThrow(/segmento reservado/);
    }
    expect(legacyRedirects([{ source: '/checkout', gone: 'sistema de Jumpseller' }])).toEqual([]); // sin regla, no tapa nada
  });

  it('una URL que la app ya sirve queda como served', () => {
    for (const u of urls) {
      if (appRoutes.has(u.source)) expect(u.served, `${u.source} es una ruta de la app`).toBe(true);
      if (u.served) expect(appRoutes.has(u.source), `${u.source} es served, pero la app no tiene esa ruta`).toBe(true);
    }
  });

  it('los destinos salen de las tablas congeladas: id vigente del producto, categoría existente o página fija', () => {
    const slugs = new Set(categories.map(c => c.slug));
    // Páginas fijas: las prerenderizadas y /buscar; nunca las que dependen de la sesión
    expect([...LEGACY_PAGE_DESTINATIONS].sort()).toEqual([...STATIC_ROUTES, '/buscar'].sort());
    for (const u of urls) {
      const destination = legacyDestination(u);
      if (u.product !== undefined) {
        const id = currentSiteId(u.product);
        expect(id, `${u.source}: producto ${u.product} sin id del sitio`).toBeTruthy();
        expect(RETIRED_SITE_IDS.has(id), `${u.source} → ${id}, un id retirado (PR 07)`).toBe(false);
        expect(destination).toBe(productPath(id));
      } else if (u.category !== undefined) {
        expect(slugs.has(u.category), `${u.source}: categoría ${u.category}`).toBe(true);
        expect(destination).toBe(categoryPath(u.category));
      } else if (u.path !== undefined) {
        expect(LEGACY_PAGE_DESTINATIONS.has(u.path), `${u.source} → ${u.path}`).toBe(true);
        expect(destination).toBe(u.path);
      } else {
        expect(destination, u.source).toBeNull();
      }
      // Sin barra final, '?' ni '#': Vercel agrega la consulta original
      if (destination && destination !== '/') expect(destination, u.source).toMatch(/^(\/[a-z0-9]+(-[a-z0-9]+)*)+$/);
    }
    // Una fila que no se puede resolver hace fallar `npm run redirects:write` y esta prueba
    expect(() => legacyDestination({ source: '/x', product: 999 })).toThrow(/sin id del sitio/);
    expect(() => legacyDestination({ source: '/x', category: 'no-existe' })).toThrow(/categories\.config/);
    for (const path of ['/cotizacion/', '/cotizacion', '/solicitar-pedido', '/carro', '/catalogo/solar']) {
      expect(() => legacyDestination({ source: '/x', path }), path).toThrow(/LEGACY_PAGE_DESTINATIONS/);
    }
  });

  it('sin cadenas ni bucles: ningún destino vuelve a redirigir', () => {
    const covered = new Set(redirects.flatMap(r => sourcePaths(r.source) ?? []).map(normalized));
    for (const r of redirects) expect(covered.has(normalized(r.destination ?? '')), `${r.source} → ${r.destination}, que vuelve a redirigir`).toBe(false);
  });

  it('301 exacto, con o sin barra final, después del bloque de la PR 07, que no cambia', () => {
    const before = [{ source: '/carro{/}?', destination: '/solicitar-pedido', permanent: false }, ...renamedIdRedirects()];
    expect(redirects.slice(0, before.length)).toEqual(before);
    expect(redirects.slice(before.length)).toEqual(legacyRules);
    expect(legacyRules).toHaveLength(urls.filter(u => legacyDestination(u) !== null).length);
    for (const r of legacyRules) {
      // Con `permanent` Vercel respondería 308 e ignoraría statusCode
      expect(Object.keys(r).sort(), r.source).toEqual(['destination', 'source', 'statusCode']);
      expect(r.statusCode, r.source).toBe(301);
      expect(r.source.endsWith('{/}?'), r.source).toBe(true);
    }
  });

  it('Vercel compila cada fuente como una ruta literal (path-to-regexp 6.1.0 y 6.3.0, como @vercel/routing-utils)', () => {
    // sourceToRegex de @vercel/routing-utils: compara la ruta sin decodificar, distinguiendo mayúsculas
    const options = { strict: true, sensitive: true, delimiter: '/' };
    for (const r of redirects) {
      const [re, updated] = [pathToRegexp61, pathToRegexp63].map(compile => {
        const keys: Key[] = [];
        const regexp = compile(r.source, keys, options);
        expect(keys, `${r.source} tiene parámetros`).toEqual([]);
        return regexp;
      });
      expect(updated.source, r.source).toBe(re.source);
      for (const path of sourcePaths(r.source) ?? []) {
        expect(re.test(path), path).toBe(true);
        expect(re.test(`${path}/`), `${path}/`).toBe(true);
        expect(re.test(`${path}x`), `${path}x`).toBe(false);
        expect(re.test(`${path}//`), `${path}//`).toBe(false);
        if (path.toUpperCase() !== path) expect(re.test(path.toUpperCase()), path.toUpperCase()).toBe(false);
      }
    }
  });

  it(`como máximo ${MAX_REDIRECTS} redirecciones (Vercel acepta 2.048)`, () => {
    expect(redirects.length).toBeLessThanOrEqual(MAX_REDIRECTS);
  });

  it('el id vigente de cada producto publicado es el de las tablas: las reglas no dependen del catálogo', () => {
    for (const p of products) expect(currentSiteId(p.jumpseller_id), String(p.jumpseller_id)).toBe(p.id);
  });
});
