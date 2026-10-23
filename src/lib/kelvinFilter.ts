// src/lib/kelvinFilter.ts
// Filtro de temperatura de color del catálogo (auditoría UX, B-05). Las temperaturas de cada
// producto salen de las opciones de sus variantes en Jumpseller (Product.kelvins, armado en
// src/data/catalog/build.ts), así que las opciones del filtro se arman desde los datos: aparecen
// solas las que existen (2200K y 2700K incluidas) y nunca una que da 0 productos.
// Sin imports de datos.

import type { Product } from '@/data/catalog/types';

export interface KelvinOption {
  kelvin: number;
  /** Productos que la tienen en alguna variante. */
  count: number;
}

/**
 * Opciones del filtro, de menor a mayor, con su conteo sobre `products` (lo que queda con los
 * demás filtros). Sin las que dan 0, salvo las elegidas: así se pueden quitar.
 */
export function kelvinOptions(products: readonly Pick<Product, 'kelvins'>[], selected: readonly number[] = []): KelvinOption[] {
  const counts = new Map<number, number>(selected.map(k => [k, 0]));
  for (const p of products) for (const k of p.kelvins) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([kelvin, count]) => ({ kelvin, count })).sort((a, b) => a.kelvin - b.kelvin);
}

/** Pasa si alguna de sus variantes tiene alguna de las temperaturas elegidas (sin elegidas, todos). */
export function matchesKelvin(product: Pick<Product, 'kelvins'>, selected: readonly number[]): boolean {
  return selected.length === 0 || product.kelvins.some(k => selected.includes(k));
}

/**
 * Temperaturas de la URL: ?k=2700, ?k=2200,2700 o ?k=2200&k=2700 → [2200, 2700]. Solo números
 * enteros entre 1000 y 10000 (con o sin la K); lo demás se ignora. Sin repetir, de menor a mayor.
 */
export function parseKelvinParam(values: readonly string[]): number[] {
  const found = values
    .flatMap(v => v.split(','))
    .map(v => /^\s*(\d{4,5})\s*k?\s*$/i.exec(v)?.[1])
    .map(Number)
    .filter(k => Number.isInteger(k) && k >= 1000 && k <= 10000);
  return [...new Set(found)].sort((a, b) => a - b);
}
