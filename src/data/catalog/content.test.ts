// Contenido SEO por producto (./content/<id>.json): formato que la ficha sabe mostrar y
// reglas del sitio. Que cada cifra esté en Jumpseller lo verifica `npm run content -- check`
// y la sincronización diaria (su informe avisa sin bloquear precios).
import { describe, expect, it } from 'vitest';
import { checkFormat, checkRules } from '../../../scripts/content/check';
import { jumpsellerSnapshot } from './jumpseller-snapshot.generated';
import { editorialOverlay } from './overlay/editorial';
import type { ProductContent } from './types';

const files = import.meta.glob<ProductContent>('./content/*.json', { eager: true, import: 'default' });
const entries = Object.entries(files).map(([path, c]) => [Number(path.match(/(\d+)\.json$/)?.[1]), c] as const);

describe('contenido SEO por producto', () => {
  it('los archivos se llaman <jumpseller_id>.json', () => {
    expect(Object.keys(files).filter(p => !/\/\d+\.json$/.test(p))).toEqual([]);
  });

  it('solo de productos publicados y nunca encima de una ficha editorial (BESTLED)', () => {
    const published = new Set(jumpsellerSnapshot.map(p => p.jumpseller_id));
    expect(entries.filter(([id]) => !published.has(id)).map(([id]) => id)).toEqual([]);
    expect(entries.filter(([id]) => editorialOverlay[id]?.description).map(([id]) => id)).toEqual([]);
  });

  it('formato del formato BESTLED y reglas del sitio (sin stock, precios ni promesas)', () => {
    const problems = entries.flatMap(([id, c]) => [...checkFormat(c), ...checkRules(c)].map(p => `${id}: ${p}`));
    expect(problems).toEqual([]);
  });
});
