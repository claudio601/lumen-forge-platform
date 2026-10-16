// src/components/legal/ConsentFields.tsx
// Casillas de privacidad y novedades de los cinco formularios del sitio (Etapa 2 · PR 13).
// Los textos, los mensajes y el tipo de lo que se envía vienen de api/_lib/forms/consent.ts,
// la misma fuente que usa el servidor para exigir la casilla y escribir la constancia.
//
// Reglas
// - La casilla obligatoria y la de novedades empiezan SIEMPRE sin marcar: nada se lee de la
//   sesión, del almacenamiento ni de un envío anterior. El primer render es igual en el
//   servidor (prerender) y en el navegador.
// - Sin `required` nativo (la burbuja del navegador sale en inglés): cada formulario llama
//   check() DESPUÉS de su propia validación, así el error de la casilla aparece solo cuando el
//   resto está bien, junto a la casilla y con el foco en ella.
// - payload() refleja lo que la persona marcó, nunca un true fijo: si algún camino envía sin
//   pasar por check(), el servidor rechaza en vez de registrar una autorización que nadie dio.
// - Sin Date, sin storage y sin analytics. No va dentro del aviso role="note" (PreSubmitNotice).

import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CONSENT_ERRORS,
  CONSENT_FIELD_NAMES,
  CONSENT_LEGEND,
  CONSENT_TEXTS,
  LEGAL_VERSION,
  consentTextParts,
  type ConsentInput,
  type ConsentKind,
} from '../../../api/_lib/forms/consent';

export interface ConsentFieldsOptions {
  /** Nota bajo la casilla obligatoria (solo /instalacion: CONSENT_TEXTS.installationNote). */
  note?: string;
  /** Clases del <fieldset> (por defecto 'mb-5'); p. ej. 'sm:col-span-2' dentro de una grilla. */
  className?: string;
}

export interface ConsentFieldsApi {
  /** La casilla obligatoria está marcada. */
  privacy: boolean;
  /** La casilla de novedades está marcada. */
  marketing: boolean;
  /** true si la obligatoria está marcada; si no, muestra el error, le da el foco y devuelve false. */
  check(): boolean;
  /** El servidor respondió 400 con code 'consent_required': muestra el error y da el foco. */
  flagMissing(): void;
  /** Lo que viaja en `consent`: el estado real de las casillas y la versión de los textos. */
  payload(): ConsentInput;
  /** Vuelve a dejar las casillas sin marcar (después de un envío confirmado). */
  reset(): void;
  /** El grupo de casillas para dibujar en el formulario. */
  fields: JSX.Element;
}

const LABEL_CLASS = 'flex items-start gap-3 cursor-pointer select-none';
const CHECKBOX_CLASS = 'mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 accent-primary cursor-pointer';
const TEXT_CLASS = 'text-sm text-gray-600 leading-snug';

/** Texto de una casilla con sus enlaces ({privacidad}, {terminos}) en otra pestaña. */
function consentTextNodes(text: string): ReactNode[] {
  return consentTextParts(text).map((part, i) =>
    typeof part === 'string' ? (
      part
    ) : (
      <Link key={i} to={part.path} target="_blank" rel="noopener noreferrer" className="text-primary underline">
        {part.label}
      </Link>
    ),
  );
}

export function useConsentFields(kind: ConsentKind, opts?: ConsentFieldsOptions): ConsentFieldsApi {
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [showError, setShowError] = useState(false);
  const privacyRef = useRef<HTMLInputElement>(null);

  const base = useId();
  const ids = {
    privacy: `${base}-privacy`,
    marketing: `${base}-marketing`,
    note: `${base}-note`,
    error: `${base}-error`,
  };

  const flagMissing = () => {
    setShowError(true);
    privacyRef.current?.focus();
  };

  const check = () => {
    if (privacy) return true;
    flagMissing();
    return false;
  };

  const payload = (): ConsentInput => ({
    privacy,
    ...(kind === 'pedido' ? { terms: privacy } : {}),
    marketing,
    version: LEGAL_VERSION,
  });

  const reset = () => {
    setPrivacy(false);
    setMarketing(false);
    setShowError(false);
  };

  const describedBy = [showError ? ids.error : '', opts?.note ? ids.note : ''].filter(Boolean).join(' ') || undefined;

  const fields = (
    <fieldset className={opts?.className ?? 'mb-5'}>
      <legend className="sr-only">{CONSENT_LEGEND}</legend>
      {/* space-y en un div y no en el fieldset: la leyenda oculta contaría como primer hijo */}
      <div className="space-y-3">
        <div>
          <label className={LABEL_CLASS}>
            <input
              ref={privacyRef}
              id={ids.privacy}
              type="checkbox"
              name={CONSENT_FIELD_NAMES.privacy}
              checked={privacy}
              onChange={(e) => {
                setPrivacy(e.target.checked);
                if (e.target.checked) setShowError(false);
              }}
              aria-required="true"
              aria-invalid={showError}
              aria-describedby={describedBy}
              className={CHECKBOX_CLASS}
            />
            <span className={TEXT_CLASS}>
              {consentTextNodes(kind === 'pedido' ? CONSENT_TEXTS.privacyWithTerms : CONSENT_TEXTS.privacy)}{' '}
              <span aria-hidden="true" className="text-red-500">*</span>
            </span>
          </label>
          {showError && (
            <p role="alert" id={ids.error} className="mt-2 pl-7 text-sm text-red-700 leading-snug">
              {CONSENT_ERRORS[kind]}
            </p>
          )}
          {opts?.note && (
            <p id={ids.note} className="mt-2 pl-7 text-xs text-gray-600 leading-snug">
              {opts.note}
            </p>
          )}
        </div>
        <label className={LABEL_CLASS}>
          <input
            id={ids.marketing}
            type="checkbox"
            name={CONSENT_FIELD_NAMES.marketing}
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className={CHECKBOX_CLASS}
          />
          <span className={TEXT_CLASS}>{CONSENT_TEXTS.marketing}</span>
        </label>
      </div>
    </fieldset>
  );

  return { privacy, marketing, check, flagMissing, payload, reset, fields };
}
