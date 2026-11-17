// api/_tests/whatsapp-webhook-cierres.test.ts
// Bot de WhatsApp, PR 1 (cierres honestos y sin caídas), de punta a punta por el webhook real.
// Claude se simula en el SDK (@anthropic-ai/sdk), así que corre el parseo real de
// claudeAgent.ts; Pipedrive se simula en sus módulos (personas, negocios, notas), así que corre
// el ensureWhatsAppDeal real. Sin red: fetch lanza. Solo datos inventados (correos @example.com,
// teléfonos +56900000xxx y un RUT con dígito verificador válido).
//
// Reglas que se prueban (diagnóstico del 16-10, plan PR 1 y especificación §5 y §10):
// - "ya derivé" (MSG_HUMAN) sale una sola vez y solo con negocio; nunca se ofrece una llamada.
// - "quedó registrada" (MSG4, el cierre de productos e instalación) solo si Pipedrive devolvió el negocio.
// - Antes de cerrar se pide el correo; sin correo el cierre es el texto A, sin negocio.
// - Un correo que llega después del cierre crea un solo negocio.
// - Si Pipedrive falla, el texto B; si el paso del flujo falla, el cliente recibe respuesta.
// - Lo que Claude devuelve con otra forma (objeto, lista) no tumba el webhook ni llega a la nota.
// - Un correo de eLIGHTS (ventas@, el que sugieren los textos A y B) nunca es el correo del cliente.
// - Dos mensajes seguidos: el segundo espera a que termine el primero y responde lo que pasó.

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  /** Salidas de Claude encoladas (JSON); sin salida, Claude no reconoce nada. */
  claude: [] as string[],
  /** [RESPUESTA] stop_reason de cada salida encolada (por defecto end_turn). */
  stopReasons: [] as string[],
  persons: [] as Array<Record<string, unknown>>,
  deals: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ dealId: number; fields: Record<string, unknown> }>,
  notes: [] as Array<{ content: string; deal_id: number; person_id: number }>,
  personsDown: false,
  dealsDown: false,
  updateDown: false,
  /** Demora de cada llamada simulada a Pipedrive (personas y negocios), en ms. */
  pdDelayMs: 0,
}));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: sim.claude.shift() ?? '{"wantsHuman":false,"qualifiesForDeal":false,"summary":"Sin datos."}' }],
        stop_reason: sim.stopReasons.shift() ?? 'end_turn',
      }),
    };
  },
}));
vi.mock('../_lib/pipedrive/persons.js', () => ({
  findOrCreatePerson: vi.fn(async (customer: Record<string, unknown>) => {
    if (sim.pdDelayMs) await new Promise((resolve) => setTimeout(resolve, sim.pdDelayMs));
    if (sim.personsDown) throw new Error('Pipedrive no responde (simulado)');
    sim.persons.push(customer);
    return { personId: 7000 + sim.persons.length, action: 'created' };
  }),
}));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  createDeal: vi.fn(async (params: Record<string, unknown>) => {
    if (sim.pdDelayMs) await new Promise((resolve) => setTimeout(resolve, sim.pdDelayMs));
    if (sim.dealsDown) throw new Error('Pipedrive no responde (simulado)');
    sim.deals.push(params);
    return { dealId: 9000 + sim.deals.length, status: 'created' };
  }),
  updateDeal: vi.fn(async (dealId: number, fields: Record<string, unknown>) => {
    if (sim.updateDown) throw new Error('Pipedrive rechaza los campos (simulado)');
    sim.updates.push({ dealId, fields });
  }),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({
  pipedrivePost: vi.fn(async (path: string, body: { content: string; deal_id: number; person_id: number }) => {
    if (path === '/notes') sim.notes.push(body);
    return { success: true, data: { id: 1 } };
  }),
}));
vi.mock('../_lib/whatsapp/notify.js', () => ({ notifyTeam: vi.fn(async () => {}) }));

import handler from '../whatsapp/webhook';
import { notifyTeam } from '../_lib/whatsapp/notify.js';
import { PRIVACY_NOTICE } from '../_lib/whatsapp/privacyNotice.js';
import { MSG4, MSG4_INSTALL_NO_EMAIL, MSG_ALREADY_WROTE, MSG_EMAIL_SHORT, MSG_REGISTERED_SHORT, getFlowState } from '../_lib/whatsapp/flowEngine.js';

type Handler = (req: unknown, res: unknown) => Promise<void>;
const webhook = handler as unknown as Handler;

// Textos aprobados por el dueño (2026-10-16), copiados tal cual.
const TEXT_A = 'Para que Claudio Quero te atienda por correo, necesito tu correo. ¿Me lo escribes por aquí? Si prefieres, envía tu solicitud a ventas@elights.cl.';
const TEXT_B = 'No pude registrar tu solicitud por un problema técnico. Por favor, envíala a ventas@elights.cl y Claudio Quero te responde por correo.';
const YA_DERIVE = /ya deriv[eé]/i;
const REGISTRADA = /qued[oó] registrad[oa]/i;
const LLAMADA = /llam/i;
const RUT_SINTETICO = '77.123.456-9'; // dígito verificador válido (módulo 11), no es un RUT real
const TECNICO = /problema t[eé]cnico/i;
// (fase 3B, dueño 16-11) El cierre que registra muestra el resumen de lo capturado; MSG4 («quedó registrada») llega con
// el «sí» del cliente, sin escribir otra vez en Pipedrive.
const PATIO_SUMMARY = 'Te resumo: focos LED, luz fría y para patio. ¿Está bien?';

let seq = 0;
// Un MessageSid por mensaje, como Twilio: el registro local deduplica tambien sin Upstash (H11).
let sidSeq = 0;
/** Un teléfono nuevo por prueba: el estado del bot vive en la memoria del módulo. */
const nextPhone = () => '+56900000' + String(100 + ++seq);

function fakeReq(params: Record<string, string>) {
  const raw = Buffer.from(new URLSearchParams(params).toString(), 'utf-8');
  return Object.assign(Readable.from([raw]), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
}

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as string | undefined,
    setHeader: () => res,
    status(code: number) { res.statusCode = code; return res; },
    send(body: string) { res.body = body; return res; },
    end: () => res,
  };
  return res;
}

