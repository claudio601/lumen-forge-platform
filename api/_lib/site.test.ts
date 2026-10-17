// api/_lib/site.test.ts
// SITE_URL tiene una sola fuente (api/_lib/site.ts): src/config/site.ts la reexporta, y el
// sitio (canonical, sitemap) y el aviso del asistente de WhatsApp cambian juntos de dominio.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE_URL } from './site';
import * as site from '../../src/config/site';

describe('SITE_URL', () => {
  it('src/config/site.ts la reexporta desde aquí (una sola fuente)', () => {
    expect(site.SITE_URL).toBe(SITE_URL);
    const source = readFileSync(fileURLToPath(new URL('../../src/config/site.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/export const SITE_URL\b/);
    expect(source).toContain("from '../../api/_lib/site'");
  });

  it('es https, sin ruta y sin / al final', () => {
    expect(SITE_URL).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    expect(SITE_URL.endsWith('/')).toBe(false);
  });

  it('absoluteUrl del sitio usa la misma dirección', () => {
    expect(site.absoluteUrl('/politica-de-privacidad')).toBe(SITE_URL + '/politica-de-privacidad');
  });
});
