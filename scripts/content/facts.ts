// scripts/content/facts.ts
// Los datos de un producto que puede usar su contenido SEO: solo lo que dice Jumpseller
// (nombre, SKU, marca, categorías, especificaciones agrupadas, aplicaciones y texto).
// Lo leen quienes escriben el contenido y check.ts, que verifica cada cifra contra esto.

import type { ProductDescription, SnapshotProduct, SpecRow } from '../../src/data/catalog/jumpseller.types';

export interface ProductFacts {
  jumpseller_id: number;
  name: string;
  sku: string;
  brand: string;
  categories: string[];
  electricos: SpecRow[];
  construccion: SpecRow[];
  componentes: SpecRow[];
  applications: string[];
  /** Texto de la descripción de Jumpseller, sin etiquetas. */
  text: string;
  /** Tablas comparativas (familia), sin etiquetas. */
  tables: string;
}

const plain = (html = '') =>
  html
    .replace(/<br>|<\/?(?:p|ul|ol|li|table|thead|tbody|tr|td|th|h3|h4|blockquote)(?: [^>]*)?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function productFacts(
  p: Pick<SnapshotProduct, 'jumpseller_id' | 'name' | 'sku' | 'brand' | 'categories'>,
  d: ProductDescription | undefined,
  categoryNames: Readonly<Record<string, string>>,
): ProductFacts {
  return {
    jumpseller_id: p.jumpseller_id,
    name: p.name,
    sku: p.sku,
    brand: p.brand ?? '',
    categories: p.categories.map(slug => categoryNames[slug] ?? slug),
    electricos: d?.electricos ?? [],
    construccion: d?.construccion ?? [],
    componentes: d?.componentes ?? [],
    applications: d?.applications ?? [],
    text: plain(d?.text),
    tables: plain(d?.tables),
  };
}

/** Todo el texto de los datos, para buscar cifras y certificaciones. */
export function factsText(f: ProductFacts): string {
  const rows = [...f.electricos, ...f.construccion, ...f.componentes].map(r => `${r.label}: ${r.value}`);
  return [f.name, f.sku, f.brand, ...f.categories, ...rows, ...f.applications, f.text, f.tables].join('\n');
}
