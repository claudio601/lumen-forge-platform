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
import { RENAMED_FROM, RENAMED_SITE_IDS, RETIRED_SITE_IDS } from '../src/data/catalog/renamed-ids';
import { EDITORIAL_KEYS, parseIp, parseKelvin, parseWatts, skuOwners } from '../src/data/catalog/build';
import { cleanSku } from './jumpseller/normalize';
import type { Product } from '../src/data/catalog/types';

type Legacy = Product & { stock?: boolean };
const legacy = JSON.parse(readFileSync(join(__dirname, 'fixtures/catalog-legacy-2026-09-30.json'), 'utf8')) as Legacy[];
const legacyById = new Map(legacy.map(p => [p.jumpseller_id, p]));
const snapById = new Map(jumpsellerSnapshot.map(p => [p.jumpseller_id, p]));
const siteSlugs = categories.map(c => c.slug);
const BESTLED = [2301098, 2301101, 2301105, 2301110, 2301114, 4156930, 15021313];
const SITE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Id del sitio de un producto: el renombrado gana sobre el legado y el de la sincronización. */
const registeredId = (jid: number) => RENAMED_SITE_IDS[jid]?.id ?? LEGACY_SITE_IDS[jid] ?? SITE_IDS[jid];

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
  it('cada producto tiene su id registrado (renombrado, legado o asignado por la sincronización)', () => {
    for (const p of products) {
      expect(p.id).toBe(registeredId(p.jumpseller_id));
    }
    // Todos los ids usados alguna vez: ninguno se repite (previous[0] es el legado o el de la sincronización)
    const all = [
      ...Object.values(LEGACY_SITE_IDS),
      ...Object.values(SITE_IDS),
      ...Object.values(RENAMED_SITE_IDS).flatMap(r => [r.id, ...r.previous.slice(1)]),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('cada id es un slug limpio: [a-z0-9] separados por "-" (sin %, puntos, comas ni tildes)', () => {
    const ids = [
      ...Object.values(LEGACY_SITE_IDS),
      ...Object.values(SITE_IDS),
      ...Object.values(RENAMED_SITE_IDS).flatMap(r => [r.id, ...r.previous]),
      ...products.map(p => p.id),
    ];
    expect(ids.filter(id => !SITE_ID.test(id))).toEqual([]);
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

  it('los productos que siguen publicados mantienen su id (URLs /producto/:id), salvo los renombrados', () => {
    expect(kept.length).toBeGreaterThan(0);
    for (const p of kept) expect(p.id).toBe(RENAMED_SITE_IDS[p.jumpseller_id]?.id ?? LEGACY_SITE_IDS[p.jumpseller_id]);
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

// PR 07: ids que el catálogo legado cortó en la última '/' del permalink. Esta lista no se
// edita: borrar o cambiar una fila de renamed-ids.ts dejaría en 404 las URLs nuevas.
const PR07_RENAMES: [number, string, string][] = [
  [2300837, 'sensor-6500k', 'tubo-led-opal-vidrio-18w-120cm-220v-c-sensor-6500k'],
  [2312822, 'm-5mt-12v-luz-calida-2312822', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-luz-calida'],
  [2313541, 'm-5mt-12v-luz-fria', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-luz-fria'],
  [2313620, 'm-5mt-12v-rojo-2313620', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-rojo'],
  [2313626, 'm-5mt-12v-azul', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-azul'],
  [2313647, 'm-5mt-12v-verde-2313647', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-verde'],
  [2313648, 'm-5mt-12v-amarillo', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-amarillo'],
  [2313769, 'm-5mt-12v-luz-calida', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-luz-calida'],
  [2313836, 'm-5mt-12v-rojo', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-rojo'],
  [2313842, 'm-5mt-12v-azul-2313842', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-azul'],
  [2313858, 'm-5mt-12v-verde', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-verde'],
  [2313868, 'm-5mt-12v-amarillo-2313868', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-amarillo'],
  [2345320, 'rejilla-e27-ip54-blanca', 'tortuga-aluminio-oval-c-rejilla-e27-ip54-blanca'],
  [3952758, 'mt-ip67-100mt-220v', 'cinta-led-exterior-14-4w-5730-72-leds-mt-ip67-100mt-220v'],
  [3954845, 'm-ip67-100-mt-220v', 'cinta-led-exterior-verde-14-4w-m-72-leds-m-ip67-100-mt-220v'],
  [4122715, 'w-ip66', 'campana-led-ufo-nf3-150w-150-lm-w-ip66'],
  [20610994, 'w-ip65', 'campana-led-ufo-nf6-300w-110lm-w-ip65'],
  [21809432, 'm-100mt-220v-rgb', 'cinta-led-exterior-6-5w-smd-2835-48leds-m-100mt-220v-rgb'],
  [22672906, 'm-100mt-220v-amarillo', 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-amarillo'],
  [22679546, 'm-100mt-220v-azul', 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-azul'],
  [22679578, 'm-100mt-220v-rojo', 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-rojo'],
  [24031164, 'w-ip65-24031164', 'campana-led-ufo-nf8-100w-110lm-w-ip65'],
  [24040212, 'w-ip65-24040212', 'campana-led-ufo-nf8-150w-110lm-w-ip65'],
  [24040292, 'w-ip65-24040292', 'campana-led-ufo-nf8-200w-110lm-w-ip65'],
  [24043701, 'w-ip65-24043701', 'campana-led-ufo-nf8-300w-110lm-w-ip65'],
  [24043822, 'w-ip65-24043822', 'campana-led-ufo-nf8-pro-300w-150lm-w-ip65'],
  [24192756, 'sensor-de-movimiento', 'proyector-led-ultra-slim-50w-ip66-negro-c-sensor-de-movimiento'],
  [24192873, 'sensor-de-movimiento-24192873', 'proyector-led-ultra-slim-100w-ip66-negro-c-sensor-de-movimiento'],
  [24256942, 'sensor-de-movimiento-24256942', 'proyector-led-ultra-slim-150w-ip66-negro-c-sensor-de-movimiento'],
  [24257068, 'sensor-de-movimiento-24257068', 'proyector-led-ultra-slim-200w-ip66-negro-c-sensor-de-movimiento'],
  [25818717, 'control-remoto-1', 'alumbrado-publico-led-solar-200w-all-in-one-c-control-remoto'],
  [25885210, 'control-remoto-1-25885210', 'alumbrado-publico-led-solar-100w-all-in-one-c-control-remoto'],
  [25888711, 'control-remoto', 'alumbrado-publico-led-solar-150w-all-in-one-c-control-remoto'],
  [25888760, 'control-remoto-1-25888760', 'alumbrado-publico-led-solar-60w-all-in-one-c-control-remoto'],
  [25891192, 'control-remoto-25891192', 'proyector-led-solar-100w-ip65-c-panel-solar-c-control-remoto'],
  [25891958, 'control-remoto-25891958', 'proyector-led-solar-150w-ip65-c-panel-solar-c-control-remoto'],
  [25892132, 'control-remoto-25892132', 'proyector-led-solar-200w-ip65-c-panel-solar-c-control-remoto'],
  [28648231, 'control-remoto-gris', 'proyector-led-solar-200w-ip66-c-panel-solar-c-control-remoto-gris'],
  [28651673, 'control-remoto-28651673', 'proyector-led-solar-100w-ip66-c-panel-solar-c-control-remoto'],
  [28666518, 'control-remoto-28666518', 'proyector-led-solar-300w-ip66-c-panel-solar-c-control-remoto'],
  [28668257, 'control-remoto-28668257', 'proyector-led-solar-150w-ip66-c-panel-solar-c-control-remoto'],
  [31518788, 'w-ip66-ik10', 'campana-led-ufo-regulable-200w-150lm-w-ip66-ik10'],
  [32954808, 'ip65-44000-lm', 'campana-led-ufo-nf9-400w-110-lm-ip65-44000-lm'],
  [33554875, 'w-ip65-33554875', 'campana-led-ufo-nf7-100w-120lm-w-ip65'],
  [33597212, 'w-ip65-33597212', 'campana-led-ufo-nf7-150w-120lm-w-ip65'],
  [33610052, 'w-ip65-33610052', 'campana-led-ufo-nf7-200w-120lm-w-ip65'],
  [33736073, 'w-ip65-11000-lm', 'campana-led-ufo-nf9-100w-110lm-w-ip65-11000-lm'],
  [33748536, 'w-ip65-16500-lm', 'campana-led-ufo-nf9-150w-110lm-w-ip65-16500-lm'],
  [33748560, 'w-ip65-22000-lm', 'campana-led-ufo-nf9-200w-110lm-w-ip65-22000-lm'],
  [34057374, 'control-remoto-34057374', 'proyector-led-solar-500w-ip65-c-panel-solar-c-control-remoto'],
];

describe('ids renombrados (src/data/catalog/renamed-ids.ts)', () => {
  const renamed = Object.entries(RENAMED_SITE_IDS).map(([jid, r]) => ({ jid: Number(jid), ...r }));

  it('cada renombre parte del id registrado (legado o de la sincronización)', () => {
    for (const r of renamed) {
      expect(r.previous.length, String(r.jid)).toBeGreaterThan(0);
      expect(r.previous[0], String(r.jid)).toBe(LEGACY_SITE_IDS[r.jid] ?? SITE_IDS[r.jid]);
      expect(r.previous, String(r.jid)).not.toContain(r.id);
    }
  });

  it('solo crece: los 50 de la PR 07 siguen ahí, con su id nuevo vigente o como id anterior', () => {
    expect(PR07_RENAMES).toHaveLength(50);
    for (const [jid, old, id] of PR07_RENAMES) {
      const r = RENAMED_SITE_IDS[jid];
      expect(r, String(jid)).toBeDefined();
      expect(r.previous, String(jid)).toContain(old);
      expect([r.id, ...r.previous], String(jid)).toContain(id);
      expect(RENAMED_FROM.get(old), old).toBe(r.id);
    }
  });

  it('ningún producto se publica con un id retirado (su 301 taparía la página)', () => {
    expect(RETIRED_SITE_IDS.size).toBe(renamed.reduce((n, r) => n + r.previous.length, 0));
    expect(products.filter(p => RETIRED_SITE_IDS.has(p.id)).map(p => p.id)).toEqual([]);
    for (const r of renamed) expect(RETIRED_SITE_IDS.has(r.id), r.id).toBe(false);
    // Un Map: /producto/constructor no encuentra nada heredado de Object.prototype
    expect(RENAMED_FROM.get('constructor')).toBeUndefined();
  });

  it('la tabla no importa nada, y el carrito y la cotización no cargan el catálogo completo (bundle principal)', () => {
    const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
    expect(read('src/data/catalog/renamed-ids.ts')).not.toMatch(/^\s*import\b/m);
    for (const f of ['src/lib/requestOrder.ts', 'src/context/AppContext.tsx', 'src/routes.tsx']) {
      const staticImports = [...read(f).matchAll(/^import\s[^;]*?from\s+'([^']+)'/gms)].map(m => m[1]);
      expect(staticImports.filter(i => /seo\/routes|data\/catalog\/index|data\/products/.test(i)), f).toEqual([]);
    }
  });
});
