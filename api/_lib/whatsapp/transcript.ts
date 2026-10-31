// api/_lib/whatsapp/transcript.ts
// [TRANSCRIPCION] La conversacion completa para la nota de Pipedrive (B1): cada mensaje del cliente y
// cada respuesta del bot, con la hora de Chile, incluidas las fotos y los mensajes vacios. Antes la
// nota guardaba solo el ultimo mensaje (casi siempre el del correo). Cada nota borra solo lo que
// incluyo (hasta su numero de orden), asi que un segundo pedido no arrastra la conversacion anterior y
// lo que llego mientras Pipedrive guardaba la nota (una foto, otro pedido) queda para la siguiente.
// Vive con el estado del bot en Upstash (stateStore.ts), con el mismo plazo de 7 dias.

export type TranscriptRole = 'cliente' | 'bot';

export interface TranscriptEntry {
  /** Numero de orden: crece con cada mensaje y nunca se repite en la instancia. */
  seq: number;
  at: number;
  role: TranscriptRole;
  text: string;
}

export interface Transcript {
  entries: TranscriptEntry[];
  /** Mensajes del medio que no se guardaron por el tope. */
  omitted: number;
  /** La conversacion ya iba avanzada cuando empezo esta transcripcion: puede faltar el inicio. */
  partialStart: boolean;
  /** Empieza despues de la nota anterior del mismo negocio. */
  sinceNote: boolean;
}

// Tope: los primeros 20 mensajes y los ultimos 40, cada uno hasta 1.000 letras (un mensaje de
// WhatsApp trae hasta 1.600). Lo del medio se cuenta y la nota lo avisa.
export const TRANSCRIPT_HEAD = 20;
export const TRANSCRIPT_TAIL = 40;
export const TRANSCRIPT_MAX_TEXT = 1000;

/** La respuesta llevo el aviso de privacidad: la nota lo marca, sin copiar su texto. */
export const PRIVACY_MARK = '[+ aviso de privacidad]';
/** La respuesta que se agrega al armar la nota: se prepara antes de enviarla. */
const NOTE_REPLY_LABEL = 'Bot (respuesta al crear la nota)';

const transcripts = new Map<string, Transcript>();
// Un solo contador para la instancia: sube tambien con lo restaurado, asi que un mensaje nuevo
// nunca repite el numero de uno que una nota en curso vaya a borrar.
let lastSeq = 0;

function emptyTranscript(partialStart = false, sinceNote = false): Transcript {
  return { entries: [], omitted: 0, partialStart, sinceNote };
}

function clip(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  return clean.length > TRANSCRIPT_MAX_TEXT ? clean.slice(0, TRANSCRIPT_MAX_TEXT) + ' [...cortado]' : clean;
}

function push(t: Transcript, entry: TranscriptEntry): void {
  t.entries.push(entry);
  if (t.entries.length > TRANSCRIPT_HEAD + TRANSCRIPT_TAIL) {
    t.entries.splice(TRANSCRIPT_HEAD, 1);
    t.omitted++;
  }
}

