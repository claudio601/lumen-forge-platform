// api/_lib/whatsapp/quantity.test.ts
// Bot de WhatsApp, PR 2 del plan (B2, B3 y CASO-1): readQuantity y claudeQuantity, sin el flujo.
// La cantidad es un entero o nada: explicita, o la respuesta a una pregunta por ella; nunca la
// potencia, la medida, el RUT, el telefono, los numeros de un correo ni los de un modelo.
// Solo mensajes, correos y RUT inventados.

import { describe, expect, it } from 'vitest';
import { claudeQuantity, readQuantity } from './quantity';
import { jumpsellerSnapshot } from '../../../src/data/catalog/jumpseller-snapshot.generated';
import { waProductUrl } from '../../../src/config/business';
import { isSyncBot } from '../../../src/test/syncBot';

describe('cantidad explícita en el texto', () => {
  it.each([
    ['Necesito 30 paneles de 18W', 30],
    ['Busco paneles 120x60, son 8, regulables', 8],
    ['Hola, necesito 400 plafones', 400],
    ['Quiero cotizar 25 BESTLED para un pasaje en Talca', 25],
    ['Quiero algo parecido al modelo PRUEBA12345, 12 unidades', 12],
    ['necesito 15und de reflectores', 15],
    ['Cantidad: 40', 40],
    ['necesito unos 1.000 focos', 1000],
    ['Necesito 30 paneles 60x60 luz neutra para una oficina en Providencia', 30],
  ])('%s → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });
});

describe('lo que nunca es cantidad', () => {
  it.each([
    'Hola, mi correo es 123prueba.99@example.com',
    'Necesito panel redondo embutido 15W',
    'busco focos de 4000K IP65 para 220V',
    'Comercial Prueba SpA, RUT 77.123.456-9, compras@comercial-prueba.example.com',
    'mi celular es +56 9 1234 5678',
    'el pedido n° 4521 no ha llegado',
    'paneles de 60x60 y de 120 x 30',
    'una tira de 5 m para un patio de 200 m2',
    'presupuesto de $250.000',
    'te escribo el 16-10 a las 15:30',
    'busco modelos E27 o GU10',
  ])('%s', (text) => {
    // Con la pregunta por la cantidad y Claude de acuerdo: solo el filtro evita tomar el número.
    expect(readQuantity(text, { asked: true, claude: text.match(/\d+/)?.[0] }).value).toBeUndefined();
  });
});

describe('varios ítems o algo que no son unidades', () => {
  it.each([
    'Necesito 30 paneles de 18W y 20 de 24W',
    'necesito 2 de 60x60 y 3 de 120x60',
    'son entre 20 y 30 focos',
  ])('%s → vacía y marcada como varios ítems, aunque Claude diga un número', (text) => {
    expect(readQuantity(text, { claude: '2' })).toEqual({ explicit: false, several: true });
  });

  it.each([
    'necesito 2 cotizaciones',
    'busco 2 tipos de paneles',
    'necesito iluminar 3 bodegas',
  ])('%s → vacía, aunque Claude diga un número', (text) => {
    expect(readQuantity(text, { claude: '2', asked: true })).toEqual({ explicit: false });
  });
});

describe('respuesta a la pregunta por la cantidad', () => {
  it.each([
    '02.11.2026',
    '2.11.2026',
    'versión 2.3.4',
    'versión 2.3.4.5',
  ])('"%s" se descarta completa, sin dejar cifras como cantidad', (text) => {
    expect(readQuantity(text, { asked: true })).toEqual({ explicit: false });
  });

  it.each([
    ['2.000 focos', 2000],
    ['1.5 metros', undefined],
    ['30 focos', 30],
    ['30 focos para el 02.11.2026', 30],
    ['versión 2.3.4, necesito 30 focos', 30],
  ])('"%s" conserva solo la cantidad legítima → %s', (text, expected) => {
    expect(readQuantity(text, { asked: true }).value).toBe(expected);
  });

  it('"20, luz fría" vale solo si la pregunta pidió la cantidad', () => {
    expect(readQuantity('20, luz fría', { asked: true, menuLength: 2 })).toEqual({ value: 20, explicit: true });
    expect(readQuantity('20, luz fría').value).toBeUndefined();
  });

  it('una lista copiada ("1) paneles 2) fría 3) 20") deja el 20', () => {
    expect(readQuantity('1) paneles\n2) fría\n3) 20', { asked: true, menuLength: 3 }).value).toBe(20);
  });

  it('CASO-1: un número suelto dentro del largo de la lista se aclara; uno mayor es la cantidad', () => {
    expect(readQuantity('1', { asked: true, menuLength: 3 })).toEqual({ explicit: false, menuPick: 1 });
    expect(readQuantity('la 2.', { asked: true, menuLength: 3 })).toEqual({ explicit: false, menuPick: 2 });
    expect(readQuantity('20', { asked: true, menuLength: 3 })).toEqual({ value: 20, explicit: true });
    expect(readQuantity('3', { asked: true, menuLength: 0 })).toEqual({ value: 3, explicit: true });
  });

  it('sin la pregunta, un número suelto solo vale si Claude lo dice también (y no reemplaza)', () => {
    expect(readQuantity('para la bodega, 30').value).toBeUndefined();
    expect(readQuantity('para la bodega, 30', { claude: '30' })).toEqual({ value: 30, explicit: false });
    expect(readQuantity('para la bodega, 30', { claude: '40' }).value).toBeUndefined();
  });

  it('un RUT sin guion (el que contesta la pregunta por el RUT) no deja números', () => {
    expect(readQuantity('771234569', { ruts: ['77.123.456-9'], claude: '771234569' }).value).toBeUndefined();
  });
});

describe('B2: lo que devuelve Claude', () => {
  it.each([
    ['30', 30],
    [30, 30],
    ['30 paneles', 30],
    ['aprox 1.000', 1000],
    [2.5, undefined],
    ['2.5', undefined],
    ['no especificada', undefined],
    ['N/A', undefined],
    ['20-30', undefined],
    [0, undefined],
    [99999, 99999],
    [100000, undefined],
    [{ paneles: 20, focos: 10 }, undefined],
    [[20, 10], undefined],
    [null, undefined],
  ])('%j → %s', (value, expected) => {
    expect(claudeQuantity(value)).toBe(expected);
  });
});

describe('ronda 2 (Codex y leads reales): un número que el texto da como otro dato', () => {
  it.each([
    'modelo 50',
    'presupuesto CLP 50000',
    'potencia 24 vatios',
    '(9) 0000 1234',
    'Dirección: Calle Prueba 456, of. 12, Providencia',
    'Pasaje Ficticio 78, bodega n° 3',
    'camino a Prueba km 14',
    'Av. Inventada 1234-B',
    'son de 40 cms de largo',
    'una tira de 3 mtrs',
    'luz entre 3000-4000k',
    'para el piso 3',
    'para 3 piezas',
  ])('%s → vacía, aunque la pregunta pidiera la cantidad', (text) => {
    expect(readQuantity(text, { asked: true, claude: '3' }).value).toBeUndefined();
  });

  it('sin la pregunta, Claude no respalda un número que el texto da como otro dato', () => {
    expect(readQuantity('Necesito focos LED, modelo 50', { claude: '50' }).value).toBeUndefined();
  });

  it.each([
    ['Necesito 30 paneles, Avenida Ficticia 123', 30],
    ['Son 7, no 10', 7],
    ['no son 10, son 7', 7],
    ['Necesito 30 paneles, modelo 50', 30],
    ['necesito 4 postes solares', 4],
    ['3 rollos de cinta led', 3],
    ['son 20 piezas de panel', 20],
    ['panel 18W x 20', 20],
    ['2x panel 60x60', 2],
    ['unos 20, luz fría', 20],
    ['necesito iluminar la calle con 30 focos', 30],
  ])('%s → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });

  it.each([
    'necesito 10x PRUEBA-1, 5x PRUEBA-2',
    'necesito 2 postes + 2 focos',
    '10 unidades de cada modelo',
    'necesito 5 c/u',
    'Cambio a 20 paneles y 30 focos',
  ])('%s → varios ítems', (text) => {
    expect(readQuantity(text)).toEqual({ explicit: false, several: true });
  });

  it('con un correo o un RUT, un número suelto no contesta la pregunta (suele ser de la dirección)', () => {
    expect(readQuantity('Pasaje Prueba 45, 20', { asked: true, contact: true }).value).toBeUndefined();
    expect(readQuantity('RUT 77.123.456-9, local 20', { asked: true }).value).toBeUndefined();
    expect(readQuantity('20, el correo ya te lo mandé', { asked: true, contact: true, claude: '20' })).toEqual({ value: 20, explicit: false });
    expect(readQuantity('Necesito 30 paneles, RUT 77.123.456-9', { asked: true })).toEqual({ value: 30, explicit: true });
  });

  it('CASO-1: el número de una lista se aclara aunque la lista no pidiera la cantidad', () => {
    expect(readQuantity('1', { menuLength: 2 })).toEqual({ explicit: false, menuPick: 1 });
  });
});

describe('ronda 3 (revisión adversaria): más datos que no son cantidad', () => {
  it.each([
    'te escribo el 15 de noviembre',
    'lo necesito para el 2026',
    'licitación 1234-56-LE26',
    'es por la cotización 4521',
    'fono 22 123 4567',
    'tira led 5050',
    'casquillo E 27',
    'panel de 60 por 60',
    'CRI 80',
    'Ra>80',
    '2000 lumens',
    'Calle Prueba 45, local 20',
    'me refería a la opción 2, el tipo de luz',
    'la 1',
  ])('%s → vacía, aunque la pregunta pidiera la cantidad', (text) => {
    expect(readQuantity(text, { asked: true, claude: text.match(/\d+/)?.[0] }).value).toBeUndefined();
  });

  it.each([
    ['1: paneles LED 2: luz fría 3: 20 unidades', 20],
    ['1. paneles LED, 2. fría, 3. 20', 20],
  ])('la lista de MSG1 contestada en una línea: %s → %i', (text, expected) => {
    expect(readQuantity(text, { asked: true, menuLength: 3 })).toEqual({ value: expected, explicit: true });
  });

  it.each([
    ['necesito dos paneles', 2],
    ['una docena de focos', 12],
    ['quiero cotizar una cotización de 30 focos', 30],
    ['necesito 30 focos y 2 galpones', 30],
    ['20 un. de panel', 20],
    ['necesito 15 pzs', 15],
  ])('%s → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });

  it('"un reflector" vale 1 solo si Claude también dice 1', () => {
    expect(readQuantity('busco un reflector', { claude: 1 })).toEqual({ value: 1, explicit: false });
    expect(readQuantity('busco un reflector').value).toBeUndefined();
  });

  it('"la opción 2" con la lista a la vista es la elección del ítem', () => {
    expect(readQuantity('la opción 2', { asked: true, menuLength: 2 })).toEqual({ explicit: false, menuPick: 2 });
  });
});

describe('ronda 4 (revisión adversaria): medidas después del producto, correcciones y "uno"', () => {
  it.each([
    'tubos led de 120 luz fría',
    'plafones de 18',
    'reflectores solares de 100',
  ])('"%s": el número después del producto y "de" es su medida o potencia', (text) => {
    expect(readQuantity(text, { asked: true, claude: text.match(/\d+/)?.[0] }).value).toBeUndefined();
  });

  it.each([
    ['tubos de 120, fría, 30', { asked: true }, 30],
    ['necesito 30 cintas 2835 de 60 leds/m', {}, 30],
    ['1.- paneles LED\n2.- fría\n3.- 20', { asked: true, menuLength: 3 }, 20],
    ['eran 25, no 20', {}, 25],
    ['cambio: 25 en vez de 20', {}, 25],
    ['necesito de 30 tubos', {}, 30],
  ])('%s %j → %i', (text, options, expected) => {
    expect(readQuantity(text, options)).toEqual({ value: expected, explicit: true });
  });

  it.each([
    ['necesito veinte y cinco focos', 25],
    ['necesito treinta y dos paneles', 32],
    ['necesito veinticinco focos', 25],
    ['necesito veintiún focos', 21],
    ['necesito sesenta paneles', 60],
  ])('número compuesto en palabras: %s → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });

  it('"ciento veinte focos" es 120, nunca 20', () => {
    expect(readQuantity('necesito ciento veinte focos')).toEqual({ value: 120, explicit: true });
  });

  it.each(['uno', 'solo una', 'uno nomás', 'necesito solo uno'])('"%s" contesta la pregunta por la cantidad con 1', (text) => {
    expect(readQuantity(text, { asked: true })).toEqual({ value: 1, explicit: true });
    expect(readQuantity(text).value).toBeUndefined();
  });
});

describe('ronda 5 (Codex, ronda 2)', () => {
  it.each([
    'El modelo es el 50',
    'Presupuesto de unos 50000',
    'tubos LED de 120 y 60',
    'paneles de 60 y 120',
    'Razón social: Comercial 25 SpA',
    'a las dos',
    'los dos modelos',
    'dos tres focos',
  ])('"%s" → vacía, aunque la pregunta pidiera la cantidad', (text) => {
    expect(readQuantity(text, { asked: true }).value).toBeUndefined();
  });

  it.each([
    ['Necesito ciento treinta y dos paneles', 132],
    ['Necesito ciento veinticinco focos', 125],
    ['Necesito doscientos veinte focos', 220],
    ['mil treinta y dos paneles', 1032],
    ['necesito dos mil quinientos paneles', 2500],
    ['trece focos', 13],
    ['catorce paneles', 14],
    ['dieciséis focos', 16],
    ['necesito treinta', 30],
    ['también necesito cambiar la cantidad a 20', 20],
  ])('el número entero en palabras o el cambio dicho: %s → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });

  it('"treinta y dos" contesta la pregunta por la cantidad', () => {
    expect(readQuantity('treinta y dos', { asked: true, claude: 32 })).toEqual({ value: 32, explicit: true });
  });

  it('una respuesta parcial a la lista ("2: fría; 3: 20 unidades") no es varios ítems', () => {
    expect(readQuantity('2: fría; 3: 20 unidades', { asked: true, menuLength: 3 })).toEqual({ value: 20, explicit: true });
  });
});

describe('ronda 6 (revisión adversaria de la ronda 5)', () => {
  it.each([
    'necesito 50 tubos LED de 120 y 30 de 60',
    'necesito 20 reflectores de 100 y 10 de 200',
    'necesito 4 focos de 10 y 2 de 20',
    'necesito 10 focos de 50 y 10 de 100',
    'mejor dos de 60x60 y tres de 120x60',
    'quiero cinco de luz fría y cinco de luz cálida',
    'necesito diez de 18W y cinco de 24W',
    'son dos de 60x60 y uno de 120',
  ])('H7 y H8: "%s" → varios ítems', (text) => {
    expect(readQuantity(text)).toEqual({ explicit: false, several: true });
  });

  it('H8: con la pregunta hecha, "necesitamos cuatro de 18w y dos de 36w" → varios ítems', () => {
    expect(readQuantity('necesitamos cuatro de 18w y dos de 36w', { asked: true })).toEqual({ explicit: false, several: true });
  });

  it.each([
    ['necesito dos cientos focos LED', 200],
    ['son seis cientas luminarias', 600],
    ['necesito tres cientos cincuenta paneles', 350],
  ])('H9: la centena en dos palabras: "%s" → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });

  it('H9: "necesito unos dos cientos" contesta la pregunta con 200', () => {
    expect(readQuantity('necesito unos dos cientos', { asked: true })).toEqual({ value: 200, explicit: true });
  });

  it.each([
    'necesito luminarias solares para un camino de unos dos kilómetros',
    'es un terreno de unas dos hectáreas',
    'necesito iluminar un camino rural de unos tres kilometros',
    'para un camino de unos 2 km',
    'son unas tres cuadras',
  ])('H10: "%s" → vacía, aunque la pregunta pidiera la cantidad', (text) => {
    expect(readQuantity(text, { asked: true }).value).toBeUndefined();
  });

  it('la medida encadenada sin otro ítem sigue siendo la medida', () => {
    expect(readQuantity('necesito 30 tubos LED de 120 y 60')).toEqual({ value: 30, explicit: true });
  });
});

describe('ronda 7 (Codex, ronda 3)', () => {
  it.each([
    '2 de 60x60 y tres de 120x60',
    'dos de 60x60 y tres de 120x60',
    'dos o tres focos',
    'cincuenta o sesenta paneles',
    'dos o tres',
  ])('R3-7: con la pregunta hecha, "%s" → varios ítems, nunca uno de sus números', (text) => {
    expect(readQuantity(text, { asked: true })).toEqual({ explicit: false, several: true });
  });

  it.each([
    ['20 paneles, dos de ellos regulables', 20],
    ['tengo dos bodegas y necesito 20 focos', 20],
    ['necesito 2 de 60x60', 2],
    ['dos focos', 2],
  ])('R3-7: "%s" → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });

  it.each([
    'No necesito veinte focos',
    'no quiero comprar 20 focos',
    'No los necesito 20',
    'no vamos a pedir 20 focos',
  ])('R3-2: la cantidad negada "%s" → vacía', (text) => {
    expect(readQuantity(text).value).toBeUndefined();
  });
});

describe('separador de miles con punto (verificación adversaria de la PR #142)', () => {
  // 1 a 3 cifras y luego un grupo de exactamente 3, seguido de la unidad o el producto: es un entero.
  it.each([
    ['1.000 focos', 1000],
    ['Necesito 1.000 focos LED', 1000],
    ['1.500 paneles LED', 1500],
    ['necesito 2.500 paneles', 2500],
    ['son 12.000 tubos', 12000],
    ['12 focos', 12],
  ])('%s → %i', (text, expected) => {
    expect(readQuantity(text, { claude: '1' })).toEqual({ value: expected, explicit: true });
  });

  it.each([
    // [METROS] "10.000 metros de cinta LED" ya no queda vacía: son 10.000 m (ver "metros que se piden")
    'una tira de 1.5 metros',
    'una tira de 1,5',
    'presupuesto de $1.000',
    'Comercial Prueba SpA, RUT 76.123.456-0',
    'mi celular es +56 9 1234 5678',
    'mi celular es 9 1234 5678',
  ])('%s → vacía, aunque la pregunta pidiera la cantidad y Claude diga el número', (text) => {
    const number = text.match(/\d[\d.,]*/)?.[0] ?? '';
    for (const claude of [number, number.replace(/\./g, '')]) {
      expect(readQuantity(text, { asked: true, claude }).value).toBeUndefined();
    }
  });

  it('"2 . 000" con espacios no es un número con separador de miles', () => {
    expect(readQuantity('necesito 2 . 000 focos').value).not.toBe(2000);
  });
});

describe('ronda 8 (el punto de "aprox." no corta la negación)', () => {
  it.each([
    'No necesito aprox. 30 focos',
    'no necesito aproximadamente. 20 focos',
    'No quiero comprar aprox. 15 paneles',
  ])('la cantidad negada con la abreviatura "%s" → vacía', (text) => {
    expect(readQuantity(text).value).toBeUndefined();
  });

  it.each([
    ['Necesito aprox. 30 focos', 30],
    ['Busco aprox. 12 paneles LED', 12],
  ])('la afirmativa con la abreviatura "%s" → %i', (text, expected) => {
    expect(readQuantity(text)).toEqual({ value: expected, explicit: true });
  });
});

// [LED-INTERNOS] Fase 1 del bot (negocios 120, 122 y 164): los LED que trae el producto no son unidades.
describe('los LED del producto no son la cantidad', () => {
  it.each([
    'Luz De 36 LED Barra De 50 Cm Con Sensor De Movimiento En Luz Blanca Recargable',
    'cinta led interior calida de de 60 led por 5 metros',
    'Luminaria vial solar led\n600w\n126 led\n3000 lumenes\nIp 65',
    '60 leds/m',
  ])('%s → vacía, aunque la pregunta pidiera la cantidad y Claude diga la cifra', (text) => {
    const number = text.match(/\d+(?=\s*led)/i)?.[0] ?? '';
    for (const claude of [undefined, number]) {
      expect(readQuantity(text, { asked: true, claude }).value).toBeUndefined();
      expect(readQuantity(text, { claude }).value).toBeUndefined();
    }
  });

  it.each([
    ['80 LED redondo embutido, 18 W, luz fría', 80],
    ['necesito 20 led', 20],
    ['necesito 2 barras de 36 led', 2],
  ])('%s → %i (LED como producto, o la cantidad de barras)', (text, expected) => {
    expect(readQuantity(text, { asked: true }).value).toBe(expected);
  });
});

// [METROS] Fase 1 del bot (negocios 143, 156, 208 y 212): los metros que se piden quedan con su unidad.
describe('metros que se piden', () => {
  it.each([
    ['10.000 metros de cinta LED', 10000, false],
    ['Necesito 500 metros', 500, false],
    ['Cinta Led, 2000 metros, comuna Tierra Amarilla', 2000, false],
    ['500 metros de cinta neoflex', 500, false],
    ['90 mtros', 90, true],
  ])('%s → %i m', (text, value, asked) => {
    expect(readQuantity(text, { asked })).toEqual({ value, explicit: true, unit: 'm' });
  });

  it('"1 rollo de 50 mts o +" es 1 rollo, sin metros', () => {
    expect(readQuantity('1 rollo de 50 mts o +')).toEqual({ value: 1, explicit: true });
  });

  it.each([
    'cinta led para exterior de 50 mts',
    'Necesito 1.5 metros de cinta LED',
    'cinta LED de 1,5 metros',
    'focos para un poste a 3 metros',
    'necesito lo siguiente en 200 metros',
    'una cinta de 5 metros',
    'https://example.com/cinta-led-50m',
    'necesito focos para un pasillo de 30 metros de largo',
  ])('%s → vacía (es una medida, no lo que se pide)', (text) => {
    expect(readQuantity(text).value).toBeUndefined();
  });

  it('"90 mtros" sin la pregunta por la cantidad no es nada (antes eran 90 unidades)', () => {
    expect(readQuantity('90 mtros').value).toBeUndefined();
  });
});

// [METROS] y [LED-INTERNOS] (revisión del 12-11-2026): el largo del lugar o del producto no es lo que se pide, y la
// cantidad dicha con "alrededor de" o "un pedido de" sigue contando.
describe('revisión del 12-11: metros del lugar o del título, y LED', () => {
  it.each([
    'Necesito reflectores LED luz fría para 80 metros de fachada en Quilicura',
    'Tengo 50 metros de muro perimetral, necesito reflectores LED',
    'focos solares para 300 metros de calle',
    'Necesito luminarias solares para 200 metros de calle en Lampa, luz fría',
    'Necesito reflectores para 300 metros de cerco',
    'Necesito iluminar 100 metros de pasillo',
    'quiero postes solares para 500 metros de camino',
    'Necesito 80 metros de fachada',
    'Hola, me interesa la Tira LED 5m 12V luz cálida',
    'Hola, consulta por CINTA LED EXTERIOR 14,4W SMD 5730 72LEDs/m 100mt. 220V. AZUL (SKU: ABC123)',
    'Hola, consulta por KIT DE INSTALACIÓN CABLES SUSPENDIDOS 1 MT. PARA PANELES (SKU: ABC123)',
  ])('%s → sin metros', (text) => {
    for (const asked of [false, true]) expect(readQuantity(text, { asked }).unit).toBeUndefined();
    expect(readQuantity(text).value).toBeUndefined();
  });

  it('negocio 146: el título repetido después de la pregunta ("120M/W") no son 120 m', () => {
    expect(readQuantity('FOCO LED PORTATIL RECARGABLE SMD20W, IP66, 120M/W,2400 LUMENES', { asked: true }).unit).toBeUndefined();
  });

  it('con un producto que no se vende por metro, "Necesito 200 metros" no son metros; con cinta, sí', () => {
    expect(readQuantity('Necesito 200 metros', { product: 'reflectores LED' }).value).toBeUndefined();
    expect(readQuantity('Necesito 200 metros', { product: 'cinta LED neoflex' })).toEqual({ value: 200, explicit: true, unit: 'm' });
  });

  it('el botón de la ficha con "BARRA DE EMERGENCIA 60 LEDs" no trae cantidad', () => {
    for (const asked of [false, true]) {
      expect(readQuantity('Hola, consulta por BARRA DE EMERGENCIA 60 LEDs RECARGABLE AUTONOMÍA 3-6 HRS. (SKU: ABC123)', { asked }).value).toBeUndefined();
    }
  });

  it.each([
    ['Necesito alrededor de 50 led', 50],
    ['cerca de 40 leds para mi local', 40],
    ['un total de 30 led', 30],
    ['Necesito un pedido de 100 leds', 100],
    ['Quiero una cotización de 20 LED para mi casa', 20],
  ])('%s → %i (la cantidad, como en main)', (text, expected) => {
    expect(readQuantity(text).value).toBe(expected);
  });

  // Depende de los nombres del catálogo del día: en el robot de sincronización solo informa (src/test/syncBot.ts).
  it.skipIf(isSyncBot)('el texto del botón de cada ficha del catálogo nunca trae metros ni cantidad', () => {
    const wrong: string[] = [];
    for (const product of jumpsellerSnapshot) {
      const sku = product.sku || product.variants[0]?.sku || 'ABC123';
      const text = new URL(waProductUrl(product.name, sku)).searchParams.get('text') ?? '';
      const free = readQuantity(text);
      if (free.value !== undefined || free.several || readQuantity(text, { asked: true }).unit) wrong.push(text);
    }
    expect(wrong).toEqual([]);
  });
});

// Revisión de Codex del 13-11-2026: con un verbo de pedido en la misma oración, "N LED" es la cantidad, como en main.
describe('[LED-INTERNOS] (revisión 13-11) la cantidad pedida con otro producto nombrado', () => {
  it.each(['Para los focos necesito 20 led', 'Necesito focos, 20 LED'])('"%s" → 20', (text) => {
    expect(readQuantity(text, { asked: true }).value).toBe(20);
  });
  it('la lista de especificaciones sigue sin cantidad', () => {
    expect(readQuantity('Luminaria vial solar led\n600w\n126 led\n3000 lumenes\nIp 65', { asked: true }).value).toBeUndefined();
  });
});
