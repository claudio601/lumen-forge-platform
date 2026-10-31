// api/_tests/whatsapp-webhook-transcripcion.test.ts
// Bot de WhatsApp, PR 3 del plan (B1, B5 y la nota), de punta a punta por el webhook real, con el
// mismo arnés que whatsapp-webhook-cierres.test.ts (Claude simulado en el SDK y Pipedrive en sus
// módulos). Solo datos inventados: correos @example.com, teléfonos +56900000xxx y un RUT de prueba.
//
// - La nota trae la sección TRANSCRIPCIÓN: cada mensaje del cliente literal, en orden y con hora de
//   Chile, y las respuestas del bot. Ya no trae "Mensaje original".
// - Una foto y un mensaje vacío quedan registrados.
// - Una conversación de 100 mensajes llega al tope y lo avisa.
// - Un "<b>" del cliente o del perfil queda escapado; el título del negocio no lleva "<" ni ">".
// - La transcripción se vacía con cada nota: la segunda nota trae solo la segunda conversación.
// - Un estado guardado antes de la PR 3 (sin transcripción) avisa que puede faltar el inicio.
// - El resumen va en su sección, sin afirmar una compra que el cliente no atribuye (T5).

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
import { saveFlowState, getFlowState } from '../_lib/whatsapp/flowEngine.js';
import { restoreHistory } from '../_lib/whatsapp/conversation.js';

type Handler = (req: unknown, res: unknown) => Promise<void>;
const webhook = handler as unknown as Handler;

let seq = 0;
const nextPhone = () => '+56900000' + String(700 + ++seq);

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

