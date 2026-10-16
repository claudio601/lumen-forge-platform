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
 * Versión de los textos legales (términos, cambios y garantía, privacidad), desde cuándo
 * rigen y versiones anteriores publicadas. Texto fijo, nunca new Date() ni Intl: el servidor
 * y el navegador dibujan lo mismo. Al cambiar un texto legal, sube las constantes en
 * api/_lib/forms/consent.ts y corre npm run legal:archive; el servidor, los formularios y el
 * archivo leen de ahí.
 */
export { LEGAL_VERSION, LEGAL_UPDATED, LEGAL_UPDATED_LABEL, LEGAL_ARCHIVE } from '../../api/_lib/forms/consent';

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
