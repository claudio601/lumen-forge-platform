// api/_lib/whatsapp/pipedriveLead.ts
// Crea o reutiliza deal en Pipedrive para leads de WhatsApp.
// v1: agrega custom fields WA + note estructurada.

import { randomBytes } from 'node:crypto';
import { redact } from '../logging/redact.js';
import { findOrCreatePerson } from '../pipedrive/persons.js';
import { createDeal, updateDeal } from '../pipedrive/deals.js';
import { initFieldOptions } from '../pipedrive/fieldOptions.js';
import { pipedriveGet, pipedrivePost } from '../pipedrive/client.js';
import type { QuoteCustomer } from '../crm/types.js';
import { TIPO_SERVICIO } from '../crm/tipo-servicio.js';
import { looksLikePersonName } from './flowEngine.js';
import type { CapturedFields, CaptureStatus } from './flowEngine.js';
import { isBusinessRut } from './rutCapture.js';
import { chileTime, TRANSCRIPT_MAX_TEXT } from './transcript.js';

const LOG_PREFIX = '[pipedriveLead]';

/**
 * Ventana de deduplicacion (decision del dueno, 2026-10-26): una conversacion nueva se junta con
 * el negocio WA- abierto del mismo numero si tuvo movimiento en estos dias. Si el negocio esta
 * ganado, perdido o quieto por mas tiempo, se crea uno nuevo, que ventas ve como lead nuevo.
 */
export const WA_DEDUP_WINDOW_DAYS = 7;

export interface WhatsAppLeadParams {
    phone: string;
    name: string;
    summary: string;
    body: string;
    captured?: CapturedFields;
    captureStatus?: CaptureStatus;
    wantsHuman?: boolean;
    leadType?: 'B2B' | 'B2C' | 'Unknown';
    priorityTier?: 'Alta' | 'Normal';
    existingDealId?: number;
    /** [TRANSCRIPCION] La conversacion en texto plano (transcript.ts); sin ella, la nota trae este mensaje. */
    transcript?: string;
}

export interface WhatsAppDealResult {
    dealId?: number;
    personId?: number;
    action: 'created' | 'found' | 'skipped';
    pendingWrite?: PendingWhatsAppWrite;
}

/** Solo las operaciones sin confirmar se guardan para el mensaje siguiente. */
export interface PendingWhatsAppWrite {
    dealId: number;
    personId?: number;
    fields?: Record<string, string>;
    note?: string;
    /**
     * [NOTA-REF] La referencia fija de la nota, que tambien es su ultima linea (buildNote): antes de repetir
     * un envio incierto se busca en las notas del negocio. Las pendientes de antes de este cambio no la traen.
     */
    noteRef?: string;
    /**
     * [NOTA-REF] Desde cuando (ms) la nota pudo quedar en Pipedrive sin confirmarse: el inicio de su primer
     * envio incierto (o un guardado en la cola sin respuesta, stateStore.ts). El siguiente la busca antes, en
     * una pagina que llegue hasta antes de esa hora.
     */
    noteUnsure?: number;
    /** [NOTA-REF] Inicio (ms) de su ultimo envio incierto: la busqueda espera NOTE_SETTLE_MS desde ahi. */
    noteUnsureLast?: number;
}

// [NOTA-REF] Cada nota del bot lleva una referencia fija ('wa-' y 12 hex al azar), creada una sola vez al
// armarla, antes del primer envio, y guardada con la escritura pendiente. Si Pipedrive guarda la nota pero
// la respuesta se pierde (tiempo limite, red, 5xx), el reintento la busca en las notas recientes del negocio
// antes de repetirla: si esta, se da por entregada. La linea va al final, separada por una linea vacia; la
// transcripcion nunca deja una linea sin la hora ni sangria, asi que no se confunde con lo que escribio el
// cliente, que tampoco conoce la referencia.
export const NOTE_REF_LABEL = 'Ref. WhatsApp: ';
const NOTE_REF_RE = /^wa-[0-9a-f]{12}$/;
// [NOTA-REF] La busqueda: paginas de NOTE_SEARCH_LIMIT notas, de la mas nueva a la mas antigua, hasta
// NOTE_SEARCH_MAX_PAGES paginas y NOTE_SEARCH_TIMEOUT_MS en total (todas las paginas juntas).
export const NOTE_SEARCH_LIMIT = 50;
export const NOTE_SEARCH_MAX_PAGES = 4;
export const NOTE_SEARCH_TIMEOUT_MS = 10_000;
// [NOTA-REF] Pipedrive puede terminar de guardar una nota despues de que se corto la espera: la busqueda no
// corre antes de este plazo desde el ultimo envio incierto (webhook.ts la reintenta en segundo plano cuando
// se cumple, si cabe en la funcion; si no, queda para el mensaje siguiente).
export const NOTE_SETTLE_MS = 30_000;
// [NOTA-REF] Margen por la diferencia de reloj con Pipedrive al comparar con la hora de cada nota (add_time).
const NOTE_CLOCK_MARGIN_MS = 10 * 60_000;

