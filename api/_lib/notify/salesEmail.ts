// api/_lib/notify/salesEmail.ts
// ─────────────────────────────────────────────────────────────────────────────
// Correo a ventas a través del relay de Google Apps Script (GAS).
//
// Único cliente del relay para estudio lumínico, cotización, instalación y
// cotizador (request-orders mantiene su propio sendGasEmail por ahora).
//
// La plantilla vive en Apps Script, fuera del repo, y es fija (verificada en Gmail):
//   - el asunto es siempre "Nueva Solicitud de Cotizacion - eLights.cl"
//     (ignora subject_override);
//   - "Modo:" muestra "undefined" si falta modo_precio, así que siempre se envía;
//   - Razon Social, RUT Empresa, Giro, Direccion y COMENTARIOS solo se imprimen
//     si la clave viene, así que solo se envían cuando tienen valor;
//   - PRODUCTOS SOLICITADOS (items_lista) lleva el detalle de la solicitud.
//
// Acepta campos de cualquier tipo: quien llama puede pasar un opcional sin validar
// (un número, null) y el correo igual sale. Un texto recortado termina con una
// marca visible, para que ventas sepa que falta algo.
//
// Los logs nunca llevan datos del cliente: solo OK/FAIL con el prefijo de quien
// llama y un motivo clasificado (status, HTTP, timeout, red). El texto que devuelve
// el relay nunca va al log, porque puede repetir lo que recibió (correo, nombre...).
// ─────────────────────────────────────────────────────────────────────────────

import { waitUntil } from '@vercel/functions';

// El mismo relay que api/request-orders/create.ts. En las pruebas,
// vitest.api.config.ts define GAS_RELAY_URL con un puerto muerto.
const DEFAULT_GAS_RELAY_URL =
  'https://script.google.com/macros/s/AKfycbwn2Qv3nJsNrUfBvzdpB9X70NmQfAVXgBKVw8bdmG-CXMXGsL-2IUcJaKX0mpO4kNwfOw/exec';

const MAX_CUERPO = 8000;
const MAX_CAMPO = 500;

// Mensaje de MailApp cuando se acaba la cuota diaria de Gmail.
const QUOTA_MESSAGE = /too many times|quota|cuota/i;

export interface SalesEmail {
  /** Línea "Modo:" del correo: el tipo de solicitud. */
  modo: string;
  nombre: string;
  email: string;
  telefono: string;
  /** Bloque PRODUCTOS SOLICITADOS; su primera línea identifica el flujo y la referencia. */
  cuerpo: string;
  /** TOTAL REFERENCIAL ('-' si no viene). */
  total?: string;
  razonSocial?: string;
  rutEmpresa?: string;
  giro?: string;
  direccion?: string;
  comentarios?: string;
  /** subject_override: la plantilla actual lo ignora; se envía para cuando lo use. */
  asunto?: string;
}

/** Texto de cualquier valor: un número o un booleano se convierten; null/undefined, vacío. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return value == null ? '' : String(value);
}

/** Marca al final de un texto recortado. */
function cutMark(removed: number): string {
  return '\n[…recortado: ' + removed + ' caracteres más]';
}

/** Recorta a `max` caracteres; si recorta, termina con la marca (cabe dentro del máximo). */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  // La marca con el largo total tiene al menos tantos dígitos como la final.
  const keep = max - cutMark(text.length).length;
  return text.slice(0, keep) + cutMark(text.length - keep);
}

/** Campo de una línea: sin saltos de línea ni espacios repetidos, con largo máximo. */
function oneLine(value: unknown): string {
  return asText(value).replace(/\s+/g, ' ').trim().slice(0, MAX_CAMPO);
}

