// Nota previa: webhook real, dos instancias, cortes y Upstash simulado; sin red.
// Datos inventados (@example.com, +56900000xxx).
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRedis, fakeFetch, UPSTASH_URL } from './fakeUpstash.js';

const sim = vi.hoisted(() => ({
  claude: new Map<string, Record<string, unknown>>(),
  notes: [] as Array<{ id: number; content: string; deal_id: number; add_time: string }>,
  outcomes: [] as string[],
  posts: 0,
  claudeDelay: 0,
  dealDelay: 0,
  updates: [] as Array<Record<string, string>>,
  onPost: undefined as undefined | ((content: string) => Promise<void>),
  onPut: undefined as undefined | (() => Promise<void>),
  searches: 0,
  deals: 0,
  notifies: 0,
  hangNotify: false,
  reached: undefined as undefined | (() => void),
  background: [] as Array<Promise<unknown>>,
}));

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => { sim.background.push(p); }) }));
vi.mock('../_lib/whatsapp/claudeAgent.js', () => ({
  askClaude: vi.fn(async (_h: unknown, body: string) => { if (sim.claudeDelay) vi.setSystemTime(Date.now() + sim.claudeDelay); return { parsed: sim.claude.get(body) ?? {}, summary: 'Resumen de prueba.' }; }),
}));
vi.mock('../_lib/pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn(async () => ({ personId: 7001, action: 'found' })) }));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  // La primera vez lo crea; despues, la deduplicacion por quoteReference lo encuentra (skipped_duplicate).
  createDeal: vi.fn(async () => { if (sim.dealDelay) vi.setSystemTime(Date.now() + sim.dealDelay); return sim.deals++ === 0 ? { dealId: 9001, status: 'created' } : { dealId: 9001, status: 'skipped_duplicate' }; }),
  updateDeal: vi.fn(async (_id: number, fields: Record<string, string>) => { await sim.onPut?.(); sim.updates.push(fields); }),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => {
  const pdTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  return {
    pipedrivePost: vi.fn(async (path: string, body: { content: string; deal_id: number }) => {
      if (path !== '/notes') return { success: true, data: { id: 1 } };
      sim.posts++;
      await sim.onPost?.(body.content);
      const outcome = sim.outcomes.shift() ?? 'ok';
      const save = () => sim.notes.push({ id: sim.notes.length + 1, content: body.content, deal_id: body.deal_id, add_time: pdTime(Date.now()) });
      if (outcome === 'ok' || outcome === 'perdida' || outcome === 'colgada') save();
      // 'colgada': Pipedrive la guardo y la instancia muere antes de recibir la respuesta.
      if (outcome === 'colgada' || outcome === 'colgada-sin-guardar') { sim.reached?.(); return new Promise(() => {}); }
      if (outcome === 'ok') return { success: true, data: { id: sim.notes.length } };
      return { success: false, data: null, error: 'Request timeout' };
    }),
    pipedriveGet: vi.fn(async (path: string, query: Record<string, string>) => {
      if (path !== '/notes') return { success: false, data: null, error: 'HTTP 404: Not Found' };
      sim.searches++;
      const all = sim.notes.filter((n) => n.deal_id === Number(query.deal_id)).sort((a, b) => b.add_time.localeCompare(a.add_time) || b.id - a.id);
      const start = Number(query.start);
      const page = all.slice(start, start + Number(query.limit));
      return { success: true, data: page.length ? page : null, additional_data: { pagination: { start, limit: Number(query.limit), more_items_in_collection: all.length > start + page.length } } };
    }),
  };
});
vi.mock('../_lib/whatsapp/notify.js', () => ({
  notifyTeam: vi.fn(async () => {
    sim.notifies++;
    // La instancia muere despues de la nota y antes del guardado de respond().
    if (sim.hangNotify) { sim.reached?.(); return new Promise(() => {}); }
  }),
}));

type Handler = (req: unknown, res: unknown) => Promise<void>;
let n = 0;
let phone = '';
let redis: ReturnType<typeof createFakeRedis>;

async function instance(): Promise<Handler> {
  vi.resetModules();
  return (await import('../whatsapp/webhook.js')).default as unknown as Handler;
}
async function drain() { while (sim.background.length) await sim.background.shift(); }

function send(handler: Handler, body: string, sid: string) {
  const params = { From: 'whatsapp:' + phone, Body: body, ProfileName: 'Perfil Prueba', MessageSid: sid, NumMedia: '0' };
  const req = Object.assign(Readable.from([Buffer.from(new URLSearchParams(params).toString())]), { method: 'POST', headers: {} });
  const res = {
    statusCode: 0, body: '', sentAt: 0,
    setHeader() { return res; },
    status(code: number) { res.statusCode = code; return res; },
    send(xml: string) { res.body = xml; res.sentAt = Date.now(); return res; },
    end() { return res; },
  };
  return { done: handler(req as never, res as never), res };
}
async function post(handler: Handler, body: string, sid: string) {
  const { done, res } = send(handler, body, sid);
  await done;
  expect(res.statusCode).toBe(200);
  await drain();
  return res;
}
/** La instancia atiende el mensaje y muere donde la simulacion se cuelga (no responde a Twilio). */
async function crash(handler: Handler, body: string, sid: string) {
  const reached = new Promise<void>((r) => { sim.reached = r; });
  const { done, res } = send(handler, body, sid);
  await Promise.race([reached, done.then(() => { throw new Error('no se colgo'); })]);
  sim.reached = undefined;
  // Lo que la instancia muerta dejo en segundo plano (si alcanzo) tambien termina o muere: aqui termina.
  await drain();
  return res;
}

