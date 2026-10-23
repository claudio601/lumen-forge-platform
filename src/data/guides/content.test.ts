// Carga del cuerpo de las guías (src/data/guides/content.ts): a pedido, con caché, y la página
// suspende mientras llega (al navegar desde otra página del sitio). En una página estática la
// ruta lo precarga antes de dibujar (lo prueban guides.test.ts y src/ssr-hydration.test.tsx).

import { describe, expect, it } from 'vitest';
import { getGuideContent, guideContentFile, guideContentSlugs, hasGuideContent, loadGuideContent, readGuideContent } from './content';

const SLUG = 'norma-luminica-ds-1-2022';

describe('cuerpo de las guías', () => {
  it('sin cargar, la página suspende con la descarga; después lo lee de la caché', async () => {
    expect(guideContentSlugs()).toContain(SLUG);
    expect(hasGuideContent(SLUG)).toBe(true);
    expect(guideContentFile(SLUG)).toBe(`src/data/guides/content/${SLUG}.ts`);
    expect(getGuideContent(SLUG)).toBeUndefined();
    let thrown: unknown;
    try {
      readGuideContent(SLUG);
    } catch (e) {
      thrown = e;
    }
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
});
