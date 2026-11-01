// api/_tests/fakeUpstash.ts
// Upstash Redis falso, en memoria, para las pruebas de los adjuntos: responde GET, MGET,
// SET … [NX] EX/PX, EVAL compare-and-delete y el EVAL del contador (INCRBY + EXPIRE) de api/_lib/idempotency/redis.ts.
// Para el bot de WhatsApp, también HSET/HDEL/HGETALL/HLEN/EXPIRE, el EVAL que guarda con revisión, los
// EVAL de la cola de pendientes (stateStore.ts: agregar, migrar, reservar (con la escritura guardada y el
// intento anterior), soltar y anotar campos confirmados), el del estado guardado aparte y los del candado
// de la conversación (marcar y soltar).
// Los EVAL se imitan en TypeScript, reconocidos por su primera línea: no se ejecuta el Lua.
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
  /**
   * Falla simulada de un comando: 'fail' responde error sin aplicarlo; 'lose' lo aplica y responde error
   * (la respuesta se perdió). También sirve para observar cada comando.
   */
  intercept?: (cmd: string, args: string[]) => 'fail' | 'lose' | undefined;
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
    const failure = redis.intercept?.(cmd, args);
    const failed = () => new Response(JSON.stringify({ error: 'ERR falla simulada' }), { status: 500 });
    if (failure === 'fail') return failed();
    // Hash guardado como JSON en `value`; sin campos, la clave no existe (como en Redis).
    const hashOf = (key: string): Record<string, string> => JSON.parse(redis.data.get(key)?.value ?? '{}');
    const saveHash = (key: string, hash: Record<string, string>, ttl?: number) => {
      if (!Object.keys(hash).length) { redis.data.delete(key); return; }
      const prev = redis.data.get(key);
      redis.data.set(key, { ...(prev ?? {}), value: JSON.stringify(hash), ...(ttl !== undefined ? { ttl, expiresAt: Date.now() + ttl * 1000 } : {}) });
    };
    let result: unknown = null;
    if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:agregar')) {
      // Cola del bot (stateStore.ts): con el tope de notas y el total, la escritura, los reemplazos y el plazo juntos.
      const [, , key, id, value, maxNotes, maxTotal, ttl, ...replace] = args;
      const hash = hashOf(key);
      let ok = true;
      if (hash[id] === undefined) {
        const entries = Object.keys(hash).filter((f) => f.startsWith('n:') || f.startsWith('f:'));
        const replaced = replace.filter((f) => hash[f] !== undefined).length;
        if (id.startsWith('n:') && entries.filter((f) => f.startsWith('n:')).length >= Number(maxNotes)) ok = false;
        else if (entries.length - replaced >= Number(maxTotal)) ok = false;
      }
      if (ok) {
        hash[id] = value;
        for (const f of replace) { delete hash[f]; delete hash['t:' + f]; }
        saveHash(key, hash, Number(ttl));
      }
      result = ok ? 1 : 0;
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:anticipar')) {
      const [, , key, id, value, maxNotes, maxTotal, ttl, marker, lease, overwrite] = args;
      const hash = hashOf(key);
      const previous = hash[id];
      if (hash[marker] !== undefined) result = [2, hash[marker]];
      else if (previous !== undefined && overwrite !== '1') result = [3, hash['t:' + id] ?? '', previous];
      else {
        const entries = Object.keys(hash).filter((f) => f.startsWith('n:') || f.startsWith('f:'));
        if (previous === undefined && ((id.startsWith('n:') && entries.filter((f) => f.startsWith('n:')).length >= Number(maxNotes)) || entries.length >= Number(maxTotal))) result = 0;
        else {
          hash[id] = value;
          if (lease !== '') hash['t:' + id] = lease;
          else if (previous === undefined) delete hash['t:' + id];
          saveHash(key, hash, Number(ttl));
          result = [1];
        }
      }
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:entregada')) {
      const [, , key, id, marker, value, now, maxAge, ttl] = args;
      const hash = hashOf(key);
      delete hash[id]; delete hash['t:' + id];
      hash[marker] = value;
      for (const f of Object.keys(hash)) {
        if (!f.startsWith('d:')) continue;
        const at = /^\{"at":(\d+)/.exec(hash[f])?.[1];
        if (at !== undefined && Number(at) < Number(now) - Number(maxAge)) delete hash[f];
      }
      saveHash(key, hash, Number(ttl));
      result = 1;
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:migrar')) {
      const [, , key, id, value, marker, ttl] = args;
      const hash = hashOf(key);
      if (hash[marker] !== undefined) {
        result = 2;
      } else {
        hash[id] = value;
        hash[marker] = '1';
        saveHash(key, hash, Number(ttl));
        result = 1;
      }
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:reservar')) {
      // Reservada: {1, la marca del intento anterior ('' si no hubo), la escritura guardada}.
      const [, , key, now, lease, id] = args;
      const hash = hashOf(key);
      if (hash[id] === undefined || Number(/^(\d+)/.exec(hash['t:' + id] ?? '')?.[1] ?? 0) > Number(now)) {
        result = 0;
      } else {
        const previous = hash['t:' + id] ?? '';
        hash['t:' + id] = lease;
        saveHash(key, hash);
        result = [1, previous, hash[id]];
      }
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:soltar')) {
      const [, , key, id, expected, meta, value, marker, markValue] = args;
      const hash = hashOf(key);
      if (hash['t:' + id] !== expected) {
        result = 0;
      } else {
        if (value !== '') hash[id] = value;
        hash['t:' + id] = meta;
        if (marker !== undefined && marker !== '') hash[marker] = markValue;
        saveHash(key, hash);
        result = 1;
      }
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:cola:version')) {
      // Campos confirmados de un negocio: el número más nuevo, y la cola con su plazo.
      const [, , key, field, ver, ttl] = args;
      const hash = hashOf(key);
      if (Number(ver) > Number(hash[field] ?? 0)) hash[field] = ver;
      saveHash(key, hash, Number(ttl));
      result = 1;
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:estado:aparte')) {
      // Estado guardado aparte (otro guardado ganó cada intento): la entrada y su plazo.
      const [, , key, id, value, ttl] = args;
      const hash = hashOf(key);
      hash[id] = value;
      saveHash(key, hash, Number(ttl));
      result = 1;
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:candado:paso')) {
      // Candado de la conversación marcado (su mensaje ya pasó por el flujo): mismo dueño, mismo plazo.
      const [, , key, token, stepped] = args;
      const entry = redis.data.get(key);
      if (entry?.value !== token) {
        result = 0;
      } else {
        if (entry.expiresAt === undefined || entry.expiresAt > Date.now()) entry.value = token + stepped;
        result = 1;
      }
    } else if (cmd === 'EVAL' && args[0].startsWith('-- whatsapp:candado:soltar')) {
      // Soltar el candado de la conversación, marcado o no, solo si sigue siendo de quien lo tomó.
      const [, , key, token, stepped] = args;
      const value = redis.data.get(key)?.value;
      result = value === token || value === token + stepped ? Number(redis.data.delete(key)) : 0;
    } else if (cmd === 'GET') {
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
    if (failure === 'lose') return failed();
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
}
