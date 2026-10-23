// src/lib/analytics.ts
// Cargador de Google Tag Manager (Etapa 2 · PR 14), sin librerías externas. Especificación de
// medición para la agencia, secciones 3 y 10 (~/proyectos/elights-gtm-2026-10/, fuera del repo).
// - Consent Mode v2 en modo básico. gtm.js (VITE_GTM_ID) se carga una sola vez, sin <noscript>,
//   solo después de que el visitante acepta la medición de visitas. La de anuncios y «Publicidad
//   en Meta» requieren la de visitas. Antes de insertar gtm.js: consent default en denied,
//   redacción de anuncios, consent update según la decisión, las claves de estado
//   (site_platform, elights_env, meta_consent) y la reposición de los ids de clic.
//   ad_personalization siempre en denied.
// - Sin decisión, con Rechazar o con una decisión vencida no hay ninguna petición a Google ni a
//   Meta, y no hay cola: lo ocurrido antes de decidir nunca se envía después.
// - El sitio no carga GA4 ni el píxel de Meta por su cuenta: los carga el contenedor, cada uno
//   con su consentimiento. El sitio nunca inicializa el píxel ni le envía eventos; solo le
//   retira el consentimiento (fbq('consent', 'revoke')) si el contenedor ya lo cargó.
// - Eventos: dataLayer.push({ event, … }) con todos los parámetros de EVENT_PARAMS (los que no
//   aplican, en undefined) y page_location limpia. Las claves de estado van solo en el envío
//   inicial y en elights_consent_update, nunca en otros eventos (ni como undefined): si no, GTM
//   las vaciaría y la excepción de Meta (meta_consent) bloquearía todo lo que sigue.
// - Ids de clic: captureLandingParams() (main.tsx, antes de React) guarda en memoria los
//   gclid, gbraid, wbraid y fbclid de la URL de llegada de esta carga completa. Si el visitante
//   acepta después de navegar, se vuelven a poner en la URL con history.replaceState antes de
//   cargar gtm.js o de avisar al contenedor: los de Google solo con la medición de anuncios y el
//   fbclid solo con Meta. Nunca pisa ids que ya están en la URL ni usa los de otra carga. Y al
//   revés: los ids sin consentimiento se quitan de la URL del navegador antes de cargar gtm.js y
//   en cada medición (gclid, gbraid y wbraid sin la de anuncios; fbclid sin Meta), porque el
//   píxel de Meta y los eventos automáticos de Google leen la dirección completa. Quedan en
//   memoria y vuelven si después se conceden.
// - Retirar un permiso con GTM cargado (applyCookieChoice): consent update, elights_consent_update,
//   ga-disable si se retira la medición de visitas, fbq('consent', 'revoke') si se retira Meta y
//   el píxel está cargado, borrado de lo que Google y Meta guardaron en el navegador (cookies y
//   almacenamiento local) y recarga de la página (GTM y el script de Meta no se pueden descargar). Si la decisión llegó desde otra pestaña no se recarga de golpe: la
//   siguiente navegación de esa pestaña es una carga completa.
// - Modo de prueba (sección 7.1): host de VITE_GTM_TEST_HOSTS y gtm_debug en la URL (Tag
//   Assistant), recordado en sessionStorage para esa pestaña. Abre el aviso, carga GTM con
//   elights_env: 'test' (el contenedor no dispara nada) y pone ga-disable por precaución.
// - Es el único archivo de src/ que toca document.cookie, y solo para borrar las cookies de
//   Google y de Meta al revocar (scripts/no-cookies.test.ts).
// - Clics de contacto: link_url sin el asunto ni el cuerpo de un mailto:, salvo el asunto «Datos
//   personales» (lo usa T07 para excluir ese correo). La confirmación de una solicitud enlaza un
//   correo con la referencia en el asunto, y la referencia nunca va a la capa de datos (3.5).
// - Nada corre al importar: el módulo se importa en Node al generar páginas estáticas. Los IDs y
//   los dominios se leen al llamar (las pruebas cambian el entorno con vi.stubEnv; en el build
//   Vite los reemplaza por su valor).
// - gtag() empuja el objeto `arguments`, que es el formato que Google documenta.
// - Un solo detector de clics mide los enlaces a WhatsApp, correo y teléfono de todo el sitio.
// Si VITE_GTM_ID no está definida (o no es un ID válido), o el dominio no mide y no es el modo
// de prueba, todo es no-op. Quitar VITE_GTM_ID en Vercel apaga toda la medición (8.4, nivel 5).

