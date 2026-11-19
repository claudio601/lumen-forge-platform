// /producto/<id>?variante=<id de la variante> (feed de Google Merchant, CLAUDE.md §18): la ficha
// llega con esa variante elegida, con su precio, su SKU, la etiqueta «Elegiste: …» y los botones
// habilitados. Un id que no es una variante del producto se ignora (la ficha queda como siempre).
// Se aplica en un efecto, después de montar: el HTML estático no cambia (src/ssr-hydration.test.tsx).
// Sin valores fijos del catálogo: el producto se elige por una propiedad del snapshot y el precio
// y el SKU esperados salen de él (como en ProductDetail.variants.test.tsx).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductDetail from './ProductDetail';
import { products, type Product } from '@/data/products';
import type { ProductVariant } from '@/data/catalog/types';
import { missingChoicesText, VARIANT_PARAM, variantAxes, variantLabel } from '@/lib/variants';
import { expectedSkuIsDistinct, snapshotVariant } from '@/test/variantRule';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));

const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;
const priceOf = (p: Product, v: ProductVariant) => snapshotVariant(p.jumpseller_id, v.id).price;
const fromText = (prices: number[]) => (new Set(prices).size > 1 ? `desde ${clp(Math.min(...prices))}` : clp(prices[0]));

// Un producto con selector cuyas variantes no cuestan lo mismo (el precio muestra si se eligió);
// la variante: la más cara con un SKU propio que la distingue (el que la ficha muestra arriba)
const withChoice = products.filter(p => (p.variants?.length ?? 0) > 1);
const product = withChoice.find(p => new Set(p.variants!.map(v => priceOf(p, v))).size > 1 && p.variants!.some(v => expectedSkuIsDistinct(p.jumpseller_id, v.id)));
const variant = product
  ? [...product.variants!].filter(v => expectedSkuIsDistinct(product.jumpseller_id, v.id)).sort((a, b) => priceOf(product, b) - priceOf(product, a))[0]
  : undefined;
const other = product ? withChoice.find(p => p.jumpseller_id !== product.jumpseller_id) : undefined;
const simple = products.find(p => !p.variants && !p.cctVariants && p.price > 1000)!;

function renderPdp(p: Product, search = '') {
  return render(
    <HelmetProvider>
      <TooltipProvider>
        <AppProvider>
          <RequestCartProvider>
            <MemoryRouter initialEntries={[`/producto/${p.id}${search}`]}>
              <Routes>
                <Route path="/producto/:id" element={<ProductDetail />} />
              </Routes>
            </MemoryRouter>
          </RequestCartProvider>
        </AppProvider>
      </TooltipProvider>
    </HelmetProvider>,
  );
}

/** Precio grande de la ficha, con «desde» si lo lleva. */
const mainPrice = (container: HTMLElement) =>
  [...container.querySelector('p.text-3xl')!.parentElement!.children]
    .map(el => el.textContent)
    .filter(t => !/^Precio/.test(t ?? ''))
    .join(' ');
const headerSku = (container: HTMLElement) => container.querySelector('h1')!.previousElementSibling!.firstElementChild!.textContent;
const requestButton = () => screen.getByRole('button', { name: /Solicitar pedido/ });
const checkedLabels = () =>
  variantAxes(product!).map(axis => within(screen.getByRole('radiogroup', { name: axis.legend })).getAllByRole('radio').find(r => r.getAttribute('aria-checked') === 'true')?.closest('label')?.textContent ?? '');

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe.skipIf(!product)(`ficha con ?${VARIANT_PARAM}= (${product?.name ?? 'ningún producto con precios distintos por variante'})`, () => {
  const p = product!;

  it('deja elegida la variante: su precio, su SKU, cada opción marcada, «Elegiste: …» y los botones habilitados', async () => {
    const { container } = renderPdp(p, `?${VARIANT_PARAM}=${variant!.id}&gclid=abc`);
    await waitFor(() => expect(mainPrice(container)).toBe(clp(priceOf(p, variant!))));
    expect(headerSku(container)).toBe(snapshotVariant(p.jumpseller_id, variant!.id).sku);
    expect(screen.getByText(new RegExp(`^Elegiste: ${variantLabel(p, variant!).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`))).toBeInTheDocument();
    const axes = variantAxes(p);
    expect(checkedLabels().every(Boolean)).toBe(true);
    for (const [i, axis] of axes.entries()) {
      const value = variant!.options.find(o => o.name === axis.name)!.value;
      const choice = axis.choices.find(c => c.value === value)!;
      expect(checkedLabels()[i].startsWith(choice.label), axis.legend).toBe(true);
    }
    expect(requestButton()).toBeEnabled();
  });

  it.each([
    ['un id que no existe', '?variante=1'],
    ['un texto', '?variante=abc'],
    ['vacío', '?variante='],
    ['un número con signo', `?variante=-${variant?.id}`],
    ['la variante de otro producto', `?variante=${other?.variants?.[0]?.id}`],
  ])('ignora %s: «desde», sin opción marcada y los botones bloqueados', async (_name, search) => {
    const { container } = renderPdp(p, search);
    // Se espera un ciclo: el efecto corre después de montar
    await new Promise(r => setTimeout(r, 0));
    expect(mainPrice(container)).toBe(fromText(p.variants!.map(v => priceOf(p, v))));
    expect(checkedLabels().some(Boolean)).toBe(false);
    expect(screen.getByText(`Elige ${missingChoicesText(variantAxes(p))} para continuar.`)).toBeInTheDocument();
    expect(requestButton()).toBeDisabled();
  });
});

describe('ficha sin selector con ?variante=', () => {
  it('se ve como siempre: su precio y el botón habilitado', async () => {
    const { container } = renderPdp(simple, '?variante=123');
    await new Promise(r => setTimeout(r, 0));
    expect(mainPrice(container)).toBe(clp(simple.price));
    expect(requestButton()).toBeEnabled();
  });
});