async function queued() {
  const { pendingKey } = await import('../_lib/whatsapp/stateStore.js');
  const hash: Record<string, string> = JSON.parse(redis.data.get(pendingKey(phone))?.value ?? '{}');
  return Object.entries(hash).flatMap(([f, v]) => { try { const i = JSON.parse(v); return i && i.id === f ? [i.write] : []; } catch { return []; } });
}
async function savedFlow() {
  const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
  const raw = redis.data.get(conversationKey(phone))?.value;
  return raw ? JSON.parse(raw).flow : undefined;
}
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

const FULL = 'Necesito 12 focos LED luz calida para mi casa en Maipu. Soy Ana Prueba, ana.prueba@example.com';
const FULL_CLAUDE = { producto: 'focos LED', tipo_de_luz: 'calida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipu', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', qualifiesForDeal: true };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T13:00:00Z'));
  sim.claude.clear(); sim.claude.set(FULL, FULL_CLAUDE);
  sim.notes.length = 0; sim.outcomes = []; sim.posts = 0; sim.searches = 0; sim.deals = 0; sim.notifies = 0;
  sim.hangNotify = false; sim.reached = undefined; sim.background = [];
  sim.claudeDelay = 0; sim.dealDelay = 0; sim.updates = []; sim.onPost = undefined; sim.onPut = undefined;
  phone = '+56900000' + String(700 + ++n);
  redis = createFakeRedis();
  vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_email');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-ficticio-solo-pruebas');
  vi.stubGlobal('fetch', fakeFetch(redis));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function hash() {
  const { pendingKey } = await import('../_lib/whatsapp/stateStore.js');
  return JSON.parse(redis.data.get(pendingKey(phone))?.value ?? '{}') as Record<string, string>;
}
async function markers() {
  return Object.fromEntries(Object.entries(await hash()).filter(([k]) => k.startsWith('d:')).map(([k, v]) => [k, JSON.parse(v)]));
}
async function savedTranscript() {
  const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
  return JSON.parse(redis.data.get(conversationKey(phone))!.value).transcript;
}
function fakeTimers() {
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(now);
}
const FIX = 'Corrijo mi correo: el correcto es ana.nueva@example.com';
const SWAP = 'Quiero cambiar mi mail ana.prueba@example.com por ana.nueva@example.com';
const AMB = 'Mis datos: 11.111.111-1; 77.123.456-9';

