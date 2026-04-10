// api/_lib/idempotency/redis.ts
// Distributed idempotency and lock module using Upstash Redis REST API.
// Used to prevent duplicate deal creation when Jumpseller fires parallel
// or repeated webhooks for the same order.

const LOG_PREFIX = '[idempotency/redis]';

// TTLs
const LOCK_TTL_MS = 30_000;        // 30 seconds
const MAPPING_TTL_S = 30 * 24 * 3600; // 30 days in seconds
const LOCK_WAIT_MS = 800;           // wait before re-checking after contention
const LOCK_RETRY_CHECK_MS = 300;    // inner poll interval

// --- Upstash REST client (no SDK required, pure fetch) ---
// We implement our own thin client so we don't need to bundle @upstash/redis
// and to avoid any ESM/CJS issues in Vercel edge-compatible serverless.

interface UpstashResponse<T> {
  result: T | null;
  error?: string;
}

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function redisCommand<T>(
  ...args: (string | number)[]
): Promise<{ ok: true; result: T } | { ok: false; unavailable: boolean; error: string }> {
  const cfg = getRedisConfig();
  if (!cfg) {
    return { ok: false, unavailable: true, error: 'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured' };
  }

  const url = `${cfg.url}/${args.map(encodeURIComponent).join('/')}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, unavailable: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as UpstashResponse<T>;
    if (json.error) {
      return { ok: false, unavailable: false, error: json.error };
    }
    return { ok: true, result: json.result as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes('TimeoutError') || msg.includes('abort') || msg.includes('timeout');
    return { ok: false, unavailable: isTimeout, error: msg };
  }
}

// --- Key builders ---
export function mappingKey(orderId: string): string {
  return `idempotency:jumpseller:${orderId}`;
}

export function lockKey(orderId: string): string {
  return `lock:jumpseller:${orderId}`;
}

// --- Mapping operations ---

/**
 * Read existing deal mapping for a Jumpseller order.
 * Returns: dealId string if found, null if not found,
 * or { unavailable: true } if Redis is down.
 */
export async function readMapping(
  orderId: string
): Promise<{ found: true; dealId: string } | { found: false } | { unavailable: true; error: string }> {
  const key = mappingKey(orderId);
  const res = await redisCommand<string>('GET', key);
  if (!res.ok) {
    if (res.unavailable) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'redis_unavailable',
        sourceRef: `jumpseller:${orderId}`,
        op: 'readMapping',
        error: res.error,
      }));
      return { unavailable: true, error: res.error };
    }
    // Non-unavailability error (e.g. bad key type): treat as not found
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'redis_read_error',
      sourceRef: `jumpseller:${orderId}`,
      error: res.error,
    }));
    return { found: false };
  }
  if (res.result !== null && res.result !== undefined) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'cache_hit_redis',
      sourceRef: `jumpseller:${orderId}`,
      dealId: res.result,
      key,
    }));
    return { found: true, dealId: res.result };
  }
  return { found: false };
}

/**
 * Persist the orderId -> dealId mapping in Redis.
 * TTL: 30 days. Must be called before releasing the lock.
 */
export async function writeMapping(
  orderId: string,
  dealId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = mappingKey(orderId);
  // SET key value EX ttl
  const res = await redisCommand<string>('SET', key, String(dealId), 'EX', MAPPING_TTL_S);
  if (!res.ok) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'redis_write_mapping_failed',
      sourceRef: `jumpseller:${orderId}`,
      dealId,
      error: res.error,
    }));
    return { ok: false, error: res.error };
  }
  console.log(JSON.stringify({
    level: 'info',
    event: 'mapping_written',
    sourceRef: `jumpseller:${orderId}`,
    dealId,
    key,
    ttlDays: 30,
  }));
  return { ok: true };
}

// --- Distributed lock operations ---

/**
 * Acquire a distributed lock for the given order using SET NX PX.
 * Returns true if lock acquired, false if already held (contention),
 * or { unavailable: true } if Redis is not reachable.
 */
export async function acquireLock(
  orderId: string,
  lockValue: string
): Promise<{ acquired: true } | { acquired: false; contention: true } | { unavailable: true; error: string }> {
  const key = lockKey(orderId);
  // SET key value NX PX ttlMs
  const res = await redisCommand<string | null>('SET', key, lockValue, 'NX', 'PX', LOCK_TTL_MS);
  if (!res.ok) {
    if (res.unavailable) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'redis_unavailable',
        sourceRef: `jumpseller:${orderId}`,
        op: 'acquireLock',
        error: res.error,
      }));
      return { unavailable: true, error: res.error };
    }
    // Non-unavailability Redis error: treat as contention (safe default)
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'lock_acquire_error',
      sourceRef: `jumpseller:${orderId}`,
      error: res.error,
    }));
    return { acquired: false, contention: true };
  }
  if (res.result === 'OK') {
    console.log(JSON.stringify({
      level: 'info',
      event: 'lock_acquired',
      sourceRef: `jumpseller:${orderId}`,
      lockValue,
      ttlMs: LOCK_TTL_MS,
    }));
    return { acquired: true };
  }
  // SET NX returned null -> key already exists -> contention
  console.log(JSON.stringify({
    level: 'info',
    event: 'lock_contention',
    sourceRef: `jumpseller:${orderId}`,
    lockValue,
  }));
  return { acquired: false, contention: true };
}

/**
 * Release the distributed lock only if we still own it (compare-and-delete).
 * Uses a Lua script via EVAL to be atomic.
 */
export async function releaseLock(orderId: string, lockValue: string): Promise<void> {
  const key = lockKey(orderId);
  // Lua: if GET key == lockValue then DEL key end
  const script = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;
  const res = await redisCommand<number>('EVAL', script, '1', key, lockValue);
  if (!res.ok) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'lock_release_failed',
      sourceRef: `jumpseller:${orderId}`,
      error: res.error,
    }));
    return;
  }
  console.log(JSON.stringify({
    level: 'info',
    event: 'lock_released',
    sourceRef: `jumpseller:${orderId}`,
    released: res.result === 1,
  }));
}

// --- High-level idempotency check flow ---

export interface IdempotencyCheckResult {
  status:
    | 'proceed'                          // lock acquired, safe to create
    | 'duplicate'                        // mapping found in Redis
    | 'contention_resolved_duplicate'    // waited, mapping appeared
    | 'contention_unresolved'            // waited, no mapping: skip by contention
    | 'blocked';                         // Redis unavailable for creator event
  dealId?: number;                       // set when status === 'duplicate' | 'contention_resolved_duplicate'
  lockValue?: string;                    // set when status === 'proceed'
  error?: string;
}

/**
 * Full idempotency check for creator events (order_created).
 * Implements the 7-step flow from the spec.
 *
 * Caller MUST call releaseLock(orderId, lockValue) after deal creation
 * if status === 'proceed'.
 */
export async function checkIdempotencyForCreate(
  orderId: string
): Promise<IdempotencyCheckResult> {
  const sourceRef = `jumpseller:${orderId}`;

  // Step 1: Check mapping
  const mapping = await readMapping(orderId);
  if ('unavailable' in mapping) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'blocked_idempotency_unavailable',
      sourceRef,
      reason: 'Redis unavailable on initial mapping check',
    }));
    return { status: 'blocked', error: mapping.error };
  }
  if (mapping.found) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'duplicate_skipped',
      sourceRef,
      dealId: Number(mapping.dealId),
      reason: 'mapping found before lock attempt',
    }));
    return { status: 'duplicate', dealId: Number(mapping.dealId) };
  }

  // Step 2: Attempt lock
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lockResult = await acquireLock(orderId, lockValue);

  if ('unavailable' in lockResult) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'blocked_idempotency_unavailable',
      sourceRef,
      reason: 'Redis unavailable on lock attempt',
    }));
    return { status: 'blocked', error: lockResult.error };
  }

  if (lockResult.acquired) {
    // Step 3: Re-check mapping post-lock (guard against race)
    const postLockMapping = await readMapping(orderId);
    if ('unavailable' in postLockMapping) {
      // Release lock and block
      await releaseLock(orderId, lockValue);
      console.error(JSON.stringify({
        level: 'error',
        event: 'blocked_idempotency_unavailable',
        sourceRef,
        reason: 'Redis unavailable on post-lock mapping check',
      }));
      return { status: 'blocked', error: postLockMapping.error };
    }
    if (postLockMapping.found) {
      await releaseLock(orderId, lockValue);
      console.log(JSON.stringify({
        level: 'info',
        event: 'duplicate_skipped',
        sourceRef,
        dealId: Number(postLockMapping.dealId),
        reason: 'mapping found post-lock (race condition resolved)',
      }));
      return { status: 'duplicate', dealId: Number(postLockMapping.dealId) };
    }
    // Lock acquired, no mapping: safe to proceed
    return { status: 'proceed', lockValue };
  }

  // Lock not acquired: contention. Wait briefly then re-check.
  console.log(JSON.stringify({
    level: 'info',
    event: 'lock_contention',
    sourceRef,
    waitMs: LOCK_WAIT_MS,
  }));
  await sleep(LOCK_WAIT_MS);

  // Re-check mapping after wait
  const retryMapping = await readMapping(orderId);
  if ('unavailable' in retryMapping) {
    // Redis went down during wait: block
    console.error(JSON.stringify({
      level: 'error',
      event: 'blocked_idempotency_unavailable',
      sourceRef,
      reason: 'Redis unavailable after contention wait',
    }));
    return { status: 'blocked', error: retryMapping.error };
  }
  if (retryMapping.found) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'duplicate_skipped',
      sourceRef,
      dealId: Number(retryMapping.dealId),
      reason: 'mapping appeared after contention wait',
    }));
    return { status: 'contention_resolved_duplicate', dealId: Number(retryMapping.dealId) };
  }

  // Contention but no mapping appeared: skip safely
  console.log(JSON.stringify({
    level: 'info',
    event: 'lock_contention_unresolved',
    sourceRef,
    reason: 'no mapping after wait, skipping to avoid race',
  }));
  return { status: 'contention_unresolved' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { LOCK_WAIT_MS, LOCK_RETRY_CHECK_MS };
