// api/_tests/whatsapp-webhook-cierres.test.ts
// Bot de WhatsApp, PR 1 (cierres honestos y sin caídas), de punta a punta por el webhook real.
// Claude se simula en el SDK (@anthropic-ai/sdk), así que corre el parseo real de
// claudeAgent.ts; Pipedrive se simula en sus módulos (personas, negocios, notas), así que corre
// el ensureWhatsAppDeal real. Sin red: fetch lanza. Solo datos inventados (correos @example.com,
// teléfonos +56900000xxx y un RUT con dígito verificador válido).
//
// Reglas que se prueban (diagnóstico del 16-10, plan PR 1 y especificación §5 y §10):
// - "ya derivé" (MSG_HUMAN) sale una sola vez y solo con negocio; nunca se ofrece una llamada.
// - "quedó registrada" (MSG4, MSG4_B2B, MSG4_INSTALL) solo si Pipedrive devolvió el negocio.
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
import { PRIVACY_NOTICE } from '../_lib/whatsapp/privacyNotice.js';
import { MSG4, MSG4_INSTALL, MSG4_INSTALL_NO_EMAIL, getFlowState } from '../_lib/whatsapp/flowEngine.js';

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

let seq = 0;
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
  await webhook(fakeReq({ From: 'whatsapp:' + phone, Body: body, ProfileName: 'Perfil Prueba', MessageSid: 'SMtest' + seq, NumMedia: '0' }), res);
  return { status: res.statusCode, reply: replyText(res.body) };
}

/** Conversa turno a turno y devuelve cada respuesta y cuántos negocios había después. */
async function chat(phone: string, turns: Array<[string, Record<string, unknown>?]>) {
  const out: Array<{ reply: string; deals: number }> = [];
  for (const [body, claude] of turns) {
    const { reply } = await send(phone, body, claude);
    out.push({ reply, deals: sim.deals.length });
  }
  return out;
}

beforeEach(() => {
  for (const list of [sim.claude, sim.persons, sim.deals, sim.updates, sim.notes]) list.length = 0;
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
    expect(turns[4].reply).toBe(TEXT_A);
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
    // DECISIÓN PENDIENTE DEL DUEÑO: con la conversación cerrada y sin correo, cada mensaje sin
    // correo recibe otra vez el texto A (como hoy MSG4_INSTALL_NO_EMAIL en instalación). No hay un
    // texto aprobado para no repetirlo; si se aprueba uno (o no responder), esta línea cambia.
    expect(replies[4]).toBe(TEXT_A);
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
    expect(turns[4].reply).toMatch(REGISTRADA);
    expect(turns[4].deals).toBe(1);
    expect(sim.deals).toHaveLength(1);
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
    const closed = await send(phone, 'hola?', {});
    expect(closed.reply).toBe(TEXT_A);
    const name = await send(phone, 'Ana Prueba', { nombre: 'Ana Prueba' });
    expect(name.reply).toBe(TEXT_A);
    expect(sim.deals).toHaveLength(0);
    const email = await send(phone, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(email.reply).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
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
    expect(r.reply).toMatch(REGISTRADA);
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
    expect(r.reply).toMatch(REGISTRADA);
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
    expect(r.reply).toMatch(REGISTRADA);
    expect(sim.persons).toHaveLength(1);
    expect(sim.deals).toHaveLength(1);
    const note = sim.notes[0].content;
    expect(note).not.toContain('[object Object]');
    expect(note).toMatch(/^Resumen bot: .+/m);
    for (const value of Object.values(sim.updates[0].fields)) expect(typeof value).toBe('string');
  });

  it('si Pipedrive rechaza los campos del negocio, la nota se escribe igual', async () => {
    const phone = nextPhone();
    sim.updateDown = true;
    const r = await send(phone, FULL, FULL_CLAUDE);
    expect(r.reply).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
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

  it('conversación cerrada sin correo, luego "ya la envié a ventas@elights.cl": el texto A, sin negocio', async () => {
    const phone = nextPhone();
    await chat(phone, [
      ['Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }],
      ['fría', { tipo_de_luz: 'fría' }],
      ['todavía no sé dónde', {}],
      ['no sé', {}],
    ]);
    const r = await send(phone, 'listo, ya la envié a ventas@elights.cl', {});
    expect(r.reply).toBe(TEXT_A);
    expect(sim.deals).toHaveLength(0);
  });

  it('instalación cerrada sin correo, luego "ok, se la mando a ventas@elights.cl": sin negocio', async () => {
    const phone = nextPhone();
    await chat(phone, [['quiero instalar focos en mi casa', {}], ['mmm', {}], ['mmm', {}], ['mmm', {}]]);
    const r = await send(phone, 'ok, se la mando a ventas@elights.cl', {});
    expect(r.reply).toBe(MSG4_INSTALL_NO_EMAIL);
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
    expect(r.reply).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.persons[0].email).toBe('ana.prueba@example.com');
  });
});

describe('correo tardío con "necesito" o "quiero"', () => {
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
      expect(r.reply).toMatch(REGISTRADA);
      expect(sim.deals).toHaveLength(1);
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
    expect(turns[4].reply).toBe(MSG4_INSTALL);
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
    expect(a.reply).toBe(MSG4);
    expect(b.reply).toBe(MSG4);
    expect(b.reply).not.toMatch(TECNICO);
    expect(sim.deals).toHaveLength(1);
  });

  it('un pedido nuevo que llega mientras se crea el negocio no hereda su resultado', async () => {
    const phone = nextPhone();
    sim.pdDelayMs = 150;
    const first = send(phone, FULL_B2C, FULL_B2C_CLAUDE);
    await pause(30);
    const second = send(phone, 'necesito tambien 5 paneles LED', { producto: 'paneles LED', cantidad: '5' });
    await Promise.all([first, second]);
    sim.pdDelayMs = 0;
    expect(getFlowState(phone).stage).not.toBe('closed');
    expect(getFlowState(phone).deal).toBeUndefined();
    // El pedido nuevo cierra sin correo: texto A, nunca "quedó registrada"; su correo crea el 2.º negocio.
    const rest = await chat(phone, [['fría', {}], ['no sé', {}], ['no sé', {}], ['no sé', {}], ['hola?', {}]]);
    for (const t of rest) expect(t.reply).not.toMatch(REGISTRADA);
    expect(rest[rest.length - 1].reply).toBe(TEXT_A);
    const late = await send(phone, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(late.reply).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(2);
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
    expect(r.reply).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
  });
});
