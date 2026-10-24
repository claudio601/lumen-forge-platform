// src/lib/notFound.ts
// Página "no encontrada" (Etapa 2, PR 05). Vercel sirve dist/404.html, con estado 404, en
// cualquier URL que no tenga archivo ni regla en vercel.json. Ese HTML se genera una sola
// vez (para NOT_FOUND_URL) y lleva NOT_FOUND_ATTR en #root: así el navegador hidrata la
// página 404 aunque la URL coincida con una ruta de la app (p. ej. un producto que ya no
// está en el catálogo, /producto/<id>), en vez de dibujar otra página encima.
// Sin dependencias: lo importan la app y los scripts de Node.

/** URL con la que se genera 404.html. Ninguna ruta la atiende: cae en '*'. */
export const NOT_FOUND_URL = '/__no-encontrada__';

/** Atributo de <div id="root"> que solo lleva 404.html. */
export const NOT_FOUND_ATTR = 'data-not-found';

/**
 * Partes de una ruta que no dicen qué se buscaba: las rutas del sitio (/producto, /catalogo…) y
 * las de la tienda anterior en Jumpseller (/products, /search…).
 */
const ROUTE_WORDS = new Set([
  'producto', 'productos', 'product', 'products', 'catalogo', 'categoria', 'categorias', 'category',
  'buscar', 'search', 'guias', 'blog', 'tienda',
]);
/** Palabras y largo máximos del buscador precargado de la 404. */
const MAX_TERMS = 8;
const MAX_TERMS_LENGTH = 80;
/** Una palabra: un número con sus decimales y lo que va pegado («14,4w», «2x18w»), o letras y cifras. */
const WORD = /\d+(?:[.,]\d+)*[\p{L}\p{N}]*|[\p{L}\p{N}]+/gu;

/**
 * Las palabras de una URL sin página, para precargar el buscador de la 404 (auditoría UX, B-10):
 * «/producto/lineal-led-flat-40w-120-cm-ip20-6500k» → «lineal led flat 40w 120 cm ip20 6500k».
 * Solo la ruta (ni la consulta ni el #), decodificada y en minúsculas; sin las partes de ruta
 * (ROUTE_WORDS), sin extensiones (.html, .php), sin ids de 5 cifras o más, sin repetir y hasta 8
 * palabras (80 caracteres). '' si no queda ninguna, y en NOT_FOUND_URL (la URL del HTML estático).
 */
export function searchTermsFromPath(pathname: string): string {
  if (pathname === NOT_FOUND_URL) return '';
  const words: string[] = [];
  for (const raw of pathname.split('/')) {
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      // '%' suelto: se lee tal cual
    }
    segment = segment.toLowerCase().replace(/\.(html?|php|aspx?)$/, '');
    if (ROUTE_WORDS.has(segment)) continue;
    for (const match of segment.matchAll(WORD)) {
      const word = match[0].replace(/,/g, '.');
      if (/^\d{5,}$/.test(word) || words.includes(word)) continue;
      words.push(word);
    }
  }
  const kept = words.slice(0, MAX_TERMS);
  while (kept.length > 1 && kept.join(' ').length > MAX_TERMS_LENGTH) kept.pop();
  return kept.join(' ').slice(0, MAX_TERMS_LENGTH);
}
