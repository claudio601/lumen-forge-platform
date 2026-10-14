// api/_tests/consent-enforcement.test.ts
// Privacidad (Etapa 2 · PR 13): los cinco formularios del sitio exigen la casilla obligatoria.
// Tabla sobre los cinco endpoints: sin la casilla (o con un valor que no es exactamente
// true), 400 con code 'consent_required' ANTES de tocar el correo o Pipedrive, también con una
// API key válida. Única tolerancia: dentro del margen, un cuerpo SIN la clave consent se
// acepta y queda registrado como 'web-legacy'. Si aparece un api/*/create.ts nuevo, la prueba
// falla hasta que se agregue a la tabla. Pipedrive y el relay están simulados. Vive en
// api/_tests/ para que Vercel no lo despliegue como función.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../_lib/pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn() }));
vi.mock('../_lib/pipedrive/organizations.js', () => ({ findOrCreateOrganization: vi.fn() }));
vi.mock('../_lib/pipedrive/deals.js', () => ({ createDeal: vi.fn() }));
vi.mock('../_lib/pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn(), pipedriveGet: vi.fn(), pipedrivePut: vi.fn() }));
vi.mock('../_lib/crm/dedupe.js', () => ({ processQuoteToCrm: vi.fn(), buildSuccessResponse: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }));

import requestOrders from '../request-orders/create';
import quotes from '../quotes/create';
import projectQuotes from '../project-quotes/create';
import installationLeads from '../installation-leads/create';
import estudioLuminico from '../estudio-luminico/create';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { findOrCreateOrganization } from '../_lib/pipedrive/organizations.js';
import { createDeal } from '../_lib/pipedrive/deals.js';
import { pipedrivePost, pipedriveGet, pipedrivePut } from '../_lib/pipedrive/client.js';
import { processQuoteToCrm, buildSuccessResponse } from '../_lib/crm/dedupe.js';
import { waitUntil } from '@vercel/functions';
import {
  CONSENT_ERROR_CODE,
  LEGAL_VERSION,
  consentGraceUntil,
  lastConsentRecord,
  type ConsentForm,
} from '../_lib/forms/consent';

type Handler = (req: unknown, res: unknown) => Promise<void>;
type Body = Record<string, unknown>;

const NAME = 'PRUEBA ETAPA 2 (13)';
const EMAIL = 'prueba-etapa2-13@example.com';
const PHONE = '+56 9 0000 0913';

interface Endpoint {
  handler: Handler;
  form: ConsentForm;
  /** /solicitar-pedido: la casilla obligatoria incluye los términos. */
  requireTerms: boolean;
  /** Cuerpo válido del formulario, SIN la clave consent (uno nuevo en cada llamada). */
  body: () => Body;
  /** API key que el endpoint acepta: no salta la casilla. */
  apiKey?: { env: string };
}

/** Una entrada por cada api/<carpeta>/create.ts de formularios del sitio. */
const ENDPOINTS: Record<string, Endpoint> = {
  'request-orders': {
    handler: requestOrders as unknown as Handler,
    form: 'solicitar-pedido',
    requireTerms: true,
    body: () => ({
      fullName: NAME, email: EMAIL, phone: PHONE, customerType: 'persona', commune: 'Santiago',
      region: 'Metropolitana', requestReference: 'RC-abc13', website: '',
      items: [{ jumpsellerId: 3305420, sku: 'AR111OPC', name: 'AR111', quantity: 2, unitPrice: 100, currency: 'CLP', lineTotal: 200, url: '/x', attributes: {} }],
    }),
  },
  quotes: {
    handler: quotes as unknown as Handler,
    form: 'cotizacion',
    requireTerms: false,
    body: () => ({
      sourceSystem: 'nuevo_elights', quoteReference: 'NE-abc13', leadType: 'B2C',
      customer: { name: NAME, email: EMAIL, phone: PHONE }, customerType: 'persona', priceMode: 'iva',
      products: [{ jumpsellerId: 3305420, sku: 'AR111OPC', name: 'AR111', quantity: 3, unitPriceClp: 13613 }],
      notes: 'PRUEBA ETAPA 2 (13) - no cotizar', website: '',
    }),
    apiKey: { env: 'QUOTES_API_KEY' },
  },
  'project-quotes': {
    handler: projectQuotes as unknown as Handler,
    form: 'cotizador',
    requireTerms: false,
    body: () => ({ tipoProyecto: 'Bodega', m2: 1200, nombre: NAME, email: EMAIL, telefono: PHONE, website: '' }),
  },
  'installation-leads': {
    handler: installationLeads as unknown as Handler,
    form: 'instalacion',
    requireTerms: false,
    body: () => ({
      nombre: NAME, email: EMAIL, telefono: PHONE, comuna: 'Santiago', tipoProyecto: 'Oficina',
      descripcion: 'PRUEBA ETAPA 2 (13) - no contactar', tipoCliente: 'empresa', preferenciaContacto: 'email',
      aceptaContacto: true, origen: 'instalacion_web', website: '',
    }),
    apiKey: { env: 'INSTALLATION_API_SECRET' },
  },
  'estudio-luminico': {
    handler: estudioLuminico as unknown as Handler,
    form: 'estudio-luminico',
    requireTerms: false,
    body: () => ({
      nombreCompleto: NAME, email: EMAIL, telefono: PHONE, tipoProyecto: 'industria_bodega', comunaCiudad: 'Santiago',
      tienePlanos: 'no_tengo', dimensionesAproximadas: 'PRUEBA 10x20 m', alturaMontaje: '6 m',
      objetivoProyecto: 'operacion_industrial', origen: 'estudio_luminico_web', fecha: '20 de noviembre de 2026',
      landingPath: '/estudio-luminico', website: '',
    }),
    apiKey: { env: 'INSTALLATION_API_SECRET' },
  },
};

/** Casillas válidas para el endpoint (los términos solo en el pedido). */
const validConsent = (ep: Endpoint, marketing = false) => ({
  privacy: true,
  ...(ep.requireTerms ? { terms: true } : {}),
  marketing,
  version: LEGAL_VERSION,
});

/** Marca para un cuerpo sin la clave consent. */
const ABSENT = Symbol('ausente');

/** Valores de consent que se rechazan en todos los endpoints. */
const INVALID: [string, unknown][] = [
  ['ausente (después del margen)', ABSENT],
  ['null', null],
  ["'true'", 'true'],
  ['[]', []],
  ['{}', {}],
  ['{ privacy: false }', { privacy: false }],
  ["{ privacy: 'true' }", { privacy: 'true' }],
  ['{ privacy: 1 }', { privacy: 1 }],
  ["{ privacy: true, marketing: 'si' }", { privacy: true, terms: true, marketing: 'si' }],
];

/** Además, en /solicitar-pedido: la casilla de privacidad sin los términos. */
const INVALID_PEDIDO: [string, unknown][] = [
  ['{ privacy: true } sin terms', { privacy: true, marketing: false, version: LEGAL_VERSION }],
  ['{ privacy: true, terms: false }', { privacy: true, terms: false, marketing: false, version: LEGAL_VERSION }],
];

const withConsent = (ep: Endpoint, consent: unknown): Body =>
  consent === ABSENT ? ep.body() : { ...ep.body(), consent };

let ipSeq = 0;
function call(ep: Endpoint, body: unknown, headers: Record<string, string> = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader() {},
  };
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': `10.13.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`, ...headers },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
  return ep.handler(req, res).then(() => res);
}

