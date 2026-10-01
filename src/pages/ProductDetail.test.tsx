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

describe('ProductDetail: descripción', () => {
  it('un producto sin texto editorial muestra la descripción de Jumpseller (tabla de especificaciones)', async () => {
    const { container } = renderPdp('amp-led-ar111-15-150w');
    await screen.findByRole('heading', { name: 'Descripción' });
    const section = screen.getByRole('heading', { name: 'Descripción' }).closest('section')!;
    expect(section.querySelector('table')).not.toBeNull();
    expect(section.textContent).toContain('G53');
    expect(container.querySelector('script:not([type="application/ld+json"])')).toBeNull();
  });

  it('los BESTLED conservan el texto editorial del prototipo', async () => {
    renderPdp(BESTLED);
    const section = (await screen.findByRole('heading', { name: 'Descripción' })).closest('section')!;
    expect(section.textContent).toContain('La luminaria LED BESTLED 150W');
    expect(section.querySelector('.prose')).toBeNull();
  });

  it('los datos estructurados del producto usan el texto de la descripción de Jumpseller', async () => {
    renderPdp('amp-led-ar111-15-150w');
    await waitFor(() => {
      const ld = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent!));
      const product = ld.find(d => d['@type'] === 'Product');
      expect(product?.description).toContain('G53');
      expect(product?.description).not.toMatch(/<[a-z]/);
    });
  });
});
