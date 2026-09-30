import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
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

describe('búsqueda: sigue a ?q', () => {
  beforeEach(() => sessionStorage.clear());

  it('una búsqueda nueva estando en /buscar actualiza el campo', async () => {
    renderAt('/buscar?q=panel');
    const input = (await screen.findByDisplayValue('panel', undefined, WAIT)) as HTMLInputElement;
    navigate('/buscar?q=proyector');
    await waitFor(() => expect(input.value).toBe('proyector'), WAIT);
  });
});
