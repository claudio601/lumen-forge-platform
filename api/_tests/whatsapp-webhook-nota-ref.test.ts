// api/_tests/whatsapp-webhook-nota-ref.test.ts
// Bot de WhatsApp, decisión 10 del dueño: si Pipedrive acepta una nota pero se pierde la respuesta, el
// reintento no crea una segunda nota idéntica. Cada nota lleva una referencia fija en su última línea, que
// viaja con la escritura pendiente en la cola de Upstash; antes de repetir un envío incierto se busca.
// Webhook real, Upstash simulado y compartido (fakeUpstash.ts), Claude y Pipedrive simulados, sin red.
// Solo datos inventados (correos @example.com, teléfonos +56900000xxx).
//
// - La primera nota del negocio: guardada y sin respuesta, el mensaje siguiente la encuentra y no la repite;
//   sin guardar (tiempo límite), la crea una vez; si la búsqueda falla, no la repite en ese mensaje; un
//   rechazo 4xx se reintenta sin búsqueda.
// - Dos instancias con la misma entrada: una sola nota (también si la que la reservó se corta después de
//   mandarla, o si la otra la mandó y la soltó después de que esta leyó la cola).
// - La referencia y la marca siguen en la cola aunque los campos del negocio esperen su reserva.
// - Una pendiente guardada con el formato anterior (sin referencia) se sigue leyendo y se entrega como antes.
// - Segunda revisión (verificador): el plazo de 30 s se cuenta desde el último envío incierto; la búsqueda y
//   el reintento salen en segundo plano (la respuesta no los espera) y, si el mensaje llega dentro del plazo,
//   esperan a que se cumpla; una escritura que revive en la cola (guardado sin respuesta) se busca antes.

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRedis, fakeFetch, UPSTASH_URL } from './fakeUpstash.js';

const sim = vi.hoisted(() => ({
  claude: new Map<string, Record<string, unknown>>(),
  /** Las notas que Pipedrive guardó, con su hora (add_time, UTC). */
  notes: [] as Array<{ id: number; content: string; deal_id: number; add_time: string }>,
  /**
   * Qué pasa con cada envío de nota, en orden (sin más, 'ok'): 'perdida' la guarda y la respuesta no llega
   * (tiempo límite); 'timeout' no la guarda; 'tardia' tampoco responde y la guarda después (sim.late);
   * 'rechazo' responde HTTP 400.
   */
  outcomes: [] as string[],
  posts: 0,
  searches: 0,
  /** Cuánto tarda la búsqueda de notas, y si falla. */
  searchDelayMs: 0,
  searchDown: false,
  /** Pipedrive rechaza los campos del negocio. */
  updateFail: false,
  /** Notas que Pipedrive termina de guardar 20 s después del envío ('tardia', ya cortada la espera de 15 s). */
  late: [] as Array<{ at: number; save: () => void }>,
  /** Guarda las notas tardías cuya hora ya llegó (todas, con `all`). */
  land(all = false) {
    const due = sim.late.filter((l) => all || l.at <= Date.now());
    sim.late = sim.late.filter((l) => !due.includes(l));
    due.forEach((l) => l.save());
  },
  /** Los campos del negocio que Pipedrive recibió. */
  updates: [] as unknown[],
  /** Lo que el webhook deja en segundo plano (waitUntil). */
  background: [] as Array<Promise<unknown>>,
  /** Upstash aplica estos EVAL de la cola pero la respuesta no llega (una vez cada uno). */
  loseReply: [] as string[],
}));

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => { sim.background.push(p); }) }));

