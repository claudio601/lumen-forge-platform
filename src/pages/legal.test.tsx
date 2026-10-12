// Páginas legales y de compra (PR 12): /empresa, /terminos-y-condiciones,
// /cambios-devoluciones-y-garantia, /despacho, /medios-de-pago y /politica-de-privacidad.
// Se dibujan como en el prerender (entry-server, sin sesión) y se revisan: un solo h1, la
// regla de contenido de check-prerender (sin stock ni plazos de despacho distintos de "hasta 2
// días hábiles"), los datos de la empresa desde site.ts, lo que la ley pide que digan y los
// defaults del dueño (despacho sin monto publicado, sin orden de compra, sin representante).
// Las frases retiradas de la PR 11 las revisa src/config/contentTruth.test.ts en todas las
// páginas fijas, también estas.

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { serverTree } from '@/entry-server';
import { preloadRoute } from '@/routes';
import { LEGAL_PAGES, type LegalPath } from '@/config/legal';
import { LEGAL_NAME, LEGAL_REPRESENTATIVE, LEGAL_RUT, LEGAL_UPDATED, LEGAL_UPDATED_LABEL, LEGAL_VERSION, SITE_URL } from '@/config/site';
import {
  businessClosedDays,
  businessHours,
  businessHoursLong,
  contactEmail,
  FREE_SHIPPING_THRESHOLD_CLP,
  quoteValidityBusinessDays,
  waBase,
} from '@/config/business';
import { NOINDEX_ROUTES, STATIC_ROUTES } from '@/lib/seo/routes';
import { findPolicyBreaking } from '../../scripts/jumpseller/descriptions';
import EmpresaPage from './EmpresaPage';
import TerminosPage from './TerminosPage';
import CambiosGarantiaPage from './CambiosGarantiaPage';
import DespachoPage, { UrbanShipping } from './DespachoPage';
import MediosPagoPage from './MediosPagoPage';
import PrivacidadPage from './PrivacidadPage';

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