/** [NOTA-REF] Una referencia nueva para una nota (una por nota armada). */
export function newNoteRef(): string {
    return 'wa-' + randomBytes(6).toString('hex');
}

function noteRefLine(ref: string): string {
    return '\n\n' + NOTE_REF_LABEL + ref;
}

/** [NOTA-REF] La referencia de una escritura, si tiene la forma de las del bot (las anteriores no la traen). */
function validRef(ref: unknown): string | undefined {
    return typeof ref === 'string' && NOTE_REF_RE.test(ref) ? ref : undefined;
}

function validTime(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * [NOTA-REF] La nota de una escritura con su referencia y sus marcas de envio incierto, sin los campos:
 * webhook.ts la separa de los campos (los que esperan su reserva, o la nota que sale despues) sin perderlas.
 */
export function notePart(write: PendingWhatsAppWrite | undefined): Pick<PendingWhatsAppWrite, 'note' | 'noteRef' | 'noteUnsure' | 'noteUnsureLast'> {
    if (write?.note === undefined) return {};
    return {
          note: write.note,
          ...(write.noteRef !== undefined ? { noteRef: write.noteRef } : {}),
          ...(write.noteUnsure !== undefined ? { noteUnsure: write.noteUnsure } : {}),
          ...(write.noteUnsureLast !== undefined ? { noteUnsureLast: write.noteUnsureLast } : {}),
    };
}

/**
 * [NOTA-REF] Desde cuando (ms) se puede buscar la nota de `write` antes de repetirla: NOTE_SETTLE_MS despues
 * del inicio de su ultimo envio incierto (sin el, de noteUnsure). undefined: no necesita busqueda (sin nota,
 * sin una referencia del bot o sin envio incierto).
 */
export function noteSearchAt(write: PendingWhatsAppWrite | undefined): number | undefined {
    const since = validTime(write?.noteUnsure);
    if (write?.note === undefined || !validRef(write.noteRef) || since === undefined) return undefined;
    return (validTime(write.noteUnsureLast) ?? since) + NOTE_SETTLE_MS;
}

/**
 * [NOTA-REF] Un envio fallido pudo dejar la nota en Pipedrive, segun lo que devuelve client.ts: el tiempo
 * limite ('Request timeout'), un error de red o un 'HTTP 5xx' pueden llegar despues de que Pipedrive la
 * guardo. Un 'HTTP 4xx' es un rechazo (no la guardo) y no necesita busqueda. Otro texto (un error de
 * Pipedrive en una respuesta 2xx) cuenta como incierto: lo peor es una busqueda de mas. Sin texto
 * (success: false en una respuesta 2xx), rechazo.
 */
function unsureFailure(error: unknown): boolean {
    if (typeof error !== 'string' || !error) return false;
    const status = /^HTTP (\d{3})\b/.exec(error);
    return status ? Number(status[1]) >= 500 : true;
}

// [NOTA-REF] Pipedrive v1 da las horas como 'YYYY-MM-DD HH:MM:SS' en UTC (como deals.ts). NaN si no se lee.
function pipedriveTime(value: unknown): number {
    if (typeof value !== 'string') return NaN;
    return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
}

interface PipedriveNote {
    content?: unknown;
    add_time?: unknown;
}

/**
 * [NOTA-REF] La busqueda la rechazo Pipedrive de forma definitiva: un 'HTTP 4xx' que no sea 408 (tiempo
 * limite) ni 429 (demasiadas llamadas) dice que la consulta o el permiso no sirven, y esperar no lo arregla.
 */
function searchRejected(error: unknown): boolean {
    const status = typeof error === 'string' ? /^HTTP (4\d\d)\b/.exec(error) : null;
    return Boolean(status) && status![1] !== '408' && status![1] !== '429';
}

/**
 * [NOTA-REF] Busca la nota con la referencia `ref` en las notas del negocio, de la mas nueva a la mas antigua
 * (GET /notes por add_time descendente), pagina por pagina. Solo cuenta la linea completa de la referencia
 * ("Ref. WhatsApp: wa-..."): una nota de ventas que cita solo el codigo no da la nota por entregada. 'absent'
 * cuando se revisaron todas las notas desde el primer envio incierto (`since`): la ultima pagina, o una que
 * ya llega a notas anteriores. Las paginas deben venir de la mas nueva a la mas antigua (si Pipedrive no
 * respetara el orden, la mas antigua no diria hasta donde llega). 'failed' (sin respuesta, una respuesta
 * rara, otro orden, o NOTE_SEARCH_MAX_PAGES paginas o NOTE_SEARCH_TIMEOUT_MS sin llegar a `since`): no se
 * repite el envio en este turno, para no duplicarla; queda pendiente. 'rejected': un rechazo definitivo de
 * la busqueda (searchRejected).
 */
async function findNoteByRef(dealId: number, ref: string, since: number): Promise<'found' | 'absent' | 'failed' | 'rejected'> {
    // Los espacios de la linea pueden volver como espacios o como &nbsp; en el HTML de Pipedrive.
    const mark = new RegExp('(?:^|[\\s>])Ref\\.(?:\\s|&nbsp;)+WhatsApp:(?:\\s|&nbsp;)*' + ref + '(?![0-9a-z])');
    const deadline = Date.now() + NOTE_SEARCH_TIMEOUT_MS;
    let newer = Infinity;
    try {
          for (let page = 0; page < NOTE_SEARCH_MAX_PAGES; page++) {
                  const left = deadline - Date.now();
                  if (left <= 0) return 'failed';
                  const res = await pipedriveGet<PipedriveNote[]>('/notes', {
                            deal_id: String(dealId), sort: 'add_time DESC', start: String(page * NOTE_SEARCH_LIMIT), limit: String(NOTE_SEARCH_LIMIT),
                  }, left);
                  if (!res.success) return searchRejected(res.error) ? 'rejected' : 'failed';
                  // Pipedrive responde data: null cuando el negocio no tiene notas (o no hay mas).
                  if (res.data === null || res.data === undefined) return 'absent';
                  if (!Array.isArray(res.data)) return 'failed';
                  if (res.data.some((n) => typeof n?.content === 'string' && mark.test(n.content))) return 'found';
                  const full = res.data.length >= NOTE_SEARCH_LIMIT || res.additional_data?.pagination?.more_items_in_collection === true;
                  if (!full) return 'absent';
                  const times = res.data.map((n) => pipedriveTime(n?.add_time));
                  // Una hora ilegible (NaN) tampoco pasa: toda comparacion con NaN es falsa.
                  if (!times.every((t, i) => t <= (i === 0 ? newer : times[i - 1]))) return 'failed';
                  newer = times[times.length - 1];
                  if (newer < since - NOTE_CLOCK_MARGIN_MS) return 'absent';
          }
          return 'failed';
    } catch {
          return 'failed';
    }
}

/**
 * [NOTA-REF] Manda la nota de `pending` sin repetirla. Con un envio anterior incierto (noteUnsure), primero
 * la busca por su referencia: si ya esta, se da por entregada; si la busqueda falla, o el ultimo envio
 * incierto es de hace menos de NOTE_SETTLE_MS (noteSearchAt), no se manda en este turno. Si Pipedrive
 * rechaza la busqueda de forma definitiva, esperar no sirve y la nota se perderia: se manda como antes de
 * este cambio (puede repetirse) y queda el error en el registro para revisarlo. Un envio incierto deja
 * anotados en `pending` el inicio del primero (noteUnsure) y el del ultimo (noteUnsureLast). Las pendientes
 * sin referencia (de antes de este cambio) se mandan como antes, sin busqueda: su texto ya se armo sin la
 * linea y un envio anterior no se puede reconocer. true: entregada.
 */
async function deliverNote(pending: PendingWhatsAppWrite): Promise<boolean> {
    const ref = validRef(pending.noteRef);
    const unsureSince = validTime(pending.noteUnsure);
    const searchAt = noteSearchAt(pending);
    if (ref && unsureSince !== undefined && searchAt !== undefined) {
          if (Date.now() < searchAt) {
                  console.warn(LOG_PREFIX + ' Nota pendiente en deal ' + pending.dealId + ': envio incierto reciente, se busca cuando se cumpla el plazo');
                  return false;
          }
          const found = await findNoteByRef(pending.dealId, ref, unsureSince);
          if (found === 'found') {
                  console.log(LOG_PREFIX + ' Nota ya estaba en deal ' + pending.dealId + ' (' + ref + '): no se repite');
                  return true;
          }
          if (found === 'failed') {
                  console.error(LOG_PREFIX + ' Nota pendiente en deal ' + pending.dealId + ': la busqueda de ' + ref + ' no se pudo confirmar, no se repite en este turno');
                  return false;
          }
          if (found === 'rejected') {
                  console.error(LOG_PREFIX + ' Pipedrive rechazo la busqueda de notas (revisar GET /notes): la nota de deal ' + pending.dealId + ' se manda sin buscarla y puede repetirse');
          }
    }
    const startedAt = Date.now();
    let unsure = false;
    try {
          const result = await pipedrivePost('/notes', {
                  content: pending.note, deal_id: pending.dealId,
                  ...(pending.personId ? { person_id: pending.personId } : {}),
          });
          if (result.success) {
                  console.log(LOG_PREFIX + ' Nota creada en deal ' + pending.dealId);
                  return true;
          }
          unsure = unsureFailure(result.error);
    } catch {
          // pipedrivePost solo lanza antes de mandar (sin token, client.ts): no hay nota que buscar.
    }
    if (ref && unsure) {
          pending.noteUnsure = Math.min(unsureSince ?? startedAt, startedAt);
          pending.noteUnsureLast = Math.max(validTime(pending.noteUnsureLast) ?? startedAt, startedAt);
    }
    console.error(LOG_PREFIX + ' Nota pendiente en deal ' + pending.dealId + (ref && unsure ? ' (resultado incierto: se busca antes de repetirla)' : ''));
    return false;
}

export async function retryWhatsAppWrite(write: PendingWhatsAppWrite): Promise<PendingWhatsAppWrite | undefined> {
    const pending = { ...write };
    if (pending.fields) {
          try {
                  await updateDeal(pending.dealId, pending.fields);
                  delete pending.fields;
          } catch {
                  console.error(LOG_PREFIX + ' Campos pendientes en deal ' + pending.dealId);
          }
    }
    if (pending.note && (await deliverNote(pending))) {
          delete pending.note;
          delete pending.noteRef;
          delete pending.noteUnsure;
          delete pending.noteUnsureLast;
    }
    return pending.fields || pending.note ? pending : undefined;
}

function waField(key: string): string | undefined {
    return process.env[key];
}

/** [CIERRE-HONESTO] Solo texto o numeros llegan a la nota y a los campos: nunca un objeto. */
function fmt(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * [CIERRE-HONESTO] Nombre de instalacion solo si tiene forma de nombre de persona: la regla que lo
 * saca del texto tambien toma "de Maipu" o "instalador electrico" (soy de..., soy instalador...).
 * Si no la tiene, queda el nombre del perfil de WhatsApp, como antes.
 */
function installName(c: CapturedFields | undefined): string | undefined {
    const value = fmt(c?.install_nombre);
    return looksLikePersonName(value) ? value : undefined;
}

/** [CIERRE-HONESTO] Contacto y proyecto del flujo de productos o, si no, del de instalacion (install_*). */
function resolveLead(c: CapturedFields) {
    return {
          nombre: fmt(c.nombre_o_empresa) ?? installName(c),
          correo: fmt(c.correo) ?? fmt(c.install_correo),
          proyecto: fmt(c.proyecto_o_uso) ?? fmt(c.install_tipo_proyecto),
          comuna: fmt(c.comuna_o_ciudad) ?? fmt(c.install_comuna),
          instalacion: Boolean(c.install_nombre || c.install_correo || c.install_comuna || c.install_tipo_proyecto),
    };
}

const RUT_TIPO_LABEL: Record<NonNullable<CapturedFields['rut_tipo']>, string> = {
    empresa: 'empresa',
    persona: 'persona',
    organismo_publico: 'organismo publico',
    comunidad: 'comunidad',
};

/** [RUT-VALIDO] El RUT con su tipo, o marcado si el digito verificador no calza. */
function rutLine(c: CapturedFields): string {
    const rut = oneLine(c.rut);
    if (!rut) return '-';
    if (c.rut_valido === false) return rut + ' (INVALIDO: no calza el digito verificador)';
    return c.rut_tipo ? rut + ' (' + RUT_TIPO_LABEL[c.rut_tipo] + ')' : rut;
}

/**
 * [NOTA] La nota de Pipedrive es HTML: todo el texto del cliente y del perfil (un "<b>" o un "&") se
 * escapa para que se vea tal cual y no cambie el formato.
 */
export function escapeNoteHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// [NOTA] Cada dato de la ficha hasta 300 letras y cada lista hasta 10 valores (los cambios ya se
// guardan hasta 10): un texto largo no llena la nota. El nombre del titulo, mas corto.
const FIELD_MAX = 300;
const LIST_MAX = 10;
const TITLE_NAME_MAX = 100;

// [NOTA] Se corta entre grafemas (una bandera o un emoji con ZWJ quedan enteros o no quedan) y sin
// pasar de `max` puntos de codigo: una letra con miles de tildes tampoco agranda la nota.
const GRAPHEMES = new Intl.Segmenter('es', { granularity: 'grapheme' });

function clipChars(text: string, max: number): string {
    if (text.length <= max) return text;
    let size = 0;
    for (const { segment, index } of GRAPHEMES.segment(text)) {
          size += Array.from(segment).length;
          if (size > max) return text.slice(0, index) + ' [...cortado]';
    }
    return text;
}

/** [NOTA] Un dato de la ficha (texto o numero) en una sola linea, sin acotar. */
function flatText(value: unknown): string | undefined {
    return fmt(value)?.replace(/[\s\u0085]+/g, ' ').trim() || undefined;
}

/**
 * [NOTA] Un dato de la ficha en una sola linea y acotado: un salto en el nombre
 * ("Empresa Prueba\nComuna/ciudad: Colina") ya no imita otra linea de la ficha.
 */
function oneLine(value: unknown, max = FIELD_MAX): string | undefined {
    const text = flatText(value);
    return text ? clipChars(text, max) : undefined;
}

// [NO-PISAR] Un cambio ("Cantidad: antes 2, ahora 3", flowEngine.ts) se acota por partes: un valor
// anterior largo ya no tapa el nuevo, que es lo que pidio cambiar el cliente.
const CHANGE_RE = /^([^:]{1,40}): antes (.*), ahora (.*)$/;
const CHANGE_BEFORE_MAX = 150;

function changeLine(value: unknown): string | undefined {
    const text = flatText(value);
    const parts = text?.match(CHANGE_RE);
    if (!parts) return text && clipChars(text, FIELD_MAX);
    return parts[1] + ': antes ' + clipChars(parts[2], CHANGE_BEFORE_MAX) + ', ahora ' + clipChars(parts[3], FIELD_MAX);
}

/** [NOTA] Una lista de la ficha: cada valor en una linea y acotado, los ultimos LIST_MAX. */
function listLines(value: unknown, line: (v: unknown) => string | undefined = (v) => oneLine(v)): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(line).filter((v): v is string => Boolean(v)).slice(-LIST_MAX);
}

/** [NOTA] El titulo del negocio es texto plano, en una linea: sin "<" ni ">" (el nombre del perfil lo escribe el cliente). */
function plainTitle(text: string): string {
    return oneLine(text.replace(/[<>]/g, ''), TITLE_NAME_MAX) ?? '';
}

/**
 * [NOTA] Tope de la nota ya escapada, en bytes: Pipedrive admite unos 100 KB por nota. Un "&" del
 * cliente ocupa 5 al escaparse, asi que el tope de la transcripcion (transcript.ts) no alcanza.
 */
export const NOTE_MAX_BYTES = 90_000;

function noteBytes(text: string): number {
    return Buffer.byteLength(escapeNoteHtml(text), 'utf8');
}

function cutLine(omitted: number): string {
    return '[... transcripci\u00f3n recortada por tama\u00f1o: ' + omitted + (omitted === 1 ? ' l\u00ednea omitida' : ' l\u00edneas omitidas') + ' ...]';
}

/**
 * [NOTA] Los mensajes de la transcripcion: cada linea que empieza uno ("[hora] Cliente: ...", un aviso)
 * con las siguientes, que van sangradas o vacias (transcript.ts).
 */
function transcriptMessages(lines: string[]): string[][] {
    const messages: string[][] = [];
    for (const line of lines) {
          if (messages.length && /^(?:\s|$)/.test(line)) messages[messages.length - 1].push(line);
          else messages.push([line]);
    }
    return messages;
}

/**
 * [NOTA] La transcripcion en `room` bytes, ya escapada. Si no cabe, se recorta por el medio, por
 * mensajes enteros: el inicio usa hasta la mitad y el final lo que queda, y una linea avisa cuantas
 * lineas faltan. Asi el aviso nunca deja lineas sueltas, sin la hora ni quien las escribio.
 */
function fitTranscript(text: string, room: number): string {
    if (noteBytes(text) <= room) return text;
    const lines = text.split('\n');
    const messages = transcriptMessages(lines);
    // Cada mensaje cuenta con su salto final; el aviso, con el numero mas largo posible.
    const sizes = messages.map((message) => noteBytes(message.join('\n')) + 1);
    let free = room - noteBytes(cutLine(lines.length));
    let half = free / 2;
    const head: string[][] = [];
    for (let i = 0; i < messages.length && sizes[i] <= half; i++) {
          head.push(messages[i]);
          half -= sizes[i];
          free -= sizes[i];
    }
    const tail: string[][] = [];
    for (let i = messages.length - 1; i >= head.length && sizes[i] <= free; i--) {
          tail.unshift(messages[i]);
          free -= sizes[i];
    }
    const keptLines = [...head, ...tail].reduce((n, message) => n + message.length, 0);
    return [...head.flat(), cutLine(lines.length - keptLines), ...tail.flat()].join('\n');
}

/** [TRANSCRIPCION] Sin transcripcion, el mensaje del cliente como uno de ella: acotado y con las lineas siguientes sangradas. */
function bodyLine(body: unknown): string {
    const text = clipChars((fmt(body) ?? '').replace(/\r\n?/g, '\n').trim(), TRANSCRIPT_MAX_TEXT);
    return '[' + chileTime(Date.now()) + '] Cliente: ' + text.split('\n').map((line, j) => (j && line ? '    ' + line : line)).join('\n');
}

const SUMMARY_MAX = 600;
/** [NOTA-REF] `ref`: la referencia de la nota (newNoteRef), que va en su ultima linea. */
export function buildNote(p: WhatsAppLeadParams, ref: string = newNoteRef()): string {
    const c = p.captured ?? {};
    const lead = resolveLead(c);
    const ambiguos = listLines(c.rut_ambiguos);
    const otras = listLines(c.comunas_otras);
    const cambios = listLines(c.cambios, changeLine);
    const varios = oneLine(c.cantidad_varios);
    const head = [
          '== Lead WhatsApp eLIGHTS ==',
          'Telefono: ' + (oneLine(p.phone) ?? '-'),
          'Nombre/empresa: ' + (oneLine(lead.nombre) ?? oneLine(p.name) ?? '-'),
          'RUT: ' + rutLine(c),
          ...(ambiguos.length ? ['varios RUT en el mensaje: revisar', ...ambiguos] : []),
          'Correo: ' + (oneLine(lead.correo) ?? '-'),
          '---',
          'Producto: ' + (oneLine(c.producto) ?? '-'),
          'Tipo de luz: ' + (oneLine(c.tipo_de_luz) ?? '-'),
          // [CANTIDAD] Con varias cantidades en un mensaje, el texto del cliente para revisar.
          'Cantidad: ' + (oneLine(c.cantidad) ?? (varios ? 'varios items, revisar: ' + varios : '-')),
          'Proyecto/uso: ' + (oneLine(lead.proyecto) ?? '-'),
          'Comuna/ciudad: ' + (oneLine(lead.comuna) ?? '-'),
          // [COMUNA] Otras comunas que el cliente dio como lugar (la de la factura, una segunda obra).
          ...(otras.length ? ['Otras comunas mencionadas: ' + otras.join(', ')] : []),
          // [NO-PISAR] Un dato ya capturado que el cliente cambio en un mensaje posterior.
          ...(cambios.length ? ['Cambios: ' + cambios.join('; ')] : []),
          '---',
          'Estado captura: ' + (p.captureStatus ?? 'incomplete'),
          'Pidio ejecutivo: ' + (p.wantsHuman ? 'Si' : 'No'),
          ...(lead.instalacion ? ['Solicitud de instalacion: Si'] : []),
          'Canal: WhatsApp',
          '',
          // [RESUMEN] Lo que redacto Claude, ya filtrado (summary.ts): no es un dato.
          '-- RESUMEN DEL BOT (interpretaci\u00f3n, no dato) --',
          oneLine(p.summary, SUMMARY_MAX) ?? '-',
          '',
          // [TRANSCRIPCION] Reemplaza la linea "Mensaje original": la conversacion completa, en hora de Chile.
          '-- TRANSCRIPCI\u00d3N --',
        ].join('\n') + '\n';
    // [NOTA] La transcripcion usa lo que la ficha deja libre bajo el tope. [NOTA-REF] La linea de la
    // referencia va al final y cuenta en el tope.
    const tail = noteRefLine(ref);
    return escapeNoteHtml(head + fitTranscript(fmt(p.transcript) ?? bodyLine(p.body), NOTE_MAX_BYTES - noteBytes(head) - noteBytes(tail)) + tail);
}

function buildWaCustomFields(
    captured: CapturedFields | undefined,
    captureStatus: CaptureStatus | undefined,
    wantsHuman: boolean | undefined,
    summary: string,
    body: string,
    resolvedLeadType: string,
  ): Record<string, string> {
    const waCustomFields: Record<string, string> = {};
    const lead = resolveLead(captured ?? {});

  const waFieldMap: Array<[string, string | undefined]> = [
        ['PIPEDRIVE_DEAL_FIELD_WA_PRODUCT', fmt(captured?.producto)],
        ['PIPEDRIVE_DEAL_FIELD_WA_LIGHT_TYPE', fmt(captured?.tipo_de_luz)],
        ['PIPEDRIVE_DEAL_FIELD_WA_QUANTITY', fmt(captured?.cantidad)],
        ['PIPEDRIVE_DEAL_FIELD_WA_PROJECT_USE', lead.proyecto],
        ['PIPEDRIVE_DEAL_FIELD_WA_LOCATION', lead.comuna],
        ['PIPEDRIVE_DEAL_FIELD_WA_WANTS_HUMAN', wantsHuman ? 'yes' : 'no'],
        ['PIPEDRIVE_DEAL_FIELD_WA_CAPTURE_STATUS', captureStatus ?? 'incomplete'],
        ['PIPEDRIVE_DEAL_FIELD_WA_LAST_MESSAGE', (fmt(body) ?? '').substring(0, 255)],
        ['PIPEDRIVE_DEAL_FIELD_WA_BOT_SUMMARY', (fmt(summary) ?? '').substring(0, 255)],
        ['PIPEDRIVE_DEAL_FIELD_WA_LEAD_TYPE', resolvedLeadType],
        ['PIPEDRIVE_DEAL_FIELD_WA_CONTACT_NAME', lead.nombre],
        ['PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', lead.correo],
      ];

  for (const [envKey, val] of waFieldMap) {
        const fieldKey = waField(envKey);
        if (fieldKey && val !== undefined && val !== null && val !== '') {
                waCustomFields[fieldKey] = val;
        }
  }

  return waCustomFields;
}

/**
 * [REGISTRO] La escritura de una correccion tardia (campos y nota del negocio que ya existe), sin mandarla:
 * lo mismo que ensureWhatsAppDeal manda con `existingDealId`. webhook.ts la deja en la cola cuando otro
 * mensaje del numero sigue escribiendo en ese negocio, para que Pipedrive reciba los valores en orden.
 */
export function buildWhatsAppUpdate(params: WhatsAppLeadParams & { existingDealId: number }): PendingWhatsAppWrite {
    const resolvedLeadType = params.leadType ?? detectLeadType(params.body, params.captured);
    const noteRef = newNoteRef();
    return {
          dealId: params.existingDealId,
          fields: buildWaCustomFields(params.captured, params.captureStatus, params.wantsHuman, params.summary, params.body, resolvedLeadType),
          note: buildNote(params, noteRef),
          noteRef,
    };
}

export async function ensureWhatsAppDeal(params: WhatsAppLeadParams): Promise<WhatsAppDealResult> {
    const { phone, name, summary, captured, captureStatus, wantsHuman } = params;

  const pipelineId = parseInt(process.env.PIPEDRIVE_PIPELINE_ID ?? '0', 10);
    const stageId = parseInt(process.env.PIPEDRIVE_STAGE_NEW_LEAD_ID ?? '0', 10);

  if (!params.existingDealId && (!pipelineId || !stageId)) {
        console.warn(LOG_PREFIX + ' PIPEDRIVE_PIPELINE_ID or PIPEDRIVE_STAGE_NEW_LEAD_ID not set \u2014 skipping');
        return { action: 'skipped' };
  }

  if (!params.existingDealId) await initFieldOptions();

  // [CIERRE-HONESTO] Lo que se arma aqui (campos y nota) va antes de crear la persona: un dato
  // raro ya no deja una persona sin negocio. El correo y el nombre de instalacion llegan a la persona.
  const quoteReference = 'WA-' + phone.replace(/\D/g, '');

  const resolvedLeadType = params.leadType ?? detectLeadType(params.body, captured);
    const resolvedPriority: 'Alta' | 'Normal' = wantsHuman ? 'Alta' : (params.priorityTier ?? 'Normal');

  const waCustomFields = buildWaCustomFields(captured, captureStatus, wantsHuman, summary, params.body, resolvedLeadType);
    // [NOTA-REF] La referencia se crea aqui, una vez, y viaja con la nota si queda pendiente.
    const noteRef = newNoteRef();
    const noteContent = buildNote(params, noteRef);

  // La correccion tardia usa el negocio guardado, sin buscar abiertos ni crear otro.
  if (params.existingDealId) {
        const pendingWrite = await retryWhatsAppWrite({ dealId: params.existingDealId, fields: waCustomFields, note: noteContent, noteRef });
        return { dealId: params.existingDealId, action: 'found', ...(pendingWrite ? { pendingWrite } : {}) };
  }

  const customer: QuoteCustomer = {
        name: installName(captured) ?? (name || phone),
        phone,
        email: resolveLead(captured ?? {}).correo,
        preferredChannel: 'WhatsApp'
  };

  const { personId, action: personAction } = await findOrCreatePerson(customer);
    console.log(LOG_PREFIX + ' Person ' + personId + ' (' + personAction + ')');

  const result = await createDeal({
        personId,
        pipelineId,
        stageId,
        title: 'WhatsApp Lead \u2014 ' + (plainTitle(name) || phone),
        quoteAmountClp: 0,
        sourceSystem: 'whatsapp',
        leadType: resolvedLeadType === 'Unknown' ? 'B2C' : resolvedLeadType,
        priorityTier: resolvedPriority,
        quoteReference,
        dedupOpenWithinDays: WA_DEDUP_WINDOW_DAYS,
        notes: fmt(summary),
        tipoServicio: TIPO_SERVICIO.WHATSAPP,
  });

  const dealId: number = result.dealId;
    const dealAction: 'created' | 'found' = result.status === 'created' ? 'created' : 'found';

  if (result.status !== 'created') {
        console.log(LOG_PREFIX + ' dedup_quote_reference_hit dealId=' + dealId);
  }

  const pendingWrite = await retryWhatsAppWrite({
        dealId, personId,
        ...(Object.keys(waCustomFields).length ? { fields: waCustomFields } : {}),
        note: noteContent, noteRef,
  });

  console.log(LOG_PREFIX + ' Deal ' + dealId + ' (' + dealAction + ') for ' + redact(phone, 'phone'));
    return { dealId, personId, action: dealAction, ...(pendingWrite ? { pendingWrite } : {}) };
}

function detectLeadType(body: string, captured?: CapturedFields): 'B2B' | 'B2C' | 'Unknown' {
    const B2B_RE = /empresa|constructora|obra|factura|licitaci[o\u00f3]n|proveedor|s\.a\.|spa|ltda|ingenier\u00eda|arquitectura|instalador/i;
    const text = body + ' ' + (fmt(captured?.nombre_o_empresa) ?? '');
    if (B2B_RE.test(text)) return 'B2B';
    // [RUT-VALIDO] Un RUT valido de empresa, organismo o comunidad (no de persona) es B2B.
    if (isBusinessRut({ valido: captured?.rut_valido === true, tipo: captured?.rut_tipo })) return 'B2B';
    if (body.length > 20) return 'B2C';
  return 'Unknown';
}
