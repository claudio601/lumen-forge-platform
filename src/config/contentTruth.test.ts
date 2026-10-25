// Textos del sitio que no se pueden respaldar (PR 11, 2026-10). Reglas del dueño: ante una
// afirmación sin confirmar, quitarla antes que inventar un reemplazo; garantía sin cifra
// única (la legal de 6 meses + la de cada ficha); el horario de elights.cl en una sola
// constante; sin "Mi cuenta" mientras no haya login (Fase 3).
// Despacho sin costo (PR 12b): el dueño lo confirmó el 2026-10-14 (total con IVA mayor que
// FREE_SHIPPING_THRESHOLD_CLP, en la Provincia de Santiago). Toda mención sale de las
// constantes de business.ts: el monto se escribe solo ahí y "gratis" sigue retirado. Toda
// oferta que se ve (también "sin cargo" o "liberado", y en tarjetas de título + párrafo)
// trae el monto con "sobre" o "mayor a" y la zona, sin nombrar otra; las reglas y sus pruebas
// de mutación están en src/test/freeShipping.ts y al final de este archivo.
// check-prerender no detecta estas frases (solo mira stock y plazos de despacho), así que
// este test las vigila en el código y en el HTML que genera el servidor.
//
// D.S. N°1/2022 (auditoría UX, entrega 4: D-04, K-03, E-01 y A-01; líneas certificadas según el
// dueño, 22-10-2026; los proyectores de estadio, solo hasta 5000K desde el 23-10-2026): al final
// de este archivo, el contenido propio (fichas SEO, fichas
// editoriales, introducciones de categoría y configuración) solo afirma el certificado D.S. N°1
// de las 8 líneas certificadas y en sus versiones certificadas, no cita el D.S. N°43, no le
// aplica la luz azul a las canchas y no pone el «% de luz azul» junto a la norma (reglas en
// src/data/catalog/ds1.ts); y el aviso del hero y el bloque de /catalogo/alumbrado-publico se
// ven como se aprobaron.
//
// Guías (plan del blog, §5.6): src/data/guides entra en la revisión del código y cada guía
// publicada (también las sin indexar) en la del HTML. La lista de frases retiradas vive en
// src/test/retired.ts, compartida con src/data/guides/guides.test.ts.
//
// Fuera de aquí: el contenido SEO por producto (src/data/catalog/content/*.json) todavía
// promete flota propia en 116 fichas. Se corrige en la PR 11b, con su regla en
// scripts/content/check.ts.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { serverTree } from '@/entry-server';
import { preloadRoute } from '@/routes';
import { STATIC_ROUTES, categoryPath, noindexGuideRoutes, prerenderedRoutes, productPath } from '@/lib/seo/routes';
import { products } from '@/data/products';
import { editorialOverlay } from '@/data/catalog/overlay/editorial';
import { productDescriptions } from '@/data/catalog/descriptions.generated';
import { PROJECT_CATEGORIES } from '@/data/catalog/categories.config';
import type { Product } from '@/data/catalog/types';
import WhatsAppButton from '@/components/WhatsAppButton';
import {
  businessHours,
  clp,
  contactEmail,
  FREE_SHIPPING_AREA,
  FREE_SHIPPING_THRESHOLD_CLP,
  freeShippingShort,
  PICKUP_PLACE,
  responseTimePromise,
  trustClaims,
  waInstaladores,
} from './business';
import { ADVISORY_LINK, DS1_NOTICE } from './navigation';
import {
  DS1_CERTIFIED_IDS,
  DS1_CERTIFIED_LINES,
  DS1_SPORTS_MAX_KELVIN,
  DS1_WARM_KELVIN,
  ds1Certificate,
  ds1ContentIssues,
  ds1Issues,
  ds1Line,
  ds1VariantIssues,
  isDs1Certified,
  isDs1CertifiedKelvin,
  sentences,
} from '@/data/catalog/ds1';
import { BESTLED_60W_ID, CATEGORY_INTROS, DS1_BUTTON_PRODUCTS, type CategoryIntro } from '@/data/catalog/category-intros';
import type { ProductContent } from '@/data/catalog/types';
import { claimIssues, freeShippingIssues, handWrittenFreeShippingAmount } from '@/test/freeShipping';
import { retiredIn } from '@/test/retired';

/**
 * Código con textos para el visitante (sin tests), las fichas editoriales BESTLED y las guías
 * (plan del blog, §5.6: src/data/guides; la frase retirada se busca línea por línea).
 */
const SOURCES = import.meta.glob<string>(
  [
    '/src/components/**/*.{ts,tsx}',
    '/src/pages/**/*.{ts,tsx}',
    '/src/config/**/*.{ts,tsx}',
    '/src/data/catalog/overlay/editorial.ts',
    '/src/data/guides/**/*.ts',
    '!**/*.test.*',
  ],
  { query: '?raw', import: 'default', eager: true },
);

describe('textos sin respaldo: el código', () => {
  it('revisa los componentes, las páginas, la configuración y las fichas BESTLED', () => {
    const files = Object.keys(SOURCES);
    for (const f of [
      '/src/components/home/TrustBar.tsx',
      '/src/components/layout/Footer.tsx',
      '/src/pages/InstallerAreaPage.tsx',
      '/src/config/business.ts',
      '/src/data/catalog/overlay/editorial.ts',
      '/src/data/guides/content/norma-luminica-ds-1-2022.ts',
      '/src/pages/GuidePage.tsx',
    ]) {
      expect(files).toContain(f);
    }
    expect(files.some(f => f.includes('.test.'))).toBe(false);
  });

  it('ninguna frase retirada vuelve a aparecer', () => {
    const hits = Object.entries(SOURCES).flatMap(([file, src]) =>
      src.split('\n').flatMap((line, i) => retiredIn(line).map(hit => `${file}:${i + 1}: ${hit}`)),
    );
    expect(hits).toEqual([]);
  });

  it('el monto del despacho sin costo y el lugar de retiro se escriben una sola vez, en business.ts', () => {
    expect(FREE_SHIPPING_THRESHOLD_CLP).toBe(250000); // dueño, 2026-10-14
    const written = (re: RegExp) =>
      Object.entries(SOURCES).flatMap(([file, src]) =>
        src
          .split('\n')
          .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
          .filter(({ line }) => !/^\s*(?:\/\/|\/?\*)/.test(line) && re.test(line)) // código, no comentarios
          .map(({ at }) => at),
      );
    expect(written(/250[._]?000/)).toEqual([expect.stringMatching(/^\/src\/config\/business\.ts:\d+$/)]);
    expect(written(/Quinta Normal/)).toEqual([expect.stringMatching(/^\/src\/config\/business\.ts:\d+$/)]);
    expect(freeShippingShort).toBe(`Despacho sin costo sobre ${clp(FREE_SHIPPING_THRESHOLD_CLP)} en la ${FREE_SHIPPING_AREA.name}`);
    expect(PICKUP_PLACE).not.toMatch(/\d/); // nunca la dirección exacta
  });

  it('ninguna línea ofrece despacho sin costo con un monto escrito a mano (cualquier monto, no solo 250.000)', () => {
    const hits = Object.entries(SOURCES)
      .filter(([file]) => file !== '/src/config/business.ts')
      .flatMap(([file, src]) => src.split('\n').flatMap((line, i) => (handWrittenFreeShippingAmount(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])));
    expect(hits).toEqual([]);
    // La regla reconoce lo que debe (la línea de la mutación de la revisión en ProductDetail.tsx)
    expect(handWrittenFreeShippingAmount('<span className="text-xs">Despacho sin costo sobre $200.000 en Santiago</span>')).toBe(true);
    expect(handWrittenFreeShippingAmount("{ text: 'Envío sin cargo desde 199990' },")).toBe(true);
    expect(handWrittenFreeShippingAmount('Despacho sin costo sobre {clp(FREE_SHIPPING_THRESHOLD_CLP)} en la {area}')).toBe(false);
    expect(handWrittenFreeShippingAmount('// Despacho sin costo: confirmado por el dueño el 2026-10-14 (PR 12b)')).toBe(false);
  });

  it('el horario de atención es el de elights.cl y sale de una sola constante', () => {
    expect(businessHours).toBe('Lunes a viernes 9:30-14:00 y 15:00-17:30 hrs.');
    const literal = Object.entries(SOURCES)
      .filter(([file, src]) => file !== '/src/config/business.ts' && /lunes a viernes/i.test(src))
      .map(([file]) => file);
    expect(literal).toEqual([]);
    expect(SOURCES['/src/components/layout/Footer.tsx']).toContain('{businessHours}');
    expect(SOURCES['/src/components/WhatsAppButton.tsx']).toContain('{businessHours}');
  });

  it('el popup de WhatsApp muestra ese horario', () => {
    render(createElement(WhatsAppButton));
    fireEvent.click(screen.getByRole('button', { name: /Contactar por WhatsApp/ }));
    expect(screen.getByText(`Horario del equipo: ${businessHours}`)).toBeInTheDocument();
  });
});

