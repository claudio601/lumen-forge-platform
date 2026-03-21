// src/lib/pipedrive/client.ts
// Base HTTP client for Pipedrive API

import type { PipedriveApiResponse } from '../crm/types';

const TIMEOUT_MS = 15_000;

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
  const url = new URL(path.replace(/^//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
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
  }
): Promise<PipedriveApiResponse<T>> {
  const url = buildUrl(path, options?.params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
      console.error(
        `[Pipedrive] ${method} ${path} -> ${res.status} ${res.statusText}`,
        errorBody.substring(0, 300)
      );
      return {
        success: false,
        data: null,
        error: `HTTP ${res.status}: ${res.statusText}`,
        error_info: errorBody.substring(0, 300),
      };
    }

    const json: PipedriveApiResponse<T> = await res.json();

    if (!json.success) {
      console.error(`[Pipedrive] ${method} ${path} -> API error:`, json.error);
    }

    return json;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.error(
      `[Pipedrive] ${method} ${path} -> ${isAbort ? 'TIMEOUT' : 'FETCH_ERROR'}:`,
      message
    );
    return {
      success: false,
      data: null,
      error: isAbort ? 'Request timeout' : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// --- Public helpers ---

export async function pipedriveGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<PipedriveApiResponse<T>> {
  return request<T>('GET', path, { params });
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