/** El texto que recibe el cliente, sin el aviso de privacidad de la primera respuesta. */
function replyText(xml: string | undefined): string {
  const m = (xml ?? '').match(/<Message>([\s\S]*)<\/Message>/);
  const text = (m ? m[1] : '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return text.split('\n\n' + PRIVACY_NOTICE)[0];
}

/** Un mensaje del cliente; `claude` es lo que devuelve Claude para ese mensaje (JSON). */
async function send(phone: string, body: string, claude: Record<string, unknown> = {}): Promise<{ status: number; reply: string }> {
  sim.claude.push(JSON.stringify({ wantsHuman: false, qualifiesForDeal: false, summary: 'Resumen de prueba.', ...claude }));
  const res = fakeRes();
  await webhook(fakeReq({ From: 'whatsapp:' + phone, Body: body, ProfileName: 'Perfil Prueba', MessageSid: 'SMtest' + seq + '-' + ++sidSeq, NumMedia: '0' }), res);
  return { status: res.statusCode, reply: replyText(res.body) };
}

/** Conversa turno a turno y devuelve cada respuesta y cuántos negocios había después. */
/** (fase 3B) El «sí» al resumen: MSG4 («quedó registrada»), sin otro negocio, nota ni aviso. */
async function confirmSummary(phone: string) {
  const before = { deals: sim.deals.length, notes: sim.notes.length, notified: vi.mocked(notifyTeam).mock.calls.length };
  const yes = await send(phone, 'Sí', {});
  expect(yes.reply).toBe(MSG4);
  expect(yes.reply).toMatch(REGISTRADA);
  expect({ deals: sim.deals.length, notes: sim.notes.length, notified: vi.mocked(notifyTeam).mock.calls.length }).toEqual(before);
}

async function chat(phone: string, turns: Array<[string, Record<string, unknown>?]>) {
  const out: Array<{ reply: string; deals: number }> = [];
  for (const [body, claude] of turns) {
    const { reply } = await send(phone, body, claude);
    out.push({ reply, deals: sim.deals.length });
  }
  return out;
}

beforeEach(() => {
  for (const list of [sim.claude, sim.stopReasons, sim.persons, sim.deals, sim.updates, sim.notes]) list.length = 0;
  sim.personsDown = false;
  sim.dealsDown = false;
  sim.updateDown = false;
  sim.pdDelayMs = 0;
  vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'clave-ficticia-solo-pruebas');
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_QUANTITY', 'cf_wa_cantidad');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_PROJECT_USE', 'cf_wa_proyecto');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_BOT_SUMMARY', 'cf_wa_resumen');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_wa_correo');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red en las pruebas'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('T16 · "Necesito un ejecutivo que me llame"', () => {
  it('nunca ofrece una llamada, y "ya derivé" sale una sola vez, después de crear el negocio', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Necesito un ejecutivo que me llame', { wantsHuman: true }],
      ['Son 15 focos LED para una bodega', { producto: 'focos LED', cantidad: '15', proyecto_o_uso: 'bodega' }],
      ['juan.prueba@example.com', { correo: 'juan.prueba@example.com' }],
      ['gracias', {}],
      ['ok', {}],
    ]);
    for (const t of turns) expect(t.reply).not.toMatch(LLAMADA);
    const derive = turns.map((t, i) => (YA_DERIVE.test(t.reply) ? i : -1)).filter((i) => i >= 0);
    expect(derive).toEqual([2]); // una sola vez: al cerrar con correo
    expect(turns[2].deals).toBe(1); // y el negocio ya existe
    expect(turns[1].deals).toBe(0);
    expect(sim.deals).toHaveLength(1);
  });
});

describe('T-X1 · pide un ejecutivo y la conversación se cierra sin correo', () => {
  it('ningún mensaje dice "ya derivé" ni "quedó registrada" sin negocio; el correo tardío crea un solo negocio', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Necesito hablar con un ejecutivo, busco focos', { producto: 'focos', wantsHuman: true }],
      ['necesito 20', { cantidad: '20' }],
      ['necesito verlo con alguien primero', { wantsHuman: true }],
      ['no sé', {}],
      ['hola?', {}],
      ['mi correo es pedro.prueba@example.com', { correo: 'pedro.prueba@example.com' }],
      ['gracias', {}],
    ]);
    const beforeEmail = turns.slice(0, 5);
    for (const t of beforeEmail) {
      expect(t.reply).not.toMatch(YA_DERIVE);
      expect(t.reply).not.toMatch(REGISTRADA);
      expect(t.deals).toBe(0);
    }
    // El correo se pidió antes de cerrar, y el cierre sin correo es el texto A.
    expect(turns.slice(0, 3).some((t) => /correo/i.test(t.reply))).toBe(true);
    expect(turns[3].reply).toBe(TEXT_A);
    // (dueno, 12-11) La segunda peticion seguida del correo no repite el texto A.
    expect(turns[4].reply).toBe(MSG_EMAIL_SHORT);
    // El correo tardío crea el negocio y recién ahí "ya derivé" (una vez).
    expect(turns[5].deals).toBe(1);
    expect(turns[5].reply).toMatch(YA_DERIVE);
    expect(turns[6].reply).not.toMatch(YA_DERIVE);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].email).toBe('pedro.prueba@example.com');
    expect(sim.notes[0].content).toContain('Correo: pedro.prueba@example.com');
  });

  it('con Pipedrive caído al llegar el correo: texto B, nunca "ya derivé"', async () => {
    const phone = nextPhone();
    await chat(phone, [
      ['Quiero hablar con un vendedor', { wantsHuman: true }],
    ]);
    sim.dealsDown = true;
    const { reply } = await send(phone, 'compras.prueba@example.com', { correo: 'compras.prueba@example.com' });
    expect(reply).toBe(TEXT_B);
    const again = await send(phone, 'hola?', {});
    expect(again.reply).not.toMatch(YA_DERIVE);
    expect(again.reply).not.toMatch(REGISTRADA);
  });
});

