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
    const link = screen.getByRole('link', { name: 'Ficha técnica' });
    expect(link).toHaveAttribute('href', `/fichas/APB${watts}.pdf`);
    expect(link).toHaveAttribute('download');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // Desde una ficha anidada y con otro dominio, el PDF se resuelve en la raíz del mismo sitio.
    expect(new URL(link.getAttribute('href')!, `https://sitio.example/producto/bestled-${watts}`).href)
      .toBe(`https://sitio.example/fichas/APB${watts}.pdf`);
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
