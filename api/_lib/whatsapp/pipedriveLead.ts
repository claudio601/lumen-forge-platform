// api/_lib/whatsapp/pipedriveLead.ts
// Crea o reutiliza deal en Pipedrive para leads de WhatsApp.
// Reutiliza: findOrCreatePerson, findExistingDeal, createDeal, initFieldOptions.
//
// Deduplicacion v1:
//   - Persona: por telefono (exact_match) via findOrCreatePerson
//   - Deal:    quoteReference "WA-<digits>" via findExistingDeal
//              Si existe open deal -> devuelve 'found', no crea duplicado
//              Si no existe -> crea con action 'created'

import { findOrCreatePerson } from '../pipedrive/persons.js';
import { findExistingDeal, createDeal } from '../pipedrive/deals.js';
import { initFieldOptions } from '../pipedrive/fieldOptions.js';
import type { QuoteCustomer } from '../crm/types.js';

const LOG_PREFIX = '[pipedriveLead]';

export interface WhatsAppLeadParams {
    phone: string;    // numero limpio, e.g. "+56912345678"
  name: string;     // ProfileName de Twilio o el numero si no hay
  summary: string;  // generado por Claude
  body: string;     // mensaje original del cliente
}

export interface WhatsAppDealResult {
    dealId?: number;
    personId?: number;  // Ajuste: expuesto para que notify.ts pueda crear actividad Pipedrive
  action: 'created' | 'found' | 'skipped';
}

export async function ensureWhatsAppDeal(
    params: WhatsAppLeadParams,
  ): Promise<WhatsAppDealResult> {
    const { phone, name, summary } = params;

  const pipelineId = parseInt(process.env.PIPEDRIVE_PIPELINE_ID ?? '0', 10);
    const stageId = parseInt(process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID ?? '0', 10);

  if (!pipelineId || !stageId) {
        console.warn(
                `${LOG_PREFIX} PIPEDRIVE_PIPELINE_ID or PIPEDRIVE_STAGE_NEW_LEAD_ID not set — skipping`,
              );
        return { action: 'skipped' };
  }

  await initFieldOptions();

  // 1. Obtener o crear persona (dedup por telefono)
  const customer: QuoteCustomer = {
        name: name || phone,
        phone,
        preferredChannel: 'WhatsApp',
  };
    const { personId, action: personAction } = await findOrCreatePerson(customer);
    console.log(`${LOG_PREFIX} Person ${personId} (${personAction})`);

  // 2. Referencia estable: "WA-<digits>" — unica por numero de telefono
  //    Garantiza que no se creen multiples deals del mismo numero en v1
  const quoteReference = `WA-${phone.replace(/\D/g, '')}`;

  // 3. Buscar deal existente (idempotencia)
  const existing = await findExistingDeal({ quoteReference, personId, pipelineId });
    if (existing) {
          console.log(`${LOG_PREFIX} Deal already exists: ${existing.id}`);
          return { dealId: existing.id, personId, action: 'found' };
    }

  // 4. Crear nuevo deal
  const { dealId, action } = await createDeal({
        personId,
        pipelineId,
        stageId,
        title: `WhatsApp Lead — ${name || phone}`,
        quoteAmountClp: 0,
        sourceSystem: 'whatsapp',
        leadType: 'B2C',
        priorityTier: 'Normal',
        quoteReference,
        notes: summary,
  });

  console.log(`${LOG_PREFIX} Deal ${dealId} (${action}) for ${phone}`);
    return { dealId, personId, action: action === 'created' ? 'created' : 'found' };
}
