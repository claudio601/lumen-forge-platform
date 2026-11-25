// api/_lib/shipping/template.ts
// Correo del aviso de despacho (spec Nivel 2, §5): asunto, HTML, texto alternativo y texto previo.
// Función PURA: recibe los datos ya leídos y validados (fields.ts, products.ts) y no llama a nada.
//
// - Diseño del ejemplo aprobado (aviso-despacho-ejemplo.html) para Gmail, Gmail Android, Outlook
//   y Apple Mail: una columna de 600 px, tablas role="presentation" y estilos en línea, sin
//   variables CSS, flex, grid ni <style>; sin imágenes remotas.
// - Textos del Nivel 1 donde chocan con la spec (los avisos enviados del 11 al 18-11-2026):
//   «Te adjuntamos <documento> en PDF y <el documento del operador>», el aviso sin lista de
//   productos («El detalle de los productos va en la factura N° X adjunta») y «El flete ya está
//   pagado: no pagas nada al recibirlo». Sin el PDF (opcional desde el 19-11-2026: la factura se
//   envía antes del despacho), «Te adjuntamos <el documento del operador>» y «… va en la factura N° X».
// - Factura o guía de despacho: todo sale de documents.ts (DOCUMENT_TYPES).
// - Fechas siempre «el <día dd de mes>», nunca «hoy» (el aviso puede salir otro día).
// - Opcionales (dueño, 24-11-2026): sin orden de flete, el asunto, el texto previo y el resto del
//   correo no la nombran (sin seguimiento ni botón; «el comprobante de <operador>»); sin entrega, sin
//   esa línea y con el cierre neutro «Al recibirlo»; con entrega y sin agencia o comuna, la entrega
//   sin lugar; sin flete, sin esa línea ni el recuadro; sin kilos, «5 bultos». Una lista de
//   viñetas sin líneas no se escribe.
// - Enlaces: solo el seguimiento de carriers.ts (https fijo, la orden normalizada con
//   encodeURIComponent) y SITE_URL + /producto/<id>. La plantilla nunca recibe una URL, y
//   assertSafeLinks revisa al final cada href.
// - Todo valor que viene de Pipedrive pasa por escapeHtml.
// El teléfono y el RUT son los de src/config (whatsappDisplayNumber, LEGAL_RUT): api/ no importa
// src/, y template.test.ts exige que sean iguales.

import { escapeHtml } from '../html/escape.js';
import { SITE_URL } from '../site.js';
import { CARRIERS, numberCellLabel, numberPhrase, resolveCarrier, trackingLink, type Carrier, type CarrierRef } from './carriers.js';
import { documentPhrase, documentTitle, type ShippingDocument } from './documents.js';
import { normalizeOrder, referenceLabel, SHIPPING_FIELD_NAMES, SHIPPING_OPTIONS, type DeliveryKind, type Freight } from './fields.js';
import { formatClp, formatDateLong, formatKg, formatPackages } from './format.js';
import type { NoticeProductLine } from './products.js';

export const COMPANY_PHONE = '+56 9 9127 3128';
export const COMPANY_RUT = '76.947.784-5';
export const SIGNATURE = ['Quedo atento.', '', 'Saludos cordiales,', 'Claudio Quero', 'eLIGHTS.cl SpA', 'claudio@elights.cl'] as const;
export const PREVIEW_SUBJECT_PREFIX = '[Vista previa] ';

export interface ShippingNoticeData {
  /** Vista previa (al dueño): prefijo en el asunto y franja de aviso. */
  preview: boolean;
  /** Nombre de pila de la persona (readPersonContact) o null: «Hola, tu pedido…». */
  greetingName: string | null;
  /** Referencia del negocio tal cual (RC-…, NE-…); solo sale si calza con el formato del servidor. */
  reference: string | null;
  /** El operador por id o, sin fila, por etiqueta: nunca un enlace. */
  carrier: CarrierRef;
  /** La orden como la escribió el dueño (el enlace usa la normalizada), o null: sin seguimiento. */
  order: string | null;
  /** null: sin la línea «Entrega» y con el cierre neutro («Al recibirlo»). */
  delivery: DeliveryKind | null;
  /** Agencia (retiro) o comuna (domicilio), o null: la entrega sin lugar. */
  place: string | null;
  /** null: sin la línea «Flete» ni su recuadro. */
  freight: Freight | null;
  packages: number;
  /** null: «5 bultos», sin los kilos. */
  kilos: number | null;
  /** 'aaaa-mm-dd'. */
  shipDate: string;
  /** 'aaaa-mm-dd' o null: sin la línea. */
  eta: string | null;
  document: ShippingDocument;
  /** [] = sin lista: el detalle va en el documento (adjunto o enviado antes). */
  products: readonly NoticeProductLine[];
  /**
   * Va adjunto el PDF del documento. Opcional desde el 19-11-2026: la factura se le envía al
   * cliente antes del despacho. La foto del comprobante del operador va siempre.
   */
  hasDocument: boolean;
}

