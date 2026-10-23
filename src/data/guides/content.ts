// src/data/guides/content.ts
// Cuerpo de cada guía (./content/<slug>.ts), cargado a pedido: cada archivo es un trozo aparte
// del bundle y solo se descarga al abrir esa guía. El patrón de src/data/catalog/content.ts.
//
// La página lee el cuerpo con readGuideContent: si no está en caché, suspende (Suspense) hasta
// que llega. Antes de dibujar una página estática, la ruta lo precarga (src/routes.tsx), así el
// servidor y el primer render del navegador no suspenden. Si una guía no se precargó, el
// render del servidor queda sin dibujar y el build falla (src/entry-server.tsx), en vez de
// publicar una guía vacía.
//
// Si la descarga falla (sin red), la página sigue suspendida y lo vuelve a intentar: la descarga
// fallida se olvida tras una pausa (RETRY_MS) y el siguiente render pide una nueva. Sin olvidarla,
// la guía no cargaría nunca; sin la pausa, sin red, React reintentaría en un bucle.

import type { GuideContent } from './types';

/** Pausa antes de volver a pedir el cuerpo de una guía cuya descarga falló. */
export const RETRY_MS = 3000;

type Loaders = Record<string, () => Promise<GuideContent>>;

/** La carga con caché sobre unos cargadores (los de import.meta.glob; las pruebas pasan otros). */
export function createGuideContentStore(loaders: Loaders, retryMs = RETRY_MS) {
  const cache = new Map<string, GuideContent>();
  const pending = new Map<string, Promise<GuideContent | undefined>>();
  const fileOf = (slug: string) => `./content/${slug}.ts`;
  const has = (slug: string) => !!loaders[fileOf(slug)];

  function load(slug: string): Promise<GuideContent | undefined> {
    const cached = cache.get(slug);
    if (cached) return Promise.resolve(cached);
    const loader = loaders[fileOf(slug)];
    if (!loader) return Promise.resolve(undefined);
    let promise = pending.get(slug);
    if (!promise) {
      promise = loader().then(
        content => {
          cache.set(slug, content);
          pending.delete(slug);
          return content;
        },
        (err: unknown) =>
          // Falló: tras la pausa se olvida, y la próxima lectura vuelve a descargarla
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              pending.delete(slug);
              reject(err);
            }, retryMs),
          ),
      );
      pending.set(slug, promise);
    }
    return promise;
  }

  function read(slug: string): GuideContent | undefined {
    if (!has(slug)) return undefined;
    const content = cache.get(slug);
    if (!content) throw load(slug);
    return content;
  }

  return {
    slugs: (): string[] => Object.keys(loaders).map(f => f.replace(/^\.\/content\/|\.ts$/g, '')),
    has,
    get: (slug: string) => cache.get(slug),
    load,
    read,
  };
}

const store = createGuideContentStore(import.meta.glob<GuideContent>('./content/*.ts', { import: 'default' }));

/** Slugs con cuerpo escrito (los archivos de ./content). */
export const guideContentSlugs = store.slugs;

/** true si la guía tiene cuerpo. */
export const hasGuideContent = store.has;

/** El archivo fuente del cuerpo (para precargarlo desde el HTML estático). */
export const guideContentFile = (slug: string) => `src/data/guides/content/${slug}.ts`;

/** Cuerpo ya cargado (síncrono). */
export const getGuideContent = store.get;

/** Descarga el cuerpo de la guía (si existe) y lo deja en caché. */
export const loadGuideContent = store.load;

/**
 * Cuerpo de la guía para la página: undefined si no existe; si existe y no está en caché,
 * suspende hasta que llega (en una página estática ya viene precargado).
 */
export const readGuideContent = store.read;
