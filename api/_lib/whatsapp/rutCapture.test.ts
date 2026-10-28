// api/_lib/whatsapp/rutCapture.test.ts
// Bot de WhatsApp, PR 6 del plan (B12): cuándo un texto trae un RUT, si calza y de qué tipo es.
// Solo RUT inventados con dígito verificador válido (módulo 11) y su versión con el dígito
// cambiado; ninguno es de un cliente. Celulares +569000… o 9XXXXXXXX inventados, correos
// @example.com. La segunda parte cubre lo que encontró la revisión de la #121: rangos de montos,
// ID de licitación, celulares cuando el bot pidió el RUT, cuerpos con puntos sin dígito
// verificador y el nombre «Rut».

import { describe, expect, it } from 'vitest';
import { RUT_EXAMPLE, findRut, isBusinessRut, rutTipo } from './rutCapture';

const EMPRESA = { rut: '77.123.456-9', valido: true, tipo: 'empresa' };

describe('sí es un RUT', () => {
  it.each([
    ['con puntos y guion', 'Comercial Prueba SpA, 77.123.456-9'],
    ['sin puntos, con guion', 'el rut es 77123456-9 gracias'],
    ['guion con espacios', '77.123.456 - 9'],
    ['guion del celular (‐)', '77.123.456‐9'],
    ['signo menos de un PDF (−)', '77.123.456−9'],
    ['después de "RUT", sin guion', 'RUT 771234569'],
    ['después de "rut:", con espacios', 'rut: 77 123 456 9'],
    ['después de "el RUT de la empresa es"', 'el RUT de la empresa es 77.123.456 9'],
    ['después de "R.U.T."', 'R.U.T. 77123456 9'],
  ])('%s', (_caso, text) => {
    expect(findRut(text)).toEqual(EMPRESA);
  });

  it('K minúscula o mayúscula, con espacios después de "RUT"', () => {
    expect(findRut('RUT 77 431 900 k')).toEqual({ rut: '77.431.900-K', valido: true, tipo: 'empresa' });
    expect(findRut('77.431.900-K')).toEqual({ rut: '77.431.900-K', valido: true, tipo: 'empresa' });
  });

  it('cuerpo de 7 dígitos (persona)', () => {
    expect(findRut('mi rut es 7.123.456-8')).toEqual({ rut: '7.123.456-8', valido: true, tipo: 'persona' });
  });

  it('el número solo, cuando el bot pidió el RUT', () => {
    expect(findRut('771234569', { asked: true })).toEqual(EMPRESA);
    expect(findRut('77.123.456 9 y compras@comercial-prueba.example.com', { asked: true })).toEqual(EMPRESA);
  });
});

describe('no es un RUT', () => {
  it.each([
    ['un celular (aunque su último dígito calce)', 'mi celular es 900017774'],
    ['un celular con +56', 'llámame al +56 9 0001 7774 o al +56900017774'],
    ['un número de pedido', 'mi pedido es el 10045678'],
    ['los dígitos de un correo', 'Soy Ana Prueba, ana.prueba.20261026@example.com'],
    ['un correo con un RUT adentro', 'escríbeme a ana-77123456-9@example.com'],
    ['un enlace', 'mira https://example.com/p/77123456-9'],
    ['una fecha', 'para el 2026-10-26'],
    ['medidas y temperaturas', 'paneles 60x60 de 3000-4000K, 120x30'],
    ['la palabra "ruta"', 'en la ruta 77123456 9'],
    ['el número solo, sin que el bot lo pida', '771234569'],
  ])('%s', (_caso, text) => {
    expect(findRut(text)).toBeUndefined();
  });

  it('cuando el bot pidió el RUT, igual no toma los dígitos de un correo ni un número de 11 cifras', () => {
    expect(findRut('cliente.771234569@example.com', { asked: true })).toBeUndefined();
    expect(findRut('56900017774', { asked: true })).toBeUndefined();
  });
});

