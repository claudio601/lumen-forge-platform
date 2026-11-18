// api/_lib/shipping/format.test.ts
// Formato es-CL del aviso de despacho (spec Nivel 2, §10: montos, kilos y fechas).

import { describe, expect, it } from 'vitest';
import {
  chileDateTime,
  chileLocalToUtc,
  chileToday,
  formatClp,
  formatDateLong,
  formatDecimal,
  formatKg,
  formatPackages,
  isIsoDate,
} from './format';

describe('montos, kilos y bultos', () => {
  it('montos con punto de miles y sin decimales', () => {
    expect(formatClp(5880)).toBe('$5.880');
    expect(formatClp(14460)).toBe('$14.460');
    expect(formatClp(990)).toBe('$990');
    expect(formatClp(1234567)).toBe('$1.234.567');
  });

  it('kilos con coma decimal y sin ceros de más', () => {
    expect(formatKg(4.5)).toBe('4,5 kg');
    expect(formatKg(3.46)).toBe('3,46 kg');
    expect(formatKg(28)).toBe('28 kg');
    expect(formatKg(3.456)).toBe('3,46 kg');
    expect(formatKg(1250.5)).toBe('1.250,5 kg');
    expect(formatDecimal(3.2)).toBe('3,2');
  });

  it('bulto en singular y en plural', () => {
    expect(formatPackages(1)).toBe('1 bulto');
    expect(formatPackages(2)).toBe('2 bultos');
  });
});

describe('fechas', () => {
  it('«día dd de mes», sin año', () => {
    expect(formatDateLong('2026-11-19')).toBe('jueves 19 de noviembre');
    expect(formatDateLong('2026-11-09')).toBe('lunes 9 de noviembre');
    expect(formatDateLong('2026-11-11')).toBe('miércoles 11 de noviembre');
    expect(formatDateLong('2026-11-14')).toBe('sábado 14 de noviembre');
    expect(formatDateLong('2027-01-01')).toBe('viernes 1 de enero');
  });

  it('una fecha que no existe no se formatea', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-11-19')).toBe(true);
    expect(isIsoDate('19-11-2026')).toBe(false);
    expect(() => formatDateLong('2026-13-01')).toThrow();
  });

  it('el día de hoy es el de Chile, no el de UTC', () => {
    // 18-11 a las 00:30 de Chile (verano, UTC−3) = 03:30 UTC del 18; 02:30 UTC del 18 todavía es el 17 en Chile
    expect(chileToday(new Date('2026-11-18T03:30:00Z'))).toBe('2026-11-18');
    expect(chileToday(new Date('2026-11-18T02:30:00Z'))).toBe('2026-11-17');
    expect(chileDateTime(new Date('2026-11-18T17:05:00Z'))).toEqual({ date: '2026-11-18', time: '14:05' });
    // invierno (UTC−4)
    expect(chileDateTime(new Date('2026-07-01T16:00:00Z'))).toEqual({ date: '2026-07-01', time: '12:00' });
  });

  it('hora de Chile → UTC, en verano y en invierno', () => {
    expect(chileLocalToUtc('2026-11-18', '14:05').toISOString()).toBe('2026-11-18T17:05:00.000Z');
    expect(chileLocalToUtc('2026-07-01', '12:00').toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(() => chileLocalToUtc('2026-11-18', '25:00')).toThrow();
  });
});
