// api/_lib/forms/attribution.ts
// ─────────────────────────────────────────────────────────────────────────────
// Origen de la visita (Etapa 2 · PR 10): de dónde llegó quien envió un formulario
// (anuncio de Google, Meta, campaña con etiquetas UTM, otro sitio o directo).
//
// Reglas que comparten el navegador (src/lib/attribution.ts lo guarda en sessionStorage)
// y los cinco endpoints de formularios (la sección "ORIGEN DE LA VISITA" de la nota de
// Pipedrive y del correo a ventas). Sin imports: lo usan el navegador y la función. La
// carpeta _lib hace que Vercel no lo despliegue como función.
//
// Privacidad: solo las claves de ATTRIBUTION_PARAMS más la página de entrada (solo la
// ruta: otros parámetros de la URL pueden traer datos personales) y el sitio anterior
// (solo su origen, https://host, sin ruta ni parámetros). Cada valor se limpia (sin
// caracteres de control ni invisibles ni mitades sueltas de un emoji, sin
// < > " ' ` \ &) y se corta a MAX_ATTRIBUTION_VALUE caracteres sin partir un emoji.
//
// Lo manda el navegador y se puede falsificar: es informativo. Nunca cambia montos,
// referencias ni la deduplicación, y un valor raro se descarta en vez de rechazar el
// formulario (parseAttribution nunca lanza ni da 400). Los valores nunca van al log.
// ─────────────────────────────────────────────────────────────────────────────

/** Parámetros de la URL que se guardan: ids de clic de anuncios y etiquetas UTM. */
export const ATTRIBUTION_PARAMS = [
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;
export type AttributionParam = (typeof ATTRIBUTION_PARAMS)[number];

/** Origen de la visita: solo las claves presentes, cada una un texto limpio. */
export type Attribution = Partial<Record<AttributionParam | 'landing' | 'referrer', string>>;

export const MAX_ATTRIBUTION_VALUE = 200;
/** Largo máximo del sitio anterior antes de reducirlo a su origen. */
const MAX_REFERRER_INPUT = 2048;

/** Ids de clic: Google Ads (gclid; gbraid y wbraid en iOS) y Meta (fbclid). */
const GOOGLE_ADS_IDS = ['gclid', 'gbraid', 'wbraid'] as const;
const CLICK_IDS = [...GOOGLE_ADS_IDS, 'fbclid'] as const;
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** Buscadores: su visita sin etiquetas es búsqueda orgánica. */
const SEARCH_ENGINE_HOST = /(?:^|\.)(?:google|bing|yahoo|duckduckgo|ecosia|brave)(?:\.[a-z]{2,3}){1,2}$/;

// Caracteres de control (C0/C1, incluye CR, LF y tab), de formato (ancho cero, marcas y
// overrides bidi, BOM), separadores de línea y párrafo, y sustitutos UTF-16 sueltos (Cs:
// media pareja de un emoji; un emoji completo es un solo carácter y no cuenta): cada uno
// pasa a ser un espacio. Un sustituto suelto no es UTF-8 válido y un lector JSON estricto
// puede rechazar la nota o el correo completos.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;
// Sin < ni > no se pueden formar etiquetas, y sin & no hay referencias de carácter
// (&#10;, &quot;) que, al leer como HTML las notas que van sin escapar, vuelvan a ser un
// salto de línea o comillas: un valor siempre queda en su línea.
const MARKUP = /[<>"'`\\&]/g;

export const ORIGEN_HEADING = '--- ORIGEN DE LA VISITA ---';

/** Texto de una línea, sin marcas, de hasta MAX_ATTRIBUTION_VALUE caracteres ('' si no es texto). */
export function cleanAttributionValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(INVISIBLE, ' ')
    .replace(MARKUP, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ATTRIBUTION_VALUE)
    // El corte cuenta unidades UTF-16: si parte un emoji, se quita la mitad que queda.
    .replace(/\p{Cs}$/u, '')
    .trimEnd();
}

/** elights.cl o cualquier *.elights.cl: una visita desde ahí es navegación interna. */
export function isSiteHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'elights.cl' || h.endsWith('.elights.cl');
}

