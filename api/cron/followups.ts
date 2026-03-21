// api/cron/followups.ts
// Cron job: create follow-up activities for open deals.
// Deduplication: uses deal custom fields (followup24Created, followup72Created)
// as flags so activities are never duplicated.
//
// Expected schedule: every hour (via Vercel Cron or external trigger).
// Auth: CRON_SECRET header must match env var.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pipedriveGet, pipedrivePut } from '../../src/lib/pipedrive/client';
import { createActivity } from '../../src/lib/pipedrive/activities';
import { initFieldOptions } from '../../src/lib/pipedrive/fieldOptions';

const LOG_PREFIX = '[cron/followups]';

// --- Types ---

interface PipedriveDeal {
  id: number;
  person_id: { value: number } | null;
  org_id: { value: number } | null;
  title: string;
  add_time: string;
  [key: string]: unknown;
}

interface FollowUpConfig {
  label: string;
  hoursAfterCreation: number;
  flagEnvVar: string;
  subject: string;
  note: string;
}

// --- Follow-up definitions ---

const FOLLOW_UPS: FollowUpConfig[] = [
  {
    label: '24h',
    hoursAfterCreation: 24,
    flagEnvVar: 'PIPEDRIVE_DEAL_FIELD_FOLLOWUP_24',
    subject: 'Seguimiento 24h — Cotización',
    note: 'Han pasado 24 horas desde la cotización. Contactar al cliente para resolver dudas.',
  },
  {
    label: '72h',
    hoursAfterCreation: 72,
    flagEnvVar: 'PIPEDRIVE_DEAL_FIELD_FOLLOWUP_72',
    subject: 'Seguimiento 72h — Cotización',
    note: 'Han pasado 72 horas sin respuesta. Ofrecer alternativas o descuento si aplica.',
  },
];

// --- Helpers ---

function hoursSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60);
}

async function markFollowUpCreated(
  dealId: number,
  fieldKey: string,
): Promise<void> {
  await pipedrivePut(`/deals/${dealId}`, {
    [fieldKey]: new Date().toISOString().slice(0, 10),
  });
}

// --- Main handler ---

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Only allow POST (Vercel Cron) or GET (manual trigger)
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Auth
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const pipelineId = process.env.PIPEDRIVE_PIPELINE_ID;
  if (!pipelineId) {
    res.status(500).json({ error: 'PIPEDRIVE_PIPELINE_ID not configured' });
    return;
  }

  try {
    await initFieldOptions();

    // Fetch open deals in the target pipeline
    const dealsRes = await pipedriveGet('/deals', {
      status: 'open',
      pipeline_id: pipelineId,
      limit: '500',
    });

    const deals: PipedriveDeal[] = dealsRes?.data ?? [];
    console.log(`${LOG_PREFIX} Found ${deals.length} open deals in pipeline ${pipelineId}`);

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const deal of deals) {
      const elapsed = hoursSince(deal.add_time);

      for (const fu of FOLLOW_UPS) {
        // Skip if not enough time has passed
        if (elapsed < fu.hoursAfterCreation) continue;

        // Resolve the custom field key for this flag
        const flagKey = process.env[fu.flagEnvVar];
        if (!flagKey) {
          console.warn(`${LOG_PREFIX} Missing env var ${fu.flagEnvVar}, skipping ${fu.label} for all deals`);
          continue;
        }

        // Check if already flagged
        const flagValue = deal[flagKey];
        if (flagValue) {
          skipped++;
          continue;
        }

        // Create the follow-up activity
        try {
          const personId = deal.person_id?.value;
          const orgId = deal.org_id?.value;

          await createActivity({
            subject: `${fu.subject} — ${deal.title}`,
            type: process.env.PIPEDRIVE_ACTIVITY_TYPE || 'task',
            dealId: deal.id,
            personId,
            orgId,
            note: fu.note,
            dueDate: new Date().toISOString().slice(0, 10),
            userId: Number(process.env.PIPEDRIVE_OWNER_USER_ID) || undefined,
          });

          // Mark the flag on the deal
          await markFollowUpCreated(deal.id, flagKey);

          console.log(`${LOG_PREFIX} Created ${fu.label} activity for deal ${deal.id}`);
          created++;
        } catch (err) {
          const msg = `Deal ${deal.id} / ${fu.label}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`${LOG_PREFIX} ${msg}`);
          errors.push(msg);
        }
      }
    }

    const summary = {
      success: true,
      dealsProcessed: deals.length,
      activitiesCreated: created,
      skipped,
      errors: errors.length,
    };

    console.log(`${LOG_PREFIX} Finished —`, JSON.stringify(summary));
    res.status(200).json(summary);
  } catch (err) {
    console.error(`${LOG_PREFIX} Fatal error:`, err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
