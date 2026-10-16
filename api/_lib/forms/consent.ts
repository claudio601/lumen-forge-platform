// api/_lib/forms/consent.ts
// ─────────────────────────────────────────────────────────────────────────────
// Privacidad y autorizaciones (Etapa 2 · PR 13): las casillas de los cinco formularios del
// sitio y la constancia que queda en la nota de Pipedrive y en el correo a ventas@.
//
// Una sola fuente para el navegador, las funciones y los scripts (mismo patrón que
// attribution.ts y projectQuote.ts): la versión de los textos legales (src/config/site.ts
// la reexporta), los textos de las casillas, los mensajes de error, la lectura de lo que
// manda el navegador y el bloque "--- PRIVACIDAD Y AUTORIZACIONES ---". Sin imports. La
// carpeta _lib hace que Vercel no lo despliegue como función.
//
// Reglas
// - El servidor exige la casilla obligatoria en todo envío del sitio: 400 con code
//   'consent_required' antes de tocar el correo o Pipedrive. Única tolerancia: durante
//   CONSENT_GRACE_DAYS días desde CONSENT_SINCE_DATE (la fecha de la versión que estrenó las
//   casillas, que no se mueve con las versiones siguientes), un cuerpo SIN la clave consent
//   (pestaña abierta antes del deploy) se acepta y queda registrado como 'web-legacy'. Un
//   cuerpo CON la clave pero sin la casilla marcada se rechaza siempre.
// - La hora del registro es la del RELOJ DEL SERVIDOR: quien llama hace un solo new Date()
//   por solicitud y lo pasa como `at`. Lo que mande el navegador en `at` o `fecha` no cuenta.
// - El bloque termina en una línea "consent_json: {…}" con claves fijas, en orden fijo y sin
//   datos personales. Vale la ÚLTIMA línea que empieza con "consent_json:": los textos
//   libres (comentarios, descripción) van siempre ANTES del bloque.
// - parseConsent y resolveConsent nunca lanzan. Nada de este módulo va al log.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Versión de los textos legales (términos, cambios y garantía, privacidad) y desde cuándo
 * rigen. Texto fijo, nunca new Date() ni Intl: el servidor y el navegador dibujan lo mismo.
 * Al cambiar un texto legal: sube LEGAL_VERSION, pon la fecha nueva en LEGAL_UPDATED y
 * LEGAL_UPDATED_LABEL, agrega la versión anterior a LEGAL_ARCHIVE y corre
 * `npm run legal:archive` (escribe public/legal/<página>-v<versión>.html).
 * LEGAL_UPDATED no mueve el margen de CONSENT_GRACE_DAYS días: se cuenta desde
 * CONSENT_SINCE_DATE (consentGraceUntil), que no cambia al subir la versión.
 */
export const LEGAL_VERSION: string = '1.3';
export const LEGAL_UPDATED: string = '2026-10-16';
export const LEGAL_UPDATED_LABEL: string = '16 de octubre de 2026';

/** Versiones anteriores, ya publicadas en public/legal/<página>-v<versión>.html. */
export const LEGAL_ARCHIVE: readonly string[] = ['1.0', '1.1', '1.2'];

/** Páginas con versión y archivo permanente (LegalLayout con `updated`). */
export const LEGAL_VERSIONED_PATHS = [
  '/terminos-y-condiciones',
  '/politica-de-privacidad',
  '/cambios-devoluciones-y-garantia',
] as const;
export type LegalVersionedPath = (typeof LEGAL_VERSIONED_PATHS)[number];

/**
 * URL del archivo permanente de una página legal en una versión (por defecto, la vigente):
 * legalArchiveHref('/terminos-y-condiciones', '1.0') → '/legal/terminos-y-condiciones-v1.0.html'.
 * Es un archivo estático de public/ (un <a href>, no una ruta de la app).
 */
export function legalArchiveHref(pagePath: LegalVersionedPath, version: string = LEGAL_VERSION): string {
  return `/legal${pagePath}-v${version}.html`;
}