describe('validación y tipo', () => {
  it('el dígito cambiado: se reconoce, con formato, pero no es válido y no tiene tipo', () => {
    expect(findRut('RUT 77.123.456-8')).toEqual({ rut: '77.123.456-8', valido: false });
  });

  it('si hay dos, gana el válido', () => {
    expect(findRut('77.123.456-8, perdón, 77.123.456-9')).toEqual(EMPRESA);
  });

  it.each([
    ['11.111.111-1', 'persona'],
    ['21.111.111-9', 'persona'],
    ['61.234.567-8', 'organismo_publico'],
    ['69.123.456-8', 'organismo_publico'],
    ['56.111.222-3', 'comunidad'],
    ['53.123.456-1', 'comunidad'],
    ['77.123.456-9', 'empresa'],
  ])('%s es %s', (rut, tipo) => {
    expect(findRut('RUT ' + rut)?.tipo).toBe(tipo);
  });

  it('el límite entre persona y empresa son 50 millones', () => {
    expect(rutTipo(49_999_999)).toBe('persona');
    expect(rutTipo(50_000_000)).toBe('empresa');
  });

  it('solo un RUT válido que no es de persona marca el lead como empresa', () => {
    expect(isBusinessRut(findRut('77.123.456-9'))).toBe(true);
    expect(isBusinessRut(findRut('61.234.567-8'))).toBe(true);
    expect(isBusinessRut(findRut('11.111.111-1'))).toBe(false);
    expect(isBusinessRut(findRut('77.123.456-8'))).toBe(false);
    expect(isBusinessRut(undefined)).toBe(false);
  });
});

describe('rangos de montos e ID de licitación (revisión de la #121)', () => {
  it.each([
    ['rango con puntos y guion', 'presupuesto entre 1.000.000-2.000.000'],
    ['rango con espacios', 'presupuesto: 2.500.000 - 3.000.000 aprox'],
    ['con signo peso', 'tengo $1.500.000-2.000.000'],
    ['signo peso y espacio', '$ 1.500.000-2'],
    ['rango de lúmenes', 'entre 1.200.000-1.500.000 lúmenes'],
    ['"millones"', 'entre 1.000.000 - 2 millones'],
    ['"presupuesto" antes', 'presupuesto 1.500.000-2'],
    ['ID de licitación de Mercado Público', 'licitación ID 1057501-9-LE24'],
    ['código con guion antes', 'código LE24-1057501-9'],
  ])('%s: no es un RUT', (_caso, text) => {
    expect(findRut(text)).toBeUndefined();
  });

  it('un RUT con la palabra "RUT" gana aunque el mismo mensaje traiga un rango o un ID', () => {
    expect(findRut('RUT 77 123 456 9, presupuesto 1.000.000-2.000.000')).toEqual(EMPRESA);
    expect(findRut('RUT 77 123 456 9, para la licitación 1057501-5-LE24')).toEqual(EMPRESA);
  });

  it('un RUT al final de una oración o entre guiones de lista sí cuenta', () => {
    expect(findRut('Mi RUT es 77.123.456-9.')).toEqual(EMPRESA);
    expect(findRut('Comercial Prueba SpA - 77.123.456-9 - compras@comercial-prueba.example.com')).toEqual(EMPRESA);
    expect(findRut('RUT 77.123.456-9 300 paneles')).toEqual(EMPRESA);
  });
});

describe('cuerpo con puntos o espacios: tiene que estar agrupado como un RUT', () => {
  it.each([
    ['"RUT" y el cuerpo con puntos, sin dígito verificador', 'mi RUT es 76.543.216'],
    ['lo mismo, seguido de texto', 'RUT 12.345.678 y necesito 20 paneles'],
    ['cuerpo con espacios, sin dígito verificador', 'RUT 12 345 678'],
    ['celular agrupado 9 XXXX XXXX', 'RUT 9 8765 4325'],
  ])('%s: no es un RUT', (_caso, text) => {
    expect(findRut(text)).toBeUndefined();
  });

  it('el cuerpo con puntos sin dígito verificador tampoco pasa cuando el bot pidió el RUT', () => {
    expect(findRut('el rut es 76.543.216, compras@comercial-prueba.example.com', { asked: true })).toBeUndefined();
  });

  it('un número que viene después no anula el RUT ("RUT 771234569 30 paneles")', () => {
    expect(findRut('Comercial Prueba SpA, RUT 771234569 30 paneles')).toEqual(EMPRESA);
    expect(findRut('RUT 77123456 9 30 paneles')).toEqual(EMPRESA);
    expect(findRut('RUT 77.123.456 9 30 paneles')).toEqual(EMPRESA);
  });
});