export interface ShippingNotice {
  subject: string;
  html: string;
  text: string;
  preheader: string;
}

// ── Colores del ejemplo aprobado ────────────────────────────────────────────

const INK = '#2B303B';
const MUTED = '#6A7181';
const BRAND = '#781DD3';
const BRAND_SOFT = '#F0EBF4';
const LINE = '#E5E7EB';
const BG = '#F6F5F8';
const WARN = '#8A5A00';
const WARN_SOFT = '#FFF6E0';
const FONT = 'Segoe UI,Roboto,Helvetica,Arial,sans-serif';

// ── Utilidades ──────────────────────────────────────────────────────────────

/** Sin saltos de línea ni espacios de más (un campo de Pipedrive no puede armar líneas nuevas). */
// eslint-disable-next-line no-control-regex -- quitar los caracteres de control es justamente el propósito
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
const e = (value: string | number) => escapeHtml(typeof value === 'string' ? clean(value) : value);

/** Id del sitio que se puede poner en una ruta: el de product-links (solo [a-z0-9-]). */
const SITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function productUrl(siteId: string | null): string | null {
  return siteId && siteId.length <= 120 && SITE_ID.test(siteId) ? `${SITE_URL}/producto/${siteId}` : null;
}

/** Orígenes permitidos en un href: el sitio y las páginas de seguimiento de carriers.ts. */
const ALLOWED_ORIGINS = new Set([new URL(SITE_URL).origin, ...CARRIERS.flatMap((c) => (c.trackingUrl ? [new URL(c.trackingUrl.replace('{n}', '0')).origin] : []))]);

/** Lanza si un href no es https a uno de los orígenes permitidos (último resguardo). */
export function assertSafeLinks(html: string): void {
  for (const m of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    const href = m[2].replace(/&amp;/g, '&');
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      throw new Error('aviso de despacho: enlace inválido');
    }
    if (url.protocol !== 'https:' || !ALLOWED_ORIGINS.has(url.origin)) throw new Error('aviso de despacho: enlace no permitido');
  }
  // Un «<» sin escapar solo lo escribe la plantilla: ninguna de estas etiquetas.
  if (/<(?:script|style|form|img|iframe|object|embed|link|base)\b/i.test(html)) {
    throw new Error('aviso de despacho: contenido no permitido');
  }
}

// ── Textos (los mismos en el HTML y en el texto) ────────────────────────────

interface Copy {
  carrier: Carrier;
  /** La orden limpia, o null (sin orden: nada la nombra). */
  order: string | null;
  delivery: DeliveryKind | null;
  /** La agencia o comuna limpia, o null. */
  place: string | null;
  freight: Freight | null;
  link: string | null;
  subject: string;
  preheader: string;
  greeting: string;
  shipDate: string;
  eta: string | null;
  docTitle: string;
  docPhrase: string;
  reference: string | null;
  /** «la orden de flete 282.022.397», «el N° de guía 123»; null sin orden. */
  numberWithArticle: string | null;
  /** «Retirarlo» o «recibirlo» (también sin entrega: el cierre neutro). */
  verb: 'retirarlo' | 'recibirlo';
  lead: string;
  /** null sin orden: no hay con qué seguirlo. */
  trackingLine: string | null;
  cells: { label: string; value: string }[];
  steps: readonly [string, string, string, string];
  /** null sin flete. */
  freightHtml: string | null;
  freightText: string | null;
  cargo: string;
  noProducts: string;
  handlingTitle: string;
  handling: string[];
  documents: string;
}

/** Texto limpio de un campo opcional, o null si va vacío. */
const optional = (value: string | null | undefined) => (typeof value === 'string' && clean(value) ? clean(value) : null);

