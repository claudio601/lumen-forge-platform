// scripts/check-ga-container.ts
// ─────────────────────────────────────────────────────────────────────────────
// Puerta de la Etapa 3 (Etapa 2 · PR 13, design.consentMode, punto 7; PR 14, especificación
// 5.1 y 6.1). Revisa la configuración pública de las etiquetas de Google que comparte la tienda
// antes del cambio de dominio: la de GA4 (G-C06JF3ZNH5, por defecto) y la de Google Ads
// (AW-774649578). El sitio carga el contenedor GTM en modo básico y solo con consentimiento; lo
// que sigue depende de ajustes que hace la agencia en las etiquetas y en GA4.
// GA4 (G-…):
//   1. Detección automática de datos de usuario (__ogt_1p_data_v2): apagada, o con los
//      formularios del sitio excluidos con FORM_EXCLUSION_SELECTORS (los 5 llevan
//      data-elights-form). Si no, Google podría leer el correo y el teléfono de los formularios.
//   2. Page_view por cambios en el historial del navegador (medición mejorada): apagados.
//      RouteTracker (src/App.tsx) ya manda uno por navegación; con los dos se contaría doble.
//   3. Redacción de correo del flujo (__ccd_auto_redact): activa (por /buscar?q=).
//   4. Eventos clave (__ccd_conversion_marking): los de EXPECTED_KEY_EVENTS, con generate_lead,
//      que la agencia marca el día del cambio (especificación 5.1). Hasta entonces la puerta lo
//      da como faltante. Si la agencia marca otro, se anota en el plan y se actualiza la lista.
//   Google Signals (__ogt_google_signals) solo se informa: la etiqueta de Google del contenedor
//   lleva allow_google_signals: false y allow_ad_personalization_signals: false.
// Google Ads (AW-…, sección 6.1-7):
//   1. Detección automática de datos de usuario: la misma regla que en GA4 (apagada, o con los
//      formularios excluidos).
//   2. Detección automática de eventos apagada: ninguna bandera vtp_enable… activa en
//      __ogt_auto_events y ninguna etiqueta __ccd_em_* (formularios, page_view por historial…).
//      Si no, Google Ads recibiría un page_view por cada cambio de ruta del sitio.
// Lo que no se ve en el contenedor (Términos de tratamiento de datos, uso compartido
// «Productos y servicios de Google», retención de 14 meses, eventos que importa Google Ads,
// conversiones mejoradas para clientes potenciales) y la prueba de red sin enviar hits se
// revisan a mano; el informe lo recuerda al final.
//
// Uso (manual; no corre en CI ni en npm test):
//   npm run check:ga-container                          (G-C06JF3ZNH5)
//   npm run check:ga-container -- G-XXXXXXXXXX
//   npm run check:ga-container -- AW-774649578          (etiqueta de Google Ads)
//   npm run check:ga-container -- --file reports/ga/gtag.js      (copia guardada, sin red)
//   npm run check:ga-container -- --key-events purchase,whatsapp_click,qualify_lead
//
// Solo hace un GET de https://www.googletagmanager.com/gtag/js?id=<ID>: no ejecuta el
// script, no abre el sitio y no envía ningún hit.
//
// Formato: Google no documenta el bloque `data` de gtag/js. El lector busca cada bandera por
// nombre en las etiquetas (convierte ["map", …] y ["list", …] en objetos y listas). Si no
// encuentra una bandera, la puerta NO pasa ("revisar a mano"): nunca aprueba por omisión.
//
// Código de salida: 0 puerta aprobada · 1 la puerta no pasa · 2 uso incorrecto, o descarga o
// lectura fallida.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Propiedad GA4 de la tienda (la misma que usará elights.cl desde la Etapa 3). */
export const DEFAULT_GA_ID = 'G-C06JF3ZNH5';

/** Etiqueta de Google de Google Ads de eLIGHTS (la de las 5 conversiones del sitio). */
export const DEFAULT_ADS_ID = 'AW-774649578';

/**
 * Eventos clave después del cambio de dominio: los del contenedor al 2026-10-14 más
 * generate_lead, que la agencia marca el día del cambio (especificación 5.1).
 */
export const EXPECTED_KEY_EVENTS: readonly string[] = ['close_convert_lead', 'generate_lead', 'purchase', 'qualify_lead', 'whatsapp_click'];

