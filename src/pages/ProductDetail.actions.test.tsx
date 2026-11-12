// Ficha, entrega 6 de la auditoría UX: la cantidad se escribe (D-03), la caja «Estudio DIALux
// (servicio cotizado)» en las fichas de proyecto (E-02) y el correo de documentos técnicos en
// todas (D-02, paso 1), con la ficha técnica destacada bajo Solicitar pedido / Cotizar y un acceso
// corto sobre el título. Sin valores fijos del catálogo: los productos se eligen por una propiedad.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductDetail from './ProductDetail';
import EstudioLuminicoPage from './EstudioLuminicoPage';
import { products, type Product } from '@/data/products';
import { contactEmail } from '@/config/business';
import { SITE_URL } from '@/config/site';
import { requestSku } from '@/lib/variantSku';
import { variantAxes, variantLabel } from '@/lib/variants';
import { STUDY_BOX_CATEGORIES, STUDY_BOX_EXCLUDED, studyBoxHref } from '@/lib/studyLink';
import { DIALUX_BOX_TEXT } from '@/config/navigation';
import { MAX_LINE_QUANTITY } from '@/lib/quantity';
import { expectedLineSku } from '@/test/variantRule';
import { productDatasheets } from '@/data/catalog/datasheets.generated';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ sendEvent: vi.fn(), trackLead: vi.fn(), trackGuideCta: vi.fn() }));
// Fichas técnicas adjuntas en Jumpseller: datos fijos, así un cambio del catálogo no rompe las pruebas.
// Un PDF para el primer producto sin ficha editorial, dos para el segundo, ninguno para el tercero,
// y uno para un BESTLED (gana su PDF editorial).
vi.mock('@/data/catalog/datasheets.generated', async () => {
  const { products } = await import('@/data/products');
  const plain = products.filter(p => !p.datasheetUrl);
  const bestled = products.find(p => p.datasheetUrl)!;
  const pdf = (id: number, w: number) => `https://images.jumpseller.com/store/elights-cl/${id}/attachments/ab${w}/ficha-${w}w.pdf?1`;
  return {
    productDatasheets: {
      [plain[0].jumpseller_id]: [pdf(plain[0].jumpseller_id, 60)],
      [plain[1].jumpseller_id]: [pdf(plain[1].jumpseller_id, 80), pdf(plain[1].jumpseller_id, 40)],
      [bestled.jumpseller_id]: [pdf(bestled.jumpseller_id, 40)],
    },
  };
});

function renderPdp(product: Product) {
  return render(
    <HelmetProvider>
      <TooltipProvider>
        <AppProvider>
          <RequestCartProvider>
            <MemoryRouter initialEntries={[`/producto/${product.id}`]}>
              <Routes>
                <Route path="/producto/:id" element={<ProductDetail />} />
                <Route path="/estudio-luminico" element={<EstudioLuminicoPage />} />
              </Routes>
            </MemoryRouter>
          </RequestCartProvider>
        </AppProvider>
      </TooltipProvider>
    </HelmetProvider>,
  );
}

const inStudyCategories = (p: Product) => [p.category, ...p.categories].some(c => c in STUDY_BOX_CATEGORIES);
const inStudyList = (p: Product) => inStudyCategories(p) && !(p.jumpseller_id in STUDY_BOX_EXCLUDED);
// Sin variantes que elegir: los botones agregan de inmediato
const simple = (p: Product) => (p.variants?.length ?? 0) <= 1 && !p.cctVariants?.length && p.price > 1000;
const campana = products.find(p => p.category === 'campanas-led' && simple(p));
const proyector = products.find(p => p.categories.every(c => c === 'proyectores-led') && p.category === 'proyectores-led');
const panel = products.find(p => !inStudyCategories(p) && simple(p))!;
const bestled = products.find(p => p.datasheetUrl)!;
const oneAxis = products.find(p => (p.variants?.length ?? 0) > 1 && variantAxes(p).length === 1)!;
// Fichas técnicas adjuntas en Jumpseller (las del mock de arriba)
const [oneSheet, manySheets, noSheet] = products.filter(p => !p.datasheetUrl);

