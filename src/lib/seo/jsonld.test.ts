import { describe, expect, it } from 'vitest';
import { products } from '@/data/products';
import { SITE_URL } from '@/config/site';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  itemListJsonLd,
  organizationJsonLd,
  productJsonLd,
  serializeJsonLd,
} from './jsonld';

describe('JSON-LD', () => {
  it('un texto con </script> no puede cerrar el bloque <script>', () => {
    const out = serializeJsonLd(faqJsonLd([{ question: 'x', answer: 'a </script><script>alert(1)</script>' }]));
    expect(out).not.toContain('<');
    expect(JSON.parse(out).mainEntity[0].acceptedAnswer.text).toBe('a </script><script>alert(1)</script>');
  });

  it('producto: precio con IVA del catálogo, en CLP, y nunca disponibilidad (no hay control de stock)', () => {
    const p = products[0];
    const ld = productJsonLd(p, 'desc') as { offers: Record<string, unknown> };
    expect(ld.offers).toMatchObject({ priceCurrency: 'CLP', price: p.price, url: `${SITE_URL}/producto/${p.id}` });
    expect(JSON.stringify(ld)).not.toMatch(/availability|InStock|OutOfStock/);
  });

  it('organización con la razón social y Santiago, sin calle', () => {
    expect(organizationJsonLd()).toMatchObject({
      legalName: 'eLIGHTS.CL SpA',
      address: { addressLocality: 'Santiago', addressCountry: 'CL' },
    });
    expect(JSON.stringify(organizationJsonLd())).not.toContain('streetAddress');
  });

  it('migas y listas con posiciones y URLs absolutas (la página 2 sigue numerando)', () => {
    const crumbs = breadcrumbJsonLd([{ name: 'Inicio', path: '/' }, { name: 'Catálogo', path: '/catalogo' }]) as {
      itemListElement: { position: number; item: string }[];
    };
    expect(crumbs.itemListElement.map(c => [c.position, c.item])).toEqual([[1, `${SITE_URL}/`], [2, `${SITE_URL}/catalogo`]]);
    const list = itemListJsonLd(products.slice(0, 2), 25) as { itemListElement: { position: number; url: string }[] };
    expect(list.itemListElement[0]).toMatchObject({ position: 25, url: `${SITE_URL}/producto/${products[0].id}` });
  });
});
