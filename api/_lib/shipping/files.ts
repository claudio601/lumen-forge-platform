// api/_lib/shipping/files.ts
// Archivos del aviso de despacho (spec Nivel 2, §4.3): la regla PURA para elegir, de la lista de
// archivos del negocio (GET /v1/deals/{id}/files), el PDF del documento (factura o guía de
// despacho) y la foto del comprobante del operador, y la revisión de sus bytes ya descargados. La
// descarga (con tope) es de la PR 2.
//
// Cuentan solo los archivos:
// - activos, subidos a Pipedrive (no enlazados desde Google Drive u otro servicio), que no son
//   adjuntos de un correo (`mail_message_id`: si el aviso vuelve al negocio por la sincronización
//   de correo o un Bcc, su factura y su comprobante vuelven a Archivos) ni están incrustados;
// - agregados en los últimos 7 días (los adjuntos del cliente de /cotizador también quedan en
//   Archivos) y DESPUÉS del último aviso. «Aviso enviado» guarda la hora sin segundos: cuenta solo
//   lo agregado desde el minuto siguiente, así el documento del aviso anterior nunca vuelve a contar;
// - con un nombre que no es de los que pone el aviso (Factura-<N>.pdf, Guia-de-despacho-<N>.pdf,
//   Comprobante-…).
// Documento (opcional desde el 19-11-2026: la factura se le envía al cliente antes del despacho,
// regla del dueño): se adjunta solo el PDF que lleva el número en el nombre como número entero (la
// factura 12 no calza con «cotizacion-2026-11-12.pdf»: los dígitos unidos por - . o / son un solo
// número). Un PDF sin el número no se adjunta: podría ser un adjunto del cliente de /cotizador.
// Con 2 o más con el número, el aviso no sale (no se adivina).
// Comprobante (obligatorio desde el 19-11-2026): un JPG o PNG; gana el que lleva «voucher» o
// «comprobante» en el nombre; si ninguno lo lleva y hay uno solo, ese. Sin foto, o con 2 o más sin
// un ganador, el aviso no sale. HEIC y otros formatos de foto detienen el aviso: el dueño la sube
// como JPG o PNG.
// Topes por `file_size`, antes de descargar: 3 MB el PDF, 5 MB la foto y 8 MB en total. El tipo
// se confirma con los primeros bytes (sniffType).
// Los nombres de archivo son del dueño o del cliente: van a la nota (escapados), nunca al log.

import { sniffType } from '../attachments/rules.js';
import { carrierFileLabel, type Carrier } from './carriers.js';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_IDS, documentFileName, documentPhrase, type ShippingDocument } from './documents.js';
import type { ShippingProblem } from './fields.js';

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_VOUCHER_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const FILE_WINDOW_DAYS = 7;

/** Lo que trae cada archivo de GET /v1/deals/{id}/files (lo que usa la regla). */
export interface DealFileMeta {
  id?: unknown;
  /** El nombre visible, con su extensión («factura-8430.pdf»): el que ve el dueño en Pipedrive. */
  name?: unknown;
  /**
   * (prueba real, 19-11) En la API real es la clave del archivo en el almacenamiento (30 letras y dígitos, sin
   * extensión), no el nombre: solo se usa si falta `name`.
   */
  file_name?: unknown;
  /** 'aaaa-mm-dd hh:mm:ss' en UTC. */
  add_time?: unknown;
  file_size?: unknown;
  active_flag?: unknown;
  inline_flag?: unknown;
  remote_location?: unknown;
  mail_message_id?: unknown;
}

export type ShippingFileRole = 'document' | 'voucher';

export interface SelectedFile {
  id: number;
  role: ShippingFileRole;
  /** Nombre en Pipedrive (para la nota; nunca al log). */
  fileName: string;
  size: number;
  /** Tope de la descarga. */
  maxBytes: number;
}

