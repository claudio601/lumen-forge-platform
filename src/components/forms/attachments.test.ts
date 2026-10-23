// src/components/forms/attachments.test.ts
// El lado del navegador de los adjuntos del cotizador (especificación «Adjuntar archivos»,
// 22-10-2026): el contrato con el permiso de subida, los ids al azar y que el SDK de Vercel
// Blob se cargue solo al enviar (import dinámico: no engorda la página).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPT, ATTACHMENT_TEXTS, STATUS_EVENT, UPLOAD_URL, randomId, uploadPathname } from './attachments';
import { ATTACHMENT_EXTENSIONS, UPLOAD_PATHNAME_RE } from '../../../api/_lib/attachments/rules';

const ROOT = resolve(__dirname, '../../..');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adjuntos en el navegador', () => {
  it('la consulta previa y la ruta del permiso son las del servidor (api/project-quotes/upload.ts)', () => {
    const server = readFileSync(join(ROOT, 'api/project-quotes/upload.ts'), 'utf-8');
    expect(server).toContain(`export const STATUS_EVENT = '${STATUS_EVENT}';`);
    expect(UPLOAD_URL).toBe('/api/project-quotes/upload');
    expect(server).toContain('// POST /api/project-quotes/upload');
  });

  it('la ruta que se pide es cotizador/<uuid>.<ext> para cada extensión permitida', () => {
    for (const ext of ATTACHMENT_EXTENSIONS) expect(uploadPathname(ext)).toMatch(UPLOAD_PATHNAME_RE);
    expect(new Set(Array.from({ length: 50 }, () => uploadPathname('pdf'))).size).toBe(50);
  });

  it('randomId da un UUID v4 también sin crypto.randomUUID (fuera de HTTPS)', () => {
    expect(randomId()).toMatch(UUID_V4);
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array) => real.getRandomValues(b) });
    for (let i = 0; i < 20; i++) expect(randomId()).toMatch(UUID_V4);
  });

  it('el selector ofrece las extensiones permitidas (y .jpeg) y la ayuda dice lo mismo que la especificación', () => {
    expect(ACCEPT).toBe('.pdf,.jpg,.png,.dwg,.dxf,.xlsx,.jpeg');
    expect(ATTACHMENT_TEXTS.help).toBe(
      'Bases de licitación, fichas técnicas, planos o planillas. PDF, JPG, PNG, DWG, DXF o XLSX; hasta 5 archivos de 20 MB cada uno.',
    );
  });

  it('ningún archivo de src/ importa @vercel/blob de forma estática: el SDK se carga solo al enviar', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(join(ROOT, 'src'));
    const staticImports = files.filter((f) => /^\s*import\s[^;]*from\s+['"]@vercel\/blob/m.test(readFileSync(f, 'utf-8')));
    expect(staticImports).toEqual([]);
    const source = readFileSync(join(ROOT, 'src/components/forms/attachments.ts'), 'utf-8');
    expect(source).toContain("await import('@vercel/blob/client')");
  });
});
