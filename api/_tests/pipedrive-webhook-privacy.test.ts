// api/_tests/pipedrive-webhook-privacy.test.ts
// Hallazgo 1 de la auditoría de Codex (#196): el webhook con el cliente de Pipedrive REAL y solo
// `fetch` simulado (las demás pruebas del webhook simulan pipedriveGet y no pasan por los registros
// del cliente). Ni el token, ni la URL, ni un nombre, ni un valor de campo llegan a console.*, tanto
// si /dealFields responde bien como si falla de cualquier forma. Datos inventados; nada sale a la red.
// Vive en api/_tests/ para que Vercel no lo despliegue como función.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../pipedrive/webhook';
import { resetFieldOptionsCache } from '../_lib/pipedrive/fieldOptions.js';

const TOKEN = 'TOKEN_FICTICIO_abcdef';
const NAME = 'Persona Inventada';
const USER = 'usuario-prueba';
const PASSWORD = 'clave-prueba';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
const TRIGGER = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const URL_WITH_TOKEN = `https://pipedrive.example/v1/dealFields?api_token=${TOKEN}&limit=500`;
const FORBIDDEN = [TOKEN, NAME, 'api_token', 'https://pipedrive.example', 'persona.inventada@example.com', 'Calle Falsa', 'Vista previa'];

const DEAL_FIELDS = [
  { key: TRIGGER, name: 'Despacho · Aviso', field_type: 'enum', options: [{ id: 71, label: 'Vista previa' }, { id: 72, label: 'Enviar al cliente' }] },
  { key: OTHER, name: 'Despacho · Agencia o comuna', field_type: 'varchar' },
];

const body = () => ({
  meta: { action: 'change', entity: 'deal', entity_id: '501', company_id: '777001', is_bulk_edit: false, version: '2.0', change_source: 'app', attempt: 1 },
  data: {
    id: 501, title: `PRUEBA ${NAME}`, status: 'open', stage_id: 11, pipeline_id: 2,
    person_id: { id: 61, name: NAME, email: [{ value: 'persona.inventada@example.com' }] },
    custom_fields: { [TRIGGER]: { type: 'enum', id: 71 }, [OTHER]: { type: 'varchar', value: 'Calle Falsa 123' } },
  },
  previous: { custom_fields: { [TRIGGER]: null, [OTHER]: null } },
});

async function call() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  await handler({ method: 'POST', headers: { authorization: AUTH, 'content-type': 'application/json' }, body: body() } as never, res as never);
  return res;
}

const logged = () =>
  [console.log, console.warn, console.error].flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');

beforeEach(() => {
  resetFieldOptionsCache();
  vi.stubEnv('PIPEDRIVE_API_TOKEN', TOKEN);
  vi.stubEnv('PIPEDRIVE_BASE_URL', 'https://pipedrive.example/v1');
  vi.stubEnv('PIPEDRIVE_WEBHOOK_USER', USER);
  vi.stubEnv('PIPEDRIVE_WEBHOOK_PASSWORD', PASSWORD);
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '2');
  vi.stubEnv('PIPEDRIVE_COMPANY_ID', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('webhook con el cliente real: los registros no llevan el token ni datos del cliente', () => {
  const cases: Array<[string, () => Promise<Response>, string]> = [
    ['/dealFields responde bien', async () => new Response(JSON.stringify({ success: true, data: DEAL_FIELDS })), 'aviso=disparador'],
    ['HTTP 401 con el nombre y la URL con el token en el cuerpo', async () => new Response(`${NAME}: token inválido en ${URL_WITH_TOKEN}`, { status: 401, statusText: 'Unauthorized' }), 'aviso=campos_no_disponibles'],
    ['success: false con el nombre y la URL en el error', async () => new Response(JSON.stringify({ success: false, error: `${NAME} ${URL_WITH_TOKEN}` })), 'aviso=campos_no_disponibles'],
    ['fetch lanza con la URL en el mensaje', async () => { throw new TypeError(`Failed to parse URL from ${URL_WITH_TOKEN} (${NAME})`); }, 'aviso=campos_no_disponibles'],
    ['respuesta 200 que no es JSON, con el nombre', async () => new Response(`<html>${NAME} ${URL_WITH_TOKEN}</html>`), 'aviso=campos_no_disponibles'],
  ];

  it.each(cases)('%s', async (_label, respond, expected) => {
    const fetchMock = vi.fn(respond);
    vi.stubGlobal('fetch', fetchMock);
    const res = await call();
    expect(res.statusCode).toBe(200);
    // El cliente real armó la URL con el token (la prueba sí pasó por ese camino).
    expect(String((fetchMock.mock.calls as unknown as [string][])[0]?.[0])).toContain(`api_token=${TOKEN}`);
    const text = logged();
    expect(text).toContain(expected);
    for (const secret of FORBIDDEN) expect(text, secret).not.toContain(secret);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});
