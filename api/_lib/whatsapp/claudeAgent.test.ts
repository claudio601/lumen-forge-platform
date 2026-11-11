// api/_lib/whatsapp/claudeAgent.test.ts
// Bot de WhatsApp, PR 1 (B2): cada campo que devuelve Claude se usa solo si es texto (un número
// pasa a texto). Un objeto o una lista quedan vacíos en vez de viajar hasta el flujo y la nota,
// donde tumbaban el webhook o se escribían como "[object Object]". El SDK está simulado (sin red).

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cada salida: un texto (un bloque, stop_reason end_turn) o varios bloques con su stop_reason.
const queue = vi.hoisted(() => [] as Array<string | { blocks: string[]; stop_reason?: string }>);
const systems = vi.hoisted(() => [] as string[]);

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = {
      create: async (args: { system: string }) => {
        systems.push(args.system);
        const next = queue.shift() ?? '{}';
        if (typeof next === 'string') return { content: [{ type: 'text', text: next }], stop_reason: 'end_turn' };
        return { content: next.blocks.map((text) => ({ type: 'text', text })), stop_reason: next.stop_reason ?? 'end_turn' };
      },
    };
  },
}));

import { askClaude, extractJsonObject, textField } from './claudeAgent';

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

// [RESPUESTA] Informe de Codex del 10-11 (punto 3): el 09-11 hubo 6 «Response not valid JSON — usando defaults» y el
// webhook registraba «Claude ok» igual. Ahora: el objeto se extrae aunque venga con texto alrededor, una respuesta
// cortada por max_tokens no se usa, cada campo se valida por separado y el resultado dice qué quedó por defecto.
describe('[RESPUESTA] respuesta de Claude que no es solo el JSON', () => {
  const MESSAGE = 'Necesito 12 focos LED para una bodega, mi correo es rosa.prueba@example.com';
  const COMPLETE = { producto: 'focos LED', cantidad: '12', correo: 'rosa.prueba@example.com', wantsHuman: false, qualifiesForDeal: true, summary: 'El cliente pide focos LED.' };
  const JSON_TEXT = JSON.stringify(COMPLETE);
  async function ask(output: string | { blocks: string[]; stop_reason?: string }) {
    queue.push(output);
    return askClaude([], MESSAGE, 'Perfil Prueba');
  }

  it('JSON directo: se usa entero y no quedan valores por defecto', async () => {
    const result = await ask(JSON_TEXT);
    expect(result.parsed).toMatchObject({ producto: 'focos LED', cantidad: '12', qualifiesForDeal: true, summary: 'El cliente pide focos LED.' });
    expect(result.diagnostics).toEqual({ usedDefaults: false, fields: {}, stopReason: 'end_turn', length: JSON_TEXT.length });
  });

  it('bloque ```json o ``` sin etiqueta, con texto alrededor: se usa', async () => {
    for (const output of ['Aquí va:\n```json\n' + JSON_TEXT + '\n```\nSaludos.', '```\n' + JSON_TEXT + '\n```']) {
      const result = await ask(output);
      expect(result.parsed.producto).toBe('focos LED');
      expect(result.diagnostics?.usedDefaults).toBe(false);
    }
  });

  it('texto antes y después del JSON, sin bloque: se usa (antes: valores por defecto)', async () => {
    const result = await ask('Claro, este es el resultado: ' + JSON_TEXT + ' Quedo atento.');
    expect(result.parsed).toMatchObject({ producto: 'focos LED', cantidad: '12', correo: 'rosa.prueba@example.com', qualifiesForDeal: true });
    expect(result.diagnostics?.usedDefaults).toBe(false);
  });

  it('llaves y comillas escapadas dentro de un texto no cortan el objeto; las llaves de la prosa se saltan', async () => {
    const inner = JSON.stringify({ ...COMPLETE, producto: 'panel "60x60" {embutido}' });
    const result = await ask('Resultado {sin formato}: ' + inner + ' fin');
    expect(result.parsed.producto).toBe('panel "60x60" {embutido}');
    expect(result.diagnostics?.reason).toBeUndefined();
  });

  it('varios bloques de texto: se leen todos (antes, solo el primero)', async () => {
    const result = await ask({ blocks: ['Este es el resultado:', JSON_TEXT] });
    expect(result.parsed.producto).toBe('focos LED');
    expect(result.diagnostics?.usedDefaults).toBe(false);
  });

  it('stop_reason max_tokens: respuesta incompleta, no se usa nada aunque el JSON se lea', async () => {
    const result = await ask({ blocks: [JSON_TEXT], stop_reason: 'max_tokens' });
    expect(result.parsed).toEqual({ wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + MESSAGE + '"' });
    expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason: 'respuesta_incompleta', stopReason: 'max_tokens' });
  });

  it('JSON cortado sin max_tokens: json_incompleto y valores por defecto', async () => {
    const result = await ask(JSON_TEXT.slice(0, 40));
    expect(result.parsed.producto).toBeUndefined();
    expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason: 'json_incompleto', stopReason: 'end_turn' });
  });

  it('null, una lista, un texto o un número: no_es_objeto (antes, [] pasaba sin aviso)', async () => {
    for (const output of ['null', '[]', '[' + JSON_TEXT + ']', '"focos"', '5', '```json\nnull\n```']) {
      const result = await ask(output);
      expect(result.diagnostics?.reason).toBe('no_es_objeto');
      expect(result.parsed.qualifiesForDeal).toBe(false);
    }
  });

  it('sin JSON, con llaves que no son JSON o con dos objetos distintos: no se elige nada', async () => {
    expect((await ask('Lo siento, no puedo ayudar con eso.')).diagnostics?.reason).toBe('sin_json');
    expect((await ask('{producto: focos, cantidad: 12}')).diagnostics?.reason).toBe('json_invalido');
    const two = await ask(JSON_TEXT + ' o bien ' + JSON.stringify({ ...COMPLETE, cantidad: '24' }));
    expect(two.diagnostics?.reason).toBe('varios_json');
    expect(two.parsed.cantidad).toBeUndefined();
  });

  it('campo por campo: uno inválido queda por defecto y los demás se usan; "false" (texto) ya no es true', async () => {
    const result = await ask(JSON.stringify({ ...COMPLETE, wantsHuman: 'false', qualifiesForDeal: null, correo: false, empresa: { nombre: 'Comercial Prueba' } }));
    expect(result.parsed).toMatchObject({ producto: 'focos LED', cantidad: '12', wantsHuman: false, qualifiesForDeal: false, summary: 'El cliente pide focos LED.' });
    expect(result.parsed.correo).toBeUndefined();
    expect(result.parsed.empresa).toBeUndefined();
    expect(result.diagnostics).toMatchObject({ usedDefaults: true, fields: { wantsHuman: 'tipo', qualifiesForDeal: 'falta', correo: 'tipo', empresa: 'tipo' } });
    expect(result.diagnostics?.reason).toBeUndefined();
    expect((await ask(JSON.stringify({ ...COMPLETE, wantsHuman: 'true' }))).parsed.wantsHuman).toBe(false);
  });

  it('texto null o vacío es "no aplica" (no cuenta como valor por defecto); sin resumen, el de respaldo', async () => {
    const result = await ask(JSON.stringify({ ...COMPLETE, empresa: null, nombre: '', summary: undefined }));
    expect(result.parsed.summary).toBe('Consulta de Perfil Prueba: "' + MESSAGE.substring(0, 80) + '"');
    expect(result.diagnostics?.fields).toEqual({ summary: 'falta' });
    expect((await ask(JSON.stringify({ ...COMPLETE, summary: 7 }))).diagnostics?.fields).toEqual({ summary: 'tipo' });
  });

  it('el diagnóstico no trae texto del cliente ni de la respuesta', async () => {
    for (const output of [JSON_TEXT, 'Sin JSON: ' + MESSAGE, JSON.stringify({ ...COMPLETE, wantsHuman: 'rosa.prueba@example.com' })]) {
      const text = JSON.stringify((await ask(output)).diagnostics);
      for (const piece of ['rosa.prueba', 'focos', 'bodega', 'Perfil Prueba']) expect(text).not.toContain(piece);
    }
  });

  it('extractJsonObject: un trozo entre llaves que no es JSON se salta entero (no se toma un objeto de adentro); un escape no cierra el texto', () => {
    expect(extractJsonObject('{"a": {"b": 1}, "c": 2,}')).toEqual({ ok: false, reason: 'json_invalido' });
    expect(extractJsonObject('texto {"a": 1} y { sin cerrar')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJsonObject('texto {"a": "\\"}"} fin')).toEqual({ ok: true, value: { a: '"}' } });
  });
});
