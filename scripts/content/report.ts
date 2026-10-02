// scripts/content/report.ts
// Revisión diaria del contenido SEO contra los datos que acaba de traer la sincronización:
// si Jumpseller cambia un dato que el texto menciona (potencia, flujo, garantía…), el
// informe de la PR del robot lo avisa para corregir el texto. No bloquea los precios.

import type { ProductDescription, SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import { checkContent } from './check';
import { productFacts } from './facts';
import { contentIds, readContent } from './files';

export interface ContentReview {
  /** Productos con contenido escrito. */
  written: number;
  /** Productos publicados que deberían tenerlo (no BESTLED). */
  targets: number;
  /** Contenido que ya no calza con Jumpseller (o con el formato y las reglas). */
  mismatched: { id: number; problems: string[] }[];
  /** Contenido de productos que ya no están publicados (o que pasaron a tener ficha editorial). */
  orphans: number[];
}

export function reviewContent(
  root: string,
  products: readonly SnapshotProduct[],
  descriptions: Readonly<Record<number, ProductDescription>>,
  options: {
    categoryNames: Readonly<Record<string, string>>;
    /** SKU y marca que muestra el sitio (Jumpseller o, si no tiene, el valor legado). */
    site: (p: SnapshotProduct) => { sku: string; brand: string };
    hasEditorial: (id: number) => boolean;
  },
): ContentReview {
  const targets = products.filter(p => !options.hasEditorial(p.jumpseller_id));
  const byId = new Map(targets.map(p => [p.jumpseller_id, p]));
  const ids = contentIds(root);
  const review: ContentReview = { written: 0, targets: targets.length, mismatched: [], orphans: [] };
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) {
      review.orphans.push(id);
      continue;
    }
    review.written++;
    let problems: string[];
    try {
      const facts = productFacts({ ...p, ...options.site(p) }, descriptions[id], options.categoryNames);
      problems = checkContent(readContent(root, id)!, facts);
    } catch (err) {
      problems = [`no se pudo leer: ${(err as Error).message}`];
    }
    if (problems.length) review.mismatched.push({ id, problems });
  }
  return review;
}

export function renderContentReport(r: ContentReview, names: ReadonlyMap<number, string>): string {
  const label = (id: number) => `${id} ${names.get(id) ?? ''}`.trim();
  const lines = ['## Contenido SEO (formato BESTLED)', '', `- Con contenido: ${r.written} de ${r.targets} productos.`];
  if (r.mismatched.length) {
    lines.push(`- ⚠️ A corregir (el texto dice algo que Jumpseller ya no dice): ${r.mismatched.length}`);
    for (const m of r.mismatched) lines.push(`  - ${label(m.id)}: ${m.problems.join('; ')}`);
  }
  if (r.orphans.length) lines.push(`- Contenido sin producto publicado (se puede borrar): ${r.orphans.join(', ')}`);
  return lines.join('\n');
}
