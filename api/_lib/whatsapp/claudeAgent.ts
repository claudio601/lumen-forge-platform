// api/_lib/whatsapp/claudeAgent.ts
// NUEVO ROL v1: Claude solo hace PARSING de campos y señal comercial.
// El control del flujo queda en flowEngine.ts (determinístico).
import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn } from './conversation.js';
const LOG_PREFIX = '[claudeAgent]';
export const FALLBACK_REPLY = 'Hola! Gracias por escribirnos. Un ejecutivo de eLights.cl te contactara pronto.';
export interface ClaudeParsed {
  producto?: string;
  tipo_de_luz?: string;
  cantidad?: string;
  proyecto_o_uso?: string;
  comuna_o_ciudad?: string;
  nombre?: string;
  empresa?: string;
  correo?: string;
  wantsHuman: boolean;
  qualifiesForDeal: boolean;
  summary: string;
}
export interface ClaudeResult {
  reply: string;
  summary: string;
  shouldCreateDeal: boolean;
  shouldNotify: boolean;
  parsed: ClaudeParsed;
}
const SYSTEM_PROMPT = 'Eres el extractor de datos del bot WhatsApp de eLIGHTS.cl. ' +
  'Analiza el mensaje y extrae campos en JSON. NO redactes respuestas para el cliente. ' +
  'Devuelve UNICAMENTE JSON con: producto, tipo_de_luz, cantidad, proyecto_o_uso, ' +
  'comuna_o_ciudad, nombre, empresa, correo (null si no aplica), ' +
  'wantsHuman (boolean), qualifiesForDeal (boolean), summary (string 1-2 lineas).';
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
    ...history.map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content })),
    { role: 'user' as const, content: profileName ? '[Cliente: ' + profileName + ']' + newMessage : newMessage },
  ];
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages,
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error(LOG_PREFIX + ' No text block');
  const rawText = textBlock.text.trim();
  let jsonStr = rawText;
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) jsonStr = fenceMatch[1];
  let parsed: ClaudeParsed;
  try {
    const raw = JSON.parse(jsonStr) as Record<string, unknown>;
    parsed = {
      producto: raw.producto as string | undefined,
      tipo_de_luz: raw.tipo_de_luz as string | undefined,
      cantidad: raw.cantidad as string | undefined,
      proyecto_o_uso: raw.proyecto_o_uso as string | undefined,
      comuna_o_ciudad: raw.comuna_o_ciudad as string | undefined,
      nombre: raw.nombre as string | undefined,
      empresa: raw.empresa as string | undefined,
      correo: raw.correo as string | undefined,
      wantsHuman: Boolean(raw.wantsHuman),
      qualifiesForDeal: Boolean(raw.qualifiesForDeal),
      summary: (raw.summary as string) || 'Consulta de ' + (profileName || 'cliente') + ': "' + newMessage.substring(0, 80) + '"',
    };
  } catch {
    console.warn(LOG_PREFIX + ' Response not valid JSON — usando defaults');
    parsed = { wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + newMessage.substring(0, 100) + '"' };
  }
  return { reply: FALLBACK_REPLY, summary: parsed.summary, shouldCreateDeal: parsed.qualifiesForDeal, shouldNotify: parsed.wantsHuman, parsed };
}
