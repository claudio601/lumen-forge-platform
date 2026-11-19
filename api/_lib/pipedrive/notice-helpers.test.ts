// api/_lib/pipedrive/notice-helpers.test.ts
// Lo que el aviso de despacho (spec Nivel 2, §3, §4.3 y §9 «Tocar») agrega a api/_lib/pipedrive/:
// pipedriveGetBinary (tope de bytes y de tiempo), `timeoutMs` en POST y PUT, getDeal,
// listDealFiles y listDealNotes (paginados), createDealNote, putDealFields (con null), getPerson,
// createAttentionTask, findStageByName y refreshDealFieldsByName. fetch simulado: nada sale a
// Pipedrive. Los registros llevan método, ruta, código y categoría; nunca el token, la URL ni datos
// del cliente (regla de la #196).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BINARY_MAX_TIMEOUT_MS, pipedriveGetBinary, pipedrivePost, pipedrivePut } from './client';
import { createDealNote, DEAL_NOTES_SORT, getDeal, listDealFiles, listDealNotes, putDealFields } from './deals';
import { getPerson } from './persons';
import { createAttentionTask } from './activities';
import { findDealFieldByName, findStageByName, refreshDealFieldsByName, resetFieldOptionsCache } from './fieldOptions';

const TOKEN = 'token-de-prueba-xyz';
const NAME = 'Persona Ficticia';
const EMAIL = 'persona.ficticia@example.com';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = () => vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][];
const urlOf = (i: number) => new URL(calls()[i][0]);
const logged = () => [console.log, console.warn, console.error].flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');

/** fetch que no responde hasta que lo cortan (como un Pipedrive colgado). */
const hangingFetch = () =>
  vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  }));

beforeEach(() => {
  resetFieldOptionsCache();
  vi.stubEnv('PIPEDRIVE_API_TOKEN', TOKEN);
  vi.stubEnv('PIPEDRIVE_BASE_URL', 'https://pipedrive.example/v1');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const text = logged();
  for (const secret of [TOKEN, 'api_token', 'pipedrive.example', NAME, EMAIL, 'factura-secreta.pdf']) expect(text, secret).not.toContain(secret);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetFieldOptionsCache();
});

describe('pipedriveGetBinary', () => {
  it('descarga los bytes (en varios trozos), con el token en la URL y sin registrarla', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.enqueue(new Uint8Array([4, 5])); c.close(); },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })));
    const res = await pipedriveGetBinary('/files/77/download', 10, 5_000);
    expect(res).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(urlOf(0).pathname).toBe('/v1/files/77/download');
    expect(urlOf(0).searchParams.get('api_token')).toBe(TOKEN);
    expect(calls()[0][1].redirect).toBe('follow');
  });

  it('404 (borrado entre la lista y la descarga): not_found; otro código: http', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`no existe factura-secreta.pdf de ${NAME}`, { status: 404 })));
    expect(await pipedriveGetBinary('/files/77/download', 10, 5_000)).toEqual({ ok: false, reason: 'not_found', status: 404 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 502 })));
    expect(await pipedriveGetBinary('/files/77/download', 10, 5_000)).toEqual({ ok: false, reason: 'http', status: 502 });
    expect(logged()).toContain('[Pipedrive] GET /files/77/download -> HTTP 502');
  });

  it('pasa el tope: too_big, por Content-Length (sin leer) o al leer el cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(20), { status: 200, headers: { 'Content-Length': '20' } })));
    expect(await pipedriveGetBinary('/files/77/download', 10, 5_000)).toEqual({ ok: false, reason: 'too_big' });
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(8)); },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(endless, { status: 200 })));
    expect(await pipedriveGetBinary('/files/77/download', 10, 5_000)).toEqual({ ok: false, reason: 'too_big' });
    expect(cancelled).toBe(true);
    expect(logged()).toContain('-> TOO_BIG');
  });

  it('corta al plazo de quien llama (timeout) y nunca espera más de 15 s', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const started = Date.now();
    expect(await pipedriveGetBinary('/files/77/download', 10, 30)).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(BINARY_MAX_TIMEOUT_MS).toBe(15_000);
    const spy = vi.spyOn(globalThis, 'setTimeout');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(1))));
    await pipedriveGetBinary('/files/77/download', 10, 60_000);
    expect(spy.mock.calls.some((c) => c[1] === 15_000)).toBe(true);
  });

  it('error de red con la URL en el mensaje: network, sin registrar la URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed https://pipedrive.example/v1/files/77/download?api_token=${TOKEN}`); }));
    expect(await pipedriveGetBinary('/files/77/download', 10, 5_000)).toEqual({ ok: false, reason: 'network' });
    expect(logged()).toContain('-> FETCH_ERROR (TypeError)');
  });
});

