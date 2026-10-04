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