export type FileSelection =
  | { ok: true; document: SelectedFile | null; voucher: SelectedFile }
  | { ok: false; problems: ShippingProblem[] };

const DOCUMENT_EXT = /\.pdf$/i;
const PHOTO_EXT = /\.(?:jpe?g|png)$/i;
const UNSUPPORTED_PHOTO_EXT = /\.(?:heic|heif|webp|gif|bmp|tiff?)$/i;
const VOUCHER_WORD = /voucher|comprobante/i;
/** Nombres que pone el aviso a lo que envía (salen de DOCUMENT_TYPES y de voucherFileName). */
const NOTICE_DOCUMENT_NAME = new RegExp(`^(?:${DOCUMENT_TYPE_IDS.map((t) => DOCUMENT_TYPES[t].filePrefix).join('|')})-\\d+\\.pdf$`);
const NOTICE_VOUCHER_NAME = /^Comprobante-[A-Za-z0-9-]+\.(?:jpg|png)$/;

const problem = (message: string): ShippingProblem => ({ field: null, code: 'invalid', message });
const mb = (bytes: number) => `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10).replace('.', ',')} MB`;
/** Bytes exactos con punto de miles («3.145.729 bytes»): el MB redondeado engaña justo en el tope. */
const exactBytes = (bytes: number) => `${String(bytes).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} bytes`;
const list = (files: readonly { fileName: string }[]) => files.map((f) => `«${f.fileName}»`).join(', ');
/**
 * (prueba real, 19-11) Con Google Drive conectado en Pipedrive (Herramientas y aplicaciones → Documentos), lo que se
 * sube a un negocio queda en ese Drive (`remote_location` «googledocs»), y la API de Pipedrive no lo entrega sin una
 * sesión de Google: el aviso no lo puede adjuntar. Se dice, en vez de «falta el PDF».
 */
const driveProblem = (files: readonly { fileName: string }[]) =>
  problem(
    `${files.length === 1 ? 'El archivo' : 'Los archivos'} ${list(files)} ${files.length === 1 ? 'quedó guardado' : 'quedaron guardados'} en Google Drive y el aviso no ${files.length === 1 ? 'lo' : 'los'} puede descargar: ` +
      'súbelo de nuevo al negocio con Google Drive desconectado en Pipedrive (Herramientas y aplicaciones → Documentos), o avísale a Claude.',
  );

/** 'aaaa-mm-dd hh:mm:ss' (UTC, Pipedrive) → ms, o null. */
function pipedriveTime(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isFinite(t) ? t : null;
}

const isTrue = (v: unknown) => v === true || v === 1 || v === '1';
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || v === 0 || v === false;

/**
 * El número del documento está en el nombre como número entero. Los dígitos unidos por - . o /
 * cuentan como un solo número («2026-11-12»); «8.430» (punto de miles) es 8430; «F8430»,
 * «DTE_33_8430» y «factura 08430» calzan con 8430.
 */
export function nameHasNumber(fileName: string, number: string): boolean {
  const wanted = Number(number);
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, '');
  return (base.match(/\d+(?:[-./]\d+)*/g) ?? []).some((token) => {
    if (/^\d+$/.test(token)) return Number(token) === wanted;
    return /^\d{1,3}(?:\.\d{3})+$/.test(token) && Number(token.replace(/\./g, '')) === wanted;
  });
}

interface Candidate {
  id: number;
  fileName: string;
  size: number | null;
}

/**
 * Elige el documento y el comprobante. `lastNoticeAt`: la hora de «Despacho · Aviso enviado»
 * (minuto exacto, en UTC), o null si nunca hubo aviso.
 */
