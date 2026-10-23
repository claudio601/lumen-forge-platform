// src/lib/analytics.test.ts
// Cargador de GTM (Etapa 2 · PR 14; especificación 3.2 a 3.6, 7.1 y 10): nada de Google ni de
// Meta antes de decidir ni después de Rechazar; gtm.js (nunca gtag/js) solo con la medición de
// visitas aceptada, con consent default en denied, update según la decisión y las claves de
// estado antes de cargarlo; los ids de clic de la llegada vuelven a la URL cada uno con su
// consentimiento; los eventos llevan exactamente los parámetros de la tabla 3.5 y nunca las
// claves de estado; retirar un permiso recarga la página (salvo desde otra pestaña); Meta solo
// se revoca, nunca se carga desde el sitio; los ids sin consentimiento salen de la URL del
// navegador; link_url nunca lleva el asunto de un correo (salvo «Datos personales») ni la
// referencia de una solicitud; al retirar se borra también el almacenamiento local de Google y
// de Meta; el modo de prueba exige host de prueba y gtm_debug; fuera de elights.cl, nada.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Analytics = typeof import('./analytics');
type CookieConsent = typeof import('./cookieConsent');
type Choice = import('./cookieConsent').CookieChoice;
type Loaded = { a: Analytics; cc: CookieConsent };

const GTM = 'GTM-TEST123';
const GA = 'G-TEST123';
const KEY = 'elights_cookie_consent';
const DAY = 24 * 60 * 60 * 1000;
const DENIED = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
const VISITS: Choice = { analytics: true, ads: false, meta: false, origin: true };
const VISITS_ADS: Choice = { analytics: true, ads: true, meta: false, origin: true };
const VISITS_META: Choice = { analytics: true, ads: false, meta: true, origin: true };
const ALL: Choice = { analytics: true, ads: true, meta: true, origin: true };
const REJECT: Choice = { analytics: false, ads: false, meta: false, origin: true };

/** Tabla 3.5 de la especificación, sin las claves de estado. */
const TABLE_3_5 = [
  'page_location', 'page_path', 'form_type', 'currency', 'item_count', 'lead_type', 'project_type',
  'tipo_proyecto', 'tiene_planos', 'objetivo_proyecto', 'normativa_objetivo', 'urgencia_proyecto',
  'link_url', 'link_type', 'item_id', 'quantity', 'unit_price', 'subtotal', 'customer_type',
  'reason', 'http_status', 'error_message',
];
const STATE = ['site_platform', 'elights_env', 'meta_consent'];
/** Regex del activador T09 del contenedor (especificación 6.3). */
const T09 =
  /^(generate_lead|whatsapp_click|contact_email_click|contact_phone_click|add_to_quote|request_cart_add|request_cart_view|request_cart_remove|request_form_start|request_form_submit_error|cotizacion_form_submit_error|cotizador_submit_error|estudio_luminico_form_submit|estudio_luminico_form_submit_error|instalacion_form_view|instalacion_form_submit_attempt|instalacion_form_submit_failure|estudio_luminico_cta_hero_click|instalacion_cta_hero_click|instalacion_cta_final_click)$/;

interface Env {
  gtm?: string | null;
  ga?: string | null;
  /** null: dominios por defecto (elights.cl y www.elights.cl; jsdom es localhost). */
  hosts?: string | null;
  testHosts?: string;
}

/**
 * Módulos nuevos (analytics sin cargar, decisión sin copia en memoria). En las pruebas el
 * dominio es localhost: se habilita explícitamente, salvo hosts === null.
 */
async function load({ gtm = GTM, ga = GA, hosts = 'localhost', testHosts }: Env = {}): Promise<Loaded & { reload: ReturnType<typeof vi.fn> }> {
  vi.resetModules();
  if (gtm !== null) vi.stubEnv('VITE_GTM_ID', gtm);
  if (ga !== null) vi.stubEnv('VITE_GA4_ID', ga);
  if (hosts !== null) vi.stubEnv('VITE_ANALYTICS_HOSTS', hosts);
  if (testHosts) vi.stubEnv('VITE_GTM_TEST_HOSTS', testHosts);
  const a = await import('./analytics');
  const cc = await import('./cookieConsent');
  const reload = vi.fn();
  vi.spyOn(a.page, 'reload').mockImplementation(reload);
  return { a, cc, reload };
}

/** Lo que hace el aviso al decidir en esta pestaña: guarda y aplica. */
function decide(m: Loaded, choice: Choice) {
  m.a.applyCookieChoice(m.cc.setCookieChoice(choice));
}

/** Una decisión tomada en otra pestaña: llega por el evento storage. */
function decideInOtherTab(m: Loaded, choice: Choice) {
  localStorage.setItem(KEY, JSON.stringify({ v: 2, at: new Date().toISOString(), ...choice }));
  m.a.applyCookieChoice(m.cc.getCookieChoice(), { otherTab: true });
}

const isArgs = (e: unknown) => Object.prototype.toString.call(e) === '[object Arguments]';
const layer = () => window.dataLayer ?? [];
/** Comandos de gtag (objetos arguments) como listas. */
const commands = () => layer().filter(isArgs).map(e => Array.from(e as ArrayLike<unknown>));
/** Lo empujado como objeto (eventos y claves de estado). */
const objects = () => layer().filter(e => !isArgs(e)) as Record<string, unknown>[];
const events = () => objects().filter(o => typeof o.event === 'string' && o.event !== 'gtm.js');
const eventNames = () => events().map(e => e.event);
const eventsNamed = (name: string) => events().filter(e => e.event === name);
const pageViews = () => eventsNamed('elights_page_view');
const gtmScripts = () => document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtm.js?id="]');
const allScripts = () => [...document.querySelectorAll('script')].map(s => s.getAttribute('src') ?? s.textContent ?? '');
const disabled = () => (window as unknown as Record<string, unknown>)['ga-disable-' + GA];
const cookieNames = () => document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean);

