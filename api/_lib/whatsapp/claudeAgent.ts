// api/_lib/whatsapp/claudeAgent.ts
// Llama a Claude (claude-sonnet-4-6) con historial conversacional.
// Devuelve JSON estructurado: { reply, summary, shouldCreateDeal, shouldNotify }.

import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn } from './conversation.js';

const LOG_PREFIX = '[claudeAgent]';

export const FALLBACK_REPLY =
    'Hola! Gracias por escribirnos. En este momento no podemos responder ' +
    'automaticamente, pero un ejecutivo de eLights.cl te contactara pronto. ' +
    'Tambien puedes cotizar en nuevo.elights.cl';

export interface ClaudeResult {
    reply: string;
    summary: string;
    shouldCreateDeal: boolean;
    shouldNotify: boolean;
}

const SYSTEM_PROMPT = `Eres el asistente comercial de WhatsApp de eLights.cl.

eLights.cl es una empresa chilena especializada en iluminacion LED para uso industrial, comercial y exterior. Vende a constructoras, instaladores electricos, ingenieros, arquitectos, empresas y municipios en todo Chile. Productos principales: luminarias LED industriales (campanas, tubulares), iluminacion de exteriores (postes, proyectores, streetlights), paneles y downlights LED para oficinas y retail, y sistemas de iluminacion para bodegas y galpones.

Objetivo de este canal: captar leads, orientar la consulta hacia una cotizacion formal y escalar a un ejecutivo cuando el cliente este listo o lo pida.

Tu trabajo en cada mensaje:
1. Responder consultas de productos de forma util y breve.
2. Detectar si hay intencion comercial real (cotizacion, cantidad, proyecto, uso).
3. Invitar al cliente a cotizar formalmente en nuevo.elights.cl.
4. Escalar a ejecutivo humano cuando corresponda.

Reglas estrictas:
- Responde SIEMPRE en espanol de Chile. Tono: directo, profesional, amable.
- NO inventes stock, plazos de entrega, fichas tecnicas ni precios exactos.
- Si preguntan precio, orienta a cotizar formalmente; no des cifras inventadas.
- Maximo 2 preguntas concretas por mensaje.
- Si quiere cotizar: busca obtener categoria de producto, cantidad aproximada, comuna y uso del proyecto.
- Si pide hablar con una persona o ejecutivo: marca shouldNotify true.
- Respuestas cortas: 2 a 5 lineas maximo.
- Sitio de cotizacion: nuevo.elights.cl

Devuelve UNICAMENTE JSON valido con exactamente estas 4 claves:
{
  "reply": "mensaje para el cliente",
    "summary": "resumen interno breve del lead y su necesidad",
      "shouldCreateDeal": true,
        "shouldNotify": false
        }`;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
    if (!_client) {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) throw new Error('[claudeAgent] ANTHROPIC_API_KEY is not set');
          _client = new Anthropic({ apiKey });
    }
    return _client;
}

export async function askClaude(
    history: ConversationTurn[],
    newMessage: string,
    profileName: string,
  ): Promise<ClaudeResult> {
    const client = getClient();

  const messages: Anthropic.MessageParam[] = [
        ...history.map((t) => ({
                role: t.role as 'user' | 'assistant',
                content: t.content,
        })),
    {
            role: 'user' as const,
            content: profileName ? `[Cliente: ${profileName}]\n${newMessage}` : newMessage,
    },
      ];

  const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages,
  });

  const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
          throw new Error(`${LOG_PREFIX} No text block in response`);
    }

  const rawText = textBlock.text.trim();

  // Extraer JSON aunque venga envuelto en ```json ... ```
  let jsonStr = rawText;
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1];

  let parsed: ClaudeResult;
    try {
          parsed = JSON.parse(jsonStr) as ClaudeResult;
    } catch {
          console.warn(`${LOG_PREFIX} Response was not valid JSON — using raw text as reply`);
          return {
                  reply: rawText.substring(0, 500),
                  summary: `Consulta: "${newMessage.substring(0, 100)}"`,
                  shouldCreateDeal: false,
                  shouldNotify: false,
          };
    }

  // Sanity checks
  if (typeof parsed.reply !== 'string' || !parsed.reply) parsed.reply = FALLBACK_REPLY;
    if (typeof parsed.summary !== 'string') parsed.summary = '';
    if (typeof parsed.shouldCreateDeal !== 'boolean') parsed.shouldCreateDeal = false;
    if (typeof parsed.shouldNotify !== 'boolean') parsed.shouldNotify = false;

  return parsed;
}
