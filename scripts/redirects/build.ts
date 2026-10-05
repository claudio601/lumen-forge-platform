// scripts/redirects/build.ts
// Las redirecciones de vercel.json. Se generan: `npm run redirects:write` escribe
// buildRedirects() en vercel.json y scripts/vercel-config.test.ts exige que sean iguales.
// Nunca editarlas a mano: después de cambiar src/data/catalog/renamed-ids.ts o
// scripts/redirects/legacy-urls.json, correr `npm run redirects:write`.
//
//   1. Rutas que solo redirigen (REDIRECT_ROUTES): 307 al mismo destino que su <Navigate>
//      en src/routes.tsx. Temporal: el sitio todavía no es el dominio principal.
//   2. Ids de producto renombrados (src/data/catalog/renamed-ids.ts): 301 de cada id
//      anterior al vigente, con o sin barra final. Vercel conserva la consulta (?gclid=…).
//   3. URLs de elights.cl en Jumpseller (legacy-urls.json, PR 08): 301 de cada URL vieja a
//      su página en el sitio nuevo, con o sin barra final. También conserva la consulta.
//
// Solo depende de tablas congeladas o mantenidas a mano: renamed-ids.ts, legacy-ids.ts, los
// ids ya registrados en site-ids.generated.ts (el robot solo agrega, nunca cambia uno), los
// slugs de categories.config.ts y legacy-urls.json. No mira qué productos se publican ni el
// snapshot: así la sincronización con Jumpseller nunca la cambia ni hace fallar sus pruebas.

import { readdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { LEGACY_SITE_IDS } from '../../src/data/catalog/legacy-ids';
import { SITE_IDS } from '../../src/data/catalog/site-ids.generated';
import { RENAMED_SITE_IDS } from '../../src/data/catalog/renamed-ids';
import { categories } from '../../src/data/catalog/categories.config';
import { categoryPath, DYNAMIC_ROUTE_PATTERNS, NOINDEX_ROUTES, productPath, REDIRECT_ROUTES, STATIC_ROUTES } from '../../src/lib/seo/routes';

export interface RedirectRule {
  source: string;
  destination: string;
  /** false = 307. Solo en las temporales: con `permanent` Vercel ignora `statusCode`. */
  permanent?: boolean;
  /** 301 en los ids renombrados y las URLs de elights.cl (`permanent: true` daría 308). */
  statusCode?: 301;
}

/** Límite propio (Vercel acepta 2.048 redirecciones en vercel.json). */
export const MAX_REDIRECTS = 1000;

const TEMPORARY: RedirectRule[] = [{ source: '/carro{/}?', destination: '/solicitar-pedido', permanent: false }];

const bySource = (a: RedirectRule, b: RedirectRule) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);

/** Un 301 por cada id anterior, directo al id vigente (sin cadenas), ordenados por fuente. */
export function renamedIdRedirects(): RedirectRule[] {
  return Object.values(RENAMED_SITE_IDS)
    .flatMap(r => r.previous.map(old => ({ source: `${productPath(old)}{/}?`, destination: productPath(r.id), statusCode: 301 as const })))
    .sort(bySource);
}

// --- URLs de elights.cl (PR 08) ---------------------------------------------------------

/**
 * Páginas que crea la PR 12. Mientras tanto ninguna URL vieja redirige desde ahí. Al crear
 * cada una: sacarla de aquí, agregarla a STATIC_ROUTES y pasar su fila de legacy-urls.json a
 * `served` (/medios-de-pago) o darle destino a las que esperan esa página.
 */
export const PLANNED_ROUTES = [
  '/empresa',
  '/terminos-y-condiciones',
  '/cambios-devoluciones-y-garantia',
  '/despacho',
  '/medios-de-pago',
  '/politica-de-privacidad',
] as const;

/** Rutas de sistema de Jumpseller (carro, pago, cuentas, adjuntos): las resuelve la Etapa 3. */
const JUMPSELLER_SYSTEM_SEGMENTS = ['cart', 'checkout', 'v2', 'customer', 'orders', 'admin', 'attachments', 'quote'];

/**
 * Primeros segmentos desde los que una URL vieja nunca redirige: las funciones (api), las
 * páginas de la app y las planeadas, los archivos de public/ y de la build, lo reservado por
 * Vercel y las rutas de sistema de Jumpseller. Vercel aplica las redirecciones antes que los
 * archivos: una regla ahí taparía una página, un archivo o un webhook.
 */
export const RESERVED_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  'api',
  'producto',
  'catalogo',
  'assets',
  '.well-known',
  '_vercel',
  'index.html',
  '404.html',
  'spa.html',
  'robots.txt',
  'sitemap.xml',
  ...readdirSync(new URL('../../public', import.meta.url)),
  ...[...STATIC_ROUTES, ...NOINDEX_ROUTES, ...REDIRECT_ROUTES, ...DYNAMIC_ROUTE_PATTERNS, ...PLANNED_ROUTES]
    .map(route => route.split('/')[1])
    .filter(Boolean),
  ...JUMPSELLER_SYSTEM_SEGMENTS,
]);

