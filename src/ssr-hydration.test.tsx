// Páginas estáticas (Etapa 2): el HTML se genera en el servidor, sin sesión, y el
// navegador lo "hidrata". Si el primer render del navegador difiere del HTML (por
// ejemplo porque lee el carrito o el modo empresa de la sesión durante el render),
// React descarta el HTML y lo vuelve a dibujar (onRecoverableError).

import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
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

const tree = (url: string) => (
  <HelmetProvider>
    <TooltipProvider>
    <AppProvider>
      <RequestCartProvider>
        <MemoryRouter initialEntries={[url]}>
          <Header />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/catalogo/:categorySlug" element={<CatalogPage />} />
            <Route path="/producto/:id" element={<ProductDetail />} />
          </Routes>
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
});

async function hydrate(url: string) {
  sessionStorage.clear();
  const html = renderToString(tree(url)); // "servidor": sin sesión
  seedSession(); // el visitante sí tiene sesión
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, tree(url), { onRecoverableError: e => errors.push(e) });
  });
  return { errors, container };
}

describe('hidratación de páginas estáticas con una sesión activa', () => {
  it('portada: sin desajustes', async () => {
    const { errors } = await hydrate('/');
    expect(errors).toEqual([]);
  });

  it('categoría en ?page=2: sin desajustes, y después de montar muestra la página 2', async () => {
    const { errors, container } = await hydrate('/catalogo/paneles-led?page=2');
    expect(errors).toEqual([]);
    expect(container.textContent).toContain('Página 2 de');
  });

  it('ficha de producto: sin desajustes', async () => {
    const { errors } = await hydrate(`/producto/${products[0].id}`);
    expect(errors).toEqual([]);
  });

  it('después de hidratar se ve la sesión: modo empresa y cantidades del carrito', async () => {
    const { container } = await hydrate(`/producto/${products[0].id}`);
    expect(sessionStorage.getItem('elights_b2b')).toBe('true');
    expect(JSON.parse(sessionStorage.getItem('elights_request_cart')!)).toHaveLength(1);
    expect(container.textContent).toMatch(/neto|sin IVA/i);
  });
});
