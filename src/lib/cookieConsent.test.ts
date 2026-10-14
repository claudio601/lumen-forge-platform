// src/lib/cookieConsent.test.ts
// Decisión de cookies (Etapa 2 · PR 13): dónde se guarda, cuándo vale (versión, 12 meses,
// reloj adelantado, tipos), que la oposición al origen no vence, el respaldo en memoria si
// el almacenamiento falla, los avisos a esta pestaña y a las otras, y los hosts de prueba.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CookieConsentModule = typeof import('./cookieConsent');

const KEY = 'elights_cookie_consent';
const NOW = new Date('2026-11-20T14:03:12.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** Módulo nuevo en cada prueba: la copia en memoria parte vacía. */
async function load(): Promise<CookieConsentModule> {
  vi.resetModules();
  return import('./cookieConsent');
}

const record = (over: Record<string, unknown> = {}) => ({
  v: 1,
  at: NOW.toISOString(),
  analytics: true,
  ads: false,
  origin: true,
  ...over,
});
const seed = (value: unknown) => localStorage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value));
const stored = () => {
  const raw = localStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('importar', () => {
  it('no lee ni escribe nada', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await load();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('guardar y leer', () => {
  it("escribe 'elights_cookie_consent' con v, at, analytics, ads y origin, en ese orden", async () => {
    const cc = await load();
    expect(cc.getCookieChoice()).toBeNull();
    cc.setCookieChoice({ analytics: true, ads: true, origin: true });
    expect(localStorage.getItem(KEY)).toBe('{"v":1,"at":"2026-11-20T14:03:12.000Z","analytics":true,"ads":true,"origin":true}');
    expect(cc.getCookieChoice()).toEqual({ analytics: true, ads: true, origin: true });
  });

  it('una decisión guardada en otra carga se lee igual', async () => {
    seed(record({ analytics: false, ads: false, origin: false }));
    const cc = await load();
    expect(cc.getCookieChoice()).toEqual({ analytics: false, ads: false, origin: false });
  });

  it('anuncios sin visitas se guardan y se leen como anuncios apagados', async () => {
    const cc = await load();
    expect(cc.setCookieChoice({ analytics: false, ads: true, origin: true })).toEqual({ analytics: false, ads: false, origin: true });
    expect(stored().ads).toBe(false);
    localStorage.clear();
    seed(record({ analytics: false, ads: true }));
    expect(cc.getCookieChoice()).toEqual({ analytics: false, ads: false, origin: true });
  });
});

describe('validez', () => {
  it.each([
    ['de 364 días', record({ at: new Date(NOW.getTime() - 364 * DAY).toISOString() })],
    ['con el reloj del navegador atrasado hasta 1 día', record({ at: new Date(NOW.getTime() + DAY).toISOString() })],
  ])('vale una decisión %s', async (_, value) => {
    seed(value);
    const cc = await load();
    expect(cc.getCookieChoice()).toEqual({ analytics: true, ads: false, origin: true });
  });

  it.each([
    ['vencida (365 días o más)', record({ at: new Date(NOW.getTime() - 365 * DAY).toISOString() })],
    ['vencida (400 días)', record({ at: new Date(NOW.getTime() - 400 * DAY).toISOString() })],
    ['de otra versión', record({ v: 2 })],
    ['sin versión', record({ v: undefined })],
    ['con fecha más de 1 día en el futuro', record({ at: new Date(NOW.getTime() + DAY + 1000).toISOString() })],
    ['con fecha ilegible', record({ at: 'ayer' })],
    ['con fecha que no es texto', record({ at: NOW.getTime() })],
    ['con analytics no booleano', record({ analytics: 'true' })],
    ['con ads no booleano', record({ ads: 1 })],
    ['sin origin', record({ origin: undefined })],
    ['que es null', null],
    ['que es un texto', 'aceptado'],
    ['que es un arreglo', [record()]],
    ['con JSON roto', '{"v":1,'],
  ])('no vale una decisión %s: el aviso vuelve', async (_, value) => {
    seed(value);
    const cc = await load();
    expect(cc.getCookieChoice()).toBeNull();
  });
});

describe('oposición al origen de la visita', () => {
  it('no vence: sigue con una decisión vencida o de otra versión', async () => {
    seed(record({ origin: false, at: new Date(NOW.getTime() - 800 * DAY).toISOString() }));
    let cc = await load();
    expect(cc.getCookieChoice()).toBeNull();
    expect(cc.isOriginOptedOut()).toBe(true);

    seed(record({ origin: false, v: 99 }));
    cc = await load();
    expect(cc.getCookieChoice()).toBeNull();
    expect(cc.isOriginOptedOut()).toBe(true);
  });

  it('sin decisión, con origin true o con un valor ilegible no hay oposición', async () => {
    let cc = await load();
    expect(cc.isOriginOptedOut()).toBe(false);
    seed(record({ origin: true }));
    cc = await load();
    expect(cc.isOriginOptedOut()).toBe(false);
    seed('{"origin":false');
    cc = await load();
    expect(cc.isOriginOptedOut()).toBe(false);
    seed(record({ origin: 'false' }));
    cc = await load();
    expect(cc.isOriginOptedOut()).toBe(false);
  });
});

describe('almacenamiento que falla', () => {
  it('si localStorage lanza, la decisión queda en memoria durante la carga', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const cc = await load();
    expect(cc.getCookieChoice()).toBeNull();
    expect(() => cc.setCookieChoice({ analytics: false, ads: false, origin: false })).not.toThrow();
    expect(cc.getCookieChoice()).toEqual({ analytics: false, ads: false, origin: false });
    expect(cc.isOriginOptedOut()).toBe(true);
  });

  it('si solo la escritura falla (cuota llena), manda lo decidido y no lo guardado antes', async () => {
    seed(record({ analytics: true }));
    const cc = await load();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    cc.setCookieChoice({ analytics: false, ads: false, origin: true });
    expect(stored().analytics).toBe(true); // lo viejo sigue en localStorage
    expect(cc.getCookieChoice()).toEqual({ analytics: false, ads: false, origin: true });
  });

  it('__resetForTests olvida la copia en memoria', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const cc = await load();
    cc.setCookieChoice({ analytics: true, ads: true, origin: true });
    cc.__resetForTests();
    expect(cc.getCookieChoice()).toBeNull();
  });
});

describe('avisos', () => {
  it('setCookieChoice avisa a los suscriptores y emite COOKIE_CONSENT_EVENT con la decisión', async () => {
    const cc = await load();
    const listener = vi.fn();
    const onEvent = vi.fn();
    const unsubscribe = cc.subscribe(listener);
    window.addEventListener(cc.COOKIE_CONSENT_EVENT, onEvent);
    cc.setCookieChoice({ analytics: true, ads: false, origin: true });
    expect(listener).toHaveBeenCalledWith({ analytics: true, ads: false, origin: true });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect((onEvent.mock.calls[0][0] as CustomEvent).detail).toEqual({ analytics: true, ads: false, origin: true });
    expect(cc.COOKIE_CONSENT_EVENT).toBe('elights:cookie-consent');
    window.removeEventListener(cc.COOKIE_CONSENT_EVENT, onEvent);

    unsubscribe();
    cc.setCookieChoice({ analytics: false, ads: false, origin: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('el evento storage (otra pestaña) avisa con la decisión guardada allí', async () => {
    const cc = await load();
    const listener = vi.fn();
    const unsubscribe = cc.subscribe(listener);
    seed(record({ analytics: false, ads: false, origin: false }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(listener).toHaveBeenCalledWith({ analytics: false, ads: false, origin: false });

    window.dispatchEvent(new StorageEvent('storage', { key: 'elights_request_cart' }));
    expect(listener).toHaveBeenCalledTimes(1);

    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null })); // otra pestaña borró todo
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('un suscriptor que falla no impide guardar ni avisar a los demás', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cc = await load();
    const ok = vi.fn();
    cc.subscribe(() => {
      throw new Error('falla');
    });
    cc.subscribe(ok);
    cc.setCookieChoice({ analytics: true, ads: true, origin: true });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ analytics: true, ads: true });
    expect(consoleError).toHaveBeenCalledTimes(1); // el error no se pierde
  });

  it('openCookieSettings emite OPEN_COOKIE_SETTINGS_EVENT', async () => {
    const cc = await load();
    const onOpen = vi.fn();
    window.addEventListener(cc.OPEN_COOKIE_SETTINGS_EVENT, onOpen);
    cc.openCookieSettings();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(cc.OPEN_COOKIE_SETTINGS_EVENT).toBe('elights:cookie-settings');
    window.removeEventListener(cc.OPEN_COOKIE_SETTINGS_EVENT, onOpen);
  });
});

describe('bannerTestHost (VITE_COOKIE_BANNER_HOSTS)', () => {
  it('sin la variable, ningún host', async () => {
    const cc = await load();
    expect(cc.bannerTestHost()).toBe(false);
    expect(cc.bannerTestHost('lumen-git-x.vercel.app')).toBe(false);
  });

  it("una entrada con '.' coincide por sufijo y las demás con el host exacto", async () => {
    const cc = await load();
    vi.stubEnv('VITE_COOKIE_BANNER_HOSTS', ' .vercel.app , preview.elights.test ');
    expect(cc.bannerTestHost('lumen-git-x-claudio.vercel.app')).toBe(true);
    expect(cc.bannerTestHost('LUMEN.VERCEL.APP')).toBe(true);
    expect(cc.bannerTestHost('vercel.app')).toBe(false);
    expect(cc.bannerTestHost('evil-vercel.app')).toBe(false);
    expect(cc.bannerTestHost('preview.elights.test')).toBe(true);
    expect(cc.bannerTestHost('x.preview.elights.test')).toBe(false);
    expect(cc.bannerTestHost('nuevo.elights.cl')).toBe(false);
    expect(cc.bannerTestHost()).toBe(false); // jsdom: localhost
  });

  it('lee el entorno al llamar, no al importar', async () => {
    const cc = await load();
    expect(cc.bannerTestHost()).toBe(false);
    vi.stubEnv('VITE_COOKIE_BANNER_HOSTS', 'localhost');
    expect(cc.bannerTestHost()).toBe(true);
    vi.unstubAllEnvs();
    expect(cc.bannerTestHost()).toBe(false);
  });
});

describe('textos', () => {
  it('el aviso cabe en 2 a 3 líneas y el diálogo dice que la decisión dura 12 meses', async () => {
    const { COOKIE_TEXTS } = await load();
    expect(COOKIE_TEXTS.banner.length).toBeLessThan(160);
    expect(COOKIE_TEXTS.settingsDescription).toContain('Guardamos tu decisión 12 meses');
    expect(COOKIE_TEXTS.analyticsText).toContain('hasta 13 meses');
    expect(COOKIE_TEXTS.adsText.startsWith('Requiere la medición de visitas.')).toBe(true);
    expect(Object.isFrozen(COOKIE_TEXTS)).toBe(true);
  });
});
