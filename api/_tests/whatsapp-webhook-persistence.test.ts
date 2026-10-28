// Correcciones #121: webhook real, Upstash falso y Pipedrive/Claude simulados. Sin red.
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRedis, fakeFetch, UPSTASH_URL } from './fakeUpstash.js';

const sim = vi.hoisted(() => ({
  parsed: {} as Record<string, unknown>,
  notes: [] as Array<{ content: string; deal_id: number }>,
  noteDown: false,
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
    if (sim.noteDown) return { success: false, data: null };
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
    await send('RUT 77.123.456-8');
    const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    const key = conversationKey(PHONE);
    expect(key).not.toContain(PHONE);
    expect(key).toMatch(/:[a-f0-9]{64}$/);
    expect(redis.data.get(key)!.ttl).toBe(604800);
    const before = await snapshot();
    expect(before.privacyShown).toBe(true);
    expect(before.history[0].content).toBe('RUT 77.123.456-8');
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
    expect(await send('RUT 77.123.456-8')).toContain('no calza');
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
    await send('RUT 77.123.456-8');
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

  it.each([0, 1_000])('con candado recuperado prevalece Redis si su fecha supera a la local en %i ms', async delta => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { conversationKey } = await import('../_lib/whatsapp/stateStore.js');
    const localInstance = webhook;
    sim.parsed = COMPLETE;
    await send('RUT 77.123.456-8');
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
    expect(after.history.slice(0, -2)).toEqual(shared.history);
    expect(after.flow.captured.rut).toBe(shared.flow.captured.rut);
    expect(after.history.some((t: { content: string }) => t.content === '771234569')).toBe(false);
    // No vuelve a quedar dirty después de elegir el estado compartido.
    redis.data.delete(conversationKey(PHONE));
    expect(await send('Hola', 'SMclean', {}, localInstance)).toContain('Privacidad:');
    expect(sim.created).toBe(1);
  });

  it('aunque Claude lo devuelva como cantidad, la respuesta de RUT no pisa las unidades', async () => {
    sim.parsed = COMPLETE;
    await send('RUT 77.123.456-8');
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
    await send('RUT 77.123.456-8');
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
    await send('RUT 77.123.456-8');
    sim.parsed = {};
    await send('lo reviso despues');
    sim.noteDown = true;
    await send('RUT 77.123.456-9');
    expect((await snapshot()).pending[0]).toMatchObject({ dealId: 9001, note: expect.stringContaining('77.123.456-9 (empresa)') });
    expect(sim.notes).toHaveLength(1);
    await coldStart();
    sim.noteDown = false;
    await send('gracias');
    await send('gracias de nuevo');
    expect(sim.notes).toHaveLength(2);
    expect((await snapshot()).pending).toEqual([]);
    expect(sim.created).toBe(1);
  });

  it('la ambiguedad que llega despues del cierre tambien queda anotada en ese negocio', async () => {
    sim.parsed = COMPLETE;
    await send('Necesito 10 focos LED');
    sim.parsed = {};
    await send('11.111.111-1; 77.123.456-9');
    expect(sim.created).toBe(1);
    expect(sim.notes[1].content).toContain('varios RUT en el mensaje: revisar');
    expect(sim.notes[1].content).toContain('RUT: -');
  });

  it('un cierre nuevo que reutiliza un negocio tambien conserva y reintenta su nota rechazada', async () => {
    sim.parsed = COMPLETE;
    await send('Necesito 10 focos LED');
    sim.noteDown = true;
    await send('Necesito 20 focos LED');
    expect((await snapshot()).pending).toHaveLength(1);
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
    await send('Necesito 10 focos LED');
    expect((await snapshot()).pending[0].note).toBeUndefined();
    sim.fieldsDown = false;
    sim.parsed = {};
    await send('gracias');
    expect(sim.notes).toHaveLength(1);
    expect((await snapshot()).pending).toEqual([]);
  });
});

describe('R121-02: ambiguedad registrada sin asignar un RUT al cliente', () => {
  it('lista ambos en la nota y no clasifica por el RUT del proveedor', async () => {
    sim.parsed = COMPLETE;
    await send('RUT 11.111.111-1; RUT 77.123.456-9');
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
    await send('Necesito 10 focos LED');
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
    await send('Necesito 10 focos LED');
    sim.parsed = { producto: 'paneles LED' };
    await send('Necesito cambiar a paneles LED');
    const state = (await snapshot()).flow;
    expect(state.dealId).toBeUndefined();
    expect(state.captured.producto).toBe('paneles LED');
    expect(state.captured.correo).toBeUndefined();
    expect(state.stage).not.toBe('closed');
  });
});
