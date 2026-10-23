// El módulo de analytics se importa al generar páginas estáticas en Node
// (Etapa 2, prerender): no debe tocar window ni document al importarse ni al llamarse.
// Desde la PR 13 tampoco la decisión de cookies: en Node todo es «sin decisión», también
// con un almacenamiento que diga que el visitante aceptó. Desde la PR 14 (GTM), lo mismo con
// el ID del contenedor, los ids de clic de la llegada y el modo de prueba.

import { afterEach, describe, expect, it, vi } from 'vitest';

// Rutas en variable: el tsconfig de scripts/ no incluye tipos del navegador, así que los
// módulos se importan sin que tsc los revise aquí (ya lo revisa el de src/).
const MODULE = '../src/lib/analytics';
const CONSENT_MODULE = '../src/lib/cookieConsent';

interface Choice {
  analytics: boolean;
  ads: boolean;
  meta: boolean;
  origin: boolean;
}

interface Analytics {
  sendPageView(path: string): void;
  sendEvent(name: string, params?: Record<string, string | number | boolean>): void;
  trackLead(formType: string, params?: Record<string, string | number | boolean>): void;
  applyCookieChoice(choice: Choice | null, options?: { otherTab?: boolean }): void;
  analyticsAvailable(): boolean;
  captureLandingParams(href?: string): void;
  testMode(): boolean;
}

interface CookieConsent {
  getCookieChoice(): Choice | null;
  setCookieChoice(choice: Choice): Choice;
  isOriginOptedOut(): boolean;
  openCookieSettings(): void;
  bannerTestHost(hostname?: string): boolean;
  subscribe(listener: (c: Choice | null) => void): () => void;
}

const g = globalThis as Record<string, unknown>;

describe('analytics en Node (sin navegador)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('importar y llamar con IDs reales no falla y no hace nada', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_GTM_ID', 'GTM-TEST123');
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');
    vi.stubEnv('VITE_GTM_TEST_HOSTS', 'localhost');
    const a = (await import(/* @vite-ignore */ MODULE)) as Analytics;
    expect(typeof g.window).toBe('undefined');
    expect(() => {
      a.captureLandingParams('https://elights.cl/?gclid=x&gtm_debug=1');
      a.sendPageView('/');
      a.sendEvent('add_to_quote', { item_id: 'x' });
      a.trackLead('solicitud_pedido');
      a.applyCookieChoice({ analytics: true, ads: true, meta: true, origin: true }, { otherTab: true });
    }).not.toThrow();
    expect(a.analyticsAvailable()).toBe(false);
    expect(a.testMode()).toBe(false);
    expect(g.dataLayer).toBeUndefined();
    expect(g.fbq).toBeUndefined();
  });

  it('con una decisión «aceptó» sembrada en el almacenamiento: sigue sin hacer nada', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_GTM_ID', 'GTM-TEST123');
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');
    vi.stubEnv('VITE_ANALYTICS_HOSTS', 'localhost');
    vi.stubEnv('VITE_COOKIE_BANNER_HOSTS', 'localhost');
    const accepted = JSON.stringify({ v: 2, at: new Date().toISOString(), analytics: true, ads: true, meta: true, origin: false });
    const getItem = vi.fn(() => accepted);
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem: vi.fn(), clear: vi.fn() });

    const a = (await import(/* @vite-ignore */ MODULE)) as Analytics;
    const cc = (await import(/* @vite-ignore */ CONSENT_MODULE)) as CookieConsent;
    expect(() => {
      a.sendPageView('/');
      a.trackLead('cotizacion');
      a.applyCookieChoice({ analytics: true, ads: true, meta: true, origin: true });
      cc.openCookieSettings();
      cc.subscribe(() => {})();
    }).not.toThrow();
    expect(cc.getCookieChoice()).toBeNull();
    expect(cc.isOriginOptedOut()).toBe(false);
    expect(cc.bannerTestHost()).toBe(false);
    expect(cc.setCookieChoice({ analytics: true, ads: true, meta: true, origin: true })).toEqual({ analytics: true, ads: true, meta: true, origin: true });
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(g.dataLayer).toBeUndefined();
    expect(g.gtag).toBeUndefined();
  });
});
