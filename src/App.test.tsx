import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import { sendPageView } from '@/lib/analytics';

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  sendPageView: vi.fn(),
}));
import { categories } from '@/data/products';

function renderAt(url: string) {
  window.history.pushState({}, '', url);
  return render(<HelmetProvider><App /></HelmetProvider>);
}

// Navegación del navegador (menú, Atrás) sin recargar: BrowserRouter escucha popstate.
function navigate(url: string) {
  act(() => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

const count = (slug: string) => categories.find(c => c.slug === slug)!.productCount;
const WAIT = { timeout: 5000 };

describe('rutas: modelo cotización → link de pago', () => {
  beforeEach(() => sessionStorage.clear());

  it('/carro redirige a /solicitar-pedido', async () => {
    renderAt('/carro');
    await waitFor(() => expect(window.location.pathname).toBe('/solicitar-pedido'), WAIT);
  });
});

describe('rutas: ids de producto renombrados (PR 07)', () => {
  beforeEach(() => sessionStorage.clear());
  const NF3 = '/producto/campana-led-ufo-nf3-150w-150-lm-w-ip66'; // antes /producto/w-ip66

  it('un enlace con el id viejo lleva a la ficha con el id vigente y conserva la consulta', async () => {
    renderAt('/producto/w-ip66?gclid=x');
    await waitFor(() => expect(window.location.pathname).toBe(NF3), WAIT);
    expect(window.location.search).toBe('?gclid=x');
    expect(await screen.findByRole('heading', { level: 1, name: /CAMPANA LED UFO NF3 150W/ }, WAIT)).toBeInTheDocument();
  });

  it('navegar dentro de la app a un id viejo (Atrás, enlace guardado) también llega a la ficha vigente', async () => {
    renderAt('/catalogo');
    navigate('/producto/control-remoto');
    await waitFor(() => expect(window.location.pathname).toBe('/producto/alumbrado-publico-led-solar-150w-all-in-one-c-control-remoto'), WAIT);
    expect(await screen.findByRole('heading', { level: 1, name: /ALUMBRADO/i }, WAIT)).toBeInTheDocument();
  });
});

describe('catálogo: la categoría sigue a la URL', () => {
  beforeEach(() => sessionStorage.clear());

  it('pasar de Paneles LED a Proyectores LED muestra solo proyectores', async () => {
    renderAt('/catalogo/paneles-led');
    await screen.findByText(`${count('paneles-led')} productos encontrados`, undefined, WAIT);
    navigate('/catalogo/proyectores-led');
    await screen.findByText(`${count('proyectores-led')} productos encontrados`, undefined, WAIT);
    const proyectores = screen.getByRole('checkbox', { name: /proyectores led/i }) as HTMLInputElement;
    const paneles = screen.getByRole('checkbox', { name: /paneles led/i }) as HTMLInputElement;
    expect(proyectores.checked).toBe(true);
    expect(paneles.checked).toBe(false);
  });

  it('un enlace directo a ?page=2 se mantiene en la página 2', async () => {
    renderAt('/catalogo/paneles-led?page=2');
    await screen.findByText(/Mostrando 25–48/, undefined, WAIT);
    expect(new URLSearchParams(window.location.search).get('page')).toBe('2');
  });
});

describe('catálogo: GA sin page_view falsos', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it.each([
    ['sin decisión de cookies', null],
    ['con la medición aceptada (decisión sembrada)', { analytics: true, ads: true, meta: true, origin: true }],
  ])('cambiar un filtro sin ?page no envía otro page_view (%s)', async (_, choice) => {
    if (choice) localStorage.setItem('elights_cookie_consent', JSON.stringify({ v: 2, at: new Date().toISOString(), ...choice }));
    renderAt('/catalogo/paneles-led');
    await screen.findByText(`${count('paneles-led')} productos encontrados`, undefined, WAIT);
    vi.mocked(sendPageView).mockClear();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'IP65' })[0]);
    await new Promise(r => setTimeout(r, 50));
    expect(sendPageView).not.toHaveBeenCalled();
  });
});

describe('aviso de cookies (PR 13)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it('fuera de elights.cl no aparece solo, nada carga Google ni Meta y el pie abre el panel informativo', async () => {
    renderAt('/');
    const footer = screen.getByRole('contentinfo');
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('region', { name: 'Aviso de cookies' })).toBeNull();
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(document.querySelector('script[src*="facebook"]')).toBeNull();
    fireEvent.click(within(footer).getByRole('button', { name: 'Configurar cookies' }));
    const dialog = await screen.findByRole('dialog', { name: 'Configurar cookies' }, WAIT);
    expect(dialog).toHaveTextContent('En esta dirección del sitio no usamos cookies, Google Analytics, medición de anuncios ni el píxel de Meta');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(localStorage.getItem('elights_cookie_consent')).toBeNull();
  });
});

// «Recordar mis datos» (especificación del 23-10-2026, §2 y §5): lo vencido se borra al abrir
// cualquier página, sin pasar por un formulario (Política §7). Lo vigente no se toca.
describe('recordar mis datos: limpieza al abrir el sitio', () => {
  const KEY = 'elights_contact';
  const DAY = 24 * 60 * 60 * 1000;
  const data = { nombre: 'PRUEBA - borrar', email: 'prueba-recordar@example.com', telefono: '+56 9 0000 0930' };
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it.each(['/', '/catalogo/paneles-led', '/empresa'])('en %s: lo vencido (más de 12 meses) se borra y lo vigente queda', async (url) => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, at: new Date(Date.now() - 366 * DAY).toISOString(), data }));
    const { unmount } = renderAt(url);
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull(), WAIT);
    unmount();
    const fresh = JSON.stringify({ v: 1, at: new Date(Date.now() - 30 * DAY).toISOString(), data });
    localStorage.setItem(KEY, fresh);
    renderAt(url);
    await screen.findAllByRole('contentinfo', undefined, WAIT);
    await new Promise(r => setTimeout(r, 50));
    expect(localStorage.getItem(KEY)).toBe(fresh);
  });

  it('un valor ilegible o de otra versión también se borra al abrir el sitio', async () => {
    localStorage.setItem(KEY, '{"v":1,"at":');
    const first = renderAt('/');
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull(), WAIT);
    first.unmount();
    localStorage.setItem(KEY, JSON.stringify({ v: 2, at: new Date().toISOString(), data }));
    renderAt('/');
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull(), WAIT);
  });
});

