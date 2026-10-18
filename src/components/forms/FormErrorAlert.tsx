// src/components/forms/FormErrorAlert.tsx
// Aviso general de un formulario, justo antes del botón de envío, donde el visitante está
// mirando (auditoría UX, F-02): role="alert" y la página no sube al tope. Muestra los
// errores de los campos (en el orden del formulario) o, si no hay, el error del servidor.

import { AlertCircle } from 'lucide-react';

interface FormErrorAlertProps {
  /** Errores de los campos, después de intentar enviar (useFieldErrors().summary). */
  summary: readonly { name: string; message: string }[];
  /** Error del envío (servidor o red), cuando los campos están bien. */
  message?: string;
  className?: string;
}

const FormErrorAlert = ({ summary, message, className = 'mb-4' }: FormErrorAlertProps) => {
  if (!summary.length && !message) return null;
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 ${className}`}
    >
      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
      {summary.length === 0 ? (
        <span>{message}</span>
      ) : summary.length === 1 ? (
        <span>{summary[0].message}</span>
      ) : (
        <div>
          <p className="font-semibold">Revisa estos {summary.length} datos antes de enviar:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {summary.map((e) => (
              <li key={e.name}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FormErrorAlert;
