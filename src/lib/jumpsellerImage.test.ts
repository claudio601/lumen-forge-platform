import { describe, it, expect, vi } from 'vitest';
import { fallbackToOriginal, jsImage, jsSrcSet, originalImage } from './jumpsellerImage';

const ref = { id: 60087097, url: 'https://images.jumpseller.com/store/elights-cl/14582065/FLYHAWK.png?1653224159' };

describe('imágenes del CDN de Jumpseller', () => {
  it('arma la URL de tamaño reducido con la versión de la foto', () => {
    expect(jsImage(ref, 400)).toBe('https://cdnx.jumpseller.com/elights-cl/image/60087097/resize/400/400?1653224159');
    expect(jsImage(ref, 200, 'thumb')).toBe('https://cdnx.jumpseller.com/elights-cl/image/60087097/thumb/200/200?1653224159');
  });

  it('srcSet con varios anchos', () => {
    expect(jsSrcSet(ref, [400, 800])).toBe(
      'https://cdnx.jumpseller.com/elights-cl/image/60087097/resize/400/400?1653224159 400w, ' +
        'https://cdnx.jumpseller.com/elights-cl/image/60087097/resize/800/800?1653224159 800w',
    );
  });

  it('sin id de imagen usa la URL original (y corrige URLs unidas por comas)', () => {
    const joined = 'https://images.jumpseller.com/a.png?1,https://images.jumpseller.com/b.png?2';
    expect(originalImage(joined)).toBe('https://images.jumpseller.com/a.png?1');
    expect(jsImage(joined, 400)).toBe('https://images.jumpseller.com/a.png?1');
    expect(jsImage({ url: 'https://x/y.png' }, 400)).toBe('https://x/y.png');
    expect(jsSrcSet('https://x/y.png', [400])).toBeUndefined();
    expect(jsImage(undefined, 400)).toBe('');
  });

  it('si el CDN falla reintenta una vez con la original; si vuelve a fallar avisa', () => {
    const onFinal = vi.fn();
    const img = document.createElement('img');
    img.src = jsImage(ref, 400);
    img.setAttribute('srcset', jsSrcSet(ref, [400, 800])!);
    const handler = fallbackToOriginal(ref, onFinal);
    handler({ currentTarget: img });
    expect(img.src).toBe(ref.url);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(onFinal).not.toHaveBeenCalled();
    handler({ currentTarget: img });
    expect(onFinal).toHaveBeenCalledOnce();
  });
});
