// api/_lib/whatsapp/comunas.test.ts
// Bot de WhatsApp, PR 3 del plan (B4): la comuna sale de la lista oficial y solo cuando el texto la
// presenta como lugar o contesta la pregunta por la comuna. Solo mensajes, correos y direcciones inventados.

import { describe, expect, it } from 'vitest';
import { COMUNAS } from './comunas.generated';
import { findComunaMentions, findComunas, officialComuna } from './comunas';

describe('lista oficial', () => {
  it('trae las 346 comunas, sin repetir código ni nombre', () => {
    expect(COMUNAS).toHaveLength(346);
    expect(new Set(COMUNAS.map(([code]) => code)).size).toBe(346);
    expect(new Set(COMUNAS.map(([, name]) => name)).size).toBe(346);
    expect(COMUNAS.every(([code]) => /^(0[1-9]|1[0-6])\d{3}$/.test(code))).toBe(true);
  });

  it('cada región tiene sus comunas (16 regiones)', () => {
    expect(new Set(COMUNAS.map(([code]) => code.slice(0, 2))).size).toBe(16);
    expect(COMUNAS.filter(([code]) => code.startsWith('13'))).toHaveLength(52);
  });

  // Referencia escrita a mano (INE/SUBDERE), no la tabla del script que escribe el archivo.
  it.each([
    ['04105', 'Paihuano'],
    ['05502', 'Calera'],
    ['07309', 'Vichuquén'],
    ['09112', 'Padre Las Casas'],
    ['11101', 'Coyhaique'],
    ['12202', 'Antártica'],
    ['13101', 'Santiago'],
    ['13106', 'Estación Central'],
    ['13120', 'Ñuñoa'],
    ['16207', 'Treguaco'],
  ])('el código %s es %s, su nombre oficial', (code, name) => {
    expect(new Map(COMUNAS).get(code)).toBe(name);
  });

  it('el archivo generado está en ASCII', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('./comunas.generated.ts', import.meta.url), 'utf8');
    expect([...text].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});

describe('officialComuna', () => {
  it.each([
    ['nunoa', 'Ñuñoa'],
    ['MAIPU', 'Maipú'],
    ['Santiago Centro', 'Santiago'],
    ['Til Til', 'Tiltil'],
    ['Llay-Llay', 'Llaillay'],
    ['Coihaique', 'Coyhaique'],
    ['OHiggins', "O'Higgins"],
    ['Viña', 'Viña del Mar'],
    ['  la serena ', 'La Serena'],
    ['La Calera', 'Calera'],
    ['calera', 'Calera'],
    ['Trehuaco', 'Treguaco'],
    ['Treguaco', 'Treguaco'],
  ])('"%s" es %s', (text, name) => {
    expect(officialComuna(text)).toBe(name);
  });

  it.each(['Región Metropolitana', 'Chiloé', 'bodega', '', 'Santiago, Chile'])('"%s" no es una comuna', (text) => {
    expect(officialComuna(text)).toBeUndefined();
  });

  it('un valor que no es texto no es una comuna', () => {
    expect(officialComuna({ comuna: 'Lampa' })).toBeUndefined();
    expect(officialComuna(['Lampa'])).toBeUndefined();
  });
});

describe('comuna con frase de ubicación', () => {
  it.each([
    ['Es para una bodega en Lampa', ['Lampa']],
    ['Quiero cotizar 25 BESTLED para un pasaje en La Serena', ['La Serena']],
    ['Soy de Maipu y necesito 10 focos', ['Maipú']],
    ['necesito paneles para puente alto', ['Puente Alto']],
    ['despacho a Temuco', ['Temuco']],
    ['la obra es en la comuna de San Pedro de la Paz', ['San Pedro de la Paz']],
    ['comuna: Ñuñoa', ['Ñuñoa']],
    ['corrijo la comuna a Temuco', ['Temuco']],
    ['es en la florida', ['La Florida']],
    ['para una oficina en Pto. Montt', ['Puerto Montt']],
    ['es en Isla de Maipo', ['Isla de Maipo']],
    ['La obra es en Lampa y la facturación en Viña del Mar', ['Lampa', 'Viña del Mar']],
    ['desde Concepción, para una cancha en Coronel', ['Concepción', 'Coronel']],
  ])('"%s" da %j', (text, expected) => {
    expect(findComunas(text)).toEqual(expected);
  });

  it.each([
    'Necesito 20 paneles. Maipú.',
    'Lampa',
    'quiero focos para un patio',
    'Av. Santiago Bueras 1234, Lampa',
    'la dirección es Providencia 1234, depto 5',
    'calle Pedro de Valdivia 300',
    'es en la Región de Valparaíso',
    'provincia de Santiago',
    '¿Tienen sucursal en Concepción?',
    'quería saber si tienen tienda en Maipú?',
    'retiro en Quinta Normal',
    'puedo retirar en la bodega de Quinta Normal',
    'Ya compré, ¿cuál es la dirección de retiro?',
    'luces para Navidad',
    'las necesito en primavera',
    'es para la granja del colegio',
    'trabajo en una viña',
    'hay que cambiar la caldera de la sala de calderas',
  ])('"%s" no da ninguna comuna', (text) => {
    expect(findComunas(text)).toEqual([]);
  });

  it('un correo con el nombre de una comuna no la da (aunque el texto lo traiga)', () => {
    expect(findComunas('mi correo es santiago.prueba@example.com')).toEqual([]);
    expect(findComunas('www.lampa.cl')).toEqual([]);
  });

  it('un número después de la comuna es una cantidad, no una dirección', () => {
    expect(findComunas('para Maipú 20 paneles')).toEqual(['Maipú']);
    expect(findComunas('en Maipú, 20 paneles')).toEqual(['Maipú']);
  });

  it('una comuna que es palabra común cuenta con mayúscula', () => {
    expect(findComunas('es para un galpón en Victoria')).toEqual(['Victoria']);
    expect(findComunas('es para la Granja')).toEqual(['La Granja']);
    expect(findComunas('es en Viña')).toEqual(['Viña del Mar']);
  });
});

describe('respuesta a la pregunta por la comuna', () => {
  it.each([
    ['Lampa', ['Lampa']],
    ['Santiago', ['Santiago']],
    ['santiago', ['Santiago']],
    ['Soy de Maipú', ['Maipú']],
    ['Maipú, Región Metropolitana', ['Maipú']],
    ['bodega, Lampa', ['Lampa']],
    ['En la comuna de Lampa', ['Lampa']],
    ['Av. Santiago Bueras 1234, Lampa', ['Lampa']],
    ['retiro', ['Retiro']],
    ['la granja', ['La Granja']],
  ])('"%s" da %j', (text, expected) => {
    expect(findComunas(text, { answering: true })).toEqual(expected);
  });

  it.each([
    'mi correo es santiago.prueba@example.com',
    'Necesito 20 paneles para Maipu',
  ])('"%s" sigue la regla de siempre', (text) => {
    expect(findComunas(text, { answering: true })).toEqual(findComunas(text));
  });

  it('"Ya compré, ¿cuál es la dirección de retiro?" no da Retiro aunque se haya preguntado la comuna', () => {
    expect(findComunas('Ya compré, ¿cuál es la dirección de retiro?', { answering: true })).toEqual([]);
  });
});

describe('el propósito del lugar (hallazgo 2 de Codex)', () => {
  it('la comuna de la facturación es otra comuna mencionada, no la de la obra', () => {
    expect(findComunaMentions('Los datos de facturación son de Viña del Mar')).toEqual([{ name: 'Viña del Mar', billing: true }]);
    expect(findComunaMentions('Facturación en Providencia con despacho a Lampa')).toEqual([
      { name: 'Providencia', billing: true }, { name: 'Lampa', billing: false },
    ]);
  });

  it.each([
    'Quiero retirar el pedido en Quinta Normal',
    '¿Puedo ir a su local en Maipú?',
    'En Concepción tienen sucursal?',
    'Tienen showroom en Las Condes',
    'me queda cerca ir a su tienda en Ñuñoa',
  ])('"%s" no da ninguna comuna, tampoco como respuesta', (text) => {
    expect(findComunas(text)).toEqual([]);
    expect(findComunas(text, { answering: true })).toEqual([]);
  });

  it('"retiro en Quinta Normal" como respuesta no da Retiro', () => {
    expect(findComunas('retiro en Quinta Normal', { answering: true })).toEqual([]);
  });

  it('un ancla de obra justo antes gana a las palabras de retiro o sucursal', () => {
    expect(findComunas('En vez de retirar prefiero que lo despachen a Lampa')).toEqual(['Lampa']);
    expect(findComunas('Necesito 20 focos para nuestra sucursal en Temuco')).toEqual(['Temuco']);
  });
});

describe('razón social (hallazgo 3 de Codex)', () => {
  it.each([
    'Somos Iluminación de Los Andes SpA',
    'Trabajo en Constructora Los Andes Ltda.',
    'CONSTRUCTORA LOS ANDES LTDA',
    'Comercial Los Andes S.A.',
    'Servicios Lampa EIRL',
    'Proyectos Colina E.I.R.L.',
  ])('"%s" no da la comuna de su nombre', (text) => {
    expect(findComunas(text)).toEqual([]);
    expect(findComunas(text, { answering: true })).toEqual([]);
  });

  it('el nombre de la empresa no tapa la comuna de la obra', () => {
    expect(findComunas('Somos Iluminación de Los Andes SpA y necesitamos focos para una bodega en Lampa')).toEqual(['Lampa']);
  });

  it('"un spa" en minúscula no es una razón social', () => {
    expect(findComunas('Necesito focos para un spa en Los Andes')).toEqual(['Los Andes']);
  });
});

describe('correcciones (hallazgo 4 de Codex)', () => {
  it.each([
    'Corrijo: ahora es en Colina, antes era en Lampa',
    'Corrijo: Colina',
    'Corrección: Colina',
    'Perdón, es Colina',
    'en realidad es Colina',
    'mejor dicho Colina',
    'Es en Colina, no en Lampa',
    'Es en Colina en vez de Lampa',
  ])('"%s" da Colina', (text) => {
    expect(findComunas(text)).toEqual(['Colina']);
  });

  it.each(['antes dije Lampa', 'antes era en Lampa', 'no es en Lampa'])('"%s" no da ninguna comuna', (text) => {
    expect(findComunas(text)).toEqual([]);
  });
});

describe('formas comunes de dar la comuna (hallazgo 6 de Codex)', () => {
  it.each([
    ['La comuna es: Lampa', ['Lampa']],
    ['la comuna es Lampa', ['Lampa']],
    ['Necesito focos para una bodega en victoria', ['Victoria']],
    ['Necesito focos para una bodega en la granja', ['La Granja']],
    ['Necesito focos para una bodega en Retiro', ['Retiro']],
    ['Necesito paneles para una oficina en Lampa y son 20', ['Lampa']],
    ['es para un galpón en Lampa y serían 20', ['Lampa']],
  ])('"%s" da %j', (text, expected) => {
    expect(findComunas(text)).toEqual(expected);
  });

  it.each([
    'luces para la casa en Navidad',
    'Necesito luces para la casa en navidad',
    'la instalación sería en primavera',
  ])('"%s" sigue sin dar Navidad ni Primavera', (text) => {
    expect(findComunas(text)).toEqual([]);
  });
});

describe('cada aparición se clasifica (hallazgo 7 de Codex)', () => {
  it('una comuna que también es de la obra queda como la de la obra', () => {
    expect(findComunaMentions('La facturación es en Lampa, la obra también es en Lampa')).toEqual([{ name: 'Lampa', billing: false }]);
    expect(findComunaMentions('La obra es en Lampa y la facturación también en Lampa')).toEqual([{ name: 'Lampa', billing: false }]);
  });
});

describe('direcciones de leads (casos inventados)', () => {
  it('"km 8" después de la comuna es una dirección, no la comuna', () => {
    expect(findComunas('Direccion: Camino de Lampa Km 8 s/n, Colina', { answering: true })).toEqual(['Colina']);
    expect(findComunas('Dirección: Fundo El Prueba de Lampa Km 8 s/n, Colina', { answering: true })).toEqual(['Colina']);
    expect(findComunas('Dirección: Fundo El Prueba de Lampa kilómetro 8, Colina', { answering: true })).toEqual(['Colina']);
    expect(findComunas('es en el fundo de Lampa km 8')).toEqual([]);
  });

  it('la dirección de un bloque de datos de la empresa es la de la factura', () => {
    expect(findComunaMentions('RUT 11.111.111-1, Direccion: Av. Prueba 123, oficina 5, Providencia', { answering: true }))
      .toEqual([{ name: 'Providencia', billing: true }]);
    expect(findComunaMentions('Dirección: Av. Prueba 123, oficina 5, Providencia', { answering: true, company: true }))
      .toEqual([{ name: 'Providencia', billing: true }]);
    expect(findComunaMentions('Facturación: Av. Prueba 123, comuna de Providencia'))
      .toEqual([{ name: 'Providencia', billing: true }]);
  });

  it('sin RUT ni razón social, la dirección que contesta la pregunta es la de la obra', () => {
    expect(findComunaMentions('Dirección: Av. Prueba 123, oficina 5, Providencia', { answering: true }))
      .toEqual([{ name: 'Providencia', billing: false }]);
    expect(findComunaMentions('RUT 11.111.111-1. Dirección de despacho: Av. Prueba 123, Providencia', { answering: true }))
      .toEqual([{ name: 'Providencia', billing: false }]);
  });

  it('un pedido después de la dirección de la empresa no queda como factura', () => {
    expect(findComunaMentions('RUT 11.111.111-1, Dirección: Av. Prueba 123, Providencia. Necesito 20 focos para una bodega en Lampa'))
      .toEqual([{ name: 'Lampa', billing: false }]);
  });
});

describe('revisión de los arreglos (casos inventados)', () => {
  it.each([
    ['Necesito 20 focos para la obra en Lampa de Constructora Prueba SpA', ['Lampa']],
    ['Necesito 20 focos para la bodega en Quilicura de Comercial Prueba Ltda', ['Quilicura']],
    ['NECESITO 20 FOCOS PARA BODEGA EN LAMPA EMPRESA PRUEBA SPA', ['Lampa']],
  ])('la razón social después de la comuna no la tapa: "%s" da %j', (text, expected) => {
    expect(findComunas(text)).toEqual(expected);
  });

  it('como respuesta, la comuna antes de la razón social cuenta', () => {
    expect(findComunas('Puente Alto Constructora Prueba SpA', { answering: true })).toEqual(['Puente Alto']);
  });

  it('la razón social en mayúsculas sigue sin dar la comuna de su nombre', () => {
    expect(findComunas('SOMOS ILUMINACION DE LOS ANDES SPA')).toEqual([]);
    expect(findComunas('TRABAJO EN CONSTRUCTORA LOS ANDES LTDA')).toEqual([]);
  });

  it('una calle en minúscula que empieza con una comuna es una dirección', () => {
    expect(findComunas('Necesito despacho a vicuña mackenna 1234, la florida')).not.toContain('Vicuña');
    expect(findComunas('vicuña mackenna 1234, la florida', { answering: true })).toEqual(['La Florida']);
    expect(findComunas('Necesito paneles para una bodega en Lampa son 20')).toEqual(['Lampa']);
    expect(findComunas('Necesito paneles para una bodega en Lampa unos 20')).toEqual(['Lampa']);
  });

  it.each([
    ['Soy instalador, mi cliente necesita 30 paneles para su oficina en Las Condes', ['Las Condes']],
    ['Mi cliente necesita 40 focos para su bodega en Lampa', ['Lampa']],
  ])('"para su oficina/bodega en X" es el lugar del cliente: "%s" da %j', (text, expected) => {
    expect(findComunas(text)).toEqual(expected);
  });

  it.each([
    ['Hola, necesito factura por 20 paneles para Maipú', 'Maipú'],
    ['Necesito 30 paneles para Puente Alto con factura', 'Puente Alto'],
    ['Necesito 20 focos para Lampa con boleta', 'Lampa'],
  ])('"%s": la factura o la boleta es el documento, %s es la comuna', (text, name) => {
    expect(findComunaMentions(text)).toEqual([{ name, billing: false }]);
  });

  it('la factura a nombre de una empresa de otra comuna sigue siendo la de la factura', () => {
    expect(findComunaMentions('Necesito factura a nombre de la empresa de Las Condes')).toEqual([{ name: 'Las Condes', billing: true }]);
    expect(findComunaMentions('Domicilio comercial: Av. Prueba 123, Providencia', { answering: true })).toEqual([{ name: 'Providencia', billing: true }]);
  });

  it.each([
    'Necesito cambiar y retirar los tubos de una bodega en Lampa',
    'Necesito retirar 20 equipos fluorescentes de una bodega en Lampa',
  ])('retirar los equipos viejos no es retirar el pedido: "%s" da Lampa', (text) => {
    expect(findComunas(text)).toEqual(['Lampa']);
  });

  it('"soy de" o "desde" es de donde es la persona: cuenta, pero queda marcada', () => {
    expect(findComunaMentions('Soy de Maipú')).toEqual([{ name: 'Maipú', billing: false, origin: true }]);
    expect(findComunaMentions('Ana Prueba, desde Maipú')).toEqual([{ name: 'Maipú', billing: false, origin: true }]);
    expect(findComunaMentions('Soy de Maipú, la obra es en Maipú')).toEqual([{ name: 'Maipú', billing: false }]);
    expect(findComunaMentions('Necesitamos paneles para la sucursal de Temuco')).toEqual([{ name: 'Temuco', billing: false }]);
    expect(findComunaMentions('Soy de Maipú', { answering: true })).toEqual([{ name: 'Maipú', billing: false }]);
  });

  it.each([
    ['Necesito 20 focos con despacho a domicilio en Maipú', 'Maipú', false],
    ['Necesito 20 focos para mi casa, mi domicilio es en La Florida', 'La Florida', false],
    ['Mi domicilio es en La Florida', 'La Florida', true],
  ])('"%s": el domicilio solo no es la factura (%s)', (text, name, answering) => {
    expect(findComunaMentions(text, { answering })).toEqual([{ name, billing: false }]);
  });

  it.each(['Antes dije Lampa pero es Colina', 'No es Lampa, es Colina', 'Es Colina, no Lampa', 'No es Lampa sino Colina', 'No, es Colina'])(
    'la corrección "%s" da Colina',
    (text) => {
      expect(findComunas(text)).toEqual(['Colina']);
    },
  );

  it('"para la sucursal de X" es la del cliente; en una pregunta, no', () => {
    expect(findComunas('Necesitamos paneles para la sucursal de Temuco')).toEqual(['Temuco']);
    expect(findComunas('¿Dónde queda la sucursal de Concepción?')).toEqual([]);
  });

  it('"despachar 20 focos a X" es el despacho', () => {
    expect(findComunaMentions('Necesito despachar 20 focos a Lampa. RUT 76.111.111-1, Dirección: Av. Prueba 123, Colina')).toEqual([{ name: 'Lampa', billing: false }]);
    expect(findComunaMentions('Necesito despachar 20 focos a Lampa. RUT 76.111.111-1, Dirección: Av. Prueba 123, Colina', { answering: true }))
      .toEqual([{ name: 'Lampa', billing: false }, { name: 'Colina', billing: true }]);
    expect(findComunas('Hay que enviar los 30 paneles a Lampa')).toEqual(['Lampa']);
  });
});

describe('bloques de datos de empresa (revisión con notas reales, casos inventados)', () => {
  it('la negrita de WhatsApp no tapa la etiqueta de la dirección de la empresa', () => {
    const text = '*COTIZACION A NOMBRE DE:*\n\n*RAZON SOCIAL:* Servicios Prueba SpA\n\n*RUT:* 77.123.456-9\n\n*DIRECCION*: Calle Prueba 252, oficina 205, PROVIDENCIA.\n\n*CONTACTO*: Ana';
    expect(findComunaMentions(text, { answering: true })).toEqual([{ name: 'Providencia', billing: true }]);
  });

  it('bajo «Facturación:» la dirección puede ir en varias líneas', () => {
    const text = 'Datos de facturación:\n\nComercial Prueba SpA\n\n77.123.456-9\n\nCalle Prueba #63\n\nciudad Los Lagos\n\nRegión de Los Ríos';
    expect(findComunaMentions(text)).toEqual([{ name: 'Los Lagos', billing: true }]);
    expect(findComunaMentions(text, { answering: true })).toEqual([{ name: 'Los Lagos', billing: true }]);
  });

  it('la obra en otra línea después de la factura sigue siendo la obra', () => {
    expect(findComunaMentions('Facturación: Comercial Prueba SpA\n\nLa obra es en Lampa'))
      .toEqual([{ name: 'Lampa', billing: false }]);
    expect(findComunaMentions('Facturación a nombre de Comercial Prueba SpA\nDespacho a Colina'))
      .toEqual([{ name: 'Colina', billing: false }]);
  });

  it('la negrita en la etiqueta de la comuna también vale', () => {
    expect(findComunas('*Comuna*: Lampa')).toEqual(['Lampa']);
    expect(findComunas('_comuna de la obra:_ Lampa')).toEqual(['Lampa']);
    expect(findComunas('Ciudad del despacho: Temuco')).toEqual(['Temuco']);
  });
});

describe('etiqueta o ancla explícita de obra (H5 de la ronda 2 de Codex)', () => {
  it.each([
    'Comuna de la obra: Colina con datos de facturación',
    '*Comuna de la obra:* Colina con retiro en su local',
    'Comuna: Colina con retiro en su local',
    'La obra está dentro de Colina.',
    'La obra queda en Colina con retiro en su local',
  ])('"%s" da Colina como la de la obra', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Colina', billing: false }]);
  });

  it('la exclusión que califica a la misma comuna sí cuenta', () => {
    expect(findComunaMentions('Comuna: Providencia para facturación')).toEqual([{ name: 'Providencia', billing: true }]);
    expect(findComunas('Comuna: Quinta Normal para retiro')).toEqual([]);
    expect(findComunaMentions('Necesito despacho a Lampa para facturar a nombre de la empresa')).toEqual([{ name: 'Lampa', billing: false }]);
  });

  // La ronda anterior exigía que un "de" suelto fuera el lugar de la obra: así "Mi señora es de Colina" cambiaba la
  // comuna capturada (revisión adversaria). "Dentro de" sí ubica la obra; un "de" suelto cuenta como en 57c5db5:
  // llena la vacía, no cambia la capturada.
  it('"dentro de" ubica la obra; un "de" suelto cuenta como de dónde es alguien', () => {
    expect(findComunaMentions('Es dentro de Colina')).toEqual([{ name: 'Colina', billing: false }]);
    expect(findComunaMentions('Necesito 20 focos de Colina')).toEqual([{ name: 'Colina', billing: false, origin: true }]);
    expect(findComunaMentions('Es de Colina')).toEqual([{ name: 'Colina', billing: false, origin: true }]);
    // Como respuesta a la pregunta por la comuna, "Es de Colina" la contesta.
    expect(findComunaMentions('Es de Colina', { answering: true })).toEqual([{ name: 'Colina', billing: false }]);
  });

  it.each([
    'Mi señora es de Colina',
    'La empresa es de Colina',
    'El dueño es de Colina',
    'Ana Prueba, de Colina',
    'ana prueba de colina',
    'Les escribe ana prueba de Colina',
    'Me recomendó un amigo de Colina',
    'Trabajo en una empresa de Colina',
  ])('revisión adversaria: "%s" no presenta la obra', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Colina', billing: false, origin: true }]);
  });

  it('"Comuna obra:" sin "de la" también es la etiqueta de la obra', () => {
    expect(findComunaMentions('Comuna obra: Colina con retiro en su local')).toEqual([{ name: 'Colina', billing: false }]);
    expect(findComunaMentions('Comuna de obra: Colina')).toEqual([{ name: 'Colina', billing: false }]);
  });

  it.each<[string, { name: string; billing: boolean }[]]>([
    ['Comuna: Providencia - facturación', [{ name: 'Providencia', billing: true }]],
    ['Comuna: Providencia – facturación', [{ name: 'Providencia', billing: true }]],
    ['Comuna: Providencia (facturación)', [{ name: 'Providencia', billing: true }]],
    ['Comuna: Colina, para facturación', [{ name: 'Colina', billing: true }]],
    ['Comuna: Quinta Normal - retiro', []],
    ['Comuna: Quinta Normal (retiro)', []],
    // Tras una coma y sin preposición, el retiro puede ser en el local: la comuna sigue siendo la del cliente.
    ['Comuna: Colina, retiro en su local', [{ name: 'Colina', billing: false }]],
  ])('el calificador de la etiqueta con guion, paréntesis o coma: "%s"', (text, expected) => {
    expect(findComunaMentions(text)).toEqual(expected);
  });

  it.each([
    ['Soy de Maipú', 'Maipú'],
    ['Somos de Maipú', 'Maipú'],
    ['Vengo de Maipú', 'Maipú'],
    ['Ana Prueba, desde Maipú', 'Maipú'],
    ['Soy Ana Prueba de Maipú', 'Maipú'],
    ['Somos una constructora de Colina', 'Colina'],
    ['Hola, les escribe Ana Prueba de Maipú', 'Maipú'],
  ])('"%s" sigue siendo de donde es la persona', (text, name) => {
    expect(findComunaMentions(text)).toEqual([{ name, billing: false, origin: true }]);
  });

  it('el retiro sin ancla explícita de obra sigue sin dar la comuna', () => {
    expect(findComunas('Quiero retirar el pedido en Quinta Normal')).toEqual([]);
    expect(findComunas('la comuna es Colina, retiro en su local')).toEqual(['Colina']);
  });
});