vi.mock('../_lib/whatsapp/claudeAgent.js', () => ({
  askClaude: vi.fn(async (_history: unknown, body: string) => ({ parsed: sim.claude.get(body) ?? {}, summary: 'Resumen de prueba.' })),
}));
vi.mock('../_lib/pipedrive/persons.js', () => ({
  findOrCreatePerson: vi.fn(async () => ({ personId: 7001, action: 'found' })),
}));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  createDeal: vi.fn(async () => ({ dealId: 9001, status: 'created' })),
  updateDeal: vi.fn(async (_dealId: number, fields: unknown) => {
    if (sim.updateFail) throw new Error('Pipedrive no responde (prueba)');
    sim.updates.push(fields);
  }),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => {
  const pdTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  return {
    pipedrivePost: vi.fn(async (path: string, body: { content: string; deal_id: number }) => {
      if (path !== '/notes') return { success: true, data: { id: 1 } };
      sim.land();
      sim.posts++;
      const outcome = sim.outcomes.shift() ?? 'ok';
      const save = () => sim.notes.push({ id: sim.notes.length + 1, content: body.content, deal_id: body.deal_id, add_time: pdTime(Date.now()) });
      if (outcome === 'ok' || outcome === 'perdida') save();
      if (outcome === 'tardia') sim.late.push({ at: Date.now() + 20_000, save });
      if (outcome === 'ok') return { success: true, data: { id: sim.notes.length } };
      if (outcome === 'rechazo') return { success: false, data: null, error: 'HTTP 400: Bad Request' };
      return { success: false, data: null, error: 'Request timeout' };
    }),
    pipedriveGet: vi.fn(async (path: string, query: Record<string, string>) => {
      if (path !== '/notes') return { success: false, data: null, error: 'HTTP 404: Not Found' };
      sim.searches++;
      if (sim.searchDelayMs) await new Promise((resolve) => setTimeout(resolve, sim.searchDelayMs));
      sim.land();
      if (sim.searchDown) return { success: false, data: null, error: 'Request timeout' };
      const all = sim.notes.filter((n) => n.deal_id === Number(query.deal_id)).sort((a, b) => b.add_time.localeCompare(a.add_time) || b.id - a.id);
      const page = all.slice(0, Number(query.limit));
      return {
        success: true, data: page.length ? page : null,
        additional_data: { pagination: { start: 0, limit: Number(query.limit), more_items_in_collection: all.length > page.length } },
      };
    }),
  };
});
vi.mock('../_lib/whatsapp/notify.js', () => ({ notifyTeam: vi.fn(async () => {}) }));

type Handler = (req: unknown, res: unknown) => Promise<void>;
let seq = 0;
let phone = '';
let redis: ReturnType<typeof createFakeRedis>;

/** Otra instancia de Vercel: el webhook con sus módulos y su propia memoria. */
async function instance(): Promise<Handler> {
  vi.resetModules();
  return (await import('../whatsapp/webhook.js')).default as unknown as Handler;
}

/** Espera lo que quedó en segundo plano (también lo que eso deja). */
async function drain() {
  while (sim.background.length) await sim.background.shift();
}

/** Un mensaje del cliente; con `wait`, también espera lo que deja en segundo plano. */
async function post(handler: Handler, body: string, wait = true) {
  const params = { From: 'whatsapp:' + phone, Body: body, ProfileName: 'Perfil Prueba', MessageSid: 'SMref' + ++seq, NumMedia: '0' };
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
  if (wait) await drain();
  return res.body;
}

/** [PENDIENTES] Las escrituras de la cola del número en Upstash, de la más antigua a la más nueva. */
async function queued(): Promise<Array<Record<string, unknown> & { dealId: number; note?: string; noteRef?: string; noteUnsure?: number }>> {
  const { pendingKey } = await import('../_lib/whatsapp/stateStore.js');
  const hash: Record<string, string> = JSON.parse(redis.data.get(pendingKey(phone))?.value ?? '{}');
  const items = Object.entries(hash).flatMap(([field, value]) => {
    try {
      const item = JSON.parse(value);
      return item && typeof item === 'object' && item.id === field ? [item] : [];
    } catch { return []; }
  });
  return items.sort((a, b) => a.at - b.at).map((i) => i.write);
}

const FULL = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
const FULL_CLAUDE = {
  producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú',
  nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', qualifiesForDeal: true,
};
const REF_LINE = /\n\nRef\. WhatsApp: (wa-[0-9a-f]{12})$/;
// [NOTA-REF] La búsqueda espera este plazo desde el envío incierto (NOTE_SETTLE_MS en pipedriveLead.ts).
const SETTLE_MS = 30_000;
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** Desde aquí también los temporizadores, con el reloj donde quedó (useFakeTimers no cambia un reloj ya simulado). */
function fakeTimers() {
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(now);
}

