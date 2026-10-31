// api/_lib/whatsapp/claudeAgent.ts
// NUEVO ROL v1: Claude solo hace PARSING de campos y señal comercial.
// El control del flujo queda en flowEngine.ts (determinístico).
import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn } from './conversation.js';
const LOG_PREFIX = '[claudeAgent]';
export const FALLBACK_REPLY = 'Hola! Gracias por escribirnos. Cu\u00e9ntanos qu\u00e9 necesitas y tu correo de contacto: la respuesta te llega por correo.';
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
  'wantsHuman (boolean), qualifiesForDeal (boolean), summary (string 1-2 lineas). ' +
  // [CANTIDAD] [NO-PISAR] PR 2 del plan del bot; el codigo igual valida los dos campos.
  'cantidad: numero entero de unidades que el cliente pidio, o null (nunca una potencia, medida, ' +
  'RUT, telefono ni los numeros de un correo). proyecto_o_uso: el espacio o uso (oficina, bodega), ' +
  'nunca la razon social ni su tipo (SpA, Ltda.).';
/**
 * [CIERRE-HONESTO] Cada campo de Claude se usa solo si es texto (un numero se pasa a texto).
 * Un objeto o una lista (dos correos, un pedido con varios items) queda vacio: antes viajaba
 * tal cual, hacia caer el webhook o llegaba a la nota como [object Object].
 */
export function textField(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}
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
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
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
      producto: textField(raw.producto),
      tipo_de_luz: textField(raw.tipo_de_luz),
      cantidad: textField(raw.cantidad),
      proyecto_o_uso: textField(raw.proyecto_o_uso),
      comuna_o_ciudad: textField(raw.comuna_o_ciudad),
      nombre: textField(raw.nombre),
      empresa: textField(raw.empresa),
      correo: textField(raw.correo),
      wantsHuman: Boolean(raw.wantsHuman),
      qualifiesForDeal: Boolean(raw.qualifiesForDeal),
      summary: textField(raw.summary) ?? 'Consulta de ' + (profileName || 'cliente') + ': "' + newMessage.substring(0, 80) + '"',
    };
  } catch {
    console.warn(LOG_PREFIX + ' Response not valid JSON — usando defaults');
    parsed = { wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + newMessage.substring(0, 100) + '"' };
  }
  return { reply: FALLBACK_REPLY, summary: parsed.summary, shouldCreateDeal: parsed.qualifiesForDeal, shouldNotify: parsed.wantsHuman, parsed };
}
