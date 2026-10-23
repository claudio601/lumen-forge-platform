// src/lib/cookieConsent.ts
// ─────────────────────────────────────────────────────────────────────────────
// Decisión de cookies del visitante (Etapa 2 · PR 13; PR 14 suma «Publicidad en Meta»). Solo en
// el navegador: nada corre al importar y, en Node (prerender), todo responde «sin decisión».
//
// Dónde se guarda: localStorage 'elights_cookie_consent' =
//   {"v":2,"at":"2026-11-20T14:03:12.000Z","analytics":false,"ads":false,"meta":false,"origin":true}
// localStorage y no una cookie: sin consentimiento el sitio no instala cookies en el
// navegador. La decisión vale por origen: la de nuevo.elights.cl no pasa a elights.cl.
//
// Validez (si no se cumple, «sin decisión» y el aviso vuelve, también a quien rechazó):
// - v === COOKIE_CONSENT_VERSION. Es independiente de LEGAL_VERSION: sube solo cuando
//   cambian las finalidades del aviso (Privacidad §12), no al corregir la redacción. La 2
//   (PR 14) agrega «Publicidad en Meta»: una decisión v1 ya no vale y el aviso vuelve a todos.
// - `at` legible, de menos de 365 días y no más de 1 día en el futuro.
// - analytics, ads, meta y origin booleanos. ads o meta true sin analytics se tratan como
//   false (la medición de anuncios y «Publicidad en Meta» requieren la de visitas).
// La oposición al origen de la visita NO vence: isOriginOptedOut() solo pide un valor
// legible con origin === false, sin mirar edad ni versión.
//
// Toda lectura y escritura va en try/catch: si el almacenamiento falla (modo privado,
// bloqueado, cuota llena), la decisión vive en memoria durante la carga.
//
// Hidratación: ningún componente lo lee al dibujar. El aviso (CookieConsent) lo lee en un
// useEffect, y el botón del pie solo emite un evento al hacer clic.
// ─────────────────────────────────────────────────────────────────────────────

export const COOKIE_CONSENT_STORAGE_KEY = 'elights_cookie_consent';
/** Versión de las finalidades del aviso. 2 desde la PR 14 (categoría «Publicidad en Meta»). */
export const COOKIE_CONSENT_VERSION = 2;
/** La decisión dura 12 meses. */
export const COOKIE_CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
/** Un reloj adelantado hasta 1 día no invalida la decisión. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/** Se emite en window con detail = la decisión. */
export const COOKIE_CONSENT_EVENT = 'elights:cookie-consent';
/** Lo emite el botón «Configurar cookies»: el aviso abre el diálogo. */
export const OPEN_COOKIE_SETTINGS_EVENT = 'elights:cookie-settings';

export interface CookieChoice {
  /** Medición de visitas (Google Analytics). */
  analytics: boolean;
  /** Medición de anuncios de Google (requiere analytics). */
  ads: boolean;
  /** Publicidad en Meta: el píxel de Meta, que carga el contenedor de GTM (requiere analytics). */
  meta: boolean;
  /** Origen de la visita (PR 10). false = el visitante se opuso. */
  origin: boolean;
}

export interface StoredCookieChoice extends CookieChoice {
  v: number;
  at: string;
}

/** De dónde llegó la decisión: esta pestaña (setCookieChoice) u otra (evento storage). */
export type CookieChoiceSource = 'this-tab' | 'other-tab';
export type CookieChoiceListener = (choice: CookieChoice | null, source: CookieChoiceSource) => void;

/** Textos del aviso y del diálogo: viven en ./cookieTexts (sin navegador, los leen los scripts). */
export { COOKIE_TEXTS } from './cookieTexts';

/** Lo último decidido en esta carga. */
let memory: StoredCookieChoice | undefined;
/** La escritura falló: lo guardado (si hay) es anterior a lo decidido en esta carga. */
let memoryWins = false;
const listeners = new Set<CookieChoiceListener>();

const inBrowser = () => typeof window !== 'undefined';

/** El valor guardado tal cual (sin validar); null si no hay o no se puede leer. */
function readRaw(): unknown {
  if (!inBrowser()) return null;
  if (memoryWins) return memory ?? null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Almacenamiento bloqueado o valor ilegible: lo decidido en esta carga, si hay
    return memory ?? null;
  }
}

