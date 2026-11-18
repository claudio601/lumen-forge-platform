// api/_lib/whatsapp/claudeAgent.test.ts
// Bot de WhatsApp, PR 1 (B2): cada campo que devuelve Claude se usa solo si es texto (un número
// pasa a texto). Un objeto o una lista quedan vacíos en vez de viajar hasta el flujo y la nota,
// donde tumbaban el webhook o se escribían como "[object Object]". El SDK está simulado (sin red).

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cada salida: un texto (un bloque, stop_reason end_turn) o varios bloques con su stop_reason.
// [MODELO] thinking: antepone un bloque thinking vacío, como Haiku 5.5 con pensamiento.
const queue = vi.hoisted(() => [] as Array<string | { blocks: string[]; stop_reason?: string; thinking?: boolean }>);
const systems = vi.hoisted(() => [] as string[]);
const sent = vi.hoisted(() => [] as Array<Array<{ role: string; content: unknown }>>);
const requests = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = {
      create: async (args: { system: string; messages: Array<{ role: string; content: unknown }> }) => {
        systems.push(args.system);
        sent.push(args.messages);
        requests.push(args as unknown as Record<string, unknown>);
        const next = queue.shift() ?? '{}';
        if (typeof next === 'string') return { content: [{ type: 'text', text: next }], stop_reason: 'end_turn' };
        const thinking = next.thinking ? [{ type: 'thinking', thinking: '', signature: 'firma-ficticia' }] : [];
        return { content: [...thinking, ...next.blocks.map((text) => ({ type: 'text', text }))], stop_reason: next.stop_reason ?? 'end_turn' };
      },
    };
  },
}));

import { askClaude, EXTRACTION_SCHEMA, extractJsonObject, readClaudeFields, requestParams, textField } from './claudeAgent';

