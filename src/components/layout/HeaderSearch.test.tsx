// Buscador del encabezado con sugerencias al escribir (pedido del dueño, 2026-10-24). Corre contra
// el catálogo real, que cambia con cada sincronización de Jumpseller: las pruebas comparan con lo
// que devuelve la búsqueda del sitio (searchProducts), no con conteos fijos.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { products } from '@/data/products';
import { clp } from '@/config/business';
import { trackSearch } from '@/lib/analytics';
import { searchProducts } from '@/lib/productSearch';
import { isHeaderMeasured } from '@/lib/searchTracking';
import { variantFromPrice } from '@/lib/variants';
import SearchPage from '@/pages/SearchPage';
import HeaderSearch from './HeaderSearch';

// Se espía trackSearch; el envío real (consentimiento, dominios) lo prueba src/lib/analytics.test.ts.
vi.mock('@/lib/analytics', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackSearch: vi.fn(),
}));
// La medición espera que el texto quede quieto: aquí 50 ms en vez de 1 s.
vi.mock('@/lib/searchTracking', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/searchTracking')>()),
  SEARCH_SETTLE_MS: 50,
}));

const NONSENSE = 'zzqxwv';
const WAIT = { timeout: 3000 };

let location = { pathname: '', search: '', state: null as unknown };
function Probe() {
  const { pathname, search, state } = useLocation();
  location = { pathname, search, state };
  return null;
}

function renderAt(url = '/catalogo') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <AppProvider>
          <RequestCartProvider>
            <HeaderSearch />
            <Routes>
              <Route path="/buscar" element={<SearchPage />} />
              <Route path="*" element={null} />
            </Routes>
            <Probe />
          </RequestCartProvider>
        </AppProvider>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

const box = () => screen.getByRole('combobox', { name: 'Buscar productos' }) as HTMLInputElement;
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const options = () => screen.queryAllByRole('option');
const key = (k: string) => fireEvent.keyDown(box(), { key: k });

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(trackSearch).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('encabezado: sugerencias al escribir', () => {
  it('desde 2 caracteres: hasta 6 productos, en el orden de la búsqueda, y «Ver los N resultados»', async () => {
    renderAt();
    fireEvent.focus(box());
    type('p');
    await act(async () => {});
    expect(options()).toHaveLength(0);
    expect(box()).toHaveAttribute('aria-expanded', 'false');

    type('proyector');
    const expected = searchProducts(products, 'proyector');
    expect(expected.length).toBeGreaterThan(6);
    await waitFor(() => expect(options()).toHaveLength(7), WAIT);
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    const rows = options();
    // toHaveTextContent junta los espacios del texto: el nombre esperado también
    expected.slice(0, 6).forEach((p, i) => expect(rows[i]).toHaveTextContent(p.name.replace(/\s+/g, ' ').trim()));
    expect(rows[6]).toHaveTextContent(`Ver los ${expected.length} resultados para «proyector»`);
    expect(screen.getByRole('status')).toHaveTextContent(`${expected.length} resultados`);
  });

  it('cada fila: lo escrito en negrita, el SKU y el precio con IVA («desde» si las variantes cuestan distinto)', async () => {
    renderAt();
    type('proyector');
    await waitFor(() => expect(options().length).toBeGreaterThan(1), WAIT);
    const [first] = searchProducts(products, 'proyector');
    const row = options()[0];
    expect(within(row).getAllByText(/^proyector$/i)[0].tagName).toBe('STRONG');
    if (first.sku) expect(row).toHaveTextContent(first.sku);
    const from = variantFromPrice(first);
    expect(row).toHaveTextContent(`${from !== undefined ? 'desde' : ''}${clp(from ?? first.price)}c/IVA`);
  });

  it('flechas y Enter: abre la ficha del producto marcado y la caja queda vacía', async () => {
    renderAt();
    type('panel');
    await waitFor(() => expect(options().length).toBeGreaterThan(2), WAIT);
    key('ArrowDown');
    key('ArrowDown');
    const second = options()[1];
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(box()).toHaveAttribute('aria-activedescendant', second.id);
    key('Enter');
    expect(location.pathname).toBe(`/producto/${searchProducts(products, 'panel')[1].id}`);
    expect(box()).toHaveValue('');
    expect(options()).toHaveLength(0);
  });

  it('flecha arriba marca la última fila, «Ver los N resultados», que abre /buscar', async () => {
    renderAt();
    type('campana');
    await waitFor(() => expect(options().length).toBeGreaterThan(1), WAIT);
    key('ArrowUp');
    expect(options().at(-1)).toHaveAttribute('aria-selected', 'true');
    key('Enter');
    expect(location.pathname + location.search).toBe('/buscar?q=campana');
  });

  it('Enter sin fila marcada busca en /buscar, como antes', async () => {
    renderAt();
    type('reflector led');
    await waitFor(() => expect(options().length).toBeGreaterThan(0), WAIT);
    fireEvent.submit(box().closest('form')!);
    expect(location.pathname + location.search).toBe('/buscar?q=reflector%20led');
  });

  it('con el mouse: clic en una fila abre la ficha', async () => {
    renderAt();
    type('tubo');
    await waitFor(() => expect(options().length).toBeGreaterThan(1), WAIT);
    const row = options()[0];
    // mousedown no le quita el foco a la caja (si no, la lista se cerraría antes del clic)
    expect(fireEvent.mouseDown(row)).toBe(false);
    fireEvent.click(row);
    expect(location.pathname).toBe(`/producto/${searchProducts(products, 'tubo')[0].id}`);
  });

  it('el mouse solo resalta: Enter sin fila marcada con las flechas busca en /buscar', async () => {
    renderAt();
    type('proyector');
    await waitFor(() => expect(options().length).toBeGreaterThan(2), WAIT);
    fireEvent.mouseEnter(options()[1]);
    expect(options()[1]).toHaveAttribute('aria-selected', 'false');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
    key('Enter');
    fireEvent.submit(box().closest('form')!);
    expect(location.pathname + location.search).toBe('/buscar?q=proyector');
  });

  it('salir de la caja desmarca la fila: al volver, Enter busca lo escrito', async () => {
    renderAt();
    type('panel');
    await waitFor(() => expect(options().length).toBeGreaterThan(2), WAIT);
    key('ArrowDown');
    key('ArrowDown');
    fireEvent.blur(box());
    fireEvent.focus(box());
    expect(options().some(o => o.getAttribute('aria-selected') === 'true')).toBe(false);
    expect(box()).not.toHaveAttribute('aria-activedescendant');
  });

  it('la lista no es una parada de Tab (tabIndex -1)', async () => {
    renderAt();
    type('panel');
    await waitFor(() => expect(options().length).toBeGreaterThan(0), WAIT);
    expect(screen.getByRole('listbox')).toHaveAttribute('tabindex', '-1');
  });

  it('Escape cierra la lista; otra vez, borra el texto', async () => {
    renderAt();
    type('panel');
    await waitFor(() => expect(options().length).toBeGreaterThan(0), WAIT);
    key('Escape');
    expect(options()).toHaveLength(0);
    expect(box()).toHaveValue('panel');
    key('Escape');
    expect(box()).toHaveValue('');
  });

  it('salir de la caja cierra la lista; volver a entrar la abre', async () => {
    renderAt();
    type('panel');
    await waitFor(() => expect(options().length).toBeGreaterThan(0), WAIT);
    fireEvent.blur(box());
    expect(options()).toHaveLength(0);
    fireEvent.focus(box());
    expect(options().length).toBeGreaterThan(0);
  });

  it('sin resultados: una fila que lleva a /buscar, con el correo a ventas', async () => {
    renderAt();
    type(NONSENSE);
    await waitFor(() => expect(options()).toHaveLength(1), WAIT);
    expect(options()[0]).toHaveTextContent(`No encontramos productos para «${NONSENSE}». Ver otras opciones`);
    fireEvent.click(options()[0]);
    expect(location.pathname + location.search).toBe(`/buscar?q=${NONSENSE}`);
  });
});

