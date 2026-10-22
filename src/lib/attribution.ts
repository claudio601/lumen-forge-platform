// src/lib/attribution.ts
// ─────────────────────────────────────────────────────────────────────────────
// Origen de la visita (Etapa 2 · PR 10): ids de clic de anuncios (gclid, gbraid, wbraid,
// fbclid), etiquetas UTM, la página de entrada y el sitio anterior. Los formularios lo
// mandan como `attribution` y el servidor lo agrega a la nota de Pipedrive y al correo.
// Las reglas de limpieza son las mismas del servidor (api/_lib/forms/attribution.ts).
//
// Dónde se captura: main.tsx llama captureAttribution() una vez por carga completa de la
// página, antes de React. La navegación interna (SPA) no lo vuelve a correr, y las
// redirecciones de React Router (que pueden botar los parámetros) todavía no ocurrieron.
// El prerender (entry-server.tsx) no lo importa.
//
// Qué se guarda: solo los parámetros de la lista (nunca otros: pueden traer datos
// personales), la ruta de la página de entrada (sin parámetros ni #) y el origen del sitio
// anterior (https://host). Un sitio anterior del mismo host o de *.elights.cl es
// navegación interna: cuenta como directo.
//
// Primera visita o último anuncio: la primera visita de la sesión se guarda (también una
// directa, solo con la página de entrada) y no se reemplaza, salvo que una visita posterior
// llegue desde una campaña (gclid, gbraid, wbraid, fbclid o utm_source): entonces reemplaza
// el registro completo, sin mezclar. Es el último clic pagado o de campaña el que llevó al
// formulario, como cuenta Google Ads. Una visita orgánica, desde otro sitio o directa nunca
// reemplaza lo guardado. Recargar la misma URL de un anuncio no cambia nada.
//
// Dónde se guarda: solo sessionStorage (dura lo que la pestaña; sin cookies ni
// localStorage). Lo que decide cada carga queda también en memoria y es lo que mandan
// los formularios de esa carga y su navegación interna: si el navegador bloquea
// sessionStorage, o solo la escritura falla (cuota llena) y queda el registro anterior,
// se manda lo decidido y no lo viejo. Cada lectura y escritura va en try/catch: nunca
// rompe el arranque.
//
// Oposición (PR 13): el interruptor «Origen de la visita» de «Configurar cookies» guarda
// origin: false en la decisión de cookies (src/lib/cookieConsent.ts). Desde ese momento no
// se captura ni se envía nada, y clearAttribution() borra lo ya anotado en esta pestaña.
// La oposición no vence. Sin decisión, o con «Rechazar» (que solo apaga las cookies de
// Google y de Meta), se sigue capturando. Los ids de clic que analytics.ts repone en la URL
// salen de su propia copia (captureLandingParams), no de este registro.
//
// Hidratación: ningún componente lo lee al dibujar; getAttribution() solo se llama al
// enviar un formulario.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ATTRIBUTION_PARAMS,
  isSiteHost,
  parseAttribution,
  type Attribution,
} from '../../api/_lib/forms/attribution';
import { isOriginOptedOut } from './cookieConsent';

export type { Attribution };

export const ATTRIBUTION_STORAGE_KEY = 'elights_attribution';

/** Respaldo cuando sessionStorage no funciona (modo privado de Safari, almacenamiento bloqueado). */
let memory: Attribution | undefined;

/** Una visita de campaña reemplaza lo guardado; las demás no. */
const isCampaignTouch = (a: Attribution) =>
  Boolean(a.gclid || a.gbraid || a.wbraid || a.fbclid || a.utm_source);

/** La misma URL de campaña (p. ej. una recarga): no reemplaza, aunque cambie el sitio anterior. */
const isSameTouch = (a: Attribution, b: Attribution) =>
  a.landing === b.landing && ATTRIBUTION_PARAMS.every((key) => a[key] === b[key]);

/**
 * Origen de una carga de página: los parámetros de la lista, la ruta (sin parámetros ni #)
 * y el origen del sitio anterior si es externo (http/https, otro host, fuera de elights.cl).
 */
export function attributionFromUrl(href: string, referrer: string): Attribution | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const raw: Record<string, string> = { landing: url.pathname };
  for (const key of ATTRIBUTION_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) raw[key] = value;
  }
  try {
    const from = new URL(referrer);
    if (
      (from.protocol === 'http:' || from.protocol === 'https:') &&
      from.hostname !== url.hostname &&
      !isSiteHost(from.hostname)
    ) {
      raw.referrer = from.origin;
    }
  } catch {
    // Sin sitio anterior (document.referrer vacío o inválido)
  }
  return parseAttribution(raw);
}

/** Lo guardado en la sesión, limpiado de nuevo (un valor alterado se limpia o se ignora). */
function readStored(): Attribution | undefined {
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    return raw === null ? undefined : parseAttribution(JSON.parse(raw)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Origen de la visita para el formulario; undefined si no hay o si el visitante se opuso (la
 * clave no viaja). Primero lo que decidió esta carga (memoria): si la escritura falló, lo
 * guardado es el registro anterior. Sin captura en esta carga, lo guardado en la sesión.
 */
export function getAttribution(): Attribution | undefined {
  if (typeof window === 'undefined' || isOriginOptedOut()) return undefined;
  return memory ?? readStored();
}

/** Borra el origen anotado en esta pestaña (sesión y memoria). Nunca lanza. */
export function clearAttribution(): void {
  memory = undefined;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
  } catch {
    // Almacenamiento bloqueado: no había nada guardado
  }
}

/** Captura el origen de esta carga de página (ver las reglas arriba). Nunca lanza. */
export function captureAttribution(href?: string, referrer?: string): void {
  if (typeof window === 'undefined' || isOriginOptedOut()) return;
  try {
    const current = attributionFromUrl(href ?? window.location.href, referrer ?? document.referrer);
    const stored = getAttribution();
    const replace = !stored || (current && isCampaignTouch(current) && !isSameTouch(current, stored));
    const next = replace ? current : stored;
    if (!next) return;
    memory = next;
    if (next === stored) return;
    try {
      window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Almacenamiento bloqueado: queda en memoria
    }
  } catch {
    // Nunca rompe el arranque de la página
  }
}
