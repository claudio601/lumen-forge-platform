// src/lib/savedContact.ts
// ─────────────────────────────────────────────────────────────────────────────
// «Recordar mis datos en este dispositivo» (especificación del 23-10-2026, aprobada por el
// dueño con sus 4 decisiones): los datos de contacto que la persona pide recordar, para
// completar los cinco formularios cuando vuelve. Sin cuentas, sin login y sin funciones
// nuevas: todo vive en el navegador. Sin React (la casilla es useRememberContact, en
// src/components/forms/RememberContact.tsx).
//
// Dónde se guarda: localStorage 'elights_contact' (el estilo de 'elights_cookie_consent') =
//   {"v":1,"at":"2026-10-23T14:03:12.000Z","data":{"nombre":"…","email":"…"}}
// - v: versión del formato. Si cambia la forma de los datos, pasa a 2 y lo de v1 se borra al
//   leerlo. Agregar una clave no exige subirla.
// - at: el último envío confirmado con la casilla marcada. Vence a los 12 meses (decisión 2).
//   Lo vencido, ilegible, de otra versión o con `at` más de 1 día en el futuro se borra al
//   leerlo; AppLayout lo revisa al abrir cualquier página (Política §7).
// - data: solo lo enviado (ya recortado, con el RUT formateado): nombre, correo, teléfono,
//   tipo de cliente, la empresa como un bloque (razón social, giro, dirección y RUT; el RUT
//   solo si es válido, decisión 1) y comuna y región (solo desde /solicitar-pedido). Nunca
//   comentarios, archivos, casillas, el campo trampa, datos del proyecto, productos ni montos.
//
// Al leer solo se aceptan textos de claves conocidas y dentro de su largo máximo; la región
// solo si está en REGIONS, el tipo solo si es 'persona' o 'empresa' y el RUT solo si pasa
// isValidRut. Sin correo, el registro no sirve (la mezcla se decide por él) y se borra.
//
// Todo acceso a localStorage va en try/catch y nada corre al importar: en Node (prerender) y
// con el almacenamiento bloqueado, leer da null, guardar no hace nada y la casilla se quita.
// No son cookies (scripts/no-cookies.test.ts) y nada de esto va a Analytics.
// ─────────────────────────────────────────────────────────────────────────────

import { REGIONS } from '@/config/regions';
import { formatRut, isValidRut } from '@/lib/rut';
import type { ConsentForm } from '../../api/_lib/forms/consent';

export const SAVED_CONTACT_STORAGE_KEY = 'elights_contact';
/** Versión del formato del valor guardado. */
export const SAVED_CONTACT_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Lo guardado vence a los 12 meses desde el último envío con la casilla marcada (decisión 2). */
export const SAVED_CONTACT_MAX_AGE_MS = 365 * DAY_MS;
/** Un reloj adelantado hasta 1 día no invalida lo guardado. */
const MAX_FUTURE_MS = DAY_MS;
/** Clave de prueba para saber si el navegador deja escribir (se borra en el acto). */
const PROBE_KEY = 'elights_contact_probe';

/** Los cinco formularios del sitio (los mismos de consent.ts). */
export type ContactForm = ConsentForm;
export type CustomerKind = 'persona' | 'empresa';

/** Lo que se guarda, con nombres propios (no los `name` de cada formulario). */
export interface SavedContact {
  nombre?: string;
  email?: string;
  telefono?: string;
  tipoCliente?: CustomerKind;
  /** Razón social o empresa. Con giro, dirección y RUT forma un bloque. */
  empresa?: string;
  giro?: string;
  direccion?: string;
  rut?: string;
  comuna?: string;
  region?: string;
}
export type SavedContactKey = keyof SavedContact;

export interface StoredContact {
  /** Fecha del último envío con la casilla marcada (ISO). */
  at: string;
  data: SavedContact;
}

/** Orden de las claves en el valor guardado (y en las pruebas). */
export const SAVED_CONTACT_KEYS: readonly SavedContactKey[] = [
  'nombre', 'email', 'telefono', 'tipoCliente', 'empresa', 'giro', 'direccion', 'rut', 'comuna', 'region',
];
type TextKey = Exclude<SavedContactKey, 'tipoCliente' | 'region'>;

/** Largo máximo de cada texto: el mayor que acepta alguno de los formularios. */
export const SAVED_CONTACT_MAX_LENGTHS: Readonly<Record<TextKey, number>> = {
  nombre: 120,
  email: 254,
  telefono: 30,
  empresa: 200,
  giro: 200,
  direccion: 200,
  rut: 20,
  comuna: 80,
};

const COMPANY_BLOCK = ['empresa', 'giro', 'direccion', 'rut'] as const;

