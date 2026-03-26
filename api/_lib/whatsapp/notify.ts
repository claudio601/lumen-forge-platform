// api/_lib/whatsapp/notify.ts
// Notificacion interna cuando un lead califica o pide hablar con un ejecutivo.
//
// v1 — sin dependencias nuevas. Dos mecanismos:
//   1. Logging estructurado siempre (visible en Vercel Functions logs).
//   2. Actividad Pipedrive (followup_24h) sobre el deal — usa activities.ts
//      que ya existe en el repo. El ejecutivo la ve en su cola de tareas.
//      Solo se crea si tenemos dealId y personId (ambos disponibles desde
//      ensureWhatsAppDeal() despues del ajuste de WhatsAppDealResult).
//
// No se agrega Resend ni ningun proveedor externo nuevo.

import { createActivity } from '../pipedrive/activities.js';

const LOG_PREFIX = '[notify]';

export interface NotifyParams {
    phone: string;
    name: string;
    message: string;
    summary: string;
    dealId?: number;    // disponible cuando pipedriveLead creo o encontro el deal
  personId?: number;  // disponible desde WhatsAppDealResult.personId
}

export async function notifyTeam(params: NotifyParams): Promise<void> {
    const { phone, name, message, summary, dealId, personId } = params;

  // 1. Log estructurado — siempre, visible en Vercel dashboard
  console.log(
        `${LOG_PREFIX} [LEAD CALIFICADO] nombre="${name}" tel="${phone}" ` +
        `deal=${dealId ?? 'n/a'} person=${personId ?? 'n/a'} ` +
        `resumen="${summary.substring(0, 120)}" msg="${message.substring(0, 80)}"`,
      );

  // 2. Actividad Pipedrive (seguimiento 24h) — requiere dealId y personId
  if (!dealId || !personId) {
        console.log(`${LOG_PREFIX} Sin dealId o personId — solo log, sin actividad Pipedrive`);
        return;
  }

  const userId = parseInt(process.env.PIPEDRIVE_OWNER_USER_ID ?? '0', 10);
    if (!userId) {
          console.warn(`${LOG_PREFIX} PIPEDRIVE_OWNER_USER_ID no configurado — sin actividad`);
          return;
    }

  // quoteReference estable para el subject de la actividad
  const quoteReference = `WA-${phone.replace(/\D/g, '')}`;

  try {
        const activity = await createActivity({
                dealId,
                personId,
                userId,
                type: 'followup_24h',
                quoteReference,
        });
        console.log(`${LOG_PREFIX} Actividad Pipedrive creada: ${activity.activityId}`);
  } catch (err) {
        // No es fatal — el bot ya respondio al cliente
      console.error(`${LOG_PREFIX} Error creando actividad Pipedrive:`, err);
  }
}
