// api/_lib/forms/consent.test.ts
// Privacidad y autorizaciones (Etapa 2 · PR 13): lo que comparten los cinco formularios y
// los cinco endpoints. La casilla obligatoria es exactamente true; una versión rara no
// rechaza; sin la clave consent solo se acepta dentro del margen (registrado como
// web-legacy); el bloque de la nota y del correo usa la hora del servidor, termina en
// consent_json (claves fijas, sin datos personales) y vale la ÚLTIMA línea consent_json.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_ERRORS,
  CONSENT_ERROR_CODE,
  CONSENT_FIELD_NAMES,
  CONSENT_FORMS,
  CONSENT_GRACE_DAYS,
  CONSENT_HEADING,
  CONSENT_JSON_PREFIX,
  CONSENT_LEGEND,
  CONSENT_SINCE_DATE,
  CONSENT_SINCE_VERSION,
  CONSENT_TEXTS,
  CONSENT_TEXT_LINKS,
  LEGACY_INSTALLATION_CHECKBOX,
  LEGAL_ARCHIVE,
  LEGAL_UPDATED,
  LEGAL_UPDATED_LABEL,
  LEGAL_VERSION,
  LEGAL_VERSIONED_PATHS,
  consentGraceUntil,
  consentJson,
  consentTextParts,
  consentTextPlain,
  formatChileTime,
  formatConsentSection,
  formatLegacyConsentSection,
  lastConsentRecord,
  legalArchiveHref,
  parseConsent,
  resolveConsent,
  type ParsedConsent,
} from './consent';
import { readFileSync } from 'node:fs';
import * as site from '../../../src/config/site';
import { legalPage } from '../../../src/config/legal';

const DAY_MS = 24 * 60 * 60 * 1000;
const AT = '2026-11-20T14:03:12Z';
const AT_CHILE = 'Registrado: 2026-11-20 11:03:12, hora de Chile (reloj del servidor)';
const PRIVACY_LINE = 'Privacidad: leída; autoriza usar sus datos para responder esta solicitud (casilla obligatoria)';
const TERMS_LINE = 'Términos y condiciones: aceptados (casilla obligatoria)';
const MARKETING_YES = 'Novedades y ofertas por correo: SÍ (casilla opcional; puede retirarlo cuando quiera)';
const MARKETING_NO = 'Novedades y ofertas por correo: NO';
/**
 * Tope del bloque en el peor caso (pedido + novedades + versión distinta de 2 dígitos). El
 * diseño estimó 520, pero sus textos obligatorios miden 556: el tope protege los correos
 * (capText de estudio corta en 8.000) sin cambiar el texto aprobado.
 */
const MAX_SECTION = 560;

/**
 * Textos aprobados de las casillas por versión de los textos legales. Cambiar una casilla
 * sin subir LEGAL_VERSION, o subirla sin agregar aquí la entrada, hace fallar la prueba.
 * Las casillas se estrenan en la versión CONSENT_SINCE_VERSION (1.1). Al subir la versión
 * sin cambiar las casillas, se agrega la entrada nueva con los mismos textos.
 */
const CONSENT_TEXTS_BY_VERSION: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  '1.2': Object.freeze({
    privacy: 'Leí la {privacidad} y autorizo a eLIGHTS a usar mis datos para responder esta solicitud.',
    privacyWithTerms:
      'Acepto los {terminos}, leí la {privacidad} y autorizo a eLIGHTS a usar mis datos para responder esta solicitud.',
    marketing: 'Quiero recibir novedades y ofertas de eLIGHTS por correo (opcional). Puedo darme de baja cuando quiera.',
    installationNote:
      'Usamos estos datos para responder y dar seguimiento a tu solicitud. Quedan registrados en los servicios con que trabajamos: Vercel (sitio web), Google (correo) y Pipedrive (gestión de clientes).',
  }),
});

