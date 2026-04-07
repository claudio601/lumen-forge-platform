// src/lib/analytics.ts
// Helper minimo para GA4. No usa librerias externas.
// Carga el script de GTM dinamicamente si VITE_GA4_ID esta definida y es un ID real.
// Si no, todas las funciones son no-ops silenciosos.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const GA_ID = import.meta.env.VITE_GA4_ID as string | undefined;

// Valores que indican que el ID no esta configurado todavia
const PLACEHOLDER_VALUES = ['', 'PENDING_GA4_MEASUREMENT_ID', '__VITE_GA4_ID__'];

const isValidId = !!GA_ID && !PLACEHOLDER_VALUES.includes(GA_ID);

if (!isValidId) {
  console.warn('[analytics] VITE_GA4_ID no configurada o es placeholder — tracking desactivado.');
} else {
  // Inyectar script GTM dinamicamente
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);

  // Inicializar dataLayer y gtag
  window.dataLayer = window.dataLayer || [];
  function gtagFn(...args: unknown[]) {
    window.dataLayer!.push(args);
  }
  window.gtag = gtagFn;
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { send_page_view: false });
}

/** Wrapper seguro alrededor de window.gtag */
export function sendEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (!isValidId || typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, params);
}

/** Envia un page_view manual — usado por RouteTracker en App.tsx */
export function sendPageView(path: string): void {
  if (!isValidId || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    send_to: GA_ID,
  });
}

export { GA_ID };
