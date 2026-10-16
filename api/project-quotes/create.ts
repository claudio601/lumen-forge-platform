// api/project-quotes/create.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/project-quotes/create
//
// Cotizador de proyecto (/cotizador; /contact y /contactos también llegan aquí).
// El visitante describe su proyecto (tipo, m², altura...) y deja sus datos. No hay
// productos ni precios: ventas prepara la propuesta y responde con un link de pago
// de Jumpseller. Reemplaza el envío por EmailJS desde el navegador.
//
// Flujo (orden crítico — no modificar):
//   1. Método (405 con Allow: POST)
//   2. Rate limit por IP (429), origen (403) y honeypot (200 sin crear nada)
//   2b. Privacidad (clave `consent`, api/_lib/forms/consent.ts): sin la casilla
//       obligatoria, 400 con code 'consent_required' antes del correo y de Pipedrive.
//       Un solo new Date() por solicitud: la hora de la constancia, la «Fecha» de la nota
//       y la ventana de la referencia salen del mismo instante del servidor.
//   3. Validar payload (400). Se arma un objeto limpio solo con las claves conocidas:
//      cualquier precio o monto que mande el navegador se descarta.
//   4. Referencia PY- única: la misma en el correo, la nota y el deal
//   5. Correo a ventas vía GAS ANTES de Pipedrive (waitUntil, no bloquea)
//   6. Pipedrive: persona, organización (si hay razón social), deal (valor 0, Tipo de
//      Servicio 89) y nota con todos los datos
//      -> CRM ok: 201 creado / 200 duplicado { success, reference, dealId }
//      -> CRM falla y el correo salió: 200 { success, reference, dealId: null, crm: 'failed' }
//         + segundo correo "ATENCIÓN ... Crear el negocio a mano."
//      -> Fallan ambos: 502
//
// El correo y la nota terminan con la constancia "PRIVACIDAD Y AUTORIZACIONES" y el origen
// de la visita (clave `attribution`, api/_lib/forms/attribution.ts). El origen es
// informativo: un origen raro se descarta, nunca da 400, y no entra en la referencia ni en
// el log. La casilla tampoco entra en la referencia.
//
// Los logs llevan solo la referencia, el tipo de proyecto (una de las opciones de la lista:
// otro valor da 400), los m², si hay empresa y los ids: nunca el correo, el teléfono, el
// nombre ni el RUT.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findOrCreatePerson } from '../_lib/pipedrive/persons.js';
import { findOrCreateOrganization } from '../_lib/pipedrive/organizations.js';
import { createDeal } from '../_lib/pipedrive/deals.js';
import { initFieldOptions } from '../_lib/pipedrive/fieldOptions.js';
import { pipedrivePost } from '../_lib/pipedrive/client.js';
import { computeLeadScore } from '../_lib/crm/scoring.js';
import { TIPO_SERVICIO } from '../_lib/crm/tipo-servicio.js';
import { normalizePhone } from '../_lib/crm/validation.js';
import type { DealResultStatus, LeadType } from '../_lib/crm/types.js';
import { checkRateLimit, getClientIp, isAllowedOrigin, isHoneypotTriggered } from '../_lib/auth.js';
import { notifySales, type SalesEmail } from '../_lib/notify/salesEmail.js';
import {
  ILLUMINATION_LEVELS,
  MAX_ALTURA,
  MAX_M2,
  PROJECT_TYPES,
  parseM2,
  type IlluminationLevel,
  type ProjectType,
} from '../_lib/forms/projectQuote.js';
import { origenFromBody } from '../_lib/forms/attribution.js';
import { CONSENT_ERROR_CODE, resolveConsent } from '../_lib/forms/consent.js';

const LOG = '[ProjectQuote]';
const ALLOWED_METHODS = ['POST'];

// ── Payload limpio ────────────────────────────────────────────────────────────

export interface ProjectQuote {
  nombre: string;
  email: string;
  telefono: string;
  tipoProyecto: ProjectType;
  m2: number;
  altura?: number;
  aplicacion?: string;
  nivelIluminacion?: IlluminationLevel;
  ciudad?: string;
  plazo?: string;
  comentarios?: string;
  rutEmpresa?: string;
  razonSocial?: string;
  giro?: string;
  direccion?: string;
}

