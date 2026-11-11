// api/_lib/whatsapp/claudeAgent.ts
// NUEVO ROL v1: Claude solo hace PARSING de campos y señal comercial.
// El control del flujo queda en flowEngine.ts (determinístico).
import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn } from './conversation.js';
import { safeSummary } from './summary.js';
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
/**
 * [RESPUESTA] Por que no se uso nada de la respuesta de Claude (todos los campos con su valor por defecto):
 * - respuesta_incompleta: stop_reason max_tokens, el texto se corto;
 * - sin_json: no trae ningun objeto JSON; json_invalido: trae algo entre llaves que no es JSON;
 * - json_incompleto: un objeto empieza y no se cierra; varios_json: mas de un objeto (no se elige);
 * - no_es_objeto: JSON valido que no es un objeto (null, una lista, un texto, un numero).
 */
export type ClaudeFallbackReason = 'respuesta_incompleta' | 'sin_json' | 'json_invalido' | 'json_incompleto' | 'varios_json' | 'no_es_objeto';
/** [RESPUESTA] Que quedo con su valor por defecto y por que. Solo datos tecnicos: nunca texto del cliente. */
export interface ClaudeDiagnostics {
  /** Algun campo (o todos) quedo con su valor por defecto. */
  usedDefaults: boolean;
  /** Nada de la respuesta se pudo usar. */
  reason?: ClaudeFallbackReason;
  /** Campo con su valor por defecto: 'falta' (no vino o vino null) o 'tipo' (vino con otro tipo). */
  fields: Partial<Record<keyof ClaudeParsed, 'falta' | 'tipo'>>;
  stopReason: string | null;
  /** Largo del texto que devolvio Claude (caracteres). */
  length: number;
}
export interface ClaudeResult {
  reply: string;
  summary: string;
  shouldCreateDeal: boolean;
  shouldNotify: boolean;
  parsed: ClaudeParsed;
  /** [RESPUESTA] askClaude siempre lo trae; opcional para los dobles de prueba del webhook. */
  diagnostics?: ClaudeDiagnostics;
}
const SYSTEM_PROMPT = 'Eres el extractor de datos del bot WhatsApp de eLIGHTS.cl. ' +
  'Analiza el mensaje y extrae campos en JSON. NO redactes respuestas para el cliente. ' +
  'Devuelve UNICAMENTE JSON con: producto, tipo_de_luz, cantidad, proyecto_o_uso, ' +
  'comuna_o_ciudad, nombre, empresa, correo (null si no aplica), ' +
  'wantsHuman (boolean), qualifiesForDeal (boolean), summary (string 1-2 lineas). ' +
  // [CANTIDAD] [NO-PISAR] PR 2 del plan del bot; el codigo igual valida los dos campos.
  'cantidad: numero entero de unidades que el cliente pidio, o null (nunca una potencia, medida, ' +
  'RUT, telefono ni los numeros de un correo). proyecto_o_uso: el espacio o uso (oficina, bodega), ' +
  'nunca la razon social ni su tipo (SpA, Ltda.). ' +
  // [COMUNA] [RESUMEN] PR 3 del plan del bot; el codigo igual valida la comuna y filtra el resumen.
  'comuna_o_ciudad: la comuna de Chile donde se instala o se despacha, solo si el cliente la dice como ' +
  'lugar (nunca la de un correo, una calle, la razon social ni la sucursal que pregunta). ' +
  // [RESUMEN] Ronda 2 (H1): cada frase dice lo que el cliente pide, pregunta o dice; summary.ts bota
  // las que afirman un hecho, asi que el resumen bien escrito pasa entero.
  'summary: una o dos frases. Cada frase empieza con "El cliente pide", "El cliente pregunta si", ' +
  '"El cliente pregunta por" o "El cliente dice que", y cuenta solo lo que el cliente pide, pregunta o dice. ' +
  'Nunca afirmes un hecho ni un estado comercial: compra, pago, acreditacion, stock, existencias, ' +
  'un pedido existente, entrega, despacho, llegada ni historial del cliente, en ningun tiempo verbal. ' +
  // [RESUMEN] R7 (Codex, ronda 3): summary.ts tambien bota esos hechos dichos con un rodeo.
  'Tampoco con rodeos ("se efectuo la adquisicion", "logro comprar", "estan a su disposicion", "estan preparados"). ' +
  'Si el cliente pregunta por eso, escribe "El cliente pregunta si hay stock" o "El cliente pregunta si es ' +
  'cliente frecuente"; si lo cuenta, "El cliente dice que ya pago". Nunca hables por la tienda ' +
  '("tenemos", "nosotros", "le enviamos") ni escribas "su pedido" o "su compra": nombra el producto ' +
  '("El cliente pregunta cuando llegan los 20 focos"). ' +
  // [RESUMEN] Ronda 3: summary.ts tambien bota los rotulos sueltos y lo que paso antes.
  'No escribas rotulos ni frases sueltas ("Pago OK", "Cliente conocido", "Despacho manana a Lampa") ' +
  'ni lo que paso antes ("ayer", "la vez anterior") salvo con "El cliente dice que".';
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
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Posicion de la llave que cierra la que abre en `start` (-1: no se cierra). Respeta comillas y escapes. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
/**
 * [RESPUESTA] El objeto JSON de la respuesta de Claude: el texto entero o el unico objeto de primer nivel que
 * trae, dentro o fuera de un bloque ```json y con texto antes o despues (informe de Codex del 10-11, punto 3).
 * Una llave dentro de un texto entre comillas no abre ni cierra nada; un trozo entre llaves que no es JSON se
 * salta entero (no se busca un objeto dentro de el). Con mas de un objeto no se elige ninguno.
 */
