// api/_lib/pipedrive/client.test.ts
// pipedriveUploadFile (adjuntos del cotizador): POST /v1/files en multipart con `file` y
// `deal_id`, sin fijar el Content-Type, con 60 s de tiempo límite. Nunca lanza, y el log
// nunca lleva el nombre del archivo. fetch está simulado: no sale nada a Pipedrive.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pipedriveUploadFile } from './client';

const FILE_NAME = 'Plano Juan Pérez.dwg';
const DWG = new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x33, 0x32]);
const upload = (extra: Partial<Parameters<typeof pipedriveUploadFile>[0]> = {}) =>
  pipedriveUploadFile({ dealId: 999, fileName: FILE_NAME, contentType: 'image/vnd.dwg', data: DWG, ...extra });

const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 77, deal_id: 999 } }), { status: 201 }));
const calls = () => vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][];
const logged = () =>
  [console.log, console.warn, console.error].flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');

describe('pipedriveUploadFile', () => {
  beforeEach(() => {
    vi.stubEnv('PIPEDRIVE_API_TOKEN', 'token-de-prueba');
    vi.stubEnv('PIPEDRIVE_BASE_URL', 'https://pipedrive.example/v1');
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

  it('POST /files en multipart con file (nombre y tipo) y deal_id', async () => {
    vi.stubGlobal('fetch', okFetch());
    const res = await upload();
    expect(res).toEqual({ success: true, data: { id: 77, deal_id: 999 } });
    const [[url, init]] = calls();
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://pipedrive.example/v1/files');
    expect(parsed.searchParams.get('api_token')).toBe('token-de-prueba');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('deal_id')).toBe('999');
    const file = form.get('file') as File;
    expect(file.name).toBe(FILE_NAME);
    expect(file.type).toBe('image/vnd.dwg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(DWG);
  });

  it('no fija el Content-Type (fetch arma el multipart con su boundary)', async () => {
    vi.stubGlobal('fetch', okFetch());
    await upload();
    const headers = new Headers(calls()[0][1].headers);
    expect(headers.has('content-type')).toBe(false);
    expect(headers.get('accept')).toBe('application/json');
  });

  it('acepta un Blob ya armado', async () => {
    vi.stubGlobal('fetch', okFetch());
    await upload({ data: new Blob([DWG], { type: 'image/vnd.dwg' }) });
    const file = (calls()[0][1].body as FormData).get('file') as File;
    expect(file.size).toBe(DWG.byteLength);
  });

  it('tiempo límite de 60 s: aborta y devuelve "Request timeout", sin lanzar', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          })
      )
    );
    const pending = upload();
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ success: false, data: null, error: 'Request timeout' });
    expect(logged()).toContain('[Pipedrive] POST /files -> TIMEOUT | dealId: 999');
  });

  it('un error HTTP devuelve success: false sin lanzar, y el log no lleva el nombre ni la respuesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`File "${FILE_NAME}" is too large`, { status: 413, statusText: 'Payload Too Large' }))
    );
    const res = await upload();
    expect(res).toMatchObject({ success: false, data: null, error: 'HTTP 413: Payload Too Large' });
    expect(res.error_info).toBe('File "[archivo]" is too large');
    expect(logged()).toContain('[Pipedrive] POST /files -> 413 Payload Too Large | dealId: 999');
    expect(logged()).not.toContain('Plano');
    expect(logged()).not.toContain('too large');
  });

  it('success: false de la API, una red caída o sin token: success: false, sin lanzar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: `Bad file ${FILE_NAME}` }), { status: 200 })));
    expect(await upload()).toEqual({ success: false, data: null, error: 'Bad file [archivo]' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await upload()).toEqual({ success: false, data: null, error: 'fetch failed' });

    vi.stubEnv('PIPEDRIVE_API_TOKEN', '');
    vi.stubGlobal('fetch', okFetch());
    expect(await upload()).toMatchObject({ success: false, error: expect.stringContaining('PIPEDRIVE_API_TOKEN') });
    expect(fetch).not.toHaveBeenCalled();
    expect(logged()).not.toContain('Plano');
  });
});
