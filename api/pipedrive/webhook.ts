// api/pipedrive/webhook.ts
// Webhook receiver for Pipedrive events.
// Handles deal stage changes and deal status updates (won/lost).
// Can trigger downstream actions: notifications, Jumpseller sync, etc.
//
// Auth: validates HTTP Basic Auth (Authorization header) using
// PIPEDRIVE_WEBHOOK_USER and PIPEDRIVE_WEBHOOK_PASSWORD.
// Configure those same credentials in Pipedrive when registering the webhook
// (http_auth_user / http_auth_password fields).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const LOG_PREFIX = '[pipedrive/webhook]';

// --- Types (v2 payload structure) ---

interface PipedriveDealWebhook {
  v: number;
  event: string;       // e.g. 'updated.deal', 'added.deal'
  retry: number;
  current: PipedriveDealData;
  previous: PipedriveDealData | null;
  meta: {
    action: string;    // 'updated', 'added', 'deleted'
    object: string;    // 'deal'
    id: number;
    company_id: number;
    user_id: number;
    timestamp: number;
  };
}

interface PipedriveDealData {
  id: number;
  title: string;
  status: string;       // 'open', 'won', 'lost', 'deleted'
  stage_id: number;
  pipeline_id: number;
  person_id: number | null;
  org_id: number | null;
  value: number;
  currency: string;
  [key: string]: unknown;
}

// --- Basic Auth validator ---

function validateBasicAuth(req: VercelRequest): 'ok' | 'unauthorized' | 'misconfigured' {
  const user = process.env.PIPEDRIVE_WEBHOOK_USER;
  const password = process.env.PIPEDRIVE_WEBHOOK_PASSWORD;

  if (!user || !password) {
    return 'misconfigured';
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return 'unauthorized';
  }

  const expected = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  if (authHeader.length !== expected.length) return 'unauthorized';
  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  const valid = crypto.timingSafeEqual(authBuf, expectedBuf);
  return valid ? 'ok' : 'unauthorized';
}

// --- Event processors ---

async function handleDealStageChange(
  current: PipedriveDealData,
  previous: PipedriveDealData | null,
): Promise<{ action: string }> {
  const oldStage = previous?.stage_id;
  const newStage = current.stage_id;

  console.log(
    `${LOG_PREFIX} Deal ${current.id} stage changed: ${oldStage} -> ${newStage}`,
  );

  // TODO: Add logic for specific stage transitions
  // e.g., moving to "proposal sent" stage could trigger an email notification
  // e.g., moving to "negotiation" stage could update Jumpseller order status

  return { action: 'stage_change_logged' };
}

async function handleDealStatusChange(
  current: PipedriveDealData,
  previous: PipedriveDealData | null,
): Promise<{ action: string }> {
  const oldStatus = previous?.status;
  const newStatus = current.status;

  console.log(
    `${LOG_PREFIX} Deal ${current.id} status changed: ${oldStatus} -> ${newStatus}`,
  );

  if (newStatus === 'won') {
    // TODO: Trigger order confirmation in Jumpseller, send thank-you email, etc.
    console.log(`${LOG_PREFIX} Deal ${current.id} won - value: ${current.value} ${current.currency}`);
    return { action: 'deal_won_processed' };
  }

  if (newStatus === 'lost') {
    // TODO: Trigger lost-deal follow-up sequence
    console.log(`${LOG_PREFIX} Deal ${current.id} lost`);
    return { action: 'deal_lost_processed' };
  }

  return { action: 'status_change_logged' };
}

// --- Main handler ---

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Validate HTTP Basic Auth
  const authResult = validateBasicAuth(req);
  if (authResult === 'misconfigured') {
    console.error(`${LOG_PREFIX} PIPEDRIVE_WEBHOOK_USER or PIPEDRIVE_WEBHOOK_PASSWORD not configured`);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (authResult === 'unauthorized') {
    console.warn(`${LOG_PREFIX} Unauthorized request`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const body = req.body as PipedriveDealWebhook;
    const { meta, current, previous } = body;

    // Only handle deal events for now
    if (meta.object !== 'deal') {
      console.log(`${LOG_PREFIX} Ignoring ${meta.object} event`);
      res.status(200).json({ success: true, action: 'ignored', reason: `Object type ${meta.object} not handled` });
      return;
    }

    // Only process deals in our pipeline
    const pipelineId = Number(process.env.PIPEDRIVE_PIPELINE_ID);
    if (pipelineId && current.pipeline_id !== pipelineId) {
      console.log(`${LOG_PREFIX} Ignoring deal ${current.id} - pipeline ${current.pipeline_id} !== ${pipelineId}`);
      res.status(200).json({ success: true, action: 'ignored', reason: 'Different pipeline' });
      return;
    }

    let result: { action: string };

    // Detect what changed
    const stageChanged = previous && current.stage_id !== previous.stage_id;
    const statusChanged = previous && current.status !== previous.status;

    if (statusChanged) {
      result = await handleDealStatusChange(current, previous);
    } else if (stageChanged) {
      result = await handleDealStageChange(current, previous);
    } else {
      console.log(`${LOG_PREFIX} Deal ${current.id} updated - no stage/status change`);
      result = { action: 'update_logged' };
    }

    res.status(200).json({
      success: true,
      dealId: current.id,
      ...result,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} Error processing webhook:`, err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
