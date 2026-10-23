// src/pages/CatalogPage.kelvin.test.tsx
// Filtro de temperatura de color del catálogo (auditoría UX, B-05), con la app completa:
// opciones desde las variantes y con su conteo, «alguna variante la tiene», y ?k=2700 en la URL
// para las campañas («alumbrado público 2700K»). Reglas, no conteos: el catálogo cambia con
// cada sincronización de Jumpseller.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import App from '@/App';
import { sendPageView } from '@/lib/analytics';
import { products, type Product } from '@/data/products';
import { preloadRoute } from '@/routes';

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  sendPageView: vi.fn(),
}));

function renderAt(url: string) {
  window.history.pushState({}, '', url);
  return render(<HelmetProvider><App /></HelmetProvider>);
}

const WAIT = { timeout: 5000 };
const inCategory = (slug: string) => products.filter(p => p.categories.includes(slug));
const withKelvin = (list: readonly Product[], ...kelvins: number[]) => list.filter(p => p.kelvins.some(k => kelvins.includes(k)));
/** Temperaturas que existen en una lista, de menor a mayor (las pruebas las sacan de los datos, no fijas). */
const kelvinsOf = (list: readonly Product[]) => [...new Set(list.flatMap(p => p.kelvins))].sort((a, b) => a - b);
const found = (n: number) => `${n} producto${n !== 1 ? 's' : ''} encontrado${n !== 1 ? 's' : ''}`;
/**
 * Opciones de temperatura del panel de escritorio: «2700K» → su casilla y su conteo. Recorre el DOM
 * en vez de getAllByRole: con la grilla completa, cada consulta por rol tarda cientos de ms.
 */
function kelvinPanel(): Map<number, { box: HTMLInputElement; count: number }> {
  const title = [...document.querySelectorAll('aside p')].find(p => p.textContent === 'Temperatura de color');
  const labels = title ? [...title.parentElement!.querySelectorAll('label')] : [];
  return new Map(
    labels.map(label => [
      Number(/^(\d+)K$/.exec(label.querySelector('span')!.textContent!)![1]),
      { box: label.querySelector('input')!, count: Number(label.lastElementChild!.textContent) },
    ]),
  );
}
const kelvinBox = (k: number) => kelvinPanel().get(k)?.box;

