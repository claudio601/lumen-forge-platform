// Correcciones #121: webhook real, Upstash falso y Pipedrive/Claude simulados. Sin red.
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRedis, fakeFetch, UPSTASH_URL } from './fakeUpstash.js';

const sim = vi.hoisted(() => ({
  parsed: {} as Record<string, unknown>,
  notes: [] as Array<{ content: string; deal_id: number }>,
  noteDown: false,
  /** Notas que Pipedrive rechaza aunque esté arriba (por su contenido). */
  rejectNote: undefined as undefined | ((content: string) => boolean),
  fieldsDown: false,
  dealStatus: 'open',
  created: 0,
}));

vi.mock('../_lib/whatsapp/claudeAgent.js', () => ({
  askClaude: vi.fn(async () => ({ parsed: sim.parsed, summary: 'Resumen de prueba.' })),
}));
vi.mock('../_lib/pipedrive/persons.js', () => ({
  findOrCreatePerson: vi.fn(async () => ({ personId: 7001, action: 'found' })),
}));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  createDeal: vi.fn(async (_params: Record<string, unknown>) => {
    if (!sim.created || sim.dealStatus !== 'open') {
      sim.created++;
      return { dealId: 9000 + sim.created, status: 'created' };
    }
    return { dealId: 9001, status: 'updated' };
  }),
  updateDeal: vi.fn(async () => {
    if (sim.fieldsDown) throw new Error('campos rechazados (simulado)');
  }),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({
  pipedrivePost: vi.fn(async (_path: string, note: { content: string; deal_id: number }) => {
    if (sim.noteDown || sim.rejectNote?.(note.content)) return { success: false, data: null };
    sim.notes.push(note);
    return { success: true, data: { id: sim.notes.length } };
  }),
}));
vi.mock('../_lib/whatsapp/notify.js', () => ({ notifyTeam: vi.fn(async () => {}) }));

const PHONE = '+56900000801';
const COMPLETE = {
  producto: 'focos LED', tipo_de_luz: 'calida', cantidad: '10', proyecto_o_uso: 'casa',
  comuna_o_ciudad: 'Maipu', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com',
};
// [CANTIDAD] PR 2: la cantidad de Claude vale solo si el texto del cliente la dice.
// [COMUNA] PR 3: la comuna tambien (de la lista oficial y con su frase de ubicacion).
const WRONG_RUT_ORDER = 'Necesito 10 focos LED para una casa en Maipu, RUT 77.123.456-8';
let redis: ReturnType<typeof createFakeRedis>;
let seq: number;
let webhook: typeof import('../whatsapp/webhook.js')['default'];

async function sendResponse(body: string, sid = 'SMpersist' + ++seq, extra: Record<string, string> = {}, handler = webhook) {
  const params = { From: 'whatsapp:' + PHONE, Body: body, MessageSid: sid, NumMedia: '0', ...extra };
  const req = Object.assign(Readable.from([Buffer.from(new URLSearchParams(params).toString())]), { method: 'POST', headers: {} });
  const res = {
    statusCode: 0, body: '',
    setHeader() { return res; },
    status(code: number) { res.statusCode = code; return res; },
    send(xml: string) { res.body = xml; return res; },
    end() { return res; },
  };
  await handler(req as never, res as never);
  return res;
}

async function send(body: string, sid = 'SMpersist' + ++seq, extra: Record<string, string> = {}, handler = webhook) {
  const res = await sendResponse(body, sid, extra, handler);
  expect(res.statusCode).toBe(200);
  return res.body;
}

async function snapshot() {
  const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
  return JSON.parse(redis.data.get(conversationKey(PHONE))!.value);
}

/** [PENDIENTES] La cola de escrituras pendientes del número (su propia clave en Upstash), de la más antigua a la más nueva. */
async function pendingQueue(): Promise<Array<{ dealId: number; note?: string; fields?: Record<string, string> }>> {
  const { pendingKey } = await import('../_lib/whatsapp/stateStore.js');
  const raw = redis.data.get(pendingKey(PHONE))?.value;
  const items = Object.values(raw ? JSON.parse(raw) as Record<string, string> : {}).map((v) => JSON.parse(v));
  return items.sort((a, b) => a.at - b.at).map((i) => i.write);
}