function buildCopy(data: ShippingNoticeData): Copy {
  const carrier = resolveCarrier(data.carrier);
  const order = optional(data.order);
  const orderNormalized = order ? normalizeOrder(order) : '';
  if (order && !orderNormalized) throw new Error('aviso de despacho: orden sin letras ni dígitos');
  const delivery: DeliveryKind | null = data.delivery === 'pickup' || data.delivery === 'home' ? data.delivery : null;
  const place = optional(data.place);
  const freight: Freight | null = data.freight && (data.freight.kind === 'due' || data.freight.kind === 'paid') ? data.freight : null;
  const kilos = typeof data.kilos === 'number' ? data.kilos : null;
  if (!Number.isInteger(data.packages) || data.packages < 1) throw new Error('aviso de despacho: bultos inválidos');
  if (kilos !== null && (!Number.isFinite(kilos) || kilos <= 0)) throw new Error('aviso de despacho: kilos inválidos');

  // Sin orden no hay seguimiento: el botón a una página sin el número tampoco serviría.
  const link = order ? trackingLink(carrier, orderNormalized) : null;
  const op = carrier.label;
  const pickup = delivery === 'pickup';
  const verb = pickup ? 'retirarlo' : 'recibirlo';
  const shipDate = formatDateLong(data.shipDate);
  const eta = data.eta ? formatDateLong(data.eta) : null;
  const docTitle = documentTitle(data.document);
  const docPhrase = documentPhrase(data.document);
  const name = data.greetingName ? clean(data.greetingName) : '';
  const numberWithArticle = order ? `${carrier.numberArticle} ${carrier.numberLabel} ${order}` : null;
  const pronoun = carrier.numberArticle === 'el' ? 'él' : 'ella';

  const subject = clean(`${data.preview ? PREVIEW_SUBJECT_PREFIX : ''}Tu pedido va en camino — ${docTitle}, ${op}${order ? ` ${carrier.numberLabel} ${order}` : ''}`);
  const preheader = clean(`${op}${order ? `, ${numberPhrase(carrier, order)}` : ''} · ${eta ? `Entrega estimada: ${eta}` : `Despachado el ${shipDate}`}`);

  const where =
    delivery === 'pickup' ? `, para retiro en su agencia${place ? ` de ${place}` : ''}` : delivery === 'home' ? `, con entrega en tu dirección${place ? ` de ${place}` : ''}` : '';
  const what = link ? 'el seguimiento' : 'los datos del envío';
  const lead = `Lo entregamos a ${op} el ${shipDate}${where}. Aquí tienes ${what} y lo que necesitas para ${verb}.`;

  let trackingLine: string | null = null;
  if (numberWithArticle) {
    if (!link) trackingLine = `Guarda ${numberWithArticle}: con ${pronoun} consultas tu envío en ${op}.`;
    else if (carrier.numberInUrl) trackingLine = `Ingresa ${numberWithArticle}.`;
    else trackingLine = `Ingresa ${numberWithArticle} en su página.`;
    if (link && carrier.trackingExtra) trackingLine += ` También puedes seguirlo ${carrier.trackingExtra}.`;
  }

  const cargo = kilos !== null ? `${formatPackages(data.packages)}, ${formatKg(kilos)}` : formatPackages(data.packages);
  const deliveryCell = delivery === 'pickup' ? `Retiro en agencia ${op}${place ? `, ${place}` : ''}` : delivery === 'home' ? `A domicilio${place ? `, ${place}` : ''}` : null;
  const cells = [
    { label: 'Operador', value: op },
    ...(order ? [{ label: numberCellLabel(carrier), value: order }] : []),
    ...(eta ? [{ label: 'Entrega estimada', value: eta }] : []),
    ...(deliveryCell ? [{ label: 'Entrega', value: deliveryCell }] : []),
  ];
  if (cells.length % 2 === 1) cells.push({ label: 'Carga', value: cargo });

  // Sin entrega, el tercer paso no dice agencia ni reparto.
  const steps = ['Pedido confirmado', 'Despachado', pickup ? 'En agencia' : delivery === 'home' ? 'En reparto' : 'En camino', pickup ? 'Retirado' : 'Entregado'] as const;

  // «Por pagar» sin monto (el comprobante no lo trae, p. ej. PDQ): la misma frase, sin cifra.
  const freightHtml = !freight
    ? null
    : freight.kind === 'due'
      ? freight.amountClp !== null
        ? `Por pagar: <b>${e(formatClp(freight.amountClp))}</b>. Lo pagas a ${e(op)} al ${verb}.`
        : `Por pagar: lo pagas a ${e(op)} al ${verb}.`
      : `El flete ya está pagado: no pagas nada al ${verb}.`;
  const freightText = !freight
    ? null
    : freight.kind === 'due'
      ? freight.amountClp !== null
        ? `por pagar, ${formatClp(freight.amountClp)}. Lo pagas a ${op} al ${verb}.`
        : `por pagar. Lo pagas a ${op} al ${verb}.`
      : `pagado por eLIGHTS.cl. No pagas nada al ${verb}.`;

  const boxes = data.packages === 1 ? 'la caja esté' : 'las cajas estén';
  const damage = `Revisa que ${boxes} en buen estado antes de firmar. Si ves algún daño, déjalo anotado con ${op} y escríbenos el mismo día con fotos.`;
  const handling = pickup
    ? [numberWithArticle ? `Lleva tu cédula de identidad y ${numberWithArticle}.` : 'Lleva tu cédula de identidad.', ...(carrier.pickupRule ? [carrier.pickupRule] : []), damage]
    : [damage];

  // Sin orden, el documento del operador no se nombra «la orden de flete de …»: es su comprobante.
  const voucher = order ? `${carrier.document.article} ${carrier.document.noun} de ${op}` : `el comprobante de ${op}`;

  return {
    carrier,
    order,
    delivery,
    place,
    freight,
    link,
    subject,
    preheader,
    greeting: name ? `Hola ${name}` : 'Hola',
    shipDate,
    eta,
    docTitle,
    docPhrase,
    reference: referenceLabel(data.reference),
    numberWithArticle,
    verb,
    lead,
    trackingLine,
    cells,
    steps,
    freightHtml,
    freightText,
    cargo,
    noProducts: `El detalle de los productos va en ${docPhrase}${data.hasDocument ? ' adjunta' : ''}.`,
    handlingTitle: pickup ? 'Al retirarlo' : 'Al recibirlo',
    handling,
    documents: data.hasDocument ? `Te adjuntamos ${docPhrase} en PDF y ${voucher}.` : `Te adjuntamos ${voucher}.`,
  };
}

