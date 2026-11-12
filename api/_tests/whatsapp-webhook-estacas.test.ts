// api/_tests/whatsapp-webhook-estacas.test.ts
// Bot de WhatsApp, fases 1 y 2 (12-11-2026): el caso real de las estacas (caso-2026-11-12-estacas.md, anonimizado),
// de punta a punta por el webhook real, con datos inventados. Claude se simula en el SDK (corre el parseo real de
// claudeAgent.ts) y Pipedrive en sus módulos (corre el ensureWhatsAppDeal real). Sin red.
//
// Debe cumplir:
// - Ninguna respuesta repite la anterior (antes, el mismo pedido del correo tres veces seguidas), salvo el texto A en
//   la conversación cerrada sin correo: es la decisión pendiente del dueño (T-X1b, revisión del 12-11-2026).
// - «Sabes cuando demora el despacho» recibe el texto aprobado del despacho.
// - «5 focos» no cambia la estaca por «focos»: la ficha dice Estaca LED COB 5W para jardín, cantidad 5 y uso jardín.
// - El correo queda en el negocio; es una persona: no se le pide el RUT ni recibe el cierre de empresa.

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  claude: [] as string[],
  persons: [] as Array<Record<string, unknown>>,
  deals: [] as Array<Record<string, unknown>>,
  notes: [] as Array<{ content: string; deal_id: number; person_id: number }>,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: sim.claude.shift() ?? '{"wantsHuman":false,"qualifiesForDeal":false,"summary":"Sin datos."}' }],
        stop_reason: 'end_turn',
      }),
    };
  },
}));
vi.mock('../_lib/pipedrive/persons.js', () => ({
  findOrCreatePerson: vi.fn(async (customer: Record<string, unknown>) => {
    sim.persons.push(customer);
    return { personId: 7000 + sim.persons.length, action: 'created' };
  }),
}));
vi.mock('../_lib/pipedrive/deals.js', () => ({
  createDeal: vi.fn(async (params: Record<string, unknown>) => {
    sim.deals.push(params);
    return { dealId: 9000 + sim.deals.length, status: 'created' };
  }),
  updateDeal: vi.fn(async () => {}),
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
import { MSG4_B2B, MSG_NEED_EMAIL, MSG_WAIT_DELIVERY, getFlowState } from '../_lib/whatsapp/flowEngine.js';

type Handler = (req: unknown, res: unknown) => Promise<void>;
const webhook = handler as unknown as Handler;

let phoneSeq = 0;
let sidSeq = 0;
const nextPhone = () => '+5690000062' + String(++phoneSeq);

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
async function send(phone: string, body: string, claude: Record<string, unknown>): Promise<string> {
  sim.claude.push(JSON.stringify({ wantsHuman: false, qualifiesForDeal: false, summary: 'Resumen de prueba.', ...claude }));
  const res = fakeRes();
  await webhook(fakeReq({ From: 'whatsapp:' + phone, Body: body, ProfileName: 'Cliente Prueba', MessageSid: 'SMestacas' + ++sidSeq, NumMedia: '0' }), res);
  return replyText(res.body);
}

beforeEach(() => {
  for (const list of [sim.claude, sim.persons, sim.deals, sim.notes]) list.length = 0;
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ESTACA = 'Estaca LED COB 5W para jardín';
const DESPACHO = 'Sabes cuando demora el despacho';
// Lo que el cliente escribió (resumido en el caso) y lo que extrae un Claude que acierta.
const TURNS: Array<[string, Record<string, unknown>]> = [
  ['Hola, necesito focos estaca con luz cálida', { producto: 'focos estaca', tipo_de_luz: 'cálida' }],
  ['Estos', {}],
  ['https://example.com/producto/estaca-led-cob-5w-para-jardin Estaca LED COB 5W para jardín, 450 lm e IP65', { producto: ESTACA, proyecto_o_uso: 'jardín' }],
  ['5 focos', { producto: 'focos', cantidad: '5' }],
  ['En un jardin', { proyecto_o_uso: 'jardín' }],
  ['Ok, yo le escribí a Claudio', {}],
  [DESPACHO, {}],
  ['ana.prueba@example.com', { correo: 'ana.prueba@example.com' }],
];

describe('caso de las estacas (12-11-2026), de punta a punta por el webhook', () => {
  it('sin respuestas repetidas (salvo el texto A pendiente), el despacho contestado y la ficha con la estaca, 5 unidades, jardín y el correo', async () => {
    const phone = nextPhone();
    const replies: string[] = [];
    for (const [body, claude] of TURNS) replies.push(await send(phone, body, claude));

    // DECISIÓN PENDIENTE DEL DUEÑO (revisión del 12-11-2026): «5 focos» cierra sin correo con el texto A, y en la
    // conversación cerrada sin correo el texto A se repite (T-X1b), hasta que apruebe otro texto. Fuera de eso, nada
    // se repite.
    expect(replies.slice(3, 6)).toEqual([MSG_NEED_EMAIL, MSG_NEED_EMAIL, MSG_NEED_EMAIL]);
    for (let i = 1; i < replies.length; i++) {
      if (i >= 4 && i <= 5) continue;
      expect(replies[i], 'respuesta ' + (i + 1)).not.toBe(replies[i - 1]);
    }
    expect(replies[TURNS.findIndex(([body]) => body === DESPACHO)]).toContain(MSG_WAIT_DELIVERY);
    for (const reply of replies) {
      expect(reply).not.toMatch(/RUT/);
      expect(reply).not.toBe(MSG4_B2B);
    }

    expect(sim.deals).toHaveLength(1);
    expect(sim.notes).toHaveLength(1);
    const note = sim.notes[0].content;
    expect(note).toContain('Producto: ' + ESTACA);
    expect(note).not.toMatch(/Producto: focos\b/);
    expect(note).toContain('Cantidad: 5');
    expect(note).toContain('Proyecto/uso: jardín');
    expect(note).toContain('Correo: ana.prueba@example.com');
    expect(sim.persons[0].email).toBe('ana.prueba@example.com');
    const state = getFlowState(phone);
    expect(state.leadType).toBe('B2C');
    expect(state.captured).toMatchObject({ producto: ESTACA, cantidad: '5', proyecto_o_uso: 'jardín', correo: 'ana.prueba@example.com' });
  });
});