describe('T-X1b · pidió un vendedor y siguen 4 mensajes sin intención comercial', () => {
  it('escenario del diagnóstico (Claude no reconoce nada): hasta el cierre ninguna respuesta repite la anterior; cerrada sin correo, el texto A se repite', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Quiero hablar con un vendedor', { wantsHuman: true }],
      ['paneles para oficina', {}],
      ['paneles para oficina', {}],
      ['paneles para oficina', {}],
      ['paneles para oficina', {}],
    ]);
    const replies = turns.map((t) => t.reply);
    // El atajo pide el correo una vez (antes: 5 de 5) y después el bot pregunta lo que falta.
    expect(replies.filter((r) => r === replies[0])).toHaveLength(1);
    for (let i = 1; i < 4; i++) expect(replies[i]).not.toBe(replies[i - 1]);
    expect(replies[3]).toBe(TEXT_A); // cierre sin correo
    // DECISIÓN DEL DUEÑO (12-11): con la conversación cerrada y sin correo, el mensaje siguiente no
    // repite el texto A: recibe MSG_EMAIL_SHORT (y así, alternados).
    expect(replies[4]).toBe(MSG_EMAIL_SHORT);
    for (const r of replies) {
      expect(r).not.toMatch(YA_DERIVE);
      expect(r).not.toMatch(REGISTRADA);
    }
    expect(sim.deals).toHaveLength(0);
  });

  it('con datos: pide el correo una sola vez, hace las demás preguntas y ninguna respuesta repite la anterior', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Quiero hablar con un vendedor', { wantsHuman: true }],
      ['paneles LED para una oficina', { producto: 'paneles LED', proyecto_o_uso: 'oficina' }],
      ['luz neutra', { tipo_de_luz: 'neutra' }],
      ['unas 20', { cantidad: '20' }],
      ['en Providencia', { comuna_o_ciudad: 'Providencia' }],
    ]);
    const replies = turns.map((t) => t.reply);
    for (let i = 1; i < replies.length; i++) expect(replies[i]).not.toBe(replies[i - 1]);
    // El primer pedido de correo (atajo de "pidió ejecutivo") no se repite.
    expect(replies.filter((r) => r === replies[0])).toHaveLength(1);
    // Después del atajo, el bot pregunta por el producto (antes saltaba directo a los datos de contacto).
    expect(replies[1]).toMatch(/tipo de luz|cantidad/i);
    for (const r of replies) {
      expect(r).not.toMatch(YA_DERIVE);
      expect(r).not.toMatch(REGISTRADA);
    }
    expect(sim.deals).toHaveLength(0);
  });
});

describe('T-X2 · no sabe la comuna', () => {
  it('pide el correo antes de cerrar; sin correo no dice "quedó registrada"; el correo tardío registra', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }],
      ['fría', { tipo_de_luz: 'fría' }],
      ['todavía no sé dónde', {}],
      ['no sé', {}],
      ['ok, mi correo es ana.prueba@example.com', { correo: 'ana.prueba@example.com' }],
    ]);
    expect(turns[2].reply).toMatch(/correo/i); // lo pide antes de cerrar
    expect(turns[3].reply).toBe(TEXT_A); // cierre sin correo
    for (const t of turns.slice(0, 4)) {
      expect(t.reply).not.toMatch(REGISTRADA);
      expect(t.deals).toBe(0);
    }
    expect(turns[4].reply).toBe(PATIO_SUMMARY);
    expect(turns[4].deals).toBe(1);
    expect(sim.deals).toHaveLength(1);
    await confirmSummary(phone);
  });

  it('producto y cantidad sin responder: pide el correo antes de cerrar y no cierra con "quedó registrada"', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Hola, quiero iluminar mi terraza', { proyecto_o_uso: 'terraza' }],
      ['no sé bien, ¿qué me recomiendas?', {}],
      ['no sé', {}],
    ]);
    expect(turns[1].reply).toMatch(/correo/i);
    expect(turns[2].reply).toBe(TEXT_A);
    for (const t of turns) expect(t.reply).not.toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(0);
  });

  it('nombre y correo en mensajes separados, después del cierre: un negocio con los dos', async () => {
    const phone = nextPhone();
    await chat(phone, [
      ['Busco 12 focos LED luz cálida para mi casa en Maipú', { producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' }],
      ['no sé', {}],
    ]);
    // (dueno, 12-11) El cierre fue el texto A: los mensajes siguientes lo alternan con MSG_EMAIL_SHORT.
    const closed = await send(phone, 'hola?', {});
    expect(closed.reply).toBe(MSG_EMAIL_SHORT);
    const name = await send(phone, 'Ana Prueba', { nombre: 'Ana Prueba' });
    expect(name.reply).toBe(TEXT_A);
    expect(sim.deals).toHaveLength(0);
    const email = await send(phone, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(email.reply).toBe('Te resumo: 12 focos LED, luz cálida, para casa y en Maipú. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    await confirmSummary(phone);
    expect(sim.notes[0].content).toContain('Nombre/empresa: Ana Prueba');
    expect(sim.notes[0].content).toContain('Correo: ana.prueba@example.com');
  });
});

describe('T-INST-2 · instalación', () => {
  it('el correo y el nombre de la instalación llegan a la persona y a la nota', async () => {
    const phone = nextPhone();
    const { reply } = await send(phone, 'Quiero instalar luces en mi casa. Soy Ana Prueba, ana.prueba@example.com, en Maipú', {
      nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', comuna_o_ciudad: 'Maipú', proyecto_o_uso: 'casa',
    });
    expect(reply).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons).toHaveLength(1);
    expect(sim.persons[0].email).toBe('ana.prueba@example.com');
    expect(sim.persons[0].name).toBe('Ana Prueba');
    const note = sim.notes[0].content;
    expect(note).toContain('Correo: ana.prueba@example.com');
    expect(note).toContain('Nombre/empresa: Ana Prueba');
    expect(note).toContain('Comuna/ciudad: Maipú');
    expect(sim.updates[0].fields.cf_wa_correo).toBe('ana.prueba@example.com');
  });

  it('instalación cerrada sin correo: el correo tardío crea el negocio con ese correo', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['quiero instalar focos en mi casa', {}],
      ['mmm', {}],
      ['mmm', {}],
      ['mmm', {}],
    ]);
    expect(turns[3].reply).not.toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(0);
    const late = await send(phone, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(late.reply).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].email).toBe('ana.prueba@example.com');
    expect(sim.notes[0].content).toContain('Correo: ana.prueba@example.com');
  });
});

