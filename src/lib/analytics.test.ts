// src/lib/analytics.test.ts
// GA4 en modo básico (Etapa 2 · PR 13): nada de Google antes de decidir ni después de
// Rechazar; gtag.js solo con la medición de visitas aceptada, con consent default en denied,
// update según la decisión, Signals y personalización apagados; sin la medición de anuncios
// los ids de clic no salen en la URL; revocar en la misma página detiene todo y borra las
// cookies de Google; fuera de elights.cl nada.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Analytics = typeof import('./analytics');
type CookieConsent = typeof import('./cookieConsent');
type Choice = import('./cookieConsent').CookieChoice;

const ID = 'G-TEST123';
const KEY = 'elights_cookie_consent';
const DAY = 24 * 60 * 60 * 1000;
const DENIED = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
const CONFIG = {
  send_page_view: false,
  cookie_expires: 34128000,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
};
const VISITS: Choice = { analytics: true, ads: false, origin: true };
const VISITS_AND_ADS: Choice = { analytics: true, ads: true, origin: true };
const REJECT: Choice = { analytics: false, ads: false, origin: true };

/**
 * Módulos nuevos (analytics sin inicializar, decisión sin copia en memoria). En las pruebas
 * el dominio es localhost: se habilita explícitamente, salvo hosts === null (dominios por
 * defecto: elights.cl y www.elights.cl).
 */
async function load(id: string = ID, hosts: string | null = 'localhost'): Promise<{ a: Analytics; cc: CookieConsent }> {
  vi.resetModules();
  vi.stubEnv('VITE_GA4_ID', id);
  if (hosts !== null) vi.stubEnv('VITE_ANALYTICS_HOSTS', hosts);
  const a = await import('./analytics');
  const cc = await import('./cookieConsent');
  return { a, cc };
}

/** Lo que hace el aviso al decidir: guarda y aplica. */
function decide(m: { a: Analytics; cc: CookieConsent }, choice: Choice) {
  m.a.applyCookieChoice(m.cc.setCookieChoice(choice));
}

const isArgs = (e: unknown) => Object.prototype.toString.call(e) === '[object Arguments]';
const entries = () => (window.dataLayer ?? []).map(e => Array.from(e as ArrayLike<unknown>));
const events = () => entries().filter(e => e[0] === 'event').map(e => e[1]);
const pageViews = () => entries().filter(e => e[0] === 'event' && e[1] === 'page_view').map(e => e[2] as Record<string, unknown>);
const gaScripts = () => document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length;
const disabled = () => (window as unknown as Record<string, unknown>)['ga-disable-' + ID];
const cookieNames = () => document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean);

function expectNothingFromGoogle() {
  expect(gaScripts()).toBe(0);
  expect(window.dataLayer).toBeUndefined();
  expect(window.gtag).toBeUndefined();
}

function clickContactLinks() {
  document.body.innerHTML = `
    <a id="wa" href="https://wa.me/56991273128?text=hola"><span id="wa-icon">WA</span></a>
    <a id="mail" href="mailto:ventas@elights.cl">correo</a>
    <a id="tel" href="tel:+56991273128">fono</a>
    <a id="otro" href="/catalogo">catálogo</a>`;
  document.body.addEventListener('click', e => e.preventDefault()); // jsdom no navega
  for (const id of ['wa-icon', 'mail', 'tel', 'otro']) document.getElementById(id)!.click();
}