/**
 * HTML de la página como lo genera el prerender (entry-server, con la ruta precargada), en
 * un DOM para consultarlo. Solo el <body>: en jsdom, Seo no dibuja <Helmet> hasta montarse
 * (src/components/Seo.tsx). Los títulos y descripciones son textos fijos del código, y el
 * test de arriba los revisa.
 */
async function page(path: string) {
  await preloadRoute(path);
  const html = renderToString(serverTree(path));
  expect(html).not.toContain('<!--$!-->'); // nada quedó para dibujar en el navegador
  const root = document.createElement('div');
  root.innerHTML = html;
  return { html, root };
}

const bestled = products.find(p => editorialOverlay[p.jumpseller_id] && p.datasheetUrl)!;
/** Valor de la fila "Garantía" de la tabla de Jumpseller (la que se ve en la ficha). */
const warrantyRow = (p: Product) => {
  const d = productDescriptions[p.jumpseller_id];
  return [...(d?.electricos ?? []), ...(d?.construccion ?? []), ...(d?.componentes ?? [])].find(r => r.label === 'Garantía')?.value;
};
const fromJumpseller = products.filter(p => !editorialOverlay[p.jumpseller_id]);
/** Sin ficha técnica y sin cifra de garantía ("Si" o sin fila): queda la legal. */
const withoutDatasheet = fromJumpseller.find(p => !p.datasheetUrl && [undefined, 'Si'].includes(warrantyRow(p)))!;
const oneYear = fromJumpseller.find(p => warrantyRow(p) === '1 año')!;
const projectProduct = fromJumpseller.find(p => p.categories.some(c => PROJECT_CATEGORIES.includes(c)))!;