/** Todo lo que deja rastro fuera del endpoint: correo, Pipedrive, CRM y waitUntil. */
const SIDE_EFFECTS = () => ({
  fetch: vi.mocked(fetch).mock.calls.length,
  findOrCreatePerson: vi.mocked(findOrCreatePerson).mock.calls.length,
  findOrCreateOrganization: vi.mocked(findOrCreateOrganization).mock.calls.length,
  createDeal: vi.mocked(createDeal).mock.calls.length,
  pipedrivePost: vi.mocked(pipedrivePost).mock.calls.length,
  pipedriveGet: vi.mocked(pipedriveGet).mock.calls.length,
  pipedrivePut: vi.mocked(pipedrivePut).mock.calls.length,
  processQuoteToCrm: vi.mocked(processQuoteToCrm).mock.calls.length,
  waitUntil: vi.mocked(waitUntil).mock.calls.length,
});
const NONE = {
  fetch: 0, findOrCreatePerson: 0, findOrCreateOrganization: 0, createDeal: 0, pipedrivePost: 0,
  pipedriveGet: 0, pipedrivePut: 0, processQuoteToCrm: 0, waitUntil: 0,
};

const mailsSettled = () => Promise.all(vi.mocked(waitUntil).mock.calls.map(([p]) => p));
/** Texto de la constancia que quedó: la nota (o el payload del CRM en /cotizacion) y los correos. */
const recorded = () => [
  ...(vi.mocked(pipedrivePost).mock.calls as unknown as [string, { content?: string }][])
    .filter(([path]) => path === '/notes')
    .map(([, body]) => body.content ?? ''),
  ...(vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][])
    .map(([, init]) => (JSON.parse(init.body as string) as { items_lista: string }).items_lista),
];
const warned = () => vi.mocked(console.warn).mock.calls.flat().map(String);

