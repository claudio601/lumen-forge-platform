import { rutCheckDigit } from '../rut.js';

/**
 * Único punto de preparación de texto para logs. No usar en respuestas, CRM ni correos.
 * Los nombres no se pueden reconocer con regex: omitir el texto libre que pueda traerlos
 * y registrar presencia/largo. Los errores se registran enmascarados y cortos (sirven para
 * depurar); un objeto que no es Error (puede traer un cuerpo completo) no se imprime.
 * Mantener los ids en campos separados: un número solo puede ser un id, un RUT o un teléfono.
 */
/** Largo máximo de un error en el log. */
const ERROR_MAX = 200;

/**
 * Relay del aviso de despacho (api/_lib/notify/shippingRelay.ts). Sus mensajes de log son
 * `Shipping relay: status <estado>` y, si hay motivo, `: <motivo>`. Solo pasan los estados y
 * los motivos de estas listas: el texto que devuelve el relay nunca llega al log. Las listas
 * viven aquí, como los estados del relay de ventas, y shippingRelay.ts las importa.
 */
export const SHIPPING_RELAY_STATUSES = ['ok', 'duplicate', 'quota', 'rejected', 'uncertain', 'config'] as const;

export const SHIPPING_RELAY_REASONS = [
  // Los responde el relay (apps-script/aviso-despacho/Code.gs) o los detecta el servidor antes de llamar.
  'firma no válida',
  'hora fuera de rango',
  'cuerpo no válido',
  'versión no soportada',
  'acción no válida',
  'clave no válida',
  'destinatario no válido',
  'asunto no válido',
  'texto del correo no válido',
  'adjuntos no válidos',
  'falta configuración en el relay',
  'relay ocupado',
  'Gmail no aceptó el envío',
  'error interno del relay',
  'motivo no reconocido',
  'status no reconocido',
  // Configuración del servidor y plazo.
  'falta SHIPPING_RELAY_URL',
  'SHIPPING_RELAY_URL no válida',
  'falta SHIPPING_RELAY_SECRET',
  'SHIPPING_RELAY_SECRET demasiado corto',
  'sin plazo para llamar al relay',
  // Transporte.
  'sin respuesta a tiempo',
  'página de inicio de sesión de Google',
] as const;

/** Motivos con un dato técnico: el estado HTTP o el tipo y el código del error de red. */
const SHIPPING_RELAY_REASON_FORMS = [
  /^respuesta no JSON \(HTTP [1-5]\d{2}\)$/,
  /^error de red \((?:Error|TypeError|SyntaxError|error)(?:, [A-Z_]{2,40})?\)$/,
];

/** true si el motivo está en la lista fija o tiene una de las dos formas con dato técnico. */
export function isShippingRelayReason(reason: string): boolean {
  return (SHIPPING_RELAY_REASONS as readonly string[]).includes(reason) ||
    SHIPPING_RELAY_REASON_FORMS.some((form) => form.test(reason));
}