const parsed = (over: Partial<ParsedConsent> = {}): ParsedConsent => ({
  privacy: true,
  terms: false,
  marketing: false,
  clientVersion: LEGAL_VERSION,
  ...over,
});

/** Un instante dentro del margen y otro justo al terminar. */
const insideGrace = () => new Date(consentGraceUntil().getTime() - 1);
const graceOver = () => new Date(consentGraceUntil().getTime());

afterEach(() => {
  vi.useRealTimers();
});

describe('constantes y textos', () => {
  it('src/config/site.ts reexporta la versión desde aquí (una sola fuente)', () => {
    expect(site.LEGAL_VERSION).toBe(LEGAL_VERSION);
    expect(site.LEGAL_UPDATED).toBe(LEGAL_UPDATED);
    expect(site.LEGAL_UPDATED_LABEL).toBe(LEGAL_UPDATED_LABEL);
    expect(site.LEGAL_ARCHIVE).toBe(LEGAL_ARCHIVE);
  });

  it('versión X.Y, fecha AAAA-MM-DD y etiqueta que dice la misma fecha', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{1,2}\.\d{1,2}$/);
    expect(LEGAL_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(LEGAL_UPDATED))).toBe(false);
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const [y, m, d] = LEGAL_UPDATED.split('-').map(Number);
    expect(LEGAL_UPDATED_LABEL).toBe(`${d} de ${MONTHS[m - 1]} de ${y}`);
  });

  it('LEGAL_ARCHIVE solo trae versiones anteriores, sin repetir', () => {
    expect(LEGAL_ARCHIVE).not.toContain(LEGAL_VERSION);
    expect(new Set(LEGAL_ARCHIVE).size).toBe(LEGAL_ARCHIVE.length);
    for (const v of LEGAL_ARCHIVE) expect(v).toMatch(/^\d{1,2}\.\d{1,2}$/);
  });

  it('CONSENT_TEXTS es el texto aprobado para la versión vigente', () => {
    const expected = CONSENT_TEXTS_BY_VERSION[LEGAL_VERSION];
    expect(expected, `falta la entrada de la versión ${LEGAL_VERSION} en CONSENT_TEXTS_BY_VERSION`).toBeDefined();
    expect({ ...CONSENT_TEXTS }).toEqual(expected);
    expect(Object.isFrozen(CONSENT_TEXTS)).toBe(true);
  });

  it('mensajes de error, código, leyenda y nombres de las casillas', () => {
    expect(CONSENT_ERRORS).toEqual({
      solicitud: 'Para enviar la solicitud, marca la casilla de la Política de privacidad.',
      pedido: 'Para enviar la solicitud, marca la casilla de los Términos y condiciones y la Política de privacidad.',
    });
    expect(CONSENT_ERROR_CODE).toBe('consent_required');
    expect(CONSENT_LEGEND).toBe('Privacidad y novedades');
    expect(CONSENT_FIELD_NAMES).toEqual({ privacy: 'consentPrivacy', marketing: 'consentMarketing' });
    expect(CONSENT_FORMS).toEqual(['solicitar-pedido', 'cotizacion', 'cotizador', 'instalacion', 'estudio-luminico']);
    expect(CONSENT_HEADING).toBe('--- PRIVACIDAD Y AUTORIZACIONES ---');
    expect(CONSENT_JSON_PREFIX).toBe('consent_json:');
  });

  it('los enlaces de las casillas coinciden con LEGAL_PAGES (ruta y nombre)', () => {
    for (const { path, label } of Object.values(CONSENT_TEXT_LINKS)) {
      expect(legalPage(path).label).toBe(label);
    }
  });

  it('consentTextParts separa texto y enlaces; consentTextPlain da el texto que se lee', () => {
    expect(consentTextParts(CONSENT_TEXTS.privacy)).toEqual([
      'Leí la ',
      { link: 'privacidad', path: '/politica-de-privacidad', label: 'Política de privacidad' },
      ' y autorizo a eLIGHTS a usar mis datos para responder esta solicitud.',
    ]);
    expect(consentTextParts(CONSENT_TEXTS.privacyWithTerms)).toEqual([
      'Acepto los ',
      { link: 'terminos', path: '/terminos-y-condiciones', label: 'Términos y condiciones' },
      ', leí la ',
      { link: 'privacidad', path: '/politica-de-privacidad', label: 'Política de privacidad' },
      ' y autorizo a eLIGHTS a usar mis datos para responder esta solicitud.',
    ]);
    expect(consentTextParts(CONSENT_TEXTS.marketing)).toEqual([CONSENT_TEXTS.marketing]);
    expect(consentTextPlain(CONSENT_TEXTS.privacyWithTerms)).toBe(
      'Acepto los Términos y condiciones, leí la Política de privacidad y autorizo a eLIGHTS a usar mis datos para responder esta solicitud.'
    );
    // Un marcador desconocido queda como texto.
    expect(consentTextParts('a {otro} b')).toEqual(['a {otro} b']);
  });

  it('legalArchiveHref: /legal/<página>-v<versión>.html, por defecto la vigente', () => {
    expect(legalArchiveHref('/terminos-y-condiciones', '1.0')).toBe('/legal/terminos-y-condiciones-v1.0.html');
    expect(legalArchiveHref('/politica-de-privacidad')).toBe(`/legal/politica-de-privacidad-v${LEGAL_VERSION}.html`);
    expect(LEGAL_VERSIONED_PATHS).toEqual(['/terminos-y-condiciones', '/politica-de-privacidad', '/cambios-devoluciones-y-garantia']);
  });
});