const previewNotice = `Vista previa: este correo no le llegó al cliente. Para enviárselo, elige «${SHIPPING_OPTIONS.trigger.send}» en «${SHIPPING_FIELD_NAMES.trigger}» del negocio.`;

// ── Texto alternativo (§5.1) ────────────────────────────────────────────────

function renderText(data: ShippingNoticeData, c: Copy): string {
  const op = c.carrier.label;
  const { order, place } = c;
  const lines: string[] = [];
  if (data.preview) lines.push(`[${previewNotice}]`, '');
  lines.push(`${c.greeting},`, '', `Tu pedido ya va en camino: lo entregamos a ${op} el ${c.shipDate}.`, '');

  // Viñetas: solo las que tienen dato; sin ninguna, no queda una lista vacía.
  const bullets: string[] = [];
  if (order) {
    if (!c.link) bullets.push(`- Seguimiento: ${numberPhrase(c.carrier, order)}. Con ${c.carrier.numberArticle === 'el' ? 'él' : 'ella'} consultas tu envío en ${op}.`);
    else if (c.carrier.numberInUrl) bullets.push(`- Seguimiento: ${numberPhrase(c.carrier, order)}, en ${c.link}${c.carrier.trackingExtra ? `, ${c.carrier.trackingExtra}` : ''}.`);
    else bullets.push(`- Seguimiento: ingresa ${c.numberWithArticle} en ${c.link}${c.carrier.trackingExtra ? `, o síguelo ${c.carrier.trackingExtra}` : ''}.`);
  }
  if (c.eta) bullets.push(`- Entrega estimada: ${c.eta}, según ${op}.`);
  if (c.delivery === 'pickup') bullets.push(`- Entrega: retiro en la agencia ${op}${place ? ` de ${place}` : ''}.`);
  if (c.delivery === 'home') bullets.push(`- Entrega: a domicilio${place ? ` en ${place}` : ''}.`);
  if (c.freightText) bullets.push(`- Flete: ${c.freightText}`);
  if (bullets.length) lines.push(...bullets, '');

  if (data.products.length) {
    lines.push(`Qué va en tu envío (${c.cargo}):`);
    for (const p of data.products) {
      lines.push(`- ${p.quantity} ${clean(p.name)}`);
      const url = productUrl(p.siteId);
      if (url) lines.push(`  Ficha técnica: ${url}`);
    }
  } else {
    lines.push(`Qué va en tu envío (${c.cargo}): ${c.noProducts.charAt(0).toLowerCase()}${c.noProducts.slice(1)}`);
  }
  lines.push('', c.documents, '');

  lines.push(`${c.handlingTitle}: ${c.handling.map((h, i) => (i === 0 ? h.charAt(0).toLowerCase() + h.slice(1) : h)).join(' ')}`, '');
  lines.push(...SIGNATURE, '', `¿Dudas con tu pedido? Responde este correo o llámanos al ${COMPANY_PHONE}.`, `eLIGHTS.cl SpA · RUT ${COMPANY_RUT} · claudio@elights.cl · elights.cl`);
  return `${lines.join('\n')}\n`;
}

