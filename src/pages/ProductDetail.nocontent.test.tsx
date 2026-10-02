// Ficha sin contenido SEO escrito (o mientras se descarga): solo lo que trae Jumpseller,
// sin secciones vacías. Se simula la ausencia de contenido para no depender de qué
// productos lo tienen.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductDetail from './ProductDetail';

vi.mock('@/data/catalog/content', () => ({ useProductContent: () => undefined }));

describe('ProductDetail sin contenido SEO', () => {
  it('muestra especificaciones y texto de Jumpseller, sin beneficios ni preguntas vacías', async () => {
    render(
      <HelmetProvider>
        <TooltipProvider>
          <AppProvider>
            <RequestCartProvider>
              <MemoryRouter initialEntries={['/producto/panel-led-backlight-60x60-cm-48w-para-cielo-americano']}>
                <Routes>
                  <Route path="/producto/:id" element={<ProductDetail />} />
                </Routes>
              </MemoryRouter>
            </RequestCartProvider>
          </AppProvider>
        </TooltipProvider>
      </HelmetProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Especificaciones técnicas', level: 2 })).toBeInTheDocument();
    // El texto de Jumpseller vuelve a "Descripción" cuando no hay contenido escrito
    const description = (await screen.findByRole('heading', { name: 'Descripción', level: 2 })).closest('section')!;
    expect(description.textContent).toContain('Panel LED Backlight 60x60');
    expect(screen.queryByRole('heading', { name: 'Beneficios clave' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Preguntas frecuentes' })).toBeNull();
  });
});
