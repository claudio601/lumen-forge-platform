import { describe, expect, it } from 'vitest';
import { htmlToText } from './html';

describe('htmlToText', () => {
  it('separa las palabras de bloques contiguos, al abrir y al cerrar', () => {
    expect(htmlToText('<p>Panel</p><p>LED</p>')).toBe('Panel LED');
    expect(htmlToText('Usos:<ul><li>Bodegas</li><li>Patios</li></ul>')).toBe('Usos: Bodegas Patios');
    expect(htmlToText('<table><tbody><tr><td>Potencia</td><td>40W</td></tr></tbody></table>')).toBe('Potencia 40W');
    expect(htmlToText('220V<br>50Hz')).toBe('220V 50Hz');
  });

  it('las etiquetas en línea no separan y las entidades se decodifican', () => {
    expect(htmlToText('<strong>LED</strong>s &amp; &lt;25W&gt; &quot;slim&quot;')).toBe('LEDs & <25W> "slim"');
  });

  it('corta en el máximo con puntos suspensivos', () => {
    expect(htmlToText('<p>abcdefghij</p>', 5)).toBe('abcd…');
  });
});
