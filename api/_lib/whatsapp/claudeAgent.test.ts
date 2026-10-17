// api/_lib/whatsapp/claudeAgent.test.ts
// Bot de WhatsApp, PR 1 (B2): cada campo que devuelve Claude se usa solo si es texto (un número
// pasa a texto). Un objeto o una lista quedan vacíos en vez de viajar hasta el flujo y la nota,
// donde tumbaban el webhook o se escribían como "[object Object]". El SDK está simulado (sin red).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => [] as string[]);

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: async () => ({ content: [{ type: 'text', text: queue.shift() ?? '{}' }] }) };
  },
}));

import { askClaude, textField } from './claudeAgent';

beforeEach(() => {
  queue.length = 0;
  vi.stubEnv('ANTHROPIC_API_KEY', 'clave-ficticia-solo-pruebas');
});

describe('textField', () => {
  it('deja el texto (sin espacios a los lados) y pasa un número a texto', () => {
    expect(textField('  focos LED ')).toBe('focos LED');
    expect(textField(20)).toBe('20');
  });

  it('un objeto, una lista, un booleano, null o un texto vacío quedan vacíos', () => {
    for (const value of [{ tipo: 'bodega' }, ['a@example.com', 'b@example.com'], [20, 10], true, null, undefined, '', '   ', Number.NaN]) {
      expect(textField(value)).toBeUndefined();
    }
  });
});

describe('askClaude con salidas de otra forma', () => {
  async function parse(raw: Record<string, unknown>) {
    queue.push(JSON.stringify({ wantsHuman: false, qualifiesForDeal: false, ...raw }));
    return (await askClaude([], 'Hola, necesito iluminar una bodega', 'Perfil Prueba')).parsed;
  }

  it('proyecto como objeto → vacío', async () => {
    expect((await parse({ proyecto_o_uso: { tipo: 'bodega', superficie_m2: 300 } })).proyecto_o_uso).toBeUndefined();
  });

  it('correo como lista → vacío (el flujo lo saca del mensaje del cliente)', async () => {
    expect((await parse({ correo: ['compras.prueba@example.com', 'pedro.prueba@example.com'] })).correo).toBeUndefined();
  });

  it('resumen como objeto → el resumen de respaldo, que es texto', async () => {
    const parsed = await parse({ summary: { resumen: 'Pide paneles', prioridad: 'media' } });
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.summary).toContain('Hola, necesito iluminar una bodega');
  });

  it('cantidad como número → texto; como objeto → vacía', async () => {
    expect((await parse({ cantidad: 20 })).cantidad).toBe('20');
    expect((await parse({ cantidad: { 'paneles 60x60': 20, 'focos de riel': 10 } })).cantidad).toBeUndefined();
  });

  it('los campos de texto siguen llegando igual', async () => {
    const parsed = await parse({ producto: 'paneles LED', correo: 'ana.prueba@example.com', summary: 'Pide paneles LED.' });
    expect(parsed.producto).toBe('paneles LED');
    expect(parsed.correo).toBe('ana.prueba@example.com');
    expect(parsed.summary).toBe('Pide paneles LED.');
  });
});
