import { describe, expect, it } from 'vitest';
import { cleanLabel, groupSpecs, splitApplications } from './spec-groups';
import { sanitizeDescription } from './sanitize-description';

const table = (rows: [string, string][]) =>
  sanitizeDescription(`<table>${rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join('')}</table>`);

describe('especificaciones agrupadas como en las fichas BESTLED', () => {
  it('reparte las filas en los tres grupos, con nombres consistentes y en el orden de la ficha', () => {
    const { specs, unknownLabels } = groupSpecs(
      table([
        ['Garantía', '5 años'],
        ['Driver', 'Mean Well'],
        ['Color de temperatura', 'Luz fría - 5000K'],
        ['POTENCIA:', '150W'],
        ['Flujo lumínico', '22.500 Lm.'],
        ['Protección', 'IP66'],
        ['Material', 'Aluminio'],
      ]),
    );
    expect(specs.electricos).toEqual([
      { label: 'Potencia', value: '150W' },
      { label: 'Flujo luminoso', value: '22.500 Lm.' },
      { label: 'Temperatura de color', value: 'Luz fría - 5000K' },
    ]);
    expect(specs.construccion).toEqual([
      { label: 'Material', value: 'Aluminio' },
      { label: 'Grado de protección', value: 'IP66' },
      { label: 'Garantía', value: '5 años' },
    ]);
    expect(specs.componentes).toEqual([{ label: 'Driver', value: 'Mean Well' }]);
    expect(unknownLabels).toEqual([]);
  });

  it('una etiqueta desconocida queda en Construcción y operación y se informa', () => {
    const { specs, unknownLabels } = groupSpecs(table([['Color del cable', 'Rojo']]));
    expect(specs.construccion).toEqual([{ label: 'Color del cable', value: 'Rojo' }]);
    expect(unknownLabels).toEqual(['Color del cable']);
  });

  it('saltos de línea, párrafos y viñetas de la celda pasan a líneas de texto plano', () => {
    const { specs } = groupSpecs(
      table([
        ['Packaging x mayor', '5 unidades por caja<p>45,5 x 25 x 33,5 CM</p><p>18,8 KG</p>'],
        ['Modo de control', 'Fotocelda<ul><li>Botón ON/OFF</li><li>Control &amp; remoto</li></ul>'],
      ]),
    );
    expect(specs.construccion).toEqual([{ label: 'Packaging por mayor', value: '5 unidades por caja\n45,5 x 25 x 33,5 CM\n18,8 KG' }]);
    expect(specs.componentes).toEqual([{ label: 'Modo de control', value: 'Fotocelda\n• Botón ON/OFF\n• Control & remoto' }]);
  });

  it('omite el SKU, el nombre, los encabezados y los valores vacíos', () => {
    const { specs } = groupSpecs(
      table([
        ['Característica', 'Valor'],
        ['Nombre del producto', 'Otro nombre'],
        ['Potencia', '-'],
        ['Voltaje', '220V'],
      ]),
    );
    expect(specs).toEqual({ electricos: [{ label: 'Tensión', value: '220V' }] });
  });

  it('la fila Aplicación pasa a la lista de aplicaciones; una frase queda como especificación', () => {
    expect(groupSpecs(table([['Aplicación', 'Bodegas, industrias y patios']])).specs).toEqual({
      applications: ['Bodegas', 'Industrias', 'Patios'],
    });
    const sentence = 'Diseñado para sobreponer panel led de cielo americano en cielo duro';
    expect(groupSpecs(table([['Aplicación', sentence]])).specs).toEqual({
      construccion: [{ label: 'Aplicación', value: sentence }],
    });
  });

  it('fila sin etiqueta continúa la anterior; encabezado en <th> se omite; tabla anidada no pega celdas', () => {
    const html = sanitizeDescription(
      '<table><tr><th>Modelo</th><th>Ficha</th></tr><tr><td>Packaging</td><td>1 por caja</td></tr><tr><td></td><td>37 x 37 cm</td></tr>' +
        '<tr><td>Dirección de luz</td><td>Bidireccional</td></tr><tr><td>Accesorios</td><td><table><tr><td>Pernos</td><td>Canastillo</td></tr></table></td></tr></table>',
    );
    const { specs } = groupSpecs(html);
    expect(specs.construccion).toEqual([{ label: 'Packaging', value: '1 por caja\n37 x 37 cm' }]);
    expect(specs.electricos).toEqual([{ label: 'Dirección de luz', value: 'Bidireccional' }]);
    expect(specs.componentes).toEqual([{ label: 'Accesorios', value: 'Pernos\nCanastillo' }]);
  });

  it('una tabla de más de dos columnas (comparativa) se conserva tal cual', () => {
    const comparison = sanitizeDescription('<table><tr><th>Modelo</th><th>40W</th><th>60W</th></tr><tr><td>Flujo</td><td>7.190 lm</td><td>10.200 lm</td></tr></table>');
    const { specs } = groupSpecs(comparison + table([['Potencia', '40W']]));
    expect(specs.tables).toBe(comparison);
    expect(specs.electricos).toEqual([{ label: 'Potencia', value: '40W' }]);
  });
});

describe('etiquetas y aplicaciones', () => {
  it('mayúscula solo al inicio, conservando siglas', () => {
    expect(cleanLabel('VIDA ÚTIL (HRS.):')).toBe('Vida útil (hrs.)');
    expect(cleanLabel('Temperatura Color (°K)')).toBe('Temperatura color (°K)');
    expect(cleanLabel('Tipo de LED')).toBe('Tipo de LED');
    expect(cleanLabel('CRI (RA>)')).toBe('CRI (RA>)');
  });

  it('separa listas de usos y rechaza frases', () => {
    expect(splitApplications('Gimnasio\nPlazas\nEstadios')).toEqual(['Gimnasio', 'Plazas', 'Estadios']);
    expect(splitApplications('Interior / Exterior')).toEqual(['Interior', 'Exterior']);
    expect(splitApplications('Interior- Residencial-Comercial')).toEqual(['Interior', 'Residencial', 'Comercial']);
    expect(splitApplications('-El producto no es compatible con VOS Switch o PIR Switch')).toBeNull();
  });
});