describe('parseConsent', () => {
  it('sin la clave: absent y "consent is required"', () => {
    expect(parseConsent(undefined, { requireTerms: false })).toEqual({
      ok: false,
      absent: true,
      errors: ['consent is required'],
    });
  });

  it.each([
    ['null', null],
    ['texto', 'true'],
    ['arreglo', []],
    ['arreglo con objeto', [{ privacy: true }]],
    ['número', 1],
    ['booleano', true],
    ['función', () => ({ privacy: true })],
    ['fecha', new Date()],
    ['instancia de clase', new (class X { privacy = true })()],
  ])('%s → "consent must be an object" (no es ausente)', (_name, raw) => {
    expect(parseConsent(raw, { requireTerms: false })).toEqual({
      ok: false,
      absent: false,
      errors: ['consent must be an object'],
    });
  });

  it.each([false, 'true', 1, null, undefined, {}])('privacy %j → rechazo', privacy => {
    const r = parseConsent({ privacy, marketing: false, version: LEGAL_VERSION }, { requireTerms: false });
    expect(r).toEqual({ ok: false, absent: false, errors: ['consent.privacy must be true'] });
  });

  it('{} acumula los errores (y terms con requireTerms)', () => {
    expect(parseConsent({}, { requireTerms: true })).toEqual({
      ok: false,
      absent: false,
      errors: ['consent.privacy must be true', 'consent.terms must be true'],
    });
  });

  it.each([undefined, false, 'true', 1])('con requireTerms, terms %j → rechazo', terms => {
    const r = parseConsent({ privacy: true, terms, marketing: false, version: LEGAL_VERSION }, { requireTerms: true });
    expect(r).toEqual({ ok: false, absent: false, errors: ['consent.terms must be true'] });
  });

  it('con requireTerms y terms true: ok con terms true', () => {
    const r = parseConsent({ privacy: true, terms: true, marketing: false, version: LEGAL_VERSION }, { requireTerms: true });
    expect(r).toEqual({ ok: true, consent: parsed({ terms: true }) });
  });

  it('sin requireTerms, terms no se lee (queda false aunque venga true)', () => {
    const r = parseConsent({ privacy: true, terms: true, version: LEGAL_VERSION }, { requireTerms: false });
    expect(r).toEqual({ ok: true, consent: parsed({ terms: false }) });
    const odd = parseConsent({ privacy: true, terms: 'x', version: LEGAL_VERSION }, { requireTerms: false });
    expect(odd.ok).toBe(true);
  });

  it('marketing: ausente → false; true y false tal cual', () => {
    const r = (marketing?: boolean) =>
      parseConsent({ privacy: true, ...(marketing === undefined ? {} : { marketing }), version: '1.0' }, { requireTerms: false });
    expect(r()).toMatchObject({ ok: true, consent: { marketing: false } });
    expect(r(true)).toMatchObject({ ok: true, consent: { marketing: true } });
    expect(r(false)).toMatchObject({ ok: true, consent: { marketing: false } });
  });

  it.each(['true', 1, 0, null, {}, []])('marketing %j → "consent.marketing must be a boolean"', marketing => {
    const r = parseConsent({ privacy: true, marketing, version: LEGAL_VERSION }, { requireTerms: false });
    expect(r).toEqual({ ok: false, absent: false, errors: ['consent.marketing must be a boolean'] });
  });

  it.each([
    ['1.1', '1.1'],
    ['10.12', '10.12'],
    ['<b>', null],
    ['1.0.0.0', null],
    ['1', null],
    ['', null],
    [' 1.1', null],
    ['1.1\n', null],
    ['100.1', null],
    [1.1, null],
    [null, null],
    [undefined, null],
  ])('versión %j → %j, nunca rechaza', (version, expected) => {
    const r = parseConsent({ privacy: true, version }, { requireTerms: false });
    expect(r).toEqual({ ok: true, consent: parsed({ clientVersion: expected }) });
  });

  it('claves extra no cambian nada; un objeto sin prototipo sirve', () => {
    const r = parseConsent({ privacy: true, version: LEGAL_VERSION, email: 'x@y.cl', at: '2020-01-01', extra: { a: 1 } }, { requireTerms: false });
    expect(r).toEqual({ ok: true, consent: parsed() });
    const bare = Object.assign(Object.create(null), { privacy: true, version: LEGAL_VERSION });
    expect(parseConsent(bare, { requireTerms: false })).toEqual({ ok: true, consent: parsed() });
  });

  it('__proto__ de JSON no aporta claves heredadas', () => {
    const viaProto = JSON.parse('{"__proto__":{"privacy":true,"terms":true}}');
    expect(parseConsent(viaProto, { requireTerms: true })).toEqual({
      ok: false,
      absent: false,
      errors: ['consent.privacy must be true', 'consent.terms must be true'],
    });
    const inherited = Object.create({ privacy: true });
    expect(parseConsent(inherited, { requireTerms: false }).ok).toBe(false);
    expect(({} as Record<string, unknown>).privacy).toBeUndefined();
  });

  it('un getter (aunque lance) no cuenta y nunca lanza', () => {
    const throwing = Object.defineProperty({}, 'privacy', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(() => parseConsent(throwing, { requireTerms: false })).not.toThrow();
    expect(parseConsent(throwing, { requireTerms: false })).toEqual({
      ok: false,
      absent: false,
      errors: ['consent.privacy must be true'],
    });
    const truthy = Object.defineProperty({}, 'privacy', { enumerable: true, get: () => true });
    expect(parseConsent(truthy, { requireTerms: false }).ok).toBe(false);
  });

  it('un Proxy que lanza en cada trampa → error, sin lanzar', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('boom');
        },
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
        get() {
          throw new Error('boom');
        },
      }
    );
    expect(() => parseConsent(hostile, { requireTerms: true })).not.toThrow();
    expect(parseConsent(hostile, { requireTerms: true })).toEqual({
      ok: false,
      absent: false,
      errors: ['consent must be an object'],
    });
  });
});