describe('más formas de escribir un RUT', () => {
  it.each([
    ['espacios entre grupos y guion', '77 123 456-9'],
    ['comas entre grupos', '77,123,456-9'],
    ['dos espacios alrededor del guion', '77.123.456  -  9'],
    ['guion de cifra (U+2012)', '77.123.456‒9'],
    ['pegado a un correo', '77.123.456-9,compras@comercial-prueba.example.com'],
    ['"RUT de mi empresa:"', 'RUT de mi empresa: 77123456 9'],
    ['"RUT de facturación"', 'RUT de facturación 77123456 9'],
    ['"el rut es el"', 'el rut es el 771234569'],
    ['"El RUT de mi empresa es", con espacios', 'El RUT de mi empresa es 77 123 456 9, compras@comercial-prueba.example.com'],
    ['"Rut de la constructora:"', 'Rut de la constructora: 77 123 456 9'],
  ])('%s', (_caso, text) => {
    expect(findRut(text)).toEqual(EMPRESA);
  });

  it('con espacios entre grupos y sin guion, cuando el bot pidió el RUT', () => {
    expect(findRut('77 123 456 9', { asked: true })).toEqual(EMPRESA);
  });
});

describe('cuando el bot pidió el RUT: celulares, montos y pedidos', () => {
  it.each([
    ['celular', 'mi celular es 912345678'],
    ['celular cuyo dígito calza', 'mi celular es 900017774'],
    ['fono fijo', 'fono 222345678'],
    ['whatsapp', 'whatsapp 987654325'],
    ['llámame', 'llámame al 912345678, compras@comercial-prueba.example.com'],
    ['con +56 y espacio', '+56 912345678'],
    ['monto', 'presupuesto $15000000'],
    ['pedido', 'mi pedido es el 10045678'],
    ['celular al final, con el correo', 'mi correo es compras@comercial-prueba.example.com y mi celular 900017774'],
    ['"te lo mando después" y el celular', 'el rut te lo mando después, mi celular es 987654325, compras@comercial-prueba.example.com'],
    ['nombre y celular seguido (sin palabra de teléfono)', 'Juan Prueba 912345678 juan.prueba@example.com'],
  ])('%s: no es un RUT', (_caso, text) => {
    expect(findRut(text, { asked: true })).toBeUndefined();
  });

  it('un número de 9 dígitos que empieza con 9 vale como respuesta solo si es todo el mensaje (sin el correo)', () => {
    expect(findRut('965432108', { asked: true })).toEqual({ rut: '96.543.210-8', valido: true, tipo: 'empresa' });
    expect(findRut('965432108, compras@comercial-prueba.example.com', { asked: true })?.rut).toBe('96.543.210-8');
  });

  it('el RUT junto a un celular con su palabra: gana el RUT', () => {
    const text = 'Comercial Prueba SpA, 771234569, cel 912345678, compras@comercial-prueba.example.com';
    expect(findRut(text, { asked: true })).toEqual(EMPRESA);
  });

  it('"total 30 paneles" antes no tapa el RUT (hay dígitos entre medio)', () => {
    expect(findRut('Comercial Prueba SpA, total 30 paneles, 771234569', { asked: true })).toEqual(EMPRESA);
  });
});

describe('el nombre «Rut»', () => {
  it.each([
    ['firma con celular agrupado', 'Saludos\nRut\n9 8765 4325'],
    ['nombre y celular seguido', 'Rut 987654325'],
    ['nombre, apellido y celular', 'Rut de la Fuente, cel 912345678'],
    ['nombre y "mi número es"', 'Rut, mi número es 912345678'],
  ])('%s: no es un RUT', (_caso, text) => {
    expect(findRut(text)).toBeUndefined();
  });

  it('un RUT que empieza con 9, seguido, vale con "RUT" en mayúsculas o con algo entre medio', () => {
    const SA = { rut: '96.543.210-8', valido: true, tipo: 'empresa' };
    expect(findRut('RUT 965432108')).toEqual(SA);
    expect(findRut('Rut: 965432108')).toEqual(SA);
    expect(findRut('rut es 965432108')).toEqual(SA);
  });
});

