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
    expect(head('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
    expect(head('meta[property="og:image:height"]')?.getAttribute('content')).toBe('630');
    expect(head('meta[property="og:image:alt"]')?.getAttribute('content')?.trim()).toBeTruthy();
    expect(head('meta[name="twitter:image"]')?.getAttribute('content')).toBe(`${SITE_URL}/og-default.jpg`);
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
        <Seo
          title="Proyector 200W | eLIGHTS"
          description="desc producto"
          path="/producto/x"
          type="product"
          image={{ url: 'https://img/x.png', width: 600, height: 600, alt: 'Proyector 200W' }}
        />
      </HelmetProvider>,
    );
    await waitFor(() => expect(head('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE_URL}/producto/x`));
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    for (const sel of [
      'meta[property="og:image"]',
      'meta[property="og:image:width"]',
      'meta[property="og:image:height"]',
      'meta[property="og:image:alt"]',
      'meta[property="og:title"]',
      'meta[property="og:type"]',
      'meta[name="twitter:image"]',
      'meta[property="og:url"]',
    ]) {
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

  it('una foto sin medidas conocidas: og:image y alt, sin og:image:width ni og:image:height', async () => {
    renderSeo(<Seo title="Sin medidas" description="d" path="/producto/y" type="product" image={{ url: 'https://images.jumpseller.com/store/elights-cl/2/a.jpg?1', alt: 'FOCO' }} />);
    await waitFor(() => expect(document.title).toBe('Sin medidas'));
    expect(head('meta[property="og:image"]')?.getAttribute('content')).toBe('https://images.jumpseller.com/store/elights-cl/2/a.jpg?1');
    expect(head('meta[property="og:image:alt"]')?.getAttribute('content')).toBe('FOCO');
    expect(head('meta[property="og:image:width"]')).toBeNull();
    expect(head('meta[property="og:image:height"]')).toBeNull();
  });

  it('una foto de Jumpseller con tildes va codificada, igual en og:image y twitter:image, con sus medidas; el JSON-LD va en su propio script', async () => {
    renderSeo(
      <Seo
        title="Producto"
        description="d"
        path="/producto/x"
        type="product"
        image={{ url: 'https://images.jumpseller.com/store/elights-cl/1/FOCO-MONOFÁSICO.png?1', width: 598, height: 602, alt: 'FOCO LED MONOFÁSICO' }}
        jsonLd={[{ '@type': 'Product', name: 'x </script>' }]}
      />,
    );
    await waitFor(() => expect(document.title).toBe('Producto'));
    const encoded = 'https://images.jumpseller.com/store/elights-cl/1/FOCO-MONOF%C3%81SICO.png?1';
    expect(head('meta[property="og:image"]')?.getAttribute('content')).toBe(encoded);
    expect(head('meta[name="twitter:image"]')?.getAttribute('content')).toBe(encoded);
    expect(head('meta[property="og:image:width"]')?.getAttribute('content')).toBe('598');
    expect(head('meta[property="og:image:height"]')?.getAttribute('content')).toBe('602');
    expect(head('meta[property="og:image:alt"]')?.getAttribute('content')).toBe('FOCO LED MONOFÁSICO');
    expect(head('meta[property="og:image:type"]')).toBeNull();
    expect(head('meta[property="og:image:secure_url"]')).toBeNull();
    expect(head('meta[property="og:type"]')?.getAttribute('content')).toBe('product');
    const ld = head('script[type="application/ld+json"]')?.textContent ?? '';
    expect(JSON.parse(ld)).toEqual({ '@type': 'Product', name: 'x </script>' });
  });
});
