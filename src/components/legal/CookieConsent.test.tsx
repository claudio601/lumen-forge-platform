// src/components/legal/CookieConsent.test.tsx
// Aviso de cookies (Etapa 2 · PR 13; PR 14: GTM y «Publicidad en Meta»), con el mismo módulo
// de analytics que usa la app: montar no carga nada ni decide; Rechazar no carga nada y no borra
// el origen de la visita; Aceptar carga gtm.js en el orden exacto y enciende también Meta; el
// diálogo refleja la decisión y la medición de anuncios y Meta requieren la de visitas; retirar
// un permiso recarga la página (no desde otra pestaña); apagar el origen lo borra; el pie reabre
// el diálogo; en los hosts sin Google el pie abre el panel informativo; el modo de prueba de GTM
// abre el aviso; en el servidor no dibuja nada.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';

const ID = 'G-TEST123';
const GTM = 'GTM-TEST123';
const KEY = 'elights_cookie_consent';
const ATTRIBUTION_KEY = 'elights_attribution';
const ATTRIBUTION = JSON.stringify({ gclid: 'Cj0KCQjwEJEMPLO123', landing: '/' });

type Env = { analyticsHosts?: string | null; bannerHosts?: string; testHosts?: string };

/**
 * Módulos nuevos en cada prueba (analytics sin inicializar). Por defecto el aviso está
 * HABILITADO: contenedor de prueba, GA4 con ID de prueba y localhost como dominio que mide.
 * La recarga de la página queda espiada (jsdom no navega).
 */
async function setup({ analyticsHosts = 'localhost', bannerHosts, testHosts }: Env = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_GTM_ID', GTM);
  vi.stubEnv('VITE_GA4_ID', ID);
  if (analyticsHosts !== null) vi.stubEnv('VITE_ANALYTICS_HOSTS', analyticsHosts);
  if (bannerHosts) vi.stubEnv('VITE_COOKIE_BANNER_HOSTS', bannerHosts);
  if (testHosts) vi.stubEnv('VITE_GTM_TEST_HOSTS', testHosts);
  const { default: CookieConsent } = await import('./CookieConsent');
  const { default: CookieSettingsButton } = await import('./CookieSettingsButton');
  const analytics = await import('@/lib/analytics');
  const cc = await import('@/lib/cookieConsent');
  const reload = vi.spyOn(analytics.page, 'reload').mockImplementation(() => {});
  const tree = (
    <MemoryRouter>
      <CookieConsent />
      <footer>
        <CookieSettingsButton className="block text-left" />
      </footer>
    </MemoryRouter>
  );
  return { CookieConsent, analytics, cc, tree, reload, T: cc.COOKIE_TEXTS };
}

const banner = () => screen.queryByRole('region', { name: 'Aviso de cookies' });
const gtmScripts = () => document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]').length;
const gtagScripts = () => document.querySelectorAll('script[src*="gtag/js"]').length;
const isArgs = (e: unknown) => Object.prototype.toString.call(e) === '[object Arguments]';
/** Cada paso del dataLayer: comandos de gtag ('consent default') y objetos por su evento ('estado' sin evento). */
const steps = () =>
  (window.dataLayer ?? []).map(e => {
    if (isArgs(e)) {
      const [cmd, arg] = Array.from(e as ArrayLike<unknown>);
      return typeof arg === 'string' ? `${cmd} ${arg}` : String(cmd);
    }
    const ev = (e as { event?: unknown }).event;
    return typeof ev === 'string' ? ev : 'estado';
  });
