// api/_tests/whatsapp-webhook.test.ts
// Aviso de privacidad del asistente de WhatsApp (Etapa 2 · PR 13w), de punta a punta en el
// webhook: la primera respuesta a cada número lleva el aviso al final (también si es un
// adjunto o un mensaje vacío) y las siguientes no; el aviso no entra al historial que va a
// Claude, ni a Pipedrive, ni al aviso al equipo, ni al log QA; si Claude o el paso del flujo
// fallan se responde igual; un 405, un 403 o un error antes de enviar no marcan el número; si la respuesta sale
// después del plazo de Twilio, lleva el aviso pero el número no se marca. Claude, Pipedrive y
// el aviso al equipo están simulados (sin red) y el reloj, cuando hace falta, también. Vive en
// api/_tests/ para que Vercel no lo despliegue como función.

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/whatsapp/claudeAgent.js', () => ({ askClaude: vi.fn() }));
vi.mock('../_lib/whatsapp/pipedriveLead.js', () => ({ ensureWhatsAppDeal: vi.fn() }));
vi.mock('../_lib/whatsapp/notify.js', () => ({ notifyTeam: vi.fn() }));

import handler from '../whatsapp/webhook';
import { askClaude } from '../_lib/whatsapp/claudeAgent.js';
import { ensureWhatsAppDeal } from '../_lib/whatsapp/pipedriveLead.js';
import { notifyTeam } from '../_lib/whatsapp/notify.js';
import { getHistory } from '../_lib/whatsapp/conversation.js';
import { MSG1, MSG4, MSG_DEAL_FAILED, MSG_MEDIA } from '../_lib/whatsapp/flowEngine.js';
import { buildTwiML } from '../_lib/whatsapp/twilio.js';
import { PRIVACY_NOTICE, PRIVACY_POLICY_URL } from '../_lib/whatsapp/privacyNotice.js';

type Handler = (req: unknown, res: unknown) => Promise<void>;
const webhook = handler as unknown as Handler;

const EMPTY_BODY_REPLY = 'Hola! No recibimos tu mensaje. Puedes escribirlo de nuevo?';
const withNotice = (reply: string) => buildTwiML(reply + '\n\n' + PRIVACY_NOTICE);

let phoneSeq = 0;
/** Un número de prueba nuevo en cada llamada: el estado del bot vive en memoria del módulo. */
const nextPhone = () => '+56900013' + String(++phoneSeq).padStart(3, '0');

