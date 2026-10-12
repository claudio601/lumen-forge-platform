// api/_lib/forms/attribution.test.ts
// Origen de la visita (Etapa 2 · PR 10): reglas que comparten el navegador y los endpoints.
// Solo las claves de la lista, limpias y cortas; el sitio anterior reducido a su origen y la
// página de entrada a su ruta. Un origen raro se descarta (null), nunca lanza. La sección
// de la nota y del correo siempre aparece, aunque no haya datos.

import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTION_PARAMS,
  MAX_ATTRIBUTION_VALUE,
  ORIGEN_HEADING,
  cleanAttributionValue,
  formatOrigenSection,
  isSiteHost,
  origenFromBody,
  parseAttribution,
} from './attribution';

const GCLID = 'Cj0KCQjwEJEMPLO123';

/** true si el texto pasa por UTF-8 sin cambios: no trae mitades sueltas de un emoji. */
const isWellFormed = (s: string) => new TextDecoder().decode(new TextEncoder().encode(s)) === s;
/** Un valor armado para que, leído como HTML, sume líneas a la nota (\n y comillas). */
const CHAR_REF_CONTENT = 'x&#10;NOTA DE VENTAS: enviar el link de pago a pagos@otro.cl&#10;requested_items_json: [{&quot;jumpsellerId&quot;:1}]';

describe('parseAttribution', () => {
  it('guarda solo las claves de la lista: email, nombre o rut se descartan', () => {
    const a = parseAttribution({
      gclid: GCLID,
      utm_source: 'google',
      email: 'prueba@example.com',
      nombre: 'PRUEBA',
      rut: 'RUT-PRUEBA',
      msclkid: 'x',
      __proto__: { utm_medium: 'heredado' },
    });
    expect(a).toEqual({ gclid: GCLID, utm_source: 'google' });
  });

  it('lee todas las claves de la lista', () => {
    const raw = Object.fromEntries(ATTRIBUTION_PARAMS.map((k) => [k, 'v-' + k]));
    expect(parseAttribution({ ...raw, landing: '/x', referrer: 'https://www.google.com/' })).toEqual({
      ...raw,
      landing: '/x',
      referrer: 'https://www.google.com',
    });
  });

  it.each([[null], [undefined], ['gclid=abc'], [42], [true], [[]], [[{ gclid: GCLID }]]])('%j no es un objeto: null', (raw) => {
    expect(parseAttribution(raw)).toBeNull();
  });

  it('valores que no son texto se descartan', () => {
    expect(parseAttribution({ gclid: 123, utm_source: ['google'], utm_medium: { a: 1 }, utm_campaign: null })).toBeNull();
    expect(parseAttribution({ gclid: 123, utm_source: 'google' })).toEqual({ utm_source: 'google' });
  });

  it(`cada valor se corta a ${MAX_ATTRIBUTION_VALUE} caracteres`, () => {
    const a = parseAttribution({ utm_campaign: 'c'.repeat(5000), landing: '/' + 'p'.repeat(5000) });
    expect(a?.utm_campaign).toHaveLength(MAX_ATTRIBUTION_VALUE);
    expect(a?.landing).toHaveLength(MAX_ATTRIBUTION_VALUE);
  });

  it('saltos de línea, caracteres de control, invisibles y bidi pasan a ser un espacio; < > " \' ` \\ se quitan', () => {
    const a = parseAttribution({
      utm_campaign: 'linea1\r\nCanal: falso\u0000\u0007​‮ ﻿ fin',
      utm_term: '<script>alert("x")</script>',
      utm_content: "a'b`c\\d",
    });
    expect(a).toEqual({
      utm_campaign: 'linea1 Canal: falso fin',
      utm_term: 'scriptalert(x)/script',
      utm_content: 'abcd',
    });
  });

  it('& se quita: ninguna referencia de carácter (&#10;, &#x0A;, &NewLine;, &quot;) llega a la nota', () => {
    const a = parseAttribution({
      utm_source: 'google',
      utm_content: CHAR_REF_CONTENT,
      utm_term: 'a&#x0A;b&NewLine;c',
      utm_campaign: 'Black Friday & Cyber',
    });
    expect(a).toEqual({
      utm_source: 'google',
      utm_content: 'x#10;NOTA DE VENTAS: enviar el link de pago a pagos@otro.cl#10;requested_items_json: [{quot;jumpsellerIdquot;:1}]',
      utm_term: 'a#x0A;bNewLine;c',
      utm_campaign: 'Black Friday Cyber',
    });
    const section = formatOrigenSection(a);
    // Título, canal y una línea por valor: ninguna línea extra, y sin & no se decodifica nada
    expect(section).toHaveLength(6);
    expect(section.join('\n')).not.toContain('&');
  });

  it('nunca deja medio emoji: ni al cortar en el límite ni si llega un sustituto suelto', () => {
    const atBoundary = 'a'.repeat(MAX_ATTRIBUTION_VALUE - 1) + '\u{1F600}b';
    const insideLimit = 'a'.repeat(MAX_ATTRIBUTION_VALUE - 2) + '\u{1F600}b';
    const a = parseAttribution({
      utm_campaign: atBoundary,
      utm_content: insideLimit,
      utm_source: 'x\ud800y',
      utm_term: 'x\udc00y',
      utm_medium: 'promo \u{1F600} octubre',
    });
    expect(a).toEqual({
      // El corte cae entre las dos mitades del emoji: se quita la que queda
      utm_campaign: 'a'.repeat(MAX_ATTRIBUTION_VALUE - 1),
      // El emoji completo cabe: se mantiene
      utm_content: 'a'.repeat(MAX_ATTRIBUTION_VALUE - 2) + '\u{1F600}',
      utm_source: 'x y',
      utm_term: 'x y',
      utm_medium: 'promo \u{1F600} octubre',
    });
    for (const value of Object.values(a ?? {})) {
      expect(isWellFormed(value)).toBe(true);
      expect(value.length).toBeLessThanOrEqual(MAX_ATTRIBUTION_VALUE);
    }
    // Como lo manda la función a Pipedrive y al relay: sin escapes \ud83d sueltos
    expect(JSON.stringify({ content: formatOrigenSection(a).join('\n') })).not.toMatch(/\\u[dD][89a-fA-F]/);
  });

  it('un valor vacío después de limpiar se descarta; todo vacío da null', () => {
    expect(parseAttribution({ gclid: '  \n\t ', utm_source: '<>', landing: '', referrer: '' })).toBeNull();
    expect(parseAttribution({})).toBeNull();
  });

  it.each([
    ['/catalogo/campanas-led', '/catalogo/campanas-led'],
    ['/p?email=prueba@example.com', '/p'],
    ['/p#nombre', '/p'],
    ['/', '/'],
    ['//evil.example/x', undefined],
    ['/\\/evil.example', undefined],
    ['https://evil.example/', undefined],
    ['catalogo', undefined],
    ['?gclid=x', undefined],
  ])('página de entrada %j → %j', (landing, expected) => {
    expect(parseAttribution({ landing })?.landing).toBe(expected);
  });

  it.each([
    ['https://www.google.com/search?q=nombre+apellido', 'https://www.google.com'],
    ['http://www.mercadopublico.cl/Procurement/x?id=1#a', 'http://www.mercadopublico.cl'],
    ['https://user:pass@ejemplo.cl:8443/x', 'https://ejemplo.cl:8443'],
  ])('sitio anterior %j → solo el origen %j', (referrer, expected) => {
    expect(parseAttribution({ referrer })).toEqual({ referrer: expected });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'ftp://ejemplo.cl/',
    'no es una url',
    'https://nuevo.elights.cl/catalogo',
    'https://www.elights.cl/',
    'https://elights.cl/',
    'https://ELIGHTS.CL./',
    'https://www.google.com/' + 'a'.repeat(2048),
  ])('sitio anterior %j se descarta', (referrer) => {
    expect(parseAttribution({ referrer })).toBeNull();
  });

  it('nunca lanza, aunque leer una clave falle', () => {
    const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
    expect(parseAttribution(hostile)).toBeNull();
  });
});