describe('encabezado: medición de la búsqueda (search, KPI 9)', () => {
  it('una vez cuando el texto queda quieto, con sus resultados y la página donde se buscó', async () => {
    renderAt('/catalogo/paneles-led');
    for (const partial of ['pa', 'pan', 'panel']) type(partial);
    await waitFor(() => expect(trackSearch).toHaveBeenCalledTimes(1), WAIT);
    expect(trackSearch).toHaveBeenCalledWith(searchProducts(products, 'panel').length, '/catalogo/paneles-led');
    // La misma búsqueda otra vez en la misma página no se cuenta de nuevo
    type('Panel ');
    await new Promise(r => setTimeout(r, 120));
    expect(trackSearch).toHaveBeenCalledTimes(1);
  });

  it('elegir un producto antes de que el texto quede quieto también la cuenta, una vez', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderAt();
    type('campana');
    await vi.waitFor(() => expect(options().length).toBeGreaterThan(1));
    fireEvent.click(options()[0]);
    expect(trackSearch).toHaveBeenCalledTimes(1);
    expect(trackSearch).toHaveBeenCalledWith(searchProducts(products, 'campana').length, '/catalogo');
    vi.advanceTimersByTime(1000);
    expect(trackSearch).toHaveBeenCalledTimes(1);
  });

  it('ya medida, /buscar con la misma búsqueda no la cuenta otra vez; si se cambia, sí', async () => {
    renderAt();
    type('reflector');
    await waitFor(() => expect(trackSearch).toHaveBeenCalledTimes(1), WAIT);
    fireEvent.submit(box().closest('form')!);
    expect(location.pathname + location.search).toBe('/buscar?q=reflector');
    expect(isHeaderMeasured(location.state)).toBe(true);
    await new Promise(r => setTimeout(r, 150));
    expect(trackSearch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'reflector 100w' } });
    await waitFor(() => expect(trackSearch).toHaveBeenCalledTimes(2), WAIT);
    expect(vi.mocked(trackSearch).mock.calls[1]).toEqual([searchProducts(products, 'reflector 100w').length, '/buscar']);
  });

  it('ya contada en esta página (/buscar), el encabezado no la cuenta y /buscar sí, como búsqueda nueva', async () => {
    renderAt('/buscar?q=panel');
    await waitFor(() => expect(trackSearch).toHaveBeenCalledTimes(1), WAIT);
    type('panel');
    await new Promise(r => setTimeout(r, 150));
    expect(trackSearch).toHaveBeenCalledTimes(1);
    fireEvent.submit(box().closest('form')!);
    expect(isHeaderMeasured(location.state)).toBe(false);
    await waitFor(() => expect(trackSearch).toHaveBeenCalledTimes(2), WAIT);
  });

  it('sin medir todavía (Enter enseguida), /buscar la cuenta como siempre', async () => {
    renderAt();
    type('reflector');
    fireEvent.submit(box().closest('form')!);
    expect(isHeaderMeasured(location.state)).toBe(false);
    await waitFor(() => expect(trackSearch).toHaveBeenCalledTimes(1), WAIT);
    expect(trackSearch).toHaveBeenCalledWith(searchProducts(products, 'reflector').length, '/buscar');
  });
});