function replyText(xml: string | undefined): string {
  const m = (xml ?? '').match(/<Message>([\s\S]*)<\/Message>/);
  const text = (m ? m[1] : '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return text.split('\n\n' + PRIVACY_NOTICE)[0];
}

async function send(phone: string, body: string, claude: Record<string, unknown> = {}, extra: Record<string, string> = {}, profile = 'Perfil Prueba') {
  sim.claude.push(JSON.stringify({ wantsHuman: false, qualifiesForDeal: false, summary: 'El cliente pide productos.', ...claude }));
  const res = fakeRes();
  await webhook(fakeReq({ From: 'whatsapp:' + phone, Body: body, ProfileName: profile, MessageSid: 'SMtr' + ++seq, NumMedia: '0', ...extra }), res);
  expect(res.statusCode).toBe(200);
  return replyText(res.body);
}

/** Las líneas de la transcripción de una nota (después del encabezado de la sección). */
function transcriptOf(note: string): string[] {
  const at = note.indexOf('-- TRANSCRIPCIÓN --');
  expect(at).toBeGreaterThan(-1);
  return note.slice(at).split('\n').slice(1);
}
const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const TIME = '\\[\\d{2}-\\d{2}-\\d{4} \\d{2}:\\d{2}\\]';
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red en las pruebas'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Mensajes parecidos a los 18 casos de §10, inventados y sin correo; el correo va al final.
const SPEC_TEXTS = [
  'Necesito panel redondo embutido 15W',
  'Busco paneles 120x60, son 7, regulables',
  'Soy Andrés Prueba, quiero focos para un patio',
  'Ya compré, ¿cuál es la dirección de retiro?',
  'Cotización de modulares de 100W y 50W para cancha',
  'Necesito 400 plafones',
  'Cinta para un árbol del jardín, luz cálida',
  'Programación de control',
  'Los paneles que compré dicen 48W y no 40W, uno falló',
  'Quiero cotizar 25 BESTLED para un pasaje en Talca',
  'Razón social Comercial Prueba Ltda, RUT 77.123.456-9',
  'RUT 77.123.456-8',
  'Necesito 400 plafones',
  '¿Tienen sucursal en Concepción?',
  'Necesito un ejecutivo que me llame',
  'Quiero algo parecido al modelo PRUEBA12345, 10 unidades',
  'Mi correo es ana.prueba@exampel.com',
];

describe('B1: la transcripción en la nota', () => {
  it('cada mensaje del cliente aparece literal, en orden y con hora, junto con las respuestas del bot', async () => {
    const phone = nextPhone();
    const replies: string[] = [];
    for (const text of SPEC_TEXTS) replies.push(await send(phone, text));
    replies.push(await send(phone, 'Hola, mi correo es 123prueba.99@example.com', { correo: '123prueba.99@example.com' }));
    expect(sim.notes.length).toBeGreaterThan(0);
    const note = sim.notes[0].content;
    expect(note).not.toContain('Mensaje original');
    const lines = transcriptOf(note).map(unescape).filter((l) => new RegExp('^' + TIME).test(l));
    const clientLines = lines.filter((l) => / Cliente: /.test(l));
    const sent = [...SPEC_TEXTS, 'Hola, mi correo es 123prueba.99@example.com'];
    // El negocio se registra con el primer correo: la nota trae todo hasta ese mensaje, en orden.
    expect(clientLines.length).toBeGreaterThanOrEqual(SPEC_TEXTS.length);
    clientLines.forEach((line, i) => expect(line).toMatch(new RegExp('^' + TIME + ' Cliente: ' + escapeRe(sent[i]) + '$')));
    // Cada mensaje del cliente va seguido de la respuesta del bot que recibió.
    for (const [i, line] of lines.entries()) {
      if (/ Cliente: /.test(line)) expect(lines[i + 1]).toMatch(new RegExp('^' + TIME + ' Bot: '));
    }
    const botLines = lines.filter((l) => / Bot: /.test(l)).map((l) => l.replace(new RegExp('^' + TIME + ' Bot: '), ''));
    expect(botLines[0]).toBe(replies[0].split('\n')[0]);
  });

  it('la hora es la de Chile', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T17:05:00Z')); // 14:05 en Chile (horario de verano, UTC-3)
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' });
    await send(phone, 'Soy Ana Prueba', { nombre: 'Ana Prueba' });
    await send(phone, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(1);
    expect(transcriptOf(sim.notes[0].content)[0]).toBe('[31-10-2026 14:05] Cliente: Necesito 20 focos LED luz fría para una bodega en Lampa');
  });

  it('una foto y un mensaje vacío quedan registrados', async () => {
    const phone = nextPhone();
    await send(phone, '', {}, { NumMedia: '1', MediaContentType0: 'image/jpeg' });
    await send(phone, '', {}, { NumMedia: '0' });
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(1);
    const lines = transcriptOf(sim.notes[0].content).map(unescape);
    expect(lines[0]).toMatch(new RegExp('^' + TIME + ' Cliente: \\[El cliente envió 1 imagen\\]$'));
    expect(lines[2]).toMatch(new RegExp('^' + TIME + ' Cliente: \\[Mensaje vacío\\]$'));
  });

  it('una foto con texto registra los dos', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED como estos, luz fría, para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' }, { NumMedia: '2', MediaContentType0: 'image/png', MediaContentType1: 'image/jpeg' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    const lines = transcriptOf(sim.notes.at(-1)!.content).map(unescape);
    expect(lines[0]).toMatch(/Cliente: \[El cliente envió 2 imágenes\] Necesito 20 focos LED como estos, luz fría, para una bodega en Lampa$/);
  });

  it('una conversación de 100 mensajes llega al tope y lo avisa', async () => {
    const phone = nextPhone();
    for (let i = 1; i <= 100; i++) await send(phone, 'Mensaje de prueba número ' + i);
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa. Soy Ana Prueba, ana.prueba@example.com',
      { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes.length).toBeGreaterThan(0);
    const note = sim.notes[0].content;
    const lines = transcriptOf(note).filter((l) => new RegExp('^' + TIME).test(l) || /^\[\.\.\. /.test(l));
    expect(lines.join('\n')).toMatch(/\[\.\.\. se omitieron \d+ mensajes por el tope de la nota \.\.\.\]/);
    expect(lines.length).toBeLessThanOrEqual(62);
    expect(lines[0]).toMatch(/Cliente: Mensaje de prueba número 1$/);
    expect(lines.at(-2)).toMatch(/Cliente: Necesito 20 focos LED/);
    expect(note.length).toBeLessThan(80_000);
  });

  it('un mensaje muy largo se corta y lo dice', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa. ' + 'detalle '.repeat(200), { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    const first = transcriptOf(sim.notes[0].content)[0];
    expect(first).toContain('[...cortado]');
    expect(first.length).toBeLessThan(1100);
  });
});