/** Cuerpo JSON con las claves que lee la plantilla del relay. */
export function toGasBody(m: SalesEmail, now: Date = new Date()): Record<string, string> {
  const body: Record<string, string> = {
    to_email: process.env.SALES_EMAIL ?? 'ventas@elights.cl',
    reply_to: oneLine(m.email),
    from_name: oneLine(m.nombre),
    nombre: oneLine(m.nombre),
    telefono: oneLine(m.telefono),
    modo_precio: oneLine(m.modo),
    items_lista: capText(asText(m.cuerpo), MAX_CUERPO),
    total: oneLine(m.total) || '-',
    fecha: now.toLocaleDateString('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }),
  };

  // Solo con valor: la plantilla imprime estas líneas apenas viene la clave.
  const optional: Record<string, string> = {
    razon_social: oneLine(m.razonSocial),
    rut_empresa: oneLine(m.rutEmpresa),
    giro: oneLine(m.giro),
    direccion: oneLine(m.direccion),
    comentarios: capText(asText(m.comentarios).trim(), MAX_CAMPO),
    subject_override: oneLine(m.asunto),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value) body[key] = value;
  }

  return body;
}

/**
 * Fallo del relay. `message` lleva solo un motivo clasificado, apto para el log.
 * `relayText` guarda lo que respondió el relay (hasta 200 caracteres) para quien
 * lo necesite al depurar; puede repetir datos del cliente ("Invalid email: …"),
 * así que nunca se escribe en un log.
 */
export class SalesEmailError extends Error {
  readonly relayText: string;

  constructor(reason: string, relayText: string) {
    super(reason);
    this.name = 'SalesEmailError';
    this.relayText = relayText;
  }
}

/**
 * Envía el correo. Rechaza si el relay no responde a tiempo, si no responde
 * JSON (una cuota agotada o un error del script devuelven HTML) o si no dice
 * status 'ok'.
 */
export async function sendSalesEmail(
  m: SalesEmail,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {}
): Promise<void> {
  const response = await fetch(process.env.GAS_RELAY_URL || DEFAULT_GAS_RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(toGasBody(m)),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new SalesEmailError(
      'GAS relay: HTTP ' + response.status + ', respuesta no JSON',
      text.slice(0, 200)
    );
  }

  const { status, message } = (result ?? {}) as { status?: unknown; message?: unknown };
  if (status !== 'ok') {
    const relayText = asText(message);
    // El status solo se registra si es una palabra corta: lo demás lo eligió el relay.
    const statusLabel =
      typeof status === 'string' && /^[a-z_-]{1,20}$/i.test(status) ? status : 'no reconocido';
    throw new SalesEmailError(
      'GAS relay: status ' + statusLabel +
        (QUOTA_MESSAGE.test(relayText) ? ' (cuota de correos agotada)' : ''),
      relayText.slice(0, 200)
    );
  }
}

/** Motivo del fallo para el log: nunca el texto del relay ni datos del cliente. */
export function failureReason(err: unknown): string {
  if (err instanceof SalesEmailError) return err.message;

  const name = err instanceof Error ? err.name : typeof err;
  if (name === 'TimeoutError' || name === 'AbortError') return 'GAS relay: sin respuesta a tiempo';

  // fetch de Node: TypeError('fetch failed') con un código en la causa (ECONNREFUSED…)
  const code = err instanceof Error ? (err.cause as { code?: unknown } | undefined)?.code : undefined;
  const codeLabel = typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code) ? ', ' + code : '';
  return 'GAS relay: error de red (' + name.slice(0, 40) + codeLabel + ')';
}

/**
 * Envía el correo sin bloquear a quien llama: registra el envío en waitUntil
 * (sobrevive al cierre de la función) y devuelve la promesa, que nunca rechaza:
 * true si el relay confirmó el envío, false si falló (queda en el log).
 */
export function notifySales(m: SalesEmail, log: string): Promise<boolean> {
  const sent = sendSalesEmail(m).then(
    () => {
      console.log(log + ' GAS relay OK');
      return true;
    },
    (err: unknown) => {
      console.warn(log + ' GAS relay FAIL: ' + failureReason(err));
      return false;
    }
  );
  waitUntil(sent);
  return sent;
}
