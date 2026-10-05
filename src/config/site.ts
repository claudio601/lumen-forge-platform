// src/config/site.ts
// Dirección pública del sitio: canonical, og:url, sitemap, robots y JSON-LD la
// toman de aquí. Hasta el cambio de dominio es nuevo.elights.cl, que está fuera de
// Google por la cabecera X-Robots-Tag (vercel.json). La PR del cambio de dominio
// (Etapa 3) la cambia a https://elights.cl. Es una constante a propósito, para no
// depender de variables de entorno de Vercel.

export const SITE_URL = 'https://nuevo.elights.cl';

export const SITE_NAME = 'eLIGHTS.cl';

/** Razón social publicada (dato del dueño, 2026-10-01). */
export const LEGAL_NAME = 'eLIGHTS.CL SpA';

/**
 * Imagen por defecto para compartir enlaces: JPEG de 1200×630 y 82.683 bytes (las redes no
 * muestran SVG). Sus medidas y su texto alternativo están en DEFAULT_OG (src/lib/seo/ogImage.ts).
 */
export const DEFAULT_OG_IMAGE = '/og-default.jpg';

/** URL absoluta del sitio para una ruta ('/catalogo' → 'https://…/catalogo'). Deja intactas las URLs absolutas. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return SITE_URL + (pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`);
}
