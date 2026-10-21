// src/components/forms/ProcessSteps.tsx
// Franja de 3 pasos de /cotizacion y /solicitar-pedido (auditoría UX, F-04; textos de las
// secciones 5.2 y 5.3 del informe). Las dos puertas del encabezado se ven siempre, también en
// 0: quien entra a una dice en una línea qué pasa después de enviar, y se distinguen sin
// leer el formulario. Sin plazos: el plazo de respuesta va junto al botón de envío.

interface ProcessStepsProps {
  /** Nombre de la lista para el lector de pantalla ("Cómo funciona la cotización"). */
  label: string;
  steps: readonly [string, string, string];
  className?: string;
}

const ProcessSteps = ({ label, steps, className = '' }: ProcessStepsProps) => (
  <ol aria-label={label} className={`grid gap-2 sm:grid-cols-3 ${className}`}>
    {steps.map((step, i) => (
      <li key={step} className="flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 text-left text-sm">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {i + 1}
        </span>
        <span>{step}</span>
      </li>
    ))}
  </ol>
);

export default ProcessSteps;