/** La decisión vigente de un valor guardado, o null si no es válida (ver las reglas arriba). */
function validChoice(raw: unknown, now: number): CookieChoice | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (r.v !== COOKIE_CONSENT_VERSION || typeof r.at !== 'string') return null;
    const at = Date.parse(r.at);
    if (!Number.isFinite(at) || now - at >= COOKIE_CONSENT_MAX_AGE_MS || at - now > MAX_FUTURE_MS) return null;
    if (typeof r.analytics !== 'boolean' || typeof r.ads !== 'boolean' || typeof r.meta !== 'boolean' || typeof r.origin !== 'boolean') {
      return null;
    }
    return { analytics: r.analytics, ads: r.ads && r.analytics, meta: r.meta && r.analytics, origin: r.origin };
  } catch {
    return null;
  }
}

/** La decisión vigente del visitante, o null si no decidió (o venció). Nunca lanza. */
export function getCookieChoice(now: number = Date.now()): CookieChoice | null {
  return validChoice(readRaw(), now);
}

/** El visitante se opuso al registro del origen de la visita. No vence. Nunca lanza. */
export function isOriginOptedOut(): boolean {
  const raw = readRaw();
  return !!raw && typeof raw === 'object' && (raw as { origin?: unknown }).origin === false;
}

function notify(choice: CookieChoice | null): void {
  for (const listener of [...listeners]) {
    try {
      listener(choice, 'this-tab');
    } catch (err) {
      // Un suscriptor que falla no impide guardar ni avisar a los demás (sin datos personales)
      console.error('[cookieConsent] un suscriptor falló', err);
    }
  }
}

/**
 * Guarda una decisión (solo desde un manejador de eventos, nunca al dibujar: escribe la hora
 * actual). Avisa a los suscriptores de esta pestaña y emite COOKIE_CONSENT_EVENT.
 * Devuelve la decisión normalizada (ads y meta solo con analytics).
 */
export function setCookieChoice(choice: CookieChoice): CookieChoice {
  const analytics = choice.analytics === true;
  const normalized: CookieChoice = {
    analytics,
    ads: choice.ads === true && analytics,
    meta: choice.meta === true && analytics,
    origin: choice.origin === true,
  };
  if (!inBrowser()) return normalized;
  const record: StoredCookieChoice = { v: COOKIE_CONSENT_VERSION, at: new Date().toISOString(), ...normalized };
  memory = record;
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(record));
    memoryWins = false;
  } catch {
    memoryWins = true;
  }
  notify(normalized);
  try {
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: normalized }));
  } catch {
    // Sin CustomEvent (navegador muy antiguo): la decisión ya quedó guardada
  }
  return normalized;
}

/**
 * Escucha las decisiones: las de esta pestaña (setCookieChoice) y las de otras pestañas del
 * mismo origen (evento `storage`). Devuelve la función para dejar de escuchar.
 */
export function subscribe(listener: CookieChoiceListener): () => void {
  if (!inBrowser()) return () => {};
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== COOKIE_CONSENT_STORAGE_KEY) return;
    memoryWins = false; // otra pestaña pudo escribir: lo guardado manda
    listener(getCookieChoice(), 'other-tab');
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Abre el diálogo «Configurar cookies» (botón del pie y de la Política de privacidad). */
export function openCookieSettings(): void {
  if (!inBrowser()) return;
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
}

/**
 * Hosts de prueba del aviso (VITE_COOKIE_BANNER_HOSTS, solo en el entorno Preview de
 * Vercel): el aviso se abre solo y muestra las categorías de Google y de Meta, pero GTM no se
 * carga (analytics exige ANALYTICS_HOSTS o el modo de prueba de VITE_GTM_TEST_HOSTS). Una entrada que empieza con '.' coincide por sufijo
 * ('.vercel.app'); las demás, con el host exacto. Lee el entorno al llamar, no al importar.
 */
export function bannerTestHost(hostname?: string): boolean {
  const host = (hostname ?? (inBrowser() ? window.location.hostname : '')).toLowerCase();
  const raw = import.meta.env.VITE_COOKIE_BANNER_HOSTS as string | undefined;
  if (!host || !raw) return false;
  return raw
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
    .some(h => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

/** Solo para pruebas: olvida la copia en memoria. */
export function __resetForTests(): void {
  memory = undefined;
  memoryWins = false;
}
