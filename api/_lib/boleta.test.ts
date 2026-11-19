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
import { isSyncBot } from '../../src/test/syncBot';

describe('umbral de 135 UF', () => {
  it('135 UF en pesos con la UF del 31-12 del año anterior (Res. Ex. SII N° 44 de 2025, resolutivo 3°)', () => {
    expect(BOLETA_ID_THRESHOLD_UF).toBe(135);
    expect(UF_VALUE_DATE).toMatch(/^\d{4}-12-31$/);
    expect(BOLETA_ID_THRESHOLD_CLP).toBe(Math.round(135 * UF_VALUE_CLP));
    expect(Number.isInteger(BOLETA_ID_THRESHOLD_CLP)).toBe(true);
    // 2026: UF del 31-12-2025 = $39.727,96 (SII, valores y fechas)
    if (UF_VALUE_DATE === '2025-12-31') expect([UF_VALUE_CLP, BOLETA_ID_THRESHOLD_CLP]).toEqual([39_727.96, 5_363_275]);
  });

  // Cada enero se cambia la UF (la del 31-12 recién pasado). No depende de Jumpseller, pero el
  // robot del catálogo no debe fallar por esto: en su PR se salta y en main avisa.
  it.skipIf(isSyncBot)('la UF es la del 31-12 del año anterior al de hoy en Chile', () => {
    const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric' }).format(new Date()));
    expect(UF_VALUE_DATE, 'actualizar UF_VALUE_CLP y UF_VALUE_DATE en api/_lib/boleta.ts con la UF del 31-12 (sii.cl)').toBe(`${year - 1}-12-31`);
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
