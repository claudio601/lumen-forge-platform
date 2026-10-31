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

  it('"ciento veinte focos" queda vacía (no 20)', () => {
    expect(readQuantity('necesito ciento veinte focos').value).toBeUndefined();
  });

  it.each(['uno', 'solo una', 'uno nomás', 'necesito solo uno'])('"%s" contesta la pregunta por la cantidad con 1', (text) => {
    expect(readQuantity(text, { asked: true })).toEqual({ value: 1, explicit: true });
    expect(readQuantity(text).value).toBeUndefined();
  });
});
