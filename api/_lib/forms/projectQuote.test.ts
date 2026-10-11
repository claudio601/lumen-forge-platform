// api/_lib/forms/projectQuote.test.ts
// Reglas compartidas del cotizador: cómo se leen los m² escritos por una persona (el punto
// separa miles; lo ambiguo no se adivina) y las opciones de las listas.

import { describe, it, expect } from 'vitest';
import { ILLUMINATION_LEVELS, MAX_M2, PROJECT_TYPES, parseM2 } from './projectQuote';

describe('parseM2', () => {
  it.each([
    ['1200', 1200],
    ['12000', 12000],
    ['12.000', 12000],
    ['1.200', 1200],
    ['5.000', 5000],
    ['100.000', 100000],
    ['10.000.000', MAX_M2],
    [' 850 ', 850],
    ['0', 0],
  ])("'%s' son %i", (text, expected) => {
    expect(parseM2(text)).toBe(expected);
  });

  it.each(['', '   ', '12,5', '1,200', '12.5', '1.2000', '12.00', '.500', '1.', '12 000', '-5', '+5', '1e3', 'abc', '12.000,5'])(
    "'%s' no se adivina: NaN",
    (text) => {
      expect(parseM2(text)).toBeNaN();
    }
  );
});

describe('opciones de las listas', () => {
  it('son las del formulario', () => {
    expect(PROJECT_TYPES).toEqual(['Oficina', 'Retail', 'Bodega', 'Industria', 'Exterior', 'Vial', 'Hogar', 'Otro']);
    expect(ILLUMINATION_LEVELS).toEqual(['Basico', 'Estandar', 'Alto rendimiento', 'Especializado']);
  });
});
