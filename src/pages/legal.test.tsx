// Páginas legales y de compra (PR 12): /empresa, /terminos-y-condiciones,
// /cambios-devoluciones-y-garantia, /despacho, /medios-de-pago y /politica-de-privacidad.
// Se dibujan como en el prerender (entry-server, sin sesión) y se revisan: un solo h1, la
// regla de contenido de check-prerender (sin stock ni plazos de despacho distintos de "hasta 2
// días hábiles"), los datos de la empresa desde site.ts, lo que la ley pide que digan y los
// defaults del dueño (sin orden de compra, sin representante). Despacho sin costo y retiro en
// bodega: confirmados por el dueño el 2026-10-14 (PR 12b), desde src/config/business.ts. La
// lista de comunas que no entran está completa (las 20 de la RM fuera de la Provincia de
// Santiago, src/test/freeShipping.ts) y los transportistas son los mismos en todas las páginas.
// Las frases retiradas de la PR 11 las revisa src/config/contentTruth.test.ts en todas las
// páginas fijas, también estas.
// PR 13: versión 1.1 con el archivo permanente de cada versión (public/legal/, enlaces bajo la
// versión), las casillas, la constancia y el aviso de cookies en Privacidad y Términos. La
// política debe decir lo mismo que el código: textos de las casillas (consent.ts) y del
// aviso de cookies (cookieConsent.ts).

import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { serverTree } from '@/entry-server';
import { preloadRoute } from '@/routes';
import { LEGAL_PAGES, type LegalPath } from '@/config/legal';
import { LEGAL_ARCHIVE, LEGAL_NAME, LEGAL_REPRESENTATIVE, LEGAL_RUT, LEGAL_UPDATED, LEGAL_UPDATED_LABEL, LEGAL_VERSION, SITE_URL } from '@/config/site';
import { COOKIE_CONSENT_MAX_AGE_MS, COOKIE_TEXTS } from '@/lib/cookieConsent';
import { CONSENT_TEXTS, consentTextPlain, legalArchiveHref, type LegalVersionedPath } from '../../api/_lib/forms/consent';
import {
  businessClosedDays,
  businessHours,
  businessHoursLong,
  clp,
  contactEmail,
  FREE_SHIPPING_AREA,
  FREE_SHIPPING_THRESHOLD_CLP,
  freeShippingExcludedList,
  PICKUP_PLACE,
  quoteValidityBusinessDays,
  REGION_CARRIERS,
  waBase,
} from '@/config/business';
import { NOINDEX_ROUTES, STATIC_ROUTES } from '@/lib/seo/routes';
import { PRIVACY_NOTICE } from '../../api/_lib/whatsapp/privacyNotice';
import { findPolicyBreaking } from '../../scripts/jumpseller/descriptions';
import { KNOWN_PHRASES } from '../../scripts/known-phrases';
import { claimIssues, FREE_RE, namedIn, RM_OUTSIDE_SANTIAGO, RM_PROVINCES } from '@/test/freeShipping';
import EmpresaPage from './EmpresaPage';
import TerminosPage from './TerminosPage';
import CambiosGarantiaPage from './CambiosGarantiaPage';
import DespachoPage from './DespachoPage';
import MediosPagoPage from './MediosPagoPage';
import PrivacidadPage from './PrivacidadPage';
import { REMEMBER_TEXTS } from '@/components/forms/RememberContact';
import { SAVED_CONTACT_MAX_AGE_MS, SAVED_CONTACT_STORAGE_KEY } from '@/lib/savedContact';

