// api/_lib/shipping/format.test.ts
// Formato es-CL del aviso de despacho (spec Nivel 2, §10: montos, kilos y fechas).

import { describe, expect, it } from 'vitest';
import {
  chileDateTime,
  chileOffset,
  chileToday,
  formatChileTimestamp,
  formatClp,
  formatDateLong,
  formatDecimal,
  formatKg,
  formatPackages,
  isIsoDate,
  parseChileTimestamp,
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

  it('marca con desfase: se escribe y se relee igual, en verano y en invierno', () => {
    expect(formatChileTimestamp(new Date('2026-11-18T17:05:30Z'))).toBe('2026-11-18 14:05 -03:00');
    expect(formatChileTimestamp(new Date('2026-07-01T16:00:00Z'))).toBe('2026-07-01 12:00 -04:00');
    expect(chileOffset(new Date('2026-11-18T17:05:00Z'))).toBe('-03:00');
    expect(chileOffset(new Date('2026-07-01T16:00:00Z'))).toBe('-04:00');
    expect(parseChileTimestamp('2026-11-18 14:05 -03:00')).toEqual({ ok: true, at: new Date('2026-11-18T17:05:00Z') });
    expect(parseChileTimestamp('2026-07-01 12:00 -04:00')).toEqual({ ok: true, at: new Date('2026-07-01T16:00:00Z') });
  });

  it('fin del horario de verano (5-4-2026): la hora que se repite se distingue por el desfase', () => {
    // 03:00 UTC del 5-4: las 00:00 (-03) vuelven a ser las 23:00 (-04) del 4-4.
    const first = new Date('2026-04-05T02:30:30Z');
    const second = new Date('2026-04-05T03:30:30Z');
    expect(formatChileTimestamp(first)).toBe('2026-04-04 23:30 -03:00');
    expect(formatChileTimestamp(second)).toBe('2026-04-04 23:30 -04:00');
    expect(parseChileTimestamp('2026-04-04 23:30 -03:00')).toEqual({ ok: true, at: new Date('2026-04-05T02:30:00Z') });
    expect(parseChileTimestamp('2026-04-04 23:30 -04:00')).toEqual({ ok: true, at: new Date('2026-04-05T03:30:00Z') });
    // Sin desfase la hora es ambigua: no se elige ninguna de las dos.
    expect(parseChileTimestamp('2026-04-04 23:30')).toEqual({ ok: false, reason: 'no_offset' });
    // Cada minuto de la madrugada se escribe y se relee igual.
    for (let ms = Date.parse('2026-04-05T01:00:00Z'); ms <= Date.parse('2026-04-05T05:00:00Z'); ms += 60_000) {
      const r = parseChileTimestamp(formatChileTimestamp(new Date(ms)));
      expect(r.ok && r.at.getTime()).toBe(ms);
    }
  });

  it('inicio del horario de verano (6-9-2026): la hora que se salta no existe con ningún desfase', () => {
    // 04:00 UTC del 6-9: las 00:00 (-04) pasan a ser las 01:00 (-03).
    expect(formatChileTimestamp(new Date('2026-09-06T03:59:00Z'))).toBe('2026-09-05 23:59 -04:00');
    expect(formatChileTimestamp(new Date('2026-09-06T04:00:00Z'))).toBe('2026-09-06 01:00 -03:00');
    expect(parseChileTimestamp('2026-09-06 00:30 -04:00')).toEqual({ ok: false, reason: 'time' });
    expect(parseChileTimestamp('2026-09-06 00:30 -03:00')).toEqual({ ok: false, reason: 'time' });
    expect(parseChileTimestamp('2026-09-06 00:30')).toEqual({ ok: false, reason: 'no_offset' });
    expect(parseChileTimestamp('2026-09-06 01:00 -03:00')).toEqual({ ok: true, at: new Date('2026-09-06T04:00:00Z') });
    for (let ms = Date.parse('2026-09-06T02:00:00Z'); ms <= Date.parse('2026-09-06T06:00:00Z'); ms += 60_000) {
      const r = parseChileTimestamp(formatChileTimestamp(new Date(ms)));
      expect(r.ok && r.at.getTime()).toBe(ms);
    }
  });

  it('un desfase que no es el de Chile en esa fecha, o una marca mal escrita, no se acepta', () => {
    expect(parseChileTimestamp('2026-11-18 14:05 -04:00')).toEqual({ ok: false, reason: 'time' });
    expect(parseChileTimestamp('2026-07-01 12:00 -03:00')).toEqual({ ok: false, reason: 'time' });
    expect(parseChileTimestamp('2026-11-18 14:05 +00:00')).toEqual({ ok: false, reason: 'time' });
    for (const bad of ['2026-11-18 25:00 -03:00', '2026-02-30 10:00 -03:00', '2026-11-18 14:05 -03:75', '2026-11-18T14:05-03:00', '18-11-2026 14:05 -03:00', '']) {
      expect(parseChileTimestamp(bad), bad).toEqual({ ok: false, reason: 'format' });
    }
  });
});