describe('consentGraceUntil', () => {
  it('CONSENT_SINCE_DATE a las 00:00 (-03:00) más CONSENT_GRACE_DAYS + 1 días, con un margen de 7 días como máximo', () => {
    expect(CONSENT_GRACE_DAYS).toBeLessThanOrEqual(7);
    expect(consentGraceUntil().getTime()).toBe(
      new Date(`${CONSENT_SINCE_DATE}T00:00:00-03:00`).getTime() + (CONSENT_GRACE_DAYS + 1) * DAY_MS
    );
    expect(consentGraceUntil().getTime()).toBe(Date.parse(`${CONSENT_SINCE_DATE}T03:00:00Z`) + 8 * DAY_MS);
  });

  it('CONSENT_SINCE_DATE es la fecha de la versión que estrenó las casillas: igual a LEGAL_UPDATED mientras esa sea la vigente, anterior después', () => {
    expect(CONSENT_SINCE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(CONSENT_SINCE_DATE))).toBe(false);
    if (LEGAL_VERSION === CONSENT_SINCE_VERSION) expect(CONSENT_SINCE_DATE).toBe(LEGAL_UPDATED);
    else expect(CONSENT_SINCE_DATE < LEGAL_UPDATED).toBe(true);
  });

  it('subir la versión (LEGAL_UPDATED nueva) no reabre el margen: consentGraceUntil no lee LEGAL_UPDATED', () => {
    const source = readFileSync(new URL('./consent.ts', import.meta.url), 'utf-8');
    const body = source.match(/export function consentGraceUntil\(\): Date \{([\s\S]*?)\n\}/)?.[1];
    expect(body, 'no se encontró consentGraceUntil en consent.ts').toBeDefined();
    expect(body).toContain('CONSENT_SINCE_DATE');
    expect(body).not.toContain('LEGAL_UPDATED');
    // La constancia «web-legacy» nombra la versión que estrenó las casillas, no la vigente
    expect(formatLegacyConsentSection({ at: new Date(AT), form: 'cotizacion' }).join('\n')).toContain(
      `formulario anterior a la versión ${CONSENT_SINCE_VERSION},`
    );
  });

  it('no depende del reloj', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const a = consentGraceUntil().getTime();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(consentGraceUntil().getTime()).toBe(a);
  });
});