async function coldStart() {
  vi.resetModules();
  webhook = (await import('../whatsapp/webhook.js')).default;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  seq = 0;
  sim.parsed = {};
  sim.notes = [];
  sim.noteDown = false;
  sim.rejectNote = undefined;
  sim.fieldsDown = false;
  sim.dealStatus = 'open';
  sim.created = 0;
  redis = createFakeRedis();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake-token');
  vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_email');
  vi.stubGlobal('fetch', fakeFetch(redis));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  webhook = (await import('../whatsapp/webhook.js')).default;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('R121-03: reintentos de Twilio', () => {
  it('reserva antes de Claude y el reintento espera done para repetir el XML exacto', async () => {
    vi.useFakeTimers();
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    const { messageKey } = await import('../_lib/whatsapp/stateStore.js');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(askClaude).mockImplementationOnce(async () => {
      expect(JSON.parse(redis.data.get(messageKey('SMsame'))!.value).status).toBe('in_progress');
      entered();
      await blocked;
      return { parsed: {}, summary: '' } as Awaited<ReturnType<typeof askClaude>>;
    });
    const first = send('Hola', 'SMsame');
    await started;
    let finished = false;
    const retry = send('Hola', 'SMsame').then(xml => { finished = true; return xml; });
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(finished).toBe(false);
      expect(askClaude).toHaveBeenCalledTimes(1);
    } finally { release(); }
    const xml = await first;
    await vi.advanceTimersByTimeAsync(100);
    expect(await retry).toBe(xml);
    await coldStart();
    expect(await send('Hola', 'SMsame')).toBe(xml);
    expect(askClaude).toHaveBeenCalledTimes(1);
    expect(redis.data.get(messageKey('SMsame'))!.ttl).toBe(86400);
  });

  it('si sigue en curso responde 503 dentro del presupuesto y permite reintentar al vencer la reserva', async () => {
    vi.useFakeTimers();
    const { claimMessage, messageKey, MESSAGE_RETRY_WAIT_MS, MESSAGE_IN_PROGRESS_TTL_S } = await import('../_lib/whatsapp/stateStore.js');
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    expect(await claimMessage('SMpending')).toEqual({ proceed: true });
    const startedAt = Date.now();
    let finished = false;
    const retry = sendResponse('Hola', 'SMpending').then(res => { finished = true; return res; });
    await vi.advanceTimersByTimeAsync(MESSAGE_RETRY_WAIT_MS - 1);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await retry;
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('');
    expect(Date.now() - startedAt).toBe(3_000);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(askClaude).not.toHaveBeenCalled();
    expect(await import('../_lib/whatsapp/conversation.js').then(m => m.getHistory(PHONE))).toEqual([]);
    expect(JSON.parse(redis.data.get(messageKey('SMpending'))!.value).status).toBe('in_progress');
    await vi.advanceTimersByTimeAsync(MESSAGE_IN_PROGRESS_TTL_S * 1000 - MESSAGE_RETRY_WAIT_MS);
    expect(await send('Hola', 'SMpending')).toContain('<Message>');
    expect(askClaude).toHaveBeenCalledTimes(1);
    expect(redis.data.get(messageKey('SMpending'))!.ttl).toBe(86400);
  });

  it('un reintento no consume la repregunta del RUT ni crea el negocio', async () => {
    sim.parsed = COMPLETE;
    const xml = await send('RUT 77.123.456-8', 'SMinvalid');
    expect(await send('RUT 77.123.456-8', 'SMinvalid')).toBe(xml);
    expect(sim.created).toBe(0);
    expect((await snapshot()).flow.rutRetryAsked).toBe(true);
  });

  it.each([{ Body: '', NumMedia: '1' }, { Body: '', NumMedia: '0' }])('tambien recuerda adjuntos y mensajes vacios: %j', async (extra) => {
    const first = await send('', 'SMearly', extra);
    expect(await send('', 'SMearly', extra)).toBe(first);
    expect(first).toContain('Privacidad:');
  });
});

