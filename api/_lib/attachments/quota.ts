// api/_lib/attachments/quota.ts
// ─────────────────────────────────────────────────────────────────────────────
// Topes de los adjuntos del cotizador (decisión D2 del dueño, 22-10-2026), con contadores
// en Upstash Redis que no guardan datos personales:
//   - por día (hora de Chile), para todo el sitio: 200 archivos y 1 GB declarados en los
//     permisos de subida;
//   - techo de lo guardado en Blob (unos 8 GB): el barrido diario (api/cron/blob-sweep.ts)
//     suma lo que queda (también lo que no pudo borrar) y lo deja en Redis; el permiso lo
//     revisa. Al llegar al techo no se entregan permisos (el formulario sigue sin adjuntos,
//     con el mensaje del tope) y el barrido avisa a ventas.
// Ese total es también la señal de que el barrido corre: vence a los 3 días sin barrido. En
// producción, sin esa clave no se entregan permisos ('unavailable'), así un CRON_SECRET que
// falta o está mal no deja archivos en Blob sin borrar; el permiso avisa a ventas una vez al
// día. En las previews y en local (VERCEL_ENV distinto de production, detrás del SSO de
// Vercel) no se exige: ahí el cron no corre.
// Además, la clave «pendiente» (ruta en Blob → id del negocio, 48 h) reserva cada archivo
// para un solo traspaso (SET NX: un reenvío mientras el primero sigue no lo duplica) y deja
// que el barrido reintente un archivo cuyo traspaso a Pipedrive no terminó (la función se
// cortó).
//
// Si Redis no responde, no se entrega el permiso: la cuota de Blob no queda sin control.
// ─────────────────────────────────────────────────────────────────────────────

import { incrementCounter, readCounter, readCounters, setCounterIfAbsent, writeCounter } from '../idempotency/redis.js';

export const DAILY_MAX_FILES = 200;
export const DAILY_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
export const STORED_CEILING_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB

const DAY_TTL_S = 2 * 24 * 3600;
/** El total lo reescribe el barrido cada día; si el barrido deja de correr, vence. */
const STORED_TTL_S = 3 * 24 * 3600;
/** Lo que vive un archivo huérfano como máximo (barrido diario + 24 h). */
export const PENDING_TTL_S = 48 * 3600;

export const STORED_BYTES_KEY = 'adjuntos:blob:bytes';

