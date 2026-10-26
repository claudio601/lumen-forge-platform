// api/_lib/whatsapp/rutCapture.test.ts
// Bot de WhatsApp, PR 6 del plan (B12): cuándo un texto trae un RUT, si calza y de qué tipo es.
// Solo RUT inventados con dígito verificador válido (módulo 11) y su versión con el dígito
// cambiado; ninguno es de un cliente. Celulares +569000…, correos @example.com.

import { describe, expect, it } from 'vitest';
import { findRut, isBusinessRut, rutTipo } from './rutCapture';

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
