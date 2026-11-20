// scripts/redirects/build.test.ts
// Ids renombrados de productos que ya no se publican (UNPUBLISHED_RENAMED): su 301 va a la
// categoría o a /catalogo, no a la ficha (que da 404). Como vercel-config.test.ts, no depende de
// qué productos se publican: solo de las tablas.

import { describe, expect, it } from 'vitest';
import { MERGED_SITE_IDS, RENAMED_DESTINATION_FROM, RENAMED_FROM, RENAMED_SITE_IDS } from '../../src/data/catalog/renamed-ids';
import { buildRedirects, LEGACY_URLS, legacyDestination, mergedIdDestination, renamedIdDestination, renamedIdRedirects, UNPUBLISHED_RENAMED } from './build';

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

  it('dentro de la app (ProductRoute) cada id viejo va al mismo destino que su 301', () => {
    const rules = renamedIdRedirects();
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      const old = r.source.replace(/^\/producto\//, '').replace(/\{\/\}\?$/, '');
      expect(RENAMED_DESTINATION_FROM.get(old), old).toBe(r.destination);
    }
    expect(RENAMED_DESTINATION_FROM.size).toBe(rules.length);
  });

  it('cada producto de la tabla es un renombrado, con una categoría de categories.config.ts: si no, redirects:write falla', () => {
    for (const jid of Object.keys(UNPUBLISHED_RENAMED).map(Number)) expect(RENAMED_SITE_IDS[jid], String(jid)).toBeDefined();
    expect(() => renamedIdRedirects({ 999: 'campanas-led' })).toThrow(/999 no está en src\/data\/catalog\/renamed-ids\.ts/);
    expect(() => renamedIdRedirects({ 24043822: 'no-existe' })).toThrow(/categories\.config\.ts/);
    expect(() => renamedIdDestination(999)).toThrow(/renamed-ids\.ts/);
  });
});

// Productos fusionados (MERGED_SITE_IDS): el id del retirado va con 301 a la ficha del que lo
// reemplaza, en el mismo bloque que los renombres, y sus URLs de elights.cl van a esa misma ficha.
describe('ids de productos fusionados (MERGED_SITE_IDS)', () => {
  const PANEL_120X15 = '/producto/panel-led-120x15-cm-36w-para-cielo-americano';
  const OLD = 'panel-led-120x15-cm-36w-luz-calida-para-cielo-americano';

  it('el panel 120x15 36W luz cálida (21766686) va con 301 al 120x15 36W (2347849), en Vercel y dentro de la app', () => {
    expect(ruleFor(buildRedirects(), OLD)).toEqual({ source: `/producto/${OLD}{/}?`, destination: PANEL_120X15, statusCode: 301 });
    expect(ruleFor(renamedIdRedirects(), OLD)?.destination).toBe(PANEL_120X15);
    expect(mergedIdDestination(21766686)).toBe(PANEL_120X15);
    expect(RENAMED_DESTINATION_FROM.get(OLD)).toBe(PANEL_120X15);
    expect(RENAMED_FROM.get(OLD)).toBe('panel-led-120x15-cm-36w-para-cielo-americano');
  });

  it('sus URLs de elights.cl llevan a la misma ficha, sin pasar por el id retirado', () => {
    const rows = LEGACY_URLS.filter(u => ['/panel-led-120x15-cm-36w-luz-calida-para-cielo-americano', '/panel-led-120x15-cm-40w-para-cielo-americano-copiar'].includes(u.source));
    expect(rows).toHaveLength(2);
    for (const u of rows) expect(legacyDestination(u), u.source).toBe(PANEL_120X15);
    expect(LEGACY_URLS.filter(u => u.product !== undefined && MERGED_SITE_IDS[u.product]).map(u => u.source)).toEqual([]);
  });

  it('un producto que no está en la tabla hace fallar redirects:write', () => {
    expect(() => mergedIdDestination(999)).toThrow(/MERGED_SITE_IDS/);
  });
});
