// api/_tests/project-quotes.upload.test.ts
// Permiso de subida de los adjuntos del cotizador (POST /api/project-quotes/upload): método,
// origen en producción, ruta, tipo según la extensión, peso declarado, vencimiento a 10
// minutos, 15 por IP por hora, topes del sitio (D2: 200 archivos y 1 GB al día, techo de lo
// guardado en Blob) y Redis caído. El SDK de Blob está simulado y Redis es un Upstash falso en
// memoria (fetch simulado): no sale nada a Vercel ni a Upstash. Vive en api/_tests/ para que
// Vercel no lo despliegue como función.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob/client', () => ({
  handleUploadPresigned: vi.fn(),
  handleUpload: vi.fn(),
}));
vi.mock('@vercel/blob', () => ({
  issueSignedToken: vi.fn(async (o: { validUntil: number }) => ({
    delegationToken: 'delegacion-de-prueba',
    clientSigningToken: 'firma-de-prueba',
    validUntil: o.validUntil,
  })),
}));

import handler, { CLIENT_TOKEN_EVENT, PERMIT_TTL_MS, PRESIGNED_EVENT, STATUS_EVENT } from '../project-quotes/upload';
import { handleUpload, handleUploadPresigned } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { DAILY_MAX_BYTES, DAILY_MAX_FILES, STORED_BYTES_KEY, STORED_CEILING_BYTES, dayKeys } from '../_lib/attachments/quota';
import { MAX_FILE_BYTES } from '../_lib/attachments/rules';
import { UPSTASH_URL, createFakeRedis, fakeFetch, type FakeRedis } from './fakeUpstash';

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const MB = 1024 * 1024;

// Upstash falso en memoria (fakeUpstash.ts): `redis` son sus datos.
let fake: FakeRedis;
let redis: FakeRedis['data'];

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
    headers: { 'x-forwarded-for': opts.ip ?? `10.9.0.${++ipSeq}`, ...(opts.origin ? { origin: opts.origin } : {}) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}

const permit = (
  { pathname = `cotizador/${UUID}.pdf`, size = 2 * MB, type = PRESIGNED_EVENT, clientPayload, multipart = false }:
  { pathname?: string; size?: number; type?: string; clientPayload?: unknown; multipart?: boolean } = {}
) => ({
  type,
  payload: { pathname, multipart, clientPayload: clientPayload === undefined ? JSON.stringify({ size }) : clientPayload },
});
const status = (files: number, bytes: number) => ({ type: STATUS_EVENT, payload: { files, bytes } });
const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;
const logged = () =>
  [console.log, console.warn, console.error].flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');
const counter = (key: string) => fake.value(key);