describe('cleanAttributionValue e isSiteHost', () => {
  it('un valor que no es texto da vacío', () => {
    expect(cleanAttributionValue(5)).toBe('');
    expect(cleanAttributionValue(undefined)).toBe('');
  });

  it.each([
    ['elights.cl', true],
    ['nuevo.elights.cl', true],
    ['www.elights.cl', true],
    ['WWW.ELIGHTS.CL', true],
    ['elights.cl.', true],
    ['notelights.cl', false],
    ['elights.cl.evil.example', false],
    ['www.google.com', false],
  ])('%s es del sitio: %s', (host, expected) => {
    expect(isSiteHost(host)).toBe(expected);
  });
});

describe('formatOrigenSection', () => {
  it('Google Ads con UTM: canal, ids de clic antes que las UTM, página de entrada y sitio anterior', () => {
    expect(
      formatOrigenSection({
        utm_campaign: 'campanas-led-industriales',
        utm_medium: 'cpc',
        utm_source: 'google',
        gclid: GCLID,
        landing: '/catalogo/campanas-led',
        referrer: 'https://www.google.com',
      })
    ).toEqual([
      '--- ORIGEN DE LA VISITA ---',
      'Canal: Google Ads (clic en anuncio)',
      'gclid: ' + GCLID,
      'utm_source: google',
      'utm_medium: cpc',
      'utm_campaign: campanas-led-industriales',
      'Página de entrada: /catalogo/campanas-led',
      'Sitio anterior: https://www.google.com',
    ]);
  });

  it('solo gbraid (iOS): Google Ads', () => {
    expect(formatOrigenSection({ gbraid: '0AAAAAEJEMPLO' })).toEqual([
      ORIGEN_HEADING,
      'Canal: Google Ads (clic en anuncio)',
      'gbraid: 0AAAAAEJEMPLO',
    ]);
  });

  it('fbclid: Meta', () => {
    expect(formatOrigenSection({ fbclid: 'IwAREJEMPLO', landing: '/' })).toEqual([
      ORIGEN_HEADING,
      'Canal: Meta: Facebook / Instagram (fbclid)',
      'fbclid: IwAREJEMPLO',
      'Página de entrada: /',
    ]);
  });

  it('solo UTM: campaña con etiquetas UTM', () => {
    expect(
      formatOrigenSection({
        utm_source: 'newsletter',
        utm_medium: 'email',
        utm_campaign: 'octubre-2026',
        utm_content: 'boton-cotizar',
        landing: '/estudio-luminico',
      })
    ).toEqual([
      ORIGEN_HEADING,
      'Canal: Campaña con etiquetas UTM',
      'utm_source: newsletter',
      'utm_medium: email',
      'utm_campaign: octubre-2026',
      'utm_content: boton-cotizar',
      'Página de entrada: /estudio-luminico',
    ]);
  });

  it('desde Google sin etiquetas: búsqueda orgánica', () => {
    const landing = '/producto/proyector-led-solar-100w-ip65-c-panel-solar-c-control-remoto';
    expect(formatOrigenSection({ landing, referrer: 'https://www.google.com' })).toEqual([
      ORIGEN_HEADING,
      'Canal: Búsqueda orgánica (www.google.com)',
      'Página de entrada: ' + landing,
      'Sitio anterior: https://www.google.com',
    ]);
  });

  it.each(['https://www.bing.com', 'https://search.yahoo.com', 'https://duckduckgo.com', 'https://www.ecosia.org', 'https://search.brave.com', 'https://www.google.cl', 'https://www.google.com.ar'])(
    '%s es un buscador',
    (referrer) => {
      expect(formatOrigenSection({ referrer })[1]).toMatch(/^Canal: Búsqueda orgánica \(/);
    }
  );

  it('otro sitio', () => {
    expect(formatOrigenSection({ landing: '/', referrer: 'https://www.mercadopublico.cl' })).toEqual([
      ORIGEN_HEADING,
      'Canal: Otro sitio (www.mercadopublico.cl)',
      'Página de entrada: /',
      'Sitio anterior: https://www.mercadopublico.cl',
    ]);
    expect(formatOrigenSection({ referrer: 'https://google.evil.example' })[1]).toBe('Canal: Otro sitio (google.evil.example)');
  });

  it('directo: solo la página de entrada', () => {
    expect(formatOrigenSection({ landing: '/' })).toEqual([
      ORIGEN_HEADING,
      'Canal: Directo (sin campaña ni sitio anterior)',
      'Página de entrada: /',
    ]);
  });

  it('etiquetas UTM sin utm_source: sigue siendo campaña, nunca "Directo"', () => {
    expect(formatOrigenSection(parseAttribution({ utm_medium: 'email', utm_campaign: 'promo-octubre', landing: '/' }))).toEqual([
      ORIGEN_HEADING,
      'Canal: Campaña con etiquetas UTM (sin utm_source)',
      'utm_medium: email',
      'utm_campaign: promo-octubre',
      'Página de entrada: /',
    ]);
    // Las etiquetas pesan más que el sitio anterior, igual que con utm_source
    expect(formatOrigenSection({ utm_content: 'boton', referrer: 'https://mail.google.com' })[1]).toBe(
      'Canal: Campaña con etiquetas UTM (sin utm_source)'
    );
  });

  it.each(['utm_medium', 'utm_campaign', 'utm_term', 'utm_content'])('solo %s: campaña sin utm_source', (key) => {
    expect(formatOrigenSection({ [key]: 'v', landing: '/' })[1]).toBe('Canal: Campaña con etiquetas UTM (sin utm_source)');
  });

  it('sin datos: la sección aparece igual', () => {
    expect(formatOrigenSection(null)).toEqual([ORIGEN_HEADING, 'Canal: Sin datos (el formulario no envió el origen)']);
  });
});

describe('origenFromBody', () => {
  it('lee la clave attribution del cuerpo, limpia', () => {
    expect(origenFromBody({ email: 'prueba@example.com', attribution: { gclid: GCLID, email: 'x' } })).toEqual([
      ORIGEN_HEADING,
      'Canal: Google Ads (clic en anuncio)',
      'gclid: ' + GCLID,
    ]);
  });

  it.each([[undefined], [null], ['x'], [[]], [{}], [{ attribution: 'gclid=x' }], [{ attribution: [GCLID] }], [{ attribution: 7 }]])(
    'cuerpo %j: "Sin datos"',
    (body) => {
      expect(origenFromBody(body)).toEqual([ORIGEN_HEADING, 'Canal: Sin datos (el formulario no envió el origen)']);
    }
  );
});
