// api/_lib/attachments/rules.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reglas de los archivos que el cliente adjunta en /cotizador (especificación
// «Adjuntar archivos», 22-10-2026): tipos, extensiones, límites, la forma de la ruta en
// Vercel Blob, el nombre que se guarda y la revisión de los primeros bytes.
//
// Sin dependencias ni process.env: el navegador también lo importa (el campo del
// formulario revisa lo mismo antes de subir). La carpeta _lib hace que Vercel no lo
// despliegue como función.
//
// Los nombres de archivo son datos del cliente: nunca van al log.
// ─────────────────────────────────────────────────────────────────────────────

/** Hasta 5 archivos por solicitud. */
export const MAX_FILES = 5;
/** 20 MB por archivo. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** 100 MB en total por solicitud (5 × 20 MB). */
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** Largo máximo del nombre que se guarda (con la extensión). */
export const MAX_NAME_LENGTH = 120;
/** Carpeta del almacén Blob: el barrido diario solo mira aquí. */
export const UPLOAD_PREFIX = 'cotizador/';

/**
 * Tipo exacto de cada extensión. El navegador no reconoce DWG ni DXF, así que el tipo
 * se fija según la extensión (y el permiso de subida solo acepta ese tipo).
 */
export const ATTACHMENT_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export type AttachmentExt = keyof typeof ATTACHMENT_TYPES;

export const ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_TYPES) as AttachmentExt[];

/** Nombre de la extensión para el cliente y para la nota: «PDF», «DWG»… */
export const extLabel = (ext: AttachmentExt): string => ext.toUpperCase();

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXT_GROUP = '(' + ATTACHMENT_EXTENSIONS.join('|') + ')';

/**
 * Ruta que pide el navegador al permiso de subida: `cotizador/<uuid>.<ext>`, con la
 * extensión ya normalizada (minúsculas, «jpeg» pasa a «jpg»).
 */
export const UPLOAD_PATHNAME_RE = new RegExp('^cotizador/' + UUID + '\\.' + EXT_GROUP + '$');

/**
 * Ruta guardada en Blob: la del permiso más el sufijo al azar que agrega Blob
 * (`addRandomSuffix`). Es la que el navegador manda a create.ts.
 */
export const STORED_PATHNAME_RE = new RegExp('^cotizador/' + UUID + '(?:-[A-Za-z0-9]{1,64})?\\.' + EXT_GROUP + '$');

/** Extensión normalizada de un nombre de archivo, o null si no es de los permitidos. */
export function attachmentExt(fileName: string): AttachmentExt | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(fileName ?? '').trim());
  if (!match) return null;
  const ext = match[1].toLowerCase();
  const normalized = ext === 'jpeg' ? 'jpg' : ext;
  return (ATTACHMENT_EXTENSIONS as string[]).includes(normalized) ? (normalized as AttachmentExt) : null;
}

/** Extensión de una ruta de Blob válida (permiso o guardada); null si la ruta no lo es. */
export function pathnameExt(pathname: string): AttachmentExt | null {
  const match = STORED_PATHNAME_RE.exec(String(pathname ?? ''));
  return match ? (match[1] as AttachmentExt) : null;
}

/** Revisión al elegir un archivo (navegador): formato, peso y archivo vacío. */
export type FileCheck = { ok: true; ext: AttachmentExt } | { ok: false; reason: 'format' | 'size' | 'empty' };

export function checkSelectedFile(file: { name: string; size: number }): FileCheck {
  const ext = attachmentExt(file.name);
  if (!ext) return { ok: false, reason: 'format' };
  if (!(file.size > 0)) return { ok: false, reason: 'empty' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, ext };
}

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f<>:"|?*\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Nombre que se guarda en la nota y en Pipedrive: sin rutas (solo lo que va después de la
 * última / o \), sin caracteres de control ni los que Windows no acepta, en una línea, con
 * máximo 120 caracteres y conservando la extensión. Si el nombre no termina en la extensión
 * real del archivo (la de su ruta en Blob), se le agrega. Vacío: «archivo.<ext>».
 */