/** Versión de los textos legales que estrenó las casillas (la constancia «web-legacy» la nombra). */
export const CONSENT_SINCE_VERSION = '1.2';

/**
 * Fecha (AAAA-MM-DD) desde la que rige CONSENT_SINCE_VERSION: la de la fusión de la PR 13.
 * Mientras esa sea la versión vigente, es igual a LEGAL_UPDATED (consent.test.ts lo exige;
 * al fijar la fecha real de la fusión se cambian las dos); con una versión posterior,
 * LEGAL_UPDATED es igual o posterior (dos versiones pueden salir el mismo día), y
 * consent.test.ts la fija a la fecha del archivo permanente de CONSENT_SINCE_VERSION. Fija
 * el margen de CONSENT_GRACE_DAYS días y NO se cambia al subir LEGAL_VERSION: una versión
 * nueva no vuelve a abrir el margen para cuerpos sin la clave consent.
 */
export const CONSENT_SINCE_DATE: string = '2026-10-16';

export const CONSENT_HEADING = '--- PRIVACIDAD Y AUTORIZACIONES ---';
export const CONSENT_ERROR_CODE = 'consent_required';
/** Prefijo de la última línea del bloque. Vale la ÚLTIMA línea que empieza así. */
export const CONSENT_JSON_PREFIX = 'consent_json:';
/** Días (contados desde CONSENT_SINCE_DATE) en que se acepta un cuerpo sin la clave consent. */
export const CONSENT_GRACE_DAYS = 7;

/** Los cinco formularios del sitio (valor de "form" en consent_json). */
export const CONSENT_FORMS = ['solicitar-pedido', 'cotizacion', 'cotizador', 'instalacion', 'estudio-luminico'] as const;
export type ConsentForm = (typeof CONSENT_FORMS)[number];

/** 'pedido': /solicitar-pedido (con términos y condiciones). 'solicitud': los otros cuatro. */
export type ConsentKind = 'pedido' | 'solicitud';

/** Origen de la constancia: casillas del formulario o cuerpo sin la clave dentro del margen. */
export type ConsentSource = 'web' | 'web-legacy';

/** Lo que manda el navegador en `consent` (useConsentFields().payload()). */
export interface ConsentInput {
  privacy: boolean;
  /** Solo en /solicitar-pedido. */
  terms?: boolean;
  marketing: boolean;
  /** LEGAL_VERSION que tenía el navegador. */
  version: string;
}

/** Nombres (atributo name) de las dos casillas. */
export const CONSENT_FIELD_NAMES = { privacy: 'consentPrivacy', marketing: 'consentMarketing' } as const;

/** Leyenda del grupo de casillas (solo lectores de pantalla). */
export const CONSENT_LEGEND = 'Privacidad y novedades';

/**
 * Enlaces dentro de los textos de las casillas: el marcador {privacidad} o {terminos} se
 * dibuja como un enlace (en otra pestaña) a la página, con su nombre de LEGAL_PAGES
 * (src/config/legal.ts; una prueba verifica que coincidan).
 */
export const CONSENT_TEXT_LINKS = {
  privacidad: { path: '/politica-de-privacidad', label: 'Política de privacidad' },
  terminos: { path: '/terminos-y-condiciones', label: 'Términos y condiciones' },
} as const;
export type ConsentLinkKey = keyof typeof CONSENT_TEXT_LINKS;

/**
 * Textos de las casillas (versión LEGAL_VERSION). Cambiar uno es cambiar lo que la persona
 * acepta: sube LEGAL_VERSION (consent.test.ts lo exige). El asterisco de la obligatoria lo
 * agrega el formulario, aparte y con aria-hidden.
 */
