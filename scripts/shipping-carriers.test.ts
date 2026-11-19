// scripts/shipping-carriers.test.ts
// Los operadores del aviso de despacho (api/_lib/shipping/carriers.ts) son los que el sitio
// publica en REGION_CARRIERS (src/config/business.ts, un texto: «Starken, … u otro operador»).
// Va en scripts/ porque importa los dos lados (api/ no importa src/).

import { describe, expect, it } from 'vitest';
import { REGION_CARRIERS } from '../src/config/business';
import { CARRIERS } from '../api/_lib/shipping/carriers';

describe('operadores del aviso de despacho', () => {
  it('son los de REGION_CARRIERS, en el mismo orden', () => {
    const names = REGION_CARRIERS.split(/, | u /).filter((name) => name !== 'otro operador');
    expect(names.length).toBeGreaterThan(5);
    expect(CARRIERS.map((c) => c.label)).toEqual(names);
  });
});