/** Texto como lo lee check-prerender (textOf): cada nodo de texto separado por un espacio. */
function spacedText(el: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Como contentIssues de check-prerender: todas las frases que marca la regla, una vez cada una. */
function policyIssues(text: string): string[] {
  const found: string[] = [];
  let rest = text;
  for (let phrase = findPolicyBreaking(rest); phrase; phrase = findPolicyBreaking(rest)) {
    found.push(phrase);
    rest = rest.split(phrase).join(' ');
  }
  return found;
}

/** Lo que marca la regla menos las frases permitidas en esa página (KNOWN_PHRASES, las mismas de check-prerender). */
const unknownIssues = (path: string, text: string) =>
  policyIssues(text).filter(phrase => !KNOWN_PHRASES.some(k => k.routes.includes(path) && k.phrase.test(phrase)));

/** Una sección de la página: desde el h2 que empieza con `heading` hasta el siguiente h2. */
function section(main: Element, heading: string) {
  const h2 = [...main.querySelectorAll('h2')].find(h => (h.textContent ?? '').startsWith(heading));
  if (!h2) throw new Error(`sin la sección "${heading}"`);
  const els: Element[] = [];
  for (let el = h2.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) els.push(el);
  return { els, text: els.map(el => el.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim() };
}

/**
 * Frases que ninguna página legal ni su descripción pueden decir (reglas del dueño, PR 11 y
 * PR 12b: la zona es la Provincia de Santiago, la lista de comunas que no entran no se presenta
 * como "las excluidas", sí hay retiro en bodega y los transportistas son los de REGION_CARRIERS).
 */
const FORBIDDEN = [
  '1 año base',
  'stock',
  'existencias',
  'camiones propios',
  '9:00',
  'Axiom',
  'gratis',
  'Santiago urbano',
  'área urbana',
  'Quedan excluidas',
  'comunas excluidas',
  'No tenemos',
  'retiro en oficina',
];

/** El único monto que dicen las páginas legales: el del despacho sin costo, desde la constante. */
const THRESHOLD = clp(FREE_SHIPPING_THRESHOLD_CLP);
const amountsIn = (s: string) => s.match(/\$\s?\d[\d.]*\d/g) ?? [];

/** Lo que confirmó el dueño el 2026-10-14 (README de la lista de precios por mayor), con sus palabras. */
const OWNER_EXCLUDED =
  'San Bernardo, Puente Alto, Colina y el resto de la Provincia de Chacabuco; Talagante, Peñaflor y Padre Hurtado; Melipilla y Alhué; Buin, Paine y Pirque';
/** "3 meses" de garantía, pero no "13 meses" (cookies de Google Analytics, Privacidad §7 y §10). */
const THREE_MONTHS = /(?<!\d)3 meses/;

/** Todo plazo en días u horas de un texto ("2 días hábiles", "3 a 5 días", "48 hrs"). */
const DAY_COUNTS = /\d+(?:\s*(?:a|-|y)\s*\d+)?\s*(?:d[ií]as?(?:\s+(?:h[aá]biles|corridos))?|h(?:oras|rs)?|semanas?)(?![\p{L}\p{N}])/giu;

/** La página como la genera el prerender, en un DOM para consultarla. */
async function page(path: LegalPath) {
  await preloadRoute(path);
  const html = renderToString(serverTree(path));
  expect(html).not.toContain('<!--$!-->'); // nada quedó para dibujar en el navegador
  const root = document.createElement('div');
  root.innerHTML = html;
  const main = root.querySelector('main')!;
  // text: lo que lee una persona; spaced: lo que lee check-prerender (para la regla de contenido)
  return { html, main, text: (main.textContent ?? '').replace(/\s+/g, ' ').trim(), spaced: spacedText(main) };
}

const internalRoutes = new Set<string>([...STATIC_ROUTES, ...NOINDEX_ROUTES]);
const VERSIONED: LegalPath[] = ['/terminos-y-condiciones', '/cambios-devoluciones-y-garantia', '/politica-de-privacidad'];
/** Correo para temas de datos personales, con el asunto ya escrito. */
const DATA_MAILTO = 'mailto:ventas@elights.cl?subject=Datos%20personales';
/** href de los enlaces de una sección (el selector a[href="…%20…"] de jsdom no encuentra el mailto). */
const linksIn = (els: Element[]) => els.flatMap(el => [...el.querySelectorAll('a')].map(a => a.getAttribute('href')));
/** Archivos permanentes que enlaza una página con versión: la vigente y las de LEGAL_ARCHIVE. */
const archiveHrefs = (path: LegalPath) =>
  VERSIONED.includes(path) ? [LEGAL_VERSION, ...LEGAL_ARCHIVE].map(v => legalArchiveHref(path as LegalVersionedPath, v)) : [];

describe('páginas legales y de compra: todas', () => {
  it('son las 6 de LEGAL_PAGES, todas páginas fijas indexables', () => {
    expect(LEGAL_PAGES.map(p => p.path)).toEqual([
      '/empresa',
      '/despacho',
      '/medios-de-pago',
      '/cambios-devoluciones-y-garantia',
      '/terminos-y-condiciones',
      '/politica-de-privacidad',
    ]);
    for (const { path } of LEGAL_PAGES) expect(STATIC_ROUTES as readonly string[]).toContain(path);
  });

  for (const { path, label } of LEGAL_PAGES) {
    it(`${path}: un h1, sin stock ni otros plazos de despacho, enlaces válidos y "Más información" con las demás`, async () => {
      const { html, main, text, spaced } = await page(path);
      expect(main.querySelectorAll('h1')).toHaveLength(1);
      expect(unknownIssues(path, spaced)).toEqual([]);
      expect(unknownIssues(path, text)).toEqual([]);
      for (const phrase of FORBIDDEN) expect(html, phrase).not.toContain(phrase);
      for (const amount of amountsIn(text)) expect(amount, `${path}: monto`).toBe(THRESHOLD);
      expect(html).not.toMatch(THREE_MONTHS);
      expect(text).not.toMatch(/\[C\d+\]|\[nombre|LEGAL_UPDATED|TODO/); // sin marcadores del borrador
      // Enlaces: internos a páginas de la app o a los archivos de versión de esta misma página;
      // externos solo correo, teléfono, WhatsApp y SERNAC
      const archives: string[] = [];
      for (const a of main.querySelectorAll('a')) {
        const href = a.getAttribute('href') ?? '';
        if (href.startsWith('/legal/')) archives.push(href);
        else if (href.startsWith('/')) expect(internalRoutes.has(href), `${path}: enlace a ${href}`).toBe(true);
        else expect(href, `${path}: enlace a ${href}`).toMatch(/^(?:mailto:ventas@elights\.cl(?:\?subject=Datos%20personales)?|tel:\+56991273128|https:\/\/wa\.me\/56991273128|https:\/\/www\.sernac\.cl)$/);
      }
      expect(archives, `${path}: enlaces a los archivos de versión`).toEqual(archiveHrefs(path));
      const nav = main.querySelector('nav[aria-label="Más información"]')!;
      expect([...nav.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(LEGAL_PAGES.filter(p => p.path !== path).map(p => p.path));
      expect(nav.textContent).not.toContain(label);
      // La versión solo en los textos que la llevan
      const version = `Versión ${LEGAL_VERSION}. Vigente desde el ${LEGAL_UPDATED_LABEL}.`;
      const archiveLinks = main.querySelector('[data-legal-archive="omit"]');
      if (VERSIONED.includes(path)) {
        expect(text).toContain(version);
        expect(main.querySelector('time')?.getAttribute('datetime')).toBe(LEGAL_UPDATED);
        // Bajo la versión: guardar o imprimir la vigente y las anteriores (fuera del archivo)
        expect(archiveLinks?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
          `Guardar o imprimir esta versión · Versiones anteriores: ${LEGAL_ARCHIVE.join(', ')}`,
        );
        const [save, ...previous] = [...archiveLinks!.querySelectorAll('a')];
        expect(save.textContent).toBe('Guardar o imprimir esta versión');
        expect(save.getAttribute('href')).toBe(legalArchiveHref(path as LegalVersionedPath));
        expect(previous.map(a => [a.textContent, a.getAttribute('href')])).toEqual(
          LEGAL_ARCHIVE.map(v => [v, legalArchiveHref(path as LegalVersionedPath, v)]),
        );
        // Archivos estáticos (no rutas de la app) y fuera del archivo de la versión
        expect(archiveLinks!.querySelector('p, div')).toBeNull(); // extractArticle lo quita entero
      } else {
        expect(text).not.toContain('Vigente desde');
        expect(archiveLinks).toBeNull();
      }
    });
  }

  it('título, canonical, migas y descripción de cada página (sin imagen propia: la de la marca)', async () => {
    for (const { path, label } of LEGAL_PAGES) {
      const Page = { '/empresa': EmpresaPage, '/terminos-y-condiciones': TerminosPage, '/cambios-devoluciones-y-garantia': CambiosGarantiaPage, '/despacho': DespachoPage, '/medios-de-pago': MediosPagoPage, '/politica-de-privacidad': PrivacidadPage }[path];
      const { unmount } = render(
        <HelmetProvider>
          <MemoryRouter initialEntries={[path]}>
            <Page />
          </MemoryRouter>
        </HelmetProvider>,
      );
      await waitFor(() => expect(document.title).toBe(`${label} | eLIGHTS Chile`));
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(SITE_URL + path);
      const ld = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent ?? '{}'));
      const crumbs = ld.find(d => d['@type'] === 'BreadcrumbList');
      expect(crumbs.itemListElement.map((c: { name: string }) => c.name)).toEqual(['Inicio', label]);
      if (path === '/empresa') expect(ld.find(d => d['@type'] === 'Organization')).toMatchObject({ legalName: LEGAL_NAME, taxID: LEGAL_RUT });
      // La descripción es lo que muestran Google y las vistas previas: misma regla de contenido que el cuerpo
      const meta = (sel: string) => document.head.querySelector(sel)?.getAttribute('content') ?? '';
      const description = meta('meta[name="description"]');
      expect(description, `${path}: description`).not.toBe('');
      expect(meta('meta[property="og:description"]')).toBe(description);
      expect(meta('meta[name="twitter:description"]')).toBe(description);
      expect(policyIssues(description), `${path}: description`).toEqual([]);
      for (const phrase of FORBIDDEN) expect(description, `${path}: description`).not.toContain(phrase);
      for (const amount of amountsIn(description)) expect(amount, `${path}: monto en la descripción`).toBe(THRESHOLD);
      if (FREE_RE.test(description)) expect(claimIssues(description), `${path}: description`).toEqual([]);
      expect(description, `${path}: description`).not.toMatch(THREE_MONTHS);
      // el link de pago es de Flow y Mercado Pago ya no se usa (dueño, 2026-10-25)
      expect(description, `${path}: description`).not.toMatch(/mercado ?pago|jumpseller/i);
      if (path === '/medios-de-pago') {
        expect(description).toContain('link de pago de Flow');
        expect(description).not.toMatch(/sin inter[eé]s|Khipu|ETpay|FlowPay|más de 30/i); // no activos en Flow
        expect(description.length).toBeLessThanOrEqual(160);
      }
      if (path === '/despacho') {
        expect([...description.matchAll(DAY_COUNTS)].map(m => m[0])).toEqual(['2 días hábiles']);
        expect(description).toContain('Despacho en hasta 2 días hábiles');
        expect(description).toContain(`Sin costo sobre ${THRESHOLD} con IVA en la ${FREE_SHIPPING_AREA.name}.`);
        expect(description).toContain('También retiro en bodega.');
        expect(description).not.toContain('a todo Chile'); // en regiones se suma el viaje
        expect(description.length).toBeLessThanOrEqual(160); // lo que muestra Google sin cortar
      }
      unmount();
    }
  });

  it('el horario largo tiene las mismas horas que el de PR 11 (businessHours)', () => {
    const times = (s: string) => s.match(/\d{1,2}:\d{2}/g);
    expect(times(businessHoursLong)).toEqual(times(businessHours));
    expect(businessHoursLong).toMatch(/^lunes a viernes, /);
    expect(businessClosedDays).toBe('Sábados, domingos y festivos, cerrado.');
  });
});

describe('páginas legales y de compra: contenido', () => {
  it('/empresa: razón social, RUT, Santiago, contacto y horario; sin representante mientras no haya dato; sin proveedores ni postulaciones', async () => {
    const { main, text } = await page('/empresa');
    expect(main.querySelector('h1')?.textContent).toBe('Quiénes somos');
    for (const s of [LEGAL_NAME, `RUT: ${LEGAL_RUT}`, 'Santiago, Región Metropolitana, Chile', contactEmail, '+56 9 9127 3128', businessHoursLong, businessClosedDays]) {
      expect(text).toContain(s);
    }
    expect(text).toContain('Despacho en hasta 2 días hábiles');
    if (LEGAL_REPRESENTATIVE === null) expect(text).not.toContain('Representante legal');
    expect(text).not.toMatch(/proveedores@|Postulaci[oó]n|Trabaja con nosotros/i);
    expect(main.querySelector(`a[href="${waBase}"]`)?.getAttribute('target')).toBe('_blank');
  });

  it('/terminos-y-condiciones: vendedor, compra por link de pago, IVA, factura, vigencia, retracto, garantía y ley', async () => {
    const { main, text } = await page('/terminos-y-condiciones');
    expect(main.querySelector('h1')?.textContent).toBe('Términos y condiciones de venta');
    for (const s of [
      LEGAL_NAME,
      LEGAL_RUT,
      'link de pago',
      'incluyen IVA',
      'factura electrónica',
      'boleta electrónica',
      `${quoteValidityBusinessDays} días hábiles`,
      'derecho a retracto',
      '10 días corridos',
      'el plazo es de 90 días',
      'garantía legal de 6 meses',
      'Despacho en hasta 2 días hábiles',
      'Ley N° 19.496',
      'SERNAC',
    ]) {
      expect(text, s).toContain(s);
    }
    expect(quoteValidityBusinessDays).toBe(10);
    // Retracto y garantía para todos los compradores, con cualquier medio de pago (default del dueño)
    expect(text).toContain('Valen igual si compras como persona o para una empresa, incluidos el derecho a retracto y la garantía.');
    expect(section(main, '2.').text).toContain('cualquiera sea el medio de pago');
    expect(text).not.toContain('que pagues con el link de pago o por transferencia');
    // §3.5: cuándo queda hecha la compra también con crédito acordado
    expect(section(main, '3.').text).toContain('Si acordamos pago con crédito (ver Medios de pago), queda hecha cuando aceptas por escrito la cotización con esas condiciones de pago.');
    // §3 y §4: el despacho puede ir sin costo (monto y zona desde business.ts, PR 12b)
    expect(section(main, '3.').text).toContain('el costo del despacho por separado (o si va sin costo o por pagar)');
    const precios = section(main, '4.');
    expect(precios.text).toContain(
      `la cotización indica que va sin costo (compras sobre ${THRESHOLD} con IVA, con entrega en la ${FREE_SHIPPING_AREA.name}) o por pagar. Las comunas que no entran y las demás condiciones están en Despacho.`,
    );
    expect(precios.els.some(el => el.querySelector('a[href="/despacho"]'))).toBe(true);
    // §9: en regiones, los 2 días hábiles son hasta la entrega al transportista; retiro en bodega sin dirección
    const despacho = section(main, '9.').text;
    expect(despacho).toContain('En regiones, es el plazo para entregar tu pedido al transportista; a eso se suma el tiempo de viaje');
    expect(despacho).toContain(`También puedes retirar tu pedido en ${PICKUP_PLACE}: la dirección exacta te la damos cuando tu pago está acreditado.`);
    // §10: las exclusiones del retracto (DS 52) y que lo conseguido a pedido sí lo tiene
    const retracto = section(main, '10.').text;
    for (const s of [
      'No hay derecho a retracto en los casos que permite la ley',
      'productos ya instalados o usados más allá de lo necesario para revisarlos',
      'productos fabricados o adaptados según tus especificaciones',
      '"sin derecho a retracto"',
      'Un producto del catálogo que conseguimos a pedido sí tiene derecho a retracto.',
      'hasta antes de que comiencen',
    ]) {
      expect(retracto, s).toContain(s);
    }
    // §11: una garantía del fabricante mayor que 6 meses da los mismos derechos (Ley 19.496 art. 21)
    expect(section(main, '11.').text).toContain('durante ese plazo mayor tienes los mismos derechos');
    if (LEGAL_REPRESENTATIVE === null) expect(text).not.toContain('Representante legal');
  });

  it('/terminos-y-condiciones (PR 13): casilla del pedido, copia permanente al pagar, novedades solo con la casilla y versiones', async () => {
    const { main } = await page('/terminos-y-condiciones');
    const buying = section(main, '3.').text;
    // §3.1: la casilla obligatoria de /solicitar-pedido (consent.ts, privacyWithTerms)
    expect(buying).toContain('Al enviar una solicitud de pedido marcas que aceptas estos términos y que leíste la Política de privacidad.');
    expect(consentTextPlain(CONSENT_TEXTS.privacyWithTerms)).toMatch(/^Acepto los Términos y condiciones, leí la Política de privacidad/);
    // §3.6: copia de los términos vigentes al pagar (Ley 19.496 art. 12 A), con el archivo permanente
    expect(buying).toContain(
      'una copia de estos términos en la versión vigente al pagar (adjunta o en un enlace permanente que puedes guardar o imprimir)',
    );
    // §14: novedades solo por correo y con la casilla opcional, sin marcar; baja por el canal de datos personales
    const marketing = section(main, '14.');
    expect(marketing.text).toContain('Solo te enviaremos novedades u ofertas por correo si marcas la casilla para recibirlas en un formulario: es opcional y viene sin marcar.');
    expect(linksIn(marketing.els)).toContain(DATA_MAILTO);
    expect(consentTextPlain(CONSENT_TEXTS.marketing)).toContain('por correo (opcional)');
    // §15: cada versión en un enlace permanente; la compra se rige por la vigente al pagar
    const changes = section(main, '15.').text;
    expect(changes).toContain('Cada versión indica su fecha y queda publicada en un enlace permanente, junto con las anteriores.');
    expect(changes).toContain('Tu compra se rige por la versión vigente cuando pagaste; si cambió desde tu solicitud, la cotización te lo indica.');
    expect(changes).not.toContain('pídela a');
  });

  it('/cambios-devoluciones-y-garantia: retracto de 10 días corridos (90 sin confirmación), 6 meses, reembolso en 45 días y quién paga el traslado', async () => {
    const { main, text } = await page('/cambios-devoluciones-y-garantia');
    expect(main.querySelector('h1')?.textContent).toBe('Cambios, devoluciones y garantía');
    for (const s of ['10 días corridos', '6 meses', '45 días', '90 días', contactEmail, businessHoursLong]) expect(text, s).toContain(s);
    expect(text).toContain('El traslado del producto de vuelta a eLIGHTS es de tu cargo'); // retracto
    expect(text).toContain('de ida y de vuelta, es de cargo de eLIGHTS'); // garantía legal
    expect(text).toContain('Si la ficha no indica un plazo de garantía, se aplica la garantía legal de 6 meses.');
    expect(text).toContain('durante ese plazo tienes los mismos derechos que en la garantía legal'); // resumen
    // §1 retracto: con cualquier medio de pago, por el mismo medio de la compra y solo con las exclusiones del DS 52
    const retracto = section(main, '1.');
    for (const s of [
      'cualquiera sea el medio de pago',
      'Lo damos igual a personas y a empresas.',
      // Sin WhatsApp desde la versión 1.3: ahí atiende el asistente, que no reconoce el retracto (PR 13x)
      'Avísanos por correo a ventas@elights.cl o por teléfono al +56 9 9127 3128 (o por el mismo medio con que compraste)',
      'Cuándo no aplica.',
      'productos ya instalados o usados más allá de lo necesario para revisarlos',
      'productos fabricados o adaptados según tus especificaciones',
      'especificaciones que tú definiste',
      '"sin derecho a retracto"',
      'Un producto del catálogo que conseguimos a pedido sí tiene derecho a retracto.',
    ]) {
      expect(retracto.text, s).toContain(s);
    }
    expect(retracto.text).not.toMatch(/pedidos\s+especialmente|con pago por link o por transferencia/);
    expect(retracto.els.some(el => el.querySelector('a[href="tel:+56991273128"]'))).toBe(true);
    // §2 garantía legal: no excluye lo que instaló eLIGHTS; vale para empresas de cualquier tamaño
    const legal = section(main, '2.').text;
    expect(legal).toContain('Daños causados después de la recepción, por ti o por terceros');
    expect(legal).toContain('Si la instalación la hizo eLIGHTS, respondemos nosotros por esos daños.');
    expect(legal).toContain('Las empresas, de cualquier tamaño, también pueden usar la garantía legal.');
    expect(legal).not.toMatch(/micro y pequeñas/);
    // §3 garantía del fabricante: un plazo mayor que 6 meses reemplaza a los 6 meses con los mismos derechos (art. 21)
    const fabricante = section(main, '3.').text;
    expect(fabricante).toContain('la ley hace que ese plazo mayor reemplace a los 6 meses');
    expect(fabricante).toContain('tienes los mismos derechos de la garantía legal (reparación sin costo, cambio o devolución de lo pagado, a tu elección)');
  });

  it('/despacho: hasta 2 días hábiles; regiones por pagar sin plazo publicado', async () => {
    const { main, text } = await page('/despacho');
    expect(main.querySelector('h1')?.textContent).toBe('Despacho');
    expect(text).toContain('Despacho en hasta 2 días hábiles');
    expect(text).toContain('Te lo informamos en la cotización, antes de que pagues.'); // tiempo a regiones
    expect(text).toContain('En regiones, es el plazo para entregar tu pedido al transportista; a eso se suma el tiempo de viaje');
    // El único plazo de la página es "2 días hábiles": ningún tiempo de viaje a regiones publicado
    expect([...text.matchAll(DAY_COUNTS)].map(m => m[0])).toEqual(['2 días hábiles']);
    expect([...main.querySelectorAll('h2')].map(h => h.textContent).slice(0, 4)).toEqual([
      FREE_SHIPPING_AREA.name,
      'Regiones',
      'Costo del despacho',
      'Retiro en bodega',
    ]);
    // Regiones: la lista de transportistas del dueño (2026-10-25, versión 1.9), la misma de la Política §5
    expect(REGION_CARRIERS).toBe('Starken, Cruz del Sur, ECOEx, Varmontt, Samex, PDQ, Pullman Cargo, Chilexpress, Transportes Mena u otro operador');
    const regiones = section(main, 'Regiones').text;
    expect(regiones).toContain(`El despacho a regiones va por pagar, vía ${REGION_CARRIERS}.`);
    expect(text).not.toMatch(/retiro en tienda/i);
    // la cotización detalla el despacho; el link de Flow cobra un solo monto (dueño, 2026-10-25)
    expect(section(main, 'Costo del despacho').text).toContain(
      'la cotización lo muestra por separado, o indica que va sin costo o por pagar. El link de pago cobra el total de la cotización.',
    );
    // Seguimiento solo por correo (dueño, 2026-10-16): el WhatsApp lo atiende un asistente que no
    // responde consultas de pedidos.
    const seguimiento = section(main, 'Seguimiento').text;
    expect(seguimiento).toContain('te mandamos por correo el nombre del transportista y el número de seguimiento');
    expect(seguimiento).toContain('con tu número de pedido o de cotización');
    expect(seguimiento).not.toMatch(/whatsapp/i);
  });

  it('/despacho: sin costo sobre el monto (con IVA) en la Provincia de Santiago, con las comunas excluidas', async () => {
    // Lo que confirmó el dueño: si cambia, cambia en business.ts y aquí
    expect(FREE_SHIPPING_THRESHOLD_CLP).toBe(250000);
    expect(FREE_SHIPPING_AREA.name).toBe('Provincia de Santiago');
    expect(FREE_SHIPPING_AREA.excluded.join('; ')).toBe(OWNER_EXCLUDED);
    const { main, text, spaced } = await page('/despacho');
    const zona = section(main, FREE_SHIPPING_AREA.name).text;
    expect(zona).toContain(`Despacho sin costo si el total de tu compra, con IVA, es mayor a ${THRESHOLD} y la entrega es en la Provincia de Santiago.`);
    // Las comunas del dueño, con sus palabras, y después las 7 que su lista no nombra: no es una lista de ejemplos
    expect(zona).toContain(
      `No entran las comunas de otras provincias de la Región Metropolitana: ${OWNER_EXCLUDED}; Calera de Tango, San José de Maipo, Isla de Maipo, El Monte, Curacaví, María Pinto y San Pedro.`,
    );
    expect(freeShippingExcludedList.startsWith(OWNER_EXCLUDED)).toBe(true);
    // El monto exacto o menos (la condición es "mayor a"), o fuera de la zona: el costo va en la cotización o por pagar
    expect(zona).toContain(`En compras de ${THRESHOLD} o menos con IVA, o con entrega fuera de esta zona, el costo del despacho te lo informamos en la cotización`);
    expect(zona).toContain('o la cotización indica que va por pagar');
    expect(zona).toContain('Si no sabes si tu comuna está en la Provincia de Santiago, te lo confirmamos en la cotización.');
    expect(zona).toContain('condición permanente de venta, no una promoción');
    expect(amountsIn(text)).toEqual([THRESHOLD, THRESHOLD]); // escrito desde la constante, con clp()
    expect(THRESHOLD).toBe('$250.000');
    expect(policyIssues(spaced)).toEqual([]);
  });

  it('/despacho: la lista de comunas que no entran está completa (las 20 de la RM fuera de la Provincia de Santiago)', async () => {
    const { main } = await page('/despacho');
    const item = section(main, FREE_SHIPPING_AREA.name).els.flatMap(el => [...el.querySelectorAll('li')]).find(li => li.textContent?.startsWith('No entran'));
    const text = (item?.textContent ?? '').replace(/\s+/g, ' ');
    expect(RM_OUTSIDE_SANTIAGO).toHaveLength(20);
    expect(Object.values(RM_PROVINCES).flat()).toHaveLength(52);
    // Lampa y Tiltil van como "el resto de la Provincia de Chacabuco" (palabras del dueño)
    const missing = RM_OUTSIDE_SANTIAGO.filter(c => !namedIn(text, c) && !((RM_PROVINCES.Chacabuco as readonly string[]).includes(c) && text.includes('el resto de la Provincia de Chacabuco')));
    expect(missing).toEqual([]);
    // Ninguna comuna de la Provincia de Santiago aparece como excluida
    expect(RM_PROVINCES.Santiago.filter(c => namedIn(text, c))).toEqual([]);
  });

  it('/despacho: retiro en la bodega de Quinta Normal, sin publicar la dirección', async () => {
    const { main, text } = await page('/despacho');
    expect(PICKUP_PLACE).toBe('nuestra bodega en Quinta Normal');
    const retiro = section(main, 'Retiro en bodega').text;
    expect(retiro).toContain('Si prefieres, retiras tu pedido en nuestra bodega en Quinta Normal, sin pagar despacho.');
    expect(retiro).toContain('La dirección exacta te la damos solo cuando tu pago está acreditado');
    // Ninguna dirección: ni números ni nombres de calle (la dirección se da solo con el pago acreditado)
    expect(retiro).not.toMatch(/\d|\b(?:calle|avenida|av\.|pasaje|camino|n°|#)/i);
    expect(text.match(/Quinta Normal/g)).toHaveLength(1);
    expect(text).not.toMatch(/No tenemos|tienda abierta|retiro en oficina/i);
  });

  it('clp(): pesos con punto de miles, sin Intl (el servidor y el navegador dibujan lo mismo)', () => {
    expect([0, 999, 1000, 250000, 249999.6, 1234567].map(clp)).toEqual(['$0', '$999', '$1.000', '$250.000', '$250.000', '$1.234.567']);
  });

  it('/medios-de-pago: link de pago de Flow con los medios activos, transferencia, crédito caso a caso; sin orden de compra', async () => {
    const { text } = await page('/medios-de-pago');
    // Los medios activos en la cuenta Flow (panel revisado el 2026-10-25)
    for (const s of ['Link de pago de Flow', 'flow.cl', 'tarjeta de crédito o débito, por Webpay', 'Onepay', 'MACH', 'Servipag', 'Banca.me', `cuenta de ${LEGAL_NAME}`, 'cheque a 30 o 60 días', 'vale vista', 'boleta electrónica', 'factura electrónica', 'incluyen IVA']) {
      expect(text, s).toContain(s);
    }
    // desde ahí corre el despacho
    expect(text).toContain('Si pagas en efectivo con el cupón de Servipag, cuando lo pagas en la sucursal.');
    expect(text).toContain('Crédito acordado: cuando recibimos el cheque o el vale vista.');
    expect(text).not.toMatch(/orden de compra|Mercado Público/i);
    // el link no es de Jumpseller y Mercado Pago ya no se usa (dueño, 2026-10-25)
    expect(text).not.toMatch(/Jumpseller|Mercado Pago/i);
    // no están activos en la cuenta Flow
    expect(text).not.toMatch(/sin inter[eé]s|Khipu|ETpay|FlowPay|más de 30/i);
  });

  it('/politica-de-privacidad: responsable, encargados (sin Axiom), plazos, derechos, cookies y canal "Datos personales"', async () => {
    const { main, text } = await page('/politica-de-privacidad');
    for (const s of [LEGAL_NAME, LEGAL_RUT, 'Vercel', 'Pipedrive', 'Google', 'Twilio', 'Anthropic', 'Upstash', 'Jumpseller', '30 días corridos', 'Sin tu consentimiento, este sitio no instala cookies', '24 meses', '6 años', 'Ley N° 21.719']) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toContain('Axiom');
    expect(text).toContain('no los subimos a Google Ads ni a Meta');
    // §2 y §5 (versión 1.8): el link de pago es de Flow; Jumpseller, catálogo y solicitudes de su tienda; sin Mercado Pago
    expect(section(main, '2.').text).toContain('Si pagas con el link de pago, Flow nos informa el estado de tu pago.');
    expect(section(main, '5.').text).toContain(
      'Jumpseller: plataforma de ventas: catálogo, precios e imágenes de productos, y registro de las solicitudes hechas en nuestra tienda de Jumpseller.',
    );
    expect(section(main, '5.').text).toContain(
      'Medios de pago: Flow (flow.cl), la plataforma con la que cobramos, y el medio que elijas al pagar (Transbank para Webpay y Onepay, MACH, Servipag o Banca.me): reciben los datos de tu pago y los que ingresas al pagar.',
    );
    expect(section(main, '7.').text).toContain('Registro técnico de las solicitudes de nuestra tienda de Jumpseller (Upstash): 30 días.');
    expect(text).not.toMatch(/Mercado Pago|links de pago|pedido pagado|Registro técnico de pedidos/i);
    // §5: los transportistas de /despacho (REGION_CARRIERS): la lista del dueño del 2026-10-25 (versión 1.9)
    expect(section(main, '5.').text).toContain(`Transportistas (${REGION_CARRIERS}, incluido el que elijas): reciben tu nombre, dirección y teléfono`);
    // §4: una persona revisa y responde cada solicitud registrada (en WhatsApp, sin correo no hay registro: prueba de la PR 13x)
    expect(text).toContain('una persona de nuestro equipo revisa y responde cada solicitud que queda registrada en nuestro sistema de seguimiento');
    // §4: el aviso del asistente de WhatsApp con IA; si piden una persona, la respuesta va por correo (regla del dueño)
    const automated = section(main, '4.').text;
    for (const s of ['Asistente de WhatsApp.', 'asistente automático', 'Claude, de Anthropic', 'una persona de nuestro equipo te responde por correo']) {
      expect(automated, s).toContain(s);
    }
    // §6: sin afirmar acuerdos de tratamiento de datos que el dueño no ha confirmado (C26 d)
    expect(section(main, '6.').text).not.toMatch(/cláusulas contractuales|acuerdos de tratamiento de datos, que incluyen/);
    // §8: hasta el 30-11-2026 rige la Ley 19.628 original (2 días hábiles, juez civil o SERNAC); desde el 1-12, la 21.719
    const rights = section(main, '8.').text;
    for (const s of [
      'Hasta el 30 de noviembre de 2026 (Ley N° 19.628 en su texto anterior): respondemos dentro de 2 días hábiles.',
      'juez de letras en lo civil (art. 16 de la Ley N° 19.628)',
      'Servicio Nacional del Consumidor (SERNAC)',
      'Desde el 1 de diciembre de 2026 (con las modificaciones de la Ley N° 21.719): respondemos dentro de 30 días corridos',
      'ante la Agencia de Protección de Datos Personales dentro de 30 días hábiles',
    ]) {
      expect(rights, s).toContain(s);
    }
    expect(rights.indexOf('Hasta el 30 de noviembre')).toBeLessThan(rights.indexOf('Agencia de Protección'));
    // §9: los registros técnicos sí pueden tener datos de clientes (api/ los registra)
    const security = section(main, '9.').text;
    expect(security).not.toContain('no contengan datos de clientes');
    expect(security).toContain('pueden incluir tu teléfono, nombre, empresa, correo, comuna o un extracto de tu mensaje');
    const hrefs = [...main.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs).toContain('mailto:ventas@elights.cl?subject=Datos%20personales');
    expect(main.querySelectorAll('table tbody tr')).toHaveLength(13); // 1.5: suma la finalidad de Meta; 1.7, recordar tus datos
    expect(main.querySelector('table')?.parentElement?.className).toContain('overflow-x-auto'); // legible en el teléfono
    if (LEGAL_REPRESENTATIVE === null) expect(text).not.toContain('Representante legal');
  });

  it('/politica-de-privacidad (PR 13x, versión 1.3): el asistente de WhatsApp como funciona hoy en el código', async () => {
    const { main, text } = await page('/politica-de-privacidad');
    const clean = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const automated = section(main, '4.');
    const bot = automated.els.map(clean).find(t => t.startsWith('Asistente de WhatsApp.'));
    expect(bot, 'falta el párrafo «Asistente de WhatsApp.» del §4').toBeDefined();
    for (const s of [
      // En ese número siempre responde el asistente; sus respuestas son plantillas (flowEngine.ts)
      'En nuestro WhatsApp te atiende un asistente automático.',
      // buildRepregunta1 repite el proyecto y el tipo de luz que devolvió la IA
      'Sus respuestas son mensajes predefinidos, que pueden repetir datos que reconoció en tus mensajes (como el proyecto o el tipo de luz); no las redacta una inteligencia artificial.',
      // La IA (claudeAgent.ts) recibe los mensajes recientes y el ProfileName, extrae datos y resume
      'El asistente envía tus mensajes recientes y el nombre de tu perfil a una inteligencia artificial (Claude, de Anthropic)',
      'y escribe un resumen para nuestro equipo.',
      // Paso a una persona: la respuesta va por correo (regla del dueño), así que hace falta el correo
      'Si pides hablar con una persona, una persona de nuestro equipo te responde por correo, así que necesitamos tu correo.',
      // flowEngine.ts no siempre lo pide: «necesito…» (COMMERCIAL_INTENT_RE) no deriva y, si nombran a
      // Claudio o Constanza, MSG_EXECUTIVE da sus correos
      'El asistente no siempre te lo pide; por ejemplo, si nombras a uno de nuestros ejecutivos, te da su correo para que le escribas.',
      // Sin correo no se crea el negocio en Pipedrive (hasMinCommercial)
      'Sin tu correo, tu solicitud no queda registrada en nuestro sistema de seguimiento y no llega a nuestro equipo',
      // Aviso breve de la PR 13w (privacyNotice.ts)
      'En su primera respuesta, el asistente te muestra un aviso breve con el enlace a esta política.',
    ]) {
      expect(bot, s).toContain(s);
    }
    // No promete que el asistente siempre pida el correo (la frase que el código no cumple)
    expect(bot).not.toContain('el asistente te pide tu correo, si aún no lo tiene');
    // Ya no dice que la IA responde, ni ofrece una persona «en cualquier momento», por WhatsApp o por teléfono
    expect(text).not.toContain('para entender tu consulta y responderla');
    expect(text).not.toMatch(/en cualquier momento puedes pedir hablar con una persona/i);
    expect(text).not.toContain('Las primeras respuestas en nuestro WhatsApp');
    for (const sentence of bot!.split(/(?<=[.;])\s+/)) {
      if (/inteligencia artificial/.test(sentence)) expect(sentence).not.toMatch(/\brespond(e|er|erla|erte)\b/i);
    }
    expect(bot).not.toMatch(/en cualquier momento/i);
    expect(bot).not.toMatch(/llam(ar|ada|aremos)|tel[eé]fono|por (este mismo canal|WhatsApp)/i);
    // §4 Priorización: en WhatsApp no hay puntaje; «Alta» si pidió una persona (pipedriveLead.ts)
    expect(automated.text).toContain(
      'En WhatsApp no hay puntaje: tu solicitud queda en "Alta" si el asistente detecta que pides hablar con una persona y en "Normal" si no',
    );
    // §2: el número y el nombre del perfil llegan solos (webhook.ts: From y ProfileName); también los adjuntos (NumMedia)
    expect(section(main, '2.').text).toContain(
      'Si nos escribes por WhatsApp, también recibimos automáticamente tu número y el nombre de tu perfil de WhatsApp.',
    );
    // Desde la 1.6, también desde el sitio (adjuntos del cotizador)
    expect(section(main, '2.').text).toContain(
      'Tus mensajes: lo que nos escribes o nos envías (por ejemplo, fotos o archivos) por correo, WhatsApp o desde el sitio.',
    );
    // §7: conversación en Upstash por 7 días; Twilio y Anthropic según las condiciones que aceptamos (encargados, §5), no
    // «según sus propias políticas» ni «plazos breves»
    const items = section(main, '7.').els.flatMap(el => [...el.querySelectorAll('li')].map(clean));
    const item = (start: string) => items.find(t => t.startsWith(start)) ?? '';
    expect(item('Asistente de WhatsApp:')).toBe(
      'Asistente de WhatsApp: guarda en Upstash el historial reciente de la conversación, los datos que va reuniendo de tu solicitud y si ya te mostró el aviso de privacidad, hasta 7 días después de tu último mensaje. Lo que registramos de la conversación en nuestro sistema de seguimiento sigue el plazo de las solicitudes.',
    );
    // Desde la 1.4, Twilio (con su plazo configurado) y Anthropic van por separado
    expect(item('Anthropic')).toContain(
      'conserva los registros de los mensajes que pasan por su servicio según las condiciones de servicio que aceptamos al contratarlo.',
    );
    expect(item('Anthropic')).not.toMatch(/breves|propias políticas/);
    expect(item('Registros técnicos del sitio y del asistente de WhatsApp')).toContain('los plazos breves que define cada proveedor');
  });

  it('/politica-de-privacidad (PR 13z, versión 1.4): revisión de las conversaciones con el asistente para mejorarlo', async () => {
    const { main, text } = await page('/politica-de-privacidad');
    const clean = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    // §3: finalidad nueva con su base legal y oposición
    const rows = [...main.querySelectorAll('table tbody tr')].map(clean);
    const row = rows.find(r => r.startsWith('Revisar las conversaciones con el asistente de WhatsApp'));
    expect(row, 'falta la finalidad de la revisión del asistente').toBeDefined();
    expect(row).toContain('para corregir sus errores y mejorarlo (ver punto 4)');
    expect(row).toContain('Interés legítimo de eLIGHTS en que el asistente entienda bien las solicitudes y las registre completas; puedes oponerte');
    // §3: hasta el 30-11, la base es la autorización, y el aviso del bot informa la finalidad
    expect(section(main, '3.').text).toContain(
      'En ese período, la revisión de las conversaciones con el asistente de WhatsApp (punto 4) se basa en la autorización que nos das al escribirle; el asistente te informa esa finalidad en su aviso de privacidad, al final de su primera respuesta.',
    );
    // §4: qué se guarda, qué se quita, quién la revisa, para qué no se usa y cómo oponerse
    const review = section(main, '4.').els.map(clean).find(t => t.startsWith('Revisión del asistente.'));
    expect(review, 'falta el párrafo «Revisión del asistente.» del §4').toBeDefined();
    for (const s of [
      'Algunas semanas, como la primera de cada mes, guardamos una copia de las conversaciones con el asistente',
      'El mismo día cambiamos tu teléfono por un código y quitamos los datos de contacto que reconocemos (correo, RUT, teléfonos y direcciones), y también tu nombre y tu empresa cuando los reconocemos.',
      'Esa copia la revisa nuestro equipo con ayuda de Claude, la inteligencia artificial de Anthropic.',
      'La revisión no decide nada sobre ti ni se usa para enviarte publicidad, y para probar el asistente usamos mensajes inventados, nunca los tuyos.',
      'Puedes oponerte escribiéndonos a ventas@elights.cl con el asunto «Datos personales».',
    ]) {
      expect(review, s).toContain(s);
    }
    // §5: Anthropic también para la revisión
    expect(section(main, '5.').text).toContain(
      'Anthropic PBC (Estados Unidos): inteligencia artificial del asistente de WhatsApp y de la revisión de sus conversaciones (punto 4).',
    );
    // §7: plazos de la copia y de la tabla de claves; Twilio con su plazo configurado
    const items = section(main, '7.').els.flatMap(el => [...el.querySelectorAll('li')].map(clean));
    const item = (start: string) => items.find(t => t.startsWith(start)) ?? '';
    const copy = item('Copia de revisión del asistente');
    expect(copy).toContain('no guardamos la exportación original');
    expect(copy).toContain('esa copia la borramos a los 60 días');
    expect(copy).toContain('La tabla que une cada código con tu teléfono la guardamos cifrada y la borramos dentro de 14 días');
    expect(item('Twilio')).toMatch(/^Twilio \(asistente de WhatsApp\): guarda los registros de los mensajes, con su texto, por 400 días, el plazo que tenemos configurado en su servicio, y además un respaldo de esos registros, que conservamos para revisar y mejorar el asistente \(punto 4\) mientras sirva para ese fin\.$/);
    // §8 y §9
    expect(section(main, '8.').text).toContain('la priorización automática y la revisión de tus conversaciones con el asistente;');
    expect(section(main, '9.').text).toContain('salvo la copia de revisión del asistente, que tiene sus propios plazos (punto 7).');
    // El aviso del bot informa la finalidad nueva
    expect(PRIVACY_NOTICE).toContain('para responder tu consulta y mejorar este asistente');
    expect(text).not.toContain('{TWILIO_RETENTION_DAYS}');
  });

  it('/cambios-devoluciones-y-garantia y /terminos-y-condiciones (PR 13x, versión 1.3): retracto, garantía y reclamos por correo, no por el WhatsApp del asistente', async () => {
    // En el WhatsApp atiende el asistente, que no reconoce estos casos y sin correo no registra nada
    // (flowEngine.ts, hasMinCommercial; Política §4). Respondemos por correo (regla del dueño).
    const noWhatsApp = /por WhatsApp|al WhatsApp|wa\.me/;
    const cambios = await page('/cambios-devoluciones-y-garantia');
    const intro = [...cambios.main.querySelectorAll('p')].map(p => (p.textContent ?? '').replace(/\s+/g, ' ').trim()).find(t => t.startsWith('Para cualquiera de estos casos'));
    expect(intro).toBe(
      `Para cualquiera de estos casos, escríbenos a ventas@elights.cl, de ${businessHoursLong} En nuestro WhatsApp te atiende un asistente automático que no gestiona estos casos.`,
    );
    const paragraph = (sectionHeading: string, start: string) =>
      section(cambios.main, sectionHeading).els.map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).find(t => t.startsWith(start)) ?? '';
    const retracto = paragraph('1.', 'Cómo hacerlo.');
    expect(retracto).toContain('Te confirmamos que recibimos tu aviso');
    expect(retracto).not.toMatch(noWhatsApp);
    expect(paragraph('2.', 'Cómo pedirla.')).toBe(
      'Cómo pedirla. Escríbenos a ventas@elights.cl. Revisamos tu caso y coordinamos el retiro o la recepción del producto. El traslado del producto con falla, de ida y de vuelta, es de cargo de eLIGHTS.',
    );
    expect(cambios.main.querySelector('a[href^="https://wa.me/"]')).toBeNull();
    const terminos = await page('/terminos-y-condiciones');
    expect(section(terminos.main, '1.').text).toContain('Te respondemos por correo electrónico, al que indiques en tu solicitud.');
    expect(terminos.text).not.toContain('Nos comunicaremos contigo por el correo electrónico, el teléfono o el WhatsApp');
    const reclamos = section(terminos.main, '16.');
    expect(reclamos.text).toContain('Si tienes un problema con tu compra, escríbenos a ventas@elights.cl y lo resolvemos contigo.');
    expect(reclamos.text).not.toMatch(noWhatsApp);
    expect(linksIn(reclamos.els)).not.toContain(waBase);
  });

  it('/politica-de-privacidad (PR 13): bases de la tabla, casillas, constancia y transición de la Ley 19.628', async () => {
    const { main } = await page('/politica-de-privacidad');
    const rows = [...main.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
    const basisOf = (purpose: string) => rows.find(([p]) => p?.startsWith(purpose))?.[1];
    expect(basisOf('Saber qué canales y campañas generan solicitudes')).toBe(
      'Interés legítimo de eLIGHTS en evaluar su publicidad; puedes oponerte desde «Configurar cookies», al pie de cada página, o escribiéndonos',
    );
    expect(basisOf('Enviarte novedades y ofertas por correo, solo si marcas la casilla opcional')).toBe('Tu consentimiento, que puedes retirar cuando quieras');
    expect(basisOf('Que Google Ads registre, con sus propias cookies')).toBe('Tu consentimiento, dado en el aviso de cookies');
    expect(basisOf('Guardar la constancia de tus autorizaciones')).toBe('Obligación legal de acreditar que tratamos tus datos de forma lícita');
    // §2: lo que guarda la constancia (formatConsentSection) y la decisión de cookies
    expect(section(main, '2.').text).toContain(
      'Tus autorizaciones y decisiones: que leíste esta política y autorizaste usar tus datos para responder (y, en la solicitud de pedido, que aceptaste los términos), si quieres recibir novedades, la versión de los textos y la fecha y hora del envío.',
    );
    // §3: la transición cita la casilla tal como la ve la persona
    const bases = section(main, '3.').text;
    expect(bases).toContain('casilla «Leí la Política de privacidad y autorizo…»');
    expect(consentTextPlain(CONSENT_TEXTS.privacy)).toMatch(/^Leí la Política de privacidad y autorizo /);
    for (const s of [
      'por correo o WhatsApp, con tu mensaje escrito',
      'Ordenar y priorizar tu solicitud es parte de responderla.',
      'usamos el origen de tu visita solo internamente, con fines estadísticos',
      'Desde el 1 de diciembre de 2026 rigen las bases de la tabla',
      // La medición con cookies no se basa en la autorización de la solicitud: también en la transición, en el aviso de cookies
      'La medición con cookies (Google Analytics, medición de anuncios de Google y Publicidad en Meta) se basa, también en ese período, en la autorización que das en el aviso de cookies.',
      'la casilla queda como constancia de que leíste esta política',
    ]) {
      expect(bases, s).toContain(s);
    }
    // §5: Google Analytics como encargado y la medición de anuncios entre los otros destinatarios
    const sharing = section(main, '5.').text;
    expect(sharing).toContain('solo en elights.cl y si lo aceptas en el aviso de cookies, Google Analytics, bajo los términos de tratamiento de datos de Google');
    expect(sharing).toContain('Google (medición de anuncios):');
    expect(sharing).toContain('Desde nuestros formularios no le enviamos tus datos de contacto.');
    // §7: plazos de las novedades, la constancia, la decisión de cookies y las cookies de Google
    const retention = section(main, '7.').text;
    for (const s of [
      'Si en una solicitud posterior no marcas la casilla, lo tomamos como retiro.',
      'guardamos solo tu correo y la constancia (versión y fechas) por 4 años',
      'Constancia de tus autorizaciones (casillas, versión y fecha): junto con tu solicitud y por el mismo plazo.',
      'Tu decisión sobre cookies: 12 meses en tu navegador',
      'las de Google Analytics, hasta 13 meses; las de medición de anuncios y su copia en el almacenamiento local de tu navegador (_gcl_ls), hasta 90 días',
      'hasta 14 meses desde tu última visita',
    ]) {
      expect(retention, s).toContain(s);
    }
    // §8: oposición al origen de la visita también desde «Configurar cookies»
    expect(section(main, '8.').text).toContain('el registro del origen de tu visita (también desde «Configurar cookies»)');
  });

  it('/politica-de-privacidad (PR 13): §10 cookies dice lo mismo que el aviso y tiene el botón «Configurar cookies»', async () => {
    const { main } = await page('/politica-de-privacidad');
    const cookies = section(main, '10.');
    for (const s of [
      'Sin tu consentimiento, este sitio no instala cookies en tu navegador.',
      'Rechazar las cookies no lo desactiva.',
      'se guarda 12 meses en el almacenamiento local de tu navegador',
      'antes de que decidas no se carga nada de Google ni de Meta',
      'Instala las cookies _ga y _ga_… por hasta 13 meses',
      '(_gcl_…, hasta 90 días)',
      'requiere la medición de visitas',
      'No activa anuncios personalizados de Google.',
      'No creamos públicos con tus visitas ni hacemos remarketing, ni en Google ni en Meta.',
      'la página se vuelve a cargar: dejamos de medir en esa misma página y borramos de tu navegador lo que Google y Meta guardaron en este sitio con ese permiso (cookies y almacenamiento local)',
      'su copia en el almacenamiento local de tu navegador (_gcl_ls)',
    ]) {
      expect(cookies.text, s).toContain(s);
    }
    expect(cookies.text).not.toContain('No usamos el píxel de Meta');
    expect(cookies.text).not.toMatch(/etiquetas de publicidad de Google|no instala cookies propias/);
    // El botón del pie, también aquí (estático: el prerender lo dibuja igual). Desde la 1.7, antes
    // va «Borrar mis datos guardados» (recordar mis datos, decisión 4 del dueño)
    const buttons = cookies.els.flatMap(el => [...el.querySelectorAll('button')]);
    expect(buttons.map(b => [b.textContent, b.getAttribute('type')])).toEqual([
      [REMEMBER_TEXTS.deleteButton, 'button'],
      [COOKIE_TEXTS.footerButton, 'button'],
    ]);
    expect(COOKIE_TEXTS.footerButton).toBe('Configurar cookies');
    // Las mismas cifras y nombres que el diálogo del aviso (src/lib/cookieConsent.ts)
    expect(COOKIE_CONSENT_MAX_AGE_MS).toBe(365 * 24 * 60 * 60 * 1000); // 12 meses
    expect(COOKIE_TEXTS.settingsDescription).toContain('Guardamos tu decisión 12 meses');
    expect(COOKIE_TEXTS.analyticsText).toContain('(_ga y _ga_…, hasta 13 meses)');
    expect(COOKIE_TEXTS.adsText).toContain('(_gcl_…, hasta 90 días) y su copia en el almacenamiento local de tu navegador (_gcl_ls)');
    expect(cookies.text).toContain(`interruptor «${COOKIE_TEXTS.originTitle}» en «${COOKIE_TEXTS.footerButton}»`);
    // Para lo ya enviado: el canal de datos personales, como dice el diálogo
    expect(COOKIE_TEXTS.originText).toContain('escríbenos a ventas@elights.cl con el asunto «Datos personales»');
    expect(linksIn(cookies.els)).toContain(DATA_MAILTO);
    // §12: el aviso vuelve si cambian sus finalidades; las versiones, desde el enlace del comienzo
    const changes = section(main, '12.').text;
    expect(changes).toContain('Si cambian las finalidades del aviso de cookies, te lo volveremos a mostrar.');
    expect(changes).toContain('Puedes guardar o imprimir cada versión desde el enlace al comienzo de esta página, donde también están las anteriores');
  });

  it('/politica-de-privacidad (PR 13): la medición de visitas y la de anuncios dicen lo que el código envía a Google', async () => {
    const { main, text } = await page('/politica-de-privacidad');
    // Anuncios: whatsapp_click es evento clave de la propiedad (src/lib/analytics.ts), así que un
    // contacto también puede contar, no solo una solicitud. Lo dicen los 5 lugares.
    const purposes = [...main.querySelectorAll('table tbody tr td:first-child')].map(td => td.textContent ?? '');
    const adsRow = purposes.find(p => p.startsWith('Que Google Ads registre'));
    const places: [string, string | undefined][] = [
      ['diálogo', COOKIE_TEXTS.adsText],
      ['tabla', adsRow],
      ['§3', section(main, '3.').text],
      ['§5', section(main, '5.').text],
      ['§10', section(main, '10.').text],
    ];
    for (const [where, s] of places) {
      expect(s, where).toContain('terminó en una solicitud o en un contacto con nosotros');
      expect(s, where).toMatch(/un clic para escribirnos por WhatsApp/);
      expect(s, where).not.toMatch(/terminó en una solicitud(?! o en un contacto)/);
    }
    // Visitas: páginas y botones (lista, formularios, WhatsApp), nunca «de forma agregada»
    const buttons = 'saber qué páginas y botones se usan (por ejemplo, agregar productos a la lista, enviar un formulario o abrir WhatsApp)';
    expect(COOKIE_TEXTS.analyticsText).toContain(buttons);
    expect(section(main, '10.').text).toContain(buttons);
    expect(text).not.toMatch(/de forma agregada|qué páginas se usan/);
    // §7: los 14 meses son de Google Analytics (verificado en GA4 el 2026-10-22, eventos y usuarios,
    // con el reinicio por actividad nueva); lo que registra Google Ads, según la política de Google
    const retention = section(main, '7.').text;
    expect(retention).toContain(
      'Google Analytics conserva los datos de medición asociados a sus cookies hasta 14 meses desde tu última visita; después solo quedan informes agregados.',
    );
    expect(retention).not.toMatch(/(?<!1)2 meses/);
    expect(retention).toContain('Lo que registra Google Ads lo conserva Google según su propia política.');
    expect(retention).not.toContain('asociados a esas cookies');
    // §10: la decisión no queda en nuestros sistemas, pero con GA cada medición lleva lo permitido (Consent Mode)
    expect(section(main, '10.').text).toContain(
      'No es una cookie y no la guardamos en nuestros sistemas; si aceptas Google Analytics, cada medición le informa a Google qué permitiste.'
    );
    expect(text).not.toContain('no sale de tu navegador');
  });

  it('/politica-de-privacidad (PR 14, versión 1.5): «Publicidad en Meta» dice lo mismo que el aviso y que el techo de la especificación', async () => {
    const { main, text } = await page('/politica-de-privacidad');
    const clean = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    // Tabla de finalidades: la de Meta, con el consentimiento del aviso como base
    const rows = [...main.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(clean));
    const meta = rows.find(([p]) => p.startsWith('Que Meta registre'));
    expect(meta, 'falta la finalidad de Meta').toBeDefined();
    expect(meta![0]).toBe(
      'Que Meta registre, con su píxel y sus cookies, las páginas que visitas y si nos enviaste una solicitud (y de qué tipo) o hiciste clic para contactarnos (y por qué medio), para medir nuestros anuncios en Facebook e Instagram (solo en elights.cl)',
    );
    expect(meta![1]).toBe('Tu consentimiento, dado en el aviso de cookies');
    // §3: la copia que va con la solicitud no se sube; lo que registra Meta, en paralelo a Google
    const bases = section(main, '3.').text;
    expect(bases).toContain('no los subimos a Google Ads ni a Meta');
    expect(bases).toContain(
      'Si en elights.cl aceptas «Publicidad en Meta», es Meta quien registra con su píxel y sus cookies (como _fbp y _fbc) las páginas que visitas (con su dirección completa y el sitio desde el que llegaste), el identificador del clic (fbclid) si llegaste desde un enlace de Facebook o Instagram, y si nos enviaste una solicitud (y de qué tipo) o hiciste clic para contactarnos (y por qué medio).',
    );
    expect(bases).toContain('Para medir visitas y anuncios no enviamos a Google ni a Meta tu nombre, correo ni teléfono.');
    // §5: Meta usa los datos para su propia publicidad (solo con el consentimiento); Google no
    const sharing = section(main, '5.').text;
    expect(sharing).toContain(
      'No vendemos tus datos ni los entregamos a terceros para que hagan su propia publicidad, salvo lo que registra el píxel de Meta si aceptas «Publicidad en Meta» (ver más abajo).',
    );
    const metaItem = section(main, '5.').els.flatMap(el => [...el.querySelectorAll('li')]).map(clean).find(t => t.startsWith('Meta (Publicidad en Meta):'));
    expect(metaItem, 'falta Meta entre los destinatarios de §5').toBeDefined();
    for (const s of [
      'solo en elights.cl y si lo aceptas en el aviso de cookies',
      'las páginas que visitas, con su dirección completa y el sitio desde el que llegaste',
      'el identificador del clic si llegaste desde un enlace de Facebook o Instagram',
      'hiciste clic para contactarnos',
      '(pedido, cotización, cotizador, estudio lumínico o instalación)',
      '(por WhatsApp, correo o teléfono)',
      'lo usa también para sus propios anuncios',
      'No le enviamos tu nombre, correo ni teléfono.',
    ]) {
      expect(metaItem, s).toContain(s);
    }
    // §7: las cookies de Meta y su plazo
    expect(section(main, '7.').text).toContain(
      'Cookies de Meta (si las aceptas): las del píxel, como _fbp y _fbc, y lo que guarda en el almacenamiento local de tu navegador, hasta 90 días.',
    );
    // §10: la categoría, que requiere la medición de visitas, el techo de lo que recibe Meta, la IP y que no hay públicos
    const cookies = section(main, '10.').els.flatMap(el => [...el.querySelectorAll('li')]).map(clean);
    const pixel = cookies.find(t => t.startsWith('Publicidad en Meta (solo en elights.cl)'));
    expect(pixel, 'falta «Publicidad en Meta» en §10').toBeDefined();
    for (const s of [
      'solo si la aceptas, y requiere la medición de visitas',
      'guarda en tu navegador cookies, como _fbp y _fbc, y datos en el almacenamiento local por hasta 90 días',
      'las páginas que visitas, con su dirección completa y el sitio desde el que llegaste, el identificador del clic (fbclid) si llegaste desde un enlace de Facebook o Instagram',
      'y de qué tipo (pedido, cotización, cotizador, estudio lumínico o instalación)',
      'o hiciste clic para contactarnos y por qué medio (WhatsApp, correo o teléfono)',
      'como tu dirección IP',
      'No le enviamos tu nombre ni tus datos de contacto.',
      'Meta también usa estos datos para sus propios anuncios, según su política.',
    ]) {
      expect(pixel, s).toContain(s);
    }
    // Lo mismo que el aviso (src/lib/cookieTexts.ts)
    expect(COOKIE_TEXTS.metaTitle).toBe('Publicidad en Meta');
    expect(COOKIE_TEXTS.metaText).toContain('Requiere la medición de visitas.');
    expect(COOKIE_TEXTS.metaText).toContain('cookies como _fbp y _fbc, y datos en el almacenamiento local, hasta 90 días');
    expect(COOKIE_TEXTS.banner).toContain('Meta');
    // El fbclid no es solo de anuncios (Facebook e Instagram lo agregan a cualquier enlace) y
    // Contact sale con el clic, aunque la persona no llegue a escribir: lo dicen el aviso y la política
    for (const [where, s] of [['diálogo', COOKIE_TEXTS.metaText], ['política', text]] as const) {
      expect(s, where).not.toMatch(/identificador del anuncio|nos contactaste/);
    }
    expect(COOKIE_TEXTS.metaText).toContain('con su dirección completa y el sitio desde el que llegaste');
    // Nada de lo que la política no permite: coincidencia avanzada, públicos ni remarketing
    expect(text).not.toMatch(/coincidencia avanzada|públicos personalizados|No usamos el píxel de Meta/i);
    // Los 8 valores de content_name, ni uno más: 5 tipos de solicitud y 3 medios de contacto
    expect(pixel!.match(/\(([^)]*)\)/g)).toEqual([
      '(solo en elights.cl)',
      '(fbclid)',
      '(pedido, cotización, cotizador, estudio lumínico o instalación)',
      '(WhatsApp, correo o teléfono)',
    ]);
  });

  // Especificación «Adjuntar archivos» (22-10-2026, §5), aprobada por el dueño con D1 a D3: los
  // archivos del cotizador pasan por Vercel Blob (privado y temporal) y quedan en Pipedrive.
  it('/politica-de-privacidad (versión 1.6): los archivos que se adjuntan en el sitio, con los textos de la especificación', async () => {
    const { main, text } = await page('/politica-de-privacidad');
    const clean = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const items = (heading: string) => section(main, heading).els.flatMap(el => [...el.querySelectorAll('li')].map(clean));
    const item = (heading: string, start: string) => items(heading).find(t => t.startsWith(start)) ?? '';
    // §2: la solicitud, los mensajes y los datos sensibles
    expect(item('2.', 'Tu solicitud:')).toBe(
      'Tu solicitud: productos, cantidades, montos referenciales, comuna y región, comentarios y, en las solicitudes de proyecto, datos de la obra (tipo de proyecto, medidas, altura de montaje, normativa, plazos y ubicación) y los archivos que adjuntes, como bases de licitación, fichas técnicas, planos o planillas.',
    );
    expect(item('2.', 'Tus mensajes:')).toBe(
      'Tus mensajes: lo que nos escribes o nos envías (por ejemplo, fotos o archivos) por correo, WhatsApp o desde el sitio.',
    );
    expect(section(main, '2.').text).toContain('Por favor no los incluyas en tus comentarios ni en tus archivos.');
    // §5: Vercel guarda los archivos por un tiempo; Pipedrive, con la solicitud
    expect(item('5.', 'Vercel Inc.')).toBe(
      'Vercel Inc. (Estados Unidos): alojamiento del sitio y de los formularios, y almacenamiento temporal de los archivos que adjuntas.',
    );
    expect(item('5.', 'Pipedrive')).toBe(
      'Pipedrive (Unión Europea / Estados Unidos): sistema donde registramos y damos seguimiento a solicitudes y clientes, incluidos los archivos que adjuntas.',
    );
    // Upstash: además, por 48 horas, la reserva del traspaso de cada archivo (ruta en Blob → negocio)
    expect(item('5.', 'Upstash')).toBe(
      'Upstash Inc.: registro técnico temporal que relaciona cada solicitud hecha en nuestra tienda de Jumpseller con su ficha en nuestro sistema de seguimiento y, por 48 horas, cada archivo que adjuntas en el sitio con tu solicitud. También guarda la conversación con el asistente de WhatsApp.',
    );
    // §7: la viñeta nueva, con el plazo de 48 horas del barrido diario (api/cron/blob-sweep.ts)
    expect(item('7.', 'Archivos que adjuntas en el sitio:')).toBe(
      'Archivos que adjuntas en el sitio: pasan por un almacenamiento privado y temporal de Vercel (Estados Unidos) y se borran apenas quedan en nuestro sistema de seguimiento o, si el envío no se completa, a más tardar en 48 horas. La copia en nuestro sistema de seguimiento sigue el plazo de tu solicitud.',
    );
    expect(items('7.').findIndex(t => t.startsWith('Archivos que adjuntas'))).toBe(
      items('7.').findIndex(t => t.startsWith('Constancia de tus autorizaciones')) + 1,
    );
    // «48 horas» es el plazo de borrado, no de despacho: la única frase que la regla marca, permitida
    // en check-prerender (KNOWN_PHRASES) solo en esta página
    expect(policyIssues(spacedText(main))).toEqual(['envío no se completa, a más tardar en 48 horas']);
    expect(unknownIssues('/politica-de-privacidad', spacedText(main))).toEqual([]);
    expect(unknownIssues('/despacho', 'envío no se completa, a más tardar en 48 horas')).toHaveLength(1);
    // §9 no cambia
    expect(section(main, '9.').text).not.toMatch(/archivo/i);
    // Ni el sitio ni la política ofrecen otro canal para mandar archivos que el correo
    expect(text).not.toMatch(/archivos? (?:por|a nuestro) WhatsApp/i);
  });

  // Especificación «Recordar mis datos en este dispositivo» (23-10-2026, §4), aprobada por el dueño
  // con sus 4 decisiones: RUT solo si es válido, 12 meses, casilla marcada si hay datos y el botón
  // «Borrar mis datos guardados» solo en §10.
  it('/politica-de-privacidad (versión 1.7): recordar mis datos, con los textos de la especificación', async () => {
    const { main } = await page('/politica-de-privacidad');
    const clean = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const items = (heading: string) => section(main, heading).els.flatMap(el => [...el.querySelectorAll('li')].map(clean));
    const item = (heading: string, start: string) => items(heading).find(t => t.startsWith(start)) ?? '';
    // §2: la última frase de «Tus autorizaciones y decisiones»
    expect(item('2.', 'Tus autorizaciones y decisiones:')).toMatch(
      /\. En tu navegador guardamos tu decisión sobre cookies y, si lo pides, tus datos de contacto \(punto 10\)\.$/,
    );
    // §3: la fila de la tabla y la base durante el período hasta el 30-11-2026
    const rows = [...main.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(clean));
    expect(rows).toContainEqual([
      'Recordar tus datos en tu navegador para completar los formularios, solo si marcas esa casilla',
      'Tu consentimiento, que retiras desmarcando la casilla',
    ]);
    expect(section(main, '3.').text).toContain(
      'en la autorización que das en el aviso de cookies. Recordar tus datos en tu navegador se basa en la autorización que das al marcar esa casilla. En ese período,',
    );
    // §7: el plazo, después de la decisión sobre cookies (12 meses, como SAVED_CONTACT_MAX_AGE_MS)
    expect(SAVED_CONTACT_MAX_AGE_MS).toBe(365 * 24 * 60 * 60 * 1000);
    expect(item('7.', 'Datos que pides recordar en tu navegador:')).toBe(
      'Datos que pides recordar en tu navegador: 12 meses desde tu último envío con la casilla marcada; después no los usamos y los borramos en tu próxima visita.',
    );
    expect(items('7.').findIndex(t => t.startsWith('Datos que pides recordar'))).toBe(
      items('7.').findIndex(t => t.startsWith('Tu decisión sobre cookies:')) + 1,
    );
    // §10: el punto nuevo, después de «Tu decisión sobre cookies», con la etiqueta de la casilla y el botón
    const remember = item('10.', 'Si marcas «Recordar mis datos en este dispositivo»');
    expect(remember).toBe(
      `Si marcas «${REMEMBER_TEXTS.label}», guardamos en el almacenamiento local de tu navegador tu nombre, correo, teléfono, comuna y región, si compras como persona o empresa, los datos de tu empresa (razón social, RUT, giro y dirección) y la fecha de tu último envío, para completar los formularios cuando vuelvas. No son cookies, no dependen del aviso de cookies y no los guardamos en nuestros sistemas: salen de tu navegador solo cuando envías un formulario. Nunca guardamos ahí tus comentarios, tus archivos ni los datos de tu proyecto. Puedes borrarlos desmarcando la casilla en cualquier formulario o con el botón «${REMEMBER_TEXTS.deleteButton}». No la marques en un computador compartido.`,
    );
    expect(items('10.').findIndex(t => t === remember)).toBe(items('10.').findIndex(t => t.startsWith('Tu decisión sobre cookies se guarda')) + 1);
    const li = section(main, '10.').els.flatMap(el => [...el.querySelectorAll('li')]).find(el => clean(el) === remember)!;
    expect(li.querySelector('strong')?.textContent).toBe(`«${REMEMBER_TEXTS.label}»`);
    expect([...li.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('type')])).toEqual([[REMEMBER_TEXTS.deleteButton, 'button']]);
    // Las casillas de privacidad y de novedades no cambian (consent.test.ts) y no hay contacto fuera de ventas@
    expect(linksIn(section(main, '10.').els).every(h => h === DATA_MAILTO)).toBe(true);
  });

  it('/politica-de-privacidad (versión 1.7): «Borrar mis datos guardados» borra lo guardado sin enviar nada', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.setItem(SAVED_CONTACT_STORAGE_KEY, JSON.stringify({ v: 1, at: new Date().toISOString(), data: { email: 'prueba-politica@example.com' } }));
    localStorage.setItem('elights_cookie_consent', 'sin tocar');
    try {
      const { unmount } = render(
        <HelmetProvider>
          <MemoryRouter initialEntries={['/politica-de-privacidad']}>
            <PrivacidadPage />
          </MemoryRouter>
        </HelmetProvider>,
      );
      // El aviso, al final del punto: vacío hasta el clic
      const li = screen.getByRole('button', { name: REMEMBER_TEXTS.deleteButton }).closest('li')!;
      const notice = li.querySelector('[role="status"]')!;
      expect(notice).toBeEmptyDOMElement();
      fireEvent.click(screen.getByRole('button', { name: REMEMBER_TEXTS.deleteButton }));
      expect(localStorage.getItem(SAVED_CONTACT_STORAGE_KEY)).toBeNull();
      expect(notice).toHaveTextContent(REMEMBER_TEXTS.cleared);
      expect(li.lastElementChild).toBe(notice);
      expect(localStorage.getItem('elights_cookie_consent')).toBe('sin tocar'); // la decisión de cookies no se toca
      expect(fetchSpy).not.toHaveBeenCalled();
      unmount();
    } finally {
      localStorage.clear();
      vi.unstubAllGlobals();
    }
  });

  it('la versión 1.0 publicada sigue entre las anteriores (sus archivos no se borran)', () => {
    expect(LEGAL_ARCHIVE).toContain('1.0');
    expect(LEGAL_ARCHIVE).not.toContain(LEGAL_VERSION);
  });
});

describe('pie y enlaces del sitio a las páginas legales', () => {
  it('ninguna página legal queda sin enlace en el pie (todas las páginas lo muestran)', async () => {
    const { html } = await page('/empresa');
    const root = document.createElement('div');
    root.innerHTML = html;
    const footerLinks = [...root.querySelectorAll('footer a')].map(a => a.getAttribute('href'));
    for (const { path } of LEGAL_PAGES) expect(footerLinks).toContain(path);
  });
});


it('política 1.10: fecha provisional y versión anterior publicada', () => {
  expect(LEGAL_VERSION).toBe('1.10');
  expect(LEGAL_UPDATED).toBe('2026-10-28');
  expect(LEGAL_UPDATED_LABEL).toBe('28 de octubre de 2026');
  expect(LEGAL_ARCHIVE).toContain('1.9');
  expect(LEGAL_RUT).toBe('76.947.784-5');
});
