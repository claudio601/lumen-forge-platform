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
// - La transcripción se vacía con cada nota: la segunda nota trae solo lo que siguió a la primera,
//   sin perder lo que llegó entre las dos (una foto, un mensaje después del cierre) ni lo de un
//   pedido que empezó mientras Pipedrive guardaba la nota anterior.
// - La primera respuesta lleva el aviso de privacidad: la nota lo marca, sin copiar el texto.
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
import { claimMessage, completeMessage, conversationKey, messageKey } from '../_lib/whatsapp/stateStore.js';
import { getTranscript } from '../_lib/whatsapp/transcript.js';
import { createFakeRedis, fakeFetch, UPSTASH_URL } from './fakeUpstash.js';

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

/** El TwiML tal como sale (con el aviso de privacidad, si lo lleva). */
async function post(phone: string, body: string, claude: Record<string, unknown> = {}, extra: Record<string, string> = {}, profile = 'Perfil Prueba') {
  sim.claude.push(JSON.stringify({ wantsHuman: false, qualifiesForDeal: false, summary: 'El cliente pide productos.', ...claude }));
  const res = fakeRes();
  await webhook(fakeReq({ From: 'whatsapp:' + phone, Body: body, ProfileName: profile, MessageSid: 'SMtr' + ++seq, NumMedia: '0', ...extra }), res);
  expect(res.statusCode).toBe(200);
  return res.body ?? '';
}

async function send(phone: string, body: string, claude: Record<string, unknown> = {}, extra: Record<string, string> = {}, profile = 'Perfil Prueba') {
  return replyText(await post(phone, body, claude, extra, profile));
}

/** Upstash simulado, como en producción (sin él, el estado vive solo en la memoria de la instancia). */
function withUpstash() {
  const redis = createFakeRedis();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-ficticio-solo-pruebas');
  vi.stubGlobal('fetch', fakeFetch(redis));
  return redis;
}

/**
 * Las líneas de la transcripción de una nota (después del encabezado de la sección). La nota termina con su
 * referencia (decisión 10 del dueño), después de una línea vacía: no es parte de la transcripción.
 */
function transcriptOf(note: string): string[] {
  const at = note.indexOf('-- TRANSCRIPCIÓN --');
  expect(at).toBeGreaterThan(-1);
  const ref = note.search(/\n\nRef\. WhatsApp: wa-[0-9a-f]{12}$/);
  expect(ref).toBeGreaterThan(at);
  return note.slice(at, ref).split('\n').slice(1);
}
const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const TIME = '\\[\\d{2}-\\d{2}-\\d{4} \\d{2}:\\d{2}\\]';
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOTE_REPLY = 'Bot (respuesta al crear la nota)';
const MARK = '\n[+ aviso de privacidad]';

