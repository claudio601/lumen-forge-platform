// Generación del SKU de variante CCT para la familia BESTLED.
// Convención alineada con Jumpseller: 2200K→"1", 2700K→"7", 4000K→"N", 5000K→"F".
// Patrón: APB{potencia}{sufijo} (ej. APB150 + 7 = APB1507).
export const CCT_SKU_SUFFIX: Record<number, string> = {
  2200: '1',
  2700: '7',
  4000: 'N',
  5000: 'F',
};

export function buildVariantSku(baseSku: string, cct: number | null | undefined): string {
  return cct != null && CCT_SKU_SUFFIX[cct] ? `${baseSku}${CCT_SKU_SUFFIX[cct]}` : baseSku;
}
