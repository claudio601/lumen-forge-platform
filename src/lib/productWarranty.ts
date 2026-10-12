import type { SpecRow } from '@/data/catalog/jumpseller.types';

/** Grupos de la tabla de especificaciones de una ficha (los mismos que dibuja SpecGroups). */
interface SpecRowGroups {
  electricos?: readonly SpecRow[];
  construccion?: readonly SpecRow[];
  componentes?: readonly SpecRow[];
}

/** Garantía legal (Ley 19.496, art. 21): el piso para todos los productos. */
export const LEGAL_WARRANTY_MONTHS = 6;

/**
 * Plazo de garantía del producto según su tabla de especificaciones ("5 años", "1 año"):
 * la editorial BESTLED o la tabla de Jumpseller, la misma que se ve más abajo en la ficha.
 * null si no hay fila de garantía, si no trae una cifra (por ejemplo "Si") o si la cifra no
 * supera la garantía legal.
 */
export function productWarranty(groups: SpecRowGroups | null | undefined): string | null {
  const rows = [...(groups?.electricos ?? []), ...(groups?.construccion ?? []), ...(groups?.componentes ?? [])];
  for (const { label, value } of rows) {
    if (!/^\s*garant[ií]a\s*:?\s*$/i.test(label)) continue; // no la de un componente ("Garantía del driver")
    const m = value.match(/^\s*(\d{1,2})\s*(años?|meses)(?![\p{L}\d])/iu);
    if (!m) continue;
    const n = Number(m[1]);
    const years = m[2].toLowerCase().startsWith('a');
    if ((years ? n * 12 : n) <= LEGAL_WARRANTY_MONTHS) continue;
    return years ? `${n} ${n === 1 ? 'año' : 'años'}` : `${n} meses`;
  }
  return null;
}

/**
 * Texto de garantía junto al precio. Si el producto informa una garantía mayor que la legal,
 * esa va primero (un producto con 5 años no se ve como uno de 6 meses); si no, la legal.
 * Sale de datos fijos del catálogo: el servidor y el navegador dibujan lo mismo.
 */
export function warrantyNote(groups: SpecRowGroups | null | undefined): string {
  const own = productWarranty(groups);
  return own ? `Garantía de ${own} (mín. legal ${LEGAL_WARRANTY_MONTHS} meses)` : `Garantía legal de ${LEGAL_WARRANTY_MONTHS} meses`;
}
