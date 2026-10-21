// Selector de variante (auditoría UX, D-01) y tarjeta «Elegir variante» (C-01), con productos
// reales del snapshot: la BESTLED 90W (precio por temperatura de color), la Flyhawk (potencia y
// color de luz; antes no se podía pedir la variante de $514.800) y el proyector antivandálico
// 100W (dos opciones, mismo precio; antes entraba sin color). Elegir una opción cambia el
// precio y el SKU; la solicitud y la cotización reciben la variante (id, SKU y etiqueta), y lo
// envían así al servidor.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductDetail from './ProductDetail';
import RequestOrderPage from './RequestOrderPage';
import QuoteCartPage from './QuoteCartPage';
import ProductCard from '@/components/catalog/ProductCard';
import { products, type Product } from '@/data/products';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { toast } from 'sonner';

const byJid = (id: number) => products.find(p => p.jumpseller_id === id)!;
const bestled90 = byJid(2301105);
const flyhawk = byJid(11521285);
const antivandalico = byJid(2252962);
// Sus dos variantes no tienen SKU en Jumpseller; el del producto (DLS7LVB) lo usa también el cilindro 7W
const downlight = byJid(3612990);
const simple = products.find(p => !p.variants && !p.cctVariants && p.price > 1000)!;

function renderPdp(product: Product) {
  return render(
    <HelmetProvider>
      <TooltipProvider>
        <AppProvider>
          <RequestCartProvider>
            <MemoryRouter initialEntries={[`/producto/${product.id}`]}>
              <Routes>
                <Route path="/producto/:id" element={<ProductDetail />} />
              </Routes>
            </MemoryRouter>
          </RequestCartProvider>
        </AppProvider>
      </TooltipProvider>
    </HelmetProvider>,
  );
}

/** Precio grande de la ficha, con «desde» si lo lleva («desde $139.900»). */
const mainPrice = (container: HTMLElement) =>
  [...container.querySelector('p.text-3xl')!.parentElement!.children]
    .map(el => el.textContent)
    .filter(t => !/^Precio/.test(t ?? ''))
    .join(' ');
const headerSku = (container: HTMLElement) => container.querySelector('h1')!.previousElementSibling!.textContent;
const requestButton = () => screen.getByRole('button', { name: /Solicitar pedido/ });
// El de la ficha es el primero (las tarjetas de «Productos relacionados» también tienen uno)
const quoteButton = () => screen.getAllByRole('button', { name: /^Cotizar$/ })[0];
const savedRequest = () => JSON.parse(sessionStorage.getItem('elights_request_cart') ?? '[]');
const savedQuote = () => JSON.parse(sessionStorage.getItem('elights_quote') ?? '[]');
const selector = (container: HTMLElement) => container.querySelector('[data-variant-selector]') as HTMLElement;

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ficha BESTLED 90W: el selector genérico reemplaza al de temperatura de color', () => {
  it('sin elegir: «desde $139.900», precio por opción, botones bloqueados y la instrucción en gris', async () => {
    const { container } = renderPdp(bestled90);
    expect(mainPrice(container)).toBe('desde $139.900');
    const group = screen.getByRole('radiogroup', { name: /Temperatura de color/ });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map(r => r.closest('label')!.textContent)).toEqual([
      'Ámbar 2200K$154.000', 'Cálida 2700K$154.000', 'Neutra 4000K$139.900', 'Fría 5000K$139.900',
    ]);
    expect(requestButton()).toBeDisabled();
    expect(quoteButton()).toBeDisabled();
    const hint = screen.getByText('Elige una temperatura de color para continuar.');
    expect(hint.className).toContain('text-muted-foreground');
    expect(requestButton().getAttribute('aria-describedby')).toBe(hint.id);
    expect(headerSku(container)).toBe('APB90');
    // Ni el texto crudo de Jumpseller ni certificados en las opciones
    expect(selector(container).textContent).not.toMatch(/luz azul|certific|D\.\s?S\.|DS ?1/i);
    // Objetivos de 44 px (≥ 32 px en el teléfono)
    for (const r of radios) expect(r.closest('label')!.className).toContain('min-h-11');
  });

  it('al elegir 2700K: $154.000, SKU APB907, y la solicitud y la cotización reciben la variante', async () => {
    const { container } = renderPdp(bestled90);
    fireEvent.click(screen.getByRole('radio', { name: /Cálida 2700K/ }));
    expect(mainPrice(container)).toBe('$154.000');
    expect(headerSku(container)).toBe('APB907');
    expect(screen.getByText('Elegiste: Cálida 2700K. La elección define el SKU del despacho.')).toBeInTheDocument();
    expect(requestButton()).toBeEnabled();

    fireEvent.click(requestButton());
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({
      jumpsellerId: 2301105, variantId: 111887900, sku: 'APB907', unitPrice: 154000,
      attributes: { potencia: '90W', colorLuz: 'Cálida 2700K' },
    });
    expect(toast.success).toHaveBeenCalledWith('Agregado a tu solicitud', expect.objectContaining({ description: `${bestled90.name} – Cálida 2700K` }));

    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    expect(savedQuote()[0]).toMatchObject({ cct: 2700, variantId: 111887900, variantSku: 'APB907', unitPrice: 154000, variantLabel: 'Cálida 2700K' });
  });

  it('modo empresa: el precio de cada opción y el «desde» van netos', async () => {
    sessionStorage.setItem('elights_b2b', 'true');
    const { container } = renderPdp(bestled90);
    await waitFor(() => expect(mainPrice(container)).toBe('desde $117.563 ($139.900 c/IVA)'));
    expect(screen.getByRole('radio', { name: /Cálida 2700K/ }).closest('label')!.textContent).toBe('Cálida 2700K$129.412');
  });

  it('con el teclado: las flechas recorren y eligen las opciones', async () => {
    const { container } = renderPdp(bestled90);
    const ambar = screen.getByRole('radio', { name: /Ámbar 2200K/ });
    fireEvent.click(ambar);
    expect(ambar).toHaveAttribute('aria-checked', 'true');
    ambar.focus();
    fireEvent.keyDown(ambar, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('radio', { name: /Cálida 2700K/ })).toHaveAttribute('aria-checked', 'true'));
    expect(headerSku(container)).toBe('APB907');
  });
});

