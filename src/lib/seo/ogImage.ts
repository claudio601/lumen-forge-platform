// src/lib/seo/ogImage.ts
// Imagen para compartir (og:image, twitter:image) de una ficha: la primera foto original
// de Jumpseller cuando WhatsApp y Facebook la pueden mostrar; si no, la imagen de la marca.
// Una sola regla, pura y con imports relativos: la usan la ficha (ProductDetail), la
// revisión del HTML estático (scripts/check-prerender.ts) y el informe de la
// sincronización (scripts/jumpseller/og-images.ts).

import { absoluteUrl, DEFAULT_OG_IMAGE } from '../../config/site';
import type { ProductImageFacts } from '../../data/catalog/jumpseller.types';

/**
 * Peso máximo (excluido) de la foto. La documentación de Meta para las vistas previas de
 * enlaces en WhatsApp pide una imagen "under 600KB"; Facebook acepta hasta 8 MB, así que
 * manda WhatsApp. El CDN de Jumpseller solo entrega WebP (revisado el 2026-10-05) y Meta
 * no lista WebP para og:image: por eso se usa la foto original o la de la marca.
 */
export const OG_MAX_BYTES = 600_000;

/** Mínimos de WhatsApp y Facebook: 300 px de ancho, 200 px el lado corto y proporción hasta 4:1. */
const MIN_WIDTH = 300;
const MIN_SIDE = 200;
const MAX_RATIO = 4;

/** Ruta de una foto que las redes muestran (sin WebP, GIF ni SVG). */
const PHOTO_PATH = /\.(jpe?g|png)$/i;

export interface OgImage {
  /** URL de la imagen (ruta del sitio o absoluta), sin codificar. */
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

/** Imagen de la marca: JPEG de 1200×630 (82.683 bytes), el logo sobre un poste solar de noche. */
export const DEFAULT_OG: OgImage = {
  url: DEFAULT_OG_IMAGE,
  width: 1200,
  height: 630,
  alt: 'eLIGHTS.cl: iluminación LED profesional',
};

/**
 * URL codificada como la emite el navegador (UTF-8 con %XX, sin normalizar). Idempotente:
 * deja intacto lo ya codificado (%2C sigue siendo %2C). Si no es una URL absoluta, la devuelve igual.
 */
export function encodeImageUrl(u: string): string {
  try {
    return new URL(u).href;
  } catch {
    return u;
  }
}

/** URL absoluta y codificada de una imagen para compartir: la que va en og:image y twitter:image. */
export function ogImageUrl(img: OgImage): string {
  return encodeImageUrl(absoluteUrl(img.url));
}

/** Por qué una ficha no usa su foto (para el informe de la sincronización). */
export type OgImageIssue = 'sin-foto' | 'sin-revisar' | 'formato' | 'peso' | 'url' | 'medidas';

function isHttpsPhoto(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PHOTO_PATH.test(decodeURIComponent(u.pathname));
  } catch {
    return false;
  }
}

/** null si la primera foto sirve como imagen para compartir; si no, el motivo. */
export function ogImageIssue(firstUrl: string | undefined, facts: ProductImageFacts | undefined): OgImageIssue | null {
  if (!firstUrl) return 'sin-foto';
  // Un dato de otra foto (el producto la cambió en Jumpseller) no sirve: se revisa en la próxima sincronización
  if (!facts || facts.url !== firstUrl || !Number.isInteger(facts.bytes) || facts.bytes <= 0) return 'sin-revisar';
  if (facts.format !== 'png' && facts.format !== 'jpeg') return 'formato';
  if (facts.bytes >= OG_MAX_BYTES) return 'peso';
  if (!isHttpsPhoto(firstUrl)) return 'url';
  const { width, height } = facts;
  if (width && height) {
    const short = Math.min(width, height);
    if (width < MIN_WIDTH || short < MIN_SIDE || Math.max(width, height) / short > MAX_RATIO) return 'medidas';
  }
  return null;
}

/**
 * Imagen para compartir de una ficha: su primera foto (PNG o JPEG según sus bytes, de menos
 * de 600 KB, https, con medidas suficientes si se conocen), o undefined para usar DEFAULT_OG.
 */
export function productOgImage(firstUrl: string | undefined, facts: ProductImageFacts | undefined, alt: string): OgImage | undefined {
  if (ogImageIssue(firstUrl, facts)) return undefined;
  const { width, height } = facts!;
  return { url: firstUrl!, ...(width && height ? { width, height } : {}), alt };
}
