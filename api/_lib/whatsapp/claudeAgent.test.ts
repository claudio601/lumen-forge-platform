// api/_lib/whatsapp/claudeAgent.test.ts
// Bot de WhatsApp, PR 1 (B2): cada campo que devuelve Claude se usa solo si es texto (un número
// pasa a texto). Un objeto o una lista quedan vacíos en vez de viajar hasta el flujo y la nota,
// donde tumbaban el webhook o se escribían como "[object Object]". El SDK está simulado (sin red).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => [] as string[]);
const systems = vi.hoisted(() => [] as string[]);

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = {
      create: async (args: { system: string }) => {
        systems.push(args.system);
        return { content: [{ type: 'text', text: queue.shift() ?? '{}' }] };
      },
    };
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

  it('[RESUMEN] PR 3: el resumen no afirma una compra que el cliente no atribuye', async () => {
    expect((await parse({ summary: 'Cliente ya compró. Pregunta por la dirección de retiro.' })).summary).toBe('Pregunta por la dirección de retiro.');
    expect((await parse({ summary: 'Cliente pagó.' })).summary).toBe('Ver la transcripción.');
    expect((await parse({ summary: 'El cliente dice que ya compró.' })).summary).toBe('El cliente dice que ya compró.');
  });

  it('[RESUMEN] ronda 2 (H1): bota las afirmaciones comerciales y conserva la consulta por el historial', async () => {
    const summary = 'Cliente hizo una nueva compra. El pago se acreditó ayer. El cliente pregunta si es cliente frecuente.';
    expect((await parse({ summary })).summary).toBe('El cliente pregunta si es cliente frecuente.');
    expect((await parse({ summary: 'Tenemos 20 focos en bodega. Los focos se entregan mañana.' })).summary).toBe('Ver la transcripción.');
  });

  it('[RESUMEN] ronda 2 (H1): el prompt pide que cada frase diga lo que el cliente pide, pregunta o dice', async () => {
    await parse({ summary: 'El cliente pide paneles.' });
    const system = systems.at(-1) ?? '';
    expect(system).toContain('Cada frase empieza con "El cliente pide", "El cliente pregunta si"');
    expect(system).toContain('"El cliente dice que"');
    expect(system).toContain('Nunca afirmes un hecho ni un estado comercial');
    for (const word of ['acreditacion', 'existencias', 'llegada', 'historial', '"tenemos"', '"su pedido"']) expect(system).toContain(word);
  });

  it('[RESUMEN] ronda 3: el prompt prohíbe rótulos sueltos y lo que pasó antes; el filtro los bota', async () => {
    await parse({ summary: 'El cliente pide paneles.' });
    const system = systems.at(-1) ?? '';
    expect(system).toContain('No escribas rotulos ni frases sueltas ("Pago OK", "Cliente conocido"');
    expect(system).toContain('("ayer", "la vez anterior") salvo con "El cliente dice que"');
    const summary = 'Pago OK. Cliente conocido. El cliente pregunta si hay stock y cuándo llegarían.';
    expect((await parse({ summary })).summary).toBe('El cliente pregunta si hay stock y cuándo llegarían.');
    expect((await parse({ summary: 'El cliente pregunta: ¿despachan a Temuco?' })).summary).toBe('El cliente pregunta: ¿despachan a Temuco?');
  });

  it('[RESUMEN] R7 (Codex, ronda 3): el prompt prohíbe los rodeos; el filtro los bota y conserva los descriptores', async () => {
    await parse({ summary: 'El cliente pide paneles.' });
    const system = systems.at(-1) ?? '';
    expect(system).toContain('Tampoco con rodeos ("se efectuo la adquisicion", "logro comprar"');
    const summary = 'Se efectuó la adquisición de veinte focos. Cliente entrega nombre y correo. '
      + 'El cliente logró adquirir las luminarias. El cliente tiene dudas sobre el pedido mínimo.';
    expect((await parse({ summary })).summary).toBe('Cliente entrega nombre y correo. El cliente tiene dudas sobre el pedido mínimo.');
    expect((await parse({ summary: 'Los focos están a disposición del cliente. Los focos están preparados.' })).summary).toBe('Ver la transcripción.');
  });

  it('[RESUMEN] R7 (verificador): el filtro bota las variantes y conserva lo que no es comercial', async () => {
    const summary = 'La adquisición de veinte focos se efectuó. El cliente logró al fin adquirir las luminarias. '
      + 'La empresa del cliente se encuentra en Maipú. Los focos del cliente quedan a su disposición. '
      + 'El cliente no pudo enviar el formulario de contacto. Se le envió el número de Starken.';
    expect((await parse({ summary })).summary)
      .toBe('La empresa del cliente se encuentra en Maipú. El cliente no pudo enviar el formulario de contacto.');
  });
});