interface FormRules {
  /** Lo que el formulario completa al volver, con su tope en ese formulario (true: el general). */
  reads: Partial<Record<SavedContactKey, number | true>>;
  /** Lo que escribe un envío confirmado. */
  writes: readonly SavedContactKey[];
  /**
   * El tipo de cliente y la empresa. 'selector': el formulario tiene el selector persona o
   * empresa y la empresa se guarda solo si se envió como empresa. 'optional': sin selector y
   * con empresa opcional; con razón social o empresa el tipo pasa a 'empresa' (nunca a
   * 'persona'). 'none': no toca ni el tipo ni la empresa.
   */
  company: 'selector' | 'optional' | 'none';
}

/** La tabla de §3 de la especificación. */
const FORM_RULES: Readonly<Record<ContactForm, FormRules>> = {
  cotizacion: {
    // MAX_DATO_EMPRESA (200) en los cuatro datos de facturación
    reads: { nombre: true, email: true, telefono: true, tipoCliente: true, empresa: 200, giro: 200, direccion: 200, rut: 200 },
    writes: ['nombre', 'email', 'telefono', 'tipoCliente', 'empresa', 'giro', 'direccion', 'rut'],
    company: 'selector',
  },
  'solicitar-pedido': {
    reads: { nombre: true, email: true, telefono: true, tipoCliente: true, empresa: true, rut: 20, comuna: true, region: true },
    writes: ['nombre', 'email', 'telefono', 'tipoCliente', 'empresa', 'rut', 'comuna', 'region'],
    company: 'selector',
  },
  cotizador: {
    // Los maxLength de SmartQuotePage (los mismos de api/project-quotes/create.ts)
    reads: { nombre: 120, email: 254, telefono: 30, empresa: 150, giro: 150, direccion: 200, rut: 20 },
    writes: ['nombre', 'email', 'telefono', 'empresa', 'giro', 'direccion', 'rut'],
    company: 'optional',
  },
  'estudio-luminico': {
    // ESTUDIO_MAX_LENGTHS
    reads: { nombre: 120, email: 254, telefono: 30, empresa: 120 },
    writes: ['nombre', 'email', 'telefono', 'empresa'],
    company: 'optional',
  },
  instalacion: {
    // La comuna de la obra solo se lee: nunca se guarda desde aquí
    reads: { nombre: 120, email: 254, telefono: 30, comuna: 80 },
    writes: ['nombre', 'email', 'telefono'],
    company: 'none',
  },
};

const inBrowser = () => typeof window !== 'undefined';

/** Mismo correo, sin mirar mayúsculas ni espacios a los lados. */
export function sameEmail(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

const sameText = (a: string | undefined, b: string | undefined) =>
  (a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === (b ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Solo las claves conocidas y válidas, en el orden de SAVED_CONTACT_KEYS: textos recortados,
 * no vacíos y dentro de su tope; la región de REGIONS; el tipo 'persona' o 'empresa'; el RUT
 * válido y con formato. Lo demás se descarta sin error.
 */
export function cleanSavedContact(raw: unknown): SavedContact {
  const out: SavedContact = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const key of SAVED_CONTACT_KEYS) {
    const value = r[key];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;
    if (key === 'tipoCliente') {
      if (text === 'persona' || text === 'empresa') out.tipoCliente = text;
    } else if (key === 'region') {
      if (REGIONS.includes(text)) out.region = text;
    } else if (text.length <= SAVED_CONTACT_MAX_LENGTHS[key]) {
      if (key === 'rut') {
        if (isValidRut(text)) out.rut = formatRut(text);
      } else {
        out[key] = text;
      }
    }
  }
  return out;
}

function removeStored(): void {
  try {
    window.localStorage.removeItem(SAVED_CONTACT_STORAGE_KEY);
  } catch {
    // Almacenamiento bloqueado: no hay nada que borrar
  }
}

/** El registro vigente, o null si no hay, no se puede leer o no sirve (y entonces lo borra). */
function validStored(raw: unknown, now: number): StoredContact | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== SAVED_CONTACT_VERSION || typeof r.at !== 'string') return null;
  const at = Date.parse(r.at);
  if (!Number.isFinite(at) || now - at >= SAVED_CONTACT_MAX_AGE_MS || at - now > MAX_FUTURE_MS) return null;
  const data = cleanSavedContact(r.data);
  if (!data.email) return null;
  return { at: r.at, data };
}

/**
 * Lo guardado y vigente, ya validado. Lo vencido, ilegible, de otra versión, con `at` más de
 * 1 día en el futuro o sin correo se borra. Solo desde un efecto o un manejador (nunca al
 * dibujar). Nunca lanza; en Node devuelve null.
 */
export function readSavedContact(now: number = Date.now()): StoredContact | null {
  if (!inBrowser()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SAVED_CONTACT_STORAGE_KEY);
  } catch {
    return null; // almacenamiento bloqueado
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const stored = validStored(parsed, now);
  if (!stored) removeStored();
  return stored;
}