describe('caídas: lo que devuelve Claude con otra forma', () => {
  const FULL = 'Necesito 20 paneles 60x60 y 10 focos de riel, luz neutra, para mi casa en Ñuñoa. Soy Pedro Prueba, pedro.prueba@example.com';
  const FULL_CLAUDE = {
    producto: 'paneles 60x60 y focos de riel', tipo_de_luz: 'neutra', cantidad: '20', proyecto_o_uso: 'casa',
    comuna_o_ciudad: 'Ñuñoa', nombre: 'Pedro Prueba', correo: 'pedro.prueba@example.com', qualifiesForDeal: true,
  };
  const FULL_SUMMARY = 'Te resumo: 20 paneles 60x60 y 10 focos de riel, luz neutra, para casa y en Ñuñoa. ¿Está bien?';

  it('proyecto como objeto en el primer mensaje: el cliente recibe respuesta', async () => {
    const phone = nextPhone();
    const r = await send(phone, 'Hola, quiero iluminar una bodega de 300 m2', { proyecto_o_uso: { tipo: 'bodega', superficie_m2: 300 } });
    expect(r.status).toBe(200);
    expect(r.reply).not.toBe('');
    expect(r.reply).not.toContain('[object Object]');
  });

  it('proyecto como objeto en el mensaje que cierra con correo: 1 persona, 1 negocio y la nota sin objetos', async () => {
    const phone = nextPhone();
    const r = await send(phone, FULL, { ...FULL_CLAUDE, proyecto_o_uso: { tipo: 'casa', superficie_m2: 120 } });
    expect(r.status).toBe(200);
    expect(r.reply).toBe(FULL_SUMMARY);
    await confirmSummary(phone);
    expect(sim.persons).toHaveLength(1);
    expect(sim.deals).toHaveLength(1);
    const note = sim.notes[0].content;
    expect(note).not.toContain('[object Object]');
    expect(note).toContain('Proyecto/uso: casa'); // lo saca del texto del cliente
  });

  it('correo como lista en el primer mensaje: el cliente recibe respuesta', async () => {
    const phone = nextPhone();
    const r = await send(phone, 'Mi correo es compras.prueba@example.com o pedro.prueba@example.com', {
      correo: ['compras.prueba@example.com', 'pedro.prueba@example.com'],
    });
    expect(r.status).toBe(200);
    expect(r.reply).not.toBe('');
  });

  it('correo como lista en el mensaje que cierra: 1 persona con el correo del texto, 1 negocio', async () => {
    const phone = nextPhone();
    const r = await send(phone, FULL, { ...FULL_CLAUDE, correo: ['pedro.prueba@example.com', 'compras.prueba@example.com'] });
    expect(r.status).toBe(200);
    expect(r.reply).toBe(FULL_SUMMARY);
    await confirmSummary(phone);
    expect(sim.persons).toHaveLength(1);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].email).toBe('pedro.prueba@example.com');
    expect(sim.notes[0].content).not.toContain('[object Object]');
  });

  it('resumen y cantidad como objetos en un pedido completo: hay negocio, y la nota no trae "[object Object]"', async () => {
    const phone = nextPhone();
    const r = await send(phone, FULL, {
      ...FULL_CLAUDE,
      cantidad: { 'paneles 60x60': 20, 'focos de riel': 10 },
      summary: { resumen: 'Pide paneles y focos', prioridad: 'media' },
    });
    expect(r.status).toBe(200);
    expect(r.reply).toBe(FULL_SUMMARY);
    await confirmSummary(phone);
    expect(sim.persons).toHaveLength(1);
    expect(sim.deals).toHaveLength(1);
    const note = sim.notes[0].content;
    expect(note).not.toContain('[object Object]');
    // [RESUMEN] PR 3: el resumen va en su sección.
    expect(note).toMatch(/^-- RESUMEN DEL BOT \(interpretación, no dato\) --\n.+/m);
    // [CANTIDAD-VARIOS] Con varios ítems, Cantidad va en null (vacía el campo); los demás campos son texto.
    const { cf_wa_cantidad: quantity, ...rest } = sim.updates[0].fields as Record<string, unknown>;
    expect(quantity).toBeNull();
    for (const value of Object.values(rest)) expect(typeof value).toBe('string');
  });

  it('si Pipedrive rechaza los campos del negocio, la nota se escribe igual', async () => {
    const phone = nextPhone();
    sim.updateDown = true;
    const r = await send(phone, FULL, FULL_CLAUDE);
    expect(r.reply).toBe(FULL_SUMMARY);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
    await confirmSummary(phone);
  });
});

