// src/components/forms/QuantityStepper.tsx
// Cantidad que se puede escribir (auditoría UX, D-03): un campo numérico entre − y +. Antes era
// un número fijo entre dos botones, y pedir 40 luminarias costaba 39 clics.
// - Cada tecla que deja un entero de 1 a MAX_LINE_QUANTITY cambia la cantidad (el subtotal y el
//   total siguen al campo). Mientras el campo está vacío o con algo que no es una cantidad
//   («0», «-»), la cantidad no cambia; al salir del campo vuelve a mostrar la vigente.
// - El − de una fila de /cotizacion o /solicitar-pedido en 1 quita la línea, como antes; el de la
//   ficha no baja de 1. Quitar con el teclado es el botón de la papelera, nunca escribir 0.
// - Nombres accesibles con el producto: «Cantidad de …», «Restar una unidad de …» y «Sumar una
//   unidad de …» (dos filas del mismo producto en dos variantes llevan la variante en el nombre).

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { MAX_LINE_QUANTITY, parseQuantity } from '@/lib/quantity';
import { cn } from '@/lib/utils';

interface Props {
  value: number;
  /** Cantidad nueva. En una fila, el − en 1 entrega 0 (la página quita la línea). */
  onChange: (qty: number) => void;
  /** Producto (y su variante) en los nombres accesibles. */
  name: string;
  /** 'pdp': la ficha (botones más grandes, no baja de 1); 'row': una fila de las dos listas. */
  variant?: 'pdp' | 'row';
  id?: string;
}

const QuantityStepper = ({ value, onChange, name, variant = 'row', id }: Props) => {
  // Lo escrito mientras no es una cantidad (vacío al borrar para escribir otra); null = la vigente
  const [draft, setDraft] = useState<string | null>(null);
  const pdp = variant === 'pdp';

  const step = (next: number) => {
    setDraft(null);
    onChange(Math.min(MAX_LINE_QUANTITY, next));
  };

  const button = cn('hover:bg-accent transition-colors disabled:opacity-40 disabled:hover:bg-transparent', pdp ? 'p-2' : 'p-2.5 sm:p-1.5');
  const icon = pdp ? 'h-4 w-4' : 'h-3 w-3';

  return (
    <div className="flex items-center border rounded-lg">
      <button
        type="button"
        aria-label={`Restar una unidad de ${name}`}
        className={button}
        disabled={pdp && value <= 1}
        onClick={() => step(pdp ? Math.max(1, value - 1) : value - 1)}
      >
        <Minus className={icon} />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_LINE_QUANTITY}
        step={1}
        aria-label={`Cantidad de ${name}`}
        value={draft ?? String(value)}
        onChange={e => {
          const qty = parseQuantity(e.target.value);
          if (qty === null) {
            setDraft(e.target.value);
            return;
          }
          setDraft(null);
          if (qty !== value) onChange(qty);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        // La rueda del mouse sobre el campo enfocado cambiaría la cantidad sin que se note
        onWheel={e => e.currentTarget.blur()}
        className={cn(
          'bg-transparent text-center text-sm font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          pdp ? 'w-16 h-9' : 'w-12 h-8',
        )}
      />
      <button
        type="button"
        aria-label={`Sumar una unidad de ${name}`}
        className={button}
        disabled={value >= MAX_LINE_QUANTITY}
        onClick={() => step(value + 1)}
      >
        <Plus className={icon} />
      </button>
    </div>
  );
};

export default QuantityStepper;