describe('R121-04: estado compartido y respaldo', () => {
  it('recupera historial, campos, repregunta y privacidad despues de perder toda la memoria', async () => {
    sim.parsed = COMPLETE;
    await send(WRONG_RUT_ORDER);
    const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    const key = conversationKey(PHONE);
    expect(key).not.toContain(PHONE);
    expect(key).toMatch(/:[a-f0-9]{64}$/);
    expect(redis.data.get(key)!.ttl).toBe(604800);
    const before = await snapshot();
    expect(before.privacyShown).toBe(true);
    expect(before.history[0].content).toBe(WRONG_RUT_ORDER);
    await coldStart();
    sim.parsed = {};
    const reply = await send('771234569');
    expect(reply).not.toContain('Privacidad:');
    const after = await snapshot();
    expect(after.flow.captured).toMatchObject({ rut: '77.123.456-9', cantidad: '10', correo: COMPLETE.correo });
    expect(after.flow.dealId).toBe(9001);
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    expect(vi.mocked(askClaude).mock.calls.at(-1)![0]).toEqual(before.history);
    expect(sim.created).toBe(1);
  });

  it('Upstash caido: responde, conserva memoria y registra el respaldo', async () => {
    redis.down = true;
    sim.parsed = COMPLETE;
    expect(await send(WRONG_RUT_ORDER)).toContain('no calza');
    sim.parsed = {};
    expect(await send('771234569')).toContain('registrad');
    expect(sim.created).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Upstash no disponible'));
  });

  it.each(['anterior', 'ausente', 'sin fecha'])('con candado recuperado guarda el respaldo local más nuevo frente a Redis %s', async mode => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { conversationKey, conversationLockKey } = await import('../_lib/whatsapp/stateStore.js');
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    sim.parsed = COMPLETE;
    await send('Es en Maipu, RUT 77.123.456-8');
    const before = await snapshot();
    vi.setSystemTime(Date.now() + 1_000);
    redis.down = true;
    sim.parsed = {};
    await send('771234569');
    const localUpdatedAt = Date.now();
    redis.down = false;
    if (mode === 'ausente') redis.data.delete(conversationKey(PHONE));
    if (mode === 'sin fecha') {
      delete before.updatedAt;
      redis.data.get(conversationKey(PHONE))!.value = JSON.stringify(before);
    }
    vi.setSystemTime(Date.now() + 1_000);
    vi.mocked(askClaude).mockImplementationOnce(async () => {
      expect(redis.data.has(conversationLockKey(PHONE))).toBe(true);
      const synced = await snapshot();
      expect(synced.updatedAt).toBe(localUpdatedAt);
      expect(synced.flow.dealId).toBe(9001);
      expect(synced.history.some((t: { content: string }) => t.content === '771234569')).toBe(true);
      return { parsed: {}, summary: '' } as Awaited<ReturnType<typeof askClaude>>;
    });
    await send('gracias');
    const after = await snapshot();
    expect(after.flow.captured.rut).toBe('77.123.456-9');
    expect(after.flow.dealId).toBe(9001);
    expect(after.updatedAt).toBe(Date.now());
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt ?? 0);
    expect(sim.created).toBe(1);
  });

  // [CONCURRENCIA] Antes esta prueba exigía que la instancia que se recupera descartara entero lo que no
  // alcanzó a guardar, incluido un mensaje ya respondido ('771234569'): es la pérdida que señala H3. Ahora
  // se mezcla en tres vías: en los datos que cambiaron los dos lados prevalece Redis (su mensaje llegó
  // después o a la vez), y ningún mensaje respondido sale del historial.
  it.each([0, 1_000])('con candado recuperado mezcla: prevalece Redis en lo que cambiaron los dos (%i ms) y no se pierde el mensaje local', async delta => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    const localInstance = webhook;
    sim.parsed = COMPLETE;
    await send('Es en Maipu, RUT 77.123.456-8');
    const base = await snapshot();
    vi.setSystemTime(Date.now() + 1_000);
    redis.down = true;
    sim.parsed = {};
    await send('771234569');
    redis.down = false;
    vi.setSystemTime(Date.now() + delta);
    // Otra instancia avanza el estado compartido mientras la primera sigue sucia.
    await coldStart();
    await send('Otra consulta ficticia');
    const shared = await snapshot();
    vi.setSystemTime(Date.now() + 1_000);
    await send('gracias', 'SMrecovered', {}, localInstance);
    const after = await snapshot();
    const users = after.history.filter((t: { role: string }) => t.role === 'user').map((t: { content: string }) => t.content);
    expect(users).toEqual(expect.arrayContaining(['Es en Maipu, RUT 77.123.456-8', '771234569', 'Otra consulta ficticia', 'gracias']));
    expect(users.at(-1)).toBe('gracias');
    for (const [field, value] of Object.entries(shared.flow.captured)) {
      if (JSON.stringify(value) !== JSON.stringify(base.flow.captured[field])) expect(after.flow.captured[field]).toEqual(value);
    }
    // Los dos mensajes llegan a ventas: siguen en la transcripción o fueron en la nota del negocio.
    const kept = sim.notes.map((n) => n.content).join('\n') + JSON.stringify(after.transcript.entries);
    for (const text of ['771234569', 'Otra consulta ficticia', 'gracias']) expect(kept).toContain(text);
    // No vuelve a quedar dirty después de elegir el estado compartido.
    redis.data.delete(conversationKey(PHONE));
    expect(await send('Hola', 'SMclean', {}, localInstance)).toContain('Privacidad:');
    expect(sim.created).toBe(1);
  });

  it('aunque Claude lo devuelva como cantidad, la respuesta de RUT no pisa las unidades', async () => {
    sim.parsed = COMPLETE;
    await send(WRONG_RUT_ORDER);
    sim.parsed = { cantidad: '771234569' };
    await send('771234569');
    expect((await snapshot()).flow.captured.cantidad).toBe('10');
  });

  it('sin estado previo no acepta un numero aislado por su digito verificador', async () => {
    await send('771234569');
    expect((await snapshot()).flow.captured.rut).toBeUndefined();
  });

  it('el respaldo local tambien vence a los 7 dias cuando Upstash sigue caido', async () => {
    redis.down = true;
    expect(await send('Hola')).toContain('Privacidad:');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 604800000);
    expect(await send('Hola')).toContain('Privacidad:');
  });

  it('un estado vencido en Redis se descarta tambien en la instancia caliente', async () => {
    await send('Hola');
    const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    redis.data.delete(conversationKey(PHONE)); // simula la expiracion en Redis
    expect(await send('Hola')).toContain('Privacidad:');
  });
});

