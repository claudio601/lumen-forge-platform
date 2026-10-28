// Estado compartido del bot; ante una caida de Upstash conserva la memoria de la instancia.
import { createHash, randomUUID } from 'node:crypto';
import { redisJsonCommand, redisJsonCommandWithTimeout } from '../idempotency/redis.js';
import { getFlowState, saveFlowState, clearFlowState } from './flowEngine.js';
import type { FlowState } from './flowEngine.js';
import { getHistory, restoreHistory, clearHistory } from './conversation.js';
import type { ConversationTurn } from './conversation.js';
import { privacyNoticeShown, restorePrivacyNotice } from './privacyNotice.js';
import type { PendingWhatsAppWrite } from './pipedriveLead.js';

export const CONVERSATION_TTL_S = 604800;
export const MESSAGE_TTL_S = 86400;
// Presupuesto solicitado: 60 s de función + 15 s de margen. vercel.json aún no declara
// maxDuration para este webhook; mantener alineado al configurar el despliegue.
export const MESSAGE_IN_PROGRESS_TTL_S = 60 + 15;
export const CONVERSATION_LOCK_TTL_MS = 25_000;
export const MESSAGE_RETRY_WAIT_MS = 3_000;

interface Snapshot {
  updatedAt?: number; // Los estados anteriores a esta versión no tienen la marca.
  flow: FlowState;
  history: ConversationTurn[];
  privacyShown: boolean;
  pending: PendingWhatsAppWrite[];
}

const pendingWrites = new Map<string, PendingWhatsAppWrite[]>();
const local = new Map<string, { updatedAt: number; dirty: boolean }>();

export function conversationKey(phone: string): string {
  return 'whatsapp:conversation:' + createHash('sha256').update(phone).digest('hex');
}

/** Mismo hash que conversationKey, sin teléfono en claro. */
export function conversationLockKey(phone: string): string {
  return 'lock:' + conversationKey(phone);
}

/** La fila local sigue vigente. Contención o caída: continuar como antes, con aviso. */
export async function acquireConversationLock(phone: string, maxWaitMs: number): Promise<{
  acquired: boolean;
  release: () => Promise<void>;
}> {
  const key = conversationLockKey(phone);
  const token = randomUUID();
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  const fallback = { acquired: false, release: async () => {} };
  while (Date.now() < deadline) {
    const result = await redisJsonCommandWithTimeout<string | null>(
      Math.min(800, deadline - Date.now()), 'SET', key, token, 'NX', 'PX', CONVERSATION_LOCK_TTL_MS,
    );
    if (!result.ok) { unavailable('candado de conversación'); return fallback; }
    if (result.result === 'OK') {
      return { acquired: true, release: async () => {
        const script = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;
        const released = await redisJsonCommand('EVAL', script, '1', key, token);
        if (!released.ok) unavailable('liberar candado de conversación');
      } };
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
  console.warn('[whatsapp/stateStore] Espera del candado agotada; continúa sin candado');
  return fallback;
}

export function messageKey(sid: string): string {
  return 'whatsapp:message:' + sid;
}

function unavailable(op: string): void {
  console.warn('[whatsapp/stateStore] Upstash no disponible; respaldo en memoria (' + op + ')');
}

export function getPendingWrites(phone: string): PendingWhatsAppWrite[] {
  return pendingWrites.get(phone) ?? [];
}

export function setPendingWrites(phone: string, pending: PendingWhatsAppWrite[]): void {
  pendingWrites.set(phone, pending);
}

function clearLocal(phone: string): void {
  clearFlowState(phone);
  clearHistory(phone);
  restorePrivacyNotice(phone, false);
  pendingWrites.delete(phone);
  local.delete(phone);
}

export async function loadConversation(phone: string, sharedAuthoritative = false): Promise<void> {
  const cached = local.get(phone);
  if (cached && Date.now() - cached.updatedAt >= CONVERSATION_TTL_S * 1000) clearLocal(phone);
  const result = await redisJsonCommand<string | null>('GET', conversationKey(phone));
  if (!result.ok) { unavailable('leer estado'); return; }
  const unsaved = local.get(phone);
  // La reconciliación y su escritura necesitan el candado del número.
  if (!sharedAuthoritative && unsaved?.dirty) return;
  if (!result.result) {
    if (unsaved?.dirty) await writeConversation(phone, unsaved.updatedAt);
    else clearLocal(phone);
    return;
  }
  try {
    const state = JSON.parse(result.result) as Snapshot;
    if (!state.flow?.captured || !Array.isArray(state.history) || !Array.isArray(state.pending)) throw new Error('estado invalido');
    const updatedAt = typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0;
    if (unsaved?.dirty && unsaved.updatedAt > updatedAt) {
      await writeConversation(phone, unsaved.updatedAt);
      return;
    }
    saveFlowState(phone, state.flow);
    restoreHistory(phone, state.history);
    restorePrivacyNotice(phone, state.privacyShown);
    setPendingWrites(phone, state.pending);
    local.set(phone, { updatedAt: updatedAt || Date.now(), dirty: false });
  } catch {
    unavailable('estado ilegible');
  }
}

export async function persistConversation(phone: string): Promise<void> {
  await writeConversation(phone, Date.now());
}

/** Reintentar la sincronización conserva la fecha de la última modificación. */
async function writeConversation(phone: string, updatedAt: number): Promise<void> {
  const state: Snapshot = {
    updatedAt,
    flow: getFlowState(phone), history: getHistory(phone),
    privacyShown: privacyNoticeShown(phone), pending: getPendingWrites(phone),
  };
  const meta = { updatedAt, dirty: true };
  local.set(phone, meta);
  const result = await redisJsonCommand('SET', conversationKey(phone), JSON.stringify(state), 'EX', CONVERSATION_TTL_S);
  if (result.ok) meta.dirty = false;
  else unavailable('guardar estado');
}

type MessageState = { status: 'in_progress' } | { status: 'done'; response: string };

export async function claimMessage(sid: string, maxWaitMs = MESSAGE_RETRY_WAIT_MS): Promise<{ proceed: boolean; response?: string }> {
  if (!sid) return { proceed: true };
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  const timeout = () => Math.max(1, Math.min(800, deadline - Date.now()));
  const result = await redisJsonCommandWithTimeout<string | null>(timeout(), 'SET', messageKey(sid), JSON.stringify({ status: 'in_progress' }), 'NX', 'EX', MESSAGE_IN_PROGRESS_TTL_S);
  if (!result.ok) { unavailable('reservar MessageSid'); return { proceed: true }; }
  if (result.result === 'OK') return { proceed: true };
  for (;;) {
    const saved = await redisJsonCommandWithTimeout<string | null>(timeout(), 'GET', messageKey(sid));
    // Ya existe una reserva: una caída durante la espera no autoriza a duplicarla.
    if (!saved.ok) { unavailable('leer MessageSid'); return { proceed: false }; }
    try {
      const state = JSON.parse(saved.result ?? '{}') as MessageState;
      if (state.status === 'done' && typeof state.response === 'string') return { proceed: false, response: state.response };
    } catch {
      return { proceed: false };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { proceed: false };
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
}

export async function completeMessage(sid: string, response: string): Promise<void> {
  if (!sid) return;
  const result = await redisJsonCommand('SET', messageKey(sid), JSON.stringify({ status: 'done', response }), 'EX', MESSAGE_TTL_S);
  if (!result.ok) unavailable('guardar respuesta');
}
