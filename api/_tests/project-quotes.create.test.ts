// api/_tests/project-quotes.create.test.ts
// Cotizador de proyecto (/cotizador): el correo a ventas sale ANTES de Pipedrive y lleva la
// misma referencia PY- que el negocio y la nota. Sin productos ni precios: el negocio vale 0
// y cualquier precio que mande el navegador se ignora. Si Pipedrive falla pero el correo
// salió, el lead no se pierde (200 + correo de ATENCIÓN); 502 solo si fallan los dos. Exige
// la casilla de privacidad y deja la constancia en el correo y la nota. Pipedrive y el relay
// están simulados. Vive en api/_tests/ para que Vercel no lo despliegue
// como función.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Otro dominio garantiza que el correo y la nota siguen la configuración compartida.
vi.mock('../_lib/site.js', () => ({ SITE_URL: 'https://sitio.example' }));
vi.mock('../_lib/pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn() }));
vi.mock('../_lib/pipedrive/organizations.js', () => ({ findOrCreateOrganization: vi.fn() }));
vi.mock('../_lib/pipedrive/deals.js', () => ({ createDeal: vi.fn() }));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn(), pipedriveUploadFile: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
// Adjuntos: Blob simulado (head, get, del); los errores de verdad, para BlobNotFoundError.
vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  head: vi.fn(),
  get: vi.fn(),
  del: vi.fn(async () => {}),
}));

import { SITE_URL } from '../_lib/site.js';
import handler, { validateProjectQuote } from '../project-quotes/create';
import { ILLUMINATION_LEVELS, PROJECT_TYPES } from '../_lib/forms/projectQuote';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { findOrCreateOrganization } from '../_lib/pipedrive/organizations.js';
import { createDeal } from '../_lib/pipedrive/deals.js';
import { pipedrivePost, pipedriveUploadFile } from '../_lib/pipedrive/client.js';
import { waitUntil } from '@vercel/functions';
import { BlobNotFoundError, del, get, head } from '@vercel/blob';
import { pendingKey } from '../_lib/attachments/quota';
import { UPSTASH_URL, createFakeRedis, fakeFetch, type FakeRedis } from './fakeUpstash';
import {
  CONSENT_ERROR_CODE,
  CONSENT_HEADING,
  LEGAL_VERSION,
  consentGraceUntil,
  formatConsentSection,
  formatLegacyConsentSection,
  lastConsentRecord,
} from '../_lib/forms/consent';