// [RESPUESTA] Informe de Codex del 10-11 (punto 3): con la respuesta de Claude ilegible el flujo sigue con sus reglas
// (no recibe FALLBACK_REPLY) y el log dice por qué se usaron los valores por defecto, en vez de «Claude ok».
describe('[RESPUESTA] respuesta de Claude que no se puede usar entera', () => {
  const FULL = 'Necesito 20 paneles LED 60x60 luz neutra para mi casa en Ñuñoa. Soy Pedro Prueba, pedro.prueba@example.com';
  const FULL_CLAUDE = {
    producto: 'paneles 60x60', tipo_de_luz: 'neutra', cantidad: '20', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Ñuñoa',
    nombre: 'Pedro Prueba', correo: 'pedro.prueba@example.com', wantsHuman: false, qualifiesForDeal: true, summary: 'El cliente pide paneles 60x60.',
  };
  const PRIVATE = ['pedro.prueba', 'Pedro Prueba', 'Ñuñoa', 'paneles'];

  /** Un mensaje con la salida de Claude tal cual (texto, no un objeto). */
  async function sendRaw(phone: string, body: string, raw: string, stopReason = 'end_turn') {
    sim.claude.push(raw);
    sim.stopReasons.push(stopReason);
    const res = fakeRes();
    await webhook(fakeReq({ From: 'whatsapp:' + phone, Body: body, ProfileName: 'Perfil Prueba', MessageSid: 'SMtest' + seq + '-' + ++sidSeq, NumMedia: '0' }), res);
    return { status: res.statusCode, reply: replyText(res.body) };
  }
  const logged = (spy: unknown) => (spy as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
  const qaOut = () => logged(console.log).filter((l) => l.includes('[QA:out]')).map((l) => JSON.parse(l.slice(l.indexOf('{'))));

  it('texto sin JSON en un pedido completo: las reglas siguen (repreguntan lo que no reconocen) y registran el negocio, la nota y el aviso a ventas; el log da el motivo y no dice «Claude ok»', async () => {
    const phone = nextPhone();
    vi.mocked(notifyTeam).mockClear();
    const NO_JSON = 'Lo siento, no puedo procesar esa solicitud.';
    const first = await sendRaw(phone, FULL, NO_JSON);
    expect(first.status).toBe(200);
    // Sin Claude, las reglas no reconocen "Soy Pedro Prueba" y lo preguntan (informe de Codex: repreguntas posibles).
    expect(first.reply).toMatch(/nombre/i);
    expect(first.reply).not.toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(0);
    const second = await sendRaw(phone, 'Pedro Prueba', NO_JSON);
    // (fase 3B) Sin Claude, el producto es el que leen las reglas.
    expect(second.reply).toBe('Te resumo: 20 paneles LED, luz neutra, para casa y en Ñuñoa. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].email).toBe('pedro.prueba@example.com');
    expect(sim.notes[0].content).toContain(FULL); // la transcripción literal del cliente
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(logged(console.log).some((l) => l.includes('Claude ok'))).toBe(false);
    const warn = logged(console.warn).filter((l) => l.includes('Claude sin datos utilizables'));
    expect(warn).toHaveLength(2);
    for (const line of warn) {
      expect(line).toContain('motivo=sin_json stop_reason=end_turn largo=' + NO_JSON.length);
      for (const piece of PRIVATE) expect(line).not.toContain(piece);
    }
    expect(qaOut().map((q) => q.ai)).toEqual(['heuristic', 'heuristic']);
    await confirmSummary(phone);
  });

  // [RESPUESTA] Revisión de Codex de la PR 168 (informe del 11-11): en estos dos casos la versión anterior cerraba y
  // creaba el negocio con datos que no debía tomar; ahora, como en main, las reglas repreguntan el nombre.
  it('Codex PR 168, hallazgo 1: una lista en un bloque ```json no se toma como objeto: sin negocio, repregunta el nombre', async () => {
    const phone = nextPhone();
    const r = await sendRaw(phone, FULL, '```json\n[' + JSON.stringify(FULL_CLAUDE) + ']\n```');
    expect(r.reply).toMatch(/nombre/i);
    expect(sim.deals).toHaveLength(0);
    expect(logged(console.warn).some((l) => l.includes('motivo=no_es_objeto'))).toBe(true);
  });

  it('Codex PR 168, hallazgo 3: un objeto seguido de una corrección sin cerrar no se usa: sin negocio, repregunta el nombre', async () => {
    const phone = nextPhone();
    const r = await sendRaw(phone, FULL, JSON.stringify(FULL_CLAUDE) + '\nCorrección: {"nombre":"Rosa Prueba"');
    expect(r.reply).toMatch(/nombre/i);
    expect(sim.deals).toHaveLength(0);
    expect(logged(console.warn).some((l) => l.includes('motivo=json_invalido stop_reason=end_turn'))).toBe(true);
  });

  // Informe 03: la prosa sin llaves alrededor del objeto puede invalidarlo. Con el rescate del texto alrededor se
  // tomaban el nombre y el correo de Rosa Prueba y se registraba el negocio; ahora, como en main, no se usa nada.
  it('Codex PR 168, informe 03: un objeto seguido de una corrección en prosa no se usa: sin negocio, repregunta el nombre', async () => {
    const phone = nextPhone();
    const OTHER = { ...FULL_CLAUDE, nombre: 'Rosa Prueba', correo: 'rosa.prueba@example.com' };
    const r = await sendRaw(phone, FULL, JSON.stringify(OTHER) + ' Corrección: nombre y correo anteriores no corresponden al cliente; dejarlos en null y preguntar de nuevo.');
    expect(r.reply).toMatch(/nombre/i);
    expect(r.reply).not.toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(0);
    expect(sim.persons).toHaveLength(0);
    expect(logged(console.warn).some((l) => l.includes('motivo=json_invalido stop_reason=end_turn'))).toBe(true);
    expect(logged(console.log).some((l) => l.includes('Claude ok'))).toBe(false);
  });

  it('cortada por max_tokens: respuesta incompleta, valores por defecto con su motivo', async () => {
    const phone = nextPhone();
    const r = await sendRaw(phone, 'Hola, busco focos', JSON.stringify(FULL_CLAUDE), 'max_tokens');
    expect(r.status).toBe(200);
    expect(r.reply).not.toBe('');
    expect(logged(console.warn).some((l) => l.includes('motivo=respuesta_incompleta stop_reason=max_tokens'))).toBe(true);
    expect(logged(console.log).some((l) => l.includes('Claude ok'))).toBe(false);
  });

  it('JSON en un bloque con texto alrededor: se usa y el log dice «Claude ok»', async () => {
    const phone = nextPhone();
    const r = await sendRaw(phone, FULL, 'Aquí está el JSON:\n```json\n' + JSON.stringify(FULL_CLAUDE) + '\n```\nSaludos.');
    expect(r.reply).toBe('Te resumo: 20 paneles 60x60, luz neutra, para casa y en Ñuñoa. ¿Está bien?');
    expect(logged(console.log).some((l) => l.includes('Claude ok'))).toBe(true);
    expect(logged(console.warn).some((l) => l.includes('Claude sin datos') || l.includes('valores por defecto'))).toBe(false);
    expect(qaOut().at(-1).ai).toBe('claude');
  });

  it('un campo con otro tipo: los demás se usan y el log nombra el campo, sin «Claude ok»', async () => {
    const phone = nextPhone();
    await sendRaw(phone, FULL, JSON.stringify({ ...FULL_CLAUDE, wantsHuman: 'false', cantidad: { paneles: 20 } }));
    expect(sim.deals).toHaveLength(1);
    const warn = logged(console.warn).filter((l) => l.includes('Claude con valores por defecto en'));
    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain('cantidad=tipo,wantsHuman=tipo stop_reason=end_turn');
    for (const piece of PRIVATE) expect(warn[0]).not.toContain(piece);
    expect(logged(console.log).some((l) => l.includes('Claude ok'))).toBe(false);
    expect(qaOut().at(-1).ai).toBe('claude');
  });
});

describe('el correo de eLIGHTS (ventas@, que sugieren los textos A y B) no es el correo del cliente', () => {
  it('atajo de ejecutivo, luego "ok, le escribo a ventas@elights.cl": sin negocio y sin "ya derivé"', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Quiero hablar con un vendedor, son paneles para una oficina', { wantsHuman: true, proyecto_o_uso: 'oficina' }],
      ['ok, le escribo a ventas@elights.cl', {}],
    ]);
    expect(turns[0].reply).toBe(TEXT_A);
    expect(turns[1].reply).not.toMatch(YA_DERIVE);
    expect(sim.deals).toHaveLength(0);
    expect(sim.persons).toHaveLength(0);
  });

  it('Claude devuelve ventas@elights.cl (lo copió del historial): no se toma como correo del cliente', async () => {
    const phone = nextPhone();
    await chat(phone, [['Quiero hablar con un vendedor, son paneles para una oficina', { wantsHuman: true, proyecto_o_uso: 'oficina' }]]);
    const r = await send(phone, 'ok', { correo: 'ventas@elights.cl' });
    expect(r.reply).not.toMatch(YA_DERIVE);
    expect(sim.deals).toHaveLength(0);
  });

  it('conversación cerrada sin correo, luego "ya la envié a ventas@elights.cl": el texto aprobado de "ya le escribí", sin negocio', async () => {
    const phone = nextPhone();
    await chat(phone, [
      ['Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }],
      ['fría', { tipo_de_luz: 'fría' }],
      ['todavía no sé dónde', {}],
      ['no sé', {}],
    ]);
    const r = await send(phone, 'listo, ya la envié a ventas@elights.cl', {});
    expect(r.reply).toBe(MSG_ALREADY_WROTE);
    expect(sim.deals).toHaveLength(0);
  });

  it('instalación cerrada sin correo, luego "ok, se la mando a ventas@elights.cl": sin negocio', async () => {
    const phone = nextPhone();
    await chat(phone, [['quiero instalar focos en mi casa', {}], ['mmm', {}], ['mmm', {}], ['mmm', {}]]);
    const r = await send(phone, 'ok, se la mando a ventas@elights.cl', {});
    // (dueno, 12-11) Sin repetir el cierre de instalacion sin correo.
    expect(r.reply).toBe(MSG_EMAIL_SHORT);
    expect(sim.deals).toHaveLength(0);
  });

  it('"ya escribí a ventas@elights.cl, mi correo es ana.prueba@example.com": el negocio va con el correo del cliente', async () => {
    const phone = nextPhone();
    await chat(phone, [
      ['Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }],
      ['fría', { tipo_de_luz: 'fría' }],
      ['todavía no sé dónde', {}],
      ['no sé', {}],
    ]);
    const r = await send(phone, 'ya escribí a ventas@elights.cl, mi correo es ana.prueba@example.com', {});
    expect(r.reply).toBe(PATIO_SUMMARY);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].email).toBe('ana.prueba@example.com');
    await confirmSummary(phone);
  });
});

