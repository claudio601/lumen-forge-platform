// src/data/guides/ds1-block.ts
// Texto del bloque «Luminarias con certificado» de una guía (plan del blog, §3.3): una línea por
// grupo de productos con las versiones que cubre su certificado D.S. N°1/2022. Los ítems salen de
// DS1_CERTIFIED_LINES (src/data/catalog/ds1.ts) y de las variantes de cada producto en Jumpseller
// (./ds1-lines.ts los genera; guides.test.ts exige que el contenido coincida con lo generado).
// Nombres de los tonos (decisión del dueño, 23-10-2026): 2200K es «ámbar» y 2700K, «cálida»; la
// de 1600K de la Pagoda también es ámbar. Sin imports: lo usan la página y las pruebas.

import type { Ds1BlockItem } from './types';

/** El tono de cada temperatura de color certificada, como se escribe en el sitio. */
export const KELVIN_TONE: Readonly<Record<number, string>> = {
  1600: 'ámbar',
  2200: 'ámbar',
  2700: 'cálida',
  3000: 'cálida',
  4000: 'neutra',
  5000: 'fría',
};

/** «ámbar de 2200K y cálida de 2700K». */
export function kelvinText(kelvin: readonly number[]): string {
  const parts = kelvin.map(k => (KELVIN_TONE[k] ? `${KELVIN_TONE[k]} de ${k}K` : `${k}K`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

/** Lo que va después del nombre de la línea: «: ámbar de 2200K y cálida de 2700K.». */
export const ds1ItemTail = (item: Pick<Ds1BlockItem, 'kelvin'>) => `: ${kelvinText(item.kelvin)}.`;

/** La oración completa de un ítem, como se lee en la página. */
export const ds1ItemSentence = (item: Pick<Ds1BlockItem, 'name' | 'kelvin'>) => `${item.name}${ds1ItemTail(item)}`;