/** Largo máximo de cada texto (el formulario usa los mismos). */
const MAX_TEXT = {
  nombre: 120,
  email: 254,
  telefono: 30,
  aplicacion: 200,
  ciudad: 200,
  plazo: 200,
  comentarios: 2000,
  rutEmpresa: 20,
  razonSocial: 150,
  giro: 150,
  direccion: 200,
} as const;

type TextKey = keyof typeof MAX_TEXT;

/**
 * Campo COMENTARIOS del correo: el helper lo corta a 500 caracteres (MAX_CAMPO en
 * api/_lib/notify/salesEmail.ts). Un comentario más largo va completo en el cuerpo.
 */
const EMAIL_COMMENT_FIELD = 500;

const NOT_GIVEN = '(no indicado)';

export interface ProjectQuoteValidation {
  valid: boolean;
  errors: string[];
  /** Solo las claves conocidas, recortadas; null si hay errores. */
  quote: ProjectQuote | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_REGEX = /^-?\d+(?:[.,]\d+)?$/;

/** Una línea: sin saltos ni espacios repetidos, así un campo no agrega líneas a la nota. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

const isBlank = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

function readText(
  p: Record<string, unknown>,
  key: TextKey,
  errors: string[],
  { required = false, multiline = false } = {}
): string | undefined {
  const raw = p[key];
  if (isBlank(raw)) {
    if (required) errors.push(key + ' is required');
    return undefined;
  }
  if (typeof raw !== 'string') {
    errors.push(key + ' must be a string');
    return undefined;
  }
  const value = multiline ? raw.replace(/\r\n?/g, '\n').trim() : oneLine(raw);
  if (value.length > MAX_TEXT[key]) {
    errors.push(key + ' max ' + MAX_TEXT[key] + ' characters');
    return undefined;
  }
  return value;
}

/**
 * Valor de una lista del formulario: solo una de sus opciones, exacta (mayúsculas
 * incluidas). Así nada escrito a mano llega al log ni al título del negocio.
 */
function readOption<T extends string>(
  p: Record<string, unknown>,
  key: 'tipoProyecto' | 'nivelIluminacion',
  options: readonly T[],
  errors: string[],
  { required = false } = {}
): T | undefined {
  const raw = p[key];
  if (isBlank(raw)) {
    if (required) errors.push(key + ' is required');
    return undefined;
  }
  if (typeof raw !== 'string' || !(options as readonly string[]).includes(raw)) {
    errors.push(key + ' must be one of: ' + options.join(', '));
    return undefined;
  }
  return raw as T;
}

/** Altura: número o texto numérico ("8", "8,5"); NaN si no lo es. */
function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && NUMBER_REGEX.test(raw.trim())) return Number(raw.trim().replace(',', '.'));
  return NaN;
}

/** m²: un número, o texto leído igual que en el formulario ("12.000" son 12000, no 12). */
function toM2(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return parseM2(raw);
  return NaN;
}

/**
 * Valida el cuerpo y arma un objeto limpio. Requeridos: nombre, email, teléfono (8 a 12
 * dígitos, la misma regla que /cotizacion), tipo de proyecto (una opción de la lista) y m²
 * (mayor que 0; como texto, un entero con o sin punto de miles, igual que el formulario).
 */
