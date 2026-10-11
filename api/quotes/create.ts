// api/quotes/create.ts
// POST /api/quotes/create
// Main endpoint: validate -> map -> dedupe -> create CRM entities.
//
// Auth model (alineado con installation-leads y estudio-luminico):
//   1. Rate limit in-memory por IP (shared bucket en _lib/auth.ts)
//   2. Origin / Referer allow-list
//   3. Header x-api-key / Authorization: Bearer con QUOTES_API_KEY
//      se acepta para llamadas server-to-server (cron, integraciones futuras).
//      El frontend NO manda header — se valida por Origin.
//   4. Honeypot anti-bot (campo `website`)
//   5. Sin API key solo se aceptan cotizaciones del sitio (sourceSystem nuevo_elights): el
//      Origin se puede falsificar, y otra fuente (jumpseller, whatsapp, manual) saltaría los
//      precios del catálogo y podría ocupar el id de un pedido real de Jumpseller.
//
// Cotizaciones del sitio (sourceSystem nuevo_elights, página /cotizacion):
//   6. Persona o empresa (customerType). Empresa exige razón social, RUT, giro y dirección,
//      de una línea cada uno; una persona no lleva organización. Sin customerType (una
//      pestaña con el JS de antes del deploy) el cuerpo se acepta como antes, para no perder
//      el lead: unos comentarios largos se recortan en vez de rechazarse.
//   7. Precios CON IVA desde el catálogo; cantidades inválidas → 400. Un producto que el
//      catálogo no identifica queda fuera del monto del negocio y se marca REVISAR.
//   8. Correo a ventas ANTES de Pipedrive, con la referencia NE- en la primera línea y los
//      comentarios completos.
//   9. Pipedrive falla y el correo salió: 200 { success, dealId: null, crm: 'failed' } y un
//      segundo correo "ATENCIÓN ... Crear el negocio a mano.". Fallan ambos: 502.
//  10. Nota del deal (HTML escapado), también en un reenvío con la misma referencia: tipo de
//      cliente, datos de facturación, productos, total CON IVA y comentarios.
// Los logs llevan la referencia, el tipo de cliente y los ids: nunca nombre, correo,
// teléfono ni RUT.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateQuotePayload } from '../_lib/crm/validation.js';
import { processQuoteToCrm, buildSuccessResponse, type CrmProcessingResult } from '../_lib/crm/dedupe.js';
import type { QuotePayload, QuoteCreateResponse, QuoteCreateSuccessResponse } from '../_lib/crm/types.js';
import {
  isAllowedOrigin,
  checkRateLimit,
  isHoneypotTriggered,
  getClientIp,
} from '../_lib/auth.js';
import { priceItems } from '../_lib/catalog/pricing.js';
import { pipedrivePost } from '../_lib/pipedrive/client.js';
import { notifySales, type SalesEmail } from '../_lib/notify/salesEmail.js';

// --- Constants ---
const LOG_PREFIX = '[api/quotes/create]';
const ALLOWED_METHODS = ['POST'];

// --- Cotizaciones del sitio ---

/** Referencia que arma /cotizacion: "NE-" + djb2 en base 36. */
const SITE_QUOTE_REFERENCE = /^NE-[0-9a-z]{1,7}$/;
const MAX_NOTES = 2000;
const MAX_COMPANY_FIELD = 200;
/** SKU o nombre que manda el navegador para un producto que el catálogo no identifica. */
const MAX_SITE_TEXT = 120;
/** Precio unitario del navegador que se muestra en una línea REVISAR (CLP). */
const MAX_SITE_PRICE = 100_000_000;
/**
 * Campo COMENTARIOS del correo: el helper lo corta a 500 caracteres (MAX_CAMPO en
 * api/_lib/notify/salesEmail.ts). Un comentario más largo va completo en el cuerpo.
 */
const EMAIL_COMMENT_FIELD = 500;
/**
 * Cuerpo del correo (PRODUCTOS SOLICITADOS): el helper lo corta a 8000 caracteres
 * (MAX_CUERPO); queda espacio para la línea de ATENCIÓN del segundo correo.
 */