import { getCookieChoice, type CookieChoice } from './cookieConsent';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    /** Lo define el píxel de Meta si el contenedor lo cargó. El sitio solo retira el consentimiento. */
    fbq?: (...args: unknown[]) => void;
    __elightsContactClick?: (e: MouseEvent) => void;
  }
}

type ConsentValue = 'granted' | 'denied';
type ParamValue = string | number | boolean;

/**
 * Parámetros de evento (tabla 3.5 de la especificación, sin las claves de estado). Cada envío
 * los lleva todos: los que no aplican, en undefined, para que GTM no arrastre valores de un
 * evento anterior.
 */
export const EVENT_PARAMS = [
  'page_location',
  'page_path',
  'form_type',
  'currency',
  'item_count',
  'lead_type',
  'project_type',
  'tipo_proyecto',
  'tiene_planos',
  'objetivo_proyecto',
  'normativa_objetivo',
  'urgencia_proyecto',
  'link_url',
  'link_type',
  'item_id',
  'quantity',
  'unit_price',
  'subtotal',
  'customer_type',
  'reason',
  'http_status',
  'error_message',
] as const;
export type EventParam = (typeof EVENT_PARAMS)[number];
/** Lo que pasa quien llama (page_location la pone este módulo). */
export type EventParams = Partial<Record<Exclude<EventParam, 'page_location'>, ParamValue>>;

/** Claves de estado: solo el envío inicial y elights_consent_update. */
export const STATE_KEYS = ['site_platform', 'elights_env', 'meta_consent'] as const;

/** Eventos del sitio que van a GA4 (tabla 3.4 y regex del activador T09 del contenedor). */
export const SITE_EVENTS = [
  'generate_lead',
  'whatsapp_click',
  'contact_email_click',
  'contact_phone_click',
  'add_to_quote',
  'request_cart_add',
  'request_cart_view',
  'request_cart_remove',
  'request_form_start',
  'request_form_submit_error',
  'cotizacion_form_submit_error',
  'cotizador_submit_error',
  'estudio_luminico_form_submit',
  'estudio_luminico_form_submit_error',
  'instalacion_form_view',
  'instalacion_form_submit_attempt',
  'instalacion_form_submit_failure',
  'estudio_luminico_cta_hero_click',
  'instalacion_cta_hero_click',
  'instalacion_cta_final_click',
  // Guías (plan del blog, §5.5): clic en un llamado hacia /cotizador o /estudio-luminico
  'guia_cta_click',
] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];

/** Marca del sitio en la capa de datos (variable DLV - site_platform del contenedor). */
export const SITE_PLATFORM = 'elights-web';

// Valores que indican que el ID de GA4 no está configurado todavía
const PLACEHOLDER_VALUES = ['', 'PENDING_GA4_MEASUREMENT_ID', '__VITE_GA4_ID__'];
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;

// G-C06JF3ZNH5 es la propiedad GA4 de la tienda elights.cl (tráfico de Google Ads,
// compras). Solo se mide desde los dominios definitivos: en nuevo.elights.cl y en
// los previews no se carga nada (salvo el modo de prueba), para no mezclar datos con la
// tienda. Empieza a medir solo cuando el sitio se sirva como elights.cl (Etapa 3).
const DEFAULT_HOSTS = ['elights.cl', 'www.elights.cl'];

/** Ids de clic de Google Ads: vuelven a la URL solo con la medición de anuncios. */
const GOOGLE_CLICK_IDS = ['gclid', 'gbraid', 'wbraid'] as const;
/** Ids de clic de anuncios: sin la medición de anuncios no van a Google en la URL. */
const CLICK_IDS = [...GOOGLE_CLICK_IDS, 'fbclid'] as const;
type ClickId = (typeof CLICK_IDS)[number];
/** Un id más largo no es de un anuncio: no se guarda. */
const MAX_CLICK_ID_LENGTH = 512;

/** Cookies de Google Ads que se borran al quitar la medición de anuncios. */
const GCL_COOKIES = ['_gcl_au', '_gcl_aw', '_gcl_gb', '_gcl_dc'];
/**
 * Almacenamiento local de Google Ads: la etiqueta de Google guarda en _gcl_ls los ids de clic y
 * su vencimiento, con ad_storage y ad_user_data concedidos (gtag de AW-774649578 y de
 * G-C06JF3ZNH5 del 16-10-2026).
 */
