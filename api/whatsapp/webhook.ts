// api/whatsapp/webhook.ts
// POST /api/whatsapp/webhook
// Recibe mensajes WhatsApp via Twilio. Valida firma, orquesta flowEngine,
// llama Claude para parsing, crea deal en Pipedrive y notifica si aplica.
// [CIERRE-HONESTO] Los cierres que dicen "quedo registrada" o "ya derive" solo salen si
// Pipedrive confirma el negocio; si no, el texto B (MSG_DEAL_FAILED). Si el paso del flujo
// falla, se responde igual (texto B) en vez de un 500 sin respuesta. Los mensajes de un mismo
// numero se atienden de a uno (ver acquirePhoneTurn).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateTwilioSignature, parseTwilioBody, buildTwiML } from '../_lib/whatsapp/twilio.js';
import { getHistory, addTurn } from '../_lib/whatsapp/conversation.js';
import { askClaude } from '../_lib/whatsapp/claudeAgent.js';
import { evaluateLeadSignals } from '../_lib/whatsapp/leadCapture.js';
import { ensureWhatsAppDeal } from '../_lib/whatsapp/pipedriveLead.js';
import { notifyTeam } from '../_lib/whatsapp/notify.js';
import { processFlowStep, getFlowState, recordDealOutcome, MSG_MEDIA, MSG_DEAL_FAILED } from '../_lib/whatsapp/flowEngine.js';
import type { FlowResult } from '../_lib/whatsapp/flowEngine.js';
import { withPrivacyNotice } from '../_lib/whatsapp/privacyNotice.js';

const LOG_PREFIX = '[whatsapp/webhook]';

/**
 * [CIERRE-HONESTO] Un mensaje a la vez por numero, en esta instancia: el paso del flujo, la
 * creacion del negocio y la anotacion de lo que respondio Pipedrive de un mensaje terminan antes
 * de que el siguiente mensaje del mismo numero entre al flujo. Sin esto, un "gracias" que llega
 * mientras se crea el negocio no sabe si quedo registrado, y el resultado de un negocio podia
 * quedar anotado en un pedido nuevo. Claude corre antes, fuera de la fila. La espera termina,
 * a mas tardar, TURN_WAIT_DEADLINE_MS despues de que empezo este webhook (Twilio espera 15 s):
 * si el mensaje anterior todavia no termina, este sigue igual (flowEngine reintenta el registro).
 */
const TURN_WAIT_DEADLINE_MS = 10_000;
const phoneTurns = new Map<string, Promise<void>>();

async function acquirePhoneTurn(phone: string, maxWaitMs: number): Promise<() => void> {
    const previous = phoneTurns.get(phone);
    let release: () => void = () => {};
    const mine = new Promise<void>((resolve) => { release = resolve; });
    phoneTurns.set(phone, mine);
    if (previous && maxWaitMs > 0) {
          await new Promise<void>((resolve) => {
                  const timer = setTimeout(resolve, maxWaitMs);
                  void previous.then(() => { clearTimeout(timer); resolve(); });
          });
    }
    return () => {
          release();
          if (phoneTurns.get(phone) === mine) phoneTurns.delete(phone);
    };
}

type DealResult = { dealId?: number; personId?: number; action: 'created' | 'found' | 'skipped' };

interface FlowTurnInput {
    phone: string;
    body: string;
    profileName: string;
    claudeParsed: Parameters<typeof processFlowStep>[2];
    claudeSummary: string;
    signals: Parameters<typeof processFlowStep>[3];
    aiSource: 'claude' | 'heuristic';
}