describe('R121-05/06 y R120-04: escrituras pendientes en el negocio guardado', () => {
  it.each(['won', 'lost'])('la correccion tardia sobre un negocio %s no crea otro, incluso tras reinicio', async (status) => {
    sim.parsed = COMPLETE;
    await send(WRONG_RUT_ORDER);
    sim.parsed = {};
    await send('lo reviso despues');
    sim.dealStatus = status;
    await coldStart();
    await send('Necesito corregir el RUT: 77.123.456-9');
    const { createDeal } = await import('../_lib/pipedrive/deals.js');
    expect(createDeal).toHaveBeenCalledTimes(1);
    expect(sim.created).toBe(1);
    expect(sim.notes.map((n) => n.deal_id)).toEqual([9001, 9001]);
    expect(sim.notes[1].content).toContain('77.123.456-9 (empresa)');
  });

  it('success:false deja la correccion pendiente; tras reinicio reintenta una sola nota', async () => {
    sim.parsed = COMPLETE;
    await send(WRONG_RUT_ORDER);
    sim.parsed = {};
    await send('lo reviso despues');
    sim.noteDown = true;
    await send('RUT 77.123.456-9');
    expect((await pendingQueue())[0]).toMatchObject({ dealId: 9001, note: expect.stringContaining('77.123.456-9 (empresa)') });
    expect(sim.notes).toHaveLength(1);
    await coldStart();
    sim.noteDown = false;
    await send('gracias');
    await send('gracias de nuevo');
    expect(sim.notes).toHaveLength(2);
    expect(await pendingQueue()).toEqual([]);
    expect(sim.created).toBe(1);
  });

  it('la ambiguedad que llega despues del cierre tambien queda anotada en ese negocio', async () => {
    sim.parsed = COMPLETE;
    await send('Necesito 10 focos LED para una casa en Maipu');
    sim.parsed = {};
    await send('11.111.111-1; 77.123.456-9');
    expect(sim.created).toBe(1);
    expect(sim.notes[1].content).toContain('varios RUT en el mensaje: revisar');
    expect(sim.notes[1].content).toContain('RUT: -');
  });

  it('un cierre nuevo que reutiliza un negocio tambien conserva y reintenta su nota rechazada', async () => {
    sim.parsed = COMPLETE;
    await send('Necesito 10 focos LED para una casa en Maipu');
    sim.noteDown = true;
    await send('Necesito 20 focos LED para una casa en Maipu');
    expect(await pendingQueue()).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
    sim.parsed = {};
    sim.noteDown = false;
    await send('gracias');
    await send('gracias otra vez');
    expect(sim.notes).toHaveLength(2);
    expect(sim.notes.every((n) => n.deal_id === 9001)).toBe(true);
    expect(sim.created).toBe(1);
  });

  it('si solo fallan los campos, reintenta los campos sin repetir la nota confirmada', async () => {
    sim.parsed = COMPLETE;
    sim.fieldsDown = true;
    await send('Necesito 10 focos LED para una casa en Maipu');
    expect((await pendingQueue())[0]).toMatchObject({ dealId: 9001 });
    expect((await pendingQueue())[0].note).toBeUndefined();
    sim.fieldsDown = false;
    sim.parsed = {};
    await send('gracias');
    expect(sim.notes).toHaveLength(1);
    expect(await pendingQueue()).toEqual([]);
  });
});