describe('encabezado de factura (H6 de la ronda 2 de Codex)', () => {
  it.each([
    'Facturación:\nDirección: Prueba 123\nComuna: Viña del Mar',
    'Facturación:\n*Dirección*: Prueba 123\n*Comuna*: Viña del Mar',
    'Datos de facturación:\nDirección: Prueba 123\nCiudad: Viña del Mar',
    'Dirección de facturación:\nCalle Prueba 123\nComuna: Viña del Mar',
    'Cotización a nombre de:\nGiro: Comercio\nCorreo: ana@example.com\nComuna: Viña del Mar',
    'Facturación:\nRUT: 11.111.111-1\nGiro: Comercio\nDirección: Prueba 123\nComuna: Viña del Mar',
  ])('el bloque queda como factura, con y sin Claude: %j', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Viña del Mar', billing: true }]);
    expect(findComunaMentions(text, { answering: true })).toEqual([{ name: 'Viña del Mar', billing: true }]);
  });

  it('una etiqueta de obra o despacho, o un pedido, corta el bloque', () => {
    expect(findComunaMentions('Facturación:\nDirección: Prueba 123\nComuna: Viña del Mar\nComuna de la obra: Lampa'))
      .toEqual([{ name: 'Viña del Mar', billing: true }, { name: 'Lampa', billing: false }]);
    expect(findComunaMentions('Facturación:\nDirección: Prueba 123\nDirección de despacho: Calle Prueba 5\nComuna: Lampa'))
      .toEqual([{ name: 'Lampa', billing: false }]);
    expect(findComunaMentions('Facturación:\nDirección: Prueba 123\nNecesito 20 focos para una bodega en Lampa'))
      .toEqual([{ name: 'Lampa', billing: false }]);
  });

  it('el giro de la empresa no corta el bloque', () => {
    expect(findComunaMentions('Facturación:\nGiro: Instalaciones eléctricas\nComuna: Viña del Mar')).toEqual([{ name: 'Viña del Mar', billing: true }]);
  });

  it('"Dirección:" sola, sin encabezado ni datos de empresa, sigue sin ser factura', () => {
    expect(findComunaMentions('Dirección: Prueba 123\nComuna: Viña del Mar')).toEqual([{ name: 'Viña del Mar', billing: false }]);
  });

  // Revisión adversaria: el bloque seguía en etiquetas del lugar sin las palabras de BLOCK_END_RE.
  it.each([
    'Dirección de la bodega: Otra 456',
    'Destino: Otra 456',
    'Lugar de trabajo: Otra 456',
    'Dónde se instalan: Otra 456',
    'Se instalan en: Otra 456',
    'Bodega:\nDirección: Otra 456',
    '*Bodega*:\nDirección: Otra 456',
    // Una línea en blanco y un segundo "Comuna:" (o "Dirección:") abren otra sección.
    '',
    'Dirección: Otra 456',
  ])('una etiqueta del lugar o repetida corta el bloque: %j', (middle) => {
    const text = 'Necesito 20 focos LED luz cálida para una bodega.\nFacturación:\nDirección: Prueba 123\nComuna: Viña del Mar\n' + middle + '\nComuna: Lampa';
    expect(findComunaMentions(text)).toEqual([{ name: 'Viña del Mar', billing: true }, { name: 'Lampa', billing: false }]);
  });

  it('los datos de la factura que nombran un lugar, o una línea en blanco sola, no cortan el bloque', () => {
    expect(findComunaMentions('Facturación:\nDirección: Prueba 123\nOficina: 501\nComuna: Viña del Mar')).toEqual([{ name: 'Viña del Mar', billing: true }]);
    expect(findComunaMentions('Facturación:\n\nRUT: 11.111.111-1\n\nComuna: Viña del Mar')).toEqual([{ name: 'Viña del Mar', billing: true }]);
  });
});