export function selectShippingFiles(
  files: readonly DealFileMeta[],
  { document, lastNoticeAt, now }: { document: ShippingDocument; lastNoticeAt: Date | null; now: Date },
): FileSelection {
  const since = Math.max(now.getTime() - FILE_WINDOW_DAYS * 86_400_000, lastNoticeAt ? lastNoticeAt.getTime() + 60_000 : -Infinity);
  const eligible: Candidate[] = [];
  /** Los que contarían pero quedaron fuera de Pipedrive (Google Drive): solo para decir por qué no se usan. */
  const remote: { fileName: string }[] = [];
  for (const f of files) {
    const id = typeof f.id === 'number' && Number.isInteger(f.id) && f.id > 0 ? f.id : null;
    const fileName = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : typeof f.file_name === 'string' ? f.file_name.trim() : '';
    const addedAt = pipedriveTime(f.add_time);
    if (!id || !fileName || addedAt === null) continue;
    if (!isTrue(f.active_flag) || isTrue(f.inline_flag) || !isEmpty(f.mail_message_id)) continue;
    if (addedAt < since) continue;
    if (NOTICE_DOCUMENT_NAME.test(fileName) || NOTICE_VOUCHER_NAME.test(fileName)) continue;
    if (!isEmpty(f.remote_location) && f.remote_location !== 's3') {
      remote.push({ fileName });
      continue;
    }
    const size = typeof f.file_size === 'number' && Number.isFinite(f.file_size) && f.file_size >= 0 ? f.file_size : null;
    eligible.push({ id, fileName, size });
  }

  const problems: ShippingProblem[] = [];
  const phrase = documentPhrase(document);
  const scope = lastNoticeAt ? 'agregada después del último aviso' : `agregada en los últimos ${FILE_WINDOW_DAYS} días`;

  // Documento (opcional): solo el PDF con el número en el nombre.
  const named = eligible.filter((f) => DOCUMENT_EXT.test(f.fileName) && nameHasNumber(f.fileName, document.number));
  let doc: Candidate | null = null;
  if (named.length === 1) doc = named[0];
  else if (named.length > 1) problems.push(problem(`Hay ${named.length} PDF con el N° ${document.number} en el nombre (${list(named)}): deja solo el de ${phrase}.`));
  else {
    // El dueño quiso adjuntarlo, pero quedó en Google Drive: se dice, en vez de enviar sin él.
    const remoteNamed = remote.filter((f) => DOCUMENT_EXT.test(f.fileName) && nameHasNumber(f.fileName, document.number));
    if (remoteNamed.length) problems.push(driveProblem(remoteNamed));
  }

  // Comprobante
  const unsupported = eligible.filter((f) => UNSUPPORTED_PHOTO_EXT.test(f.fileName));
  if (unsupported.length) problems.push(problem(`La foto ${list(unsupported)} no es JPG ni PNG: súbela como JPG o PNG (o bórrala si no es el comprobante).`));
  const photos = eligible.filter((f) => PHOTO_EXT.test(f.fileName));
  const marked = photos.filter((f) => VOUCHER_WORD.test(f.fileName));
  let voucher: Candidate | null = null;
  if (marked.length === 1) voucher = marked[0];
  else if (marked.length > 1) problems.push(problem(`Hay ${marked.length} fotos de comprobante (${list(marked)}): deja una.`));
  else if (photos.length === 1) voucher = photos[0];
  else if (photos.length > 1) problems.push(problem(`Hay ${photos.length} fotos (${list(photos)}) y ninguna dice «comprobante» o «voucher» en el nombre: deja solo la del comprobante.`));
  else {
    // Sin foto en Pipedrive, una que quedó en Google Drive no se descarta callada: el cliente recibiría el aviso sin
    // el comprobante que el dueño sí subió.
    const remotePhotos = remote.filter((f) => PHOTO_EXT.test(f.fileName));
    if (remotePhotos.length) problems.push(driveProblem(remotePhotos));
    else if (!unsupported.length) {
      problems.push(problem(`Falta la foto del comprobante del operador: súbela en JPG o PNG a Archivos del negocio (cuenta solo una ${scope}; no cuentan los adjuntos de correos).`));
    }
  }

  // Topes, antes de descargar
  const capped = (c: Candidate | null, max: number, what: string) => {
    if (!c) return;
    if (c.size === null) problems.push(problem(`No se pudo leer el tamaño de ${what} «${c.fileName}».`));
    else if (c.size > max) problems.push(problem(`${what.charAt(0).toUpperCase()}${what.slice(1)} «${c.fileName}» supera el máximo de ${mb(max)} (pesa ${exactBytes(c.size)}).`));
  };
  const before = problems.length;
  capped(doc, MAX_DOCUMENT_BYTES, 'el PDF');
  capped(voucher, MAX_VOUCHER_BYTES, 'la foto del comprobante');
  // Hoy 3 + 5 = 8 MB: el total solo se pasa si cambian los topes de cada uno.
  const total = (doc?.size ?? 0) + (voucher?.size ?? 0);
  if (problems.length === before && total > MAX_TOTAL_BYTES) {
    problems.push(problem(`El PDF y la foto juntos superan el máximo de ${mb(MAX_TOTAL_BYTES)} (suman ${exactBytes(total)}).`));
  }

  if (problems.length || !voucher) return { ok: false, problems };
  const selected = (c: Candidate, role: ShippingFileRole, maxBytes: number): SelectedFile => ({ id: c.id, role, fileName: c.fileName, size: c.size!, maxBytes });
  return {
    ok: true,
    document: doc ? selected(doc, 'document', MAX_DOCUMENT_BYTES) : null,
    voucher: selected(voucher, 'voucher', MAX_VOUCHER_BYTES),
  };
}

