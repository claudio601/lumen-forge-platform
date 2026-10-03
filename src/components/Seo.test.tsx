import { describe, expect, it } from 'vitest';
import { Suspense } from 'react';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import Seo from './Seo';
import { SITE_URL } from '@/config/site';
import { SPA_HEAD } from '@/entry-server';
import indexHtml from '../../index.html?raw';

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

  it('con el <head> de spa.html no quedan etiquetas repetidas: las de la página reemplazan las fijas', async () => {
    const html = indexHtml.replace('<!--app-head-->', SPA_HEAD);
    document.head.innerHTML = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
    render(
      <HelmetProvider>
        <Seo title="Proyector 200W | eLIGHTS" description="desc producto" path="/producto/x" type="product" image="https://img/x.png" />
      </HelmetProvider>,
    );
    await waitFor(() => expect(head('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE_URL}/producto/x`));
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    for (const sel of ['meta[property="og:image"]', 'meta[property="og:title"]', 'meta[property="og:type"]', 'meta[name="twitter:image"]', 'meta[property="og:url"]']) {
      expect(document.head.querySelectorAll(sel), sel).toHaveLength(1);
    }
    expect(head('meta[name="description"]')?.getAttribute('content')).toBe('desc producto');
    expect(head('meta[property="og:image"]')?.getAttribute('content')).toBe('https://img/x.png');
    expect(head('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE_URL}/producto/x`);
    expect(head('meta[name="robots"]')).toBeNull(); // el noindex de spa.html era de la app vacía
  });

  it('un render que React descarta no deja sus etiquetas registradas para las páginas siguientes', async () => {
    // La página "fantasma" se dibuja junto a algo que suspende para siempre: React descarta
    // ese render y muestra el fallback. Pasa al hidratar una página estática.
    const never = new Promise<never>(() => undefined);
    const Suspends = () => {
      throw never;
    };
    renderSeo(
      <>
        <Suspense fallback={null}>
          <Seo title="Fantasma" description="d" path="/fantasma" jsonLd={[{ '@type': 'Thing', name: 'fantasma' }]} />
          <Suspends />
        </Suspense>
        <Seo title="Real" description="d" path="/real" />
      </>,
    );
    await waitFor(() => expect(document.title).toBe('Real'));
    expect(head('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_URL}/real`);
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
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
