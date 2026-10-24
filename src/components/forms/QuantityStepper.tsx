// src/components/forms/QuantityStepper.tsx
// Cantidad que se puede escribir (auditoría UX, D-03): un campo entre − y +. Antes era un número
// fijo entre dos botones, y pedir 40 luminarias costaba 39 clics.
// - Campo de texto con teclado numérico y rol de spinbutton (flechas ↑ y ↓), no type="number":
//   así se puede escribir «1.000» con punto de miles, como en Chile (con type="number", Chrome
//   lo dejaba en 1), y la rueda del mouse no cambia la cantidad sin que se note.
// - Cada tecla que deja una cantidad de 1 a MAX_LINE_QUANTITY la cambia (el subtotal y el total
//   siguen al campo). Mientras lo escrito no es una cantidad (vacío, «0», «1.»), la cantidad no
//   cambia; al salir del campo o con Enter vuelve a mostrar la vigente. Enter no saca el foco.
// - El − de una fila de /cotizacion o /solicitar-pedido en 1 quita la línea, como antes; el de la
//   ficha no baja de 1. Quitar con el teclado es el botón de la papelera: ni escribir 0 ni la
//   flecha ↓ quitan la línea.
// - El HTML estático de la ficha (prerender) ya trae el campo: si el visitante escribe antes de
//   que la página termine de cargar, al montar se toma lo escrito (si no, React lo cambiaría por
//   la cantidad del estado en el siguiente render, sin aviso). Con el foco aún en el campo, como
//   si se escribiera en ese momento: «1.0» a medio escribir queda a la vista y las teclas que
//   siguen se suman a eso (antes volvía a «1» y «1.000» terminaba en 100). Fuera del campo, como
//   al salir de él.
// - Nombres accesibles con el producto: «Cantidad de …», «Restar una unidad de …» y «Sumar una
//   unidad de …» (dos filas del mismo producto en dos variantes llevan la variante en el nombre).
// - Letra de 16 px en el teléfono (14 px desde md, como src/components/ui/input.tsx): con menos,
//   Safari de iPhone amplía la página al tocar el campo. Borde y foco con contraste (auditoría UX,
//   H-01: borde #8C93A3, 3,1:1 sobre blanco; foco al 100 %).

import { useEffect, useRef, useState } from 'react';
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
  // Lo escrito, mientras no se muestra la cantidad tal cual: vacío al borrar para escribir otra,
  // «1.» a medio escribir o «1.000» con punto de miles. null = se muestra la vigente.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pdp = variant === 'pdp';

  // Lo escrito → la cantidad y lo que se ve. Si es una cantidad, pasa a ser la vigente; queda a
  // la vista mientras no lo sea, o con punto de miles («1.000»), salvo que pase del tope.
  const applyText = (text: string) => {
    const qty = parseQuantity(text);
    setDraft(qty === null || (text.includes('.') && qty < MAX_LINE_QUANTITY) ? text : null);
    if (qty !== null && qty !== value) onChange(qty);
  };

  // Lo escrito en el HTML estático antes de hidratar (React lo conserva al hidratar, pero lo
  // pisaría en el siguiente render). Solo al montar.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || el.value === String(value)) return;
    if (document.activeElement === el) {
      // Sigue escribiendo: como una tecla más
      applyText(el.value);
      return;
    }
    // Ya salió del campo: como al salir, la cantidad escrita o la vigente
    const typed = parseQuantity(el.value);
    if (typed !== null && typed !== value) onChange(typed);
    else el.value = String(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (next: number) => {
    setDraft(null);
    onChange(Math.min(MAX_LINE_QUANTITY, next));
  };

  const button = cn('hover:bg-accent transition-colors disabled:opacity-40 disabled:hover:bg-transparent', pdp ? 'p-2' : 'p-2.5 sm:p-1.5');
  const icon = pdp ? 'h-4 w-4' : 'h-3 w-3';

  return (
    <div className="flex items-center border border-[#8C93A3] rounded-lg">
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
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={1}
        aria-valuemax={MAX_LINE_QUANTITY}
        aria-label={`Cantidad de ${name}`}
        value={draft ?? String(value)}
        onChange={e => applyText(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            // Confirma sin quitar el foco ni enviar nada
            e.preventDefault();
            setDraft(null);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            step(value + 1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            step(Math.max(1, value - 1));
          }
        }}
        className={cn(
          'bg-transparent text-center text-base md:text-sm font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm',
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
