// src/components/forms/attachments.ts
// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos del cotizador (/cotizador) en el navegador (especificación «Adjuntar archivos»,
// 22-10-2026): los textos del campo (§1, los usa FileAttachments.tsx) y la subida directo a
// Vercel Blob (§2.2 y decisión D1 del dueño: se suben AL ENVIAR, después de validateForm y
// de la casilla de privacidad, y nunca si el campo trampa tiene texto; eso lo decide
// SmartQuotePage).
//
// La subida:
//   1. Consulta previa ('elights.upload-status' en /api/project-quotes/upload): ¿caben hoy?
//      El SDK del navegador descarta la respuesta de error del permiso, así que sin esta
//      consulta el formulario no podría mostrar el mensaje del tope diario (D2).
//   2. De a un archivo, con uploadPresigned de @vercel/blob/client, que se carga recién aquí
//      (import dinámico) para no engordar la página: ruta `cotizador/<uuid>.<ext>`, el tipo
//      fijado según la extensión (los navegadores no reconocen DWG ni DXF) y el peso
//      declarado en clientPayload ({"size": n}), que es el máximo que permite el permiso.
//   3. Cada archivo subido guarda su ruta en Blob: si después falla otro archivo, o el
//      servidor responde 400 o 502, el reintento no lo vuelve a subir (el servidor recibe las
//      mismas referencias).
//
// Nunca va a la consola el nombre de un archivo.
// ─────────────────────────────────────────────────────────────────────────────

import { contactEmail } from '@/config/business';
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_TYPES,
  MAX_FILES,
  MAX_FILE_BYTES,
  type AttachmentExt,
} from '../../../api/_lib/attachments/rules';

// ── Textos del campo ──────────────────────────────────────────────────────────

const MB = 1024 * 1024;

/** Extensiones para el selector de archivos (jpeg también, como en el servidor). */
export const ACCEPT = [...ATTACHMENT_EXTENSIONS, 'jpeg'].map((ext) => '.' + ext).join(',');

/** «PDF, JPG, PNG, DWG, DXF o XLSX». */
const FORMATS = (() => {
  const labels = ATTACHMENT_EXTENSIONS.map((ext) => ext.toUpperCase());
  return labels.slice(0, -1).join(', ') + ' o ' + labels[labels.length - 1];
})();

/** Peso de un archivo que pasa el máximo, redondeado hacia arriba: nunca «pesa 20 MB y el máximo es 20 MB». */
const overSize = (bytes: number) => String(Math.ceil((bytes / MB) * 10) / 10).replace('.', ',') + ' MB';

/** Textos del campo (especificación §1). */
export const ATTACHMENT_TEXTS = {
  title: 'Adjuntar archivos (opcional)',
  help: `Bases de licitación, fichas técnicas, planos o planillas. ${FORMATS}; hasta ${MAX_FILES} archivos de ${MAX_FILE_BYTES / MB} MB cada uno.`,
  choose: 'Elegir archivos',
  remove: 'Quitar',
  format: (name: string) => `"${name}" no se puede adjuntar. Usa ${FORMATS}.`,
  size: (name: string, bytes: number) =>
    `"${name}" pesa ${overSize(bytes)} y el máximo es ${MAX_FILE_BYTES / MB} MB. Mándalo a ${contactEmail} cuando tengas tu número de solicitud.`,
  tooMany: `Puedes adjuntar hasta ${MAX_FILES} archivos. Los demás, mándalos a ${contactEmail} cuando tengas tu número de solicitud.`,
  empty: (name: string) => `"${name}" está vacío.`,
  uploadFailed: (name: string) => `No pudimos subir "${name}". Reintenta o envía la solicitud sin ese archivo.`,
  retry: 'Reintentar',
  skipFile: 'Enviar sin ese archivo',
  dailyLimit: `Hoy no podemos recibir más archivos por el sitio. Envía tu solicitud y mándanos los archivos a ${contactEmail} con tu número de solicitud.`,
  sendWithout: 'Enviar sin archivos',
} as const;

/** Lo que pasó al subir: un archivo que falló (con su id) o el tope del día. */
export type UploadProblem = { kind: 'failed'; id: string } | { kind: 'limit' };

// ── Subida ────────────────────────────────────────────────────────────────────