const EMAIL_BODY_BUDGET = 7800;

type CustomerType = 'persona' | 'empresa';

const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  empresa: 'Empresa',
  persona: 'Persona natural',
};

/** Sin customerType (formulario anterior) el tipo de cliente no se adivina. */
const customerTypeLabel = (type: CustomerType | undefined) =>
  type ? CUSTOMER_TYPE_LABEL[type] : 'no indicado (formulario anterior)';

/** Datos de facturación de una empresa: van al correo y a la nota, nunca al log. */
interface Billing {
  razonSocial: string;
  rut: string;
  giro: string;
  direccion: string;
}

interface SiteQuote {
  /** Tipo de cliente; undefined en un cuerpo sin customerType (formulario anterior). */
  customerType?: CustomerType;
  /** El cliente veía precios netos (modo empresa del encabezado). */
  net: boolean;
  billing?: Billing;
  /** Líneas de productos para la nota y el correo. */
  detail: string[];
  /** Las mismas líneas abreviadas, para un correo que no alcanza a llevarlas completas. */
  compact: string[];
  /** Productos que el catálogo no identificó: fuera del total, REVISAR. */
  pending: number;
}

/** Una línea: sin saltos de línea ni espacios repetidos. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Texto de una línea, de 1 a `max` caracteres; si no, undefined. */
function requiredText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = oneLine(value);
  return text && text.length <= max ? text : undefined;
}

/** SKU o nombre que mandó el navegador: una línea, hasta MAX_SITE_TEXT caracteres. */
function siteText(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return oneLine(text).slice(0, MAX_SITE_TEXT);
}

/** Precio unitario que mostró el sitio: entero de 1 a MAX_SITE_PRICE; si no, undefined. */
function sitePrice(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_SITE_PRICE
    ? value
    : undefined;
}

/** Comentarios del formulario anterior: nunca rechazan el lead; uno largo se recorta con una marca. */
function legacyNotes(notes: unknown): string | undefined {
  if (typeof notes !== 'string') return undefined;
  if (notes.length <= MAX_NOTES) return notes;
  return notes.slice(0, MAX_NOTES) + '\n[…recortado: ' + (notes.length - MAX_NOTES) + ' caracteres más]';
}

const pendingText = (n: number) =>
  n === 1 ? '1 producto sin precio de catálogo' : `${n} productos sin precio de catálogo`;

/**
 * Lee y valida los campos de /cotizacion que no son parte de QuotePayload (customerType,
 * priceMode, company) y los quita del cuerpo antes del CRM. El leadType sale del tipo de
 * cliente: empresa → B2B con su razón social como organización; persona → B2C, sin
 * organización. El RUT solo se exige presente (sin validar su formato).
 */