beforeEach(() => {
  queue.length = 0;
  requests.length = 0;
  vi.stubEnv('ANTHROPIC_API_KEY', 'clave-ficticia-solo-pruebas');
  vi.stubEnv('ANTHROPIC_MODEL', undefined);
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

  it('texto antes y después del JSON, sin bloque: no se usa (igual que main: la prosa puede invalidarlo)', async () => {
    const result = await ask('Claro, este es el resultado: ' + JSON_TEXT + ' Quedo atento.');
    expect(result.parsed.producto).toBeUndefined();
    expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason: 'json_invalido' });
  });

  it('llaves y comillas escapadas dentro de un texto del JSON no lo cortan', async () => {
    const inner = JSON.stringify({ ...COMPLETE, producto: 'panel "60x60" {embutido}' });
    const result = await ask('Resultado:\n```json\n' + inner + '\n```\nfin');
    expect(result.parsed.producto).toBe('panel "60x60" {embutido}');
    expect(result.diagnostics?.reason).toBeUndefined();
  });

  it('varios bloques de texto: se leen todos (antes, solo el primero)', async () => {
    const result = await ask({ blocks: ['Este es el resultado:\n```json', JSON_TEXT, '```'] });
    expect(result.parsed.producto).toBe('focos LED');
    expect(result.diagnostics?.usedDefaults).toBe(false);
  });

  it('stop_reason max_tokens: respuesta incompleta, no se usa nada aunque el JSON se lea', async () => {
    const result = await ask({ blocks: [JSON_TEXT], stop_reason: 'max_tokens' });
    expect(result.parsed).toEqual({ wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + MESSAGE + '"' });
    expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason: 'respuesta_incompleta', stopReason: 'max_tokens' });
  });

  it('JSON cortado sin max_tokens: json_invalido y valores por defecto', async () => {
    const result = await ask(JSON_TEXT.slice(0, 40));
    expect(result.parsed.producto).toBeUndefined();
    expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason: 'json_invalido', stopReason: 'end_turn' });
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
    expect(two.diagnostics?.reason).toBe('json_invalido');
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

  // [RESPUESTA] Revisión de Codex de la PR 168 (informes 01 a 03 del 11-11): la regla estricta de main (el texto entero
  // o un solo bloque), sin rescatar objetos del texto que los rodea. Cada caso con su resultado; ante la duda, nada.
  const B = JSON.stringify({ ...COMPLETE, cantidad: '24' });
  const CASES: Array<[string, string, 'usa' | 'json_incompleto' | 'no_es_objeto' | 'json_invalido' | 'varios_json']> = [
    ['lista en bloque', '```json\n[' + JSON_TEXT + ']\n```', 'no_es_objeto'],
    ['comilla con llave en la prosa y bloque válido', 'El cliente escribió "{".\n```json\n' + JSON_TEXT + '\n```', 'usa'],
    ['objeto y una corrección sin cerrar', JSON_TEXT + ' Corrección: {"nombre":"Rosa Prueba"', 'json_invalido'],
    ['objeto, comilla de pulgadas y una corrección completa', JSON_TEXT + ' Panel 24" Corrección: {"nombre":"Rosa Prueba"}', 'json_invalido'],
    ['lista que empieza con null en la prosa', 'Resultado: [null, ' + JSON_TEXT + ']', 'json_invalido'],
    ['objeto y una lista sin cerrar', JSON_TEXT + ' Corrección: [1,', 'json_invalido'],
    ['lista inválida en bloque', '```json\n[1, ' + JSON_TEXT + ',]\n```', 'json_invalido'],
    ['comilla de pulgadas antes del objeto', 'Panel 24" ' + JSON_TEXT, 'json_invalido'],
    ['dos objetos sin bloque', JSON_TEXT + ' ' + B, 'json_invalido'],
    ['texto, objeto y texto sin llaves', 'Este es el resultado: ' + JSON_TEXT + ' Quedo atento.', 'json_invalido'],
    ['dos bloques', '```json\n' + JSON_TEXT + '\n```\nO bien:\n```json\n' + B + '\n```', 'varios_json'],
    ['un bloque y otro sin cerrar', '```json\n' + JSON_TEXT + '\n```\nCorrección:\n```json\n{"cantidad": "24"', 'json_incompleto'],
    // Informe 03: la prosa sin llaves alrededor del objeto puede invalidarlo; una marca ``` sin pareja.
    ['objeto y una corrección en prosa', JSON_TEXT + ' Corrección: nombre y correo anteriores no corresponden al cliente; dejarlos en null y preguntar de nuevo.', 'json_invalido'],
    ['ejemplo de formato, no son datos del cliente', 'Ejemplo de formato, no son datos del cliente: ' + JSON_TEXT + '. No usar esos datos.', 'json_invalido'],
    ['una sola marca ``` sin cerrar', '```json\n' + JSON_TEXT, 'json_incompleto'],
    ['objeto y una corrección en un bloque sin cerrar', JSON_TEXT + '\nCorrección:\n```json\nnull', 'json_incompleto'],
  ];

  for (const [label, output, expected] of CASES) {
    it('Codex PR 168, regla estricta: ' + label + ' → ' + (expected === 'usa' ? 'se usa' : 'no se usa (' + expected + ')'), async () => {
      const result = await ask(output);
      if (expected === 'usa') {
        expect(result.diagnostics?.reason).toBeUndefined();
        expect(result.parsed).toMatchObject({ producto: 'focos LED', cantidad: '12', qualifiesForDeal: true });
      } else {
        expect(extractJsonObject(output)).toEqual({ ok: false, reason: expected });
        expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason: expected });
        expect(result.parsed).toEqual({ wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + MESSAGE + '"' });
      }
    });
  }

  it('Codex PR 168 (control): una llave o un corchete suelto en la prosa, fuera del objeto: no se usa (igual que main)', async () => {
    for (const tail of [' Escríbeme si falta algo {', ' usa llaves { así } en el texto', ' [nota] fin']) {
      const result = await ask(JSON_TEXT + tail);
      expect(result.diagnostics?.usedDefaults).toBe(true);
      expect(result.diagnostics?.reason).toBe('json_invalido');
      expect(result.parsed.producto).toBeUndefined();
    }
  });
});