let ipSeq = 0;
function call(body: unknown, opts: { method?: string; ip?: string; origin?: string } = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  const req = {
    method: opts.method ?? 'POST',
    headers: { 'x-forwarded-for': opts.ip ?? `10.4.0.${++ipSeq}`, ...(opts.origin ? { origin: opts.origin } : {}) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}

const EMAIL = 'prueba-etapa2-09d@example.com';
const PHONE = '+56 9 1111 1111';
const NAME = 'PRUEBA ETAPA 2';
const RUT = 'RUT-PRUEBA'; // marcador: nunca un valor con forma de RUT
/** Casilla de privacidad marcada, como la manda /cotizador (sin novedades). */
const CONSENT = { privacy: true, marketing: false, version: LEGAL_VERSION };
const base = { tipoProyecto: 'Bodega', m2: 1200, nombre: NAME, email: EMAIL, telefono: PHONE, website: '', consent: CONSENT };
const full = {
  ...base,
  altura: 8,
  aplicacion: 'PRUEBA aplicación general',
  nivelIluminacion: 'Estandar',
  ciudad: 'Santiago',
  plazo: 'PRUEBA 3 meses',
  comentarios: 'PRUEBA ETAPA 2 (09d) - no cotizar',
  razonSocial: 'PRUEBA EMPRESA',
  rutEmpresa: RUT,
  giro: 'PRUEBA giro',
  direccion: 'PRUEBA dirección 123',
};

type PdCall = [string, { content: string; deal_id: number }];
const notes = () =>
  (vi.mocked(pipedrivePost).mock.calls as unknown as PdCall[]).filter(([path]) => path === '/notes').map(([, body]) => body);
const gasCalls = () => vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][];
const gasBodies = () => gasCalls().map(([, init]) => JSON.parse(init.body as string) as Record<string, string>);
const relay = (text: string) => vi.fn(async () => ({ ok: true, status: 200, text: async () => text }));
const dealArgs = () => vi.mocked(createDeal).mock.calls[0][0];
const refOf = (res: { body: unknown }) => (res.body as { reference: string }).reference;
/** Espera los correos registrados en waitUntil. */
const mailsSettled = () => Promise.all(vi.mocked(waitUntil).mock.calls.map(([p]) => p));
const logged = () =>
  [console.log, console.warn, console.error]
    .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
    .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join('\n');

describe('POST /api/project-quotes/create', () => {
  beforeEach(() => {
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(findOrCreateOrganization).mockReset().mockResolvedValue({ organizationId: 22, action: 'created' });
    vi.mocked(createDeal).mockReset().mockResolvedValue({ dealId: 999, status: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(waitUntil).mockClear();
    vi.mocked(head).mockClear();
    vi.mocked(del).mockClear();
    vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
    vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '2');
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('sin archivos no se toca Blob (como antes de los adjuntos)', async () => {
    const res = await call(full);
    expect(res.statusCode).toBe(201);
    expect(head).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(notes()).toHaveLength(1);
    expect(notes()[0].content).not.toContain('ARCHIVOS');
  });

  it('GET responde 405 con Allow: POST', async () => {
    const res = await call(undefined, { method: 'GET' });
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('persona: 201 y un negocio de proyecto con valor 0, Tipo de Servicio 89 y la misma referencia', async () => {
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true, reference: expect.stringMatching(/^PY-[0-9a-z]+$/), dealId: 999 });
    const reference = refOf(res);
    expect(dealArgs()).toMatchObject({
      personId: 11,
      pipelineId: 1,
      stageId: 2,
      title: `Proyecto ${reference} - Bodega 1200 m2 - PRUEBA ETAPA 2`,
      quoteAmountClp: 0,
      sourceSystem: 'nuevo_elights',
      tipoServicio: 89,
      leadType: 'B2C',
      quoteReference: reference,
    });
    expect(dealArgs().orgId).toBeUndefined();
    expect(findOrCreateOrganization).not.toHaveBeenCalled();
    expect(vi.mocked(findOrCreatePerson).mock.calls[0][0]).toMatchObject({ name: NAME, email: EMAIL, phone: '+56911111111' });
  });

  it('empresa: crea la organización, la pasa al negocio y el lead es B2B', async () => {
    const res = await call({ ...base, razonSocial: 'PRUEBA EMPRESA' });
    expect(res.statusCode).toBe(201);
    expect(findOrCreateOrganization).toHaveBeenCalledWith({ name: 'PRUEBA EMPRESA' });
    expect(dealArgs()).toMatchObject({ orgId: 22, leadType: 'B2B' });
  });

  it('solo con RUT de empresa el lead es B2B, sin crear organización', async () => {
    const res = await call({ ...base, rutEmpresa: RUT });
    expect(res.statusCode).toBe(201);
    expect(findOrCreateOrganization).not.toHaveBeenCalled();
    expect(dealArgs()).toMatchObject({ leadType: 'B2B' });
  });

  it('la nota del negocio lleva la referencia, el proyecto, el contacto, la empresa y los comentarios', async () => {
    const res = await call(full);
    const reference = refOf(res);
    const [note] = notes();
    expect(note.deal_id).toBe(999);
    expect(note.content.startsWith('=== COTIZADOR DE PROYECTO')).toBe(true);
    for (const text of [
      'Referencia: ' + reference,
      '--- PROYECTO ---',
      'Tipo de proyecto: Bodega',
      'm2 aproximados: 1200',
      'Altura (m): 8',
      'Aplicación: PRUEBA aplicación general',
      'Nivel de iluminación: Estandar',
      'Ciudad / Región: Santiago',
      'Plazo: PRUEBA 3 meses',
      '--- CONTACTO ---',
      'Nombre: ' + NAME,
      'Email: ' + EMAIL,
      'Teléfono: ' + PHONE,
      'Tipo de cliente: Empresa (B2B)',
      'Razón social: PRUEBA EMPRESA',
      'RUT empresa: ' + RUT,
      'Giro: PRUEBA giro',
      'Dirección: PRUEBA dirección 123',
      '--- COMENTARIOS ---\nPRUEBA ETAPA 2 (09d) - no cotizar',
      'Sin productos ni precios: preparar propuesta y responder con link de pago de Flow.',
    ]) {
      expect(note.content).toContain(text);
    }
    expect(note.content).not.toContain('(no indicado)');
  });

  it.each(['created', 'skipped_duplicate'] as const)('la nota de Pipedrive usa SITE_URL en el enlace al cotizador (%s)', async (status) => {
    vi.mocked(createDeal).mockResolvedValue({ dealId: 999, status });
    await call(base);
    const [note] = notes();
    expect(note.content.split('\n')).toContain(`=== COTIZADOR DE PROYECTO (${SITE_URL}/cotizador) ===`);
  });

  it('los opcionales vacíos dicen "(no indicado)" en la nota', async () => {
    await call({ ...base, aplicacion: '', ciudad: '   ', altura: null });
    const [note] = notes();
    for (const label of ['Altura (m)', 'Aplicación', 'Nivel de iluminación', 'Ciudad / Región', 'Plazo', 'Razón social', 'RUT empresa', 'Giro', 'Dirección']) {
      expect(note.content).toContain(`${label}: (no indicado)`);
    }
    expect(note.content).toContain('Tipo de cliente: Persona (B2C)');
    expect(note.content).toContain('--- COMENTARIOS ---\n(sin comentarios)');
  });

  it('reenvío del mismo formulario (skipped_duplicate): 200 y la nota en el negocio existente, marcada como reenvío', async () => {
    vi.mocked(createDeal).mockResolvedValue({ dealId: 555, status: 'skipped_duplicate' });
    const res = await call(full);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, reference: refOf(res), dealId: 555 });
    const [note] = notes();
    expect(note.deal_id).toBe(555);
    expect(note.content.startsWith('Reenvío del mismo formulario')).toBe(true);
    expect(note.content).toContain('misma referencia ' + refOf(res));
    expect(note.content).toContain('=== COTIZADOR DE PROYECTO');
  });

  it.each([
    ['responde success:false', () => vi.mocked(pipedrivePost).mockResolvedValue({ success: false, data: null, error: 'HTTP 500' } as never)],
    ['lanza', () => vi.mocked(pipedrivePost).mockRejectedValue(new Error('[Pipedrive] PIPEDRIVE_API_TOKEN is not set'))],
  ])('una nota que %s no bloquea: 201 y un aviso con el dealId', async (_cause, breakNote) => {
    breakNote();
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    const warnings = vi.mocked(console.warn).mock.calls.flat().map(String).join('\n');
    expect(warnings).toContain('Nota en Pipedrive FAIL | dealId: 999');
    expect(gasBodies()).toHaveLength(1);
  });

  it('la nota escapa el HTML y un campo de una línea no agrega líneas', async () => {
    await call({ ...full, giro: 'PRUEBA\nTOTAL CON IVA: 1 CLP <a href="https://x.example">pagar</a>', comentarios: 'línea 1\n<b>línea 2</b>' });
    const [note] = notes();
    expect(note.content).toContain('Giro: PRUEBA TOTAL CON IVA: 1 CLP &lt;a href="https://x.example"&gt;pagar&lt;/a&gt;');
    expect(note.content).toContain('línea 1\n&lt;b&gt;línea 2&lt;/b&gt;');
    expect(note.content).not.toMatch(/<a|<b>/);
    expect(note.content.split('\n').some((line) => line.startsWith('TOTAL'))).toBe(false);
  });

  it('los precios que manda el navegador se ignoran: el negocio vale 0 y no aparecen en la nota ni en el correo', async () => {
    const res = await call({ ...base, quoteAmountClp: 999999, unitPrice: 777777, products: [{ sku: 'X', unitPrice: 777777 }] });
    expect(res.statusCode).toBe(201);
    expect(dealArgs().quoteAmountClp).toBe(0);
    const [note] = notes();
    const mail = JSON.stringify(gasBodies());
    for (const text of ['999999', '777777', 'unitPrice', 'quoteAmountClp']) {
      expect(note.content).not.toContain(text);
      expect(mail).not.toContain(text);
    }
  });

  it('el correo sale antes de Pipedrive, a ventas@, con el modo, la referencia y las líneas del proyecto', async () => {
    const res = await call(base);
    const reference = refOf(res);
    const [[url]] = gasCalls();
    expect(url).toBe(process.env.GAS_RELAY_URL);
    const fetchOrder = vi.mocked(fetch).mock.invocationCallOrder[0];
    expect(fetchOrder).toBeLessThan(vi.mocked(findOrCreatePerson).mock.invocationCallOrder[0]);
    expect(fetchOrder).toBeLessThan(vi.mocked(createDeal).mock.invocationCallOrder[0]);

    const mails = gasBodies();
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail).toMatchObject({
      to_email: 'ventas@elights.cl',
      reply_to: EMAIL,
      from_name: NAME,
      nombre: NAME,
      telefono: PHONE,
      modo_precio: 'Proyecto (sin precios)',
      total: '-',
    });
    expect(mail.items_lista.split('\n')[0]).toBe(`Cotizador de proyecto ${reference} (${SITE_URL}/cotizador)`);
    expect(mail.items_lista).toContain('Tipo de proyecto: Bodega');
    expect(mail.items_lista).toContain('m2 aproximados: 1200');
    for (const key of ['razon_social', 'rut_empresa', 'giro', 'direccion', 'comentarios']) {
      expect(mail).not.toHaveProperty(key);
    }
    expect(Object.values(mail).join('\n')).not.toContain('undefined');
  });

  it('con empresa y comentarios, el correo lleva razón social, RUT, giro, dirección y comentarios', async () => {
    await call(full);
    const [mail] = gasBodies();
    expect(mail).toMatchObject({
      razon_social: 'PRUEBA EMPRESA',
      rut_empresa: RUT,
      giro: 'PRUEBA giro',
      direccion: 'PRUEBA dirección 123',
      comentarios: 'PRUEBA ETAPA 2 (09d) - no cotizar',
    });
    for (const text of ['Altura (m): 8', 'Aplicación: PRUEBA aplicación general', 'Nivel de iluminación: Estandar', 'Ciudad / Región: Santiago', 'Plazo: PRUEBA 3 meses']) {
      expect(mail.items_lista).toContain(text);
    }
  });

  it('SALES_EMAIL cambia el destinatario del correo', async () => {
    vi.stubEnv('SALES_EMAIL', 'otra-casilla@example.com');
    await call(base);
    expect(gasBodies()[0].to_email).toBe('otra-casilla@example.com');
  });

  it.each([
    ['createDeal rechaza', () => { vi.mocked(createDeal).mockRejectedValue(new Error('[deals] Failed to create deal: HTTP 500')); }],
    ['createDeal no devuelve negocio', () => { vi.mocked(createDeal).mockResolvedValue({ dealId: null, status: 'skipped_lock_contention' }); }],
    ['findOrCreatePerson rechaza', () => { vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down')); }],
    ['falta PIPEDRIVE_PIPELINE_ID', () => { vi.stubEnv('PIPEDRIVE_PIPELINE_ID', ''); }],
  ])('Pipedrive falla (%s) y el correo salió: 200 sin negocio + correo de ATENCIÓN', async (_cause, breakCrm) => {
    breakCrm();
    const res = await call(base);
    expect(res.statusCode).toBe(200);
    const reference = refOf(res);
    expect(res.body).toEqual({ success: true, reference, dealId: null, crm: 'failed' });
    expect(reference).toMatch(/^PY-/);

    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    expect(mails[1].items_lista.startsWith(`ATENCIÓN: la solicitud ${reference} NO quedó en Pipedrive. Crear el negocio a mano.`)).toBe(true);
    expect(mails[1].items_lista).toContain(mails[0].items_lista);
    expect(mails[1].reply_to).toBe(EMAIL);
    expect(logged()).toContain('LEAD SIN CRM ' + reference);
  });

  it('sin PIPEDRIVE_PIPELINE_ID no se toca Pipedrive (ni persona ni organización)', async () => {
    vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '');
    const res = await call(full);
    expect(res.statusCode).toBe(200);
    expect(findOrCreatePerson).not.toHaveBeenCalled();
    expect(findOrCreateOrganization).not.toHaveBeenCalled();
    expect(createDeal).not.toHaveBeenCalled();
  });

  it.each([
    ['el relay responde status error', () => relay('{"status":"error","message":"cuota"}')],
    ['la red falla', () => vi.fn(async () => { throw new TypeError('fetch failed'); })],
  ])('Pipedrive y el correo fallan (%s): 502 y ningún correo de ATENCIÓN', async (_cause, brokenFetch) => {
    vi.stubGlobal('fetch', brokenFetch());
    vi.mocked(createDeal).mockRejectedValue(new Error('[deals] down'));
    const res = await call(base);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      success: false,
      error: 'No pudimos registrar tu solicitud. Inténtalo de nuevo o escríbenos a ventas@elights.cl.',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/whatsapp/i);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('con Pipedrive bien y el correo fallando responde 201 y deja un aviso', async () => {
    vi.stubGlobal('fetch', relay('<html>Error</html>'));
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    await mailsSettled();
    expect(vi.mocked(console.warn).mock.calls.flat().map(String).join('\n')).toContain('GAS relay FAIL');
  });

  it('un comentario largo llega completo a los dos correos aunque Pipedrive falle', async () => {
    vi.mocked(createDeal).mockRejectedValue(new Error('[deals] down'));
    const comentarios = 'Proyecto bodega. ' + 'x'.repeat(1500) + ' FIN-DEL-COMENTARIO';
    const res = await call({ ...base, comentarios });
    expect(res.statusCode).toBe(200);
    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    for (const mail of mails) {
      expect(mail.items_lista).toContain(comentarios);
      expect(mail.items_lista).not.toContain('recortado');
      expect(mail.comentarios.length).toBeLessThanOrEqual(500);
      expect(mail.comentarios).not.toContain('recortado');
      expect(mail.comentarios).toContain('va completo al final de PRODUCTOS SOLICITADOS');
    }
  });

  it('un comentario de 500 caracteres va entero en COMENTARIOS', async () => {
    const comentarios = 'c'.repeat(500);
    await call({ ...base, comentarios });
    const [mail] = gasBodies();
    expect(mail.comentarios).toBe(comentarios);
    expect(mail.items_lista).not.toContain(comentarios);
  });

  it('con todos los campos al máximo, ningún correo se recorta', async () => {
    vi.mocked(createDeal).mockRejectedValue(new Error('[deals] down'));
    const max = {
      ...full,
      nombre: 'n'.repeat(120), tipoProyecto: 'Industria', aplicacion: 'a'.repeat(200), nivelIluminacion: 'Alto rendimiento',
      ciudad: 'c'.repeat(200), plazo: 'p'.repeat(200), comentarios: 'k'.repeat(1999) + 'Z', razonSocial: 'r'.repeat(150),
      giro: 'g'.repeat(150), direccion: 'd'.repeat(200), m2: 10_000_000, altura: 200,
    };
    const res = await call(max);
    expect(res.statusCode).toBe(200);
    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    for (const mail of mails) {
      expect(JSON.stringify(mail)).not.toContain('recortado');
      expect(mail.items_lista).toContain(max.comentarios);
    }
  });

  it.each([
    ['sin nombre', { nombre: undefined }],
    ['sin email', { email: '' }],
    ['sin teléfono', { telefono: undefined }],
    ['sin tipo de proyecto', { tipoProyecto: '  ' }],
    // Solo las opciones de la lista del formulario, exactas
    ["tipo de proyecto 'x@y.cl'", { tipoProyecto: 'x@y.cl' }],
    ["tipo de proyecto 'bodega' (minúscula)", { tipoProyecto: 'bodega' }],
    ['tipo de proyecto numérico', { tipoProyecto: 3 }],
    ["nivel de iluminación 'x@y.cl'", { nivelIluminacion: 'x@y.cl' }],
    ['sin m2', { m2: undefined }],
    ["m2 '0'", { m2: '0' }],
    ["m2 '-5'", { m2: '-5' }],
    ["m2 'abc'", { m2: 'abc' }],
    // Como texto, los m² se leen igual que en el formulario: lo ambiguo no se adivina
    ["m2 '12,5'", { m2: '12,5' }],
    ["m2 '1,200'", { m2: '1,200' }],
    ["m2 '12.5'", { m2: '12.5' }],
    ["m2 '12 000'", { m2: '12 000' }],
    ["m2 '1.2000'", { m2: '1.2000' }],
    ['m2 sobre 10.000.000', { m2: 10_000_001 }],
    ["email 'x@'", { email: 'x@' }],
    ['teléfono de 7 dígitos', { telefono: '212 3456' }],
    ['teléfono de 13 dígitos', { telefono: '+56 9 1111 111122' }],
    ['comentarios de 2001 caracteres', { comentarios: 'c'.repeat(2001) }],
    ['nombre numérico', { nombre: 123 }],
    ['altura de 201 m', { altura: 201 }],
    ['RUT de empresa de 21 caracteres', { rutEmpresa: 'R'.repeat(21) }],
  ])('%s: 400 sin correo ni Pipedrive', async (_name, extra) => {
    const res = await call({ ...base, ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: 'Validation failed', details: { errors: expect.any(Array) } });
    expect(fetch).not.toHaveBeenCalled();
    expect(createDeal).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
  });

  it.each([
    ['12.000', 12000],
    ['1.200', 1200],
    ['100.000', 100000],
    [' 1200 ', 1200],
  ])("m2 '%s' como texto son %i (punto de miles, como en el formulario)", (text, expected) => {
    const v = validateProjectQuote({ ...base, m2: text });
    expect(v.valid).toBe(true);
    expect(v.quote.m2).toBe(expected);
  });

  it("m2 '12.000' llega como 12000 al título del negocio y al correo, no como 12", async () => {
    const res = await call({ ...base, m2: '12.000' });
    expect(res.statusCode).toBe(201);
    expect(dealArgs().title).toBe(`Proyecto ${refOf(res)} - Bodega 12000 m2 - ${NAME}`);
    expect(gasBodies()[0].items_lista).toContain('m2 aproximados: 12000\n');
  });

  it.each(PROJECT_TYPES.map((t) => [t]))("acepta el tipo de proyecto '%s' de la lista", (tipoProyecto) => {
    expect(validateProjectQuote({ ...base, tipoProyecto }).quote?.tipoProyecto).toBe(tipoProyecto);
  });

  it.each(ILLUMINATION_LEVELS.map((l) => [l]))("acepta el nivel de iluminación '%s' de la lista", (nivelIluminacion) => {
    expect(validateProjectQuote({ ...base, nivelIluminacion }).quote?.nivelIluminacion).toBe(nivelIluminacion);
  });

  it('un tipo de proyecto fuera de la lista (correo, teléfono, nombre, escape) da 400 y no llega al log ni al correo', async () => {
    for (const tipoProyecto of ['juan.perez@gmail.com +56912345678 Juan Perez', 'x\u001b[2Jy']) {
      const res = await call({ ...base, tipoProyecto });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(tipoProyecto);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(createDeal).not.toHaveBeenCalled();
    const text = logged();
    expect(text).toContain('Validación FAIL');
    for (const leak of ['juan.perez', '56912345678', 'Juan Perez', '\u001b']) {
      expect(text).not.toContain(leak);
    }
  });

  it('acepta m2 y altura como texto numérico y arma un objeto solo con las claves conocidas', () => {
    const v = validateProjectQuote({ ...base, m2: '1200', altura: '8,5', comentarios: '  hola\r\nchao  ', ciudad: '  Santiago\n Centro ', extra: 'x', quoteAmountClp: 5 });
    expect(v.valid).toBe(true);
    expect(v.quote).toEqual({ nombre: NAME, email: EMAIL, telefono: PHONE, tipoProyecto: 'Bodega', m2: 1200, altura: 8.5, ciudad: 'Santiago Centro', comentarios: 'hola\nchao' });
  });

  it('honeypot: responde 200 y no crea nada', async () => {
    const res = await call({ ...base, website: 'http://spam' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
    expect(createDeal).not.toHaveBeenCalled();
  });

  it('en producción bloquea orígenes desconocidos (403) y acepta nuevo.elights.cl', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const bad = await call(base, { origin: 'https://spam.example' });
    expect(bad.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    const ok = await call(base, { origin: 'https://nuevo.elights.cl' });
    expect(ok.statusCode).toBe(201);
  });

  it('límite de solicitudes por IP: la 11.ª recibe 429, sin correo', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call(base, { ip: '203.0.113.9' })).statusCode);
    expect(statuses.slice(0, 10).every((s) => s === 201 || s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('referencia: el mismo formulario en la misma hora da la misma; otro comentario u otra hora, otra', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T15:05:00Z'));
    const first = refOf(await call(base));
    vi.setSystemTime(new Date('2026-10-06T15:55:00Z'));
    const sameHour = refOf(await call(base));
    const otherComment = refOf(await call({ ...base, comentarios: 'otro comentario' }));
    vi.setSystemTime(new Date('2026-10-06T16:05:00Z'));
    const nextHour = refOf(await call(base));
    expect(sameHour).toBe(first);
    expect(otherComment).not.toBe(first);
    expect(nextHour).not.toBe(first);
    // La referencia del negocio es la misma que la de la respuesta
    expect(vi.mocked(createDeal).mock.calls.map(([d]) => d.quoteReference)).toEqual([first, sameHour, otherComment, nextHour]);
  });

  // Cubre las líneas de log del endpoint y del ayudante de correo. persons.js está
  // simulado: su propio log (protegido) queda fuera de esta prueba.
  it('los logs no llevan el correo, el teléfono, el nombre, la empresa ni el RUT', async () => {
    await call(full);
    vi.mocked(createDeal).mockRejectedValueOnce(new Error('[deals] down'));
    await call(full);
    // Un relay que repite lo que recibió tampoco llega al log
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'error', message: `Invalid email: ${EMAIL} ${NAME} ${PHONE} ${RUT}` })));
    await call(full);
    await call({ ...full, telefono: '123' });
    await call({ ...full, website: 'http://spam' });
    await mailsSettled();
    const text = logged();
    expect(text).toContain('LEAD SIN CRM');
    expect(text).toContain('tipo: Bodega | m2: 1200 | hasCompany: true');
    for (const pii of [EMAIL, PHONE, '+56911111111', '911111111', NAME, RUT, 'PRUEBA EMPRESA', 'PRUEBA dirección', 'PRUEBA giro']) {
      expect(text).not.toContain(pii);
    }
  });
});

// --- Origen de la visita (Etapa 2 · PR 10) ---
// El cotizador manda `attribution`; validateProjectQuote arma un objeto limpio sin él, y el
// endpoint lo lee del cuerpo, lo limpia y agrega la sección "ORIGEN DE LA VISITA" al final
// del correo y de la nota (HTML escapado). Un origen raro se descarta: nunca da 400.

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
const AT = '2026-11-20T14:03:12Z';
/** Constancia esperada de /cotizador en el instante AT. */
const expectedSection = (marketing: boolean) =>
  formatConsentSection({
    consent: { privacy: true, terms: false, marketing, clientVersion: LEGAL_VERSION },
    at: new Date(AT),
    form: 'cotizador',
  }).join('\n');
const BAD_ATTRIBUTIONS: [string, unknown, string][] = [
  ['un texto', 'gclid=' + GCLID, SIN_DATOS],
  ['una lista', [GCLID], SIN_DATOS],
  ['un número', 42, SIN_DATOS],
  ['valores enormes', { gclid: 'g'.repeat(10_000), utm_source: 's'.repeat(10_000) }, 'gclid: ' + 'g'.repeat(200) + '\nutm_source: ' + 's'.repeat(200)],
  ['una etiqueta script', { utm_campaign: '<script>alert(1)</script>', landing: '/<script>' }, 'utm_campaign: scriptalert(1)/script\nPágina de entrada: /script'],
  ['claves email o rut', { email: EMAIL, rut: RUT, nombre: NAME }, SIN_DATOS],
];

describe('POST /api/project-quotes/create: origen de la visita', () => {
  beforeEach(() => {
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(findOrCreateOrganization).mockReset().mockResolvedValue({ organizationId: 22, action: 'created' });
    vi.mocked(createDeal).mockReset().mockResolvedValue({ dealId: 999, status: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(waitUntil).mockClear();
    vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
    vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '2');
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('el correo y la nota terminan con la constancia y la sección', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
    const res = await call({ ...full, attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const [note] = notes();
    expect(note.content.endsWith('source: cotizador | landingPath: /cotizador\n\n' + expectedSection(false) + '\n\n' + ORIGEN_GADS)).toBe(true);
    expect(gasBodies()[0].items_lista.endsWith('\n\n' + expectedSection(false) + '\n\n' + ORIGEN_GADS)).toBe(true);
    expect(note.content).not.toContain('q=');
  });

  it('sin origen (formulario anterior): la sección dice "Sin datos"', async () => {
    await call(base);
    expect(notes()[0].content.endsWith(SIN_DATOS)).toBe(true);
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

  it('reenvío del mismo formulario (skipped_duplicate): la nota del reenvío lleva la constancia y la sección', async () => {
    vi.mocked(createDeal).mockResolvedValue({ dealId: 555, status: 'skipped_duplicate' });
    await call({ ...full, attribution: ATTRIBUTION });
    const [note] = notes();
    expect(note.content.startsWith('Reenvío del mismo formulario')).toBe(true);
    expect(note.content).toContain('\n\n' + CONSENT_HEADING + '\n');
    expect(note.content.endsWith(ORIGEN_GADS)).toBe(true);
    expect(lastConsentRecord(note.content)).toMatchObject({ form: 'cotizador', privacy: true, src: 'web' });
  });

  it('comentario largo: el correo lleva completos los comentarios y después la constancia y la sección', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
    const comentarios = 'PRUEBA ' + 'c'.repeat(1900) + ' FIN';
    await call({ ...base, comentarios, attribution: ATTRIBUTION });
    const [mail] = gasBodies();
    expect(mail.items_lista).toContain(
      'Comentarios del cliente (completos):\n' + comentarios + '\n\n' + expectedSection(false) + '\n\n' + ORIGEN_GADS,
    );
    expect(mail.items_lista).not.toContain('recortado');
  });

  it.each(BAD_ATTRIBUTIONS)('origen inválido (%s): nunca 400, y solo lo limpio llega a la nota y al correo', async (_name, attribution, expected) => {
    const res = await call({ ...base, attribution });
    expect(res.statusCode).toBe(201);
    for (const text of [notes()[0].content, gasBodies()[0].items_lista]) {
      expect(text).toContain(expected);
      expect(text).not.toMatch(/<script|&lt;script|g{201}|s{201}/);
    }
    expect(notes()[0].content).not.toContain('RUT empresa: ' + RUT);
  });

  it('el origen no cambia la referencia PY-', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T15:10:00Z'));
    const a = await call({ ...full, attribution: ATTRIBUTION });
    const b = await call({ ...full, attribution: { fbclid: 'IwAREJEMPLO', landing: '/' } });
    expect(refOf(a)).toMatch(/^PY-/);
    expect(refOf(b)).toBe(refOf(a));
  });

  it('el log no lleva el origen ni datos del cliente', async () => {
    await call({ ...full, attribution: ATTRIBUTION });
    vi.mocked(findOrCreatePerson).mockRejectedValue(new Error('[Pipedrive] down'));
    await call({ ...full, attribution: ATTRIBUTION });
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'error', message: 'Invalid: ' + EMAIL + ' ' + GCLID })));
    await call({ ...full, attribution: ATTRIBUTION });
    await call({ ...base, attribution: { utm_source: 'x'.repeat(5000) } });
    await mailsSettled();
    const text = logged();
    expect(text).toContain('LEAD SIN CRM');
    for (const secret of [GCLID, 'campanas-led-industriales', '/catalogo/campanas-led', 'www.google.com', EMAIL, NAME, PHONE]) {
      expect(text).not.toContain(secret);
    }
  });
});

// --- Privacidad (Etapa 2 · PR 13) ---
// El cotizador exige la casilla de privacidad (400 'consent_required' antes del correo y de
// Pipedrive). La constancia va en el correo (antes del origen) y en la nota (después de
// 'source: cotizador…' y antes del origen). La «Fecha» de la nota, el «Registrado» de la
// constancia y la ventana de la referencia salen del mismo instante del servidor.

/** «Fecha» de la nota: el mismo formato que chileDateTime de project-quotes. */
const chileFecha = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago' });

describe('POST /api/project-quotes/create: privacidad', () => {
  beforeEach(() => {
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(findOrCreateOrganization).mockReset().mockResolvedValue({ organizationId: 22, action: 'created' });
    vi.mocked(createDeal).mockReset().mockResolvedValue({ dealId: 999, status: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(waitUntil).mockClear();
    vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
    vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '2');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([false, true])('constancia (novedades: %s): en la nota después de "source: cotizador…" y antes del origen; en el correo antes del origen', async (marketing) => {
    const res = await call({ ...full, consent: { ...CONSENT, marketing }, attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const [note] = notes();
    expect(note.content).toContain('source: cotizador | landingPath: /cotizador\n\n' + expectedSection(marketing) + '\n\n' + ORIGEN_GADS);
    const [mail] = gasBodies();
    expect(mail.items_lista).toContain('Plazo: PRUEBA 3 meses\n\n' + expectedSection(marketing) + '\n\n' + ORIGEN_GADS);
    for (const text of [note.content, mail.items_lista]) {
      expect(lastConsentRecord(text)).toMatchObject({ form: 'cotizador', privacy: true, terms: null, marketing, src: 'web' });
    }
  });

  it('reenvío (skipped_duplicate): la nota del reenvío lleva la constancia del envío nuevo, antes del origen', async () => {
    vi.mocked(createDeal).mockResolvedValue({ dealId: 555, status: 'skipped_duplicate' });
    const res = await call({ ...full, consent: { ...CONSENT, marketing: true }, attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(200);
    const [note] = notes();
    expect(note.deal_id).toBe(555);
    expect(note.content.startsWith('Reenvío del mismo formulario')).toBe(true);
    expect(note.content).toContain('source: cotizador | landingPath: /cotizador\n\n' + expectedSection(true) + '\n\n' + ORIGEN_GADS);
    expect(lastConsentRecord(note.content)).toMatchObject({ form: 'cotizador', marketing: true, src: 'web', at: AT });
  });

  it('la «Fecha» de la nota y el «Registrado» de la constancia son el mismo instante, aunque el reloj avance durante la solicitud', async () => {
    vi.mocked(findOrCreatePerson).mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.parse(AT) + 5 * 60_000));
      return { personId: 11, action: 'created' };
    });
    const res = await call(base);
    expect(res.statusCode).toBe(201);
    const [note] = notes();
    expect(note.content).toContain('Fecha: ' + chileFecha(AT) + '\n');
    expect(note.content).not.toContain(chileFecha('2026-11-20T14:08:12Z'));
    expect(note.content).toContain('Registrado: 2026-11-20 11:03:12, hora de Chile (reloj del servidor)');
    expect(lastConsentRecord(note.content)?.at).toBe(AT);
  });

  it('la referencia PY- no cambia con las casillas (novedades ni versión)', async () => {
    const a = await call(base);
    const b = await call({ ...base, consent: { ...CONSENT, marketing: true } });
    const c = await call({ ...base, consent: { ...CONSENT, version: '9.9' } });
    expect(refOf(a)).toMatch(/^PY-/);
    expect(refOf(b)).toBe(refOf(a));
    expect(refOf(c)).toBe(refOf(a));
  });

  it('todos los campos al máximo y Pipedrive caído: los dos correos llevan la constancia completa, sin recorte', async () => {
    vi.mocked(createDeal).mockRejectedValue(new Error('[deals] down'));
    const max = {
      ...full,
      nombre: 'n'.repeat(120), tipoProyecto: 'Industria', aplicacion: 'a'.repeat(200), nivelIluminacion: 'Alto rendimiento',
      ciudad: 'c'.repeat(200), plazo: 'p'.repeat(200), comentarios: 'k'.repeat(1999) + 'Z', razonSocial: 'r'.repeat(150),
      giro: 'g'.repeat(150), direccion: 'd'.repeat(200), m2: 10_000_000, altura: 200,
      consent: { ...CONSENT, marketing: true },
      attribution: Object.fromEntries(['gclid', 'gbraid', 'wbraid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].map((k) => [k, k[0].repeat(200)])),
    };
    const res = await call(max);
    expect(res.statusCode).toBe(200);
    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    for (const mail of mails) {
      expect(JSON.stringify(mail)).not.toContain('recortado');
      expect(mail.items_lista).toContain(expectedSection(true));
      expect(lastConsentRecord(mail.items_lista)).toMatchObject({ marketing: true, src: 'web' });
    }
  });

  it('sin la casilla: 400 consent_required antes de validar el resto, sin correo ni Pipedrive, y el log solo dice "Consent missing"', async () => {
    vi.setSystemTime(consentGraceUntil());
    const { consent: _omit, ...noConsent } = base;
    // El tercero además trae un teléfono inválido: la casilla se revisa primero
    for (const body of [noConsent, { ...base, consent: { ...CONSENT, privacy: false } }, { ...noConsent, telefono: '1' }]) {
      const res = await call(body);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: 'Validation failed', code: CONSENT_ERROR_CODE });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(findOrCreatePerson).not.toHaveBeenCalled();
    expect(createDeal).not.toHaveBeenCalled();
    expect(vi.mocked(console.warn).mock.calls.flat().map(String)).toEqual([
      '[ProjectQuote] Consent missing',
      '[ProjectQuote] Consent missing',
      '[ProjectQuote] Consent missing',
    ]);
  });

  it('sin la clave consent, dentro del margen: 201 y constancia "web-legacy"', async () => {
    const at = new Date(consentGraceUntil().getTime() - 60_000);
    vi.setSystemTime(at);
    const { consent: _omit, ...noConsent } = base;
    const res = await call(noConsent);
    expect(res.statusCode).toBe(201);
    const legacy = formatLegacyConsentSection({ at, form: 'cotizador' }).join('\n');
    for (const text of [notes()[0].content, gasBodies()[0].items_lista]) {
      expect(text).toContain(legacy);
      expect(lastConsentRecord(text)).toMatchObject({ src: 'web-legacy' });
    }
  });

  it('un bloque falso en los comentarios nunca queda último: vale la constancia real', async () => {
    const fake = 'x'.repeat(600) + '\n' + CONSENT_HEADING + '\nconsent_json: {"v":"1.1","at":"2026-01-01T00:00:00Z","form":"cotizador","privacy":true,"terms":null,"marketing":true,"src":"web"}';
    const res = await call({ ...base, comentarios: fake });
    expect(res.statusCode).toBe(201);
    for (const text of [notes()[0].content, gasBodies()[0].items_lista]) {
      expect(text).toContain('"marketing":true');
      expect(lastConsentRecord(text)).toMatchObject({ marketing: false, src: 'web', at: AT });
    }
  });
});

// --- Adjuntos (especificación «Adjuntar archivos», 22-10-2026) ---
// El navegador ya subió los archivos a Blob y manda `archivos: [{ pathname, nombre }]`. Se
// responde 201/200 sin esperarlos; un waitUntil registrado antes de responder los pasa de a
// uno a Pipedrive (POST /files) y los borra de Blob. Si uno falla, se borra igual (D3) y una
// segunda nota y un correo a ventas dicen cuál falta. Blob y Pipedrive están simulados; Redis
// es un Upstash falso en memoria (claves «pendiente» para el barrido).

const UUID8 = '3f2b8c1e-9a4d-4e6f-8b7a-';
const MB = 1024 * 1024;
const enc = (text: string) => new TextEncoder().encode(text);
const CONTENT = {
  pdf: enc('%PDF-1.7\n'),
  dwg: enc('AC1032\0\0'),
  xlsx: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
  dxf: enc('  0\nSECTION\n  2\nHEADER\n'),
};
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

interface StoredFile { pathname: string; url: string; size: number; uploadedAt: Date; contentType: string; data: Uint8Array }
let stored: Map<string, StoredFile>;
let fileSeq = 0;
/** Un archivo que el navegador ya subió a Blob; devuelve la referencia que manda a create.ts. */
function uploaded(nombre: string, { size = MB, data, minutesAgo = 2, ext = nombre.split('.').pop() as string } = {} as {
  size?: number; data?: Uint8Array; minutesAgo?: number; ext?: string;
}) {
  const pathname = `cotizador/${UUID8}${String(++fileSeq).padStart(12, '0')}-Sufijo${fileSeq}.${ext}`;
  stored.set(pathname, {
    pathname,
    url: `https://store.private.blob.vercel-storage.com/${pathname}`,
    size,
    uploadedAt: new Date(Date.now() - minutesAgo * 60_000),
    contentType: TYPES[ext],
    data: data ?? CONTENT[ext as keyof typeof CONTENT],
  });
  return { pathname, nombre };
}

let fake: FakeRedis;
let current: { statusCode: number } | null = null;
/** waitUntil registrados, con el estado de la respuesta en ese momento (0: antes de responder). */
let registered: { statusAtRegistration: number; promise: Promise<unknown> }[];
const settled = () => Promise.all(registered.map((r) => r.promise));
/** Como call(), pero deja la respuesta en `current` para saber si ya se respondió. */
function send(body: unknown) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  current = res;
  const req = { method: 'POST', headers: { 'x-forwarded-for': `10.5.0.${++ipSeq}` }, body, socket: { remoteAddress: '127.0.0.1' } };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}
const uploads = () => vi.mocked(pipedriveUploadFile).mock.calls.map(([args]) => args);
const deletedUrls = () => vi.mocked(del).mock.calls.flatMap(([arg]) => (Array.isArray(arg) ? arg : [arg]));

describe('POST /api/project-quotes/create: adjuntos', () => {
  beforeEach(() => {
    stored = new Map();
    fileSeq = 0;
    registered = [];
    current = null;
    fake = createFakeRedis();
    vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' });
    vi.mocked(findOrCreateOrganization).mockReset().mockResolvedValue({ organizationId: 22, action: 'created' });
    vi.mocked(createDeal).mockReset().mockResolvedValue({ dealId: 999, status: 'created' });
    vi.mocked(pipedrivePost).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(pipedriveUploadFile).mockReset().mockResolvedValue({ success: true, data: { id: 50 } } as never);
    vi.mocked(waitUntil).mockReset().mockImplementation((promise: Promise<unknown>) => {
      registered.push({ statusAtRegistration: current?.statusCode ?? 0, promise });
    });
    vi.mocked(head).mockReset().mockImplementation(async (pathname: string) => {
      const f = stored.get(pathname);
      if (!f) throw new BlobNotFoundError();
      return { url: f.url, downloadUrl: f.url, pathname, size: f.size, uploadedAt: f.uploadedAt, contentType: f.contentType, contentDisposition: '', cacheControl: '', etag: 'e' };
    });
    vi.mocked(get).mockReset().mockImplementation(async (pathname: string) => {
      const f = stored.get(pathname);
      if (!f) return null;
      return { statusCode: 200, stream: new Blob([f.data]).stream(), headers: new Headers(), blob: {} } as never;
    });
    vi.mocked(del).mockReset().mockImplementation(async (arg: string | string[]) => {
      for (const url of Array.isArray(arg) ? arg : [arg]) {
        for (const [p, f] of stored) if (f.url === url || p === url) stored.delete(p);
      }
    });
    vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
    vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '2');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-de-prueba');
    vi.stubGlobal('fetch', fakeFetch(fake));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('201 antes de adjuntar: el traspaso va en un waitUntil registrado antes de responder', async () => {
    let release: () => void = () => {};
    vi.mocked(pipedriveUploadFile).mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ success: true, data: { id: 50 } } as never); })
    );
    const archivos = [uploaded('bases.pdf')];
    const res = await send({ ...base, archivos });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true, reference: refOf(res), dealId: 999 });
    // El correo y el traspaso se registraron antes de responder
    expect(registered.length).toBeGreaterThanOrEqual(2);
    expect(registered.every((r) => r.statusAtRegistration === 0)).toBe(true);
    // El traspaso sigue después de la respuesta
    await vi.waitFor(() => expect(pipedriveUploadFile).toHaveBeenCalledTimes(1));
    expect(stored.size).toBe(1);
    release();
    await settled();
    expect(stored.size).toBe(0);
  });

  it('la nota principal y el correo listan los archivos con su peso', async () => {
    const archivos = [
      uploaded('bases.pdf', { size: 2.1 * MB }),
      uploaded('plano.dwg', { size: 14 * MB }),
      uploaded('planilla.xlsx', { size: 85 * 1024 }),
    ];
    const res = await send({ ...full, archivos });
    expect(res.statusCode).toBe(201);
    await settled();
    const line = 'Archivos que envió el cliente (3): bases.pdf (2,1 MB), plano.dwg (14 MB), planilla.xlsx (85 KB). Quedan en la pestaña Archivos del negocio.';
    const [note] = notes();
    expect(note.content).toContain('--- COMENTARIOS ---\nPRUEBA ETAPA 2 (09d) - no cotizar\n\n--- ARCHIVOS ---\n' + line + '\n\nSin productos ni precios');
    const [mail] = fake.mails;
    expect(mail.items_lista).toContain('Plazo: PRUEBA 3 meses\n\n' + line + '\n\n');
    // Todo quedó en Archivos: sin segunda nota ni segundo correo
    expect(notes()).toHaveLength(1);
    expect(fake.mails).toHaveLength(1);
  });

  it('sube de a uno, con el nombre, el tipo y el negocio, y borra cada archivo después de subirlo', async () => {
    const archivos = [uploaded('bases.pdf'), uploaded('plano.dwg'), uploaded('corte.dxf')];
    await send({ ...base, archivos });
    await settled();
    expect(uploads().map((u) => [u.dealId, u.fileName, u.contentType])).toEqual([
      [999, 'bases.pdf', 'application/pdf'],
      [999, 'plano.dwg', 'image/vnd.dwg'],
      [999, 'corte.dxf', 'image/vnd.dxf'],
    ]);
    expect(Array.from(uploads()[1].data as Uint8Array)).toEqual(Array.from(CONTENT.dwg));
    const getOrder = vi.mocked(get).mock.invocationCallOrder;
    const upOrder = vi.mocked(pipedriveUploadFile).mock.invocationCallOrder;
    const delOrder = vi.mocked(del).mock.invocationCallOrder;
    expect(delOrder).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(getOrder[i]).toBeLessThan(upOrder[i]);
      expect(upOrder[i]).toBeLessThan(delOrder[i]);
      if (i < 2) expect(delOrder[i]).toBeLessThan(getOrder[i + 1]);
    }
    expect(stored.size).toBe(0);
    // Las claves «pendiente» quedan terminadas (0): el barrido no las reintenta
    for (const a of archivos) expect(fake.data.get(pendingKey(a.pathname))?.value).toBe('0');
  });

  it('un archivo que no es lo que dice: se borra igual (D3) y la nota y el correo dicen cuál falta', async () => {
    const archivos = [uploaded('bases.pdf'), uploaded('plano.dwg', { data: enc('MZ este es un .exe') }), uploaded('ficha.pdf')];
    const res = await send({ ...base, archivos });
    expect(res.statusCode).toBe(201);
    await settled();
    expect(uploads().map((u) => u.fileName)).toEqual(['bases.pdf', 'ficha.pdf']);
    expect(stored.size).toBe(0);
    const report = 'Adjuntos: 2 de 3 quedaron en Archivos.\nNo se pudo adjuntar "plano.dwg" (no es un DWG válido). Pedirlo al cliente por correo.';
    const [, second] = notes();
    expect(second.deal_id).toBe(999);
    expect(second.content).toBe(report);
    expect(fake.mails).toHaveLength(2);
    const followUp = fake.mails[1];
    expect(followUp.items_lista).toBe(`Adjuntos del cotizador ${refOf(res)} (negocio 999 en Pipedrive)\n` + report);
    expect(followUp.reply_to).toBe(EMAIL);
    expect(followUp).not.toHaveProperty('comentarios');
  });

  it.each([
    ['vencido (más de 2 horas)', () => uploaded('plano.dwg', { minutesAgo: 121 }), 'venció: se subió hace más de 2 horas'],
    ['de más de 20 MB', () => uploaded('plano.dwg', { size: 20 * MB + 1 }), 'pesa más de 20 MB'],
    ['con otro tipo en Blob', () => { const r = uploaded('plano.dwg'); stored.get(r.pathname)!.contentType = 'application/pdf'; return r; }, 'no es un tipo de archivo permitido'],
  ])('archivo %s: no se sube, se borra y la nota lo dice', async (_name, make, reason) => {
    const ref = make();
    await send({ ...base, archivos: [ref] });
    await settled();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
    expect(notes()[1].content).toContain(`No se pudo adjuntar "plano.dwg" (${reason}).`);
  });

  it('si Pipedrive rechaza el archivo (413), se borra y la nota lo dice', async () => {
    vi.mocked(pipedriveUploadFile).mockResolvedValue({ success: false, data: null, error: 'HTTP 413: Payload Too Large' } as never);
    await send({ ...base, archivos: [uploaded('bases.pdf', { size: 19.9 * MB })] });
    await settled();
    expect(stored.size).toBe(0);
    expect(notes()[1].content).toContain('No se pudo adjuntar "bases.pdf" (Pipedrive lo rechazó por su tamaño). Pedirlo al cliente por correo.');
  });

  it('sin tiempo en la función: el resto queda en Blob como pendiente y la nota y el correo lo dicen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T14:00:00Z'));
    vi.mocked(pipedriveUploadFile).mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.now() + 40_000)); // una subida lenta
      return { success: true, data: { id: 50 } } as never;
    });
    const archivos = [uploaded('bases.pdf'), uploaded('plano.dwg')];
    await send({ ...base, archivos });
    await settled();
    expect(uploads()).toHaveLength(1);
    expect(stored.has(archivos[1].pathname)).toBe(true);
    expect(fake.data.get(pendingKey(archivos[1].pathname))?.value).toBe('999');
    expect(fake.data.get(pendingKey(archivos[1].pathname))?.ttl).toBe(48 * 3600);
    const [, second] = notes();
    expect(second.content).toContain('Adjuntos: 1 de 2 quedaron en Archivos.');
    expect(second.content).toContain('"plano.dwg" quedó pendiente');
    expect(second.content).toContain('el barrido diario lo reintenta');
    expect(fake.mails).toHaveLength(2);
  });

  it('reenvío: se adjunta lo que siga en Blob; lo demás, «ya adjuntado en el envío anterior o vencido»', async () => {
    vi.mocked(createDeal).mockResolvedValue({ dealId: 555, status: 'skipped_duplicate' });
    const already = { pathname: `cotizador/${UUID8}000000000999-Sufijo.pdf`, nombre: 'ficha.pdf' }; // ya no está en Blob
    const archivos = [uploaded('plano.dwg'), already];
    const res = await send({ ...base, archivos });
    expect(res.statusCode).toBe(200);
    await settled();
    expect(uploads().map((u) => [u.dealId, u.fileName])).toEqual([[555, 'plano.dwg']]);
    const [main, second] = notes();
    expect(main.content.startsWith('Reenvío del mismo formulario')).toBe(true);
    expect(main.content).toContain('Archivos que envió el cliente (2): plano.dwg (1 MB), ficha.pdf.');
    expect(second.content).toBe('Adjuntos: 1 de 2 quedaron en Archivos.\n"ficha.pdf": ya adjuntado en el envío anterior o vencido.');
    // Nada que pedirle al cliente: sin correo de seguimiento
    expect(fake.mails).toHaveLength(1);
  });

  it('reenvío mientras el primer traspaso sigue: la reserva (SET NX) evita subir dos veces el mismo archivo', async () => {
    let release: () => void = () => {};
    vi.mocked(pipedriveUploadFile).mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ success: true, data: { id: 50 } } as never); })
    );
    const archivos = [uploaded('plano.dwg')];
    expect((await send({ ...base, archivos })).statusCode).toBe(201);
    await vi.waitFor(() => expect(pipedriveUploadFile).toHaveBeenCalledTimes(1));
    // La respuesta 201 se perdió y el cliente envía otra vez: el archivo sigue en Blob
    vi.mocked(createDeal).mockResolvedValue({ dealId: 999, status: 'skipped_duplicate' });
    const firstTransfers = registered.length;
    expect((await send({ ...base, archivos })).statusCode).toBe(200);
    await Promise.all(registered.slice(firstTransfers).map((r) => r.promise));
    expect(pipedriveUploadFile).toHaveBeenCalledTimes(1);
    expect(notes().at(-1)?.content).toBe('Adjuntos: 0 de 1 quedaron en Archivos.\n"plano.dwg": ya adjuntado en el envío anterior o en curso.');
    release();
    await settled();
    expect(pipedriveUploadFile).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(0);
    expect(fake.data.get(pendingKey(archivos[0].pathname))?.value).toBe('0');
    // Nada que pedirle al cliente: sin correo de seguimiento (el de la solicitud, dos veces)
    expect(fake.mails).toHaveLength(2);
  });

  it('el tiempo de Pipedrive se mide después de leer el archivo: la subida nunca pasa del plazo de la función', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse('2026-11-20T14:00:00Z');
    vi.setSystemTime(start);
    vi.mocked(get).mockImplementation(async (pathname: string) => {
      const f = stored.get(pathname);
      vi.setSystemTime(Date.now() + 15_000); // Blob tardó 15 s en entregar el archivo
      return { statusCode: 200, stream: new Blob([f!.data]).stream(), headers: new Headers(), blob: {} } as never;
    });
    await send({ ...base, archivos: [uploaded('plano.dwg', { size: 19 * MB })] });
    await settled();
    const [{ timeoutMs }] = uploads();
    // 60 s del maxDuration, menos 10 s de margen, menos los 15 s de Blob
    expect(timeoutMs).toBeLessThanOrEqual(60_000 - 10_000 - 15_000);
    expect(timeoutMs).toBeGreaterThanOrEqual(10_000);
  });

  it('si después de leer el archivo ya no quedan 10 s, no se sube: queda pendiente para el barrido', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T14:00:00Z'));
    vi.mocked(get).mockImplementation(async (pathname: string) => {
      const f = stored.get(pathname);
      vi.setSystemTime(Date.now() + 42_000);
      return { statusCode: 200, stream: new Blob([f!.data]).stream(), headers: new Headers(), blob: {} } as never;
    });
    const archivos = [uploaded('plano.dwg')];
    await send({ ...base, archivos });
    await settled();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(stored.has(archivos[0].pathname)).toBe(true);
    expect(fake.data.get(pendingKey(archivos[0].pathname))?.value).toBe('999');
    expect(notes()[1].content).toContain('"plano.dwg" quedó pendiente');
  });

  it('CRM caído: 200 crm failed, se borran todos los archivos y el correo ATENCIÓN lo dice', async () => {
    vi.mocked(createDeal).mockRejectedValue(new Error('[deals] down'));
    const archivos = [uploaded('bases.pdf'), uploaded('plano.dwg')];
    const res = await send({ ...base, archivos });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ crm: 'failed', dealId: null });
    await settled();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
    expect(fake.mails).toHaveLength(2);
    expect(fake.mails[1].items_lista.startsWith(
      `ATENCIÓN: la solicitud ${refOf(res)} NO quedó en Pipedrive. Crear el negocio a mano.\n` +
        'El cliente adjuntó 2 archivos que no se guardaron: pedírselos por correo.\n\n'
    )).toBe(true);
    expect(fake.mails[1].items_lista).toContain(fake.mails[0].items_lista);
  });

  it('honeypot: 200 como siempre, sin correo ni Pipedrive, y se borran las referencias', async () => {
    const archivos = [uploaded('bases.pdf'), uploaded('plano.dwg')];
    const res = await send({ ...base, website: 'http://spam', archivos });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    await settled();
    expect(stored.size).toBe(0);
    expect(head).not.toHaveBeenCalled();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(createDeal).not.toHaveBeenCalled();
    expect(fake.mails).toHaveLength(0);
  });

  it.each([
    ['sin la casilla de privacidad', (b: Record<string, unknown>) => ({ ...b, consent: { ...CONSENT, privacy: false } })],
    ['con un teléfono inválido', (b: Record<string, unknown>) => ({ ...b, telefono: '1' })],
  ])('400 %s: los archivos quedan en Blob (el cliente reenvía las mismas referencias)', async (_name, change) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(consentGraceUntil());
    const archivos = [uploaded('bases.pdf')];
    const res = await send(change({ ...base, archivos }));
    expect(res.statusCode).toBe(400);
    await settled();
    expect(stored.size).toBe(1);
    expect(head).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('502 (fallan Pipedrive y el correo): los archivos quedan en Blob para el reintento', async () => {
    vi.mocked(createDeal).mockRejectedValue(new Error('[deals] down'));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res = await send({ ...base, archivos: [uploaded('bases.pdf')] });
    expect(res.statusCode).toBe(502);
    await settled();
    expect(stored.size).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });

  it('referencias mal formadas, repetidas o sobrantes: se descartan y quedan anotadas, nunca 400', async () => {
    const ok = [uploaded('a.pdf'), uploaded('b.pdf'), uploaded('c.pdf'), uploaded('d.pdf'), uploaded('e.pdf')];
    const archivos = [
      ok[0],
      ok[0],
      { pathname: 'cotizador/../secreto.pdf', nombre: 'x.pdf' },
      { pathname: 'https://evil.example/x.pdf', nombre: 'x.pdf' },
      ...ok.slice(1),
      uploaded('sobrante.pdf'),
    ];
    const res = await send({ ...base, archivos });
    expect(res.statusCode).toBe(201);
    await settled();
    expect(uploads().map((u) => u.fileName)).toEqual(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf']);
    expect(notes()[0].content).toContain('Se descartaron 4 referencias de archivo no válidas.');
    expect(fake.mails[0].items_lista).toContain('Se descartaron 4 referencias de archivo no válidas.');
    expect((await send({ ...base, archivos: 'no es una lista' })).statusCode).toBe(201);
  });

  it('un nombre con HTML o rutas llega limpio y escapado a la nota', async () => {
    await send({ ...base, archivos: [{ ...uploaded('x.dwg'), nombre: 'C:\\planos\\<b>plano<b> & "corte".dwg' }] });
    await settled();
    const [note] = notes();
    expect(note.content).toContain('Archivos que envió el cliente (1): bplanob &amp; corte.dwg (1 MB).');
    expect(note.content).not.toMatch(/<b>|planos/);
    expect(uploads()[0].fileName).toBe('bplanob & corte.dwg');
  });

  it('los archivos no cambian la referencia PY-', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T15:10:00Z'));
    const a = await send(base);
    const b = await send({ ...base, archivos: [uploaded('bases.pdf')] });
    expect(refOf(a)).toMatch(/^PY-/);
    expect(refOf(b)).toBe(refOf(a));
    await settled();
  });

  it('los logs no llevan nombres de archivo ni rutas: solo cuántos son y un código de motivo', async () => {
    const secretName = 'Licitación Juan Pérez 76.123.456-7.pdf';
    await send({ ...base, archivos: [uploaded(secretName), uploaded('plano.dwg', { data: enc('nada') }), { pathname: 'mala', nombre: 'oculto.pdf' }] });
    vi.mocked(createDeal).mockRejectedValueOnce(new Error('[deals] down'));
    await send({ ...base, comentarios: 'otro', archivos: [uploaded('otro-secreto.pdf')] });
    await send({ ...base, website: 'x', archivos: [uploaded('honeypot-secreto.pdf')] });
    await settled();
    const text = logged();
    expect(text).toContain('Adjuntos: 2 | descartados: 1');
    expect(text).toContain('Adjunto 2/2 failed: bad_content');
    for (const leak of ['Licitación', 'Juan', '76.123', 'plano', 'oculto', 'otro-secreto', 'honeypot-secreto', 'cotizador/', UUID8]) {
      expect(text).not.toContain(leak);
    }
  });
});
