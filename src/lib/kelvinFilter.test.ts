// src/lib/kelvinFilter.test.ts
// Filtro de temperatura de color (auditoría UX, B-05): opciones desde los datos, con su conteo,
// y «alguna variante tiene esa temperatura». Contra el catálogo real, con reglas (no conteos).

import { describe, it, expect } from 'vitest';
import { products } from '@/data/products';
import { kelvinOptions, matchesKelvin, parseKelvinParam } from './kelvinFilter';

const k = (...kelvins: number[]) => ({ kelvins });

describe('opciones del filtro', () => {
  it('cuentan los productos con esa temperatura en alguna variante, de menor a mayor, sin las que dan 0', () => {
    expect(kelvinOptions([k(4000, 2700), k(2700), k()])).toEqual([
      { kelvin: 2700, count: 2 },
      { kelvin: 4000, count: 1 },
    ]);
  });

  it('una temperatura elegida aparece aunque dé 0 (para poder quitarla)', () => {
    expect(kelvinOptions([k(4000)], [2200])).toEqual([
      { kelvin: 2200, count: 0 },
      { kelvin: 4000, count: 1 },
    ]);
  });

  it('en el catálogo: son exactamente las temperaturas de los datos, con 2200K y 2700K si alguna variante las tiene', () => {
    const options = kelvinOptions(products);
    const inData = [...new Set(products.flatMap(p => p.kelvins))].sort((a, b) => a - b);
    expect(options.map(o => o.kelvin)).toEqual(inData);
    for (const o of options) {
      expect(o.count).toBeGreaterThan(0);
      expect(o.count).toBe(products.filter(p => p.kelvins.includes(o.kelvin)).length);
    }
    for (const kelvin of [2200, 2700]) {
      if (products.some(p => p.kelvins.includes(kelvin))) expect(options.some(o => o.kelvin === kelvin), `${kelvin}K`).toBe(true);
    }
  });

  it('en alumbrado público hay opciones (antes, todas daban 0)', () => {
    const lighting = products.filter(p => p.categories.includes('alumbrado-publico'));
    const options = kelvinOptions(lighting);
    if (lighting.some(p => p.kelvins.length)) expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(lighting.filter(p => matchesKelvin(p, [o.kelvin]))).toHaveLength(o.count);
  });
});

describe('filtrar', () => {
  it('vale si alguna variante tiene alguna de las temperaturas elegidas; sin elegidas, todos', () => {
    expect(matchesKelvin(k(2200, 4000), [4000])).toBe(true);
    expect(matchesKelvin(k(2200, 4000), [2700, 2200])).toBe(true);
    expect(matchesKelvin(k(5000), [2700])).toBe(false);
    expect(matchesKelvin(k(), [2700])).toBe(false);
    expect(matchesKelvin(k(), [])).toBe(true);
  });
});

describe('?k en la URL', () => {
  it('acepta ?k=2700, ?k=2200,2700, ?k=2200&k=2700 y la K', () => {
    expect(parseKelvinParam(['2700'])).toEqual([2700]);
    expect(parseKelvinParam(['2700,2200'])).toEqual([2200, 2700]);
    expect(parseKelvinParam(['2200', '2700', '2700'])).toEqual([2200, 2700]);
    expect(parseKelvinParam(['2700K', ' 4000k '])).toEqual([2700, 4000]);
  });

  it('ignora lo que no es una temperatura', () => {
    expect(parseKelvinParam([])).toEqual([]);
    expect(parseKelvinParam(['', 'abc', '0', '27', '99999', '2700.5', '-2700'])).toEqual([]);
  });
});