describe('resolveConsent', () => {
  const valid = { privacy: true, marketing: false, version: LEGAL_VERSION };

  it('casillas válidas → bloque web', () => {
    const at = new Date(AT);
    const r = resolveConsent({ consent: valid }, { form: 'cotizacion', requireTerms: false, at });
    expect(r).toEqual({ ok: true, src: 'web', section: formatConsentSection({ consent: parsed(), at, form: 'cotizacion' }) });
  });

  it('sin la clave consent dentro del margen → bloque web-legacy', () => {
    const at = insideGrace();
    const r = resolveConsent({ nombre: 'Ana' }, { form: 'cotizador', requireTerms: false, at });
    expect(r).toEqual({ ok: true, src: 'web-legacy', section: formatLegacyConsentSection({ at, form: 'cotizador' }) });
    if (r.ok) {
      expect(r.section.join('\n')).not.toContain('Casilla anterior');
      expect(lastConsentRecord(r.section.join('\n'))).toMatchObject({ src: 'web-legacy', privacy: null, form: 'cotizador' });
    }
  });

  it('en /instalacion con aceptaContacto true, el bloque legado nombra la casilla anterior', () => {
    const at = insideGrace();
    const r = resolveConsent({ aceptaContacto: true }, { form: 'instalacion', requireTerms: false, at });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.src).toBe('web-legacy');
      expect(r.section).toContain(`Casilla anterior marcada: «${LEGACY_INSTALLATION_CHECKBOX}»`);
    }
    // 'true' (texto) no es la casilla marcada; en otro formulario tampoco se nombra.
    const text = resolveConsent({ aceptaContacto: 'true' }, { form: 'instalacion', requireTerms: false, at });
    const other = resolveConsent({ aceptaContacto: true }, { form: 'estudio-luminico', requireTerms: false, at });
    for (const x of [text, other]) {
      expect(x.ok).toBe(true);
      if (x.ok) expect(x.section.join('\n')).not.toContain('Casilla anterior');
    }
  });

  it('sin la clave consent al terminar el margen → errores (400)', () => {
    expect(resolveConsent({}, { form: 'instalacion', requireTerms: false, at: graceOver() })).toEqual({
      ok: false,
      errors: ['consent is required'],
    });
    expect(resolveConsent({ aceptaContacto: true }, { form: 'instalacion', requireTerms: false, at: graceOver() }).ok).toBe(false);
  });

  it.each([
    ['null', null],
    ['texto', 'true'],
    ['arreglo', []],
    ['{}', {}],
    ['privacy false', { privacy: false }],
    ["privacy 'true'", { privacy: 'true' }],
    ['privacy 1', { privacy: 1 }],
  ])('clave presente e inválida (%s) → errores, también dentro del margen', (_name, consent) => {
    const r = resolveConsent({ consent }, { form: 'cotizacion', requireTerms: false, at: insideGrace() });
    expect(r.ok).toBe(false);
  });

  it('pedido: sin terms o con terms false → errores', () => {
    for (const consent of [{ privacy: true }, { privacy: true, terms: false }]) {
      const r = resolveConsent({ consent }, { form: 'solicitar-pedido', requireTerms: true, at: insideGrace() });
      expect(r).toEqual({ ok: false, errors: ['consent.terms must be true'] });
    }
  });

  it('decide `at` (reloj del servidor que pasa quien llama), no el reloj del proceso', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(consentGraceUntil().getTime() - DAY_MS));
    expect(resolveConsent({}, { form: 'cotizador', requireTerms: false, at: graceOver() }).ok).toBe(false);
    vi.setSystemTime(new Date(consentGraceUntil().getTime() + DAY_MS));
    expect(resolveConsent({}, { form: 'cotizador', requireTerms: false, at: insideGrace() }).ok).toBe(true);
  });

  it('`at` y `fecha` del cuerpo no cuentan para el registro', () => {
    const at = new Date(AT);
    const r = resolveConsent(
      { consent: { ...valid, at: '2020-01-01T00:00:00Z' }, at: '2020-01-01T00:00:00Z', fecha: '01-01-2020' },
      { form: 'estudio-luminico', requireTerms: false, at }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.section).toContain(AT_CHILE);
      expect(r.section.join('\n')).not.toContain('2020');
    }
  });

  it('sin datos personales: nombre, correo, teléfono o RUT del cuerpo nunca llegan al bloque', () => {
    const body = {
      nombre: 'Ana Pérez',
      email: 'ana@example.cl',
      telefono: '+56911112222',
      rut: '11.111.111-1',
      consent: { ...valid, terms: true, email: 'ana@example.cl', nombre: 'Ana Pérez' },
    };
    for (const at of [new Date(AT), insideGrace()]) {
      const r = resolveConsent(body, { form: 'solicitar-pedido', requireTerms: true, at });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const text = r.section.join('\n');
        for (const pii of ['Ana', 'Pérez', 'ana@example.cl', '56911112222', '11.111.111-1']) expect(text).not.toContain(pii);
      }
    }
  });

  it('cuerpo hostil (Proxy) → error, sin lanzar', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('boom');
        },
      }
    );
    expect(() => resolveConsent(hostile, { form: 'cotizacion', requireTerms: false, at: insideGrace() })).not.toThrow();
    expect(resolveConsent(hostile, { form: 'cotizacion', requireTerms: false, at: insideGrace() }).ok).toBe(false);
  });
});