/** Cada paso del dataLayer, en orden: comandos de gtag como 'consent default' y objetos por su clave. */
function steps(): string[] {
  return layer().map(e => {
    if (isArgs(e)) {
      const [cmd, arg] = Array.from(e as ArrayLike<unknown>);
      return typeof arg === 'string' ? `${cmd} ${arg}` : String(cmd);
    }
    const o = e as Record<string, unknown>;
    if (o.event === 'gtm.js') return 'gtm.js';
    if (typeof o.event === 'string') return o.event;
    return 'estado';
  });
}

function expectNothingLoaded() {
  expect(gtmScripts()).toHaveLength(0);
  expect(window.dataLayer).toBeUndefined();
  expect(window.gtag).toBeUndefined();
  expect(allScripts().join(' ')).not.toMatch(/googletagmanager|gtag\/js|fbevents|connect\.facebook\.net/);
}

function clickContactLinks() {
  document.body.innerHTML = `
    <a id="wa" href="https://wa.me/56991273128?text=hola"><span id="wa-icon">WA</span></a>
    <a id="mail" href="mailto:ventas@elights.cl">correo</a>
    <a id="datos" href="mailto:ventas@elights.cl?subject=Datos%20personales">datos</a>
    <a id="tel" href="tel:+56991273128">fono</a>
    <a id="otro" href="/catalogo">catálogo</a>`;
  document.body.addEventListener('click', e => e.preventDefault()); // jsdom no navega
  for (const id of ['wa-icon', 'mail', 'datos', 'tel', 'otro']) document.getElementById(id)!.click();
}