/** Paso del flujo, negocio en Pipedrive e historial de un mensaje (dentro del turno del numero). */
async function runFlowTurn(t: FlowTurnInput): Promise<{ flowResult: FlowResult; dealResult: DealResult; reply: string }> {
  const { phone, body, profileName, claudeParsed, claudeSummary, signals, aiSource } = t;

  let flowResult: FlowResult;
    try {
          flowResult = processFlowStep(phone, body, claudeParsed, signals);
    } catch (err) {
          // [CIERRE-HONESTO] Respuesta segura: nada quedo registrado, se ofrece ventas@ (texto B).
          console.error(LOG_PREFIX + ' Flow error (respuesta segura):', err);
          const stateNow = getFlowState(phone);
          flowResult = {
                  reply: MSG_DEAL_FAILED,
                  shouldCreateDeal: false,
                  shouldNotify: false,
                  captureStatus: stateNow.captureStatus,
                  captured: stateNow.captured,
                  wantsHuman: stateNow.wantsHuman,
                  closedFlow: false,
          };
    }
    // La conversacion que pidio el negocio (si mientras tanto empieza otra, el resultado no va ahi).
    const conversationId = getFlowState(phone).firstMessageAt;

  // Log de salida: resultado del flujo para QA
  console.log(LOG_PREFIX + ' [QA:out] ' + JSON.stringify({
        ai: aiSource,
        closed: flowResult.closedFlow,
        capture_status: flowResult.captureStatus,
        wants_human: flowResult.wantsHuman,
        slots_after: {
                producto: flowResult.captured.producto ?? null,
                tipo_de_luz: flowResult.captured.tipo_de_luz ?? null,
                cantidad: flowResult.captured.cantidad ?? null,
                proyecto_o_uso: flowResult.captured.proyecto_o_uso ?? null,
                comuna_o_ciudad: flowResult.captured.comuna_o_ciudad ?? null,
                nombre_o_empresa: flowResult.captured.nombre_o_empresa ?? null,
                correo: flowResult.captured.correo ?? null,
        },
        reply_preview: flowResult.reply.substring(0, 60).replace(/\n/g, ' '),
  }));

  let dealResult: DealResult = {
        action: 'skipped',
  };

  if (flowResult.shouldCreateDeal) {
        try {
                dealResult = await ensureWhatsAppDeal({
                          phone,
                          name: profileName || phone,
                          summary: claudeSummary,
                          body,
                          captured: flowResult.captured,
                          captureStatus: flowResult.captureStatus,
                          wantsHuman: flowResult.wantsHuman,
                });
        } catch (err) {
                console.error(LOG_PREFIX + ' Pipedrive error (non-fatal):', err);
        }
  }

  // [CIERRE-HONESTO] El cierre solo afirma el registro si Pipedrive devolvio el negocio.
  let reply = flowResult.reply;
    if (flowResult.shouldCreateDeal) {
          const registered = (dealResult.action === 'created' || dealResult.action === 'found') && typeof dealResult.dealId === 'number';
          recordDealOutcome(phone, registered, conversationId);
          if (!registered) {
                  console.warn(LOG_PREFIX + ' Negocio no confirmado (' + dealResult.action + ') — respondiendo MSG_DEAL_FAILED');
                  reply = MSG_DEAL_FAILED;
          }
    }

  addTurn(phone, { role: 'user', content: body });
    addTurn(phone, { role: 'assistant', content: reply });

  return { flowResult, dealResult, reply };
}

export const config = { api: { bodyParser: false } };