describe('textos sin respaldo: el HTML de las páginas', () => {
  // Páginas fijas, una ficha BESTLED y las guías: todo su texto sale del código, de editorial.ts
  // y de src/data/guides. Las demás fichas también muestran el contenido SEO por producto (PR 11b)
  // y la garantía propia de cada producto, así que ahí solo se revisa lo que pone el sitio.
  const guideRoutes = prerenderedRoutes().filter(r => r.startsWith('/guias/'));
  it('las guías publicadas (también las sin indexar) entran en esta revisión', () => {
    expect(guideRoutes.length).toBeGreaterThan(0);
    for (const r of noindexGuideRoutes()) expect(guideRoutes).toContain(r);
  });
  for (const path of [...STATIC_ROUTES, productPath(bestled.id), ...guideRoutes]) {
    it(`${path}: sin frases retiradas (texto y atributos)`, async () => {
      const { html } = await page(path);
      expect(retiredIn(html, true)).toEqual([]);
      // El link de pago es de Flow y ya no se usa Mercado Pago (dueño, 2026-10-25). Solo en el HTML:
      // fuera de RETIRED porque los comentarios del código sí los nombran para explicarlo.
      expect(html).not.toMatch(/mercado ?pago|links? de pago[^.<]{0,60}jumpseller|jumpseller[^.<]{0,60}links? de pago/i);
      expect(html).toContain(businessHours); // pie de página
    });
  }

  it('inicio: despacho, garantía según ficha y asesoría; sin envío gratis', async () => {
    const { root } = await page('/');
    const text = root.textContent ?? '';
    expect(text).toContain('Despacho en hasta 2 días hábiles');
    expect(text).toContain('Garantía según ficha (mín. 6 meses)');
    expect(text).toContain('Asesoría técnica por correo');
    expect(text).toContain('Garantía según producto');
    expect(text).toContain('Certificaciones por producto'); // no "Productos certificados" para todo el catálogo
    expect(text).toContain('Cotización formal y despacho a todo Chile'); // barra superior
    expect(text).not.toMatch(/env[ií]o gratis/i);
    // Regiones con las palabras del dueño (PR 12b): sin la lista de transportistas de elights.cl
    expect(text).toContain('A regiones, por pagar, vía Starken, PDQ u otro operador.');
    expect(text).not.toMatch(/ECOEx|Cruz del Sur/);
  });

  it('inicio: el despacho sin costo, una vez, con el texto de la constante y enlace a sus condiciones', async () => {
    const { root } = await page('/');
    const links = [...root.querySelectorAll('a')].filter(a => /sin costo/i.test(a.textContent ?? ''));
    expect(links.map(a => [a.textContent, a.getAttribute('href')])).toEqual([[freeShippingShort, '/despacho']]);
    expect(freeShippingShort).toBe('Despacho sin costo sobre $250.000 en la Provincia de Santiago');
    // La barra sigue con 4 avisos, en una lista que se envuelve según el ancho de cada uno. En
    // columnas iguales (grid-cols-2/4) este aviso quedaba en 4 o 5 líneas junto a avisos de 1 o 2
    // (revisión de la PR 12b, medido con Space Grotesk); ver TrustBar.tsx
    const bar = links[0].closest('ul')!;
    expect(bar.children).toHaveLength(4);
    expect([...bar.children].every(li => li.tagName === 'LI')).toBe(true);
    expect(bar.className.split(' ')).toContain('flex-wrap');
    expect(bar.className).not.toMatch(/grid-cols-/);
    expect(bar.textContent).not.toContain('Despacho desde Santiago');
    expect((root.textContent ?? '').match(/sin (?:costo|cargo)|liberad[oa]/gi)).toHaveLength(1);
  });

  // Toda oferta de despacho sin costo: el monto de la constante con "sobre" o "mayor a", la zona
  // de la constante y ninguna otra (src/test/freeShipping.ts). También en las fichas (una BESTLED
  // y una de Jumpseller) y en una categoría: ahí se agregaría una promesa junto al precio.
  for (const path of [...STATIC_ROUTES, productPath(bestled.id), productPath(withoutDatasheet.id), categoryPath(bestled.categories[0]), ...guideRoutes]) {
    it(`${path}: el despacho sin costo solo con el monto y la zona de business.ts`, async () => {
      const { root } = await page(path);
      const { claims, issues } = freeShippingIssues(root);
      expect(issues).toEqual([]);
      // El detector no está vacío donde hay ofertas
      if (path === '/despacho' || path === '/terminos-y-condiciones' || path === '/') expect(claims.length, path).toBeGreaterThan(0);
    });
  }

  it('inicio: "Por qué elegir eLIGHTS" sin tarjetas repetidas', async () => {
    const { root } = await page('/');
    const section = [...root.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === '¿Por qué elegir eLIGHTS?')!;
    const titles = [...section.querySelectorAll('h3')].map(h => h.textContent);
    expect(titles).toHaveLength(8);
    expect(new Set(titles).size).toBe(8);
    expect(titles).toContain('Estudio lumínico DIALux');
    expect(section.textContent).not.toContain('Asesoría de proyectos');
    expect(section.textContent).toContain('te enviamos el informe en PDF'); // sin precio; el plazo lo da el bloque del estudio
  });

  it('/instaladores: página de contacto con un solo h1, sin niveles, descuentos ni registro', async () => {
    const { root } = await page('/instaladores');
    expect([...root.querySelectorAll('h1')].map(h => h.textContent)).toEqual(['Instaladores y profesionales']);
    const link = (text: string) => [...root.querySelectorAll('main a')].find(a => a.textContent?.trim() === text)?.getAttribute('href');
    expect(link('Escríbenos por WhatsApp')).toBe(waInstaladores);
    expect(link('Solicitar propuesta')).toBe('/cotizador');
    expect(link('ventas@elights.cl')).toBe('mailto:ventas@elights.cl');
    const text = root.textContent ?? '';
    expect(text).not.toMatch(/Standard|Silver|Gold|descuento|Crédito 30|Ejecutivo|reordena|Crear cuenta|Niveles del programa/i);
    expect(root.querySelector('main button[disabled]')).toBeNull(); // ya no está "Crear cuenta profesional"
  });

  it('/instalacion: sin cifras del hero ni precio de la visita', async () => {
    const { root } = await page('/instalacion');
    // Solo la página: desde la PR 12 el pie enlaza "Cambios, devoluciones y garantía" en todas
    const text = root.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/\$\s?20\.000|Proyectos\s*SEC|SEC\s*Certificados|Garant[ií]a|garantizad/i);
    expect(text).not.toMatch(/certificaci[oó]n/i); // ni la de la instalación eléctrica (licencia SEC sin confirmar)
    expect(text).toContain('Evaluamos tu espacio y te enviamos una propuesta detallada.');
  });

  it('/instalacion: las tres tarjetas de servicio con su etiqueta, sin repetir textos', async () => {
    const { root } = await page('/instalacion');
    const cards = [...root.querySelectorAll('#servicios h3')].map(h => h.parentElement!);
    expect(cards.map(c => c.querySelector('h3')?.textContent)).toEqual(['Visita Técnica', 'Instalación Completa', 'Paneles Solares']);
    expect(cards.map(c => c.querySelector('span.rounded-full')?.textContent?.trim())).toEqual([
      'Informe con recomendaciones',
      'Producto + Mano de obra incluida',
      'Conexión a la red (Net Billing)',
    ]);
    for (const c of cards) expect(c.querySelector('p')?.className).toContain('mb-5');
    const text = root.textContent ?? '';
    expect(text.match(/Net Billing/g)).toHaveLength(1);
    expect(text.match(/Sin compromiso/g)).toHaveLength(1); // la etiqueta del formulario; no se repite bajo el botón
    expect(text).toContain('¿Cómo funciona?');
    expect(text).toContain('¿Prefieres no llenar el formulario? Escríbenos por WhatsApp o por correo');
  });

  it('/estudio-luminico: tipos de proyecto sin afirmar experiencia; FAQ con tildes', async () => {
    const { root } = await page('/estudio-luminico');
    const text = root.textContent ?? '';
    expect(text).toContain('Estos son los tipos de proyecto que estudiamos.');
    expect(text).not.toMatch(/experiencia en/i);
    expect(text).toContain('¿Sirve para licitaciones?');
    expect(text).toContain('indícala en el formulario');
    expect(text).toContain('¿Prefieres no llenar el formulario? Escríbenos por WhatsApp');
    const faq = [...root.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === 'Preguntas frecuentes')!;
    expect(faq.textContent).not.toMatch(/\bSi\. |\b(?:Cuanto|que formato|Que normativas)\b/);
    // El texto propio de la página (los formularios tienen sus propios tests de etiquetas)
    expect(text).not.toMatch(/indicalaa|\b(?:segun|modelacion|Cuantame|planificacion|Posicion|Visualizacion|tecnicos|instalacion)\b/);
  });

  it('encabezado: sin el enlace "Mi cuenta"', async () => {
    const { root } = await page('/');
    expect(root.querySelector('header [title="Mi cuenta"]')).toBeNull();
    expect(root.querySelector('header a[href="/instaladores"]')).toBeNull(); // solo estaba en "Mi cuenta" (el menú móvil está cerrado)
  });

  it('ficha BESTLED: su garantía de 5 años junto al despacho y la FAQ de garantía según la ley', async () => {
    const { root } = await page(productPath(bestled.id));
    const text = root.textContent ?? '';
    expect(text).toContain('Despacho en hasta 2 días hábiles');
    // La primera cifra de garantía que se ve es la del producto, no la legal
    expect(text).toContain('Garantía de 5 años (mín. legal 6 meses)');
    expect(text).not.toContain('Garantía legal de 6 meses');
    expect(text.indexOf('Garantía de 5 años')).toBeLessThan(text.search(/Garant[ií]a\s*5 años/));
    expect(text).toContain('durante esos 6 meses el cliente elige entre reparación, cambio o devolución');
    // Con ficha técnica: el botón descarga el PDF
    const datasheet = [...root.querySelectorAll('a')].find(a => a.textContent?.trim() === 'Ficha técnica');
    expect(datasheet?.getAttribute('href')).toBe(bestled.datasheetUrl);
  });

  it('ficha sin ficha técnica: sin botón deshabilitado ni "próximamente", con la garantía legal', async () => {
    const { root, html } = await page(productPath(withoutDatasheet.id));
    const buttons = [...root.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Ficha técnica');
    expect(buttons).toEqual([]);
    expect(html).not.toMatch(/Ficha técnica pr[oó]ximamente/i);
    expect(html).not.toContain('Mi cuenta');
    expect(root.textContent).toContain('Garantía legal de 6 meses');
    expect(html).toContain(businessHours);
  });

  it('ficha con garantía de 1 año en Jumpseller: esa cifra junto al precio, no solo la legal', async () => {
    const { root } = await page(productPath(oneYear.id));
    const text = root.textContent ?? '';
    expect(text).toContain('Garantía de 1 año (mín. legal 6 meses)');
    expect(text).not.toContain('Garantía legal de 6 meses');
  });

  it('ficha de un producto para proyectos: "Precio referencial" sin promesa de descuentos', async () => {
    const { root } = await page(productPath(projectProduct.id));
    const text = root.textContent ?? '';
    expect(text).toContain('Precio referencial');
    expect(text).not.toMatch(/descuento|cont[aá]ctanos para/i);
  });
});