describe('razón social en minúsculas (H7 de la ronda 2 de Codex)', () => {
  it.each([
    'Somos iluminación de los andes spa',
    'somos iluminacion de los andes ltda',
    'trabajo en constructora de los andes limitada',
    'represento a servicios de lampa eirl',
    'soy de la empresa comercial de colina s.a.',
  ])('"%s" no da la comuna de su nombre', (text) => {
    expect(findComunas(text)).toEqual([]);
    expect(findComunas(text, { answering: true })).toEqual([]);
  });

  it('un spa como lugar de instalación sigue dando la comuna', () => {
    expect(findComunas('Necesito focos para un spa en Pucón')).toEqual(['Pucón']);
    expect(findComunas('Somos una empresa y necesitamos focos para un spa en Pucón')).toEqual(['Pucón']);
  });

  it('la obra después de la razón social en minúsculas cuenta', () => {
    expect(findComunas('Somos iluminación de los andes spa y necesitamos focos para una bodega en Lampa')).toEqual(['Lampa']);
  });

  // Revisión adversaria: otras formas de presentar la empresa.
  it.each([
    'Les escribo de iluminacion de los andes spa',
    'Empresa: iluminacion de los andes spa',
    'Mi empresa: iluminacion de los andes spa',
    'Ana Prueba, iluminacion de los andes spa',
    'Ana Prueba\niluminacion de los andes spa',
    'Cotización a nombre de iluminacion de los andes spa',
    'Pertenezco a iluminacion de los andes spa',
  ])('"%s" no da Los Andes', (text) => {
    expect(findComunas(text)).toEqual([]);
    expect(findComunas(text, { answering: true })).toEqual([]);
  });

  it('al inicio de la cláusula, un spa de una sola palabra o con artículo sigue siendo un lugar', () => {
    expect(findComunas('Hotel spa en Pucón, necesito 20 focos')).toEqual(['Pucón']);
    expect(findComunas('Necesito focos. El spa del hotel queda en Pucón')).toEqual(['Pucón']);
  });
});