describe('catálogo: ?page inválido', () => {
  beforeEach(() => sessionStorage.clear());

  it('?page=abc muestra la página 1 y limpia la URL', async () => {
    renderAt('/catalogo/paneles-led?page=abc');
    await screen.findByText(/Mostrando 1–24/, undefined, WAIT);
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('page')).toBe(false), WAIT);
  });

  it('?page=99 muestra la última página y corrige la URL', async () => {
    const last = Math.ceil(count('paneles-led') / 24);
    renderAt('/catalogo/paneles-led?page=99');
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('page')).toBe(String(last)), WAIT);
  });
});

describe('búsqueda: sigue a ?q', () => {
  beforeEach(() => sessionStorage.clear());

  it('una búsqueda nueva estando en /buscar actualiza el campo', async () => {
    renderAt('/buscar?q=panel');
    const input = (await screen.findByDisplayValue('panel', undefined, WAIT)) as HTMLInputElement;
    navigate('/buscar?q=proyector');
    await waitFor(() => expect(input.value).toBe('proyector'), WAIT);
  });

  it('repetir desde el header la búsqueda actual restaura el campo aunque se haya editado', async () => {
    renderAt('/buscar?q=panel');
    const input = (await screen.findByDisplayValue('panel', undefined, WAIT)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'tubo' } });
    expect(input.value).toBe('tubo');
    // Buscar "panel" otra vez desde el header (misma URL, navegación nueva). Es el campo de
    // escritorio: en el teléfono el buscador se pliega en la lupa, que lleva a /buscar (A-02).
    const header = screen.getByPlaceholderText('Buscar por SKU, producto, watts, kelvin...');
    fireEvent.change(header, { target: { value: 'panel' } });
    fireEvent.submit(header.closest('form')!);
    await waitFor(() => expect(input.value).toBe('panel'), WAIT);
  });
});

// Auditoría UX, B-01 (entrega 3): una ficha abierta desde un listado empieza arriba; Atrás
// devuelve al punto del listado. La paginación sube a la grilla, también al volver a la 1.
describe('navegación: la ficha abre arriba y Atrás conserva el punto (B-01)', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('un enlace del listado a la ficha (PUSH) sube al tope; Atrás (POP) no mueve la página', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderAt('/catalogo/paneles-led');
    await screen.findByText(`${count('paneles-led')} productos encontrados`, undefined, WAIT);
    expect(scrollTo).not.toHaveBeenCalled(); // la primera carga no se toca
    const cards = within(screen.getByRole('main')).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/producto/'));
    const card = cards[cards.length - 1]; // la última tarjeta, la del caso medido
    fireEvent.click(card);
    await waitFor(() => expect(window.location.pathname).toBe(card.getAttribute('href')), WAIT);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    navigate('/catalogo/paneles-led'); // popstate: Atrás
    await screen.findByText(`${count('paneles-led')} productos encontrados`, undefined, WAIT);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('paginación: no se mueve al llegar a ?page=2; sube a la grilla al ir a la 1 y al volver a la 2', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderAt('/catalogo/paneles-led?page=2');
    await screen.findByText(/Mostrando 25–48/, undefined, WAIT);
    expect(scrollIntoView).not.toHaveBeenCalled(); // enlace directo o Atrás: se conserva el punto
    fireEvent.click(screen.getByRole('link', { name: '1' }));
    await screen.findByText(/Mostrando 1–24/, undefined, WAIT);
    expect(scrollIntoView).toHaveBeenCalledTimes(1); // antes, volver a la 1 no subía
    fireEvent.click(screen.getByRole('link', { name: '2' }));
    await screen.findByText(/Mostrando 25–48/, undefined, WAIT);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollTo).not.toHaveBeenCalled(); // mismo pathname: ScrollToTop no interviene
  });

  it('Atrás y Adelante entre páginas de la misma categoría (POP) no suben a la grilla', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderAt('/catalogo/paneles-led');
    await screen.findByText(/Mostrando 1–24/, undefined, WAIT);
    fireEvent.click(screen.getByRole('link', { name: '2' })); // PUSH: sube a la grilla
    await screen.findByText(/Mostrando 25–48/, undefined, WAIT);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    navigate('/catalogo/paneles-led'); // popstate: Atrás, a la página 1
    await screen.findByText(/Mostrando 1–24/, undefined, WAIT);
    navigate('/catalogo/paneles-led?page=2'); // popstate: Adelante, a la página 2
    await screen.findByText(/Mostrando 25–48/, undefined, WAIT);
    await new Promise(r => setTimeout(r, 50));
    // El navegador devuelve al punto donde estaba el visitante: nadie compite con él.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('la corrección de un ?page inválido (REPLACE) no mueve la pantalla', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const last = Math.ceil(count('paneles-led') / 24);
    renderAt('/catalogo/paneles-led?page=99');
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('page')).toBe(String(last)), WAIT);
    await new Promise(r => setTimeout(r, 50));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