// [RESPALDO] [LUZ] Fase 1 del bot (12-11-2026): el nombre del perfil va aparte del mensaje y el prompt pide el
// producto específico, el uso y el producto del último mensaje y un color de luz que sea un color.
describe('fase 1: el mensaje y el prompt', () => {
  it('el último bloque enviado es exactamente el mensaje del cliente, sin "[Cliente:"', async () => {
    queue.push('{}');
    await askClaude([], 'necesito 6 unidades', 'Sistemas de seguridad');
    const last = sent.at(-1)!.at(-1)!;
    expect(last.role).toBe('user');
    const blocks = last.content as Array<{ type: string; text: string }>;
    expect(blocks.at(-1)).toEqual({ type: 'text', text: 'necesito 6 unidades' });
    expect(JSON.stringify(last.content)).not.toContain('[Cliente:');
    expect(blocks[0].text).toContain('Nombre del perfil de WhatsApp');
    expect(blocks[0].text).toContain('"Sistemas de seguridad"');
    expect(systems.at(-1)).not.toContain('Sistemas de seguridad');
  });

  it('sin nombre de perfil, el mensaje va solo', async () => {
    queue.push('{}');
    await askClaude([], 'necesito 6 unidades', '');
    expect(sent.at(-1)!.at(-1)).toEqual({ role: 'user', content: 'necesito 6 unidades' });
  });

  it('el prompt trae las reglas de producto, uso y color de luz', async () => {
    queue.push('{}');
    await askClaude([], 'Hola', 'Perfil Prueba');
    const system = systems.at(-1) ?? '';
    expect(system).toContain('producto: el nombre mas especifico que dio el cliente');
    expect(system).toContain('nunca los deduzcas del nombre del producto ni del nombre del perfil');
    expect(system).toContain('tipo_de_luz: solo el color de luz que el cliente nombra');
    expect(system).toContain('nunca LED, interior, exterior ni el uso');
  });
});

// [MODELO] Claude Haiku 5.5 (17-11-2026): modelo por defecto, sin pensamiento y con esfuerzo bajo; sin parámetros
// de muestreo ni prellenado (Haiku 5.5 responde 400); un bloque thinking se salta y un rechazo no tumba el webhook.
describe('[MODELO] Haiku 5.5', () => {
  const MESSAGE = 'Necesito 12 focos LED para una bodega, mi correo es rosa.prueba@example.com';
  const JSON_TEXT = JSON.stringify({ producto: 'focos LED', cantidad: '12', wantsHuman: false, qualifiesForDeal: true, summary: 'El cliente pide focos LED.' });

  it('por defecto: claude-haiku-5-5, sin pensamiento, esfuerzo bajo y 1024 tokens; sin temperature, top_p, top_k ni prellenado', async () => {
    queue.push(JSON_TEXT);
    await askClaude([{ role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Hola, cuéntanos.' }], MESSAGE, 'Perfil Prueba');
    const req = requests.at(-1)!;
    expect(req).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 1024, thinking: { type: 'disabled' } });
    // [SALIDA] El esfuerzo y el formato del JSON, juntos en output_config.
    expect(req.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } });
    for (const key of ['temperature', 'top_p', 'top_k']) expect(req).not.toHaveProperty(key);
    expect((req.messages as Array<{ role: string }>).at(-1)!.role).toBe('user');
  });

  it('ANTHROPIC_MODEL=claude-haiku-4-5: el pedido de antes (400 tokens, sin thinking ni output_config)', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-haiku-4-5');
    queue.push(JSON_TEXT);
    await askClaude([], MESSAGE, 'Perfil Prueba');
    const req = requests.at(-1)!;
    expect(req).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: 400 });
    expect(req).not.toHaveProperty('thinking');
    expect(req).not.toHaveProperty('output_config');
  });

  it('ANTHROPIC_MODEL con otro modelo actual: ese modelo con el pedido nuevo', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5');
    queue.push(JSON_TEXT);
    await askClaude([], MESSAGE, 'Perfil Prueba');
    expect(requests.at(-1)).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 1024, thinking: { type: 'disabled' } });
  });

  it('un bloque thinking antes del texto se salta: se usa el JSON', async () => {
    queue.push({ blocks: [JSON_TEXT], thinking: true });
    const result = await askClaude([], MESSAGE, 'Perfil Prueba');
    expect(result.parsed).toMatchObject({ producto: 'focos LED', cantidad: '12', qualifiesForDeal: true });
    expect(result.diagnostics?.usedDefaults).toBe(false);
  });

  it('stop_reason refusal sin texto: valores por defecto con motivo rechazo, sin lanzar', async () => {
    queue.push({ blocks: [], stop_reason: 'refusal' });
    const result = await askClaude([], MESSAGE, 'Perfil Prueba');
    expect(result.parsed).toEqual({ wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + MESSAGE + '"' });
    expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason: 'rechazo', stopReason: 'refusal', length: 0 });
  });

  it('stop_reason refusal con algo de texto: tampoco se usa', async () => {
    queue.push({ blocks: [JSON_TEXT], stop_reason: 'refusal' });
    const result = await askClaude([], MESSAGE, 'Perfil Prueba');
    expect(result.parsed.producto).toBeUndefined();
    expect(result.diagnostics?.reason).toBe('rechazo');
  });

  it('sin texto y sin rechazo: lanza como antes (el webhook sigue con las reglas)', async () => {
    queue.push({ blocks: [], thinking: true, stop_reason: 'end_turn' });
    await expect(askClaude([], MESSAGE, 'Perfil Prueba')).rejects.toThrow('No text block');
  });
});

