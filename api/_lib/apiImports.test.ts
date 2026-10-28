// api/_lib/apiImports.test.ts
// Las funciones de api/ corren en Vercel como módulos ES ("type": "module"): una importación
// relativa sin la extensión .js, o hacia afuera de api/ (como src/), hace que la función no
// cargue (500 FUNCTION_INVOCATION_FAILED), aunque Vitest la resuelva y las pruebas pasen. Pasó
// en la vista previa de la #121 con el bot de WhatsApp. Las pruebas (*.test.ts) no se despliegan
// y quedan fuera de esta regla.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function deployedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return deployedSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

// `from '…'` (import y export) e `import('…')`, solo rutas relativas.
const RELATIVE_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g;

const imports = deployedSources(API_DIR).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT_RE)].map((m) => ({
    file: relative(API_DIR, file),
    spec: m[1],
    target: resolve(dirname(file), m[1]),
  })),
);

describe('importaciones de las funciones de api/', () => {
  it('hay importaciones que revisar', () => {
    expect(imports.length).toBeGreaterThan(50);
  });

  it('toda importación relativa termina en .js', () => {
    expect(imports.filter((i) => !i.spec.endsWith('.js')).map((i) => `${i.file}: ${i.spec}`)).toEqual([]);
  });

  it('ninguna sale de api/ (src/ se comparte al revés: src importa desde api/_lib)', () => {
    expect(imports.filter((i) => !i.target.startsWith(API_DIR + sep)).map((i) => `${i.file}: ${i.spec}`)).toEqual([]);
  });
});