const savedRequest = () => JSON.parse(sessionStorage.getItem('elights_request_cart') ?? '[]');
const savedQuote = () => JSON.parse(sessionStorage.getItem('elights_quote') ?? '[]');
// El nombre accesible junta los espacios repetidos de algunos nombres de Jumpseller
const named = (p: Product) => p.name.replace(/\s+/g, ' ').trim();
const quantityField = (p: Product) => screen.getByRole('spinbutton', { name: `Cantidad de ${named(p)}` }) as HTMLInputElement;
const box = () => document.querySelector('[data-dialux-box]') as HTMLElement | null;
// El correo de documentos: «Pedir ficha técnica» arriba si no hay PDF, o «Pedir documentos
// técnicos» en su bloque si lo hay (nunca los dos). El acceso corto «Pedir ficha técnica» de
// arriba no es el correo: baja a ese botón.
const docsLink = () => {
  const links = screen.getAllByRole('link', { name: /^Pedir (documentos técnicos|ficha técnica)$/ })
    .filter(a => a.getAttribute('href')?.startsWith('mailto:'));
  expect(links).toHaveLength(1);
  return links[0];
};
// Fila de Solicitar pedido / Cotizar, y fila de la ficha técnica (la siguiente)
const ctaRow = () => screen.getByRole('button', { name: /Solicitar pedido/ }).parentElement!;
const datasheetRow = (link: HTMLElement) => link.closest('[data-datasheets]')!;
const datasheetButtons = () => within(document.querySelector<HTMLElement>('[data-datasheets]')!).getAllByRole('link');
// Acceso corto a la ficha técnica, en la línea del código, sobre el título
const shortcut = () => document.querySelector<HTMLAnchorElement>('[data-datasheet-shortcut]')!;
const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
/** Acceso corto arriba: en la línea del código (justo sobre el título), antes del selector y de los botones. */
function expectShortcutOnTop() {
  const a = shortcut();
  expect(a.tagName).toBe('A');
  expect(a.parentElement!.nextElementSibling).toBe(screen.getByRole('heading', { level: 1 }));
  expect(before(a, ctaRow())).toBe(true);
  const selector = document.querySelector('[role="radiogroup"]');
  if (selector) expect(before(a, selector)).toBe(true);
  expect(a.className).toMatch(/\btext-primary\b/);
  expect(a.className).toMatch(/\bmin-h-6\b/); // objetivo táctil de 24 px
  expect(a.className).toMatch(/(^|\s)-my-1(\s|$)/); // sin sumar alto a la línea del código
  expect(a.querySelector('svg')).not.toBeNull();
}
/** Botón de la ficha técnica: el mismo tratamiento que «Cotizar» (borde y texto del color primario,
 *  48 px), ancho completo; nunca más fuerte que Cotizar. */