// ── Bytes descargados ───────────────────────────────────────────────────────

const CONTENT_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' } as const;

export interface ReadyAttachment {
  /** Nombre limpio con que lo recibe el cliente. */
  fileName: string;
  contentType: (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];
  bytes: Uint8Array;
}

/** «Comprobante-Pullman-Cargo-23501234567.jpg»; sin orden de flete, «Comprobante-Transportes-TVP.jpg». */
export function voucherFileName(carrier: Pick<Carrier, 'label'>, orderNormalized: string, ext: 'jpg' | 'png'): string {
  return `Comprobante-${carrierFileLabel(carrier)}${orderNormalized ? `-${orderNormalized}` : ''}.${ext}`;
}

/**
 * Revisa los bytes descargados: tamaño dentro del tope y tipo por los primeros bytes (el PDF tiene
 * que ser PDF; el comprobante, JPG o PNG: un PDF con extensión .jpg no pasa). Devuelve el adjunto
 * con su nombre limpio.
 */
export function checkDownloadedFile(
  file: SelectedFile,
  bytes: Uint8Array,
  { document, carrier, orderNormalized }: { document: ShippingDocument; carrier: Pick<Carrier, 'label'>; orderNormalized: string },
): { ok: true; attachment: ReadyAttachment } | { ok: false; problem: ShippingProblem } {
  const what = file.role === 'document' ? `El PDF «${file.fileName}»` : `La foto del comprobante «${file.fileName}»`;
  if (bytes.length === 0) return { ok: false, problem: problem(`${what} está vacío.`) };
  if (bytes.length > file.maxBytes) return { ok: false, problem: problem(`${what} pesa más de ${mb(file.maxBytes)}.`) };
  const type = sniffType(bytes);
  if (file.role === 'document') {
    if (type !== 'pdf') return { ok: false, problem: problem(`${what} no es un PDF: adjunta ${documentPhrase(document)} en PDF.`) };
    return { ok: true, attachment: { fileName: documentFileName(document), contentType: CONTENT_TYPES.pdf, bytes } };
  }
  if (type !== 'jpg' && type !== 'png') return { ok: false, problem: problem(`${what} no es JPG ni PNG.`) };
  return { ok: true, attachment: { fileName: voucherFileName(carrier, orderNormalized, type), contentType: CONTENT_TYPES[type], bytes } };
}
