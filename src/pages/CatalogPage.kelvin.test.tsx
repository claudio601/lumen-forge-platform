// src/pages/CatalogPage.kelvin.test.tsx
// Filtro de temperatura de color del catálogo (auditoría UX, B-05), con la app completa:
// opciones desde las variantes y con su conteo, «alguna variante la tiene», y ?k=2700 en la URL
// para las campañas («alumbrado público 2700K»). Reglas, no conteos: el catálogo cambia con
// cada sincronización de Jumpseller.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('elegir una temperatura deja los productos con alguna variante en ella, sin enviar otro page_view', async () => {
    const lighting = inCategory('alumbrado-publico');
    const k = [...new Set(lighting.flatMap(p => p.kelvins))].sort((a, b) => a - b)[0];
    renderAt('/catalogo/alumbrado-publico');
    await screen.findByText(found(lighting.length), undefined, WAIT);
    vi.mocked(sendPageView).mockClear();
    fireEvent.click(kelvinBox(k)!);
    await screen.findByText(found(withKelvin(lighting, k).length), undefined, WAIT);
    await new Promise(r => setTimeout(r, 50));
    expect(sendPageView).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('?k=2700 (enlace de campaña) llega con el filtro puesto y se mantiene en la URL', async () => {
    const lighting = inCategory('alumbrado-publico');
    const expected = withKelvin(lighting, 2700);
    if (!expected.length) return; // ninguna variante en 2700K: no hay qué filtrar
    renderAt('/catalogo/alumbrado-publico?k=2700&gclid=abc');
    await screen.findByText(found(expected.length), undefined, WAIT);
    expect(kelvinBox(2700)!.checked).toBe(true);
    expect(new URLSearchParams(window.location.search).get('k')).toBe('2700');
  });

  it('?k=2200,2700 suma las dos; si el visitante cambia la temperatura, manda su elección y ?k sale de la URL', async () => {
    const lighting = inCategory('alumbrado-publico');
    if (!withKelvin(lighting, 2200).length || !withKelvin(lighting, 2700).length) return;
    renderAt('/catalogo/alumbrado-publico?k=2200,2700');
    await screen.findByText(found(withKelvin(lighting, 2200, 2700).length), undefined, WAIT);
    fireEvent.click(kelvinBox(2200)!); // queda solo 2700K
    await screen.findByText(found(withKelvin(lighting, 2700).length), undefined, WAIT);
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('k')).toBe(false), WAIT);
    expect(kelvinBox(2700)!.checked).toBe(true);
  });

  it('?k con la página 2: el enlace directo se respeta', async () => {
    const all = products;
    const kelvins = [...new Set(all.flatMap(p => p.kelvins))];
    const k = kelvins.find(x => withKelvin(all, x).length > 24);
    if (!k) return;
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
