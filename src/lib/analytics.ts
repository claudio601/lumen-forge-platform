// src/lib/analytics.ts
// Helper mínimo para GA4 (gtag.js), sin librerías externas.
// - Consent Mode v2 en modo básico (PR 13). gtag.js solo se carga después de que el
//   visitante acepta la medición de visitas. La de anuncios requiere la de visitas. Los
//   valores por defecto van en denied y ad_personalization siempre en denied.
// - Sin decisión, con Rechazar o con una decisión vencida no hay ninguna petición a Google,
//   y no hay cola: lo ocurrido antes de decidir nunca se envía después.
// - Revocar en la misma página (applyCookieChoice): consent update en denied,
//   window['ga-disable-<ID>'] = true (el interruptor documentado de GA; detiene también la
//   medición mejorada) y se borran las cookies _ga y _gcl. Es el único archivo de src/ que
//   toca document.cookie, y solo para borrar (scripts/no-cookies.test.ts).
// - Google Signals y las señales de personalización de anuncios van apagados por código.
// - Nada corre al importar: el módulo se importa en Node al generar páginas estáticas.
// - El ID y los dominios se leen al llamar, no al importar (las pruebas cambian el entorno
//   con vi.stubEnv; en el build Vite los reemplaza por su valor).
// - gtag() empuja el objeto `arguments`, que es el formato que Google documenta.
// - Un solo detector de clics mide los enlaces a WhatsApp, correo y teléfono de todo el
//   sitio.
// Si VITE_GA4_ID no está definida (o es un placeholder), o el dominio no es el definitivo
// (ver analyticsHosts), todo es no-op.

import { getCookieChoice, type CookieChoice } from './cookieConsent';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    __elightsContactClick?: (e: MouseEvent) => void;
  }
}

type Params = Record<string, string | number | boolean>;
type ConsentValue = 'granted' | 'denied';

// Valores que indican que el ID no está configurado todavía
const PLACEHOLDER_VALUES = ['', 'PENDING_GA4_MEASUREMENT_ID', '__VITE_GA4_ID__'];

// G-C06JF3ZNH5 es la propiedad GA4 de la tienda elights.cl (tráfico de Google Ads,
// compras). Solo se mide desde los dominios definitivos: en nuevo.elights.cl y en
// los previews no se envía nada, para no mezclar datos con la tienda. Empieza a
// medir solo cuando el sitio se sirva como elights.cl (Etapa 3).
const DEFAULT_HOSTS = ['elights.cl', 'www.elights.cl'];

/** Ids de clic de anuncios: sin la medición de anuncios no van a Google en la URL. */
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid'];

/** Cookies de Google Ads que se borran al quitar la medición de anuncios. */
const GCL_COOKIES = ['_gcl_au', '_gcl_aw', '_gcl_gb', '_gcl_dc'];

/** 395 días (≈ 13 meses), en segundos. */
const COOKIE_EXPIRES_SECONDS = 34128000;

/** El ID de medición, o undefined si falta o es un placeholder. */
export function gaId(): string | undefined {
  const id = import.meta.env.VITE_GA4_ID as string | undefined;
  return id && !PLACEHOLDER_VALUES.includes(id) ? id : undefined;
}

function analyticsHosts(): string[] {
  const raw = import.meta.env.VITE_ANALYTICS_HOSTS as string | undefined;
  return raw?.split(',').map(h => h.trim()) ?? DEFAULT_HOSTS;
}

/** Hay ID válido, estamos en el navegador y el dominio es uno de los que miden. */
export function analyticsAvailable(): boolean {
  if (!gaId() || typeof window === 'undefined' || typeof document === 'undefined') return false;
  return analyticsHosts().includes(window.location.hostname);
}

let initialized = false;

/** La decisión vigente, normalizada (anuncios solo con visitas). */
function currentChoice(): CookieChoice | null {
  const c = getCookieChoice();
  return c && { analytics: c.analytics === true, ads: c.ads === true && c.analytics === true, origin: c.origin };
}

function consentState(c: CookieChoice): Record<string, ConsentValue> {
  const ads: ConsentValue = c.analytics && c.ads ? 'granted' : 'denied';
  return {
    analytics_storage: c.analytics ? 'granted' : 'denied',
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: 'denied',
  };
}

const disableKey = (id: string) => 'ga-disable-' + id;

function isDisabled(id: string): boolean {
  return (window as unknown as Record<string, unknown>)[disableKey(id)] === true;
}

function setDisabled(id: string, disabled: boolean): void {
  (window as unknown as Record<string, unknown>)[disableKey(id)] = disabled;
}

/** Ruta (con su consulta) sin gclid, gbraid, wbraid ni fbclid. Sin ids, la deja igual. */
function stripClickIds(path: string): string {
  const q = path.indexOf('?');
  if (q < 0) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  if (!CLICK_IDS.some(k => params.has(k))) return path;
  for (const k of CLICK_IDS) params.delete(k);
  const rest = params.toString();
  return path.slice(0, q) + (rest ? '?' + rest : '');
}

/** origin + ruta + consulta, sin # y, sin la medición de anuncios, sin ids de clic. */
function cleanLocation(c: CookieChoice): string {
  const { origin, pathname, search } = window.location;
  const path = pathname + search;
  return origin + (c.ads ? path : stripClickIds(path));
}

/** Clics en enlaces de contacto (cualquier página): un evento por clic. */
function trackContactClick(e: MouseEvent): void {
  const link = (e.target as Element | null)?.closest?.('a[href]');
  const href = link?.getAttribute('href') ?? '';
  const name = /wa\.me\/|api\.whatsapp\.com|^whatsapp:/i.test(href)
    ? 'whatsapp_click'
    : href.startsWith('mailto:')
      ? 'contact_email_click'
      : href.startsWith('tel:')
        ? 'contact_phone_click'
        : '';
  if (name) sendEvent(name, { page_path: window.location.pathname });
}

