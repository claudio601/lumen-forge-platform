// api/_tests/whatsapp-webhook-rut.test.ts
// Bot de WhatsApp, PR 6 (B12, RUT), de punta a punta por el webhook real. Claude se simula en el
// SDK y Pipedrive en sus módulos; el negocio simulado se junta por la referencia WA-<teléfono>,
// como la ventana de 7 días de createDeal. Sin red. Solo RUT inventados (dígito verificador
// válido y su versión con el dígito cambiado), correos @example.com y teléfonos +56900000xxx.
//
// - La prueba del dueño: RUT con el dígito cambiado → se pide una vez → corregido → un negocio
//   B2B con la nota "RUT: … (empresa)".
// - El RUT corregido que llega después del cierre ("déjame revisarlo") se suma al mismo negocio:
//   otra nota y aviso a ventas, sin negocio nuevo. Si Pipedrive falla en ese paso, el negocio
//   sigue registrado y la respuesta no cambia al texto B.
// - Un rango de presupuesto no es un RUT: sin repregunta, negocio B2C y "RUT: -".

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  claude: [] as string[],
  deals: [] as Array<Record<string, unknown>>,
  notes: [] as Array<{ content: string; deal_id: number }>,
  dealsDown: false,
}));

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
  findOrCreatePerson: vi.fn(async () => ({ personId: 7001, action: 'created' })),
}));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  createDeal: vi.fn(async (params: Record<string, unknown>) => {
    if (sim.dealsDown) throw new Error('Pipedrive no responde (simulado)');
    const open = sim.deals.findIndex((d) => d.quoteReference === params.quoteReference);
    if (open >= 0) return { dealId: 9001 + open, status: 'updated' };
    sim.deals.push(params);
    return { dealId: 9000 + sim.deals.length, status: 'created' };
  }),
  updateDeal: vi.fn(async () => {}),
}));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({
  pipedrivePost: vi.fn(async (path: string, body: { content: string; deal_id: number }) => {
    if (path === '/notes') sim.notes.push(body);
    return { success: true, data: { id: 1 } };
  }),
}));
vi.mock('../_lib/whatsapp/notify.js', () => ({ notifyTeam: vi.fn(async () => {}) }));

import handler from '../whatsapp/webhook';
import { PRIVACY_NOTICE } from '../_lib/whatsapp/privacyNotice.js';
import { MSG_RUT_INVALID } from '../_lib/whatsapp/flowEngine.js';
import { notifyTeam } from '../_lib/whatsapp/notify.js';

type Handler = (req: unknown, res: unknown) => Promise<void>;
const webhook = handler as unknown as Handler;

const REGISTRADA = /qued[oó] registrad[oa]/i;
const TECNICO = /problema t[eé]cnico/i;
const CORREO = 'compras@comercial-prueba.example.com';
const B2B_CLAUDE = {
  producto: 'paneles LED 60x60', tipo_de_luz: 'fría', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia',
  empresa: 'Comercial Prueba SpA', correo: CORREO, qualifiesForDeal: true,
};
const b2b = (rut: string) =>
  `Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia. Comercial Prueba SpA, RUT ${rut}, ${CORREO}`;

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

async function send(phone: string, body: string, claude: Record<string, unknown> = {}): Promise<string> {
  sim.claude.push(JSON.stringify({ wantsHuman: false, qualifiesForDeal: false, summary: 'Resumen de prueba.', ...claude }));
  const res = fakeRes();
  await webhook(fakeReq({ From: 'whatsapp:' + phone, Body: body, ProfileName: 'Perfil Prueba', MessageSid: 'SMrut' + seq, NumMedia: '0' }), res);
  expect(res.statusCode).toBe(200);
  return replyText(res.body);
}

