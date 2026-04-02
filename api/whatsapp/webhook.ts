// api/whatsapp/webhook.ts
// POST /api/whatsapp/webhook
// Recibe mensajes WhatsApp via Twilio. Valida firma, orquesta flowEngine,
// llama Claude para parsing, crea deal en Pipedrive y notifica si aplica.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateTwilioSignature, parseTwilioBody, buildTwiML } from '../_lib/whatsapp/twilio.js';
import { getHistory, addTurn } from '../_lib/whatsapp/conversation.js';
import { askClaude } from '../_lib/whatsapp/claudeAgent.js';
import { evaluateLeadSignals } from '../_lib/whatsapp/leadCapture.js';
import { ensureWhatsAppDeal } from '../_lib/whatsapp/pipedriveLead.js';
import { notifyTeam } from '../_lib/whatsapp/notify.js';
import { processFlowStep, getFlowState, MSG_MEDIA } from '../_lib/whatsapp/flowEngine.js';

const LOG_PREFIX = '[whatsapp/webhook]';

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
        res.status(200).send(buildTwiML(MSG_MEDIA));
        return;
  }

  if (!body.trim()) {
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(buildTwiML('Hola! No recibimos tu mensaje. Puedes escribirlo de nuevo?'));
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

  const flowResult = processFlowStep(phone, body, claudeParsed, signals);

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

  addTurn(phone, { role: 'user', content: body });
    addTurn(phone, { role: 'assistant', content: flowResult.reply });

  let dealResult: { dealId?: number; personId?: number; action: 'created' | 'found' | 'skipped' } = {
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

  const wantsHuman = flowResult.wantsHuman || signals.wantsHuman;
    const shouldNotify = dealResult.action === 'created' || wantsHuman;

  if (shouldNotify) {
        try {
                await notifyTeam({
                          phone,
                          name: profileName || phone,
                          message: body,
                          summary: claudeSummary,
                          dealId: dealResult.dealId,
                          personId: dealResult.personId,
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
    res.status(200).send(buildTwiML(flowResult.reply));
}
