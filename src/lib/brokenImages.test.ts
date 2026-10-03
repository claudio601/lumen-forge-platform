import { describe, expect, it } from 'vitest';
import { retryBrokenImages } from './brokenImages';

/** <img> con el estado de carga que da el navegador (jsdom no carga imágenes). */
function img(src: string, complete: boolean, naturalWidth: number) {
  const el = document.createElement('img');
  el.setAttribute('src', src);
  Object.defineProperty(el, 'complete', { value: complete });
  Object.defineProperty(el, 'naturalWidth', { value: naturalWidth });
  const errors: Event[] = [];
  el.addEventListener('error', e => errors.push(e));
  return { el, errors };
}

describe('retryBrokenImages', () => {
  it('reenvía "error" solo a las fotos del CDN de Jumpseller que terminaron sin dibujarse', () => {
    const root = document.createElement('div');
    const broken = img('https://cdnx.jumpseller.com/elights-cl/image/1/resize/400/400', true, 0);
    const ok = img('https://cdnx.jumpseller.com/elights-cl/image/2/resize/400/400', true, 400);
    const loading = img('https://cdnx.jumpseller.com/elights-cl/image/3/resize/400/400', false, 0);
    const other = img('/logo.svg', true, 0);
    for (const x of [broken, ok, loading, other]) root.appendChild(x.el);
    expect(retryBrokenImages(root)).toBe(1);
    expect(broken.errors).toHaveLength(1);
    expect([ok, loading, other].map(x => x.errors.length)).toEqual([0, 0, 0]);
  });
});
