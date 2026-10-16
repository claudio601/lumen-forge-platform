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
// Fuera de aquí: el contenido SEO por producto (src/data/catalog/content/*.json) todavía
// promete flota propia en 116 fichas. Se corrige en la PR 11b, con su regla en
// scripts/content/check.ts.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { serverTree } from '@/entry-server';
import { preloadRoute } from '@/routes';
import { STATIC_ROUTES, categoryPath, productPath } from '@/lib/seo/routes';
import { products } from '@/data/products';
import { editorialOverlay } from '@/data/catalog/overlay/editorial';
import { productDescriptions } from '@/data/catalog/descriptions.generated';
import { PROJECT_CATEGORIES } from '@/data/catalog/categories.config';
import type { Product } from '@/data/catalog/types';
import WhatsAppButton from '@/components/WhatsAppButton';
import { businessHours, clp, FREE_SHIPPING_AREA, FREE_SHIPPING_THRESHOLD_CLP, freeShippingShort, PICKUP_PLACE, waInstaladores } from './business';
import { claimIssues, freeShippingIssues, handWrittenFreeShippingAmount } from '@/test/freeShipping';

interface Retired {
  re: RegExp;
  why: string;
  /** Solo en el código: en el HTML chocaría con precios del catálogo ("$250.990", "$120.000"). */
  sourceOnly?: true;
}

