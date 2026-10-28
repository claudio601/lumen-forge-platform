// api/_lib/rut.test.ts
// El dígito verificador del RUT tiene una sola fuente (api/_lib/rut.ts): src/lib/rut.ts la
// reexporta, y los formularios del sitio y el bot de WhatsApp validan igual.
// Solo RUT inventados.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rutCheckDigit } from './rut';
import * as siteRut from '../../src/lib/rut';

describe('rutCheckDigit', () => {
  it('src/lib/rut.ts lo reexporta desde aquí (una sola fuente)', () => {
    expect(siteRut.rutCheckDigit).toBe(rutCheckDigit);
    const source = readFileSync(fileURLToPath(new URL('../../src/lib/rut.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/export function rutCheckDigit\b/);
    expect(source).toContain("from '../../api/_lib/rut'");
  });

  it.each([
    ['77123456', '9'],
    ['11111111', '1'],
    ['7123456', '8'],
    ['77431900', 'K'],
    ['76000000', '0'],
  ])('%s → %s', (body, dv) => {
    expect(rutCheckDigit(body)).toBe(dv);
  });
});
