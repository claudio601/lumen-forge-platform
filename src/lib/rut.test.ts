// RUT (auditoría UX, F-02): limpiar, formato 11.111.111-1 y dígito verificador (módulo 11).
// Todos los RUT de esta prueba son inventados (repetidos o en el rango 44 millones, sin
// asignar): nunca usar RUT reales de personas o empresas.

import { describe, expect, it } from 'vitest';
import { cleanRut, formatRut, isValidRut, rutCheckDigit, rutProblem } from './rut';

describe('rutCheckDigit (módulo 11)', () => {
  it.each([
    ['11111111', '1'],
    ['22222222', '2'],
    ['44444444', '4'],
    ['4444444', '5'],
    ['444444', '2'],
    ['44444407', 'K'], // resto 10
    ['44444401', '0'], // resto 11
  ])('%s → %s', (body, dv) => {
    expect(rutCheckDigit(body)).toBe(dv);
  });
});

describe('cleanRut', () => {
  it('quita puntos, guiones, espacios y ceros a la izquierda; la k pasa a K', () => {
    expect(cleanRut('44.444.407-k')).toBe('44444407K');
    expect(cleanRut(' 44 444 444 - 4 ')).toBe('444444444');
    expect(cleanRut('0044.444.444-4')).toBe('444444444');
    expect(cleanRut('44.444.444‐4')).toBe('444444444'); // guion tipográfico (celular)
    expect(cleanRut('44.444.444−4')).toBe('444444444'); // signo menos U+2212 (copiado de un PDF)
  });

  it('con letras que no son K no es un RUT', () => {
    expect(cleanRut('RUT-PRUEBA')).toBe('');
    expect(cleanRut('44.444.444-4a')).toBe('');
  });
});

describe('formatRut (al salir del campo)', () => {
  it.each([
    ['444444444', '44.444.444-4'],
    ['44444444-4', '44.444.444-4'],
    ['44.444.444-4', '44.444.444-4'],
    ['44444407k', '44.444.407-K'],
    ['44.444.407-K', '44.444.407-K'],
    ['44444455', '4.444.445-5'], // 8 caracteres: el último es el dígito verificador
    ['4444442', '444.444-2'],
    [' 4.444.444-5 ', '4.444.444-5'],
  ])('%s → %s', (input, out) => {
    expect(formatRut(input)).toBe(out);
  });

  it('lo que no se puede leer como RUT queda tal como se escribió (sin espacios a los lados)', () => {
    expect(formatRut('  RUT-PRUEBA ')).toBe('RUT-PRUEBA');
    expect(formatRut('4')).toBe('4');
    expect(formatRut('')).toBe('');
    expect(formatRut('44K44444-4')).toBe('44K44444-4');
  });

  it('con puntos pero sin dígito verificador no se reagrupa (no se inventa otro RUT)', () => {
    // Leído como cuerpo + DV, "44.444.445" pasaría como 4.444.444-5, que sí es válido
    expect(formatRut('44.444.445')).toBe('44.444.445');
    expect(formatRut(' 44.444.444 ')).toBe('44.444.444');
    expect(formatRut('4.444.444')).toBe('4.444.444');
  });

  it('con el signo menos U+2212 (copiado de un PDF) toma el formato con guion', () => {
    expect(formatRut('44.444.444−4')).toBe('44.444.444-4');
  });

  it('no cambia si se aplica dos veces', () => {
    for (const r of ['444444444', '44444407k', '4444442']) expect(formatRut(formatRut(r))).toBe(formatRut(r));
  });
});

describe('isValidRut y rutProblem', () => {
  it.each(['44.444.444-4', '444444444', '44.444.407-K', '44.444.407-k', '44444407k', '44.444.401-0', '4.444.444-5', '444.444-2', '11.111.111-1', '22.222.222-2', '44.444.444−4'])(
    'válido: %s',
    (rut) => {
      expect(isValidRut(rut)).toBe(true);
      expect(rutProblem(rut)).toBeNull();
    },
  );

  it.each(['44.444.444-5', '44.444.407-0', '44.444.401-K', '4.444.444-4', '11.111.111-2'])('dígito verificador que no calza: %s', (rut) => {
    expect(isValidRut(rut)).toBe(false);
    expect(rutProblem(rut)).toBe('check_digit');
  });

  it.each(['RUT-PRUEBA', '4', '44', '44.444-4', '444.444.444-4', '44K44444-4', '44.444.444-44a', '00.000.000-0'])('mal escrito: %s', (rut) => {
    expect(isValidRut(rut)).toBe(false);
    expect(rutProblem(rut)).toBe('format');
  });

  it.each(['44.444.445', '22.222.222', '44.444.444', '4.444.444', ' 11.111.111 '])('con puntos pero sin dígito verificador es "format": %s', (rut) => {
    // "44.444.445" leído como 4.444.444-5 calzaría: se avisa que falta el DV en vez de aceptarlo
    expect(rutProblem(rut)).toBe('format');
    expect(isValidRut(rut)).toBe(false);
  });

  it('vacío (o solo espacios) es "empty": el formulario decide si es obligatorio', () => {
    expect(rutProblem('')).toBe('empty');
    expect(rutProblem('   ')).toBe('empty');
    expect(isValidRut('')).toBe(false);
  });
});
