// Encabezado (auditoría UX, entrega 3):
// - F-04: las puertas «Cotización (n)» y «Pedido (n)» con palabras, siempre visibles, también en 0.
// - B-02: el menú del teléfono es un panel (diálogo) con las acciones clave antes de las
//   categorías; se cierra con Escape y devuelve el foco al botón del menú.
// - A-02: la estructura que deja el encabezado fijo del teléfono en ~100 px (jsdom no mide:
//   la altura se midió en el navegador a 375×812, de 191 a 101 px).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { products } from '@/data/products';
import { categories } from '@/data/catalog/categories.config';
import { ADVISORY_LINK } from '@/config/navigation';
import { sendEvent } from '@/lib/analytics';
import Header from './Header';

vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn() }));

let currentPath = '';
function PathProbe() {
  currentPath = useLocation().pathname;
  return null;
}

function renderHeader(url = '/') {
  return render(
    <AppProvider>
      <RequestCartProvider>
        <MemoryRouter initialEntries={[url]}>
          <Header />
          <PathProbe />
        </MemoryRouter>
      </RequestCartProvider>
    </AppProvider>,
  );
}

/** 3 unidades en la cotización y 2 + 5 en la solicitud de pedido. */
function seedLists() {
  const [a, b] = products;
  sessionStorage.setItem('elights_quote', JSON.stringify([{ product: a, quantity: 3 }]));
  sessionStorage.setItem(
    'elights_request_cart',
    JSON.stringify([
      { productId: a.id, sku: a.sku || 'A', name: a.name, quantity: 2, unitPrice: a.price, priceMode: 'iva', url: `/producto/${a.id}`, attributes: {} },
      { productId: b.id, sku: b.sku || 'B', name: b.name, quantity: 5, unitPrice: b.price, priceMode: 'iva', url: `/producto/${b.id}`, attributes: {} },
    ]),
  );
}

const startsWith = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
  return screen.getByRole('dialog', { name: 'Menú' });
};

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(sendEvent).mockClear();
});

describe('encabezado: puertas «Cotización (n)» y «Pedido (n)» (F-04)', () => {
  it('se ven en 0, con palabras, cada una a su página', () => {
    renderHeader();
    const doors = screen.getByRole('navigation', { name: 'Tus listas' });
    const links = within(doors).getAllByRole('link');
    expect(links.map(a => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Cotización (0)', '/cotizacion'],
      ['Pedido (0)', '/solicitar-pedido'],
    ]);
  });

  it('cuentan las unidades de cada lista por separado', async () => {
    seedLists();
    renderHeader();
    const doors = screen.getByRole('navigation', { name: 'Tus listas' });
    expect(await within(doors).findByRole('link', { name: 'Cotización (3)' })).toHaveAttribute('href', '/cotizacion');
    expect(within(doors).getByRole('link', { name: /^Pedido \(7\)/ })).toHaveAttribute('href', '/solicitar-pedido');
  });

  it('en el teléfono van en su propia fila, a lo ancho y a medias; desde lg, a la derecha', () => {
    renderHeader();
    const doors = screen.getByRole('navigation', { name: 'Tus listas' });
    expect(doors).toHaveClass('order-last', 'w-full', 'grid', 'grid-cols-2', 'lg:order-none', 'lg:w-auto');
    for (const a of within(doors).getAllByRole('link')) expect(a).toHaveClass('w-full', 'sm:w-auto');
  });

  it('entre 1024 y 1279 px el buscador conserva espacio: el total y "Instalación" se ven desde xl', async () => {
    // Medido en el navegador a 1024 px, en modo empresa con 40 unidades: el campo pasó de 67 px
    // (sin espacio para escribir) a 259 px. jsdom no mide: se fija la regla que lo logra.
    seedLists();
    renderHeader();
    const pedido = await screen.findByRole('link', { name: /^Pedido \(7\)/ });
    const total = within(pedido).getByText(/^· \$/);
    expect(total).toHaveClass('hidden', 'xl:inline');
    expect(screen.getByText('Instalación')).toHaveClass('hidden', 'xl:inline');
    expect(screen.getByRole('textbox', { name: 'Buscar productos' }).closest('form')).toHaveClass('flex-1', 'min-w-[15rem]');
  });
});

describe('encabezado compacto en el teléfono (A-02)', () => {
  it('la barra violeta va en 1 línea de 28 px y sale de la pantalla al bajar (sticky con top -28 px)', () => {
    renderHeader();
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('sticky', '-top-7', 'md:top-0');
    const bar = header.firstElementChild as HTMLElement;
    expect(bar).toHaveClass('h-7', 'md:h-auto');
    const short = within(bar).getByText('Cotización formal · Despacho a todo Chile');
    expect(short).toHaveClass('md:hidden', 'truncate');
    // En escritorio, la barra de siempre
    expect(within(bar).getByText(/^Atención empresas, instaladores y proyectos/)).toHaveClass('hidden', 'md:inline');
  });

  it('el buscador del teléfono se pliega en la lupa, que lleva a /buscar', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: 'Buscar productos' })).toHaveAttribute('href', '/buscar');
    // Un solo campo de búsqueda en el encabezado: el de escritorio (md:flex)
    const fields = screen.getAllByRole('textbox');
    expect(fields).toHaveLength(1);
    expect(fields[0].closest('form')).toHaveClass('hidden', 'md:flex');
  });
});