describe('POST /api/project-quotes/upload', () => {
  beforeEach(() => {
    fake = createFakeRedis();
    redis = fake.data;
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-de-prueba');
    vi.stubEnv('BLOB_STORE_ID', 'store_prueba');
    vi.stubEnv('BLOB_WEBHOOK_PUBLIC_KEY', 'clave-publica-de-prueba');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_prueba_x');
    vi.stubGlobal('fetch', fakeFetch(fake));
    vi.mocked(handleUploadPresigned).mockReset().mockImplementation(async ({ body, getSignedToken }) => {
      const { payload } = body as { payload: { pathname: string; clientPayload: string; multipart: boolean } };
      const { token, urlOptions } = await getSignedToken(payload.pathname, payload.clientPayload, payload.multipart);
      return {
        type: 'blob.generate-presigned-url',
        presignedUrlPayload: { delegationToken: token.delegationToken, signature: 'x', params: { opciones: JSON.stringify(urlOptions) } },
      };
    });
    vi.mocked(handleUpload).mockReset().mockImplementation(async ({ body, onBeforeGenerateToken }) => {
      const { payload } = body as { payload: { pathname: string; clientPayload: string; multipart: boolean } };
      const options = await onBeforeGenerateToken(payload.pathname, payload.clientPayload, payload.multipart);
      return { type: 'blob.generate-client-token', clientToken: 'vercel_blob_client_' + JSON.stringify(options) };
    });
    vi.mocked(issueSignedToken).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Opciones del permiso presignado que armó el endpoint. */
  const urlOptions = (res: { body: unknown }) =>
    JSON.parse((res.body as { presignedUrlPayload: { params: { opciones: string } } }).presignedUrlPayload.params.opciones);

  it('GET responde 405 con Allow: POST', async () => {
    const res = await call(undefined, { method: 'GET' });
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('en producción bloquea orígenes desconocidos (403) y acepta nuevo.elights.cl', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const bad = await call(permit(), { origin: 'https://spam.example' });
    expect(bad.statusCode).toBe(403);
    expect(handleUploadPresigned).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const ok = await call(permit(), { origin: 'https://nuevo.elights.cl' });
    expect(ok.statusCode).toBe(200);
  });

  it('permiso presignado: solo esa ruta, el tipo de la extensión, el peso declarado, sufijo al azar y 10 minutos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T14:00:00Z'));
    const pathname = `cotizador/${UUID}.dwg`;
    const res = await call(permit({ pathname, size: 3 * MB }));
    expect(res.statusCode).toBe(200);
    const validUntil = Date.parse('2026-11-20T14:00:00Z') + PERMIT_TTL_MS;
    expect(PERMIT_TTL_MS).toBe(10 * 60_000);
    expect(issueSignedToken).toHaveBeenCalledWith({
      pathname,
      operations: ['put'],
      allowedContentTypes: ['image/vnd.dwg'],
      maximumSizeInBytes: 3 * MB,
      validUntil,
    });
    expect(urlOptions(res)).toEqual({
      allowedContentTypes: ['image/vnd.dwg'],
      maximumSizeInBytes: 3 * MB,
      validUntil,
      addRandomSuffix: true,
    });
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['pdf', 'application/pdf'],
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['dwg', 'image/vnd.dwg'],
    ['dxf', 'image/vnd.dxf'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('.%s solo admite %s', async (ext, type) => {
    const res = await call(permit({ pathname: `cotizador/${UUID}.${ext}` }));
    expect(res.statusCode).toBe(200);
    expect(urlOptions(res).allowedContentTypes).toEqual([type]);
  });

  it('vuelta atrás con handleUpload (token de cliente): las mismas restricciones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T14:00:00Z'));
    const res = await call(permit({ type: CLIENT_TOKEN_EVENT, pathname: `cotizador/${UUID}.xlsx`, size: 5 * MB }));
    expect(res.statusCode).toBe(200);
    const options = JSON.parse((res.body as { clientToken: string }).clientToken.slice('vercel_blob_client_'.length));
    expect(options).toEqual({
      allowedContentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      maximumSizeInBytes: 5 * MB,
      validUntil: Date.parse('2026-11-20T14:00:00Z') + PERMIT_TTL_MS,
      addRandomSuffix: true,
    });
    expect(handleUploadPresigned).not.toHaveBeenCalled();
  });

  it.each([
    ['sin uuid', 'cotizador/bases.pdf'],
    ['otra carpeta', `otra/${UUID}.pdf`],
    ['con ..', `cotizador/../${UUID}.pdf`],
    ['.exe', `cotizador/${UUID}.exe`],
    ['.PDF en mayúsculas', `cotizador/${UUID}.PDF`],
    ['.jpeg sin normalizar', `cotizador/${UUID}.jpeg`],
    ['con sufijo', `cotizador/${UUID}-abc.pdf`],
    ['una URL', `https://x.blob.vercel-storage.com/cotizador/${UUID}.pdf`],
    ['vacía', ''],
  ])('ruta %s: 400 sin tocar Redis ni Blob', async (_name, pathname) => {
    const res = await call(permit({ pathname }));
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('invalid_pathname');
    expect(fetch).not.toHaveBeenCalled();
    expect(handleUploadPresigned).not.toHaveBeenCalled();
  });

  it.each([
    ['sin peso', null],
    ['peso 0', JSON.stringify({ size: 0 })],
    ['más de 20 MB', JSON.stringify({ size: MAX_FILE_BYTES + 1 })],
    ['peso con decimales', JSON.stringify({ size: 10.5 })],
    ['peso como texto', JSON.stringify({ size: '100' })],
    ['clientPayload que no es JSON', 'size=100'],
    ['clientPayload objeto', { size: 100 }],
  ])('%s: 400 invalid_size', async (_name, clientPayload) => {
    const res = await call(permit({ clientPayload }));
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('invalid_size');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('20 MB exactos sí: el permiso nunca deja subir más de lo declarado', async () => {
    const res = await call(permit({ size: MAX_FILE_BYTES }));
    expect(res.statusCode).toBe(200);
    expect(urlOptions(res).maximumSizeInBytes).toBe(MAX_FILE_BYTES);
  });

  it('multipart o un evento desconocido: 400', async () => {
    expect((await call(permit({ multipart: true }))).statusCode).toBe(400);
    expect((await call({ type: 'blob.upload-completed', payload: { blob: {} } })).statusCode).toBe(400);
    expect((await call('no es json')).statusCode).toBe(400);
    expect((await call({ type: PRESIGNED_EVENT })).statusCode).toBe(400);
    expect(handleUploadPresigned).not.toHaveBeenCalled();
  });

  it('15 permisos por IP por hora: el 16.º recibe 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) statuses.push((await call(permit(), { ip: '203.0.113.50' })).statusCode);
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true);
    expect(statuses[15]).toBe(429);
    expect(handleUploadPresigned).toHaveBeenCalledTimes(15);
  });

  it('cada permiso suma 1 archivo y el peso declarado al día de Chile, con vencimiento, sin datos personales', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T02:30:00Z')); // 20 de noviembre en Chile
    await call(permit({ size: 3 * MB }));
    await call(permit({ size: 2 * MB }));
    const keys = dayKeys();
    expect(keys).toEqual({ files: 'adjuntos:dia:2026-11-20:archivos', bytes: 'adjuntos:dia:2026-11-20:bytes' });
    expect(counter(keys.files)).toBe(2);
    expect(counter(keys.bytes)).toBe(5 * MB);
    expect(redis.get(keys.files)?.ttl).toBe(2 * 24 * 3600);
    expect([...redis.keys()].every((k) => k.startsWith('adjuntos:dia:'))).toBe(true);
  });

  it(`tope diario de ${DAILY_MAX_FILES} archivos: el siguiente recibe 429 daily_limit`, async () => {
    const keys = dayKeys();
    redis.set(keys.files, { value: String(DAILY_MAX_FILES - 1) });
    expect((await call(permit())).statusCode).toBe(200);
    const res = await call(permit());
    expect(res.statusCode).toBe(429);
    expect(codeOf(res)).toBe('daily_limit');
    expect(handleUploadPresigned).toHaveBeenCalledTimes(1);
  });

  it('tope diario de 1 GB declarado: 429 daily_limit', async () => {
    redis.set(dayKeys().bytes, { value: String(DAILY_MAX_BYTES - MB) });
    expect((await call(permit({ size: MB }))).statusCode).toBe(200);
    const res = await call(permit({ size: 1 }));
    expect(res.statusCode).toBe(429);
    expect(codeOf(res)).toBe('daily_limit');
  });

  it('techo de lo guardado en Blob (unos 8 GB): no hay permiso y no se suma nada', async () => {
    expect(STORED_CEILING_BYTES).toBe(8 * 1024 ** 3);
    redis.set(STORED_BYTES_KEY, { value: String(STORED_CEILING_BYTES) });
    const res = await call(permit());
    expect(res.statusCode).toBe(429);
    expect(codeOf(res)).toBe('daily_limit');
    expect(redis.has(dayKeys().files)).toBe(false);
    expect(handleUploadPresigned).not.toHaveBeenCalled();
    redis.set(STORED_BYTES_KEY, { value: String(STORED_CEILING_BYTES - 1) });
    expect((await call(permit())).statusCode).toBe(200);
  });

  it.each([
    ['Redis no responde', () => { fake.down = true; }],
    ['Redis responde 500', () => { vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 }))); }],
    ['Redis sin configurar', () => { vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); }],
  ])('%s: 503 unavailable, sin permiso', async (_name, breakRedis) => {
    breakRedis();
    const res = await call(permit());
    expect(res.statusCode).toBe(503);
    expect(codeOf(res)).toBe('unavailable');
    expect(handleUploadPresigned).not.toHaveBeenCalled();
  });

  it('sin almacén Blob (todavía no existe): 503 unavailable, sin tocar Redis', async () => {
    vi.stubEnv('BLOB_STORE_ID', '');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const res = await call(permit());
    expect(res.statusCode).toBe(503);
    expect(codeOf(res)).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('presignado sin BLOB_WEBHOOK_PUBLIC_KEY, o token de cliente sin BLOB_READ_WRITE_TOKEN: 503', async () => {
    vi.stubEnv('BLOB_WEBHOOK_PUBLIC_KEY', '');
    expect((await call(permit())).statusCode).toBe(503);
    vi.stubEnv('BLOB_WEBHOOK_PUBLIC_KEY', 'clave');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect((await call(permit({ type: CLIENT_TOKEN_EVENT }))).statusCode).toBe(503);
    expect((await call(permit())).statusCode).toBe(200);
  });

  it('si el SDK de Blob falla: 503 unavailable y el log no lleva la ruta', async () => {
    vi.mocked(handleUploadPresigned).mockRejectedValue(new Error(`Vercel Blob: falla cotizador/${UUID}.pdf`));
    const res = await call(permit());
    expect(res.statusCode).toBe(503);
    expect(codeOf(res)).toBe('unavailable');
    expect(logged()).toContain('Permiso FAIL | pdf | Error');
    expect(logged()).not.toContain(UUID);
  });

  it('los logs llevan la extensión y el motivo, nunca la ruta', async () => {
    await call(permit());
    redis.set(dayKeys().files, { value: String(DAILY_MAX_FILES) });
    await call(permit());
    const text = logged();
    expect(text).toContain('Permiso OK | pdf | presignado');
    expect(text).toContain('Permiso negado: daily_limit');
    expect(text).not.toContain(UUID);
  });

  describe('consulta previa (elights.upload-status)', () => {
    it('hay espacio: available true, sin sumar a los topes', async () => {
      const res = await call(status(3, 12 * MB));
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ available: true });
      expect(redis.size).toBe(0);
      expect(handleUploadPresigned).not.toHaveBeenCalled();
    });

    it('si no caben hoy (archivos, bytes o techo): available false con daily_limit', async () => {
      redis.set(dayKeys().files, { value: String(DAILY_MAX_FILES - 2) });
      expect((await call(status(2, MB))).body).toEqual({ available: true });
      expect((await call(status(3, MB))).body).toEqual({ available: false, code: 'daily_limit' });
      redis.set(dayKeys().files, { value: '0' });
      redis.set(dayKeys().bytes, { value: String(DAILY_MAX_BYTES - 5 * MB) });
      expect((await call(status(1, 6 * MB))).body).toEqual({ available: false, code: 'daily_limit' });
      redis.set(dayKeys().bytes, { value: '0' });
      redis.set(STORED_BYTES_KEY, { value: String(STORED_CEILING_BYTES) });
      expect((await call(status(1, MB))).body).toEqual({ available: false, code: 'daily_limit' });
    });

    it('sin almacén o con Redis caído: available false con unavailable', async () => {
      fake.down = true;
      expect((await call(status(1, MB))).body).toEqual({ available: false, code: 'unavailable' });
      vi.stubEnv('BLOB_STORE_ID', '');
      vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
      expect((await call(status(1, MB))).body).toEqual({ available: false, code: 'unavailable' });
    });

    it('cantidades fuera de rango: 400', async () => {
      for (const body of [status(0, MB), status(6, MB), status(1, 0), status(1, 101 * MB), { type: STATUS_EVENT, payload: {} }]) {
        expect((await call(body)).statusCode).toBe(400);
      }
    });

    it('tiene su propio límite por IP (15 por hora) y no gasta los permisos', async () => {
      const ip = '203.0.113.77';
      for (let i = 0; i < 15; i++) expect((await call(status(1, MB), { ip })).statusCode).toBe(200);
      expect((await call(status(1, MB), { ip })).statusCode).toBe(429);
      expect((await call(permit(), { ip })).statusCode).toBe(200);
    });
  });
});