function expectProminent(link: HTMLElement) {
  expect(link.tagName).toBe('A');
  expect(link.querySelector('button')).toBeNull(); // nunca un <button> dentro de un <a>
  expect(link.closest('button')).toBeNull();
  expect(link.closest('[data-docs-block]')).toBeNull();
  const quote = within(ctaRow()).getByRole('button', { name: 'Cotizar' }).className.split(/\s+/);
  const own = link.className.split(/\s+/);
  for (const token of ['h-12', 'border-primary/30', 'text-primary', 'hover:bg-accent']) {
    expect(own).toContain(token);
    expect(quote).toContain(token);
  }
  expect(own).toContain('w-full');
  expect(link.className).not.toMatch(/\bfont-(semibold|bold)\b/);
  expect(link.className).toContain('focus-visible:ring-2');
  expect(link.className).not.toContain('text-muted-foreground');
  expect(link.querySelector('svg')).not.toBeNull();
}
/** Asunto y cuerpo del correo prellenado. */
function mail(href: string) {
  const [address, query] = href.replace(/^mailto:/, '').split('?');
  const params = new URLSearchParams(query);
  return { address, subject: params.get('subject'), body: params.get('body') };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe('ficha: la cantidad se escribe (D-03)', () => {
  it('campo «Cantidad» con el nombre del producto, entre − y + con nombre', () => {
    renderPdp(panel);
    expect(screen.getByText('Cantidad', { selector: 'label' })).toBeInTheDocument();
    expect(quantityField(panel).value).toBe('1');
    expect(screen.getByRole('button', { name: `Restar una unidad de ${named(panel)}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Sumar una unidad de ${named(panel)}` })).toBeEnabled();
  });

  it('escribir 40: el subtotal es por 40, y la solicitud y la cotización reciben 40', async () => {
    const { container } = renderPdp(panel);
    fireEvent.change(quantityField(panel), { target: { value: '40' } });
    const subtotal = `$${(panel.price * 40).toLocaleString('es-CL')}`;
    expect(container.textContent?.replace(/\s/g, ' ')).toContain(`Subtotal: ${subtotal}`);

    fireEvent.click(screen.getByRole('button', { name: /Solicitar pedido/ }));
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({ jumpsellerId: panel.jumpseller_id, quantity: 40 });

    fireEvent.click(screen.getAllByRole('button', { name: /^Cotizar$/ })[0]);
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    expect(savedQuote()[0]).toMatchObject({ quantity: 40 });
  });

  it('«1.000» con punto de miles, tecla por tecla: la solicitud y la cotización reciben 1000', async () => {
    renderPdp(panel);
    const qty = quantityField(panel);
    qty.focus();
    for (const typed of ['1', '1.', '1.0', '1.00', '1.000']) fireEvent.change(qty, { target: { value: typed } });
    // Tocar el botón saca el foco del campo: la cantidad sigue en 1000
    fireEvent.blur(qty);
    expect(qty.value).toBe('1000');
    fireEvent.click(screen.getByRole('button', { name: /Solicitar pedido/ }));
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({ jumpsellerId: panel.jumpseller_id, quantity: 1000 });
    fireEvent.click(screen.getAllByRole('button', { name: /^Cotizar$/ })[0]);
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    expect(savedQuote()[0]).toMatchObject({ quantity: 1000 });
  });

  it('más del tope del servidor queda en el tope; agregar otra vez no lo pasa', async () => {
    renderPdp(panel);
    fireEvent.change(quantityField(panel), { target: { value: '50000' } });
    expect(quantityField(panel).value).toBe(String(MAX_LINE_QUANTITY));
    const request = screen.getByRole('button', { name: /Solicitar pedido/ });
    fireEvent.click(request);
    fireEvent.click(request);
    await waitFor(() => expect(savedRequest()[0]?.quantity).toBe(MAX_LINE_QUANTITY));
    const quote = screen.getAllByRole('button', { name: /^Cotizar$/ })[0];
    fireEvent.click(quote);
    fireEvent.click(quote);
    await waitFor(() => expect(savedQuote()[0]?.quantity).toBe(MAX_LINE_QUANTITY));
  });
});

// Síntoma visto en la preview (Chromium): «1.000» y Tab, antes de elegir la variante, dejaban el
// campo en «1.000» y aria-valuenow en 1. Era la página sin JavaScript (no había cargado): con la
// página hidratada, el teclado de verdad deja 1000 en el campo, en el subtotal y en los botones.
describe('ficha: la cantidad con el teclado (userEvent: keydown, input y keyup por tecla, y Tab)', () => {
  const typeOver = (user: ReturnType<typeof userEvent.setup>, el: HTMLInputElement, text: string) =>
    user.type(el, text, { initialSelectionStart: 0, initialSelectionEnd: el.value.length });
  const subtotal = (container: HTMLElement) => container.textContent?.replace(/\s/g, ' ').match(/Subtotal( desde)?: \$[\d.]+/)?.[0];
  const [axis] = variantAxes(oneAxis);
  const chooseFirst = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(within(screen.getByRole('radiogroup', { name: axis.legend })).getAllByRole('radio')[0]);

  for (const order of ['sin elegir la variante antes', 'con la variante elegida antes'] as const) {
    it(`producto con variantes, ${order}: «1.000» y Tab dejan 1000 (campo, aria-valuenow y subtotal); Solicitar pedido y Cotizar llevan 1000`, async () => {
      const user = userEvent.setup();
      const { container } = renderPdp(oneAxis);
      if (order === 'con la variante elegida antes') await chooseFirst(user);
      const qty = quantityField(oneAxis);
      const unit = subtotal(container)!;
      await typeOver(user, qty, '1.000');
      await user.tab();
      expect(qty.value).toBe('1000');
      expect(qty).toHaveAttribute('aria-valuenow', '1000');
      const pesos = (text: string) => Number(text.replace(/\D/g, ''));
      expect(pesos(subtotal(container)!)).toBe(pesos(unit) * 1000); // con 100 sería × 100
      // Enter con el foco en el campo no cambia nada
      await user.click(qty);
      await user.keyboard('{Enter}');
      expect(document.activeElement).toBe(qty);
      expect(qty).toHaveAttribute('aria-valuenow', '1000');
      if (order === 'sin elegir la variante antes') await chooseFirst(user);
      const price = Number(subtotal(container)!.replace(/\D/g, '')) / 1000;
      expect(Number.isInteger(price) && price > 0).toBe(true);
      expect(qty).toHaveAttribute('aria-valuenow', '1000');
      await user.click(screen.getByRole('button', { name: /Solicitar pedido/ }));
      await waitFor(() => expect(savedRequest()).toHaveLength(1));
      expect(savedRequest()[0]).toMatchObject({ jumpsellerId: oneAxis.jumpseller_id, quantity: 1000, unitPrice: price });
      await user.click(screen.getAllByRole('button', { name: /^Cotizar$/ })[0]);
      await waitFor(() => expect(savedQuote()).toHaveLength(1));
      expect(savedQuote()[0]).toMatchObject({ quantity: 1000 });
    });
  }

  it('producto sin variantes: «1.000» y Enter (sin salir del campo) y luego los botones: 1000', async () => {
    const user = userEvent.setup();
    renderPdp(panel);
    const qty = quantityField(panel);
    await typeOver(user, qty, '1.000');
    await user.keyboard('{Enter}');
    expect(qty.value).toBe('1000');
    expect(qty).toHaveAttribute('aria-valuenow', '1000');
    await user.click(screen.getByRole('button', { name: /Solicitar pedido/ }));
    await waitFor(() => expect(savedRequest()).toHaveLength(1));
    expect(savedRequest()[0]).toMatchObject({ jumpsellerId: panel.jumpseller_id, quantity: 1000 });
    await user.click(screen.getAllByRole('button', { name: /^Cotizar$/ })[0]);
    await waitFor(() => expect(savedQuote()).toHaveLength(1));
    expect(savedQuote()[0]).toMatchObject({ quantity: 1000 });
  });
});

describe('ficha: caja «Estudio DIALux (servicio cotizado)» (E-02)', () => {
  it.skipIf(!campana)('campana: la caja bajo los botones, con su texto y el enlace al formulario con el tipo y la ficha', () => {
    const p = campana!;
    renderPdp(p);
    const aside = box()!;
    expect(aside).not.toBeNull();
    expect(within(aside).getByText(DIALUX_BOX_TEXT.title)).toBeInTheDocument();
    expect(within(aside).getByText(DIALUX_BOX_TEXT.text)).toBeInTheDocument();
    const link = within(aside).getByRole('link', { name: DIALUX_BOX_TEXT.button });
    expect(link.getAttribute('href')).toBe(`/estudio-luminico?tipo=industria_bodega&producto=${p.id}#solicitar`);
    expect(screen.getByRole('complementary', { name: DIALUX_BOX_TEXT.title })).toBe(aside);
    // Después de los botones principales
    const request = screen.getByRole('button', { name: /Solicitar pedido/ });
    expect(request.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.skipIf(!proyector)('proyector: el enlace no preselecciona el tipo', () => {
    renderPdp(proyector!);
    expect(within(box()!).getByRole('link').getAttribute('href')).toBe(`/estudio-luminico?producto=${proyector!.id}#solicitar`);
  });

  it('una ficha fuera de esas categorías no la lleva', () => {
    renderPdp(panel);
    expect(box()).toBeNull();
    expect(screen.queryByText(DIALUX_BOX_TEXT.title)).not.toBeInTheDocument();
  });

  it.skipIf(!campana)('el enlace abre el formulario del estudio con el tipo preseleccionado y la ficha anotada, y baja al formulario', async () => {
    const p = campana!;
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderPdp(p);
    fireEvent.click(within(box()!).getByRole('link', { name: DIALUX_BOX_TEXT.button }));
    const tipo = await screen.findByLabelText(/Tipo de proyecto/) as HTMLSelectElement;
    await waitFor(() => expect(tipo.value).toBe('industria_bodega'));
    expect((screen.getByLabelText(/Descripción del proyecto/) as HTMLTextAreaElement).value)
      .toBe(`Producto de referencia: ${SITE_URL}/producto/${p.id}`);
    expect(scroll.mock.contexts.some(el => (el as Element).id === 'solicitar')).toBe(true);
  });

  it('la llevan justo las fichas de las cinco categorías, salvo las excluidas', () => {
    for (const p of products) expect(Boolean(studyBoxHref(p)), p.id).toBe(inStudyList(p));
  });

  const tripode = products.find(p => p.jumpseller_id === 3770404);
  it.skipIf(!tripode)('el trípode para proyector (un accesorio) no la lleva', () => {
    renderPdp(tripode!);
    expect(box()).toBeNull();
  });
});

describe('ficha: «Pedir documentos técnicos» (D-02, paso 1)', () => {
  it('sin variante: correo a ventas con el producto, el SKU de la línea y la ficha', () => {
    renderPdp(panel);
    const { address, subject, body } = mail(docsLink().getAttribute('href')!);
    const sku = requestSku(panel);
    expect(address).toBe(contactEmail);
    expect(address).toBe('ventas@elights.cl');
    expect(subject).toBe(`Documentos técnicos: ${panel.name} (SKU ${sku})`);
    expect(body).toContain(`Producto: ${panel.name}\r\n`);
    expect(body).toContain(`SKU: ${sku}\r\n`);
    expect(body).toContain(`Ficha: ${SITE_URL}/producto/${panel.id}\r\n`);
    // No promete documentos que el producto puede no tener
    expect(body).not.toMatch(/IES|LDT|certificad|D\.\s?S\.|DS ?1|SEC/);
    expect(screen.getByText(`Abre un correo a ${contactEmail} con el producto y el SKU.`)).toBeInTheDocument();
    expect(docsLink().getAttribute('aria-describedby')).toBe(screen.getByText(/^Abre un correo a/).id);
  });

  it('con la variante elegida: su etiqueta y su SKU en el asunto', () => {
    const p = oneAxis;
    const [axis] = variantAxes(p);
    renderPdp(p);
    const radios = within(screen.getByRole('radiogroup', { name: axis.legend })).getAllByRole('radio');
    fireEvent.click(radios[0]);
    const v = p.variants!.find(x => x.options.find(o => o.name === axis.name)?.value === axis.choices[0].value)!;
    const sku = expectedLineSku(p.jumpseller_id, v.id);
    const { subject, body } = mail(docsLink().getAttribute('href')!);
    expect(subject).toBe(`Documentos técnicos: ${p.name} – ${variantLabel(p, v)} (SKU ${sku})`);
    expect(body).toContain(`SKU: ${sku}\r\n`);
  });

  it('el botón no espera la variante: los documentos se piden por producto, con la opción en blanco para el cliente', () => {
    const [axis] = variantAxes(oneAxis);
    renderPdp(oneAxis);
    expect(screen.getByRole('button', { name: /Solicitar pedido/ })).toBeDisabled();
    const { subject, body } = mail(docsLink().getAttribute('href')!);
    expect(subject).toBe(`Documentos técnicos: ${oneAxis.name} (SKU ${requestSku(oneAxis)})`);
    expect(body).toContain(`Producto: ${oneAxis.name}\r\n${axis.legend}:\r\nSKU: `);
  });

  it('con la variante elegida, el cuerpo no repite la opción en blanco', () => {
    const [axis] = variantAxes(oneAxis);
    renderPdp(oneAxis);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: axis.legend })).getAllByRole('radio')[0]);
    expect(mail(docsLink().getAttribute('href')!).body).not.toContain(`${axis.legend}:`);
  });

  it('BESTLED sin variante: «Temperatura de color:» en blanco (sus certificados son por variante)', () => {
    renderPdp(bestled);
    expect(mail(docsLink().getAttribute('href')!).body).toMatch(/\r\nTemperatura de color:\r\nSKU: /);
  });

  it('BESTLED: «Ficha técnica (PDF)» destacada, justo debajo de Solicitar pedido / Cotizar, y el bloque para pedir lo demás', () => {
    renderPdp(bestled);
    const [datasheet, ...rest] = datasheetButtons();
    expect(rest).toEqual([]);
    expect(datasheet).toHaveAccessibleName('Ficha técnica (PDF)');
    // Su PDF editorial (gana al de Jumpseller), propio del sitio: se descarga
    expect(datasheet.getAttribute('href')).toBe(bestled.datasheetUrl);
    expect(datasheet.hasAttribute('download')).toBe(true);
    expectProminent(datasheet);
    expect(datasheetRow(datasheet).previousElementSibling).toBe(ctaRow());
    // Arriba, sobre el título y antes del selector, el acceso corto al mismo PDF
    expectShortcutOnTop();
    expect(shortcut()).toHaveAccessibleName('Ficha técnica (PDF)');
    expect(shortcut().getAttribute('href')).toBe(bestled.datasheetUrl);
    expect(shortcut().hasAttribute('download')).toBe(true);
    // Fuera del bloque «Documentos técnicos», que sigue para pedir IES y certificados por variante
    const block = screen.getByRole('region', { name: 'Documentos técnicos' });
    expect(within(block).getByRole('link', { name: 'Pedir documentos técnicos' })).toBeInTheDocument();
    expect(within(block).queryByRole('link', { name: /Ficha técnica/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pedir ficha técnica' })).not.toBeInTheDocument();
  });

  it('con PDF adjunto en Jumpseller: un botón destacado al PDF del CDN, en otra pestaña; WhatsApp queda en su fila', () => {
    renderPdp(oneSheet);
    const [datasheet, ...rest] = datasheetButtons();
    expect(rest).toEqual([]);
    expect(datasheet).toHaveAccessibleName('Ficha técnica (PDF)');
    expect(datasheet.getAttribute('href')).toBe(productDatasheets[oneSheet.jumpseller_id][0]);
    expect(datasheet.getAttribute('target')).toBe('_blank');
    expect(datasheet.getAttribute('rel')).toBe('noopener noreferrer');
    // `download` no sirve en otro dominio: el PDF se abre en otra pestaña
    expect(datasheet.hasAttribute('download')).toBe(false);
    expectProminent(datasheet);
    expect(datasheetRow(datasheet).previousElementSibling).toBe(ctaRow());
    // WhatsApp, en la fila siguiente y con su estilo de siempre
    const wa = screen.getByRole('link', { name: /Escríbenos por WhatsApp/ });
    expect(wa.parentElement).not.toBe(datasheet.parentElement);
    expect(datasheetRow(datasheet).nextElementSibling).toBe(wa.parentElement);
    expect(wa.querySelector('button')).toBeNull();
    expect(screen.getByRole('region', { name: 'Documentos técnicos' })).toBeInTheDocument();
    // El acceso corto de arriba abre el mismo PDF, también en otra pestaña
    expectShortcutOnTop();
    expect(shortcut()).toHaveAccessibleName('Ficha técnica (PDF)');
    expect(shortcut().getAttribute('href')).toBe(datasheet.getAttribute('href'));
    expect(shortcut().getAttribute('target')).toBe('_blank');
    expect(shortcut().getAttribute('rel')).toBe('noopener noreferrer');
    expect(shortcut().hasAttribute('download')).toBe(false);
  });

  it('con varios PDF en Jumpseller: un botón por PDF, con su potencia, de menor a mayor y en la misma grilla', () => {
    renderPdp(manySheets);
    const links = datasheetButtons();
    expect(links.map(l => l.textContent?.trim())).toEqual(['Ficha técnica 40W (PDF)', 'Ficha técnica 80W (PDF)']);
    expect(links.map(l => l.getAttribute('href'))).toEqual([...productDatasheets[manySheets.jumpseller_id]].reverse());
    for (const l of links) expectProminent(l);
    expect(new Set(links.map(l => l.parentElement)).size).toBe(1);
    expect(datasheetRow(links[0]).previousElementSibling).toBe(ctaRow());
  });

  it('con varios PDF: el acceso corto «Fichas técnicas (PDF)» baja a los botones y le pasa el foco al primero, sin cambiar la URL', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      renderPdp(manySheets);
      expectShortcutOnTop();
      const a = shortcut();
      expect(a).toHaveAccessibleName('Fichas técnicas (PDF)');
      expect(a.getAttribute('href')).toBe('#ficha-tecnica');
      expect(a.hasAttribute('target')).toBe(false);
      const row = document.getElementById('ficha-tecnica')!;
      expect(row.hasAttribute('data-datasheets')).toBe(true);
      expect(fireEvent.click(a)).toBe(false); // sin navegar: el ancla queda solo para sin JS
      expect(document.activeElement).toBe(datasheetButtons()[0]);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(row);
      expect(scroll.mock.calls[0][0]).toMatchObject({ block: 'center' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('sin PDF: «Pedir ficha técnica» igual de visible, en el mismo lugar, con el correo de «Pedir documentos técnicos» (sin repetirlo abajo)', () => {
    renderPdp(noSheet);
    expect(screen.queryByRole('link', { name: /^Fichas? técnicas?/ })).not.toBeInTheDocument();
    const [ask, ...rest] = datasheetButtons();
    expect(rest).toEqual([]);
    expect(ask).toHaveAccessibleName('Pedir ficha técnica');
    expectProminent(ask);
    expect(datasheetRow(ask).previousElementSibling).toBe(ctaRow());
    const { address, subject } = mail(ask.getAttribute('href')!);
    expect(address).toBe(contactEmail);
    expect(subject).toBe(`Documentos técnicos: ${noSheet.name} (SKU ${requestSku(noSheet)})`);
    expect(ask.getAttribute('aria-describedby')).toBe(screen.getByText(`Abre un correo a ${contactEmail} con el producto y el SKU.`).id);
    // El mismo correo no se ofrece dos veces
    expect(screen.queryByRole('region', { name: 'Documentos técnicos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pedir documentos técnicos' })).not.toBeInTheDocument();
    expect([...document.querySelectorAll('a')].filter(a => a.getAttribute('href') === ask.getAttribute('href'))).toHaveLength(1);
    // Arriba, «Pedir ficha técnica» no abre el correo: baja a este botón y su nota
    expectShortcutOnTop();
    expect(shortcut()).toHaveAccessibleName('Pedir ficha técnica');
    expect(shortcut().getAttribute('href')).toBe('#ficha-tecnica');
    expect(fireEvent.click(shortcut())).toBe(false);
    expect(document.activeElement).toBe(ask);
  });

  it('en todas las fichas, siempre a ventas@elights.cl', () => {
    // Una muestra por categoría: cada ficha dibuja el mismo bloque
    const sample = [...new Map(products.map(p => [p.category, p])).values()];
    for (const p of sample) {
      const { unmount } = renderPdp(p);
      const href = docsLink().getAttribute('href')!;
      expect(href.startsWith(`mailto:${contactEmail}?subject=`), p.id).toBe(true);
      expect(mail(href).subject, p.id).toContain(p.name);
      unmount();
    }
  });
});