describe('timeoutMs en pipedrivePost y pipedrivePut', () => {
  it('cortan al plazo de quien llama, no a los 15 s fijos', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const started = Date.now();
    expect(await pipedrivePost('/notes', { content: 'x', deal_id: 1 }, undefined, 30)).toMatchObject({ success: false, error: 'Request timeout' });
    expect(await pipedrivePut('/deals/1', { a: null }, undefined, 30)).toMatchObject({ success: false, error: 'Request timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('deals: lecturas y escrituras del aviso', () => {
  it('getDeal: el negocio; 404 o borrado → not_found; otra falla → failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { id: 5, status: 'open', title: NAME } })));
    expect(await getDeal(5, 1_000)).toEqual({ ok: true, deal: { id: 5, status: 'open', title: NAME } });
    expect(urlOf(0).pathname).toBe('/v1/deals/5');
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 404)));
    expect(await getDeal(5, 1_000)).toEqual({ ok: false, reason: 'not_found' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { id: 5, status: 'deleted' } })));
    expect(await getDeal(5, 1_000)).toEqual({ ok: false, reason: 'not_found' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 500)));
    expect(await getDeal(5, 1_000)).toEqual({ ok: false, reason: 'failed' });
  });

  it('listDealFiles: todas las páginas, del más nuevo al más antiguo', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ success: true, data: [{ id: 3 }, { id: 2 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 100 } } }))
      .mockResolvedValueOnce(json({ success: true, data: [{ id: 1 }], additional_data: { pagination: { more_items_in_collection: false } } })));
    const res = await listDealFiles(5, { deadline: Date.now() + 5_000 });
    expect(res).toEqual({ ok: true, files: [{ id: 3 }, { id: 2 }, { id: 1 }], complete: true });
    expect(urlOf(0).pathname).toBe('/v1/deals/5/files');
    expect(Object.fromEntries(urlOf(0).searchParams)).toMatchObject({ sort: 'id DESC', start: '0', limit: '100' });
    expect(urlOf(1).searchParams.get('start')).toBe('100');
  });

  it('listDealFiles: una página que falla o un plazo vencido → ok: false; sin archivos, lista vacía', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ success: true, data: [{ id: 3 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 100 } } }))
      .mockResolvedValueOnce(json({ success: false }, 500)));
    expect(await listDealFiles(5, { deadline: Date.now() + 5_000 })).toEqual({ ok: false });
    expect(await listDealFiles(5, { deadline: Date.now() - 1 })).toEqual({ ok: false });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: null })));
    expect(await listDealFiles(5, { deadline: Date.now() + 5_000 })).toEqual({ ok: true, files: [], complete: true });
  });

  it('listDealNotes: por negocio, ordenadas como findNoteByRef, de a 50', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: [{ id: 9, content: 'x' }] })));
    expect(await listDealNotes(5, { deadline: Date.now() + 5_000 })).toEqual({ ok: true, notes: [{ id: 9, content: 'x' }], complete: true });
    expect(urlOf(0).pathname).toBe('/v1/notes');
    expect(Object.fromEntries(urlOf(0).searchParams)).toMatchObject({ deal_id: '5', sort: DEAL_NOTES_SORT, limit: '50' });
    expect(DEAL_NOTES_SORT).toBe('add_time DESC, id DESC');
  });

  it('createDealNote devuelve si quedó (y su id); sin registrar el contenido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { id: 44 } })));
    expect(await createDealNote(5, `Nota de ${NAME}`, 1_000)).toEqual({ ok: true, noteId: 44 });
    expect(JSON.parse(String(calls()[0][1].body))).toEqual({ content: `Nota de ${NAME}`, deal_id: 5 });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 500)));
    expect(await createDealNote(5, `Nota de ${NAME}`, 1_000)).toEqual({ ok: false, error: 'HTTP 500' });
    expect(logged()).toContain('createDealNote failed dealId=5 error=HTTP 500');
  });

  it('putDealFields manda los null tal cual (vacía el campo) y no llama con un cuerpo vacío', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { id: 5 } })));
    expect(await putDealFields(5, { abc: null, def: 'x', stage_id: 25 }, 1_000)).toEqual({ ok: true });
    expect(calls()[0][1].method).toBe('PUT');
    expect(JSON.parse(String(calls()[0][1].body))).toEqual({ abc: null, def: 'x', stage_id: 25 });
    expect(await putDealFields(5, {}, 1_000)).toEqual({ ok: true });
    expect(calls()).toHaveLength(1);
    vi.stubGlobal('fetch', hangingFetch());
    expect(await putDealFields(5, { abc: null }, 20)).toEqual({ ok: false, error: 'TIMEOUT' });
  });
});