describe('correo tardío con "necesito" o "quiero"', () => {
  const summaries: Record<string, string> = {
    'necesito que me escriban a ana.prueba@example.com': PATIO_SUMMARY,
    'ana.prueba@example.com necesito 12': 'Te resumo: 12 focos LED, luz fría y para patio. ¿Está bien?',
  };
  for (const msg of ['necesito que me escriban a ana.prueba@example.com', 'ana.prueba@example.com necesito 12']) {
    it('"' + msg + '": se suma a lo capturado y crea el negocio (antes reiniciaba la conversación)', async () => {
      const phone = nextPhone();
      await chat(phone, [
        ['Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }],
        ['fría', { tipo_de_luz: 'fría' }],
        ['todavía no sé dónde', {}],
        ['no sé', {}],
      ]);
      const r = await send(phone, msg, { correo: 'ana.prueba@example.com' });
      expect(r.reply).toBe(summaries[msg]);
      expect(sim.deals).toHaveLength(1);
      await confirmSummary(phone);
      const note = sim.notes[0].content;
      expect(note).toContain('Producto: focos LED');
      expect(note).toContain('Proyecto/uso: patio');
      expect(note).toContain('Correo: ana.prueba@example.com');
    });
  }
});

describe('instalación con el correo dado antes en el flujo de productos', () => {
  it('no lo vuelve a pedir, crea el negocio con ese correo y nunca dice "problema técnico" (Pipedrive arriba)', async () => {
    const phone = nextPhone();
    const turns = await chat(phone, [
      ['Hola, mi correo es luis.prueba@example.com, busco focos', { correo: 'luis.prueba@example.com', producto: 'focos' }],
      ['en realidad quiero instalar focos en mi casa', { proyecto_o_uso: 'casa' }],
      ['ya te di mi correo', {}],
      ['Luis Prueba', { nombre: 'Luis Prueba' }],
      ['Maipú', { comuna_o_ciudad: 'Maipú' }],
      ['ok', {}],
    ]);
    expect(turns[1].reply).not.toMatch(/correo/i);
    expect(turns[4].reply).toBe(MSG4);
    expect(turns[4].deals).toBe(1);
    for (const t of turns) expect(t.reply).not.toMatch(TECNICO);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0]).toMatchObject({ email: 'luis.prueba@example.com', name: 'Luis Prueba' });
  });
});

