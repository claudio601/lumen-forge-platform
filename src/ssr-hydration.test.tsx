// Páginas estáticas (Etapa 2): el HTML se genera en el servidor, sin sesión y sin
// parámetros de URL, y el navegador lo "hidrata". El árbol imita App.tsx: proveedores
// arriba, la página en un React.lazy dentro de <Suspense>. Si el primer render del
// navegador difiere del HTML, o si una actualización urgente llega a la página antes
// de que termine de hidratarse, React descarta el HTML del servidor y la vuelve a
// dibujar (onRecoverableError) o avisa por consola ("did not match").

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { lazy, Suspense, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import Index from '@/pages/Index';
import CatalogPage from '@/pages/CatalogPage';
import ProductDetail from '@/pages/ProductDetail';
import { products } from '@/data/products';

type Pages = { Index: ComponentType; CatalogPage: ComponentType; ProductDetail: ComponentType };

const server: Pages = { Index, CatalogPage, ProductDetail };
// En el navegador las páginas llegan con React.lazy, como en App.tsx (el chunk ya está
// en caché, pero lazy igual suspende en el primer render de la hidratación).
const lazyPage = (C: ComponentType) => lazy(() => Promise.resolve({ default: C }));
const client = (): Pages => ({ Index: lazyPage(Index), CatalogPage: lazyPage(CatalogPage), ProductDetail: lazyPage(ProductDetail) });

const tree = (url: string, P: Pages) => (
  <HelmetProvider>
    <TooltipProvider>
      <AppProvider>
        <RequestCartProvider>
          <MemoryRouter initialEntries={[url]}>
            <Header />
            <main id="main">
              <Suspense fallback={<div data-testid="cargando" />}>
                <Routes>
                  <Route path="/" element={<P.Index />} />
                  <Route path="/catalogo/:categorySlug" element={<P.CatalogPage />} />
                  <Route path="/producto/:id" element={<P.ProductDetail />} />
                </Routes>
              </Suspense>
            </main>
            <Footer />
          </MemoryRouter>
        </RequestCartProvider>
      </AppProvider>
    </TooltipProvider>
  </HelmetProvider>
);

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
  vi.restoreAllMocks();
});

const MISMATCH = /did not match|did not expect server HTML|Expected server HTML|received an update before it finished hydrating|switch to client rendering/i;

/**
 * Genera el HTML como el servidor (ruta sin parámetros, sin sesión) y lo hidrata
 * en la URL del visitante, opcionalmente con una sesión activa.
 */
async function hydrate(serverPath: string, clientUrl: string, withSession: boolean) {
  sessionStorage.clear();
  const html = renderToString(tree(serverPath, server));
  if (withSession) seedSession();
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const serverH1 = container.querySelector('#main h1');
  const errors: unknown[] = [];
  const consoleErrors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args.map(String).join(' ')); });
  await act(async () => {
    root = hydrateRoot(container, tree(clientUrl, client()), { onRecoverableError: e => errors.push(e) });
    await new Promise(r => setTimeout(r, 0));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { errors, mismatches: consoleErrors.filter(m => MISMATCH.test(m)), container, serverH1 };
}

const PAGES: [string, string, string][] = [
  ['portada', '/', '/'],
  ['categoría (Google Ads, página 2)', '/catalogo/paneles-led', '/catalogo/paneles-led?gclid=abc&utm_source=google&page=2'],
  ['ficha de producto', `/producto/${products[0].id}`, `/producto/${products[0].id}?gclid=abc`],
];

describe('hidratación de las páginas estáticas (árbol como App.tsx: lazy + Suspense)', () => {
  for (const [name, serverPath, clientUrl] of PAGES) {
    for (const withSession of [false, true]) {
      it(`${name}, ${withSession ? 'con sesión (modo empresa y carrito)' : 'visitante nuevo'}: conserva el HTML del servidor`, async () => {
        const { errors, mismatches, container, serverH1 } = await hydrate(serverPath, clientUrl, withSession);
        expect(errors).toEqual([]);
        expect(mismatches).toEqual([]);
        expect(serverH1).not.toBeNull();
        expect(container.contains(serverH1)).toBe(true); // React reutilizó el nodo: no lo volvió a dibujar
        expect(container.querySelector('[data-testid="cargando"]')).toBeNull();
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
});
