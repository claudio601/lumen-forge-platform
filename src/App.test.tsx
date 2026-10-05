import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
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
  beforeEach(() => sessionStorage.clear());

  it('cambiar un filtro sin ?page no envía otro page_view', async () => {
    renderAt('/catalogo/paneles-led');
    await screen.findByText(`${count('paneles-led')} productos encontrados`, undefined, WAIT);
    vi.mocked(sendPageView).mockClear();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'IP65' })[0]);
    await new Promise(r => setTimeout(r, 50));
    expect(sendPageView).not.toHaveBeenCalled();
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
    // Buscar "panel" otra vez desde el header (misma URL, navegación nueva).
    const header = screen.getByPlaceholderText('Buscar productos...');
    fireEvent.change(header, { target: { value: 'panel' } });
    fireEvent.submit(header.closest('form')!);
    await waitFor(() => expect(input.value).toBe('panel'), WAIT);
  });
});