function prepareSiteQuote(body: Record<string, unknown>): { site: SiteQuote; errors: string[] } {
  const { customerType, priceMode, company } = body;
  delete body.customerType;
  delete body.priceMode;
  delete body.company;
  // Campos de los pedidos de Jumpseller: una cotización del sitio no los lleva
  delete body.jumpsellerOrderId;
  delete body.jumpsellerEventType;

  const errors: string[] = [];
  if (typeof body.quoteReference !== 'string' || !SITE_QUOTE_REFERENCE.test(body.quoteReference)) {
    errors.push('quoteReference must match NE-xxxxxxx');
  }
  if (customerType === undefined) {
    // Formulario anterior (textarea sin límite): se acepta como antes, recortado
    const notes = legacyNotes(body.notes);
    if (notes === undefined) delete body.notes;
    else body.notes = notes;
  } else if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > MAX_NOTES)) {
    errors.push(`notes must be text of up to ${MAX_NOTES} characters`);
  }
  if (priceMode !== undefined && priceMode !== 'iva' && priceMode !== 'neto') {
    errors.push("priceMode must be 'iva' or 'neto'");
  }
  if (customerType !== undefined && customerType !== 'persona' && customerType !== 'empresa') {
    errors.push("customerType must be 'persona' or 'empresa'");
  }

  // Sin priceMode (bundle viejo), el sitio mandaba leadType B2B cuando mostraba precios netos
  const net = priceMode === undefined ? body.leadType === 'B2B' : priceMode === 'neto';

  let billing: Billing | undefined;
  if (customerType === 'empresa') {
    const org = (body.organization ?? {}) as Record<string, unknown>;
    const c = (company ?? {}) as Record<string, unknown>;
    const razonSocial = requiredText(org.name, MAX_COMPANY_FIELD);
    const rut = requiredText(c.rut, MAX_COMPANY_FIELD);
    const giro = requiredText(c.giro, MAX_COMPANY_FIELD);
    const direccion = requiredText(c.address, MAX_COMPANY_FIELD);
    if (razonSocial && rut && giro && direccion) {
      billing = { razonSocial, rut, giro, direccion };
      body.organization = { name: razonSocial };
    } else {
      const missing = [
        !razonSocial && 'organization.name',
        !rut && 'company.rut',
        !giro && 'company.giro',
        !direccion && 'company.address',
      ].filter(Boolean);
      errors.push(`empresa requires ${missing.join(', ')} (1-${MAX_COMPANY_FIELD} characters)`);
    }
  } else if (customerType === 'persona') {
    delete body.organization;
  }
  if (customerType === 'empresa' || customerType === 'persona') {
    body.leadType = customerType === 'empresa' ? 'B2B' : 'B2C';
  }

  const type = customerType === 'empresa' || customerType === 'persona' ? customerType : undefined;
  return { site: { customerType: type, net, billing, detail: [], compact: [], pending: 0 }, errors };
}

/**
 * Reemplaza en el lugar precio, nombre y SKU de cada producto por los del catálogo
 * (CON IVA) y recalcula quoteAmountClp solo con ellos: el monto del negocio nunca usa un
 * precio del navegador. Un producto que no se identifica no bloquea: queda fuera del total
 * y el correo y la nota lo marcan REVISAR con el precio que mostró el sitio (llevado a CON
 * IVA si el cliente veía precios netos), si es un precio razonable. Un total de 0 no se
 * manda: el deal queda sin monto. Deja el detalle en `site`; devuelve los errores de
 * cantidad (400).
 */
function repriceSiteQuote(body: Record<string, unknown>, site: SiteQuote): string[] {
  const products = (body.products as unknown[]).map(
    (p) => (p && typeof p === 'object' ? p : {}) as Record<string, unknown>,
  );
  const pricing = priceItems(
    products.map((p) => ({ jumpsellerId: p.jumpsellerId, variantId: p.variantId, sku: p.sku, name: p.name, quantity: p.quantity })),
  );
  if (pricing.errors.length) return pricing.errors;
  if (pricing.unresolved.length) {
    console.warn(
      `${LOG_PREFIX} ${pricing.unresolved.length} producto(s) sin precio de catálogo (líneas ` +
        `${pricing.unresolved.map((u) => u.index).join(', ')}): fuera del total, REVISAR`,
    );
  }

  const priced = new Map(pricing.lineIndexes.map((idx, n) => [idx, pricing.lines[n]]));
  let total = 0;
  body.products = products.map((p, i) => {
    const line = priced.get(i);
    if (!line) {
      const quantity = Number(p.quantity); // entero de 1 a 9999: priceItems ya lo validó
      const sku = siteText(p.sku);
      const name = siteText(p.name);
      const shown = sitePrice(p.unitPriceClp);
      const gross = shown === undefined ? undefined : site.net ? Math.round(shown * 1.19) : shown;
      site.pending++;
      const revisar =
        `  REVISAR [${sku}] ${name} x${quantity}` +
        (gross === undefined
          ? ' (sin precio del sitio; por confirmar, fuera del total)'
          : ` @ ${gross} CLP (precio del sitio, por confirmar; fuera del total)`);
      site.detail.push(revisar);
      site.compact.push(revisar);
      return { sku: sku || undefined, name: name || 'Producto sin identificar', quantity, ...(gross === undefined ? {} : { unitPriceClp: gross }) };
    }
    total += line.lineTotal;
    const sku = siteText(line.sku);
    const revisarVariant = line.variantUnknown ? ' — REVISAR: variante ya no existe, precio base' : '';
    site.detail.push(
      `  [${sku}] ${line.name} x${line.quantity} @ ${line.unitPrice} CLP = ${line.lineTotal} CLP` +
        ` | Jumpseller ${line.jumpsellerId}${line.variantId ? ` variante ${line.variantId}` : ''}` +
        revisarVariant,
    );
    site.compact.push(`  [${sku}] x${line.quantity} = ${line.lineTotal} CLP${revisarVariant}`);
    return { sku: line.sku, name: line.name, quantity: line.quantity, unitPriceClp: line.unitPrice };
  });
  if (total > 0) body.quoteAmountClp = total;
  else delete body.quoteAmountClp;
  return [];
}

