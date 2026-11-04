import { describe, expect, it } from 'vitest';
import { redact } from './redact.js';

// Valores inventados; los RUT válidos se comprueban también en rut.test.ts.
describe('redact: datos de contacto en texto libre', () => {
  it.each([
    '12.345.678-5', '12345678-5', '123456785', '12.345.6785',
    '12 345 678-5', '12 345 678 5', '12\u00a0345\u00a0678–5',
    '77.431.900-K', '77431900-k', '77431900K',
    'RUT: 123456785', 'rut 77431900k', 'R.U.T. 123456785',
    'RUT de la empresa: 123456785', 'RUT: 123456780',
    '12.345.678-0', // Un DV erróneo no deja de ser un dato personal.
  ])('oculta RUT %s', (rut) => {
    expect(redact('Dato: ' + rut + '; gracias')).toContain('[RUT]');
    expect(redact('Dato: ' + rut + '; gracias')).not.toContain(rut.replace(/^.*?: /, ''));
  });

  it.each(['prueba@ejemplo.cl', 'prueba+ventas@sub.ejemplo.cl', 'PRUEBA_1@EJEMPLO.CL'])('oculta correo %s', (email) => {
    expect(redact(`Escribe a ${email}, gracias`)).toBe('Escribe a [correo], gracias');
  });

  it.each([
    '+56 9 1234 5678', '+56912345678', '56912345678', '9 1234 5678', '912345678',
    '2 2345 6789', '+1 (202) 555-0123', '+44 20 7946 0123', '+34 612 345 678',
    '12025550123', '442079460123', '2025550123', '0044 20 7946 0123', '(202) 555-0123', '202-555-0123', '020 7946 0123', 'phone=2025550123', 'tel: 23456789', 'celular 912345678',
  ])('oculta teléfono %s', (phone) => {
    expect(redact('Contacto: ' + phone + '; gracias')).toContain('[teléfono]');
    expect(redact('Contacto: ' + phone + '; gracias')).not.toContain(phone);
  });

  it('oculta todos los datos y conserva signos al lado de un RUT', () => {
    expect(redact('12.345.678-5,prueba@ejemplo.cl;+56 9 1234 5678')).toBe('[RUT],[correo];[teléfono]');
  });

  it('no mezcla un teléfono con el RUT que viene justo después separado por espacios', () => {
    expect(redact('+56 9 1234 5678 12.345.678-5')).toBe('[teléfono] [RUT]');
    expect(redact('phone=2025550123 12.345.678-5')).toBe('phone=[teléfono] [RUT]');
    expect(redact('tel: 12345678-5')).toBe('tel: [teléfono]');
    expect(redact('+56 90001777-4')).toBe('[teléfono]');
  });

  it('no recorta antes de ocultar: también cubre datos al final de textos largos', () => {
    expect(redact('x'.repeat(5000) + ' 12.345.678-5 prueba@ejemplo.cl')).toBe('x'.repeat(5000) + ' [RUT] [correo]');
  });
});

describe('redact: datos operativos que deben seguir visibles', () => {
  it.each([
    '$12.345.678', '$ 123456785', 'CLP 123456785', '123456785 pesos',
    'presupuesto 1.000.000-2.000.000', 'monto: 912345678', 'total=123456785',
    'APB40-1', 'APB12345678-5', 'SKU: 123456785', '1057501-9-LE24',
    '2026-10-30', '30/10/2026', '30.10.2026', '60x60', '123456785 mm',
    'dealId=123456785 personId: 912345678 pedido 123456785',
    'id=123456785', 'MessageSid=SM12345678901234567890123456789012',
    'RC-abc12345', 'ESTL-123456785', 'JS-123456785',
    'dealId=12025550123', '123456789012 CLP', '$ 12025550123',
  ])('conserva %s', (text) => expect(redact(text)).toBe(text));

  it('no hereda estado entre llamadas', () => {
    for (let i = 0; i < 3; i++) expect(redact('12.345.678-5')).toBe('[RUT]');
  });

  it('prepara referencias WA sin cambiar otras referencias ni ids', () => {
    expect(redact('WA-56912345678')).toBe('WA-…5678');
    expect(redact('RC-abc12345')).toBe('RC-abc12345');
  });
});

describe('redact: campos estructurados y fallos externos', () => {
  it.each(['+56 9 1234 5678', 'whatsapp:+56912345678', '+1 (202) 555-5678'])('deja cuatro dígitos de %s', (phone) => {
    expect(redact(phone, 'phone')).toBe('…5678');
  });
  it.each(['', undefined, null, '1234', '123'])('no revela un teléfono incompleto: %s', (phone) => {
    expect(redact(phone, 'phone')).toBe('[teléfono]');
  });
  it('un objeto que no es Error no se imprime (puede traer un cuerpo completo)', () => {
    expect(redact({ message: 'Persona Ficticia', response: { email: 'prueba@ejemplo.cl' } }, 'error')).toBe('[detalle omitido]');
  });
  it('un error se registra con su tipo y su mensaje enmascarado, en 200 caracteres como máximo', () => {
    expect(redact(new Error('Falla con 12.345.678-5 prueba@ejemplo.cl +56 9 1234 5678'), 'error')).toBe('Error: Falla con [RUT] [correo] [teléfono]');
    expect(redact(new TypeError("Cannot read properties of undefined (reading 'id')"), 'error')).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(redact('Invalid phone: +56 9 1234 5678', 'error')).toBe('Invalid phone: [teléfono]');
    expect(redact('HTTP 400: prueba@ejemplo.cl', 'error')).toBe('HTTP 400: [correo]');
    expect(redact(new Error('x'.repeat(500)), 'error')).toHaveLength(200);
    expect(redact(new DOMException('datos privados', 'AbortError'), 'error')).toBe('TIMEOUT');
  });
});