// Estos casos usan solo la API anterior: tambien se ejecutan contra 8b10510.
describe('A: ventanas del primer envio', () => {
  async function checkPreflight(content: string, id: string) {
    const q = await hash();
    expect(q[id], 'la nota ya debe estar en Upstash al entrar al POST').toBeDefined();
    const item = JSON.parse(q[id]);
    expect(content.endsWith('Ref. WhatsApp: ' + item.write.noteRef)).toBe(true);
    expect(Number(q['t:' + id].split(':')[0])).toBeGreaterThan(Date.now());
  }
  it('A0 registro: la entrada y su reserva existen dentro del primer POST', async () => {
    sim.onPut = async () => expect(await hash()).toHaveProperty('n:r' + (await savedFlow()).firstMessageAt + '.9001');
    sim.onPost = async (content) => checkPreflight(content, 'n:r' + (await savedFlow()).firstMessageAt + '.9001');
    await post(await instance(), FULL, 'SMa0');
    // La compuerta captura errores de su callback: se exige tambien que el POST terminara bien.
    expect(sim.notes).toHaveLength(1);
    expect(sim.updates).toHaveLength(1);
  });
  it('A0 correccion con reserva: la entrada y su reserva preceden al POST', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMa0c');
    later(60_000);
    sim.onPut = async () => expect(await hash()).toHaveProperty('n:mSMa0cb.9001');
    sim.onPost = async (content) => checkPreflight(content, 'n:mSMa0cb.9001');
    await post(hook, FIX, 'SMa0cb');
    expect(sim.notes).toHaveLength(2);
    expect(sim.updates).toHaveLength(2);
  });
  it('A1 R1: corte dentro del POST y reentrega del mismo sid', async () => {
    sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMa1');
    const conv = (await savedFlow()).firstMessageAt;
    later(75_001);
    await post(await instance(), FULL, 'SMa1');
    expect(sim.notes).toHaveLength(1);
    expect(sim.searches).toBe(1);
    expect(await queued()).toEqual([]);
    expect(await markers()).toHaveProperty('d:r' + conv + '.9001');
    expect(await savedFlow()).toMatchObject({ deal: 'registered', dealId: 9001 });
    expect(sim.notes[0].content.match(/Cliente: Necesito 12 focos/g)).toHaveLength(1);
    expect((await savedTranscript()).entries).toEqual([]);
  });
  it('A2 R2: otro sid sin dato nuevo conserva gracias y su respuesta', async () => {
    sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMa2');
    later(75_001);
    await post(await instance(), 'gracias', 'SMa2b');
    expect(sim.notes).toHaveLength(1);
    const transcript = await savedTranscript();
    expect(transcript.entries).toHaveLength(2);
    expect(transcript.entries[0].text).toContain('gracias');
    expect(transcript.entries[1].role).toBe('bot');
  });
  it('A3 R3: corte en notifyTeam despues de confirmar la nota', async () => {
    sim.hangNotify = true;
    await crash(await instance(), FULL, 'SMa3');
    sim.hangNotify = false;
    later(75_001);
    await post(await instance(), FULL, 'SMa3');
    expect(sim.notes).toHaveLength(1);
    expect(sim.searches).toBe(0);
  });
  it('A3b: falla entregada; la reserva persistida obliga a buscar', async () => {
    redis.intercept = (cmd, args) => cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:entregada') ? 'fail' : undefined;
    sim.hangNotify = true;
    await crash(await instance(), FULL, 'SMa3b');
    redis.intercept = undefined;
    sim.hangNotify = false;
    later(75_001);
    await post(await instance(), FULL, 'SMa3b');
    expect(sim.notes).toHaveLength(1);
    expect(sim.searches).toBe(1);
  });
  it('A4 R4: envio incierto y corte en notifyTeam', async () => {
    sim.outcomes = ['perdida']; sim.hangNotify = true;
    await crash(await instance(), FULL, 'SMa4');
    sim.hangNotify = false;
    later(75_001);
    await post(await instance(), FULL, 'SMa4');
    expect(sim.notes).toHaveLength(1);
    expect(sim.searches).toBe(1);
  });
  it('A5 R6: reentrega tras vencer la funcion, despues gracias', async () => {
    sim.claudeDelay = 13_000; sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMa5');
    sim.claudeDelay = 0;
    later(62_001); fakeTimers();
    const first = send(await instance(), FULL, 'SMa5');
    await vi.advanceTimersByTimeAsync(12_600);
    await first.done;
    expect(first.res.body).toContain('quedo registrada');
    await drain();
    await vi.advanceTimersByTimeAsync(10_000);
    const next = send(await instance(), 'gracias', 'SMa5b');
    await vi.advanceTimersByTimeAsync(20_000);
    await next.done; await drain();
    expect(sim.notes).toHaveLength(1);
  });
  it('A6: la reserva anticipada vence antes del sid incluso con createDeal lento', async () => {
    sim.dealDelay = 5_000; sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMa6');
    sim.dealDelay = 0;
    // La reserva de la nota ya vencio con la funcion anterior, antes del MessageSid.
    later(70_001); fakeTimers();
    const hook = await instance();
    const request = send(hook, FULL, 'SMa6');
    await vi.advanceTimersByTimeAsync(0);
    await request.done;
    expect(request.res.statusCode).toBe(200);
    await drain();
    expect(sim.notes).toHaveLength(1);
    expect(sim.searches).toBe(1);
    expect(await queued()).toEqual([]);
  });
  it('A7 C2: reentrega de cambiar X por Y no vuelve a escribir X', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMa7'); later(60_000);
    sim.outcomes = ['colgada'];
    await crash(hook, SWAP, 'SMa7b'); later(75_001);
    const updatesBefore = sim.updates.length;
    await post(await instance(), SWAP, 'SMa7b');
    expect(sim.updates.slice(updatesBefore).every((fields) => fields.cf_email === 'ana.nueva@example.com')).toBe(true);
    expect(sim.notes).toHaveLength(2);
    expect(sim.updates.at(-1)).toMatchObject({ cf_email: 'ana.nueva@example.com' });
  });
  it('A8 T8: reentrega del RUT ambiguo no repite la nota', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMa8'); later(60_000);
    sim.outcomes = ['colgada'];
    await crash(hook, AMB, 'SMa8b'); later(75_001);
    await post(await instance(), AMB, 'SMa8b');
    expect(sim.notes).toHaveLength(2);
    expect(sim.notes.filter((x) => x.content.includes('varios RUT'))).toHaveLength(1);
  });
  it('A9 C3: correccion sin reserva y corte en notifyTeam', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMa9'); later(60_000);
    const { dealWriteKey } = await import('../_lib/whatsapp/stateStore.js');
    redis.data.set(dealWriteKey(phone), { value: 'otra-instancia', expiresAt: Date.now() + 60_000 });
    sim.hangNotify = true;
    await crash(hook, FIX, 'SMa9b');
    sim.hangNotify = false; later(75_001);
    await post(await instance(), FIX, 'SMa9b');
    expect(sim.notes).toHaveLength(2);
  });
  it('A10 T9: corte sin guardar no pierde la correccion', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMa10'); later(60_000);
    sim.outcomes = ['colgada-sin-guardar'];
    await crash(hook, FIX, 'SMa10b'); later(75_001);
    await post(await instance(), 'gracias', 'SMa10c');
    later(31_000);
    await post(await instance(), 'ok', 'SMa10d');
    expect(sim.notes.filter((x) => x.content.includes('ana.nueva@example.com'))).toHaveLength(1);
    expect(sim.searches).toBe(1);
  });
  it('A12 Z1: createDeal tarda 31 s, corte sin guardar, reentrega recupera sin otro mensaje', async () => {
    sim.dealDelay = 31_000; sim.outcomes = ['colgada-sin-guardar'];
    await crash(await instance(), FULL, 'SMz1');
    sim.dealDelay = 0; later(44_001);
    const res = await post(await instance(), FULL, 'SMz1');
    expect(res.body).toContain('quedo registrada');
    expect(sim.notes).toHaveLength(1);
    expect(sim.posts).toBe(2); expect(sim.searches).toBe(1);
    expect(await queued()).toEqual([]);
    later(10 * 60_000);
    await post(await instance(), 'gracias', 'SMz1b');
    expect(sim.notes).toHaveLength(1); expect(sim.posts).toBe(2);
  });
  it('A13 Z2: pedido nuevo completo reentregado conserva una sola nota', async () => {
    const body = 'Otro pedido: necesito 20 paneles LED luz fria para mi casa en Maipu. Soy Ana Prueba, ana.prueba@example.com';
    sim.claude.set(body, { ...FULL_CLAUDE, producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20' });
    const hook = await instance();
    await post(hook, FULL, 'SMz2'); later(60_000);
    sim.outcomes = ['colgada'];
    await crash(hook, body, 'SMz2b'); later(75_001);
    await post(await instance(), body, 'SMz2b'); later(10 * 60_000);
    await post(await instance(), 'gracias', 'SMz2c');
    expect(sim.notes).toHaveLength(2);
    expect(sim.notes.filter((note) => note.content.includes('paneles'))).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });
  it('A14 Z3: guardado previo fallido no cambia la nota logica del sid', async () => {
    redis.intercept = (cmd, args) => cmd === 'EVAL' && (args[0].includes('^{"rev":') || args[0].startsWith('-- whatsapp:estado:aparte')) ? 'fail' : undefined;
    sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMz3');
    redis.intercept = undefined; later(75_001);
    await post(await instance(), FULL, 'SMz3');
    expect(sim.notes).toHaveLength(1); expect(sim.searches).toBe(1);
    expect(await queued()).toEqual([]);
  });
  it('A15 Z4: corte en PUT de cambiar X por Y libera campos antes de la reentrega', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMz4'); later(60_000);
    sim.claudeDelay = 5_000;
    sim.onPut = async () => { sim.reached?.(); await new Promise(() => {}); };
    await crash(hook, SWAP, 'SMz4b');
    sim.onPut = undefined; sim.claudeDelay = 0; later(70_001); fakeTimers();
    const request = send(await instance(), SWAP, 'SMz4b');
    await vi.advanceTimersByTimeAsync(20_000); await request.done; await drain();
    expect(sim.updates.at(-1)).toMatchObject({ cf_email: 'ana.nueva@example.com' });
    expect(sim.notes).toHaveLength(2); expect(await queued()).toEqual([]);
  });
  it.each(['registro', 'campos', 'correccion'])('A16 X1-X3: anticipar falla sin aplicarse, recupera %s en otra instancia', async (kind) => {
    const hook = await instance();
    if (kind === 'correccion') { await post(hook, FULL, 'SMx3'); later(60_000); }
    let failed = false;
    redis.intercept = (cmd, args) => {
      if (!failed && cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:anticipar')) { failed = true; return 'fail'; }
    };
    if (kind === 'campos') sim.onPut = async () => { throw new Error('PUT fallido de prueba'); };
    else sim.outcomes = ['timeout'];
    await post(hook, kind === 'correccion' ? FIX : FULL, 'SMx123');
    redis.intercept = undefined; sim.onPut = undefined; later(31_000);
    await post(await instance(), 'gracias', 'SMx123b'); later(31_000);
    await post(await instance(), 'ok', 'SMx123c');
    expect(sim.notes).toHaveLength(kind === 'correccion' ? 2 : 1);
    expect(sim.updates.at(-1)).toMatchObject({ cf_email: kind === 'correccion' ? 'ana.nueva@example.com' : 'ana.prueba@example.com' });
    expect(await queued()).toEqual([]);
  });
  it('A17 G4 reforzado: la correccion con otro sid no repite la transcripcion del registro', async () => {
    sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMz6'); later(75_001);
    await post(await instance(), 'Mi RUT es 11.111.111-1', 'SMz6b');
    expect(sim.notes).toHaveLength(2); expect(sim.notes[1].content).toContain('11.111.111-1');
    expect(sim.notes.map((note) => note.content).join('\n').match(/Cliente: Necesito 12 focos/g)).toHaveLength(1);
    expect((await savedTranscript()).entries).toEqual([]);
  });
  it('A18 X4: Upstash colgado no agrega latencia por cada lapida acumulada', async () => {
    fakeTimers();
    // Los plazos reales de produccion se simulan con los mismos temporizadores que el webhook.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('Request timeout')), ms);
      return controller.signal;
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Request timeout')), { once: true });
    })));
    const hook = await instance();
    const times: number[] = [];
    for (const [i, body] of [FULL, FIX, 'Mi correo correcto es ana.otra@example.com', 'Mi RUT es 22.222.222-2', 'gracias', 'ok'].entries()) {
      const start = Date.now();
      const request = send(hook, body, 'SMhang' + i);
      await vi.advanceTimersByTimeAsync(60_000); await request.done; await drain();
      times.push(request.res.sentAt - start);
      expect(request.res.statusCode).toBe(200);
      later(60_000);
    }
    expect(sim.notes).toHaveLength(4);
    expect(Math.max(...times.slice(0, 4)) - Math.min(...times.slice(0, 4)), 'latencias en ms: ' + times.join(', ')).toBeLessThanOrEqual(300);
    expect(times[4]).toBeLessThanOrEqual(6_000); expect(times[5]).toBeLessThanOrEqual(6_000);
  });
  it('A11: anticipar se aplica sin respuesta y la instancia muere en POST', async () => {
    let lost = false;
    redis.intercept = (cmd, args) => {
      if (!lost && cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:anticipar')) { lost = true; return 'lose'; }
    };
    sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMa11');
    redis.intercept = undefined; later(75_001);
    await post(await instance(), FULL, 'SMa11');
    expect(sim.notes).toHaveLength(1);
    expect(sim.searches).toBe(1);
  });
});