// Las mutaciones de la revisión de la PR 12b: todas pasaban el detector anterior
describe('despacho sin costo: el detector atrapa ofertas que contradicen la constante', () => {
  const T = clp(FREE_SHIPPING_THRESHOLD_CLP);
  const issuesOf = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return freeShippingIssues(root);
  };

  it('acepta las ofertas del sitio y las menciones genéricas; ignora "sin costo" que no es despacho', () => {
    for (const html of [
      `<a href="/despacho">${freeShippingShort}</a>`,
      `<ul><li><strong>Despacho sin costo</strong> si el total de tu compra, con IVA, es mayor a ${T} y la entrega es en la Provincia de Santiago.</li></ul>`,
      `<ul><li>Va por separado en la cotización, o la cotización indica que va sin costo (compras sobre ${T} con IVA, con entrega en la Provincia de Santiago) o por pagar. Las comunas que no entran están en <a href="/despacho">Despacho</a>.</li></ul>`,
      '<p>El costo del despacho no está incluido en el precio de los productos. Antes de que pagues, la cotización y el link de pago lo muestran por separado, o indican que va sin costo o por pagar.</p>',
      '<p>El despacho sin costo es una condición permanente de venta, no una promoción con fecha de término.</p>',
    ]) {
      const { claims, issues } = issuesOf(html);
      expect(claims, html).toHaveLength(1);
      expect(issues, html).toEqual([]);
    }
    expect(issuesOf('<ul><li>reparación sin costo;</li></ul>')).toEqual({ claims: [], issues: [] }); // garantía
    expect(claimIssues(`Despacho en hasta 2 días hábiles desde que tu pago está confirmado. Sin costo sobre ${T} con IVA en la Provincia de Santiago.`)).toEqual([]);
  });

  it.each([
    ['comunas que no entran', '<p>Puente Alto y San Bernardo también tienen despacho sin costo.</p>'],
    ['toda la Región Metropolitana', '<p>Despacho sin costo en toda la Región Metropolitana.</p>'],
    ['todo Chile, sin monto ni zona', '<p>Despacho sin costo a todo Chile.</p>'],
    ['sin monto ni zona', '<p>Despacho sin costo.</p>'],
    ['la zona sin el monto', '<p>Despacho sin costo en la Provincia de Santiago.</p>'],
    ['otro monto junto al precio de la ficha', '<div><span>$250.990</span><span class="text-xs">Despacho sin costo sobre $200.000 en Santiago</span></div>'],
    ['tarjeta: título y párrafo', '<div><h3>Despacho sin costo</h3><p>En compras sobre $200.000 en Santiago.</p></div>'],
    ['tarjeta: título junto a un ícono', '<div><div><svg></svg><h3>Despacho sin costo</h3></div><p>En compras sobre $200.000 en Santiago.</p></div>'],
    ['"sin cargo"', '<p>Despacho sin cargo sobre $200.000 en Santiago.</p>'],
    ['"o más" con el monto de la constante', `<ul><li>Si tu compra es de ${T} o más, el despacho va sin costo.</li></ul>`],
    ['"desde" el monto', `<p>Despacho sin costo desde ${T} en la Provincia de Santiago.</p>`],
    ['"igual o mayor a"', `<p>Despacho sin costo en compras igual o mayor a ${T} en la Provincia de Santiago.</p>`],
    ['la zona y además una comuna que no entra', `<p>Despacho sin costo sobre ${T} en la Provincia de Santiago y en Puente Alto.</p>`],
    ['título correcto, párrafo con otra comuna', `<div><h3>Despacho sin costo sobre ${T} en la Provincia de Santiago</h3><p>También en Calera de Tango.</p></div>`],
    ['"liberado" en "Santiago centro"', `<p>Despacho liberado sobre ${T} en Santiago centro.</p>`],
    ['a regiones', `<p>Despacho sin costo sobre ${T} en la Provincia de Santiago y a regiones.</p>`],
  ])('detecta: %s', (_, html) => {
    expect(issuesOf(html).issues).not.toEqual([]);
  });
});

// ── D.S. N°1/2022 (auditoría UX, entrega 4) ─────────────────────────────────────────────
// Reglas en src/data/catalog/ds1.ts. No dependen de valores del catálogo que cambian con
// Jumpseller: revisan el contenido propio (lo que escribe eLIGHTS) y la lista de productos con
// certificado (DS1_CERTIFIED_LINES), que decide el dueño.

/** Todos los textos de un valor (objeto, lista o texto), uno por línea. */
const textsOf = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(textsOf) : value && typeof value === 'object' ? Object.values(value).flatMap(textsOf) : [];