// ── HTML (§5.2) ─────────────────────────────────────────────────────────────

const section = (title: string, body: string) =>
  `<tr><td style="padding:16px 24px;border-top:1px solid ${LINE}">` +
  `<h2 style="margin:0 0 10px;font-size:15px;line-height:1.3;color:${INK}">${title}</h2>${body}</td></tr>`;

const para = (html: string, extra = '') => `<p style="margin:0;font-size:15px;line-height:1.55;color:${INK}${extra}">${html}</p>`;

/** Celdas de 2 columnas que pasan a 1 en el celular, sin media queries (Outlook: tabla fantasma). */
function trackingCells(cells: Copy['cells']): string {
  const cell = ({ label, value }: { label: string; value: string }) =>
    `<div style="display:inline-block;width:100%;max-width:240px;vertical-align:top;padding:0 0 12px">` +
    `<div style="font-size:11px;line-height:1.4;text-transform:uppercase;letter-spacing:.06em;color:${MUTED};font-family:${FONT}">${e(label)}</div>` +
    `<div style="font-size:15px;line-height:1.4;font-weight:600;color:${INK};font-family:${FONT}">${e(value)}</div></div>`;
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const pair = cells.slice(i, i + 2);
    rows.push(
      `<div style="font-size:0;line-height:0">` +
        `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" valign="top"><![endif]-->` +
        pair.map(cell).join(`<!--[if mso]></td><td width="50%" valign="top"><![endif]-->`) +
        `<!--[if mso]></td></tr></table><![endif]-->` +
        `</div>`,
    );
  }
  return rows.join('');
}

function trackingButton(link: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0"><tr>` +
    `<td bgcolor="${BRAND}" style="border-radius:6px">` +
    `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="display:inline-block;padding:11px 18px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px">Seguir mi envío en ${e(label)}</a>` +
    `</td></tr></table>`
  );
}

function stepsRow(steps: Copy['steps']): string {
  const cell = (label: string, done: boolean) =>
    `<td width="25%" valign="top" align="center" style="padding:8px 3px 0;border-top:4px solid ${done ? BRAND : LINE};font-size:11px;line-height:1.35;color:${done ? INK : MUTED};font-weight:${done ? 600 : 400}">${e(label)}</td>`;
  return (
    `<tr><td style="padding:4px 24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" aria-label="Estado del pedido" style="font-family:${FONT}"><tr>` +
    steps.map((s, i) => cell(s, i < 2)).join('<td width="4" style="font-size:0;line-height:0">&nbsp;</td>') +
    `</tr></table></td></tr>`
  );
}

