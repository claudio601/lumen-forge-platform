// src/data/guides/ds1-lines.ts
// Genera el bloque «Luminarias con certificado» desde las líneas del dueño (DS1_CERTIFIED_LINES)
// y las variantes de cada producto en Jumpseller, con las reglas de src/data/catalog/ds1.ts:
// - por cada producto publicado de una línea, las versiones que tiene de verdad (la temperatura
//   de color de sus variantes) y que su certificado cubre (ds1CoversKelvin: las cálidas de 2200K
//   y 2700K, la ámbar de 1600K y la de 2700K en la Pagoda, y hasta 5000K en los estadios);
// - los productos de una línea con las mismas versiones van juntos, en un ítem;
// - queda fuera el producto sin ninguna versión certificada (el estadio de 600W, solo 6000K) y
//   el que tiene una versión cálida sin su temperatura de color (el estadio modular de 800W:
//   «Luz Cálida - 1% Luz Azul»), hasta que se corrija su ficha (plan del blog, §3.3).
// Solo lo usan las pruebas (guides.test.ts): la página muestra el texto aprobado por el dueño,
// que vive en ./content/<slug>.ts y tiene que coincidir con lo que genera esta función.

import { DS1_CERTIFIED_LINES, ds1CoversKelvin, type Ds1LineKey } from '../catalog/ds1';

/** «2200K», «2.700 K», «4000 kelvin». */
const KELVIN = /(?<![\d.,])(\d{1,2}\.?\d{3})\s?(?:K(?![\p{L}\p{N}])|kelvin)/giu;
/** Una versión cálida o ámbar que Jumpseller nombra sin su temperatura («Luz Cálida - 1% Luz Azul»). */
const WARM = /c[aá]lid|[aá]mbar/i;

export interface Ds1LineGroup {
  line: Ds1LineKey;
  /** Ids de Jumpseller, en el orden de la línea. */
  products: number[];
  kelvin: number[];
}

export interface Ds1LineGroups {
  groups: Ds1LineGroup[];
  /** Productos de una línea que el bloque no nombra, con el motivo. */
  excluded: { id: number; reason: string }[];
}

/** Las temperaturas de color de las opciones de un producto («Color de Luz: Luz Cálida - 2700K»). */
export const optionKelvin = (options: readonly string[]): number[] =>
  [...new Set(options.flatMap(o => [...o.matchAll(KELVIN)].map(m => Number(m[1].replace('.', '')))))].sort((a, b) => a - b);

/**
 * Los grupos del bloque, línea por línea en el orden dado. variantOptions: las opciones de las
 * variantes de cada producto publicado (sin el producto, no está publicado y no se nombra).
 */
export function ds1LineGroups(order: readonly Ds1LineKey[], variantOptions: ReadonlyMap<number, readonly string[]>): Ds1LineGroups {
  const groups: Ds1LineGroup[] = [];
  const excluded: { id: number; reason: string }[] = [];
  for (const key of order) {
    const line = DS1_CERTIFIED_LINES[key];
    const byVersions = new Map<string, Ds1LineGroup>();
    for (const id of line.ids) {
      const options = variantOptions.get(id);
      if (!options) {
        excluded.push({ id, reason: 'no está publicado' });
        continue;
      }
      if (options.some(o => WARM.test(o) && !o.match(KELVIN))) {
        excluded.push({ id, reason: 'una versión cálida sin su temperatura de color en Jumpseller' });
        continue;
      }
      const kelvin = optionKelvin(options).filter(k => ds1CoversKelvin(line.versions, k));
      if (!kelvin.length) {
        excluded.push({ id, reason: 'ninguna versión con certificado' });
        continue;
      }
      const k = kelvin.join(',');
      const group = byVersions.get(k) ?? { line: key, products: [], kelvin };
      group.products.push(id);
      byVersions.set(k, group);
    }
    groups.push(...byVersions.values());
  }
  return { groups, excluded };
}
