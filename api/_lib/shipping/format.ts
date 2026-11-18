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

/** Fecha y hora de Chile ('aaaa-mm-dd', 'hh:mm') → instante en UTC. */
export function chileLocalToUtc(isoDate: string, time: string): Date {
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!isIsoDate(isoDate) || !t || Number(t[1]) > 23 || Number(t[2]) > 59) {
    throw new Error('chileLocalToUtc: fecha u hora inválida');
  }
  const [y, mo, d] = isoDate.split('-').map(Number);
  const local = Date.UTC(y, mo - 1, d, Number(t[1]), Number(t[2]));
  // Dos pasadas: la segunda corrige el cambio de horario entre la hora local y la UTC.
  const first = local - chileOffsetMs(local);
  return new Date(local - chileOffsetMs(first));
}
