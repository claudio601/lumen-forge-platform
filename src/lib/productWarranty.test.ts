import { describe, expect, it } from 'vitest';
import { productWarranty, warrantyNote } from './productWarranty';

const g = (value: string, label = 'Garantía') => ({ construccion: [{ label: 'Grado de protección', value: 'IP65' }, { label, value }] });

describe('garantía del producto junto al precio', () => {
  it('toma la cifra de la fila de garantía, en cualquier grupo', () => {
    expect(productWarranty(g('5 años'))).toBe('5 años');
    expect(productWarranty(g('5 años de fábrica'))).toBe('5 años');
    expect(productWarranty(g('5 años.'))).toBe('5 años');
    expect(productWarranty(g('2 años contra defectos de fabricación'))).toBe('2 años');
    expect(productWarranty(g('1 año.'))).toBe('1 año');
    expect(productWarranty(g('18 meses'))).toBe('18 meses');
    expect(productWarranty({ electricos: [{ label: 'Garantia', value: '3 AÑOS' }] })).toBe('3 años');
    expect(productWarranty({ componentes: [{ label: 'Garantía', value: '2 años' }] })).toBe('2 años');
  });

  it('sin cifra, sin fila o sin superar la legal: nada', () => {
    expect(productWarranty(g('Si'))).toBeNull();
    expect(productWarranty(g('6 meses'))).toBeNull();
    expect(productWarranty(g('3 meses'))).toBeNull();
    expect(productWarranty(g('0 años'))).toBeNull();
    expect(productWarranty(g('5 añosx'))).toBeNull();
    expect(productWarranty(g('5 años', 'Vida útil'))).toBeNull();
    expect(productWarranty(g('5 años', 'Garantía del driver'))).toBeNull(); // la de un componente no es la del producto
    expect(productWarranty({})).toBeNull();
    expect(productWarranty(null)).toBeNull();
  });

  it('el texto: la del producto primero, o la legal', () => {
    expect(warrantyNote(g('5 años'))).toBe('Garantía de 5 años (mín. legal 6 meses)');
    expect(warrantyNote(g('1 año'))).toBe('Garantía de 1 año (mín. legal 6 meses)');
    expect(warrantyNote(g('Si'))).toBe('Garantía legal de 6 meses');
    expect(warrantyNote(null)).toBe('Garantía legal de 6 meses');
  });
});
