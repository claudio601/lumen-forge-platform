// scripts/catalog.test.ts
// El catálogo del sitio sale del snapshot de Jumpseller (PR 7). Estas pruebas corren
// también en cada PR de sincronización, así que fijan reglas, no datos que Jumpseller
// puede cambiar: ids/URLs estables, datos derivados del snapshot, valores legados solo
// donde Jumpseller no tiene y TODO el contenido editorial intacto.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { products } from '../src/data/catalog/index';
import { jumpsellerSnapshot } from '../src/data/catalog/jumpseller-snapshot.generated';
import { CATEGORY_PRODUCT_COUNTS, PUBLISHED_PRODUCT_COUNT } from '../src/data/catalog/categories.generated';
import { categories } from '../src/data/catalog/categories.config';
import { editorialOverlay } from '../src/data/catalog/overlay/editorial';
import { baseOverrides } from '../src/data/catalog/overlay/overrides';
import { LEGACY_SITE_IDS } from '../src/data/catalog/legacy-ids';
import { SITE_IDS } from '../src/data/catalog/site-ids.generated';
import { EDITORIAL_KEYS, parseIp, parseKelvin, parseWatts, skuOwners } from '../src/data/catalog/build';
import { cleanSku } from './jumpseller/normalize';
import type { Product } from '../src/data/catalog/types';

type Legacy = Product & { stock?: boolean };
const legacy = JSON.parse(readFileSync(join(__dirname, 'fixtures/catalog-legacy-2026-09-30.json'), 'utf8')) as Legacy[];
const legacyById = new Map(legacy.map(p => [p.jumpseller_id, p]));
const snapById = new Map(jumpsellerSnapshot.map(p => [p.jumpseller_id, p]));
const siteSlugs = categories.map(c => c.slug);
const BESTLED = [2301098, 2301101, 2301105, 2301110, 2301114, 4156930, 15021313];

describe('lectura de specs desde el nombre', () => {
  it('potencia, incluidos decimales con coma', () => {
    expect(parseWatts('PROYECTOR LED ANTIVANDÁLICO 200W IP66')).toBe(200);
    expect(parseWatts('CINTA LED EXTERIOR 14,4W SMD 5730 72LEDs/m')).toBe(14.4);
    expect(parseWatts('RIEL MONOFÁSICO 1 MT')).toBe(0);
  });
  it('temperatura de color e IP', () => {
    expect(parseKelvin('PANEL LED 60X60 40W 4000K')).toBe(4000);
    expect(parseKelvin('PANEL LED 60X60 40W')).toBe(0);
    expect(parseIp('ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08')).toBe('IP66');
    expect(parseIp('TUBO LED T8')).toBeUndefined();
  });
});