describe('menú del teléfono (B-02)', () => {
  it('cerrado no está en la página; el botón dice qué hace', () => {
    renderHeader();
    const trigger = screen.getByRole('button', { name: 'Abrir menú' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveClass('lg:hidden');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('abre un panel con las acciones clave arriba, antes de las categorías', async () => {
    seedLists();
    renderHeader();
    await screen.findByRole('link', { name: 'Cotización (3)' }); // la sesión ya se leyó
    const menu = openMenu();
    // Con el panel abierto, Radix esconde el resto de la página al lector de pantalla (hidden)
    expect(screen.getByRole('button', { name: 'Abrir menú', hidden: true })).toHaveAttribute('aria-expanded', 'true');
    // El foco va al panel (no al botón de B2B, donde un Enter cambiaría los precios)
    expect(menu).toHaveFocus();

    const quote = within(menu).getByRole('link', { name: /^Cotización \(3\)/ });
    expect(quote).toHaveAttribute('href', '/cotizacion');
    expect(quote).toHaveTextContent('Solicitar cotización formal con RUT');
    expect(within(menu).getByRole('link', { name: /^Pedido \(7\)/ })).toHaveAttribute('href', '/solicitar-pedido');
    expect(within(menu).getByText('Te respondemos por correo el mismo día hábil.')).toBeInTheDocument();
    const b2b = within(menu).getByRole('button', { name: /Cambiar a B2B \(empresa\)/ });
    const advisory = within(menu).getByRole('link', { name: /^Asesoría técnica/ });
    expect(advisory).toHaveAttribute('href', ADVISORY_LINK.to);
    expect(advisory).toHaveTextContent('servicio cotizado');
    expect(within(menu).getByRole('link', { name: /^Instalación profesional/ })).toHaveAttribute('href', '/instalacion');
    const installers = within(menu).getByRole('link', { name: /^Instaladores y profesionales/ });
    expect(installers).toHaveAttribute('href', '/instaladores');

    // Todas las categorías, después de las acciones
    const firstCategory = within(menu).getByRole('link', { name: startsWith(categories[0].name) });
    for (const cat of categories) {
      expect(within(menu).getByRole('link', { name: startsWith(cat.name) })).toHaveAttribute('href', `/catalogo/${cat.slug}`);
    }
    const order = (el: Element) => [...menu.querySelectorAll('a, button')].indexOf(el);
    for (const action of [quote, b2b, advisory, installers]) expect(order(action)).toBeLessThan(order(firstCategory));

    // Con scroll propio: el alto de la pantalla y la lista que se desplaza dentro
    expect(menu).toHaveClass('h-[100dvh]', 'flex-col');
    expect(within(menu).getByRole('navigation', { name: 'Menú del sitio' })).toHaveClass('flex-1', 'overflow-y-auto');
  });

  it('Escape lo cierra y devuelve el foco al botón del menú', async () => {
    renderHeader();
    openMenu();
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const trigger = screen.getByRole('button', { name: 'Abrir menú' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('con Tab, la X «Cerrar» (arriba a la derecha) es lo primero del panel, antes de las opciones', () => {
    renderHeader();
    const menu = openMenu();
    const focusable = menu.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable[0]).toBe(within(menu).getByRole('button', { name: 'Cerrar' }));
    expect(focusable[1]).toBe(within(menu).getByRole('link', { name: /^Cotización \(0\)/ }));
  });

  it('la X («Cerrar») lo cierra', async () => {
    renderHeader();
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('un enlace navega y cierra el menú', async () => {
    renderHeader('/catalogo');
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('link', { name: /^Asesoría técnica/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(currentPath).toBe(ADVISORY_LINK.to);
  });

  it('«Cambiar a B2B» pasa a precios sin IVA y cierra el menú', async () => {
    renderHeader();
    await waitFor(() => expect(screen.getByRole('button', { name: 'B2C - Con IVA' })).toBeEnabled());
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('button', { name: /Cambiar a B2B \(empresa\)/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'B2B - Precio neto' })).toBeInTheDocument();
    const reopened = openMenu();
    expect(within(reopened).getByRole('button', { name: /B2B activo: precios sin IVA/ })).toBeInTheDocument();
  });
});

describe('Analytics: request_cart_view igual desde la puerta y desde el menú', () => {
  it('con la solicitud vacía no se envía, ni desde la puerta ni desde el menú', async () => {
    renderHeader('/catalogo');
    const doors = screen.getByRole('navigation', { name: 'Tus listas' });
    fireEvent.click(within(doors).getByRole('link', { name: 'Pedido (0)' }));
    await waitFor(() => expect(currentPath).toBe('/solicitar-pedido'));
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('link', { name: /^Pedido \(0\)/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('con productos se envía desde la puerta y desde el menú, con el mismo conteo y el subtotal con IVA', async () => {
    seedLists();
    renderHeader('/catalogo');
    const [a, b] = products;
    const expected = { item_count: 7, subtotal: a.price * 2 + b.price * 5 };
    const doors = screen.getByRole('navigation', { name: 'Tus listas' });
    fireEvent.click(await within(doors).findByRole('link', { name: /^Pedido \(7\)/ }));
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenLastCalledWith('request_cart_view', expected);
    await waitFor(() => expect(currentPath).toBe('/solicitar-pedido'));

    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('link', { name: /^Pedido \(7\)/ }));
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent).toHaveBeenLastCalledWith('request_cart_view', expected);
  });
});
