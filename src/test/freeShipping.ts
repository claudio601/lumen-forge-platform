// Despacho sin costo (PR 12b): lo que las pruebas aceptan como oferta de despacho sin costo.
// Lo usan src/config/contentTruth.test.ts (todas las páginas fijas, una ficha BESTLED, una
// ficha de Jumpseller y una categoría) y src/pages/legal.test.tsx (descripciones y comunas).
// Regla: toda oferta trae el monto de FREE_SHIPPING_THRESHOLD_CLP con "sobre" o "mayor a"
// (el dueño dijo "mayor a": con el monto exacto no aplica) y la zona FREE_SHIPPING_AREA.name;
// no nombra otra zona (comunas de otras provincias, la Región Metropolitana, regiones ni todo
// Chile). Solo se aceptan sin monto ni zona las menciones genéricas de GENERIC_FREE_SHIPPING,
// que remiten a la cotización o a /despacho.

import { clp, FREE_SHIPPING_AREA, FREE_SHIPPING_THRESHOLD_CLP } from '@/config/business';

/** Las 52 comunas de la Región Metropolitana, por provincia. */
export const RM_PROVINCES = {
  Santiago: [
    'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central', 'Huechuraba', 'Independencia', 'La Cisterna',
    'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Las Condes', 'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul',
    'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda', 'Peñalolén', 'Providencia', 'Pudahuel', 'Quilicura', 'Quinta Normal',
    'Recoleta', 'Renca', 'San Joaquín', 'San Miguel', 'San Ramón', 'Santiago', 'Vitacura',
  ],
  Cordillera: ['Puente Alto', 'Pirque', 'San José de Maipo'],
  Chacabuco: ['Colina', 'Lampa', 'Tiltil'],
  Maipo: ['San Bernardo', 'Buin', 'Calera de Tango', 'Paine'],
  Talagante: ['Talagante', 'El Monte', 'Isla de Maipo', 'Padre Hurtado', 'Peñaflor'],
  Melipilla: ['Melipilla', 'Alhué', 'Curacaví', 'María Pinto', 'San Pedro'],
} as const;

/** Las 20 comunas de la RM que no son de la Provincia de Santiago: ninguna entra en el despacho sin costo. */
export const RM_OUTSIDE_SANTIAGO: string[] = Object.entries(RM_PROVINCES)
  .filter(([province]) => province !== 'Santiago')
  .flatMap(([, comunas]) => [...comunas]);

