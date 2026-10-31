// api/_tests/fakeUpstash.ts
// Upstash Redis falso, en memoria, para las pruebas de los adjuntos: responde GET, MGET,
// SET … [NX] EX/PX, EVAL compare-and-delete y el EVAL del contador (INCRBY + EXPIRE) de api/_lib/idempotency/redis.ts.
// Para el bot de WhatsApp, también HSET/HDEL/HGETALL/HLEN/EXPIRE y el EVAL que guarda con revisión.
// Se instala como fetch; las llamadas al relay de correo (GAS_RELAY_URL) responden
// {"status":"ok"}. No es una prueba ni una función: vive en api/_tests/ para que Vercel no
// lo despliegue.

import { vi } from 'vitest';

export const UPSTASH_URL = 'https://upstash.example';

export interface FakeRedis {
  data: Map<string, { value: string; ttl?: number; expiresAt?: number }>;
  down: boolean;
  /** Correos que recibió el relay (cuerpo JSON). */
  mails: Record<string, string>[];
  value: (key: string) => number;
}

export function createFakeRedis(): FakeRedis {
  const data = new Map<string, { value: string; ttl?: number; expiresAt?: number }>();
  return { data, down: false, mails: [], value: (key) => Number(data.get(key)?.value ?? 0) };
}

/** fetch simulado: Upstash en `UPSTASH_URL` y el relay de correo. */
export function fakeFetch(redis: FakeRedis) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (process.env.GAS_RELAY_URL && url.startsWith(process.env.GAS_RELAY_URL)) {
      redis.mails.push(JSON.parse(String(init?.body)));
      return new Response('{"status":"ok"}', { status: 200 });
    }
    if (!url.startsWith(UPSTASH_URL)) throw new Error('fetch no simulado: ' + new URL(url).host);
    if (redis.down) throw new TypeError('fetch failed');
    const [cmd, ...args]: string[] = init?.method === 'POST'
      ? JSON.parse(String(init.body)).map(String)
      : new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    // Redis aplica el vencimiento antes de GET, NX y EVAL (también con reloj simulado).
    for (const [key, entry] of redis.data) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) redis.data.delete(key);
    }
    let result: unknown = null;
    if (cmd === 'GET') {
      result = redis.data.get(args[0])?.value ?? null;
    } else if (cmd === 'MGET') {
      result = args.map((key) => redis.data.get(key)?.value ?? null);
    } else if (cmd === 'SET') {
      // SET key value [NX] EX seconds / PX milliseconds
      const nx = args.includes('NX');
      const px = args.includes('PX');
      const ttl = Number(args[args.indexOf(px ? 'PX' : 'EX') + 1]);
      if (nx && redis.data.has(args[0])) {
        result = null;
      } else {
        redis.data.set(args[0], { value: args[1], ttl, expiresAt: Date.now() + ttl * (px ? 1 : 1000) });
        result = 'OK';
      }
    } else if (cmd === 'EVAL' && args[0].includes('^{"rev":')) {
      // Bot de WhatsApp (stateStore.ts): SET ... EX solo si la revisión guardada es la esperada.
      const [, , key, expected, value, ttl] = args;
      const current = redis.data.get(key)?.value;
      const rev = current ? Number(/^\{"rev":(\d+),/.exec(current)?.[1] ?? 0) : 0;
      if (rev !== Number(expected)) {
        result = 0;
      } else {
        redis.data.set(key, { value, ttl: Number(ttl), expiresAt: Date.now() + Number(ttl) * 1000 });
        result = 1;
      }
    } else if (cmd === 'HSET' || cmd === 'HDEL' || cmd === 'HGETALL' || cmd === 'HLEN') {
      // Hash guardado como JSON en `value` (la cola de escrituras pendientes del bot de WhatsApp).
      const entry = redis.data.get(args[0]);
      const hash: Record<string, string> = entry ? JSON.parse(entry.value) : {};
      if (cmd === 'HGETALL') result = Object.entries(hash).flat();
      else if (cmd === 'HLEN') result = Object.keys(hash).length;
      else {
        let changed = 0;
        if (cmd === 'HSET') for (let i = 1; i + 1 < args.length; i += 2) { changed += hash[args[i]] === undefined ? 1 : 0; hash[args[i]] = args[i + 1]; }
        else for (const field of args.slice(1)) { changed += hash[field] === undefined ? 0 : 1; delete hash[field]; }
        if (Object.keys(hash).length) redis.data.set(args[0], { ...(entry ?? {}), value: JSON.stringify(hash) });
        else redis.data.delete(args[0]);
        result = changed;
      }
    } else if (cmd === 'EXPIRE') {
      const entry = redis.data.get(args[0]);
      if (entry) { entry.ttl = Number(args[1]); entry.expiresAt = Date.now() + Number(args[1]) * 1000; }
      result = entry ? 1 : 0;
    } else if (cmd === 'EVAL' && args[0].includes("redis.call('del'")) {
      const [, , key, token] = args;
      result = redis.data.get(key)?.value === token ? Number(redis.data.delete(key)) : 0;
    } else if (cmd === 'EVAL' && args[0].includes('INCRBY')) {
      const [, , key, by, ttl] = args;
      const prev = redis.data.get(key);
      const value = Number(prev?.value ?? 0) + Number(by);
      redis.data.set(key, { value: String(value), ttl: prev?.ttl ?? Number(ttl), expiresAt: prev?.expiresAt ?? Date.now() + Number(ttl) * 1000 });
      result = value;
    } else {
      throw new Error('comando no simulado: ' + cmd);
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
}