describe('la nota escapa el texto del cliente', () => {
  it('un "<b>" del cliente y del perfil queda escapado, y el título no lleva "<" ni ">"', async () => {
    const phone = nextPhone();
    const profile = 'Ana <b>Prueba</b> & Cía';
    await send(phone, 'Necesito 20 focos LED <b>luz fría</b> & blancos para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' }, {}, profile);
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' }, {}, profile);
    expect(sim.notes).toHaveLength(1);
    const note = sim.notes[0].content;
    expect(note).not.toMatch(/<\/?b>/);
    expect(note).toContain('Necesito 20 focos LED &lt;b&gt;luz fría&lt;/b&gt; &amp; blancos');
    expect(sim.deals[0].title).toBe('WhatsApp Lead — Ana bPrueba/b & Cía');
  });
});

describe('cada nota trae su conversación', () => {
  it('la segunda nota trae solo la segunda conversación', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(1);
    await send(phone, 'gracias');
    await send(phone, 'Necesito 30 paneles LED luz neutra para una oficina en Providencia', { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(2);
    const first = transcriptOf(sim.notes[0].content).join('\n');
    const second = transcriptOf(sim.notes[1].content).join('\n');
    expect(first).toContain('focos LED luz fría para una bodega en Lampa');
    expect(first).not.toContain('paneles LED');
    expect(second).toContain('Necesito 30 paneles LED luz neutra para una oficina en Providencia');
    expect(second).not.toContain('bodega en Lampa');
    expect(second).not.toContain('gracias');
  });

  it('la respuesta que va en la nota no se repite en la nota siguiente', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    const closing = await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    const lines = transcriptOf(sim.notes[0].content).map(unescape).filter((l) => new RegExp('^' + TIME).test(l));
    expect(lines.at(-1)).toMatch(new RegExp('^' + TIME + ' Bot: ' + escapeRe(closing.split('\n')[0])));
    await send(phone, 'Necesito corregir el RUT: 77.123.456-9');
    if (sim.notes.length > 1) {
      const next = transcriptOf(sim.notes[1].content).map(unescape);
      expect(next[0]).toBe('(Desde la nota anterior.)');
      // Solo la respuesta a este mensaje (que repite el cierre), no la del cierre anterior.
      expect(next.filter((l) => / Bot: /.test(l))).toHaveLength(1);
      expect(next[1]).toMatch(/ Cliente: Necesito corregir el RUT/);
    }
  });
});

describe('estado anterior a la PR 3', () => {
  it('sin transcripción guardada y con la conversación avanzada, la nota avisa que puede faltar el inicio', async () => {
    const phone = nextPhone();
    // Una conversación en curso que empezó antes de la PR 3: hay estado e historial, pero no transcripción.
    const state = getFlowState(phone);
    saveFlowState(phone, { ...state, stage: 'stage2', captured: { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20' } });
    restoreHistory(phone, [{ role: 'user', content: 'Necesito 20 focos LED luz fría' }, { role: 'assistant', content: 'Pregunta de prueba' }]);
    await send(phone, 'Para una bodega en Lampa', { proyecto_o_uso: 'bodega' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(1);
    expect(transcriptOf(sim.notes[0].content)[0]).toMatch(/^\(Puede faltar el inicio de la conversación/);
  });
});

describe('B5 en la nota (T5)', () => {
  it('el resumen va en su sección y no afirma una compra que el cliente no atribuye', async () => {
    const phone = nextPhone();
    await send(phone, 'Ya compré, ¿cuál es la dirección de retiro?', { summary: 'Cliente ya compró y quiere retirar.' });
    await send(phone, 'Son 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega', summary: 'Cliente ya compró. El cliente pide 20 focos LED.' });
    const reply = await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', summary: 'Cliente pagó su pedido.' });
    expect(reply).not.toMatch(/Quinta Normal/i);
    expect(sim.notes).toHaveLength(1);
    const note = unescape(sim.notes[0].content);
    expect(note).toContain('-- RESUMEN DEL BOT (interpretación, no dato) --\nVer la transcripción.');
    expect(note).not.toMatch(/Comuna\/ciudad: Retiro/);
  });
});