export function sanitizeFileName(name: unknown, ext: AttachmentExt): string {
  const raw = typeof name === 'string' ? name : '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  let clean = base.replace(/\s+/g, ' ').replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (attachmentExt(clean) !== ext) clean = (clean ? clean + '.' : 'archivo.') + ext;
  if (clean === '.' + ext || clean === '') clean = 'archivo.' + ext;
  if (clean.length <= MAX_NAME_LENGTH) return clean;
  const dot = clean.lastIndexOf('.');
  const suffix = clean.slice(dot);
  return clean.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd() + suffix;
}

// ── Primeros bytes ────────────────────────────────────────────────────────────

/** Cuántos bytes del comienzo necesita sniffType (la cabecera ASCII de un DXF). */
export const SNIFF_BYTES = 512;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const PDF = ascii('%PDF-');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const DWG = ascii('AC10');
const DXF_BINARY = ascii('AutoCAD Binary DXF\r\n\x1a\x00');
/**
 * DXF de texto: comentarios 999 opcionales y después el grupo 0 con SECTION. sniffType arma
 * el texto byte a byte (latin-1), así que la marca BOM de UTF-8 (EF BB BF) llega como esos
 * tres caracteres, no como U+FEFF.
 */
const DXF_ASCII = /^(?:\xef\xbb\xbf)?\s*(?:999\r?\n[^\r\n]*\r?\n\s*)*0\r?\nSECTION\r?\n/;

/**
 * Tipo según los primeros bytes: %PDF-, PNG, JPEG, ZIP (XLSX), AC10 (DWG) o un DXF de texto
 * o binario. null si no es ninguno. No detecta malware: el servidor nunca abre los archivos.
 */
export function sniffType(bytes: Uint8Array): AttachmentExt | null {
  if (startsWith(bytes, PDF)) return 'pdf';
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, JPEG)) return 'jpg';
  if (startsWith(bytes, ZIP)) return 'xlsx';
  if (startsWith(bytes, DWG)) return 'dwg';
  if (startsWith(bytes, DXF_BINARY)) return 'dxf';
  let head = '';
  const n = Math.min(bytes.length, SNIFF_BYTES);
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
  if (DXF_ASCII.test(head)) return 'dxf';
  return null;
}

/** true si los primeros bytes corresponden a la extensión. */
export const matchesExtension = (bytes: Uint8Array, ext: AttachmentExt): boolean => sniffType(bytes) === ext;

// ── Referencias que llegan a create.ts ────────────────────────────────────────

export interface AttachmentRef {
  /** Ruta en Blob (STORED_PATHNAME_RE). */
  pathname: string;
  /** Nombre limpio (sanitizeFileName). */
  nombre: string;
  ext: AttachmentExt;
}

/**
 * Lee `archivos: [{ pathname, nombre }]` del cuerpo. Una referencia mal formada, repetida o
 * sobrante (más de 5) se descarta y se cuenta en `discarded`: nunca da 400.
 */
export function parseAttachmentRefs(body: unknown): { refs: AttachmentRef[]; discarded: number } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).archivos : undefined;
  if (raw === undefined || raw === null) return { refs: [], discarded: 0 };
  if (!Array.isArray(raw)) return { refs: [], discarded: 1 };
  const refs: AttachmentRef[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const item of raw.slice(0, 100)) {
    const pathname = item && typeof item === 'object' ? (item as Record<string, unknown>).pathname : undefined;
    const nombre = item && typeof item === 'object' ? (item as Record<string, unknown>).nombre : undefined;
    const ext = typeof pathname === 'string' ? pathnameExt(pathname) : null;
    if (!ext || typeof nombre !== 'string' || seen.has(pathname as string) || refs.length >= MAX_FILES) {
      discarded++;
      continue;
    }
    seen.add(pathname as string);
    refs.push({ pathname: pathname as string, nombre: sanitizeFileName(nombre, ext), ext });
  }
  discarded += Math.max(0, raw.length - 100);
  return { refs, discarded };
}

/** Peso legible en español de Chile: «85 KB», «2,1 MB», «34 MB». */
export function formatBytes(bytes: number): string {
  if (!(bytes >= 0)) return '';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return String(Math.round(mb * 10) / 10).replace('.', ',') + ' MB';
}