/** Qué pasa con cada URL vieja: exactamente uno por fila. */
export const LEGACY_TARGET_KEYS = ['product', 'category', 'path', 'served', 'gone', 'pending'] as const;

const reason = z.string().trim().min(1);

const LegacyUrlSchema = z
  .object({
    /** La ruta tal como la manda el navegador (la canónica de Jumpseller), sin barra final. */
    source: z.string().min(1),
    /** jumpseller_id: 301 a la ficha, con su id vigente. */
    product: z.number().int().positive().optional(),
    /** Slug de categories.config.ts: 301 a /catalogo/<slug>. */
    category: z.string().min(1).optional(),
    /** Una de LEGACY_PAGE_DESTINATIONS ('/', STATIC_ROUTES o /buscar): 301 ahí. */
    path: z.string().min(1).optional(),
    /** El sitio nuevo sirve esa misma URL: sin regla. */
    served: z.literal(true).optional(),
    /** 404 definitiva y aprobada (motivo). */
    gone: reason.optional(),
    /** 404 por ahora (motivo): se resuelve antes de la Etapa 3. */
    pending: reason.optional(),
    note: reason.optional(),
  })
  .strict()
  .refine(e => LEGACY_TARGET_KEYS.filter(k => e[k] !== undefined).length === 1, {
    message: `cada URL lleva exactamente uno de: ${LEGACY_TARGET_KEYS.join(', ')}`,
  });

export type LegacyUrl = z.infer<typeof LegacyUrlSchema>;

const LegacyUrlsFileSchema = z.object({ urls: z.array(LegacyUrlSchema) }).strict();

/** Lee y valida legacy-urls.json (o el texto que se le pase). */
export function loadLegacyUrls(text = readFileSync(new URL('./legacy-urls.json', import.meta.url), 'utf8')): LegacyUrl[] {
  const parsed = LegacyUrlsFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`scripts/redirects/legacy-urls.json no es válido: ${issues}`);
  }
  return parsed.data.urls;
}

export const LEGACY_URLS: readonly LegacyUrl[] = loadLegacyUrls();

/**
 * Id vigente de un producto registrado, publicado o no. El mismo orden que
 * src/data/catalog/index.ts: renombrado > sincronización > catálogo legado.
 */
export function currentSiteId(jid: number): string | undefined {
  return RENAMED_SITE_IDS[jid]?.id ?? SITE_IDS[jid] ?? LEGACY_SITE_IDS[jid];
}

const CATEGORY_SLUGS = new Set(categories.map(c => c.slug));
/**
 * Páginas fijas a las que puede ir una URL vieja (`path`): las prerenderizadas de STATIC_ROUTES
 * (incluye '/') y /buscar (spa.html, lee ?q=). /cotizacion y /solicitar-pedido no: dependen de
 * la sesión. La misma lista usan vercel-config.test.ts y check-prerender.ts.
 */
export const LEGACY_PAGE_DESTINATIONS: ReadonlySet<string> = new Set<string>([...STATIC_ROUTES, '/buscar']);

/** Destino de la regla de una URL vieja, o null si no lleva regla (served, gone, pending). */
export function legacyDestination(e: LegacyUrl): string | null {
  if (e.product !== undefined) {
    const id = currentSiteId(e.product);
    if (!id) throw new Error(`legacy-urls.json: ${e.source} → producto ${e.product} sin id del sitio (renamed-ids.ts, site-ids.generated.ts o legacy-ids.ts)`);
    return productPath(id);
  }
  if (e.category !== undefined) {
    if (!CATEGORY_SLUGS.has(e.category)) throw new Error(`legacy-urls.json: ${e.source} → categoría "${e.category}", que no está en categories.config.ts`);
    return categoryPath(e.category);
  }
  if (e.path !== undefined) {
    if (!LEGACY_PAGE_DESTINATIONS.has(e.path)) throw new Error(`legacy-urls.json: ${e.source} → "${e.path}", que no está en LEGACY_PAGE_DESTINATIONS (STATIC_ROUTES o /buscar)`);
    return e.path;
  }
  return null;
}

/** Primer segmento de una ruta, sin decodificar ('/fichas/a.pdf' → 'fichas'). */
export const firstSegment = (path: string) => path.split('/')[1] ?? '';

/** Un 301 por cada URL vieja con destino, con o sin barra final, ordenados por fuente. */
export function legacyRedirects(urls: readonly LegacyUrl[] = LEGACY_URLS): RedirectRule[] {
  return urls
    .flatMap(e => {
      const destination = legacyDestination(e);
      if (destination && RESERVED_FIRST_SEGMENTS.has(firstSegment(e.source))) {
        throw new Error(`legacy-urls.json: ${e.source} empieza por un segmento reservado (RESERVED_FIRST_SEGMENTS); su 301 taparía una página, un archivo o una función`);
      }
      return destination ? [{ source: `${e.source}{/}?`, destination, statusCode: 301 as const }] : [];
    })
    .sort(bySource);
}

export function buildRedirects(): RedirectRule[] {
  return [...TEMPORARY, ...renamedIdRedirects(), ...legacyRedirects()];
}
