import { describe, expect, it } from 'vitest';
import { products } from '@/data/products';
import { SITE_URL } from '@/config/site';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
  itemListJsonLd,
  organizationJsonLd,
  productJsonLd,
  productOffer,
  productSku,
  MAX_SKU_LENGTH,
  serializeJsonLd,
} from './jsonld';

describe('JSON-LD', () => {
  it('un texto con </script> no puede cerrar el bloque <script>', () => {
    const out = serializeJsonLd(faqJsonLd([{ question: 'x', answer: 'a </script><script>alert(1)</script>' }]));
    expect(out).not.toContain('<');
    expect(JSON.parse(out).mainEntity[0].acceptedAnswer.text).toBe('a </script><script>alert(1)</script>');
  });

  it('producto: precio con IVA del catálogo, en CLP, y nunca disponibilidad (no hay control de stock)', () => {
    const p = products.find(x => new Set((x.variants ?? []).map(v => v.price)).size <= 1)!;
    const ld = productJsonLd(p, 'desc') as { offers: Record<string, unknown> };
    expect(ld.offers).toEqual({
      '@type': 'Offer',
      url: `${SITE_URL}/producto/${p.id}`,
      priceCurrency: 'CLP',
      price: p.price,
      seller: { '@type': 'Organization', name: 'eLIGHTS.cl' },
    });
    expect(JSON.stringify(ld)).not.toMatch(/availability|InStock|OutOfStock/);
  });

  // Search Console (11-11-2026): el sku caía al id del sitio y en 21 fichas pasaba los 50 caracteres
  it('sku y mpn: solo el SKU de Jumpseller (del producto o el único de sus variantes); si no hay, no van', () => {
    const base = { ...products[0], variants: undefined, singleVariant: undefined };
    const v = (sku: string) => ({ id: 1, sku, price: 1000, options: [] });
    const ld = (p: typeof base) => productJsonLd(p, 'desc') as Record<string, unknown>;
    expect(ld({ ...base, sku: 'PL6060BD' })).toMatchObject({ sku: 'PL6060BD', mpn: 'PL6060BD' });
    expect(ld({ ...base, sku: '', variants: [v('SPIR180N'), v('SPIR180N')] })).toMatchObject({ sku: 'SPIR180N', mpn: 'SPIR180N' });
    expect(ld({ ...base, sku: '', singleVariant: { sku: 'PLC20GC', options: [] } })).toMatchObject({ sku: 'PLC20GC' });
    for (const p of [
      { ...base, sku: '' },
      { ...base, sku: '', variants: [v('PL6060BDC'), v('PL6060BDN')] },
      { ...base, sku: 'X'.repeat(MAX_SKU_LENGTH + 1) },
    ]) {
      expect(ld(p)).not.toHaveProperty('sku');
      expect(ld(p)).not.toHaveProperty('mpn');
    }
  });

  it('en el catálogo: ninguna ficha publica un sku vacío, de más de 50 caracteres o que no venga de Jumpseller', () => {
    let withSku = 0;
    for (const p of products) {
      const sku = productSku(p);
      if (sku === undefined) continue;
      withSku++;
      expect(sku.length).toBeGreaterThan(0);
      expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
      const fromJumpseller = [p.sku, p.singleVariant?.sku, ...(p.variants ?? []).map(x => x.sku)].map(s => s?.trim());
      expect(fromJumpseller).toContain(sku);
    }
    expect(withSku).toBeGreaterThan(0);
  });

  // Auditoría UX, I-03: antes, un solo Offer con el precio más bajo (la 2700K costaba más)
  const variant = (id: number, price: number) => ({ id, sku: `S${id}`, price, options: [{ name: 'Temperatura', value: `${id}K` }] });

  it('producto con variantes de distinto precio (I-03): AggregateOffer con el rango y una oferta por variante, sin disponibilidad', () => {
    const p = { ...products[0], price: 118500, variants: [variant(2200, 130400), variant(2700, 130400), variant(4000, 118500), variant(5000, 118500)] };
    const ld = productJsonLd(p, 'desc') as { offers: Record<string, unknown> };
    expect(ld.offers).toEqual({
      '@type': 'AggregateOffer',
      url: `${SITE_URL}/producto/${p.id}`,
      priceCurrency: 'CLP',
      lowPrice: 118500,
      highPrice: 130400,
      offerCount: 4,
      seller: { '@type': 'Organization', name: 'eLIGHTS.cl' },
    });
    expect(JSON.stringify(ld)).not.toMatch(/availability|InStock|OutOfStock|"price"/);
  });

  it('producto con variantes del mismo precio, o con una sola: Offer con el precio', () => {
    const same = { ...products[0], price: 19900, variants: [variant(3000, 19900), variant(6000, 19900)] };
    expect(productOffer(same)).toMatchObject({ '@type': 'Offer', price: 19900 });
    expect(productOffer({ ...same, variants: undefined })).toMatchObject({ '@type': 'Offer', price: 19900 });
  });

  it('en el catálogo: cada ficha con variantes de distinto precio publica su rango con IVA (las BESTLED de alumbrado y la Flyhawk)', () => {
    const ranged = products.filter(p => new Set((p.variants ?? []).map(v => v.price)).size > 1);
    expect(ranged.length).toBeGreaterThan(0);
    for (const p of ranged) {
      const prices = p.variants!.map(v => v.price);
      expect(productOffer(p), p.id).toMatchObject({
        '@type': 'AggregateOffer',
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: prices.length,
      });
      // El precio «desde» de la ficha y de la tarjeta es el más bajo
      expect(Math.min(...prices), p.id).toBe(p.price);
    }
    for (const p of products) expect(JSON.stringify(productOffer(p)), p.id).not.toMatch(/availability|Stock/);
  });

  it('producto: todas las fotos originales (también WebP y pesadas), codificadas como og:image', () => {
    const p = { ...products[0], images: ['https://images.jumpseller.com/store/elights-cl/1/FOCO-MONOFÁSICO.png?1', 'https://images.jumpseller.com/store/elights-cl/1/b%2Cc.webp?2'] };
    const ld = productJsonLd(p, 'desc') as { image: string[] };
    expect(ld.image).toEqual([
      'https://images.jumpseller.com/store/elights-cl/1/FOCO-MONOF%C3%81SICO.png?1',
      'https://images.jumpseller.com/store/elights-cl/1/b%2Cc.webp?2',
    ]);
  });

  it('organización con la razón social, el RUT de la empresa y Santiago, sin calle', () => {
    expect(organizationJsonLd()).toMatchObject({
      legalName: 'eLIGHTS.CL SpA',
      taxID: '76.947.784-5',
      address: { addressLocality: 'Santiago', addressCountry: 'CL' },
    });
    expect(JSON.stringify(organizationJsonLd())).not.toContain('streetAddress');
    expect(organizationJsonLd().logo).toEqual({ '@type': 'ImageObject', url: `${SITE_URL}/logo-square.png`, width: 512, height: 512 });
  });

  it('migas y listas con posiciones y URLs absolutas (la página 2 sigue numerando)', () => {
    const crumbs = breadcrumbJsonLd([{ name: 'Inicio', path: '/' }, { name: 'Catálogo', path: '/catalogo' }]) as {
      itemListElement: { position: number; item: string }[];
    };
    expect(crumbs.itemListElement.map(c => [c.position, c.item])).toEqual([[1, `${SITE_URL}/`], [2, `${SITE_URL}/catalogo`]]);
    const list = itemListJsonLd(products.slice(0, 2), 25) as { itemListElement: { position: number; url: string }[] };
    expect(list.itemListElement[0]).toMatchObject({ position: 25, url: `${SITE_URL}/producto/${products[0].id}` });
  });

  it('guía (plan del blog, §1.6): Article con fechas fijas, autor con su página, editorial con su logo y la URL de la guía', () => {
    const ld = articleJsonLd({
      headline: 'Título',
      description: 'Descripción',
      path: '/guias/x',
      datePublished: '2026-10-23T00:00:00-03:00',
      dateModified: '2026-10-23T00:00:00-03:00',
      author: { name: 'Claudio Quero', path: '/empresa' },
      image: `${SITE_URL}/og-default.jpg`,
    });
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Título',
      description: 'Descripción',
      image: [`${SITE_URL}/og-default.jpg`],
      datePublished: '2026-10-23T00:00:00-03:00',
      dateModified: '2026-10-23T00:00:00-03:00',
      author: { '@type': 'Person', name: 'Claudio Quero', url: `${SITE_URL}/empresa` },
      publisher: {
        '@type': 'Organization',
        name: 'eLIGHTS.cl',
        url: `${SITE_URL}/`,
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo-square.png`, width: 512, height: 512 },
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/guias/x` },
      inLanguage: 'es-CL',
    });
  });
});