// [SALIDA] Salidas estructuradas (18-11-2026): Haiku 5.5 sin pensamiento y con esfuerzo bajo a veces contestaba con una
// frase para el cliente en vez del JSON (18 turnos «sin_json» en producción, casi todos saludos o mensajes después del
// cierre). Con output_config.format la API obliga a devolver el objeto del esquema; Haiku 4.5 sigue con el pedido de antes.
describe('[SALIDA] salidas estructuradas', () => {
  const MESSAGES = [{ role: 'user' as const, content: 'Hola' }];
  const FIELDS = ['producto', 'tipo_de_luz', 'cantidad', 'proyecto_o_uso', 'comuna_o_ciudad', 'nombre', 'empresa', 'correo', 'wantsHuman', 'qualifiesForDeal', 'summary'];
  const MESSAGE = 'Necesito 20 paneles LED 60x60 para una oficina';

  it('requestParams con Haiku 5.5: formato json_schema junto al esfuerzo, sin pensamiento y 1024 tokens', () => {
    expect(requestParams('claude-haiku-5-5', MESSAGES)).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    });
    // Otro esfuerzo (solo el arnés de comparación lo cambia): el formato sigue.
    expect(requestParams('claude-haiku-5-5', MESSAGES, { effort: 'medium' }).output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } });
  });

  it('requestParams con Haiku 4.5 (con o sin fecha): exactamente el pedido de antes, sin formato', () => {
    for (const model of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001']) {
      const params = requestParams(model, MESSAGES);
      expect(Object.keys(params).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
      expect(params).toMatchObject({ model, max_tokens: 400 });
    }
  });

  it('el esquema: los 11 campos que lee readClaudeFields, todos obligatorios y ningún otro', () => {
    expect(EXTRACTION_SCHEMA.type).toBe('object');
    expect(EXTRACTION_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(EXTRACTION_SCHEMA.properties)).toEqual(FIELDS);
    expect([...EXTRACTION_SCHEMA.required]).toEqual(FIELDS);
    for (const name of ['producto', 'tipo_de_luz', 'proyecto_o_uso', 'comuna_o_ciudad', 'nombre', 'empresa', 'correo'] as const) {
      expect(EXTRACTION_SCHEMA.properties[name]).toEqual({ type: ['string', 'null'] });
    }
    // cantidad: el prompt pide un número entero o null (textField lo pasa a texto).
    expect(EXTRACTION_SCHEMA.properties.cantidad).toEqual({ type: ['integer', 'null'] });
    expect(EXTRACTION_SCHEMA.properties.wantsHuman).toEqual({ type: 'boolean' });
    expect(EXTRACTION_SCHEMA.properties.qualifiesForDeal).toEqual({ type: 'boolean' });
    expect(EXTRACTION_SCHEMA.properties.summary).toEqual({ type: 'string' });
  });

  it('el esquema solo usa palabras clave que la API admite (sin minLength, minimum, pattern ni otras)', () => {
    const keys = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      for (const [key, value] of Object.entries(node)) {
        keys.add(key);
        if (key === 'properties') Object.values(value as object).forEach(walk);
        else walk(value);
      }
    };
    walk(EXTRACTION_SCHEMA);
    expect([...keys].sort()).toEqual(['additionalProperties', 'properties', 'required', 'type']);
  });

  it('el prompt del sistema nombra cada campo del esquema', async () => {
    queue.push('{}');
    await askClaude([], MESSAGE, 'Perfil Prueba');
    for (const name of FIELDS) expect(systems.at(-1)).toContain(name);
  });

  it('una respuesta con la forma del esquema se lee entera: null es «no aplica» y la cantidad entera pasa a texto', () => {
    const raw = { producto: 'paneles LED 60x60', tipo_de_luz: null, cantidad: 20, proyecto_o_uso: 'oficina', comuna_o_ciudad: null, nombre: null, empresa: null, correo: null, wantsHuman: false, qualifiesForDeal: false, summary: 'El cliente pide 20 paneles LED 60x60.' };
    expect(Object.keys(raw)).toEqual(FIELDS);
    const { parsed, fields } = readClaudeFields(raw, 'respaldo');
    expect(fields).toEqual({});
    expect(parsed).toEqual({ producto: 'paneles LED 60x60', cantidad: '20', proyecto_o_uso: 'oficina', wantsHuman: false, qualifiesForDeal: false, summary: 'El cliente pide 20 paneles LED 60x60.' });
  });

  it('askClaude con la respuesta estructurada de un «gracias»: sin valores por defecto ni motivo', async () => {
    const text = JSON.stringify({ producto: null, tipo_de_luz: null, cantidad: null, proyecto_o_uso: null, comuna_o_ciudad: null, nombre: null, empresa: null, correo: null, wantsHuman: false, qualifiesForDeal: false, summary: 'El cliente dice que agradece la atención.' });
    queue.push(text);
    const result = await askClaude([{ role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Tu solicitud quedó registrada.' }], 'gracias', 'Perfil Prueba');
    expect(result.parsed).toEqual({ wantsHuman: false, qualifiesForDeal: false, summary: 'El cliente dice que agradece la atención.' });
    expect(result.diagnostics).toEqual({ usedDefaults: false, fields: {}, stopReason: 'end_turn', length: text.length });
  });

  it('la lectura sigue estricta con el formato: texto suelto, max_tokens y rechazo dan los motivos de siempre', async () => {
    const cases: Array<[string | { blocks: string[]; stop_reason?: string }, string]> = [
      ['¡Gracias a ti! Que tengas un buen día.', 'sin_json'],
      [{ blocks: ['{"producto": "paneles'], stop_reason: 'max_tokens' }, 'respuesta_incompleta'],
      [{ blocks: [], stop_reason: 'refusal' }, 'rechazo'],
      ['{"producto": "paneles"', 'json_invalido'],
    ];
    for (const [output, reason] of cases) {
      queue.push(output);
      const result = await askClaude([], MESSAGE, 'Perfil Prueba');
      expect((requests.at(-1)!.output_config as { format?: unknown }).format).toEqual({ type: 'json_schema', schema: EXTRACTION_SCHEMA });
      expect(result.diagnostics).toMatchObject({ usedDefaults: true, reason });
      expect(result.parsed).toEqual({ wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + MESSAGE + '"' });
    }
  });
});
