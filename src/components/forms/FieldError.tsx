// src/components/forms/FieldError.tsx
// Mensaje bajo un campo con error (auditoría UX, F-02). El campo lo enlaza con
// aria-describedby (useFieldErrors().fieldProps): no lleva role="alert", porque el foco ya
// va al primer campo con error y el resumen junto al botón (FormErrorAlert) es el aviso.

interface FieldErrorProps {
  id: string;
  message?: string;
}

const FieldError = ({ id, message }: FieldErrorProps) =>
  message ? (
    <p id={id} className="mt-1.5 text-sm text-red-700 leading-snug">
      {message}
    </p>
  ) : null;

export default FieldError;
