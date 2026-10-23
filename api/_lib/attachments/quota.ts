// api/_lib/attachments/quota.ts
// ─────────────────────────────────────────────────────────────────────────────
// Topes de los adjuntos del cotizador (decisión D2 del dueño, 22-10-2026), con contadores
// en Upstash Redis que no guardan datos personales:
//   - por día (hora de Chile), para todo el sitio: 200 archivos y 1 GB declarados en los
//     permisos de subida;
//   - techo de lo guardado en Blob (unos 8 GB): el barrido diario (api/cron/blob-sweep.ts)
//     suma lo que queda y lo deja en Redis; el permiso lo revisa. Al llegar al techo no se
//     entregan permisos (el formulario sigue sin adjuntos, con el mensaje del tope) y el
//     barrido avisa a ventas.
// Además, la clave «pendiente» (ruta en Blob → id del negocio, 48 h) deja que el barrido
// reintente un archivo cuyo traspaso a Pipedrive no terminó (la función se cortó).
//
// Si Redis no responde, no se entrega el permiso: la cuota de Blob no queda sin control.
// ─────────────────────────────────────────────────────────────────────────────

import { incrementCounter, readCounter, writeCounter } from '../idempotency/redis.js';

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
export type CapacityResult = { ok: true } | { ok: false; code: UnavailableCode };

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
    readCounter(STORED_BYTES_KEY),
    readCounter(keys.files),
    readCounter(keys.bytes),
  ]);
  if (stored.ok === false || dayFiles.ok === false || dayBytes.ok === false) return { ok: false, code: 'unavailable' };
  if (stored.value >= STORED_CEILING_BYTES) return { ok: false, code: 'daily_limit' };
  if (dayFiles.value + files > DAILY_MAX_FILES || dayBytes.value + bytes > DAILY_MAX_BYTES) {
    return { ok: false, code: 'daily_limit' };
  }
  return { ok: true };
}

/**
 * Reserva un archivo de `bytes` (el peso que declaró el navegador) en los topes del día.
 * Revisa primero el techo de Blob; después suma a los dos contadores del día y rechaza si
 * alguno pasa el tope (lo sumado no se devuelve: el tope es por día y solo crece).
 */
export async function reserveUpload(bytes: number, now: Date = new Date()): Promise<CapacityResult> {
  const stored = await readCounter(STORED_BYTES_KEY);
  if (stored.ok === false) return { ok: false, code: 'unavailable' };
  if (stored.value >= STORED_CEILING_BYTES) return { ok: false, code: 'daily_limit' };
  const keys = dayKeys(now);
  const [dayFiles, dayBytes] = await Promise.all([
    incrementCounter(keys.files, 1, DAY_TTL_S),
    incrementCounter(keys.bytes, bytes, DAY_TTL_S),
  ]);
  if (dayFiles.ok === false || dayBytes.ok === false) return { ok: false, code: 'unavailable' };
  if (dayFiles.value > DAILY_MAX_FILES || dayBytes.value > DAILY_MAX_BYTES) return { ok: false, code: 'daily_limit' };
  return { ok: true };
}

/** El barrido deja el total guardado en Blob. */
export async function recordStoredBytes(total: number): Promise<boolean> {
  return (await writeCounter(STORED_BYTES_KEY, total, STORED_TTL_S)).ok;
}

/** Marca los archivos que se van a traspasar al negocio `dealId` (para el reintento del barrido). */
export async function markPending(pathnames: string[], dealId: number): Promise<boolean> {
  const results = await Promise.all(pathnames.map((p) => writeCounter(pendingKey(p), dealId, PENDING_TTL_S)));
  return results.every((r) => r.ok);
}

/** Traspaso terminado (adjuntado o descartado): el barrido ya no lo reintenta. */
export async function markDone(pathname: string): Promise<boolean> {
  return (await writeCounter(pendingKey(pathname), 0, PENDING_TTL_S)).ok;
}

/** Negocio de un archivo pendiente; null si no hay (o ya terminó, o Redis no responde). */
export async function readPending(pathname: string): Promise<number | null> {
  const res = await readCounter(pendingKey(pathname));
  return res.ok && res.value > 0 ? res.value : null;
}
