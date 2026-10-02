// scripts/content/content.ts
// Herramientas del contenido SEO por producto (src/data/catalog/content/<id>.json):
//
//   npm run content -- export [id…]   datos de Jumpseller de cada producto (los que puede usar
//                                     el texto) en reports/content/facts/<id>.json
//   npm run content -- check [id…]    verifica el contenido (formato, reglas del sitio y que
//                                     cada cifra, certificación y marca esté en Jumpseller)
//
// Sin ids: todos los productos publicados que no son BESTLED (esos tienen su ficha editorial).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { categories } from '../../src/data/catalog/categories.config';
import { products } from '../../src/data/catalog/index';
import { productDescriptions } from '../../src/data/catalog/descriptions.generated';
import { jumpsellerSnapshot } from '../../src/data/catalog/jumpseller-snapshot.generated';
import { editorialOverlay } from '../../src/data/catalog/overlay/editorial';
import type { ProductContent } from '../../src/data/catalog/types';
import { checkContent, repeatedSentences } from './check';
import { productFacts, type ProductFacts } from './facts';
import { contentIds, readContent } from './files';

const FACTS_DIR = 'reports/content/facts';

const categoryNames = Object.fromEntries(categories.map(c => [c.slug, c.name]));
/** SKU y marca que muestra el sitio (Jumpseller o, si no tiene, el valor legado). */
const site = new Map(products.map(p => [p.jumpseller_id, { sku: p.sku, brand: p.brand }]));

/** Productos publicados que llevan contenido SEO escrito a partir de Jumpseller (no los BESTLED). */
export function contentTargets(): ProductFacts[] {
  return jumpsellerSnapshot
    .filter(p => !editorialOverlay[p.jumpseller_id]?.description)
    .map(p => productFacts({ ...p, ...site.get(p.jumpseller_id) }, productDescriptions[p.jumpseller_id], categoryNames));
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const root = process.cwd();
  const ids = new Set(rest.map(Number).filter(Boolean));
  const targets = contentTargets().filter(f => !ids.size || ids.has(f.jumpseller_id));

  if (command === 'export') {
    mkdirSync(join(root, FACTS_DIR), { recursive: true });
    for (const f of targets) writeFileSync(join(root, FACTS_DIR, `${f.jumpseller_id}.json`), `${JSON.stringify(f, null, 2)}\n`, 'utf8');
    console.log(`Datos de ${targets.length} productos en ${FACTS_DIR}/`);
    return 0;
  }

  if (command === 'check') {
    const written = new Set(contentIds(root));
    let failed = 0;
    const contents = new Map<number, ProductContent>();
    for (const f of targets) {
      if (!written.has(f.jumpseller_id)) continue;
      let content: ProductContent;
      try {
        content = readContent(root, f.jumpseller_id)!;
      } catch (err) {
        console.log(`✗ ${f.jumpseller_id} ${f.name}\n    - JSON inválido: ${(err as Error).message}`);
        failed++;
        continue;
      }
      contents.set(f.jumpseller_id, content);
      const problems = checkContent(content, f);
      if (problems.length) {
        failed++;
        console.log(`✗ ${f.jumpseller_id} ${f.name}\n${problems.map(p => `    - ${p}`).join('\n')}`);
      }
    }
    const orphans = [...written].filter(id => !contentTargets().some(f => f.jumpseller_id === id));
    if (orphans.length) console.log(`Contenido de productos que no están publicados (o son BESTLED): ${orphans.join(', ')}`);
    for (const r of repeatedSentences(contents)) console.log(`Repetida en ${r.ids.length} productos: "${r.sentence.slice(0, 120)}…"`);
    console.log(`${contents.size - failed} de ${contents.size} productos con contenido sin problemas · ${targets.length - contents.size} sin contenido todavía.`);
    return failed ? 1 : 0;
  }

  console.error('Uso: npm run content -- export|check [id…]');
  return 2;
}

if (process.argv[1]?.endsWith('content.ts')) process.exit(main(process.argv.slice(2)));