/** Frases retiradas. Todas están en origin/main b110116 (antes de la PR 11). */
const RETIRED: Retired[] = [
  { re: /\+8 años/i, why: 'años en el mercado sin confirmar' },
  { re: /100\+/, why: 'cantidad de proyectos sin confirmar' },
  { re: /gratis|gratuit/i, why: 'envío o servicio gratis sin confirmar (DIALux: sin promesa de precio)' },
  // El monto existe (PR 12b), pero escrito a mano se desfasa de la constante: solo FREE_SHIPPING_THRESHOLD_CLP + clp()
  { re: /\$\s?250|250\.000/, why: 'monto del despacho sin costo escrito a mano (usar FREE_SHIPPING_THRESHOLD_CLP)', sourceOnly: true },
  { re: /santiago urbano|[aá]rea urbana/i, why: 'la zona del despacho sin costo es FREE_SHIPPING_AREA (Provincia de Santiago)' },
  { re: /no tenemos[^.]{0,60}retiro|retiro en oficina/i, why: 'sí hay retiro en bodega (PICKUP_PLACE)' },
  { re: /20\.000/, why: 'precio de la visita técnica sin confirmar', sourceOnly: true },
  { re: /descontable|no se descuenta/i, why: 'promesa sobre el precio de la visita o del estudio' },
  { re: /pr[oó]ximamente/i, why: 'anuncia funciones que no existen' },
  { re: /24-48|menos de 24 ?h(?:oras|rs?)?\b|(?:<|&lt;)\s?24 ?h|en 24 ?h(?:oras|rs?)?\b|24 ?h(?:oras|rs?)?\.? h[aá]biles/i, why: 'plazo de respuesta sin confirmar' },
  { re: /cotizaci[oó]n r[aá]pida/i, why: 'rapidez de respuesta sin confirmar' },
  { re: /9:00-18:00/, why: 'horario antiguo (usar businessHours)' },
  { re: /reposici[oó]n continua|prioridad en disponibilidad|reserva de productos/i, why: 'promesa implícita de stock' },
  { re: /precios especiales|tarifas especiales/i, why: 'precios especiales sin confirmar' },
  { re: /descuentos? por (?:proyecto|volumen)/i, why: 'descuentos por proyecto o volumen sin confirmar' },
  { re: /mi cuenta/i, why: 'no hay login (Fase 3)' },
  {
    re: /certificados SEC|SEC\s*Certificados|t[eé]cnicos? certificados?|electricistas certificados|instalador(?:es)? certificad[oa]s?|certificaci[oó]n de (?:la )?instalaci[oó]n/i,
    why: 'credenciales del equipo sin verificar (la declaración ante la SEC exige instalador autorizado)',
  },
  { re: /value: ['"]SEC['"]/, why: 'cifra "SEC / Certificados" del hero de /instalacion', sourceOnly: true },
  { re: /garantizad[oa]/i, why: '"garantizado" sin explicar la garantía (Ley 19.496, art. 33)' },
  { re: /productos certificados|certificaci[oó]n SEC, DS1, CE, IEC/i, why: 'una sola certificación para todo el catálogo' },
  // "12 meses" solo como garantía: la Política de privacidad dice que la decisión de cookies dura 12 meses (PR 13)
  {
    re: /garant[ií]a de f[aá]brica|garant[ií]a (?:base )?(?:de )?(?:1 año|12 meses)|12 meses(?: de)? garant[ií]a|'12 meses', label: 'Garant[ií]a'/i,
    why: 'una sola garantía para todo el catálogo',
  },
  { re: /camiones propios|flota propia|reparto propio|nuestros camiones|propios camiones|camiones de eLIGHTS/i, why: 'flota propia sin confirmar' },
  { re: /post-venta incluida|soporte t[eé]cnico incluido|certificados CE\/IEC|primer mes|letra chica|todo tipo de instalaciones/i, why: 'promesa general sin respaldo' },
  { re: /experiencia en (?:recintos|todo tipo)|nuestro ingeniero/i, why: 'experiencia o equipo sin respaldo' },
  { re: /aproximadamente 20|~20 p/i, why: 'extensión del informe DIALux sin confirmar' },
  { re: /cotizador inteligente/i, why: 'el formulario es simple' },
];

/** Código con textos para el visitante (sin tests) y las fichas editoriales BESTLED. */
const SOURCES = import.meta.glob<string>(
  [
    '/src/components/**/*.{ts,tsx}',
    '/src/pages/**/*.{ts,tsx}',
    '/src/config/**/*.{ts,tsx}',
    '/src/data/catalog/overlay/editorial.ts',
    '!**/*.test.*',
  ],
  { query: '?raw', import: 'default', eager: true },
);

function retiredIn(text: string, onlyRendered = false): string[] {
  return RETIRED.filter(r => !(onlyRendered && r.sourceOnly)).flatMap(({ re, why }) => {
    const m = text.match(re);
    return m ? [`"${m[0]}" (${why})`] : [];
  });
}

describe('textos sin respaldo: el código', () => {
  it('revisa los componentes, las páginas, la configuración y las fichas BESTLED', () => {
    const files = Object.keys(SOURCES);
    for (const f of ['/src/components/home/TrustBar.tsx', '/src/components/layout/Footer.tsx', '/src/pages/InstallerAreaPage.tsx', '/src/config/business.ts', '/src/data/catalog/overlay/editorial.ts']) {
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
    expect(screen.getByText(businessHours)).toBeInTheDocument();
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
  // Páginas fijas y una ficha BESTLED: todo su texto sale del código y de editorial.ts.
  // Las demás fichas también muestran el contenido SEO por producto (PR 11b) y la garantía
  // propia de cada producto, así que ahí solo se revisa lo que pone el sitio.
  for (const path of [...STATIC_ROUTES, productPath(bestled.id)]) {
    it(`${path}: sin frases retiradas (texto y atributos)`, async () => {
      const { html } = await page(path);
      expect(retiredIn(html, true)).toEqual([]);
      expect(html).toContain(businessHours); // pie de página
    });
  }

  it('inicio: despacho, garantía según ficha y asesoría; sin envío gratis', async () => {
    const { root } = await page('/');
    const text = root.textContent ?? '';
    expect(text).toContain('Despacho en hasta 2 días hábiles');
    expect(text).toContain('Garantía según ficha (mín. 6 meses)');
    expect(text).toContain('Asesoría técnica por WhatsApp');
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
  for (const path of [...STATIC_ROUTES, productPath(bestled.id), productPath(withoutDatasheet.id), categoryPath(bestled.categories[0])]) {
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
    expect(text).toContain('¿Prefieres escribir directo?');
  });

  it('/estudio-luminico: tipos de proyecto sin afirmar experiencia; FAQ con tildes', async () => {
    const { root } = await page('/estudio-luminico');
    const text = root.textContent ?? '';
    expect(text).toContain('Estos son los tipos de proyecto que estudiamos.');
    expect(text).not.toMatch(/experiencia en/i);
    expect(text).toContain('¿Sirve para licitaciones?');
    expect(text).toContain('indícala en el formulario');
    expect(text).toContain('¿Prefieres consultar directamente?');
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
