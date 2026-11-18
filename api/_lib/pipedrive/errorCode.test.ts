// api/_lib/pipedrive/errorCode.test.ts
// Lo que se registra de un error del cliente de Pipedrive: solo el código, nunca el texto (que puede
// traer un nombre). Ronda 3 de la auditoría de Codex (#196).

import { describe, expect, it } from 'vitest';
import { pipedriveErrorCode } from './errorCode.js';

describe('pipedriveErrorCode', () => {
  it('HTTP NNN, TIMEOUT u otro; nunca el texto', () => {
    expect(pipedriveErrorCode('HTTP 404: Not Found')).toBe('HTTP 404');
    expect(pipedriveErrorCode('HTTP 400: Persona Inventada')).toBe('HTTP 400');
    expect(pipedriveErrorCode('Request timeout')).toBe('TIMEOUT');
    expect(pipedriveErrorCode('Persona Inventada rechazada')).toBe('otro');
    expect(pipedriveErrorCode('HTTP 4000 Persona')).toBe('otro');
    expect(pipedriveErrorCode(undefined)).toBe('otro');
    expect(pipedriveErrorCode({ toString: null })).toBe('otro');
  });
});
