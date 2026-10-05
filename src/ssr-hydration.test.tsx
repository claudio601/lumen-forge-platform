// Páginas estáticas (Etapa 2): el HTML se genera en el servidor (entry-server.tsx), sin
// sesión y sin parámetros de URL, y el navegador lo "hidrata" con la app real (App.tsx).
// Si el primer render del navegador difiere del HTML, o si una actualización urgente
// llega a la página antes de que termine de hidratarse, React descarta el HTML del
// servidor y la vuelve a dibujar (onRecoverableError) o avisa por consola ("did not match").

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from '@/App';
import { serverTree } from '@/entry-server';
import { preloadRoute, staticPage } from '@/routes';
import { NOT_FOUND_ATTR, NOT_FOUND_URL } from '@/lib/notFound';
import { STATIC_ROUTES } from '@/lib/seo/routes';
import { products } from '@/data/products';
import { editorialOverlay } from '@/data/catalog/overlay/editorial';
import { hasProductContent } from '@/data/catalog/content';

/** Sesión de un cliente en modo empresa con productos en la cotización y en la solicitud. */
function seedSession() {
  const p = products[0];
  sessionStorage.setItem('elights_b2b', 'true');
  sessionStorage.setItem('elights_quote', JSON.stringify([{ product: p, quantity: 3 }]));
  sessionStorage.setItem(
    'elights_request_cart',
    JSON.stringify([{ productId: p.id, jumpsellerId: p.jumpseller_id, sku: p.sku || `JS-${p.jumpseller_id}`, name: p.name, quantity: 2, unitPrice: p.price, priceMode: 'iva', url: `/producto/${p.id}`, attributes: {} }]),
  );
}

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  sessionStorage.clear();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

const MISMATCH = /did not match|did not expect server HTML|Expected server HTML|received an update before it finished hydrating|switch to client rendering/i;

/**
 * Genera el HTML como el prerender (ruta sin parámetros, sin sesión) y lo hidrata con
 * la app del navegador en la URL del visitante, opcionalmente con una sesión activa.
 * notFound: el HTML es 404.html (Vercel lo sirve en cualquier URL sin archivo ni regla).
 */