function productsBlock(data: ShippingNoticeData, c: Copy): string {
  if (!data.products.length) return para(e(c.noProducts));
  const rows = data.products
    .map((p) => {
      const url = productUrl(p.siteId);
      const sheet = url ? `<br><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="font-size:13px;color:${BRAND}">Ficha técnica</a>` : '';
      return (
        `<tr><td width="48" valign="top" style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:15px;color:${MUTED}">${e(p.quantity)}</td>` +
        `<td valign="top" style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:15px;line-height:1.45;color:${INK}">${e(p.name)}${sheet}</td></tr>`
      );
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT}">${rows}</table>`;
}

function renderHtml(data: ShippingNoticeData, c: Copy): string {
  const op = c.carrier.label;
  const ref = [c.docTitle, ...(c.reference ? [c.reference] : []), `Despachado el ${c.shipDate}`].map(e).join('<br>');
  const freightBox = !c.freight
    ? ''
    : c.freight.kind === 'due'
      ? `<div style="background:${WARN_SOFT};color:${WARN};border-radius:6px;padding:10px 12px;font-size:14px;line-height:1.5">${c.freightHtml}</div>`
      : `<div style="background:${BRAND_SOFT};color:${INK};border-radius:6px;padding:10px 12px;font-size:14px;line-height:1.5">${c.freightHtml}</div>`;
  const handling = `<ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.55;color:${INK}">${c.handling.map((h) => `<li style="margin:4px 0">${e(h)}</li>`).join('')}</ul>`;
  const signature = SIGNATURE.filter((l) => l).map(e);
  const hiddenPreheader =
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BG};opacity:0">` +
    `${e(c.preheader)}${'&#8204;&nbsp;'.repeat(40)}</div>`;

  const body = [
    data.preview
      ? `<tr><td style="padding:12px 24px;background:${WARN_SOFT};color:${WARN};font-size:13px;line-height:1.5;border-bottom:1px solid ${LINE}">${e(previewNotice)}</td></tr>`
      : '',
    // 1. Encabezado
    `<tr><td style="padding:20px 24px;border-bottom:1px solid ${LINE}">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
      `<td valign="middle" style="font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:.2px;color:${BRAND}">eLIGHTS.cl</td>` +
      `<td valign="middle" align="right" style="font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};text-align:right">${ref}</td>` +
      `</tr></table></td></tr>`,
    // 2. Saludo
    `<tr><td style="padding:24px 24px 8px">` +
      `<h1 style="margin:0 0 6px;font-size:22px;line-height:1.25;color:${INK}">${e(c.greeting)}, tu pedido va en camino</h1>` +
      `<p style="margin:0;font-size:15px;line-height:1.55;color:${MUTED}">${e(c.lead)}</p></td></tr>`,
    // 3. Seguimiento
    `<tr><td style="padding:12px 24px 16px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BRAND_SOFT}" style="background:${BRAND_SOFT};border-radius:8px"><tr>` +
      `<td style="padding:18px 18px 16px;font-family:${FONT}">` +
      trackingCells(c.cells) +
      (c.link ? trackingButton(c.link, op) : '') +
      (c.trackingLine ? `<p style="margin:${c.link ? '10px' : '0'} 0 0;font-size:12px;line-height:1.5;color:${MUTED}">${e(c.trackingLine)}</p>` : '') +
      `</td></tr></table></td></tr>`,
    // 4. Estado
    stepsRow(c.steps),
    // 5. Flete (sin flete, sin la sección)
    c.freight ? section('Flete', freightBox) : '',
    // 6. Qué va en tu envío
    section(`Qué va en tu envío · ${e(c.cargo)}`, productsBlock(data, c)),
    // 7. Al retirarlo / Al recibirlo
    section(e(c.handlingTitle), handling),
    // 8. Documentos
    section('Documentos', para(e(c.documents))),
    // 9. Firma
    `<tr><td style="padding:16px 24px 20px;border-top:1px solid ${LINE};font-size:15px;line-height:1.55;color:${INK}">` +
      `${signature[0]}<br><br>${signature[1]}<br>${signature.slice(2).join('<br>')}</td></tr>`,
    // 10. Pie
    `<tr><td style="padding:18px 24px;background:${BG};font-size:12px;line-height:1.6;color:${MUTED};border-radius:0 0 10px 10px">` +
      `¿Dudas con tu pedido? Responde este correo o llámanos al ${e(COMPANY_PHONE)}.<br>` +
      `<b style="color:${INK}">eLIGHTS.cl SpA</b> · RUT ${e(COMPANY_RUT)} · claudio@elights.cl · elights.cl</td></tr>`,
  ].join('\n');

  return (
    `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta name="color-scheme" content="light">\n<meta name="supported-color-schemes" content="light">\n` +
    `<title>${e(`Aviso de despacho · ${c.docTitle}`)}</title>\n</head>\n` +
    `<body style="margin:0;padding:0;background:${BG}">\n${hiddenPreheader}\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background:${BG}">\n` +
    `<tr><td align="center" style="padding:24px 12px">\n` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:10px;font-family:${FONT};color:${INK}">\n` +
    `${body}\n</table>\n</td></tr>\n</table>\n</body>\n</html>\n`
  );
}

// ── Entrada ─────────────────────────────────────────────────────────────────

/** Asunto, HTML, texto alternativo y texto previo del aviso. Lanza si un dato no sirve. */
export function buildShippingNotice(data: ShippingNoticeData): ShippingNotice {
  const copy = buildCopy(data);
  const html = renderHtml(data, copy);
  assertSafeLinks(html);
  return { subject: copy.subject, html, text: renderText(data, copy), preheader: copy.preheader };
}
