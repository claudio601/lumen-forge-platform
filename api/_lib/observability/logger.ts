import { Axiom } from '@axiomhq/js';

// Singleton instance
let axiomClient: Axiom | null = null;

function getClient(): Axiom | null {
  if (axiomClient) return axiomClient;

  const token = process.env.AXIOM_TOKEN;
  if (!token) {
    // Axiom not configured — fail silent, fallback to console
    return null;
  }

  axiomClient = new Axiom({
    token,
    orgId: process.env.AXIOM_ORG_ID, // optional
  });

  return axiomClient;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  source: string; // ej. 'jumpseller-webhook', 'whatsapp-bridge'
  event?: string; // ej. 'order_created', 'lookup_failed'
  dealId?: number;
  orderId?: string;
  userId?: string | number;
  [key: string]: unknown; // Allow arbitrary fields
}

export async function log(
  level: LogLevel,
  message: string,
  context: LogContext
): Promise<void> {
  const dataset = process.env.AXIOM_DATASET;
  const timestamp = new Date().toISOString();

  const event = {
    _time: timestamp,
    level,
    message,
    ...context,
    environment: process.env.VERCEL_ENV || 'development',
    deployment_url: process.env.VERCEL_URL,
  };

  // Always log to console as fallback (Vercel logs)
  const consoleFn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  consoleFn(JSON.stringify(event));

  // Also send to Axiom if configured
  const client = getClient();
  if (!client || !dataset) return;

  try {
    await client.ingest(dataset, [event]);
  } catch (err) {
    // Don't fail the request if Axiom is down
    console.error('[axiom-logger] failed to send log to Axiom:', err);
  }
}

// Convenience functions
export const logger = {
  debug: (msg: string, ctx: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx: LogContext) => log('error', msg, ctx),
};
