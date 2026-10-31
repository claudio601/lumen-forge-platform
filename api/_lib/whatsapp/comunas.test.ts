// api/_lib/whatsapp/comunas.test.ts
// Bot de WhatsApp, PR 3 del plan (B4): la comuna sale de la lista oficial y solo cuando el texto la
// presenta como lugar o contesta la pregunta por la comuna. Solo mensajes, correos y direcciones inventados.

import { describe, expect, it } from 'vitest';
import { COMUNAS } from './comunas.generated';
import { findComunas, officialComuna } from './comunas';
import { FIXES } from '../../../scripts/whatsapp/comunas';

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

  it('los nombres corregidos de la fuente quedan con su nombre oficial', () => {
    const byCode = new Map(COMUNAS);
    for (const [code, name] of Object.entries(FIXES)) expect(byCode.get(code)).toBe(name);
    expect(byCode.get('13101')).toBe('Santiago');
    expect(byCode.get('13120')).toBe('Ñuñoa');
    expect(byCode.get('13106')).toBe('Estación Central');
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

describe('rendimiento', () => {
  it('un texto de 50.000 letras se revisa en menos de 500 ms', () => {
    const text = 'en '.repeat(10000) + 'Lampa '.repeat(2000) + 'Av. '.repeat(2000);
    const t0 = performance.now();
    findComunas(text, { answering: true });
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