const CONTENT = import.meta.glob<ProductContent>('/src/data/catalog/content/*.json', { eager: true, import: 'default' });
const contentEntries = Object.entries(CONTENT).map(([path, c]) => [Number(path.match(/(\d+)\.json$/)![1]), c] as const);
const CONFIG_SOURCES = import.meta.glob<string>(['/src/data/catalog/categories.config.ts', '/src/data/catalog/category-intros.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Las únicas oraciones de las introducciones de categoría que afirman el certificado D.S. N°1:
 * nombran las líneas certificadas de alumbrado público (DS1_CERTIFIED_LINES: BESTLED, Flyhawk,
 * solar industrial All in One y Pagoda solar UFO; sin la Island, que es ornamental, ni los Slim
 * SMD y los proyectores de estadio) y solo sus versiones certificadas; la clasificación para
 * Áreas de Protección Especial, solo de las BESTLED (su certificado detallado, PR #78). Una
 * oración nueva con el certificado se agrega aquí solo con la decisión del dueño.
 */
const APPROVED_CERTIFICATE_SENTENCES: ReadonlySet<string> = new Set([
  'Las líneas BESTLED, Flyhawk y Solar industrial All in One tienen certificado D.S. N°1 en sus versiones de 2200K y 2700K; la Pagoda LED solar UFO, en sus versiones ámbar de 1600K y cálida de 2700K.',
  'En las BESTLED, la de 2700K es para el resto del país y la de 2200K es apta también para las Áreas de Protección Especial.',
  'Ver BESTLED con certificado D.S. N°1',
]);

/** Textos de una introducción de categoría, cada uno por separado (título, párrafos, botones, detalle). */
const introTexts = (intro: CategoryIntro) => [
  intro.title,
  ...intro.paragraphs,
  ...intro.actions.flatMap(a => [a.label, a.hint ?? '', 'mailSubject' in a.to ? a.to.mailSubject : '']),
  intro.details.summary,
  ...intro.details.items.map(i => `${i.label}: ${i.text}`),
];
/** En una introducción, el certificado solo se afirma en las oraciones aprobadas. */
const introIssues = (texts: string[]) =>
  texts.flatMap(sentences).flatMap(s => ds1Issues(s, { certified: APPROVED_CERTIFICATE_SENTENCES.has(s) }));

/** La ficha publicada a la que lleva el botón de las BESTLED: la primera candidata publicada, o ninguna. */
const ds1ButtonTarget = () =>
  DS1_BUTTON_PRODUCTS.map(id => products.find(p => p.jumpseller_id === id)).find((p): p is Product => p !== undefined);

describe('D.S. N°1/2022: el contenido propio solo afirma lo documentado', () => {
  it('el certificado es de las 8 líneas del dueño (33 productos), cada una con sus versiones; la ficha editorial de las BESTLED lo dice por variante', () => {
    // Decisiones del dueño del 22-10-2026: las cálidas de 2200K y 2700K en 5 líneas y la ámbar de
    // 1600K y la de 2700K en la Pagoda; la del 23-10-2026 reemplaza «todas las versiones» en los
    // proyectores de estadio por las de hasta 5000K (la Tabla 4 limita el alumbrado deportivo a
    // 5000K o 3000K según la clase del recinto)
    const versions = Object.fromEntries(Object.entries(DS1_CERTIFIED_LINES).map(([line, l]) => [line, l.versions]));
    expect(versions).toEqual({
      bestled: [2200, 2700],
      flyhawk: [2200, 2700],
      solarIndustrial: [2200, 2700],
      island: [2200, 2700],
      slim: [2200, 2700],
      pagoda: [1600, 2700],
      estadioModular: { maxKelvin: 5000 },
      estadio: { maxKelvin: 5000 },
    });
    expect(DS1_SPORTS_MAX_KELVIN).toBe(5000);
    expect(DS1_WARM_KELVIN).toEqual([2200, 2700]);
    for (const [line, l] of Object.entries(DS1_CERTIFIED_LINES)) expect(l.ids.length, line).toBeGreaterThan(0);
    expect(DS1_CERTIFIED_IDS).toHaveLength(33);
    expect(new Set(DS1_CERTIFIED_IDS).size).toBe(DS1_CERTIFIED_IDS.length);
    // Los Slim de 30, 50 y 100W no tienen certificado
    for (const id of [2340468, 2340483, 2340625]) expect(ds1Certificate(id), String(id)).toBe(false);
    // Solo los proyectores de estadio son de recintos deportivos
    expect(Object.entries(DS1_CERTIFIED_LINES).filter(([, l]) => l.sports).map(([line]) => line)).toEqual(['estadioModular', 'estadio']);
    for (const id of DS1_CERTIFIED_LINES.bestled.ids) {
      const text = textsOf(editorialOverlay[id]).join('\n');
      expect(text, String(id)).toContain('certificación DS1 en sus variantes 2200K y 2700K');
    }
  });

  it('preguntas por producto y por versión: cada línea con su regla', () => {
    const [slim, pagoda, island, estadio, modular, bestled] = (['slim', 'pagoda', 'island', 'estadio', 'estadioModular', 'bestled'] as const).map(
      line => DS1_CERTIFIED_LINES[line].ids[0],
    );
    const other = 2340625; // Slim 100W, sin certificado
    expect(ds1Line(slim)?.key).toBe('slim');
    expect(ds1Line(modular)?.key).toBe('estadioModular');
    expect(ds1Line(other)).toBeUndefined();
    expect(ds1Line(undefined)).toBeUndefined();
    for (const id of DS1_CERTIFIED_IDS) expect(isDs1Certified(id), String(id)).toBe(true);
    for (const id of [other, undefined]) expect(isDs1Certified(id)).toBe(false);

    const certifiedKelvin = (id: number | undefined, kelvin: readonly number[]) => kelvin.filter(k => isDs1CertifiedKelvin(id, k));
    const ALL = [1600, 2200, 2700, 3000, 4000, 5000, 6000, 6500];
    expect(certifiedKelvin(bestled, ALL)).toEqual([2200, 2700]);
    expect(certifiedKelvin(island, ALL)).toEqual([2200, 2700]);
    expect(certifiedKelvin(slim, ALL)).toEqual([2200, 2700]); // no la de 3000K ni las frías
    expect(certifiedKelvin(pagoda, ALL)).toEqual([1600, 2700]); // no la de 4000K ni la de 5000K
    // Estadios: hasta 5000K, no la fría de 6000K ni la de 6500K (23-10-2026)
    expect(certifiedKelvin(estadio, ALL)).toEqual([1600, 2200, 2700, 3000, 4000, 5000]);
    expect(certifiedKelvin(modular, ALL)).toEqual([1600, 2200, 2700, 3000, 4000, 5000]);
    expect(certifiedKelvin(other, ALL)).toEqual([]);
    expect(certifiedKelvin(undefined, ALL)).toEqual([]);
  });

  it('fichas SEO (content/*.json): el certificado D.S. N°1 solo en las líneas certificadas y en sus versiones, sin la sigla DS1, sin el D.S. N°43, sin luz azul en canchas ni en los proyectores de estadio y sin el % de luz azul junto a la norma', () => {
    expect(contentEntries.length).toBeGreaterThan(0);
    const problems = contentEntries.flatMap(([id, c]) => ds1ContentIssues(c, id).map(p => `${id}: ${p}`));
    expect(problems).toEqual([]);
    // Las BESTLED usan su ficha editorial (la única con la clasificación para Áreas de Protección Especial)
    expect(contentEntries.filter(([id]) => DS1_CERTIFIED_LINES.bestled.ids.includes(id)).map(([id]) => id)).toEqual([]);
  });

  it('el detector de las fichas SEO: en una línea certificada, el certificado va con sus versiones certificadas; en el resto, nunca', () => {
    const certified = { certified: ds1Certificate(DS1_CERTIFIED_LINES.flyhawk.ids[0]) };
    for (const text of [
      'Las versiones cálidas de 2200K y 2700K tienen certificado D.S. N°1/2022.',
      'La de 2.200 K tiene certificado D.S. N°1/2022, la norma de contaminación lumínica.',
      '¿Qué versiones tienen certificado D.S. N°1/2022?',
      '¿Necesitas el D.S. N°1? Te asesoramos',
    ]) {
      expect(ds1Issues(text, certified), text).toEqual([]);
    }
    for (const text of [
      'Tiene certificado D.S. N°1/2022.',
      'Las versiones de 2200K, 2700K y 4000K tienen certificado D.S. N°1/2022.',
      'La de 5000K cumple el D.S. N°1/2022.',
      'Todas sus versiones tienen certificado D.S. N°1/2022, también la de 2700K.',
      'Certificación SEC y DS1 en 2200K.',
      'La de 2200K tiene certificado D.S. N°1/2022 y es apta para Áreas de Protección Especial.',
    ]) {
      expect(ds1Issues(text, certified), text).not.toEqual([]);
    }
    // Slim SMD: la de 3000K no tiene certificado
    const slim = { certified: ds1Certificate(DS1_CERTIFIED_LINES.slim.ids[0]) };
    expect(ds1Issues('Las de 2200K y 2700K tienen certificado D.S. N°1/2022.', slim)).toEqual([]);
    expect(ds1Issues('Las de 2200K, 2700K y 3000K tienen certificado D.S. N°1/2022.', slim)).not.toEqual([]);
    // …ni nombrada sin «K» o por su tono, ni en otra oración sin la norma (también en la Island)
    const island = { certified: ds1Certificate(DS1_CERTIFIED_LINES.island.ids[0]) };
    for (const text of [
      'Las versiones de 2200K, 2700K y la fría tienen certificado D.S. N°1/2022.',
      'La de 2700K y la neutra tienen certificado D.S. N°1/2022.',
      'Las cálidas de 2200K, 2700K y 3000 tienen certificado D.S. N°1/2022.',
      'La de 3000K también lo tiene.',
      'La versión de 4000K está certificada.',
      'La de 4000K tiene el mismo certificado.',
    ]) {
      expect(ds1Issues(text, slim), text).not.toEqual([]);
      expect(ds1Issues(text, island), text).not.toEqual([]);
    }
    for (const text of ['La de 3000K y la fría de 6500K no lo tienen.', 'Las de 2200K y 2700K tienen certificado D.S. N°1/2022, exigible desde el 19-10-2026.']) {
      expect(ds1Issues(text, slim), text).toEqual([]);
    }
    // Un tono frío o neutro con una temperatura cálida es un error de redacción: en las líneas
    // certificadas por versión se sigue marcando (solo los estadios aceptan «la fría de 5000K»)
    for (const text of [
      'La fría de 2700K tiene certificado D.S. N°1/2022.',
      'La neutra (2200K) y la de 2700K tienen certificado D.S. N°1/2022.',
      'La de 2200K tiene certificado D.S. N°1/2022. La fría - 2700K está certificada.',
    ]) {
      expect(ds1Issues(text, slim), text).not.toEqual([]);
      expect(ds1Issues(text, island), text).not.toEqual([]);
    }
    // La respuesta a la pregunta por el certificado tampoco nombra una versión sin certificado
    expect(ds1Issues('¿Qué versiones tienen certificado D.S. N°1/2022?\nLas de 2200K, 2700K y 3000K.', slim)).toContainEqual(
      expect.stringContaining('extiende el certificado D.S. N°1 a una versión sin certificado (3000K'),
    );
    expect(ds1Issues('¿Qué versiones tienen certificado D.S. N°1/2022?\nLas cálidas de 2200K y 2700K. La de 3000K no lo tiene.', slim)).toEqual([]);
    // Pagoda: la ámbar de 1600K y la de 2700K, no la de 2200K ni las frías
    const pagoda = { certified: ds1Certificate(DS1_CERTIFIED_LINES.pagoda.ids[0]) };
    expect(ds1Issues('Sus versiones ámbar de 1600K y cálida de 2700K tienen certificado D.S. N°1/2022.', pagoda)).toEqual([]);
    for (const text of ['La de 2200K tiene certificado D.S. N°1/2022.', 'Las de 1600K, 2700K y 4000K tienen certificado D.S. N°1/2022.']) {
      expect(ds1Issues(text, pagoda), text).not.toEqual([]);
    }
    // Proyectores de estadio (23-10-2026): solo las versiones de hasta 5000K, nombradas en la
    // oración del certificado; nunca sin límite, en una de más de 5000K ni en «todas sus
    // versiones»; sin la sigla ni la luz azul
    for (const id of [DS1_CERTIFIED_LINES.estadio.ids[0], DS1_CERTIFIED_LINES.estadioModular.ids[0]]) {
      const stadium = { certified: ds1Certificate(id) };
      for (const text of [
        'Para alumbrado deportivo, sus versiones cálida de 2700K, neutra de 4000K y fría de 5000K tienen certificado D.S. N°1/2022.',
        'Para alumbrado deportivo, su versión cálida de 3000K tiene certificado D.S. N°1/2022. La fría de 6000K no lo tiene.',
        'Tienen certificado D.S. N°1/2022 sus versiones de 2200K, 2700K, 4000K y 5000K.',
        'La neutra (4000K) tiene certificado D.S. N°1/2022.',
        '¿Qué versiones tienen certificado D.S. N°1/2022?',
        '¿Qué versiones tienen certificado D.S. N°1/2022?\nPara alumbrado deportivo, la cálida de 3000K. La fría de 6000K no lo tiene.',
        'La de 3000K tiene certificado D.S. N°1/2022. También se cotiza en fría de 6000K, sin certificado.',
        'Tiene certificado D.S. N°1/2022 en la luz blanca cálida de 2700K.',
        '¿Necesitas el D.S. N°1/2022? Te asesoramos: escríbenos a ventas@elights.cl.',
      ]) {
        expect(ds1Issues(text, stadium), `${id}: ${text}`).toEqual([]);
      }
      for (const [text, problem] of [
        ['Este proyector tiene certificado D.S. N°1/2022.', /sin decir de qué versiones \(solo las de hasta 5000K\)/],
        ['Para alumbrado deportivo, tiene certificado D.S. N°1/2022.', /sin decir de qué versiones/],
        ['Tiene certificado D.S. N°1/2022 en todas sus versiones, también en 5000K.', /de todas las versiones/],
        ['Tiene certificado D.S. N°1/2022 en sus cuatro temperaturas de color, desde 2200K.', /de todas las versiones/],
        ['Las versiones de 3000K y 6000K tienen certificado D.S. N°1/2022.', /junto a una versión sin certificado \(6000K/],
        ['La fría de 6500K cumple el D.S. N°1/2022.', /sin decir de qué versiones/],
        ['La de 3000K y la fría tienen certificado D.S. N°1/2022.', /junto a una versión sin certificado \(fría/],
        ['La de 3000K tiene certificado D.S. N°1/2022. La de 6000K también lo tiene.', /extiende el certificado D.S. N°1 a una versión sin certificado \(6000K/],
        // «Ambas», «sus dos versiones»: los estadios de 300 y 500W tienen dos, una de 6000K
        ['Ambas versiones, incluida la cálida de 3000K, tienen certificado D.S. N°1/2022.', /de todas las versiones/],
        ['Sus dos versiones, incluida la de 2200K, tienen certificado D.S. N°1/2022.', /de todas las versiones/],
        ['La de 3000K tiene certificado D.S. N°1/2022, igual que la otra versión.', /también en otra versión, sin nombrarla/],
        // La respuesta a una pregunta por el certificado, y la oración que sigue con «también»
        ['¿Qué versiones tienen certificado D.S. N°1/2022?\nLa cálida de 3000K y la fría de 6000K.', /extiende el certificado D.S. N°1 a una versión sin certificado \(6000K/],
        ['¿Tiene certificado D.S. N°1/2022?\nSí, para alumbrado deportivo.', /pregunta cuya respuesta no dice de qué versiones/],
        ['La de 3000K tiene certificado D.S. N°1/2022. La de 6000K, también.', /extiende el certificado D.S. N°1 a una versión sin certificado \(6000K/],
        ['La de 3000K tiene certificado D.S. N°1/2022. Lo mismo vale para la de 6500K.', /extiende el certificado D.S. N°1 a una versión sin certificado \(6500K/],
        // Otros nombres de la fría: «frío», «luz de día», «la blanca»
        ['Tiene certificado D.S. N°1/2022 en sus tonos cálido de 2200K y frío.', /junto a una versión sin certificado \(frío/],
        ['Tiene certificado D.S. N°1/2022 en 2200K y en luz de día.', /junto a una versión sin certificado \(luz de día/],
        ['La de 3000K y la blanca tienen certificado D.S. N°1/2022.', /junto a una versión sin certificado \(la blanca/],
        ['Certificación SEC y DS1.', /sigla «DS1»/],
        ['En canchas, la de 2700K tiene 7% de luz azul y certificado D.S. N°1/2022.', /luz azul a canchas/],
      ] as const) {
        expect(
          ds1Issues(text, stadium).some(p => problem.test(p)),
          `${id}: ${text}`,
        ).toBe(true);
      }
    }
    // Fuera de las líneas certificadas (o sin id), ni siquiera en 2200K
    const other = contentEntries.map(([id]) => id).find(id => !DS1_CERTIFIED_IDS.includes(id))!;
    for (const id of [other, undefined]) {
      expect(ds1Issues('Las versiones de 2200K y 2700K tienen certificado D.S. N°1/2022.', { certified: ds1Certificate(id) })).not.toEqual([]);
    }
  });

  it('estadios: el certificado solo en las versiones de hasta 5000K que el producto tiene entre sus variantes; sin ninguna, asesoría', () => {
    // Las opciones de las variantes como las da Jumpseller (ProductFacts.variantOptions). La
    // verificación contra el catálogo real va en content.test.ts (checkFacts), que el robot de
    // sincronización solo informa.
    const ficha = (description: string): ProductContent => ({ metaTitle: '', metaDescription: '', description, keyBenefits: [], useCases: [], faq: [] });
    const [estadio300, , estadio600] = DS1_CERTIFIED_LINES.estadio.ids;
    const modular800 = DS1_CERTIFIED_LINES.estadioModular.ids[7];
    const options300 = ['Color de Temperatura: Luz Cálida - 3000K', 'Color de Temperatura: Luz Fría- 6000K'];
    const options600 = ['Color de Temperatura: Luz Fría- 6000K'];
    const options800 = ['Color de Luz: Luz Cálida - 1% Luz Azul', 'Color de Luz: Luz Cálida - 7% Luz Azul', 'Color de Luz: Luz Neutra – 4000K', 'Color de Luz: Luz fría - 5000K'];

    // Con una versión de hasta 5000K: la nombra; la de más, en otra oración que no lo afirma
    const ok300 = 'Para alumbrado deportivo, su versión cálida de 3000K tiene certificado D.S. N°1/2022. La fría de 6000K no lo tiene.';
    expect(ds1VariantIssues(ficha(ok300), estadio300, options300)).toEqual([]);
    for (const text of [
      'La de 5000K tiene certificado D.S. N°1/2022.',
      'Las de 3000K y 4000K tienen certificado D.S. N°1/2022.',
      'La de 3000K tiene certificado D.S. N°1/2022. La de 2700K también lo tiene.',
      'La de 3000K tiene certificado D.S. N°1/2022. La de 4000K, también.',
      '¿Qué versiones tienen certificado D.S. N°1/2022?\nLa de 2700K.',
    ]) {
      expect(ds1VariantIssues(ficha(text), estadio300, options300), text).toContainEqual(expect.stringContaining('en una versión que el producto no tiene'));
    }
    // Sin ninguna de hasta 5000K (el de 600W, solo 6000K): ninguna afirmación, solo asesoría
    for (const text of ['Para alumbrado deportivo, tiene certificado D.S. N°1/2022.', 'La de 5000K tiene certificado D.S. N°1/2022.']) {
      expect(ds1VariantIssues(ficha(text), estadio600, options600), text).toContainEqual(expect.stringContaining('no tiene versiones de hasta 5000K (sus variantes: 6000K)'));
    }
    expect(ds1VariantIssues(ficha('¿Necesitas el D.S. N°1/2022? Te asesoramos: escríbenos a ventas@elights.cl.'), estadio600, options600)).toEqual([]);
    expect(ds1VariantIssues(ficha('La fría de 6000K no lo tiene.'), estadio600, options600)).toEqual([]);
    // Una cálida que Jumpseller no da con su cifra (el modular de 800W) cuenta como de hasta 5000K
    const ok800 = 'Para alumbrado deportivo, sus versiones de tono cálido, la neutra de 4000K y la fría de 5000K tienen certificado D.S. N°1/2022.';
    expect(ds1VariantIssues(ficha(ok800), modular800, options800)).toEqual([]);
    expect(ds1VariantIssues(ficha('La cálida de 2700K tiene certificado D.S. N°1/2022.'), modular800, options800)).toContainEqual(
      expect.stringContaining('en una versión que el producto no tiene (2700K'),
    );
    // Las demás líneas certificadas no dependen de las variantes: las revisa ds1ContentIssues
    const slim = DS1_CERTIFIED_LINES.slim.ids[0];
    expect(ds1VariantIssues(ficha('Las de 2200K y 2700K tienen certificado D.S. N°1/2022.'), slim, [])).toEqual([]);
  });

  it('fichas SEO: una pregunta sobre la norma no se responde con el % de luz azul (se lee como «cumple»)', () => {
    const faq = { question: '¿Sirve para un proyecto que debe cumplir el D.S. N°1/2022?', answer: 'Se ofrece en 2200K (1% de luz azul) y 2700K (7% de luz azul).' };
    const [[, sample]] = contentEntries;
    expect(ds1ContentIssues({ ...sample, faq: [...sample.faq, faq] }).some(p => p.startsWith('da el % de luz azul junto a la norma'))).toBe(true);
  });

  it('fichas editoriales: el certificado solo en productos con certificado, y nunca el D.S. N°43', () => {
    const entries = Object.entries(editorialOverlay);
    expect(entries.length).toBeGreaterThan(0);
    // La de las BESTLED está aprobada tal cual (PR #78: reparte las variantes en varias
    // oraciones); otra línea certificada, solo con la versión de 2200K o 2700K en cada oración
    const certified = (id: number) => DS1_CERTIFIED_LINES.bestled.ids.includes(id) || ds1Certificate(id);
    const problems = entries.flatMap(([id, e]) => ds1Issues(textsOf(e).join('\n'), { certified: certified(Number(id)) }).map(p => `${id}: ${p}`));
    expect(problems).toEqual([]);
  });

  it('portada («Por qué elegir eLIGHTS»): sin la sigla DS1 ni certificados D.S. N°1', () => {
    const problems = Object.values(trustClaims).flatMap(c => ds1Issues(`${c.title}. ${c.desc}`, { certified: false }));
    expect(problems).toEqual([]);
    expect(trustClaims.certifications.desc).not.toMatch(/\bDS\s?-?0?1\b|D\.S\./);
  });

  it('introducciones de categoría: el certificado solo en las oraciones aprobadas, y su botón lleva a BESTLED certificadas', () => {
    const intros = Object.entries(CATEGORY_INTROS);
    expect(intros.map(([slug]) => slug)).toContain('alumbrado-publico');
    for (const [slug, intro] of intros) {
      expect(introIssues(introTexts(intro)), slug).toEqual([]);
      for (const a of intro.actions) {
        if ('products' in a.to) {
          expect(a.to.products.length, `${slug}: ${a.label}`).toBeGreaterThan(0);
          for (const id of a.to.products) expect(DS1_CERTIFIED_IDS, `${slug}: ${a.label}`).toContain(id);
        }
      }
    }
    // La 60W primero; después, el resto de las BESTLED, por si la sincronización deja de publicarla
    expect(DS1_BUTTON_PRODUCTS[0]).toBe(BESTLED_60W_ID);
    expect([...DS1_BUTTON_PRODUCTS].sort()).toEqual([...DS1_CERTIFIED_LINES.bestled.ids].sort());
  });

  it('categories.config.ts y category-intros.ts (sus textos) no citan el D.S. N°43, no usan la sigla DS1 ni afirman otros certificados', () => {
    const files = Object.keys(CONFIG_SOURCES);
    expect(files).toHaveLength(2);
    for (const [file, src] of Object.entries(CONFIG_SOURCES)) {
      // Los textos entre comillas del código, sin comentarios ni imports (los nombres como
      // DS1_CERTIFIED_IDS no son texto del sitio)
      const code = src.split('\n').filter(l => !/^\s*(?:\/\/|\/?\*|import\b)/.test(l)).join('\n');
      const strings = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2] ?? m[3]);
      expect(strings.length, file).toBeGreaterThan(0);
      expect(introIssues(strings), file).toEqual([]);
    }
  });

  it('el detector de las introducciones atrapa un certificado fuera de las oraciones aprobadas', () => {
    for (const text of [
      'Ver luminarias con certificado D.S. N°1',
      'Los solares de esta categoría cumplen el D.S. N°1/2022.',
      'Las BESTLED y la Flyhawk tienen certificado D.S. N°1.',
      'Las líneas BESTLED, Flyhawk y Solar industrial All in One tienen certificado D.S. N°1 en todas sus versiones.',
      'El proyector de estadio modular tiene certificado D.S. N°1 en 2700K.',
      'Los proyectores de estadio tienen certificado D.S. N°1 en todas sus versiones.',
      'Los proyectores de estadio tienen certificado D.S. N°1 hasta 5000K.',
      'La Island tiene certificado D.S. N°1 en sus versiones de 2200K y 2700K.',
      'La Pagoda LED solar UFO tiene certificado D.S. N°1 en todas sus versiones.',
      'Los Slim SMD tienen certificado D.S. N°1 en 2200K y 2700K.',
      'La versión de 2200K es apta para Áreas de Protección Especial.',
      'Cumple la normativa lumínica chilena.',
      'Certificada para cielos oscuros.',
      'Cumple la norma de emisión de luminosidad artificial.',
      'Cumple el Decreto 1 del MMA.',
      'En canchas, la luz azul no puede superar el 1 %.',
      'Certificación SEC, DS1 y DS43.',
    ]) {
      expect(introIssues([text]), text).not.toEqual([]);
    }
    expect(introIssues([...APPROVED_CERTIFICATE_SENTENCES, '¿Necesitas el D.S. N°1? Te asesoramos'])).toEqual([]);
  });
});

describe('D.S. N°1/2022 en las páginas', () => {
  it('inicio: el aviso del hero lleva a alumbrado público, sin "con certificado"', async () => {
    expect(DS1_NOTICE.to).toBe(categoryPath('alumbrado-publico'));
    const { root } = await page('/');
    const notices = [...root.querySelectorAll('main a')].filter(a => a.textContent?.includes('D.S. N°1/2022'));
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    expect(notice.closest('section')?.querySelector('h1')).not.toBeNull(); // en el hero, junto al título
    expect(notice.getAttribute('href')).toBe(categoryPath('alumbrado-publico'));
    expect(notice.textContent).toBe(`${DS1_NOTICE.label} ${DS1_NOTICE.text} ${DS1_NOTICE.cta} `);
    expect(notice.textContent).toContain('desde el 19 de octubre de 2026 rige en todo Chile para el alumbrado exterior nuevo.');
    expect(notice.textContent).not.toMatch(/certific|cumple|DS1\b|todo alumbrado/i);
  });

  it('/catalogo/alumbrado-publico: el bloque D.S. N°1, antes de la grilla, con sus botones, el detalle y las fuentes', async () => {
    const { html, root } = await page(categoryPath('alumbrado-publico'));
    const block = root.querySelector('section[aria-labelledby="category-intro-title"]')!;
    expect(block).not.toBeNull();
    expect(block.querySelector('h2')?.textContent).toBe('Alumbrado público y D.S. N°1/2022');
    expect(html.indexOf('category-intro-title')).toBeLessThan(html.indexOf('grid grid-cols-2')); // antes de la grilla
    const text = block.textContent ?? '';
    // Lo que es "nuevo" (art. 3 aa): proyectos adjudicados o iniciados desde la fecha
    expect(text).toContain('Desde el 19 de octubre de 2026, el D.S. N°1/2022 del Ministerio del Medio Ambiente');
    expect(text).toContain('a las luminarias exteriores de los proyectos de instalación o recambio que se adjudican o comienzan desde esa fecha.');
    expect(text).toContain('En las Áreas de Protección Especial se exige desde el 19 de octubre de 2024.');
    // Las líneas certificadas de alumbrado público, en sus versiones certificadas (decisión del dueño, 22-10-2026)
    expect(text).toContain(
      'Las líneas BESTLED, Flyhawk y Solar industrial All in One tienen certificado D.S. N°1 en sus versiones de 2200K y 2700K; la Pagoda LED solar UFO, en sus versiones ámbar de 1600K y cálida de 2700K.',
    );
    expect(text).not.toMatch(/estadio|island|slim|(?:3|4|5|6)\.?[05]00\s?K/i);
    expect(text).toContain(responseTimePromise); // el mismo día hábil, por correo
    expect(text).not.toMatch(/stock|DS ?43|2029|WhatsApp|ll[aá]manos|al aire libre|todo alumbrado/i);

    const link = (label: string) => [...block.querySelectorAll('a')].find(a => a.textContent?.startsWith(label));
    // Botón de las BESTLED: la primera candidata publicada (la 60W si está); sin ninguna publicada, no aparece
    const target = ds1ButtonTarget();
    const bestledLink = link('Ver BESTLED con certificado D.S. N°1');
    if (target) {
      expect(DS1_CERTIFIED_IDS).toContain(target.jumpseller_id);
      expect(bestledLink?.getAttribute('href')).toBe(productPath(target.id));
    } else {
      expect(bestledLink).toBeUndefined();
    }
    const mail = link('¿Tu comuna es Área de Protección Especial? Pregúntanos')?.getAttribute('href') ?? '';
    expect(mail.startsWith(`mailto:${contactEmail}?subject=`)).toBe(true);
    expect(decodeURIComponent(mail.split('subject=')[1])).toBe('Consulta D.S. N°1/2022: ¿mi comuna es Área de Protección Especial?');
    const advisory = link('¿Necesitas el D.S. N°1? Te asesoramos');
    expect(advisory?.getAttribute('href')).toBe(ADVISORY_LINK.to);
    expect(advisory?.textContent).toContain(ADVISORY_LINK.hint); // el estudio se cotiza

    // Detalle plegable, en el HTML del servidor (buscadores y lectores de pantalla)
    const details = block.querySelector('details')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Qué exige la norma según el tipo de alumbrado');
    expect([...details.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual([
      'Calles, pasajes, plazas y alumbrado industrial',
      'Canchas y recintos deportivos',
      'Alumbrado ornamental y de fachadas',
      'Áreas de Protección Especial',
      'Proyectos adjudicados o iniciados antes',
      'Cómo se acredita',
    ]);
    // Art. 3 a): techado sin muros sigue siendo exterior; art. 3 z) y 11: lo existente cumple al recambio
    expect(details.textContent).toContain('Cuentan como alumbrado exterior aunque estén techados, si no tienen muros.');
    expect(details.textContent).toContain('cuentan como existentes: cumplen la norma cuando se recambian.');
    // Cada texto por separado: el certificado solo en las oraciones aprobadas; la luz azul nunca junto a canchas
    expect(introIssues([...block.querySelectorAll('h2, p, a, summary, dt, dd')].map(el => el.textContent ?? ''))).toEqual([]);

    const sources = [...block.querySelectorAll('a[target="_blank"]')];
    expect(sources.map(a => a.getAttribute('href'))).toEqual([
      'https://www.bcn.cl/leychile/navegar?i=1197027',
      'https://luminica.mma.gob.cl/plazos-norma-luminica/',
    ]);
    for (const a of sources) expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('las demás categorías no llevan introducción', async () => {
    const other = (await import('@/data/catalog/categories.config')).categories.find(c => !CATEGORY_INTROS[c.slug])!;
    const { root } = await page(categoryPath(other.slug));
    expect(root.querySelector('section[aria-labelledby="category-intro-title"]')).toBeNull();
  });
});
