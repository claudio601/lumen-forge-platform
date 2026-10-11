// api/quotes/create.test.ts
// Cotizaciones del sitio (sourceSystem nuevo_elights): precios CON IVA desde el catálogo,
// persona o empresa, y el correo a ventas ANTES de Pipedrive con la misma referencia NE-
// que la nota. Si Pipedrive falla pero el correo salió, el lead no se pierde (200 + correo
// de ATENCIÓN); 502 solo si fallan los dos. Sin API key solo entran cotizaciones del sitio.
// Un producto que el catálogo no identifica queda fuera del monto del negocio (REVISAR).
// Pipedrive y el relay están simulados.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../_lib/crm/dedupe.js', () => ({
  processQuoteToCrm: vi.fn(),
  buildSuccessResponse: vi.fn(),
}));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }));

import handler from './create';
import { processQuoteToCrm, buildSuccessResponse } from '../_lib/crm/dedupe.js';
import { pipedrivePost } from '../_lib/pipedrive/client.js';
import { waitUntil } from '@vercel/functions';

let ipSeq = 0;
function call(body: unknown, headers: Record<string, string> = {}) {
  const res = {
    statusCode: 0, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader() {},
  };
  const req = { method: 'POST', headers: { 'x-forwarded-for': `10.9.0.${++ipSeq}`, ...headers }, body, socket: {} };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}

const NAME = 'PRUEBA ETAPA 2 (09b)';
const EMAIL = 'prueba-etapa2-09b@example.com';
const PHONE = '+56 9 0000 0902';
const RAZON_SOCIAL = 'PRUEBA ETAPA 2 (no procesar)';
const COMENTARIO = 'PRUEBA ETAPA 2 (09b) - no cotizar';
const customer = { name: NAME, email: EMAIL, phone: PHONE };

const quote = (sourceSystem: string) => ({
  sourceSystem,
  quoteReference: 'NE-abc123',
  leadType: 'B2B',
  customer,
  products: [{ jumpsellerId: 3305420, sku: 'AR111OPC', name: 'AR111', quantity: 3, unitPriceClp: 13613 }],
  quoteAmountClp: 40839,
});
const company = { rut: 'RUT-PRUEBA', giro: 'Prueba', address: 'Prueba 123, Santiago' };
const empresa = () => ({
  ...quote('nuevo_elights'),
  customerType: 'empresa',
  priceMode: 'neto',
  organization: { name: RAZON_SOCIAL },
  company,
  notes: COMENTARIO,
  website: '',
});
const persona = () => ({
  ...quote('nuevo_elights'),
  customerType: 'persona',
  priceMode: 'iva',
  leadType: 'B2C',
  notes: COMENTARIO,
  website: '',
});
const unidentified = [{ jumpsellerId: 1, sku: 'VIEJO', name: 'Retirado', quantity: 2, unitPriceClp: 10000 }];

const crmResult = (dealId: number, status: string) => ({ person: { personId: 11 }, organization: null, deal: { dealId, status } });
const crmPayload = () => vi.mocked(processQuoteToCrm).mock.calls[0][0] as unknown as Record<string, unknown> & {
  products: { unitPriceClp: number }[]; quoteAmountClp: number; organization?: { name: string };
};
type PdCall = [string, { content: string; deal_id: number }];
const notes = () => (vi.mocked(pipedrivePost).mock.calls as unknown as PdCall[]).filter(([p]) => p === '/notes').map(([, b]) => b);
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

