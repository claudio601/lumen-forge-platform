// api/_tests/request-orders.create.test.ts
// "Solicitar pedido": el servidor recalcula precios CON IVA desde el catálogo, acepta
// productos sin SKU y se protege de spam. Pipedrive y el correo están simulados.
// Vive en api/_tests/ para que Vercel no lo despliegue como función.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../_lib/pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn(async () => ({ personId: 11 })) }));
vi.mock('../_lib/pipedrive/organizations.js', () => ({ findOrCreateOrganization: vi.fn(async () => ({ organizationId: 22 })) }));
vi.mock('../_lib/pipedrive/deals.js', () => ({ createDeal: vi.fn(async () => ({ dealId: 999, status: 'created' })) }));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn(async () => ({ success: true, data: { id: 1 } })) }));

import handler from '../request-orders/create';
import { createDeal } from '../_lib/pipedrive/deals.js';
import { pipedrivePost } from '../_lib/pipedrive/client.js';
import { waitUntil } from '@vercel/functions';

let ipSeq = 0;
function call(body: unknown, opts: { ip?: string; origin?: string } = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': opts.ip ?? `10.0.0.${++ipSeq}`, ...(opts.origin ? { origin: opts.origin } : {}) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}

const base = {
  fullName: 'PRUEBA TEST', email: 'prueba@example.com', phone: '+56911111111',
  customerType: 'persona', commune: 'Santiago', region: 'Metropolitana', requestReference: 'RC-abc12',
};
const ar111 = { jumpsellerId: 3305420, sku: 'AR111OPC', name: 'AR111', quantity: 2, unitPrice: 100, currency: 'CLP', lineTotal: 200, url: '/x', attributes: {} };

describe('POST /api/request-orders/create', () => {
  beforeEach(() => {
    vi.mocked(createDeal).mockClear();
    vi.mocked(pipedrivePost).mockClear();
    process.env.PIPEDRIVE_PIPELINE_ID = '1';
    process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID = '2';
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ status: 'ok' }) })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('un precio alterado en el navegador no llega a Pipedrive: se usa el del catálogo (CON IVA)', async () => {
    const res = await call({ ...base, items: [ar111], subtotal: 200 });
    expect(res.statusCode).toBe(201);
    const deal = vi.mocked(createDeal).mock.calls[0][0];
    expect(deal.quoteAmountClp).toBe(2 * 16200);
    expect(deal.notes).toContain('[AR111OPC] AMPOLLETA LED AR111');
    expect(deal.notes).toContain('@ 16200 CLP = 32400 CLP | Jumpseller 3305420');
    expect(deal.notes).toContain('TOTAL CON IVA: 32400 CLP');
    expect(deal.notes).not.toContain('@ 100 CLP');
  });

  it('un producto sin SKU (JS-<id>) se acepta', async () => {
    const item = { jumpsellerId: 3921249, sku: 'JS-3921249', name: 'Lineal', quantity: 1, unitPrice: 1, currency: 'CLP', lineTotal: 1, url: '/x', attributes: {} };
    const res = await call({ ...base, items: [item] });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(createDeal).mock.calls[0][0].notes).toContain('[JS-3921249]');
  });

  it('dos colores de luz del mismo BESTLED son dos líneas con su precio de variante', async () => {
    const line = (variantId: number) => ({ jumpsellerId: 2301098, variantId, sku: 'x', name: 'x', quantity: 1, unitPrice: 1, currency: 'CLP', lineTotal: 1, url: '/x', attributes: {} });
    const res = await call({ ...base, items: [line(95224064), line(111887368)] });
    expect(res.statusCode).toBe(201);
    const deal = vi.mocked(createDeal).mock.calls[0][0];
    expect(deal.quoteAmountClp).toBe(108500 + 119400);
    expect(deal.notes).toContain('variante 111887368');
  });

  it('el detalle de productos queda como nota del negocio en Pipedrive (con ids de Jumpseller)', async () => {
    await call({ ...base, items: [ar111] });
    const [path, body] = vi.mocked(pipedrivePost).mock.calls[0] as [string, { content: string; deal_id: number }];
    expect(path).toBe('/notes');
    expect(body.deal_id).toBe(999);
    expect(body.content).toContain('Jumpseller 3305420');
    expect(body.content).toContain('TOTAL CON IVA: 32400 CLP');
  });

  it('el correo a ventas trae referencia, negocio de Pipedrive, color de luz y modo de precio', async () => {
    const bestled = { jumpsellerId: 4156930, variantId: 113961236, sku: 'APB1507', name: 'BESTLED', quantity: 1, unitPrice: 1, currency: 'CLP', lineTotal: 1, url: '/x', attributes: { colorLuz: '2700K Cálida' } };
    await call({ ...base, notes: 'despacho a obra', items: [bestled] });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, { body: string }];
    const mail = JSON.parse(init.body) as Record<string, string>;
    expect(mail.modo_precio).toBe('Con IVA');
    expect(mail.items_lista).toContain('Solicitud de pedido RC-abc12');
    expect(mail.items_lista).toContain('negocio Pipedrive #999');
    expect(mail.items_lista).toContain('Comuna: Santiago, Metropolitana');
    expect(mail.items_lista).toContain('Notas del cliente: despacho a obra');
    expect(mail.items_lista).toContain('2700K Cálida x1');
    expect(mail.items_lista).toContain('(Jumpseller 4156930, variante 113961236)');
  });

  it('un producto que ya no existe NO pierde la solicitud: se crea el negocio y se marca para revisar', async () => {
    const res = await call({ ...base, items: [{ ...ar111, jumpsellerId: 2787870, name: 'CAMPANA UFO 150W', unitPrice: 50000 }, ar111] });
    expect(res.statusCode).toBe(201);
    const deal = vi.mocked(createDeal).mock.calls[0][0];
    expect(deal.quoteAmountClp).toBe(2 * 16200);
    expect(deal.notes).toContain('REVISAR [AR111OPC] CAMPANA UFO 150W x2');
    expect(deal.notes).toContain('precio por confirmar (el cliente vio 50000 CLP)');
  });

  it('bundle anterior (sin jumpsellerId, SKU base de BESTLED): se identifica por el nombre', async () => {
    const old = { sku: 'APB120', name: 'ALUMBRADO PÚBLICO BESTLED 120W IP66 IK08', quantity: 1, unitPrice: 162000, currency: 'CLP', lineTotal: 162000, url: '/producto/alumbrado-publico-bestled-120w-ip66-ik08', attributes: {} };
    const res = await call({ ...base, items: [old] });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(createDeal).mock.calls[0][0].notes).toContain('Jumpseller 2301110');
  });

  it('cantidad inválida → 400 (validación)', async () => {
    const res = await call({ ...base, items: [{ ...ar111, quantity: 1.5 }] });
    expect(res.statusCode).toBe(400);
    expect(createDeal).not.toHaveBeenCalled();
  });

  it('en producción bloquea orígenes desconocidos (403)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const bad = await call({ ...base, items: [ar111] }, { origin: 'https://spam.example' });
    expect(bad.statusCode).toBe(403);
    const ok = await call({ ...base, items: [ar111] }, { origin: 'https://nuevo.elights.cl' });
    expect(ok.statusCode).toBe(201);
  });

  it('honeypot: responde 200 y no crea negocio', async () => {
    const res = await call({ ...base, items: [ar111], website: 'http://spam' });
    expect(res.statusCode).toBe(200);
    expect(createDeal).not.toHaveBeenCalled();
  });

  it('límite de solicitudes por IP (429)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call({ ...base, items: [ar111] }, { ip: '203.0.113.7' })).statusCode);
    expect(statuses.slice(0, 10).every(s => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

// --- Origen de la visita (Etapa 2 · PR 10) ---
// El formulario manda `attribution`; el servidor lo limpia y agrega la sección "ORIGEN DE LA
// VISITA" a la nota (antes de requested_items_json, que sigue al final) y al correo. Un
// origen raro se descarta: nunca da 400. Nada de eso llega al log.

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
/** Escape JSON de una mitad suelta de un emoji (\ud83d): un lector estricto lo rechaza. */
const LONE_SURROGATE_ESCAPE = /\\u[dD][89a-fA-F]/;
const BAD_ATTRIBUTIONS: [string, unknown, string][] = [
  ['un texto', 'gclid=' + GCLID, SIN_DATOS],
  ['una lista', [GCLID], SIN_DATOS],
  ['un número', 42, SIN_DATOS],
  ['valores enormes', { gclid: 'g'.repeat(10_000), utm_source: 's'.repeat(10_000) }, 'gclid: ' + 'g'.repeat(200) + '\nutm_source: ' + 's'.repeat(200)],
  ['una etiqueta script', { utm_campaign: '<script>alert(1)</script>', landing: '/<script>' }, 'utm_campaign: scriptalert(1)/script\nPágina de entrada: /script'],
  ['medio emoji', { utm_campaign: 'a'.repeat(199) + '\u{1F600}b', utm_term: 'x\ud800y' }, 'utm_campaign: ' + 'a'.repeat(199) + '\nutm_term: x y'],
  ['claves email o rut', { email: 'prueba@example.com', rut: 'RUT-PRUEBA', nombre: 'PRUEBA TEST' }, SIN_DATOS],
];

describe('POST /api/request-orders/create: origen de la visita', () => {
  const noteBodies = () => (vi.mocked(pipedrivePost).mock.calls as unknown as [string, { content: string; deal_id: number }][])
    .filter(([path]) => path === '/notes').map(([, body]) => body);
  const mails = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][])
    .map(([, init]) => JSON.parse(init.body as string) as Record<string, string>);
  const mailsSettled = () => Promise.all(vi.mocked(waitUntil).mock.calls.map(([p]) => p));
  const logged = () =>
    [console.log, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
      .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
      .join('\n');

  beforeEach(() => {
    vi.mocked(createDeal).mockClear();
    vi.mocked(pipedrivePost).mockClear();
    vi.mocked(waitUntil).mockClear();
    process.env.PIPEDRIVE_PIPELINE_ID = '1';
    process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID = '2';
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ status: 'ok' }) })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('la nota y el correo llevan la sección; requested_items_json sigue siendo la última línea', async () => {
    const res = await call({ ...base, items: [ar111], attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const [note] = noteBodies();
    expect(note.content).toContain('\n\n' + ORIGEN_GADS + '\nrequested_items_json: ');
    expect(note.content.split('\n').at(-1)).toMatch(/^requested_items_json: \[/);
    expect(vi.mocked(createDeal).mock.calls[0][0].notes).toContain(ORIGEN_GADS);
    const [mail] = mails();
    expect(mail.items_lista.endsWith('\n\n' + ORIGEN_GADS)).toBe(true);
    // Solo el origen del sitio anterior y la ruta de la página de entrada
    expect(note.content).not.toContain('q=');
    expect(mail.items_lista).not.toContain('q=');
  });

  it('sin origen (formulario anterior): la sección dice "Sin datos"', async () => {
    await call({ ...base, items: [ar111] });
    expect(noteBodies()[0].content).toContain(SIN_DATOS + '\nrequested_items_json: ');
    expect(mails()[0].items_lista.endsWith(SIN_DATOS)).toBe(true);
  });

  it.each(BAD_ATTRIBUTIONS)('origen inválido (%s): 201, nunca 400, y solo lo limpio llega a la nota y al correo', async (_name, attribution, expected) => {
    const res = await call({ ...base, items: [ar111], attribution });
    expect(res.statusCode).toBe(201);
    const content = noteBodies()[0].content;
    const body = mails()[0].items_lista;
    for (const text of [content, body]) {
      expect(text).toContain(expected);
      expect(text).not.toMatch(/<script|g{201}|s{201}|RUT-PRUEBA/);
    }
  });

  it('referencias de carácter en el origen (&#10;, &#x0A;, &quot;): ningún & llega a la nota ni al correo, y la sección no suma líneas', async () => {
    const res = await call({ ...base, items: [ar111], attribution: CHAR_REF_ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const content = noteBodies()[0].content;
    const body = mails()[0].items_lista;
    expect(content).toContain('\n\n' + ORIGEN_CHAR_REF + '\nrequested_items_json: [');
    expect(body.endsWith('\n\n' + ORIGEN_CHAR_REF)).toBe(true);
    for (const text of [content, body]) expect(text).not.toMatch(/&(?:#|quot;|NewLine;)/i);
    // La única línea requested_items_json sigue siendo la real, al final
    expect(content.split('\n').filter((line) => line.startsWith('requested_items_json'))).toHaveLength(1);
    expect(content.split('\n').at(-1)).toMatch(/^requested_items_json: \[\{"jumpsellerId":3305420/);
  });

  it('medio emoji en el origen: la nota a Pipedrive y el correo viajan sin mitades sueltas', async () => {
    const attribution = { utm_campaign: 'a'.repeat(199) + '\u{1F600}b', utm_term: 'x\ud800y' };
    expect((await call({ ...base, items: [ar111], attribution })).statusCode).toBe(201);
    await mailsSettled();
    const sent = [
      JSON.stringify(noteBodies()[0]),
      ...(vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]).map(([, init]) => init.body as string),
    ];
    expect(sent).toHaveLength(2);
    for (const json of sent) expect(json).not.toMatch(LONE_SURROGATE_ESCAPE);
  });

  it('reenvío con la misma referencia (skipped_duplicate): ahora deja una nota "Reenvío" con el origen', async () => {
    vi.mocked(createDeal).mockResolvedValueOnce({ dealId: 555, status: 'skipped_duplicate' } as never);
    const res = await call({ ...base, items: [ar111], attribution: ATTRIBUTION });
    expect(res.statusCode).toBe(201);
    const sent = noteBodies();
    expect(sent).toHaveLength(1);
    expect(sent[0].deal_id).toBe(555);
    expect(sent[0].content.startsWith('Reenvío de la solicitud RC-abc12 (misma referencia; no se creó un negocio nuevo)\n')).toBe(true);
    expect(sent[0].content).toContain(ORIGEN_GADS);
    expect(sent[0].content.split('\n').at(-1)).toMatch(/^requested_items_json: /);
  });

  it('el origen no cambia la referencia del negocio', async () => {
    await call({ ...base, items: [ar111], attribution: ATTRIBUTION });
    await call({ ...base, items: [ar111], attribution: { fbclid: 'IwAREJEMPLO', landing: '/' } });
    const [a, b] = vi.mocked(createDeal).mock.calls.map(([args]) => args.quoteReference);
    expect(a).toBe('RC-abc12');
    expect(b).toBe(a);
  });

  it('el log no lleva el origen ni datos del cliente, tampoco cuando el relay repite lo que recibió', async () => {
    await call({ ...base, items: [ar111], attribution: ATTRIBUTION });
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ status: 'error', message: 'Invalid email: ' + base.email + ' ' + base.fullName }) })));
    await call({ ...base, items: [ar111], attribution: ATTRIBUTION });
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 502, json: async () => { throw new SyntaxError('Unexpected token < in "<html>' + base.email); } })));
    await call({ ...base, items: [ar111], attribution: ATTRIBUTION });
    await call({ ...base, items: [ar111], attribution: 'x'.repeat(5000) });
    await mailsSettled();
    const text = logged();
    expect(text).toContain('GAS email starting | ref: RC-abc12');
    expect(text).toContain('GAS relay: status error');
    expect(text).toContain('GAS relay: HTTP 502, respuesta no JSON');
    for (const secret of [GCLID, 'campanas-led-industriales', '/catalogo/campanas-led', 'www.google.com', base.email, base.fullName, base.phone]) {
      expect(text).not.toContain(secret);
    }
  });
});
