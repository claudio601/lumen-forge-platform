// api/_lib/pipedrive/crossChannel.ts
// ─────────────────────────────────────────────────────────────────────────────
// Posibles duplicados entre la web y WhatsApp (decisión del dueño, 13-11-2026).
//
// Al crear un negocio desde un canal (formularios de pedido, cotización y cotizador, o el bot
// de WhatsApp), se miran los negocios abiertos de la misma persona: la que encontró
// findOrCreatePerson con el criterio de siempre (correo y, si no, teléfono). Si uno se creó
// desde el otro canal en los últimos CROSS_CHANNEL_WINDOW_DAYS días, la nota del negocio nuevo
// lo dice bajo «Para revisar»: «Posible duplicado: revisar el negocio #<id> (<canal>, <fecha>)».
//
// Solo avisa: nunca une, borra ni suprime correos. Una sola llamada (GET /persons/{id}/deals,
// abiertos, de los más nuevos a los más antiguos). Si Pipedrive falla o tarda, el negocio se
// crea igual y no hay aviso (fail-open); el log solo lleva el motivo, nunca datos del cliente.
//
// El canal de un negocio sale de su referencia (campo PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE:
// WA- es WhatsApp; NE-, RC- y PY- son los formularios), del Tipo de Servicio
// (PIPEDRIVE_FIELD_TIPO_SERVICIO: 92 WhatsApp, 89 cotización web) o, en un negocio sin esos
// campos, de su título («WhatsApp Lead — …», «Solicitud RC-…»). Instalación (90), estudio
// lumínico (91) y Jumpseller (93) no son de ninguno de los dos canales.
// ─────────────────────────────────────────────────────────────────────────────

import { pipedriveGet } from './client.js';
import { TIPO_SERVICIO } from '../crm/tipo-servicio.js';
import type { PipedriveDeal } from '../crm/types.js';

export type Channel = 'web' | 'whatsapp';

/** Ventana del aviso: un negocio del otro canal creado en los últimos 7 días. */
export const CROSS_CHANNEL_WINDOW_DAYS = 7;
/** Tope de la consulta: si Pipedrive tarda más, el negocio sigue sin aviso. */
export const CROSS_CHANNEL_TIMEOUT_MS = 4_000;
/** Negocios abiertos que se leen (los más nuevos primero) y avisos que se escriben como máximo. */
const PAGE_LIMIT = 50;
const MAX_ITEMS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEB_REFERENCE = /^(?:NE|RC|PY)-[0-9a-z]+$/i;
const WEB_REFERENCE_IN_TITLE = /\b(?:NE|RC|PY)-[0-9a-z]{4,}\b/i;

const CHANNEL_LABEL: Record<Channel, string> = { web: 'web', whatsapp: 'WhatsApp' };

/** Pipedrive v1 da las fechas como 'YYYY-MM-DD HH:MM:SS' en UTC (v2: ISO 8601). NaN si no se lee. */
export function pipedriveTime(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  return Date.parse(iso);
}

/** Id de una opción de un campo de lista: v1 la da como texto ("92"), número u objeto { id }. */
function optionId(value: unknown): string {
  if (value && typeof value === 'object') {
    const v = value as { id?: unknown; value?: unknown };
    return String(v.id ?? v.value ?? '');
  }
  return value === null || value === undefined ? '' : String(value);
}

/** El canal de un negocio que ya existe, o null si no es de la web ni de WhatsApp. */
export function dealChannel(deal: PipedriveDeal): Channel | null {
  const refKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
  const ref = refKey && typeof deal[refKey] === 'string' ? (deal[refKey] as string).trim() : '';
  if (/^WA-\d+$/.test(ref)) return 'whatsapp';
  if (WEB_REFERENCE.test(ref)) return 'web';
  if (ref) return null; // otra referencia (JS-, EL-…): ni web ni WhatsApp

  const tipoKey = process.env.PIPEDRIVE_FIELD_TIPO_SERVICIO;
  const tipo = tipoKey ? optionId(deal[tipoKey]) : '';
  if (tipo === String(TIPO_SERVICIO.WHATSAPP)) return 'whatsapp';
  if (tipo === String(TIPO_SERVICIO.COTIZACION_WEB)) return 'web';
  if (tipo) return null;

  const title = typeof deal.title === 'string' ? deal.title : '';
  if (/^WhatsApp Lead\b/.test(title)) return 'whatsapp';
  if (WEB_REFERENCE_IN_TITLE.test(title)) return 'web';
  return null;
}

