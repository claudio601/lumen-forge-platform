// scripts/jumpseller/panel-boxes.test.ts
// Cajas master de paneles frente al «Packaging por mayor» de Jumpseller (revisión del 16-11-2026).
// Datos inventados: no depende del catálogo del día.
// Run: npx vitest run --config vitest.api.config.ts scripts/jumpseller/panel-boxes.test.ts

import { describe, it, expect } from 'vitest';
import { comparePanelBoxes, packagingUnits, renderPanelBoxesReport } from './panel-boxes';
import type { ProductDescription } from '../../src/data/catalog/jumpseller.types';

const withPackaging = (value: string, label = 'Packaging por mayor'): ProductDescription => ({
  construccion: [{ label: 'Garantía', value: '1 año' }, { label, value }],
});

describe('packagingUnits', () => {
  it.each([
    ['10 unidades por caja\n61,5 x 61,5 x 29,5 CM\n13,5 KG', 10],
    ['6 piezas x caja\nLargo: 121 cm.', 6],
    ['10 unidades por cajas', 10],
    ['12 unidades/caja', 12],
    ['100 Unidades por caja', 100],
  ])('«%s» → %d', (value, expected) => {
    expect(packagingUnits(withPackaging(value))).toBe(expected);
  });

  it('sin la fila, con solo el packaging individual o sin número que leer: null', () => {
    expect(packagingUnits(undefined)).toBeNull();
    expect(packagingUnits({ construccion: [{ label: 'Garantía', value: '1 año' }] })).toBeNull();
    expect(packagingUnits(withPackaging('1 unidad por caja', 'Packaging individual'))).toBeNull();
    expect(packagingUnits(withPackaging('Consultar'))).toBeNull();
  });

  it('la fila puede estar en cualquiera de los tres grupos', () => {
    expect(packagingUnits({ componentes: [{ label: 'Packaging por mayor', value: '8 piezas x caja' }] })).toBe(8);
  });
});

describe('comparePanelBoxes', () => {
  const boxes = { 1: { box: 10 }, 2: { box: 6 }, 3: { box: null }, 4: { box: 10, minUnits: 4 }, 5: { box: 6 } };
  const descriptions = {
    1: withPackaging('10 piezas x caja'),
    2: withPackaging('8 unidades por caja'),
    3: withPackaging('10 unidades por caja'),
    4: { construccion: [] },
  };

  it('lista los que no coinciden, también si a uno de los dos le falta el número; omite los no publicados', () => {
    expect(comparePanelBoxes(boxes, descriptions, new Set([1, 2, 3, 4]))).toEqual([
      { id: 2, site: 6, jumpseller: 8 },
      { id: 3, site: null, jumpseller: 10 },
      { id: 4, site: 10, jumpseller: null },
    ]);
  });

  it('el informe: una tabla con las dos cajas, o una línea si todo coincide', () => {
    const names = new Map([[2, 'PANEL | PRUEBA']]);
    const report = renderPanelBoxesReport(comparePanelBoxes(boxes, descriptions, new Set([2, 3])), names);
    expect(report).toContain('## Cajas master de paneles (PANEL_MASTER_BOX)');
    expect(report).toContain('| 2 PANEL / PRUEBA | 6 | 8 |');
    expect(report).toContain('| 3  | sin número | 10 |');
    expect(renderPanelBoxesReport([], names)).toContain('Coinciden con el «Packaging por mayor» de Jumpseller.');
  });
});
