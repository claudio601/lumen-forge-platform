// Selector de variante (auditoría UX, D-01) y tarjeta «Elegir variante» (C-01). Elegir una opción
// cambia el precio y el SKU; la solicitud y la cotización reciben la variante (id, SKU y
// etiqueta) y la envían así al servidor.
// Sin valores fijos del catálogo: la sincronización diaria trae los SKU y precios que el dueño
// corrige en Jumpseller. Los productos se eligen por una propiedad del snapshot («una opción con
// precio distinto por opción», «el producto con dos opciones», «dos variantes sin SKU propio»);
// el precio esperado sale del snapshot y el SKU, de la regla de src/test/variantRule.ts (el
// propio de la variante o «JS-<id>»). Si ningún producto cumple la propiedad, la prueba se omite.

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
import type { ProductVariant } from '@/data/catalog/types';
import {
  missingChoicesText, variantAttributes, variantAxes, variantFromPrice, variantKelvin, variantLabel, type VariantAxis,
} from '@/lib/variants';
import { expectedLineSku, expectedSkuIsDistinct, snapshotProduct, snapshotVariant } from '@/test/variantRule';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn() }));
import { toast } from 'sonner';

// ── Lo esperado, desde el snapshot ───────────────────────────────────────────

const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;
const net = (gross: number) => Math.round(gross / 1.19);
/** Precio CON IVA de la variante en Jumpseller. */
const priceOf = (p: Product, v: ProductVariant) => snapshotVariant(p.jumpseller_id, v.id).price;
/** SKU propio de la variante en Jumpseller ('' si no tiene): el que la ficha muestra arriba. */
const ownSku = (p: Product, v: ProductVariant) => snapshotVariant(p.jumpseller_id, v.id).sku;
const valueOf = (axis: VariantAxis, v: ProductVariant) => v.options.find(o => o.name === axis.name)!.value;
const choiceIndex = (axis: VariantAxis, v: ProductVariant) => axis.choices.findIndex(c => c.value === valueOf(axis, v));
/** Precio de cada opción, solo si cada opción tiene un único precio y no cuestan todas lo mismo. */
function choicePrices(p: Product, axis: VariantAxis): (number | undefined)[] {
  const sets = axis.choices.map(c => new Set(p.variants!.filter(v => valueOf(axis, v) === c.value).map(v => priceOf(p, v))));
  const decides = sets.every(s => s.size === 1) && new Set(sets.flatMap(s => [...s])).size > 1;
  return sets.map(s => (decides ? [...s][0] : undefined));
}
/** Texto de cada opción del selector: etiqueta, dato («1 % de luz azul») y su precio si lo lleva. */
const optionTexts = (p: Product, axis: VariantAxis, format = clp) => {
  const prices = choicePrices(p, axis);
  return axis.choices.map((c, i) => `${c.label}${c.detail ?? ''}${prices[i] !== undefined ? format(prices[i]!) : ''}`);
};
/** Precio grande antes de terminar de elegir: «desde» la más barata si no cuestan todas lo mismo. */
const fromText = (prices: number[]) => (new Set(prices).size > 1 ? `desde ${clp(Math.min(...prices))}` : clp(prices[0]));
const hintFor = (p: Product, v: ProductVariant) =>
  `Elegiste: ${variantLabel(p, v)}. ${expectedSkuIsDistinct(p.jumpseller_id, v.id) ? 'La elección define el SKU del despacho.' : 'La elección queda registrada en tu solicitud.'}`;
/** Atributos como quedan guardados en la sesión (JSON: sin los undefined). */
const savedAttributes = (p: Product, v: ProductVariant) => JSON.parse(JSON.stringify(variantAttributes(p, v)));
/** La más cara; a igual precio, la que no tiene SKU propio (el caso «JS-<id>») y luego el orden de Jumpseller. */
const mostExpensive = (p: Product, among: readonly ProductVariant[] = p.variants!) =>
  [...among].sort((a, b) => priceOf(p, b) - priceOf(p, a) || Number(Boolean(ownSku(p, a))) - Number(Boolean(ownSku(p, b))))[0];

