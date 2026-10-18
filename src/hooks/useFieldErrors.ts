// src/hooks/useFieldErrors.ts
// Errores por campo de los formularios de /cotizacion y /solicitar-pedido (auditoría UX,
// F-02): se revisa cada campo al salir de él y todos al enviar. El mensaje va debajo del
// campo (aria-invalid y aria-describedby) y el foco pasa al primero con error, sin subir la
// página al tope. El resumen junto al botón (role="alert") lo dibuja cada página con
// `summary`, que solo se llena después de un intento de envío.
//
// El foco se da después de dibujar el error (flushSync): así el campo ya tiene aria-invalid y
// aria-describedby cuando lo recibe, y el lector de pantalla lee su mensaje (WCAG 3.3.1).

import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export interface FieldErrorsApi<F extends string, V> {
  /** Mensaje de cada campo con error. */
  errors: Partial<Record<F, string>>;
  /** Los errores visibles en el orden del formulario, solo después de intentar enviar. */
  summary: { name: F; message: string }[];
  /** Al salir del campo: lo revisa con los valores actuales. */
  onBlur: (name: F, values: V) => void;
  /** Al escribir: si el campo ya mostraba un error, lo vuelve a revisar con el valor nuevo. */
  onChange: (name: F, values: V) => void;
  /**
   * Al enviar: revisa los campos `names` (en el orden del formulario), muestra sus errores,
   * borra los de campos que ya no están y lleva el foco al primero con error. true si no hay.
   */
  checkAll: (names: readonly F[], values: V) => boolean;
  /** Error que viene del servidor para un campo (p. ej. un correo rechazado). */
  setError: (name: F, message: string) => void;
  /** Props para el campo: id, aria-invalid y aria-describedby (con el id del mensaje). */
  fieldProps: (name: F) => { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };
  /** Id del mensaje de un campo (para el <p> que lo muestra). */
  errorId: (name: F) => string;
}

/**
 * @param idPrefix  prefijo de los ids de los campos ("qc-" → "qc-email", "qc-email-error")
 * @param validate  la regla de cada campo: el mensaje, o null si está bien
 * @param order     todos los campos en el orden del formulario (para el resumen)
 */
export function useFieldErrors<F extends string, V>(
  idPrefix: string,
  validate: (name: F, values: V) => string | null,
  order: readonly F[],
): FieldErrorsApi<F, V> {
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});
  const [attempted, setAttempted] = useState(false);
  // La regla puede depender de otros campos (tipo de cliente): siempre la última
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const set = useCallback((name: F, message: string | null) => {
    setErrors((prev) => {
      if ((prev[name] ?? null) === message) return prev;
      const next = { ...prev };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  }, []);

  const onBlur = useCallback((name: F, values: V) => set(name, validateRef.current(name, values)), [set]);

  const onChange = useCallback(
    (name: F, values: V) => {
      setErrors((prev) => {
        if (!prev[name]) return prev;
        const message = validateRef.current(name, values);
        if (message === prev[name]) return prev;
        const next = { ...prev };
        if (message) next[name] = message;
        else delete next[name];
        return next;
      });
    },
    [],
  );

  const errorId = useCallback((name: F) => `${idPrefix}${name}-error`, [idPrefix]);

  const checkAll = useCallback(
    (names: readonly F[], values: V) => {
      const next: Partial<Record<F, string>> = {};
      for (const name of names) {
        const message = validateRef.current(name, values);
        if (message) next[name] = message;
      }
      // Primero se dibujan los errores; recién entonces el foco (ver arriba)
      flushSync(() => {
        setErrors(next);
        setAttempted(true);
      });
      const first = names.find((n) => next[n]);
      if (first) document.getElementById(`${idPrefix}${first}`)?.focus();
      return !first;
    },
    [idPrefix],
  );

  const setError = useCallback(
    (name: F, message: string) => {
      flushSync(() => {
        set(name, message);
        setAttempted(true);
      });
      document.getElementById(`${idPrefix}${name}`)?.focus();
    },
    [idPrefix, set],
  );

  const fieldProps = (name: F) =>
    errors[name]
      ? { id: `${idPrefix}${name}`, 'aria-invalid': true as const, 'aria-describedby': errorId(name) }
      : { id: `${idPrefix}${name}` };

  const summary = attempted ? order.filter((n) => errors[n]).map((n) => ({ name: n, message: errors[n] as string })) : [];

  return { errors, summary, onBlur, onChange, checkAll, setError, fieldProps, errorId };
}
