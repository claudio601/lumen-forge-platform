import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductDetail from './ProductDetail';
import proyector100 from '@/data/catalog/content/2252962.json';
import { products } from '@/data/products';
import { productDatasheets } from '@/data/catalog/datasheets.generated';
import { productDatasheetLinks } from '@/lib/datasheets';
import { PANEL_MASTER_BOX, panelRegionShippingNotice } from '@/config/business';
import { isSyncBot } from '@/test/syncBot';

const BESTLED = 'alumbrado-publico-bestled-150w-ip66-ik08';

function renderPdp(id: string) {
  return render(
    <HelmetProvider>
      <TooltipProvider>
        <AppProvider>
          <RequestCartProvider>
            <MemoryRouter initialEntries={[`/producto/${id}`]}>
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

describe('ProductDetail: fichas PDF BESTLED', () => {
  it.each([40, 60, 90, 120, 150, 200, 250])('BESTLED %iW: enlace relativo al PDF con descarga y apertura en otra pestaña', (watts) => {
    renderPdp(`alumbrado-publico-bestled-${watts}w-ip66-ik08`);
    // El botón bajo Solicitar pedido / Cotizar y el acceso corto sobre el título: el mismo PDF
    const links = screen.getAllByRole('link', { name: 'Ficha técnica (PDF)' });
    expect(links.map(a => a.hasAttribute('data-datasheet-shortcut') || !!a.closest('[data-datasheets]'))).toEqual([true, true]);
    for (const link of links) {
      expect(link).toHaveAttribute('href', `/fichas/APB${watts}.pdf`);
      expect(link).toHaveAttribute('download');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // Desde una ficha anidada y con otro dominio, el PDF se resuelve en la raíz del mismo sitio.
      expect(new URL(link.getAttribute('href')!, `https://sitio.example/producto/bestled-${watts}`).href)
        .toBe(`https://sitio.example/fichas/APB${watts}.pdf`);
    }
  });
});

// Todas las fichas publicadas tienen su botón de ficha técnica bajo Solicitar pedido / Cotizar
// (reclamos de clientes, 2026-11-11): uno por PDF, o «Pedir ficha técnica» si Jumpseller no
// tiene el PDF, y un acceso corto sobre el título. Datos del día, pero la regla no depende de cuáles productos tienen PDF.
describe('ProductDetail: botón de ficha técnica en todas las fichas', () => {
  const sheets = (p: (typeof products)[number]) => productDatasheetLinks(p.datasheetUrl, productDatasheets[p.jumpseller_id]);
  // Una ficha por categoría, más una con varios PDF y una sin PDF si las hay
  const sample = [...new Map(products.map(p => [p.category, p])).values()];
  const many = products.find(p => sheets(p).length > 1);
  const none = products.find(p => sheets(p).length === 0);
  for (const p of [many, none]) if (p && !sample.includes(p)) sample.push(p);

  it.each(sample.map(p => [p.id, p] as const))('%s', (_id, p) => {
    renderPdp(p.id);
    const row = screen.getByRole('button', { name: /Solicitar pedido/ }).parentElement!.nextElementSibling as HTMLElement;
    expect(row.hasAttribute('data-datasheets')).toBe(true);
    const links = [...row.querySelectorAll('a')];
    const expected = sheets(p);
    if (expected.length) {
      expect(links.map(a => a.textContent?.trim())).toEqual(expected.map(d => `${d.label} (PDF)`));
      expect(links.map(a => a.getAttribute('href'))).toEqual(expected.map(d => d.href));
    } else {
      expect(links.map(a => a.textContent?.trim())).toEqual(['Pedir ficha técnica']);
      expect(links[0].getAttribute('href')).toMatch(/^mailto:/);
    }
    // Acceso corto sobre el título (a la vista también con selector de variante): con un PDF, el
    // PDF; con varios o sin PDF, el ancla de esa fila
    const shortcuts = document.querySelectorAll('[data-datasheet-shortcut]');
    expect(shortcuts).toHaveLength(1);
    const shortcut = shortcuts[0];
    expect(shortcut.parentElement!.nextElementSibling!.tagName).toBe('H1'); // en la línea del código
    expect(row.id).toBe('ficha-tecnica');
    if (expected.length === 1) {
      expect(shortcut.textContent?.trim()).toBe(`${expected[0].label} (PDF)`);
      expect(shortcut.getAttribute('href')).toBe(expected[0].href);
    } else {
      expect(shortcut.textContent?.trim()).toBe(expected.length ? 'Fichas técnicas (PDF)' : 'Pedir ficha técnica');
      expect(shortcut.getAttribute('href')).toBe('#ficha-tecnica');
    }
  });
});

// Paneles de formato grande (regla del dueño A22, decisión 2A, 2026-11-13): a regiones solo desde su
// caja master (el slim 60x60, desde 4 unidades); con menos, retiro en bodega. Junto al despacho.
describe('ProductDetail: paneles de formato grande a regiones', () => {
  const PANELS: Record<number, string> = {
    3702364: 'Despacho a regiones: desde 6 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    4426526: 'Despacho a regiones: desde 6 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    4190659: 'Despacho a regiones: desde 10 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    2347772: 'Despacho a regiones: desde 6 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    2348936: 'Despacho a regiones: desde 6 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    2347854: 'Despacho a regiones: desde 10 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    2348922: 'Despacho a regiones: desde una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    2347849: 'Despacho a regiones: desde 10 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    21766686: 'Despacho a regiones: desde 10 unidades, una caja completa. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    4608256: 'Despacho a regiones: desde 4 unidades. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
    2501112: 'Despacho a regiones: desde 4 unidades. Con menos unidades, retiro en nuestra bodega en Quinta Normal.',
  };

  it('los 11 paneles de la regla, cada uno con su aviso', () => {
    expect(Object.keys(PANEL_MASTER_BOX).map(Number).sort()).toEqual(Object.keys(PANELS).map(Number).sort());
    for (const id of Object.keys(PANELS).map(Number)) expect(panelRegionShippingNotice(id)).toBe(PANELS[id]);
  });

  // Datos del día: si Jumpseller despublica uno, el robot no se bloquea (src/test/syncBot.ts)
  it.skipIf(isSyncBot)('los 11 están publicados en Paneles LED', () => {
    for (const id of Object.keys(PANELS).map(Number)) {
      expect(products.find(p => p.jumpseller_id === id)?.category, String(id)).toBe('paneles-led');
    }
  });

  const published = Object.entries(PANELS).filter(([id]) => products.some(p => p.jumpseller_id === Number(id)));
  it.each(published)('%s: el aviso junto al despacho, con enlace a /despacho', (id, notice) => {
    const p = products.find(x => x.jumpseller_id === Number(id))!;
    renderPdp(p.id);
    const el = document.querySelector('[data-panel-shipping]')!;
    expect(el.textContent).toBe(`${notice} Ver despacho`);
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/despacho');
    // Va justo después de la fila de «Despacho en hasta 2 días hábiles»
    expect(el.previousElementSibling?.textContent).toContain('Despacho en hasta 2 días hábiles');
    // Sin promesa de despacho sin costo ni redondeo a cajas
    expect(el.textContent).not.toMatch(/sin costo|gratis|m[uú]ltiplos|por caja\b/i);
  });

  it('los paneles chicos (redondos y cuadrados) y los demás productos no llevan el aviso', () => {
    const small = products.filter(p => p.category === 'paneles-led' && /PANEL LED (?:REDONDO|CUADRADO)/i.test(p.name));
    expect(small.length).toBeGreaterThan(0);
    for (const p of small) expect(panelRegionShippingNotice(p.jumpseller_id), p.name).toBeNull();
    renderPdp(small[0].id);
    expect(document.querySelector('[data-panel-shipping]')).toBeNull();
  });
});

describe('ProductDetail: modelo cotización, nunca stock', () => {
  beforeEach(() => sessionStorage.clear());

  it('muestra "Consultar disponibilidad" y ninguna mención a stock', () => {
    const { container } = renderPdp(BESTLED);
    const link = screen.getAllByRole('link', { name: 'Consultar disponibilidad' })[0];
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
    expect(container.textContent).not.toMatch(/stock/i);
  });

  it('el despacho prometido es "hasta 2 días hábiles"', () => {
    renderPdp(BESTLED);
    expect(screen.getByText('Despacho en hasta 2 días hábiles')).toBeInTheDocument();
  });

  it('el JSON-LD del producto es válido y no declara disponibilidad', async () => {
    renderPdp(BESTLED);
    // La BESTLED cuesta más en 2200K y 2700K (auditoría UX, I-03): el rango de sus variantes, con IVA
    const prices = products.find(p => p.id === BESTLED)!.variants!.map(v => v.price);
    expect(new Set(prices).size).toBeGreaterThan(1);
    await waitFor(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      const product = scripts.map(s => JSON.parse(s.textContent || '{}')).find(j => j['@type'] === 'Product');
      expect(product).toBeDefined();
      expect(product.offers).toMatchObject({
        '@type': 'AggregateOffer',
        priceCurrency: 'CLP',
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: prices.length,
      });
      expect(product.offers).not.toHaveProperty('availability');
    });
  });
});

const sectionOf = async (heading: string) => (await screen.findByRole('heading', { name: heading, level: 2 })).closest('section')!;

describe('ProductDetail: descripción y especificaciones en el formato BESTLED', () => {
  it('la tabla de Jumpseller se muestra en los grupos de las BESTLED, no como descripción', async () => {
    const { container } = renderPdp('amp-led-ar111-15-150w');
    const specs = await sectionOf('Especificaciones técnicas');
    const groups = [...specs.querySelectorAll('h3')].map(h => h.textContent);
    expect(groups).toEqual(['Eléctrico y fotométrico', 'Construcción y operación', 'Componentes y control']);
    expect(specs.textContent).toContain('G53');
    expect(specs.querySelector('table')).toBeNull();
    // La tabla ya no aparece en "Descripción" (antes se mostraba ahí)
    const description = screen.queryByRole('heading', { name: 'Descripción', level: 2 })?.closest('section');
    expect(description?.querySelector('table') ?? null).toBeNull();
    expect(container.querySelector('script:not([type="application/ld+json"])')).toBeNull();
  });

  it('con texto en Jumpseller: el texto va en Descripción y la tabla en Especificaciones técnicas', async () => {
    renderPdp('panel-led-backlight-60x60-cm-48w-para-cielo-americano');
    const description = await sectionOf('Descripción');
    expect(description.textContent).toContain('Panel LED Backlight 60x60');
    expect(description.querySelector('table')).toBeNull();
    const specs = await sectionOf('Especificaciones técnicas');
    expect(specs.textContent).toContain('Eléctrico y fotométrico');
  });

  it('una comparativa de varias columnas se conserva como tabla', async () => {
    renderPdp('alumbrado-publico-led-solar-flyhawk-40-80w');
    const specs = await sectionOf('Especificaciones técnicas');
    expect(specs.querySelector('table')?.textContent).toContain('Flyhawk 60W');
  });

  it('los BESTLED conservan el texto y las especificaciones editoriales del prototipo', async () => {
    renderPdp(BESTLED);
    const description = await sectionOf('Descripción');
    expect(description.textContent).toContain('La luminaria LED BESTLED 150W');
    expect(description.querySelector('.prose')).toBeNull();
    const specs = await sectionOf('Especificaciones técnicas');
    expect(specs.textContent).toContain('Philips Lumileds 2835');
  });
});

describe('ProductDetail: contenido SEO en el formato BESTLED', () => {
  it('carga el contenido del producto: descripción con subtítulos, beneficios, casos de uso y preguntas', async () => {
    renderPdp('proyector-led-antivandalico-100w-ip66');
    const benefits = await sectionOf('Beneficios clave');
    expect(benefits.querySelectorAll('li')).toHaveLength(proyector100.keyBenefits.length);
    const description = await sectionOf('Descripción');
    expect(description.querySelectorAll('h3').length).toBeGreaterThanOrEqual(2);
    expect(description.textContent).not.toContain('**');
    await sectionOf('Casos de uso');
    const faq = await sectionOf('Preguntas frecuentes');
    expect(faq.textContent).toContain(proyector100.faq[0].question);
    // Las respuestas están en el HTML aunque el acordeón esté cerrado (las declara el FAQPage)
    expect(faq.textContent).toContain(proyector100.faq[0].answer.slice(0, 60));
    expect(screen.getByText(proyector100.faq[0].answer).closest('[data-state]')?.getAttribute('data-state')).toBe('closed');
    // Las especificaciones de Jumpseller siguen ahí
    expect((await sectionOf('Especificaciones técnicas')).textContent).toContain('Eléctrico y fotométrico');
  });

  it('título, descripción y preguntas frecuentes llegan a Google (meta y datos estructurados)', async () => {
    renderPdp('proyector-led-antivandalico-100w-ip66');
    await waitFor(() => {
      expect(document.title).toBe(proyector100.metaTitle);
      expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(proyector100.metaDescription);
      const ld = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent!));
      expect(ld.find(d => d['@type'] === 'FAQPage')?.mainEntity).toHaveLength(proyector100.faq.length);
      const product = ld.find(d => d['@type'] === 'Product');
      // La descripción del contenido, en texto plano (sin ** de negritas ni viñetas)
      expect(product?.description).toContain(proyector100.description.split('\n')[0].replace(/\*\*/g, '').slice(0, 60));
      expect(product?.description).not.toMatch(/\*\*|<[a-z]/);
    });
  });

});
