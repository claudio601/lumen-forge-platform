// scripts/catalog-parity.test.ts
// Garantía de "cero pérdida" del PR 6: el catálogo armado desde base + contenido
// editorial es idéntico al catálogo legado (src/data/products.ts al 2026-09-30).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { products } from '../src/data/catalog/index';
import { legacyBase } from '../src/data/catalog/legacy-base';
import { editorialOverlay } from '../src/data/catalog/overlay/editorial';
import { LEGACY_SITE_IDS } from '../src/data/catalog/legacy-ids';
import { EDITORIAL_KEYS } from '../src/data/catalog/build';

const legacy = JSON.parse(readFileSync(join(__dirname, 'fixtures/catalog-legacy-2026-09-30.json'), 'utf8')) as Record<string, unknown>[];
const roundtrip = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Cantidad de valores hoja (strings, números, booleanos) dentro de un valor. */
function leaves(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + leaves(x), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce((n: number, x) => n + leaves(x), 0);
  return v === undefined ? 0 : 1;
}

describe('paridad con el catálogo legado', () => {
  it('base + editorial es idéntico, producto por producto, al catálogo del 2026-09-30', () => {
    expect(products).toHaveLength(legacy.length);
    expect(roundtrip(products)).toEqual(legacy);
  });

  it('no se pierde ningún valor editorial', () => {
    const editorialLeaves = (items: Record<string, unknown>[]) =>
      items.reduce((n, p) => n + EDITORIAL_KEYS.reduce((m, k) => m + leaves(p[k]), 0), 0);
    const expected = editorialLeaves(legacy);
    expect(expected).toBeGreaterThan(1000);
    expect(editorialLeaves(roundtrip(products) as unknown as Record<string, unknown>[])).toBe(expected);
  });

  it('conserva conteos clave: 324 productos, ids únicos, 7 con editorial, destacados', () => {
    const jsIds = products.map(p => p.jumpseller_id);
    expect(products).toHaveLength(324);
    expect(new Set(jsIds).size).toBe(324);
    expect(new Set(products.map(p => p.id)).size).toBe(324);
    expect(Object.keys(editorialOverlay)).toHaveLength(7);
    expect(products.filter(p => p.featured).length).toBe(legacy.filter(p => p.featured).length);
  });
});

describe('estructura base / editorial', () => {
  it('la base no contiene campos editoriales', () => {
    for (const p of legacyBase) for (const k of EDITORIAL_KEYS) expect(p).not.toHaveProperty(k);
  });

  it('el editorial solo usa campos editoriales y apunta a productos existentes', () => {
    const baseIds = new Set(legacyBase.map(p => p.jumpseller_id));
    for (const [id, fields] of Object.entries(editorialOverlay)) {
      expect(baseIds.has(Number(id))).toBe(true);
      for (const k of Object.keys(fields)) expect(EDITORIAL_KEYS as readonly string[]).toContain(k);
    }
  });

  it('LEGACY_SITE_IDS congela el id de cada producto (URLs /producto/:id)', () => {
    expect(Object.keys(LEGACY_SITE_IDS)).toHaveLength(324);
    for (const p of products) expect(LEGACY_SITE_IDS[p.jumpseller_id]).toBe(p.id);
  });
});
