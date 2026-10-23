// src/components/forms/RememberContact.tsx
// Casilla «Recordar mis datos en este dispositivo» de los cinco formularios (especificación
// del 23-10-2026, aprobada por el dueño con sus 4 decisiones). Al estilo de useConsentFields:
// el formulario dibuja `field` y llama prefill() y afterSubmit(). Lo guardado lo maneja
// src/lib/savedContact.ts.
//
// Reglas
// - El primer render es igual en el servidor (prerender) y en el navegador: la casilla sin
//   marcar, con su nota de ayuda, dentro del fieldset que se habilita al hidratar. Nada se lee
//   al dibujar: prefill() va en un efecto (después de hidratar, o cuando /cotizacion y
//   /solicitar-pedido ya leyeron la sesión) o en «Enviar otra solicitud».
// - Si el almacenamiento está bloqueado, la casilla se quita (se revisa en un efecto).
// - Con datos guardados, la casilla aparece marcada y dice «Seguir recordando…» (decisión 3);
//   la nota de ayuda cambia en el mismo lugar y con la misma altura (los dos textos ocupan la
//   misma celda; el que no corresponde queda invisible).
// - Desmarcar borra en el acto lo guardado, sin vaciar los campos. Cambiar el correo que se
//   completó la desmarca y borra: en un computador compartido, los datos de otra persona no
//   quedan guardados sin que lo pida.
// - afterSubmit guarda solo un envío CONFIRMADO (el servidor devolvió la referencia, la misma
//   condición de trackLead) con la casilla marcada, y solo lo enviado. Nunca cambia lo que
//   viaja al servidor ni va a Analytics.
// - No es una casilla de consentimiento de la constancia: no viaja en `consent` ni en el cuerpo.

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  clearSavedContact,
  prefillFor,
  readSavedContact,
  sameEmail,
  saveSavedContact,
  savedContactAvailable,
  type ContactForm,
  type SavedContact,
} from '@/lib/savedContact';

/** Textos de la especificación (§1). La Política §10 cita la etiqueta y el botón. */
export const REMEMBER_TEXTS = {
  label: 'Recordar mis datos en este dispositivo',
  labelSaved: 'Seguir recordando mis datos en este dispositivo',
  hint: 'Solo en este navegador. No la marques en un computador compartido.',
  hintSaved: 'Completamos tus datos con lo que guardaste aquí. Revisa que estén al día, sobre todo el correo.',
  cleared: 'Listo: borramos tus datos de este dispositivo',
  emailChanged: 'Cambiaste el correo: si quieres que recordemos estos datos, marca la casilla de nuevo',
  deleteButton: 'Borrar mis datos guardados',
} as const;

/** `name` de la casilla (no viaja: los formularios mandan JSON armado a mano). */
export const REMEMBER_FIELD_NAME = 'recordarDatos';

export interface RememberContactOptions {
  /** Clases del bloque (p. ej. 'sm:col-span-2' dentro de una grilla). */
  className?: string;
}

export interface RememberContactApi {
  /** La casilla está marcada. */
  checked: boolean;
  /**
   * Lee lo guardado: si hay, marca la casilla («Seguir recordando…») y devuelve lo que este
   * formulario completa (prefillFor: sus claves, dentro de sus topes, el RUT con formato); si
   * no, la deja sin marcar y devuelve null. Solo en un efecto o un manejador.
   */
  prefill(): SavedContact | null;
  /** El correo del formulario cambió: si es otro que el guardado, desmarca y borra. */
  onEmailChange(value: string): void;
  /**
   * Después del envío. ok: el servidor confirmó con su referencia. Con ok y la casilla marcada
   * guarda `sent` (lo que viajó, con los nombres de savedContact); si no, no cambia nada.
   */
  afterSubmit(ok: boolean, sent: SavedContact): void;
  /** La casilla con su nota de ayuda y el aviso; null si el almacenamiento está bloqueado. */
  field: JSX.Element | null;
}

