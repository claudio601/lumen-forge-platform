// Reglas de los campos de /cotizacion y /solicitar-pedido (auditoría UX, F-02). El correo se
// revisa en el navegador con la MISMA expresión que el servidor: si alguna cambia, esta
// prueba falla y hay que cambiar las dos.

import { describe, expect, it } from 'vitest';
import { EMAIL_RE, FIELD_MESSAGES, emailMessage, phoneDigitCount, requiredMessage, rutMessage } from './formValidation';

/** Los endpoints que validan el correo de estos formularios (solo se leen, como texto). */
const SERVER = import.meta.glob<string>(['/api/request-orders/create.ts', '/api/_lib/crm/validation.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('correo: la misma regla que el servidor', () => {
  it('api/request-orders/create.ts y api/_lib/crm/validation.ts usan la misma expresión', () => {
    expect(Object.keys(SERVER).sort()).toEqual(['/api/_lib/crm/validation.ts', '/api/request-orders/create.ts']);
    for (const [file, src] of Object.entries(SERVER)) {
      const fn = src.slice(src.indexOf('function isValidEmail'));
      expect(fn, file).toContain(`/${EMAIL_RE.source}/.test(`);
    }
  });

  it.each(['nombre@empresa.cl', 'prueba+1@example.com', ' nombre@empresa.cl '])('válido: "%s"', (email) => {
    expect(emailMessage(email, 'vacío')).toBeNull();
  });

  it.each(['nombre', 'nombre@empresa', 'nombre empresa.cl', '@empresa.cl', 'nombre@.cl x', 'a b@c.cl'])('inválido: "%s"', (email) => {
    expect(emailMessage(email, 'vacío')).toBe(FIELD_MESSAGES.emailInvalid);
  });

  it('vacío: el mensaje del campo', () => {
    expect(emailMessage('  ', 'Escribe tu correo electrónico.')).toBe('Escribe tu correo electrónico.');
  });
});

describe('otros campos', () => {
  it('obligatorio: solo espacios cuenta como vacío', () => {
    expect(requiredMessage('  ', 'Escribe tu comuna.')).toBe('Escribe tu comuna.');
    expect(requiredMessage('Maipú', 'Escribe tu comuna.')).toBeNull();
  });

  it('teléfono: cuenta solo los dígitos', () => {
    expect(phoneDigitCount('+56 9 0000 0910')).toBe(11);
    expect(phoneDigitCount('(2) 212-3456')).toBe(8);
  });

  it('RUT obligatorio u opcional, con su dígito verificador (RUT inventados)', () => {
    const required = { required: true, emptyMessage: 'Escribe el RUT de la empresa.' };
    const optional = { required: false, emptyMessage: '' };
    expect(rutMessage('', required)).toBe('Escribe el RUT de la empresa.');
    expect(rutMessage('', optional)).toBeNull();
    expect(rutMessage('44.444.444-4', required)).toBeNull();
    expect(rutMessage('44.444.407-k', optional)).toBeNull();
    expect(rutMessage('44.444.444-5', optional)).toBe('Revisa el RUT: el dígito verificador no corresponde.');
    expect(rutMessage('RUT-PRUEBA', required)).toBe(FIELD_MESSAGES.rutFormat);
  });
});