describe('formatConsentSection', () => {
  const now = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
    return new Date();
  };

  it('pedido (con términos), sin novedades: bloque exacto', () => {
    const at = now();
    expect(formatConsentSection({ consent: parsed({ terms: true }), at, form: 'solicitar-pedido' })).toEqual([
      CONSENT_HEADING,
      PRIVACY_LINE,
      TERMS_LINE,
      MARKETING_NO,
      `Versión de los textos legales: ${LEGAL_VERSION}`,
      AT_CHILE,
      `consent_json: {"v":"${LEGAL_VERSION}","at":"2026-11-20T14:03:12Z","form":"solicitar-pedido","privacy":true,"terms":true,"marketing":false,"src":"web"}`,
    ]);
  });

  it('solicitud (sin términos), con novedades: sin la línea de términos y terms null', () => {
    const at = now();
    expect(formatConsentSection({ consent: parsed({ marketing: true }), at, form: 'instalacion' })).toEqual([
      CONSENT_HEADING,
      PRIVACY_LINE,
      MARKETING_YES,
      `Versión de los textos legales: ${LEGAL_VERSION}`,
      AT_CHILE,
      `consent_json: {"v":"${LEGAL_VERSION}","at":"2026-11-20T14:03:12Z","form":"instalacion","privacy":true,"terms":null,"marketing":true,"src":"web"}`,
    ]);
  });

  it('versión del navegador distinta: lo dice y agrega sv', () => {
    const at = now();
    const section = formatConsentSection({ consent: parsed({ clientVersion: '9.9' }), at, form: 'cotizador' });
    expect(section).toContain(`Versión de los textos legales: 9.9 (vigente en el servidor: ${LEGAL_VERSION})`);
    expect(lastConsentRecord(section.join('\n'))).toEqual({
      v: '9.9',
      sv: LEGAL_VERSION,
      at: '2026-11-20T14:03:12Z',
      form: 'cotizador',
      privacy: true,
      terms: null,
      marketing: false,
      src: 'web',
    });
  });

  it('versión desconocida: "desconocida" y v null', () => {
    const at = now();
    const section = formatConsentSection({ consent: parsed({ clientVersion: null }), at, form: 'cotizacion' });
    expect(section).toContain(`Versión de los textos legales: desconocida (vigente en el servidor: ${LEGAL_VERSION})`);
    expect(lastConsentRecord(section.join('\n'))).toMatchObject({ v: null, sv: LEGAL_VERSION });
  });

  it('consent_json: última línea, una sola línea y claves en orden fijo', () => {
    const at = now();
    for (const consent of [parsed(), parsed({ clientVersion: '2.0', terms: true, marketing: true })]) {
      const section = formatConsentSection({ consent, at, form: 'solicitar-pedido' });
      for (const line of section) expect(line).not.toMatch(/[\r\n]/);
      const last = section[section.length - 1];
      expect(last.startsWith(`${CONSENT_JSON_PREFIX} {`)).toBe(true);
      expect(section.filter(l => l.startsWith(CONSENT_JSON_PREFIX))).toHaveLength(1);
      const keys = Object.keys(JSON.parse(last.slice(CONSENT_JSON_PREFIX.length)));
      const order = ['v', 'sv', 'at', 'form', 'privacy', 'terms', 'marketing', 'src'];
      expect(keys).toEqual(order.filter(k => keys.includes(k)));
      expect(keys).toEqual(consent.clientVersion === LEGAL_VERSION ? order.filter(k => k !== 'sv') : order);
    }
  });

  it(`nunca vacío y como máximo ${MAX_SECTION} caracteres en el peor caso`, () => {
    const at = now();
    const worst = formatConsentSection({
      consent: parsed({ terms: true, marketing: true, clientVersion: '99.98' }),
      at,
      form: 'solicitar-pedido',
    }).join('\n');
    const legacy = formatLegacyConsentSection({ at, form: 'instalacion', aceptaContacto: true }).join('\n');
    for (const text of [worst, legacy]) {
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(MAX_SECTION);
    }
  });

  it('consentJson arma las claves en orden aunque los campos lleguen en otro', () => {
    const at = new Date(AT);
    expect(
      consentJson({ src: 'web', marketing: true, terms: null, privacy: true, form: 'cotizacion', at, sv: '2.0', v: '1.9' })
    ).toBe('{"v":"1.9","sv":"2.0","at":"2026-11-20T14:03:12Z","form":"cotizacion","privacy":true,"terms":null,"marketing":true,"src":"web"}');
  });
});