describe('ficha Flyhawk 40-80W: potencia y temperatura de color', () => {
  it('antes solo se podía pedir a $442.800; ahora 80W 2200K llega a $514.800, con su variante', async () => {
    const { container } = renderPdp(flyhawk);
    expect(mainPrice(container)).toBe('desde $442.800');
    const power = screen.getByRole('radiogroup', { name: /Potencia/ });
    expect(within(power).getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['40W$442.800', '60W$478.800', '80W$514.800']);
    const color = screen.getByRole('radiogroup', { name: /Temperatura de color/ });
    expect(within(color).getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['Cálida 2200K', 'Cálida 2700K', 'Neutra 4000K']);
    expect(screen.getByText('Elige una potencia y una temperatura de color para continuar.')).toBeInTheDocument();

    fireEvent.click(within(power).getByRole('radio', { name: /80W/ }));
    // El precio ya es el de 80W (el color no lo cambia), pero falta el color
    expect(mainPrice(container)).toBe('$514.800');
    expect(requestButton()).toBeDisabled();
    expect(screen.getByText('Elige una temperatura de color para continuar.')).toBeInTheDocument();

    fireEvent.click(within(color).getByRole('radio', { name: /Cálida 2200K/ }));
    expect(requestButton()).toBeEnabled();
    expect(screen.getByText('Elegiste: 80W · Cálida 2200K. La elección queda registrada en tu solicitud.')).toBeInTheDocument();
    // Sin SKU de Jumpseller para esta variante: no se muestra el de las 4000K (APSB80N)
    expect(headerSku(container)).toBe('');
    const wa = decodeURIComponent(screen.getByRole('link', { name: /Consultar por WhatsApp/ }).getAttribute('href')!);
    expect(wa).toContain('80W · Cálida 2200K (SKU: JS-11521285)');

    fireEvent.click(requestButton());
    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({
      variantId: 118197864, sku: 'JS-11521285', unitPrice: 514800, attributes: { potencia: '80W', colorLuz: '80W · Cálida 2200K' },
    });
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    expect(savedQuote()[0]).toMatchObject({ variantId: 118197864, variantSku: 'JS-11521285', unitPrice: 514800, variantLabel: '80W · Cálida 2200K' });
  });
});

