// scripts/redirects/write.ts
// Escribe en vercel.json las redirecciones de scripts/redirects/build.ts. Solo cambia
// "redirects": las reescrituras, cabeceras y la región quedan iguales, en el mismo formato.
//
//   npm run redirects:write
//
// Correrlo después de cada cambio en src/data/catalog/renamed-ids.ts y revisar
// `git diff vercel.json` antes del commit.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRedirects } from './build';

/** vercel.json (texto) con las redirecciones generadas en lugar de las que tenía. */
export function withRedirects(json: string): string {
  const cfg = JSON.parse(json) as Record<string, unknown>;
  cfg.redirects = buildRedirects();
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = fileURLToPath(new URL('../../vercel.json', import.meta.url));
  const before = readFileSync(file, 'utf8');
  const after = withRedirects(before);
  if (after === before) console.log('vercel.json ya está al día.');
  else {
    writeFileSync(file, after);
    console.log(`vercel.json: ${buildRedirects().length} redirecciones escritas. Revisar con git diff vercel.json.`);
  }
}