// ── Productos elegidos por una propiedad del snapshot ────────────────────────

const withChoice = products.filter(p => (p.variants?.length ?? 0) > 1);
// Una sola opción y cada valor con su precio; primero las BESTLED (temperatura de color con el nombre de la ficha)
const singleAxisPriced = (p: Product) => {
  const axes = variantAxes(p);
  return axes.length === 1 && choicePrices(p, axes[0]).every(x => x !== undefined);
};
const priced = withChoice.find(p => p.cctVariants?.length && singleAxisPriced(p)) ?? withChoice.find(singleAxisPriced);
// La que se elige: la más cara con un SKU propio que la distingue (si no hay ninguna, la más cara)
const distinctOf = (p: Product) => p.variants!.filter(v => expectedSkuIsDistinct(p.jumpseller_id, v.id));
const pricedPick = priced ? mostExpensive(priced, distinctOf(priced).length ? distinctOf(priced) : priced.variants!) : undefined;
// Hoy, la Flyhawk 40-80W: potencia y temperatura de color (antes no se podía pedir la más cara)
const twoAxes = withChoice.find(p => variantAxes(p).length > 1);
// Una opción, mismo precio en todas y alguna variante con un SKU propio que la distingue
const samePrice = withChoice.find(p => variantAxes(p).length === 1 && variantFromPrice(p) === undefined && distinctOf(p).length > 0);
// Dos variantes sin SKU propio en Jumpseller; primero uno con SKU de producto (el de arriba antes de elegir)
const twoNoSku = (p: Product) => variantAxes(p).length === 1 && p.variants!.filter(v => !ownSku(p, v)).length >= 2;
const withoutOwnSku = withChoice.find(p => p.sku && twoNoSku(p)) ?? withChoice.find(twoNoSku);
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
const radios = (axis: VariantAxis) => within(screen.getByRole('radiogroup', { name: axis.legend })).getAllByRole('radio');
const radioTexts = (axis: VariantAxis) => radios(axis).map(r => r.closest('label')!.textContent);
/** Elige en el eje la opción de la variante `v`. */
const pick = (axis: VariantAxis, v: ProductVariant) => fireEvent.click(radios(axis)[choiceIndex(axis, v)]);

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.skipIf(!priced)(`ficha con una opción que decide el precio (${priced?.name ?? 'ninguna en el snapshot'})`, () => {
  const p = priced!;
  const axes = priced ? variantAxes(priced) : [];
  const v = pricedPick!;

  it('sin elegir: «desde» la más barata, precio por opción, botones bloqueados y la instrucción en gris', () => {
    const { container } = renderPdp(p);
    expect(mainPrice(container)).toBe(fromText(p.variants!.map(x => priceOf(p, x))));
    expect(radioTexts(axes[0])).toEqual(optionTexts(p, axes[0]));
    expect(requestButton()).toBeDisabled();
    expect(quoteButton()).toBeDisabled();
    const hint = screen.getByText(`Elige ${missingChoicesText(axes)} para continuar.`);
    expect(hint.className).toContain('text-muted-foreground');
    expect(requestButton().getAttribute('aria-describedby')).toBe(hint.id);
    // Antes de elegir, el SKU del producto (como siempre)
    expect(headerSku(container)).toBe(p.sku);
    // Ni el texto crudo de Jumpseller ni certificados en las opciones
    expect(selector(container).textContent).not.toMatch(/luz azul|certific|D\.\s?S\.|DS ?1/i);
    // Objetivos de 44 px (≥ 32 px en el teléfono)
    for (const r of radios(axes[0])) expect(r.closest('label')!.className).toContain('min-h-11');
  });

  it('al elegir: su precio y su SKU, y la solicitud y la cotización reciben la variante', async () => {
    const { container } = renderPdp(p);
    const label = variantLabel(p, v);
    const sku = expectedLineSku(p.jumpseller_id, v.id);
    pick(axes[0], v);
    expect(mainPrice(container)).toBe(clp(priceOf(p, v)));
    expect(headerSku(container)).toBe(ownSku(p, v));
    expect(screen.getByText(hintFor(p, v))).toBeInTheDocument();
    expect(requestButton()).toBeEnabled();

    fireEvent.click(requestButton());
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({
      jumpsellerId: p.jumpseller_id, variantId: v.id, sku, unitPrice: priceOf(p, v), attributes: savedAttributes(p, v),
    });
    expect(toast.success).toHaveBeenCalledWith('Agregado a tu solicitud', expect.objectContaining({ description: `${p.name} – ${label}` }));

    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    const kelvin = variantKelvin(p, v);
    expect(savedQuote()[0]).toMatchObject({
      ...(kelvin !== undefined ? { cct: kelvin } : {}), variantId: v.id, variantSku: sku, unitPrice: priceOf(p, v), variantLabel: label,
    });
  });

  it('modo empresa: el precio de cada opción y el «desde» van netos', async () => {
    sessionStorage.setItem('elights_b2b', 'true');
    const { container } = renderPdp(p);
    const min = Math.min(...p.variants!.map(x => priceOf(p, x)));
    await waitFor(() => expect(mainPrice(container)).toBe(`desde ${clp(net(min))} (${clp(min)} c/IVA)`));
    expect(radioTexts(axes[0])).toEqual(optionTexts(p, axes[0], n => clp(net(n))));
  });

  it('con el teclado: las flechas recorren y eligen las opciones', async () => {
    const { container } = renderPdp(p);
    const first = radios(axes[0])[0];
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-checked', 'true');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(radios(axes[0])[1]).toHaveAttribute('aria-checked', 'true'));
    const second = p.variants!.find(x => valueOf(axes[0], x) === axes[0].choices[1].value)!;
    expect(headerSku(container)).toBe(ownSku(p, second));
  });
});