describe('formatLegacyConsentSection', () => {
  it('bloque exacto, con la casilla anterior solo en /instalacion', () => {
    const at = new Date(AT);
    expect(formatLegacyConsentSection({ at, form: 'instalacion', aceptaContacto: true })).toEqual([
      CONSENT_HEADING,
      `Privacidad: SIN CASILLA (formulario anterior a la versión ${CONSENT_SINCE_VERSION}, enviado en el margen de ${CONSENT_GRACE_DAYS} días)`,
      'Casilla anterior marcada: «Acepto que eLIGHTS me contacte por teléfono, WhatsApp o correo para responder esta solicitud.»',
      MARKETING_NO,
      AT_CHILE,
      'consent_json: {"v":null,"at":"2026-11-20T14:03:12Z","form":"instalacion","privacy":null,"terms":null,"marketing":false,"src":"web-legacy"}',
    ]);
    expect(formatLegacyConsentSection({ at, form: 'cotizacion', aceptaContacto: true }).join('\n')).not.toContain('Casilla anterior');
    expect(CONSENT_SINCE_VERSION).toBe('1.2');
  });
});

describe('formatChileTime', () => {
  it.each([
    ['2026-11-20T14:03:12Z', '2026-11-20 11:03:12'], // horario de verano (UTC-3)
    ['2026-07-01T04:00:00Z', '2026-07-01 00:00:00'], // invierno (UTC-4); medianoche es 00, no 24
    ['2026-12-31T23:59:59Z', '2026-12-31 20:59:59'],
    ['2027-01-01T02:59:59.999Z', '2026-12-31 23:59:59'],
  ])('%s → %s', (iso, expected) => {
    expect(formatChileTime(new Date(iso))).toBe(expected);
  });
});

