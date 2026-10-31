// api/_lib/whatsapp/quantity.test.ts
// Bot de WhatsApp, PR 2 del plan (B2, B3 y CASO-1): readQuantity y claudeQuantity, sin el flujo.
// La cantidad es un entero o nada: explicita, o la respuesta a una pregunta por ella; nunca la
// potencia, la medida, el RUT, el telefono, los numeros de un correo ni los de un modelo.
// Solo mensajes, correos y RUT inventados.

import { describe, expect, it } from 'vitest';
import { claudeQuantity, readQuantity } from './quantity';

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