const GCL_STORAGE = ['_gcl_ls'];
/**
 * Cookies del píxel de Meta que se borran al quitar «Publicidad en Meta»: _fbp y _fbc, y _fbleid,
 * que el script del píxel puede escribir en un Lead (código del píxel descargado el 22-10-2026).
 */
const META_COOKIES = ['_fbp', '_fbc', '_fbleid'];
/**
 * Almacenamiento local que puede escribir el píxel de Meta (su script y la configuración del
 * píxel 590822921694460, 22-10-2026). Se confirma en la fase A (pestaña Aplicación).
 */
const META_STORAGE = ['multiFbc', 'fbcEbpOrigin', 'lastExternalReferrer', 'lastExternalReferrerTime'];
/** El único asunto de correo que llega a la capa de datos (T07 excluye ese correo). */
const DATA_SUBJECT = 'Datos personales';

/** sessionStorage: el modo de prueba sigue activo en esta pestaña después de navegar. */
const TEST_MODE_KEY = 'elights_gtm_debug';

const DENIED_ALL: Record<string, ConsentValue> = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
};

/** El ID del contenedor (VITE_GTM_ID), o undefined si falta o no es un ID de GTM. */
export function gtmId(): string | undefined {
  const id = (import.meta.env.VITE_GTM_ID as string | undefined)?.trim();
  return id && GTM_ID.test(id) ? id : undefined;
}

/** El ID de medición de GA4 (VITE_GA4_ID), solo para ga-disable; undefined si falta. */
export function gaId(): string | undefined {
  const id = import.meta.env.VITE_GA4_ID as string | undefined;
  return id && !PLACEHOLDER_VALUES.includes(id) ? id : undefined;
}

