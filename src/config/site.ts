// src/config/site.ts
// Dirección pública del sitio: canonical, og:url, sitemap, robots y JSON-LD la
// toman de aquí. api/_lib/site.ts es la fuente única para el frontend y la API.
// El dominio público es https://elights.cl desde la Etapa 3; desplegar ese cambio
// solo el día del corte a Vercel. nuevo.elights.cl conserva su noindex por host.
// La URL pública no depende de variables de entorno ni cambia los webhooks.

import { SITE_URL } from '../../api/_lib/site';

export { SITE_URL };

export const SITE_NAME = 'eLIGHTS.cl';

/** Razón social publicada (dato del dueño, 2026-10-01). */
export const LEGAL_NAME = 'eLIGHTS.CL SpA';

/** RUT de la empresa (no de una persona), que el dueño entregó para publicar. */
export const LEGAL_RUT = '76.947.784-5';

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
