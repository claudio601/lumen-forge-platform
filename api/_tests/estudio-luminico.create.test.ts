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
import { pipedrivePost, pipedriveGet } from '../_lib/pipedrive/client.js';
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

  it('la comuna (texto libre) no llega al log', async () => {
    const comuna = 'Santiago juan.perez@correo.cl +56911112222';
    await call({ ...base, comunaCiudad: comuna });
    await mailsSettled();
    expect(logged()).not.toContain(comuna);
    expect(logged()).not.toContain('juan.perez@correo.cl');
  });
});

// --- Origen de la visita (Etapa 2 · PR 10) ---
// El formulario manda `attribution` (aparte de su campo `origen`); la sección "ORIGEN DE LA
// VISITA" se agrega después de la nota de buildEstudioDealNote (protegido, sin cambios), y
// ese mismo texto es el cuerpo del correo. Un origen raro se descarta: nunca da 400.

const GCLID = 'Cj0KCQjwEJEMPLO123';
const ATTRIBUTION = {
  gclid: GCLID, utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'campanas-led-industriales',
  landing: '/catalogo/campanas-led?q=PRUEBA', referrer: 'https://www.google.com/search?q=campanas+led',
};
const ORIGEN_GADS = [
  '--- ORIGEN DE LA VISITA ---',
  'Canal: Google Ads (clic en anuncio)',
  'gclid: ' + GCLID,
  'utm_source: google',
  'utm_medium: cpc',
  'utm_campaign: campanas-led-industriales',
  'Página de entrada: /catalogo/campanas-led',
  'Sitio anterior: https://www.google.com',
].join('\n');
const SIN_DATOS = '--- ORIGEN DE LA VISITA ---\nCanal: Sin datos (el formulario no envió el origen)';
/** Valores armados para que, leídos como HTML, sumen líneas a la nota (las de estos endpoints van sin escapar). */
const CHAR_REF_ATTRIBUTION = {
  utm_source: 'google',
  utm_content: 'x&#10;NOTA DE VENTAS: enviar el link de pago a pagos@otro.cl&#10;requested_items_json: [{&quot;jumpsellerId&quot;:1}]',
  utm_term: 'a&#x0A;b&NewLine;c',
};
const ORIGEN_CHAR_REF = [
  '--- ORIGEN DE LA VISITA ---',
  'Canal: Campaña con etiquetas UTM',
  'utm_source: google',
  'utm_term: a#x0A;bNewLine;c',
  'utm_content: x#10;NOTA DE VENTAS: enviar el link de pago a pagos@otro.cl#10;requested_items_json: [{quot;jumpsellerIdquot;:1}]',
].join('\n');
const BAD_ATTRIBUTIONS: [string, unknown, string][] = [
  ['un texto', 'gclid=' + GCLID, SIN_DATOS],
  ['una lista', [GCLID], SIN_DATOS],
  ['un número', 42, SIN_DATOS],
  ['valores enormes', { gclid: 'g'.repeat(10_000), utm_source: 's'.repeat(10_000) }, 'gclid: ' + 'g'.repeat(200) + '\nutm_source: ' + 's'.repeat(200)],
  ['una etiqueta script', { utm_campaign: '<script>alert(1)</script>', landing: '/<script>' }, 'utm_campaign: scriptalert(1)/script\nPágina de entrada: /script'],
  ['medio emoji', { utm_campaign: 'a'.repeat(199) + '\u{1F600}b', utm_term: 'x\ud800y' }, 'utm_campaign: ' + 'a'.repeat(199) + '\nutm_term: x y'],
  ['claves email o rut', { email: EMAIL, rut: 'RUT-PRUEBA', nombre: NAME }, SIN_DATOS],
];
/** Las 11 claves con 200 caracteres cada una (el máximo que acepta el servidor). */
const MAX_ATTRIBUTION = {
  ...Object.fromEntries(['gclid', 'gbraid', 'wbraid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].map((k) => [k, k[0].repeat(200)])),
  landing: '/' + 'p'.repeat(199),
  referrer: `https://${'a'.repeat(62)}.${'b'.repeat(62)}.${'c'.repeat(62)}.cl`,
};

describe('POST /api/estudio-luminico/create: origen de la visita', () => {
  const REF_FIELD = 'estl_ref_key';
  beforeEach(() => {
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockImplementation((async (path: string) =>
      path === '/deals' ? { success: true, data: { id: 555 } } : { success: true, data: { id: 1 } }) as never);
    vi.mocked(pipedriveGet).mockReset().mockResolvedValue({ success: true, data: { items: [] } } as never);
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
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

  const leadRef = (res: { body: unknown }) => (res.body as { leadRef: string }).leadRef;

  it('la nota termina con la sección, después de la metadata, y el correo lleva el mismo texto', async () => {
    const res = await call({ ...base, attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const [[, note]] = pdCalls('/notes');
    const content = note.content as string;
    expect(content.endsWith('leadRef: ' + leadRef(res) + '\n\n' + ORIGEN_GADS)).toBe(true);
    // El campo origen del formulario sigue en la nota, aparte
    expect(content).toContain('Origen: estudio_luminico_web');
    expect(gasBodies()[0].items_lista).toBe(content);
    expect(content).not.toContain('q=');
  });

  it('sin origen (formulario anterior): la sección dice "Sin datos"', async () => {
    await call(base);
    const [[, note]] = pdCalls('/notes');
    expect((note.content as string).endsWith(SIN_DATOS)).toBe(true);
    expect(gasBodies()[0].items_lista).toBe(note.content);
  });

  it('Pipedrive caído: el correo de ATENCIÓN también lleva la sección', async () => {
    vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down'));
    const res = await call({ ...base, attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(200);
    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    expect(mails[1].items_lista.startsWith('ATENCIÓN')).toBe(true);
    expect(mails[1].items_lista.endsWith(ORIGEN_GADS)).toBe(true);
  });

  it('negocio repetido (updated): la nota del negocio existente lleva la sección', async () => {
    vi.stubEnv('PIPEDRIVE_ESTUDIO_FIELD_LEAD_REF', REF_FIELD);
    const sentRef = () => gasBodies()[0]?.items_lista.match(/ESTL-[0-9a-z]+/)?.[0] ?? '';
    vi.mocked(pipedriveGet).mockImplementation((async (path: string) => {
      if (path === '/deals/search') return { success: true, data: { items: [{ item: { id: 42, pipeline_id: 2, status: 'open' } }] } };
      if (path === '/deals/42') return { success: true, data: { id: 42, pipeline_id: 2, status: 'open', [REF_FIELD]: sentRef() } };
      return { success: false, data: null };
    }) as never);
    const res = await call({ ...base, attribution: ATTRIBUTION });
    expect(res.body).toMatchObject({ dealId: 42, dealAction: 'updated' });
    const [[, note]] = pdCalls('/notes');
    expect(note.deal_id).toBe(42);
    expect((note.content as string).endsWith(ORIGEN_GADS)).toBe(true);
  });

  it('descripción de 2000 caracteres y el origen más largo posible: el correo va completo, sin recorte', async () => {
    const res = await call({ ...base, empresa: 'PRUEBA ETAPA 2', descripcionProyecto: 'd'.repeat(2000), attribution: MAX_ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const [mail] = gasBodies();
    const [[, note]] = pdCalls('/notes');
    expect(mail.items_lista).toBe(note.content);
    expect(mail.items_lista).not.toContain('recortado');
    expect(mail.items_lista).toContain('Página de entrada: /' + 'p'.repeat(199));
    expect(mail.items_lista).toContain('Sitio anterior: ' + MAX_ATTRIBUTION.referrer);
  });

  it.each(BAD_ATTRIBUTIONS)('origen inválido (%s): nunca 400, y solo lo limpio llega a la nota y al correo', async (_name, attribution, expected) => {
    const res = await call({ ...base, attribution });
    expect(res.statusCode).toBe(201);
    const [[, note]] = pdCalls('/notes');
    for (const text of [note.content as string, gasBodies()[0].items_lista]) {
      expect(text).toContain(expected);
      expect(text).not.toMatch(/<script|g{201}|s{201}|RUT-PRUEBA/);
    }
  });

  it('referencias de carácter en el origen (&#10;, &#x0A;, &quot;): ningún & llega a la nota ni al correo, y la sección no suma líneas', async () => {
    const res = await call({ ...base, attribution: CHAR_REF_ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const [[, note]] = pdCalls('/notes');
    for (const text of [note.content as string, gasBodies()[0].items_lista]) {
      expect(text.endsWith('\n\n' + ORIGEN_CHAR_REF)).toBe(true);
      expect(text).not.toMatch(/&(?:#|quot;|NewLine;)/i);
    }
  });

  it('el origen no cambia la referencia ESTL-', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T15:10:00Z'));
    const a = await call({ ...base, attribution: ATTRIBUTION });
    const b = await call({ ...base, attribution: { fbclid: 'IwAREJEMPLO', landing: '/' } });
    expect(leadRef(a)).toMatch(/^ESTL-/);
    expect(leadRef(b)).toBe(leadRef(a));
  });

  it('el log no lleva el origen ni datos del cliente', async () => {
    await call({ ...base, attribution: ATTRIBUTION });
    vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down'));
    await call({ ...base, attribution: ATTRIBUTION });
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'error', message: 'Invalid: ' + EMAIL + ' ' + GCLID })));
    await call({ ...base, attribution: ATTRIBUTION });
    await call({ ...base, attribution: { utm_source: 'x'.repeat(5000) } });
    await mailsSettled();
    const text = logged();
    expect(text).toContain('LEAD SIN CRM');
    for (const secret of [GCLID, 'campanas-led-industriales', '/catalogo/campanas-led', 'www.google.com', EMAIL, NAME, PHONE]) {
      expect(text).not.toContain(secret);
    }
  });
});