describe('nombre de instalación que no es un nombre', () => {
  it('"soy de Maipu" (Claude sin nombre): la persona y la nota conservan el nombre del perfil', async () => {
    const phone = nextPhone();
    await send(phone, 'Hola, soy de Maipu y quiero instalar focos en mi casa, ana.prueba@example.com', {
      correo: 'ana.prueba@example.com', comuna_o_ciudad: 'Maipu', proyecto_o_uso: 'casa',
    });
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].name).toBe('Perfil Prueba');
    expect(sim.notes[0].content).toContain('Nombre/empresa: Perfil Prueba');
    expect(sim.notes[0].content).not.toContain('Nombre/empresa: de Maipu');
  });

  it('"soy instalador electrico" (Claude sin nombre): la persona conserva el nombre del perfil', async () => {
    // PR 2 (T-INST-3): un instalador que pide productos sigue el flujo de productos.
    const phone = nextPhone();
    await chat(phone, [
      ['Hola, soy instalador electrico y necesito 50 paneles LED 60x60 luz neutra para una casa en Maipu, pedro.prueba@example.com', {
        producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '50', correo: 'pedro.prueba@example.com', comuna_o_ciudad: 'Maipu', proyecto_o_uso: 'casa',
      }],
      ['gracias', {}],
    ]);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].name).toBe('Perfil Prueba');
    expect(sim.notes[0].content).not.toContain('Nombre/empresa: instalador');
    expect(sim.notes[0].content).toContain('Cantidad: 50');
    expect(sim.notes[0].content).not.toContain('Solicitud de instalacion');
  });
});

