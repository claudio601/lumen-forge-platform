// Contenido SEO por producto (./content/<id>.json): formato que la ficha sabe mostrar,
// reglas del sitio y que cada cifra, certificación y marca esté en Jumpseller.
//
// En la PR diaria del robot (rama bot/jumpseller-sync) lo que depende de los datos de
// Jumpseller (cifras, productos que dejaron de publicarse) solo se informa en el informe
// de la sincronización: un texto desactualizado nunca debe bloquear los precios.
import { describe, expect, it } from 'vitest';
import { checkFacts, checkFormat, checkRules } from '../../../scripts/content/check';
import { productFacts } from '../../../scripts/content/facts';
import { categories } from './categories.config';
import { productDescriptions } from './descriptions.generated';
import { products } from './index';
import { jumpsellerSnapshot } from './jumpseller-snapshot.generated';
import { editorialOverlay } from './overlay/editorial';
import type { ProductContent } from './types';

const files = import.meta.glob<ProductContent>('./content/*.json', { eager: true, import: 'default' });
const entries = Object.entries(files).map(([path, c]) => [Number(path.match(/(\d+)\.json$/)?.[1]), c] as const);
const isSyncBot = (process.env.GITHUB_REF_NAME ?? process.env.GITHUB_HEAD_REF ?? '') === 'bot/jumpseller-sync';

describe('contenido SEO por producto', () => {
  it('los archivos se llaman <jumpseller_id>.json', () => {
    expect(Object.keys(files).filter(p => !/\/\d+\.json$/.test(p))).toEqual([]);
  });

  it('nunca encima de una ficha editorial (BESTLED)', () => {
    expect(entries.filter(([id]) => editorialOverlay[id]?.description).map(([id]) => id)).toEqual([]);
  });

  it('formato del formato BESTLED y reglas del sitio (sin stock, precios ni promesas)', () => {
    const problems = entries.flatMap(([id, c]) => [...checkFormat(c), ...checkRules(c)].map(p => `${id}: ${p}`));
    expect(problems).toEqual([]);
  });

  it.skipIf(isSyncBot)('solo de productos publicados', () => {
    const published = new Set(jumpsellerSnapshot.map(p => p.jumpseller_id));
    expect(entries.filter(([id]) => !published.has(id)).map(([id]) => id)).toEqual([]);
  });

  it.skipIf(isSyncBot)('cada cifra, certificación y marca está en los datos de Jumpseller del producto', () => {
    const names = Object.fromEntries(categories.map(c => [c.slug, c.name]));
    const site = new Map(products.map(p => [p.jumpseller_id, { sku: p.sku, brand: p.brand }]));
    const snapshot = new Map(jumpsellerSnapshot.map(p => [p.jumpseller_id, p]));
    const problems = entries.flatMap(([id, c]) => {
      const p = snapshot.get(id);
      if (!p) return [];
      const facts = productFacts({ ...p, ...site.get(id) }, productDescriptions[id], names);
      return checkFacts(c, facts).map(problem => `${id}: ${problem}`);
    });
    expect(problems).toEqual([]);
  });
});