/** `name` como palabra completa (sin letras pegadas a los lados). */
export const namedIn = (text: string, name: string) =>
  new RegExp(`(?<!\\p{L})${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'u').test(text);

/** Lo que se lee como "sin costo": también "sin cargo", "liberado" y "gratis". */
export const FREE_RE = /sin (?:costo|cargo)|liberad[oa]s?|gratis|gratuit/i;
const SHIPPING_RE = /despach|env[ií]o|flete/i;
/** Un monto en pesos ("$250.000"). Sin /g: se usa con test() y con matchAll(new RegExp(..., 'g')). */
const AMOUNT_RE = /\$\s?\d[\d.]*\d/;
/** Otra zona, que contradice la de FREE_SHIPPING_AREA. */
const OTHER_AREA_RE = /regi[oó]n metropolitana|\bRM\b|todo Chile|regiones/i;
/** Condiciones que incluyen el monto exacto (el dueño dijo "mayor a"). */
const NOT_STRICT_RE = /\bo m[aá]s\b|a partir de|igual o (?:mayor|superior)|en adelante|como m[ií]nimo/i;

/** Menciones permitidas sin monto ni zona (texto exacto): remiten a la cotización o a /despacho. */
export const GENERIC_FREE_SHIPPING = ['va sin costo o por pagar', 'El despacho sin costo es una condición permanente de venta'];

/** Los problemas de una oferta de despacho sin costo (un texto ya normalizado), o [] si cumple. */
export function claimIssues(s: string): string[] {
  const issues: string[] = [];
  const threshold = clp(FREE_SHIPPING_THRESHOLD_CLP);
  const specific = FREE_RE.test(GENERIC_FREE_SHIPPING.reduce((rest, g) => rest.split(g).join(' '), s));
  const amounts = [...s.matchAll(new RegExp(AMOUNT_RE.source, 'g'))];
  if (specific && !s.includes(FREE_SHIPPING_AREA.name)) issues.push(`sin la zona "${FREE_SHIPPING_AREA.name}"`);
  if (specific && amounts.length === 0) issues.push(`sin el monto ${threshold}`);
  for (const m of amounts) {
    if (m[0] !== threshold) issues.push(`monto ${m[0]} (la constante es ${threshold})`);
    const before = s.slice(0, m.index);
    if (!/(?:sobre|mayor a)\s*$/i.test(before) || /igual o (?:mayor|superior) a\s*$/i.test(before)) {
      issues.push(`el monto ${m[0]} no va después de "sobre" o "mayor a"`);
    }
  }
  if (NOT_STRICT_RE.test(s)) issues.push(`condición que incluye el monto exacto ("${s.match(NOT_STRICT_RE)![0]}")`);
  if (/santiago/i.test(s.split(FREE_SHIPPING_AREA.name).join(' '))) issues.push(`"Santiago" sin ser "${FREE_SHIPPING_AREA.name}"`);
  if (OTHER_AREA_RE.test(s)) issues.push(`otra zona ("${s.match(OTHER_AREA_RE)![0]}")`);
  for (const c of RM_OUTSIDE_SANTIAGO) if (namedIn(s, c)) issues.push(`nombra ${c}, que no entra`);
  if (/gratis|gratuit/i.test(s)) issues.push('"gratis"');
  return issues;
}

const BLOCK = 'p, li, a, td, th, h1, h2, h3, h4, h5, h6, dd, dt, label, button';
const HEADING = /^H([1-6])$/;

/**
 * Texto de un título con lo que lo acompaña: los elementos que le siguen hasta el próximo
 * título del mismo nivel o superior. Si el título va solo en su contenedor (por ejemplo, junto
 * a un ícono), se sube hasta que algo le siga. Así una tarjeta "<h3>Despacho sin costo</h3>
 * <p>sobre $X en Y</p>" se revisa entera.
 */
function headingText(h: Element): string {
  const level = Number(h.tagName[1]);
  const stop = Array.from({ length: level }, (_, i) => `h${i + 1}`).join(', ');
  let anchor = h;
  while (!anchor.nextElementSibling && anchor.parentElement && !anchor.parentElement.matches('main, article, section, body')) {
    anchor = anchor.parentElement;
  }
  const parts = [anchor.textContent ?? ''];
  for (let el = anchor.nextElementSibling; el && !el.matches(stop) && !el.querySelector(stop); el = el.nextElementSibling) {
    parts.push(el.textContent ?? '');
  }
  return parts.join(' ');
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Cada oferta de despacho sin costo de un DOM, con sus problemas. Una oferta es el bloque
 * (párrafo, ítem, enlace, celda, botón; un título con lo que lo acompaña) de cada texto que
 * dice "sin costo" o parecido, si habla de despacho, trae un monto o nombra un lugar.
 */
export function freeShippingIssues(root: Element): { claims: string[]; issues: string[] } {
  const blocks = new Map<Element, string>();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!FREE_RE.test(n.nodeValue ?? '')) continue;
    const el = n.parentElement!;
    const block = el.closest(BLOCK) ?? el;
    if (!blocks.has(block)) blocks.set(block, normalize(HEADING.test(block.tagName) ? headingText(block) : block.textContent ?? ''));
  }
  const claims = [...blocks.values()].filter(
    s => SHIPPING_RE.test(s) || AMOUNT_RE.test(s) || /santiago|regi[oó]n|chile/i.test(s) || RM_OUTSIDE_SANTIAGO.some(c => namedIn(s, c)),
  );
  return { claims, issues: claims.flatMap(s => claimIssues(s).map(issue => `${issue}: "${s}"`)) };
}

/**
 * Una línea de código que ofrece despacho sin costo con un monto escrito a mano (en vez de
 * clp(FREE_SHIPPING_THRESHOLD_CLP)). Solo se permite en src/config/business.ts.
 */
export const handWrittenFreeShippingAmount = (line: string) =>
  FREE_RE.test(line) && SHIPPING_RE.test(line) && /\$\s?\d|\b\d{1,3}(?:[._]\d{3})+\b|\b\d{5,}\b/.test(line);
