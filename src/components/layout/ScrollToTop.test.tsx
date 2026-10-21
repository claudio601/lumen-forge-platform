// ScrollToTop (auditoría UX, B-01): una página que se abre con un enlace (PUSH) empieza arriba;
// Atrás y Adelante (POP) conservan el punto, y tampoco suben las redirecciones (REPLACE), los
// cambios de ?search (paginación y filtros del catálogo) ni la primera carga.

import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';

let go: NavigateFunction;
let path = '';

function Probe() {
  go = useNavigate();
  const { pathname, search, hash } = useLocation();
  path = pathname + search + hash;
  return <div id="solicitar">ancla</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ScrollToTop />
      <Probe />
    </MemoryRouter>,
  );
}

const originalScrollIntoView = Element.prototype.scrollIntoView;
let scrollTo: MockInstance<typeof window.scrollTo>;
let scrollIntoView: Mock;
beforeEach(() => {
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe('ScrollToTop', () => {
  it('la primera carga no mueve la página (el navegador restaura su punto)', () => {
    renderAt('/catalogo/alumbrado-publico');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('PUSH a otra página (listado → ficha): arriba', () => {
    renderAt('/catalogo/alumbrado-publico');
    act(() => go('/producto/bestled-60w'));
    expect(path).toBe('/producto/bestled-60w');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('POP (Atrás y Adelante): conserva el punto del listado y de la ficha', () => {
    renderAt('/catalogo/alumbrado-publico');
    act(() => go('/producto/bestled-60w'));
    scrollTo.mockClear();
    act(() => go(-1));
    expect(path).toBe('/catalogo/alumbrado-publico');
    act(() => go(1));
    expect(path).toBe('/producto/bestled-60w');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('REPLACE (redirecciones como /carro o un id renombrado): no sube', () => {
    renderAt('/carro');
    act(() => go('/solicitar-pedido', { replace: true }));
    expect(path).toBe('/solicitar-pedido');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('mismo pathname con otro ?search (paginación, filtros, búsqueda): no sube', () => {
    renderAt('/catalogo/proyectores-led');
    act(() => go('/catalogo/proyectores-led?page=2'));
    act(() => go({ search: '?page=3' }));
    act(() => go('/buscar?q=panel'));
    scrollTo.mockClear();
    act(() => go('/buscar?q=proyector'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('PUSH con #ancla: va al ancla si está dibujada; si no, arriba', () => {
    renderAt('/');
    act(() => go('/estudio-luminico#solicitar'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => go('/instalacion#no-existe'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
