import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import Seo from './Seo';
import { SITE_URL } from '@/config/site';

const head = (selector: string) => document.head.querySelector(selector);

function renderSeo(ui: React.ReactElement) {
  document.head.innerHTML = '';
  return render(<HelmetProvider>{ui}</HelmetProvider>);
}

describe('<Seo>', () => {
  it('canonical, og:url e imagen absolutos; imagen por defecto en JPEG (las redes no muestran SVG)', async () => {
    renderSeo(<Seo title="Paneles LED | eLIGHTS" description="d" path="/catalogo/paneles-led?page=2" />);
    await waitFor(() => expect(document.title).toBe('Paneles LED | eLIGHTS'));
    expect(head('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_URL}/catalogo/paneles-led?page=2`);
    expect(head('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE_URL}/catalogo/paneles-led?page=2`);
    expect(head('meta[property="og:image"]')?.getAttribute('content')).toBe(`${SITE_URL}/og-default.jpg`);
    expect(head('meta[name="robots"]')).toBeNull();
  });

  it('noindex: robots noindex y sin canonical ni og:url', async () => {
    renderSeo(<Seo title="Buscar" description="d" path="/buscar" noindex />);
    await waitFor(() => expect(document.title).toBe('Buscar'));
    expect(head('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
    expect(head('link[rel="canonical"]')).toBeNull();
    expect(head('meta[property="og:url"]')).toBeNull();
  });

  it('una imagen absoluta (foto de Jumpseller) se usa tal cual; el JSON-LD va en su propio script', async () => {
    renderSeo(
      <Seo
        title="Producto"
        description="d"
        path="/producto/x"
        type="product"
        image="https://images.jumpseller.com/store/elights-cl/1/x.png"
        jsonLd={[{ '@type': 'Product', name: 'x </script>' }]}
      />,
    );
    await waitFor(() => expect(document.title).toBe('Producto'));
    expect(head('meta[property="og:image"]')?.getAttribute('content')).toBe('https://images.jumpseller.com/store/elights-cl/1/x.png');
    expect(head('meta[property="og:type"]')?.getAttribute('content')).toBe('product');
    const ld = head('script[type="application/ld+json"]')?.textContent ?? '';
    expect(JSON.parse(ld)).toEqual({ '@type': 'Product', name: 'x </script>' });
  });
});
