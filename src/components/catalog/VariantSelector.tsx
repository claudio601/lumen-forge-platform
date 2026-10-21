// src/components/catalog/VariantSelector.tsx
// Selector de variante de la ficha (auditoría UX, D-01): un grupo de opciones por cada opción
// de Jumpseller (potencia, temperatura o color de luz, color de la carcasa), con etiquetas
// limpias (src/lib/variants.ts). Cada opción es una tarjeta de 44 px de alto con su radio
// (RadioGroup de Radix: flechas y Tab con el teclado). Si el eje decide el precio, cada opción
// lo muestra. Nunca afirma certificados ni muestra stock.
// El valor de cada radio es la posición de la opción, no el texto de Jumpseller: el HTML
// publicado (prerender) no lleva el texto crudo («Luz Cálida - 2200K - 1% Luz Azul»).

import { useId } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { ProductVariant } from '@/data/catalog/types';
import { axisPrices, choiceAvailable, type VariantAxis, type VariantSelection } from '@/lib/variants';
import { cn } from '@/lib/utils';

interface Props {
  axes: readonly VariantAxis[];
  variants: readonly ProductVariant[];
  selection: VariantSelection;
  onSelect: (axisName: string, value: string) => void;
  /** Precio en el modo del selector del encabezado (con IVA o neto). */
  formatPrice: (gross: number) => string;
  /** Instrucción o estado («Elige una temperatura de color para continuar»). */
  hint: string;
  /** id del texto de la instrucción: los botones de la ficha lo citan en aria-describedby. */
  hintId: string;
}

const VariantSelector = ({ axes, variants, selection, onSelect, formatPrice, hint, hintId }: Props) => {
  const baseId = useId();
  return (
    <div className="mb-4 p-4 border rounded-xl bg-surface space-y-4" data-variant-selector="">
      {axes.map((axis, i) => {
        const legendId = `${baseId}-eje-${i}`;
        const prices = axisPrices(variants, axis, selection);
        const picked = axis.choices.findIndex(c => c.value === selection[axis.name]);
        return (
          <div key={axis.name}>
            <p id={legendId} className="text-sm font-semibold mb-2">
              {axis.legend} <span className="text-destructive" aria-hidden="true">*</span>
            </p>
            <RadioGroup
              aria-labelledby={legendId}
              required
              value={picked >= 0 ? String(picked) : ''}
              onValueChange={position => {
                const choice = axis.choices[Number(position)];
                if (choice) onSelect(axis.name, choice.value);
              }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            >
              {axis.choices.map((choice, j) => {
                const id = `${legendId}-${j}`;
                const checked = picked === j;
                const available = choiceAvailable(variants, axis, choice.value, selection);
                const price = prices?.get(choice.value);
                return (
                  <label
                    key={choice.value}
                    htmlFor={id}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm transition-colors',
                      available ? 'cursor-pointer hover:border-primary/60' : 'cursor-not-allowed opacity-50',
                      checked && 'border-primary ring-1 ring-primary bg-primary/5',
                    )}
                  >
                    <RadioGroupItem value={String(j)} id={id} disabled={!available} />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{choice.label}</span>
                      {choice.detail && <span className="block text-xs text-muted-foreground">{choice.detail}</span>}
                    </span>
                    {price !== undefined && (
                      <span className="text-xs font-semibold whitespace-nowrap">{formatPrice(price)}</span>
                    )}
                  </label>
                );
              })}
            </RadioGroup>
          </div>
        );
      })}
      <p id={hintId} className="text-xs text-muted-foreground" aria-live="polite">
        {hint}
      </p>
    </div>
  );
};

export default VariantSelector;