/**
 * El canal de un negocio que se va a crear: los formularios del sitio (nuevo_elights con
 * Tipo de Servicio «cotización web») o el bot (whatsapp con Tipo de Servicio WhatsApp). Los
 * demás (instalación, estudio lumínico, Jumpseller, cotizaciones con API key) no se revisan.
 */
export function newDealChannel(params: { sourceSystem: string; tipoServicio?: number }): Channel | null {
  if (params.sourceSystem === 'nuevo_elights' && params.tipoServicio === TIPO_SERVICIO.COTIZACION_WEB) return 'web';
  if (params.sourceSystem === 'whatsapp' && params.tipoServicio === TIPO_SERVICIO.WHATSAPP) return 'whatsapp';
  return null;
}

/** Fecha de Chile para la nota: dd-mm-aaaa. */
function chileDate(time: number): string {
  const parts = new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Santiago',
  }).formatToParts(new Date(time));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}-${part('month')}-${part('year')}`;
}

/** «Posible duplicado: revisar el negocio #123 (WhatsApp, 12-11-2026)». */
export function duplicateItem(dealId: number, channel: Channel, addTime: number): string {
  return `Posible duplicado: revisar el negocio #${dealId} (${CHANNEL_LABEL[channel]}, ${chileDate(addTime)})`;
}

/**
 * Los avisos «Posible duplicado» para un negocio nuevo de `channel` de la persona `personId`:
 * sus negocios abiertos del otro canal creados en los últimos 7 días (sin `newDealId`), del
 * más nuevo al más antiguo, hasta MAX_ITEMS. Nunca lanza: ante cualquier falla devuelve [].
 */
export async function findCrossChannelDuplicates({
  personId,
  channel,
  newDealId,
  now = Date.now(),
  timeoutMs = CROSS_CHANNEL_TIMEOUT_MS,
}: {
  personId: number;
  channel: Channel;
  newDealId?: number | null;
  now?: number;
  timeoutMs?: number;
}): Promise<string[]> {
  if (!Number.isInteger(personId) || personId <= 0) return [];
  const other: Channel = channel === 'web' ? 'whatsapp' : 'web';
  try {
    const res = await pipedriveGet<PipedriveDeal[]>(
      `/persons/${personId}/deals`,
      { status: 'open', sort: 'add_time DESC', start: '0', limit: String(PAGE_LIMIT) },
      timeoutMs
    );
    if (!res.success) {
      console.warn(JSON.stringify({ level: 'warn', event: 'cross_channel_lookup_failed', reason: 'request_failed' }));
      return [];
    }
    if (res.data === null || res.data === undefined) return []; // la persona no tiene negocios abiertos
    if (!Array.isArray(res.data)) {
      console.warn(JSON.stringify({ level: 'warn', event: 'cross_channel_lookup_failed', reason: 'unexpected_body' }));
      return [];
    }
    const cutoff = now - CROSS_CHANNEL_WINDOW_DAYS * DAY_MS;
    const found = res.data
      .filter((d): d is PipedriveDeal => Boolean(d) && typeof d === 'object' && Number.isInteger(d.id))
      .filter((d) => d.id !== newDealId && d.status === 'open')
      .map((d) => ({ id: d.id, added: pipedriveTime(d.add_time), channel: dealChannel(d) }))
      .filter((d) => d.channel === other && Number.isFinite(d.added) && d.added >= cutoff)
      .sort((a, b) => b.added - a.added)
      .slice(0, MAX_ITEMS);
    if (found.length) {
      console.log(JSON.stringify({ level: 'info', event: 'cross_channel_possible_duplicate', channel, dealIds: found.map((d) => d.id) }));
    }
    return found.map((d) => duplicateItem(d.id, other, d.added));
  } catch {
    console.warn(JSON.stringify({ level: 'warn', event: 'cross_channel_lookup_failed', reason: 'exception' }));
    return [];
  }
}
