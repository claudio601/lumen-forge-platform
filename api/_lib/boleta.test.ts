// api/_lib/boleta.test.ts
// Boleta a personas sobre 135 UF (decisión del dueño, 13-11-2026).

import { describe, expect, it } from 'vitest';
import {
  BOLETA_ID_THRESHOLD_CLP,
  BOLETA_ID_THRESHOLD_UF,
  UF_VALUE_CLP,
  UF_VALUE_DATE,
  personaNeedsBoletaId,
} from './boleta';

describe('umbral de 135 UF', () => {
  it('135 UF en pesos con la UF de su fecha (≈ $5,58 millones con IVA, la estimación del dueño)', () => {
    expect(BOLETA_ID_THRESHOLD_UF).toBe(135);
    expect(UF_VALUE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(BOLETA_ID_THRESHOLD_CLP).toBe(Math.round(135 * UF_VALUE_CLP));
    expect(Number.isInteger(BOLETA_ID_THRESHOLD_CLP)).toBe(true);
    expect(Math.abs(BOLETA_ID_THRESHOLD_CLP - 5_580_000)).toBeLessThan(100_000);
  });

  it('solo una persona, y solo estrictamente sobre el umbral', () => {
    expect(personaNeedsBoletaId('persona', BOLETA_ID_THRESHOLD_CLP + 1)).toBe(true);
    expect(personaNeedsBoletaId('persona', BOLETA_ID_THRESHOLD_CLP)).toBe(false);
    expect(personaNeedsBoletaId('persona', 1)).toBe(false);
    expect(personaNeedsBoletaId('empresa', BOLETA_ID_THRESHOLD_CLP * 2)).toBe(false);
    expect(personaNeedsBoletaId(undefined, BOLETA_ID_THRESHOLD_CLP * 2)).toBe(false);
    expect(personaNeedsBoletaId('persona', undefined)).toBe(false);
    expect(personaNeedsBoletaId('persona', Number.NaN)).toBe(false);
    expect(personaNeedsBoletaId('persona', String(BOLETA_ID_THRESHOLD_CLP * 2))).toBe(false);
  });
});
