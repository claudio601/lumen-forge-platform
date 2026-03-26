// api/_lib/whatsapp/twilio.ts
// Helpers para validar firma Twilio y construir TwiML.
// Usa el SDK oficial de Twilio para validateRequest.

import twilio from 'twilio';

/**
 * Parsea un body application/x-www-form-urlencoded en un objeto clave/valor.
 * Twilio envia siempre este content-type en webhooks de WhatsApp.
 */
export function parseTwilioBody(rawBody: string): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(rawBody)) {
          params[key] = value;
    }
    return params;
}

/**
 * Valida la firma X-Twilio-Signature.
 * @param authToken  TWILIO_AUTH_TOKEN
 * @param url        URL exacta del webhook (APP_BASE_URL + /api/whatsapp/webhook)
 * @param params     Objeto parseado del body urlencoded
 * @param signature  Valor del header X-Twilio-Signature
 */
export function validateTwilioSignature(
    authToken: string,
    url: string,
    params: Record<string, string>,
    signature: string,
  ): boolean {
    if (!authToken || !signature) return false;
    try {
          return twilio.validateRequest(authToken, signature, url, params);
    } catch (err) {
          console.error('[twilio] validateRequest threw:', err);
          return false;
    }
}

/**
 * Construye una respuesta TwiML minima con un mensaje de texto.
 * Twilio espera XML: <Response><Message>...</Message></Response>
 */
export function buildTwiML(message: string): string {
    const escaped = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${escaped}</Message></Response>`;
}
