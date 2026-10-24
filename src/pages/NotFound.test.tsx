// src/pages/NotFound.test.tsx
// Página 404 útil (auditoría UX, B-10): el buscador precargado con las palabras de la URL que
// encuentran productos, las 6 categorías principales (las del pie) y el correo a ventas para un
// producto que ya no está. Sin WhatsApp en la página (queda para después de la marcha blanca del
// bot). Que responda 404 y con noindex lo prueban ssr-hydration.test.tsx, check:prerender y el
// chequeo de humo.

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { categories, mainCategories } from '@/data/catalog/categories.config';
import { products } from '@/data/products';
import { isNotFoundSearch } from '@/lib/notFound';
import { notFoundSearch } from '@/lib/notFoundSearch';
import { searchProducts } from '@/lib/productSearch';
import NotFound from './NotFound';

function SearchProbe() {
  const { pathname, search, state } = useLocation();
  return <p data-testid="buscar" data-from-not-found={String(isNotFoundSearch(state))}>{pathname + search}</p>;
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
/** La 404 precarga el buscador al cargar notFoundSearch (import()). */
const prefilled = (value: string) => waitFor(() => expect(field().value).toBe(value));
/** Un producto dado de baja: la URL de una ficha real con otra potencia. */
const RETIRED = (() => {
  const p = products.find(x => /-\d+w-/.test(x.id))!;
  return `/producto/${p.id.replace(/-(\d+)w-/, (_m, n) => `-${Number(n) + 7}w-`)}`;
})();

describe('404 útil (B-10)', () => {
  it('el h1 sigue siendo «404» (check:prerender lo exige en 404.html)', () => {
    renderAt('/producto/no-existe');
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['404']);
    expect(screen.getByText('Página no encontrada')).toBeInTheDocument();
  });

  it('un producto dado de baja: el buscador llega con las palabras de la URL que encuentran productos', async () => {
    renderAt(`${RETIRED}?gclid=abc#x`);
    const q = notFoundSearch(RETIRED);
    expect(q).not.toBe('');
    expect(searchProducts(products, q).length).toBeGreaterThan(0);
    await prefilled(q);
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByTestId('buscar')).toHaveTextContent(`/buscar?q=${encodeURIComponent(q)}`);
    // Sin cambios: /buscar no mide esa búsqueda (la eligió la 404)
    expect(screen.getByTestId('buscar')).toHaveAttribute('data-from-not-found', 'true');
  });

  it('si nada de la URL encuentra productos, el buscador queda vacío; lo escrito sí se mide', async () => {
    renderAt('/una/url/que/no/existe');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Escríbenos a ventas@elights.cl' }).getAttribute('href')).toContain('existe'));
    await prefilled('');
    fireEvent.change(field(), { target: { value: '  proyector 200W ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByTestId('buscar')).toHaveTextContent('/buscar?q=proyector%20200W');
    expect(screen.getByTestId('buscar')).toHaveAttribute('data-from-not-found', 'false');
  });

  it('vacía, lleva a /buscar', async () => {
    renderAt('/producto/no-existe');
    await prefilled('');
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByTestId('buscar')).toHaveTextContent(/^\/buscar$/);
  });

  it('si la persona escribe antes de que cargue la búsqueda, no se le cambia el texto', async () => {
    renderAt(RETIRED);
    fireEvent.change(field(), { target: { value: 'campana' } });
    await import('@/lib/notFoundSearch');
    await new Promise(r => setTimeout(r, 0));
    expect(field().value).toBe('campana');
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

  it('«¿Buscabas un producto que ya no está?»: correo a ventas, con todas las palabras de la URL o lo escrito, sin WhatsApp', async () => {
    const { container } = renderAt('/producto/foco-que-no-existe');
    const section = screen.getByRole('heading', { name: '¿Buscabas un producto que ya no está?' }).closest('section')!;
    const mail = within(section).getByRole('link', { name: 'Escríbenos a ventas@elights.cl' });
    const subject = () => new URLSearchParams(mail.getAttribute('href')!.split('?')[1]).get('subject');
    await prefilled(notFoundSearch('/producto/foco-que-no-existe'));
    expect(mail.getAttribute('href')!.startsWith('mailto:ventas@elights.cl?subject=')).toBe(true);
    // El buscador lleva solo lo que encuentra productos; el correo, qué producto era
    expect(subject()).toBe('Busco: foco que no existe');
    fireEvent.change(field(), { target: { value: 'foco solar' } });
    expect(subject()).toBe('Busco: foco solar');
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