const CHECKBOX_CLASS = 'mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 accent-primary cursor-pointer';
/** Las dos letras chicas en la misma celda: la altura es la del texto más largo. */
const STACKED: CSSProperties = { gridArea: '1 / 1' };
const HIDDEN: CSSProperties = { ...STACKED, visibility: 'hidden' };

/**
 * Los campos vacíos de `values` con lo de `patch`; nunca pisa lo que la persona escribió.
 * Devuelve el mismo objeto si no cambia nada.
 */
export function fillEmpty<T extends object>(values: T, patch: Partial<Record<keyof T, string | undefined>>): T {
  let next = values;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (!value || values[key] !== '') continue;
    if (next === values) next = { ...values };
    (next as Record<keyof T, unknown>)[key] = value;
  }
  return next;
}

export function useRememberContact(form: ContactForm, opts?: RememberContactOptions): RememberContactApi {
  const [available, setAvailable] = useState(true);
  const [checked, setChecked] = useState(false);
  /** Los campos se completaron con lo guardado: «Seguir recordando…» y su nota de ayuda. */
  const [fromSaved, setFromSaved] = useState(false);
  const [message, setMessage] = useState('');
  // El valor vigente aunque el envío haya empezado con otro render
  const checkedRef = useRef(false);
  /** El correo guardado mientras la casilla sigue marcada por lo guardado. */
  const savedEmail = useRef<string | null>(null);

  const base = useId();
  const ids = { box: `${base}-remember`, hint: `${base}-remember-hint` };

  useEffect(() => {
    if (!savedContactAvailable()) setAvailable(false);
  }, []);

  const mark = (value: boolean) => {
    checkedRef.current = value;
    setChecked(value);
  };

  /** Borra lo guardado y deja la casilla sin marcar, con el aviso (sin vaciar los campos). */
  const forget = (notice: string) => {
    clearSavedContact();
    savedEmail.current = null;
    mark(false);
    setFromSaved(false);
    setMessage(notice);
  };

  const prefill = (): SavedContact | null => {
    setMessage('');
    const stored = readSavedContact();
    if (!stored) {
      savedEmail.current = null;
      mark(false);
      setFromSaved(false);
      return null;
    }
    savedEmail.current = stored.data.email ?? null;
    mark(true);
    setFromSaved(true);
    return prefillFor(form, stored.data);
  };

  const onEmailChange = (value: string) => {
    if (savedEmail.current === null || sameEmail(value, savedEmail.current)) return;
    forget(REMEMBER_TEXTS.emailChanged);
  };

  const afterSubmit = (ok: boolean, sent: SavedContact) => {
    if (ok && checkedRef.current) saveSavedContact(form, sent);
  };

  const onToggle = (value: boolean) => {
    if (value) {
      mark(true);
      setMessage('');
      return;
    }
    // Desmarcar borra en el acto; el aviso solo si había algo guardado
    const had = fromSaved;
    forget(had ? REMEMBER_TEXTS.cleared : '');
  };

  const field = available ? (
    <div className={opts?.className}>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          id={ids.box}
          type="checkbox"
          name={REMEMBER_FIELD_NAME}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-describedby={ids.hint}
          className={CHECKBOX_CLASS}
        />
        <span className="text-sm text-gray-700 leading-snug">{fromSaved ? REMEMBER_TEXTS.labelSaved : REMEMBER_TEXTS.label}</span>
      </label>
      <p id={ids.hint} className="mt-1 pl-7 grid text-xs text-gray-600 leading-snug">
        <span style={fromSaved ? HIDDEN : STACKED} aria-hidden={fromSaved || undefined}>{REMEMBER_TEXTS.hint}</span>
        <span style={fromSaved ? STACKED : HIDDEN} aria-hidden={!fromSaved || undefined}>{REMEMBER_TEXTS.hintSaved}</span>
      </p>
      <p role="status" className={message ? 'mt-1 pl-7 text-xs font-medium text-gray-700 leading-snug' : 'pl-7 text-xs'}>
        {message}
      </p>
    </div>
  ) : null;

  return { checked, prefill, onEmailChange, afterSubmit, field };
}
