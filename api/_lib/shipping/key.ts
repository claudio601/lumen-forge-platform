// api/_lib/shipping/key.ts
// ─────────────────────────────────────────────────────────────────────────────
// Clave de idempotencia del aviso de despacho (spec Nivel 2, §7 Privacidad y §8).
//
// Es el SHA-256 en hex de `{dealId}:{carrierId}:{orden normalizada}`. La misma clave usan
// Redis (`aviso-despacho:v1:<clave>`), la marca de 24 h de la vista previa y el relay de
// Apps Script (PropertiesService, 400 días). Va como hash para que ni el negocio ni la orden
// de flete queden legibles en Upstash ni en Google.
//
// Si la clave cambiara entre dos intentos del mismo envío, las tres capas contra el envío
// doble dejarían de servir. Por eso la función no normaliza nada por su cuenta: exige la
// orden ya normalizada (solo A-Z y 0-9) y lanza si no lo está, y trata igual el id como
// número (webhook v1) o como texto (v2, `meta.entity_id`).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

const DEAL_ID_RE = /^[1-9]\d{0,15}$/;
const CARRIER_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** Orden de flete normalizada: solo letras y dígitos, en mayúsculas. */
const ORDER_RE = /^[A-Z0-9]{1,64}$/;
/** Forma de la clave: 64 caracteres hex en minúscula. */
export const SHIPPING_NOTICE_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Clave de idempotencia del aviso: SHA-256 en hex de `{dealId}:{carrierId}:{orden}`.
 * Lanza TypeError si el id del negocio no es un entero positivo, si el id del operador
 * no es un identificador corto o si la orden no viene normalizada.
 */
export function shippingNoticeKey(
  dealId: number | string,
  carrierId: number | string,
  normalizedOrder: string,
): string {
  const deal = String(dealId);
  const carrier = String(carrierId);
  if (!DEAL_ID_RE.test(deal)) throw new TypeError('shippingNoticeKey: dealId no válido');
  if (!CARRIER_ID_RE.test(carrier)) throw new TypeError('shippingNoticeKey: carrierId no válido');
  if (typeof normalizedOrder !== 'string' || !ORDER_RE.test(normalizedOrder)) {
    throw new TypeError('shippingNoticeKey: la orden de flete no viene normalizada (solo A-Z y 0-9)');
  }
  return createHash('sha256').update(`${deal}:${carrier}:${normalizedOrder}`, 'utf8').digest('hex');
}

/** Los primeros 8 caracteres de la clave, para los registros; `--------` si no es una clave. */
export function shortKey(key: unknown): string {
  return typeof key === 'string' && SHIPPING_NOTICE_KEY_RE.test(key) ? key.slice(0, 8) : '--------';
}