/** El pedido completo registra el negocio 9001; su nota queda en la cola según `outcome`. */
async function registered(hook: Handler, outcome: string) {
  sim.outcomes = [outcome];
  sim.claude.set(FULL, FULL_CLAUDE);
  await post(hook, FULL);
  const [pending] = await queued();
  expect(pending).toMatchObject({ dealId: 9001, noteRef: expect.stringMatching(/^wa-[0-9a-f]{12}$/) });
  expect(pending.note!.match(REF_LINE)![1]).toBe(pending.noteRef);
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T13:00:00Z'));
  sim.claude.clear();
  sim.notes.length = 0;
  sim.outcomes = [];
  sim.posts = 0;
  sim.searches = 0;
  sim.searchDelayMs = 0;
  sim.searchDown = false;
  sim.updateFail = false;
  sim.late = [];
  sim.updates = [];
  sim.background = [];
  sim.loseReply = [];
  phone = '+56900000' + String(900 + ++seq);
  redis = createFakeRedis();
  vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_email');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-ficticio-solo-pruebas');
  const upstash = fakeFetch(redis);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const res = await upstash(url as never, init as never);
    // Upstash aplica el EVAL, pero la respuesta se pierde (la instancia no sabe si quedó guardado).
    const lost = sim.loseReply.findIndex((script) => String(init?.body ?? '').includes(script));
    if (lost >= 0) {
      sim.loseReply.splice(lost, 1);
      throw new TypeError('fetch failed');
    }
    return res;
  });
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

describe('la primera nota del negocio', () => {
  it('Pipedrive la guarda y se pierde la respuesta: queda en la cola con su referencia y el mensaje siguiente la encuentra sin repetirla', async () => {
    const hook = await instance();
    const pending = await registered(hook, 'perdida');
    expect(sim.notes.map((n) => n.content)).toEqual([pending.note]);
    expect(pending.noteUnsure).toBe(Date.now());
    later(SETTLE_MS);
    await post(hook, 'gracias');
    expect(sim.searches).toBe(1);
    expect(sim.posts).toBe(1);
    expect(await queued()).toEqual([]);
    // Ni otra instancia ni otro mensaje la vuelven a mandar.
    await post(await instance(), 'gracias de nuevo');
    expect(sim.notes).toHaveLength(1);
  });

  it('tiempo límite sin que Pipedrive la haya guardado: el mensaje siguiente la busca, no está y la crea una vez', async () => {
    const hook = await instance();
    const pending = await registered(hook, 'timeout');
    expect(sim.notes).toHaveLength(0);
    later(SETTLE_MS);
    await post(hook, 'gracias');
    expect(sim.searches).toBe(1);
    expect(sim.notes.map((n) => n.content)).toEqual([pending.note]);
    expect(await queued()).toEqual([]);
    await post(hook, 'gracias de nuevo');
    expect(sim.notes).toHaveLength(1);
  });

  it('si la búsqueda falla, el mensaje siguiente no la repite: sigue en la cola y otro la da por entregada', async () => {
    const hook = await instance();
    const pending = await registered(hook, 'perdida');
    later(SETTLE_MS);
    sim.searchDown = true;
    await post(hook, 'gracias');
    expect(sim.posts).toBe(1);
    expect(await queued()).toEqual([pending]);
    sim.searchDown = false;
    later(1_000);
    await post(await instance(), 'gracias de nuevo');
    expect(sim.searches).toBe(2);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });

  it('un rechazo 4xx no necesita búsqueda: el mensaje siguiente la manda directo', async () => {
    const hook = await instance();
    const pending = await registered(hook, 'rechazo');
    expect(pending.noteUnsure).toBeUndefined();
    await post(hook, 'gracias');
    expect(sim.searches).toBe(0);
    expect(sim.notes.map((n) => n.content)).toEqual([pending.note]);
    expect(await queued()).toEqual([]);
  });
});

