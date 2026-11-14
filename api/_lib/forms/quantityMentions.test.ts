// api/_lib/forms/quantityMentions.test.ts
// «Revisar cantidad» (decisión del dueño, 13-11-2026): la heurística es conservadora.
// Run: npx vitest run --config vitest.api.config.ts api/_lib/forms/quantityMentions.test.ts

import { describe, it, expect } from 'vitest';
import { mentionedQuantities, quantityReviewItem } from './quantityMentions.js';

describe('mentionedQuantities: lo que sí cuenta', () => {
  it.each([
    ['necesito 3', [3]],
    ['Hola, necesito 3.', [3]],
    ['2 rollos', [2]],
    ['10 unidades', [10]],
    ['panel 60x60 x 4', [4]],
    ['x 4', [4]],
    ['4 u.', [4]],
    ['Necesitamos 12 de 60x60 para una oficina', [12]],
    ['Requiero aproximadamente 25 focos', [25]],
    ['Son 6 equipos, por favor', [6]],
    ['quiero dos', [2]],
    ['tres paneles y 10 tubos', [3, 10]],
    ['Cantidad: 8', [8]],
    ['cantidad de 15 para la bodega', [15]],
    ['en total 20', [20]],
    ['Me gustaría cotizar 30 luminarias', [30]],
    ['Necesito 5 ampolletas', [5]],
    ['campana 200W x 6', [6]],
    ['5 uds', [5]],
    ['7 und.', [7]],
    ['NECESITO 3 PANELES', [3]],
    ['Necesito 3 paneles. Son 3 en total', [3]],
    ['4 lámparas', [4]],
  ])('«%s» → %j', (comment, expected) => {
    expect(mentionedQuantities(comment)).toEqual(expected);
  });
});

describe('mentionedQuantities: lo que nunca cuenta', () => {
  it.each([
    ['modelo', 'Quiero el AR111 y el modelo 200'],
    ['modelo con espacio', 'necesito el modelo 3 de la ficha'],
    ['medida', 'panel 60x60'],
    ['medida con espacios', 'panel de 60 x 60'],
    ['medida de tres', 'necesito 60x60x10'],
    ['potencia', 'necesito 40W'],
    ['potencia con espacio', 'necesito 40 W para un galpón'],
    ['temperatura', 'necesito 4000K'],
    ['temperatura con espacio', 'necesito 4000 K'],
    ['IP pegado', 'necesito IP65'],
    ['IP con espacio', 'luminarias IP 65'],
    ['IK', 'resistencia IK 08'],
    ['voltaje', 'son 220V'],
    ['metros', 'necesito 3 metros de cinta'],
    ['teléfono', 'mi fono es +56 9 1234 5678'],
    ['teléfono sin espacios', 'llamar al +56912345678'],
    ['teléfono con etiqueta', 'fono 9 8765 4321'],
    ['RUT', 'RUT 12.345.678-9'],
    ['RUT sin puntos', '12345678-9'],
    ['precio', 'mi presupuesto es $15.000'],
    ['precio en miles', 'necesito 15 mil pesos de descuento'],
    ['precio en lucas', 'son 20 lucas'],
    ['UF', 'son 135 UF'],
    ['fecha con barra', 'lo necesito para el 15/12'],
    ['fecha con mes', 'necesito 15 de diciembre'],
    ['fecha con día', 'entrega el día 20'],
    ['hora', 'a las 15:30'],
    ['envase', 'cajas de 10'],
    ['plazo', 'necesito 2 días hábiles'],
    ['porcentaje', 'son 30%'],
    ['grados', 'apertura 120°'],
    ['decimal', 'necesito 1,5'],
    ['lo que ya tiene', 'tengo 10 paneles'],
    ['potencia de', 'necesito 40 de potencia'],
    ['un', 'busco un panel para mi oficina'],
    ['cero', 'necesito 0'],
    ['sin número', 'quiero cotizar paneles'],
    ['palabra que contiene un número', 'adosado'],
  ])('%s: «%s»', (_name, comment) => {
    expect(mentionedQuantities(comment)).toEqual([]);
  });

  it('no es texto: nada', () => {
    expect(mentionedQuantities(undefined)).toEqual([]);
    expect(mentionedQuantities(12)).toEqual([]);
    expect(mentionedQuantities('   ')).toEqual([]);
  });

  it('un comentario largo y raro se resuelve rápido', () => {
    const comment = 'necesito '.repeat(400) + 'x '.repeat(400) + '60x60 '.repeat(200);
    const start = performance.now();
    mentionedQuantities(comment);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('quantityReviewItem', () => {
  it('el comentario menciona otra cantidad que la elegida', () => {
    expect(quantityReviewItem('necesito 3', [1])).toBe('Revisar cantidad: el comentario menciona 3; se eligió 1');
  });

  it('varias líneas: lista las elegidas y su total', () => {
    expect(quantityReviewItem('son 10 unidades', [2, 3])).toBe(
      'Revisar cantidad: el comentario menciona 10; se eligieron 2 y 3 (en total 5)',
    );
    expect(quantityReviewItem('necesito 4 focos y 9 tubos', [1, 2, 5])).toBe(
      'Revisar cantidad: el comentario menciona 4 y 9; se eligieron 1, 2 y 5 (en total 8)',
    );
  });

  it.each([
    ['la misma cantidad', 'necesito 3', [3]],
    ['una de las elegidas', 'necesito 3 paneles y 2 tubos', [3, 2]],
    ['el total', 'en total 5', [2, 3]],
    ['sin comentario', '', [2]],
    ['sin mención clara', 'panel 60x60 de 40W 4000K IP65', [2]],
    ['sin ítems', 'necesito 3', []],
  ])('%s: sin aviso', (_name, comment, chosen) => {
    expect(quantityReviewItem(comment, chosen)).toBeNull();
  });
});