describe('R121-02: ambiguedad registrada sin asignar un RUT al cliente', () => {
  it('lista ambos en la nota y no clasifica por el RUT del proveedor', async () => {
    sim.parsed = COMPLETE;
    await send('Necesito 10 focos LED para una casa en Maipu, RUT 11.111.111-1; RUT 77.123.456-9');
    const { createDeal } = await import('../_lib/pipedrive/deals.js');
    expect(vi.mocked(createDeal).mock.calls[0][0]).toMatchObject({ leadType: 'B2C' });
    expect(sim.notes[0].content).toContain('RUT: -');
    expect(sim.notes[0].content).toContain('varios RUT en el mensaje: revisar\n11.111.111-1\n77.123.456-9');
    expect((await snapshot()).flow.captured.rut).toBeUndefined();
  });
});


describe('segunda tanda: candado entre instancias', () => {
  it('dos módulos separados leen bajo candado: conserva historial, campos y dealId', async () => {
    const firstInstance = webhook;
    // Esta instancia ya tiene un caché anterior al negocio que creará la otra.
    await send('Hola');
    await coldStart();
    const secondInstance = webhook;
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    let release!: () => void;
    const blocked = new Promise<void>(r => { release = r; });
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    vi.mocked(askClaude).mockImplementationOnce(async () => {
      entered();
      await blocked;
      return { parsed: COMPLETE, summary: 'Prueba' } as Awaited<ReturnType<typeof askClaude>>;
    });
    const first = send('Necesito 10 focos LED', 'SMinstanceA', {}, secondInstance);
    await started;
    const callsBefore = vi.mocked(askClaude).mock.calls.length;
    const second = send('gracias', 'SMinstanceB', {}, firstInstance);
    try {
      await new Promise(r => setTimeout(r, 30));
      expect(askClaude).toHaveBeenCalledTimes(callsBefore);
    } finally { release(); }
    await Promise.all([first, second]);
    const state = await snapshot();
    expect(state.flow.dealId).toBe(9001);
    expect(state.flow.captured.cantidad).toBe('10');
    expect(state.history.filter((t: { role: string }) => t.role === 'user').map((t: { content: string }) => t.content))
      .toEqual(['Hola', 'Necesito 10 focos LED', 'gracias']);
    expect(vi.mocked(askClaude).mock.calls.at(-1)![0].some(t => t.content === 'Necesito 10 focos LED')).toBe(true);
    expect(sim.created).toBe(1);
    const { conversationLockKey, conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    expect(conversationLockKey(PHONE)).toBe('lock:' + conversationKey(PHONE));
    expect(conversationLockKey(PHONE)).not.toContain(PHONE);
    expect(redis.data.has(conversationLockKey(PHONE))).toBe(false);
  });

  it('un candado vencido no bloquea ni puede borrar el de su sucesor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { acquireConversationLock, conversationLockKey, CONVERSATION_LOCK_TTL_MS } = await import('../_lib/whatsapp/stateStore.js');
    expect(CONVERSATION_LOCK_TTL_MS).toBe(25_000);
    const first = await acquireConversationLock(PHONE, 1000);
    expect(first.acquired).toBe(true);
    expect(redis.data.get(conversationLockKey(PHONE))!.ttl).toBe(25_000);
    const oldToken = redis.data.get(conversationLockKey(PHONE))!.value;
    vi.setSystemTime(Date.now() + CONVERSATION_LOCK_TTL_MS);
    const second = await acquireConversationLock(PHONE, 1000);
    expect(second.acquired).toBe(true);
    expect(redis.data.get(conversationLockKey(PHONE))!.value).not.toBe(oldToken);
    await first.release();
    expect(redis.data.has(conversationLockKey(PHONE))).toBe(true);
    await second.release();
    expect(redis.data.has(conversationLockKey(PHONE))).toBe(false);
  });

  it('contención respeta maxWaitMs, registra y permite seguir sin candado', async () => {
    vi.useFakeTimers();
    const { acquireConversationLock } = await import('../_lib/whatsapp/stateStore.js');
    const first = await acquireConversationLock(PHONE, 1000);
    const waiting = acquireConversationLock(PHONE, 250);
    await vi.advanceTimersByTimeAsync(249);
    let finished = false;
    void waiting.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await waiting).acquired).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Espera del candado agotada'));
    await first.release();
  });

  it('Upstash caído deja continuar y registra la caída del candado', async () => {
    redis.down = true;
    await send('Hola');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('candado de conversación'));
  });

  it('libera en finally incluso si falla persistir/procesar fuera del flujo', async () => {
    const { conversationLockKey } = await import('../_lib/whatsapp/stateStore.js');
    const spy = vi.spyOn(await import('../_lib/whatsapp/pipedriveLead.js'), 'retryWhatsAppWrite').mockRejectedValueOnce(new Error('fallo simulado'));
    const { setPendingWrites, persistConversation } = await import('../_lib/whatsapp/stateStore.js');
    setPendingWrites(PHONE, [{ dealId: 9001, note: 'Nota ficticia' }]);
    await persistConversation(PHONE);
    await expect(send('Hola')).rejects.toThrow('fallo simulado');
    expect(spy).toHaveBeenCalled();
    expect(redis.data.has(conversationLockKey(PHONE))).toBe(false);
    spy.mockRestore();
  });
});