describe.skipIf(!twoAxes)(`ficha con dos opciones (${twoAxes?.name ?? 'ninguna en el snapshot'})`, () => {
  it('la más cara se puede pedir: se elige opción por opción y llega con su precio, su variante y el SKU de la regla', async () => {
    const p = twoAxes!;
    const axes = variantAxes(p);
    const v = mostExpensive(p);
    const label = variantLabel(p, v);
    const sku = expectedLineSku(p.jumpseller_id, v.id);
    const { container } = renderPdp(p);
    expect(mainPrice(container)).toBe(fromText(p.variants!.map(x => priceOf(p, x))));
    for (const axis of axes) expect(radioTexts(axis), axis.legend).toEqual(optionTexts(p, axis));
    expect(screen.getByText(`Elige ${missingChoicesText(axes)} para continuar.`)).toBeInTheDocument();

    // La primera opción acota el precio, pero falta elegir el resto
    pick(axes[0], v);
    const remaining = p.variants!.filter(x => valueOf(axes[0], x) === valueOf(axes[0], v)).map(x => priceOf(p, x));
    expect(mainPrice(container)).toBe(fromText(remaining));
    expect(requestButton()).toBeDisabled();
    expect(screen.getByText(`Elige ${missingChoicesText(axes.slice(1))} para continuar.`)).toBeInTheDocument();

    for (const axis of axes.slice(1)) pick(axis, v);
    expect(requestButton()).toBeEnabled();
    expect(mainPrice(container)).toBe(clp(priceOf(p, v)));
    expect(screen.getByText(hintFor(p, v))).toBeInTheDocument();
    // Arriba, solo el SKU propio de la variante (nunca el del producto ni el de otra variante)
    expect(headerSku(container)).toBe(ownSku(p, v));
    const wa = decodeURIComponent(screen.getByRole('link', { name: /Escríbenos por WhatsApp/ }).getAttribute('href')!);
    expect(wa).toContain(`${label} (SKU: ${sku})`);

    fireEvent.click(requestButton());
    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({ variantId: v.id, sku, unitPrice: priceOf(p, v), attributes: savedAttributes(p, v) });
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    expect(savedQuote()[0]).toMatchObject({ variantId: v.id, variantSku: sku, unitPrice: priceOf(p, v), variantLabel: label });
  });
});

