// src/data/guides/content.ts
// Cuerpo de cada guía (./content/<slug>.ts), cargado a pedido: cada archivo es un trozo aparte
// del bundle y solo se descarga al abrir esa guía. El patrón de src/data/catalog/content.ts.
//
// La página lee el cuerpo con readGuideContent: si no está en caché, suspende (Suspense) hasta
// que llega. Antes de dibujar una página estática, la ruta lo precarga (src/routes.tsx), así el
// servidor y el primer render del navegador no suspenden. Si una guía no se precargó, el
// render del servidor queda sin dibujar y el build falla (src/entry-server.tsx), en vez de
// publicar una guía vacía.

import type { GuideContent } from './types';

const loaders = import.meta.glob<GuideContent>('./content/*.ts', { import: 'default' });
const cache = new Map<string, GuideContent>();
const pending = new Map<string, Promise<GuideContent | undefined>>();

const fileOf = (slug: string) => `./content/${slug}.ts`;

/** Slugs con cuerpo escrito (los archivos de ./content). */
export const guideContentSlugs = (): string[] => Object.keys(loaders).map(f => f.replace(/^\.\/content\/|\.ts$/g, ''));

/** true si la guía tiene cuerpo. */
export const hasGuideContent = (slug: string) => !!loaders[fileOf(slug)];

/** El archivo fuente del cuerpo (para precargarlo desde el HTML estático). */
export const guideContentFile = (slug: string) => `src/data/guides/content/${slug}.ts`;

/** Cuerpo ya cargado (síncrono). */
export const getGuideContent = (slug: string) => cache.get(slug);

/** Descarga el cuerpo de la guía (si existe) y lo deja en caché. */
export function loadGuideContent(slug: string): Promise<GuideContent | undefined> {
  const cached = cache.get(slug);
  if (cached) return Promise.resolve(cached);
  const load = loaders[fileOf(slug)];
  if (!load) return Promise.resolve(undefined);
  let promise = pending.get(slug);
  if (!promise) {
    promise = load().then(content => {
      cache.set(slug, content);
      pending.delete(slug);
      return content;
    });
    pending.set(slug, promise);
  }
  return promise;
}

/**
 * Cuerpo de la guía para la página: undefined si no existe; si existe y no está en caché,
 * suspende hasta que llega (en una página estática ya viene precargado).
 */
export function readGuideContent(slug: string): GuideContent | undefined {
  if (!hasGuideContent(slug)) return undefined;
  const content = cache.get(slug);
  if (!content) throw loadGuideContent(slug);
  return content;
}