interface FakeRes {
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
  ended: boolean;
  setHeader(name: string, value: string): FakeRes;
  status(code: number): FakeRes;
  send(body: string): FakeRes;
  end(): FakeRes;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    headers: {},
    ended: false,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(body) {
      res.body = body;
      res.ended = true;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

function fakeReq(params: Record<string, string>, init: { method?: string; headers?: Record<string, string> } = {}) {
  const raw = Buffer.from(new URLSearchParams(params).toString(), 'utf-8');
  return Object.assign(Readable.from([raw]), {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(init.headers ?? {}) },
  });
}

/** Un mensaje de WhatsApp tal como lo manda Twilio. */
async function sendMessage(phone: string, body: string, extra: Record<string, string> = {}): Promise<FakeRes> {
  const res = fakeRes();
  await webhook(
    fakeReq({
      From: 'whatsapp:' + phone,
      Body: body,
      ProfileName: 'PRUEBA 13w',
      MessageSid: 'SM' + phone.replace(/\D/g, ''),
      NumMedia: '0',
      ...extra,
    }),
    res,
  );
  return res;
}

const claudeOk = (parsed: Record<string, unknown> = {}) => ({
  reply: '',
  summary: 'Resumen de prueba',
  shouldCreateDeal: false,
  shouldNotify: false,
  parsed: { wantsHuman: false, qualifiesForDeal: false, summary: 'Resumen de prueba', ...parsed },
});

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
  vi.mocked(askClaude).mockResolvedValue(claudeOk());
  vi.mocked(ensureWhatsAppDeal).mockResolvedValue({ action: 'created', dealId: 101, personId: 202 });
  vi.mocked(notifyTeam).mockResolvedValue(undefined);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('primera respuesta a cada número: la respuesta y después el aviso', () => {
  it('"Hola" de un número nuevo: MSG1 y el aviso; el segundo mensaje va sin aviso', async () => {
    const phone = nextPhone();
    const first = await sendMessage(phone, 'Hola');
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('text/xml');
    expect(first.body).toBe(withNotice(MSG1));
    // La respuesta se lee primero: el aviso va después de una línea en blanco.
    expect(first.body!.indexOf(MSG1.slice(0, 40))).toBeLessThan(first.body!.indexOf('Privacidad:'));

    const second = await sendMessage(phone, 'Hola');
    expect(second.body).toBe(buildTwiML(MSG1));
    expect(second.body).not.toContain('Privacidad:');
    expect(second.body).not.toContain(PRIVACY_POLICY_URL);
  });

  it('un adjunto sin texto como primer mensaje: MSG_MEDIA y el aviso; el siguiente texto va sin aviso', async () => {
    const phone = nextPhone();
    const media = await sendMessage(phone, '', { NumMedia: '1' });
    expect(media.statusCode).toBe(200);
    expect(media.body).toBe(withNotice(MSG_MEDIA));
    expect(askClaude).not.toHaveBeenCalled();

    const text = await sendMessage(phone, 'Hola');
    expect(text.body).toBe(buildTwiML(MSG1));
  });

  it('un mensaje vacío como primer mensaje: el texto fijo y el aviso; el siguiente va sin aviso', async () => {
    const phone = nextPhone();
    const empty = await sendMessage(phone, '   ');
    expect(empty.statusCode).toBe(200);
    expect(empty.body).toBe(withNotice(EMPTY_BODY_REPLY));

    const text = await sendMessage(phone, 'Hola');
    expect(text.body).toBe(buildTwiML(MSG1));
  });

  it('cada número recibe el suyo', async () => {
    const a = nextPhone();
    const b = nextPhone();
    expect((await sendMessage(a, 'Hola')).body).toBe(withNotice(MSG1));
    expect((await sendMessage(b, 'Hola')).body).toBe(withNotice(MSG1));
    expect((await sendMessage(a, 'Hola')).body).toBe(buildTwiML(MSG1));
  });
});

describe('el aviso no se filtra a otros datos', () => {
  it('el historial guarda la respuesta exacta y el siguiente llamado a Claude no ve el aviso', async () => {
    const phone = nextPhone();
    await sendMessage(phone, 'Hola');
    expect(getHistory(phone)).toEqual([
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: MSG1 },
    ]);

    await sendMessage(phone, 'Necesito focos LED');
    expect(askClaude).toHaveBeenCalledTimes(2);
    const historySentToClaude = JSON.stringify(vi.mocked(askClaude).mock.calls[1][0]);
    expect(historySentToClaude).toContain('Soy el asistente');
    expect(historySentToClaude).not.toContain('Privacidad:');
    expect(JSON.stringify(getHistory(phone))).not.toContain('Privacidad:');
  });

  it('el log [QA:out] registra solo el largo de la respuesta, sin plantilla ni aviso', async () => {
    const phone = nextPhone();
    await sendMessage(phone, 'Hola');
    const qaOut = log.mock.calls.map(c => String(c[0])).find(line => line.includes('[QA:out]'));
    expect(qaOut).toBeDefined();
    const payload = JSON.parse(qaOut!.slice(qaOut!.indexOf('{')));
    expect(payload.reply_caracteres).toBe(MSG1.length);
    expect(payload).not.toHaveProperty('reply_preview');
    for (const call of log.mock.calls) {
      expect(String(call[0])).not.toContain('Privacidad:');
    }
  });

  it('Pipedrive y el aviso al equipo reciben los datos sin el aviso', async () => {
    const phone = nextPhone();
    const body = 'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Persona Prueba, prueba-13w@example.com';
    vi.mocked(askClaude).mockResolvedValueOnce(
      claudeOk({
        producto: 'ampolletas LED',
        tipo_de_luz: 'calida',
        cantidad: '10',
        proyecto_o_uso: 'casa',
        comuna_o_ciudad: 'Maipú',
        nombre: 'Persona Prueba',
        correo: 'prueba-13w@example.com',
        qualifiesForDeal: true,
      }),
    );
    const res = await sendMessage(phone, body);
    expect(res.body).toBe(withNotice(MSG4));

    expect(ensureWhatsAppDeal).toHaveBeenCalledTimes(1);
    const dealArgs = vi.mocked(ensureWhatsAppDeal).mock.calls[0][0];
    expect(dealArgs.body).toBe(body);
    expect(JSON.stringify(dealArgs)).not.toContain('Privacidad:');
    expect(JSON.stringify(dealArgs)).not.toContain(PRIVACY_POLICY_URL);

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    const notifyArgs = vi.mocked(notifyTeam).mock.calls[0][0];
    expect(notifyArgs.message).toBe(body);
    expect(JSON.stringify(notifyArgs)).not.toContain('Privacidad:');
    expect(JSON.stringify(notifyArgs)).not.toContain(PRIVACY_POLICY_URL);

    // Un flujo cerrado que se reinicia por un nuevo requerimiento no es un contacto nuevo.
    const again = await sendMessage(phone, 'Necesito 5 focos LED para el patio');
    expect(log.mock.calls.some(c => String(c[0]).includes('[flowEngine] nuevo requerimiento'))).toBe(true);
    expect(again.body).not.toContain('Privacidad:');
  });
});