function hostList(raw: string | undefined, fallback: readonly string[]): string[] {
  if (raw === undefined) return [...fallback];
  return raw
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Dominios que miden (VITE_ANALYTICS_HOSTS; por defecto elights.cl y www.elights.cl). */
function measuringHosts(): string[] {
  return hostList(import.meta.env.VITE_ANALYTICS_HOSTS as string | undefined, DEFAULT_HOSTS);
}

/** Hosts del modo de prueba (VITE_GTM_TEST_HOSTS, host exacto; por defecto ninguno). */
function testHosts(): string[] {
  return hostList(import.meta.env.VITE_GTM_TEST_HOSTS as string | undefined, []);
}

const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Ids de clic de la URL de llegada de esta carga completa (captureLandingParams). */
let landing: Partial<Record<ClickId, string>> = {};
/** El modo de prueba ya se activó en esta carga (respaldo si sessionStorage falla). */
let testRemembered = false;

function rememberTestMode(): void {
  testRemembered = true;
  try {
    window.sessionStorage.setItem(TEST_MODE_KEY, '1');
  } catch {
    // Almacenamiento bloqueado: vale para esta carga
  }
}

/**
 * Al arrancar (main.tsx, antes de React, una vez por carga completa): guarda en memoria los
 * ids de clic de la URL de llegada y, en un host de prueba con gtm_debug, recuerda el modo de
 * prueba en esta pestaña. Es una copia propia, distinta del origen de la visita (que puede
 * venir de la sesión y que el visitante puede apagar). Nunca lanza.
 */
export function captureLandingParams(href?: string): void {
  if (!inBrowser()) return;
  try {
    const url = new URL(href ?? window.location.href);
    const ids: Partial<Record<ClickId, string>> = {};
    for (const key of CLICK_IDS) {
      const value = url.searchParams.get(key);
      if (value && value.length <= MAX_CLICK_ID_LENGTH) ids[key] = value;
    }
    landing = ids;
    if (url.searchParams.has('gtm_debug') && testHosts().includes(url.hostname.toLowerCase())) rememberTestMode();
  } catch {
    landing = {};
  }
}

/**
 * Modo de prueba (sección 7.1): el host está en VITE_GTM_TEST_HOSTS y la URL trae gtm_debug (el
 * parámetro de Tag Assistant), o ya lo trajo en esta pestaña. Independiente de los dominios que
 * miden.
 */
export function testMode(): boolean {
  if (!inBrowser()) return false;
  if (!testHosts().includes(window.location.hostname.toLowerCase())) return false;
  if (new URLSearchParams(window.location.search).has('gtm_debug')) {
    rememberTestMode();
    return true;
  }
  if (testRemembered) return true;
  try {
    return window.sessionStorage.getItem(TEST_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Hay contenedor, estamos en el navegador y el dominio mide (o es el modo de prueba). */
export function analyticsAvailable(): boolean {
  if (!gtmId() || !inBrowser()) return false;
  return measuringHosts().includes(window.location.hostname) || testMode();
}

/** gtm.js ya se insertó en esta carga. */
let loaded = false;
/** La decisión que rige en esta página (la del envío inicial o la última aplicada). */
let applied: CookieChoice | null = null;
/** Se retiró un permiso: no se envía nada más en esta carga (viene la recarga). */
let paused = false;
/** Se retiró un permiso desde otra pestaña: la siguiente navegación es una carga completa. */
let reloadPending = false;
let reloading = false;

/** La recarga, aparte para poder probarla (jsdom no navega). */
export const page = {
  reload(): void {
    window.location.reload();
  },
};

/** Decisión normalizada: anuncios y Meta solo con la medición de visitas. */
function normalize(c: CookieChoice): CookieChoice {
  const analytics = c.analytics === true;
  return { analytics, ads: analytics && c.ads === true, meta: analytics && c.meta === true, origin: c.origin };
}

/** La decisión vigente, normalizada. */
function currentChoice(): CookieChoice | null {
  const c = getCookieChoice();
  return c && normalize(c);
}

const consentValue = (granted: boolean): ConsentValue => (granted ? 'granted' : 'denied');

function consentState(c: CookieChoice): Record<string, ConsentValue> {
  return {
    analytics_storage: consentValue(c.analytics),
    ad_storage: consentValue(c.ads),
    ad_user_data: consentValue(c.ads),
    ad_personalization: 'denied',
  };
}

const disableKey = (id: string) => 'ga-disable-' + id;

function setGaDisabled(disabled: boolean): void {
  const id = gaId();
  if (id) (window as unknown as Record<string, unknown>)[disableKey(id)] = disabled;
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

const herePath = () => window.location.pathname + window.location.search;

/**
 * Quita de la URL del navegador los ids de clic sin consentimiento: gclid, gbraid y wbraid sin la
 * medición de anuncios, y fbclid sin Meta. El píxel de Meta envía la dirección completa de la
 * página y los eventos automáticos de Google la leen: así cada id llega solo con su propio
 * consentimiento. El resto de la consulta queda tal cual, y el estado del historial (React
 * Router) también. Los ids de la llegada siguen en memoria: restoreClickIds los repone si
 * después se conceden. Nunca lanza.
 */
function stripUnconsentedClickIds(c: CookieChoice): void {
  try {
    const { pathname, search, hash } = window.location;
    if (search.length < 2) return;
    const blocked = (key: string) => (CLICK_IDS as readonly string[]).includes(key) && (key === 'fbclid' ? !c.meta : !c.ads);
    const parts = search.slice(1).split('&');
    const kept = parts.filter(part => !blocked(part.split('=')[0]));
    if (kept.length === parts.length) return;
    const rest = kept.filter(Boolean).join('&');
    window.history.replaceState(window.history.state, '', pathname + (rest ? '?' + rest : '') + hash);
  } catch {
    // Sin historial (navegador muy antiguo): page_location y page_path igual van limpias
  }
}

/** origin + ruta + consulta, sin # y, sin la medición de anuncios, sin ids de clic. */
function cleanLocation(c: CookieChoice): string {
  const path = herePath();
  return window.location.origin + (c.ads ? path : stripClickIds(path));
}

/**
 * Vuelve a poner en la URL los ids de clic de la llegada que falten (sección 3.2): los de
 * Google con `google`, el fbclid con `meta`. No pisa ninguno que ya esté en la URL y conserva
 * el estado del historial (React Router). Nunca lanza.
 */
function restoreClickIds(google: boolean, meta: boolean): void {
  try {
    const { pathname, search, hash } = window.location;
    const params = new URLSearchParams(search);
    const add: string[] = [];
    if (google && !GOOGLE_CLICK_IDS.some(k => params.has(k))) {
      for (const k of GOOGLE_CLICK_IDS) {
        const value = landing[k];
        if (value) add.push(k + '=' + encodeURIComponent(value));
      }
    }
    if (meta && !params.has('fbclid') && landing.fbclid) add.push('fbclid=' + encodeURIComponent(landing.fbclid));
    if (!add.length) return;
    const query = (search.length > 1 ? search + '&' : '?') + add.join('&');
    window.history.replaceState(window.history.state, '', pathname + query + hash);
  } catch {
    // Sin historial (navegador muy antiguo): sigue sin los ids
  }
}

function push(entry: Record<string, unknown>): void {
  window.dataLayer!.push(entry);
}

/**
 * Un evento con todos los parámetros de EVENT_PARAMS (undefined los que no aplican) y
 * page_location limpia. Solo copia claves de EVENT_PARAMS: nunca una clave de estado. Sin la
 * medición de anuncios, page_path va sin ids de clic.
 */
function eventEntry(name: string, params: EventParams, c: CookieChoice): Record<string, unknown> {
  const entry: Record<string, unknown> = { event: name };
  for (const key of EVENT_PARAMS) entry[key] = undefined;
  for (const key of EVENT_PARAMS) {
    if (key !== 'page_location' && key in params) entry[key] = params[key as keyof EventParams];
  }
  if (typeof entry.page_path === 'string' && !c.ads) entry.page_path = stripClickIds(entry.page_path);
  entry.page_location = cleanLocation(c);
  return entry;
}

/** Las claves de estado: el envío inicial y elights_consent_update. */
function stateKeys(c: CookieChoice): Record<string, string> {
  return { site_platform: SITE_PLATFORM, elights_env: testMode() ? 'test' : 'prod', meta_consent: consentValue(c.meta) };
}

/** elights_consent_update: la decisión que quedó y las claves de estado. */
function consentUpdateEntry(c: CookieChoice): Record<string, unknown> {
  return {
    ...eventEntry('elights_consent_update', {}, c),
    analytics_consent: consentValue(c.analytics),
    ads_consent: consentValue(c.ads),
    ...stateKeys(c),
  };
}

/**
 * link_url para la capa de datos (tabla 3.5). En un mailto:, solo la dirección, y el asunto solo
 * si es «Datos personales» (T07 lo usa para no contar ese correo como conversión). Cualquier
 * otro asunto o cuerpo se descarta: el correo de la confirmación de una solicitud lleva la
 * referencia en el asunto (RequestConfirmation), y la referencia nunca va a la capa de datos.
 * WhatsApp y teléfono, tal cual.
 */
export function contactLinkUrl(href: string): string {
  if (!/^mailto:/i.test(href)) return href;
  const q = href.indexOf('?');
  if (q < 0) return href;
  const address = href.slice(0, q);
  try {
    if (new URLSearchParams(href.slice(q + 1)).get('subject') === DATA_SUBJECT) {
      return address + '?subject=' + encodeURIComponent(DATA_SUBJECT);
    }
  } catch {
    // Consulta ilegible: solo la dirección
  }
  return address;
}

/** Clics en enlaces de contacto (cualquier página): un evento por clic. */
function trackContactClick(e: MouseEvent): void {
  const link = (e.target as Element | null)?.closest?.('a[href]');
  const href = link?.getAttribute('href') ?? '';
  const type = /wa\.me\/|api\.whatsapp\.com|^whatsapp:/i.test(href)
    ? 'whatsapp'
    : href.startsWith('mailto:')
      ? 'email'
      : href.startsWith('tel:')
        ? 'phone'
        : '';
  if (!type) return;
  const name: SiteEvent = type === 'whatsapp' ? 'whatsapp_click' : type === 'email' ? 'contact_email_click' : 'contact_phone_click';
  sendEvent(name, { link_url: contactLinkUrl(href), link_type: type, page_path: herePath() });
}

/**
 * Carga GTM una sola vez, solo con la medición de visitas aceptada, en el orden de la sección
 * 3.2. Devuelve false si no hay que medir (sin consentimiento, sin ID, fuera de los dominios y
 * del modo de prueba, fuera del navegador o después de retirar un permiso).
 */
function init(c: CookieChoice | null): c is CookieChoice {
  if (!c?.analytics || !analyticsAvailable()) return false;
  // Si otro script borró gtag, no se mide (y nunca se lanza un error dentro de React).
  if (loaded) return !paused && typeof window.gtag === 'function';
  loaded = true;
  applied = c;
  const test = testMode();

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- gtag exige el objeto arguments
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', DENIED_ALL);
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('consent', 'update', consentState(c));
  // En el modo de prueba, GA4 queda desactivado por precaución (el contenedor tampoco dispara)
  setGaDisabled(test);
  push(stateKeys(c));
  stripUnconsentedClickIds(c);
  restoreClickIds(c.ads, c.meta);
  push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(gtmId()!);
  document.head.appendChild(s);

  // Un solo detector aunque el módulo se cargue de nuevo (recarga en caliente).
  if (window.__elightsContactClick) document.removeEventListener('click', window.__elightsContactClick, true);
  window.__elightsContactClick = trackContactClick;
  document.addEventListener('click', trackContactClick, true);
  return true;
}

/** elights_page_view con la decisión dada (la de applyCookieChoice o la guardada). */
function pageView(c: CookieChoice | null, path?: string): void {
  if (!init(c)) return;
  stripUnconsentedClickIds(c);
  const page_location = cleanLocation(c);
  // Los eventos automáticos que ocurran en esta página usan la misma ubicación limpia.
  window.gtag?.('set', { page_location });
  push(eventEntry('elights_page_view', { page_path: path ?? herePath() }, c));
}

function reload(): void {
  paused = true;
  if (reloading) return;
  reloading = true;
  try {
    page.reload();
  } catch {
    // Sin recarga posible: la página ya no envía nada (paused)
  }
}

/** Envía un evento del sitio (solo con la medición de visitas aceptada). */
export function sendEvent(eventName: SiteEvent, params: EventParams = {}): void {
  const c = currentChoice();
  if (!init(c)) return;
  stripUnconsentedClickIds(c);
  push(eventEntry(eventName, params, c));
}

/**
 * Vista de página (elights_page_view; GTM envía el page_view). La usa RouteTracker en App.tsx
 * con la ruta y su consulta. Si otra pestaña retiró un permiso, esta navegación es una carga
 * completa.
 */
export function sendPageView(path: string): void {
  if (reloadPending) {
    reload();
    return;
  }
  pageView(currentChoice(), path);
}

/** Expira una cookie en este host y dominio. Lo único que este sitio escribe en document.cookie. */
function expireCookie(name: string, domain?: string): void {
  document.cookie = `${name}=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? '; domain=' + domain : ''}`;
}

/**
 * Borra de este navegador lo que Google y Meta guardaron con lo que ya no está permitido:
 * cookies _ga y _ga_* (visitas); _gcl_* y _gcl_ls del almacenamiento local (anuncios); _fbp,
 * _fbc, _fbleid y las claves del píxel en el almacenamiento local (Meta). Las cookies, sin
 * domain, en .elights.cl y en el host.
 */
function deleteCookies(which: { analytics: boolean; ads: boolean; meta: boolean }): void {
  if (!which.analytics && !which.ads && !which.meta) return;
  try {
    const keys = [...(which.ads ? GCL_STORAGE : []), ...(which.meta ? META_STORAGE : [])];
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Almacenamiento bloqueado: no hay nada que borrar
  }
  try {
    const present = document.cookie
      .split(';')
      .map(part => part.split('=')[0].trim())
      .filter(Boolean);
    const names = new Set<string>();
    if (which.ads) {
      for (const name of GCL_COOKIES) names.add(name);
      for (const name of present) if (name.startsWith('_gcl_')) names.add(name);
    }
    if (which.analytics) {
      names.add('_ga');
      for (const name of present) if (name.startsWith('_ga_')) names.add(name);
    }
    if (which.meta) for (const name of META_COOKIES) names.add(name);
    const domains = [undefined, '.elights.cl', window.location.hostname];
    for (const name of names) for (const domain of domains) expireCookie(name, domain);
  } catch {
    // Cookies bloqueadas: no hay nada que borrar
  }
}

export interface ApplyOptions {
  /** La decisión llegó desde otra pestaña (evento storage): no se recarga de golpe. */
  otherTab?: boolean;
}

/**
 * Aplica una decisión del aviso de cookies (la registra CookieConsent; cubre esta pestaña y
 * las otras). No hace nada fuera de los dominios que miden y del modo de prueba.
 * - Sin GTM cargado y sin la medición de visitas: borra las cookies de Google y de Meta.
 * - Sin GTM cargado y con la medición de visitas: borra las cookies de lo no permitido (por
 *   ejemplo una _gcl que dejó la tienda), carga GTM y envía la primera vista.
 * - Con GTM cargado, si retira un permiso: consent update, elights_consent_update, ga-disable
 *   (visitas), fbq('consent', 'revoke') (Meta, si el píxel está cargado), borrado de cookies y
 *   recarga. Desde otra pestaña, sin recarga: la siguiente navegación es una carga completa.
 * - Con GTM cargado, si concede o amplía: repone los ids de clic de lo que se concede, consent
 *   update y elights_consent_update; si Meta pasa a concedido, también elights_meta_granted.
 */
export function applyCookieChoice(choice: CookieChoice | null, options: ApplyOptions = {}): void {
  if (!choice || !analyticsAvailable()) return;
  const c = normalize(choice);

  if (!loaded) {
    if (!c.analytics) {
      deleteCookies({ analytics: true, ads: true, meta: true });
      return;
    }
    deleteCookies({ analytics: false, ads: !c.ads, meta: !c.meta });
    pageView(c);
    return;
  }

  const prev = applied ?? c;
  applied = c;
  stripUnconsentedClickIds(c);
  const withdrawn = {
    analytics: prev.analytics && !c.analytics,
    ads: prev.ads && !c.ads,
    meta: prev.meta && !c.meta,
  };
  if (withdrawn.analytics || withdrawn.ads || withdrawn.meta) {
    if (!paused) {
      window.gtag?.('consent', 'update', consentState(c));
      push(consentUpdateEntry(c));
    }
    if (withdrawn.analytics) setGaDisabled(true);
    if (withdrawn.meta && typeof window.fbq === 'function') {
      try {
        window.fbq('consent', 'revoke');
      } catch {
        // El píxel falló: igual se borran sus cookies y se recarga
      }
    }
    deleteCookies({ analytics: !c.analytics, ads: !c.ads, meta: !c.meta });
    if (options.otherTab) {
      reloadPending = true;
      if (withdrawn.analytics) paused = true;
    } else {
      reload();
    }
    return;
  }

  // Después de un retiro en otra pestaña, lo que decida esta pestaña se aplica con una recarga
  if (reloadPending || paused) {
    if (!options.otherTab) reload();
    return;
  }
  restoreClickIds(c.ads && !prev.ads, c.meta && !prev.meta);
  window.gtag?.('consent', 'update', consentState(c));
  push(consentUpdateEntry(c));
  if (c.meta && !prev.meta) push(eventEntry('elights_meta_granted', {}, c));
  deleteCookies({ analytics: false, ads: !c.ads, meta: !c.meta });
}

/**
 * Dónde está el llamado de una guía: en el texto o en el recuadro final. Son valores propios de
 * link_type, distintos de los de contacto (whatsapp, email, phone), que usa la tabla de Meta
 * Contact (scripts/check-gtm-export.ts).
 */
export type GuideCtaPlace = 'guia_texto' | 'guia_recuadro';

/**
 * Clic en un llamado de una guía hacia /cotizador o /estudio-luminico (plan del blog, §5.5): un
 * guia_cta_click con el destino (link_url), el lugar (link_type) y la guía (page_path). Como todo
 * evento, solo con la medición de visitas aceptada (sendEvent). Los clics a ventas@elights.cl ya
 * los mide contact_email_click.
 */
export function trackGuideCta(place: GuideCtaPlace, linkUrl: string, pagePath: string): void {
  sendEvent('guia_cta_click', { link_url: linkUrl, link_type: place, page_path: pagePath });
}

export type LeadFormType = 'solicitud_pedido' | 'cotizacion' | 'cotizador' | 'estudio_luminico' | 'instalacion';

/**
 * Solicitud confirmada por el servidor: el evento recomendado de GA4 (generate_lead), uno por
 * envío. Solo se llama si la respuesta trae la referencia (la trampa contra bots responde
 * { success: true } sin ella); la referencia nunca va a la capa de datos. En el contenedor
 * dispara las conversiones de Google Ads (A04 y A05) y el Lead de Meta.
 */
export function trackLead(formType: LeadFormType, params: Omit<EventParams, 'form_type' | 'currency'> = {}): void {
  sendEvent('generate_lead', { ...params, form_type: formType, currency: 'CLP' });
}
