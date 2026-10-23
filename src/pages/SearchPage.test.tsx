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

describe('/buscar: búsqueda tolerante (B-03)', () => {
  beforeEach(() => sessionStorage.clear());

  it.each(['reflector', 'luminaria vial', 'alumbrado publico', 'galpon', 'cancha', '2700K', 'IP 65', 'APB601', 'proyectr'])(
    '«%s» muestra resultados',
    q => {
      const expected = searchProducts(products, q).length;
      expect(expected).toBeGreaterThan(0);
      renderAt(`/buscar?q=${encodeURIComponent(q)}`);
      expect(screen.getByText(`${expected} resultado${expected === 1 ? '' : 's'} para «${q}»`)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '¿No lo encuentras? Te lo buscamos' })).toBeNull();
    },
  );
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

  it('una sugerencia busca al hacer clic', () => {
    renderAt(`/buscar?q=${encodeURIComponent(`cancha ${NONSENSE}`)}`);
    const section = screen.getByRole('region', { name: '¿No lo encuentras? Te lo buscamos' });
    const chip = within(section).getByRole('button', { name: 'proyector de estadio' });
    fireEvent.click(chip);
    const expected = searchProducts(products, 'proyector de estadio').length;
    expect(screen.getByText(`${expected} resultado${expected === 1 ? '' : 's'} para «proyector de estadio»`)).toBeInTheDocument();
    expect(screen.getByDisplayValue('proyector de estadio')).toBeInTheDocument();
  });
});
