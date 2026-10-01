// scripts/jumpseller/client.ts
// Cliente mínimo y de solo lectura para la API de Jumpseller.
// - Autenticación SOLO por header Basic base64(login:token) (CLAUDE.md §2).
//   Nunca por query string (patrón obsoleto de los scripts de ids anteriores, ya borrados).
// - Nunca registra credenciales, headers ni URLs con secretos.
// - Reintentos con backoff + jitter en 5xx y errores de red; 429 respeta los
//   headers Jumpseller-*RateLimit-*; máximo ~5 req/s (límite de la API: 20/s).

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type ApiErrorKind = 'auth' | 'http' | 'network' | 'rate' | 'shape';

export class JumpsellerApiError extends Error {
  constructor(message: string, public readonly kind: ApiErrorKind, public readonly status?: number) {
    super(message);
    this.name = 'JumpsellerApiError';
  }
}

export interface ClientOptions {
  login: string;
  token: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  maxRetries?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  pageSize?: number;
}

const DEFAULT_BASE = 'https://api.jumpseller.com/v1';
const MAX_PAGES = 200; // resguardo contra loops: 200 × 100 = 20.000 ítems

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function createJumpsellerClient(opts: ClientOptions) {
  if (!opts.login || !opts.token) {
    throw new JumpsellerApiError('Faltan credenciales de Jumpseller', 'auth');
  }
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const fetchImpl: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const maxRetries = opts.maxRetries ?? 4;
  const minIntervalMs = opts.minIntervalMs ?? 200;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pageSize = opts.pageSize ?? 100;
  const authorization = 'Basic ' + Buffer.from(`${opts.login}:${opts.token}`, 'utf8').toString('base64');

  let lastRequestAt = -Infinity;
  async function throttle() {
    const wait = lastRequestAt + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  const backoff = (attempt: number) => Math.round(500 * 2 ** attempt + random() * 250);

  function rateLimitWait(headers: { get(name: string): string | null }): number {
    if (headers.get('Jumpseller-BannedByRateLimit-Reset')) {
      throw new JumpsellerApiError('Jumpseller bloqueó temporalmente las consultas por exceso de solicitudes', 'rate', 429);
    }
    const retryAfter = Number(headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 60) * 1000;
    const perMinuteRemaining = Number(headers.get('Jumpseller-PerMinuteRateLimit-Remaining'));
    if (headers.get('Jumpseller-PerMinuteRateLimit-Remaining') !== null && perMinuteRemaining <= 0) return 60_000;
    return 1_000 + Math.round(random() * 250); // la ventana por segundo se libera en ~1 s
  }

  async function getJson(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString();
    const url = `${base}/${path.replace(/^\/+/, '')}.json${qs ? `?${qs}` : ''}`;

    for (let attempt = 0; ; attempt++) {
      await throttle();
      // El timeout cubre también la lectura del cuerpo: una conexión que se corta o
      // queda colgada a mitad de la respuesta se reintenta como error de red.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchImpl(url, {
          headers: { Authorization: authorization, Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        if (attempt < maxRetries) { await sleep(backoff(attempt)); continue; }
        throw new JumpsellerApiError(`Sin respuesta de Jumpseller (${path})`, 'network');
      }

      if (res.status === 401 || res.status === 403) {
        clearTimeout(timer);
        throw new JumpsellerApiError(`Jumpseller rechazó las credenciales (HTTP ${res.status})`, 'auth', res.status);
      }
      if (res.status === 429) {
        clearTimeout(timer);
        if (attempt >= maxRetries) throw new JumpsellerApiError('Demasiadas solicitudes a Jumpseller (429)', 'rate', 429);
        await sleep(rateLimitWait(res.headers));
        continue;
      }
      if (res.status >= 500) {
        clearTimeout(timer);
        if (attempt < maxRetries) { await sleep(backoff(attempt)); continue; }
        throw new JumpsellerApiError(`Jumpseller respondió HTTP ${res.status} (${path})`, 'http', res.status);
      }
      if (!res.ok) {
        clearTimeout(timer);
        throw new JumpsellerApiError(`Jumpseller respondió HTTP ${res.status} (${path})`, 'http', res.status);
      }
      try {
        const body = await res.json();
        clearTimeout(timer);
        return body;
      } catch {
        clearTimeout(timer);
        if (attempt < maxRetries) { await sleep(backoff(attempt)); continue; }
        throw new JumpsellerApiError(`Respuesta incompleta o inválida de Jumpseller (${path})`, 'network');
      }
    }
  }

  /** Recorre páginas (limit=pageSize) hasta que una venga corta o vacía. Desenvuelve {key: {...}}. */
  async function getAllPages<T>(path: string, wrapperKey: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await getJson(path, { limit: pageSize, page });
      if (!Array.isArray(body)) throw new JumpsellerApiError(`Respuesta inesperada de ${path} (no es una lista)`, 'shape');
      for (const item of body) {
        const inner = (item as Record<string, unknown>)?.[wrapperKey];
        if (!inner || typeof inner !== 'object') {
          throw new JumpsellerApiError(`Respuesta inesperada de ${path} (falta "${wrapperKey}")`, 'shape');
        }
        out.push(inner as T);
      }
      if (body.length < pageSize) return out;
    }
    throw new JumpsellerApiError(`Demasiadas páginas en ${path}`, 'shape');
  }

  return {
    getJson,
    fetchAvailableProducts: () => getAllPages<unknown>('products/status/available', 'product'),
    countAvailableProducts: async (): Promise<number> => {
      const body = (await getJson('products/status/available/count')) as { count?: unknown };
      const n = Number(body?.count);
      if (!Number.isInteger(n) || n < 0) throw new JumpsellerApiError('Conteo de productos inválido', 'shape');
      return n;
    },
    fetchCategories: () => getAllPages<unknown>('categories', 'category'),
  };
}

export type JumpsellerClient = ReturnType<typeof createJumpsellerClient>;
