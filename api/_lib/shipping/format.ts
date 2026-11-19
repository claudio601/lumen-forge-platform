// api/_lib/shipping/format.ts
// Formato es-CL del aviso de despacho (spec Nivel 2, §4.1 y §5): montos «$5.880», kilos
// «4,5 kg», bultos «1 bulto» / «2 bultos» y fechas «jueves 19 de noviembre», siempre en hora de
// Chile (America/Santiago). El aviso nunca dice «hoy»: siempre «el <día dd de mes>».
// Sin Intl para los textos (el resultado no depende del ICU del servidor); Intl solo para saber
// qué día y hora es en Chile.
// Sin imports; la carpeta _lib hace que Vercel no lo despliegue como función.

export const CHILE_TIME_ZONE = 'America/Santiago';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/** Miles con punto: 1234567 → «1.234.567». */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Monto en pesos, entero y con punto de miles: 5880 → «$5.880». */
export function formatClp(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  return `${amount < 0 ? '-' : ''}$${groupThousands(String(rounded))}`;
}

/** Decimal con coma y hasta 2 decimales, sin ceros de más: 4.5 → «4,5»; 28 → «28»; 3.456 → «3,46». */
export function formatDecimal(value: number): string {
  const fixed = (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  const [int, dec] = fixed.split('.');
  return dec ? `${groupThousands(int)},${dec}` : groupThousands(int);
}

/** Kilos: 4.5 → «4,5 kg». */
export function formatKg(kilos: number): string {
  return `${formatDecimal(kilos)} kg`;
}

/** «1 bulto» / «2 bultos». */
export function formatPackages(count: number): string {
  return `${count} ${count === 1 ? 'bulto' : 'bultos'}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** true si es una fecha 'aaaa-mm-dd' que existe en el calendario. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** 'aaaa-mm-dd' → «jueves 19 de noviembre». Lanza si la fecha no existe. */
export function formatDateLong(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new Error('formatDateLong: fecha inválida');
  const [y, mo, d] = isoDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} de ${MONTHS[mo - 1]}`;
}

function chileParts(at: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** Fecha y hora de Chile de un instante: { date: 'aaaa-mm-dd', time: 'hh:mm' }. */
export function chileDateTime(at: Date): { date: string; time: string } {
  const p = chileParts(at);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Día de hoy en Chile: 'aaaa-mm-dd'. */
export function chileToday(now: Date): string {
  return chileDateTime(now).date;
}

/** Diferencia (ms) entre la hora de Chile y UTC en ese instante: −3 h en verano, −4 h en invierno. */
function chileOffsetMs(atMs: number): number {
  const minute = Math.floor(atMs / 60_000) * 60_000;
  const p = chileParts(new Date(minute));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - minute;
}

/** Desfase de Chile en ese instante, como lo escribe una marca: «-03:00» (verano) o «-04:00» (invierno). */
export function chileOffset(at: Date): string {
  const minutes = Math.round(chileOffsetMs(at.getTime()) / 60_000);
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Marca de hora de Chile con su desfase: «2026-11-18 14:05 -03:00» (sin segundos). Lleva el
 * desfase porque la hora sola no alcanza: al terminar el horario de verano (primer domingo de
 * abril) la hora de 23:00 a 23:59 se repite, y al empezar (primer domingo de septiembre) la de
 * 00:00 a 00:59 no existe. Es lo único que escribe una hora que después se relee
 * (formatSentLog, «Despacho · Aviso enviado»): siempre con parseChileTimestamp.
 */
export function formatChileTimestamp(at: Date): string {
  const { date, time } = chileDateTime(at);
  return `${date} ${time} ${chileOffset(at)}`;
}

export type ChileTimestampResult =
  | { ok: true; at: Date }
  /** `format`: no es «aaaa-mm-dd hh:mm ±hh:mm»; `no_offset`: falta el desfase (la hora puede ser ambigua); `time`: esa hora no existe en Chile con ese desfase. */
  | { ok: false; reason: 'format' | 'no_offset' | 'time' };

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?: ([+-])(\d{2}):(\d{2}))?$/;

/**
 * Lee una marca de formatChileTimestamp. Exige el desfase y que la hora exista en Chile con ese
 * desfase: «2026-09-06 00:30 -04:00» (hora que se salta) o «2026-11-18 14:05 -04:00» (desfase de
 * invierno en verano) no se aceptan. Nunca elige una de dos horas posibles.
 */
export function parseChileTimestamp(text: string): ChileTimestampResult {
  const m = TIMESTAMP.exec(text);
  if (!m || !isIsoDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return { ok: false, reason: 'format' };
  if (!m[4]) return { ok: false, reason: 'no_offset' };
  if (Number(m[6]) > 59) return { ok: false, reason: 'format' };
  const [y, mo, d] = m[1].split('-').map(Number);
  const offsetMinutes = (m[4] === '-' ? -1 : 1) * (Number(m[5]) * 60 + Number(m[6]));
  const at = new Date(Date.UTC(y, mo - 1, d, Number(m[2]), Number(m[3])) - offsetMinutes * 60_000);
  // La hora releída tiene que ser la misma en Chile y con el mismo desfase.
  const back = chileDateTime(at);
  if (back.date !== m[1] || back.time !== `${m[2]}:${m[3]}` || chileOffset(at) !== `${m[4]}${m[5]}:${m[6]}`) return { ok: false, reason: 'time' };
  return { ok: true, at };
}
