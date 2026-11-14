// api/_lib/forms/review.test.ts
// Avisos «Para revisar» (decisiones del dueño, 13-11-2026): el bloque, el RUT por revisar y su
// lugar en el correo (después de la primera línea).

import { describe, expect, it } from 'vitest';
import { REVIEW_HEADING, afterFirstLine, reviewSection, rutReviewItem } from './review';
import { rutCheckDigit } from '../rut';

/** RUT de prueba con su dígito verificador, y el mismo con otro dígito. */
const BODY = '44444444';
const VALID = `44.444.444-${rutCheckDigit(BODY)}`;
const WRONG = `44.444.444-${rutCheckDigit(BODY) === '1' ? '2' : '1'}`;

describe('reviewSection', () => {
  it('sin avisos no agrega nada; con avisos, el encabezado, una línea por aviso y una en blanco', () => {
    expect(reviewSection([])).toEqual([]);
    expect(reviewSection([null, undefined, ''])).toEqual([]);
    expect(reviewSection(['uno', null, 'dos'])).toEqual([REVIEW_HEADING, '- uno', '- dos', '']);
    expect(REVIEW_HEADING).toBe('Para revisar:');
  });
});

describe('rutReviewItem', () => {
  it('un RUT que calza (con o sin puntos, K minúscula) no avisa; vacío o ausente tampoco', () => {
    expect(rutReviewItem(VALID)).toBeNull();
    expect(rutReviewItem(VALID.replace(/\./g, ''))).toBeNull();
    expect(rutReviewItem(undefined)).toBeNull();
    expect(rutReviewItem('   ')).toBeNull();
    expect(rutReviewItem(12)).toBeNull();
  });

  it('el dígito verificador que no calza y lo que no es un RUT avisan con su motivo, sin repetir el RUT', () => {
    expect(rutReviewItem(WRONG)).toBe('RUT por revisar: dígito verificador no calza');
    expect(rutReviewItem('RUT-PRUEBA')).toBe('RUT por revisar: no tiene formato de RUT (12.345.678-9)');
    expect(rutReviewItem('44.444.444')).toBe('RUT por revisar: no tiene formato de RUT (12.345.678-9)');
    expect(rutReviewItem(WRONG)).not.toContain('44');
  });
});

describe('afterFirstLine', () => {
  it('pone el bloque después de la primera línea, con una línea en blanco antes', () => {
    expect(afterFirstLine(['Ref', 'resto'], ['Para revisar:', '- x', ''])).toEqual(['Ref', '', 'Para revisar:', '- x', '', 'resto']);
    expect(afterFirstLine(['Ref', 'resto'], [])).toEqual(['Ref', 'resto']);
  });
});
