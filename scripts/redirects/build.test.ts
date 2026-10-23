// scripts/redirects/build.test.ts
// Ids renombrados de productos que ya no se publican (UNPUBLISHED_RENAMED): su 301 va a la
// categoría o a /catalogo, no a la ficha (que da 404). Como vercel-config.test.ts, no depende de
// qué productos se publican: solo de las tablas.

import { describe, expect, it } from 'vitest';
import { RENAMED_SITE_IDS } from '../../src/data/catalog/renamed-ids';
import { buildRedirects, renamedIdDestination, renamedIdRedirects, UNPUBLISHED_RENAMED } from './build';

const ruleFor = (rules: { source: string; destination: string }[], old: string) => rules.find(r => r.source === `/producto/${old}{/}?`);

describe('ids renombrados de productos no publicados (UNPUBLISHED_RENAMED)', () => {
  it('las campanas UFO NF8 de 100, 150, 200 y 300W, que ya no se publican, van con 301 a /catalogo/campanas-led', () => {
    const rules = buildRedirects();
    for (const jid of [24031164, 24040212, 24040292, 24043701]) {
      const old = `w-ip65-${jid}`;
      expect(ruleFor(rules, old), old).toEqual({ source: `/producto/${old}{/}?`, destination: '/catalogo/campanas-led', statusCode: 301 });
    }
  });

  it('un producto renombrado que sigue publicado va, como siempre, a su ficha con el id vigente', () => {
    // NF8 Pro 300W (24043822): misma familia, publicado
    expect(ruleFor(renamedIdRedirects(), 'w-ip65-24043822')?.destination).toBe('/producto/campana-led-ufo-nf8-pro-300w-150lm-w-ip65');
    expect(renamedIdDestination(24043822)).toBe('/producto/campana-led-ufo-nf8-pro-300w-150lm-w-ip65');
  });

  it('sin categoría conocida (null), a /catalogo; y todos los ids anteriores del producto van al mismo destino', () => {
    const rules = renamedIdRedirects({ 24043822: null });
    expect(ruleFor(rules, 'w-ip65-24043822')?.destination).toBe('/catalogo');
    // Sin las UFO NF8 en la tabla, vuelven a su ficha
    expect(ruleFor(rules, 'w-ip65-24031164')?.destination).toBe('/producto/campana-led-ufo-nf8-100w-110lm-w-ip65');
    expect(rules).toHaveLength(renamedIdRedirects().length);
  });

  it('cada producto de la tabla es un renombrado, con una categoría de categories.config.ts: si no, redirects:write falla', () => {
    for (const jid of Object.keys(UNPUBLISHED_RENAMED).map(Number)) expect(RENAMED_SITE_IDS[jid], String(jid)).toBeDefined();
    expect(() => renamedIdRedirects({ 999: 'campanas-led' })).toThrow(/999 no está en src\/data\/catalog\/renamed-ids\.ts/);
    expect(() => renamedIdRedirects({ 24043822: 'no-existe' })).toThrow(/categories\.config\.ts/);
    expect(() => renamedIdDestination(999)).toThrow(/renamed-ids\.ts/);
  });
});