describe('fallas: el bot responde igual y un error no marca el número', () => {
  it('si Claude falla, responde con la respuesta y el aviso', async () => {
    const phone = nextPhone();
    vi.mocked(askClaude).mockRejectedValueOnce(new Error('sin red'));
    const res = await sendMessage(phone, 'Hola');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(withNotice(MSG1));
  });

  it('si falla el paso del flujo, responde el texto B con el aviso (antes: un 500 sin respuesta)', async () => {
    const phone = nextPhone();
    // Un campo que lanza al leerse hace fallar processFlowStep.
    const parsed = { wantsHuman: false, qualifiesForDeal: false, summary: 'x' };
    Object.defineProperty(parsed, 'producto', {
      enumerable: true,
      get() {
        throw new Error('falla simulada');
      },
    });
    vi.mocked(askClaude).mockResolvedValueOnce({ ...claudeOk(), parsed } as Awaited<ReturnType<typeof askClaude>>);
    const res = await sendMessage(phone, 'Necesito focos LED');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(withNotice(MSG_DEAL_FAILED));
    expect(ensureWhatsAppDeal).not.toHaveBeenCalled();
  });

  it('si el envío falla antes de armar la respuesta, el número no queda marcado: el siguiente mensaje lleva el aviso', async () => {
    const phone = nextPhone();
    const failed = fakeRes();
    failed.setHeader = () => {
      throw new Error('falla simulada al enviar');
    };
    await expect(
      webhook(fakeReq({ From: 'whatsapp:' + phone, Body: 'Hola', NumMedia: '0' }), failed),
    ).rejects.toThrow('falla simulada al enviar');
    expect(failed.body).toBeUndefined();

    const next = await sendMessage(phone, 'Hola');
    expect(next.body).toBe(withNotice(MSG1));
  });

  it('GET sigue en 405, sin cuerpo ni aviso', async () => {
    const res = fakeRes();
    await webhook(fakeReq({}, { method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toBeUndefined();
    expect(res.ended).toBe(true);
  });

  it('una firma inválida sigue en 403, sin cuerpo ni aviso, y no marca el número', async () => {
    vi.stubEnv('TWILIO_SKIP_VALIDATION', 'false');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token-de-prueba');
    vi.stubEnv('APP_BASE_URL', 'https://example.test');
    const phone = nextPhone();
    const res = fakeRes();
    await webhook(
      fakeReq(
        { From: 'whatsapp:' + phone, Body: 'Hola', NumMedia: '0' },
        { headers: { 'x-twilio-signature': 'firma-invalida' } },
      ),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toBeUndefined();
    expect(askClaude).not.toHaveBeenCalled();

    vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
    expect((await sendMessage(phone, 'Hola')).body).toBe(withNotice(MSG1));
  });
});

describe('plazo de Twilio (15 s): una respuesta tardía no da el aviso por mostrado', () => {
  const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
  /** Avanza el reloj simulado, como si la llamada hubiera tardado `ms`. */
  const elapse = (ms: number) => vi.setSystemTime(Date.now() + ms);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  it('Claude tarda 20 s: la respuesta lleva el aviso, el número no se marca y el siguiente mensaje lo vuelve a llevar', async () => {
    const phone = nextPhone();
    vi.mocked(askClaude).mockImplementationOnce(async () => {
      elapse(20_000);
      return claudeOk();
    });
    const slow = await sendMessage(phone, 'Hola');
    expect(slow.statusCode).toBe(200);
    expect(slow.body).toBe(withNotice(MSG1));

    // Twilio pudo no entregar la primera: la segunda, a tiempo, lo lleva y recién ahí lo marca.
    const second = await sendMessage(phone, 'Hola');
    expect(second.body).toBe(withNotice(MSG1));
    const third = await sendMessage(phone, 'Hola');
    expect(third.body).toBe(buildTwiML(MSG1));
  });

  it('se cuenta desde que empieza el webhook: Claude (6 s) y Pipedrive (6 s) suman más de 10 s', async () => {
    const phone = nextPhone();
    const body = 'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Persona Prueba, prueba-13w@example.com';
    vi.mocked(askClaude).mockImplementationOnce(async () => {
      elapse(6_000);
      return claudeOk({
        producto: 'ampolletas LED',
        tipo_de_luz: 'calida',
        cantidad: '10',
        proyecto_o_uso: 'casa',
        comuna_o_ciudad: 'Maipú',
        nombre: 'Persona Prueba',
        correo: 'prueba-13w@example.com',
        qualifiesForDeal: true,
      });
    });
    vi.mocked(ensureWhatsAppDeal).mockImplementationOnce(async () => {
      elapse(6_000);
      return { action: 'created', dealId: 101, personId: 202 };
    });
    const slow = await sendMessage(phone, body);
    expect(ensureWhatsAppDeal).toHaveBeenCalledTimes(1);
    expect(slow.body).toBe(withNotice(MSG4));

    const next = await sendMessage(phone, 'Gracias');
    expect(next.body).toContain('Privacidad:');
    expect((await sendMessage(phone, 'Gracias')).body).not.toContain('Privacidad:');
  });

  it('justo en 10 s se da por mostrado: el siguiente mensaje va sin aviso', async () => {
    const phone = nextPhone();
    vi.mocked(askClaude).mockImplementationOnce(async () => {
      elapse(10_000);
      return claudeOk();
    });
    expect((await sendMessage(phone, 'Hola')).body).toBe(withNotice(MSG1));
    expect((await sendMessage(phone, 'Hola')).body).toBe(buildTwiML(MSG1));
  });
});

describe('deduplicación: un cierre que se junta con el negocio abierto del mismo número', () => {
  it('el negocio ya existía (found): igual se avisa a ventas, marcado como negocio existente', async () => {
    const phone = nextPhone();
    vi.mocked(askClaude).mockResolvedValueOnce(
      claudeOk({
        producto: 'ampolletas LED',
        tipo_de_luz: 'calida',
        cantidad: '10',
        proyecto_o_uso: 'casa',
        comuna_o_ciudad: 'Maipú',
        nombre: 'Persona Prueba',
        correo: 'prueba-13w@example.com',
        qualifiesForDeal: true,
      }),
    );
    vi.mocked(ensureWhatsAppDeal).mockResolvedValueOnce({ action: 'found', dealId: 303, personId: 202 });

    const res = await sendMessage(phone, 'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Persona Prueba, prueba-13w@example.com');
    expect(res.body).toBe(withNotice(MSG4));

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyTeam).mock.calls[0][0]).toMatchObject({ dealId: 303, personId: 202, existingDeal: true });
  });

  it('un negocio nuevo (created) va sin la marca de negocio existente', async () => {
    const phone = nextPhone();
    vi.mocked(askClaude).mockResolvedValueOnce(
      claudeOk({
        producto: 'ampolletas LED',
        tipo_de_luz: 'calida',
        cantidad: '10',
        proyecto_o_uso: 'casa',
        comuna_o_ciudad: 'Maipú',
        nombre: 'Persona Prueba',
        correo: 'prueba-13w@example.com',
        qualifiesForDeal: true,
      }),
    );

    await sendMessage(phone, 'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Persona Prueba, prueba-13w@example.com');

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyTeam).mock.calls[0][0]).toMatchObject({ dealId: 101, existingDeal: false });
  });
});