export const CONSENT_TEXTS = Object.freeze({
  /** Obligatoria en /cotizacion, /cotizador, /instalacion y /estudio-luminico. */
  privacy: 'Leí la {privacidad} y autorizo a eLIGHTS a usar mis datos para responder esta solicitud.',
  /** Obligatoria en /solicitar-pedido. */
  privacyWithTerms:
    'Acepto los {terminos}, leí la {privacidad} y autorizo a eLIGHTS a usar mis datos para responder esta solicitud.',
  /** Opcional, sin marcar, en los cinco formularios. */
  marketing: 'Quiero recibir novedades y ofertas de eLIGHTS por correo (opcional). Puedo darme de baja cuando quiera.',
  /** Nota bajo la obligatoria, solo en /instalacion (texto aprobado por el dueño, sin cambios). */
  installationNote:
    'Usamos estos datos para responder y dar seguimiento a tu solicitud. Quedan registrados en los servicios con que trabajamos: Vercel (sitio web), Google (correo) y Pipedrive (gestión de clientes).',
});

/** Mensaje junto a la casilla obligatoria cuando falta (también con un 400 'consent_required'). */
export const CONSENT_ERRORS: Readonly<Record<ConsentKind, string>> = Object.freeze({
  solicitud: 'Para enviar la solicitud, marca la casilla de la Política de privacidad.',
  pedido: 'Para enviar la solicitud, marca la casilla de los Términos y condiciones y la Política de privacidad.',
});

/** Casilla de /instalacion antes de la versión CONSENT_SINCE_VERSION (la nombra la constancia «web-legacy»). */
export const LEGACY_INSTALLATION_CHECKBOX =
  'Acepto que eLIGHTS me contacte por teléfono, WhatsApp o correo para responder esta solicitud.';

export type ConsentTextPart = string | { link: ConsentLinkKey; path: string; label: string };

/** Separa un texto de casilla en trozos de texto y enlaces ({privacidad}, {terminos}). */
export function consentTextParts(text: string): ConsentTextPart[] {
  return text
    .split(/(\{(?:privacidad|terminos)\})/)
    .filter(part => part !== '')
    .map(part => {
      const key = part.slice(1, -1);
      if (part.startsWith('{') && (key === 'privacidad' || key === 'terminos')) {
        return { link: key, ...CONSENT_TEXT_LINKS[key] };
      }
      return part;
    });
}

/** El texto de una casilla tal como se lee (los marcadores pasan a ser el nombre de la página). */
export function consentTextPlain(text: string): string {
  return consentTextParts(text)
    .map(part => (typeof part === 'string' ? part : part.label))
    .join('');
}

// ── Lectura de lo que manda el navegador ─────────────────────────────────────

/** Lo que el servidor acepta como casillas válidas. */
export interface ParsedConsent {
  privacy: true;
  /** true en /solicitar-pedido (requireTerms, verificado); false donde no se piden los términos. */
  terms: boolean;
  marketing: boolean;
  /** Versión de los textos que tenía el navegador; null si no viene o no tiene la forma X.Y. */
  clientVersion: string | null;
}

export type ParseConsentResult =
  | { ok: true; consent: ParsedConsent }
  | { ok: false; absent: boolean; errors: string[] };

const VERSION_RE = /^\d{1,2}\.\d{1,2}$/;

function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Valor de una propiedad PROPIA de datos: nunca un getter ni algo heredado (__proto__). */
function ownValue(obj: object, key: string): unknown {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  return desc && 'value' in desc ? desc.value : undefined;
}

/**
 * Lee `consent` del cuerpo. privacy debe ser exactamente true (no 'true' ni 1); con
 * requireTerms, terms también. marketing: true = sí; ausente = no; otro valor = error.
 * Una versión con forma rara queda como desconocida (null) y nunca rechaza. absent es true
 * solo si la clave no viene (undefined). Nunca lanza. Errores en inglés, como los demás.
 */