/** Los mensajes de la transcripción de una nota: quién y el texto (las líneas siguientes, sin la sangría). */
function entriesOf(note: string): Array<{ who: string; text: string }> {
  const entries: Array<{ who: string; text: string }> = [];
  for (const line of transcriptOf(note).map(unescape)) {
    const m = line.match(new RegExp('^' + TIME + ' (Cliente|Bot|' + escapeRe(NOTE_REPLY) + '): (.*)$'));
    if (m) entries.push({ who: m[1], text: m[2] });
    else if (entries.length) entries[entries.length - 1].text += '\n' + line.replace(/^ {4}/, '');
  }
  return entries;
}
const clientTexts = (note: string) => entriesOf(note).filter((e) => e.who === 'Cliente').map((e) => e.text);
const FIRST = 'Necesito 20 focos LED luz fría para una bodega en Lampa';
const FIRST_CLAUDE = { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' };
const CONTACT = 'Soy Ana Prueba, ana.prueba@example.com';
const CONTACT_CLAUDE = { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
const ORDER_B = 'Necesito 30 paneles LED luz neutra para una oficina en Providencia';
const ORDER_B_CLAUDE = { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' };
// Un pedido completo en un solo mensaje (B2C: no pide RUT).
const FULL_B2C = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
const FULL_B2C_CLAUDE = {
  producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú',
  nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', qualifiesForDeal: true,
};

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

// Mensajes parecidos a los 18 casos de §10, inventados. Dos traen correo: el de T18 (con el dominio
// mal escrito) y el de T1, que va al final.
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
  'Hola, mi correo es 123prueba.99@example.com',
];

describe('B1: la transcripción en la nota', () => {
  it.each([{}, { cantidad: '1000', producto: 'focos', proyecto_o_uso: 'bodega' }])('una URL en una pregunta no llena la cantidad y se guarda literal en la transcripción (Claude %j)', async (claude) => {
    const redis = withUpstash();
    const phone = nextPhone();
    const first = 'Necesito paneles LED luz neutra para una oficina';
    const pedido = { producto: 'paneles LED', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina' };
    expect(await send(phone, first, pedido)).toMatch(/cantidad de unidades/i);
    const question = 'Quiero saber si tienen https://example.com/1.000/focos para bodega';
    const reply = await send(phone, question, claude);
    const saved = JSON.parse(redis.data.get(conversationKey(phone))!.value);
    expect(saved.transcript.entries.filter((e: { role: string }) => e.role === 'cliente').map((e: { text: string }) => e.text)).toEqual([first, question]);
    expect(saved.flow.captured.cantidad).toBeUndefined();
    expect(saved.flow.captured.cantidad_varios).toBeUndefined();
    expect(saved.flow.captured).toMatchObject(pedido);
    expect(saved.flow.captured.cambios).toBeUndefined();
    expect(reply).toMatch(/cantidad de unidades/i);
  });

  it('cada mensaje del cliente llega literal, en orden y con hora, con la respuesta que recibió, y ninguno se pierde', async () => {
    const phone = nextPhone();
    expect(SPEC_TEXTS).toHaveLength(18);
    const replies: string[] = [];
    for (const [i, text] of SPEC_TEXTS.entries()) replies.push(await send(phone, text, i === 17 ? { correo: '123prueba.99@example.com' } : {}));
    // En T5 el cliente pidió que lo atendiera una persona: el correo de T18 (el 17.º mensaje) cierra la
    // solicitud y escribe la nota. El 18.º (otro correo) llega después del cierre registrado: se suma al
    // mismo negocio en una segunda nota, con el correo nuevo y la línea de cambios.
    expect(sim.notes).toHaveLength(2);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes[1].deal_id).toBe(sim.notes[0].deal_id);
    const first = sim.notes[0].content;
    expect(first).not.toContain('Mensaje original');
    expect(transcriptOf(first).map(unescape).filter((l) => / Cliente: /.test(l)).every((l) => new RegExp('^' + TIME + ' Cliente: ').test(l))).toBe(true);
    expect(entriesOf(first)).toEqual(SPEC_TEXTS.slice(0, 17).flatMap((text, i) => [
      { who: 'Cliente', text },
      { who: i === 16 ? NOTE_REPLY : 'Bot', text: replies[i] + (i === 0 ? MARK : '') },
    ]));
    const late = sim.notes[1].content;
    expect(transcriptOf(late)[0]).toBe('(Desde la nota anterior.)');
    expect(entriesOf(late)).toEqual([{ who: 'Cliente', text: SPEC_TEXTS[17] }, { who: NOTE_REPLY, text: replies[17] }]);
    expect(unescape(late)).toContain('123prueba.99@example.com');
    expect(unescape(late)).toMatch(/Correo: antes ana\.prueba@exampel\.com, ahora 123prueba\.99@example\.com/);
    // El pedido siguiente es otro negocio y su nota parte después de la nota del correo.
    const order = 'Necesito 30 paneles LED luz neutra para una oficina en Providencia';
    replies.push(await send(phone, order, { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina' }));
    replies.push(await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' }));
    expect(sim.notes).toHaveLength(3);
    const third = sim.notes[2].content;
    expect(transcriptOf(third)[0]).toBe('(Desde la nota anterior.)');
    expect(entriesOf(third)).toEqual([
      { who: 'Cliente', text: order }, { who: 'Bot', text: replies[18] },
      { who: 'Cliente', text: 'Soy Ana Prueba, ana.prueba@example.com' }, { who: NOTE_REPLY, text: replies[19] },
    ]);
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
    expect(clientTexts(sim.notes[0].content).slice(0, 2)).toEqual(['[El cliente envió 1 imagen]', '[Mensaje vacío]']);
  });

  it('una foto con texto registra los dos', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED como estos, luz fría, para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' }, { NumMedia: '2', MediaContentType0: 'image/png', MediaContentType1: 'image/jpeg' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    const lines = transcriptOf(sim.notes.at(-1)!.content).map(unescape);
    expect(lines[0]).toMatch(/Cliente: \[El cliente envió 2 imágenes\] Necesito 20 focos LED como estos, luz fría, para una bodega en Lampa$/);
  });

  // [VARIOS-IMAGEN] Fase 1 del bot (negocio 130): el webhook le dice al flujo que el texto acompaña una imagen.
  it('dos imágenes con "12 UND" y "5 UND" quedan como dos ítems, no como una corrección', async () => {
    const phone = nextPhone();
    await send(phone, 'NECESITO COTIZACION DE PRODUCTOS');
    await send(phone, '12 UND', { cantidad: '12' }, { NumMedia: '1', MediaContentType0: 'image/jpeg' });
    await send(phone, '5 UND', { cantidad: '5' }, { NumMedia: '1', MediaContentType0: 'image/jpeg' });
    const { captured } = getFlowState(phone);
    expect(captured.cantidad).toBeUndefined();
    expect(captured.cantidad_varios).toContain('12');
    expect(captured.cantidad_varios).toContain('5 UND');
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
  it('la segunda nota trae lo que siguió a la primera, sin la conversación anterior', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(1);
    await send(phone, 'gracias');
    await send(phone, 'Necesito 30 paneles LED luz neutra para una oficina en Providencia', { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(2);
    const first = transcriptOf(sim.notes[0].content).join('\n');
    expect(first).toContain('focos LED luz fría para una bodega en Lampa');
    expect(first).not.toContain('paneles LED');
    expect(transcriptOf(sim.notes[1].content)[0]).toBe('(Desde la nota anterior.)');
    // El "gracias" llegó después de la primera nota: nunca se anotó, así que va en la segunda.
    expect(clientTexts(sim.notes[1].content)).toEqual(['gracias', 'Necesito 30 paneles LED luz neutra para una oficina en Providencia', 'Soy Ana Prueba, ana.prueba@example.com']);
  });

  it('la foto que abre un segundo pedido queda en la nota de ese pedido, con su respuesta', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(1);
    const media = await send(phone, '', {}, { NumMedia: '1', MediaContentType0: 'image/jpeg' });
    sim.claude.length = 0; // la foto no pasa por Claude: su salida simulada no es para el mensaje siguiente
    const order = 'Necesito 30 paneles LED como este, luz neutra, para una oficina en Providencia';
    await send(phone, order, { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(2);
    const second = entriesOf(sim.notes[1].content);
    expect(second.slice(0, 3)).toEqual([
      { who: 'Cliente', text: '[El cliente envió 1 imagen]' }, { who: 'Bot', text: media }, { who: 'Cliente', text: order },
    ]);
    expect(transcriptOf(sim.notes[1].content).join('\n')).not.toContain('bodega en Lampa');
  });

  it('la respuesta que va en la nota no se repite en la nota siguiente', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    const closing = await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(entriesOf(sim.notes[0].content).at(-1)).toEqual({ who: NOTE_REPLY, text: closing });
    const again = await send(phone, 'Necesito corregir el RUT: 77.123.456-9');
    // La corrección del RUT escribe la segunda nota en el mismo negocio.
    expect(sim.notes).toHaveLength(2);
    expect(transcriptOf(sim.notes[1].content)[0]).toBe('(Desde la nota anterior.)');
    // Solo este mensaje y su respuesta (que repite el cierre), no la del cierre anterior.
    expect(entriesOf(sim.notes[1].content)).toEqual([
      { who: 'Cliente', text: 'Necesito corregir el RUT: 77.123.456-9' }, { who: NOTE_REPLY, text: again },
    ]);
  });
});

describe('dos pedidos seguidos con Pipedrive lento', () => {
  it('la nota del pedido A que termina después de que empezó B no borra los mensajes de B', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const phone = nextPhone();
    sim.pdDelayMs = 15_000; // la persona y el negocio de A tardan 30 s en total
    const a = send(phone, FULL_B2C, FULL_B2C_CLAUDE);
    await vi.advanceTimersByTimeAsync(100);
    const order = 'Necesito 30 paneles LED luz neutra para una oficina en Providencia';
    const b = send(phone, order, { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina' });
    await vi.advanceTimersByTimeAsync(10_000); // B deja de esperar a A y responde
    const replyB = await b;
    expect(sim.notes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(30_000); // A termina y escribe su nota
    await a;
    expect(sim.notes).toHaveLength(1);
    expect(sim.notes[0].content).not.toContain('paneles LED');
    sim.pdDelayMs = 0;
    vi.useRealTimers();
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(2);
    const second = entriesOf(sim.notes[1].content);
    expect(second.filter((e) => e.who === 'Cliente').map((e) => e.text)).toEqual([order, 'Soy Ana Prueba, ana.prueba@example.com']);
    expect(second[1].who).toBe('Bot');
    expect(second[1].text.startsWith(replyB)).toBe(true);
  });
});

describe('dos mensajes superpuestos con Upstash, como en producción', () => {
  it('el pedido B que entra al vencer la espera no restaura el estado de antes de A: llega a ventas en su propia nota', async () => {
    withUpstash();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const phone = nextPhone();
    await send(phone, FIRST, FIRST_CLAUDE);
    sim.pdDelayMs = 15_000; // la persona y el negocio de A tardan 30 s en total
    const a = send(phone, CONTACT, CONTACT_CLAUDE);
    await vi.advanceTimersByTimeAsync(100);
    const b = send(phone, ORDER_B, ORDER_B_CLAUDE);
    await vi.advanceTimersByTimeAsync(10_000); // B deja de esperar a A, sin el candado
    await b;
    await vi.advanceTimersByTimeAsync(30_000);
    await a;
    expect(sim.notes).toHaveLength(1);
    expect(clientTexts(sim.notes[0].content)).toEqual([FIRST, CONTACT]);
    sim.pdDelayMs = 0;
    await send(phone, CONTACT, CONTACT_CLAUDE);
    // El pedido B es otro negocio, con su nota: no se tomó como un cambio del pedido A.
    expect(sim.deals).toHaveLength(2);
    expect(sim.notes).toHaveLength(2);
    expect(clientTexts(sim.notes[1].content)).toEqual([ORDER_B, CONTACT]);
    expect(unescape(sim.notes[1].content)).toContain('paneles LED');
  });

  it('si el negocio de A falla, el mensaje de A sigue en la transcripción (también la guardada) para la nota siguiente', async () => {
    const redis = withUpstash();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const phone = nextPhone();
    await send(phone, FIRST, FIRST_CLAUDE);
    sim.pdDelayMs = 15_000;
    sim.dealsDown = true; // el negocio falla después de la demora
    const a = send(phone, CONTACT, CONTACT_CLAUDE);
    await vi.advanceTimersByTimeAsync(100);
    const b = send(phone, '¿los focos traen garantía?');
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all([a, b]);
    expect(sim.notes).toHaveLength(0);
    const clients = (entries: Array<{ role: string; text: string }>) => entries.filter((e) => e.role === 'cliente').map((e) => e.text);
    expect(clients(getTranscript(phone)!.entries)).toEqual([FIRST, CONTACT, '¿los focos traen garantía?']);
    const saved = JSON.parse(redis.data.get(conversationKey(phone))!.value);
    expect(clients(saved.transcript.entries)).toEqual([FIRST, CONTACT, '¿los focos traen garantía?']);
  });
});

describe('R14: MessageSid con Upstash a medias (reservó, pero no guardó la respuesta)', () => {
  const XML = '<Response><Message>hola</Message></Response>';

  it('la instancia que ya respondió repite la respuesta, la vuelve a guardar y no reprocesa al vencer la reserva', async () => {
    const redis = withUpstash();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const sid = 'SMhalf' + ++seq;
    expect(await claimMessage(sid, 0)).toEqual({ proceed: true });
    redis.down = true;
    await completeMessage(sid, XML); // queda solo en la memoria de la instancia
    redis.down = false;
    const retry = claimMessage(sid, 3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await retry).toEqual({ proceed: false, response: XML });
    expect(JSON.parse(redis.data.get(messageKey(sid))!.value)).toEqual({ status: 'done', response: XML });
    vi.setSystemTime(Date.now() + 76_000); // vencida la reserva «en curso» de 75 s
    expect(await claimMessage(sid, 0)).toEqual({ proceed: false, response: XML });
  });

  it('por el webhook: la entrega repetida recibe el mismo XML y el mensaje no se registra dos veces', async () => {
    const redis = withUpstash();
    const upstash = fakeFetch(redis);
    let doneDown = true; // Upstash rechaza solo el SET «done»
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (doneDown && String(init?.body ?? '').includes('\\"status\\":\\"done\\"')) throw new TypeError('fetch failed');
      return upstash(input, init);
    }));
    const phone = nextPhone();
    const sid = 'SMhalfHook' + ++seq;
    const first = await post(phone, 'Hola', {}, { MessageSid: sid });
    doneDown = false;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 76_000);
    expect(await post(phone, 'Hola', {}, { MessageSid: sid })).toBe(first);
    expect(getTranscript(phone)!.entries.map((e) => e.role)).toEqual(['cliente', 'bot']);
  });
});

describe('el aviso de privacidad en la transcripción', () => {
  it('la primera respuesta lo llevó: la nota lo marca, sin copiar el texto del aviso', async () => {
    const phone = nextPhone();
    const first = await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega' });
    const closing = await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(entriesOf(sim.notes[0].content)).toEqual([
      { who: 'Cliente', text: 'Necesito 20 focos LED luz fría para una bodega en Lampa' }, { who: 'Bot', text: first + MARK },
      { who: 'Cliente', text: 'Soy Ana Prueba, ana.prueba@example.com' }, { who: NOTE_REPLY, text: closing },
    ]);
    expect(unescape(sim.notes[0].content)).not.toContain(PRIVACY_NOTICE.split('\n')[0]);
  });

  it('si la primera respuesta es la del cierre, la marca va en la respuesta de la nota', async () => {
    const phone = nextPhone();
    const closing = await send(phone, FULL_B2C, FULL_B2C_CLAUDE);
    expect(sim.notes).toHaveLength(1);
    expect(entriesOf(sim.notes[0].content)).toEqual([{ who: 'Cliente', text: FULL_B2C }, { who: NOTE_REPLY, text: closing + MARK }]);
  });

  it('con dos mensajes superpuestos, la marca en la nota de A coincide con lo que A envió', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const phone = nextPhone();
    sim.pdDelayMs = 15_000;
    const a = post(phone, FULL_B2C, FULL_B2C_CLAUDE); // el primer mensaje del número
    await vi.advanceTimersByTimeAsync(100);
    const b = post(phone, ORDER_B, ORDER_B_CLAUDE);
    await vi.advanceTimersByTimeAsync(10_000); // B deja de esperar a A y responde
    const sentB = await b;
    await vi.advanceTimersByTimeAsync(30_000);
    const sentA = await a;
    expect(sim.notes).toHaveLength(1);
    const noted = entriesOf(sim.notes[0].content).at(-1)!;
    expect(noted.who).toBe(NOTE_REPLY);
    expect(noted.text.endsWith(MARK)).toBe(sentA.includes('Privacidad:'));
    // El aviso salió al menos una vez.
    expect(sentA.includes('Privacidad:') || sentB.includes('Privacidad:')).toBe(true);
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

describe('B1: el dato corregido después del cierre registrado', () => {
  it('el correo corregido llega a ventas en una nota del mismo negocio, con la conversación hasta ese mensaje', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@exampel.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@exampel.com' });
    expect(sim.notes).toHaveLength(1);
    const fix = 'Perdón, me equivoqué: es ana.prueba@example.com';
    const reply = await send(phone, fix, { correo: 'ana.prueba@example.com' });
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(2);
    expect(sim.notes[1].deal_id).toBe(sim.notes[0].deal_id);
    expect(entriesOf(sim.notes[1].content)).toEqual([{ who: 'Cliente', text: fix }, { who: NOTE_REPLY, text: reply }]);
    expect(unescape(sim.notes[1].content)).toMatch(/Correo: antes ana\.prueba@exampel\.com, ahora ana\.prueba@example\.com/);
  });

  it('el mismo correo repetido no escribe otra nota', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    await send(phone, 'Mi correo es ANA.PRUEBA@example.com', { correo: 'ANA.PRUEBA@example.com' });
    expect(sim.notes).toHaveLength(1);
  });

  it('un correo anterior que Claude repite sin que el cliente lo escriba no pisa el corregido', async () => {
    const phone = nextPhone();
    await send(phone, 'Necesito 20 focos LED luz fría para una bodega en Lampa', { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' });
    await send(phone, 'Soy Ana Prueba, ana.prueba@exampel.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@exampel.com' });
    await send(phone, 'Es ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(sim.notes).toHaveLength(2);
    await send(phone, 'Muchas gracias', { correo: 'ana.prueba@exampel.com' });
    expect(sim.notes).toHaveLength(2);
  });
});
