// api/_tests/estudio-luminico.create.test.ts
// "Estudio lumínico": el correo a ventas sale ANTES de Pipedrive y lleva la misma
// referencia ESTL- que la nota. Si Pipedrive falla pero el correo salió, el lead no se
// pierde (200 + correo de ATENCIÓN); 502 solo si fallan los dos. Pipedrive y el relay
// están simulados. Vive en api/_tests/ para que Vercel no lo despliegue como función.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../_lib/pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn() }));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn(), pipedriveGet: vi.fn(), pipedrivePut: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

import handler from '../estudio-luminico/create';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { pipedrivePost } from '../_lib/pipedrive/client.js';
import { waitUntil } from '@vercel/functions';

let ipSeq = 0;
function call(body: unknown, opts: { method?: string; ip?: string; origin?: string } = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  const req = {
    method: opts.method ?? 'POST',
    headers: { 'x-forwarded-for': opts.ip ?? `10.9.0.${++ipSeq}`, ...(opts.origin ? { origin: opts.origin } : {}) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}

const EMAIL = 'prueba-etapa2-09a@example.com';
const PHONE = '+56 9 0000 0901';
const NAME = 'PRUEBA ETAPA 2 (09a)';
const base = {
  nombreCompleto: NAME, email: EMAIL, telefono: PHONE,
  tipoProyecto: 'industria_bodega', comunaCiudad: 'Santiago', tienePlanos: 'no_tengo',
  dimensionesAproximadas: 'PRUEBA 10x20 m', alturaMontaje: '6 m', objetivoProyecto: 'operacion_industrial',
  normativaObjetivo: 'en_12464', urgenciaProyecto: 'este_mes', descripcionProyecto: 'PRUEBA - no procesar',
  origen: 'estudio_luminico_web', fecha: '6 de octubre de 2026', landingPath: '/estudio-luminico', website: '',
};

type PdCall = [string, Record<string, unknown>];
const pdCalls = (path: string) => (vi.mocked(pipedrivePost).mock.calls as unknown as PdCall[]).filter(([p]) => p === path);
const gasBodies = () =>
  (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string) as Record<string, string>);
const relay = (text: string) => vi.fn(async () => ({ ok: true, status: 200, text: async () => text }));
/** Espera los correos registrados en waitUntil. */
const mailsSettled = () => Promise.all(vi.mocked(waitUntil).mock.calls.map(([p]) => p));
const logged = () =>
  [console.log, console.warn, console.error]
    .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
    .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join('\n');

describe('POST /api/estudio-luminico/create', () => {
  beforeEach(() => {
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockImplementation((async (path: string) =>
      path === '/deals' ? { success: true, data: { id: 555 } } : { success: true, data: { id: 1 } }) as never);
    vi.mocked(waitUntil).mockClear();
    vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '2');
    vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '10');
    vi.stubEnv('PIPEDRIVE_OWNER_USER_ID', '1');
    vi.stubEnv('PIPEDRIVE_FIELD_TIPO_SERVICIO', 'tipo_key');
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('crea el negocio en el pipeline de ventas con Tipo de Servicio 91 y la nota completa', async () => {
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, dealId: 555, personId: 11, dealAction: 'created', leadRef: expect.stringMatching(/^ESTL-/) });

    const [[, deal]] = pdCalls('/deals');
    expect(deal).toMatchObject({ pipeline_id: 2, stage_id: 10, user_id: 1, value: 0, currency: 'CLP', person_id: 11, tipo_key: 91 });
    expect(Object.keys(deal).sort()).toEqual(['currency', 'person_id', 'pipeline_id', 'stage_id', 'tipo_key', 'title', 'user_id', 'value']);

    const [[, note]] = pdCalls('/notes');
    expect(note.deal_id).toBe(555);
    for (const text of ['Dimensiones aproximadas: PRUEBA 10x20 m', 'Altura de montaje: 6 m', 'Tiene planos DWG:', 'Objetivo del proyecto:',
      'Normativa objetivo:', 'Urgencia:', 'PRUEBA - no procesar', 'Referencia: ' + (res.body as { leadRef: string }).leadRef]) {
      expect(note.content).toContain(text);
    }
  });

  it('el correo sale antes de Pipedrive, con la nota completa y la misma referencia', async () => {
    const res = await call({ ...base, empresa: 'PRUEBA ETAPA 2' });
    expect(vi.mocked(fetch).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(findOrCreatePerson).mock.invocationCallOrder[0]);

    const [mail] = gasBodies();
    const [[, note]] = pdCalls('/notes');
    expect(mail.items_lista).toBe(note.content);
    expect(mail.items_lista).toContain('Referencia: ' + (res.body as { leadRef: string }).leadRef);
    expect(mail.modo_precio).toBe('Estudio lumínico DIALux');
    expect(mail.razon_social).toBe('PRUEBA ETAPA 2');
    expect(mail.reply_to).toBe(EMAIL);
    expect(Object.values(mail)).not.toContain('undefined');
    expect(gasBodies()).toHaveLength(1);
  });

  it('sin empresa el correo no lleva la línea Razon Social', async () => {
    await call(base);
    expect(gasBodies()[0]).not.toHaveProperty('razon_social');
  });

  it.each([
    ['findOrCreatePerson rechaza', () => { vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] Failed to create person: HTTP 500')); }],
    ['POST /deals responde success:false', () => {
      vi.mocked(pipedrivePost).mockImplementation((async (path: string) =>
        path === '/deals' ? { success: false, data: null, error: 'HTTP 400' } : { success: true, data: { id: 1 } }) as never);
    }],
    ['falta PIPEDRIVE_OWNER_USER_ID', () => { vi.stubEnv('PIPEDRIVE_OWNER_USER_ID', ''); }],
  ])('Pipedrive falla (%s) y el correo salió: 200 sin negocio + correo de ATENCIÓN', async (_cause, breakCrm) => {
    breakCrm();
    const res = await call(base);
    expect(res.statusCode).toBe(200);
    const leadRef = (res.body as { leadRef: string }).leadRef;
    expect(res.body).toEqual({ success: true, dealId: null, leadRef, crm: 'failed' });
    expect(leadRef).toMatch(/^ESTL-/);

    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    expect(mails[1].items_lista.startsWith('ATENCIÓN: la solicitud ' + leadRef + ' NO quedó en Pipedrive. Crear el negocio a mano.')).toBe(true);
    expect(mails[1].items_lista).toContain(mails[0].items_lista);
    expect(logged()).toContain('LEAD SIN CRM ' + leadRef);
  });

  it.each([
    ['el relay responde status error', () => relay('{"status":"error","message":"cuota"}')],
    ['la red falla', () => vi.fn(async () => { throw new TypeError('fetch failed'); })],
  ])('Pipedrive y el correo fallan (%s): 502 y ningún correo de ATENCIÓN', async (_cause, brokenFetch) => {
    vi.stubGlobal('fetch', brokenFetch());
    vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down'));
    const res = await call(base);
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ success: false });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('una nota fallida no bloquea: 201 y console.error con dealId y referencia', async () => {
    vi.mocked(pipedrivePost).mockImplementation((async (path: string) =>
      path === '/deals' ? { success: true, data: { id: 555 } } : { success: false, data: null, error: 'HTTP 500' }) as never);
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    const leadRef = (res.body as { leadRef: string }).leadRef;
    const errors = vi.mocked(console.error).mock.calls.flat().map(String).join('\n');
    expect(errors).toContain('dealId: 555');
    expect(errors).toContain(leadRef);
  });

  it('con Pipedrive bien y el correo fallando responde 201 y deja un aviso', async () => {
    vi.stubGlobal('fetch', relay('<html>Error</html>'));
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    await mailsSettled();
    expect(vi.mocked(console.warn).mock.calls.flat().map(String).join('\n')).toContain('GAS relay FAIL');
  });

  it.each([
    ['empresa numérica', { empresa: 12345 }],
    ['descripción numérica', { descripcionProyecto: 123 }],
    ['descripción de más de 2000 caracteres', { descripcionProyecto: 'd'.repeat(2001) }],
  ])('%s: 400 sin correo ni Pipedrive', async (_name, extra) => {
    const res = await call({ ...base, ...extra });
    expect(res.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
  });

  it('empresa null cuenta como ausente: 201 y el correo sin Razon Social', async () => {
    const res = await call({ ...base, empresa: null });
    expect(res.statusCode).toBe(201);
    expect(gasBodies()[0]).not.toHaveProperty('razon_social');
  });

  it('con la descripción más larga permitida el correo lleva la nota completa, sin recorte', async () => {
    const res = await call({ ...base, empresa: 'PRUEBA ETAPA 2', descripcionProyecto: 'd'.repeat(2000) });
    expect(res.statusCode).toBe(201);
    const [mail] = gasBodies();
    const [[, note]] = pdCalls('/notes');
    expect(mail.items_lista).toBe(note.content);
    expect(mail.items_lista).not.toContain('recortado');
    expect(mail.items_lista).toContain('leadRef: ' + (res.body as { leadRef: string }).leadRef);
  });

  it('teléfono de 7 dígitos: 400 sin correo ni Pipedrive', async () => {
    const res = await call({ ...base, telefono: '2123456' });
    expect(res.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
    expect(pipedrivePost).not.toHaveBeenCalled();
  });

  it('honeypot: responde 200 y no crea nada', async () => {
    const res = await call({ ...base, website: 'http://spam' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
  });

  it('en producción bloquea orígenes desconocidos (403)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const bad = await call(base, { origin: 'https://spam.example' });
    expect(bad.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    const ok = await call(base, { origin: 'https://nuevo.elights.cl' });
    expect(ok.statusCode).toBe(201);
  });

  it('GET responde 405', async () => {
    const res = await call(undefined, { method: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  // Cubre las líneas de log del endpoint y del ayudante de correo. persons.js está
  // simulado: su propio log (protegido) queda fuera de esta prueba.
  it('las líneas de log del endpoint no llevan el correo, el teléfono ni el nombre del cliente', async () => {
    await call(base);
    vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down'));
    await call(base);
    // Un relay que repite lo que recibió tampoco llega al log
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'error', message: 'Invalid email: ' + EMAIL + ' ' + NAME + ' ' + PHONE })));
    await call(base);
    await call({ ...base, telefono: '123' });
    await mailsSettled();
    const text = logged();
    expect(text).toContain('LEAD SIN CRM');
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(NAME);
  });
});
