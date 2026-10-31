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
    expect(readQuantity(text, { claude: '15' }).value).toBeUndefined();
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
    [{ paneles: 20, focos: 10 }, undefined],
    [[20, 10], undefined],
    [null, undefined],
  ])('%j → %s', (value, expected) => {
    expect(claudeQuantity(value)).toBe(expected);
  });
});
