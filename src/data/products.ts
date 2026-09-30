// src/data/products.ts
// Punto de entrada histórico del catálogo: re-exporta desde ./catalog para no cambiar
// a quienes importan desde '@/data/products'.
//   - Tipos y categorías (livianos): ./catalog/types, ./catalog/categories.config
//   - Productos: ./catalog/index (base + contenido editorial en ./catalog/overlay)

export type { Product, Category } from './catalog/types';
export { PROJECT_CATEGORIES, categories, popularSearches } from './catalog/categories.config';
export { products } from './catalog/index';
