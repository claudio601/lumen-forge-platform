import { describe, expect, it } from 'vitest';
import type { ProductImageFacts } from '@/data/catalog/jumpseller.types';
import { SITE_URL } from '@/config/site';
import { DEFAULT_OG, encodeImageUrl, OG_MAX_BYTES, ogImageIssue, ogImageUrl, productOgImage } from './ogImage';

const URL_PNG = 'https://images.jumpseller.com/store/elights-cl/1/foto.png?1582811881';
const facts = (over: Partial<ProductImageFacts> = {}): ProductImageFacts => ({
  url: URL_PNG,
  format: 'png',
  bytes: 150_000,
  width: 600,
  height: 600,
  ...over,
});

describe('imagen para compartir de una ficha (productOgImage)', () => {
  it('PNG o JPEG de menos de 600 KB: su foto, con medidas y texto alternativo', () => {
    expect(OG_MAX_BYTES).toBe(600_000);
    expect(productOgImage(URL_PNG, facts({ bytes: 599_999 }), 'PANEL LED 40W')).toEqual({ url: URL_PNG, width: 600, height: 600, alt: 'PANEL LED 40W' });
    const jpg = URL_PNG.replace('.png', '.jpg');
    expect(productOgImage(jpg, facts({ url: jpg, format: 'jpeg', bytes: 599_999 }), 'x')).toMatchObject({ url: jpg });
  });

  it('un PNG con nombre .jpg (servido como image/jpeg) también sirve', () => {
    const jpg = URL_PNG.replace('.png', '.jpg');
    expect(productOgImage(jpg, facts({ url: jpg, format: 'png' }), 'x')).toMatchObject({ url: jpg });
  });

  it('sin medidas conocidas: su foto, sin width ni height', () => {
    expect(productOgImage(URL_PNG, facts({ width: undefined, height: undefined }), 'x')).toEqual({ url: URL_PNG, alt: 'x' });
  });

  it('la imagen de la marca (undefined) cuando la foto no sirve', () => {
    const cases: [string, string | undefined, ProductImageFacts | undefined][] = [
      ['600.000 bytes', URL_PNG, facts({ bytes: 600_000 })],
      ['WebP', URL_PNG, facts({ format: 'webp' })],
      ['GIF', URL_PNG, facts({ format: 'gif' })],
      ['otro formato', URL_PNG, facts({ format: 'other' })],
      ['dato de otra foto', URL_PNG, facts({ url: URL_PNG.replace('?1582811881', '?2') })],
      ['sin dato', URL_PNG, undefined],
      ['sin foto', undefined, facts()],
      ['0 bytes', URL_PNG, facts({ bytes: 0 })],
      ['http', URL_PNG.replace('https:', 'http:'), facts({ url: URL_PNG.replace('https:', 'http:') })],
      ['extensión .webp', URL_PNG.replace('.png', '.webp'), facts({ url: URL_PNG.replace('.png', '.webp') })],
      ['299 px de ancho', URL_PNG, facts({ width: 299, height: 299 })],
      ['proporción 4,1', URL_PNG, facts({ width: 1230, height: 300 })],
      ['lado corto de 150 px (proporción justo 4)', URL_PNG, facts({ width: 600, height: 150 })],
      ['vertical, proporción 4,1', URL_PNG, facts({ width: 300, height: 1230 })],
    ];
    for (const [label, url, f] of cases) expect(productOgImage(url, f, 'x'), label).toBeUndefined();
  });

  it('el motivo sirve para el informe de la sincronización', () => {
    expect(ogImageIssue(URL_PNG, facts())).toBeNull();
    expect(ogImageIssue(URL_PNG, facts({ bytes: 601_579 }))).toBe('peso');
    expect(ogImageIssue(URL_PNG, facts({ format: 'webp' }))).toBe('formato');
    expect(ogImageIssue(URL_PNG, undefined)).toBe('sin-revisar');
    expect(ogImageIssue(undefined, undefined)).toBe('sin-foto');
    expect(ogImageIssue(URL_PNG, facts({ width: 1200, height: 150 }))).toBe('medidas');
  });
});

describe('encodeImageUrl', () => {
  it('codifica las tildes en UTF-8 y es idempotente (el %2C ya codificado se mantiene)', () => {
    const raw = 'https://images.jumpseller.com/store/elights-cl/4123096/FOCO-MONOFÁSICO.png?1';
    const encoded = 'https://images.jumpseller.com/store/elights-cl/4123096/FOCO-MONOF%C3%81SICO.png?1';
    expect(encodeImageUrl(raw)).toBe(encoded);
    expect(encodeImageUrl(encoded)).toBe(encoded);
    const comma = 'https://images.jumpseller.com/store/elights-cl/35794580/media/x.png/v1/fit/w_500%2Ch_500%2Cq_90/file.png?1781479280';
    expect(encodeImageUrl(comma)).toBe(comma);
  });

  it('si no es una URL absoluta la devuelve igual', () => {
    expect(encodeImageUrl('/og-default.jpg')).toBe('/og-default.jpg');
    expect(encodeImageUrl('no es url')).toBe('no es url');
  });

  it('la imagen de la marca va absoluta, con 1200×630 y texto alternativo', () => {
    expect(ogImageUrl(DEFAULT_OG)).toBe(`${SITE_URL}/og-default.jpg`);
    expect(DEFAULT_OG).toMatchObject({ width: 1200, height: 630 });
    expect(DEFAULT_OG.alt.trim()).not.toBe('');
  });
});
