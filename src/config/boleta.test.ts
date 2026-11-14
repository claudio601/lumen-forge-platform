// src/config/boleta.test.ts
// Las constantes de la boleta sobre 135 UF (dueño, 2026-11-13) se leen desde business.ts y
// son las mismas que usa el servidor (api/_lib/boleta.ts).

import { describe, expect, it } from 'vitest';
import * as business from './business';
import * as server from '../../api/_lib/boleta';

describe('boleta a personas sobre 135 UF', () => {
  it('business.ts reexporta los valores del servidor', () => {
    expect(business.BOLETA_ID_THRESHOLD_UF).toBe(135);
    expect(business.BOLETA_ID_THRESHOLD_UF).toBe(server.BOLETA_ID_THRESHOLD_UF);
    expect(business.UF_VALUE_CLP).toBe(server.UF_VALUE_CLP);
    expect(business.UF_VALUE_DATE).toBe(server.UF_VALUE_DATE);
    expect(business.BOLETA_ID_THRESHOLD_CLP).toBe(Math.round(135 * business.UF_VALUE_CLP));
  });
});
