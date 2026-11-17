// api/_tests/whatsapp-webhook-resumen.test.ts
// FASE 3B (dueño, 16-11-2026): el resumen antes del cierre, por el webhook real, con Upstash simulado y una o dos
// instancias; Claude, Pipedrive y el aviso a ventas son dobles (sin red).
// - El turno del resumen registra: una persona, un negocio, la nota (con el resumen como respuesta del bot) y un aviso.
// - El «sí» responde MSG4 sin escribir en Pipedrive; el «sí» que llega mientras se registra, también, con un solo negocio.
// - Pipedrive caído: el texto B en lugar del resumen, que ya no espera respuesta; el «sí» siguiente no dice «quedó
//   registrada».
// - Una corrección o un item más va al mismo negocio (nota con «Cambios:»), sin otro aviso a ventas.
// - El resumen pendiente (summaryAt, summaryShown, lastQuestion.summary) se guarda en Upstash y sigue en otra instancia;
//   dos correcciones a la vez en dos instancias quedan las dos.
// Datos inventados (@example.com, +56900000xxx).

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRedis, fakeFetch, UPSTASH_URL } from './fakeUpstash.js';
import { MSG4, MSG_DEAL_FAILED } from '../_lib/whatsapp/flowEngine.js';

const sim = vi.hoisted(() => ({
  claude: new Map<string, { parsed: Record<string, unknown>; delayMs?: number }>(),
  persons: 0,
  deals: [] as Array<Record<string, unknown>>,
  notes: [] as Array<{ content: string; deal_id: number }>,
  updates: [] as Array<{ dealId: number; fields: Record<string, unknown> }>,
  dealDelayMs: 0,
  dealFail: false,
  notified: 0,
}));

vi.mock('../_lib/whatsapp/claudeAgent.js', () => ({
  askClaude: vi.fn(async (_history: unknown, body: string) => {
    const step = sim.claude.get(body);
    if (step?.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    return { parsed: step?.parsed ?? {}, summary: 'Resumen de prueba.' };
  }),
}));
vi.mock('../_lib/pipedrive/persons.js', () => ({
  findOrCreatePerson: vi.fn(async () => { sim.persons++; return { personId: 7001, action: 'created' }; }),
}));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  createDeal: vi.fn(async (params: Record<string, unknown>) => {
    if (sim.dealDelayMs) await new Promise((resolve) => setTimeout(resolve, sim.dealDelayMs));
    if (sim.dealFail) throw new Error('Pipedrive no responde (prueba)');
    sim.deals.push(params);
    return { dealId: 9000 + sim.deals.length, status: 'created' };
  }),
  updateDeal: vi.fn(async (dealId: number, fields: Record<string, unknown>) => { sim.updates.push({ dealId, fields: { ...fields } }); }),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({
  pipedrivePost: vi.fn(async (_path: string, note: { content: string; deal_id: number }) => {
    sim.notes.push(note);
    return { success: true, data: { id: sim.notes.length } };
  }),
}));
vi.mock('../_lib/whatsapp/notify.js', () => ({ notifyTeam: vi.fn(async () => { sim.notified++; }) }));

type Handler = (req: unknown, res: unknown) => Promise<void>;
let seq = 0;
let phone = '';
let redis: ReturnType<typeof createFakeRedis>;

async function instance(): Promise<Handler> {
  vi.resetModules();
  return (await import('../whatsapp/webhook.js')).default as unknown as Handler;
}

const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** El texto que recibe el cliente (con el aviso de privacidad, si va). */
async function post(handler: Handler, body: string, sid = 'SMres' + ++seq): Promise<string> {
  const params = { From: 'whatsapp:' + phone, Body: body, ProfileName: 'Perfil Prueba', MessageSid: sid, NumMedia: '0' };
  const req = Object.assign(Readable.from([Buffer.from(new URLSearchParams(params).toString())]), { method: 'POST', headers: {} });
  const res = {
    statusCode: 0, body: '',
    setHeader() { return res; },
    status(code: number) { res.statusCode = code; return res; },
    send(xml: string) { res.body = xml; return res; },
    end() { return res; },
  };
  await handler(req as never, res as never);
  expect(res.statusCode).toBe(200);
  return unescape(/<Message>([\s\S]*)<\/Message>/.exec(res.body)?.[1] ?? '');
}

function claude(body: string, parsed: Record<string, unknown>, delayMs?: number) {
  sim.claude.set(body, { parsed, ...(delayMs ? { delayMs } : {}) });
}

