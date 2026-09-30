// api/quotes/create.test.ts
// Cotizaciones del sitio (sourceSystem nuevo_elights): precios CON IVA desde el catálogo.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../_lib/crm/dedupe.js', () => ({
  processQuoteToCrm: vi.fn(async () => ({ deal: { dealId: 77, status: 'created' } })),
  buildSuccessResponse: vi.fn(() => ({ success: true })),
}));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn(async () => ({ success: true })) }));

import handler from './create';
import { processQuoteToCrm } from '../_lib/crm/dedupe.js';
import { pipedrivePost } from '../_lib/pipedrive/client.js';

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

const quote = (sourceSystem: string) => ({
  sourceSystem,
  quoteReference: 'NE-abc123',
  leadType: 'B2B',
  customer: { name: 'PRUEBA', email: 'prueba@example.com', phone: '+56911111111' },
  products: [{ jumpsellerId: 3305420, sku: 'AR111OPC', name: 'AR111', quantity: 3, unitPriceClp: 13613 }],
  quoteAmountClp: 40839,
});

describe('POST /api/quotes/create', () => {
  beforeEach(() => {
    vi.mocked(processQuoteToCrm).mockClear();
    vi.mocked(pipedrivePost).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('cotización del sitio en modo neto: el negocio queda CON IVA desde el catálogo', async () => {
    const res = await call(quote('nuevo_elights'));
    expect(res.statusCode).toBeLessThan(300);
    const payload = vi.mocked(processQuoteToCrm).mock.calls[0][0] as { products: { unitPriceClp: number }[]; quoteAmountClp: number };
    expect(payload.products[0].unitPriceClp).toBe(16200);
    expect(payload.quoteAmountClp).toBe(3 * 16200);
    expect(payload.products[0]).not.toHaveProperty('jumpsellerId');
    const [path, body] = vi.mocked(pipedrivePost).mock.calls[0] as [string, { content: string; deal_id: number }];
    expect(path).toBe('/notes');
    expect(body.deal_id).toBe(77);
    expect(body.content).toContain('Jumpseller 3305420');
  });

  it('producto no identificado en modo empresa: el precio neto del sitio se lleva a CON IVA', async () => {
    const q = quote('nuevo_elights');
    q.products = [{ jumpsellerId: 1, sku: 'VIEJO', name: 'Retirado', quantity: 2, unitPriceClp: 10000 }] as typeof q.products;
    await call(q);
    const payload = vi.mocked(processQuoteToCrm).mock.calls[0][0] as { quoteAmountClp: number; products: { unitPriceClp: number }[] };
    expect(payload.products[0].unitPriceClp).toBe(11900);
    expect(payload.quoteAmountClp).toBe(23800);
    expect((vi.mocked(pipedrivePost).mock.calls[0][1] as { content: string }).content).toContain('REVISAR [VIEJO]');
  });

  it('otras fuentes (integraciones con API key) no se modifican', async () => {
    process.env.QUOTES_API_KEY = 'k';
    const res = await call(quote('jumpseller'), { 'x-api-key': 'k' });
    expect(res.statusCode).toBeLessThan(300);
    const payload = vi.mocked(processQuoteToCrm).mock.calls[0][0] as { quoteAmountClp: number; products: { unitPriceClp: number }[] };
    expect(payload.quoteAmountClp).toBe(40839);
    expect(payload.products[0].unitPriceClp).toBe(13613);
    delete process.env.QUOTES_API_KEY;
  });
});
