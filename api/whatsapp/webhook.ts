// api/whatsapp/webhook.ts
// POST /api/whatsapp/webhook
// Recibe mensajes WhatsApp via Twilio. Valida firma, llama Claude,
// combina con heuristicas, crea deal en Pipedrive y notifica si aplica.
//
// Body: application/x-www-form-urlencoded (formato estandar Twilio).
// bodyParser: false — leemos raw body para validar X-Twilio-Signature.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateTwilioSignature, parseTwilioBody, buildTwiML } from '../_lib/whatsapp/twilio.js';
import { getHistory, addTurn } from '../_lib/whatsapp/conversation.js';
import { askClaude, FALLBACK_REPLY } from '../_lib/whatsapp/claudeAgent.js';
import { evaluateLeadSignals } from '../_lib/whatsapp/leadCapture.js';
import { ensureWhatsAppDeal } from '../_lib/whatsapp/pipedriveLead.js';
import { notifyTeam } from '../_lib/whatsapp/notify.js';h

const LOG_PREFIX = '[whatsapp/webhook]';

// Requerido: Twilio envia application/x-www-form-urlencoded
// y la validacion de firma necesita el raw body sin parsear.
export const config = { api: { bodyParser: false } };

// Mismo patron que api/jumpseller/webhook.ts
function readRawBody(req: VercelRequest): Promise<Buffer> {
    return new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
    });
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse,
  ): Promise<void> {
    if (req.method !== 'POST') {
          res.status(405).end();
          return;
    }

  // 1. Raw body
  let rawBody: Buffer;
    try {
          rawBody = await readRawBody(req);
    } catch {
          console.error(`${LOG_PREFIX} Failed to read body`);
          res.status(400).end();
          return;
    }

  // 2. Parsear urlencoded -> objeto para validar firma y leer campos
  const params = parseTwilioBody(rawBody.toString('utf-8'));

  // 3. Validar X-Twilio-Signature
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
    const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook`;
    const twilioSig = (req.headers['x-twilio-signature'] as string) ?? '';

  const skipValidation = process.env.TWILIO_SKIP_VALIDATION === 'true';
    if (!skipValidation) {
          if (!validateTwilioSignature(authToken, webhookUrl, params, twilioSig)) {
                  console.warn(`${LOG_PREFIX} Invalid Twilio signature — url: ${webhookUrl}`);
                  res.status(403).end();
                  return;
          }
    }

  // 4. Extraer campos del payload Twilio
  const from        = params['From'] ?? '';          // "whatsapp:+56912345678"
  const body        = params['Body'] ?? '';
    const profileName = params['ProfileName'] ?? '';
    const messageSid  = params['MessageSid'] ?? '';
    const numMedia    = parseInt(params['NumMedia'] ?? '0', 10);

  if (!from) {
        res.status(400).end();
        return;
  }

  const phone = from.replace('whatsapp:', '');

  // 5. Media sin texto — respuesta util, sin procesar adjuntos en v1
  if (numMedia > 0 && body.trim().length < 3) {
        console.log(`${LOG_PREFIX} Media message from ${phone} [${messageSid}] — no text body`);
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(
                buildTwiML(
                          'Recibimos tu imagen o archivo, gracias. ' +
                          'Por ahora atendemos mejor por texto: ' +
                          'cuentanos que producto necesitas, para que proyecto y que cantidad aproximada, ' +
                          'y te ayudamos de inmediato.',
                        ),
              );
        return;
  }

  if (!body.trim()) {
        console.warn(`${LOG_PREFIX} Empty body from ${phone} [${messageSid}]`);
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(
                buildTwiML('Hola! No recibimos tu mensaje. Puedes escribirlo de nuevo?'),
              );
        return;
  }

  console.log(`${LOG_PREFIX} msg from ${phone} [${messageSid}]: "${body.substring(0, 80)}"`);

  // 6. Heuristica — corre SIEMPRE, antes de Claude
  const signals = evaluateLeadSignals(body);

  // 7. Historial conversacional (en memoria, limite 12 turns)
  const history = getHistory(phone);

  // 8. Claude
  let claudeReply: string;
    let claudeSummary: string;
    let claudeDeal: boolean;
    let claudeNotify: boolean;

  try {
        const result = await askClaude(history, body, profileName);
        claudeReply   = result.reply;
        claudeSummary = result.summary;
        claudeDeal    = result.shouldCreateDeal;
        claudeNotify  = result.shouldNotify;
        console.log(
                `${LOG_PREFIX} Claude ok — deal: ${claudeDeal}, notify: ${claudeNotify}, ` +
                `heuristic deal: ${signals.qualifiesForDeal}, human: ${signals.wantsHuman}`,
              );
  } catch (err) {
        console.error(`${LOG_PREFIX} Claude failed:`, err);
        claudeReply   = FALLBACK_REPLY;
        claudeSummary = `Consulta de ${profileName || phone}: "${body}"`;
        claudeDeal    = false;
        claudeNotify  = false;
  }

  // 9. Combinar Claude + heuristica (OR conservador)
  const wantsHuman = claudeNotify || signals.wantsHuman;
  const shouldCreateDeal = claudeDeal || signals.qualifiesForDeal || wantsHuman;

  // 10. Guardar turno en historial
  addTurn(phone, { role: 'user', content: body });
    addTurn(phone, { role: 'assistant', content: claudeReply });

  // 11. Deal en Pipedrive si califica
  let dealResult: { dealId?: number; personId?: number; action: 'created' | 'found' | 'skipped' } =
  { action: 'skipped' };
    if (shouldCreateDeal) {
          try {
                  dealResult = await ensureWhatsAppDeal({
                            phone,
                            name: profileName || phone,
                            summary: claudeSummary,
                            body,
                  });
          } catch (err) {
                  console.error(`${LOG_PREFIX} Pipedrive error (non-fatal):`, err);
          }
    }

  // 12. Notificar al equipo — regla v1:
  //     - deal recien creado (action === 'created'), O
  //     - cliente pide hablar con una persona (wantsHuman === true)
  //     No notificar si el deal ya existia (found) ni si no califica (skipped)
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
                  console.error(`${LOG_PREFIX} Notify error (non-fatal):`, err);
          }
    }

  // 13. Responder con TwiML
  res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(buildTwiML(claudeReply));
}
