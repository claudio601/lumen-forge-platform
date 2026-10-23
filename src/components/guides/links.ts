// src/components/guides/links.ts
// A dónde lleva cada destino de un enlace de una guía (src/data/guides/types.ts). Lo usan
// GuideRich (el texto), GuideFinalBox (el correo) y GuideLayout (las fichas del bloque D.S. N°1).

import { contactEmail } from '@/config/business';
import { products } from '@/data/products';
import { categoryPath, productPath } from '@/lib/seo/routes';
import { guidePath, isPublishedGuide } from '@/data/guides/index';
import type { GuideLink, Rich } from '@/data/guides/types';

/** Rutas cuyo clic desde una guía es un llamado a la acción medido. */
export const MEASURED_ROUTES: readonly string[] = ['/cotizador', '/estudio-luminico'];

/** La ficha publicada de la lista (ids de Jumpseller en orden de preferencia), o null. */
export function firstPublishedProduct(ids: readonly number[]): string | null {
  for (const id of ids) {
    const p = products.find(x => x.jumpseller_id === id);
    if (p) return productPath(p.id);
  }
  return null;
}

export const mailHref = (subject?: string) => `mailto:${contactEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;

type Resolved = { kind: 'route' | 'anchor' | 'external' | 'mail'; href: string } | null;

/** A dónde lleva un destino; null si no hay enlace (guía sin publicar o fichas sin publicar). */
export function resolveGuideLink(to: GuideLink): Resolved {
  if ('category' in to) return { kind: 'route', href: categoryPath(to.category) };
  if ('guide' in to) return isPublishedGuide(to.guide) ? { kind: 'route', href: guidePath(to.guide) } : null;
  if ('route' in to) return { kind: 'route', href: to.route };
  if ('products' in to) {
    const href = firstPublishedProduct(to.products);
    return href ? { kind: 'route', href } : null;
  }
  if ('mail' in to) return { kind: 'mail', href: mailHref(to.mail.subject) };
  if ('anchor' in to) return { kind: 'anchor', href: `#${to.anchor}` };
  return { kind: 'external', href: to.external };
}

/** true si el texto no muestra nada (solo trozos de guías sin publicar). */
export function isEmptyRich(content: Rich): boolean {
  return content.every(part => (typeof part === 'string' ? !part.trim() : 'ifGuide' in part ? !isPublishedGuide(part.ifGuide) || isEmptyRich(part.parts) : false));
}
