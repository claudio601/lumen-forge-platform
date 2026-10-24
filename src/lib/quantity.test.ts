// Cantidad de una línea (auditoría UX, D-03): el tope del sitio es el del servidor, y lo que no
// es un entero positivo no cambia la cantidad.

import { describe, expect, it } from 'vitest';
import { MAX_LINE_QUANTITY, clampQuantity, parseQuantity } from './quantity';
import { MAX_QUANTITY } from '../../api/_lib/catalog/pricing';

describe('cantidad de una línea', () => {
  it('el tope es el mismo que acepta el servidor (api/_lib/catalog/pricing.ts)', () => {
    expect(MAX_LINE_QUANTITY).toBe(MAX_QUANTITY);
  });

  it('parseQuantity: enteros de 1 al tope; lo demás, null', () => {
    expect(parseQuantity('40')).toBe(40);
    expect(parseQuantity(' 7 ')).toBe(7);
    expect(parseQuantity('007')).toBe(7);
    expect(parseQuantity('9999')).toBe(9999);
    expect(parseQuantity('12000')).toBe(MAX_LINE_QUANTITY);
    for (const raw of ['', ' ', '0', '00', '-1', '-', '2,5', '2.5', '1e3', 'abc', '+3']) {
      expect(parseQuantity(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('clampQuantity: entero de 1 al tope', () => {
    expect([0, -3, 1, 2.9, 40, 9999, 10000, 25000, NaN, Infinity].map(clampQuantity)).toEqual([1, 1, 1, 2, 40, 9999, 9999, 9999, 1, 9999]);
  });
});