/**
 * Carga gtag.js una sola vez, solo con la medición de visitas aceptada. Devuelve false si
 * no hay que medir (sin consentimiento, sin ID, fuera de los dominios o fuera del navegador).
 * El consentimiento se revisa antes del atajo `initialized`.
 */
function init(c: CookieChoice | null): boolean {
  if (!analyticsAvailable() || c?.analytics !== true) return false;
  // Si otro script borró gtag, no se mide (y nunca se lanza un error dentro de React).
  if (initialized) return typeof window.gtag === 'function';
  initialized = true;
  const id = gaId()!;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- gtag.js exige el objeto arguments
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('consent', 'update', consentState(c));
  setDisabled(id, false);
  window.gtag('js', new Date());
  // Sin page_location aquí: quedaría pegado en los eventos automáticos después de navegar.
  window.gtag('config', id, {
    send_page_view: false,
    cookie_expires: COOKIE_EXPIRES_SECONDS,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
  document.head.appendChild(s);

  // Un solo detector aunque el módulo se cargue de nuevo (recarga en caliente).
  if (window.__elightsContactClick) document.removeEventListener('click', window.__elightsContactClick, true);
  window.__elightsContactClick = trackContactClick;
  document.addEventListener('click', trackContactClick, true);
  return true;
}

/** page_view con la decisión dada (la de applyCookieChoice o la guardada). */
function pageView(c: CookieChoice | null, path: string): void {
  if (!init(c)) return;
  const id = gaId()!;
  if (isDisabled(id)) return;
  const page_location = cleanLocation(c);
  // Los eventos automáticos que ocurran en esta página usan la misma ubicación limpia.
  window.gtag?.('set', { page_location });
  window.gtag?.('event', 'page_view', {
    page_location,
    page_path: c.ads ? path : stripClickIds(path),
    send_to: id,
  });
}

/** Envía un evento a GA4 (solo con la medición de visitas aceptada). */
export function sendEvent(eventName: string, params?: Params): void {
  const c = currentChoice();
  if (!init(c) || isDisabled(gaId()!)) return;
  window.gtag?.('event', eventName, { ...params, page_location: cleanLocation(c) });
}

/** Envía un page_view manual. Lo usa RouteTracker en App.tsx. */
export function sendPageView(path: string): void {
  pageView(currentChoice(), path);
}

/** Expira una cookie en este host y dominio. Lo único que este sitio escribe en document.cookie. */
function expireCookie(name: string, domain?: string): void {
  document.cookie = `${name}=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? '; domain=' + domain : ''}`;
}

/** Borra _gcl_* y, con withAnalytics, también _ga y _ga_* (sin domain, en .elights.cl y en el host). */
function deleteGoogleCookies(withAnalytics: boolean): void {
  try {
    const present = document.cookie
      .split(';')
      .map(part => part.split('=')[0].trim())
      .filter(Boolean);
    const names = new Set(GCL_COOKIES);
    for (const name of present) {
      if (name.startsWith('_gcl_')) names.add(name);
      if (withAnalytics && (name === '_ga' || name.startsWith('_ga_'))) names.add(name);
    }
    if (withAnalytics) names.add('_ga');
    const domains = [undefined, '.elights.cl', window.location.hostname];
    for (const name of names) for (const domain of domains) expireCookie(name, domain);
  } catch {
    // Cookies bloqueadas: no hay nada que borrar
  }
}

/**
 * Aplica una decisión del aviso de cookies (la registra CookieConsent; cubre esta pestaña y
 * las otras). No hace nada fuera de los dominios que miden.
 * - Sin gtag cargado y con la medición de visitas: lo carga y envía la primera vista (sin la
 *   de anuncios, antes borra las _gcl que quedaron, por ejemplo de una decisión vencida).
 * - Sin la medición de visitas: consent en denied, ga-disable y se borran _ga y _gcl.
 * - Con gtag cargado y la medición de visitas: consent según la decisión; si venía de
 *   revocar, un page_view de la página actual.
 * - Sin la medición de anuncios: se borran las _gcl, con o sin gtag cargado.
 */
export function applyCookieChoice(choice: CookieChoice | null): void {
  if (!choice || !analyticsAvailable()) return;
  const c: CookieChoice = {
    analytics: choice.analytics === true,
    ads: choice.ads === true && choice.analytics === true,
    origin: choice.origin,
  };
  const id = gaId()!;
  const here = window.location.pathname + window.location.search;

  if (!c.analytics) {
    if (initialized) {
      window.gtag?.('consent', 'update', consentState(c));
      setDisabled(id, true);
    }
    deleteGoogleCookies(true);
    return;
  }
  if (!initialized) {
    if (!c.ads) deleteGoogleCookies(false);
    pageView(c, here);
    return;
  }
  const wasDisabled = isDisabled(id);
  setDisabled(id, false);
  window.gtag?.('consent', 'update', consentState(c));
  if (!c.ads) deleteGoogleCookies(false);
  if (wasDisabled) pageView(c, here);
}

export type LeadFormType = 'solicitud_pedido' | 'cotizacion' | 'cotizador' | 'estudio_luminico' | 'instalacion';

/**
 * Lead enviado con éxito: el evento recomendado de GA4 (generate_lead), uno por envío. Hoy
 * no es evento clave en la propiedad (lo son purchase, whatsapp_click, qualify_lead y
 * close_convert_lead): para importarlo como conversión en Google Ads hay que marcarlo en GA4.
 */
export function trackLead(formType: LeadFormType, params?: Params): void {
  sendEvent('generate_lead', { form_type: formType, currency: 'CLP', ...params });
}