describe('controles compatibles con main', () => {
  it('G1: Upstash caido, responde y envia sin buscar ni esperar 30 s', async () => {
    redis.down = true;
    const hook = await instance();
    const start = Date.now();
    const res = await post(hook, FULL, 'SMg1');
    expect(res.body).toContain('quedo registrada');
    expect(Date.now() - start).toBeLessThan(30_000);
    await post(hook, 'gracias', 'SMg1b');
    expect(sim.posts).toBe(1); expect(sim.searches).toBe(0);
  });
  it('G2: con diez notas, el registro sigue mandando su nota', async () => {
    const hook = await instance();
    const { enqueuePendingWrite } = await import('../_lib/whatsapp/stateStore.js');
    for (let i = 0; i < 10; i++) await enqueuePendingWrite(phone, { dealId: 9002, note: 'Nota ficticia ' + i });
    // No se pueden entregar las diez para hacer espacio antes del registro.
    sim.outcomes = Array(5).fill('timeout');
    const res = await post(hook, FULL, 'SMg2');
    expect(res.body).toContain('quedo registrada');
    expect(sim.notes.filter((x) => x.deal_id === 9001)).toHaveLength(1);
  });
  it('G4: otro sid con dato nuevo crea su nota de correccion', async () => {
    sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMg4'); later(75_001);
    await post(await instance(), 'Mi RUT es 11.111.111-1', 'SMg4b');
    expect(sim.notes).toHaveLength(2);
    expect(sim.notes[1].content).toContain('11.111.111-1');
  });
  it('G5: marcas d: no afectan la lectura ni las entradas aleatorias', async () => {
    const { pendingKey, enqueuePendingWrite, loadPendingWrites, duePendingWrites } = await import('../_lib/whatsapp/stateStore.js');
    await enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota inventada' });
    const key = pendingKey(phone);
    const q = JSON.parse(redis.data.get(key)!.value);
    q['d:r123.9001'] = JSON.stringify({ at: Date.now(), dealId: 9001, sid: 'SMold', noteIds: [] });
    redis.data.get(key)!.value = JSON.stringify(q);
    expect(await loadPendingWrites(phone)).toHaveLength(1);
    expect(await duePendingWrites(phone, 5)).toHaveLength(1);
  });
  it('R2x: un pedido nuevo explicito vuelve a stage1 sin otra nota', async () => {
    sim.outcomes = ['colgada'];
    await crash(await instance(), FULL, 'SMr2x'); later(75_001);
    await post(await instance(), 'Otro pedido: necesito 3 reflectores', 'SMr2xb');
    expect(sim.notes).toHaveLength(1);
    expect((await savedFlow()).stage).toBe('stage1');
  });
  it('C1: correccion simple con reentrega', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMc1'); later(60_000);
    sim.outcomes = ['colgada'];
    await crash(hook, FIX, 'SMc1b'); later(75_001);
    await post(await instance(), FIX, 'SMc1b');
    expect(sim.notes).toHaveLength(2);
  });
  it('Q1: corte durante reintento de la cola, despues busca de nuevo', async () => {
    sim.outcomes = ['timeout'];
    await post(await instance(), FULL, 'SMq1'); later(30_000);
    sim.outcomes = ['colgada'];
    const reached = new Promise<void>((r) => { sim.reached = r; });
    const request = send(await instance(), 'gracias', 'SMq1b');
    await request.done; await reached;
    sim.reached = undefined; sim.background = [];
    later(75_001);
    await post(await instance(), 'hola', 'SMq1c');
    expect(sim.notes).toHaveLength(1); expect(sim.searches).toBe(2);
    expect(await queued()).toEqual([]);
  });
  it('A0 control sin reserva: la nota esta en la cola antes del POST de handoff', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMg0'); later(60_000);
    const { dealWriteKey } = await import('../_lib/whatsapp/stateStore.js');
    redis.data.set(dealWriteKey(phone), { value: 'otra-instancia', expiresAt: Date.now() + 60_000 });
    await post(hook, FIX, 'SMg0b');
    sim.onPost = async (content) => {
      const writes = await queued();
      expect(writes.some((w: { note?: string }) => w.note === content)).toBe(true);
    };
    later(75_001);
    await post(await instance(), 'gracias', 'SMg0c');
    expect(sim.notes).toHaveLength(2);
  });
});