describe('segunda tanda: caducidad de MessageSid y corrección tardía', () => {
  it('una ejecución muerta permite reintentar a los 75 s; done conserva 24 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { claimMessage, messageKey, MESSAGE_IN_PROGRESS_TTL_S } = await import('../_lib/whatsapp/stateStore.js');
    expect(MESSAGE_IN_PROGRESS_TTL_S).toBe(75);
    expect(await claimMessage('SMdead')).toEqual({ proceed: true });
    expect(redis.data.get(messageKey('SMdead'))!.ttl).toBe(75);
    vi.setSystemTime(Date.now() + 74999);
    expect(await claimMessage('SMdead', 0)).toEqual({ proceed: false });
    vi.setSystemTime(Date.now() + 1);
    expect(await send('Hola', 'SMdead')).toContain('<Message>');
    expect(redis.data.get(messageKey('SMdead'))!.ttl).toBe(86400);
  });

  it.each(['cambiar', 'cambio', 'modificar'])('«%s el RUT» conserva el negocio y todos los datos', async verb => {
    sim.parsed = COMPLETE;
    await send('Necesito 10 focos LED para una casa en Maipu');
    sim.parsed = {};
    const before = await snapshot();
    await send('necesito ' + verb + ' el RUT de la factura: 77.123.456-9');
    const after = await snapshot();
    expect(after.flow.dealId).toBe(before.flow.dealId);
    expect(after.flow.firstMessageAt).toBe(before.flow.firstMessageAt);
    expect(after.flow.captured).toMatchObject({ ...before.flow.captured, rut: '77.123.456-9' });
    expect(sim.created).toBe(1);
    expect(sim.notes.at(-1)).toMatchObject({ deal_id: 9001, content: expect.stringContaining('77.123.456-9') });
  });

  it('una solicitud nueva sin «rut» sigue empezando desde cero', async () => {
    sim.parsed = COMPLETE;
    await send('Necesito 10 focos LED para una casa en Maipu');
    sim.parsed = { producto: 'paneles LED' };
    await send('Necesito cambiar a paneles LED');
    const state = (await snapshot()).flow;
    expect(state.dealId).toBeUndefined();
    expect(state.captured.producto).toBe('paneles LED');
    expect(state.captured.correo).toBeUndefined();
    expect(state.stage).not.toBe('closed');
  });
});