describe('getPerson', () => {
  it('la persona; 404 o borrada → not_found; otra falla → failed; sin registrar el nombre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { id: 61, name: NAME, email: [{ value: EMAIL }], active_flag: true } })));
    expect(await getPerson(61, 1_000)).toMatchObject({ ok: true, person: { id: 61, name: NAME } });
    expect(urlOf(0).pathname).toBe('/v1/persons/61');
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: NAME }, 404)));
    expect(await getPerson(61, 1_000)).toEqual({ ok: false, reason: 'not_found' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { id: 61, name: NAME, active_flag: false } })));
    expect(await getPerson(61, 1_000)).toEqual({ ok: false, reason: 'not_found' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 503)));
    expect(await getPerson(61, 1_000)).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('createAttentionTask', () => {
  it('tarea para el dueño, que vence ahora, con la nota escapada y el plazo de quien llama', async () => {
    vi.stubEnv('PIPEDRIVE_ACTIVITY_TYPE', 'task');
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { id: 700 } })));
    const res = await createAttentionTask({
      dealId: 5, personId: 61, userId: 9001, subject: 'ATENCIÓN aviso de despacho', note: 'Línea 1 <b>\nLínea 2 & más', timeoutMs: 1_000,
      now: new Date('2026-11-18T15:04:00Z'),
    });
    expect(res).toEqual({ ok: true, activityId: 700 });
    expect(urlOf(0).pathname).toBe('/v1/activities');
    expect(JSON.parse(String(calls()[0][1].body))).toEqual({
      subject: 'ATENCIÓN aviso de despacho', type: 'task', due_date: '2026-11-18', due_time: '15:04',
      deal_id: 5, person_id: 61, user_id: 9001, note: 'Línea 1 &lt;b&gt;<br>Línea 2 &amp; más', done: 0,
    });
  });

  it('nunca lanza: una falla devuelve ok: false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 500)));
    expect(await createAttentionTask({ dealId: 5, userId: 9001, subject: 's', note: 'n', timeoutMs: 1_000 })).toEqual({ ok: false, error: 'HTTP 500' });
  });
});

describe('findStageByName (etapa por nombre en el embudo del negocio)', () => {
  const STAGES = [
    { id: 24, name: 'Despachado', pipeline_id: 1, active_flag: true },
    { id: 20, name: 'Ganado pagado', pipeline_id: 1, active_flag: true },
    { id: 90, name: 'Despachado', pipeline_id: 1, active_flag: false },
    { id: 25, name: 'Despachado', pipeline_id: 2, active_flag: true },
  ];
  const stagesFetch = () => vi.fn(async (url: string) => {
    const pipeline = Number(new URL(url).searchParams.get('pipeline_id'));
    return json({ success: true, data: STAGES.filter((s) => s.pipeline_id === pipeline || pipeline === 1) });
  });

  it('cada embudo da su etapa (sin las inactivas ni las de otro embudo), con caché', async () => {
    vi.stubGlobal('fetch', stagesFetch());
    expect(await findStageByName(1, 'Despachado')).toEqual({ status: 'ok', stageId: 24 });
    expect(await findStageByName(2, 'Despachado')).toEqual({ status: 'ok', stageId: 25 });
    expect(await findStageByName(1, 'Despachado')).toEqual({ status: 'ok', stageId: 24 });
    expect(calls()).toHaveLength(2);
    expect(urlOf(0).searchParams.get('pipeline_id')).toBe('1');
  });

  it('un embudo sin esa etapa: missing; dos con el mismo nombre: duplicate; un id inválido no consulta', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const pipeline = Number(new URL(url).searchParams.get('pipeline_id'));
      return json({ success: true, data: pipeline === 3 ? [{ id: 30, name: 'Instalación', pipeline_id: 3 }] : [{ id: 1, name: 'Despachado', pipeline_id: 4 }, { id: 2, name: 'Despachado', pipeline_id: 4 }] });
    }));
    expect(await findStageByName(3, 'Despachado')).toEqual({ status: 'missing' });
    expect(await findStageByName(4, 'Despachado')).toEqual({ status: 'duplicate' });
    expect(await findStageByName(0, 'Despachado')).toEqual({ status: 'missing' });
    expect(calls()).toHaveLength(2);
  });

  it('si /stages falla: unavailable, sin guardar la falla como resultado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ success: false }, 500)).mockImplementation(async () => json({ success: true, data: STAGES })));
    expect(await findStageByName(2, 'Despachado')).toEqual({ status: 'unavailable' });
    expect(await findStageByName(2, 'Despachado')).toEqual({ status: 'ok', stageId: 25 });
  });
});

describe('refreshDealFieldsByName', () => {
  it('vuelve a consultar /dealFields aunque la caché esté vigente (una opción recién agregada)', async () => {
    const fields = (labels: string[]) => [{ key: 'k'.repeat(40), name: 'Despacho · Operador', field_type: 'enum', options: labels.map((label, i) => ({ id: i + 1, label })) }];
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ success: true, data: fields(['Starken']) }))
      .mockResolvedValueOnce(json({ success: true, data: fields(['Starken', 'Transportes Mena']) })));
    const before = await findDealFieldByName('Despacho · Operador');
    expect(before.status === 'ok' && before.field.options).toHaveLength(1);
    expect(await refreshDealFieldsByName({ timeoutMs: 1_000 })).toBe(true);
    const after = await findDealFieldByName('Despacho · Operador');
    expect(after.status === 'ok' && after.field.options).toHaveLength(2);
    expect(calls()).toHaveLength(2);
  });
});