describe.skipIf(!samePrice)(`ficha con opciones del mismo precio (${samePrice?.name ?? 'ninguna en el snapshot'})`, () => {
  it('sin «desde» ni precio por opción; al elegir, el SKU propio de la variante, y la solicitud lo lleva', async () => {
    const p = samePrice!;
    const axes = variantAxes(p);
    const v = distinctOf(p)[0];
    const { container } = renderPdp(p);
    expect(mainPrice(container)).toBe(clp(priceOf(p, v)));
    expect(radioTexts(axes[0])).toEqual(axes[0].choices.map(c => `${c.label}${c.detail ?? ''}`));
    expect(requestButton()).toBeDisabled();
    pick(axes[0], v);
    expect(headerSku(container)).toBe(ownSku(p, v));
    expect(screen.getByText(hintFor(p, v))).toBeInTheDocument();
    fireEvent.click(requestButton());
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({
      variantId: v.id, sku: expectedLineSku(p.jumpseller_id, v.id), unitPrice: priceOf(p, v), attributes: savedAttributes(p, v),
    });
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

function renderQuotePage() {
  return render(
    <HelmetProvider><AppProvider>
      <MemoryRouter initialEntries={['/cotizacion']}><QuoteCartPage /></MemoryRouter>
    </AppProvider></HelmetProvider>,
  );
}

async function sendQuote() {
  type(/Nombre y Apellido/, 'PRUEBA VARIANTES - borrar');
  type(/Email/, 'prueba-variantes@example.com');
  type(/Teléfono/, '+56 9 0000 0913');
  fireEvent.click(screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/));
  fireEvent.click(screen.getByRole('button', { name: /ENVIAR SOLICITUD/ }));
  expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
}

describe('la variante elegida llega en el envío', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it.skipIf(!twoAxes)(`solicitud de pedido (la más cara de ${twoAxes?.name ?? '—'}): la lista la muestra y el envío lleva id, SKU y etiqueta`, async () => {
    const p = twoAxes!;
    const v = mostExpensive(p);
    const label = variantLabel(p, v);
    const sku = expectedLineSku(p.jumpseller_id, v.id);
    const first = renderPdp(p);
    for (const axis of variantAxes(p)) pick(axis, v);
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
    expect(screen.getByText(label)).toBeInTheDocument();
    // La puesta al día con el catálogo conserva el precio de la variante (antes caía al del producto)
    expect(screen.getByText('Total con IVA:').parentElement!.textContent).toContain(clp(priceOf(p, v)));
    expect(screen.getByRole('button', { name: `Quitar ${p.name}, ${label}, ${sku} de la solicitud` })).toBeInTheDocument();
    type(/Nombre completo/, 'PRUEBA VARIANTES - borrar');
    type(/Correo electrónico/, 'prueba-variantes@example.com');
    type(/Teléfono/, '+56 9 0000 0913');
    type(/Comuna/, 'Santiago');
    fireEvent.click(screen.getByLabelText(/autorizo a eLIGHTS a usar mis datos/));
    fireEvent.click(screen.getByRole('button', { name: /ENVIAR SOLICITUD DE PEDIDO/ }));
    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    expect(sentBody().items).toEqual([
      expect.objectContaining({
        jumpsellerId: p.jumpseller_id, variantId: v.id, sku, unitPrice: priceOf(p, v), attributes: savedAttributes(p, v),
      }),
    ]);
  });

  it.skipIf(!priced)(`cotización (${priced?.name ?? '—'}): la lista la muestra y el envío lleva el id y el SKU de la variante`, async () => {
    const p = priced!;
    const v = pricedPick!;
    const label = variantLabel(p, v);
    const sku = expectedLineSku(p.jumpseller_id, v.id);
    const first = renderPdp(p);
    pick(variantAxes(p)[0], v);
    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    first.unmount();

    vi.stubGlobal('fetch', ok());
    renderQuotePage();
    expect(await screen.findByText(`${sku} · ${label}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Quitar ${p.name}, ${label} de la cotización` })).toBeInTheDocument();
    await sendQuote();
    expect(sentBody().products).toEqual([
      expect.objectContaining({
        jumpsellerId: p.jumpseller_id, variantId: v.id, sku, variantLabel: label, unitPriceClp: priceOf(p, v), quantity: 1,
      }),
    ]);
  });

  it.skipIf(!withoutOwnSku)(`cotización con dos variantes sin SKU propio (${withoutOwnSku?.name ?? 'ninguna en el snapshot'}): dos líneas «JS-<id>», distinguibles por id y etiqueta`, async () => {
    const p = withoutOwnSku!;
    const axis = variantAxes(p)[0];
    const [v1, v2] = p.variants!.filter(v => !ownSku(p, v));
    const js = `JS-${p.jumpseller_id}`;
    expect([v1, v2].map(v => expectedLineSku(p.jumpseller_id, v.id))).toEqual([js, js]);
    const first = renderPdp(p);
    expect(headerSku(first.container)).toBe(p.sku); // antes de elegir, el del producto (como siempre)
    pick(axis, v1);
    // El SKU del producto no es el de la variante: arriba no se muestra y la ayuda no promete un SKU
    expect(headerSku(first.container)).toBe('');
    expect(screen.getByText(`Elegiste: ${variantLabel(p, v1)}. La elección queda registrada en tu solicitud.`)).toBeInTheDocument();
    fireEvent.click(quoteButton());
    pick(axis, v2);
    fireEvent.click(quoteButton());
    await waitFor(() => expect(savedQuote()).toHaveLength(2));
    first.unmount();

    vi.stubGlobal('fetch', ok());
    renderQuotePage();
    expect(await screen.findByText(`${js} · ${variantLabel(p, v1)}`)).toBeInTheDocument();
    expect(screen.getByText(`${js} · ${variantLabel(p, v2)}`)).toBeInTheDocument();
    await sendQuote();
    expect(sentBody().products).toEqual([v1, v2].map(v =>
      expect.objectContaining({ jumpsellerId: p.jumpseller_id, variantId: v.id, sku: js, variantLabel: variantLabel(p, v), quantity: 1 })));
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
  it.skipIf(!priced)(`${priced?.name ?? '—'}: «desde» y «Elegir variante», que lleva a la ficha; sin Solicitar ni Cotizar`, () => {
    const p = priced!;
    const { container } = renderCard(p);
    // «desde» y el precio, en dos elementos
    expect(container.textContent).toContain(`desde${clp(Math.min(...p.variants!.map(x => priceOf(p, x))))}`);
    const link = screen.getByRole('link', { name: `Elegir variante: ${p.name}` });
    expect(link.getAttribute('href')).toBe(`/producto/${p.id}`);
    expect(link.className).toContain('h-8'); // 32 px
    expect(screen.queryByRole('button', { name: /^solicitar$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cotizar/i })).toBeNull();
  });

  it.skipIf(!samePrice)(`mismo precio en todas las variantes (${samePrice?.name ?? '—'}): sin «desde», también «Elegir variante»`, () => {
    const p = samePrice!;
    const { container } = renderCard(p);
    expect(container.textContent).not.toContain('desde');
    expect(container.textContent).toContain(clp(snapshotProduct(p.jumpseller_id).price));
    expect(screen.getByRole('link', { name: `Elegir variante: ${p.name}` })).toBeInTheDocument();
  });

  it('un producto sin variantes sigue con «Solicitar» y «Cotizar»', () => {
    renderCard(simple);
    expect(screen.getByRole('button', { name: /^solicitar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cotizar/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Elegir variante/ })).toBeNull();
  });
});
