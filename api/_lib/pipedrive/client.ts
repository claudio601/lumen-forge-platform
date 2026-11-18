// src/lib/pipedrive/client.ts
// Base HTTP client for Pipedrive API
//
// Registros (auditoría de la #196): solo el método, la ruta sin la consulta, el código HTTP y una
// categoría de error. Nunca la URL (lleva `api_token`), ni el cuerpo de la respuesta, ni el mensaje
// de un error, que pueden traer el token o datos del cliente (un nombre no se reconoce con regex).
// Lo que se devuelve a quien llama (`error`, `error_info`) conserva el texto, pero sin el token ni
// URLs: varios llamadores lo escriben en sus registros.

import type { PipedriveApiResponse } from '../crm/types.js';

const TIMEOUT_MS = 15_000;

/** La ruta para un registro: sin la consulta y solo con caracteres de ruta. */
function logPath(path: string): string {
  return String(path).split('?')[0].replace(/[^\w/.-]/g, '_').slice(0, 120);
}

/** Categoría de un error lanzado: su nombre y, si lo trae, el código de sistema (ECONNRESET…). */
function errorCategory(err: unknown): string {
  const name = err instanceof Error && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : 'Error';
  const code = err instanceof Error ? (err as { cause?: { code?: unknown } }).cause?.code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? `${name} ${code}` : name;
}

/** Quita el token y las URLs de un texto que vuelve a quien llama. */
function scrubSecrets(text: string): string {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  let safe = token ? text.split(token).join('[token]') : text;
  safe = safe.replace(/\bapi_token=[^&\s"'<>]*/gi, 'api_token=[token]');
  return safe.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[url]');
}

/** El texto de estado HTTP, solo letras y espacios (lo manda el servidor). */
function safeStatusText(text: string): string {
  return String(text ?? '').replace(/[^A-Za-z ]/g, '').trim().slice(0, 40);
}

function getConfig() {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  const baseUrl = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
  if (!token) {
    throw new Error('[Pipedrive] PIPEDRIVE_API_TOKEN is not set');
  }
  return { token, baseUrl };
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const { token, baseUrl } = getConfig();
  const url = new URL(
    path.startsWith('/') ? path.slice(1) : path,
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  );
  url.searchParams.set('api_token', token);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options?: {
    body?: Record<string, unknown>;
    params?: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<PipedriveApiResponse<T>> {
  const url = buildUrl(path, options?.params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? TIMEOUT_MS);

  try {
    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    if (options?.body && (method === 'POST' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, fetchOptions);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'no body');
      console.error(`[Pipedrive] ${method} ${logPath(path)} -> HTTP ${res.status}`);
      return {
        success: false,
        data: null,
        error: `HTTP ${res.status}: ${safeStatusText(res.statusText)}`,
        error_info: scrubSecrets(errorBody.substring(0, 300)),
      };
    }

    const json = (await res.json()) as PipedriveApiResponse<T>;

    if (!json.success) {
      console.error(`[Pipedrive] ${method} ${logPath(path)} -> API error`);
      return { ...json, error: json.error === undefined ? undefined : scrubSecrets(String(json.error)) };
    }

    return json;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.error(`[Pipedrive] ${method} ${logPath(path)} -> ${isAbort ? 'TIMEOUT' : `FETCH_ERROR (${errorCategory(err)})`}`);
    return {
      success: false,
      data: null,
      error: isAbort ? 'Request timeout' : scrubSecrets(message),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// --- Public helpers ---

export async function pipedriveGet<T>(
  path: string,
  params?: Record<string, string>,
  timeoutMs?: number
): Promise<PipedriveApiResponse<T>> {
  return request<T>('GET', path, { params, timeoutMs });
}

export async function pipedrivePost<T>(
  path: string,
  body: Record<string, unknown>,
  params?: Record<string, string>
): Promise<PipedriveApiResponse<T>> {
  return request<T>('POST', path, { body, params });
}

export async function pipedrivePut<T>(
  path: string,
  body: Record<string, unknown>,
  params?: Record<string, string>
): Promise<PipedriveApiResponse<T>> {
  return request<T>('PUT', path, { body, params });
}

export async function pipedriveDelete<T>(
  path: string,
  params?: Record<string, string>
): Promise<PipedriveApiResponse<T>> {
  return request<T>('DELETE', path, { params });
}

const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Sube un archivo a un negocio: POST /files, multipart con `file` y `deal_id`. No fija el
 * Content-Type (fetch arma el multipart con su boundary). Tiempo límite: 60 s. Nunca lanza:
 * devuelve { success, data } o { success: false, error }. El log nunca lleva el nombre del
 * archivo (es un dato del cliente), ni lo que responde Pipedrive.
 */
export async function pipedriveUploadFile<T = { id: number }>({
  dealId,
  fileName,
  contentType,
  data,
  timeoutMs = UPLOAD_TIMEOUT_MS,
}: {
  dealId: number;
  fileName: string;
  contentType: string;
  data: Uint8Array | ArrayBuffer | Blob;
  timeoutMs?: number;
}): Promise<PipedriveApiResponse<T>> {
  const path = '/files';
  const scrub = (text: string) => scrubSecrets(fileName ? text.split(fileName).join('[archivo]') : text).substring(0, 300);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const form = new FormData();
    form.append('file', data instanceof Blob ? data : new Blob([data as Uint8Array], { type: contentType }), fileName);
    form.append('deal_id', String(dealId));

    const res = await fetch(buildUrl(path), {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      body: form,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'no body');
      console.error(`[Pipedrive] POST ${path} -> ${res.status} ${safeStatusText(res.statusText)} | dealId: ${dealId}`);
      return {
        success: false,
        data: null,
        error: `HTTP ${res.status}: ${safeStatusText(res.statusText)}`,
        error_info: scrub(errorBody),
      };
    }

    const json = (await res.json()) as PipedriveApiResponse<T>;
    if (!json.success) {
      console.error(`[Pipedrive] POST ${path} -> API error | dealId: ${dealId}`);
      return { success: false, data: null, error: scrub(String(json.error ?? 'API error')) };
    }
    return json;
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Pipedrive] POST ${path} -> ${isAbort ? 'TIMEOUT' : 'FETCH_ERROR'} | dealId: ${dealId}`);
    return { success: false, data: null, error: isAbort ? 'Request timeout' : scrub(message) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Paginated GET: fetches all pages and returns combined data array.
 * Use for listing deals, persons, etc. where results may span multiple pages.
 */
export async function pipedriveGetAll<T>(
  path: string,
  params?: Record<string, string>,
  limit = 100
): Promise<T[]> {
  const results: T[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await pipedriveGet<T[]>(path, {
      ...params,
      start: String(start),
      limit: String(limit),
    });

    if (!res.success || !res.data) break;

    results.push(...res.data);
    hasMore = res.additional_data?.pagination?.more_items_in_collection ?? false;
    start = res.additional_data?.pagination?.next_start ?? start + limit;
  }

  return results;
}