describe('PR 3 (B1): la transcripción en el estado compartido', () => {
  it('sobrevive a un reinicio: se restaura del estado guardado y la nota trae los mensajes anteriores', async () => {
    sim.parsed = { producto: 'focos LED', tipo_de_luz: 'calida', cantidad: '10', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipu' };
    await send('Necesito 10 focos LED luz calida para una casa en Maipu');
    const saved = (await snapshot()).transcript;
    expect(saved.entries.map((e: { role: string }) => e.role)).toEqual(['cliente', 'bot']);
    expect(saved.entries.every((e: { seq: unknown }) => Number.isSafeInteger(e.seq))).toBe(true);
    await coldStart();
    sim.parsed = { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
    await send('Soy Ana Prueba, ana.prueba@example.com');
    expect(sim.notes).toHaveLength(1);
    const transcript = sim.notes[0].content.slice(sim.notes[0].content.indexOf('-- TRANSCRIPCI'));
    expect(transcript).not.toContain('Puede faltar el inicio');
    expect(transcript).toMatch(/\] Cliente: Necesito 10 focos LED luz calida para una casa en Maipu\n\[[^\]]+\] Bot: /);
    expect(transcript).toContain('] Cliente: Soy Ana Prueba, ana.prueba@example.com');
    // Lo anotado se borra del estado guardado: el pedido siguiente no lo arrastra.
    expect((await snapshot()).transcript.entries).toEqual([]);
  });

  // [PENDIENTES] H2: antes esta prueba exigía descartar las más antiguas sobre el tope de 3; una nota
  // descartada ya había salido de la transcripción y no llegaba nunca a ventas. Ahora la cola tiene su
  // propia clave y presupuesto, y no se descarta ninguna escritura sin confirmar.
  it('H2: cuatro notas rechazadas y Pipedrive se recupera: llegan las cuatro, en orden', async () => {
    sim.parsed = COMPLETE;
    sim.noteDown = true;
    for (let i = 1; i <= 4; i++) await send('Necesito ' + (10 + i) + ' focos LED para una casa en Maipu');
    const queued = await pendingQueue();
    expect(queued.map((w) => w.note!.match(/Cliente: Necesito (\d+) focos/)![1])).toEqual(['11', '12', '13', '14']);
    // El estado guardado ya no lleva las notas: solo el campo vacío, para la versión anterior.
    expect((await snapshot()).pending).toEqual([]);
    sim.noteDown = false;
    sim.parsed = {};
    await send('gracias');
    expect(sim.notes.map((n) => n.content.match(/Cliente: Necesito (\d+) focos/)![1])).toEqual(['11', '12', '13', '14']);
    expect(await pendingQueue()).toEqual([]);
  });

  it('H2: con la cola llena no entra otra, la transcripción se conserva y la nota siguiente la incluye; el aviso no lleva datos del cliente', async () => {
    const { MAX_PENDING_WRITES, MAX_PENDING_RETRIES_PER_TURN, pendingKey, PENDING_WRITE_TTL_S } = await import('../_lib/whatsapp/stateStore.js');
    expect(MAX_PENDING_WRITES).toBe(10);
    sim.parsed = COMPLETE;
    sim.noteDown = true;
    for (let i = 1; i <= MAX_PENDING_WRITES + 1; i++) await send('Necesito ' + (10 + i) + ' focos LED para una casa en Maipu');
    expect(await pendingQueue()).toHaveLength(MAX_PENDING_WRITES);
    expect(redis.data.get(pendingKey(PHONE))!.ttl).toBe(PENDING_WRITE_TTL_S);
    expect(pendingKey(PHONE)).not.toContain(PHONE.slice(1));
    // La undécima no entró a la cola: su mensaje sigue en la transcripción guardada.
    expect((await snapshot()).transcript.entries.map((e: { text: string }) => e.text)).toContain('Necesito 21 focos LED para una casa en Maipu');
    const logs = vi.mocked(console.error).mock.calls.map((c) => c.map(String).join(' ')).filter((l) => /Cola de escrituras pendientes llena/.test(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(PHONE.slice(1));
      expect(line).not.toContain('ana.prueba');
      expect(line).not.toContain('Necesito');
    }
    sim.noteDown = false;
    sim.parsed = {};
    // De a MAX_PENDING_RETRIES_PER_TURN por mensaje (Twilio espera 15 s), las más antiguas primero.
    for (let i = 0; i < Math.ceil(MAX_PENDING_WRITES / MAX_PENDING_RETRIES_PER_TURN); i++) await send('gracias ' + i);
    const delivered = sim.notes.map((n) => n.content.match(/Cliente: Necesito (\d+) focos/)![1]);
    expect(delivered).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
    expect(await pendingQueue()).toEqual([]);
    // La nota siguiente del negocio trae el pedido que no entró a la cola.
    sim.parsed = COMPLETE;
    await send('Necesito 22 focos LED para una casa en Maipu');
    const last = sim.notes.at(-1)!.content;
    expect(last).toContain('Cliente: Necesito 21 focos LED para una casa en Maipu');
    expect(last).toContain('Cliente: Necesito 22 focos LED para una casa en Maipu');
  });

  // [PENDIENTES] Verificador: con la cola llena, una escritura de solo campos (la nota llegó, los campos del
  // negocio no) se descartaba sin aviso útil y el correo nuevo no llegaba nunca al negocio.
  it('con la cola llena, los campos rechazados del negocio (el correo nuevo) quedan pendientes y llegan cuando Pipedrive se recupera', async () => {
    const { MAX_PENDING_WRITES } = await import('../_lib/whatsapp/stateStore.js');
    const { updateDeal } = await import('../_lib/pipedrive/deals.js');
    sim.parsed = COMPLETE;
    sim.noteDown = true;
    for (let i = 1; i <= MAX_PENDING_WRITES; i++) await send('Necesito ' + (10 + i) + ' focos LED para una casa en Maipu');
    expect(await pendingQueue()).toHaveLength(MAX_PENDING_WRITES);
    // Pipedrive acepta las notas nuevas, pero sigue rechazando las de la cola y los campos del negocio.
    sim.noteDown = false;
    sim.rejectNote = (content) => /Cliente: Necesito (1\d|20) focos/.test(content);
    sim.fieldsDown = true;
    sim.parsed = { ...COMPLETE, correo: 'ana.nueva@example.com' };
    const notesBefore = sim.notes.length;
    await send('Necesito 30 focos LED para una casa en Maipu, mi correo es ana.nueva@example.com');
    expect(sim.notes.length).toBe(notesBefore + 1);
    const queued = await pendingQueue();
    expect(queued.filter((w) => w.note !== undefined)).toHaveLength(MAX_PENDING_WRITES);
    expect(queued.filter((w) => w.note === undefined && w.fields?.cf_email === 'ana.nueva@example.com')).toHaveLength(1);
    // Pipedrive se recupera del todo: todo lo pendiente llega, también los campos con el correo nuevo.
    sim.rejectNote = undefined;
    sim.fieldsDown = false;
    sim.parsed = {};
    const callsBefore = vi.mocked(updateDeal).mock.calls.length;
    for (let i = 1; i <= 4; i++) await send('gracias ' + i);
    const later = vi.mocked(updateDeal).mock.calls.slice(callsBefore);
    expect(later.some(([, fields]) => (fields as Record<string, string>).cf_email === 'ana.nueva@example.com')).toBe(true);
    expect(await pendingQueue()).toEqual([]);
  });

  it('los campos sin confirmar de un mismo negocio quedan en una sola escritura, con los valores más nuevos', async () => {
    sim.parsed = COMPLETE;
    sim.fieldsDown = true;
    await send('Necesito 10 focos LED para una casa en Maipu');
    sim.parsed = { ...COMPLETE, correo: 'ana.nueva@example.com' };
    await send('Necesito 20 focos LED para una casa en Maipu, mi correo es ana.nueva@example.com');
    const queued = await pendingQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ dealId: 9001, fields: { cf_email: 'ana.nueva@example.com' } });
    expect(queued[0].note).toBeUndefined();
  });
});