/** Fecha de hoy en Chile, AAAA-MM-DD. */
export function chileDay(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

export function dayKeys(now: Date = new Date()): { files: string; bytes: string } {
  const day = chileDay(now);
  return { files: `adjuntos:dia:${day}:archivos`, bytes: `adjuntos:dia:${day}:bytes` };
}

export const pendingKey = (pathname: string) => `adjuntos:pendiente:${pathname}`;

/** Por qué no hay subida: tope (diario o techo de Blob) o servicio no disponible. */
export type UnavailableCode = 'daily_limit' | 'unavailable';
/** Motivo interno (para el log, nunca para el navegador). */
export type UnavailableReason = 'redis' | 'no_sweep' | 'ceiling' | 'daily';
export type CapacityResult = { ok: true } | { ok: false; code: UnavailableCode; reason: UnavailableReason };

const denied = (code: UnavailableCode, reason: UnavailableReason): CapacityResult => ({ ok: false, code, reason });

/** Solo producción exige que el barrido haya corrido (en las previews el cron no corre). */
const sweepRequired = () => process.env.VERCEL_ENV === 'production';

/** Techo de Blob y señal de vida del barrido (el total que deja cada día). */
async function storedCheck(): Promise<CapacityResult> {
  const stored = await readCounter(STORED_BYTES_KEY);
  if (stored.ok === false) return denied('unavailable', 'redis');
  if (!stored.exists && sweepRequired()) return denied('unavailable', 'no_sweep');
  if (stored.value >= STORED_CEILING_BYTES) return denied('daily_limit', 'ceiling');
  return { ok: true };
}

/** Credenciales del almacén Blob (OIDC con BLOB_STORE_ID, o el token de lectura y escritura). */
export function blobStoreConfigured(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * ¿Caben `files` archivos y `bytes` más hoy? Solo lee (no suma): es la consulta que hace el
 * formulario antes de subir, para mostrar el mensaje del tope.
 */
export async function checkCapacity(
  { files, bytes }: { files: number; bytes: number },
  now: Date = new Date()
): Promise<CapacityResult> {
  const keys = dayKeys(now);
  const [stored, dayFiles, dayBytes] = await Promise.all([
    storedCheck(),
    readCounter(keys.files),
    readCounter(keys.bytes),
  ]);
  if (dayFiles.ok === false || dayBytes.ok === false) return denied('unavailable', 'redis');
  if (stored.ok === false) return stored;
  if (dayFiles.value + files > DAILY_MAX_FILES || dayBytes.value + bytes > DAILY_MAX_BYTES) {
    return denied('daily_limit', 'daily');
  }
  return { ok: true };
}

/**
 * Reserva un archivo de `bytes` (el peso que declaró el navegador) en los topes del día.
 * Revisa primero el techo de Blob; después suma a los dos contadores del día y rechaza si
 * alguno pasa el tope (lo sumado no se devuelve: el tope es por día y solo crece).
 */
export async function reserveUpload(bytes: number, now: Date = new Date()): Promise<CapacityResult> {
  const stored = await storedCheck();
  if (stored.ok === false) return stored;
  const keys = dayKeys(now);
  const [dayFiles, dayBytes] = await Promise.all([
    incrementCounter(keys.files, 1, DAY_TTL_S),
    incrementCounter(keys.bytes, bytes, DAY_TTL_S),
  ]);
  if (dayFiles.ok === false || dayBytes.ok === false) return denied('unavailable', 'redis');
  if (dayFiles.value > DAILY_MAX_FILES || dayBytes.value > DAILY_MAX_BYTES) return denied('daily_limit', 'daily');
  return { ok: true };
}

/**
 * true la primera vez del día (hora de Chile) que se pide el aviso `name`: así un aviso a
 * ventas que dispara el sitio sale como máximo una vez al día. false si ya salió o si Redis
 * no responde (sin Redis no se avisa: evita una lluvia de correos).
 */
export async function claimDailyAlert(name: string, now: Date = new Date()): Promise<boolean> {
  const res = await setCounterIfAbsent(`adjuntos:aviso:${name}:${chileDay(now)}`, 1, DAY_TTL_S);
  return res.ok && res.set;
}

/** El barrido deja el total guardado en Blob. */
export async function recordStoredBytes(total: number): Promise<boolean> {
  return (await writeCounter(STORED_BYTES_KEY, total, STORED_TTL_S)).ok;
}

/**
 * Reserva cada archivo para traspasarlo al negocio `dealId` (SET NX, 48 h): 'claimed' si la
 * reserva es de este traspaso; 'taken' si otro ya lo tiene (un envío anterior que sigue o
 * que lo dejó pendiente para el barrido, o que ya terminó); 'error' si Redis no respondió
 * (el traspaso sigue igual, sin reintento del barrido).
 */
export type PendingClaim = 'claimed' | 'taken' | 'error';

export async function claimPending(pathnames: string[], dealId: number): Promise<Map<string, PendingClaim>> {
  const results = await Promise.all(pathnames.map((p) => setCounterIfAbsent(pendingKey(p), dealId, PENDING_TTL_S)));
  return new Map(
    pathnames.map((p, i) => {
      const r = results[i];
      return [p, r.ok === false ? 'error' : r.set ? 'claimed' : 'taken'] as const;
    })
  );
}

/** Traspaso terminado (adjuntado o descartado): el barrido ya no lo reintenta. */
export async function markDone(pathname: string): Promise<boolean> {
  return (await writeCounter(pendingKey(pathname), 0, PENDING_TTL_S)).ok;
}

const PENDING_MGET_CHUNK = 50;

/**
 * Negocio de cada archivo pendiente (ruta → id), con MGET de a 50 claves y en paralelo: un
 * Redis lento cuesta como máximo un tiempo límite (5 s), no uno por archivo. Las rutas sin
 * pendiente (o ya terminadas) no aparecen; `ok` es false si algún MGET falló.
 */
export async function readPendingMany(pathnames: string[]): Promise<{ ok: boolean; deals: Map<string, number> }> {
  const chunks: string[][] = [];
  for (let i = 0; i < pathnames.length; i += PENDING_MGET_CHUNK) chunks.push(pathnames.slice(i, i + PENDING_MGET_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => readCounters(chunk.map(pendingKey))));
  const deals = new Map<string, number>();
  let ok = true;
  results.forEach((res, c) => {
    if (res.ok === false) {
      ok = false;
      return;
    }
    res.values.forEach((value, i) => {
      if (value !== null && value > 0) deals.set(chunks[c][i], value);
    });
  });
  return { ok, deals };
}

/** Candado del barrido: el cron de Vercel puede llamar dos veces la misma ejecución. */
export const SWEEP_LOCK_KEY = 'adjuntos:barrido:candado';

/** 'acquired' si este barrido tiene el candado (120 s); 'busy' si otro lo tiene; 'error' sin Redis. */
export async function acquireSweepLock(ttlSeconds = 120): Promise<'acquired' | 'busy' | 'error'> {
  const res = await setCounterIfAbsent(SWEEP_LOCK_KEY, 1, ttlSeconds);
  if (res.ok === false) return 'error';
  return res.set ? 'acquired' : 'busy';
}