beforeEach(() => {
  vi.mocked(findOrCreatePerson).mockReset().mockResolvedValue({ personId: 11, action: 'created' } as never);
  vi.mocked(findOrCreateOrganization).mockReset().mockResolvedValue({ organizationId: 22, action: 'created' } as never);
  vi.mocked(createDeal).mockReset().mockResolvedValue({ dealId: 999, status: 'created' } as never);
  vi.mocked(pipedrivePost).mockReset().mockImplementation((async (path: string) =>
    path === '/deals' ? { success: true, data: { id: 777 } } : { success: true, data: { id: 1 } }) as never);
  vi.mocked(pipedriveGet).mockReset().mockResolvedValue({ success: true, data: { items: [] } } as never);
  vi.mocked(pipedrivePut).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
  vi.mocked(processQuoteToCrm).mockReset().mockResolvedValue({
    person: { personId: 11 }, organization: null, deal: { dealId: 77, status: 'created' },
  } as never);
  vi.mocked(buildSuccessResponse).mockReset().mockImplementation(((r: { deal: { dealId: number; status: string } }) =>
    ({ success: true, personId: 11, organizationId: null, dealId: r.deal.dealId, dealStatus: r.deal.status })) as never);
  vi.mocked(waitUntil).mockClear();
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '2');
  vi.stubEnv('PIPEDRIVE_OWNER_USER_ID', '1');
  vi.stubEnv('PIPEDRIVE_INSTALL_PIPELINE_ID', '3');
  vi.stubEnv('PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID', '30');
  // Sirve a los dos relays: request-orders lee json(); el helper de correo, text()
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, text: async () => '{"status":"ok"}', json: async () => ({ status: 'ok' }),
  })));
  // Después del margen: un cuerpo sin la clave consent ya no se acepta
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(consentGraceUntil().getTime() + 60_000));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('casilla obligatoria en los formularios del sitio', () => {
  it('la tabla cubre todos los api/*/create.ts (un endpoint nuevo falla hasta agregarse)', () => {
    const apiDir = fileURLToPath(new URL('..', import.meta.url));
    const found = readdirSync(apiDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(apiDir, d.name, 'create.ts')))
      .map((d) => d.name)
      .sort();
    expect(found).toEqual(Object.keys(ENDPOINTS).sort());
  });

  describe.each(Object.entries(ENDPOINTS))('%s', (_name, ep) => {
    const cases = ep.requireTerms ? [...INVALID, ...INVALID_PEDIDO] : INVALID;

    it.each(cases)('consent %s: 400 consent_required sin correo, Pipedrive ni CRM; el log solo dice "Consent missing"', async (_label, consent) => {
      const res = await call(ep, withConsent(ep, consent));
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        error: 'Validation failed',
        code: CONSENT_ERROR_CODE,
        details: { errors: expect.any(Array) },
      });
      expect(SIDE_EFFECTS()).toEqual(NONE);
      expect(warned()).toHaveLength(1);
      expect(warned()[0]).toMatch(/ Consent missing$/);
      const logs = [console.log, console.warn, console.error].flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');
      for (const pii of [NAME, EMAIL, PHONE]) expect(logs).not.toContain(pii);
    });

    it('control: el mismo cuerpo con la casilla marcada → 2xx, y la constancia "web" queda en la nota y el correo', async () => {
      const res = await call(ep, withConsent(ep, validConsent(ep)));
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(300);
      expect(res.body).toMatchObject({ success: true });
      await mailsSettled();
      const texts = recorded();
      expect(texts.length).toBeGreaterThanOrEqual(2);
      for (const text of texts) {
        expect(lastConsentRecord(text)).toMatchObject({
          v: LEGAL_VERSION,
          form: ep.form,
          privacy: true,
          terms: ep.requireTerms ? true : null,
          marketing: false,
          src: 'web',
        });
      }
    });

    it('honeypot sin casillas: 200 sin crear nada', async () => {
      const res = await call(ep, { ...ep.body(), website: 'http://spam' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(SIDE_EFFECTS()).toEqual(NONE);
    });

    it('dentro del margen: sin la clave consent → 2xx con constancia "web-legacy"; con la clave sin marcar → 400', async () => {
      vi.setSystemTime(new Date(consentGraceUntil().getTime() - 60_000));
      const invalid = await call(ep, withConsent(ep, { privacy: false }));
      expect(invalid.statusCode).toBe(400);
      expect(invalid.body).toMatchObject({ code: CONSENT_ERROR_CODE });
      expect(SIDE_EFFECTS()).toEqual(NONE);

      const legacy = await call(ep, ep.body());
      expect(legacy.statusCode).toBeGreaterThanOrEqual(200);
      expect(legacy.statusCode).toBeLessThan(300);
      await mailsSettled();
      const texts = recorded();
      expect(texts.length).toBeGreaterThanOrEqual(2);
      for (const text of texts) {
        expect(lastConsentRecord(text)).toMatchObject({ v: null, form: ep.form, privacy: null, terms: null, marketing: false, src: 'web-legacy' });
      }
    });

    if (ep.apiKey) {
      const { env } = ep.apiKey;
      it(`con ${env} válida y sin consent: igual 400 (la clave no salta la casilla)`, async () => {
        vi.stubEnv(env, 'clave-de-prueba');
        const res = await call(ep, ep.body(), { 'x-api-key': 'clave-de-prueba' });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ code: CONSENT_ERROR_CODE });
        expect(SIDE_EFFECTS()).toEqual(NONE);

        // Control: la clave es válida (con la casilla, la solicitud entra)
        const ok = await call(ep, withConsent(ep, validConsent(ep)), { 'x-api-key': 'clave-de-prueba' });
        expect(ok.statusCode).toBeLessThan(300);
      });
    }
  });
});