describe('R14: MessageSid repetido con Upstash caído', () => {
  it('la segunda entrega responde lo mismo y no vuelve a registrar el mensaje', async () => {
    redis.down = true;
    const first = await send('Hola', 'SMlocalDup');
    expect(await send('Hola', 'SMlocalDup')).toBe(first);
    const { askClaude } = await import('../_lib/whatsapp/claudeAgent.js');
    expect(askClaude).toHaveBeenCalledTimes(1);
    const { getTranscript } = await import('../_lib/whatsapp/transcript.js');
    expect(getTranscript(PHONE)!.entries.map((e) => e.role)).toEqual(['cliente', 'bot']);
    const { getHistory } = await import('../_lib/whatsapp/conversation.js');
    expect(getHistory(PHONE).filter((t) => t.role === 'user')).toHaveLength(1);
    // Otro MessageSid se atiende normal.
    await send('Hola de nuevo', 'SMlocalOther');
    expect(askClaude).toHaveBeenCalledTimes(2);
  });

  it('el registro local es acotado: 500 mensajes, 10 minutos los respondidos y 75 s los que siguen en curso', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    redis.down = true;
    const { claimMessage, completeMessage, MESSAGE_IN_PROGRESS_TTL_S } = await import('../_lib/whatsapp/stateStore.js');
    expect(await claimMessage('SMold', 0)).toEqual({ proceed: true });
    for (let i = 0; i < 500; i++) await claimMessage('SMfill' + i, 0);
    expect(await claimMessage('SMfill499', 0)).toEqual({ proceed: false });
    expect(await claimMessage('SMold', 0)).toEqual({ proceed: true }); // el más antiguo salió del registro
    await completeMessage('SMdone', '<Response/>');
    vi.setSystemTime(Date.now() + 10 * 60_000 - 1);
    expect(await claimMessage('SMdone', 0)).toEqual({ proceed: false, response: '<Response/>' });
    vi.setSystemTime(Date.now() + 1);
    expect(await claimMessage('SMdone', 0)).toEqual({ proceed: true });
    expect(await claimMessage('SMstuck', 0)).toEqual({ proceed: true });
    vi.setSystemTime(Date.now() + MESSAGE_IN_PROGRESS_TTL_S * 1000);
    expect(await claimMessage('SMstuck', 0)).toEqual({ proceed: true });
  });
});