describe('ficha del proyector antivandálico 100W: dos colores, mismo precio', () => {
  it('sin «desde»; al elegir «Fría» el SKU es CHIPX100NF y la solicitud lo lleva', async () => {
    const { container } = renderPdp(antivandalico);
    expect(mainPrice(container)).toBe('$32.500');
    const group = screen.getByRole('radiogroup', { name: /Color de luz/ });
    expect(within(group).getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['Cálida', 'Fría']);
    expect(requestButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Fría' }));
    expect(headerSku(container)).toBe('CHIPX100NF');
    fireEvent.click(requestButton());
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({ variantId: 4160896, sku: 'CHIPX100NF', unitPrice: 32500, attributes: { colorLuz: 'Fría' } });
  });
});

describe('ficha sin variantes: igual que antes', () => {
  it('sin selector y con los botones activos', () => {
    const { container } = renderPdp(simple);
    expect(selector(container)).toBeNull();
    expect(requestButton()).toBeEnabled();
    expect(mainPrice(container)).not.toMatch(/desde/);
  });
});

// ── La variante llega al servidor ────────────────────────────────────────────

const ok = () => vi.fn(async (_url: string, init: RequestInit) => ({
  ok: true,
  status: 201,
  json: async () => ({ success: true, requestReference: JSON.parse(init.body as string).requestReference, dealId: 1 }),
  text: async () => '{"success":true}',
}));
const sentBody = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('la variante elegida llega en el envío', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('solicitud de pedido (Flyhawk 80W 2200K): la lista la muestra y el envío lleva id, SKU y etiqueta', async () => {
    const first = renderPdp(flyhawk);
    fireEvent.click(screen.getByRole('radio', { name: /80W/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Cálida 2200K/ }));
    fireEvent.click(requestButton());
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    first.unmount();

    vi.stubGlobal('fetch', ok());
    render(
      <HelmetProvider><AppProvider><RequestCartProvider>
        <MemoryRouter initialEntries={['/solicitar-pedido']}><RequestOrderPage /></MemoryRouter>
      </RequestCartProvider></AppProvider></HelmetProvider>,
    );
    await screen.findByLabelText(/Nombre completo/);
    expect(screen.getByText('80W · Cálida 2200K')).toBeInTheDocument();
    // La puesta al día con el catálogo conserva el precio de la variante (antes caía a $442.800)
    expect(screen.getByText('Total con IVA:').parentElement!.textContent).toContain('$514.800');
    expect(screen.getByRole('button', { name: `Quitar ${flyhawk.name}, 80W · Cálida 2200K, JS-11521285 de la solicitud` })).toBeInTheDocument();
    type(/Nombre completo/, 'PRUEBA VARIANTES - borrar');
    type(/Correo electrónico/, 'prueba-variantes@example.com');
    type(/Teléfono/, '+56 9 0000 0913');
    type(/Comuna/, 'Santiago');
    fireEvent.click(screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/));
    fireEvent.click(screen.getByRole('button', { name: /ENVIAR SOLICITUD DE PEDIDO/ }));
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody().items).toEqual([
      expect.objectContaining({
        jumpsellerId: 11521285, variantId: 118197864, sku: 'JS-11521285', unitPrice: 514800,
        attributes: { potencia: '80W', colorLuz: '80W · Cálida 2200K' },
      }),
    ]);
  });

  it('cotización (BESTLED 90W 2700K): la lista la muestra y el envío lleva el id y el SKU de la variante', async () => {
    const first = renderPdp(bestled90);
    fireEvent.click(screen.getByRole('radio', { name: /Cálida 2700K/ }));
    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    first.unmount();

    vi.stubGlobal('fetch', ok());
    render(
      <HelmetProvider><AppProvider>
        <MemoryRouter initialEntries={['/cotizacion']}><QuoteCartPage /></MemoryRouter>
      </AppProvider></HelmetProvider>,
    );
    expect(await screen.findByText('APB907 · Cálida 2700K')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Quitar ${bestled90.name}, Cálida 2700K de la cotización` })).toBeInTheDocument();
    type(/Nombre y Apellido/, 'PRUEBA VARIANTES - borrar');
    type(/Email/, 'prueba-variantes@example.com');
    type(/Teléfono/, '+56 9 0000 0913');
    fireEvent.click(screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/));
    fireEvent.click(screen.getByRole('button', { name: /ENVIAR SOLICITUD/ }));
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody().products).toEqual([
      expect.objectContaining({
        jumpsellerId: 2301105, variantId: 111887900, sku: 'APB907', variantLabel: 'Cálida 2700K', unitPriceClp: 154000, quantity: 1,
      }),
    ]);
  });

  it('cotización con dos variantes sin SKU propio (downlight 7W slim): dos líneas distinguibles por id y etiqueta', async () => {
    const first = renderPdp(downlight);
    expect(headerSku(first.container)).toBe('DLS7LVB'); // antes de elegir, el del producto (como siempre)
    fireEvent.click(screen.getByRole('radio', { name: 'Cálida 3000K' }));
    // DLS7LVB no es el SKU de la variante: arriba no se muestra y la ayuda no promete un SKU
    expect(headerSku(first.container)).toBe('');
    expect(screen.getByText('Elegiste: Cálida 3000K. La elección queda registrada en tu solicitud.')).toBeInTheDocument();
    fireEvent.click(quoteButton());
    fireEvent.click(screen.getByRole('radio', { name: 'Fría' }));
    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedQuote()).toHaveLength(2));
    first.unmount();

    vi.stubGlobal('fetch', ok());
    render(
      <HelmetProvider><AppProvider>
        <MemoryRouter initialEntries={['/cotizacion']}><QuoteCartPage /></MemoryRouter>
      </AppProvider></HelmetProvider>,
    );
    expect(await screen.findByText('JS-3612990 · Cálida 3000K')).toBeInTheDocument();
    expect(screen.getByText('JS-3612990 · Fría')).toBeInTheDocument();
    type(/Nombre y Apellido/, 'PRUEBA VARIANTES - borrar');
    type(/Email/, 'prueba-variantes@example.com');
    type(/Teléfono/, '+56 9 0000 0913');
    fireEvent.click(screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/));
    fireEvent.click(screen.getByRole('button', { name: /ENVIAR SOLICITUD/ }));
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody().products).toEqual([
      expect.objectContaining({ jumpsellerId: 3612990, variantId: 11927495, sku: 'JS-3612990', variantLabel: 'Cálida 3000K', quantity: 1 }),
      expect.objectContaining({ jumpsellerId: 3612990, variantId: 11927496, sku: 'JS-3612990', variantLabel: 'Fría', quantity: 1 }),
    ]);
  });
});

// ── Tarjeta del listado (C-01) ───────────────────────────────────────────────

function renderCard(product: Product) {
  return render(
    <MemoryRouter>
      <AppProvider>
        <RequestCartProvider>
          <ProductCard product={product} />
        </RequestCartProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

describe('tarjeta: un producto con variantes no se agrega a ciegas (C-01)', () => {
  it('BESTLED 90W: «desde $139.900» y «Elegir variante», que lleva a la ficha; sin Solicitar ni Cotizar', () => {
    const { container } = renderCard(bestled90);
    expect(container.textContent).toContain('desde$139.900'); // «desde» y el precio, en dos elementos
    const link = screen.getByRole('link', { name: `Elegir variante: ${bestled90.name}` });
    expect(link.getAttribute('href')).toBe(`/producto/${bestled90.id}`);
    expect(link.className).toContain('h-8'); // 32 px
    expect(screen.queryByRole('button', { name: /^solicitar$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cotizar/i })).toBeNull();
  });

  it('Flyhawk: «desde $442.800»; antivandálico 100W (mismo precio): sin «desde», también «Elegir variante»', () => {
    const fly = renderCard(flyhawk);
    expect(fly.container.textContent).toContain('desde$442.800');
    fly.unmount();
    const { container } = renderCard(antivandalico);
    expect(container.textContent).not.toContain('desde');
    expect(container.textContent).toContain('$32.500');
    expect(screen.getByRole('link', { name: /^Elegir variante/ })).toBeInTheDocument();
  });

  it('un producto sin variantes sigue con «Solicitar» y «Cotizar»', () => {
    renderCard(simple);
    expect(screen.getByRole('button', { name: /^solicitar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cotizar/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Elegir variante/ })).toBeNull();
  });
});