export function redact(value: unknown, kind: 'text' | 'phone' | 'error' = 'text'): string {
  if (kind === 'phone') {
    const digits = String(value ?? '').replace(/\D/g, '');
    // No revelar completo un valor incompleto de cuatro dígitos o menos.
    return digits.length > 4 ? '…' + digits.slice(-4) : '[teléfono]';
  }
  if (kind === 'error') {
    const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
    // Relay del aviso de despacho: estado y motivo de las listas de arriba.
    if (message.startsWith('Shipping relay: ')) {
      const shipping = /^Shipping relay: status ([a-z]+)(?:: (.+))?$/.exec(message);
      if (!shipping || !(SHIPPING_RELAY_STATUSES as readonly string[]).includes(shipping[1])) {
        return 'Shipping relay: status no reconocido';
      }
      const reason = shipping[2];
      return 'Shipping relay: status ' + shipping[1] +
        (reason === undefined ? '' : ': ' + (isShippingRelayReason(reason) ? reason : 'motivo no reconocido'));
    }
    // Mensajes que construyen nuestros relays: solo estados conocidos, nunca texto del servidor.
    const relayHttp = /^GAS relay: HTTP ([1-5]\d{2}), respuesta no JSON$/.exec(message);
    if (relayHttp) return 'GAS relay: HTTP ' + relayHttp[1] + ', respuesta no JSON';
    if (message.startsWith('GAS relay: status ')) {
      const status = /^GAS relay: status (error|fail|failed|no reconocido)( \(cuota de correos agotada\))?$/.exec(message);
      return status ? 'GAS relay: status ' + status[1] + (status[2] ?? '') : 'GAS relay: status no reconocido';
    }
    const name = value instanceof Error ? value.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') return 'TIMEOUT';
    if (value instanceof Error) return (name + ': ' + redact(message)).slice(0, ERROR_MAX);
    if (typeof value === 'string') return redact(value).slice(0, ERROR_MAX);
    return '[detalle omitido]';
  }
  const text = String(value ?? '');
  const dash = '[-‐‑‒–—−]';
  const body = '\\d{1,2}(?:[., \\u00a0]\\d{3}){2}|\\d{7,8}';
  // Límites de rutCapture: no tomar un fragmento de SKU, monto, fecha o licitación.
  const start = '(?<![\\p{L}\\d_.,$+‐‑‒–—−-])';
  const end = `(?![\\p{L}\\d_]|[.,]\\d|${dash})`;
  const notPersonal = (source: string, index: number, raw: string): boolean => {
    const before = source.slice(Math.max(0, index - 70), index);
    const after = source.slice(index + raw.length);
    return /(?:\$|\b(?:monto|presupuesto|total|valor|precio|clp|uf|sku|id|dealId|personId|orderId|pedido|orden|folio|MessageSid))\s*[:=#]?\s*$/i.test(before) ||
      /^\s*(?:pesos|clp|uf|millones|lucas|mm|cm|metros|m2|m²|w|kw)\b/i.test(after);
  };
  let safe = text.replace(/[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu, '[correo]');
  // Referencia WhatsApp histórica: el sufijo es el teléfono, no un id opaco.
  safe = safe.replace(/\bWA-(\d{7,15})(?!\d)/g, (_, phone: string) => 'WA-' + redact(phone, 'phone'));
  const notRut = (source: string, index: number, raw: string): boolean =>
    notPersonal(source, index, raw) ||
    /(?:\+\d{1,3}|\b(?:tel[eé]fono|phone|celular|celu|cel|fono|tel|whatsapp|wsp|m[oó]vil))\s*[:=]?\s*["']?$/i
      .test(source.slice(Math.max(0, index - 40), index));
  // RUT con guion o puntos/espacios, aun con DV erróneo (también es un dato personal).
  const formatted = new RegExp(`${start}(${body})[ \\u00a0]*${dash}[ \\u00a0]*[\\dk]${end}`, 'giu');
  safe = safe.replace(formatted, (raw, _body, index, source) => notRut(source, index, raw) ? raw : '[RUT]');
  const labelled = new RegExp(`(\\br\\.?u\\.?t\\.?\\s*(?:(?:es|de|la|empresa|n[°º])\\s*)*[:=#]?\\s*)(${body})[ \\u00a0]*[\\dk]${end}`, 'giu');
  safe = safe.replace(labelled, (_, label: string) => label + '[RUT]');
  // Sin etiqueta, reconocer RUT sin guion por módulo 11, incluidos los agrupados.
  const bare = new RegExp(`${start}(${body})[ \\u00a0]*([\\dk])${end}`, 'giu');
  safe = safe.replace(bare, (raw, rutBody: string, dv: string, index: number, source: string) =>
    !notRut(source, index, raw) && rutCheckDigit(rutBody.replace(/\D/g, '')) === dv.toUpperCase() ? '[RUT]' : raw);
  // Prefijo internacional inequívoco, con grupos habituales y paréntesis.
  safe = safe.replace(/(?<![\p{L}\d])(?:\+|00)\d(?:[ ()‐‑‒–—−-]*\d){6,14}(?!\d)/gu, '[teléfono]');
  // Teléfono anunciado explícitamente, incluso si también parece un RUT.
  safe = safe.replace(/(\b(?:tel[eé]fono|phone|celular|celu|cel|fono|tel|whatsapp|wsp|m[oó]vil)\b\s*[:=]?\s*["']?)(\d(?:[ ()-]*\d){6,14})(?!\d)/gi,
    (_, label: string) => label + '[teléfono]');
  // Formato nacional extranjero habitual: (202) 555-0123, 202-555-0123, 020 7946 0123.
  safe = safe.replace(/(?<![\p{L}\d_.,$+-])(?:\(\d{3}\)[ -]?\d{3}[ -]\d{4}|\d{3}[ -]\d{3}[ -]\d{4}|\d{3}[ -]\d{4}[ -]\d{4})(?![\p{L}\d_]|[.,]\d|[-‐‑‒–—−])/gu,
    (raw, index: number, source: string) => notPersonal(source, index, raw) ? raw : '[teléfono]');
  // Números chilenos sin +: nueve dígitos nacionales o 56 + nueve, agrupados o seguidos.
  const chilean = /(?<![\p{L}\d_.,$+-])(?:56[ -]?)?[2-9](?:[ -]?\d){8}(?![\p{L}\d_]|[.,]\d|[-‐‑‒–—−])/gu;
  safe = safe.replace(chilean, (raw, index: number, source: string) => notPersonal(source, index, raw) ? raw : '[teléfono]');
  // Extranjeros escritos seguidos sin +: mantener ids y montos etiquetados como tales.
  safe = safe.replace(/(?<![\p{L}\d_.,$+-])\d{10,15}(?![\p{L}\d_]|[.,]\d|[-‐‑‒–—−])/gu,
    (raw, index: number, source: string) => notPersonal(source, index, raw) ? raw : '[teléfono]');
  return safe;
}
