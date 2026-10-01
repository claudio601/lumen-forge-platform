import { describe, expect, it } from 'vitest';
import { buildDescriptions, diffDescriptions, findRuleBreaking, renderDescriptionsReport } from './descriptions';

const TEXT = '<p>Proyector LED para canchas, bodegas y fachadas de edificios industriales.</p>';
const TABLE = '<table><tr><td>Potencia</td><td>100W</td></tr><tr><td>Color del cable</td><td>Rojo</td></tr></table>';

describe('descripciones para el sitio', () => {
  it('separa el texto y agrupa la tabla; solo productos publicados', () => {
    const r = buildDescriptions(
      [
        { id: 1, description: TEXT + TABLE },
        { id: 2, description: TABLE },
      ],
      new Set([1]),
      {},
    );
    expect(Object.keys(r.descriptions)).toEqual(['1']);
    expect(r.descriptions[1].text).toBe(TEXT);
    expect(r.descriptions[1].electricos).toEqual([{ label: 'Potencia', value: '100W' }]);
    expect(r.unknownLabels).toEqual(['Color del cable']);
    expect(r.available).toBe(true);
  });

  it('lo que cubre el contenido editorial (BESTLED) no se toma de Jumpseller', () => {
    const editorial = { 1: { description: 'Texto del prototipo', specsElectricos: [{ label: 'Potencia', value: '40W' }] } };
    const r = buildDescriptions([{ id: 1, description: TEXT + TABLE }], new Set([1]), editorial);
    expect(r.descriptions[1]).toBeUndefined();
    const onlyText = buildDescriptions([{ id: 1, description: TEXT + TABLE }], new Set([1]), { 1: { description: 'x' } });
    expect(onlyText.descriptions[1].text).toBeUndefined();
    expect(onlyText.descriptions[1].electricos).toBeDefined();
  });

  it('sin el campo description en los datos (respaldo antiguo) no hay descripciones disponibles', () => {
    expect(buildDescriptions([{ id: 1 }], new Set([1]), {}).available).toBe(false);
  });

  it('avisa los textos que contradicen las reglas del sitio, también dentro de la tabla', () => {
    const r = buildDescriptions(
      [{ id: 1, description: '<table><tr><td>Despacho</td><td>Entrega en 24 horas</td></tr></table>' }],
      new Set([1]),
      {},
    );
    expect(r.warnings).toEqual([{ id: 1, phrase: expect.stringContaining('24 horas') }]);
  });

  it('reglas: sin stock, despacho solo "hasta 2 días hábiles", sin precios', () => {
    expect(findRuleBreaking('<p>Últimas unidades en stock</p>')).toMatch(/stock|unidades/i);
    expect(findRuleBreaking('Despacho inmediato')).toBe('Despacho inmediato');
    expect(findRuleBreaking('Despacho en hasta 2 días hábiles')).toBeNull();
    expect(findRuleBreaking('Precio $19.990')).toBe('$19.990');
    expect(findRuleBreaking('Potencia 40W, IP65')).toBeNull();
  });

  it('el informe lista cambios, omitidas, avisos y etiquetas sin grupo', () => {
    const r = buildDescriptions([{ id: 1, description: TEXT + TABLE }], new Set([1]), {});
    const diff = diffDescriptions({ 1: { text: '<p>antes</p>' }, 3: { text: '<p>x</p>' } }, r.descriptions);
    expect(diff).toEqual({ added: [], changed: [1], removed: [3] });
    const report = renderDescriptionsReport(r, diff, new Map([[1, 'PROYECTOR'], [3, 'PANEL']]), 2);
    expect(report).toContain('Cambiadas: 1 PROYECTOR');
    expect(report).toContain('Eliminadas: 3 PANEL');
    expect(report).toContain('sin grupo (quedaron en "Construcción y operación"): Color del cable');
    expect(report).toContain('Bajaron de 2 a 1');
  });
});