describe('dos mensajes seguidos mientras se crea el negocio (Pipedrive tarda)', () => {
  const FULL_B2C = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
  const FULL_B2C_CLAUDE = {
    producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú',
    nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', qualifiesForDeal: true,
  };

  it('el "gracias" que llega mientras se crea el negocio espera y responde el cierre real, no el texto B', async () => {
    const phone = nextPhone();
    sim.pdDelayMs = 150;
    const first = send(phone, FULL_B2C, FULL_B2C_CLAUDE);
    await pause(30);
    const second = send(phone, 'gracias', {});
    const [a, b] = await Promise.all([first, second]);
    expect(a.reply).toBe('Te resumo: 12 focos LED, luz cálida, para casa y en Maipú. ¿Está bien?');
    // [PLAZO] El segundo mensaje recibe el recordatorio corto, no otra vez el cierre largo.
    expect(b.reply).toBe(MSG_REGISTERED_SHORT);
    expect(b.reply).not.toMatch(TECNICO);
    expect(sim.deals).toHaveLength(1);
  });

  it('un pedido nuevo que llega mientras se crea el negocio no hereda su resultado', async () => {
    const phone = nextPhone();
    sim.pdDelayMs = 150;
    const first = send(phone, FULL_B2C, FULL_B2C_CLAUDE);
    await pause(30);
    // (fase 3B) Con el resumen a la vista, "necesito también 5 paneles" se suma al mismo pedido
    // (whatsapp-webhook-resumen.test.ts); un pedido nuevo lo dice.
    const second = send(phone, 'necesito otro pedido: 5 paneles LED', { producto: 'paneles LED', cantidad: '5' });
    await Promise.all([first, second]);
    sim.pdDelayMs = 0;
    expect(getFlowState(phone).stage).not.toBe('closed');
    expect(getFlowState(phone).deal).toBeUndefined();
    // El pedido nuevo cierra sin correo: texto A, nunca "quedó registrada"; su correo crea el 2.º negocio.
    const rest = await chat(phone, [['fría', {}], ['no sé', {}], ['no sé', {}], ['no sé', {}], ['hola?', {}]]);
    for (const t of rest) expect(t.reply).not.toMatch(REGISTRADA);
    expect(rest[rest.length - 1].reply).toBe(TEXT_A);
    const late = await send(phone, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    // (revisión 16-11, T3) Con dos partes, «y» antes de la última, como en el alcance de la fase 3B.
    expect(late.reply).toBe('Te resumo: 5 paneles LED y luz fría. ¿Está bien?');
    expect(sim.deals).toHaveLength(2);
    await confirmSummary(phone);
  });
});

describe('Pipedrive caído', () => {
  const B2B = 'Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia. Comercial Prueba SpA, RUT ' + RUT_SINTETICO + ', compras@comercial-prueba.example.com';
  const B2B_CLAUDE = {
    producto: 'paneles LED 60x60', tipo_de_luz: 'fría', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia',
    empresa: 'Comercial Prueba SpA', correo: 'compras@comercial-prueba.example.com', qualifiesForDeal: true,
  };

  it('falla la creación del negocio: texto B, y los mensajes siguientes tampoco dicen "quedó registrada"', async () => {
    const phone = nextPhone();
    sim.dealsDown = true;
    const r = await send(phone, B2B, B2B_CLAUDE);
    expect(r.status).toBe(200);
    expect(r.reply).toBe(TEXT_B);
    const again = await send(phone, 'hola?', {});
    expect(again.reply).not.toMatch(REGISTRADA);
    expect(again.reply).toBe(TEXT_B);
  });

  it('Pipedrive no responde ni para la persona: texto B', async () => {
    const phone = nextPhone();
    sim.personsDown = true;
    const r = await send(phone, B2B, B2B_CLAUDE);
    expect(r.reply).toBe(TEXT_B);
    expect(sim.deals).toHaveLength(0);
  });

  it('pidió un vendedor y dio su correo, pero Pipedrive falla: texto B, no "ya derivé"', async () => {
    const phone = nextPhone();
    sim.dealsDown = true;
    const r = await send(phone, 'Quiero hablar con un vendedor, mi correo es pedro.prueba@example.com', { wantsHuman: true, correo: 'pedro.prueba@example.com' });
    expect(r.reply).toBe(TEXT_B);
    expect(r.reply).not.toMatch(YA_DERIVE);
  });

  it('control: con Pipedrive arriba, el mismo pedido B2B queda registrado', async () => {
    const phone = nextPhone();
    const r = await send(phone, B2B, B2B_CLAUDE);
    expect(r.reply).toBe('Te resumo: 30 paneles LED 60x60, luz fría, para oficina y en Providencia. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    await confirmSummary(phone);
  });
});

// FASE 3A, punto 5 (16-11): por el webhook real, el negocio nuevo lleva el tipo del flujo y no el de las palabras del
// último mensaje ("obra" todavía cuenta como empresa en detectLeadType).
describe('[REGISTRO] el negocio nuevo lleva el tipo del flujo', () => {
  const ORDER = 'Necesito 20 paneles LED 60x60 luz neutra para mi casa en Ñuñoa. Soy Pedro Prueba';
  const ORDER_CLAUDE = { producto: 'paneles 60x60', tipo_de_luz: 'neutra', cantidad: '20', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Ñuñoa', nombre: 'Pedro Prueba' };

  it('una persona cuyo último mensaje dice «obra»: negocio y persona B2C', async () => {
    const phone = nextPhone();
    expect((await send(phone, ORDER, ORDER_CLAUDE)).reply).not.toMatch(REGISTRADA);
    expect(getFlowState(phone).leadType).toBe('B2C');
    const r = await send(phone, 'Es para la obra de ampliación de mi casa: pedro.prueba@example.com', { correo: 'pedro.prueba@example.com' });
    expect(r.reply).toBe('Te resumo: 20 paneles 60x60, luz neutra, para casa y en Ñuñoa. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    expect(sim.deals[0].leadType).toBe('B2C');
    expect(sim.persons[0].customerType).toBe('B2C');
  });

  it('una empresa sin RUT cuyo último mensaje es solo el correo: negocio B2B', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 paneles LED 60x60 luz neutra para la oficina de Comercial Prueba SpA en Ñuñoa',
      { ...ORDER_CLAUDE, proyecto_o_uso: 'oficina', nombre: undefined, empresa: 'Comercial Prueba SpA' });
    expect(getFlowState(phone).leadType).toBe('B2B');
    const r = await send(phone, 'compras@comercial-prueba.example.com', { correo: 'compras@comercial-prueba.example.com' });
    expect(r.reply).toBe('Te resumo: 20 paneles 60x60, luz neutra, para oficina y en Ñuñoa. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    expect(sim.deals[0].leadType).toBe('B2B');
  });

  // (revisión 16-11) El flujo de instalación fijaba B2C: con el tipo del flujo en el negocio nuevo, una constructora que
  // pedía instalación quedaba como persona (boleta). Ahora la instalación usa las señales de empresa del flujo.
  it('una constructora que pide instalación en un mensaje: negocio y persona B2B', async () => {
    const phone = nextPhone();
    const r = await send(phone, 'Somos Constructora Prueba SpA, necesitamos instalación de luminarias LED en una obra en Maipú. Contacto Juan Prueba, juan.prueba@example.com',
      { empresa: 'Constructora Prueba SpA', nombre: 'Juan Prueba', correo: 'juan.prueba@example.com', comuna_o_ciudad: 'Maipú', proyecto_o_uso: 'obra' });
    expect(r.reply).toBe(MSG4);
    expect(getFlowState(phone)).toMatchObject({ isInstallFlow: true, leadType: 'B2B' });
    expect(sim.deals).toHaveLength(1);
    expect(sim.deals[0].leadType).toBe('B2B');
    expect(sim.persons[0].customerType).toBe('B2B');
  });

  it('una empresa (factura) que después pide la instalación: sigue B2B', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 campanas LED 150W para la bodega de Comercial Prueba SpA en Quilicura, necesito factura',
      { producto: 'campanas LED 150W', cantidad: '20', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', empresa: 'Comercial Prueba SpA' });
    expect(getFlowState(phone).leadType).toBe('B2B');
    await send(phone, 'También necesitamos la instalación de las campanas');
    expect(getFlowState(phone)).toMatchObject({ isInstallFlow: true, leadType: 'B2B' });
    const r = await send(phone, 'Juan Prueba, juan.prueba@example.com, Quilicura, bodega', { nombre: 'Juan Prueba', correo: 'juan.prueba@example.com', comuna_o_ciudad: 'Quilicura' });
    expect(r.reply).toBe(MSG4);
    expect(sim.deals).toHaveLength(1);
    expect(sim.deals[0].leadType).toBe('B2B');
    expect(sim.persons[0].customerType).toBe('B2B');
  });

  it('la empresa aparece a mitad de la instalación («factura para Constructora…»): B2B', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito instalar 30 campanas LED');
    expect(getFlowState(phone)).toMatchObject({ isInstallFlow: true, leadType: 'B2C' });
    const r = await send(phone, 'Pedro Prueba, pedro.prueba@example.com, Quilicura, bodega, necesito factura para Constructora Prueba SpA',
      { nombre: 'Pedro Prueba', correo: 'pedro.prueba@example.com' });
    expect(r.reply).toBe(MSG4);
    expect(sim.deals[0].leadType).toBe('B2B');
    expect(sim.persons[0].customerType).toBe('B2B');
  });

  it('una persona que pide instalación para su casa: negocio y persona B2C (como antes)', async () => {
    const phone = nextPhone();
    const r = await send(phone, 'Necesito instalar 10 focos LED en mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com',
      { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', comuna_o_ciudad: 'Maipú', proyecto_o_uso: 'casa' });
    expect(r.reply).toBe(MSG4);
    expect(getFlowState(phone)).toMatchObject({ isInstallFlow: true, leadType: 'B2C' });
    expect(sim.deals[0].leadType).toBe('B2C');
    expect(sim.persons[0].customerType).toBe('B2C');
  });
});