export function parseConsent(raw: unknown, opts: { requireTerms: boolean }): ParseConsentResult {
  if (raw === undefined) return { ok: false, absent: true, errors: ['consent is required'] };
  try {
    if (!isPlainObject(raw)) return { ok: false, absent: false, errors: ['consent must be an object'] };
    const privacy = ownValue(raw, 'privacy');
    const terms = ownValue(raw, 'terms');
    const marketing = ownValue(raw, 'marketing');
    const version = ownValue(raw, 'version');
    const errors: string[] = [];
    if (privacy !== true) errors.push('consent.privacy must be true');
    if (opts.requireTerms && terms !== true) errors.push('consent.terms must be true');
    if (marketing !== undefined && typeof marketing !== 'boolean') errors.push('consent.marketing must be a boolean');
    if (errors.length) return { ok: false, absent: false, errors };
    return {
      ok: true,
      consent: {
        privacy: true,
        terms: opts.requireTerms,
        marketing: marketing === true,
        clientVersion: typeof version === 'string' && VERSION_RE.test(version) ? version : null,
      },
    };
  } catch {
    return { ok: false, absent: false, errors: ['consent must be an object'] };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fin del margen para cuerpos sin la clave consent: las 00:00 (hora de Chile, UTC-3 en
 * primavera y verano) del 8.º día después de CONSENT_SINCE_DATE, es decir, hasta el fin del
 * CONSENT_GRACE_DAYS-ésimo día después de la fecha de la versión que estrenó las casillas.
 * Nunca se cuenta desde LEGAL_UPDATED: subir la versión no reabre el margen.
 */
export function consentGraceUntil(): Date {
  return new Date(Date.parse(`${CONSENT_SINCE_DATE}T00:00:00-03:00`) + (CONSENT_GRACE_DAYS + 1) * DAY_MS);
}

export type ResolveConsentResult =
  | { ok: true; src: ConsentSource; section: string[] }
  | { ok: false; errors: string[] };

/**
 * Lo que hace cada endpoint después del honeypot: lee body.consent y devuelve el bloque para
 * la nota y el correo, o los errores (→ 400 con code CONSENT_ERROR_CODE).
 * - Casillas válidas → bloque 'web'.
 * - Sin la clave consent y `at` antes de consentGraceUntil() → bloque 'web-legacy' (en
 *   /instalacion, si body.aceptaContacto === true, nombra la casilla anterior).
 * - Cualquier otro caso → errores.
 * `at` es el new Date() del servidor, uno por solicitud. Nunca lanza.
 */
export function resolveConsent(
  body: unknown,
  opts: { form: ConsentForm; requireTerms: boolean; at: Date }
): ResolveConsentResult {
  let raw: unknown;
  let aceptaContacto = false;
  try {
    if (isPlainObject(body)) {
      raw = ownValue(body, 'consent');
      aceptaContacto = ownValue(body, 'aceptaContacto') === true;
    }
  } catch {
    return { ok: false, errors: ['consent must be an object'] };
  }
  const parsed = parseConsent(raw, { requireTerms: opts.requireTerms });
  // `=== false`: con strictNullChecks apagado, `if (parsed.ok)` no estrecha la otra rama.
  if (parsed.ok === false) {
    if (parsed.absent && opts.at.getTime() < consentGraceUntil().getTime()) {
      return {
        ok: true,
        src: 'web-legacy',
        section: formatLegacyConsentSection({ at: opts.at, form: opts.form, aceptaContacto }),
      };
    }
    return { ok: false, errors: parsed.errors };
  }
  return {
    ok: true,
    src: 'web',
    section: formatConsentSection({ consent: parsed.consent, at: opts.at, form: opts.form }),
  };
}

// ── Bloque de la nota y el correo ────────────────────────────────────────────

/**
 * Fecha y hora de Chile, 'AAAA-MM-DD HH:MM:SS' (24 h). Solo en el servidor: usa Intl, que
 * nunca debe correr durante un render. Distinto de chileDateTime de project-quotes (la
 * «Fecha» legible de esa nota).
 */
export function formatChileTime(at: Date): string {
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** Instante UTC al segundo: '2026-11-20T14:03:12Z'. */
function utcSeconds(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Campos de consent_json. */
export interface ConsentJsonFields {
  /** Versión de los textos que tenía el navegador (null: desconocida o sin casillas). */
  v: string | null;
  /** Versión vigente en el servidor, solo si difiere de v (y solo en constancias 'web'). */
  sv?: string;
  at: Date;
  form: ConsentForm;
  privacy: true | null;
  terms: true | null;
  marketing: boolean;
  src: ConsentSource;
}

/** JSON de una línea con claves fijas y en orden: v, sv (si viene), at, form, privacy, terms, marketing, src. */
export function consentJson(f: ConsentJsonFields): string {
  return JSON.stringify({
    v: f.v,
    ...(f.sv !== undefined ? { sv: f.sv } : {}),
    at: utcSeconds(f.at),
    form: f.form,
    privacy: f.privacy,
    terms: f.terms,
    marketing: f.marketing,
    src: f.src,
  });
}

const marketingLine = (marketing: boolean) =>
  'Novedades y ofertas por correo: ' + (marketing ? 'SÍ (casilla opcional; puede retirarlo cuando quiera)' : 'NO');

const registeredLine = (at: Date) => `Registrado: ${formatChileTime(at)}, hora de Chile (reloj del servidor)`;

/**
 * Bloque de una constancia con casillas ('web'). Nunca vacío; quien llama pone antes la
 * línea en blanco. Sin datos personales.
 */
export function formatConsentSection({
  consent,
  at,
  form,
}: {
  consent: ParsedConsent;
  at: Date;
  form: ConsentForm;
  src?: 'web';
}): string[] {
  const v = consent.clientVersion;
  const differs = v !== LEGAL_VERSION;
  return [
    CONSENT_HEADING,
    'Privacidad: leída; autoriza usar sus datos para responder esta solicitud (casilla obligatoria)',
    ...(consent.terms ? ['Términos y condiciones: aceptados (casilla obligatoria)'] : []),
    marketingLine(consent.marketing),
    'Versión de los textos legales: ' +
      (differs ? `${v ?? 'desconocida'} (vigente en el servidor: ${LEGAL_VERSION})` : LEGAL_VERSION),
    registeredLine(at),
    `${CONSENT_JSON_PREFIX} ${consentJson({
      v,
      ...(differs ? { sv: LEGAL_VERSION } : {}),
      at,
      form,
      privacy: true,
      terms: consent.terms ? true : null,
      marketing: consent.marketing,
      src: 'web',
    })}`,
  ];
}

/**
 * Bloque de un cuerpo sin la clave consent dentro del margen ('web-legacy'). En
 * /instalacion, con aceptaContacto, nombra la casilla que tenía el formulario anterior.
 */
export function formatLegacyConsentSection({
  at,
  form,
  aceptaContacto = false,
}: {
  at: Date;
  form: ConsentForm;
  aceptaContacto?: boolean;
}): string[] {
  return [
    CONSENT_HEADING,
    `Privacidad: SIN CASILLA (formulario anterior a la versión ${CONSENT_SINCE_VERSION}, enviado en el margen de ${CONSENT_GRACE_DAYS} días)`,
    ...(form === 'instalacion' && aceptaContacto === true
      ? [`Casilla anterior marcada: «${LEGACY_INSTALLATION_CHECKBOX}»`]
      : []),
    marketingLine(false),
    registeredLine(at),
    `${CONSENT_JSON_PREFIX} ${consentJson({
      v: null,
      at,
      form,
      privacy: null,
      terms: null,
      marketing: false,
      src: 'web-legacy',
    })}`,
  ];
}

/** consent_json leído de vuelta (para pruebas y para el registro de novedades de ventas). */
export interface ConsentRecord {
  v: string | null;
  sv?: string;
  at: string;
  form: string;
  privacy: boolean | null;
  terms: boolean | null;
  marketing: boolean;
  src: string;
}

/**
 * La decisión vigente de una nota o un correo: la ÚLTIMA línea que empieza con
 * "consent_json:" (separa por saltos de línea o <br>). null si no hay o no es JSON válido.
 */
export function lastConsentRecord(text: string): ConsentRecord | null {
  const lines = text.split(/\r?\n|<br\s*\/?>/i);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith(CONSENT_JSON_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(lines[i].slice(CONSENT_JSON_PREFIX.length));
      return isPlainObject(parsed) ? (parsed as ConsentRecord) : null;
    } catch {
      return null;
    }
  }
  return null;
}
