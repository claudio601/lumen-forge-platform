// src/pages/NotFound.test.tsx
// Página 404 útil (auditoría UX, B-10): el buscador precargado con las palabras de la URL, las 6
// categorías principales (las del pie) y el correo a ventas para un producto que ya no está. Sin
// WhatsApp en la página (queda para después de la marcha blanca del bot). Que responda 404 y con
// noindex lo prueban ssr-hydration.test.tsx, check:prerender y el chequeo de humo.

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { categories, mainCategories } from '@/data/catalog/categories.config';
import NotFound from './NotFound';

function SearchProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="buscar">{pathname + search}</p>;
}

function renderAt(url: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/buscar" element={<SearchProbe />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

const field = () => screen.getByRole('searchbox', { name: 'Buscar productos' }) as HTMLInputElement;

describe('404 útil (B-10)', () => {
  it('el h1 sigue siendo «404» (check:prerender lo exige en 404.html)', () => {
    renderAt('/producto/no-existe');
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['404']);
    expect(screen.getByText('Página no encontrada')).toBeInTheDocument();
  });

  it('el buscador llega con las palabras de la URL y busca en /buscar', () => {
    renderAt('/producto/lineal-led-flat-40w-120-cm-ip20-6500k?gclid=abc#x');
    expect(field().value).toBe('lineal led flat 40w 120 cm ip20 6500k');
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByTestId('buscar')).toHaveTextContent('/buscar?q=lineal%20led%20flat%2040w%20120%20cm%20ip20%206500k');
  });

  it('se puede cambiar la búsqueda; vacía, lleva a /buscar', () => {
    renderAt('/una/url/que/no/existe');
    expect(field().value).toBe('una url que no existe');
    fireEvent.change(field(), { target: { value: '  proyector 200W ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByTestId('buscar')).toHaveTextContent('/buscar?q=proyector%20200W');
  });

  it('sin JavaScript también busca: formulario GET a /buscar con el campo q', () => {
    renderAt('/producto/no-existe');
    const form = screen.getByRole('search') as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('/buscar');
    expect(form.getAttribute('method')).toBe('get');
    expect(field().name).toBe('q');
    expect(field().getAttribute('enterkeyhint')).toBe('search');
  });

  it('las 6 categorías principales, las mismas del pie', () => {
    renderAt('/producto/no-existe');
    const section = screen.getByRole('heading', { name: 'Categorías principales' }).closest('section')!;
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(links.map(a => [a.textContent, a.getAttribute('href')])).toEqual(mainCategories().map(c => [c.name, `/catalogo/${c.slug}`]));
    // Las que más productos tienen
    const counts = mainCategories().map(c => c.productCount);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(Math.max(...categories.filter(c => !mainCategories().includes(c)).map(c => c.productCount)));
  });

  it('«¿Buscabas un producto que ya no está?»: correo a ventas, prellenado con lo que se busca, sin WhatsApp', () => {
    const { container } = renderAt('/producto/foco-que-no-existe');
    const section = screen.getByRole('heading', { name: '¿Buscabas un producto que ya no está?' }).closest('section')!;
    const mail = within(section).getByRole('link', { name: 'Escríbenos a ventas@elights.cl' });
    const href = mail.getAttribute('href')!;
    expect(href.startsWith('mailto:ventas@elights.cl?subject=')).toBe(true);
    expect(new URLSearchParams(href.split('?')[1]).get('subject')).toBe('Busco: foco que no existe');
    fireEvent.change(field(), { target: { value: '' } });
    expect(mail.getAttribute('href')).toBe('mailto:ventas@elights.cl');
    expect(section).toHaveTextContent('Te respondemos por correo el mismo día hábil.');
    expect(container.innerHTML).not.toMatch(/wa\.me|whatsapp/i);
    expect(container.textContent).not.toMatch(/stock/i);
  });

  it('sigue con «Volver al inicio» y con noindex', async () => {
    renderAt('/producto/no-existe');
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow'));
  });
});
