// fillEmpty (especificación «Recordar mis datos» del 23-10-2026, §1): el prellenado completa
// los campos vacíos, y la región y el tipo de /solicitar-pedido si siguen en su valor inicial;
// nunca pisa lo que la persona escribió. Hoy el prellenado corre antes de que se pueda
// escribir (fieldset deshabilitado o formulario aún oculto), así que esta regla solo la
// prueban estas pruebas.

import { describe, expect, it } from 'vitest';
import { fillEmpty } from './RememberContact';

const EMPTY = { nombre: '', email: '', telefono: '' };

describe('fillEmpty', () => {
  it('completa los campos vacíos y no toca los que tienen valor', () => {
    const values = { ...EMPTY, nombre: 'Lo que escribió la persona' };
    expect(fillEmpty(values, { nombre: 'PRUEBA guardado', email: 'prueba@example.com' })).toEqual({
      nombre: 'Lo que escribió la persona', email: 'prueba@example.com', telefono: '',
    });
    // Tampoco un espacio escrito a propósito
    expect(fillEmpty({ ...EMPTY, telefono: ' ' }, { telefono: '+56 9 0000 0000' }).telefono).toBe(' ');
  });

  it('un valor vacío o undefined de lo guardado no completa nada', () => {
    expect(fillEmpty(EMPTY, { nombre: '', email: undefined })).toBe(EMPTY);
  });

  it('devuelve el mismo objeto si no cambia nada, y uno nuevo (sin tocar el original) si cambia', () => {
    const full = { nombre: 'A', email: 'b@example.com', telefono: 'c' };
    expect(fillEmpty(full, { nombre: 'X', email: 'y@example.com' })).toBe(full);
    const values = { ...EMPTY };
    const next = fillEmpty(values, { nombre: 'X' });
    expect(next).not.toBe(values);
    expect(values.nombre).toBe('');
  });

  describe('con valores iniciales (la región y el tipo de /solicitar-pedido)', () => {
    // Como EMPTY_FORM de /solicitar-pedido
    const INITIAL = { fullName: '', region: 'Región Metropolitana', customerType: 'persona' };
    const SAVED = { fullName: 'PRUEBA guardado', region: 'Valparaiso', customerType: 'empresa' };

    it('completa lo que sigue en su valor inicial', () => {
      expect(fillEmpty(INITIAL, SAVED, INITIAL)).toEqual(SAVED);
    });

    it('no toca la región ni el tipo que la persona ya cambió', () => {
      const prev = { fullName: '', region: 'Biobío', customerType: 'persona' };
      expect(fillEmpty(prev, SAVED, INITIAL)).toEqual({ fullName: 'PRUEBA guardado', region: 'Biobío', customerType: 'empresa' });
      const empresa = { fullName: 'Escrito', region: 'Región Metropolitana', customerType: 'empresa' };
      expect(fillEmpty(empresa, { ...SAVED, customerType: 'persona' }, INITIAL)).toEqual({
        fullName: 'Escrito', region: 'Valparaiso', customerType: 'empresa',
      });
    });

    it('sin valores iniciales, un campo que no está vacío no se toca aunque esté en su valor inicial', () => {
      expect(fillEmpty(INITIAL, SAVED)).toEqual({ ...INITIAL, fullName: 'PRUEBA guardado' });
    });
  });
});
