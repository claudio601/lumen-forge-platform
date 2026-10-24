// src/lib/headerSearchEngine.ts
// El catálogo y el índice de búsqueda para las sugerencias del buscador del encabezado
// (HeaderSearch). El encabezado va en todas las páginas: esto se carga aparte, con import() al
// acercarse o entrar a la caja, para no hacer más pesada la primera carga.

export { products } from '@/data/products';
export { highlightMatches, searchProducts, searchWords } from './productSearch';
export { variantFromPrice } from './variants';