async function snapshot() {
  const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
  return JSON.parse(redis.data.get(conversationKey(phone))!.value);
}

const ORDER = 'Necesito 12 focos LED luz cálida para una casa en Maipú';
const ORDER_CLAUDE = { producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' };
const CONTACT = 'Soy Ana Prueba, ana.prueba@example.com';
const CONTACT_CLAUDE = { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
const SUMMARY = 'Te resumo: 12 focos LED, luz cálida, para casa y en Maipú. ¿Está bien?';
const REGISTRADA = /qued[oó] registrad[oa]/i;

/** El pedido y el contacto: el segundo mensaje cierra con el resumen y registra el negocio 9001. */
async function closeWithSummary(hook: Handler): Promise<string> {
  claude(ORDER, ORDER_CLAUDE);
  await post(hook, ORDER);
  claude(CONTACT, CONTACT_CLAUDE);
  return post(hook, CONTACT);
}

beforeEach(() => {
  sim.claude.clear();
  sim.persons = 0;
  sim.deals.length = 0;
  sim.notes.length = 0;
  sim.updates.length = 0;
  sim.dealDelayMs = 0;
  sim.dealFail = false;
  sim.notified = 0;
  phone = '+56900000' + String(500 + ++seq);
  redis = createFakeRedis();
  vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-ficticio-solo-pruebas');
  vi.stubGlobal('fetch', fakeFetch(redis));
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

describe('el turno del resumen registra la solicitud', () => {
  it('sin respuesta del cliente: una persona, un negocio, la nota con el resumen y un aviso a ventas', async () => {
    const hook = await instance();
    expect(await closeWithSummary(hook)).toBe(SUMMARY);
    expect(sim.persons).toBe(1);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
    expect(sim.notes[0].deal_id).toBe(9001);
    expect(unescape(sim.notes[0].content)).toContain(SUMMARY);
    expect(sim.notified).toBe(1);
    // El resumen queda esperando respuesta, guardado en Upstash.
    const { flow } = await snapshot();
    expect(flow).toMatchObject({ stage: 'closed', deal: 'registered', dealId: 9001, summaryShown: 1, lastQuestion: { summary: true } });
    expect(typeof flow.summaryAt).toBe('number');
  });

  it('el «sí» responde MSG4 sin otra persona, negocio, nota ni aviso', async () => {
    const hook = await instance();
    await closeWithSummary(hook);
    const counts = () => ({ persons: sim.persons, deals: sim.deals.length, notes: sim.notes.length, updates: sim.updates.length, notified: sim.notified });
    const before = counts();
    expect(before).toMatchObject({ persons: 1, deals: 1, notes: 1, notified: 1 });
    expect(await post(hook, 'Sí')).toBe(MSG4);
    expect(counts()).toEqual(before);
    expect((await snapshot()).flow.lastQuestion).toBeNull();
  });

  it('el resumen pendiente sigue en otra instancia (estado guardado en Upstash)', async () => {
    await closeWithSummary(await instance());
    const cold = await instance();
    expect(await post(cold, '👍')).toBe(MSG4);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
  });
});

describe('Pipedrive caído en el turno del resumen', () => {
  it('el texto B en lugar del resumen, que ya no espera respuesta; el «sí» siguiente no dice «quedó registrada»', async () => {
    const hook = await instance();
    sim.dealFail = true;
    const closing = await closeWithSummary(hook);
    expect(closing).toBe(MSG_DEAL_FAILED);
    expect(closing).not.toContain('Te resumo');
    const { flow } = await snapshot();
    expect(flow.deal).toBe('failed');
    // [RESUMEN] La respuesta cambió: ya no hay pregunta pendiente (un archivo no recibe «Cuéntanos tu respuesta…»).
    expect(flow.lastQuestion).toBeNull();
    const yes = await post(hook, 'Sí');
    expect(yes).not.toMatch(REGISTRADA);
    expect(yes).toBe(MSG_DEAL_FAILED);
    expect(sim.deals).toHaveLength(0);
    expect(sim.notified).toBe(0);
  });
});

describe('una corrección o un item más va al mismo negocio, sin otro aviso a ventas', () => {
  it('«No, son 30»: el resumen corregido, una nota con «Cambios:» en el negocio 9001, sin negocio nuevo ni aviso', async () => {
    const hook = await instance();
    await closeWithSummary(hook);
    claude('No, son 30', { cantidad: '30' });
    expect(await post(hook, 'No, son 30')).toBe('Te resumo: 30 focos LED, luz cálida, para casa y en Maipú. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(2);
    expect(sim.notes[1].deal_id).toBe(9001);
    expect(unescape(sim.notes[1].content)).toContain('Cambios: Cantidad: antes 12, ahora 30');
    expect(sim.updates.at(-1)!.dealId).toBe(9001);
    expect(sim.notified).toBe(1);
    const { flow } = await snapshot();
    expect(flow).toMatchObject({ dealId: 9001, summaryShown: 2, captured: { cantidad: '30' } });
    // Confirmado, sin escribir otra vez.
    expect(await post(hook, 'ok')).toBe(MSG4);
    expect(sim.notes).toHaveLength(2);
  });

  it('«También necesito 5 paneles LED»: se suma como otro item del mismo negocio', async () => {
    const hook = await instance();
    await closeWithSummary(hook);
    claude('También necesito 5 paneles LED', { producto: 'paneles LED', cantidad: '5' });
    expect(await post(hook, 'También necesito 5 paneles LED')).toBe('Te resumo: 12 focos LED y 5 paneles LED, luz cálida, para casa y en Maipú. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes.map((n) => n.deal_id)).toEqual([9001, 9001]);
    expect(sim.notified).toBe(1);
  });

  it('el mismo item mientras se crea el negocio (Pipedrive tarda, una instancia): va a ese negocio', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hook = await instance();
    claude(ORDER, ORDER_CLAUDE);
    await post(hook, ORDER);
    claude(CONTACT, CONTACT_CLAUDE);
    claude('necesito tambien 5 paneles LED', { producto: 'paneles LED', cantidad: '5' });
    sim.dealDelayMs = 3_000;
    const a = post(hook, CONTACT);
    await vi.advanceTimersByTimeAsync(500);
    const b = post(hook, 'necesito tambien 5 paneles LED');
    await vi.advanceTimersByTimeAsync(40_000);
    const [replyA, replyB] = await Promise.all([a, b]);
    expect(replyA).toBe(SUMMARY);
    expect(replyB).toBe('Te resumo: 12 focos LED y 5 paneles LED, luz cálida, para casa y en Maipú. ¿Está bien?');
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes.map((n) => n.deal_id)).toEqual([9001, 9001]);
    expect(sim.notified).toBe(1);
  });
});

describe('concurrencia', () => {
  it('un «sí» que llega en otra instancia mientras se registra el negocio: MSG4 y un solo negocio', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = await instance();
    const second = await instance();
    claude(ORDER, ORDER_CLAUDE);
    await post(first, ORDER);
    claude(CONTACT, CONTACT_CLAUDE);
    sim.dealDelayMs = 3_000;
    const a = post(first, CONTACT);
    await vi.advanceTimersByTimeAsync(500);
    const b = post(second, 'Sí');
    await vi.advanceTimersByTimeAsync(40_000);
    const [replyA, replyB] = await Promise.all([a, b]);
    expect(replyA).toBe(SUMMARY);
    expect(replyB).toBe(MSG4);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
    expect(sim.notified).toBe(1);
    expect((await snapshot()).flow).toMatchObject({ deal: 'registered', dealId: 9001 });
  });

  it('dos correcciones a la vez en dos instancias: quedan las dos, con el resumen mostrado dos veces y un solo negocio', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = await instance();
    const second = await instance();
    await closeWithSummary(first);
    // A tiene el candado 12 s (Claude lento); B espera 10 s, sigue sin él y lee el estado de antes de A.
    claude('No, son 30', { cantidad: '30' }, 12_000);
    claude('Es en Pudahuel', { comuna_o_ciudad: 'Pudahuel' });
    const a = post(first, 'No, son 30');
    await vi.advanceTimersByTimeAsync(100);
    const b = post(second, 'Es en Pudahuel');
    await vi.advanceTimersByTimeAsync(40_000);
    await Promise.all([a, b]);
    const { flow } = await snapshot();
    expect(flow.captured).toMatchObject({ cantidad: '30', comuna_o_ciudad: 'Pudahuel' });
    expect(flow.captured.cambios).toEqual(expect.arrayContaining(['Cantidad: antes 12, ahora 30', 'Comuna/ciudad: antes Maipú, ahora Pudahuel']));
    expect(flow).toMatchObject({ dealId: 9001, summaryShown: 2 });
    expect(typeof flow.summaryAt).toBe('number');
    expect(sim.deals).toHaveLength(1);
    expect(sim.notified).toBe(1);
  });
});

describe('summaryAt y summaryShown van juntos en la mezcla de dos instancias (FIELD_GROUPS)', () => {
  /** Otra instancia de Vercel: su stateStore y su flowEngine, con su propia memoria. */
  async function freshModules() {
    vi.resetModules();
    const store = await import('../_lib/whatsapp/stateStore.js');
    const flow = await import('../_lib/whatsapp/flowEngine.js');
    return { store, flow };
  }
  type Modules = Awaited<ReturnType<typeof freshModules>>;
  /** El paso del flujo del mensaje `n` que cambia esos datos del flujo (y, si se dan, de lo capturado). */
  function step(m: Modules, n: number, fields: Record<string, unknown>, captured: Record<string, string> = {}) {
    const base = structuredClone(m.flow.getFlowState(phone));
    const current = m.store.beginFlowStep(phone, n, base);
    const now = m.flow.getFlowState(phone);
    m.flow.saveFlowState(phone, { ...now, ...fields, captured: { ...now.captured, ...captured } });
    m.store.settleFlowStep(phone, n, base, current);
  }

  it('A (10) muestra el segundo resumen sin guardar, B (20) vuelve a mostrar el primero y guarda, A (30) cambia la comuna: quedan los dos datos de B', async () => {
    const initial = await freshModules();
    step(initial, 1, { stage: 'closed', summaryShown: 1, summaryAt: 100 }, { producto: 'focos LED', comuna_o_ciudad: 'Maipú' });
    expect(await initial.store.persistConversation(phone)).toBe('saved');
    const a = await freshModules();
    await a.store.loadConversation(phone);
    const b = await freshModules();
    await b.store.loadConversation(phone);
    step(a, 10, { summaryShown: 2, summaryAt: 200 });
    step(b, 20, { summaryShown: 1, summaryAt: 300 });
    expect(await b.store.persistConversation(phone)).toBe('saved');
    step(a, 30, {}, { comuna_o_ciudad: 'Colina' });
    expect(await a.store.persistConversation(phone)).toBe('saved');
    const { flow } = await snapshot();
    // Sin el grupo quedaba summaryShown 2 (de A) con el summaryAt de B: un resumen que nadie mostró así.
    expect({ summaryShown: flow.summaryShown, summaryAt: flow.summaryAt }).toEqual({ summaryShown: 1, summaryAt: 300 });
    expect(flow.captured.comuna_o_ciudad).toBe('Colina');
  });
});

// Revisión de la fase 3B (16-11-2026, F1 del webhook): un comentario después del resumen (lo que puede pasar más
// adelante, lo que se suma sin producto, lo que sigue a un «sí y») no es una corrección: antes escribía la nota y el
// campo de la cantidad en el negocio.
describe('(revisión 16-11) un comentario después del resumen no escribe en Pipedrive', () => {
  it.each<[string, Record<string, unknown>]>([
    ['Dale, tengo 3 obras más', {}],
    ['Sí, y quizás después pida 10 más', { cantidad: '10' }],
    ['Perfecto. Más adelante pediré 10 más', { cantidad: '10' }],
    ['Sí, y a lo mejor 5 más el próximo mes', { cantidad: '5' }],
    ['Sí, y los de la bodega son 10', { cantidad: '10', proyecto_o_uso: 'bodega' }],
    ['Si. Tambien tengo una bodega en Quilicura', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura' }],
    ['Sí, pero también podría ser luz fría', { tipo_de_luz: 'fría' }],
  ])('«%s»: MSG4, sin nota ni cambio de campos en el negocio 9001', async (body, parsed) => {
    vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_QUANTITY', 'campo_cantidad_prueba');
    const hook = await instance();
    expect(await closeWithSummary(hook)).toContain(SUMMARY);
    const notes = sim.notes.length;
    const updates = sim.updates.length;
    claude(body, parsed);
    expect(await post(hook, body)).toBe(MSG4);
    expect(sim.notes).toHaveLength(notes);
    expect(sim.updates).toHaveLength(updates);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notified).toBe(1);
    const { flow } = await snapshot();
    expect(flow.captured).toMatchObject({ cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' });
    expect(flow.captured.cantidad_varios).toBeUndefined();
  });
});