function readRawBody(req: VercelRequest): Promise<Buffer> {
    return new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    const startedAt = Date.now(); // plazo de Twilio para el aviso de privacidad (privacyNotice.ts)
    if (req.method !== 'POST') {
          res.status(405).end();
          return;
    }

  let rawBody: Buffer;
    try {
          rawBody = await readRawBody(req);
    } catch {
          console.error(LOG_PREFIX + ' Failed to read body');
          res.status(400).end();
          return;
    }

  const params = parseTwilioBody(rawBody.toString('utf-8'));
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
    const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
    const webhookUrl = baseUrl + '/api/whatsapp/webhook';
    const twilioSig = (req.headers['x-twilio-signature'] as string) ?? '';
    const skipValidation = process.env.TWILIO_SKIP_VALIDATION === 'true';

  if (!skipValidation) {
        if (!validateTwilioSignature(authToken, webhookUrl, params, twilioSig)) {
                console.warn(LOG_PREFIX + ' Invalid Twilio signature');
                res.status(403).end();
                return;
        }
  }

  const from = params['From'] ?? '';
    const body = params['Body'] ?? '';
    const profileName = params['ProfileName'] ?? '';
    const messageSid = params['MessageSid'] ?? '';
    const numMedia = parseInt(params['NumMedia'] ?? '0', 10);

  if (!from) {
        res.status(400).end();
        return;
  }

  const phone = from.replace('whatsapp:', '');

  if (numMedia > 0 && body.trim().length < 3) {
        console.log(LOG_PREFIX + ' Media from ' + phone + ' [' + messageSid + ']');
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(buildTwiML(withPrivacyNotice(phone, MSG_MEDIA, startedAt)));
        return;
  }

  if (!body.trim()) {
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(buildTwiML(withPrivacyNotice(phone, 'Hola! No recibimos tu mensaje. Puedes escribirlo de nuevo?', startedAt)));
        return;
  }

  // Log de entrada: mensaje recibido + estado previo del flujo
  const stateIn = getFlowState(phone);
    console.log(LOG_PREFIX + ' msg from ' + phone + ' [' + messageSid + ']: "' + body.substring(0, 80) + '"');
    console.log(LOG_PREFIX + ' [QA:in] ' + JSON.stringify({
          stage: stateIn.stage,
          leadType: stateIn.leadType,
          repreg: { s1: stateIn.repreguntasStage1, s2: stateIn.repreguntasStage2, s3: stateIn.repreguntasStage3 },
          slots_prev: {
                  producto: stateIn.captured.producto ?? null,
                  tipo_de_luz: stateIn.captured.tipo_de_luz ?? null,
                  cantidad: stateIn.captured.cantidad ?? null,
                  proyecto_o_uso: stateIn.captured.proyecto_o_uso ?? null,
                  comuna_o_ciudad: stateIn.captured.comuna_o_ciudad ?? null,
          },
    }));

  const signals = evaluateLeadSignals(body);
    const history = getHistory(phone);

  // claudeParsed con tipo explícito alineado a lo que espera processFlowStep
  let claudeParsed: {
        producto?: string;
        tipo_de_luz?: string;
        cantidad?: string;
        proyecto_o_uso?: string;
        comuna_o_ciudad?: string;
        nombre?: string;
        empresa?: string;
        correo?: string;
        wantsHuman?: boolean;
        qualifiesForDeal?: boolean;
  } = {};
    let claudeSummary = 'Consulta de ' + (profileName || phone) + ': "' + body.substring(0, 80) + '"';
    let aiSource: 'claude' | 'heuristic' = 'heuristic';

  try {
        const result = await askClaude(history, body, profileName);
        claudeParsed = result.parsed;
        claudeSummary = result.summary;
        aiSource = 'claude';
        console.log(LOG_PREFIX + ' Claude ok — wantsHuman: ' + result.parsed.wantsHuman);
        // Log completo del parsing de Claude para QA
      console.log(LOG_PREFIX + ' [QA:claude] ' + JSON.stringify({
              producto: result.parsed.producto ?? null,
              tipo_de_luz: result.parsed.tipo_de_luz ?? null,
              cantidad: result.parsed.cantidad ?? null,
              proyecto_o_uso: result.parsed.proyecto_o_uso ?? null,
              comuna_o_ciudad: result.parsed.comuna_o_ciudad ?? null,
              nombre: result.parsed.nombre ?? null,
              empresa: result.parsed.empresa ?? null,
              correo: result.parsed.correo ?? null,
              wantsHuman: result.parsed.wantsHuman,
              qualifiesForDeal: result.parsed.qualifiesForDeal,
      }));
  } catch (err) {
        console.error(LOG_PREFIX + ' Claude failed (non-fatal — usando heuristica):', err);
  }

  // [CIERRE-HONESTO] Los mensajes de un numero entran al flujo de a uno (ver acquirePhoneTurn).
  const releaseTurn = await acquirePhoneTurn(phone, TURN_WAIT_DEADLINE_MS - (Date.now() - startedAt));
  let turn: Awaited<ReturnType<typeof runFlowTurn>>;
  try {
        turn = await runFlowTurn({ phone, body, profileName, claudeParsed, claudeSummary, signals, aiSource });
  } finally {
        releaseTurn();
  }
  const { flowResult, dealResult, reply } = turn;

  const wantsHuman = flowResult.wantsHuman || signals.wantsHuman;
    // 'found': el cierre se junto con el negocio abierto del mismo numero (ventana de 7 dias). Avisa
    // igual que un negocio nuevo: ventas recibe una tarea por cierre, como antes de la deduplicacion.
    const shouldNotify = dealResult.action === 'created' || dealResult.action === 'found' || wantsHuman;

  if (shouldNotify) {
        try {
                await notifyTeam({
                          phone,
                          name: profileName || phone,
                          message: body,
                          summary: claudeSummary,
                          dealId: dealResult.dealId,
                          personId: dealResult.personId,
                          existingDeal: dealResult.action === 'found',
                });
        } catch (err) {
                console.error(LOG_PREFIX + ' Notify error (non-fatal):', err);
        }
  }

  console.log(
        LOG_PREFIX +
          ' closed=' + flowResult.closedFlow +
          ' capture=' + flowResult.captureStatus +
          ' deal=' + dealResult.action +
          ' notify=' + shouldNotify,
      );

  res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(buildTwiML(withPrivacyNotice(phone, reply, startedAt)));
}
