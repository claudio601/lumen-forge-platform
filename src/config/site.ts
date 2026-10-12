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

/** RUT de la empresa (no de una persona), que el dueño entregó para publicar. */
export const LEGAL_RUT = '76.947.784-6';

/** Domicilio publicado: solo la comuna (decisión del dueño, 2026-10-01). */
export const LEGAL_COMUNA = 'Santiago';

/** Representante legal (DS 6 art. 7). Sin dato del dueño: null y las páginas omiten la línea. */
export const LEGAL_REPRESENTATIVE: string | null = null;

/**
 * Versión de los textos legales (términos, cambios y garantía, privacidad) y desde cuándo
 * rigen. Texto fijo, nunca new Date() ni Intl: el servidor y el navegador dibujan lo mismo.
 * Al cambiar un texto legal se actualizan las tres constantes. La PR 13 guarda {version, at}
 * con cada envío.
 */
export const LEGAL_VERSION = '1.0';
export const LEGAL_UPDATED = '2026-10-12';
export const LEGAL_UPDATED_LABEL = '12 de octubre de 2026';

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
