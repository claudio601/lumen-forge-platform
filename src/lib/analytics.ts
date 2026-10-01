// src/lib/analytics.ts
// Helper mínimo para GA4 (gtag.js), sin librerías externas.
// - Nada corre al importar: el script de Google se carga la primera vez que se
//   envía algo. Así el módulo se puede importar en Node al generar páginas estáticas.
// - gtag() empuja el objeto `arguments`, que es el formato que Google documenta.
//   La versión anterior empujaba un arreglo.
// - Consent Mode v2: por ahora todo "granted". El banner de cookies (Etapa 2,
//   PR 13) cambiará los valores por defecto a "denied".
// - Un solo detector de clics mide los enlaces a WhatsApp, correo y teléfono de
//   todo el sitio.
// Si VITE_GA4_ID no está definida (o es un placeholder), o el dominio no es el
// definitivo (ver ANALYTICS_HOSTS), todo es no-op.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    __elightsContactClick?: (e: MouseEvent) => void;
  }
}

type Params = Record<string, string | number | boolean>;

const GA_ID = import.meta.env.VITE_GA4_ID as string | undefined;

// Valores que indican que el ID no está configurado todavía
const PLACEHOLDER_VALUES = ['', 'PENDING_GA4_MEASUREMENT_ID', '__VITE_GA4_ID__'];

const isValidId = !!GA_ID && !PLACEHOLDER_VALUES.includes(GA_ID);

// G-C06JF3ZNH5 es la propiedad GA4 de la tienda elights.cl (tráfico de Google Ads,
// compras). Solo se mide desde los dominios definitivos: en nuevo.elights.cl y en
// los previews no se envía nada, para no mezclar datos con la tienda. Empieza a
// medir solo cuando el sitio se sirva como elights.cl (Etapa 3).
const ANALYTICS_HOSTS = (import.meta.env.VITE_ANALYTICS_HOSTS as string | undefined)?.split(',').map(h => h.trim()) ?? [
  'elights.cl',
  'www.elights.cl',
];

let initialized = false;

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

/** Carga gtag.js una sola vez. Devuelve false si no hay que medir (sin ID o fuera del navegador). */
function init(): boolean {
  if (!isValidId || typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!ANALYTICS_HOSTS.includes(window.location.hostname)) return false;
  if (initialized) return true;
  initialized = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- gtag.js exige el objeto arguments
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  });
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { send_page_view: false });

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);

  // Un solo detector aunque el módulo se cargue de nuevo (recarga en caliente).
  if (window.__elightsContactClick) document.removeEventListener('click', window.__elightsContactClick, true);
  window.__elightsContactClick = trackContactClick;
  document.addEventListener('click', trackContactClick, true);
  return true;
}

/** Envía un evento a GA4. */
export function sendEvent(eventName: string, params?: Params): void {
  if (!init()) return;
  window.gtag!('event', eventName, params);
}

/** Envía un page_view manual. Lo usa RouteTracker en App.tsx. */
export function sendPageView(path: string): void {
  if (!init()) return;
  window.gtag!('event', 'page_view', { page_path: path, send_to: GA_ID as string });
}

export type LeadFormType = 'solicitud_pedido' | 'cotizacion' | 'cotizador' | 'estudio_luminico' | 'instalacion';

/**
 * Lead enviado con éxito: el evento recomendado de GA4 (generate_lead), uno por
 * envío. Es el que se importa como conversión en Google Ads.
 */
export function trackLead(formType: LeadFormType, params?: Params): void {
  sendEvent('generate_lead', { form_type: formType, currency: 'CLP', ...params });
}

export { GA_ID };
