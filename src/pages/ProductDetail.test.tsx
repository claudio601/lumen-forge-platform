import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductDetail from './ProductDetail';

const BESTLED = 'alumbrado-publico-bestled-150w-ip66-ik08';

function renderPdp(id: string) {
  return render(
    <HelmetProvider>
      <TooltipProvider>
        <AppProvider>
          <RequestCartProvider>
            <MemoryRouter initialEntries={[`/producto/${id}`]}>
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

describe('ProductDetail: modelo cotización, nunca stock', () => {
  beforeEach(() => sessionStorage.clear());

  it('muestra "Consultar disponibilidad" y ninguna mención a stock', () => {
    const { container } = renderPdp(BESTLED);
    const link = screen.getAllByRole('link', { name: 'Consultar disponibilidad' })[0];
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
    expect(container.textContent).not.toMatch(/stock/i);
  });

  it('el despacho prometido es "hasta 2 días hábiles"', () => {
    renderPdp(BESTLED);
    expect(screen.getByText('Despacho en hasta 2 días hábiles')).toBeInTheDocument();
  });

  it('el JSON-LD del producto es válido y no declara disponibilidad', async () => {
    renderPdp(BESTLED);
    await waitFor(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      const product = scripts.map(s => JSON.parse(s.textContent || '{}')).find(j => j['@type'] === 'Product');
      expect(product).toBeDefined();
      expect(product.offers.price).toBeGreaterThan(0);
      expect(product.offers).not.toHaveProperty('availability');
    });
  });
});
