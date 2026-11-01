// api/_tests/whatsapp-webhook-concurrencia.test.ts
// Bot de WhatsApp, PR 3 (ronda 3 de Codex): dos mensajes del mismo número a la vez. Webhook real, Upstash
// simulado y compartido, Claude y Pipedrive simulados, sin red. Solo datos inventados (correos
// @example.com, teléfonos +56900000xxx).
//
// - H3: dos instancias de Vercel de verdad (dos importaciones del módulo con vi.resetModules) y un Redis
//   compartido. El mensaje de B, que entra sin el candado, no se pierde cuando A termina después.
// - H4: en una instancia, A (Claude lento) y B (que agotó la espera y terminó primero): A no pisa el correo
//   que dio B, el historial queda en orden de llegada y cada nota lleva su propio mensaje.
// - H11: sin Upstash configurado, la entrega repetida de un MessageSid se registra una sola vez.
// - H12: textos acotados en el historial (también al restaurar) y un tope de bytes del estado guardado.
// - Verificador (ronda 3): el guardado temprano no hace que otro mensaje registre de nuevo el negocio que
//   A está registrando; las listas de solo agregar (cambios) conservan la línea de cada mensaje; los datos
//   capturados enormes no pasan el tope ni le quitan espacio a la transcripción.
// - Ronda 3 de Codex, la cola de pendientes: R3 (la migración del estado anterior no se acredita antes de
//   guardar la escritura y respeta MAX_STATE_BYTES), R5 (el tope y el plazo de 30 días van en una sola
//   operación, también con 20 instancias a la vez) y R6 (cinco que siempre fallan no frenan a una posterior;
//   una pendiente reservada no la manda otra instancia cuando vence el candado de 25 s).
// - Verificador de R4 y R10 (ronda 3): una corrección no frena el registro de un pedido nuevo; la corrección
//   que llega durante el registro llega al negocio; la que llega antes que un pedido nuevo va al negocio
//   anterior; el número de campos confirmados no se pierde si falla su EVAL; y la respuesta de una corrección
//   (y la del mensaje que tiene la reserva) no pasa los 15 s de Twilio.

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRedis, fakeFetch, UPSTASH_URL } from './fakeUpstash.js';
import { MSG_DEAL_PENDING } from '../_lib/whatsapp/flowEngine.js';

const sim = vi.hoisted(() => ({
  /** Lo que devuelve Claude según el texto del mensaje, y cuánto tarda. */
  claude: new Map<string, { parsed: Record<string, unknown>; delayMs?: number }>(),
  notes: [] as Array<{ content: string; deal_id: number }>,
  deals: [] as Array<Record<string, unknown>>,
  /** Cuánto tarda Pipedrive en guardar cada nota. */
  noteDelayMs: 0,
  /** Cuánto tarda Pipedrive en crear el negocio, y si falla. */
  dealDelayMs: 0,
  dealFail: false,
  /** Avisos a ventas (notifyTeam). */
  notified: 0,
  /** Notas que Pipedrive rechaza (success: false), por ejemplo las de un negocio eliminado. */
  rejectNote: undefined as undefined | ((note: { content: string; deal_id: number }) => boolean),
  /** [REGISTRO] Campos que Pipedrive aplicó (updateDeal), en el orden en que terminaron. */
  updates: [] as Array<{ dealId: number; fields: Record<string, string> }>,
  /** Cuánto tarda cada actualización de campos, y cuáles fallan. */
  updateDelayMs: undefined as undefined | ((fields: Record<string, string>) => number),
  updateFail: undefined as undefined | ((fields: Record<string, string>) => boolean),
  /** Cada solicitud después de la primera es un negocio nuevo (9002, 9003...), sin juntarse con el abierto. */
  distinct: false,
}));

vi.mock('../_lib/whatsapp/claudeAgent.js', () => ({
  askClaude: vi.fn(async (_history: unknown, body: string) => {
    const step = sim.claude.get(body);
    if (step?.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    return { parsed: step?.parsed ?? {}, summary: 'Resumen de prueba.' };
  }),
}));
vi.mock('../_lib/pipedrive/persons.js', () => ({
  findOrCreatePerson: vi.fn(async () => ({ personId: 7001, action: 'found' })),
}));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  createDeal: vi.fn(async (params: Record<string, unknown>) => {
    if (sim.dealDelayMs) await new Promise((resolve) => setTimeout(resolve, sim.dealDelayMs));
    if (sim.dealFail) throw new Error('Pipedrive no responde (prueba)');
    sim.deals.push(params);
    if (sim.distinct && sim.deals.length > 1) return { dealId: 9000 + sim.deals.length, status: 'created' };
    return sim.deals.length === 1 ? { dealId: 9001, status: 'created' } : { dealId: 9001, status: 'updated' };
  }),
  updateDeal: vi.fn(async (dealId: number, fields: Record<string, string>) => {
    const delay = sim.updateDelayMs?.(fields) ?? 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (sim.updateFail?.(fields)) throw new Error('Pipedrive no responde (prueba)');
    sim.updates.push({ dealId, fields: { ...fields } });
  }),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({
  pipedrivePost: vi.fn(async (_path: string, note: { content: string; deal_id: number }) => {
    if (sim.noteDelayMs) await new Promise((resolve) => setTimeout(resolve, sim.noteDelayMs));
    if (sim.rejectNote?.(note)) return { success: false, data: null };
    sim.notes.push(note);
    return { success: true, data: { id: sim.notes.length } };
  }),
}));
vi.mock('../_lib/whatsapp/notify.js', () => ({ notifyTeam: vi.fn(async () => { sim.notified++; }) }));

type Handler = (req: unknown, res: unknown) => Promise<void>;
let seq = 0;
let phone = '';

async function instance(): Promise<Handler> {
  vi.resetModules();
  return (await import('../whatsapp/webhook.js')).default as unknown as Handler;
}

async function post(handler: Handler, body: string, sid = 'SMconc' + ++seq) {
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
  return res.body;
}

function claude(body: string, parsed: Record<string, unknown>, delayMs?: number) {
  sim.claude.set(body, { parsed, ...(delayMs ? { delayMs } : {}) });
}

const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** Los mensajes del cliente en la transcripción de una nota. */
function clientTexts(note: string): string[] {
  const at = note.indexOf('-- TRANSCRIPCI');
  return unescape(note.slice(at)).split('\n').map((l) => /^\[[^\]]+\] Cliente: (.*)$/.exec(l)?.[1]).filter((t): t is string => t !== undefined);
}

let redis: ReturnType<typeof createFakeRedis>;
async function snapshot() {
  const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
  return JSON.parse(redis.data.get(conversationKey(phone))!.value);
}