async function hydrate(serverPath: string, clientUrl: string, withSession: boolean, notFound = false) {
  sessionStorage.clear();
  const errors: unknown[] = [];
  const consoleErrors: string[] = [];
  // En jsdom, Radix usa useLayoutEffect también en el render del servidor y React avisa
  // (en Node, donde corre el prerender, no lo usa). Solo cuentan los avisos de hidratación.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args.map(String).join(' ')); });
  await preloadRoute(serverPath);
  const html = renderToString(serverTree(serverPath));
  if (withSession) seedSession();
  window.history.replaceState({}, '', clientUrl);
  const container = document.createElement('div');
  container.innerHTML = html;
  if (notFound) container.setAttribute(NOT_FOUND_ATTR, ''); // como scripts/prerender.ts (markNotFound)
  document.body.appendChild(container);
  const serverH1 = container.querySelector('main h1');
  await act(async () => {
    const { notFoundPath, preload } = staticPage(container, new URL(clientUrl, 'http://x').pathname); // como src/main.tsx
    await preload;
    root = hydrateRoot(container, <HelmetProvider><App notFoundPath={notFoundPath} /></HelmetProvider>, { onRecoverableError: e => errors.push(e) });
    await new Promise(r => setTimeout(r, 0));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { errors, mismatches: consoleErrors.filter(m => MISMATCH.test(m)), container, serverH1 };
}

const withContent = products.find(p => hasProductContent(p.jumpseller_id) && !editorialOverlay[p.jumpseller_id])!;
const bestled = products.find(p => editorialOverlay[p.jumpseller_id])!;

const PAGES: [string, string, string][] = [
  ...STATIC_ROUTES.map(r => [`página fija ${r}`, r, r] as [string, string, string]),
  ['categoría (Google Ads, página 2)', '/catalogo/paneles-led', '/catalogo/paneles-led?gclid=abc&utm_source=google&page=2'],
  ['ficha con contenido SEO', `/producto/${withContent.id}`, `/producto/${withContent.id}?gclid=abc`],
  ['ficha BESTLED', `/producto/${bestled.id}`, `/producto/${bestled.id}`],
];

/**
 * URLs que reciben 404.html (PR 05). Varias coinciden con una ruta de la app: sin la marca
 * de 404.html el navegador dibujaría otra página encima del HTML.
 */
const NOT_FOUND_URLS: [string, string][] = [
  ['URL desconocida', '/una/url/que/no/existe'],
  ['producto que no existe', '/producto/no-existe'],
  ['producto que salió del catálogo (id publicado antes)', '/producto/w-ip65-24043701?gclid=abc'],
  ['categoría que no existe, página 2', '/catalogo/no-existe?page=2'],
  ['ruta de la app con otras mayúsculas', '/Cotizador'],
];

describe('hidratación de las páginas estáticas (árbol real: entry-server y App)', () => {
  const cases: [string, string, string, boolean][] = [
    ...PAGES.map(([name, serverPath, clientUrl]) => [name, serverPath, clientUrl, false] as [string, string, string, boolean]),
    ...NOT_FOUND_URLS.map(([name, url]) => [`404.html en ${name} (${url})`, NOT_FOUND_URL, url, true] as [string, string, string, boolean]),
  ];
  for (const [name, serverPath, clientUrl, notFound] of cases) {
    for (const withSession of [false, true]) {
      it(`${name}, ${withSession ? 'con sesión (modo empresa y carrito)' : 'visitante nuevo'}: conserva el HTML del servidor`, async () => {
        const { errors, mismatches, container, serverH1 } = await hydrate(serverPath, clientUrl, withSession, notFound);
        expect(errors).toEqual([]);
        expect(mismatches).toEqual([]);
        expect(serverH1).not.toBeNull();
        expect(container.contains(serverH1)).toBe(true); // React reutilizó el nodo: no lo volvió a dibujar
        expect(container.querySelector('main .animate-spin')).toBeNull(); // ni el indicador de carga
      });
    }
  }

  it('después de hidratar, la categoría muestra la página de la URL y la sesión queda aplicada', async () => {
    const { container } = await hydrate('/catalogo/paneles-led', '/catalogo/paneles-led?page=2', true);
    expect(container.textContent).toContain('Página 2 de');
    expect(container.textContent).toContain('B2B - Precio neto');
    expect(sessionStorage.getItem('elights_b2b')).toBe('true');
    expect(JSON.parse(sessionStorage.getItem('elights_request_cart')!)).toHaveLength(1);
  });

  it('la ficha llega con su contenido SEO en el HTML y lo conserva al hidratar', async () => {
    const { container } = await hydrate(`/producto/${withContent.id}`, `/producto/${withContent.id}`, false);
    expect(container.textContent).toContain('Beneficios clave');
    expect(container.textContent).toContain('Preguntas frecuentes');
  });

  it('404.html en un producto que no existe: queda la página "no encontrada" (sin la ficha) y lleva noindex', async () => {
    const { container } = await hydrate(NOT_FOUND_URL, '/producto/no-existe', false, true);
    expect(container.querySelector('main h1')?.textContent).toBe('404');
    expect(container.textContent).not.toContain('Producto no encontrado');
    await waitFor(() => expect(document.title).toBe('Página no encontrada | eLIGHTS Chile'));
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
  });

  it('desde la página 404 se navega normal, y al volver atrás se ve otra vez la 404', async () => {
    const { container } = await hydrate(NOT_FOUND_URL, '/producto/no-existe', false, true);
    const home = [...container.querySelectorAll('main a')].find(a => a.textContent === 'Volver al inicio')!;
    await act(async () => { fireEvent.click(home); });
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(container.querySelector('main h1')?.textContent).not.toBe('404'));
    await act(async () => {
      window.history.back();
      await new Promise(r => setTimeout(r, 50));
    });
    expect(window.location.pathname).toBe('/producto/no-existe');
    await waitFor(() => expect(container.querySelector('main h1')?.textContent).toBe('404'));
  });

  it('sin la marca de 404.html, el navegador hidrata la ruta de la URL (la marca no se cuela en otras páginas)', async () => {
    const container = document.createElement('div');
    expect(staticPage(container, '/producto/no-existe').notFoundPath).toBeUndefined();
    container.setAttribute(NOT_FOUND_ATTR, '');
    expect(staticPage(container, '/producto/no-existe').notFoundPath).toBe('/producto/no-existe');
    expect(await staticPage(container, '/producto/no-existe').preload).toEqual(await preloadRoute(NOT_FOUND_URL));
  });
});