function clearCookies() {
  for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; path=/`;
}

function setCookies(...names: string[]) {
  for (const name of names) document.cookie = `${name}=1; path=/`;
}

/** Llega desde un anuncio a `landing`, la captura main.tsx y navega (sin recargar) a `here`. */
function arrive(m: Loaded, landing: string, here: string = landing) {
  window.history.replaceState({ idx: 0, key: 'llegada' }, '', landing);
  m.a.captureLandingParams();
  window.history.replaceState({ idx: 1, key: 'ficha' }, '', here);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  delete window.dataLayer;
  delete window.gtag;
  delete window.fbq;
  delete (window as unknown as Record<string, unknown>)['ga-disable-' + GA];
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

describe('sin decisión o sin consentimiento: nada de Google ni de Meta', () => {
  it('importar no hace nada (se puede usar al generar páginas estáticas)', async () => {
    await load();
    expectNothingLoaded();
  });

  it('sin decisión: ni vistas, ni eventos, ni leads, ni clics cargan algo', async () => {
    const { a } = await load();
    a.sendPageView('/');
    a.sendEvent('add_to_quote', { item_id: 'x' });
    a.trackLead('cotizacion');
    clickContactLinks();
    expectNothingLoaded();
  });

  it('con Rechazar guardado: lo mismo', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, at: new Date().toISOString(), ...REJECT }));
    const { a } = await load();
    a.sendPageView('/');
    a.trackLead('solicitud_pedido');
    clickContactLinks();
    expectNothingLoaded();
  });

  it.each([
    ['vencida (400 días)', { v: 2, at: new Date(Date.now() - 400 * DAY).toISOString(), ...ALL }],
    ['de la versión 1 (antes de «Publicidad en Meta»)', { v: 1, at: new Date().toISOString(), analytics: true, ads: true, origin: true }],
  ])('con una decisión %s, aunque aceptara: lo mismo', async (_, record) => {
    localStorage.setItem(KEY, JSON.stringify(record));
    const { a } = await load();
    a.sendPageView('/');
    a.trackLead('instalacion');
    expectNothingLoaded();
  });

  it('lo ocurrido antes de decidir nunca se envía después (sin cola)', async () => {
    window.history.replaceState({}, '', '/catalogo');
    const m = await load();
    m.a.sendPageView('/');
    m.a.sendEvent('add_to_quote');
    m.a.trackLead('cotizacion');
    expectNothingLoaded();
    decide(m, ALL);
    expect(eventNames()).toEqual(['elights_page_view']);
    expect(pageViews()[0].page_path).toBe('/catalogo');
    m.a.sendEvent('request_cart_view', { item_count: 1, subtotal: 1000 });
    m.a.trackLead('cotizador');
    expect(eventNames()).toEqual(['elights_page_view', 'request_cart_view', 'generate_lead']);
  });
});

describe('carga de GTM (sección 3.2)', () => {
  it('aceptar visitas: default en denied → redacción → update → claves de estado → gtm.js → vista, con un solo gtm.js', async () => {
    window.history.replaceState({}, '', '/catalogo?utm_source=google');
    const m = await load();
    decide(m, VISITS);
    expect(steps()).toEqual(['consent default', 'set ads_data_redaction', 'consent update', 'estado', 'gtm.js', 'set', 'elights_page_view']);
    const [def, redaction, update] = commands();
    expect(def).toEqual(['consent', 'default', DENIED]);
    expect(redaction).toEqual(['set', 'ads_data_redaction', true]);
    expect(update).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(objects()[0]).toEqual({ site_platform: 'elights-web', elights_env: 'prod', meta_consent: 'denied' });
    expect(objects()[1]).toEqual({ 'gtm.start': expect.any(Number), event: 'gtm.js' });
    const location = window.location.origin + '/catalogo?utm_source=google';
    expect(commands()[3]).toEqual(['set', { page_location: location }]);
    expect(pageViews()[0]).toMatchObject({ page_location: location, page_path: '/catalogo?utm_source=google' });
    expect(disabled()).toBe(false);
    expect(gtmScripts()).toHaveLength(1);
    expect(gtmScripts()[0].getAttribute('src')).toBe('https://www.googletagmanager.com/gtm.js?id=' + GTM);
    expect((gtmScripts()[0] as HTMLScriptElement).async).toBe(true);
    // Otra navegación: una vista más, sin cargar el script de nuevo
    window.history.replaceState({}, '', '/');
    m.a.sendPageView('/');
    expect(gtmScripts()).toHaveLength(1);
    expect(pageViews()).toHaveLength(2);
  });

  it('nunca inserta gtag/js, ni <noscript>, ni el script del píxel de Meta (aunque acepte todo)', async () => {
    const m = await load();
    decide(m, ALL);
    m.a.sendPageView('/catalogo');
    m.a.trackLead('cotizacion');
    clickContactLinks();
    expect(document.querySelectorAll('script[src*="gtag/js"]')).toHaveLength(0);
    expect(document.querySelectorAll('noscript')).toHaveLength(0);
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(allScripts().join(' ')).not.toMatch(/fbevents|connect\.facebook\.net|facebook\.com\/tr/);
    expect(commands().filter(c => c[0] === 'config' || c[0] === 'js' || c[0] === 'event')).toEqual([]);
  });

  it('aceptar todo: ad_storage y ad_user_data granted, ad_personalization siempre denied, meta_consent granted', async () => {
    const m = await load();
    decide(m, ALL);
    expect(commands()[2]).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied' }]);
    expect(objects()[0]).toEqual({ site_platform: 'elights-web', elights_env: 'prod', meta_consent: 'granted' });
  });

  it('Meta o anuncios sin la medición de visitas no cargan nada (requieren la de visitas)', async () => {
    const m = await load();
    decide(m, { analytics: false, ads: true, meta: true, origin: true });
    expect(m.cc.getCookieChoice()).toEqual(REJECT);
    expectNothingLoaded();
    m.a.applyCookieChoice({ analytics: false, ads: true, meta: true, origin: true });
    expectNothingLoaded();
  });

  it('un visitante que vuelve con la decisión guardada: la vista de RouteTracker carga GTM en el mismo orden', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, at: new Date().toISOString(), ...VISITS_META }));
    const { a } = await load();
    a.sendPageView('/');
    expect(steps()).toEqual(['consent default', 'set ads_data_redaction', 'consent update', 'estado', 'gtm.js', 'set', 'elights_page_view']);
    expect(objects()[0]).toMatchObject({ meta_consent: 'granted' });
  });

  it('sin la medición de anuncios, ni page_path ni page_location llevan gclid, gbraid, wbraid ni fbclid', async () => {
    const path = '/producto/x?gclid=Cj0KC&utm_source=google&gbraid=g1&wbraid=w1&fbclid=f1&page=2';
    window.history.replaceState({}, '', path);
    const m = await load();
    decide(m, VISITS);
    m.a.sendEvent('add_to_quote', { item_id: 'x' });
    clickContactLinks();
    const clean = '/producto/x?utm_source=google&page=2';
    expect(pageViews()[0]).toMatchObject({ page_location: window.location.origin + clean, page_path: clean });
    for (const e of events()) expect(e.page_location).toBe(window.location.origin + clean);
    expect(JSON.stringify(objects())).not.toMatch(/gclid|gbraid|wbraid|fbclid|Cj0KC/);
    expect(JSON.stringify(commands())).not.toMatch(/gclid|gbraid|wbraid|fbclid|Cj0KC/);
    // Solo ids de clic: la ruta queda sin '?'
    m.a.sendPageView('/catalogo?gclid=Cj0KC');
    expect(pageViews().at(-1)!.page_path).toBe('/catalogo');
  });

  it('con la medición de anuncios, la URL va completa', async () => {
    window.history.replaceState({}, '', '/?gclid=Cj0KC');
    const m = await load();
    decide(m, VISITS_ADS);
    expect(pageViews()[0]).toMatchObject({ page_location: window.location.origin + '/?gclid=Cj0KC', page_path: '/?gclid=Cj0KC' });
  });

  it('borra las cookies de lo no permitido antes de cargar (por ejemplo las que dejó la tienda)', async () => {
    setCookies('_ga', '_gcl_au', '_fbp', 'otra');
    const m = await load();
    decide(m, VISITS);
    expect(cookieNames().sort()).toEqual(['_ga', 'otra']);
  });

  it('con todo aceptado no borra nada', async () => {
    setCookies('_ga', '_gcl_au', '_fbp');
    const m = await load();
    decide(m, ALL);
    expect(cookieNames().sort()).toEqual(['_fbp', '_ga', '_gcl_au']);
  });

  it('Rechazar sin GTM cargado borra las cookies de Google y de Meta que quedaron', async () => {
    setCookies('_ga', '_ga_ABC123', '_gcl_au', '_fbp', '_fbc', 'otra');
    const m = await load();
    decide(m, REJECT);
    expectNothingLoaded();
    expect(cookieNames()).toEqual(['otra']);
    expect(m.reload).not.toHaveBeenCalled();
  });
});

describe('eventos y parámetros (tablas 3.4 y 3.5)', () => {
  it('EVENT_PARAMS es la tabla 3.5, las claves de estado son las 3 y SITE_EVENTS cumple la regex de T09', async () => {
    const { a } = await load();
    expect([...a.EVENT_PARAMS]).toEqual(TABLE_3_5);
    expect([...a.STATE_KEYS]).toEqual(STATE);
    for (const name of a.SITE_EVENTS) expect(name).toMatch(T09);
    expect(a.SITE_EVENTS).toHaveLength(T09.source.split('|').length);
  });

  it('cada evento trae exactamente las claves de la tabla 3.5 (undefined las que no aplican) y nunca las de estado', async () => {
    const m = await load();
    decide(m, ALL);
    m.a.sendEvent('request_cart_add', { item_id: 'APB1507', quantity: 2, unit_price: 19990 });
    m.a.sendEvent('request_cart_remove', { item_id: 'APB1507' });
    m.a.sendEvent('request_form_start', { customer_type: 'empresa' });
    m.a.sendEvent('request_form_submit_error', { reason: 'api_error', http_status: 500 });
    m.a.trackLead('cotizacion', { lead_type: 'B2B', item_count: 3 });
    clickContactLinks();
    m.a.applyCookieChoice(m.cc.setCookieChoice(ALL)); // la misma decisión: elights_consent_update
    m.a.sendPageView('/');
    const expected = ['event', ...TABLE_3_5].sort();
    const others = events().filter(e => e.event !== 'elights_consent_update');
    expect(others.length).toBeGreaterThan(8);
    for (const e of others) {
      expect(Object.keys(e).sort(), String(e.event)).toEqual(expected);
      for (const key of STATE) expect(key in e, `${String(e.event)}: ${key}`).toBe(false);
    }
    expect(eventsNamed('request_cart_add')[0]).toMatchObject({ item_id: 'APB1507', quantity: 2, unit_price: 19990, form_type: undefined, link_url: undefined });
    // elights_consent_update: los mismos parámetros, la decisión y las claves de estado
    const [update] = eventsNamed('elights_consent_update');
    expect(Object.keys(update).sort()).toEqual([...expected, 'analytics_consent', 'ads_consent', ...STATE].sort());
    expect(update).toMatchObject({ analytics_consent: 'granted', ads_consent: 'granted', meta_consent: 'granted', site_platform: 'elights-web', elights_env: 'prod' });
  });

  it('un parámetro que no es de la tabla (o una clave de estado) nunca llega a la capa de datos', async () => {
    const m = await load();
    decide(m, VISITS);
    const params = { item_id: 'x', sku: 'x', meta_consent: 'denied', elights_env: 'test' } as unknown as import('./analytics').EventParams;
    m.a.sendEvent('add_to_quote', params);
    const [added] = eventsNamed('add_to_quote');
    expect(added.item_id).toBe('x');
    for (const key of ['sku', ...STATE]) expect(key in added).toBe(false);
  });

  it('generate_lead: uno por envío, con el tipo de formulario y CLP, sin valor ni referencia', async () => {
    const m = await load();
    decide(m, VISITS);
    m.a.trackLead('cotizacion', { lead_type: 'B2B' });
    const leads = eventsNamed('generate_lead');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ form_type: 'cotizacion', currency: 'CLP', lead_type: 'B2B', page_location: window.location.origin + '/' });
    expect(JSON.stringify(objects())).not.toMatch(/value|NE-|RC-|PY-/);
  });

  it('clics a WhatsApp, correo y teléfono: un evento por clic, con link_url, link_type y page_path', async () => {
    window.history.replaceState({}, '', '/catalogo?gclid=Cj0KC&page=2');
    const m = await load();
    decide(m, VISITS);
    clickContactLinks();
    const clicks = events().filter(e => e.event !== 'elights_page_view');
    expect(clicks.map(e => [e.event, e.link_url, e.link_type, e.page_path])).toEqual([
      ['whatsapp_click', 'https://wa.me/56991273128?text=hola', 'whatsapp', '/catalogo?page=2'],
      ['contact_email_click', 'mailto:ventas@elights.cl', 'email', '/catalogo?page=2'],
      ['contact_email_click', 'mailto:ventas@elights.cl?subject=Datos%20personales', 'email', '/catalogo?page=2'],
      ['contact_phone_click', 'tel:+56991273128', 'phone', '/catalogo?page=2'],
    ]);
  });

  it('link_url de un mailto: solo la dirección, y el asunto solo si es «Datos personales» (nunca la referencia)', async () => {
    const m = await load();
    decide(m, ALL);
    document.body.innerHTML = `
      <a id="ref" href="mailto:ventas@elights.cl?subject=Solicitud%20RC-abc12">ventas</a>
      <a id="ne" href="mailto:ventas@elights.cl?subject=Solicitud%20NE-x9y8z&body=Hola">ventas</a>
      <a id="py" href="mailto:ventas@elights.cl?body=PY-q1w2e3">ventas</a>
      <a id="cat" href="mailto:ventas@elights.cl?subject=Cotizaci%C3%B3n%20de%20campanas%20LED">ventas</a>
      <a id="otro" href="mailto:contacto@elights.cl?subject=Instalaci%C3%B3n">contacto</a>
      <a id="datos" href="mailto:ventas@elights.cl?subject=Datos%20personales&body=Quiero%20ejercer">datos</a>`;
    document.body.addEventListener('click', e => e.preventDefault());
    for (const id of ['ref', 'ne', 'py', 'cat', 'otro', 'datos']) document.getElementById(id)!.click();
    expect(eventsNamed('contact_email_click').map(e => e.link_url)).toEqual([
      'mailto:ventas@elights.cl',
      'mailto:ventas@elights.cl',
      'mailto:ventas@elights.cl',
      'mailto:ventas@elights.cl',
      'mailto:contacto@elights.cl',
      'mailto:ventas@elights.cl?subject=Datos%20personales',
    ]);
    // Ninguna entrada de la capa de datos trae una referencia de solicitud
    expect(JSON.stringify(layer().map(e => (isArgs(e) ? Array.from(e as ArrayLike<unknown>) : e)))).not.toMatch(/\b(RC|NE|PY)-[a-z0-9]/i);
    expect(m.a.contactLinkUrl('https://wa.me/56991273128?text=hola')).toBe('https://wa.me/56991273128?text=hola');
    expect(m.a.contactLinkUrl('tel:+56991273128')).toBe('tel:+56991273128');
  });

  it('un solo detector de clics aunque el módulo se cargue de nuevo', async () => {
    let m = await load();
    decide(m, VISITS);
    m = await load();
    m.a.applyCookieChoice(VISITS);
    delete window.dataLayer;
    document.head.innerHTML = '';
    m = await load();
    m.a.applyCookieChoice(VISITS);
    clickContactLinks();
    expect(eventsNamed('whatsapp_click')).toHaveLength(1);
  });
});

describe('ids de clic al aceptar después de navegar (sección 3.2)', () => {
  /** La URL en el momento en que se empuja gtm.js. */
  function watchGtmStart(): () => string | undefined {
    let seen: string | undefined;
    const dl: unknown[] = [];
    dl.push = (...items: unknown[]) => {
      for (const item of items) if (item && typeof item === 'object' && 'gtm.start' in item) seen = window.location.search;
      return Array.prototype.push.apply(dl, items);
    };
    window.dataLayer = dl;
    return () => seen;
  }

  it('aceptar todo en una ficha: gclid, gbraid y fbclid vuelven a la URL antes de gtm.js, y la primera vista lleva el gclid', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&gbraid=B1&fbclid=F1&utm_source=google', '/producto/x?page=2#ficha');
    const seenAtGtm = watchGtmStart();
    decide(m, ALL);
    expect(seenAtGtm()).toBe('?page=2&gclid=G1&gbraid=B1&fbclid=F1');
    expect(window.location.hash).toBe('#ficha');
    expect(window.history.state).toEqual({ idx: 1, key: 'ficha' }); // el historial de React Router intacto
    expect(pageViews()[0].page_location).toBe(window.location.origin + '/producto/x?page=2&gclid=G1&gbraid=B1&fbclid=F1');
  });

  it('solo la medición de visitas: no vuelve ningún id', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&fbclid=F1', '/producto/x');
    decide(m, VISITS);
    expect(window.location.search).toBe('');
  });

  it('visitas y Meta, sin anuncios: solo el fbclid (y la medición no lo lleva)', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&wbraid=W1&fbclid=F1', '/producto/x');
    decide(m, VISITS_META);
    expect(window.location.search).toBe('?fbclid=F1');
    expect(pageViews()[0].page_location).toBe(window.location.origin + '/producto/x');
  });

  it('visitas y anuncios, sin Meta: solo los de Google', async () => {
    const m = await load();
    arrive(m, '/?wbraid=W1&fbclid=F1', '/producto/x');
    decide(m, VISITS_ADS);
    expect(window.location.search).toBe('?wbraid=W1');
  });

  it('no pisa ids que ya están en la URL', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&gbraid=B1&fbclid=F1', '/producto/x?gclid=OTRO&fbclid=F2');
    decide(m, ALL);
    expect(window.location.search).toBe('?gclid=OTRO&fbclid=F2');
  });

  it('solo los de esta carga: nunca los de la sesión (origen de la visita) ni los de otra pestaña', async () => {
    sessionStorage.setItem('elights_attribution', JSON.stringify({ gclid: 'DE_LA_SESION', landing: '/' }));
    const m = await load();
    arrive(m, '/producto/x', '/producto/y');
    decide(m, ALL);
    expect(window.location.search).toBe('');
  });

  it('un id raro (muy largo) no se guarda; los valores se codifican', async () => {
    const m = await load();
    arrive(m, '/?gclid=' + 'x'.repeat(600) + '&fbclid=a%20b%26c', '/producto/x');
    decide(m, ALL);
    expect(window.location.search).toBe('?fbclid=a%20b%26c');
  });

  it('aceptar anuncios después, sin recargar: el gclid vuelve antes del consent update y del elights_consent_update', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&fbclid=F1', '/producto/x');
    decide(m, VISITS);
    expect(window.location.search).toBe('');
    const before = layer().length;
    let searchAtUpdate = '';
    const push = window.dataLayer!.push.bind(window.dataLayer);
    window.dataLayer!.push = (...items: unknown[]) => {
      if (isArgs(items[0])) searchAtUpdate = window.location.search;
      return push(...items);
    };
    decide(m, VISITS_ADS);
    expect(searchAtUpdate).toBe('?gclid=G1');
    expect(steps().slice(before)).toEqual(['consent update', 'elights_consent_update']);
    expect(eventsNamed('elights_consent_update')[0]).toMatchObject({ ads_consent: 'granted', meta_consent: 'denied', page_location: window.location.origin + '/producto/x?gclid=G1' });
    expect(m.reload).not.toHaveBeenCalled();
  });
});

describe('ids de clic sin consentimiento: fuera de la URL del navegador (el píxel y Google la leen)', () => {
  it('visitas y Meta, sin anuncios: gclid, gbraid y wbraid salen de la URL antes de gtm.js; el fbclid queda', async () => {
    const m = await load();
    arrive(m, '/catalogo?gclid=G1&utm_source=google&gbraid=B1&fbclid=F1&wbraid=W1#lista');
    let seenAtGtm: string | undefined;
    const dl: unknown[] = [];
    dl.push = (...items: unknown[]) => {
      for (const item of items) if (item && typeof item === 'object' && 'gtm.start' in item) seenAtGtm = window.location.search;
      return Array.prototype.push.apply(dl, items);
    };
    window.dataLayer = dl;
    decide(m, VISITS_META);
    expect(seenAtGtm).toBe('?utm_source=google&fbclid=F1');
    expect(window.location.hash).toBe('#lista');
    expect(window.history.state).toEqual({ idx: 1, key: 'ficha' });
    // Aceptar después la medición de anuncios: vuelven desde la memoria de esta carga
    decide(m, ALL);
    expect(window.location.search).toBe('?utm_source=google&fbclid=F1&gclid=G1&gbraid=B1&wbraid=W1');
  });

  it('visitas y anuncios, sin Meta: el fbclid sale de la URL; los de Google quedan', async () => {
    const m = await load();
    arrive(m, '/?fbclid=F1&gclid=G1');
    decide(m, VISITS_ADS);
    expect(window.location.search).toBe('?gclid=G1');
  });

  it('solo la medición de visitas: ningún id queda en la URL, y una ruta nueva con ids tampoco los deja', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&fbclid=F1&page=2');
    decide(m, VISITS);
    expect(window.location.search).toBe('?page=2');
    window.history.pushState({ idx: 2 }, '', '/catalogo?gclid=G2');
    m.a.sendPageView('/catalogo?gclid=G2');
    expect(window.location.search).toBe('');
    window.history.replaceState({ idx: 2 }, '', '/catalogo?fbclid=F2&q=panel');
    m.a.sendEvent('add_to_quote', { item_id: 'x' });
    expect(window.location.search).toBe('?q=panel');
  });

  it('retirar la medición de anuncios con Meta aceptado: el gclid sale de la URL (también desde otra pestaña)', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&fbclid=F1');
    decide(m, ALL);
    expect(window.location.search).toBe('?gclid=G1&fbclid=F1');
    decideInOtherTab(m, VISITS_META);
    expect(window.location.search).toBe('?fbclid=F1');
    expect(m.reload).not.toHaveBeenCalled();
  });

  it('sin decisión o con Rechazar la URL no se toca (no se carga nada que la lea)', async () => {
    const m = await load();
    arrive(m, '/?gclid=G1&fbclid=F1');
    m.a.sendPageView('/?gclid=G1&fbclid=F1');
    expect(window.location.search).toBe('?gclid=G1&fbclid=F1');
    decide(m, REJECT);
    expect(window.location.search).toBe('?gclid=G1&fbclid=F1');
  });
});

describe('Publicidad en Meta', () => {
  it('Meta concedido con GTM ya cargado: fbclid, consent update, elights_consent_update y después elights_meta_granted', async () => {
    const m = await load();
    arrive(m, '/?fbclid=F1', '/producto/x');
    decide(m, VISITS);
    const before = layer().length;
    decide(m, VISITS_META);
    expect(window.location.search).toBe('?fbclid=F1');
    expect(steps().slice(before)).toEqual(['consent update', 'elights_consent_update', 'elights_meta_granted']);
    expect(eventsNamed('elights_consent_update')[0]).toMatchObject({ meta_consent: 'granted', analytics_consent: 'granted', ads_consent: 'denied' });
    expect(Object.keys(eventsNamed('elights_meta_granted')[0]).sort()).toEqual(['event', ...TABLE_3_5].sort());
    expect(m.reload).not.toHaveBeenCalled();
  });

  it('en la primera decisión no hay elights_meta_granted (basta la primera vista)', async () => {
    const m = await load();
    decide(m, ALL);
    expect(eventNames()).toEqual(['elights_page_view']);
    // Volver a guardar lo mismo: elights_consent_update, sin elights_meta_granted
    decide(m, ALL);
    expect(eventNames()).toEqual(['elights_page_view', 'elights_consent_update']);
  });

  it('las claves de estado no se borran: meta_consent sigue concedido en todo lo que sigue', async () => {
    const m = await load();
    decide(m, VISITS_META);
    m.a.sendPageView('/catalogo');
    clickContactLinks();
    m.a.trackLead('instalacion', { tipo_proyecto: 'bodega' });
    // Cómo lo ve GTM: el modelo de datos combina los objetos empujados en orden
    const model: Record<string, unknown> = {};
    for (const o of objects()) Object.assign(model, o);
    expect(model.meta_consent).toBe('granted');
    expect(model.site_platform).toBe('elights-web');
    expect(model.elights_env).toBe('prod');
  });

  it('el sitio nunca inicializa el píxel ni le envía eventos (solo lo puede revocar)', async () => {
    const fbq = vi.fn();
    window.fbq = fbq;
    const m = await load();
    decide(m, ALL);
    m.a.sendPageView('/catalogo');
    m.a.trackLead('cotizacion');
    clickContactLinks();
    decide(m, ALL);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('retirar Meta con el píxel cargado: fbq(consent, revoke), meta_consent denied, borra _fbp y _fbc y recarga', async () => {
    const m = await load();
    decide(m, ALL);
    const fbq = vi.fn();
    window.fbq = fbq; // lo cargó el contenedor
    setCookies('_fbp', '_fbc', '_ga', '_gcl_aw', 'otra');
    const before = layer().length;
    decide(m, VISITS_ADS);
    expect(fbq.mock.calls).toEqual([['consent', 'revoke']]);
    expect(steps().slice(before)).toEqual(['consent update', 'elights_consent_update']);
    expect(eventsNamed('elights_consent_update')[0]).toMatchObject({ meta_consent: 'denied', ads_consent: 'granted', analytics_consent: 'granted' });
    expect(cookieNames().sort()).toEqual(['_ga', '_gcl_aw', 'otra']);
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it('retirar Meta y anuncios: borra también lo que Google y Meta guardaron en el almacenamiento local', async () => {
    const m = await load();
    decide(m, ALL);
    for (const key of ['_gcl_ls', 'multiFbc', 'fbcEbpOrigin', 'lastExternalReferrer', 'lastExternalReferrerTime', 'otra']) localStorage.setItem(key, '1');
    setCookies('_fbleid', '_fbp');
    decide(m, VISITS);
    expect(Object.keys(localStorage).sort()).toEqual([KEY, 'otra'].sort());
    expect(cookieNames()).toEqual([]);
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it('retirar solo Meta deja _gcl_ls; retirar solo anuncios deja las claves de Meta', async () => {
    let m = await load();
    decide(m, ALL);
    localStorage.setItem('_gcl_ls', '{"schema":"gcl"}');
    localStorage.setItem('lastExternalReferrer', 'facebook.com');
    decide(m, VISITS_ADS);
    expect(localStorage.getItem('_gcl_ls')).not.toBeNull();
    expect(localStorage.getItem('lastExternalReferrer')).toBeNull();
    localStorage.clear();
    m = await load();
    decide(m, ALL);
    localStorage.setItem('_gcl_ls', '{"schema":"gcl"}');
    localStorage.setItem('lastExternalReferrer', 'facebook.com');
    decide(m, VISITS_META);
    expect(localStorage.getItem('_gcl_ls')).toBeNull();
    expect(localStorage.getItem('lastExternalReferrer')).toBe('facebook.com');
  });

  it('Rechazar (o aceptar solo visitas) antes de cargar borra el almacenamiento local que dejó la tienda', async () => {
    localStorage.setItem('_gcl_ls', '{"schema":"gcl"}');
    localStorage.setItem('multiFbc', 'fb.1.x');
    const m = await load();
    decide(m, VISITS);
    expect(localStorage.getItem('_gcl_ls')).toBeNull();
    expect(localStorage.getItem('multiFbc')).toBeNull();
  });

  it('retirar Meta sin el píxel cargado: no llama a fbq, borra las cookies y recarga', async () => {
    const m = await load();
    decide(m, VISITS_META);
    setCookies('_fbp');
    expect(() => decide(m, VISITS)).not.toThrow();
    expect(cookieNames()).toEqual([]);
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it('un fbq que falla no impide borrar ni recargar', async () => {
    const m = await load();
    decide(m, VISITS_META);
    window.fbq = () => {
      throw new Error('falla');
    };
    setCookies('_fbc');
    expect(() => decide(m, VISITS)).not.toThrow();
    expect(cookieNames()).toEqual([]);
    expect(m.reload).toHaveBeenCalledTimes(1);
  });
});

describe('retirar un permiso con GTM cargado (sección 3.3)', () => {
  it('retirar todo: update en denied, elights_consent_update, ga-disable, borra _ga, _gcl y Meta, recarga y no envía nada más', async () => {
    const m = await load();
    decide(m, ALL);
    window.fbq = vi.fn();
    setCookies('_ga', '_ga_ABC123', '_gcl_au', '_gcl_aw', '_fbp', '_fbc', 'otra');
    const before = layer().length;
    decide(m, REJECT);
    expect(commands().at(-1)).toEqual(['consent', 'update', DENIED]);
    expect(steps().slice(before)).toEqual(['consent update', 'elights_consent_update']);
    expect(eventsNamed('elights_consent_update')[0]).toMatchObject({ analytics_consent: 'denied', ads_consent: 'denied', meta_consent: 'denied' });
    expect(window.fbq).toHaveBeenCalledWith('consent', 'revoke');
    expect(disabled()).toBe(true);
    expect(cookieNames()).toEqual(['otra']);
    expect(m.reload).toHaveBeenCalledTimes(1);

    const after = layer().length;
    m.a.trackLead('cotizacion');
    m.a.sendEvent('add_to_quote');
    m.a.sendPageView('/catalogo');
    clickContactLinks();
    decide(m, ALL); // volver a aceptar antes de que termine la recarga: otra recarga no, nada más
    expect(layer().length).toBe(after);
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it('retirar solo la medición de anuncios: update con ads en denied, borra las _gcl, deja _ga y recarga', async () => {
    const m = await load();
    decide(m, VISITS_ADS);
    setCookies('_ga', '_gcl_au');
    decide(m, VISITS);
    expect(commands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(cookieNames()).toEqual(['_ga']);
    expect(disabled()).toBe(false);
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it('ampliar no recarga: de visitas a todo', async () => {
    const m = await load();
    decide(m, VISITS);
    decide(m, ALL);
    expect(m.reload).not.toHaveBeenCalled();
    expect(eventsNamed('elights_consent_update')).toHaveLength(1);
    expect(eventsNamed('elights_meta_granted')).toHaveLength(1);
  });

  it('desde otra pestaña no se recarga de golpe: se aplica lo demás y la siguiente navegación es una carga completa', async () => {
    const m = await load();
    decide(m, ALL);
    window.fbq = vi.fn();
    setCookies('_ga', '_gcl_au', '_fbp', 'otra');
    decideInOtherTab(m, REJECT);
    expect(m.reload).not.toHaveBeenCalled();
    expect(commands().at(-1)).toEqual(['consent', 'update', DENIED]);
    expect(eventsNamed('elights_consent_update')[0]).toMatchObject({ meta_consent: 'denied' });
    expect(window.fbq).toHaveBeenCalledWith('consent', 'revoke');
    expect(disabled()).toBe(true);
    expect(cookieNames()).toEqual(['otra']);
    // Mientras tanto no se envía nada
    const after = layer().length;
    m.a.sendEvent('add_to_quote');
    clickContactLinks();
    expect(layer().length).toBe(after);
    // La siguiente navegación de esta pestaña: carga completa
    m.a.sendPageView('/catalogo');
    expect(m.reload).toHaveBeenCalledTimes(1);
    expect(layer().length).toBe(after);
  });

  it('desde otra pestaña, retirar solo Meta: la medición de visitas sigue hasta la siguiente navegación, que recarga', async () => {
    const m = await load();
    decide(m, VISITS_META);
    decideInOtherTab(m, VISITS);
    expect(m.reload).not.toHaveBeenCalled();
    m.a.sendEvent('add_to_quote', { item_id: 'x' });
    expect(eventsNamed('add_to_quote')).toHaveLength(1);
    m.a.sendPageView('/catalogo');
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it('después de un retiro en otra pestaña, una decisión de esta pestaña se aplica recargando', async () => {
    const m = await load();
    decide(m, ALL);
    decideInOtherTab(m, VISITS);
    expect(m.reload).not.toHaveBeenCalled();
    decide(m, ALL);
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it('si otro script borra window.gtag, nada lanza (RouteTracker y los formularios siguen)', async () => {
    const m = await load();
    decide(m, ALL);
    delete window.gtag;
    expect(() => {
      m.a.sendPageView('/catalogo');
      m.a.trackLead('cotizacion');
      decide(m, REJECT);
    }).not.toThrow();
    expect(pageViews()).toHaveLength(1);
  });
});

describe('modo de prueba (sección 7.1)', () => {
  it('host de prueba con gtm_debug: el aviso puede abrirse, GTM carga con elights_env test y ga-disable', async () => {
    window.history.replaceState({}, '', '/?gtm_debug=1700000000000');
    const m = await load({ hosts: null, testHosts: 'nuevo.elights.cl, localhost' });
    expect(m.a.testMode()).toBe(true);
    expect(m.a.analyticsAvailable()).toBe(true);
    decide(m, ALL);
    expect(objects()[0]).toEqual({ site_platform: 'elights-web', elights_env: 'test', meta_consent: 'granted' });
    expect(disabled()).toBe(true);
    expect(gtmScripts()).toHaveLength(1);
    // elights_consent_update también lleva test
    decide(m, ALL);
    expect(eventsNamed('elights_consent_update')[0]).toMatchObject({ elights_env: 'test' });
  });

  it('se recuerda en la pestaña: al navegar sin gtm_debug y en la carga siguiente sigue en modo de prueba', async () => {
    window.history.replaceState({}, '', '/?gtm_debug=x');
    let m = await load({ hosts: null, testHosts: 'localhost' });
    m.a.captureLandingParams();
    window.history.replaceState({}, '', '/catalogo');
    expect(m.a.testMode()).toBe(true);
    m = await load({ hosts: null, testHosts: 'localhost' }); // otra carga de la misma pestaña
    expect(m.a.testMode()).toBe(true);
    sessionStorage.clear(); // otra pestaña
    m = await load({ hosts: null, testHosts: 'localhost' });
    expect(m.a.testMode()).toBe(false);
  });

  it('sin gtm_debug, un host de prueba es como cualquier otro: no se carga nada', async () => {
    const m = await load({ hosts: null, testHosts: 'localhost' });
    expect(m.a.testMode()).toBe(false);
    expect(m.a.analyticsAvailable()).toBe(false);
    decide(m, ALL);
    m.a.sendPageView('/');
    expectNothingLoaded();
  });

  it('gtm_debug en un host que no es de prueba no hace nada', async () => {
    window.history.replaceState({}, '', '/?gtm_debug=1');
    const m = await load({ hosts: null, testHosts: 'nuevo.elights.cl' });
    expect(m.a.testMode()).toBe(false);
    decide(m, ALL);
    expectNothingLoaded();
    expect(sessionStorage.getItem('elights_gtm_debug')).toBeNull();
  });

  it('el modo de prueba también exige el ID del contenedor', async () => {
    window.history.replaceState({}, '', '/?gtm_debug=1');
    const m = await load({ gtm: null, hosts: null, testHosts: 'localhost' });
    expect(m.a.analyticsAvailable()).toBe(false);
    decide(m, ALL);
    expectNothingLoaded();
  });
});

describe('dónde se carga', () => {
  it('fuera de elights.cl (nuevo.elights.cl, previews) no carga nada aunque haya consentimiento', async () => {
    const m = await load({ hosts: null });
    expect(window.location.hostname).toBe('localhost');
    expect(m.a.analyticsAvailable()).toBe(false);
    decide(m, ALL);
    m.a.sendPageView('/');
    m.a.trackLead('solicitud_pedido');
    clickContactLinks();
    expectNothingLoaded();
  });

  it.each([
    ['sin VITE_GTM_ID', null],
    ['con un ID que no es de GTM', 'G-C06JF3ZNH5'],
    ['con un ID vacío', ''],
  ])('%s no carga nada ni falla, aunque haya consentimiento', async (_, gtm) => {
    const m = await load({ gtm });
    decide(m, ALL);
    m.a.sendEvent('add_to_quote');
    m.a.trackLead('instalacion');
    expectNothingLoaded();
  });

  it('sin VITE_GA4_ID carga GTM igual (ga-disable queda sin poner)', async () => {
    const m = await load({ ga: null });
    decide(m, VISITS);
    expect(gtmScripts()).toHaveLength(1);
    expect(disabled()).toBeUndefined();
  });

  it('los IDs y los dominios se leen al llamar, no al importar', async () => {
    const m = await load({ hosts: null });
    expect(m.a.analyticsAvailable()).toBe(false);
    vi.stubEnv('VITE_ANALYTICS_HOSTS', 'localhost');
    expect(m.a.analyticsAvailable()).toBe(true);
    expect(m.a.gtmId()).toBe(GTM);
    expect(m.a.gaId()).toBe(GA);
    vi.stubEnv('VITE_GTM_ID', 'PENDIENTE');
    expect(m.a.gtmId()).toBeUndefined();
    expect(m.a.analyticsAvailable()).toBe(false);
    vi.stubEnv('VITE_GA4_ID', '__VITE_GA4_ID__');
    expect(m.a.gaId()).toBeUndefined();
  });

  it('el aviso puesto en un host de prueba (VITE_COOKIE_BANNER_HOSTS) no habilita GTM', async () => {
    vi.stubEnv('VITE_COOKIE_BANNER_HOSTS', 'localhost');
    const m = await load({ hosts: null });
    decide(m, ALL);
    m.a.sendPageView('/');
    expectNothingLoaded();
  });
});