/** Borra lo vencido o ilegible (AppLayout, al abrir cualquier página). Nunca lanza. */
export function purgeSavedContact(now: number = Date.now()): void {
  readSavedContact(now);
}

/** Borra lo guardado (desmarcar la casilla o «Borrar mis datos guardados»). Nunca lanza. */
export function clearSavedContact(): void {
  if (inBrowser()) removeStored();
}

/**
 * true si el navegador deja leer y escribir en localStorage. Si no, la casilla se quita: no se
 * promete lo que no se puede cumplir. Solo desde un efecto. Nunca lanza.
 */
export function savedContactAvailable(): boolean {
  if (!inBrowser()) return false;
  try {
    const storage = window.localStorage;
    storage.getItem(SAVED_CONTACT_STORAGE_KEY);
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lo que queda guardado después de un envío confirmado de `form` con la casilla marcada, o
 * null si el envío no trae correo. Pura (la usan saveSavedContact y las pruebas).
 * - Solo las claves que escribe ese formulario, limpias (cleanSavedContact).
 * - Correo distinto del guardado: se reemplaza todo, sin mezclar.
 * - Mismo correo: lo enviado reemplaza lo guardado; un campo vacío o que el formulario no
 *   tiene no borra nada. Un valor enviado que no se puede guardar (un RUT inválido, un texto
 *   más largo que su tope) tampoco deja el anterior: la persona ya lo reemplazó.
 * - Empresa como bloque: si cambia su nombre, se borran el RUT, el giro y la dirección que no
 *   vinieron en ese envío. Con selector, se guarda solo si se envió como empresa; sin
 *   selector, con razón social o empresa el tipo pasa a 'empresa' (nunca a 'persona'). Si el
 *   envío no trae la empresa, el bloque guardado no se toca.
 */
export function mergeSavedContact(form: ContactForm, prev: SavedContact | null, sent: SavedContact): SavedContact | null {
  const rules = FORM_RULES[form];
  const picked: Record<string, unknown> = {};
  for (const key of rules.writes) picked[key] = sent[key];
  const next = cleanSavedContact(picked);
  if (!next.email) return null;
  // Lo que llegó con texto y cleanSavedContact descartó (RUT inválido, más largo que su tope)
  const rejected = new Set(rules.writes.filter((key) => {
    const value = sent[key];
    return typeof value === 'string' && value.trim() !== '' && next[key] === undefined;
  }));

  let withCompany: boolean;
  if (rules.company === 'selector') {
    withCompany = next.tipoCliente === 'empresa';
  } else {
    delete next.tipoCliente;
    withCompany = rules.company === 'optional' && (!!next.empresa || rejected.has('empresa'));
    if (rules.company === 'optional' && next.empresa) next.tipoCliente = 'empresa';
  }
  if (!withCompany) {
    for (const key of COMPANY_BLOCK) {
      delete next[key];
      rejected.delete(key);
    }
  }

  const base: SavedContact = prev && sameEmail(prev.email, next.email) ? { ...prev } : {};
  // Otra empresa (también una que no se puede guardar): no queda nada del bloque anterior
  if (rejected.has('empresa') || (next.empresa && !sameText(base.empresa, next.empresa))) {
    for (const key of COMPANY_BLOCK) delete base[key];
  }
  for (const key of rejected) delete base[key];
  return cleanSavedContact({ ...base, ...next });
}

/**
 * Guarda lo enviado en un envío CONFIRMADO de `form` con la casilla marcada (mezcla de
 * mergeSavedContact) y pone `at` en la hora actual. Devuelve false si no pudo (sin correo o
 * almacenamiento bloqueado). Nunca lanza.
 */
export function saveSavedContact(form: ContactForm, sent: SavedContact, now: number = Date.now()): boolean {
  if (!inBrowser()) return false;
  const next = mergeSavedContact(form, readSavedContact(now)?.data ?? null, sent);
  if (!next) return false;
  try {
    window.localStorage.setItem(
      SAVED_CONTACT_STORAGE_KEY,
      JSON.stringify({ v: SAVED_CONTACT_VERSION, at: new Date(now).toISOString(), data: next }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Lo que `form` completa con lo guardado: solo las claves que lee, dentro de su tope en ese
 * formulario (si un valor lo supera, ese campo no se completa ahí) y el RUT con formatRut.
 */
export function prefillFor(form: ContactForm, saved: SavedContact): SavedContact {
  const out: SavedContact = {};
  const reads = FORM_RULES[form].reads;
  for (const key of SAVED_CONTACT_KEYS) {
    const max = reads[key];
    const value = saved[key];
    if (max === undefined || value === undefined) continue;
    if (typeof max === 'number' && value.length > max) continue;
    if (key === 'tipoCliente') out.tipoCliente = value as CustomerKind;
    else out[key] = key === 'rut' ? formatRut(value) : value;
  }
  return out;
}