describe('POST /api/quotes/create', () => {
  beforeEach(() => {
    vi.mocked(processQuoteToCrm).mockReset().mockResolvedValue(crmResult(77, 'created') as never);
    vi.mocked(buildSuccessResponse).mockReset().mockImplementation(((r: ReturnType<typeof crmResult>) =>
      ({ success: true, personId: 11, organizationId: null, dealId: r.deal.dealId, dealStatus: r.deal.status })) as never);
    vi.mocked(pipedrivePost).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(waitUntil).mockClear();
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('cotización del sitio en modo neto: el negocio queda CON IVA desde el catálogo', async () => {
    const res = await call(quote('nuevo_elights'));
    expect(res.statusCode).toBeLessThan(300);
    const payload = crmPayload();
    expect(payload.products[0].unitPriceClp).toBe(16200);
    expect(payload.quoteAmountClp).toBe(3 * 16200);
    expect(payload.products[0]).not.toHaveProperty('jumpsellerId');
    const [path, body] = vi.mocked(pipedrivePost).mock.calls[0] as unknown as PdCall;
    expect(path).toBe('/notes');
    expect(body.deal_id).toBe(77);
    expect(body.content).toContain('Jumpseller 3305420');
  });

  it('producto no identificado en modo empresa: REVISAR con el precio del sitio CON IVA, fuera del monto del negocio', async () => {
    const q = quote('nuevo_elights');
    q.products = unidentified;
    await call(q);
    const payload = crmPayload();
    expect(payload.products[0].unitPriceClp).toBe(11900);
    expect(payload).not.toHaveProperty('quoteAmountClp');
    const [note] = notes();
    expect(note.content).toContain('REVISAR [VIEJO] Retirado x2 @ 11900 CLP (precio del sitio, por confirmar; fuera del total)');
    expect(note.content).toContain('TOTAL CON IVA: por confirmar (REVISAR)');
  });

  it('otras fuentes (integraciones con API key) no se modifican ni mandan correo', async () => {
    vi.stubEnv('QUOTES_API_KEY', 'k');
    const res = await call(quote('jumpseller'), { 'x-api-key': 'k' });
    expect(res.statusCode).toBeLessThan(300);
    const payload = crmPayload();
    expect(payload.quoteAmountClp).toBe(40839);
    expect(payload.products[0].unitPriceClp).toBe(13613);
    expect(fetch).not.toHaveBeenCalled();
    expect(pipedrivePost).not.toHaveBeenCalled();
  });

  it('empresa: un correo ANTES de Pipedrive con los datos de facturación y el total CON IVA', async () => {
    const res = await call(empresa());
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, dealId: 77, quoteReference: 'NE-abc123' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(processQuoteToCrm).mock.invocationCallOrder[0]);
    const [mail] = gasBodies();
    expect(mail).toMatchObject({
      reply_to: EMAIL,
      razon_social: RAZON_SOCIAL,
      rut_empresa: 'RUT-PRUEBA',
      giro: 'Prueba',
      direccion: 'Prueba 123, Santiago',
      comentarios: COMENTARIO,
      total: '$48.600',
      modo_precio: 'Con IVA (el cliente veía precios netos, modo empresa)',
    });
    expect(mail.items_lista.split('\n')[0]).toBe('Cotización web NE-abc123 (buscar la referencia en Pipedrive)');
    for (const text of ['NE-abc123', 'Tipo de cliente: Empresa', 'Jumpseller 3305420']) expect(mail.items_lista).toContain(text);
    expect(Object.values(mail)).not.toContain('undefined');

    const payload = crmPayload();
    expect(payload).toMatchObject({ leadType: 'B2B', organization: { name: RAZON_SOCIAL }, quoteAmountClp: 48600 });
    for (const key of ['company', 'customerType', 'priceMode']) expect(payload).not.toHaveProperty(key);

    const [note] = notes();
    expect(note.deal_id).toBe(77);
    expect(note.content.startsWith('Cotización web NE-abc123')).toBe(true);
    for (const text of ['Tipo de cliente: Empresa', 'Razón social: ' + RAZON_SOCIAL, 'RUT: RUT-PRUEBA', 'Giro: Prueba',
      'Dirección: Prueba 123, Santiago', 'Jumpseller 3305420', 'TOTAL CON IVA: 48600 CLP', 'precios netos',
      'Comentarios del cliente: ' + COMENTARIO]) {
      expect(note.content).toContain(text);
    }
  });

  it.each([
    ['sin razón social', { organization: undefined }],
    ['sin RUT', { company: { ...company, rut: '' } }],
    ['giro en blanco', { company: { ...company, giro: '   ' } }],
    ['sin dirección', { company: { rut: 'RUT-PRUEBA', giro: 'Prueba' } }],
    ['sin datos de empresa', { company: undefined }],
    ['razón social de más de 200 caracteres', { organization: { name: 'x'.repeat(201) } }],
  ])('empresa %s: 400 sin correo ni Pipedrive', async (_name, extra) => {
    const res = await call({ ...empresa(), ...extra });
    expect(res.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(processQuoteToCrm).not.toHaveBeenCalled();
  });

  it('persona: B2C y sin organización ni datos de empresa, aunque el cuerpo los traiga', async () => {
    const res = await call({ ...persona(), organization: { name: RAZON_SOCIAL }, company });
    expect(res.statusCode).toBe(201);
    const payload = crmPayload();
    expect(payload.leadType).toBe('B2C');
    expect(payload.organization).toBeUndefined();
    expect(payload).not.toHaveProperty('company');

    const [mail] = gasBodies();
    for (const key of ['razon_social', 'rut_empresa', 'giro', 'direccion']) expect(mail).not.toHaveProperty(key);
    expect(mail.modo_precio).toBe('Con IVA');
    expect(mail.items_lista).toContain('Tipo de cliente: Persona natural');

    const [note] = notes();
    expect(note.content).toContain('Tipo de cliente: Persona natural');
    expect(note.content).not.toMatch(/^(RUT|Razón social|Giro|Dirección):/m);
    expect(note.content).not.toContain('precios netos');
  });

  it('Pipedrive falla y el correo salió: 200 sin negocio + correo de ATENCIÓN', async () => {
    vi.mocked(processQuoteToCrm).mockRejectedValue(new Error('[Pipedrive] Failed to create person: HTTP 500'));
    const res = await call(empresa());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, quoteReference: 'NE-abc123', dealId: null, crm: 'failed' });

    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    expect(mails[1].items_lista.startsWith('ATENCIÓN: la solicitud NE-abc123 NO quedó en Pipedrive. Crear el negocio a mano.')).toBe(true);
    expect(mails[1].items_lista).toContain(mails[0].items_lista);
    expect(mails[1].rut_empresa).toBe('RUT-PRUEBA');
    expect(logged()).toContain('LEAD SIN CRM NE-abc123');
    expect(pipedrivePost).not.toHaveBeenCalled();
  });

  it.each([
    ['el relay responde status error', () => relay('{"status":"error","message":"cuota"}')],
    ['la red falla', () => vi.fn(async () => { throw new TypeError('fetch failed'); })],
  ])('Pipedrive y el correo fallan (%s): 502 y ningún correo de ATENCIÓN', async (_cause, brokenFetch) => {
    vi.stubGlobal('fetch', brokenFetch());
    vi.mocked(processQuoteToCrm).mockRejectedValue(new Error('[Pipedrive] down'));
    const res = await call(empresa());
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ success: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('Pipedrive bien y el correo fallando: 201 y queda un aviso', async () => {
    vi.stubGlobal('fetch', relay('<html>Error</html>'));
    const res = await call(empresa());
    expect(res.statusCode).toBe(201);
    await mailsSettled();
    expect(vi.mocked(console.warn).mock.calls.flat().map(String).join('\n')).toContain('GAS relay FAIL');
  });

  it('reenvío con la misma referencia (skipped_duplicate): una nota "Reenvío" en el negocio existente', async () => {
    vi.mocked(processQuoteToCrm).mockResolvedValue(crmResult(55, 'skipped_duplicate') as never);
    const res = await call(empresa());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, dealId: 55, quoteReference: 'NE-abc123' });
    const sent = notes();
    expect(sent).toHaveLength(1);
    expect(sent[0].deal_id).toBe(55);
    expect(sent[0].content.startsWith('Reenvío de la cotización NE-abc123')).toBe(true);
    for (const text of ['RUT: RUT-PRUEBA', 'Giro: Prueba', 'Dirección: Prueba 123, Santiago', 'Comentarios del cliente: ' + COMENTARIO]) {
      expect(sent[0].content).toContain(text);
    }
  });

  it('una nota fallida no bloquea: 201 y un aviso con el dealId', async () => {
    vi.mocked(pipedrivePost).mockResolvedValue({ success: false, data: null, error: 'HTTP 500' } as never);
    const res = await call(empresa());
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(console.warn).mock.calls.flat().map(String).join('\n')).toContain('Nota en Pipedrive FAIL | dealId: 77');
  });

  it.each([
    ['persona + precios netos: × 1,19', { ...persona(), priceMode: 'neto' }, 11900],
    ['empresa + precios con IVA: sin cambio', { ...empresa(), priceMode: 'iva' }, 10000],
  ])('producto no identificado, %s', async (_name, body, unitPrice) => {
    await call({ ...body, products: unidentified });
    const payload = crmPayload();
    expect(payload.products[0].unitPriceClp).toBe(unitPrice);
    expect(payload).not.toHaveProperty('quoteAmountClp');
    expect(notes()[0].content).toContain(`REVISAR [VIEJO] Retirado x2 @ ${unitPrice} CLP (precio del sitio`);
  });

  it('producto no identificado sin precio: el deal va sin monto y la nota dice REVISAR', async () => {
    const res = await call({ ...persona(), products: [{ ...unidentified[0], unitPriceClp: 0 }] });
    expect(res.statusCode).toBe(201);
    expect(crmPayload()).not.toHaveProperty('quoteAmountClp');
    expect(notes()[0].content).toContain('REVISAR [VIEJO] Retirado x2 (sin precio del sitio; por confirmar, fuera del total)');
    expect(notes()[0].content).toContain('TOTAL CON IVA: por confirmar (REVISAR)');
    expect(gasBodies()[0].total).toBe('Por confirmar (1 producto sin precio de catálogo)');
  });

  it.each([
    ['cantidad 0', { products: [{ ...quote('').products[0], quantity: 0 }] }],
    ['cantidad 10000', { products: [{ ...quote('').products[0], quantity: 10000 }] }],
    ["referencia 'XX-1'", { quoteReference: 'XX-1' }],
    ['teléfono de 7 dígitos', { customer: { ...customer, phone: '2123456' } }],
    ['comentarios de más de 2000 caracteres', { notes: 'c'.repeat(2001) }],
    ['tipo de cliente desconocido', { customerType: 'otro' }],
    ['modo de precio desconocido', { priceMode: 'b2b' }],
  ])('%s: 400 sin correo ni Pipedrive', async (_name, extra) => {
    const res = await call({ ...empresa(), ...extra });
    expect(res.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(processQuoteToCrm).not.toHaveBeenCalled();
  });

  it('honeypot: 200 y no crea nada', async () => {
    const res = await call({ ...persona(), website: 'http://spam' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(processQuoteToCrm).not.toHaveBeenCalled();
  });

  // processQuoteToCrm está simulado: su propio log (protegido) queda fuera de esta prueba.
  it('las líneas de log no llevan el nombre, el correo, el teléfono ni el RUT', async () => {
    await call(empresa());
    vi.mocked(processQuoteToCrm).mockRejectedValueOnce(new Error('[Pipedrive] down'));
    await call(empresa());
    // Un relay que repite lo que recibió tampoco llega al log
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'error', message: 'Invalid email: ' + EMAIL + ' ' + NAME + ' RUT-PRUEBA' })));
    vi.mocked(processQuoteToCrm).mockRejectedValueOnce(new Error('[Pipedrive] down'));
    await call(empresa());
    await call({ ...empresa(), customer: { ...customer, phone: '123' } });
    await call({ ...empresa(), company: { ...company, giro: '' } });
    await mailsSettled();
    const text = logged();
    expect(text).toContain('LEAD SIN CRM NE-abc123');
    for (const pii of [EMAIL, NAME, PHONE, 'RUT-PRUEBA', 'Prueba 123']) expect(text).not.toContain(pii);
  });

  // --- Correo: comentarios largos y cotizaciones grandes ---

  const LONG_NOTES = 'Proyecto bodega 3000 m2. ' + 'x'.repeat(1500) + ' FIN-DEL-COMENTARIO';

  it('comentario de 1500 caracteres con Pipedrive caído: los dos correos lo llevan completo', async () => {
    vi.mocked(processQuoteToCrm).mockRejectedValue(new Error('[Pipedrive] down'));
    const res = await call({ ...persona(), notes: LONG_NOTES });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, dealId: null, crm: 'failed' });

    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    for (const mail of mails) {
      expect(mail.items_lista).toContain('Comentarios del cliente (completos):\n' + LONG_NOTES);
      expect(mail.items_lista).not.toContain('recortado');
      // El campo COMENTARIOS (máx. 500) lleva el comienzo y dónde está el resto
      expect(mail.comentarios.length).toBeLessThanOrEqual(500);
      expect(mail.comentarios.startsWith('Proyecto bodega 3000 m2.')).toBe(true);
      expect(mail.comentarios).toContain('va completo al final de PRODUCTOS SOLICITADOS');
      expect(mail.comentarios).not.toContain('recortado');
    }
  });

  // Fija el límite local (500) al del helper: si el helper cortara antes, esta prueba falla.
  it('comentario de 500 caracteres: entero en COMENTARIOS y sin repetirse en el cuerpo', async () => {
    const notes500 = 'c'.repeat(499) + 'Z';
    await call({ ...persona(), notes: notes500 });
    const [mail] = gasBodies();
    expect(mail.comentarios).toBe(notes500);
    expect(mail.items_lista).not.toContain('Comentarios del cliente');
  });

  it.each([
    ['80 líneas: todas, abreviadas', 80, false],
    ['400 líneas: las que caben y cuántas faltan', 400, true],
  ])('cotización de %s, con Pipedrive caído; el comentario llega completo', async (_name, count, cut) => {
    vi.mocked(processQuoteToCrm).mockRejectedValue(new Error('[Pipedrive] down'));
    const products = Array.from({ length: count }, () => ({ ...quote('').products[0], quantity: 1 }));
    const comment = 'c'.repeat(1980) + ' FIN-DEL-COMENTARIO';
    const res = await call({ ...persona(), products, notes: comment });
    expect(res.statusCode).toBe(200);

    const mails = gasBodies();
    expect(mails).toHaveLength(2);
    for (const mail of mails) {
      expect(mail.items_lista.length).toBeLessThanOrEqual(8000);
      expect(mail.items_lista).not.toContain('recortado');
      expect(mail.items_lista).toContain('Comentarios del cliente (completos):\n' + comment);
      const lines = mail.items_lista.split('\n').filter((l) => l === '  [AR111OPC] x1 = 16200 CLP');
      if (cut) {
        expect(lines.length).toBeGreaterThan(100);
        expect(mail.items_lista).toContain(`  … y ${count - lines.length} línea(s) más que no caben en el correo`);
      } else {
        expect(lines).toHaveLength(count);
        expect(mail.items_lista).toContain('(líneas abreviadas para que quepan en el correo');
      }
    }
  });

  // --- Sin API key solo entran cotizaciones del sitio ---

  it.each(['jumpseller', 'whatsapp', 'manual'])(
    "sin API key, sourceSystem '%s' con Origin falsificado: 400, sin Pipedrive ni correo",
    async (sourceSystem) => {
      vi.stubEnv('VERCEL_ENV', 'production');
      vi.stubEnv('QUOTES_API_KEY', 'k');
      const res = await call(
        { ...quote(sourceSystem), jumpsellerOrderId: '99999', quoteAmountClp: 1 },
        { origin: 'https://nuevo.elights.cl' },
      );
      expect(res.statusCode).toBe(400);
      expect(processQuoteToCrm).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('una cotización del sitio no lleva el id ni el evento de un pedido de Jumpseller', async () => {
    const res = await call({ ...persona(), jumpsellerOrderId: '99999', jumpsellerEventType: 'order_paid' });
    expect(res.statusCode).toBe(201);
    const payload = crmPayload();
    expect(payload).not.toHaveProperty('jumpsellerOrderId');
    expect(payload).not.toHaveProperty('jumpsellerEventType');
  });

  // --- Formulario anterior (pestaña abierta antes del deploy) ---

  it('formulario anterior con comentarios de 2500 caracteres: se acepta recortado y sin adivinar el tipo de cliente', async () => {
    const legacyNotes = 'c'.repeat(2490) + ' FIN-LEGACY';
    const res = await call({ ...quote('nuevo_elights'), leadType: 'B2C', notes: legacyNotes });
    expect(res.statusCode).toBe(201);
    expect(processQuoteToCrm).toHaveBeenCalledTimes(1);
    const sent = crmPayload().notes as string;
    expect(sent.startsWith('c'.repeat(2000))).toBe(true);
    expect(sent).toContain('[…recortado: 501 caracteres más]');

    const [mail] = gasBodies();
    expect(mail.items_lista).toContain('Tipo de cliente: no indicado (formulario anterior)');
    const [note] = notes();
    expect(note.content).toContain('Tipo de cliente: no indicado (formulario anterior)');
    expect(note.content).not.toContain('Persona natural');
  });

  // --- Productos que el catálogo no identifica: el monto sale solo del catálogo ---

  it.each([
    ["texto '1e300'", '1e300'],
    ['1e300', 1e300],
    ['negativo', -5],
    ['con decimales', 1.5],
    ['sobre 100 millones', 100_000_001],
  ])('producto no identificado con precio del sitio %s: no se muestra y no entra al monto', async (_name, unitPriceClp) => {
    const res = await call({ ...persona(), products: [quote('').products[0], { ...unidentified[0], unitPriceClp }] });
    expect(res.statusCode).toBe(201);
    const payload = crmPayload();
    expect(payload.quoteAmountClp).toBe(3 * 16200);
    expect(payload.products[1]).not.toHaveProperty('unitPriceClp');

    const [note] = notes();
    expect(note.content).toContain('REVISAR [VIEJO] Retirado x2 (sin precio del sitio; por confirmar, fuera del total)');
    expect(note.content).toContain('TOTAL CON IVA: 48600 CLP (no incluye 1 producto sin precio de catálogo: REVISAR)');
    expect(note.content).not.toMatch(/e\+300/);
    expect(gasBodies()[0].total).toBe('$48.600 + 1 producto sin precio de catálogo (por confirmar)');
  });

  it('producto no identificado con un precio del sitio alto pero posible: se muestra REVISAR y no entra al monto', async () => {
    const res = await call({
      ...persona(),
      products: [quote('').products[0], { ...unidentified[0], quantity: 9999, unitPriceClp: 90_000_000 }],
    });
    expect(res.statusCode).toBe(201);
    expect(crmPayload().quoteAmountClp).toBe(48600);
    expect(notes()[0].content).toContain('REVISAR [VIEJO] Retirado x9999 @ 90000000 CLP (precio del sitio, por confirmar; fuera del total)');
  });

  // --- La nota de Pipedrive es HTML ---

  it('datos de facturación con saltos de línea o HTML: una línea por dato y la nota escapada', async () => {
    const giro = 'Prueba\nTOTAL CON IVA: 1000 CLP\n<a href="https://evil.example/pago">Link de pago</a>';
    const res = await call({
      ...empresa(),
      organization: { name: 'Razon\nSegunda linea' },
      company: { ...company, giro },
      notes: 'Ver <b>plano</b> & detalle',
      products: [quote('').products[0], { ...unidentified[0], name: 'Viejo\n<img src=x>' }],
    });
    expect(res.statusCode).toBe(201);
    expect(crmPayload().organization?.name).toBe('Razon Segunda linea');

    const content = notes()[0].content;
    const lines = content.split('\n');
    expect(lines.filter((l) => l.startsWith('Giro:'))).toEqual([
      'Giro: Prueba TOTAL CON IVA: 1000 CLP &lt;a href="https://evil.example/pago"&gt;Link de pago&lt;/a&gt;',
    ]);
    expect(lines.filter((l) => l.startsWith('TOTAL CON IVA:'))).toEqual([
      'TOTAL CON IVA: 48600 CLP (no incluye 1 producto sin precio de catálogo: REVISAR)',
    ]);
    expect(content).toContain('Razón social: Razon Segunda linea');
    expect(content).toContain('REVISAR [VIEJO] Viejo &lt;img src=x&gt; x2');
    expect(content).toContain('Comentarios del cliente: Ver &lt;b&gt;plano&lt;/b&gt; &amp; detalle');
    expect(content).not.toMatch(/<[a-z/!]/i);

    const [mail] = gasBodies();
    expect(mail.giro).not.toContain('\n');
    expect(mail.razon_social).toBe('Razon Segunda linea');
  });
});