describe('dos instancias con la misma entrada', () => {
  it('A la reintenta (búsqueda lenta) y vence el candado; B no la manda a la vez: una sola nota', async () => {
    await registered(await instance(), 'perdida');
    // Desde aquí también los plazos del candado y de la búsqueda, con el reloj donde quedó (useFakeTimers no
    // cambia la configuración de un reloj ya simulado).
    const now = Date.now();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(now + SETTLE_MS);
    const { CONVERSATION_LOCK_TTL_MS } = await import('../_lib/whatsapp/stateStore.js');
    const a = await instance();
    const b = await instance();
    sim.searchDelayMs = 30_000;
    const replyA = post(a, 'gracias');
    await vi.advanceTimersByTimeAsync(CONVERSATION_LOCK_TTL_MS + 1_000);
    const replyB = post(b, 'Hola de nuevo');
    await vi.advanceTimersByTimeAsync(40_000);
    await Promise.all([replyA, replyB]);
    expect(sim.searches).toBe(1);
    expect(sim.posts).toBe(1);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });

  it('la que la reservó la manda y se corta antes de soltarla: al vencer la reserva, la otra la busca y no la repite', async () => {
    const pending = await registered(await instance(), 'rechazo');
    expect(pending.noteUnsure).toBeUndefined();
    // A: la reserva, la manda (Pipedrive la guarda y la respuesta no llega) y se corta sin soltarla.
    await instance();
    const storeA = await import('../_lib/whatsapp/stateStore.js');
    const leadA = await import('../_lib/whatsapp/pipedriveLead.js');
    const [item] = await storeA.duePendingWrites(phone, storeA.MAX_PENDING_RETRIES_PER_TURN);
    expect(await storeA.claimPendingWrite(phone, item.id)).toBe(true);
    sim.outcomes = ['perdida'];
    await leadA.retryWhatsAppWrite(storeA.sendablePendingWrite(phone, item)!);
    expect(sim.notes).toHaveLength(1);
    // B, otra instancia, cuando la reserva de A ya venció.
    later(storeA.PENDING_CLAIM_TTL_MS);
    await post(await instance(), 'gracias');
    expect(sim.searches).toBe(1);
    expect(sim.posts).toBe(2);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });

  it('B la manda y la suelta como incierta después de que A leyó la cola: A la reserva con lo de Upstash y la busca', async () => {
    await registered(await instance(), 'rechazo');
    // A lee la cola (la escritura todavía sin marca de envío incierto).
    await instance();
    const storeA = await import('../_lib/whatsapp/stateStore.js');
    const leadA = await import('../_lib/whatsapp/pipedriveLead.js');
    const [itemA] = await storeA.duePendingWrites(phone, storeA.MAX_PENDING_RETRIES_PER_TURN);
    expect(itemA.write.noteUnsure).toBeUndefined();
    // B, otra instancia: la reserva, la manda (guardada, sin respuesta) y la suelta con la marca.
    await instance();
    const storeB = await import('../_lib/whatsapp/stateStore.js');
    const leadB = await import('../_lib/whatsapp/pipedriveLead.js');
    const [itemB] = await storeB.duePendingWrites(phone, storeB.MAX_PENDING_RETRIES_PER_TURN);
    expect(await storeB.claimPendingWrite(phone, itemB.id)).toBe(true);
    sim.outcomes = ['perdida'];
    const left = await leadB.retryWhatsAppWrite(storeB.sendablePendingWrite(phone, itemB)!);
    expect(left).toMatchObject({ noteUnsure: Date.now(), noteUnsureLast: Date.now() });
    await storeB.settlePendingWrite(phone, itemB.id, left);
    expect((await queued())[0].noteUnsure).toBe(Date.now());
    // A sigue con lo que leyó antes: la reserva le trae la escritura de Upstash, con la marca.
    later(SETTLE_MS);
    expect(await storeA.claimPendingWrite(phone, itemA.id)).toBe(true);
    const write = storeA.sendablePendingWrite(phone, itemA)!;
    expect(write).toMatchObject({ noteUnsure: left!.noteUnsure, noteUnsureLast: left!.noteUnsureLast });
    expect(await leadA.retryWhatsAppWrite(write)).toBeUndefined();
    await storeA.settlePendingWrite(phone, itemA.id, undefined);
    expect(sim.searches).toBe(1);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });
});