/** [PENDIENTES] Las escrituras de la cola del número en Upstash (sin las marcas de intento ni de migración), de la más antigua a la más nueva. */
async function queued(): Promise<Array<{ dealId: number; note?: string; fields?: Record<string, string> }>> {
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

const ORDER = 'Necesito 12 focos LED luz cálida para una casa en Maipú';
const ORDER_CLAUDE = { producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' };
const CONTACT = 'Soy Ana Prueba, ana.prueba@example.com';
const CONTACT_CLAUDE = { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };

beforeEach(() => {
  sim.claude.clear();
  sim.notes.length = 0;
  sim.deals.length = 0;
  sim.noteDelayMs = 0;
  sim.dealDelayMs = 0;
  sim.dealFail = false;
  sim.notified = 0;
  sim.rejectNote = undefined;
  sim.updates.length = 0;
  sim.updateDelayMs = undefined;
  sim.updateFail = undefined;
  sim.distinct = false;
  phone = '+56900000' + String(300 + ++seq);
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

describe('H3: dos instancias con el mismo número', () => {
  it('B entra sin el candado y corrige la comuna; A termina después: Colina queda y el mensaje de B sigue en la transcripción', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = await instance();
    const second = await instance();
    claude(ORDER, ORDER_CLAUDE);
    await post(first, ORDER);
    expect((await snapshot()).flow.captured.comuna_o_ciudad).toBe('Maipú');
    // A: el contacto que cierra la solicitud; Claude tarda 12 s y A tiene el candado todo ese tiempo.
    claude(CONTACT, CONTACT_CLAUDE, 12_000);
    const a = post(first, CONTACT);
    await vi.advanceTimersByTimeAsync(100);
    // B, en la otra instancia: espera el candado 10 s, sigue sin él y lee el estado de antes de A.
    const FIX = 'La comuna es Colina';
    claude(FIX, { comuna_o_ciudad: 'Colina' });
    const b = post(second, FIX);
    await vi.advanceTimersByTimeAsync(10_000);
    await b;
    expect((await snapshot()).flow.captured.comuna_o_ciudad).toBe('Colina');
    expect(sim.notes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await a;
    // A registró el negocio con su nota (con su mensaje; el de B llegó después).
    expect(sim.notes).toHaveLength(1);
    expect(clientTexts(sim.notes[0].content)).toEqual([ORDER, CONTACT]);
    const after = await snapshot();
    expect(after.flow.dealId).toBe(9001);
    expect(after.flow.captured.comuna_o_ciudad).toBe('Colina');
    expect(after.flow.captured.correo).toBe('ana.prueba@example.com');
    // El mensaje de B y su respuesta no se perdieron: quedan para la nota siguiente.
    const entries = after.transcript.entries as Array<{ role: string; text: string }>;
    expect(entries.filter((e) => e.role === 'cliente').map((e) => e.text)).toEqual([FIX]);
    expect(entries.map((e) => e.role)).toEqual(['cliente', 'bot']);
    // Y el historial tiene los tres mensajes, en orden de llegada.
    expect(after.history.filter((t: { role: string }) => t.role === 'user').map((t: { content: string }) => t.content)).toEqual([ORDER, CONTACT, FIX]);
  });

  it('el guardado de una instancia no pisa el de la otra: la escritura usa la revisión leída', async () => {
    const first = await instance();
    claude(ORDER, ORDER_CLAUDE);
    await post(first, ORDER);
    const saved = await snapshot();
    expect(Object.keys(saved)[0]).toBe('rev');
    const rev = saved.rev;
    const { conversationKey, SAVE_IF_REV_SCRIPT } = await import('../_lib/whatsapp/stateStore.js');
    const fetcher = fakeFetch(redis);
    const call = async (...args: Array<string | number>) => ((await (await fetcher(UPSTASH_URL, { method: 'POST', body: JSON.stringify(args) })).json()) as { result: unknown }).result;
    // Con una revisión vieja no escribe; con la actual, sí.
    expect(await call('EVAL', SAVE_IF_REV_SCRIPT, '1', conversationKey(phone), rev - 1, '{"rev":99,"x":1}', 60)).toBe(0);
    expect((await snapshot()).rev).toBe(rev);
    expect(await call('EVAL', SAVE_IF_REV_SCRIPT, '1', conversationKey(phone), rev, JSON.stringify({ ...saved, rev: rev + 1 }), 60)).toBe(1);
    expect((await snapshot()).rev).toBe(rev + 1);
  });
});

describe('H4: en una instancia, el mensaje anterior termina después', () => {
  it('A (Claude lento) no pisa el correo de B; el historial queda en orden de llegada y cada nota lleva su mensaje', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hook = await instance();
    const FULL = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
    claude(FULL, { ...ORDER_CLAUDE, ...CONTACT_CLAUDE, qualifiesForDeal: true });
    await post(hook, FULL);
    expect(sim.notes).toHaveLength(1);
    const A = 'Es ana.a@example.com';
    const B = 'Es ana.b@example.com';
    claude(A, { correo: 'ana.a@example.com' }, 12_000);
    claude(B, { correo: 'ana.b@example.com' });
    const a = post(hook, A);
    await vi.advanceTimersByTimeAsync(100);
    const b = post(hook, B);
    // B deja de esperar a A a los 10 s y pasa primero por el flujo. [REGISTRO] R4 (ronda 3): antes B también
    // escribía primero en Pipedrive y la prueba lo exigía (dos notas al terminar B); ahora su corrección espera
    // la reserva que tomó A y escribe en el negocio después de A, así Pipedrive termina con el correo de B.
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all([a, b]);
    const { getFlowState } = await import('../_lib/whatsapp/flowEngine.js');
    const { getHistory } = await import('../_lib/whatsapp/conversation.js');
    // El correo final es el de B, el mensaje que llegó después.
    expect(getFlowState(phone).captured.correo).toBe('ana.b@example.com');
    expect((await snapshot()).flow.captured.correo).toBe('ana.b@example.com');
    // Historial en orden de llegada: A antes que B, cada uno seguido de su respuesta.
    const history = getHistory(phone);
    expect(history.filter((t) => t.role === 'user').map((t) => t.content)).toEqual([FULL, A, B]);
    expect(history.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    // Cada nota lleva su propio mensaje: la de A no se lleva el de B, ni la de B el de A.
    expect(sim.notes).toHaveLength(3);
    expect(sim.notes.every((n) => n.deal_id === 9001)).toBe(true);
    expect(clientTexts(sim.notes[1].content)).toEqual([A]);
    expect(clientTexts(sim.notes[2].content)).toEqual([B]);
    // La nota de A no vuelve a poner el correo de A como el vigente.
    expect(unescape(sim.notes[1].content)).not.toMatch(/Correo: ana\.a@example\.com/);
  });
});

describe('H11: MessageSid repetido sin Upstash configurado', () => {
  it('dos entregas de "Hola" con el mismo SID registran un solo mensaje y responden lo mismo', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red en las pruebas'); }));
    const hook = await instance();
    const first = await post(hook, 'Hola', 'SMsinConfig');
    expect(await post(hook, 'Hola', 'SMsinConfig')).toBe(first);
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    expect(askClaude).toHaveBeenCalledTimes(1);
    const { getTranscript } = await import('../_lib/whatsapp/transcript.js');
    expect(getTranscript(phone)!.entries.map((e) => e.role)).toEqual(['cliente', 'bot']);
    const { getHistory } = await import('../_lib/whatsapp/conversation.js');
    expect(getHistory(phone).filter((t) => t.role === 'user')).toHaveLength(1);
    // Otro SID sí se atiende.
    await post(hook, 'Hola de nuevo', 'SMsinConfig2');
    expect(askClaude).toHaveBeenCalledTimes(2);
  });
});

describe('H12: tope de los textos y del estado guardado', () => {
  it('mensajes enormes: cada texto queda acotado y el estado guardado bajo MAX_STATE_BYTES', async () => {
    const hook = await instance();
    const { MAX_STATE_BYTES, conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    const { MAX_TURN_TEXT } = await import('../_lib/whatsapp/conversation.js');
    expect(MAX_STATE_BYTES).toBe(256 * 1024);
    expect(MAX_TURN_TEXT).toBe(4096);
    // El caso de Codex: "Hola " y 200.000 letras, y luego mensajes cada vez más largos (con letras de varios bytes).
    await post(hook, 'Hola ' + 'a'.repeat(200_000));
    for (let i = 1; i <= 8; i++) await post(hook, 'Consulta ' + i + ' ' + 'ñ€'.repeat(20_000 * i));
    const raw = redis.data.get(conversationKey(phone))!.value;
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(MAX_STATE_BYTES);
    const saved = JSON.parse(raw);
    for (const t of saved.history) expect(t.content.length).toBeLessThanOrEqual(MAX_TURN_TEXT + ' [...cortado]'.length);
    const { getHistory } = await import('../_lib/whatsapp/conversation.js');
    for (const t of getHistory(phone)) expect(t.content.length).toBeLessThanOrEqual(MAX_TURN_TEXT + ' [...cortado]'.length);
    expect(saved.history.at(-2).content.startsWith('Consulta 8 ')).toBe(true);
  });

  it('un estado guardado con un texto enorme (versión anterior) se acota al restaurarlo', async () => {
    const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    const hook = await instance();
    await post(hook, 'Hola');
    const saved = await snapshot();
    saved.history[0].content = 'Hola ' + 'a'.repeat(200_000);
    redis.data.get(conversationKey(phone))!.value = JSON.stringify(saved);
    const cold = await instance();
    await post(cold, 'Necesito focos LED');
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    const history = vi.mocked(askClaude).mock.calls.at(-1)![0];
    expect(history[0].content.length).toBeLessThanOrEqual(4096 + ' [...cortado]'.length);
    expect(history[0].content.startsWith('Hola aaa')).toBe(true);
  });
});

describe('H2: escrituras pendientes de un estado anterior (formato de la PR 121)', () => {
  it('pasan a su cola y se entregan una sola vez', async () => {
    const { conversationKey, pendingKey } = await import('../_lib/whatsapp/stateStore.js');
    const hook = await instance();
    await post(hook, 'Hola');
    const saved = await snapshot();
    saved.pending = [{ dealId: 9001, note: 'Nota pendiente ficticia' }];
    delete saved.rev; // la versión anterior no escribía revisión
    redis.data.get(conversationKey(phone))!.value = JSON.stringify(saved);
    const cold = await instance();
    await post(cold, 'gracias');
    expect(sim.notes.map((n) => n.content)).toEqual(['Nota pendiente ficticia']);
    expect((await snapshot()).pending).toEqual([]);
    // [PENDIENTES] R3: antes se exigía que la clave de la cola desapareciera. Ahora la marca de la migración
    // vive en la misma cola (así se guarda junto con la escritura, en una sola operación): la cola queda sin
    // escrituras y solo con esa marca, para que un estado guardado que todavía la traiga no la vuelva a pasar.
    expect(await queued()).toEqual([]);
    expect(Object.keys(JSON.parse(redis.data.get(pendingKey(phone))!.value))).toEqual([expect.stringMatching(/^m:legacy-/)]);
    await post(cold, 'gracias de nuevo');
    await post(await instance(), 'gracias otra vez');
    expect(sim.notes).toHaveLength(1);
  });
});

describe('Verificador: el guardado temprano no repite el registro que otro mensaje tiene en curso', () => {
  const LIVING = 'Ah y son para el living';

  /** A cierra la solicitud con Pipedrive lento; B llega a los 500 ms y deja de esperar el candado. */
  async function overlap(two: boolean, noteDelayMs: number) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = await instance();
    const second = two ? await instance() : first;
    claude(ORDER, ORDER_CLAUDE);
    await post(first, ORDER);
    claude(CONTACT, CONTACT_CLAUDE);
    claude(LIVING, {});
    sim.noteDelayMs = noteDelayMs;
    const a = post(first, CONTACT);
    await vi.advanceTimersByTimeAsync(500);
    const b = post(second, LIVING);
    await vi.advanceTimersByTimeAsync(40_000);
    const [replyA, replyB] = await Promise.all([a, b]);
    return { replyA, replyB };
  }

  /**
   * `followUp`: B cambió un dato («living» en vez de «casa») y supo a tiempo que A registró el negocio. [REGISTRO]
   * Ronda 3 del verificador (R4 durante el registro): antes la prueba exigía una sola nota y el mensaje de B en la
   * transcripción, a la espera de una nota siguiente; así el dato nuevo nunca llegaba al negocio. Ahora va al
   * negocio de A como una corrección: su propia nota, sin repetir la de A, y sin otro aviso a ventas.
   */
  async function expectOneRegistration(followUp = false) {
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(followUp ? 2 : 1);
    expect(clientTexts(sim.notes[0].content)).toEqual([ORDER, CONTACT]);
    expect(sim.notified).toBe(1);
    const after = await snapshot();
    expect(after.flow.deal).toBe('registered');
    expect(after.flow.dealId).toBe(9001);
    const entries = after.transcript.entries as Array<{ role: string; text: string }>;
    if (followUp) {
      expect(sim.notes[1].deal_id).toBe(9001);
      expect(clientTexts(sim.notes[1].content)).toEqual([LIVING]);
      expect(entries.filter((e) => e.role === 'cliente')).toEqual([]);
    } else {
      // El mensaje de B queda en la transcripción para la nota siguiente.
      expect(entries.filter((e) => e.role === 'cliente').map((e) => e.text)).toEqual([LIVING]);
    }
    const { registrationKey } = await import('../_lib/whatsapp/stateStore.js');
    expect(redis.data.has(registrationKey(phone))).toBe(false);
  }

  it('dos instancias: B lee la conversación cerrada y sin negocio, pero no registra de nuevo: un negocio, una nota de A y un aviso', async () => {
    const { replyA, replyB } = await overlap(true, 12_000);
    await expectOneRegistration(true);
    // Las dos respuestas dicen lo que confirmó Pipedrive (el registro de A).
    expect(replyA).toContain('quedo registrada');
    expect(replyB).toContain('quedo registrada');
  });

  it('una instancia: B deja de esperar a A, que sigue en Pipedrive, y tampoco registra de nuevo', async () => {
    const { replyA, replyB } = await overlap(false, 12_000);
    await expectOneRegistration(true);
    expect(replyA).toContain('quedo registrada');
    expect(replyB).toContain('quedo registrada');
  });

  it('si A no termina antes del plazo de B, B no afirma el registro ni el fallo (texto aprobado) y tampoco lo repite', async () => {
    const { replyA, replyB } = await overlap(true, 20_000);
    await expectOneRegistration();
    expect(replyA).toContain('quedo registrada');
    expect(replyB).toContain(MSG_DEAL_PENDING.slice(0, 60));
    expect(replyB).not.toContain('quedo registrada');
    expect(replyB).not.toContain('No pude registrar');
  });

  it('si el registro de A falla mientras B espera, B responde el texto B', async () => {
    sim.dealDelayMs = 3_000;
    sim.dealFail = true;
    const { replyB } = await overlap(true, 0);
    expect(sim.deals).toHaveLength(0);
    expect(replyB).toContain('No pude registrar');
    expect(replyB).not.toContain(MSG_DEAL_PENDING.slice(0, 60));
  });

  it('si la reserva de otro mensaje vence sin resultado (su instancia se cortó), este mensaje registra la solicitud', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hook = await instance();
    claude(ORDER, ORDER_CLAUDE);
    await post(hook, ORDER);
    // Otra instancia tomó la reserva y se cortó antes de terminar: vence en 3 s.
    const { registrationKey } = await import('../_lib/whatsapp/stateStore.js');
    redis.data.set(registrationKey(phone), { value: 'instancia-cortada', ttl: 3_000, expiresAt: Date.now() + 3_000 });
    claude(CONTACT, CONTACT_CLAUDE);
    const reply = post(hook, CONTACT);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await reply).toContain('quedo registrada');
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
    expect(clientTexts(sim.notes[0].content)).toEqual([ORDER, CONTACT]);
    expect((await snapshot()).flow.deal).toBe('registered');
    expect(redis.data.has(registrationKey(phone))).toBe(false);
  });
});

describe('Verificador: dos mensajes a la vez que agregan cada uno un cambio', () => {
  const MORE = 'Mejor que sean 20 focos';
  const FIX = 'La comuna es Colina';
  const BOTH = ['Cantidad: antes 12, ahora 20', 'Comuna/ciudad: antes Maipú, ahora Colina'];

  async function run(mode: 'secuencia' | 'una instancia' | 'dos instancias') {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = await instance();
    const second = mode === 'dos instancias' ? await instance() : first;
    claude(ORDER, ORDER_CLAUDE);
    await post(first, ORDER);
    claude(FIX, { comuna_o_ciudad: 'Colina' });
    if (mode === 'secuencia') {
      claude(MORE, { cantidad: '20' });
      await post(first, MORE);
      await post(first, FIX);
    } else {
      // A tarda 12 s en Claude; B llega a los 100 ms, deja de esperar y termina primero.
      claude(MORE, { cantidad: '20' }, 12_000);
      const a = post(first, MORE);
      await vi.advanceTimersByTimeAsync(100);
      const b = post(second, FIX);
      await vi.advanceTimersByTimeAsync(10_000);
      await b;
      await vi.advanceTimersByTimeAsync(5_000);
      await a;
    }
    const after = await snapshot();
    expect(after.flow.captured.cantidad).toBe('20');
    expect(after.flow.captured.comuna_o_ciudad).toBe('Colina');
    expect(after.flow.captured.cambios).toEqual(BOTH);
    claude(CONTACT, CONTACT_CLAUDE);
    await post(first, CONTACT);
    expect(sim.notes).toHaveLength(1);
    expect(unescape(sim.notes[0].content)).toContain('Cambios: ' + BOTH.join('; '));
  }

  it('en secuencia (referencia)', () => run('secuencia'));
  it('en una instancia: la nota trae los dos cambios, en el orden de llegada', () => run('una instancia'));
  it('en dos instancias: la nota trae los dos cambios, en el orden de llegada', () => run('dos instancias'));
});

describe('Verificador: datos capturados enormes', () => {
  it('el estado guardado queda bajo MAX_STATE_BYTES sin acortar el historial ni la transcripción', async () => {
    const hook = await instance();
    await post(hook, 'Hola');
    const { MAX_STATE_BYTES, MAX_CAPTURED_BYTES, conversationKey, persistConversation } = await import('../_lib/whatsapp/stateStore.js');
    const { getFlowState, saveFlowState } = await import('../_lib/whatsapp/flowEngine.js');
    const big = '€'.repeat(5_000);
    const state = getFlowState(phone);
    saveFlowState(phone, {
      ...state,
      captured: { ...state.captured, cambios: Array(30).fill(big), comunas_otras: Array(30).fill(big), proyecto_o_uso: big, install_descripcion: big },
    });
    await persistConversation(phone);
    const raw = redis.data.get(conversationKey(phone))!.value;
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(MAX_STATE_BYTES);
    const saved = JSON.parse(raw);
    expect(Buffer.byteLength(JSON.stringify(saved.flow.captured))).toBeLessThanOrEqual(MAX_CAPTURED_BYTES);
    // El historial y la transcripción (mensajes del cliente aún no anotados) no pagan por los datos capturados.
    expect(saved.history).toHaveLength(2);
    expect(saved.history[0].content).toBe('Hola');
    expect(saved.transcript.entries.map((e: { role: string }) => e.role)).toEqual(['cliente', 'bot']);
    // De la lista de cambios quedan los más recientes.
    expect(saved.flow.captured.cambios.length).toBeGreaterThan(0);
  });
});

/** La cola de Upstash no acepta escrituras: el HSET directo o el EVAL que la escribe. */
const queueDown = (cmd: string, args: string[]) => (cmd === 'HSET' || (cmd === 'EVAL' && args[0].includes("'hset'")) ? 'fail' as const : undefined);
const isStateSave = (cmd: string, args: string[]) => cmd === 'EVAL' && args[0].includes('^{"rev":');

describe('R3: escrituras pendientes del estado anterior', () => {
  /** El estado guardado por la versión anterior: con sus pendientes dentro y sin revisión. */
  async function legacyState(pending: Array<Record<string, unknown>>) {
    const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    await post(await instance(), 'Hola');
    const saved = await snapshot();
    saved.pending = pending;
    delete saved.rev;
    redis.data.get(conversationKey(phone))!.value = JSON.stringify(saved);
  }

  it('A reserva la migración, falla la escritura en la cola y A se corta: B la pasa a la cola y la entrega', async () => {
    await legacyState([{ dealId: 9001, note: 'Pendiente legado de prueba' }]);
    // A lee el estado con la cola caída y se corta antes de guardar nada más.
    redis.intercept = queueDown;
    await instance();
    const a = await import('../_lib/whatsapp/stateStore.js');
    await a.loadConversation(phone);
    redis.intercept = undefined;
    // B, otra instancia, con la cola de vuelta.
    await post(await instance(), 'gracias');
    expect(sim.notes.map((n) => n.content)).toEqual(['Pendiente legado de prueba']);
    expect((await snapshot()).pending).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it('tres notas legadas de 90.000 bytes con la cola caída: ningún guardado pasa MAX_STATE_BYTES y las tres llegan después', async () => {
    const { MAX_STATE_BYTES } = await import('../_lib/whatsapp/stateStore.js');
    const big = (i: number) => 'Nota legada ' + i + ' ' + 'x'.repeat(90_000);
    await legacyState([1, 2, 3].map((i) => ({ dealId: 9001, note: big(i) })));
    const saves: number[] = [];
    const watchSaves = (cmd: string, args: string[]) => { if (isStateSave(cmd, args)) saves.push(Buffer.byteLength(args[4])); };
    // La cola rechaza el HSET y Pipedrive tampoco acepta las notas.
    redis.intercept = (cmd, args) => { watchSaves(cmd, args); return queueDown(cmd, args); };
    sim.rejectNote = () => true;
    const hook = await instance();
    await post(hook, 'gracias');
    // Sin la cola, las tres siguen en el estado guardado.
    expect((await snapshot()).pending).toHaveLength(3);
    redis.intercept = (cmd, args) => { watchSaves(cmd, args); return undefined; };
    sim.rejectNote = undefined;
    await post(hook, 'gracias de nuevo');
    expect(saves.length).toBeGreaterThan(0);
    for (const size of saves) expect(size).toBeLessThanOrEqual(MAX_STATE_BYTES);
    expect(sim.notes.map((n) => n.content)).toEqual([big(1), big(2), big(3)]);
    expect((await snapshot()).pending).toEqual([]);
    expect(await queued()).toEqual([]);
  });
});

describe('R5: el tope y el plazo de la cola van en una sola operación', () => {
  /** Una instancia nueva del módulo, con su propia memoria (otra instancia de Vercel). */
  async function freshStore() {
    vi.resetModules();
    return import('../_lib/whatsapp/stateStore.js');
  }

  it('con nueve pendientes, 20 instancias agregan una nota a la vez: entra una sola y la cola queda en 10', async () => {
    const first = await freshStore();
    for (let i = 1; i <= 9; i++) await first.enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota ficticia ' + i });
    const stores = [];
    for (let i = 0; i < 20; i++) stores.push(await freshStore());
    const results = await Promise.all(stores.map((s, i) => s.enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota concurrente ' + i })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await queued()).toHaveLength(first.MAX_PENDING_WRITES);
  });

  it('a una del tope duro, 20 instancias agregan campos de negocios distintos a la vez: entra uno solo', async () => {
    const first = await freshStore();
    for (let i = 1; i <= first.MAX_PENDING_WRITES; i++) await first.enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota ficticia ' + i });
    for (let i = 1; i < first.MAX_PENDING_TOTAL - first.MAX_PENDING_WRITES; i++) {
      await first.enqueuePendingWrite(phone, { dealId: 8000 + i, fields: { cf_email: 'ana' + i + '@example.com' } });
    }
    expect(await queued()).toHaveLength(first.MAX_PENDING_TOTAL - 1);
    const stores = [];
    for (let i = 0; i < 20; i++) stores.push(await freshStore());
    const results = await Promise.all(stores.map((s, i) => s.enqueuePendingWrite(phone, { dealId: 8100 + i, fields: { cf_email: 'ana.c' + i + '@example.com' } })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await queued()).toHaveLength(first.MAX_PENDING_TOTAL);
  });

  it('HSET guarda y EXPIRE falla: la cola no queda sin su plazo de 30 días', async () => {
    const store = await freshStore();
    redis.intercept = (cmd) => (cmd === 'EXPIRE' ? 'fail' : undefined);
    expect(await store.enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota ficticia' })).toBe(true);
    await store.loadPendingWrites(phone);
    await store.loadPendingWrites(phone);
    expect(redis.data.get(store.pendingKey(phone))!.ttl).toBe(store.PENDING_WRITE_TTL_S);
  });

  it('si se pierde la respuesta del guardado, la cola ya tiene su plazo y la lectura siguiente no la duplica', async () => {
    const store = await freshStore();
    let lost = false;
    redis.intercept = (cmd, args) => {
      if (lost || !(cmd === 'HSET' || (cmd === 'EVAL' && args[0].includes("'hset'")))) return undefined;
      lost = true;
      return 'lose';
    };
    await store.enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota ficticia' });
    expect(redis.data.get(store.pendingKey(phone))!.ttl).toBe(store.PENDING_WRITE_TTL_S);
    await store.loadPendingWrites(phone);
    expect(await queued()).toEqual([{ dealId: 9001, note: 'Nota ficticia' }]);
    expect(redis.data.get(store.pendingKey(phone))!.ttl).toBe(store.PENDING_WRITE_TTL_S);
  });
});

describe('R6: reintentos de la cola de pendientes', () => {
  it('cinco pendientes de un negocio eliminado, que siempre fallan, no frenan a la sexta (negocio 9002), que llega', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await instance();
    const store = await import('../_lib/whatsapp/stateStore.js');
    for (let i = 1; i <= 5; i++) {
      await store.enqueuePendingWrite(phone, { dealId: 9009, note: 'Nota del negocio eliminado ' + i });
      vi.setSystemTime(Date.now() + 1);
    }
    await store.enqueuePendingWrite(phone, { dealId: 9002, note: 'Nota del negocio vigente' });
    sim.rejectNote = (note) => note.deal_id === 9009;
    await post(await instance(), 'gracias');
    expect(sim.notes).toEqual([]);
    // Otra instancia, sin la memoria de la anterior: primero la que nunca se intentó.
    await post(await instance(), 'gracias de nuevo');
    expect(sim.notes.map((n) => [n.deal_id, n.content])).toEqual([[9002, 'Nota del negocio vigente']]);
    // Las cinco que fallan no se descartan: siguen en la cola.
    expect((await queued()).map((w) => w.dealId)).toEqual([9009, 9009, 9009, 9009, 9009]);
  });

  it('el candado de 25 s vence mientras A manda una pendiente lenta: B no la manda otra vez', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await instance();
    const store = await import('../_lib/whatsapp/stateStore.js');
    await store.enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota pendiente ficticia' });
    const a = await instance();
    const b = await instance();
    sim.noteDelayMs = 30_000;
    const replyA = post(a, 'gracias');
    await vi.advanceTimersByTimeAsync(store.CONVERSATION_LOCK_TTL_MS + 1_000);
    expect(sim.notes).toHaveLength(0);
    const replyB = post(b, 'Hola de nuevo');
    await vi.advanceTimersByTimeAsync(40_000);
    await Promise.all([replyA, replyB]);
    expect(sim.notes.map((n) => n.content)).toEqual(['Nota pendiente ficticia']);
    expect(await queued()).toEqual([]);
  });

  it('si la instancia que la reservó se corta, la reserva vence y un mensaje posterior la manda', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await instance();
    const store = await import('../_lib/whatsapp/stateStore.js');
    await store.enqueuePendingWrite(phone, { dealId: 9001, note: 'Nota pendiente ficticia' });
    // La reserva y se corta sin mandarla.
    const [item] = await store.duePendingWrites(phone, store.MAX_PENDING_RETRIES_PER_TURN);
    expect(await store.claimPendingWrite(phone, item.id)).toBe(true);
    await post(await instance(), 'gracias');
    expect(sim.notes).toEqual([]);
    vi.setSystemTime(Date.now() + store.PENDING_CLAIM_TTL_MS);
    await post(await instance(), 'gracias de nuevo');
    expect(sim.notes.map((n) => n.content)).toEqual(['Nota pendiente ficticia']);
    expect(await queued()).toEqual([]);
  });
});

describe('R1: cada dato lo deja el último mensaje que lo cambió (decisión 7)', () => {
  /** Otra instancia de Vercel: su stateStore y su flowEngine, con su propia memoria. */
  async function freshModules() {
    vi.resetModules();
    const store = await import('../_lib/whatsapp/stateStore.js');
    const flow = await import('../_lib/whatsapp/flowEngine.js');
    return { store, flow };
  }
  type Modules = Awaited<ReturnType<typeof freshModules>>;
  /** El paso del flujo de un mensaje (número de orden `n`) que cambia solo esos datos capturados. */
  function step(m: Modules, n: number, captured: Record<string, string>) {
    const base = structuredClone(m.flow.getFlowState(phone));
    const current = m.store.beginFlowStep(phone, n, base);
    const now = m.flow.getFlowState(phone);
    m.flow.saveFlowState(phone, { ...now, captured: { ...now.captured, ...captured } });
    m.store.settleFlowStep(phone, n, base, current);
  }

  it('A (10) cambia el correo sin guardar, B (20) lo cambia y guarda, A (30) cambia solo la comuna y guarda: quedan Colina y el correo de B', async () => {
    const initial = await freshModules();
    step(initial, 1, { producto: 'focos LED', comuna_o_ciudad: 'Maipú' });
    expect(await initial.store.persistConversation(phone)).toBe('saved');
    const a = await freshModules();
    await a.store.loadConversation(phone);
    const b = await freshModules();
    await b.store.loadConversation(phone);
    step(a, 10, { correo: 'ana.a@example.com' });
    step(b, 20, { correo: 'ana.b@example.com' });
    expect(await b.store.persistConversation(phone)).toBe('saved');
    step(a, 30, { comuna_o_ciudad: 'Colina' });
    expect(await a.store.persistConversation(phone)).toBe('saved');
    const saved = (await snapshot()).flow.captured;
    expect(saved.correo).toBe('ana.b@example.com');
    expect(saved.comuna_o_ciudad).toBe('Colina');
    expect(a.flow.getFlowState(phone).captured.correo).toBe('ana.b@example.com');
    expect(a.flow.getFlowState(phone).captured.comuna_o_ciudad).toBe('Colina');
  });
});

describe('R2: otro guardado gana cada intento', () => {
  it('"Hola perdido" responde 200 y queda aparte en Upstash; la instancia siguiente lo mezcla y lo borra de ahí', async () => {
    const { conversationKey, heldKey } = await import('../_lib/whatsapp/stateStore.js');
    await post(await instance(), 'Hola');
    // Entre la lectura y el EVAL de cada guardado, otro guardado sube la revisión.
    redis.intercept = (cmd, args) => {
      if (!isStateSave(cmd, args)) return undefined;
      const entry = redis.data.get(conversationKey(phone))!;
      const saved = JSON.parse(entry.value);
      entry.value = JSON.stringify({ ...saved, rev: saved.rev + 1 });
      return undefined;
    };
    await post(await instance(), 'Hola perdido');
    redis.intercept = undefined;
    // El estado compartido no lo tiene, pero quedó aparte, en Upstash (no solo en la memoria de la instancia).
    const user = (t: { role: string }) => t.role === 'user';
    const content = (t: { content: string }) => t.content;
    expect((await snapshot()).history.filter(user).map(content)).toEqual(['Hola']);
    expect(redis.data.has(heldKey(phone))).toBe(true);
    // Otra instancia, sin la memoria de la anterior.
    await post(await instance(), 'Hola de nuevo');
    const after = await snapshot();
    expect(after.history.filter(user).map(content)).toEqual(['Hola', 'Hola perdido', 'Hola de nuevo']);
    const entries = after.transcript.entries as Array<{ role: string; text: string }>;
    expect(entries.filter((e) => e.role === 'cliente').map((e) => e.text)).toEqual(['Hola', 'Hola perdido', 'Hola de nuevo']);
    expect(redis.data.has(heldKey(phone))).toBe(false);
  });
});

describe('R4: Pipedrive termina con el correo del mensaje que llegó después', () => {
  const FULL = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
  const A = 'Es ana.a@example.com';
  const B = 'Es ana.b@example.com';
  const emails = () => sim.updates.map((u) => u.fields.cf_email);

  beforeEach(() => { vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_email'); });

  async function registered(hook: Handler) {
    claude(FULL, { ...ORDER_CLAUDE, ...CONTACT_CLAUDE, qualifiesForDeal: true });
    await post(hook, FULL);
    expect(sim.notes).toHaveLength(1);
    expect(emails()).toEqual(['ana.prueba@example.com']);
    claude(A, { correo: 'ana.a@example.com' });
    claude(B, { correo: 'ana.b@example.com' });
  }

  /**
   * A actualiza el negocio lento (`updateMs`); B llega a los 100 ms y deja de esperar a A a los 10 s.
   * `midway`: lo que se revisa a los 15 s (B ya respondió).
   */
  async function lateCorrections(two: boolean, updateMs: number, midway?: () => Promise<void>) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = await instance();
    const second = two ? await instance() : first;
    await registered(first);
    sim.updateDelayMs = (fields) => (fields.cf_email === 'ana.a@example.com' ? updateMs : 0);
    const a = post(first, A);
    await vi.advanceTimersByTimeAsync(100);
    const b = post(second, B);
    await vi.advanceTimersByTimeAsync(15_000);
    await midway?.();
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all([a, b]);
    return first;
  }

  for (const two of [false, true]) {
    const where = two ? 'dos instancias' : 'una instancia';

    it(where + ': A actualiza lento (11 s) y B llega después: B escribe cuando A termina y queda ana.b', async () => {
      await lateCorrections(two, 11_000);
      expect(emails()).toEqual(['ana.prueba@example.com', 'ana.a@example.com', 'ana.b@example.com']);
      expect((await snapshot()).flow.captured.correo).toBe('ana.b@example.com');
    });

    it(where + ': A tarda más que la espera de B (20 s): la corrección de B va a la cola y A, que tiene la reserva, la manda al terminar', async () => {
      const first = await lateCorrections(two, 20_000, async () => {
        // B ya respondió sin escribir en el negocio (A sigue en Pipedrive): su corrección espera en la cola.
        expect(emails()).toEqual(['ana.prueba@example.com']);
        expect((await queued()).map((w) => w.fields?.cf_email)).toEqual(['ana.b@example.com']);
      });
      expect(emails()).toEqual(['ana.prueba@example.com', 'ana.a@example.com', 'ana.b@example.com']);
      expect(await queued()).toEqual([]);
      expect(clientTexts(sim.notes.at(-1)!.content)).toContain(B);
      // El mensaje siguiente no la vuelve a mandar.
      await post(first, 'gracias');
      expect(emails()).toEqual(['ana.prueba@example.com', 'ana.a@example.com', 'ana.b@example.com']);
    });
  }

  it('una escritura de la cola con el correo de A no pisa la corrección de B, que ya llegó: sale solo su nota', async () => {
    const hook = await instance();
    await registered(hook);
    // Pipedrive no acepta los campos de A ni su nota: quedan en la cola.
    sim.updateFail = (fields) => fields.cf_email === 'ana.a@example.com';
    sim.rejectNote = (note) => clientTexts(note.content).includes(A);
    await post(hook, A);
    expect((await queued()).map((w) => [w.fields?.cf_email, w.note !== undefined])).toEqual([['ana.a@example.com', true]]);
    // B: el reintento de A vuelve a fallar; la corrección de B llega.
    await post(hook, B);
    expect(emails()).toEqual(['ana.prueba@example.com', 'ana.b@example.com']);
    // Pipedrive vuelve: el reintento manda la nota de A, sin su correo.
    sim.updateFail = undefined;
    sim.rejectNote = undefined;
    await post(hook, 'gracias');
    expect(emails()).toEqual(['ana.prueba@example.com', 'ana.b@example.com']);
    expect(clientTexts(sim.notes.at(-1)!.content)).toEqual([A]);
    expect(await queued()).toEqual([]);
  });
});

describe('R10: un correo que llega mientras el mensaje anterior abre otro pedido', () => {
  const NEW_ORDER = 'Otro pedido: 30 paneles LED luz fría para una oficina en Lampa.';
  const NEW_ORDER_CLAUDE = { producto: 'paneles LED', tipo_de_luz: 'fría', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' };
  const EMAIL = 'Mi correo es ana.nueva@example.com';

  beforeEach(() => { vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_email'); });

  for (const two of [false, true]) {
    it((two ? 'dos instancias' : 'una instancia') + ': A (Claude lento) abre el pedido nuevo; el correo de B no va al negocio anterior 9001 y queda en el pedido nuevo', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const first = await instance();
      const second = two ? await instance() : first;
      claude(ORDER, ORDER_CLAUDE);
      await post(first, ORDER);
      claude(CONTACT, CONTACT_CLAUDE);
      await post(first, CONTACT);
      const before = await snapshot();
      expect(before.flow.dealId).toBe(9001);
      const [notesBefore, updatesBefore] = [sim.notes.length, sim.updates.length];
      claude(NEW_ORDER, NEW_ORDER_CLAUDE, 12_000);
      claude(EMAIL, { correo: 'ana.nueva@example.com' });
      const a = post(first, NEW_ORDER);
      await vi.advanceTimersByTimeAsync(100);
      const b = post(second, EMAIL);
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.all([a, b]);
      // El correo no fue como corrección del negocio anterior (antes: una nota con solo ese mensaje y el correo
      // en 9001, sin registrar el pedido nuevo, que quedaba sin correo). Llegó con el registro del pedido nuevo
      // (createDeal; el Pipedrive simulado lo junta con el negocio abierto del número, como la deduplicación).
      expect(sim.deals).toHaveLength(2);
      const withEmail = sim.notes.slice(notesBefore).filter((n) => clientTexts(n.content).includes(EMAIL));
      expect(withEmail.map((n) => clientTexts(n.content))).toEqual([[NEW_ORDER, EMAIL]]);
      expect(sim.updates.slice(updatesBefore).map((u) => u.fields.cf_email)).toEqual(['ana.nueva@example.com']);
      // El pedido nuevo es la conversación activa y tiene el correo.
      const after = await snapshot();
      expect(after.flow.firstMessageAt).not.toBe(before.flow.firstMessageAt);
      expect(after.flow.captured.producto).toBe('paneles LED');
      expect(after.flow.captured.correo).toBe('ana.nueva@example.com');
    });
  }
});

describe('R11: el resultado del registro se consulta por conversación', () => {
  it('A registra; B espera su resultado; C abre otra conversación mientras tanto: B no responde que falló', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const LIVING = 'Ah y son para el living';
    const NEW_ORDER = 'Otro pedido: 30 paneles LED luz fría para una oficina en Lampa.';
    const hook = await instance();
    claude(ORDER, ORDER_CLAUDE);
    await post(hook, ORDER);
    const conversationA = (await snapshot()).flow.firstMessageAt;
    claude(CONTACT, CONTACT_CLAUDE);
    claude(LIVING, {});
    claude(NEW_ORDER, { producto: 'paneles LED', tipo_de_luz: 'fría', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' });
    sim.noteDelayMs = 12_000;
    const a = post(hook, CONTACT);
    await vi.advanceTimersByTimeAsync(500);
    const b = post(hook, LIVING);
    await vi.advanceTimersByTimeAsync(500);
    const c = post(hook, NEW_ORDER);
    await vi.advanceTimersByTimeAsync(40_000);
    const [replyA, replyB] = await Promise.all([a, b, c]);
    expect(sim.deals).toHaveLength(1);
    expect(replyA).toContain('quedo registrada');
    // C abrió otra conversación: la de A y B ya no es la activa, pero su registro sí se confirmó.
    expect((await snapshot()).flow.firstMessageAt).not.toBe(conversationA);
    expect(replyB).toContain('quedo registrada');
    expect(replyB).not.toContain('No pude registrar');
  });
});

describe('Verificador de R4 y R10 (ronda 3)', () => {
  const FULL = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
  const A = 'Es ana.a@example.com';
  const B = 'Es ana.b@example.com';
  const NEW_ORDER = 'Otro pedido: 30 paneles LED luz fría para una oficina en Lampa.';
  const NEW_ORDER_CLAUDE = { producto: 'paneles LED', tipo_de_luz: 'fría', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' };
  const NEW_ORDER_EMAIL = 'Otro pedido: 20 focos LED luz cálida para mi casa en Lampa. Soy Ana Dos, ana.dos@example.com';
  const NEW_ORDER_EMAIL_CLAUDE = { producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '20', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Lampa', nombre: 'Ana Dos', correo: 'ana.dos@example.com' };
  const emails = () => sim.updates.map((u) => u.fields.cf_email);

  beforeEach(() => { vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_email'); });

  /** La solicitud de Ana Prueba queda registrada en el negocio 9001 (una nota). */
  async function registered(hook: Handler) {
    claude(FULL, { ...ORDER_CLAUDE, ...CONTACT_CLAUDE, qualifiesForDeal: true });
    await post(hook, FULL);
    expect(sim.notes).toHaveLength(1);
    expect(emails()).toEqual(['ana.prueba@example.com']);
    claude(A, { correo: 'ana.a@example.com' });
    claude(B, { correo: 'ana.b@example.com' });
  }

  describe('R10: la corrección llega antes que el mensaje que abre el pedido nuevo', () => {
    for (const two of [false, true]) {
      it((two ? 'dos instancias' : 'una instancia') + ': A "Es ana.a" (Claude 11 s) y C "Otro pedido..." a los 100 ms: el correo de A es del negocio 9001', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const first = await instance();
        const second = two ? await instance() : first;
        await registered(first);
        const [notesBefore, updatesBefore, dealsBefore] = [sim.notes.length, sim.updates.length, sim.deals.length];
        sim.distinct = true;
        claude(A, { correo: 'ana.a@example.com' }, 11_000);
        claude(NEW_ORDER, NEW_ORDER_CLAUDE);
        const a = post(first, A);
        await vi.advanceTimersByTimeAsync(100);
        const c = post(second, NEW_ORDER);
        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.all([a, c]);
        // Antes: el paso de A corría otra vez sobre el pedido que abrió C (que llegó después) y el correo no
        // llegaba al negocio 9001.
        expect(sim.updates.slice(updatesBefore).map((u) => [u.dealId, u.fields.cf_email])).toEqual([[9001, 'ana.a@example.com']]);
        expect(sim.notes.slice(notesBefore).map((n) => [n.deal_id, clientTexts(n.content)])).toEqual([[9001, [A]]]);
        expect(sim.deals).toHaveLength(dealsBefore);
        // El pedido nuevo sigue abierto, sin el correo del negocio anterior.
        const after = await snapshot();
        expect(after.flow.captured.producto).toBe('paneles LED');
        expect(after.flow.captured.correo).toBeUndefined();
      });
    }

    it('tres instancias: A "gracias" (Claude 11 s, con el candado), B "Es ana.b" a los 100 ms y C "Otro pedido..." a los 200 ms: el correo de B es del negocio 9001', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      sim.distinct = true;
      const first = await instance();
      const second = await instance();
      const third = await instance();
      await registered(first);
      const [updatesBefore, dealsBefore] = [sim.updates.length, sim.deals.length];
      claude('gracias', {}, 11_000);
      claude(NEW_ORDER, NEW_ORDER_CLAUDE);
      const a = post(first, 'gracias');
      await vi.advanceTimersByTimeAsync(100);
      const b = post(second, B);
      await vi.advanceTimersByTimeAsync(100);
      const c = post(third, NEW_ORDER);
      await vi.advanceTimersByTimeAsync(60_000);
      const [, replyB] = await Promise.all([a, b, c]);
      expect(sim.updates.slice(updatesBefore).map((u) => [u.dealId, u.fields.cf_email])).toEqual([[9001, 'ana.b@example.com']]);
      expect(sim.deals).toHaveLength(dealsBefore);
      expect(replyB).toContain('quedo registrada');
      expect((await snapshot()).flow.captured.correo).toBeUndefined();
    });
  });

  describe('R4: una corrección no frena el registro de un pedido nuevo', () => {
    it('A corrige lento (20 s); B, en otra instancia, manda un pedido nuevo con correo a los 100 ms: se registra y Pipedrive termina con el correo de B', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const first = await instance();
      const second = await instance();
      await registered(first);
      const dealsBefore = sim.deals.length;
      sim.updateDelayMs = (fields) => (fields.cf_email === 'ana.a@example.com' ? 20_000 : 0);
      claude(NEW_ORDER_EMAIL, NEW_ORDER_EMAIL_CLAUDE);
      const a = post(first, A);
      await vi.advanceTimersByTimeAsync(100);
      const b = post(second, NEW_ORDER_EMAIL);
      await vi.advanceTimersByTimeAsync(40_000);
      const [, replyB] = await Promise.all([a, b]);
      // Antes: B esperaba la reserva que tenía la corrección de A y respondía MSG_DEAL_PENDING sin registrar.
      expect(sim.deals.length - dealsBefore).toBe(1);
      expect(replyB).toContain('quedo registrada');
      expect(replyB).not.toContain(MSG_DEAL_PENDING.slice(0, 60));
      // El pedido nuevo se juntó con el negocio abierto (9001), donde A seguía escribiendo: sus campos salen
      // después de los de A (decisión 7: gana el mensaje que llegó después).
      expect(emails().at(-1)).toBe('ana.dos@example.com');
      expect(await queued()).toEqual([]);
    });

    it('M1 reintenta campos pendientes lentos (20 s); M2, en otra instancia, manda un pedido nuevo con correo a los 100 ms: se registra', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const first = await instance();
      const second = await instance();
      await registered(first);
      sim.updateFail = (fields) => fields.cf_email === 'ana.a@example.com';
      await post(first, A);
      sim.updateFail = undefined;
      expect((await queued()).map((w) => w.fields?.cf_email)).toEqual(['ana.a@example.com']);
      const dealsBefore = sim.deals.length;
      sim.updateDelayMs = (fields) => (fields.cf_email === 'ana.a@example.com' ? 20_000 : 0);
      claude('gracias', {});
      claude(NEW_ORDER_EMAIL, NEW_ORDER_EMAIL_CLAUDE);
      const m1 = post(first, 'gracias');
      await vi.advanceTimersByTimeAsync(100);
      const m2 = post(second, NEW_ORDER_EMAIL);
      await vi.advanceTimersByTimeAsync(40_000);
      const [, replyM2] = await Promise.all([m1, m2]);
      expect(sim.deals.length - dealsBefore).toBe(1);
      expect(replyM2).toContain('quedo registrada');
      expect(emails().at(-1)).toBe('ana.dos@example.com');
    });
  });

  it('R4: B corrige el correo (500 ms) mientras A registra la solicitud (nota de 12 s): Pipedrive termina con el correo de B y ventas recibe un aviso', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hook = await instance();
    claude(ORDER, ORDER_CLAUDE);
    await post(hook, ORDER);
    claude(CONTACT, CONTACT_CLAUDE);
    claude(B, { correo: 'ana.b@example.com' });
    sim.noteDelayMs = 12_000;
    const a = post(hook, CONTACT);
    await vi.advanceTimersByTimeAsync(500);
    const b = post(hook, B);
    await vi.advanceTimersByTimeAsync(40_000);
    const [replyA, replyB] = await Promise.all([a, b]);
    sim.noteDelayMs = 0;
    await post(hook, 'gracias');
    // Antes: el negocio quedaba con ana.prueba y la corrección de B no llegaba nunca a Pipedrive.
    expect(sim.deals).toHaveLength(1);
    expect(emails()).toEqual(['ana.prueba@example.com', 'ana.b@example.com']);
    expect(sim.notes.map((n) => [n.deal_id, clientTexts(n.content)])).toEqual([[9001, [ORDER, CONTACT]], [9001, [B]]]);
    expect(sim.notified).toBe(1);
    expect(replyA).toContain('quedo registrada');
    expect(replyB).toContain('quedo registrada');
    expect((await snapshot()).flow.captured.correo).toBe('ana.b@example.com');
  });

  it('R4: el EVAL que anota los campos confirmados falla una vez: otra instancia no reenvía el correo viejo de la cola', async () => {
    const first = await instance();
    await registered(first);
    sim.updateFail = (fields) => fields.cf_email === 'ana.a@example.com';
    sim.rejectNote = (note) => clientTexts(note.content).includes(A);
    await post(first, A);
    expect((await queued()).map((w) => w.fields?.cf_email)).toEqual(['ana.a@example.com']);
    // B en otra instancia: el reintento de A falla otra vez; la corrección de B llega, pero se pierde el EVAL que la anota.
    redis.intercept = (cmd, args) => (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:version') ? 'fail' : undefined);
    await post(await instance(), B);
    redis.intercept = undefined;
    sim.updateFail = undefined;
    sim.rejectNote = undefined;
    // Una tercera instancia reintenta la cola: sale la nota de A, sin su correo (el número de B viaja en el estado).
    await post(await instance(), 'gracias');
    expect(emails()).toEqual(['ana.prueba@example.com', 'ana.b@example.com']);
    expect(await queued()).toEqual([]);
  });

  for (const two of [false, true]) {
    it('R4, plazo de Twilio, ' + (two ? 'dos instancias' : 'una instancia') + ': A corrige (Pipedrive 12 s) y B corrige a los 100 ms (Pipedrive 3 s): las dos respuestas salen antes de 15 s y queda ana.b', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const first = await instance();
      const second = two ? await instance() : first;
      await registered(first);
      sim.updateDelayMs = (fields) => (fields.cf_email === 'ana.a@example.com' ? 12_000 : fields.cf_email === 'ana.b@example.com' ? 3_000 : 0);
      const startA = Date.now();
      let tookA = 0;
      const a = post(first, A).then((reply) => { tookA = Date.now() - startA; return reply; });
      await vi.advanceTimersByTimeAsync(100);
      const startB = Date.now();
      let tookB = 0;
      const b = post(second, B).then((reply) => { tookB = Date.now() - startB; return reply; });
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.all([a, b]);
      // Antes: B esperaba la reserva hasta 12,5 s y después escribía (3 s): respondía a los 15 s.
      expect(tookB).toBeLessThan(15_000);
      // Quien tiene la reserva manda la corrección de B en segundo plano: su respuesta no la espera.
      expect(tookA).toBeLessThan(15_000);
      expect(emails()).toEqual(['ana.prueba@example.com', 'ana.a@example.com', 'ana.b@example.com']);
      expect(await queued()).toEqual([]);
      expect((await snapshot()).flow.captured.correo).toBe('ana.b@example.com');
    });
  }
});