function clearCookies() {
  for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; path=/`;
}

describe('analytics (GA4, modo básico)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.dataLayer;
    delete window.gtag;
    delete (window as unknown as Record<string, unknown>)['ga-disable-' + ID];
    if (window.__elightsContactClick) {
      document.removeEventListener('click', window.__elightsContactClick, true);
      delete window.__elightsContactClick;
    }
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    clearCookies();
    window.history.replaceState({}, '', '/');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearCookies();
  });

  it('importar no hace nada (se puede usar al generar páginas estáticas)', async () => {
    await load();
    expectNothingFromGoogle();
  });

  it('(a) sin decisión: ni page_view, ni eventos, ni leads, ni clics cargan algo de Google', async () => {
    const { a } = await load();
    a.sendPageView('/');
    a.sendEvent('add_to_quote', { item_id: 'x' });
    a.trackLead('cotizacion');
    clickContactLinks();
    expectNothingFromGoogle();
  });

  it('(b) con Rechazar guardado: lo mismo', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, ads: false, origin: true }));
    const { a } = await load();
    a.sendPageView('/');
    a.trackLead('solicitud_pedido');
    clickContactLinks();
    expectNothingFromGoogle();
  });

  it('(c) con una decisión vencida (400 días), aunque aceptara: lo mismo', async () => {
    const at = new Date(Date.now() - 400 * DAY).toISOString();
    localStorage.setItem(KEY, JSON.stringify({ v: 1, at, analytics: true, ads: true, origin: true }));
    const { a } = await load();
    a.sendPageView('/');
    a.trackLead('instalacion');
    expectNothingFromGoogle();
  });

  it('(d) aceptar visitas: default en denied → redacción → update → ga-disable false → js → config → page_view de la página actual', async () => {
    window.history.replaceState({}, '', '/catalogo?utm_source=google');
    const m = await load();
    decide(m, VISITS);
    expect(window.dataLayer!.every(isArgs)).toBe(true);
    expect(entries().map(e => e[0])).toEqual(['consent', 'set', 'consent', 'js', 'config', 'set', 'event']);
    const [def, redaction, update, js, config, setLocation, pv] = entries();
    expect(def).toEqual(['consent', 'default', DENIED]);
    expect(redaction).toEqual(['set', 'ads_data_redaction', true]);
    expect(update).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(js[1]).toBeInstanceOf(Date);
    expect(config).toEqual(['config', ID, CONFIG]); // sin page_location
    const location = window.location.origin + '/catalogo?utm_source=google';
    expect(setLocation).toEqual(['set', { page_location: location }]);
    expect(pv).toEqual(['event', 'page_view', { page_location: location, page_path: '/catalogo?utm_source=google', send_to: ID }]);
    expect(disabled()).toBe(false);
    expect(gaScripts()).toBe(1);
    // Otra navegación: un page_view más, sin cargar el script de nuevo
    m.a.sendPageView('/');
    expect(gaScripts()).toBe(1);
    expect(pageViews()).toHaveLength(2);
  });

  it('(e) aceptar visitas y anuncios: ad_storage y ad_user_data granted, ad_personalization siempre denied', async () => {
    const m = await load();
    decide(m, VISITS_AND_ADS);
    const update = entries().find(e => e[0] === 'consent' && e[1] === 'update');
    expect(update).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied' }]);
    expect(entries()[0]).toEqual(['consent', 'default', DENIED]);
  });

  it('un visitante que vuelve con la decisión guardada: el page_view de RouteTracker carga gtag con default y update antes de config', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: true, ads: false, origin: true }));
    const { a } = await load();
    a.sendPageView('/');
    expect(entries().map(e => e.slice(0, 2))).toEqual([
      ['consent', 'default'],
      ['set', 'ads_data_redaction'],
      ['consent', 'update'],
      ['js', entries()[3][1]],
      ['config', ID],
      ['set', { page_location: window.location.origin + '/' }],
      ['event', 'page_view'],
    ]);
  });

  it('(f) sin la medición de anuncios, ni page_path ni page_location llevan gclid, gbraid, wbraid ni fbclid', async () => {
    const path = '/producto/x?gclid=Cj0KC&utm_source=google&gbraid=g1&wbraid=w1&fbclid=f1&page=2';
    window.history.replaceState({}, '', path);
    const m = await load();
    decide(m, VISITS);
    m.a.sendEvent('view_item', { item_id: 'x' });
    const clean = '/producto/x?utm_source=google&page=2';
    expect(pageViews()[0]).toEqual({ page_location: window.location.origin + clean, page_path: clean, send_to: ID });
    expect(entries().at(-1)).toEqual(['event', 'view_item', { item_id: 'x', page_location: window.location.origin + clean }]);
    expect(JSON.stringify(entries())).not.toMatch(/gclid|gbraid|wbraid|fbclid|Cj0KC/);

    // Solo ids de clic: la ruta queda sin '?'
    m.a.sendPageView('/catalogo?gclid=Cj0KC');
    expect(pageViews().at(-1)!.page_path).toBe('/catalogo');
  });

  it('(f) con la medición de anuncios, la URL va completa', async () => {
    window.history.replaceState({}, '', '/?gclid=Cj0KC');
    const m = await load();
    decide(m, VISITS_AND_ADS);
    expect(pageViews()[0]).toEqual({ page_location: window.location.origin + '/?gclid=Cj0KC', page_path: '/?gclid=Cj0KC', send_to: ID });
  });

  it('(g) revocar en la misma página: un consent update en denied, ga-disable, nada más se envía y se borran _ga y _gcl', async () => {
    const m = await load();
    decide(m, VISITS_AND_ADS);
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_ga_ABC123=GS1.1.789; path=/';
    document.cookie = '_gcl_au=1.1.123; path=/';
    document.cookie = '_gcl_aw=GCL.123; path=/';
    document.cookie = 'otra=1; path=/';
    const before = entries().length;

    m.a.applyCookieChoice(REJECT); // lo guardado aún dice «aceptó»: ga-disable igual lo detiene
    expect(entries().slice(before)).toEqual([['consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]]);
    expect(disabled()).toBe(true);
    expect(cookieNames()).toEqual(['otra']);

    m.a.trackLead('cotizacion');
    m.a.sendEvent('add_to_quote');
    m.a.sendPageView('/catalogo');
    clickContactLinks();
    expect(entries().length).toBe(before + 1);
  });

  it('(h) revocar y volver a aceptar en la misma página: ga-disable false y un page_view', async () => {
    window.history.replaceState({}, '', '/cotizador');
    const m = await load();
    decide(m, VISITS);
    decide(m, REJECT);
    expect(disabled()).toBe(true);
    m.a.sendPageView('/cotizador'); // revocado: no cuenta
    expect(pageViews()).toHaveLength(1);

    decide(m, VISITS);
    expect(disabled()).toBe(false);
    expect(pageViews()).toHaveLength(2);
    expect(pageViews()[1].page_path).toBe('/cotizador');
    expect(entries().filter(e => e[0] === 'consent' && e[1] === 'update').map(e => (e[2] as Record<string, string>).analytics_storage)).toEqual(['granted', 'denied', 'granted']);
    expect(gaScripts()).toBe(1);
  });

  it('quitar solo la medición de anuncios borra las _gcl y deja _ga', async () => {
    const m = await load();
    decide(m, VISITS_AND_ADS);
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_gcl_au=1.1.123; path=/';
    const views = pageViews().length;
    decide(m, VISITS);
    expect(cookieNames()).toEqual(['_ga']);
    expect(entries().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(pageViews()).toHaveLength(views); // no venía de revocar: sin page_view nuevo
    expect(disabled()).toBe(false);
  });

  it('Rechazar sin gtag cargado (decisión vencida) borra las cookies de Google que quedaron', async () => {
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_gcl_au=1.1.123; path=/';
    const m = await load();
    decide(m, REJECT);
    expectNothingFromGoogle();
    expect(cookieNames()).toEqual([]);
  });

  it('solo visitas con gtag sin cargar (decisión vencida o cambio desde otra pestaña): borra las _gcl y deja _ga', async () => {
    // Aceptó todo hace más de 12 meses: la decisión venció y RouteTracker ya no carga gtag
    const at = new Date(Date.now() - 400 * DAY).toISOString();
    localStorage.setItem(KEY, JSON.stringify({ v: 1, at, analytics: true, ads: true, origin: true }));
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_gcl_au=1.1.123; path=/';
    document.cookie = '_gcl_aw=GCL.123; path=/';
    const m = await load();
    m.a.sendPageView('/');
    expectNothingFromGoogle();
    decide(m, VISITS);
    expect(cookieNames()).toEqual(['_ga']);
    expect(entries().find(e => e[0] === 'consent' && e[1] === 'update')?.[2]).toMatchObject({ ad_storage: 'denied', ad_user_data: 'denied' });
    expect(pageViews()).toHaveLength(1);
  });

  it('solo visitas con gtag sin cargar y sin decisión anterior (p. ej. una _gcl que dejó la tienda): también la borra', async () => {
    document.cookie = '_gcl_au=1.1.123; path=/';
    const m = await load();
    decide(m, VISITS);
    expect(cookieNames()).toEqual([]);
    expect(pageViews()).toHaveLength(1);
  });

  it('visitas y anuncios con gtag sin cargar: no borra las _gcl', async () => {
    document.cookie = '_gcl_au=1.1.123; path=/';
    const m = await load();
    decide(m, VISITS_AND_ADS);
    expect(cookieNames()).toEqual(['_gcl_au']);
  });

  it('(i) lo ocurrido antes de decidir nunca se envía después', async () => {
    window.history.replaceState({}, '', '/catalogo');
    const m = await load();
    m.a.sendPageView('/');
    m.a.sendEvent('add_to_quote');
    m.a.trackLead('cotizacion');
    expectNothingFromGoogle();
    decide(m, VISITS_AND_ADS);
    expect(events()).toEqual(['page_view']);
    expect(pageViews()[0].page_path).toBe('/catalogo');
    // Tampoco con los eventos siguientes (sin cola que se vacíe más tarde)
    m.a.sendEvent('despues');
    m.a.trackLead('cotizador');
    expect(events()).toEqual(['page_view', 'despues', 'generate_lead']);
    expect(entries().find(e => e[0] === 'event' && e[1] === 'generate_lead')?.[2]).toMatchObject({ form_type: 'cotizador' });
  });

  it('un lead enviado es un solo generate_lead con el tipo de formulario', async () => {
    const m = await load();
    decide(m, VISITS);
    m.a.trackLead('cotizacion', { lead_type: 'B2B' });
    expect(entries().at(-1)).toEqual([
      'event',
      'generate_lead',
      { form_type: 'cotizacion', currency: 'CLP', lead_type: 'B2B', page_location: window.location.origin + '/' },
    ]);
    expect(events().filter(n => n === 'generate_lead')).toHaveLength(1);
  });

  it('con consentimiento mide los clics a WhatsApp, correo y teléfono, una vez por clic', async () => {
    const m = await load();
    decide(m, VISITS);
    clickContactLinks();
    expect(events().filter(n => n !== 'page_view')).toEqual(['whatsapp_click', 'contact_email_click', 'contact_phone_click']);
  });

  it('(j) fuera de elights.cl (nuevo.elights.cl, previews) no envía nada aunque haya consentimiento', async () => {
    const m = await load(ID, null); // dominios por defecto: elights.cl y www.elights.cl
    expect(window.location.hostname).toBe('localhost');
    expect(m.a.analyticsAvailable()).toBe(false);
    decide(m, VISITS_AND_ADS);
    m.a.sendPageView('/');
    m.a.trackLead('solicitud_pedido');
    clickContactLinks();
    expectNothingFromGoogle();
  });

  it('sin ID configurado no carga nada ni falla, aunque haya consentimiento', async () => {
    const m = await load('PENDING_GA4_MEASUREMENT_ID');
    decide(m, VISITS_AND_ADS);
    m.a.sendEvent('x');
    m.a.trackLead('instalacion');
    expectNothingFromGoogle();
  });

  it('el ID y los dominios se leen al llamar, no al importar', async () => {
    const m = await load(ID, null);
    expect(m.a.analyticsAvailable()).toBe(false);
    vi.stubEnv('VITE_ANALYTICS_HOSTS', 'localhost');
    expect(m.a.analyticsAvailable()).toBe(true);
    expect(m.a.gaId()).toBe(ID);
    vi.stubEnv('VITE_GA4_ID', '__VITE_GA4_ID__');
    expect(m.a.gaId()).toBeUndefined();
    expect(m.a.analyticsAvailable()).toBe(false);
  });

  it('si otro script borra window.gtag, nada lanza (RouteTracker y los formularios siguen) y no se envía nada', async () => {
    const m = await load();
    decide(m, VISITS_AND_ADS);
    delete window.gtag;
    expect(() => {
      m.a.sendPageView('/catalogo');
      m.a.trackLead('cotizacion');
      decide(m, REJECT);
      decide(m, VISITS);
    }).not.toThrow();
    expect(pageViews()).toHaveLength(1);
  });

  it('el aviso puesto en un host de prueba (VITE_COOKIE_BANNER_HOSTS) no habilita GA', async () => {
    vi.stubEnv('VITE_COOKIE_BANNER_HOSTS', 'localhost');
    const m = await load(ID, null);
    decide(m, VISITS_AND_ADS);
    m.a.sendPageView('/');
    expectNothingFromGoogle();
  });
});
