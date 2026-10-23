// api/_tests/blob-sweep.test.ts
// Barrido diario de los adjuntos (GET /api/cron/blob-sweep): 401 sin el secreto del cron,
// borra solo lo de más de 24 h, pagina, deja en Redis el total guardado (techo de D2),
// reintenta los archivos pendientes (ruta → negocio) y avisa a ventas al llegar al techo o si
// un reintento falla. Blob, Pipedrive y el relay están simulados; Redis es un Upstash falso.
// Vive en api/_tests/ para que Vercel no lo despliegue como función.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  list: vi.fn(),
  head: vi.fn(),
  get: vi.fn(),
  del: vi.fn(async () => {}),
}));
vi.mock('../_lib/pipedrive/client.js', () => ({ pipedrivePost: vi.fn(), pipedriveUploadFile: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

import handler, { DELETE_AFTER_MS, MAX_RETRIES_PER_RUN, retryFileName } from '../cron/blob-sweep';
import { BlobNotFoundError, del, get, head, list } from '@vercel/blob';
import { pipedrivePost, pipedriveUploadFile } from '../_lib/pipedrive/client.js';
import { STORED_BYTES_KEY, STORED_CEILING_BYTES, pendingKey } from '../_lib/attachments/quota';
import { UPSTASH_URL, createFakeRedis, fakeFetch, type FakeRedis } from './fakeUpstash';

const NOW = Date.parse('2026-11-20T09:00:00Z');
const HOUR = 3600_000;
const MB = 1024 * 1024;
const SECRET = 'secreto-de-prueba';
const PDF = new TextEncoder().encode('%PDF-1.7\n');

let seq = 0;
/** Un archivo en Blob subido hace `hours` horas. */
function blob(hours: number, { size = MB, ext = 'pdf' } = {}) {
  const n = String(++seq).padStart(12, '0');
  const pathname = `cotizador/3f2b8c1e-9a4d-4e6f-8b7a-${n}-sufijo.${ext}`;
  return { pathname, url: `https://store.private.blob.vercel-storage.com/${pathname}`, downloadUrl: '', size, uploadedAt: new Date(NOW - hours * HOUR), etag: 'e' };
}

let fake: FakeRedis;
let files: ReturnType<typeof blob>[];

function call({ method = 'GET', auth = `Bearer ${SECRET}` }: { method?: string; auth?: string | null } = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  const req = { method, headers: auth === null ? {} : { authorization: auth }, query: {} };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res).then(() => res);
}

/** Contenido que devuelve get() para cada ruta. */
let contents: Map<string, Uint8Array>;
const stream = (data: Uint8Array) => new Blob([data]).stream();
const deleted = () => vi.mocked(del).mock.calls.flatMap(([arg]) => (Array.isArray(arg) ? arg : [arg]));
const notes = () =>
  (vi.mocked(pipedrivePost).mock.calls as unknown as [string, { content: string; deal_id: number }][])
    .filter(([path]) => path === '/notes')
    .map(([, body]) => body);
const logged = () =>
  [console.log, console.warn, console.error].flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');

describe('GET /api/cron/blob-sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    seq = 0;
    files = [];
    contents = new Map();
    fake = createFakeRedis();
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('BLOB_STORE_ID', 'store_prueba');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-de-prueba');
    vi.stubGlobal('fetch', fakeFetch(fake));
    vi.mocked(list).mockReset().mockImplementation(async () => ({ blobs: files, hasMore: false }));
    vi.mocked(head).mockReset().mockImplementation(async (pathname: string) => {
      const f = files.find((x) => x.pathname === pathname);
      if (!f) throw new BlobNotFoundError();
      const ext = pathname.split('.').pop();
      return { ...f, contentType: ext === 'pdf' ? 'application/pdf' : 'image/vnd.dwg', contentDisposition: '', cacheControl: '' };
    });
    vi.mocked(get).mockReset().mockImplementation(async (pathname: string) => {
      const data = contents.get(pathname) ?? PDF;
      return { statusCode: 200, stream: stream(data), headers: new Headers(), blob: {} } as never;
    });
    vi.mocked(del).mockClear();
    vi.mocked(pipedrivePost).mockReset().mockResolvedValue({ success: true, data: { id: 1 } } as never);
    vi.mocked(pipedriveUploadFile).mockReset().mockResolvedValue({ success: true, data: { id: 9 } } as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ['sin cabecera', null],
    ['con otro secreto', 'Bearer otro'],
    ['sin Bearer', SECRET],
  ])('401 %s, sin listar nada', async (_name, auth) => {
    const res = await call({ auth });
    expect(res.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('sin CRON_SECRET configurado: 401 a todo', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call({ auth: 'Bearer ' })).statusCode).toBe(401);
    expect((await call({ auth: 'Bearer undefined' })).statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('solo GET (el cron de Vercel llama con GET)', async () => {
    const res = await call({ method: 'POST' });
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('sin almacén Blob: 200 sin hacer nada', async () => {
    vi.stubEnv('BLOB_STORE_ID', '');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, skipped: 'no_store' });
    expect(list).not.toHaveBeenCalled();
  });

  it('lista cotizador/ y borra solo lo de más de 24 h; deja el total que queda en Redis', async () => {
    const young = [blob(1, { size: 3 * MB }), blob(23.9, { size: 2 * MB })];
    const old = [blob(24.1), blob(47)];
    files = [...young, ...old];
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'cotizador/' }));
    expect(deleted().sort()).toEqual(old.map((f) => f.url).sort());
    expect(res.body).toMatchObject({ ok: true, listed: 4, deleted: 2, retried: 0, storedBytes: 5 * MB, ceilingReached: false });
    expect(fake.value(STORED_BYTES_KEY)).toBe(5 * MB);
    expect(fake.data.get(STORED_BYTES_KEY)?.ttl).toBe(3 * 24 * 3600);
    expect(DELETE_AFTER_MS).toBe(24 * HOUR);
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(fake.mails).toHaveLength(0);
  });

  it('pagina con el cursor de list()', async () => {
    const page1 = [blob(30), blob(2)];
    const page2 = [blob(40)];
    vi.mocked(list)
      .mockResolvedValueOnce({ blobs: page1, hasMore: true, cursor: 'c1' } as never)
      .mockResolvedValueOnce({ blobs: page2, hasMore: false } as never);
    const res = await call();
    expect(vi.mocked(list).mock.calls.map(([o]) => o?.cursor)).toEqual([undefined, 'c1']);
    expect(res.body).toMatchObject({ listed: 3, deleted: 2 });
    expect(deleted().sort()).toEqual([page1[0].url, page2[0].url].sort());
  });

  it('reintenta un archivo pendiente (ruta → negocio): lo pasa a Pipedrive, lo borra y deja una nota', async () => {
    const stuck = blob(3, { size: 2 * MB });
    files = [stuck];
    fake.data.set(pendingKey(stuck.pathname), { value: '555' });
    const res = await call();
    expect(res.body).toMatchObject({ retried: 1, deleted: 0, storedBytes: 0 });
    expect(pipedriveUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 555, fileName: retryFileName(stuck.pathname, 'pdf'), contentType: 'application/pdf' })
    );
    expect(retryFileName(stuck.pathname, 'pdf')).toBe('archivo-3f2b8c1e.pdf');
    expect(deleted()).toEqual([stuck.url]);
    expect(fake.value(pendingKey(stuck.pathname))).toBe(0); // ya no se reintenta
    const [note] = notes();
    expect(note.deal_id).toBe(555);
    expect(note.content).toContain('Reintento del barrido diario');
    expect(note.content).toContain('Adjuntos: 1 de 1 quedaron en Archivos.');
    expect(fake.mails).toHaveLength(0); // todo quedó: sin correo
  });

  it('un reintento que falla: se borra (D3), la nota dice cuál falta y un correo a ventas también', async () => {
    const bad = blob(5);
    files = [bad];
    fake.data.set(pendingKey(bad.pathname), { value: '777' });
    contents.set(bad.pathname, new TextEncoder().encode('MZ este es un .exe'));
    await call();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(deleted()).toEqual([bad.url]);
    const [note] = notes();
    expect(note.content).toContain('No se pudo adjuntar "archivo-3f2b8c1e.pdf" (no es un PDF válido). Pedirlo al cliente por correo.');
    expect(fake.mails).toHaveLength(1);
    expect(fake.mails[0].items_lista).toContain('Negocio 777 en Pipedrive:');
    expect(fake.mails[0].items_lista).toContain('no es un PDF válido');
    expect(fake.mails[0].to_email).toBe('ventas@elights.cl');
  });

  it(`hasta ${MAX_RETRIES_PER_RUN} reintentos por barrido; un pendiente de más de 24 h sin reintento se borra y la nota lo dice`, async () => {
    const stuck = [blob(2), blob(3), blob(4), blob(5), blob(30)];
    files = stuck;
    for (const f of stuck) fake.data.set(pendingKey(f.pathname), { value: '888' });
    const res = await call();
    expect(pipedriveUploadFile).toHaveBeenCalledTimes(MAX_RETRIES_PER_RUN);
    expect(res.body).toMatchObject({ retried: 3, deleted: 1, storedBytes: MB }); // el de 5 h espera al día siguiente
    const [note] = notes();
    expect(note.content).toContain('Adjuntos: 3 de 4 quedaron en Archivos.');
    expect(note.content).toContain('quedó pendiente y venció antes de poder reintentarlo');
  });

  it('un archivo de menos de 1 hora no se reintenta (su traspaso puede estar en curso)', async () => {
    const recent = blob(0.5);
    files = [recent];
    fake.data.set(pendingKey(recent.pathname), { value: '555' });
    await call();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('al llegar al techo (unos 8 GB guardados) avisa a ventas; el permiso lo lee de Redis', async () => {
    files = [blob(2, { size: STORED_CEILING_BYTES - MB }), blob(3, { size: MB }), blob(30, { size: 5 * MB })];
    const res = await call();
    expect(res.body).toMatchObject({ ceilingReached: true, storedBytes: STORED_CEILING_BYTES });
    expect(fake.value(STORED_BYTES_KEY)).toBe(STORED_CEILING_BYTES);
    expect(fake.mails).toHaveLength(1);
    const [mail] = fake.mails;
    expect(mail.items_lista).toContain('ALERTA: el almacenamiento temporal de archivos del cotizador tiene 8 GB (techo: 8 GB).');
    expect(mail.items_lista).toContain('el sitio no recibe archivos adjuntos');
    expect(mail.items_lista).toContain('ventas@elights.cl');
    expect(mail.items_lista).not.toMatch(/whatsapp|\+56/i);
    expect(mail.modo_precio).toBe('Aviso del sitio: archivos adjuntos');
  });

  it('si list() falla: 500 sin borrar nada', async () => {
    vi.mocked(list).mockRejectedValue(new Error('Vercel Blob: store suspended'));
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(del).not.toHaveBeenCalled();
  });

  it('los logs llevan cantidades y pesos, nunca rutas', async () => {
    const stuck = blob(3);
    files = [stuck, blob(30), blob(1)];
    fake.data.set(pendingKey(stuck.pathname), { value: '555' });
    vi.mocked(del).mockRejectedValueOnce(new Error(`Vercel Blob: falla ${stuck.pathname}`));
    await call();
    const text = logged();
    expect(text).toContain('[BlobSweep] Listados: 3 | borrados: 1 | reintentos: 1');
    expect(text).not.toContain('cotizador/');
    expect(text).not.toContain('3f2b8c1e');
  });
});
