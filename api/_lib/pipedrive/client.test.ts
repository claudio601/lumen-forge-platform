// api/_lib/pipedrive/client.test.ts
// pipedriveUploadFile (adjuntos del cotizador): POST /v1/files en multipart con `file` y
// `deal_id`, sin fijar el Content-Type, con 60 s de tiempo límite. Nunca lanza, y el log
// nunca lleva el nombre del archivo. fetch está simulado: no sale nada a Pipedrive.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pipedriveUploadFile, pipedriveGet, pipedrivePost, pipedrivePut, pipedriveDelete } from './client';

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

  it('el cliente general conserva respuestas para su consumidor y registra solo método, ruta, código y categoría', async () => {
    const privateText = 'Persona Ficticia 12.345.678-5 prueba@ejemplo.cl +56 9 1234 5678';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(privateText, { status: 400 })));
    const failed = await pipedriveGet('/persons/999');
    expect(failed.error_info).toBe(privateText);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: privateText }))));
    expect((await pipedriveGet('/persons/999')).error).toBe(privateText);
    const externalError = Object.assign(new Error(privateText), { response: { body: privateText } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw externalError; }));
    expect((await pipedriveGet('/persons/999')).error).toBe(privateText);
    // (auditoría de la #196) El registro ya no lleva el cuerpo ni el mensaje: un nombre no se
    // reconoce con regex, y el mensaje puede traer la URL con el token.
    for (const pii of ['Persona Ficticia', '12.345.678-5', 'prueba@ejemplo.cl', '+56 9 1234 5678', '[RUT]', '[correo]']) {
      expect(logged()).not.toContain(pii);
    }
    expect(logged()).toContain('[Pipedrive] GET /persons/999 -> HTTP 400');
    expect(logged()).toContain('[Pipedrive] GET /persons/999 -> API error');
    expect(logged()).toContain('[Pipedrive] GET /persons/999 -> FETCH_ERROR (Error)');
  });

  // Hallazgo 1 de la auditoría de Codex (#196): con el cliente real y solo `fetch` simulado, ni el
  // token ni la URL ni un nombre llegan a console.*, en ningún método ni camino de error. Tampoco el
  // token ni la URL vuelven en `error`/`error_info` (varios llamadores los registran).
  describe('privacidad de los registros (fetch simulado)', () => {
    const TOKEN = 'TOKEN_FICTICIO_abcdef';
    const NAME = 'Persona Inventada';
    const leakedUrl = () => `https://pipedrive.example/v1/persons/7?api_token=${TOKEN}&term=${encodeURIComponent(NAME)}`;
    const forbidden = [TOKEN, NAME, 'api_token', 'https://pipedrive.example', encodeURIComponent(NAME)];

    beforeEach(() => {
      vi.stubEnv('PIPEDRIVE_API_TOKEN', TOKEN);
    });

    const failures: Array<[string, () => unknown]> = [
      ['HTTP 401 con el nombre y la URL en el cuerpo', () => vi.fn(async () => new Response(`${NAME} no autorizado en ${leakedUrl()}`, { status: 401, statusText: 'Unauthorized' }))],
      ['success: false con el nombre y la URL en el error', () => vi.fn(async () => new Response(JSON.stringify({ success: false, error: `${NAME} ${leakedUrl()}` })))],
      ['fetch lanza con la URL (como «Failed to parse URL from …»)', () => vi.fn(async () => { throw new TypeError(`Failed to parse URL from ${leakedUrl()}`); })],
      ['fetch lanza con causa de sistema', () => vi.fn(async () => { throw Object.assign(new TypeError(`fetch failed ${leakedUrl()}`), { cause: { code: 'ECONNRESET' } }); })],
      ['respuesta 200 que no es JSON', () => vi.fn(async () => new Response(`<html>${NAME}</html>`, { status: 200 }))],
    ];

    it.each(failures)('%s', async (_label, makeFetch) => {
      vi.stubGlobal('fetch', makeFetch());
      const results = [
        await pipedriveGet('/persons/search', { term: NAME }),
        await pipedrivePost('/persons', { name: NAME }),
        await pipedrivePut('/deals/7', { title: NAME }),
        await pipedriveDelete('/deals/7?x=1'),
        await upload(),
      ];
      const text = logged();
      for (const secret of forbidden) expect(text, secret).not.toContain(secret);
      for (const res of results) {
        expect(res.success).toBe(false);
        const returned = `${res.error ?? ''} ${res.error_info ?? ''}`;
        expect(returned).not.toContain(TOKEN);
        expect(returned).not.toContain('https://pipedrive.example');
      }
      // La ruta va sin la consulta.
      expect(text).toContain('[Pipedrive] DELETE /deals/7 ->');
      expect(text).not.toContain('x=1');
    });

    // Ronda 3 de la auditoría de Codex (#196).
    it('el statusText del servidor nunca se usa: solo el código y su descripción fija', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 400, statusText: NAME })));
      const get = await pipedriveGet('/deals/7');
      const up = await upload();
      expect(get.error).toBe('HTTP 400: Bad Request');
      expect(up.error).toBe('HTTP 400: Bad Request');
      expect(logged()).toContain('[Pipedrive] POST /files -> 400 Bad Request | dealId: 999');
      expect(logged()).not.toContain(NAME);
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 599, statusText: NAME })));
      expect((await pipedriveGet('/deals/7')).error).toBe('HTTP 599: Unknown Status');
    });

    it('error_info se recorta después de quitar el token (ni un trozo del token queda)', async () => {
      const body = 'x'.repeat(290) + TOKEN + 'y'.repeat(50);
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 401 })));
      const get = await pipedriveGet('/deals/7');
      const up = await upload();
      for (const res of [get, up]) {
        expect(res.error_info).not.toContain(TOKEN.slice(0, 6));
        expect(res.error_info).toBe(('x'.repeat(290) + '[token]' + 'y'.repeat(50)).slice(0, 300));
        expect(res.error_info!.length).toBeLessThanOrEqual(300);
      }
    });

    it('success: false: también se limpia json.error_info', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'denied', error_info: `ver ${leakedUrl()} o api_token=${TOKEN}` }))));
      const res = await pipedriveGet('/deals/7');
      expect(res.error).toBe('denied');
      expect(res.error_info).toBe('ver [url] o api_token=[token]');
      // Sin error_info en la respuesta, no se agrega.
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'denied' }))));
      expect(await pipedriveGet('/deals/7')).not.toHaveProperty('error_info');
    });

    it('la categoría lleva el código de sistema, nunca el mensaje', async () => {
      vi.stubGlobal('fetch', failures[3][1]());
      await pipedriveGet('/deals/7');
      expect(logged()).toContain('[Pipedrive] GET /deals/7 -> FETCH_ERROR (TypeError ECONNRESET)');
    });
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
