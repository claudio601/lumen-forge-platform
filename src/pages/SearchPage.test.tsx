// src/pages/SearchPage.test.tsx
// /buscar (auditoría UX, B-03 y B-04): la búsqueda tolerante en la página y la salida cuando no
// hay resultados (correo prellenado a ventas, asesoría técnica y sugerencias). Sin WhatsApp: queda
// para después de la marcha blanca del bot. Nunca stock.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { ADVISORY_LINK } from '@/config/navigation';
import { products } from '@/data/products';
import { searchProducts } from '@/lib/productSearch';
import SearchPage from './SearchPage';

function renderAt(url: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <AppProvider>
          <RequestCartProvider>
            <SearchPage />
          </RequestCartProvider>
        </AppProvider>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

const NONSENSE = 'palabraquenoexiste';
/** El SKU de una variante real (no fijo: la prueba no depende de que una variante siga en Jumpseller). */
const VARIANT_SKU = products.flatMap(p => (p.variants ?? []).map(v => v.sku)).find(Boolean)!;

describe('/buscar: búsqueda tolerante (B-03)', () => {
  beforeEach(() => sessionStorage.clear());

  it('hay variantes con SKU para probar', () => expect(VARIANT_SKU).toBeTruthy());

  it.each(['reflector', 'luminaria vial', 'alumbrado publico', 'galpon', 'cancha', '2700K', 'IP 65', VARIANT_SKU, 'proyectr'])(
    '«%s» muestra resultados',
    q => {
      const expected = searchProducts(products, q).length;
      expect(expected).toBeGreaterThan(0);
      renderAt(`/buscar?q=${encodeURIComponent(q)}`);
      expect(screen.getByRole('status')).toHaveTextContent(`${expected} resultado${expected === 1 ? '' : 's'} para «${q}»`);
      expect(screen.queryByRole('heading', { name: '¿No lo encuentras? Te lo buscamos' })).toBeNull();
    },
  );
});

describe('/buscar: accesibilidad', () => {
  beforeEach(() => sessionStorage.clear());

  it('el campo y el botón para borrar tienen nombre; una sola región viva, vacía sin búsqueda', () => {
    renderAt('/buscar');
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: NONSENSE } });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(`No encontramos productos para «${NONSENSE}».`);
    fireEvent.click(screen.getByRole('button', { name: 'Borrar búsqueda' }));
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toHaveFocus();
  });
});

describe('/buscar: sin resultados (B-04)', () => {
  beforeEach(() => sessionStorage.clear());

  it('ofrece el correo prellenado a ventas, la asesoría técnica y hasta 3 sugerencias; sin WhatsApp ni stock', () => {
    renderAt(`/buscar?q=${encodeURIComponent(`galpón ${NONSENSE}`)}`);
    const section = screen.getByRole('region', { name: '¿No lo encuentras? Te lo buscamos' });

    const mail = within(section).getByRole('link', { name: /ventas@elights\.cl/ });
    const href = mail.getAttribute('href')!;
    expect(href.startsWith('mailto:ventas@elights.cl?')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('subject')).toBe(`Busco: galpón ${NONSENSE}`);
    expect(params.get('body')).toContain(`busco: galpón ${NONSENSE}`);

    const advisory = within(section).getByRole('link', { name: new RegExp(`^${ADVISORY_LINK.label}`) });
    expect(advisory).toHaveAttribute('href', ADVISORY_LINK.to);

    const chips = within(section).getAllByRole('button');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips[0]).toHaveTextContent('campana'); // por sinónimo de «galpón»
    for (const chip of chips) expect(searchProducts(products, chip.textContent!).length).toBeGreaterThan(0);

    expect(section.innerHTML).not.toMatch(/wa\.me|whatsapp/i);
    expect(section.textContent).not.toMatch(/stock/i);
  });

  it('«0» ya no trae todo el catálogo: muestra la salida', () => {
    renderAt('/buscar?q=0');
    expect(screen.getByRole('region', { name: '¿No lo encuentras? Te lo buscamos' })).toBeInTheDocument();
  });

  it('una sugerencia busca al hacer clic, y el foco vuelve al campo', () => {
    renderAt(`/buscar?q=${encodeURIComponent(`cancha ${NONSENSE}`)}`);
    const section = screen.getByRole('region', { name: '¿No lo encuentras? Te lo buscamos' });
    const chip = within(section).getByRole('button', { name: 'proyector de estadio' });
    fireEvent.click(chip);
    const expected = searchProducts(products, 'proyector de estadio').length;
    expect(screen.getByRole('status')).toHaveTextContent(`${expected} resultado${expected === 1 ? '' : 's'} para «proyector de estadio»`);
    expect(screen.getByDisplayValue('proyector de estadio')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toHaveFocus();
  });

  it('las sugerencias conservan las tildes de lo que escribió el cliente', () => {
    renderAt(`/buscar?q=${encodeURIComponent('señalética xyzzy')}`);
    const section = screen.getByRole('region', { name: '¿No lo encuentras? Te lo buscamos' });
    expect(within(section).getAllByRole('button')[0]).toHaveTextContent('señalética');
  });

  it('un emoji en el corte del correo no deja la página en blanco', () => {
    const q = 'a'.repeat(119) + '😀';
    renderAt(`/buscar?q=${encodeURIComponent(q)}`);
    const section = screen.getByRole('region', { name: '¿No lo encuentras? Te lo buscamos' });
    expect(within(section).getByRole('link', { name: /ventas@elights\.cl/ }).getAttribute('href')).toMatch(/^mailto:ventas@elights\.cl\?/);
  });
});
