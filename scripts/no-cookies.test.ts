// scripts/no-cookies.test.ts
// «Sin tu consentimiento, este sitio no instala cookies en tu navegador» (Política de
// privacidad, PR 13). Lo respalda el código:
// - Ningún archivo de src/ toca document.cookie, salvo src/lib/analytics.ts, y ahí solo para
//   BORRAR las cookies de Google al revocar (una sola asignación, que expira la cookie).
// - Ninguna API ni librería de cookies (cookieStore, js-cookie y similares).
// - El componente sidebar de shadcn, que guardaba su estado en una cookie y nadie usaba,
//   ya no existe.
// Las decisiones y las listas se guardan en localStorage/sessionStorage (no son cookies).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Código del sitio que llega al navegador (sin pruebas ni su configuración). */
function siteFiles(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : siteFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(name) && !/\.(test|spec)\./.test(name) ? [path] : [];
  });
}

const rel = (path: string) => relative(ROOT, path).split('\\').join('/');

describe('el sitio no instala cookies', () => {
  const files = siteFiles();

  it('revisa el código de src/', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map(rel)).toContain('src/lib/analytics.ts');
    expect(files.map(rel)).toContain('src/lib/cookieConsent.ts');
  });

  it('solo src/lib/analytics.ts menciona document.cookie', () => {
    const hits = files.filter(f => /document\s*\.\s*cookie/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual(['src/lib/analytics.ts']);
  });

  it('analytics.ts solo escribe document.cookie para expirar (una sola asignación)', () => {
    const lines = readFileSync(join(SRC, 'lib', 'analytics.ts'), 'utf8').split('\n');
    const writes = lines.filter(l => /document\s*\.\s*cookie\s*=[^=]/.test(l));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('Max-Age=0');
    expect(writes[0]).toContain('expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('sin cookieStore ni librerías de cookies', () => {
    const api = files.filter(f => /\bcookieStore\b|from ['"](?:js-cookie|react-cookie|universal-cookie|cookie)['"]/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(api).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter(d => /(^|[-/])cookies?($|[-/])/.test(d))).toEqual([]);
  });

  it('src/components/ui/sidebar.tsx ya no existe', () => {
    expect(existsSync(join(SRC, 'components', 'ui', 'sidebar.tsx'))).toBe(false);
  });

  it('index.html no carga nada de Google por su cuenta', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/googletagmanager|google-analytics|gtag\(/);
  });
});
