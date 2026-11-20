// scripts/redirects/build.ts
// Las redirecciones de vercel.json. Se generan: `npm run redirects:write` escribe
// buildRedirects() en vercel.json y scripts/vercel-config.test.ts exige que sean iguales.
// Nunca editarlas a mano: después de cambiar src/data/catalog/renamed-ids.ts (también
// UNPUBLISHED_RENAMED o MERGED_SITE_IDS) o scripts/redirects/legacy-urls.json, correr
// `npm run redirects:write`.
//
//   1. Rutas que solo redirigen (REDIRECT_ROUTES): 307 al mismo destino que su <Navigate>
//      en src/routes.tsx. Temporal: el sitio todavía no es el dominio principal.
//   2. Ids de producto renombrados (src/data/catalog/renamed-ids.ts): 301 de cada id
//      anterior al vigente, con o sin barra final. Vercel conserva la consulta (?gclid=…).
//      Si el producto ya no se publica (UNPUBLISHED_RENAMED), el 301 va a su categoría o a
//      /catalogo, como las filas `category` de legacy-urls.json. En el mismo bloque, los ids
//      de productos fusionados (MERGED_SITE_IDS, en renamed-ids.ts): 301 a la ficha del que
//      los reemplaza.
//   3. URLs de elights.cl en Jumpseller (legacy-urls.json, PR 08): 301 de cada URL vieja a
//      su página en el sitio nuevo, con o sin barra final. También conserva la consulta.
//
// Solo depende de tablas congeladas o mantenidas a mano: renamed-ids.ts (con UNPUBLISHED_RENAMED
// y MERGED_SITE_IDS), legacy-ids.ts, los ids ya registrados en site-ids.generated.ts (el robot
// solo agrega, nunca cambia uno), los slugs de categories.config.ts y legacy-urls.json. No mira
// qué productos se publican ni el snapshot: así la sincronización con Jumpseller nunca la cambia
// ni hace fallar sus pruebas. Cuando un producto sale o vuelve al catálogo, check:prerender avisa.

import { readdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { LEGACY_SITE_IDS } from '../../src/data/catalog/legacy-ids';
import { SITE_IDS } from '../../src/data/catalog/site-ids.generated';
import { MERGED_SITE_IDS, RENAMED_SITE_IDS, UNPUBLISHED_RENAMED } from '../../src/data/catalog/renamed-ids';
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
export const MAX_REDIRECTS = 1500;

const TEMPORARY: RedirectRule[] = [{ source: '/carro{/}?', destination: '/solicitar-pedido', permanent: false }];

const bySource = (a: RedirectRule, b: RedirectRule) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);

const CATEGORY_SLUGS = new Set(categories.map(c => c.slug));

export { UNPUBLISHED_RENAMED };

/**
 * Destino de los ids anteriores de un producto renombrado: su ficha, con el id vigente, o, si ya
 * no se publica (`unpublished`), su categoría o /catalogo.
 */
export function renamedIdDestination(jid: number, unpublished: Readonly<Record<number, string | null>> = UNPUBLISHED_RENAMED): string {
  const renamed = RENAMED_SITE_IDS[jid];
  if (!renamed) throw new Error(`renamedIdDestination: el producto ${jid} no está en src/data/catalog/renamed-ids.ts`);
  if (!Object.hasOwn(unpublished, jid)) return productPath(renamed.id);
  const slug = unpublished[jid];
  if (slug === null) return '/catalogo';
  if (!CATEGORY_SLUGS.has(slug)) throw new Error(`UNPUBLISHED_RENAMED: producto ${jid} → categoría "${slug}", que no está en categories.config.ts`);
  return categoryPath(slug);
}

/**
 * Destino de los ids de un producto fusionado (MERGED_SITE_IDS): la ficha del que lo reemplaza,
 * con su id vigente (o, si es un renombrado que ya no se publica, su categoría o /catalogo).
 * Falla si la tabla no cuadra: un retirado que también es renombrado, una cadena de fusiones o un
 * `id` que ya no es el vigente del que lo reemplaza.
 */
export function mergedIdDestination(jid: number, unpublished: Readonly<Record<number, string | null>> = UNPUBLISHED_RENAMED): string {
  const merged = MERGED_SITE_IDS[jid];
  if (!merged) throw new Error(`mergedIdDestination: el producto ${jid} no está en MERGED_SITE_IDS (src/data/catalog/renamed-ids.ts)`);
  const where = `MERGED_SITE_IDS (src/data/catalog/renamed-ids.ts): ${jid} → ${merged.into}`;
  if (RENAMED_SITE_IDS[jid]) throw new Error(`${where}: ${jid} también está en RENAMED_SITE_IDS`);
  if (merged.into === jid || MERGED_SITE_IDS[merged.into]) throw new Error(`${where}: ${merged.into} también es un producto fusionado (sin cadenas)`);
  const id = currentSiteId(merged.into);
  if (merged.id !== id) throw new Error(`${where}: dice id "${merged.id}", pero el vigente de ${merged.into} es "${id ?? 'ninguno'}"`);
  return RENAMED_SITE_IDS[merged.into] ? renamedIdDestination(merged.into, unpublished) : productPath(merged.id);
}

/**
 * Un 301 por cada id anterior, directo al id vigente (sin cadenas), o a la categoría si el
 * producto ya no se publica; también los ids de los productos fusionados, a la ficha del que los
 * reemplaza. Ordenados por fuente.
 */
export function renamedIdRedirects(unpublished: Readonly<Record<number, string | null>> = UNPUBLISHED_RENAMED): RedirectRule[] {
  for (const jid of Object.keys(unpublished).map(Number)) {
    if (!RENAMED_SITE_IDS[jid]) throw new Error(`UNPUBLISHED_RENAMED: el producto ${jid} no está en src/data/catalog/renamed-ids.ts`);
  }
  const rules = (previous: readonly string[], destination: string) =>
    previous.map(old => ({ source: `${productPath(old)}{/}?`, destination, statusCode: 301 as const }));
  return [
    ...Object.entries(RENAMED_SITE_IDS).flatMap(([jid, r]) => rules(r.previous, renamedIdDestination(Number(jid), unpublished))),
    ...Object.entries(MERGED_SITE_IDS).flatMap(([jid, m]) => rules(m.previous, mergedIdDestination(Number(jid), unpublished))),
  ].sort(bySource);
}

// --- URLs de elights.cl (PR 08) ---------------------------------------------------------

/** Rutas de sistema de Jumpseller (carro, pago, cuentas, adjuntos): las resuelve la Etapa 3. */
const JUMPSELLER_SYSTEM_SEGMENTS = ['cart', 'checkout', 'v2', 'customer', 'orders', 'admin', 'attachments', 'quote'];

/**
 * Primeros segmentos desde los que una URL vieja nunca redirige: las funciones (api), las
 * páginas de la app, los archivos de public/ y de la build, lo reservado por
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
  // Feed de Google Merchant (scripts/merchant-feed.ts, CLAUDE.md §18): lo escribe la build en dist/feeds/
  'feeds',
  ...readdirSync(new URL('../../public', import.meta.url)),
  ...[...STATIC_ROUTES, ...NOINDEX_ROUTES, ...REDIRECT_ROUTES, ...DYNAMIC_ROUTE_PATTERNS]
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
