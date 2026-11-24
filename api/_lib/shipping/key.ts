// api/_lib/shipping/key.ts
// ─────────────────────────────────────────────────────────────────────────────
// Clave de idempotencia del aviso de despacho (spec Nivel 2, §7 Privacidad y §8).
//
// Es el SHA-256 en hex de `{dealId}:{carrierId}:{referencia del despacho}`. La misma clave usan
// Redis (`aviso-despacho:v1:<clave>`), la marca de 24 h de la vista previa y el relay de
// Apps Script (PropertiesService, 400 días). Va como hash para que ni el negocio ni la orden
// de flete queden legibles en Upstash ni en Google.
//
// La referencia (dispatchRef) es la orden de flete normalizada (solo A-Z y 0-9) o, sin orden
// (opcional desde el 24-11-2026, decisión del dueño), «-» y el documento: `-factura8459`,
// `-guia123`. El «-» nunca aparece en una orden normalizada, así que las dos formas no chocan.
// Sin orden, el documento identifica el despacho: dos despachos del mismo negocio y operador
// con documentos distintos son dos avisos; con el mismo documento, uno solo (el segundo se
// escribe desde Gmail). Con orden, la clave es la misma de siempre.
//
// Si la clave cambiara entre dos intentos del mismo envío, las tres capas contra el envío
// doble dejarían de servir. Por eso shippingNoticeKey no normaliza nada por su cuenta: exige
// una de las dos formas exactas y lanza si no, y trata igual el id como número (webhook v1) o
// como texto (v2, `meta.entity_id`).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { DOCUMENT_TYPE_IDS, MAX_DOCUMENT_DIGITS, type ShippingDocument } from './documents.js';

const DEAL_ID_RE = /^[1-9]\d{0,15}$/;
const CARRIER_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** Orden de flete normalizada: solo letras y dígitos, en mayúsculas. */
const ORDER_REF_RE = /^[A-Z0-9]{1,64}$/;
/** Sin orden: «-», el tipo de documento y su número sin ceros a la izquierda («-factura8459»). */
const DOCUMENT_REF_RE = new RegExp(`^-(?:${DOCUMENT_TYPE_IDS.join('|')})[1-9]\\d{0,${MAX_DOCUMENT_DIGITS - 1}}$`);
/** Forma de la clave: 64 caracteres hex en minúscula. */
export const SHIPPING_NOTICE_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Referencia del despacho para la clave: la orden normalizada o, si va vacía, «-» y el documento
 * (`-factura8459`, `-guia123`).
 */
export function dispatchRef(orderNormalized: string, document: ShippingDocument): string {
  return orderNormalized || `-${document.type}${document.number}`;
}

/**
 * Clave de idempotencia del aviso: SHA-256 en hex de `{dealId}:{carrierId}:{referencia}`
 * (dispatchRef). Lanza TypeError si el id del negocio no es un entero positivo, si el id del
 * operador no es un identificador corto o si la referencia no es una orden normalizada ni la
 * forma exacta del documento.
 */
export function shippingNoticeKey(
  dealId: number | string,
  carrierId: number | string,
  ref: string,
): string {
  const deal = String(dealId);
  const carrier = String(carrierId);
  if (!DEAL_ID_RE.test(deal)) throw new TypeError('shippingNoticeKey: dealId no válido');
  if (!CARRIER_ID_RE.test(carrier)) throw new TypeError('shippingNoticeKey: carrierId no válido');
  if (typeof ref !== 'string' || !(ORDER_REF_RE.test(ref) || DOCUMENT_REF_RE.test(ref))) {
    throw new TypeError('shippingNoticeKey: la referencia no es una orden normalizada (A-Z y 0-9) ni «-<documento><número>»');
  }
  return createHash('sha256').update(`${deal}:${carrier}:${ref}`, 'utf8').digest('hex');
}

/** Los primeros 8 caracteres de la clave, para los registros; `--------` si no es una clave. */
export function shortKey(key: unknown): string {
  return typeof key === 'string' && SHIPPING_NOTICE_KEY_RE.test(key) ? key.slice(0, 8) : '--------';
}