const META = 'Publicidad en Meta';
const stored = () => {
  const raw = localStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
};
const dialog = () => screen.getByRole('dialog', { name: 'Configurar cookies' });
const switchFor = (name: string) => within(dialog()).getByRole('switch', { name });
const openFromFooter = () => fireEvent.click(screen.getByRole('button', { name: 'Configurar cookies' }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  delete window.dataLayer;
  delete window.gtag;
  delete window.fbq;
  delete (window as unknown as Record<string, unknown>)['ga-disable-' + ID];
  document.head.innerHTML = '';
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('aviso de cookies en un host con Google', () => {
  it('montar no decide ni carga nada: el aviso se ve, sin script, sin dataLayer y sin decisión guardada', async () => {
    const { tree, analytics } = await setup();
    render(tree);
    analytics.sendPageView('/'); // como RouteTracker
    expect(await screen.findByRole('region', { name: 'Aviso de cookies' })).toBeInTheDocument();
    expect(gtmScripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('textos exactos (nombra a Meta), enlace a la Política en otra pestaña y botones en orden Rechazar · Configurar · Aceptar', async () => {
    const { tree, T } = await setup();
    render(tree);
    const region = await screen.findByRole('region', { name: 'Aviso de cookies' });
    expect(region.textContent).toBe(`${T.banner} ${T.policyLink}${T.reject}${T.configure}${T.accept}`);
    expect(region.textContent).toContain('cookies de Google y de Meta');
    const link = within(region).getByRole('link', { name: 'Política de privacidad' });
    expect(link).toHaveAttribute('href', '/politica-de-privacidad');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(region).getAllByRole('button').map(b => b.textContent)).toEqual(['Rechazar', 'Configurar', 'Aceptar']);
  });

  it('Rechazar y Aceptar son idénticos; Configurar es outline del mismo tamaño', async () => {
    const { tree } = await setup();
    render(tree);
    const region = await screen.findByRole('region', { name: 'Aviso de cookies' });
    const [reject, configure, accept] = within(region).getAllByRole('button');
    expect(reject.className).toBe(accept.className);
    expect(configure.className).not.toBe(accept.className);
    expect(configure).toHaveClass('border-input', 'h-9');
    expect(accept).toHaveClass('h-9', 'flex-1');
  });

  it('es fijo, sin overlay, sin X y no roba el foco', async () => {
    const { tree } = await setup();
    render(tree);
    const region = await screen.findByRole('region', { name: 'Aviso de cookies' });
    expect(region).toHaveClass('fixed', 'bottom-[5.5rem]', 'sm:left-6', 'sm:bottom-6', 'z-[60]');
    expect(region.className).not.toMatch(/\binset-0\b/);
    expect(within(region).queryByRole('button', { name: /cerrar|close|×/i })).toBeNull();
    expect(region.contains(document.activeElement)).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('Rechazar: sigue sin script ni dataLayer, guarda false/false conservando el origen y no borra el origen anotado', async () => {
    sessionStorage.setItem(ATTRIBUTION_KEY, ATTRIBUTION);
    const { tree } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Rechazar' }));
    expect(banner()).toBeNull();
    expect(gtmScripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
    expect(stored()).toMatchObject({ v: 2, analytics: false, ads: false, meta: false, origin: true });
    expect(sessionStorage.getItem(ATTRIBUTION_KEY)).toBe(ATTRIBUTION);
  });

  it('Aceptar: un gtm.js (ningún gtag/js) y el dataLayer en orden consent default → set → update → estado → gtm.js → vista; enciende Meta', async () => {
    const { tree } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Aceptar' }));
    expect(banner()).toBeNull();
    expect(gtmScripts()).toBe(1);
    expect(gtagScripts()).toBe(0);
    expect(steps()).toEqual(['consent default', 'set ads_data_redaction', 'consent update', 'estado', 'gtm.js', 'set', 'elights_page_view']);
    expect((window.dataLayer ?? [])[3]).toEqual({ site_platform: 'elights-web', elights_env: 'prod', meta_consent: 'granted' });
    expect(stored()).toMatchObject({ v: 2, analytics: true, ads: true, meta: true, origin: true });
  });

  it('Aceptar conserva una oposición previa al origen de la visita', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, at: '2020-01-01T00:00:00.000Z', analytics: false, ads: false, meta: false, origin: false }));
    const { tree } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Aceptar' }));
    expect(stored()).toMatchObject({ analytics: true, ads: true, meta: true, origin: false });
  });

  it('con una decisión vigente el aviso no aparece', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, at: new Date().toISOString(), analytics: false, ads: false, meta: false, origin: true }));
    const { tree } = await setup();
    render(tree);
    await act(async () => {});
    expect(banner()).toBeNull();
  });

  it('una decisión de la versión 1 (antes de «Publicidad en Meta») vuelve a mostrar el aviso, aunque aceptara todo', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: true, ads: true, origin: true }));
    const { tree, analytics } = await setup();
    render(tree);
    analytics.sendPageView('/'); // como RouteTracker: sin decisión vigente no carga nada
    expect(await screen.findByRole('region', { name: 'Aviso de cookies' })).toBeInTheDocument();
    expect(gtmScripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
  });

  it('Configurar abre el diálogo (el aviso se oculta): origen activo, visitas, anuncios y Meta inactivos, anuncios y Meta deshabilitados sin visitas', async () => {
    const { tree, T } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Configurar' }));
    expect(banner()).toBeNull();
    expect(within(dialog()).getByText(T.settingsDescription)).toBeInTheDocument();
    expect(within(dialog()).getByText('Siempre activas')).toBeInTheDocument();
    expect(within(dialog()).getAllByRole('switch').map(s => s.getAttribute('aria-labelledby') && document.getElementById(s.getAttribute('aria-labelledby')!)?.textContent)).toEqual([
      'Origen de la visita',
      'Medición de visitas (Google Analytics)',
      'Medición de anuncios de Google',
      META,
    ]);
    expect(switchFor('Origen de la visita')).toHaveAttribute('aria-checked', 'true');
    expect(switchFor('Medición de visitas (Google Analytics)')).toHaveAttribute('aria-checked', 'false');
    const ads = switchFor('Medición de anuncios de Google');
    expect(ads).toHaveAttribute('aria-checked', 'false');
    expect(ads).toBeDisabled();
    expect(ads).toHaveAccessibleDescription(T.adsText);
    const meta = switchFor(META);
    expect(meta).toHaveAttribute('aria-checked', 'false');
    expect(meta).toBeDisabled();
    expect(meta).toHaveAccessibleDescription(T.metaText);

    fireEvent.click(switchFor('Medición de visitas (Google Analytics)'));
    expect(switchFor('Medición de anuncios de Google')).toBeEnabled();
    expect(switchFor(META)).toBeEnabled();
    fireEvent.click(switchFor('Medición de anuncios de Google'));
    fireEvent.click(switchFor(META));
    expect(switchFor('Medición de anuncios de Google')).toHaveAttribute('aria-checked', 'true');
    expect(switchFor(META)).toHaveAttribute('aria-checked', 'true');

    // Apagar la medición de visitas apaga también la de anuncios y Meta
    fireEvent.click(switchFor('Medición de visitas (Google Analytics)'));
    expect(switchFor('Medición de anuncios de Google')).toHaveAttribute('aria-checked', 'false');
    expect(switchFor('Medición de anuncios de Google')).toBeDisabled();
    expect(switchFor(META)).toHaveAttribute('aria-checked', 'false');
    expect(switchFor(META)).toBeDisabled();

    expect(within(dialog()).getAllByRole('button').map(b => b.textContent || b.getAttribute('aria-label'))).toEqual([
      'Rechazar cookies',
      'Guardar mi elección',
      'Aceptar cookies',
      'Cerrar sin cambiar tu decisión',
    ]);
  });

  it('Guardar mi elección con solo visitas carga GTM sin anuncios ni Meta', async () => {
    const { tree } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Configurar' }));
    fireEvent.click(switchFor('Medición de visitas (Google Analytics)'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Guardar mi elección' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(banner()).toBeNull();
    expect(stored()).toMatchObject({ analytics: true, ads: false, meta: false, origin: true });
    const update = (window.dataLayer ?? []).filter(isArgs).map(e => Array.from(e as ArrayLike<unknown>)).find(e => e[0] === 'consent' && e[1] === 'update');
    expect(update?.[2]).toEqual({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    expect((window.dataLayer ?? [])[3]).toMatchObject({ meta_consent: 'denied' });
  });

  it('Guardar con visitas y Meta, sin anuncios: meta_consent granted y anuncios en denied', async () => {
    const { tree } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Configurar' }));
    fireEvent.click(switchFor('Medición de visitas (Google Analytics)'));
    fireEvent.click(switchFor(META));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Guardar mi elección' }));
    expect(stored()).toMatchObject({ analytics: true, ads: false, meta: true });
    expect((window.dataLayer ?? [])[3]).toEqual({ site_platform: 'elights-web', elights_env: 'prod', meta_consent: 'granted' });
  });

  it('Meta después, sin recargar: elights_consent_update y elights_meta_granted', async () => {
    const { tree, reload } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Configurar' }));
    fireEvent.click(switchFor('Medición de visitas (Google Analytics)'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Guardar mi elección' }));
    const before = steps().length;
    openFromFooter();
    fireEvent.click(switchFor(META));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Guardar mi elección' }));
    expect(steps().slice(before)).toEqual(['consent update', 'elights_consent_update', 'elights_meta_granted']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('apagar el origen y guardar borra lo anotado y deja de anotar', async () => {
    sessionStorage.setItem(ATTRIBUTION_KEY, ATTRIBUTION);
    const { tree, cc } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Configurar' }));
    fireEvent.click(switchFor('Origen de la visita'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Rechazar cookies' }));
    expect(stored()).toMatchObject({ analytics: false, ads: false, meta: false, origin: false });
    expect(sessionStorage.getItem(ATTRIBUTION_KEY)).toBeNull();
    expect(cc.isOriginOptedOut()).toBe(true);
    const { captureAttribution, getAttribution } = await import('@/lib/attribution');
    captureAttribution('https://elights.cl/?gclid=OTRO', '');
    expect(sessionStorage.getItem(ATTRIBUTION_KEY)).toBeNull();
    expect(getAttribution()).toBeUndefined();
  });

  it('el botón del pie reabre el diálogo con la decisión previa y el foco en el título', async () => {
    const { tree, reload } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Aceptar' }));
    openFromFooter();
    expect(switchFor('Origen de la visita')).toHaveAttribute('aria-checked', 'true');
    expect(switchFor('Medición de visitas (Google Analytics)')).toHaveAttribute('aria-checked', 'true');
    expect(switchFor('Medición de anuncios de Google')).toHaveAttribute('aria-checked', 'true');
    expect(switchFor(META)).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(within(dialog()).getByRole('heading', { name: 'Configurar cookies' }));

    // Revocar desde el pie: GA queda desactivado y la página se recarga
    window.fbq = vi.fn(); // el píxel que cargó el contenedor
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Rechazar cookies' }));
    expect((window as unknown as Record<string, unknown>)['ga-disable-' + ID]).toBe(true);
    expect(window.fbq).toHaveBeenCalledWith('consent', 'revoke');
    expect(stored()).toMatchObject({ analytics: false, ads: false, meta: false, origin: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('retirar solo Meta desde el pie recarga la página; ampliar no', async () => {
    const { tree, reload } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Configurar' }));
    fireEvent.click(switchFor('Medición de visitas (Google Analytics)'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Guardar mi elección' }));
    openFromFooter();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Aceptar cookies' }));
    expect(reload).not.toHaveBeenCalled();
    openFromFooter();
    fireEvent.click(switchFor(META));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Guardar mi elección' }));
    expect(stored()).toMatchObject({ analytics: true, ads: true, meta: false });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('la X cierra sin decidir: sin decisión, el aviso vuelve', async () => {
    const { tree } = await setup();
    render(tree);
    await screen.findByRole('region', { name: 'Aviso de cookies' });
    openFromFooter();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cerrar sin cambiar tu decisión' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(banner()).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('una decisión tomada en otra pestaña quita el aviso de esta y se aplica', async () => {
    sessionStorage.setItem(ATTRIBUTION_KEY, ATTRIBUTION);
    const { tree } = await setup();
    render(tree);
    await screen.findByRole('region', { name: 'Aviso de cookies' });
    localStorage.setItem(KEY, JSON.stringify({ v: 2, at: new Date().toISOString(), analytics: false, ads: false, meta: false, origin: false }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    expect(banner()).toBeNull();
    expect(sessionStorage.getItem(ATTRIBUTION_KEY)).toBeNull();
    expect(gtmScripts()).toBe(0);
  });

  it('retirar un permiso en otra pestaña no recarga esta: la siguiente navegación es una carga completa', async () => {
    const { tree, reload, analytics } = await setup();
    render(tree);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Aviso de cookies' })).getByRole('button', { name: 'Aceptar' }));
    expect(gtmScripts()).toBe(1);
    localStorage.setItem(KEY, JSON.stringify({ v: 2, at: new Date().toISOString(), analytics: false, ads: false, meta: false, origin: true }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    expect(reload).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>)['ga-disable-' + ID]).toBe(true);
    analytics.sendPageView('/catalogo'); // como RouteTracker al navegar
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('en el servidor (renderToString) no dibuja nada, con el aviso habilitado y sin decisión', async () => {
    const { CookieConsent } = await setup();
    expect(
      renderToString(
        <StaticRouter location="/">
          <CookieConsent />
        </StaticRouter>,
      ),
    ).toBe('');
  });
});

describe('por host', () => {
  it('con los dominios por defecto (localhost no mide) el aviso no aparece solo y el pie abre el panel informativo', async () => {
    sessionStorage.setItem(ATTRIBUTION_KEY, ATTRIBUTION);
    const { tree, T } = await setup({ analyticsHosts: null });
    render(tree);
    await act(async () => {});
    expect(banner()).toBeNull();

    openFromFooter();
    expect(within(dialog()).getByText(T.settingsDescriptionNoGoogle)).toBeInTheDocument();
    expect(T.settingsDescriptionNoGoogle.startsWith('En esta dirección del sitio no usamos cookies, Google Analytics, medición de anuncios ni el píxel de Meta')).toBe(true);
    expect(within(dialog()).getByText('Necesarias')).toBeInTheDocument();
    expect(within(dialog()).getAllByRole('switch')).toHaveLength(1);
    expect(within(dialog()).queryByText(/Medición de visitas/)).toBeNull();
    expect(within(dialog()).queryByText(META)).toBeNull();
    expect(within(dialog()).getAllByRole('button').map(b => b.textContent || b.getAttribute('aria-label'))).toEqual([
      'Guardar mi elección',
      'Cerrar',
      'Cerrar sin cambiar tu decisión',
    ]);

    // Cerrar no decide ni hace volver el aviso
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(banner()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();

    // Guardar con el origen apagado: { analytics: false, ads: false, origin: false }
    openFromFooter();
    fireEvent.click(switchFor('Origen de la visita'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Guardar mi elección' }));
    expect(stored()).toMatchObject({ v: 2, analytics: false, ads: false, meta: false, origin: false });
    expect(sessionStorage.getItem(ATTRIBUTION_KEY)).toBeNull();
    expect(gtmScripts()).toBe(0);
  });

  it('con VITE_COOKIE_BANNER_HOSTS=localhost aparece solo, muestra las categorías de Google y Meta, y aceptar no carga GTM', async () => {
    const { tree } = await setup({ analyticsHosts: null, bannerHosts: 'localhost' });
    render(tree);
    const region = await screen.findByRole('region', { name: 'Aviso de cookies' });
    fireEvent.click(within(region).getByRole('button', { name: 'Configurar' }));
    expect(within(dialog()).getAllByRole('switch')).toHaveLength(4);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Aceptar cookies' }));
    expect(stored()).toMatchObject({ analytics: true, ads: true, meta: true, origin: true });
    expect(gtmScripts()).toBe(0);
    expect(window.dataLayer).toBeUndefined();
  });

  it('modo de prueba (VITE_GTM_TEST_HOSTS y gtm_debug): el aviso aparece en esa pestaña y GTM se carga con elights_env test', async () => {
    window.history.replaceState({}, '', '/?gtm_debug=1700000000000');
    const { tree } = await setup({ analyticsHosts: null, testHosts: 'localhost' });
    render(tree);
    const region = await screen.findByRole('region', { name: 'Aviso de cookies' });
    fireEvent.click(within(region).getByRole('button', { name: 'Aceptar' }));
    expect(gtmScripts()).toBe(1);
    expect((window.dataLayer ?? [])[3]).toEqual({ site_platform: 'elights-web', elights_env: 'test', meta_consent: 'granted' });
    expect((window as unknown as Record<string, unknown>)['ga-disable-' + ID]).toBe(true);
  });

  it('un host de prueba sin gtm_debug ni medición habilitada: el aviso no aparece solo', async () => {
    const { tree } = await setup({ analyticsHosts: null, testHosts: 'localhost' });
    render(tree);
    await act(async () => {});
    expect(banner()).toBeNull();
  });
});
