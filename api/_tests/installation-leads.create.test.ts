// api/_tests/installation-leads.create.test.ts
// "Instalación profesional": el correo a ventas sale ANTES de Pipedrive y lleva la misma
// referencia INST- que la nota y el campo del deal. Si Pipedrive falla pero el correo salió,
// el lead no se pierde (200 + correo de ATENCIÓN); 502 solo si fallan los dos. Pipedrive y
// el relay están simulados. Vive en api/_tests/ para que Vercel no lo despliegue como función.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../_lib/pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn() }));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn(), pipedriveGet: vi.fn(), pipedrivePut: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

import handler from '../installation-leads/create';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { pipedrivePost, pipedriveGet, pipedrivePut } from '../_lib/pipedrive/client.js';
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
    headers: { 'x-forwarded-for': opts.ip ?? `10.9.3.${++ipSeq}`, ...(opts.origin ? { origin: opts.origin } : {}) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}

const EMAIL = 'prueba-etapa2-09c@example.com';
const PHONE = '+56 9 0000 0903';
const NAME = 'PRUEBA ETAPA 2 (09c) - borrar';
const DESCRIPCION = 'PRUEBA ETAPA 2 (09c) - no contactar; borrar';
const base = {
  nombre: NAME, email: EMAIL, telefono: PHONE, comuna: 'Santiago', tipoProyecto: 'Oficina',
  descripcion: DESCRIPCION, tipoCliente: 'empresa', preferenciaContacto: 'email',
  aceptaContacto: true, origen: 'instalacion_web', website: '',
};

const REF_KEY = 'lead_ref_key';
const TIPO_KEY = 'tipo_key';

type PdCall = [string, Record<string, unknown>];
const pdCalls = (path: string) => (vi.mocked(pipedrivePost).mock.calls as unknown as PdCall[]).filter(([p]) => p === path);
const gasCalls = () => vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][];
const gasBodies = () => gasCalls().map(([, init]) => JSON.parse(init.body as string) as Record<string, string>);
const relay = (text: string) => vi.fn(async () => ({ ok: true, status: 200, text: async () => text }));
/** Espera los correos registrados en waitUntil. */
const mailsSettled = () => Promise.all(vi.mocked(waitUntil).mock.calls.map(([p]) => p));
const logged = () =>
  [console.log, console.warn, console.error]
    .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
    .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join('\n');
const leadRefOf = (res: { body: unknown }) => (res.body as { leadRef: string }).leadRef;
/** Referencia del primer correo (sale antes de cualquier llamada a Pipedrive). */
const sentRef = () => gasBodies()[0]?.items_lista.match(/INST-[0-9a-z]+/)?.[0] ?? '';