export function validateProjectQuote(body: unknown): ProjectQuoteValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Payload must be a non-null object'], quote: null };
  }
  const p = body as Record<string, unknown>;
  const errors: string[] = [];

  const nombre = readText(p, 'nombre', errors, { required: true });
  const email = readText(p, 'email', errors, { required: true });
  if (email !== undefined && !EMAIL_REGEX.test(email)) errors.push('email has invalid format');
  const telefono = readText(p, 'telefono', errors, { required: true });
  if (telefono !== undefined) {
    const digits = telefono.replace(/\D/g, '').length;
    if (digits < 8 || digits > 12) errors.push('telefono must have 8 to 12 digits');
  }
  const tipoProyecto = readOption(p, 'tipoProyecto', PROJECT_TYPES, errors, { required: true });

  let m2: number | undefined;
  if (isBlank(p.m2)) {
    errors.push('m2 is required');
  } else {
    const n = toM2(p.m2);
    if (Number.isFinite(n) && n > 0 && n <= MAX_M2) m2 = n;
    else errors.push('m2 must be a number greater than 0 and at most ' + MAX_M2 + ' (as text: digits, thousands with dots)');
  }

  let altura: number | undefined;
  if (!isBlank(p.altura)) {
    const n = toNumber(p.altura);
    if (Number.isFinite(n) && n >= 0 && n <= MAX_ALTURA) altura = n;
    else errors.push('altura must be a number from 0 to ' + MAX_ALTURA);
  }

  const optional = {
    aplicacion: readText(p, 'aplicacion', errors),
    nivelIluminacion: readOption(p, 'nivelIluminacion', ILLUMINATION_LEVELS, errors),
    ciudad: readText(p, 'ciudad', errors),
    plazo: readText(p, 'plazo', errors),
    comentarios: readText(p, 'comentarios', errors, { multiline: true }),
    rutEmpresa: readText(p, 'rutEmpresa', errors),
    razonSocial: readText(p, 'razonSocial', errors),
    giro: readText(p, 'giro', errors),
    direccion: readText(p, 'direccion', errors),
  };

  if (errors.length) return { valid: false, errors, quote: null };

  const quote: ProjectQuote = { nombre, email, telefono, tipoProyecto, m2 };
  if (altura !== undefined) quote.altura = altura;
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) Object.assign(quote, { [key]: value });
  }
  return { valid: true, errors: [], quote };
}

// ── Referencia, correo y nota ─────────────────────────────────────────────────