beforeEach(() => {
  for (const list of [sim.claude, sim.deals, sim.notes]) list.length = 0;
  sim.dealsDown = false;
  vi.stubEnv('TWILIO_SKIP_VALIDATION', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'clave-ficticia-solo-pruebas');
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red en las pruebas'); }));
  vi.mocked(notifyTeam).mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('la prueba del dueño: RUT con el dígito cambiado', () => {
  it('se pide una vez sin crear el negocio; corregido, un negocio B2B con la nota "RUT: … (empresa)"', async () => {
    const phone = nextPhone();
    expect(await send(phone, b2b('77.123.456-8'), B2B_CLAUDE)).toBe(MSG_RUT_INVALID);
    expect(sim.deals).toHaveLength(0);

    expect(await send(phone, 'perdón, es 77.123.456-9')).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.deals[0].leadType).toBe('B2B');
    expect(sim.notes).toHaveLength(1);
    expect(sim.notes[0].content).toContain('RUT: 77.123.456-9 (empresa)');
    const logged = [console.log, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');
    for (const pii of ['77.123.456-8', '77.123.456-9', CORREO, phone, phone.slice(1), 'Perfil Prueba', B2B_CLAUDE.empresa]) {
      expect(logged).not.toContain(pii);
    }
    expect(logged).toContain('…' + phone.slice(-4));
    expect(logged).toContain('SMrut' + seq);

  });
});

describe('el RUT corregido llega después del cierre', () => {
  async function closeWithInvalidRut(phone: string) {
    expect(await send(phone, b2b('77.123.456-8'), B2B_CLAUDE)).toBe(MSG_RUT_INVALID);
    expect(await send(phone, 'déjame revisarlo y te lo mando')).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes[0].content).toContain('RUT: 77.123.456-8 (INVALIDO: no calza el digito verificador)');
  }

  it('se suma al mismo negocio: otra nota con el RUT válido y aviso a ventas, sin negocio nuevo', async () => {
    const phone = nextPhone();
    await closeWithInvalidRut(phone);
    vi.mocked(notifyTeam).mockClear();

    expect(await send(phone, 'el RUT correcto es 77.123.456-9')).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(2);
    expect(sim.notes[1].deal_id).toBe(sim.notes[0].deal_id);
    expect(sim.notes[1].content).toContain('RUT: 77.123.456-9 (empresa)');
    expect(vi.mocked(notifyTeam)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyTeam).mock.calls[0][0]).toMatchObject({ existingDeal: true });

    // Ya está: un "gracias" no vuelve a escribir en Pipedrive.
    expect(await send(phone, 'gracias')).toMatch(REGISTRADA);
    expect(sim.notes).toHaveLength(2);
  });

  it('si Pipedrive falla en ese paso: el negocio sigue registrado y la respuesta no pasa al texto B', async () => {
    const phone = nextPhone();
    await closeWithInvalidRut(phone);
    sim.dealsDown = true;

    const r = await send(phone, 'el RUT correcto es 77.123.456-9');
    expect(r).toMatch(REGISTRADA);
    expect(r).not.toMatch(TECNICO);
    expect(await send(phone, 'hola?')).toMatch(REGISTRADA);
  });
});

describe('un rango de presupuesto no es un RUT', () => {
  it('sin repregunta: el negocio es B2C y la nota dice "RUT: -"', async () => {
    const phone = nextPhone();
    const r = await send(
      phone,
      'Hola, necesito 10 ampolletas LED luz cálida para mi casa en Maipú, tengo entre 1.000.000-2.000.000 de presupuesto. Soy Ana Prueba, ana.prueba@example.com',
      { producto: 'ampolletas LED', tipo_de_luz: 'cálida', cantidad: '10', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com', qualifiesForDeal: true },
    );
    expect(r).not.toBe(MSG_RUT_INVALID);
    expect(r).toMatch(REGISTRADA);
    expect(sim.deals).toHaveLength(1);
    expect(sim.deals[0].leadType).toBe('B2C');
    expect(sim.notes[0].content).toContain('RUT: -');
  });
});

describe('QA sin valores libres del cliente o de Claude', () => {
  it('ningún slot ni resumen permite que un nombre o contacto vuelva al log', async () => {
    const phone = nextPhone();
    const privateText = 'Persona Ficticia 12.345.678-5 prueba@ejemplo.cl +56 9 1234 5678';
    await send(phone, privateText, {
      producto: privateText, tipo_de_luz: privateText, cantidad: privateText,
      proyecto_o_uso: privateText, comuna_o_ciudad: privateText,
      nombre: 'Persona Ficticia', empresa: 'Empresa Ficticia', correo: 'prueba@ejemplo.cl',
      summary: privateText,
    });
    await send(phone, 'quiero otra consulta nueva', {});
    const logged = [console.log, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');
    for (const pii of ['Persona Ficticia', 'Empresa Ficticia', '12.345.678-5', 'prueba@ejemplo.cl', '+56 9 1234 5678', phone, phone.slice(1)]) {
      expect(logged).not.toContain(pii);
    }
    expect(logged).toContain('[QA:in]');
    expect(logged).toContain('[QA:out]');
    expect(logged).toContain('[QA:claude]');
  });
});
