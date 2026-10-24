// src/lib/notFoundSearch.ts
// El texto con que la 404 precarga su buscador (auditoría UX, B-10): de las palabras de la URL,
// las que sí encuentran productos. Trae el catálogo y el índice de búsqueda, así que la 404 lo
// carga aparte (import() al montar): la 404 va también en el trozo de las guías y del catálogo.

import { products } from '@/data/products';
import { searchThatFinds } from './productSearch';
import { searchTermsFromPath } from './notFound';

/** Lo que encuentra productos de las palabras de la URL; '' si nada. */
export function notFoundSearch(pathname: string): string {
  return searchThatFinds(products, searchTermsFromPath(pathname));
}