function djb2(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * "PY-{hash}". Ventana de 1 hora: el mismo formulario enviado dos veces en la misma
 * hora da la misma referencia (Pipedrive no crea un segundo negocio); otro contenido
 * u otra hora dan una nueva.
 */
export function buildProjectQuoteRef(q: ProjectQuote, now: number = Date.now()): string {
  const key = [
    q.email.toLowerCase(),
    q.telefono.replace(/\D/g, ''),
    q.tipoProyecto.toLowerCase(),
    String(q.m2),
    q.comentarios ?? '',
    (q.razonSocial ?? '').toLowerCase(),
    Math.floor(now / 3_600_000),
  ].join('|');
  return 'PY-' + djb2(key);
}

/** Empresa (B2B) si dejó razón social o RUT de empresa. */
const isCompany = (q: ProjectQuote) => Boolean(q.razonSocial || q.rutEmpresa);

function projectLines(q: ProjectQuote): string[] {
  return [
    `Tipo de proyecto: ${q.tipoProyecto}`,
    `m2 aproximados: ${q.m2}`,
    `Altura (m): ${q.altura ?? NOT_GIVEN}`,
    `Aplicación: ${q.aplicacion ?? NOT_GIVEN}`,
    `Nivel de iluminación: ${q.nivelIluminacion ?? NOT_GIVEN}`,
    `Ciudad / Región: ${q.ciudad ?? NOT_GIVEN}`,
    `Plazo: ${q.plazo ?? NOT_GIVEN}`,
  ];
}

/**
 * Correo a ventas. La plantilla es fija: el tipo de solicitud va en "Modo:" y la primera
 * línea de PRODUCTOS SOLICITADOS lleva la referencia para encontrar el negocio. Razón
 * social, RUT, giro, dirección y comentarios solo viajan si el cliente los dejó. `consent`:
 * la constancia PRIVACIDAD Y AUTORIZACIONES; `origen`: la sección ORIGEN DE LA VISITA, al final.
 */
export function buildProjectQuoteEmail(
  q: ProjectQuote,
  ref: string,
  origen: string[] = [],
  consent: string[] = []
): SalesEmail {
  const comentarios = q.comentarios ?? '';
  const longComment = comentarios.length > EMAIL_COMMENT_FIELD;
  return {
    modo: 'Proyecto (sin precios)',
    nombre: q.nombre,
    email: q.email,
    telefono: q.telefono,
    cuerpo: [
      `Cotizador de proyecto ${ref} (nuevo.elights.cl/cotizador)`,
      ...projectLines(q),
      ...(longComment ? ['', 'Comentarios del cliente (completos):', comentarios] : []),
      ...(consent.length ? ['', ...consent] : []),
      ...(origen.length ? ['', ...origen] : []),
    ].join('\n'),
    total: '-',
    razonSocial: q.razonSocial,
    rutEmpresa: q.rutEmpresa,
    giro: q.giro,
    direccion: q.direccion,
    comentarios: longComment
      ? comentarios.slice(0, 300).trimEnd() +
        ' […]\n(Comentario de ' + comentarios.length + ' caracteres: va completo al final de PRODUCTOS SOLICITADOS.)'
      : q.comentarios,
    asunto: `Cotizador de proyecto ${ref}`,
  };
}

/** La nota de Pipedrive es HTML: el texto del cliente no puede agregar etiquetas ni enlaces. */
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const chileDateTime = (date: Date) =>
  date.toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago' });

/**
 * Nota del deal con todos los datos, la constancia de privacidad y el origen; un reenvío del
 * mismo formulario lo dice al comienzo. `now`: el instante de la solicitud (el mismo de la
 * constancia).
 */
export function buildProjectQuoteNote(
  q: ProjectQuote,
  ref: string,
  {
    resend = false,
    now = new Date(),
    origen = [],
    consent = [],
  }: { resend?: boolean; now?: Date; origen?: string[]; consent?: string[] } = {}
): string {
  const fecha = chileDateTime(now);
  return escapeHtml([
    ...(resend
      ? [`Reenvío del mismo formulario (${fecha}): misma referencia ${ref}, no se creó un negocio nuevo.`, '']
      : []),
    '=== COTIZADOR DE PROYECTO (nuevo.elights.cl/cotizador) ===',
    `Referencia: ${ref}`,
    `Fecha: ${fecha}`,
    '',
    '--- PROYECTO ---',
    ...projectLines(q),
    '',
    '--- CONTACTO ---',
    `Nombre: ${q.nombre}`,
    `Email: ${q.email}`,
    `Teléfono: ${q.telefono}`,
    `Tipo de cliente: ${isCompany(q) ? 'Empresa (B2B)' : 'Persona (B2C)'}`,
    `Razón social: ${q.razonSocial ?? NOT_GIVEN}`,
    `RUT empresa: ${q.rutEmpresa ?? NOT_GIVEN}`,
    `Giro: ${q.giro ?? NOT_GIVEN}`,
    `Dirección: ${q.direccion ?? NOT_GIVEN}`,
    '',
    '--- COMENTARIOS ---',
    q.comentarios ?? '(sin comentarios)',
    '',
    'Sin productos ni precios: preparar propuesta y responder con link de pago de Jumpseller.',
    'source: cotizador | landingPath: /cotizador',
    ...(consent.length ? ['', ...consent] : []),
    ...(origen.length ? ['', ...origen] : []),
  ].join('\n'));
}

/** Nota en el deal. No bloquea: el correo a ventas ya lleva los mismos datos. */
async function addNote(dealId: number, content: string, ref: string): Promise<void> {
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

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!ALLOWED_METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  if (!checkRateLimit(getClientIp(req)).allowed) {
    console.warn(`${LOG} Rate limit excedido`);
    res.status(429).json({ success: false, error: 'Too many requests. Try again later.' });
    return;
  }
  if (!isAllowedOrigin(req)) {
    console.warn(`${LOG} Origen bloqueado:`, req.headers['origin']);
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const body = req.body;

  // Campo oculto "website": solo lo llenan bots. Se responde OK sin crear nada.
  if (isHoneypotTriggered(body)) {
    console.warn(`${LOG} Honeypot activado`);
    res.status(200).json({ success: true });
    return;
  }

  // Privacidad, antes del correo y de Pipedrive. Un solo reloj por solicitud: la hora de la
  // constancia es la del servidor.
  const at = new Date();
  const consent = resolveConsent(body, { form: 'cotizador', requireTerms: false, at });
  // `=== false`: con strictNullChecks apagado, `if (!consent.ok)` no estrecha el tipo.
  if (consent.ok === false) {
    console.warn(`${LOG} Consent missing`);
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: CONSENT_ERROR_CODE,
      details: { errors: consent.errors },
    });
    return;
  }

  const validation = validateProjectQuote(body);
  if (!validation.valid) {
    console.warn(`${LOG} Validación FAIL | errors:`, validation.errors);
    res.status(400).json({ success: false, error: 'Validation failed', details: { errors: validation.errors } });
    return;
  }

  const quote = validation.quote;
  // validateProjectQuote arma un objeto limpio: el origen se lee del cuerpo. Informativo,
  // nunca rechaza ni va al log.
  const origen = origenFromBody(body);
  // Una sola referencia para el correo, la nota y el deal: calcularla dos veces podría
  // separarlas si cambia la hora entre ambas.
  const reference = buildProjectQuoteRef(quote, at.getTime());
  const hasCompany = isCompany(quote);
  const ref = `${LOG} ${reference}`;
  console.log(`${ref} Procesando | tipo: ${quote.tipoProyecto} | m2: ${quote.m2} | hasCompany: ${hasCompany}`);

  // ── Paso 1: correo a ventas ANTES de Pipedrive (si el CRM falla, el lead no se pierde) ──
  const email = buildProjectQuoteEmail(quote, reference, origen, consent.section);
  const mail = notifySales(email, ref);

  // ── Paso 2: Pipedrive ───────────────────────────────────────────────────────
  let dealId: number;
  let status: DealResultStatus;
  try {
    const pipelineId = Number(process.env.PIPEDRIVE_PIPELINE_ID);
    const stageId = Number(process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID);
    if (!pipelineId || !stageId) {
      throw new Error('PIPEDRIVE_PIPELINE_ID or PIPEDRIVE_STAGE_NEW_LEAD_ID not set');
    }

    await initFieldOptions();

    const leadType: LeadType = hasCompany ? 'B2B' : 'B2C';
    const customer = {
      name: quote.nombre,
      email: quote.email,
      phone: normalizePhone(quote.telefono),
      commune: quote.ciudad,
    };
    // Sin productos ni monto: el puntaje sale del tipo de cliente, la empresa y el teléfono.
    const { priorityTier } = computeLeadScore({
      sourceSystem: 'nuevo_elights',
      quoteReference: reference,
      leadType,
      customer,
      organization: quote.razonSocial ? { name: quote.razonSocial } : undefined,
      products: [],
      quoteAmountClp: 0,
    });

    const person = await findOrCreatePerson(customer);

    let orgId: number | undefined;
    if (quote.razonSocial) {
      orgId = (await findOrCreateOrganization({ name: quote.razonSocial })).organizationId;
    }

    const result = await createDeal({
      personId: person.personId,
      orgId,
      pipelineId,
      stageId,
      title: `Proyecto ${reference} - ${quote.tipoProyecto} ${quote.m2} m2 - ${quote.nombre}`.slice(0, 255),
      quoteAmountClp: 0,
      sourceSystem: 'nuevo_elights',
      leadType,
      priorityTier,
      quoteReference: reference,
      tipoServicio: TIPO_SERVICIO.COTIZACION_WEB,
    });
    if (!result.dealId) {
      throw new Error(`createDeal returned null dealId (status: ${result.status})`);
    }
    dealId = result.dealId;
    status = result.status;

    // createDeal no guarda notas: el detalle va aparte, también en un reenvío.
    await addNote(
      dealId,
      buildProjectQuoteNote(quote, reference, { resend: status !== 'created', now: at, origen, consent: consent.section }),
      ref
    );

    console.log(
      `${ref} Deal: ${dealId} (${status}) | person: ${person.personId}` +
        (orgId ? ` | org: ${orgId}` : '') + ` | leadType: ${leadType} | tier: ${priorityTier}`
    );
  } catch (err) {
    console.error(`${LOG} LEAD SIN CRM ${reference} | Pipedrive FAIL: ${errorMessage(err)}`);

    if (await mail) {
      // El correo salió: el lead no se pierde. Segundo correo para crear el negocio a mano.
      notifySales(
        {
          ...email,
          cuerpo: `ATENCIÓN: la solicitud ${reference} NO quedó en Pipedrive. Crear el negocio a mano.\n\n` + email.cuerpo,
          asunto: `ATENCIÓN ${reference} sin Pipedrive`,
        },
        ref
      );
      res.status(200).json({ success: true, reference, dealId: null, crm: 'failed' });
      return;
    }

    res.status(502).json({
      success: false,
      error: 'No pudimos registrar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.',
    });
    return;
  }

  // ── Paso 3: respuesta ───────────────────────────────────────────────────────
  res.status(status === 'created' ? 201 : 200).json({ success: true, reference, dealId });
}