describe('POST /api/installation-leads/create', () => {
  beforeEach(() => {
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockImplementation((async (path: string) =>
      path === '/deals' ? { success: true, data: { id: 777 } } : { success: true, data: { id: 1 } }) as never);
    // Sin negocios previos con la referencia
    vi.mocked(pipedriveGet).mockReset().mockResolvedValue({ success: true, data: { items: [] } } as never);
    vi.mocked(pipedrivePut).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(waitUntil).mockClear();
    vi.stubEnv('PIPEDRIVE_INSTALL_PIPELINE_ID', '3');
    vi.stubEnv('PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID', '30');
    vi.stubEnv('PIPEDRIVE_OWNER_USER_ID', '1');
    vi.stubEnv('PIPEDRIVE_FIELD_TIPO_SERVICIO', TIPO_KEY);
    vi.stubEnv('PIPEDRIVE_INSTALL_FIELD_LEAD_REF', REF_KEY);
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('crea el negocio en el pipeline 3 con Tipo de Servicio 90 y la misma referencia en el campo y la nota', async () => {
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, dealId: 777, personId: 11, dealAction: 'created', leadRef: expect.stringMatching(/^INST-/) });
    const leadRef = leadRefOf(res);

    const [[, deal]] = pdCalls('/deals');
    expect(deal).toMatchObject({ pipeline_id: 3, stage_id: 30, value: 0, currency: 'CLP', person_id: 11, [TIPO_KEY]: 90, [REF_KEY]: leadRef });
    expect(deal.title).toBe('Instalacion Oficina — ' + NAME + ' — Santiago');

    const notes = pdCalls('/notes');
    expect(notes).toHaveLength(1);
    const [[, note]] = notes;
    expect(note.deal_id).toBe(777);
    const content = note.content as string;
    expect(content.startsWith('Solicitud de instalación ' + leadRef + '\n')).toBe(true);
    for (const text of ['Tipo de proyecto: Oficina', 'Tipo de cliente: Empresa', 'Comuna: Santiago',
      'Preferencia de contacto: Correo electrónico', DESCRIPCION, 'Puntaje: ', 'prioridad ']) {
      expect(content).toContain(text);
    }
  });

  it('el correo sale antes de Pipedrive, a ventas@, con respuesta al cliente y la misma referencia', async () => {
    const res = await call(base);
    const leadRef = leadRefOf(res);
    expect(vi.mocked(fetch).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(findOrCreatePerson).mock.invocationCallOrder[0]);

    const [[url]] = gasCalls();
    expect(url).toBe('http://127.0.0.1:9/gas-disabled-in-tests');
    const mails = gasBodies();
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail.to_email).toBe('ventas@elights.cl');
    expect(mail.reply_to).toBe(EMAIL);
    expect(mail.modo_precio).toBe('Instalación profesional (sin monto)');
    expect(mail.total).toBe('-');
    expect(mail.items_lista.startsWith('Solicitud de instalación ' + leadRef)).toBe(true);
    for (const text of ['Tipo de proyecto: Oficina', 'Tipo de cliente: Empresa', 'Comuna: Santiago',
      'Preferencia de contacto: Correo electrónico', 'Teléfono: ' + PHONE, 'Correo: ' + EMAIL, DESCRIPCION]) {
      expect(mail.items_lista).toContain(text);
    }
    // Sin datos de empresa: la plantilla no imprime esas líneas
    expect(mail).not.toHaveProperty('razon_social');
    expect(mail).not.toHaveProperty('rut_empresa');
    expect(Object.values(mail)).not.toContain('undefined');
    expect(mail.items_lista).not.toContain('undefined');
  });

  it('SALES_EMAIL reemplaza el destinatario', async () => {
    vi.stubEnv('SALES_EMAIL', 'otra-casilla@example.com');
    await call(base);
    expect(gasBodies()[0].to_email).toBe('otra-casilla@example.com');
  });

  it.each([
    ['findOrCreatePerson rechaza', () => { vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] Failed to create person: HTTP 500')); }],
    ['POST /deals responde success:false', () => {
      vi.mocked(pipedrivePost).mockImplementation((async (path: string) =>
        path === '/deals' ? { success: false, data: null, error: 'HTTP 400' } : { success: true, data: { id: 1 } }) as never);
    }],
    ['falta PIPEDRIVE_INSTALL_PIPELINE_ID', () => { vi.stubEnv('PIPEDRIVE_INSTALL_PIPELINE_ID', ''); }],
    ['falta PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID', () => { vi.stubEnv('PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID', ''); }],
  ])('Pipedrive falla (%s) y el correo salió: 200 sin negocio + correo de ATENCIÓN', async (_cause, breakCrm) => {
    breakCrm();
    const res = await call(base);
    expect(res.statusCode).toBe(200);
    const leadRef = leadRefOf(res);
    expect(res.body).toEqual({ success: true, dealId: null, leadRef, crm: 'failed' });
    expect(leadRef).toMatch(/^INST-/);

    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    expect(mails[1].items_lista.startsWith('ATENCIÓN: la solicitud ' + leadRef + ' NO quedó en Pipedrive. Crear el negocio a mano.')).toBe(true);
    expect(mails[1].items_lista).toContain(mails[0].items_lista);
    expect(mails[1].reply_to).toBe(EMAIL);
    expect(pdCalls('/notes')).toHaveLength(0);
    expect(logged()).toContain('LEAD SIN CRM ' + leadRef);
  });

  it.each([
    ['el relay responde status error', () => relay('{"status":"error","message":"cuota"}')],
    ['la red falla', () => vi.fn(async () => { throw new TypeError('fetch failed'); })],
    ['el relay no responde a tiempo', () => vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); })],
  ])('Pipedrive y el correo fallan (%s): 502 y ningún correo de ATENCIÓN', async (_cause, brokenFetch) => {
    vi.stubGlobal('fetch', brokenFetch());
    vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down'));
    const res = await call(base);
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ success: false });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('con Pipedrive bien y el correo fallando responde 201, sin rechazo sin manejar', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
      const res = await call(base);
      expect(res.statusCode).toBe(201);
      expect(res.body).toMatchObject({ success: true, dealId: 777 });
      await expect(mailsSettled()).resolves.toEqual([false]);
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(vi.mocked(console.warn).mock.calls.flat().map(String).join('\n')).toContain('GAS relay FAIL');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('una nota fallida no bloquea: 201 y un aviso con dealId y referencia', async () => {
    vi.mocked(pipedrivePost).mockImplementation((async (path: string) =>
      path === '/deals' ? { success: true, data: { id: 777 } } : { success: false, data: null, error: 'HTTP 500' }) as never);
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    const warns = vi.mocked(console.warn).mock.calls.flat().map(String).join('\n');
    expect(warns).toContain('Note FAIL | dealId: 777');
    expect(warns).toContain(leadRefOf(res));
    expect(gasBodies()).toHaveLength(1);
  });

  it('negocio repetido: el resultado de búsqueda no trae pipeline_id; se mira el negocio completo y se actualiza', async () => {
    vi.mocked(pipedriveGet).mockImplementation((async (path: string) => {
      if (path === '/deals/search') return { success: true, data: { items: [{ item: { id: 42, title: 'x' } }] } };
      // El negocio guardado tiene la referencia que el endpoint calcula para este lead
      if (path === '/deals/42') return { success: true, data: { id: 42, pipeline_id: 3, status: 'open', [REF_KEY]: sentRef() } };
      return { success: false, data: null };
    }) as never);
    const res = await call(base);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, dealId: 42, dealAction: 'updated', leadRef: expect.stringMatching(/^INST-/) });
    expect(pipedriveGet).toHaveBeenCalledWith('/deals/search', expect.objectContaining({ term: leadRefOf(res) }));
    expect(pipedrivePut).toHaveBeenCalledWith('/deals/42', { title: 'Instalacion Oficina — ' + NAME + ' — Santiago' });
    expect(pdCalls('/deals')).toHaveLength(0);
    const [[, note]] = pdCalls('/notes');
    expect(note.deal_id).toBe(42);
    expect((note.content as string).startsWith('Solicitud de instalación ' + leadRefOf(res))).toBe(true);
  });

  it.each([
    ['en otro pipeline', { pipeline_id: 2, status: 'open' }],
    ['cerrado', { pipeline_id: 3, status: 'won' }],
  ])('un negocio con la misma referencia pero %s no se reutiliza: se crea uno nuevo', async (_name, deal) => {
    vi.mocked(pipedriveGet).mockImplementation((async (path: string) => {
      if (path === '/deals/search') return { success: true, data: { items: [{ item: { id: 42, pipeline_id: 3, status: 'open' } }] } };
      if (path === '/deals/42') return { success: true, data: { id: 42, ...deal, [REF_KEY]: sentRef() } };
      return { success: false, data: null };
    }) as never);
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    expect(pdCalls('/deals')).toHaveLength(1);
    expect(pipedrivePut).not.toHaveBeenCalled();
  });

  it('honeypot: responde 200 y no crea nada ni envía correo', async () => {
    const res = await call({ ...base, website: 'http://spam' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
    expect(pipedrivePost).not.toHaveBeenCalled();
  });

  it.each([
    ['teléfono de 7 dígitos', { telefono: '2123456' }],
    ['correo sin dominio (a@b)', { email: 'a@b' }],
    ['descripción de 2001 caracteres', { descripcion: 'd'.repeat(2001) }],
    ['nombre de 121 caracteres', { nombre: 'n'.repeat(121) }],
    ['correo de 255 caracteres', { email: 'a'.repeat(243) + '@example.com' }],
    ['teléfono de 31 caracteres', { telefono: '+56 9 1234 5678' + ' '.repeat(16) }],
    ['comuna de 81 caracteres', { comuna: 'c'.repeat(81) }],
    ['tipoCliente no es texto', { tipoCliente: 1 }],
    ['preferenciaContacto null', { preferenciaContacto: null }],
  ])('%s: 400 sin correo ni Pipedrive', async (_name, extra) => {
    const res = await call({ ...base, ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
    expect(pipedrivePost).not.toHaveBeenCalled();
  });

  it('con los largos máximos permitidos el lead se acepta', async () => {
    const res = await call({ ...base, nombre: 'n'.repeat(120), comuna: 'c'.repeat(80), descripcion: 'd'.repeat(2000) });
    expect(res.statusCode).toBe(201);
    expect(gasBodies()[0].items_lista).toContain('d'.repeat(2000));
    expect(gasBodies()[0].items_lista).not.toContain('recortado');
  });

  it('en producción bloquea orígenes desconocidos (403) sin correo ni Pipedrive', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const bad = await call(base, { origin: 'https://spam.example' });
    expect(bad.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
    const ok = await call(base, { origin: 'https://nuevo.elights.cl' });
    expect(ok.statusCode).toBe(201);
  });

  it('429 después de 10 solicitudes desde la misma IP, sin correo', async () => {
    const ip = '10.9.3.250';
    for (let i = 0; i < 10; i++) await call({ ...base, website: 'http://spam' }, { ip });
    const res = await call(base, { ip });
    expect(res.statusCode).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('GET responde 405', async () => {
    const res = await call(undefined, { method: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  it('from_name no lleva saltos de línea aunque el nombre los traiga', async () => {
    const res = await call({ ...base, nombre: 'PRUEBA\r\nBcc: otro@example.com' });
    expect(res.statusCode).toBe(201);
    const [mail] = gasBodies();
    expect(mail.from_name).not.toMatch(/[\r\n]/);
    expect(mail.nombre).not.toMatch(/[\r\n]/);
  });

  // Cubre las líneas de log del endpoint y del ayudante de correo. persons.js está
  // simulado: su propio log (protegido) queda fuera de esta prueba.
  it('las líneas de log no llevan el correo, el teléfono ni el nombre del cliente', async () => {
    await call(base);
    vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down'));
    await call(base);
    // Un relay que repite lo que recibió tampoco llega al log
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'error', message: 'Invalid email: ' + EMAIL + ' ' + NAME + ' ' + PHONE })));
    await call(base);
    await call({ ...base, telefono: '123' });
    await call({ ...base, website: 'http://spam' });
    await mailsSettled();
    const text = logged();
    expect(text).toContain('LEAD SIN CRM');
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(NAME);
  });
});

// --- Origen de la visita (Etapa 2 · PR 10) ---
// El formulario manda `attribution` (aparte de su campo `origen`, que sigue siendo una lista
// cerrada); el servidor lo limpia y agrega la sección "ORIGEN DE LA VISITA" al final del
// correo y de la nota. Un origen raro se descarta: nunca da 400.

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

describe('POST /api/installation-leads/create: origen de la visita', () => {
  beforeEach(() => {
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockImplementation((async (path: string) =>
      path === '/deals' ? { success: true, data: { id: 777 } } : { success: true, data: { id: 1 } }) as never);
    vi.mocked(pipedriveGet).mockReset().mockResolvedValue({ success: true, data: { items: [] } } as never);
    vi.mocked(pipedrivePut).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(waitUntil).mockClear();
    vi.stubEnv('PIPEDRIVE_INSTALL_PIPELINE_ID', '3');
    vi.stubEnv('PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID', '30');
    vi.stubEnv('PIPEDRIVE_OWNER_USER_ID', '1');
    vi.stubEnv('PIPEDRIVE_FIELD_TIPO_SERVICIO', TIPO_KEY);
    vi.stubEnv('PIPEDRIVE_INSTALL_FIELD_LEAD_REF', REF_KEY);
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

  const noteContents = () => pdCalls('/notes').map(([, note]) => note.content as string);

  it('el correo y la nota terminan con la sección (la nota, después del puntaje)', async () => {
    const res = await call({ ...base, attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const [content] = noteContents();
    expect(content).toMatch(/\nPuntaje: .*\n\n--- ORIGEN DE LA VISITA ---\n/);
    expect(content.endsWith('\n\n' + ORIGEN_GADS)).toBe(true);
    expect(gasBodies()[0].items_lista.endsWith('\n\n' + ORIGEN_GADS)).toBe(true);
    expect(content).not.toContain('q=');
  });

  it('sin origen (formulario anterior): la sección dice "Sin datos"', async () => {
    await call(base);
    expect(noteContents()[0].endsWith(SIN_DATOS)).toBe(true);
    expect(gasBodies()[0].items_lista.endsWith(SIN_DATOS)).toBe(true);
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
    vi.mocked(pipedriveGet).mockImplementation((async (path: string) => {
      if (path === '/deals/search') return { success: true, data: { items: [{ item: { id: 42 } }] } };
      if (path === '/deals/42') return { success: true, data: { id: 42, pipeline_id: 3, status: 'open', [REF_KEY]: sentRef() } };
      return { success: false, data: null };
    }) as never);
    const res = await call({ ...base, attribution: ATTRIBUTION });
    expect(res.body).toMatchObject({ dealId: 42, dealAction: 'updated' });
    const [[, note]] = pdCalls('/notes');
    expect(note.deal_id).toBe(42);
    expect((note.content as string).endsWith(ORIGEN_GADS)).toBe(true);
  });

  it('el campo origen sigue siendo una lista cerrada; attribution es otra clave y no choca con él', async () => {
    expect((await call({ ...base, origen: 'otro', attribution: ATTRIBUTION })).statusCode).toBe(400);
    expect((await call({ ...base, attribution: { origen: 'otro' } })).statusCode).toBe(201);
    expect((await call({ ...base, attribution: ATTRIBUTION })).statusCode).toBe(201);
  });

  it.each(BAD_ATTRIBUTIONS)('origen inválido (%s): nunca 400, y solo lo limpio llega a la nota y al correo', async (_name, attribution, expected) => {
    const res = await call({ ...base, attribution });
    expect(res.statusCode).toBe(201);
    for (const text of [noteContents()[0], gasBodies()[0].items_lista]) {
      expect(text).toContain(expected);
      expect(text).not.toMatch(/<script|g{201}|s{201}|RUT-PRUEBA/);
    }
  });

  it('referencias de carácter en el origen (&#10;, &#x0A;, &quot;): ningún & llega a la nota ni al correo, y la sección no suma líneas', async () => {
    const res = await call({ ...base, attribution: CHAR_REF_ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    for (const text of [noteContents()[0], gasBodies()[0].items_lista]) {
      expect(text.endsWith('\n\n' + ORIGEN_CHAR_REF)).toBe(true);
      expect(text).not.toMatch(/&(?:#|quot;|NewLine;)/i);
    }
  });

  it('el origen no cambia la referencia INST-', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T15:10:00Z'));
    const a = await call({ ...base, attribution: ATTRIBUTION });
    const b = await call({ ...base, attribution: { fbclid: 'IwAREJEMPLO', landing: '/' } });
    expect(leadRefOf(a)).toMatch(/^INST-/);
    expect(leadRefOf(b)).toBe(leadRefOf(a));
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
