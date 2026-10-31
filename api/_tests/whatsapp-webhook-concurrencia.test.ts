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
    return sim.deals.length === 1 ? { dealId: 9001, status: 'created' } : { dealId: 9001, status: 'updated' };
  }),
  updateDeal: vi.fn(async () => {}),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({
  pipedrivePost: vi.fn(async (_path: string, note: { content: string; deal_id: number }) => {
    if (sim.noteDelayMs) await new Promise((resolve) => setTimeout(resolve, sim.noteDelayMs));
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
    await vi.advanceTimersByTimeAsync(10_000); // B deja de esperar a A y termina primero
    await b;
    expect(sim.notes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await a;
    const { getFlowState } = await import('../_lib/whatsapp/flowEngine.js');
    const { getHistory } = await import('../_lib/whatsapp/conversation.js');
    // El correo final es el de B, el mensaje que llegó después.
    expect(getFlowState(phone).captured.correo).toBe('ana.b@example.com');
    expect((await snapshot()).flow.captured.correo).toBe('ana.b@example.com');
    // Historial en orden de llegada: A antes que B, cada uno seguido de su respuesta.
    const history = getHistory(phone);
    expect(history.filter((t) => t.role === 'user').map((t) => t.content)).toEqual([FULL, A, B]);
    expect(history.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    // Cada nota lleva su propio mensaje: la de B no se lleva el de A, que seguía en curso.
    expect(sim.notes).toHaveLength(3);
    expect(sim.notes.every((n) => n.deal_id === 9001)).toBe(true);
    expect(clientTexts(sim.notes[1].content)).toEqual([B]);
    expect(clientTexts(sim.notes[2].content)).toEqual([A]);
    // La nota de A no vuelve a poner el correo de A como el vigente.
    expect(unescape(sim.notes[2].content)).not.toMatch(/Correo: ana\.a@example\.com/);
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
    expect(redis.data.has(pendingKey(phone))).toBe(false);
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

  async function expectOneRegistration() {
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
    expect(clientTexts(sim.notes[0].content)).toEqual([ORDER, CONTACT]);
    expect(sim.notified).toBe(1);
    const after = await snapshot();
    expect(after.flow.deal).toBe('registered');
    expect(after.flow.dealId).toBe(9001);
    // El mensaje de B queda en la transcripción para la nota siguiente.
    const entries = after.transcript.entries as Array<{ role: string; text: string }>;
    expect(entries.filter((e) => e.role === 'cliente').map((e) => e.text)).toEqual([LIVING]);
    const { registrationKey } = await import('../_lib/whatsapp/stateStore.js');
    expect(redis.data.has(registrationKey(phone))).toBe(false);
  }

  it('dos instancias: B lee la conversación cerrada y sin negocio, pero no registra de nuevo: un negocio, una nota y un aviso', async () => {
    const { replyA, replyB } = await overlap(true, 12_000);
    await expectOneRegistration();
    // Las dos respuestas dicen lo que confirmó Pipedrive (el registro de A).
    expect(replyA).toContain('quedo registrada');
    expect(replyB).toContain('quedo registrada');
  });

  it('una instancia: B deja de esperar a A, que sigue en Pipedrive, y tampoco registra de nuevo', async () => {
    const { replyA, replyB } = await overlap(false, 12_000);
    await expectOneRegistration();
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
