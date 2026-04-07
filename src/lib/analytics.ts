// src/lib/analytics.ts
// Helper minimo para GA4. No usa librerias externas.
// Si VITE_GA4_ID no esta definida, todas las funciones son no-ops seguros.

declare global {
    interface Window {
          gtag?: (...args: unknown[]) => void;
          dataLayer?: unknown[];
    }
}

const GA_ID = import.meta.env.VITE_GA4_ID as string | undefined;

if (!GA_ID) {
    console.warn('[analytics] VITE_GA4_ID no definida — tracking desactivado.');
}

/** Wrapper seguro alrededor de window.gtag */
export function sendEvent(
    eventName: string,
    params?: Record<string, string | number | boolean>
  ): void {
    if (!GA_ID || typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, params);
}

/** Envia un page_view manual — usado por RouteTracker en App.tsx */
export function sendPageView(path: string): void {
    if (!GA_ID || typeof window.gtag !== 'function') return;
    window.gtag('event', 'page_view', {
          page_path: path,
          send_to: GA_ID,
    });
}

export { GA_ID };
