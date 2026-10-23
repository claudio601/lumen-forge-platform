// Carga del cuerpo de las guías (src/data/guides/content.ts): a pedido, con caché, y la página
// suspende mientras llega (al navegar desde otra página del sitio). En una página estática la
// ruta lo precarga antes de dibujar (lo prueban guides.test.ts y src/ssr-hydration.test.tsx).

import { describe, expect, it, vi } from 'vitest';
import {
  createGuideContentStore,
  getGuideContent,
  guideContentFile,
  guideContentSlugs,
  hasGuideContent,
  loadGuideContent,
  readGuideContent,
} from './content';
import type { GuideContent } from './types';

const SLUG = 'norma-luminica-ds-1-2022';

/** Lo que la página lanza al leer un cuerpo que no está en caché (la descarga), o undefined. */
function thrownBy(read: () => unknown): unknown {
  try {
    read();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('cuerpo de las guías', () => {
  it('sin cargar, la página suspende con la descarga; después lo lee de la caché', async () => {
    expect(guideContentSlugs()).toContain(SLUG);
    expect(hasGuideContent(SLUG)).toBe(true);
    expect(guideContentFile(SLUG)).toBe(`src/data/guides/content/${SLUG}.ts`);
    expect(getGuideContent(SLUG)).toBeUndefined();
    const thrown = thrownBy(() => readGuideContent(SLUG));
    expect(thrown).toBeInstanceOf(Promise);
    // La misma descarga para quien la pida mientras llega
    expect(loadGuideContent(SLUG)).toBe(thrown);
    const content = await (thrown as Promise<unknown>);
    expect(readGuideContent(SLUG)).toBe(content);
    expect(getGuideContent(SLUG)?.slug).toBe(SLUG);
  });

  it('una guía que no existe no suspende: no hay nada que cargar', async () => {
    expect(hasGuideContent('no-existe')).toBe(false);
    expect(readGuideContent('no-existe')).toBeUndefined();
    expect(await loadGuideContent('no-existe')).toBeUndefined();
  });

  it('si la descarga falla (sin red), tras una pausa se olvida y la siguiente lectura la vuelve a pedir', async () => {
    vi.useFakeTimers();
    try {
      const guide = { slug: 'g' } as GuideContent;
      const loader = vi.fn<() => Promise<GuideContent>>().mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce(guide);
      const store = createGuideContentStore({ './content/g.ts': loader }, 3000);
      const first = thrownBy(() => store.read('g')) as Promise<unknown>;
      expect(first).toBeInstanceOf(Promise);
      const failed = first.catch((e: Error) => e.message);
      // Durante la pausa la página sigue suspendida con la misma descarga: sin un bucle de pedidos
      await vi.advanceTimersByTimeAsync(2999);
      expect(store.load('g')).toBe(first);
      expect(loader).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await failed).toBe('sin red');
      // Pasada la pausa, la siguiente lectura descarga de nuevo, y esta vez llega
      const again = thrownBy(() => store.read('g'));
      expect(again).toBeInstanceOf(Promise);
      expect(again).not.toBe(first);
      expect(await again).toBe(guide);
      expect(loader).toHaveBeenCalledTimes(2);
      expect(store.read('g')).toBe(guide);
    } finally {
      vi.useRealTimers();
    }
  });
});