/** Exclusión que se pide a la agencia en la detección automática de datos de usuario. */
export const FORM_EXCLUSION_SELECTORS: readonly string[] = [
  '[data-elights-form] input',
  '[data-elights-form] textarea',
  '[data-elights-form]',
];

const GA_ID = /^G-[A-Z0-9]{4,20}$/;
const ADS_ID = /^AW-\d{6,12}$/;

/** El ID es de una etiqueta de Google Ads (AW-…). */
export const isAdsId = (id: string) => ADS_ID.test(id);
const DOWNLOAD_TIMEOUT_MS = 20_000;

export const containerUrl = (id: string) => `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;

/** Una etiqueta del contenedor, con los valores ["map", …] y ["list", …] ya convertidos. */
export interface ContainerTag {
  function: string;
  [key: string]: unknown;
}

// ── Lectura del bloque `data` ────────────────────────────────────────────────

/**
 * Posición del cierre que corresponde a la apertura ('{' o '[') de `open`, o -1. Respeta las
 * cadenas entre comillas dobles (con sus escapes): una llave dentro de un texto no cuenta.
 */
export function matchingClose(text: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '[': ']' };
  if (!pairs[text[open]]) return -1;
  const stack: string[] = [];
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(pairs[ch]);
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Convierte los valores de GTM: ["map", k1, v1, …] → objeto; ["list", …] → lista. */
export function normalizeGtmValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value[0] === 'map') {
      const out: Record<string, unknown> = {};
      for (let i = 1; i + 1 < value.length; i += 2) out[String(value[i])] = normalizeGtmValue(value[i + 1]);
      return out;
    }
    if (value[0] === 'list') return value.slice(1).map(normalizeGtmValue);
    return value.map(normalizeGtmValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeGtmValue(v);
    return out;
  }
  return value;
}

const isTag = (t: unknown): t is ContainerTag =>
  !!t && typeof t === 'object' && !Array.isArray(t) && typeof (t as { function?: unknown }).function === 'string';

/** Las etiquetas del contenedor ("resource" → "tags"). Lanza si no encuentra el bloque. */
export function extractContainerTags(js: string): ContainerTag[] {
  const start = /var\s+data\s*=\s*\{/.exec(js);
  if (!start) throw new Error('no se encontró el bloque «var data = {…}» del contenedor');
  const open = start.index + start[0].length - 1;
  const close = matchingClose(js, open);
  if (close < 0) throw new Error('el bloque «data» del contenedor no cierra');
  const data = js.slice(open, close + 1);
  let tags: unknown;
  try {
    tags = (JSON.parse(data) as { resource?: { tags?: unknown } }).resource?.tags;
  } catch {
    // No es JSON estricto: se lee solo la lista "tags", y si tampoco, etiqueta por etiqueta
    const at = /"tags"\s*:\s*\[/.exec(data);
    if (!at) throw new Error('el contenedor no trae la lista "tags"');
    const listOpen = at.index + at[0].length - 1;
    const listClose = matchingClose(data, listOpen);
    if (listClose < 0) throw new Error('la lista "tags" del contenedor no cierra');
    const list = data.slice(listOpen, listClose + 1);
    try {
      tags = JSON.parse(list);
    } catch {
      const found: unknown[] = [];
      for (let i = 1; i < list.length - 1; i++) {
        if (list[i] === '"') {
          i = skipString(list, i);
          continue;
        }
        if (list[i] !== '{') continue;
        const end = matchingClose(list, i);
        if (end < 0) break;
        try {
          found.push(JSON.parse(list.slice(i, end + 1)));
        } catch {
          /* una etiqueta que no se lee no se cuenta */
        }
        i = end;
      }
      tags = found;
    }
  }
  if (!Array.isArray(tags)) throw new Error('el contenedor no trae la lista "tags"');
  return tags.map(normalizeGtmValue).filter(isTag);
}

/** Índice de la comilla que cierra la cadena que abre en `i`. */
function skipString(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '"') return j;
  }
  return text.length;
}

// ── Banderas ─────────────────────────────────────────────────────────────────

export interface ContainerFlags {
  /** Funciones de todas las etiquetas, en orden (para el informe). */
  tagFunctions: string[];
  userData: {
    /** Hay etiqueta __ogt_1p_data_v2. */
    present: boolean;
    /** true, false o null (no se pudo leer). */
    auto: boolean | null;
    email: boolean | null;
    phone: boolean | null;
    address: boolean | null;
    /** Selectores excluidos de la detección automática. */
    exclusions: string[];
  };
  /** Page_view por cambios en el historial: true, false o null (no se encontró la opción). */
  historyPageViews: boolean | null;
  /** Etiquetas de medición mejorada (informativo). */
  enhancedMeasurement: string[];
  /** Redacción de correo: true solo si todas las etiquetas __ccd_auto_redact la tienen activa. */
  redactEmail: boolean | null;
  /** Valor de Google Signals en el contenedor (informativo). */
  googleSignals: string | null;
  /** Eventos clave, ordenados. */
  keyEvents: string[];
  /**
   * Detección automática de eventos (Google Ads): las banderas vtp_enable… activas de
   * __ogt_auto_events y las etiquetas __ccd_em_*. Vacía si está apagada. null si hay una bandera
   * que no se puede leer.
   */
  autoEvents: string[] | null;
}

const simpleKey = (k: string) => k.toLowerCase().replace(/[^a-z]/g, '');

/** Valores de todas las claves (a cualquier profundidad) que cumplen `test`. */
function deepValues(node: unknown, test: (key: string) => boolean, skip?: (obj: Record<string, unknown>) => boolean): unknown[] {
  const out: unknown[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      const obj = n as Record<string, unknown>;
      if (skip?.(obj)) return;
      for (const [k, v] of Object.entries(obj)) {
        if (test(k)) out.push(v);
        walk(v);
      }
    }
  };
  walk(node);
  return out;
}

/** true si alguno es true; false si todos son false (y hay alguno); null en otro caso. */
function anyTrue(values: unknown[]): boolean | null {
  if (values.some(v => v === true)) return true;
  return values.length > 0 && values.every(v => v === false) ? false : null;
}

/** true solo si todos son true (y hay alguno); false si alguno es false; null en otro caso. */
function allTrue(values: unknown[]): boolean | null {
  if (values.length > 0 && values.every(v => v === true)) return true;
  return values.some(v => v === false) ? false : null;
}

const splitSelectors = (values: unknown[]) =>
  values
    .filter((v): v is string => typeof v === 'string')
    .flatMap(v => v.split(','))
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

/** Nombres de evento de una regla de __ccd_conversion_marking (matchingRules en JSON). */
export function ruleEventNames(rule: unknown): string[] {
  let parsed: unknown = rule;
  if (typeof rule === 'string') {
    try {
      parsed = JSON.parse(rule);
    } catch {
      return [...rule.matchAll(/"stringValue"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
    }
  }
  const names: string[] = [];
  const all: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      const obj = n as Record<string, unknown>;
      if (typeof obj.stringValue === 'string') all.push(obj.stringValue);
      if (Array.isArray(obj.args)) {
        const byEventName = obj.args.some(a => {
          const parts = (a as { contextValue?: { keyParts?: unknown } })?.contextValue?.keyParts;
          return Array.isArray(parts) && parts.includes('eventName');
        });
        if (byEventName) {
          for (const a of obj.args) {
            const s = (a as { stringValue?: unknown })?.stringValue;
            if (typeof s === 'string') names.push(s);
          }
        }
      }
      Object.values(obj).forEach(walk);
    }
  };
  walk(parsed);
  return names.length ? names : all;
}

export function readContainerFlags(tags: readonly ContainerTag[]): ContainerFlags {
  const byFn = (name: string) => tags.filter(t => t.function === name);

  const userDataTags = byFn('__ogt_1p_data_v2');
  const pick = (key: string) => anyTrue(userDataTags.map(t => t[key]));
  const userData: ContainerFlags['userData'] = userDataTags.length
    ? {
        present: true,
        auto: pick('vtp_isAutoEnabled'),
        email: pick('vtp_autoEmailEnabled'),
        phone: pick('vtp_autoPhoneEnabled'),
        address: pick('vtp_autoAddressEnabled'),
        exclusions: [...new Set(splitSelectors(deepValues(userDataTags, k => simpleKey(k).includes('exclusion'))))],
      }
    : { present: false, auto: false, email: false, phone: false, address: false, exclusions: [] };

  // Page_view por historial: la opción se llama distinto según la versión del contenedor
  // (vtp_historyEvents en __ccd_em_page_view, history_events en la lista de medición
  // mejorada de __gct). Una entrada page_view desactivada no cuenta: sin vistas de página
  // automáticas tampoco hay las del historial.
  let pageViewOff = false;
  const historyValues = deepValues(
    tags,
    k => simpleKey(k).includes('history'),
    o => {
      const off = o.name === 'page_view' && o.enabled === false;
      if (off) pageViewOff = true;
      return off;
    },
  );
  const historyPageViews = anyTrue(historyValues) ?? (pageViewOff ? false : null);

  const enhancedMeasurement = [
    ...tags.map(t => t.function).filter(f => f.startsWith('__ccd_em_') || f === '__ogt_auto_events'),
    ...deepValues(byFn('__gct'), k => simpleKey(k) === 'vtpenhancedmeasurement')
      .flatMap(v => (Array.isArray(v) ? v : []))
      .filter(e => (e as { enabled?: unknown })?.enabled === true)
      .map(e => String((e as { name?: unknown }).name)),
  ];

  const redactTags = byFn('__ccd_auto_redact');
  const redactEmail = redactTags.length ? allTrue(redactTags.map(t => t.vtp_redactEmail)) : false;

  const signals = byFn('__ogt_google_signals')
    .map(t => t.vtp_googleSignals)
    .filter((v): v is string => typeof v === 'string');

  const keyEvents = [
    ...new Set(
      byFn('__ccd_conversion_marking').flatMap(t =>
        deepValues(t, k => k === 'matchingRules').flatMap(ruleEventNames),
      ),
    ),
  ].sort();

  let autoEvents: string[] | null = [];
  for (const t of byFn('__ogt_auto_events')) {
    for (const [k, v] of Object.entries(t)) {
      if (!/^vtp_enable/.test(k) || k === 'vtp_enableInPageEventsHidden') continue;
      if (v === true) autoEvents?.push(k.replace(/^vtp_enable/, ''));
      else if (v !== false) autoEvents = null;
    }
  }
  if (autoEvents) autoEvents.push(...tags.map(t => t.function).filter(f => f.startsWith('__ccd_em_')));

  return {
    tagFunctions: tags.map(t => t.function),
    userData,
    historyPageViews,
    enhancedMeasurement: [...new Set(enhancedMeasurement)],
    redactEmail,
    googleSignals: signals.length ? [...new Set(signals)].join(', ') : null,
    keyEvents,
    autoEvents: autoEvents && [...new Set(autoEvents)],
  };
}

// ── Puerta ───────────────────────────────────────────────────────────────────

export interface GateVerdict {
  approved: boolean;
  /** Por qué no pasa (vacío si pasa). */
  failures: string[];
  /** Lo que solo se informa. */
  notes: string[];
}

const normSelector = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** La exclusión cubre los formularios del sitio (los tres selectores de FORM_EXCLUSION_SELECTORS). */
export function excludesSiteForms(exclusions: readonly string[]): boolean {
  const have = new Set(exclusions.map(normSelector));
  return FORM_EXCLUSION_SELECTORS.every(s => have.has(normSelector(s)));
}

const yesNo = (v: boolean | null) => (v === null ? '¿?' : v ? 'sí' : 'no');

/** Detección automática de datos de usuario: apagada o con los formularios del sitio excluidos. */
function userDataFailures(flags: ContainerFlags): string[] {
  const failures: string[] = [];
  const recommended = FORM_EXCLUSION_SELECTORS.join(', ');
  const ud = flags.userData;
  const autoOn = ud.auto !== false && [ud.email, ud.phone, ud.address].some(v => v !== false);
  if (ud.present && autoOn && !excludesSiteForms(ud.exclusions)) {
    if (ud.auto === null || [ud.email, ud.phone, ud.address].includes(null)) {
      failures.push('No se pudo leer si la detección automática de datos de usuario está activa: revisar a mano en la etiqueta de Google.');
    } else {
      failures.push(
        `La detección automática de datos de usuario está activa (correo: ${yesNo(ud.email)}, teléfono: ${yesNo(ud.phone)}, ` +
          `dirección: ${yesNo(ud.address)}) sin excluir los formularios del sitio` +
          (ud.exclusions.length ? ` (excluye hoy: ${ud.exclusions.join(', ')})` : '') +
          `. En la etiqueta de Google: excluir «${recommended}», o apagar la detección.`,
      );
    }
  }
  return failures;
}

export function gateVerdict(flags: ContainerFlags, expectedKeyEvents: readonly string[] = EXPECTED_KEY_EVENTS): GateVerdict {
  const failures: string[] = userDataFailures(flags);
  const notes: string[] = [];

  if (flags.historyPageViews === true) {
    failures.push(
      'Siguen activos los page_view por cambios en el historial del navegador (medición mejorada). Apagarlos en el flujo web de GA4: RouteTracker ya manda uno por navegación.',
    );
  } else if (flags.historyPageViews === null) {
    failures.push('No se encontró la opción de page_view por historial del navegador: revisar a mano en GA4 (flujo web → medición mejorada → vistas de página).');
  }

  if (flags.redactEmail !== true) {
    failures.push(
      flags.redactEmail === null
        ? 'No se pudo leer la redacción de correo del flujo: revisar a mano en GA4 (flujo web → redacción de datos).'
        : 'La redacción de correo del flujo está apagada (o no aparece). Activarla en GA4 (flujo web → redacción de datos).',
    );
  }

  const want = [...new Set(expectedKeyEvents)].sort();
  const extra = flags.keyEvents.filter(e => !want.includes(e));
  const missing = want.filter(e => !flags.keyEvents.includes(e));
  if (extra.length || missing.length) {
    failures.push(
      `Los eventos clave cambiaron (sobran: ${extra.join(', ') || 'ninguno'}; faltan: ${missing.join(', ') || 'ninguno'}). ` +
        'Si el cambio es intencional, anotarlo en el plan y actualizar EXPECTED_KEY_EVENTS (o usar --key-events).',
    );
  }

  notes.push(
    `Google Signals en el contenedor: ${flags.googleSignals ?? 'no aparece'} (la etiqueta de Google del contenedor GTM lleva allow_google_signals: false y allow_ad_personalization_signals: false).`,
  );
  return { approved: failures.length === 0, failures, notes };
}

/**
 * Puerta de la etiqueta de Google Ads (AW-…): detección automática de datos de usuario apagada
 * o con los formularios excluidos, y detección automática de eventos apagada (6.1-7).
 */
export function adsGateVerdict(flags: ContainerFlags): GateVerdict {
  const failures = userDataFailures(flags);
  if (flags.autoEvents === null) {
    failures.push('No se pudo leer la detección automática de eventos: revisar a mano en la etiqueta de Google de Ads.');
  } else if (flags.autoEvents.length) {
    failures.push(
      `La detección automática de eventos sigue activa (${flags.autoEvents.join(', ')}). Apagarla en la etiqueta de Google de Ads ` +
        'antes de la fase A2 (adelanto D8, sección 6.1-7): si no, Google Ads recibiría un page_view por cada cambio de ruta y los envíos de formularios.',
    );
  }
  return { approved: failures.length === 0, failures, notes: [] };
}

/** Lo que la puerta pide y el contenedor no muestra (se revisa a mano). */
export const MANUAL_CHECKS: readonly string[] = [
  'GA4: Términos de tratamiento de datos aceptados y uso compartido «Productos y servicios de Google» apagado.',
  'GA4: retención de datos en 14 meses, de eventos y de usuarios, con «Restablecer los datos de usuario con cada actividad nueva» activado (lo que dice la Política de privacidad §7, versión 1.5).',
  'Google Ads: qué eventos se importan como conversiones (anotarlo en el plan).',
  'Prueba de red con el contenedor real sin enviar hits (design.consentMode, punto 8).',
];

/** Lo que la puerta de Google Ads pide y la etiqueta no muestra. */
export const MANUAL_CHECKS_ADS: readonly string[] = [
  'Google Ads: conversiones mejoradas para clientes potenciales apagadas, y ninguna acción de conversión creada automáticamente.',
  'Google Ads: las etiquetas AW-774649578 y G-C06JF3ZNH5 siguen separadas (sin combinar ni como destinos una de otra).',
];

export function formatReport(id: string, flags: ContainerFlags, verdict: GateVerdict): string[] {
  const ud = flags.userData;
  if (isAdsId(id)) {
    return [
      `[check-ga-container] ${id}: ${flags.tagFunctions.length} etiquetas`,
      `  Detección automática de datos de usuario: ${
        ud.present
          ? `${yesNo(ud.auto)} (correo: ${yesNo(ud.email)}, teléfono: ${yesNo(ud.phone)}, dirección: ${yesNo(ud.address)}); excluye: ${ud.exclusions.join(', ') || 'nada'}`
          : 'no hay etiqueta'
      }`,
      `  Detección automática de eventos: ${flags.autoEvents === null ? '¿?' : flags.autoEvents.join(', ') || 'apagada'}`,
      ...verdict.failures.map(f => `::error title=Puerta de la Etapa 3::${f}`),
      verdict.approved ? '[check-ga-container] La etiqueta de Google Ads pasa la puerta.' : `[check-ga-container] La puerta no pasa: ${verdict.failures.length} punto(s).`,
      'Falta revisar a mano (no se ve en la etiqueta):',
      ...MANUAL_CHECKS_ADS.map(c => `  - ${c}`),
    ];
  }
  const lines = [
    `[check-ga-container] ${id}: ${flags.tagFunctions.length} etiquetas`,
    `  Detección automática de datos de usuario: ${
      ud.present
        ? `${yesNo(ud.auto)} (correo: ${yesNo(ud.email)}, teléfono: ${yesNo(ud.phone)}, dirección: ${yesNo(ud.address)}); excluye: ${ud.exclusions.join(', ') || 'nada'}`
        : 'no hay etiqueta'
    }`,
    `  Page_view por historial del navegador: ${yesNo(flags.historyPageViews)}`,
    `  Medición mejorada: ${flags.enhancedMeasurement.join(', ') || 'nada'}`,
    `  Redacción de correo: ${yesNo(flags.redactEmail)}`,
    `  Google Signals: ${flags.googleSignals ?? 'no aparece'}`,
    `  Eventos clave: ${flags.keyEvents.join(', ') || 'ninguno'}`,
    ...verdict.notes.map(n => `  Nota: ${n}`),
    ...verdict.failures.map(f => `::error title=Puerta de la Etapa 3::${f}`),
    verdict.approved ? '[check-ga-container] La etiqueta de Google pasa la puerta.' : `[check-ga-container] La puerta no pasa: ${verdict.failures.length} punto(s).`,
    'Falta revisar a mano (no se ve en el contenedor):',
    ...MANUAL_CHECKS.map(c => `  - ${c}`),
  ];
  return lines;
}

// ── Descarga y línea de comandos ─────────────────────────────────────────────

type FetchLike = (url: string, init: { method: 'GET'; redirect: 'follow'; signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Descarga el script del contenedor. Solo GET; no lo ejecuta. */
export async function downloadContainer(id: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  const res = await fetchImpl(containerUrl(id), {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { accept: 'application/javascript, text/javascript, */*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export interface CliArgs {
  id: string;
  file?: string;
  keyEvents: readonly string[];
}

/** Lee los argumentos. Lanza con un mensaje en español si son incorrectos. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { id: DEFAULT_GA_ID, keyEvents: EXPECTED_KEY_EVENTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (!v) throw new Error(`falta el valor de ${flag}`);
      return v;
    };
    if (flag === '--file') args.file = value();
    else if (flag === '--key-events') {
      args.keyEvents = value()
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else if (GA_ID.test(a) || ADS_ID.test(a)) args.id = a;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  return args;
}

async function main(argv: readonly string[]) {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`[check-ga-container] ${(err as Error).message}`);
    console.error('Uso: npm run check:ga-container [-- G-XXXXXXXXXX | AW-XXXXXXXXX] [--file copia.js] [--key-events a,b,c]');
    process.exit(2);
  }
  let js: string;
  try {
    js = args.file ? readFileSync(args.file, 'utf8') : await downloadContainer(args.id);
  } catch (err) {
    console.error(`[check-ga-container] No se pudo ${args.file ? 'leer' : 'descargar'} el contenedor: ${(err as Error).message}`);
    process.exit(2);
  }
  let tags: ContainerTag[];
  try {
    tags = extractContainerTags(js);
  } catch (err) {
    console.error(`[check-ga-container] No se pudo leer el contenedor: ${(err as Error).message}`);
    process.exit(2);
  }
  const flags = readContainerFlags(tags);
  const verdict = isAdsId(args.id) ? adsGateVerdict(flags) : gateVerdict(flags, args.keyEvents);
  for (const line of formatReport(args.id, flags, verdict)) console.log(line);
  process.exit(verdict.approved ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main(process.argv.slice(2));