/** Página de entrada: solo la ruta, sin parámetros ni #; '' si no empieza con una sola /. */
function cleanLanding(value: unknown): string {
  if (typeof value !== 'string') return '';
  const path = cleanAttributionValue(value.split(/[?#]/, 1)[0]);
  return /^\/(?!\/)/.test(path) ? path : '';
}

/** Sitio anterior: solo el origen (https://host) de una URL http(s) que no sea del sitio. */
function cleanReferrer(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_REFERRER_INPUT) return '';
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (isSiteHost(url.hostname)) return '';
  return cleanAttributionValue(url.origin);
}

/**
 * Lee el origen que mandó el navegador (o el guardado en la sesión): solo las claves de la
 * lista, limpias; las vacías se descartan. null si no es un objeto o no queda nada. Nunca
 * lanza: un origen raro o falsificado se descarta, no rechaza el formulario.
 */
export function parseAttribution(raw: unknown): Attribution | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    // Solo claves propias: nada heredado del prototipo
    const input = raw as Record<string, unknown>;
    const own = (key: string) => (Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined);
    const out: Attribution = {};
    for (const key of ATTRIBUTION_PARAMS) {
      const value = cleanAttributionValue(own(key));
      if (value) out[key] = value;
    }
    const landing = cleanLanding(own('landing'));
    if (landing) out.landing = landing;
    const referrer = cleanReferrer(own('referrer'));
    if (referrer) out.referrer = referrer;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Host del sitio anterior (ya reducido a su origen). */
function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/** Línea "Canal:" según lo más fuerte que trae el origen. */
function channelOf(a: Attribution | null): string {
  if (!a) return 'Sin datos (el formulario no envió el origen)';
  if (GOOGLE_ADS_IDS.some((key) => a[key])) return 'Google Ads (clic en anuncio)';
  if (a.fbclid) return 'Meta: Facebook / Instagram (fbclid)';
  if (a.utm_source) return 'Campaña con etiquetas UTM';
  // Etiquetas UTM sin utm_source (un error común al etiquetar correos): sigue siendo una
  // campaña, nunca "Directo" con líneas UTM debajo.
  if (UTM_PARAMS.some((key) => a[key])) return 'Campaña con etiquetas UTM (sin utm_source)';
  if (a.referrer) {
    const host = hostOf(a.referrer);
    return SEARCH_ENGINE_HOST.test(host) ? `Búsqueda orgánica (${host})` : `Otro sitio (${host})`;
  }
  return 'Directo (sin campaña ni sitio anterior)';
}

/**
 * Líneas de la sección "ORIGEN DE LA VISITA" para la nota de Pipedrive y el correo: título,
 * canal, ids de clic, etiquetas UTM, página de entrada y sitio anterior (solo los
 * presentes). Nunca vacía: sin origen dice "Sin datos". Quien llama pone una línea en
 * blanco antes.
 */
export function formatOrigenSection(a: Attribution | null): string[] {
  const lines = [ORIGEN_HEADING, `Canal: ${channelOf(a)}`];
  if (!a) return lines;
  for (const key of [...CLICK_IDS, ...UTM_PARAMS]) {
    if (a[key]) lines.push(`${key}: ${a[key]}`);
  }
  if (a.landing) lines.push(`Página de entrada: ${a.landing}`);
  if (a.referrer) lines.push(`Sitio anterior: ${a.referrer}`);
  return lines;
}

/** Sección de origen a partir del cuerpo del formulario (clave `attribution`). */
export function origenFromBody(body: unknown): string[] {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).attribution : undefined;
  return formatOrigenSection(parseAttribution(raw));
}
