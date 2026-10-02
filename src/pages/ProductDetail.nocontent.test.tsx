// Ficha sin contenido SEO escrito (o mientras se descarga): solo lo que trae Jumpseller,
// sin secciones vacías. Se simula la ausencia de contenido para no depender de qué
// productos lo tienen.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductDetail from './ProductDetail';

vi.mock('@/data/catalog/content', () => ({ useProductContent: () => undefined }));

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

describe('ProductDetail sin contenido SEO', () => {
  it('muestra especificaciones y texto de Jumpseller, sin beneficios ni preguntas vacías', async () => {
    renderPdp('panel-led-backlight-60x60-cm-48w-para-cielo-americano');
    expect(await screen.findByRole('heading', { name: 'Especificaciones técnicas', level: 2 })).toBeInTheDocument();
    // El texto de Jumpseller vuelve a "Descripción" cuando no hay contenido escrito
    const description = (await screen.findByRole('heading', { name: 'Descripción', level: 2 })).closest('section')!;
    expect(description.textContent).toContain('Panel LED Backlight 60x60');
    expect(screen.queryByRole('heading', { name: 'Beneficios clave' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Preguntas frecuentes' })).toBeNull();
  });

  it('los datos estructurados resumen las especificaciones de Jumpseller en texto plano', async () => {
    renderPdp('amp-led-ar111-15-150w');
    await waitFor(() => {
      const ld = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent!));
      const product = ld.find(d => d['@type'] === 'Product');
      expect(product?.description).toContain('Flujo luminoso: 1200 Lm.');
      expect(product?.description).not.toMatch(/<[a-z]/);
    });
  });
});