describe('catálogo: temperatura de color desde las variantes (B-05)', () => {
  // La página del catálogo se carga aparte (ruta lazy): una vez antes, para que la primera prueba
  // no pague la carga con la suite en paralelo.
  beforeAll(() => preloadRoute('/catalogo/alumbrado-publico'), 30_000);
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(sendPageView).mockClear();
  });

  it('en alumbrado público, las opciones salen de los datos, con su conteo y sin las que dan 0', async () => {
    const lighting = inCategory('alumbrado-publico');
    renderAt('/catalogo/alumbrado-publico');
    await screen.findByText(found(lighting.length), undefined, WAIT);
    const inData = [...new Set(lighting.flatMap(p => p.kelvins))].sort((a, b) => a - b);
    expect(inData.length).toBeGreaterThan(0);
    const panel = kelvinPanel();
    // Exactamente las temperaturas de los datos, de menor a mayor: ninguna opción fija que dé 0
    // (antes: 3000K, 4000K, 5000K, 5700K y 6500K, todas en 0 en esta categoría)
    expect([...panel.keys()]).toEqual(inData);
    for (const k of inData) expect(panel.get(k)!.count, `${k}K`).toBe(withKelvin(lighting, k).length);
    // 2200K y 2700K aparecen solas si alguna variante las tiene
    for (const k of [2200, 2700]) if (withKelvin(lighting, k).length) expect(panel.has(k), `${k}K`).toBe(true);
  });

  it('elegir una temperatura deja los productos con alguna variante en ella, sin enviar otro page_view ni perder el foco', async () => {
    const lighting = inCategory('alumbrado-publico');
    const [k] = kelvinsOf(lighting);
    expect(k).toBeDefined();
    renderAt('/catalogo/alumbrado-publico');
    await screen.findByText(found(lighting.length), undefined, WAIT);
    vi.mocked(sendPageView).mockClear();
    const box = kelvinBox(k)!;
    box.focus();
    fireEvent.click(box);
    await screen.findByText(found(withKelvin(lighting, k).length), undefined, WAIT);
    await new Promise(r => setTimeout(r, 50));
    expect(sendPageView).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    // El panel no se vuelve a montar con cada clic: la misma casilla, con el foco (B-07)
    expect(box.isConnected).toBe(true);
    expect(document.activeElement).toBe(box);
  });

  it('?k (enlace de campaña, como ?k=2700) llega con el filtro puesto y se mantiene en la URL', async () => {
    const lighting = inCategory('alumbrado-publico');
    const [k] = kelvinsOf(lighting);
    expect(k).toBeDefined();
    renderAt(`/catalogo/alumbrado-publico?k=${k}&gclid=abc`);
    await screen.findByText(found(withKelvin(lighting, k).length), undefined, WAIT);
    expect(kelvinBox(k)!.checked).toBe(true);
    expect(new URLSearchParams(window.location.search).get('k')).toBe(String(k));
  });

  it('?k con dos temperaturas suma las dos; si el visitante cambia la temperatura, manda su elección y ?k sale de la URL', async () => {
    const lighting = inCategory('alumbrado-publico');
    const [k1, k2] = kelvinsOf(lighting);
    expect(k2).toBeDefined();
    renderAt(`/catalogo/alumbrado-publico?k=${k1},${k2}`);
    await screen.findByText(found(withKelvin(lighting, k1, k2).length), undefined, WAIT);
    fireEvent.click(kelvinBox(k1)!); // queda solo k2
    await screen.findByText(found(withKelvin(lighting, k2).length), undefined, WAIT);
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('k')).toBe(false), WAIT);
    expect(kelvinBox(k2)!.checked).toBe(true);
  });

  it('?k con la página 2 → quitar la temperatura → Atrás: vuelve el filtro de la URL, con su casilla marcada', async () => {
    const k = kelvinsOf(products).find(x => withKelvin(products, x).length > 24);
    expect(k).toBeDefined();
    const filtered = withKelvin(products, k!).length;
    renderAt(`/catalogo?k=${k}`);
    await screen.findByText(found(filtered), undefined, WAIT);
    fireEvent.click(document.querySelector<HTMLAnchorElement>('a[rel="next"]')!); // página 2 (una entrada nueva)
    await screen.findByText(/Mostrando 25–/, undefined, WAIT);
    expect(new URLSearchParams(window.location.search).get('k')).toBe(String(k));
    fireEvent.click(kelvinBox(k!)!); // la quita: ?k y ?page salen de la URL
    await screen.findByText(found(products.length), undefined, WAIT);
    await waitFor(() => expect(window.location.search).toBe(''), WAIT);
    vi.mocked(sendPageView).mockClear();
    await act(async () => {
      window.history.back();
      await new Promise(r => setTimeout(r, 50));
    });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('k')).toBe(String(k)), WAIT);
    await screen.findByText(found(filtered), undefined, WAIT);
    expect(kelvinBox(k!)!.checked).toBe(true);
    // El page_view de la entrada con ?k coincide con lo que se ve
    expect(sendPageView).toHaveBeenLastCalledWith(`/catalogo?k=${k}`);
    // Y quitarla de nuevo funciona
    fireEvent.click(kelvinBox(k!)!);
    await screen.findByText(found(products.length), undefined, WAIT);
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('k')).toBe(false), WAIT);
  });

  it('?k con la página 2: el enlace directo se respeta', async () => {
    const all = products;
    const k = kelvinsOf(all).find(x => withKelvin(all, x).length > 24);
    expect(k).toBeDefined();
    renderAt(`/catalogo?k=${k}&page=2`);
    await screen.findByText(/Mostrando 25–/, undefined, WAIT);
    expect(screen.getByText(found(withKelvin(all, k).length))).toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.get('page')).toBe('2');
    expect(params.get('k')).toBe(String(k));
  });

  it('una ?k que no es temperatura se ignora', async () => {
    const lighting = inCategory('alumbrado-publico');
    renderAt('/catalogo/alumbrado-publico?k=abc');
    await screen.findByText(found(lighting.length), undefined, WAIT);
  });
});