describe('si hay varios RUT', () => {
  it('sin pertenencia explicita no elige el de empresa sobre el de persona', () => {
    expect(findRut('Soy Ana Prueba, RUT 11.111.111-1, la empresa es 77.123.456-9')).toBeUndefined();
  });

  it('si ninguno calza, gana el que viene después de la palabra "RUT"', () => {
    expect(findRut('77.123.456-7 o RUT 77 123 456 8')).toEqual({ rut: '77.123.456-8', valido: false });
  });
});

describe('el ejemplo de la repregunta', () => {
  it('calza su dígito verificador, pero copiado no se toma como RUT', () => {
    expect(findRut('RUT ' + RUT_EXAMPLE.replace(/\.|-/g, ''))).toBeUndefined();
    expect(findRut('Por ejemplo: ' + RUT_EXAMPLE)).toBeUndefined();
    expect(findRut(RUT_EXAMPLE, { asked: true })).toBeUndefined();
  });
});

describe('mensajes largos', () => {
  it.each([
    ['letras sin espacios', 'a'.repeat(65_536)],
    ['dígitos sin espacios', '1'.repeat(65_536)],
    ['cuerpos con guion repetidos', '1234567-'.repeat(8_192)],
    ['"RUT" y espacios', 'RUT ' + ' '.repeat(65_536)],
    ['arrobas', 'x@'.repeat(32_768)],
  ])('%s: responde en menos de 50 ms', (_caso, text) => {
    const start = performance.now();
    findRut(text, { asked: true });
    expect(performance.now() - start).toBeLessThan(50);
  });
});


describe('R121-01: candidatos con guion y contexto ajeno al RUT', () => {
  it.each([
    '+56 90001777-4', 'celular 90001777-4', 'pedido 77123456-9', 'APB77123456-9',
    'fono 90001777-4', 'teléfono 90001777-4', 'orden 77123456-9', 'N° 77123456-9', 'nro. 77123456-9',
    'Ñ77123456-9', '77123456-9Ñ',
  ])('%s: sin RUT, tambien si se habia pedido', (text) => {
    expect(findRut(text)).toBeUndefined();
    expect(findRut(text, { asked: true })).toBeUndefined();
  });
});

describe('R121-02: pertenencia de varios RUT', () => {
  it.each(['mi RUT', 'nuestro RUT', 'RUT de mi empresa'])('%s identifica el RUT del cliente', (prefix) => {
    expect(findRut('Proveedor: 77.123.456-9; ' + prefix + ' 11.111.111-1')).toEqual({ rut: '11.111.111-1', valido: true, tipo: 'persona' });
  });

  it('una cotizacion pegada no gana sobre «Mi RUT»', () => {
    expect(findRut('Mi RUT es 11.111.111-1. Cotizacion: RUT de la empresa 77.123.456-9')).toEqual({ rut: '11.111.111-1', valido: true, tipo: 'persona' });
  });

  it('«de la empresa» y dos pertenencias distintas siguen siendo ambiguos', () => {
    expect(findRut('11.111.111-1; RUT de la empresa 77.123.456-9')).toBeUndefined();
    expect(findRut('mi RUT 11.111.111-1; nuestro RUT 77.123.456-9')).toBeUndefined();
  });

  it('repetir el mismo RUT con distintos formatos no genera ambiguedad', () => {
    expect(findRut('RUT 77123456-9; 77.123.456-9')).toEqual(EMPRESA);
  });
});


describe('segunda tanda: pertenencia después del número', () => {
  it.each(['es mi RUT', 'es nuestro RUT'])('%s reconoce al dueño a la derecha', suffix => {
    expect(findRut('77.123.456-9 es del proveedor y 11.111.111-1 ' + suffix))
      .toEqual({ rut: '11.111.111-1', valido: true, tipo: 'persona' });
  });

  it.each([
    '77.123.456-9 es del proveedor y 11.111.111-1 es el RUT de facturación',
    '77.123.456-9 es mi RUT y 11.111.111-1 es nuestro RUT',
    '77.123.456-9 es del proveedor y 11.111.111-1. Por favor, guarden este dato: es mi RUT',
  ])('sin pertenencia única cercana sigue ambiguo: %s', text => {
    expect(findRut(text)).toBeUndefined();
  });
});
