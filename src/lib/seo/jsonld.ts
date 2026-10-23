// src/lib/seo/jsonld.ts
// Datos estructurados (schema.org, JSON-LD) para buscadores. Funciones puras: las
// usa el componente <Seo> en el navegador y, desde la PR 04, el prerender en Node.
// Reglas del dueño: precios CON IVA (los de Jumpseller) y nunca disponibilidad
// (no hay control de stock: "Consultar disponibilidad").

import { absoluteUrl, LEGAL_NAME, LEGAL_RUT, SITE_NAME, SITE_URL } from '@/config/site';
import { contactEmail, whatsappNumber } from '@/config/business';
import type { Product } from '@/data/catalog/types';
import { encodeImageUrl } from './ogImage';

export type JsonLd = Record<string, unknown>;

// "<" escapado como < (válido en JSON): así un texto con "</script>" no puede
// cerrar el bloque <script> del HTML. El escape se arma por partes a propósito.
const LT_ESCAPE = '\\' + 'u003c';

/** JSON-LD listo para ir dentro de <script type="application/ld+json">. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, LT_ESCAPE);
}

export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    taxID: LEGAL_RUT,
    url: SITE_URL + '/',
    // Isotipo cuadrado de la marca (Google pide mínimo 112×112; logo.svg es apaisado).
    logo: { '@type': 'ImageObject', url: absoluteUrl('/logo-square.png'), width: 512, height: 512 },
    email: contactEmail,
    telephone: `+${whatsappNumber}`,
    address: { '@type': 'PostalAddress', addressLocality: 'Santiago', addressCountry: 'CL' },
    areaServed: 'CL',
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL + '/',
    inLanguage: 'es-CL',
  };
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(crumbs: Crumb[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

/** Lista de productos de una página de catálogo (posiciones absolutas, para la página N). */
export function itemListJsonLd(items: Pick<Product, 'id' | 'name'>[], firstPosition = 1): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((p, i) => ({
      '@type': 'ListItem',
      position: firstPosition + i,
      url: absoluteUrl(`/producto/${p.id}`),
      name: p.name,
    })),
  };
}

export function productJsonLd(product: Product, description: string): JsonLd {
  const images = product.images?.length ? product.images : [product.image].filter(Boolean);
  return {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.name,
    // Todas las fotos originales (Google acepta WebP y archivos pesados), codificadas como og:image
    image: images.map(encodeImageUrl),
    description,
    sku: product.sku || product.id,
    mpn: product.sku || product.id,
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(`/producto/${product.id}`),
      priceCurrency: 'CLP',
      price: product.price,
      seller: { '@type': 'Organization', name: SITE_NAME },
    },
  };
}

export interface ArticleData {
  /** Igual al H1. */
  headline: string;
  description: string;
  /** Ruta de la guía ('/guias/<slug>'). */
  path: string;
  /** ISO 8601 con la zona horaria de Chile, como texto fijo. */
  datePublished: string;
  dateModified: string;
  author: { name: string; path: string };
  /** URL absoluta de la imagen para compartir (la de la marca mientras las guías no tengan una propia). */
  image: string;
}

/**
 * Una guía (plan del blog, §1.6): Article, que Google acepta sin propiedades obligatorias. El
 * autor es una persona con su página; la editorial, eLIGHTS.cl con su isotipo cuadrado (el de
 * organizationJsonLd). Las guías no llevan FAQPage: Google dejó de mostrarlo.
 */
export function articleJsonLd(a: ArticleData): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.headline,
    description: a.description,
    image: [a.image],
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    author: { '@type': 'Person', name: a.author.name, url: absoluteUrl(a.author.path) },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL + '/',
      logo: { '@type': 'ImageObject', url: absoluteUrl('/logo-square.png'), width: 512, height: 512 },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': absoluteUrl(a.path) },
    inLanguage: 'es-CL',
  };
}

export function faqJsonLd(faq: { question: string; answer: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org/',
    '@type': 'FAQPage',
    mainEntity: faq.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}
