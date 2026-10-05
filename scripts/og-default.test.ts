// La imagen de la marca (public/og-default.jpg) tiene que seguir siendo lo que dicen sus
// constantes (DEFAULT_OG): si alguien la reemplaza por otra, las etiquetas og:image:width
// y og:image:height mentirían.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sniffImage } from './jumpseller/og-images';
import { DEFAULT_OG, OG_MAX_BYTES } from '../src/lib/seo/ogImage';

describe('imagen de la marca para compartir', () => {
  it('public/og-default.jpg es un JPEG de 1200×630, de menos de 600 KB, igual a DEFAULT_OG', () => {
    const file = readFileSync(join(__dirname, '../public', DEFAULT_OG.url));
    expect(sniffImage(new Uint8Array(file))).toEqual({ format: 'jpeg', width: DEFAULT_OG.width, height: DEFAULT_OG.height });
    expect(DEFAULT_OG).toMatchObject({ url: '/og-default.jpg', width: 1200, height: 630 });
    expect(file.length).toBeLessThan(OG_MAX_BYTES);
  });
});