describe('"Soy de Maipú" como respuesta a la pregunta por la comuna (H8 de la ronda 2 de Codex)', () => {
  it.each(['Soy de Maipú. La obra es en Lampa.', 'Desde Maipú. La obra es en Lampa.', 'Soy de Maipú, la casa queda en Lampa'])(
    '"%s": Maipú es de dónde es la persona y Lampa la obra',
    (text) => {
      expect(findComunaMentions(text, { answering: true })).toEqual([{ name: 'Maipú', billing: false, origin: true }, { name: 'Lampa', billing: false }]);
    },
  );

  it('sin la obra en el mensaje, la respuesta sigue siendo la comuna', () => {
    expect(findComunaMentions('Soy de Maipú', { answering: true })).toEqual([{ name: 'Maipú', billing: false }]);
    expect(findComunaMentions('Desde Maipú, Región Metropolitana', { answering: true })).toEqual([{ name: 'Maipú', billing: false }]);
  });
});

describe('obra, empresa y factura (R8 de la ronda 3 de Codex)', () => {
  // Solo las etiquetas y el texto suelto cortan el bloque de la factura: el valor de un dato no.
  it.each([
    'Facturación:\nGiro: Despacho de encomiendas\nDirección: Prueba 123\nComuna: Viña del Mar',
    'Facturación:\nObservaciones: requiere factura electrónica\nDirección: Prueba 123\nComuna: Viña del Mar',
    'Facturación:\nGiro: Comercio.\nComuna: Viña del Mar',
  ])('el valor de un dato no corta el bloque, con y sin la pregunta abierta: %j', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Viña del Mar', billing: true }]);
    expect(findComunaMentions(text, { answering: true })).toEqual([{ name: 'Viña del Mar', billing: true }]);
  });

  it.each([
    // Lo que sigue al fin de la oración dentro del valor ya es texto suelto.
    'Facturación:\nGiro: Comercio. Necesito 20 paneles\nComuna: Lampa',
    // Una etiqueta del despacho o de la obra sigue cortando el bloque.
    'Facturación:\nGiro: Comercio\nDespacho:\nComuna: Lampa',
    'Facturación:\nGiro: Comercio\nNecesito lo siguiente: 20 paneles\nComuna: Lampa',
  ])('el texto suelto o una etiqueta de la obra siguen cortándolo: %j', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Lampa', billing: false }]);
  });

  it('la empresa del cliente cuenta como de dónde es; la obra gana', () => {
    expect(findComunaMentions('Nuestra empresa está en Colina. La obra está en Lampa.'))
      .toEqual([{ name: 'Colina', billing: false, origin: true }, { name: 'Lampa', billing: false }]);
    expect(findComunaMentions('La empresa queda en Colina')).toEqual([{ name: 'Colina', billing: false, origin: true }]);
    expect(findComunaMentions('Les cuento que mi empresa se encuentra en Colina')).toEqual([{ name: 'Colina', billing: false, origin: true }]);
  });

  it.each([
    'La bodega de la empresa está en Lampa',
    'Necesito focos para una empresa en Lampa',
  ])('un lugar de la empresa, o una empresa sin el verbo, sigue siendo el lugar: "%s"', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Lampa', billing: false }]);
  });

  it.each([
    'La obra se encuentra en Colina con retiro en su local.',
    'La bodega se ubica en Colina',
    'La obra estará en Colina',
  ])('"%s" presenta la obra', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Colina', billing: false }]);
  });

  it('un bloque de factura con valores largos en 100.000 letras, en menos de 1 s', () => {
    const unit = 'Facturación:\nGiro: Despacho de encomiendas y requiere factura electrónica\nComuna: Lampa\n';
    const text = unit.repeat(Math.ceil(100_000 / unit.length));
    const t0 = performance.now();
    findComunas(text, { answering: true });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('revisión adversaria de R8 (ronda 3): una línea, viñetas, obra explícita y corrección', () => {
  // El encabezado y el pedido en una sola línea, tras una coma: el pedido en primera persona corta el bloque.
  it.each([
    'Facturación: Prueba SpA, necesito 20 paneles LED luz fría para Lampa',
    'Datos de facturación: Prueba SpA, RUT 11.111.111-1, necesito 20 paneles para Lampa',
    'Casa matriz: Providencia, necesito los focos para Lampa',
    'Facturación: Prueba SpA, ahora necesito los paneles para Lampa',
    'Facturación:\nGiro: Comercio, necesito 20 paneles\nComuna: Lampa',
  ])('el pedido dentro del valor corta el bloque: %j', (text) => {
    expect(findComunaMentions(text).filter((m) => !m.billing)).toEqual([{ name: 'Lampa', billing: false }]);
  });

  it('"necesito factura" dentro del valor no corta el bloque (es el documento)', () => {
    expect(findComunaMentions('Facturación:\nObservaciones: necesito factura electrónica\nComuna: Viña del Mar'))
      .toEqual([{ name: 'Viña del Mar', billing: true }]);
  });

  // Viñetas, números y emojis de lista de WhatsApp, y el guion en vez de los dos puntos.
  it.each([
    'Facturación:\n- Giro: Despacho de encomiendas\n- Dirección: Prueba 123\n- Comuna: Viña del Mar',
    'Facturación:\n• Giro: Despacho de encomiendas\n• Dirección: Prueba 123\n• Comuna: Viña del Mar',
    'Facturación:\n1. Giro: Despacho de encomiendas\n2. Dirección: Prueba 123\n3. Comuna: Viña del Mar',
    'Facturación:\n1) Giro: Despacho de encomiendas\n2) Comuna: Viña del Mar',
    'Facturación:\n-Giro: Despacho de encomiendas\n-Comuna: Viña del Mar',
    'Facturación:\n> Giro: Despacho de encomiendas\n> Comuna: Viña del Mar',
    'Facturación:\n📌 Giro: Despacho de encomiendas\n📌 Comuna: Viña del Mar',
    'Facturación:\nGiro - Despacho de encomiendas\nComuna: Viña del Mar',
    'Facturación:\n- Observaciones: requiere factura electrónica\n- Comuna: Viña del Mar',
    'Factura a nombre de:\nGiro: Despacho de encomiendas\nComuna: Viña del Mar',
  ])('la lista de la factura sigue en el bloque: %j', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Viña del Mar', billing: true }]);
  });

  it.each([
    // Con viñeta, una etiqueta de pedido o una repetida siguen cortando el bloque.
    'Facturación:\n- Necesito: 20 paneles\n- Comuna: Lampa',
    'Facturación:\n- Comuna: Viña del Mar\n- Comuna: Lampa',
  ])('con viñetas, el pedido o la etiqueta repetida cortan el bloque: %j', (text) => {
    expect(findComunaMentions(text).filter((m) => !m.billing)).toEqual([{ name: 'Lampa', billing: false }]);
  });

  // Una comuna con solo un "en" antes cuenta como de dónde es la persona si el mensaje trae la obra explícita.
  it.each([
    'Somos una empresa ubicada en Colina. La obra está en Lampa.',
    'Estamos ubicados en Colina. La obra está en Lampa.',
    'Estamos en Colina. La obra está en Lampa.',
    'Nuestra constructora está en Colina. La obra está en Lampa.',
    'Trabajamos en Colina. La obra está en Lampa.',
  ])('la obra explícita gana a la mención débil: %j', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Colina', billing: false, origin: true }, { name: 'Lampa', billing: false }]);
  });

  it('sin la obra explícita, la mención débil sigue siendo el lugar', () => {
    expect(findComunaMentions('Estamos en Colina')).toEqual([{ name: 'Colina', billing: false }]);
  });

  it.each([
    'Necesito focos para una bodega en Lampa y otra en Colina',
    'La obra es en Lampa y en Colina',
  ])('la comuna unida a la de la obra con "y otra en" o "y en" sigue siendo la obra: %j', (text) => {
    expect(findComunaMentions(text)).toEqual([{ name: 'Lampa', billing: false }, { name: 'Colina', billing: false }]);
  });

  it('"Perdón, la empresa está en Colina" es una corrección: cuenta como lugar', () => {
    expect(findComunaMentions('Perdón, la empresa está en Colina')).toEqual([{ name: 'Colina', billing: false }]);
    expect(findComunaMentions('Nuestra empresa está en Colina')).toEqual([{ name: 'Colina', billing: false, origin: true }]);
  });

  it.each([
    'Facturación:\n' + '-'.repeat(50_000) + '\nComuna: Lampa',
    ('Facturación:\n- Giro: Despacho\n' + '1) Comuna: Lampa\n').repeat(3_000),
    'Estamos en Colina y en Lampa, '.repeat(3_000) + 'la obra está en Maipú',
  ])('viñetas, guiones y menciones coordinadas en textos largos, en menos de 1 s (%#)', (text) => {
    const t0 = performance.now();
    findComunas(text, { answering: true });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('rendimiento', () => {
  it('un texto de 50.000 letras se revisa en menos de 500 ms', () => {
    const text = 'en '.repeat(10000) + 'Lampa '.repeat(2000) + 'Av. '.repeat(2000);
    const t0 = performance.now();
    findComunas(text, { answering: true });
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('un texto largo con nombres de empresa, direcciones y correcciones también', () => {
    const text = ('Corrijo: antes era en Lampa, Dirección: Av. Prueba 123, Constructora Los Andes SpA factura retiro ').repeat(500);
    const t0 = performance.now();
    findComunas(text, { answering: true, company: true });
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('razones sociales en mayúsculas, despachos y calles en minúscula también', () => {
    const text = 'PARA BODEGA EN LAMPA EMPRESA PRUEBA SPA '.repeat(600) + 'despachar 20 focos a Lampa '.repeat(400) + 'en Lampa calle norte 12 '.repeat(400);
    const t0 = performance.now();
    findComunas(text, { answering: true, company: true });
    expect(performance.now() - t0).toBeLessThan(500);
  });

  // Antes cada razón social buscaba comunas hasta el final del texto: 200.000 letras tardaban unos 8 s.
  it.each([
    'Empresa Empresa Empresa SpA ',
    'somos empresa empresa empresa spa ',
    'Facturación:\nDirección: Prueba 123\nComuna: Colina con retiro\n',
    // Revisar el bloque de cada encabezado, y no solo el del último, tardaba más de 1 s.
    'Facturación:\nComuna: Lampa\n',
    'ana prueba, iluminacion de los andes spa, ',
  ])('muchas razones sociales o bloques de factura (%j) en 100.000 letras, en menos de 1 s', (unit) => {
    const text = unit.repeat(Math.ceil(100_000 / unit.length));
    const t0 = performance.now();
    findComunas(text, { answering: true });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