// Solo rama: funciones nuevas y forma de la marca. Se excluye este bloque del contraste con main.
describe('solo rama: marcas y unidad de stateStore', () => {
  const write = () => ({ dealId: 9001, fields: { cf_email: 'ana.nueva@example.com' }, note: 'Nota ficticia\n\nRef. WhatsApp: wa-0123456789ab', noteRef: 'wa-0123456789ab' });
  const opts = () => ({ key: 'mSMunit.9001', ver: Date.now() * 2000, sid: 'SMunit', noteIds: ['linea1'] });
  it('G3: registro normal deja marca, gracias no repite y la entrega siguiente poda', async () => {
    const hook = await instance();
    await post(hook, FULL, 'SMg3');
    expect(sim.notes).toHaveLength(1); expect(await queued()).toEqual([]);
    const conv = (await savedFlow()).firstMessageAt;
    expect(await markers()).toHaveProperty('d:r' + conv + '.9001');
    await post(hook, 'gracias', 'SMg3b');
    expect(sim.notes).toHaveLength(1);
    const { pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    const q = await hash(); q['d:r1.9001'] = JSON.stringify({ at: Date.now() - 7 * 86400_000 - 1, dealId: 9001 });
    redis.data.get(pendingKey(phone))!.value = JSON.stringify(q);
    await post(hook, FIX, 'SMg3c');
    expect(await markers()).not.toHaveProperty('d:r1.9001');
  });
  it('U1: la segunda anticipacion conserva el original, sid, ids y reserva', async () => {
    const { anticipateWrite } = await import('../_lib/whatsapp/stateStore.js');
    const first = await anticipateWrite(phone, write(), opts());
    const original = await hash();
    later(1_000);
    const second = await anticipateWrite(phone, { ...write(), note: 'Otra nota' }, { ...opts(), sid: 'SMotro', noteIds: ['otra'] });
    expect(first.status).toBe('new');
    expect(second).toMatchObject({ status: 'queued', item: { sid: 'SMunit', noteIds: ['linea1'], write: write() } });
    expect(await hash()).toEqual(original);
  });
  it('U2: entrega completa y entrega de nota con campos pendientes dejan marca', async () => {
    const { anticipateWrite, settlePendingWrite } = await import('../_lib/whatsapp/stateStore.js');
    const first = await anticipateWrite(phone, write(), opts());
    if (!('item' in first)) throw new Error('sin item');
    await settlePendingWrite(phone, first.item.id, undefined);
    expect(await anticipateWrite(phone, write(), opts())).toMatchObject({ status: 'delivered', mark: { dealId: 9001, sid: 'SMunit', noteIds: ['linea1'] } });
    const next = await anticipateWrite(phone, write(), { ...opts(), key: 'mSMnext.9001' });
    if (!('item' in next)) throw new Error('sin item');
    await settlePendingWrite(phone, next.item.id, { dealId: 9001, fields: write().fields });
    expect(await queued()).toEqual([{ dealId: 9001, fields: write().fields }]);
    expect(await anticipateWrite(phone, write(), { ...opts(), key: 'mSMnext.9001' })).toMatchObject({ status: 'delivered' });
  });
  it('U7: registro normal ejecuta entregada una vez aunque la liberacion cargue la cola', async () => {
    let done = 0;
    redis.intercept = (cmd, args) => { if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:entregada')) done++; return undefined; };
    await post(await instance(), FULL, 'SMdone');
    expect(done).toBe(1);
  });
  it('U8: alias de registro devuelve la entrada original y se poda con su marca', async () => {
    const { anticipateWrite, settlePendingWrite, pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    const first = await anticipateWrite(phone, write(), { ...opts(), key: 'r123.9001' });
    const original = await hash();
    expect(await anticipateWrite(phone, { ...write(), note: 'No debe salir' }, { ...opts(), key: 'r456.9001' })).toMatchObject({ status: 'queued', item: { id: 'n:r123.9001', write: write() } });
    expect(await hash()).toEqual(original);
    if (!('item' in first)) throw new Error('sin item');
    await settlePendingWrite(phone, first.item.id, undefined);
    expect(await anticipateWrite(phone, write(), { ...opts(), key: 'r456.9001' })).toMatchObject({ status: 'delivered' });
    expect(await hash()).toHaveProperty('s:SMunit.9001', 'n:r123.9001');
    later(7 * 86400_000 + 1);
    const next = await anticipateWrite(phone, write(), { ...opts(), key: 'r789.9001', sid: 'SMnext' });
    if (!('item' in next)) throw new Error('sin item');
    await settlePendingWrite(phone, next.item.id, undefined);
    expect(await hash()).not.toHaveProperty('s:SMunit.9001');
    expect(await hash()).not.toHaveProperty('d:r123.9001');
    expect(redis.data.get(pendingKey(phone))!.expiresAt).toBe(Date.now() + 30 * 86400_000);
  });
  it.each(['queued', 'delivered'])('U9: respaldo tras SETTLE 0 respeta el rastro remoto %s', async (status) => {
    const a = await import('../_lib/whatsapp/stateStore.js');
    redis.intercept = (cmd, args) => cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:anticipar') ? 'fail' : undefined;
    const first = await a.anticipateWrite(phone, write(), opts());
    if (!('item' in first)) throw new Error('sin item');
    redis.intercept = undefined; vi.resetModules();
    const b = await import('../_lib/whatsapp/stateStore.js');
    const remote = await b.anticipateWrite(phone, { ...write(), note: 'Nota de otra reserva' }, opts());
    if (!('item' in remote)) throw new Error('sin item');
    if (status === 'delivered') await b.settlePendingWrite(phone, remote.item.id, undefined);
    const before = await hash();
    await a.settlePendingWrite(phone, first.item.id, write());
    if (status === 'queued') {
      expect(await hash()).toEqual(before);
      const [item] = await a.loadPendingWrites(phone);
      expect(item.write.note).toBe('Nota de otra reserva');
    } else {
      const [item] = await a.loadPendingWrites(phone);
      expect(item.id).toMatch(/^f:/);
      expect(item.write).toEqual({ dealId: 9001, fields: write().fields });
      expect(await markers()).toHaveProperty('d:mSMunit.9001');
    }
  });
  it('U9b: el respaldo aplicado sin respuesta deja la copia local incierta', async () => {
    const { anticipateWrite, settlePendingWrite, getPendingWrites } = await import('../_lib/whatsapp/stateStore.js');
    let attempts = 0;
    redis.intercept = (cmd, args) => {
      if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:anticipar')) return ++attempts === 1 ? 'fail' : 'lose';
    };
    const first = await anticipateWrite(phone, write(), opts());
    if (!('item' in first)) throw new Error('sin item');
    await settlePendingWrite(phone, first.item.id, write());
    expect(attempts).toBe(2);
    expect(getPendingWrites(phone)[0].noteUnsure).toBe(Date.now());
    expect((await hash())[first.item.id]).toBeDefined();
  });
  it.each(['registro', 'campos'])('U10: la reserva de %s respeta el limite absoluto y conserva el tope anterior', async (kind) => {
    const { claimRegistration, claimDealWrite, registrationKey, dealWriteKey, REGISTRATION_TTL_MS } = await import('../_lib/whatsapp/stateStore.js');
    const take = kind === 'registro' ? claimRegistration : claimDealWrite;
    const key = (kind === 'registro' ? registrationKey : dealWriteKey)(phone);
    const deadline = Date.now() + 65_000;
    later(5_000);
    const claim = await take(phone, deadline);
    expect(claim.claimed).toBe(true);
    expect(redis.data.get(key)!.expiresAt).toBe(deadline);
    expect((await take(phone, deadline)).claimed).toBe(false);
    await claim.release();
    await take(phone, Date.now() + 100_000);
    expect(redis.data.get(key)!.expiresAt).toBe(Date.now() + REGISTRATION_TTL_MS);
  });
  it('U3: cola llena no agrega ni reserva', async () => {
    const { anticipateWrite, enqueuePendingWrite } = await import('../_lib/whatsapp/stateStore.js');
    for (let i = 0; i < 10; i++) await enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota ' + i });
    const before = await hash();
    expect(await anticipateWrite(phone, write(), opts())).toEqual({ status: 'full' });
    expect(await hash()).toEqual(before);
  });
  it('U4: poda estricta a siete dias y renueva el plazo de treinta dias', async () => {
    const { anticipateWrite, settlePendingWrite, pendingKey, CONVERSATION_TTL_S, PENDING_WRITE_TTL_S } = await import('../_lib/whatsapp/stateStore.js');
    const key = pendingKey(phone);
    const old = Date.now() - CONVERSATION_TTL_S * 1000;
    redis.data.set(key, { value: JSON.stringify({ 'd:r1.9001': JSON.stringify({ at: old - 1 }), 'd:r2.9001': JSON.stringify({ at: old }), 'd:ilegible': 'otro formato' }), expiresAt: Date.now() + 1_000 });
    const first = await anticipateWrite(phone, write(), opts());
    if (!('item' in first)) throw new Error('sin item');
    await settlePendingWrite(phone, first.item.id, undefined);
    expect(await hash()).not.toHaveProperty('d:r1.9001');
    expect(await hash()).toHaveProperty('d:r2.9001');
    expect(await hash()).toHaveProperty('d:ilegible');
    expect(redis.data.get(key)!.expiresAt).toBe(Date.now() + PENDING_WRITE_TTL_S * 1000);
  });
  it('U5: una marca remota impide revivir la nota de memoria; conserva sus campos en f:', async () => {
    vi.resetModules();
    const a = await import('../_lib/whatsapp/stateStore.js');
    let lost = false;
    redis.intercept = (cmd, args) => { if (!lost && cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:anticipar')) { lost = true; return 'lose'; } };
    await a.anticipateWrite(phone, write(), { ...opts(), reserve: false });
    redis.intercept = undefined;
    vi.resetModules();
    const b = await import('../_lib/whatsapp/stateStore.js');
    const [item] = await b.loadPendingWrites(phone);
    expect(await b.claimPendingWrite(phone, item.id)).toBe(true);
    await b.settlePendingWrite(phone, item.id, undefined);
    const q = await a.loadPendingWrites(phone);
    expect(q).toHaveLength(1); expect(q[0].id).toMatch(/^f:/);
    expect(q[0].write).toEqual({ dealId: 9001, fields: write().fields });
  });
  it('U6: entrada aleatoria con respuesta perdida revive incierta y busca antes de repetir', async () => {
    vi.resetModules();
    const a = await import('../_lib/whatsapp/stateStore.js');
    let lost = false;
    redis.intercept = (cmd, args) => { if (!lost && cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:agregar')) { lost = true; return 'lose'; } };
    await a.enqueuePendingWrite(phone, write());
    redis.intercept = undefined;
    vi.resetModules();
    const b = await import('../_lib/whatsapp/stateStore.js');
    const { retryWhatsAppWrite } = await import('../_lib/whatsapp/pipedriveLead.js');
    const [item] = await b.loadPendingWrites(phone);
    expect(await b.claimPendingWrite(phone, item.id)).toBe(true);
    await b.settlePendingWrite(phone, item.id, await retryWhatsAppWrite(b.sendablePendingWrite(phone, item)!));
    expect(sim.notes).toHaveLength(1); expect(sim.searches).toBe(0);
    later(31_000);
    const [revived] = await a.loadPendingWrites(phone);
    expect(await a.claimPendingWrite(phone, revived.id)).toBe(true);
    await a.settlePendingWrite(phone, revived.id, await retryWhatsAppWrite(a.sendablePendingWrite(phone, revived)!));
    expect(sim.notes).toHaveLength(1); expect(sim.searches).toBe(1);
  });
  it('U1b: reserva opcional limpia un t: huerfano y limita los ids a sesenta', async () => {
    const { anticipateWrite, pendingKey, pendingLeaseUntil } = await import('../_lib/whatsapp/stateStore.js');
    const key = pendingKey(phone);
    redis.data.set(key, { value: JSON.stringify({ 't:n:mSMunit.9001': '9999999999999:1:vieja' }) });
    const result = await anticipateWrite(phone, write(), { ...opts(), reserve: false, noteIds: Array.from({ length: 70 }, (_, i) => 'linea' + i) });
    expect(result).toMatchObject({ status: 'new' });
    if (!('item' in result)) throw new Error('sin item');
    expect(result.item.noteIds).toHaveLength(60);
    expect(await hash()).not.toHaveProperty('t:' + result.item.id);
    expect(pendingLeaseUntil(phone, result.item.id)).toBe(0);
  });
  it('U2b: soltar usa el token aunque la respuesta de anticipar se perdio', async () => {
    const { anticipateWrite, settlePendingWrite } = await import('../_lib/whatsapp/stateStore.js');
    let lost = false;
    redis.intercept = (cmd, args) => { if (!lost && cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:anticipar')) { lost = true; return 'lose'; } };
    const result = await anticipateWrite(phone, write(), opts());
    expect(result.status).toBe('memory');
    if (!('item' in result)) throw new Error('sin item');
    expect(result.item.write.noteUnsure).toBeUndefined();
    redis.intercept = undefined;
    await settlePendingWrite(phone, result.item.id, { dealId: 9001, fields: write().fields });
    expect(await markers()).toHaveProperty('d:mSMunit.9001');
    expect(await queued()).toEqual([{ dealId: 9001, fields: write().fields }]);
  });
  it('U2c: entregada fallida queda en lapida local y se reintenta con su marca', async () => {
    const { anticipateWrite, settlePendingWrite, loadPendingWrites, retryDeliveredWrite } = await import('../_lib/whatsapp/stateStore.js');
    const result = await anticipateWrite(phone, write(), opts());
    if (!('item' in result)) throw new Error('sin item');
    redis.intercept = (cmd, args) => cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:entregada') ? 'fail' : undefined;
    await settlePendingWrite(phone, result.item.id, undefined);
    expect(await markers()).toEqual({});
    redis.intercept = undefined;
    expect(await loadPendingWrites(phone)).toEqual([]);
    await retryDeliveredWrite(phone);
    expect(await markers()).toHaveProperty('d:mSMunit.9001');
  });
  it('U2e: si soltar fallo sin aplicarse, la entrega posterior de campos tambien deja marca', async () => {
    const { anticipateWrite, settlePendingWrite, loadPendingWrites, claimPendingWrite } = await import('../_lib/whatsapp/stateStore.js');
    const result = await anticipateWrite(phone, write(), opts());
    if (!('item' in result)) throw new Error('sin item');
    redis.intercept = (cmd, args) => cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:soltar') ? 'fail' : undefined;
    await settlePendingWrite(phone, result.item.id, { dealId: 9001, fields: write().fields });
    redis.intercept = undefined;
    const [pending] = await loadPendingWrites(phone);
    expect(pending.write.note).toBeUndefined();
    later(75_001);
    expect(await claimPendingWrite(phone, pending.id)).toBe(true);
    await settlePendingWrite(phone, pending.id, undefined);
    expect(await markers()).toHaveProperty('d:mSMunit.9001');
    expect(await anticipateWrite(phone, write(), opts())).toMatchObject({ status: 'delivered' });
  });
  it('U2d: un token vencido no escribe marca ni reemplaza los campos de otra reserva', async () => {
    const { anticipateWrite, settlePendingWrite, pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    const result = await anticipateWrite(phone, write(), opts());
    if (!('item' in result)) throw new Error('sin item');
    const q = await hash(); q['t:' + result.item.id] = '9999999999999:2:otra';
    redis.data.get(pendingKey(phone))!.value = JSON.stringify(q);
    await settlePendingWrite(phone, result.item.id, { dealId: 9001, fields: write().fields });
    expect(await hash()).toEqual(q);
  });
  it('U3b: el tope total tambien cuenta los campos, pero no las marcas', async () => {
    const { anticipateWrite, enqueuePendingWrite, pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    for (let i = 0; i < 20; i++) await enqueuePendingWrite(phone, { dealId: 9001 + i, fields: { cf_email: 'ana.prueba@example.com' } });
    expect(await anticipateWrite(phone, write(), opts())).toEqual({ status: 'full' });
    const q = await hash(); delete q[Object.keys(q).find((k) => k.startsWith('f:'))!];
    for (let i = 0; i < 30; i++) q['d:r' + i + '.9001'] = JSON.stringify({ at: Date.now(), dealId: 9001 });
    redis.data.get(pendingKey(phone))!.value = JSON.stringify(q);
    expect(await anticipateWrite(phone, write(), opts())).toMatchObject({ status: 'new' });
  });
  it('U4b: un segundo anticipar no cambia el plazo de una entrada o marca existente', async () => {
    const { anticipateWrite, settlePendingWrite, pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    const result = await anticipateWrite(phone, write(), opts());
    if (!('item' in result)) throw new Error('sin item');
    const key = pendingKey(phone);
    const ttl = redis.data.get(key)!.expiresAt;
    later(1_000);
    expect((await anticipateWrite(phone, write(), opts())).status).toBe('queued');
    expect(redis.data.get(key)!.expiresAt).toBe(ttl);
    await settlePendingWrite(phone, result.item.id, undefined);
    const deliveredTtl = redis.data.get(key)!.expiresAt;
    later(1_000);
    expect((await anticipateWrite(phone, write(), opts())).status).toBe('delivered');
    expect(redis.data.get(key)!.expiresAt).toBe(deliveredTtl);
  });
  it.each([false, true])('beforeNote se llama una vez, con negocio conocido, y puede omitir todo (existing=%s)', async (existing) => {
    const { ensureWhatsAppDeal } = await import('../_lib/whatsapp/pipedriveLead.js');
    const beforeNote = vi.fn(async (pending: { dealId: number; note?: string; personId?: number }) => {
      expect(pending).toMatchObject({ dealId: 9001, note: expect.stringContaining('Ref. WhatsApp:') });
      expect(pending.personId).toBe(existing ? undefined : 7001);
      expect(sim.posts).toBe(0); expect(sim.updates).toEqual([]);
      return { dealId: pending.dealId };
    });
    const result = await ensureWhatsAppDeal({ phone, name: 'Ana Prueba', summary: 'Resumen ficticio', body: FULL, captured: { correo: 'ana.prueba@example.com' }, beforeNote, ...(existing ? { existingDealId: 9001 } : {}) });
    expect(beforeNote).toHaveBeenCalledTimes(1);
    expect(result.pendingWrite).toBeUndefined();
    expect(sim.posts).toBe(0); expect(sim.updates).toEqual([]);
  });
  it('beforeNote que rechaza conserva el envio anterior', async () => {
    const { ensureWhatsAppDeal } = await import('../_lib/whatsapp/pipedriveLead.js');
    const beforeNote = vi.fn(async () => { throw new Error('Falla de compuerta ficticia'); });
    await ensureWhatsAppDeal({ phone, name: 'Ana Prueba', summary: 'Resumen ficticio', body: FULL, beforeNote });
    expect(beforeNote).toHaveBeenCalledTimes(1); expect(sim.notes).toHaveLength(1);
  });
  it('claves invalidas no entran al protocolo fijo', async () => {
    const { noteWriteKey } = await import('../_lib/whatsapp/stateStore.js');
    expect(noteWriteKey('r', '123', 9001)).toBe('r123.9001');
    for (const id of ['', 'a.b', 'a'.repeat(65), 'ñ']) expect(noteWriteKey('m', id, 9001)).toBeUndefined();
    for (const id of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(noteWriteKey('m', 'SMvalid', id)).toBeUndefined();
  });
});