/** Lo que mando el cliente, con sus adjuntos: "[El cliente envio 1 imagen]" o "[Mensaje vacio]". */
export function inboundText(body: string, mediaTypes: string[] = []): string {
  const parts: string[] = [];
  if (mediaTypes.length) {
    const kinds = new Map<string, number>();
    for (const type of mediaTypes) {
      const kind = /^image\//i.test(type) ? 'imagen' : /^audio\//i.test(type) ? 'audio' : /^video\//i.test(type) ? 'video' : 'archivo';
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    const plural = (kind: string, n: number) => (n === 1 ? kind : kind === 'imagen' ? 'im\u00e1genes' : kind + 's');
    parts.push('[El cliente envi\u00f3 ' + [...kinds].map(([kind, n]) => n + ' ' + plural(kind, n)).join(' y ') + ']');
  }
  if (body.trim()) parts.push(body);
  return parts.length ? parts.join(' ') : '[Mensaje vac\u00edo]';
}

/** La respuesta del bot como salio: si llevo el aviso de privacidad, con la marca al final. */
export function botReplyText(reply: string, withNotice: boolean): string {
  return withNotice ? reply + '\n' + PRIVACY_MARK : reply;
}

/**
 * Registra un mensaje y devuelve su numero de orden. Si el numero no tenia transcripcion y la
 * conversacion ya iba avanzada (`inProgress`: un estado guardado antes de este cambio), la nota
 * avisara que puede faltar el inicio.
 */
export function recordTranscript(phone: string, role: TranscriptRole, text: string, opts: { at?: number; inProgress?: boolean } = {}): number {
  let t = transcripts.get(phone);
  if (!t) {
    t = emptyTranscript(Boolean(opts.inProgress));
    transcripts.set(phone, t);
  }
  const seq = ++lastSeq;
  push(t, { seq, at: opts.at ?? Date.now(), role, text: clip(text) });
  return seq;
}

/**
 * Ya se escribio (o quedo pendiente) una nota con la transcripcion hasta `upTo`: se borra solo eso.
 * Lo que llego despues (otro pedido mientras Pipedrive respondia) sigue para la nota siguiente.
 */
export function clearTranscriptAfterNote(phone: string, upTo: number): void {
  const rest = transcripts.get(phone)?.entries.filter((e) => e.seq > upTo) ?? [];
  transcripts.set(phone, { ...emptyTranscript(false, true), entries: rest });
}

export function getTranscript(phone: string): Transcript | undefined {
  return transcripts.get(phone);
}

/**
 * Lo guardado en Upstash, si tiene la forma esperada; si no, nada (la nota avisara que puede faltar
 * el inicio). Una entrada sin numero de orden (o fuera de orden) recibe uno nuevo.
 */
export function restoreTranscript(phone: string, saved: unknown): void {
  const t = saved as Partial<Transcript> | undefined;
  const valid = Boolean(t && Array.isArray(t.entries) && t.entries.every((e) => e && typeof e.at === 'number'
    && (e.role === 'cliente' || e.role === 'bot') && typeof e.text === 'string'));
  if (!valid) { transcripts.delete(phone); return; }
  let prev = 0;
  const entries = t!.entries!.slice(-(TRANSCRIPT_HEAD + TRANSCRIPT_TAIL)).map((e) => {
    const seq = Number.isSafeInteger(e.seq) && e.seq > prev ? e.seq : Math.max(prev, lastSeq) + 1;
    prev = seq;
    lastSeq = Math.max(lastSeq, seq);
    return { seq, at: e.at, role: e.role, text: clip(e.text) };
  });
  transcripts.set(phone, {
    entries,
    omitted: typeof t!.omitted === 'number' && t!.omitted > 0 ? t!.omitted : 0,
    partialStart: t!.partialStart === true,
    sinceNote: t!.sinceNote === true,
  });
}

export function clearTranscript(phone: string): void {
  transcripts.delete(phone);
}

const CHILE_TIME = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
/** "31-10-2026 14:05", en hora de Chile. */
export function chileTime(at: number): string {
  const parts = Object.fromEntries(CHILE_TIME.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return parts.day + '-' + parts.month + '-' + parts.year + ' ' + parts.hour + ':' + parts.minute;
}

// Las lineas siguientes de un mensaje van sangradas: nunca parecen otro mensaje.
function noteLine(at: number, who: string, text: string): string {
  return '[' + chileTime(at) + '] ' + who + ': ' + text.split('\n').map((line, j) => (j && line ? '    ' + line : line)).join('\n');
}

/**
 * La transcripcion en texto plano para la nota (pipedriveLead.ts la escapa): los mensajes hasta
 * `upTo` (el del cliente que pidio la nota) y la respuesta que el bot esta por mandar (`reply`),
 * rotulada aparte porque todavia no salio.
 */
export function transcriptForNote(phone: string, opts: { upTo?: number; reply?: string; at?: number } = {}): string {
  const t = transcripts.get(phone) ?? emptyTranscript(true);
  const { upTo, reply } = opts;
  const entries = upTo === undefined ? t.entries : t.entries.filter((e) => e.seq <= upTo);
  const lines: string[] = [];
  if (t.partialStart) lines.push('(Puede faltar el inicio de la conversaci\u00f3n: el asistente se reinici\u00f3 o la conversaci\u00f3n empez\u00f3 antes de este registro.)');
  else if (t.sinceNote) lines.push('(Desde la nota anterior.)');
  entries.forEach((e, i) => {
    if (i === TRANSCRIPT_HEAD && t.omitted > 0) lines.push('[... se omitieron ' + t.omitted + ' mensajes por el tope de la nota ...]');
    lines.push(noteLine(e.at, e.role === 'cliente' ? 'Cliente' : 'Bot', e.text));
  });
  if (reply) lines.push(noteLine(opts.at ?? Date.now(), NOTE_REPLY_LABEL, clip(reply)));
  if (!entries.length && !reply) lines.push('(Sin mensajes registrados.)');
  return lines.join('\n');
}