const formatClp = (amount: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(amount);

/**
 * Cuerpo del correo dentro de EMAIL_BODY_BUDGET, con los comentarios (`tail`) siempre
 * completos: si los productos no caben, van abreviados (sin nombre ni ids de Jumpseller) y,
 * en último caso, solo los que caben, con el número de los que faltan.
 */
function fitEmailBody(head: string[], site: SiteQuote, tail: string[]): string {
  const body = (lines: string[]) => [...head, ...lines, ...tail].join('\n');
  const full = body(site.detail);
  if (full.length <= EMAIL_BODY_BUDGET) return full;

  const notice = 200; // espacio para el aviso de abajo
  let used = body([]).length + notice;
  const kept: string[] = [];
  for (const line of site.compact) {
    if (used + line.length + 1 > EMAIL_BODY_BUDGET) break;
    kept.push(line);
    used += line.length + 1;
  }
  const missing = site.compact.length - kept.length;
  return body([
    ...kept,
    missing
      ? `  … y ${missing} línea(s) más que no caben en el correo (el detalle completo va en la nota de Pipedrive)`
      : '  (líneas abreviadas para que quepan en el correo; el detalle completo va en la nota de Pipedrive)',
  ]);
}

/**
 * Correo a ventas: la primera línea lleva la referencia para encontrar el deal. El campo
 * COMENTARIOS admite 500 caracteres; un comentario más largo va completo al final del cuerpo
 * y el campo lleva el comienzo con un aviso.
 */
function buildSalesEmail(payload: QuotePayload, site: SiteQuote): SalesEmail {
  const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
  const longNotes = notes.length > EMAIL_COMMENT_FIELD;
  const head = [
    `Cotización web ${payload.quoteReference} (buscar la referencia en Pipedrive)`,
    `Tipo de cliente: ${customerTypeLabel(site.customerType)}`,
  ];
  const tail = longNotes ? ['', 'Comentarios del cliente (completos):', notes] : [];
  const pending = site.pending ? pendingText(site.pending) : '';
  return {
    modo: site.net ? 'Con IVA (el cliente veía precios netos, modo empresa)' : 'Con IVA',
    nombre: payload.customer.name,
    email: payload.customer.email ?? '',
    telefono: payload.customer.phone ?? '',
    cuerpo: fitEmailBody(head, site, tail),
    total: payload.quoteAmountClp
      ? formatClp(payload.quoteAmountClp) + (pending ? ' + ' + pending + ' (por confirmar)' : '')
      : pending ? 'Por confirmar (' + pending + ')' : undefined,
    razonSocial: site.billing?.razonSocial,
    rutEmpresa: site.billing?.rut,
    giro: site.billing?.giro,
    direccion: site.billing?.direccion,
    comentarios: longNotes
      ? notes.slice(0, 300).trimEnd() +
        ' […]\n(Comentario de ' + notes.length + ' caracteres: va completo al final de PRODUCTOS SOLICITADOS.)'
      : notes || undefined,
    asunto: `Cotización web ${payload.quoteReference}`,
  };
}

/** La nota de Pipedrive es HTML: el texto del cliente no puede agregar etiquetas ni enlaces. */
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nota del deal: tipo de cliente, datos de facturación, productos, total y comentarios. */
function buildSiteQuoteNote(payload: QuotePayload, site: SiteQuote, duplicate: boolean): string {
  const ref = payload.quoteReference;
  return escapeHtml([
    duplicate
      ? `Reenvío de la cotización ${ref} (misma referencia; no se creó un negocio nuevo)`
      : `Cotización web ${ref} (precios CON IVA desde Jumpseller)`,
    `Tipo de cliente: ${customerTypeLabel(site.customerType)}`,
    ...(site.billing
      ? [
          `Razón social: ${site.billing.razonSocial}`,
          `RUT: ${site.billing.rut}`,
          `Giro: ${site.billing.giro}`,
          `Dirección: ${site.billing.direccion}`,
        ]
      : []),
    ...site.detail,
    payload.quoteAmountClp
      ? `TOTAL CON IVA: ${payload.quoteAmountClp} CLP` + (site.pending ? ` (no incluye ${pendingText(site.pending)}: REVISAR)` : '')
      : 'TOTAL CON IVA: por confirmar (REVISAR)',
    ...(site.net ? ['El cliente veía precios netos (modo empresa del sitio); los montos de esta nota son CON IVA.'] : []),
    ...(payload.notes ? [`Comentarios del cliente: ${payload.notes}`] : []),
  ].join('\n'));
}

/** Nota en el deal. No bloquea: el correo a ventas ya lleva los mismos datos. */
async function addSiteQuoteNote(dealId: number, content: string, ref: string): Promise<void> {
  try {
    const res = await pipedrivePost('/notes', { content, deal_id: dealId });
    if (!res.success) console.warn(`${ref} Nota en Pipedrive FAIL | dealId: ${dealId} | ${res.error ?? 'unknown'}`);
  } catch (err) {
    console.warn(`${ref} Nota en Pipedrive FAIL | dealId: ${dealId} | ${errorMessage(err)}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Auth ---

/**
 * Cómo se autoriza la llamada (null: no se autoriza):
 *  - 'key': header `x-api-key` / `Authorization: Bearer` igual a QUOTES_API_KEY
 *    (server-to-server — cron, integraciones programáticas);
 *  - 'origin': sin header, con Origin/Referer en la allow-list (flujo web), o sin
 *    QUOTES_API_KEY configurada (dev/local).
 */
function authorize(req: VercelRequest): 'key' | 'origin' | null {
  const quotesKey = process.env.QUOTES_API_KEY;
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  if (apiKey || authHeader) {
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const provided = apiKey ?? bearer;
    return quotesKey && provided === quotesKey ? 'key' : null;
  }

  if (isAllowedOrigin(req)) return 'origin';
  if (!quotesKey) return 'origin';
  console.warn(`${LOG_PREFIX} Unauthorized: no header and untrusted origin`);
  return null;
}

// --- Handler ---

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!ALLOWED_METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    console.warn(`${LOG_PREFIX} Rate limit exceeded for IP: ${ip}`);
    res.status(429).json({ success: false, error: 'Too many requests. Try again later.' });
    return;
  }

  if (!isAllowedOrigin(req)) {
    console.warn(`${LOG_PREFIX} Blocked origin:`, req.headers['origin']);
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const body = req.body;

  if (isHoneypotTriggered(body)) {
    console.warn(`${LOG_PREFIX} Honeypot triggered from IP: ${ip}`);
    res.status(200).json({ success: true });
    return;
  }

  // Sin API key, solo cotizaciones del sitio: el Origin se puede falsificar, y una fuente
  // 'jumpseller' con el id de un pedido real haría que el webhook lo diera por repetido.
  if (auth !== 'key' && !(body && typeof body === 'object' && body.sourceSystem === 'nuevo_elights')) {
    const errors = ["sourceSystem must be 'nuevo_elights' (other sources require an API key)"];
    console.warn(`${LOG_PREFIX} Validation failed:`, errors);
    res.status(400).json({ success: false, error: 'Validation failed', details: { errors } } satisfies QuoteCreateResponse);
    return;
  }

  // Cotizaciones del sitio: persona o empresa, y precios CON IVA recalculados desde el
  // catálogo de Jumpseller (el navegador puede mandar precios netos del modo empresa o
  // desactualizados). Las otras fuentes (solo con API key) no se tocan.
  let site: SiteQuote | undefined;
  if (body && typeof body === 'object' && body.sourceSystem === 'nuevo_elights' && Array.isArray(body.products)) {
    const prepared = prepareSiteQuote(body as Record<string, unknown>);
    const errors = prepared.errors.length
      ? prepared.errors
      : repriceSiteQuote(body as Record<string, unknown>, prepared.site);
    if (errors.length) {
      console.warn(`${LOG_PREFIX} Validation failed:`, errors);
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: { errors },
      } satisfies QuoteCreateResponse);
      return;
    }
    site = prepared.site;
  }

  const validation = validateQuotePayload(body);
  if (!validation.valid) {
    console.warn(`${LOG_PREFIX} Validation failed:`, validation.errors);
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: { errors: validation.errors },
    } satisfies QuoteCreateResponse);
    return;
  }

  const payload = body as QuotePayload;
  const quoteReference = payload.quoteReference;
  const ref = `${LOG_PREFIX} ${quoteReference}`;

  console.log(
    `${ref} Processing quote (source: ${payload.sourceSystem}, customerType: ` +
      `${site ? site.customerType ?? 'sin indicar' : 'n/a'})`
  );

  // Cotización del sitio: correo a ventas ANTES de Pipedrive (si el CRM falla, el lead no
  // se pierde). Otras fuentes no mandan correo.
  const email = site ? buildSalesEmail(payload, site) : undefined;
  const mail = email ? notifySales(email, ref) : undefined;

  let result: CrmProcessingResult;
  try {
    result = await processQuoteToCrm(payload);
  } catch (err) {
    console.error(`${LOG_PREFIX} LEAD SIN CRM ${quoteReference} | Pipedrive FAIL: ${errorMessage(err)}`);

    if (email && (await mail)) {
      // El correo salió: el lead no se pierde. Segundo correo para crear el negocio a mano.
      notifySales(
        {
          ...email,
          cuerpo:
            'ATENCIÓN: la solicitud ' + quoteReference + ' NO quedó en Pipedrive. Crear el negocio a mano.\n\n' +
            email.cuerpo,
          asunto: 'ATENCIÓN ' + quoteReference + ' sin Pipedrive',
        },
        ref
      );
      res.status(200).json({ success: true, quoteReference, dealId: null, crm: 'failed' });
      return;
    }

    res.status(502).json({
      success: false,
      error: 'No se pudo registrar tu cotización. Por favor inténtalo de nuevo o escríbenos por WhatsApp.',
    } satisfies QuoteCreateResponse);
    return;
  }

  const response = { ...buildSuccessResponse(result), quoteReference } satisfies QuoteCreateSuccessResponse & {
    quoteReference: string;
  };

  // Cotización del sitio: el detalle (tipo de cliente, facturación, ids de Jumpseller) queda
  // como nota del deal, también en un reenvío con la misma referencia (sin negocio nuevo).
  const dealId = result.deal?.dealId;
  const status = result.deal?.status;
  if (site && dealId && (status === 'created' || status === 'skipped_duplicate')) {
    await addSiteQuoteNote(dealId, buildSiteQuoteNote(payload, site, status === 'skipped_duplicate'), ref);
  }

  console.log(
    `${ref} Quote processed successfully — ` +
    `deal: ${response.dealId} (${response.dealStatus}), score: ${response.leadScore}`
  );

  // 201 for new deals, 200 for all other outcomes
  res.status(status === 'created' ? 201 : 200).json(response);
}