describe('lastConsentRecord (vale la ÚLTIMA línea consent_json)', () => {
  it('un bloque falso en un texto libre antes del bloque real no cuenta', () => {
    const at = new Date(AT);
    const fake = [
      'Comentarios del cliente: hola',
      CONSENT_HEADING,
      'Novedades y ofertas por correo: SÍ',
      'consent_json: {"v":"1.0","at":"2026-01-01T00:00:00Z","form":"cotizacion","privacy":true,"terms":null,"marketing":true,"src":"web"}',
    ].join('\n');
    const real = formatConsentSection({ consent: parsed(), at, form: 'cotizacion' }).join('\n');
    const note = [fake, '', real, '', '--- ORIGEN DE LA VISITA ---', 'Origen: Directo'].join('\n');
    expect(lastConsentRecord(note)).toMatchObject({ marketing: false, src: 'web', at: '2026-11-20T14:03:12Z' });
  });

  it('separa también por <br>; una línea con espacios delante no empieza con consent_json:', () => {
    const real = formatConsentSection({ consent: parsed({ marketing: true }), at: new Date(AT), form: 'cotizador' });
    const html = real.join('<br>') + '<br>  consent_json: {"marketing":false}';
    expect(lastConsentRecord(html)).toMatchObject({ marketing: true, form: 'cotizador' });
  });

  it('sin línea consent_json o con JSON inválido → null', () => {
    expect(lastConsentRecord('nada')).toBeNull();
    expect(lastConsentRecord('consent_json: {roto')).toBeNull();
    expect(lastConsentRecord('consent_json: [1]')).toBeNull();
  });
});