/** Una sección de la página: desde el h2 que empieza con `heading` hasta el siguiente h2. */
function section(main: Element, heading: string) {
  const h2 = [...main.querySelectorAll('h2')].find(h => (h.textContent ?? '').startsWith(heading));
  if (!h2) throw new Error(`sin la sección "${heading}"`);
  const els: Element[] = [];
  for (let el = h2.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) els.push(el);
  return { els, text: els.map(el => el.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim() };
}

/** Frases que ninguna página legal ni su descripción pueden decir (reglas del dueño y PR 11). */
const FORBIDDEN = ['3 meses', '1 año base', 'stock', 'existencias', 'camiones propios', '9:00', '$250.000', 'Axiom'];

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
      expect(policyIssues(spaced)).toEqual([]);
      expect(policyIssues(text)).toEqual([]);
      for (const phrase of FORBIDDEN) expect(html, phrase).not.toContain(phrase);
      expect(text).not.toMatch(/\[C\d+\]|\[nombre|LEGAL_UPDATED|TODO/); // sin marcadores del borrador
      // Enlaces: internos a páginas de la app; externos solo correo, teléfono, WhatsApp y SERNAC
      for (const a of main.querySelectorAll('a')) {
        const href = a.getAttribute('href') ?? '';
        if (href.startsWith('/')) expect(internalRoutes.has(href), `${path}: enlace a ${href}`).toBe(true);
        else expect(href, `${path}: enlace a ${href}`).toMatch(/^(?:mailto:ventas@elights\.cl(?:\?subject=Datos%20personales)?|tel:\+56991273128|https:\/\/wa\.me\/56991273128|https:\/\/www\.sernac\.cl)$/);
      }
      const nav = main.querySelector('nav[aria-label="Más información"]')!;
      expect([...nav.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(LEGAL_PAGES.filter(p => p.path !== path).map(p => p.path));
      expect(nav.textContent).not.toContain(label);
      // La versión solo en los textos que la llevan
      const version = `Versión ${LEGAL_VERSION}. Vigente desde el ${LEGAL_UPDATED_LABEL}.`;
      if (VERSIONED.includes(path)) {
        expect(text).toContain(version);
        expect(main.querySelector('time')?.getAttribute('datetime')).toBe(LEGAL_UPDATED);
      } else {
        expect(text).not.toContain('Vigente desde');
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
      if (path === '/despacho') {
        expect([...description.matchAll(DAY_COUNTS)].map(m => m[0])).toEqual(['2 días hábiles']);
        expect(description).toContain('Despacho en hasta 2 días hábiles');
        expect(description).not.toContain('a todo Chile'); // en regiones se suma el viaje
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
    // §9: en regiones, los 2 días hábiles son hasta la entrega al transportista
    expect(section(main, '9.').text).toContain('En regiones, es el plazo para entregar tu pedido al transportista; a eso se suma el tiempo de viaje');
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
      'por WhatsApp o por teléfono al +56 9 9127 3128 (o por el mismo medio con que compraste)',
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

  it('/despacho: hasta 2 días hábiles; el monto del despacho sin costo solo con FREE_SHIPPING_THRESHOLD_CLP; regiones sin plazo publicado', async () => {
    const { main, text } = await page('/despacho');
    expect(main.querySelector('h1')?.textContent).toBe('Despacho');
    expect(text).toContain('Despacho en hasta 2 días hábiles');
    expect(text).toContain('Te lo informamos en la cotización, antes de que pagues.'); // tiempo a regiones
    expect(text).toContain('En regiones, es el plazo para entregar tu pedido al transportista; a eso se suma el tiempo de viaje');
    // El único plazo de la página es "2 días hábiles": ningún tiempo de viaje a regiones publicado
    expect([...text.matchAll(DAY_COUNTS)].map(m => m[0])).toEqual(['2 días hábiles']);
    expect(text).toContain('Starken, Cruz del Sur o PDQ');
    expect(text).not.toMatch(/ECOEx|retiro en tienda/i);
    if (FREE_SHIPPING_THRESHOLD_CLP === null) {
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).toContain('El costo del despacho te lo informamos en la cotización, antes de que pagues.');
    } else {
      expect(text).toContain('(IVA incluido): despacho a domicilio sin costo.');
    }
  });

  it('/despacho: con monto publicado, las dos franjas en pesos (sin Intl); sin monto, nada de montos', () => {
    const { container, rerender } = render(<UrbanShipping thresholdClp={200000} />);
    expect(container.textContent).toContain('Compras sobre $200.000 (IVA incluido): despacho a domicilio sin costo.');
    expect(container.textContent).toContain('Compras de $200.000 o menos: el despacho va por pagar con Starken o Chilexpress');
    expect(container.textContent).toContain('condición permanente de venta');
    expect(policyIssues(spacedText(container))).toEqual([]);
    rerender(<UrbanShipping thresholdClp={null} />);
    expect(container.textContent).not.toMatch(/\$|sin costo/);
    expect(container.textContent).toContain('eliges entre Starken y Chilexpress');
  });

  it('/medios-de-pago: link de pago (Webpay vía Flow o Mercado Pago), transferencia, crédito caso a caso; sin orden de compra', async () => {
    const { text } = await page('/medios-de-pago');
    for (const s of ['link de pago', 'Webpay (a través de Flow)', 'Mercado Pago', `cuenta de ${LEGAL_NAME}`, 'cheque a 30 o 60 días', 'vale vista', 'boleta electrónica', 'factura electrónica', 'incluyen IVA']) {
      expect(text, s).toContain(s);
    }
    expect(text).toContain('Crédito acordado: cuando recibimos el cheque o el vale vista.'); // desde ahí corre el despacho
    expect(text).not.toMatch(/orden de compra|Mercado Público/i);
    expect(text).not.toMatch(/cuotas|tarjeta de cr[eé]dito o d[eé]bito/i); // no confirmado (C13)
  });

  it('/politica-de-privacidad: responsable, encargados (sin Axiom), plazos, derechos, cookies y canal "Datos personales"', async () => {
    const { main, text } = await page('/politica-de-privacidad');
    for (const s of [LEGAL_NAME, LEGAL_RUT, 'Vercel', 'Pipedrive', 'Google', 'Twilio', 'Anthropic', 'Upstash', 'Jumpseller', '30 días corridos', 'no instala cookies propias', '24 meses', '6 años', 'Ley N° 21.719']) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toContain('Axiom');
    expect(text).toContain('no los subimos a Google Ads ni a Meta');
    expect(text).toContain('una persona de nuestro equipo revisa y responde cada solicitud');
    // §4: el aviso del asistente de WhatsApp con IA y el paso a una persona (default del dueño)
    const automated = section(main, '4.').text;
    for (const s of ['Asistente de WhatsApp.', 'asistente automático', 'Claude, de Anthropic', 'puedes pedir hablar con una persona']) {
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
    expect(main.querySelectorAll('table tbody tr')).toHaveLength(8);
    expect(main.querySelector('table')?.parentElement?.className).toContain('overflow-x-auto'); // legible en el teléfono
    if (LEGAL_REPRESENTATIVE === null) expect(text).not.toContain('Representante legal');
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
