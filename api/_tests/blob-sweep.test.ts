// api/_tests/blob-sweep.test.ts
// Barrido diario de los adjuntos (GET /api/cron/blob-sweep): 401 sin el secreto del cron,
// borra lo de 23 h o más, pagina, deja en Redis el total guardado (techo de D2, con lo que no
// pudo borrar), y recién después reintenta los archivos pendientes (ruta → negocio), con lo
// que quede de tiempo. Candado contra llamadas dobles del cron, y avisos a ventas al llegar al
// techo, si un reintento falla, si algo no se borró, si Redis no guardó el total o si el
// barrido falla. Blob, Pipedrive y el relay están simulados; Redis es un Upstash falso.
// Vive en api/_tests/ para que Vercel no lo despliegue como función.

import { readFileSync } from 'node:fs';
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

import handler, { DELETE_AFTER_MS, MAX_RETRIES_PER_RUN, MIN_RETRY_WINDOW_MS, SWEEP_MAX_DURATION_S, retryFileName } from '../cron/blob-sweep';
import { BlobNotFoundError, del, get, head, list } from '@vercel/blob';
import { pipedrivePost, pipedriveUploadFile } from '../_lib/pipedrive/client.js';
import { STORED_BYTES_KEY, STORED_CEILING_BYTES, SWEEP_LOCK_KEY, pendingKey } from '../_lib/attachments/quota';
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

  it('lista cotizador/ y borra lo de 23 h o más; deja el total que queda en Redis', async () => {
    const young = [blob(1, { size: 3 * MB }), blob(22.9, { size: 2 * MB })];
    const old = [blob(23.1), blob(47)];
    files = [...young, ...old];
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'cotizador/' }));
    expect(deleted().sort()).toEqual(old.map((f) => f.url).sort());
    expect(res.body).toMatchObject({ ok: true, listed: 4, deleted: 2, undeleted: 0, retried: 0, storedBytes: 5 * MB, ceilingReached: false });
    expect(fake.value(STORED_BYTES_KEY)).toBe(5 * MB);
    expect(fake.data.get(STORED_BYTES_KEY)?.ttl).toBe(3 * 24 * 3600);
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(fake.mails).toHaveLength(0);
  });

  it('23 h: con la hora variable del cron de Hobby (de 09:00 a 09:59 UTC), un huérfano vive menos de 48 h', () => {
    expect(DELETE_AFTER_MS).toBe(23 * HOUR);
    // Subido justo después de un barrido a las 09:00; el siguiente corre a las 09:00 (tiene casi
    // 24 h: se borra); en el peor caso sobrevive uno de 22 h 59 min, y el barrido siguiente puede
    // correr hasta 24 h 59 min después
    expect(DELETE_AFTER_MS + (24 * HOUR + 59 * 60_000)).toBeLessThan(48 * HOUR);
  });

  it('maxDuration del barrido en vercel.json = SWEEP_MAX_DURATION_S', () => {
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf-8')) as {
      functions?: Record<string, { maxDuration?: number }>;
    };
    expect(vercel.functions?.['api/cron/blob-sweep.ts']?.maxDuration).toBe(SWEEP_MAX_DURATION_S);
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
    // El total se guarda antes de reintentar: cuenta el archivo (de más, nunca de menos)
    expect(res.body).toMatchObject({ retried: 1, deleted: 0, storedBytes: 2 * MB });
    expect(pipedriveUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 555, fileName: retryFileName(stuck.pathname, 'pdf'), contentType: 'application/pdf' })
    );
    expect(retryFileName(stuck.pathname, 'pdf')).toBe('archivo-3f2b8c1e.pdf');
    expect(deleted()).toEqual([stuck.url]);
    expect(fake.value(pendingKey(stuck.pathname))).toBe(0); // ya no se reintenta
    const [note] = notes();
    expect(note.deal_id).toBe(555);
    expect(note.content).toContain('Barrido diario de adjuntos');
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

  it(`hasta ${MAX_RETRIES_PER_RUN} reintentos por barrido; un pendiente de 23 h o más se borra sin reintento y la nota lo dice`, async () => {
    const stuck = [blob(2), blob(3), blob(4), blob(5), blob(30)];
    files = stuck;
    for (const f of stuck) fake.data.set(pendingKey(f.pathname), { value: '888' });
    const res = await call();
    expect(pipedriveUploadFile).toHaveBeenCalledTimes(MAX_RETRIES_PER_RUN);
    // El de 5 h queda (el barrido siguiente lo borra con su nota); el de 30 h se borra primero
    expect(res.body).toMatchObject({ retried: 3, deleted: 1, storedBytes: 4 * MB });
    expect(deleted()[0]).toBe(stuck[4].url);
    const [note] = notes();
    expect(notes()).toHaveLength(1);
    expect(note.content).toContain('Adjuntos: 3 de 4 quedaron en Archivos.');
    expect(note.content).toContain('quedó pendiente y venció antes de poder reintentarlo');
    // El vencido queda terminado: su nota no se repite mañana aunque su borrado fallara
    expect(fake.value(pendingKey(stuck[4].pathname))).toBe(0);
    expect(fake.value(pendingKey(stuck[3].pathname))).toBe(888);
  });

  it('el borrado y el total van antes de los reintentos, y Pipedrive recibe solo lo que queda hasta el plazo', async () => {
    const old = blob(30, { size: 4 * MB });
    const stuck = blob(3, { size: 2 * MB });
    files = [old, stuck];
    fake.data.set(pendingKey(stuck.pathname), { value: '555' });
    const startedAt = Date.now();
    vi.mocked(get).mockImplementation(async (pathname: string) => {
      vi.setSystemTime(Date.now() + 15_000); // Blob lento
      return { statusCode: 200, stream: stream(contents.get(pathname) ?? PDF), headers: new Headers(), blob: {} } as never;
    });
    let seenBeforeUpload: { deletedOld: boolean; total: number } | null = null;
    vi.mocked(pipedriveUploadFile).mockImplementation(async () => {
      seenBeforeUpload = { deletedOld: deleted().includes(old.url), total: fake.value(STORED_BYTES_KEY) };
      return { success: true, data: { id: 9 } } as never;
    });
    await call();
    expect(seenBeforeUpload).toEqual({ deletedOld: true, total: 2 * MB });
    const [{ timeoutMs }] = vi.mocked(pipedriveUploadFile).mock.calls[0];
    // Plazo: 60 s del maxDuration menos 10 s de margen, menos los 15 s que tardó Blob
    expect(timeoutMs).toBeLessThanOrEqual(SWEEP_MAX_DURATION_S * 1000 - 10_000 - 15_000);
    expect(timeoutMs).toBeGreaterThan(0);
    expect(Date.now() - startedAt).toBeLessThan(SWEEP_MAX_DURATION_S * 1000);
  });

  it(`un reintento empieza solo si quedan ${MIN_RETRY_WINDOW_MS / 1000} s; sin tiempo después de leer, el archivo queda pendiente`, async () => {
    const first = blob(2);
    const second = blob(3);
    files = [first, second];
    for (const f of files) fake.data.set(pendingKey(f.pathname), { value: '555' });
    vi.mocked(get).mockImplementation(async (pathname: string) => {
      vi.setSystemTime(Date.now() + 41_000); // tras leer quedan menos de 10 s hasta el plazo
      return { statusCode: 200, stream: stream(contents.get(pathname) ?? PDF), headers: new Headers(), blob: {} } as never;
    });
    const res = await call();
    expect(res.body).toMatchObject({ retried: 1 });
    expect(get).toHaveBeenCalledTimes(1); // el segundo no empieza: ya no quedan 30 s
    expect(pipedriveUploadFile).not.toHaveBeenCalled(); // no alcanzaba: no se arriesga a cortarse a mitad
    expect(del).not.toHaveBeenCalled();
    expect(fake.value(pendingKey(first.pathname))).toBe(555); // lo borra el barrido siguiente, con su nota
    expect(notes()).toHaveLength(0);
  });

  it('las claves «pendiente» se leen con MGET de a 50, no de a una', async () => {
    files = Array.from({ length: 120 }, () => blob(3));
    await call();
    const commands = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname.split('/')[1]);
    expect(commands.filter((c) => c === 'MGET')).toHaveLength(3);
    expect(commands.filter((c) => c === 'GET')).toHaveLength(0);
  });

  it('candado: una llamada repetida del cron mientras corre la primera no hace nada', async () => {
    files = [blob(30)];
    fake.data.set(SWEEP_LOCK_KEY, { value: '1', ttl: 300 });
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, skipped: 'running' });
    expect(list).not.toHaveBeenCalled();
    fake.data.delete(SWEEP_LOCK_KEY);
    await call();
    expect(fake.data.get(SWEEP_LOCK_KEY)?.ttl).toBe(300);
    expect(deleted()).toHaveLength(1);
  });

  it('lo que no se pudo borrar suma al total (el techo lo ve) y un correo a ventas lo dice', async () => {
    const old = blob(30, { size: 7 * MB });
    files = [old, blob(2, { size: MB })];
    vi.mocked(del).mockRejectedValue(new Error('Vercel Blob: falla'));
    const res = await call();
    expect(res.body).toMatchObject({ deleted: 0, undeleted: 1, storedBytes: 8 * MB });
    expect(fake.value(STORED_BYTES_KEY)).toBe(8 * MB);
    expect(fake.mails).toHaveLength(1);
    expect(fake.mails[0].items_lista).toContain('No se pudieron borrar 1 archivo(s) de más de 23 horas');
  });

  it('si Redis no guarda el total, el barrido borra igual y un correo a ventas lo dice', async () => {
    const old = blob(30);
    files = [old];
    fake.down = true;
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(deleted()).toEqual([old.url]);
    expect(fake.mails).toHaveLength(1);
    expect(fake.mails[0].items_lista).toContain('Redis (Upstash) no guardó el total');
    expect(fake.mails[0].items_lista).not.toMatch(/whatsapp|\+56/i);
  });

  it('un archivo de menos de 1 hora no se reintenta (su traspaso puede estar en curso)', async () => {
    const recent = blob(0.5);
    files = [recent];
    fake.data.set(pendingKey(recent.pathname), { value: '555' });
    await call();
    expect(pipedriveUploadFile).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('al llegar al techo (700 MB guardados) avisa a ventas; el permiso lo lee de Redis', async () => {
    files = [blob(2, { size: STORED_CEILING_BYTES - MB }), blob(3, { size: MB }), blob(30, { size: 5 * MB })];
    const res = await call();
    expect(res.body).toMatchObject({ ceilingReached: true, storedBytes: STORED_CEILING_BYTES });
    expect(fake.value(STORED_BYTES_KEY)).toBe(STORED_CEILING_BYTES);
    expect(fake.mails).toHaveLength(1);
    const [mail] = fake.mails;
    expect(mail.items_lista).toContain('ALERTA: el almacenamiento temporal de archivos del cotizador tiene 700 MB (techo: 700 MB).');
    expect(mail.items_lista).toContain('el sitio no recibe archivos adjuntos');
    expect(mail.items_lista).toContain('ventas@elights.cl');
    expect(mail.items_lista).not.toMatch(/whatsapp|\+56/i);
    expect(mail.modo_precio).toBe('Aviso del sitio: archivos adjuntos');
  });

  it('si list() falla: 500 sin borrar nada, y un correo a ventas lo dice', async () => {
    vi.mocked(list).mockRejectedValue(new Error('Vercel Blob: store suspended'));
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(del).not.toHaveBeenCalled();
    expect(fake.mails).toHaveLength(1);
    expect(fake.mails[0].items_lista).toContain('ALERTA: el barrido diario de archivos adjuntos falló (Error).');
    expect(fake.mails[0].to_email).toBe('ventas@elights.cl');
    expect(fake.mails[0].items_lista).not.toContain('store suspended');
  });

  it('los logs llevan cantidades y pesos, nunca rutas', async () => {
    const stuck = blob(3);
    files = [stuck, blob(30), blob(1)];
    fake.data.set(pendingKey(stuck.pathname), { value: '555' });
    vi.mocked(del).mockRejectedValueOnce(new Error(`Vercel Blob: falla ${stuck.pathname}`));
    await call();
    const text = logged();
    expect(text).toContain('[BlobSweep] Listados: 3 | borrados: 0 | sin borrar: 1 | reintentos: 1');
    expect(text).not.toContain('cotizador/');
    expect(text).not.toContain('3f2b8c1e');
  });
});
