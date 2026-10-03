// src/entry-server.tsx
// Render del servidor para las páginas estáticas. Vite lo compila aparte
// (`vite build --ssr`, a dist-ssr/) y scripts/prerender.ts lo llama una vez por ruta.
// Mismo árbol que el navegador (App.tsx), con StaticRouter en vez de BrowserRouter.

import { renderToString } from 'react-dom/server';
import { HelmetProvider, type HelmetServerState } from 'react-helmet-async';
import { StaticRouter } from 'react-router-dom/server';
import { AppLayout, AppProviders } from './App';
import { preloadRoute } from './routes';

export { indexableRoutes } from './lib/seo/routes';

/**
 * Cabecera de spa.html, la app vacía para las páginas que dependen de la sesión o de la
 * búsqueda y las URLs desconocidas. La página la reemplaza al dibujarse (data-rh: Helmet).
 */
export const SPA_HEAD =
  '<title>eLIGHTS — Iluminación LED Profesional Chile</title><meta data-rh="true" name="robots" content="noindex, follow"/>';

export interface RenderResult {
  /** HTML de la app, para dentro de <div id="root">. */
  html: string;
  /** Etiquetas de <head>: título, descripción, canonical, Open Graph y JSON-LD. */
  head: string;
  /** Archivos fuente de la página y sus datos (para <link rel="modulepreload">). */
  files: string[];
}

export function serverTree(url: string, helmetContext: { helmet?: HelmetServerState } = {}) {
  return (
    <HelmetProvider context={helmetContext}>
      <AppProviders>
        <StaticRouter location={url}>
          <AppLayout />
        </StaticRouter>
      </AppProviders>
    </HelmetProvider>
  );
}

// Una parte que suspendió y quedó para dibujarse en el navegador (React marca el HTML así).
const CLIENT_RENDERED = '<!--$!-->';

export async function render(url: string): Promise<RenderResult> {
  const files = await preloadRoute(new URL(url, 'http://localhost').pathname);
  const helmetContext: { helmet?: HelmetServerState } = {};
  const html = renderToString(serverTree(url, helmetContext));
  // Con la página y sus datos precargados nada suspende. Si algo suspendiera, el HTML
  // saldría sin contenido (solo el indicador de carga): mejor fallar el build.
  if (html.includes(CLIENT_RENDERED)) throw new Error(`${url}: una parte de la página quedó sin dibujar en el servidor`);
  const { helmet } = helmetContext;
  if (!helmet) throw new Error(`${url}: sin etiquetas de <head>`);
  const head = [helmet.title, helmet.priority, helmet.meta, helmet.link, helmet.script]
    .map(part => part?.toString() ?? '')
    .filter(Boolean)
    .join('');
  return { html, head, files };
}