describe('la cola conserva la referencia', () => {
  it('con los campos esperando su reserva, sale solo la nota y su referencia y su marca siguen en la cola', async () => {
    sim.updateFail = true;
    const hook = await instance();
    const pending = await registered(hook, 'rechazo');
    expect(pending.fields).toEqual({ cf_email: 'ana.prueba@example.com' });
    // Otra instancia tiene la reserva de los campos del negocio: este mensaje manda solo la nota.
    const { dealWriteKey } = await import('../_lib/whatsapp/stateStore.js');
    redis.data.set(dealWriteKey(phone), { value: 'otra-instancia', expiresAt: Date.now() + 60_000 });
    sim.outcomes = ['perdida'];
    await post(hook, 'gracias');
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([{ ...pending, noteUnsure: Date.now(), noteUnsureLast: Date.now() }]);
    // Se suelta la reserva y Pipedrive vuelve: los campos llegan y la nota no se repite.
    redis.data.delete(dealWriteKey(phone));
    sim.updateFail = false;
    later(SETTLE_MS);
    await post(hook, 'gracias de nuevo');
    expect(sim.searches).toBe(1);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });

  it('una pendiente con el formato anterior (sin referencia), con un intento sin cerrar, se lee y se entrega como antes', async () => {
    const { pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    const at = Date.now() - 3_600_000;
    // Como la dejó la versión anterior: la escritura sin referencia y la reserva de un intento que se cortó.
    const item = { id: 'n:00000000-0000-4000-8000-000000000001', at, ver: at * 2000, write: { dealId: 9001, personId: 7001, note: 'Nota pendiente ficticia' } };
    redis.data.set(pendingKey(phone), {
      value: JSON.stringify({ [item.id]: JSON.stringify(item), ['t:' + item.id]: String(at + 75_000) + ':' + String(at) + ':token-anterior' }),
      ttl: 30 * 86400, expiresAt: Date.now() + 30 * 86400 * 1000,
    });
    await post(await instance(), 'gracias');
    expect(sim.searches).toBe(0);
    expect(sim.notes.map((n) => n.content)).toEqual(['Nota pendiente ficticia']);
    expect(await queued()).toEqual([]);
  });
});

describe('segunda revisión: el plazo de 30 s y el segundo plano', () => {
  it('dos envíos inciertos seguidos: el plazo se cuenta desde el último y la nota que Pipedrive guardó tarde no se repite', async () => {
    const hook = await instance();
    const pending = await registered(hook, 'timeout');
    const first = pending.noteUnsure!;
    // 30 s después: la busca, no está y la manda; ese envío tampoco responde y Pipedrive la guarda 20 s después.
    later(SETTLE_MS);
    sim.outcomes = ['tardia'];
    await post(hook, 'gracias');
    expect(sim.searches).toBe(1);
    expect(sim.posts).toBe(2);
    expect(await queued()).toEqual([{ ...pending, noteUnsure: first, noteUnsureLast: Date.now() }]);
    // 16 s después del segundo envío: todavía no se busca; espera el plazo en segundo plano.
    fakeTimers();
    later(16_000);
    await post(hook, 'otra pregunta', false);
    expect(sim.searches).toBe(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 16_000);
    await drain();
    // Cumplido el plazo desde el segundo envío, la busca y la encuentra (Pipedrive ya la había guardado).
    sim.land(true);
    expect(sim.searches).toBe(2);
    expect(sim.posts).toBe(2);
    expect(sim.notes.map((n) => n.content)).toEqual([pending.note]);
    expect(await queued()).toEqual([]);
  });

  it('tiempo límite sin guardarla y el cliente escribe una sola vez más antes de 30 s: la nota llega igual, en segundo plano', async () => {
    const hook = await instance();
    const pending = await registered(hook, 'timeout');
    fakeTimers();
    later(10_000);
    await post(hook, 'gracias', false);
    // La respuesta no espera el plazo: la nota sigue en la cola, todavía sin buscarla.
    expect(sim.searches).toBe(0);
    expect(await queued()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 10_000);
    await drain();
    expect(sim.searches).toBe(1);
    expect(sim.notes.map((n) => n.content)).toEqual([pending.note]);
    expect(await queued()).toEqual([]);
  });

  it('si el reintento ya no cabe en la función, no espera: la nota queda en la cola para el mensaje siguiente', async () => {
    const { pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    const ref = 'wa-0123456789ab';
    const at = Date.now() - 60_000;
    // Otra instancia la mandó con resultado incierto y su reloj va 1 s adelantado: el plazo vence en 31 s y el
    // reintento (hasta 30 s) ya no cabe en los 60 s de esta función.
    const item = {
      id: 'n:00000000-0000-4000-8000-000000000002', at, ver: at * 2000,
      write: { dealId: 9001, personId: 7001, note: 'Nota ficticia\n\nRef. WhatsApp: ' + ref, noteRef: ref, noteUnsure: at, noteUnsureLast: Date.now() + 1_000 },
    };
    redis.data.set(pendingKey(phone), { value: JSON.stringify({ [item.id]: JSON.stringify(item) }), ttl: 30 * 86400, expiresAt: Date.now() + 30 * 86400 * 1000 });
    // Con temporizadores reales: si esperara los 31 s, esta prueba no terminaría a tiempo.
    await post(await instance(), 'gracias');
    expect(sim.searches).toBe(0);
    expect(sim.posts).toBe(0);
    expect(await queued()).toEqual([item.write]);
    later(SETTLE_MS + 1_000);
    await post(await instance(), 'gracias de nuevo');
    expect(sim.searches).toBe(1);
    expect(sim.notes.map((n) => n.content)).toEqual([item.write.note]);
    expect(await queued()).toEqual([]);
  });

  it('la búsqueda de una nota incierta no demora la respuesta al cliente: sale en segundo plano', async () => {
    const hook = await instance();
    await registered(hook, 'perdida');
    fakeTimers();
    later(SETTLE_MS);
    sim.searchDelayMs = 12_000;
    let answered = false;
    const reply = post(hook, 'gracias', false).then(() => { answered = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(answered).toBe(true);
    expect(sim.searches).toBe(1);
    await vi.advanceTimersByTimeAsync(sim.searchDelayMs);
    await reply;
    await drain();
    expect(sim.posts).toBe(1);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });

  it('con campos y una nota incierta: los campos salen antes de responder y la nota, buscada, en segundo plano', async () => {
    sim.updateFail = true;
    const hook = await instance();
    const pending = await registered(hook, 'perdida');
    expect(pending.fields).toEqual({ cf_email: 'ana.prueba@example.com' });
    sim.updateFail = false;
    fakeTimers();
    later(SETTLE_MS);
    sim.searchDelayMs = 12_000;
    let answered = false;
    const reply = post(hook, 'gracias', false).then(() => { answered = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(answered).toBe(true);
    expect(sim.updates).toEqual([pending.fields]);
    // Mientras se busca la nota, la cola la conserva con su referencia y sus marcas, ya sin los campos.
    expect(await queued()).toEqual([{ dealId: 9001, personId: 7001, ...notePartOf(pending) }]);
    await vi.advanceTimersByTimeAsync(sim.searchDelayMs);
    await reply;
    await drain();
    expect(sim.searches).toBe(1);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });
});

/** La nota de una escritura de la cola, con su referencia y sus marcas. */
function notePartOf(write: Awaited<ReturnType<typeof queued>>[number]) {
  const { note, noteRef, noteUnsure, noteUnsureLast } = write;
  return { note, noteRef, noteUnsure, noteUnsureLast };
}

describe('segunda revisión: una escritura que revive en la cola', () => {
  it('Upstash guardó la nota sin responder y otra instancia la entregó: esta la vuelve a guardar, la busca y no la repite', async () => {
    const a = await instance();
    sim.loseReply = ['whatsapp:cola:agregar'];
    const pending = await registered(a, 'rechazo');
    expect(pending.noteUnsure).toBeUndefined();
    // B, otra instancia: la entrega (sin envío incierto, sin búsqueda) y la borra de la cola.
    const b = await instance();
    later(5_000);
    await post(b, 'gracias');
    expect(sim.searches).toBe(0);
    expect(sim.notes.map((n) => n.content)).toEqual([pending.note]);
    expect(await queued()).toEqual([]);
    // A no supo que quedó guardada: la vuelve a guardar, como incierta, y la busca antes de repetirla.
    later(SETTLE_MS);
    await post(a, 'otra pregunta');
    expect(sim.searches).toBe(1);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });

  it('al soltarla, Upstash guardó lo que faltaba sin responder y otra instancia la entregó: tampoco se repite', async () => {
    sim.updateFail = true;
    const a = await instance();
    const pending = await registered(a, 'rechazo');
    // A la reintenta: los campos llegan y la nota se rechaza; Upstash guarda la nota sola, pero no responde.
    sim.updateFail = false;
    sim.outcomes = ['rechazo'];
    sim.loseReply = ['whatsapp:cola:soltar'];
    later(1_000);
    await post(a, 'gracias');
    expect(sim.updates).toEqual([pending.fields]);
    expect(await queued()).toEqual([{ dealId: 9001, personId: 7001, note: pending.note, noteRef: pending.noteRef }]);
    // B la entrega y la borra.
    later(1_000);
    await post(await instance(), 'gracias de nuevo');
    expect(sim.notes.map((n) => n.content)).toEqual([pending.note]);
    expect(await queued()).toEqual([]);
    // A la vuelve a guardar, como incierta, y la busca antes de repetirla.
    later(SETTLE_MS);
    await post(a, 'otra pregunta');
    expect(sim.searches).toBe(1);
    expect(sim.notes).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });
});
