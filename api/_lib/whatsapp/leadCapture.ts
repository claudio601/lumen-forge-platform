// api/_lib/whatsapp/leadCapture.ts
// Heuristicas de intencion comercial para mensajes de WhatsApp.
// Corre SIEMPRE — su resultado se combina con la salida de Claude (OR conservador).

const LOG_PREFIX = '[leadCapture]';

// Palabras/patrones que indican intencion de compra o cotizacion
const DEAL_PATTERNS = [
    /cotiza/i,
    /cotizaci[oó]n/i,
    /precio/i,
    /cu[aá]nto (cuesta|vale|sale)/i,
    /proyecto/i,
    /cantidad/i,
    /comprar/i,
    /necesito \d+/i,
    /\d+\s*(unidades?|lumin|foco|reflector|panel|regleta|downlight|street\s*light)/i,
    /por mayor/i,
    /mayorista/i,
    /instalaci[oó]n/i,
    /obra/i,
    /licitaci[oó]n/i,
    /proveedor/i,
    /factura/i,
  ];

// Palabras/patrones que indican que quiere hablar con una persona
const HUMAN_PATTERNS = [
    /ejecutivo/i,
    /hablar con/i,
    /llamar/i,
    /persona/i,
    /asesor/i,
    /vendedor/i,
    /humano/i,
    /urgente/i,
  ];

export interface LeadSignals {
    qualifiesForDeal: boolean;
    wantsHuman: boolean;
    score: number; // 0-10, util para logs
}

/**
 * Evalua seniales comerciales en el mensaje.
 * Siempre se ejecuta — no es un fallback.
 */
export function evaluateLeadSignals(message: string): LeadSignals {
    const dealMatches = DEAL_PATTERNS.filter((p) => p.test(message)).length;
    const humanMatches = HUMAN_PATTERNS.filter((p) => p.test(message)).length;

  const qualifiesForDeal = dealMatches > 0;
    const wantsHuman = humanMatches > 0;
    const score = Math.min(dealMatches * 2 + humanMatches, 10);

  if (qualifiesForDeal || wantsHuman) {
        console.log(
                `${LOG_PREFIX} signals — deal: ${qualifiesForDeal}, human: ${wantsHuman}, score: ${score}`,
              );
  }

  return { qualifiesForDeal, wantsHuman, score };
}
