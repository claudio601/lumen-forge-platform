// api/request-orders/create.test.ts
// "Solicitar pedido": el servidor recalcula precios CON IVA desde el catálogo, acepta
// productos sin SKU y se protege de spam. Pipedrive y el correo están simulados.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../_lib/pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn(async () => ({ personId: 11 })) }));
vi.mock('../_lib/pipedrive/organizations.js', () => ({ findOrCreateOrganization: vi.fn(async () => ({ organizationId: 22 })) }));
vi.mock('../_lib/pipedrive/deals.js', () => ({ createDeal: vi.fn(async () => ({ dealId: 999, status: 'created' })) }));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }));

import handler from './create';
import { createDeal } from '../_lib/pipedrive/deals.js';

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

  it('producto que ya no existe → 400 "Products unavailable" y no se crea negocio', async () => {
    const res = await call({ ...base, items: [{ ...ar111, jumpsellerId: 2787870 }] });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Products unavailable');
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