describe('catálogo desde Jumpseller', () => {
  it('cada producto tiene su id registrado (legado o asignado por la sincronización)', () => {
    for (const p of products) {
      expect(p.id).toBe(LEGACY_SITE_IDS[p.jumpseller_id] ?? SITE_IDS[p.jumpseller_id]);
    }
    const all = [...Object.values(LEGACY_SITE_IDS), ...Object.values(SITE_IDS)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('publica exactamente los productos del snapshot, con ids únicos', () => {
    expect(products).toHaveLength(jumpsellerSnapshot.length);
    expect(PUBLISHED_PRODUCT_COUNT).toBe(products.length);
    expect(new Set(products.map(p => p.id)).size).toBe(products.length);
    expect(new Set(products.map(p => p.jumpseller_id)).size).toBe(products.length);
  });

  it('precio, nombre y fotos vienen de Jumpseller; fotos separadas (sin URLs unidas por comas)', () => {
    for (const p of products) {
      const s = snapById.get(p.jumpseller_id)!;
      expect(p.price).toBe(s.price);
      expect(p.price).toBeGreaterThan(0);
      expect(p.name).toBe(s.name);
      expect(p.images).toEqual(s.images.map(i => i.url));
      expect(p.images.length).toBeGreaterThan(0);
      expect(p.image).toBe(p.images[0]);
      for (const url of p.images) expect(url).not.toContain(',');
      expect(p.imageRefs!.map(i => i.id)).toEqual(s.images.map(i => i.id));
    }
  });

  it('categorías: la principal es la primera, todas existen en el sitio y los conteos cuadran', () => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      expect(p.categories.length).toBeGreaterThan(0);
      expect(p.category).toBe(p.categories[0]);
      for (const c of p.categories) {
        expect(siteSlugs).toContain(c);
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    expect(counts).toEqual(CATEGORY_PRODUCT_COUNTS);
    for (const c of categories) expect(c.productCount).toBe(CATEGORY_PRODUCT_COUNTS[c.slug] ?? 0);
  });

  it('nunca publica productos de prueba ni campos prohibidos', () => {
    expect(products.some(p => /PRODUCTO\s+TEST/i.test(p.name))).toBe(false);
    for (const id of [34540602, 34540610, 34540669]) expect(products.some(p => p.jumpseller_id === id)).toBe(false);
    const json = JSON.stringify(products);
    expect(json).not.toMatch(/"stock"|"cost_per_item"|"stock_unlimited"/);
  });
});

describe('se conserva lo que no viene de Jumpseller', () => {
  const kept = products.filter(p => legacyById.has(p.jumpseller_id));

  it('los productos que siguen publicados mantienen su id (URLs /producto/:id)', () => {
    expect(kept.length).toBeGreaterThan(0);
    for (const p of kept) expect(p.id).toBe(LEGACY_SITE_IDS[p.jumpseller_id]);
  });

  it('temperatura e IP salen del nombre; los lúmenes legados se conservan', () => {
    for (const p of products) {
      expect(p.kelvin).toBe(parseKelvin(p.name));
      expect(p.ip).toBe(parseIp(p.name));
    }
    for (const p of kept) expect(p.lumens).toBe(legacyById.get(p.jumpseller_id)!.lumens);
  });

  it('la potencia sale del nombre (corrige cintas "14,4W" que el sitio mostraba como 4W)', () => {
    const changed: number[] = [];
    for (const p of kept) {
      expect(p.watts).toBe(parseWatts(p.name));
      const l = legacyById.get(p.jumpseller_id)!;
      if (p.name === l.name && p.watts !== l.watts) changed.push(p.jumpseller_id);
    }
    for (const id of changed) expect(products.find(p => p.jumpseller_id === id)!.name).toMatch(/\d+,\d+W/);
  });

  it('SKU y marca: los de Jumpseller cuando existen; si no, los del sitio (sin caracteres invisibles)', () => {
    const owners = skuOwners(jumpsellerSnapshot);
    for (const p of kept) {
      const l = legacyById.get(p.jumpseller_id)!;
      const s = snapById.get(p.jumpseller_id)!;
      const single = s.variants.length === 1 && owners.get(s.variants[0].sku)?.size === 1 ? s.variants[0].sku : '';
      expect(p.sku).toBe(s.sku || cleanSku(l.sku) || single);
      expect(p.sku).not.toMatch(/[\u200B\uFEFF]/);
      // Marca: la de Jumpseller cuando existe; si Jumpseller no la trae, la de las
      // correcciones del sitio (overrides). Si alguien la quita en Jumpseller, el sitio
      // deja de mostrarla (no vuelve a la copia de marzo).
      expect(p.brand).toBe(s.brand ?? baseOverrides[p.jumpseller_id]?.brand ?? '');
    }
  });

  it('nunca toma prestado el SKU de variante que usa otro producto (SKUs repetidos en Jumpseller)', () => {
    const owners = skuOwners(jumpsellerSnapshot);
    for (const p of products) {
      const s = snapById.get(p.jumpseller_id)!;
      const legacySku = legacyById.has(p.jumpseller_id) ? cleanSku(legacyById.get(p.jumpseller_id)!.sku) : '';
      if (!p.sku || p.sku === s.sku || p.sku === legacySku) continue;
      expect(owners.get(p.sku), `${p.jumpseller_id} ${p.sku}`).toEqual(new Set([p.jumpseller_id]));
    }
    // Caso real: DLRO40N es del panel Retraído 40W; los de 24W y 6W no lo heredan.
    expect(products.find(p => p.jumpseller_id === 25714697)!.sku).toBe('');
    expect(products.find(p => p.jumpseller_id === 25714841)!.sku).toBe('');
  });

  it('todo el contenido editorial de los 7 BESTLED sigue intacto', () => {
    for (const id of BESTLED) {
      const p = products.find(x => x.jumpseller_id === id)!;
      const l = legacyById.get(id)!;
      expect(p, String(id)).toBeDefined();
      for (const k of EDITORIAL_KEYS) {
        if (k === 'cctVariants') continue;
        expect(p[k], `${id}.${k}`).toEqual(l[k]);
      }
    }
    for (const id of Object.keys(editorialOverlay)) expect(snapById.has(Number(id))).toBe(true);
  });

  it('las variantes CCT de BESTLED toman precio y SKU de Jumpseller', () => {
    for (const id of BESTLED) {
      const p = products.find(x => x.jumpseller_id === id)!;
      const live = new Map(snapById.get(id)!.variants.map(v => [v.id, v]));
      expect(p.cctVariants).toHaveLength(4);
      for (const v of p.cctVariants!) {
        const s = live.get(v.jumpseller_variant_id!)!;
        expect(s, `${id} variante ${v.jumpseller_variant_id}`).toBeDefined();
        expect(v.price).toBe(s.price);
        expect(v.sku).toBe(s.sku || v.sku);
      }
    }
  });
});
