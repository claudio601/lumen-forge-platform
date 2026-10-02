// src/data/catalog/content.ts
// Contenido SEO por producto (./content/<jumpseller_id>.json), cargado a pedido: cada
// archivo es un trozo aparte del bundle y solo se descarga al abrir esa ficha.

import { startTransition, useEffect, useState } from 'react';
import type { ProductContent } from './types';

const loaders = import.meta.glob<ProductContent>('./content/*.json', { import: 'default' });
const cache = new Map<number, ProductContent>();

const loaderFor = (jumpsellerId: number) => loaders[`./content/${jumpsellerId}.json`];

/** true si el producto tiene contenido SEO escrito. */
export const hasProductContent = (jumpsellerId: number) => !!loaderFor(jumpsellerId);

/** Contenido ya cargado (síncrono): para el render del servidor una vez precargado. */
export const getProductContent = (jumpsellerId: number) => cache.get(jumpsellerId);

/** Descarga el contenido del producto (si tiene) y lo deja en caché. */
export async function loadProductContent(jumpsellerId: number): Promise<ProductContent | undefined> {
  const cached = cache.get(jumpsellerId);
  if (cached) return cached;
  const load = loaderFor(jumpsellerId);
  if (!load) return undefined;
  const content = await load();
  cache.set(jumpsellerId, content);
  return content;
}

/**
 * Contenido del producto para la ficha. Si no está en caché, el primer render va sin él
 * (igual que el HTML del servidor, así la hidratación no difiere) y llega en un efecto.
 */
export function useProductContent(jumpsellerId: number | undefined): ProductContent | undefined {
  const [content, setContent] = useState(() => (jumpsellerId ? cache.get(jumpsellerId) : undefined));
  useEffect(() => {
    if (!jumpsellerId) return;
    let alive = true;
    setContent(cache.get(jumpsellerId));
    loadProductContent(jumpsellerId)
      .then(c => alive && startTransition(() => setContent(c)))
      .catch(() => undefined); // sin contenido SEO la ficha igual muestra especificaciones y texto de Jumpseller
    return () => {
      alive = false;
    };
  }, [jumpsellerId]);
  return content;
}