export function extractJsonObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; reason: Exclude<ClaudeFallbackReason, 'respuesta_incompleta'> } {
  const trimmed = text.trim();
  try {
    const whole: unknown = JSON.parse(trimmed);
    return isPlainObject(whole) ? { ok: true, value: whole } : { ok: false, reason: 'no_es_objeto' };
  } catch { /* texto alrededor, un bloque o un JSON cortado: se busca el objeto */ }
  const objects: Record<string, unknown>[] = [];
  let sawBraces = false;
  for (let start = trimmed.indexOf('{'); start !== -1; ) {
    const end = closingBrace(trimmed, start);
    if (end === -1) {
      if (!objects.length) return { ok: false, reason: 'json_incompleto' };
      break;
    }
    sawBraces = true;
    try {
      const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
      if (isPlainObject(value)) objects.push(value);
    } catch { /* no es JSON: se salta entero */ }
    start = trimmed.indexOf('{', end + 1);
  }
  if (objects.length === 1) return { ok: true, value: objects[0] };
  if (objects.length > 1) return { ok: false, reason: 'varios_json' };
  // Un bloque ```json con null, una lista o un texto.
  for (const fence of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    try {
      if (!isPlainObject(JSON.parse(fence[1]))) return { ok: false, reason: 'no_es_objeto' };
    } catch { /* sigue */ }
  }
  return { ok: false, reason: sawBraces ? 'json_invalido' : 'sin_json' };
}
const TEXT_FIELDS = ['producto', 'tipo_de_luz', 'cantidad', 'proyecto_o_uso', 'comuna_o_ciudad', 'nombre', 'empresa', 'correo'] as const;
const isMissing = (value: unknown) => value === undefined || value === null;
/**
 * [RESPUESTA] Los campos de la respuesta, uno por uno: un campo con otro tipo queda con su valor por defecto
 * (vacio, false o el resumen de respaldo) y los demas se usan igual. Un texto null o vacio es "no aplica".
 */
export function readClaudeFields(raw: Record<string, unknown>, fallbackSummary: string): { parsed: ClaudeParsed; fields: ClaudeDiagnostics['fields'] } {
  const fields: ClaudeDiagnostics['fields'] = {};
  const parsed: ClaudeParsed = { wantsHuman: false, qualifiesForDeal: false, summary: fallbackSummary };
  for (const name of TEXT_FIELDS) {
    const value = raw[name];
    const text = textField(value);
    if (text !== undefined) parsed[name] = text;
    else if (!isMissing(value) && typeof value !== 'string') fields[name] = 'tipo';
  }
  for (const name of ['wantsHuman', 'qualifiesForDeal'] as const) {
    const value = raw[name];
    // Solo un booleano: "false" (texto) ya no se lee como true.
    if (typeof value === 'boolean') parsed[name] = value;
    else fields[name] = isMissing(value) ? 'falta' : 'tipo';
  }
  const summary = raw.summary;
  // [RESUMEN] Sin las frases que afirman hechos sin atribuirlos al cliente (summary.ts).
  if (typeof summary === 'string' && summary.trim()) parsed.summary = safeSummary(summary);
  else fields.summary = isMissing(summary) || typeof summary === 'string' ? 'falta' : 'tipo';
  return { parsed, fields };
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
  // [RESPUESTA] Todos los bloques de texto, en orden (antes, solo el primero).
  const texts = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : []));
  if (!texts.length) throw new Error(LOG_PREFIX + ' No text block');
  const rawText = texts.join('\n');
  const stopReason = response.stop_reason ?? null;
  const diagnostics: ClaudeDiagnostics = { usedDefaults: false, fields: {}, stopReason, length: rawText.length };
  // [RESPUESTA] Cortada por max_tokens: incompleta, no se usa nada (un dato a medias no es un dato).
  const extracted = stopReason === 'max_tokens' ? { ok: false as const, reason: 'respuesta_incompleta' as const } : extractJsonObject(rawText);
  // Sin nada utilizable, los valores por defecto de siempre; el webhook registra el motivo (en vez de "Claude ok")
  // y el paso queda de las reglas del flujo. (=== false: sin strictNullChecks, `if (x.ok)` no estrecha la union.)
  let parsed: ClaudeParsed = { wantsHuman: false, qualifiesForDeal: false, summary: 'Consulta: "' + newMessage.substring(0, 100) + '"' };
  if (extracted.ok === false) {
    diagnostics.reason = extracted.reason;
    diagnostics.usedDefaults = true;
  } else {
    const read = readClaudeFields(extracted.value, 'Consulta de ' + (profileName || 'cliente') + ': "' + newMessage.substring(0, 80) + '"');
    parsed = read.parsed;
    diagnostics.fields = read.fields;
    diagnostics.usedDefaults = Object.keys(read.fields).length > 0;
  }
  return { reply: FALLBACK_REPLY, summary: parsed.summary, shouldCreateDeal: parsed.qualifiesForDeal, shouldNotify: parsed.wantsHuman, parsed, diagnostics };
}