/** Permiso de subida y consulta previa (api/project-quotes/upload.ts). */
export const UPLOAD_URL = '/api/project-quotes/upload';
/** Tipo de la consulta previa: el mismo STATUS_EVENT del servidor (la prueba lo compara). */
export const STATUS_EVENT = 'elights.upload-status';

/** Un archivo elegido en el formulario. */
export interface AttachmentItem {
  /** Id local (para la lista y los mensajes). */
  id: string;
  file: File;
  ext: AttachmentExt;
  /** Ruta guardada en Blob (con el sufijo al azar), cuando ya se subió. */
  pathname?: string;
}

/**
 * Resultado de subir lo pendiente. `items` trae las rutas de lo que sí se subió (también
 * cuando falla uno, para no volver a subirlo al reintentar).
 * - 'limit': tope diario del sitio o subida no disponible (sin almacén, Redis caído).
 * - 'failed': no se pudo subir `id`; los siguientes ni se intentaron.
 */
export type UploadResult =
  | { ok: true; items: AttachmentItem[] }
  | { ok: false; reason: 'limit'; items: AttachmentItem[] }
  | { ok: false; reason: 'failed'; id: string; items: AttachmentItem[] };

/** Id al azar (UUID v4). crypto.randomUUID existe en HTTPS y localhost; si no, getRandomValues. */
export function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Ruta que se pide al permiso: `cotizador/<uuid>.<ext>` (UPLOAD_PATHNAME_RE del servidor). */
export const uploadPathname = (ext: AttachmentExt): string => `cotizador/${randomId()}.${ext}`;

type Availability = 'ok' | 'limit' | 'unknown';

/**
 * Consulta previa: 'limit' si el servidor dice que hoy no hay subida (tope diario, techo de
 * Blob o servicio no disponible). Si la consulta misma falla (red, 429, 5xx), 'unknown': se
 * intenta subir igual y, si no se puede, el formulario muestra la falla de ese archivo.
 */
async function checkAvailability(files: number, bytes: number): Promise<Availability> {
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: STATUS_EVENT, payload: { files, bytes } }),
    });
    if (!res.ok) return 'unknown';
    const data = JSON.parse(await res.text()) as { available?: unknown };
    if (data?.available === true) return 'ok';
    if (data?.available === false) return 'limit';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Nombre del error sin su mensaje (el mensaje podría traer la ruta). */
const errorName = (err: unknown) => (err instanceof Error ? err.name : typeof err);

/**
 * Sube, de a uno, los archivos que todavía no tienen ruta en Blob. `onProgress` recibe el
 * avance total de esta subida, de 0 a 100.
 */
export async function uploadPending(items: AttachmentItem[], onProgress: (percent: number) => void): Promise<UploadResult> {
  const next = items.map((item) => ({ ...item }));
  const pending = next.filter((item) => !item.pathname);
  if (!pending.length) return { ok: true, items: next };

  const total = pending.reduce((sum, item) => sum + item.file.size, 0);
  if ((await checkAvailability(pending.length, total)) === 'limit') return { ok: false, reason: 'limit', items: next };

  onProgress(0);
  let uploadPresigned: (typeof import('@vercel/blob/client'))['uploadPresigned'];
  try {
    ({ uploadPresigned } = await import('@vercel/blob/client'));
  } catch (err) {
    console.error('[Adjuntos] No se pudo cargar la subida', errorName(err));
    return { ok: false, reason: 'failed', id: pending[0].id, items: next };
  }

  let done = 0;
  const report = (loaded: number) => onProgress(Math.min(100, Math.floor(((done + loaded) / total) * 100)));
  for (const item of pending) {
    try {
      const blob = await uploadPresigned(uploadPathname(item.ext), item.file, {
        access: 'private',
        handleUploadUrl: UPLOAD_URL,
        clientPayload: JSON.stringify({ size: item.file.size }),
        contentType: ATTACHMENT_TYPES[item.ext],
        onUploadProgress: ({ loaded }) => report(Math.min(loaded, item.file.size)),
      });
      item.pathname = blob.pathname;
    } catch (err) {
      console.error('[Adjuntos] Falló la subida de un archivo', errorName(err));
      return { ok: false, reason: 'failed', id: item.id, items: next };
    }
    done += item.file.size;
    report(0);
  }
  return { ok: true, items: next };
}
