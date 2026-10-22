// scripts/search-console.test.ts
// Search Console verifica la propiedad elights.cl con la metaetiqueta google-site-verification
// de la tienda Jumpseller: en el DNS no hay registro TXT de Google (revisado el 22-10-2026).
// Si el sitio nuevo no la trae el día del cambio de dominio, la propiedad pierde la
// verificación. Todas las páginas prerenderizadas parten de index.html, así que basta con ahí.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = '2_ZhjTlwBTduj_Mcdz3hb_z4slpTKWmaYL_IoTVnHSk';

describe('verificación de Search Console', () => {
  it('index.html trae una sola metaetiqueta google-site-verification, la de elights.cl', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const tags = html.match(/<meta\s+name="google-site-verification"\s+content="[^"]*"\s*\/?>/g) ?? [];
    expect(tags).toEqual([`<meta name="google-site-verification" content="${TOKEN}" />`]);
  });
});
