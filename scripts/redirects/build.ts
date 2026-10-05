// scripts/redirects/build.ts
// Las redirecciones de vercel.json. Se generan: `npm run redirects:write` escribe
// buildRedirects() en vercel.json y scripts/vercel-config.test.ts exige que sean iguales.
// Nunca editarlas a mano.
//
//   1. Rutas que solo redirigen (REDIRECT_ROUTES): 307 al mismo destino que su <Navigate>
//      en src/routes.tsx. Temporal: el sitio todavía no es el dominio principal.
//   2. Ids de producto renombrados (src/data/catalog/renamed-ids.ts): 301 de cada id
//      anterior al vigente, con o sin barra final. Vercel conserva la consulta (?gclid=…).
//
// Solo depende de la tabla de renombres, no de qué productos se publican: así la
// sincronización con Jumpseller nunca la cambia ni hace fallar sus pruebas.

import { RENAMED_SITE_IDS } from '../../src/data/catalog/renamed-ids';
import { productPath } from '../../src/lib/seo/routes';

export interface RedirectRule {
  source: string;
  destination: string;
  /** false = 307. Solo en las temporales: con `permanent` Vercel ignora `statusCode`. */
  permanent?: boolean;
  /** 301 en los ids renombrados (`permanent: true` daría 308). */
  statusCode?: 301;
}

/** Límite propio (Vercel acepta 2.048 redirecciones en vercel.json). */
export const MAX_REDIRECTS = 1000;

const TEMPORARY: RedirectRule[] = [{ source: '/carro{/}?', destination: '/solicitar-pedido', permanent: false }];

/** Un 301 por cada id anterior, directo al id vigente (sin cadenas), ordenados por fuente. */
export function renamedIdRedirects(): RedirectRule[] {
  return Object.values(RENAMED_SITE_IDS)
    .flatMap(r => r.previous.map(old => ({ source: `${productPath(old)}{/}?`, destination: productPath(r.id), statusCode: 301 as const })))
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

export function buildRedirects(): RedirectRule[] {
  return [...TEMPORARY, ...renamedIdRedirects()];
}
