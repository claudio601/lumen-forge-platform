// Cantidad que se puede escribir (auditoría UX, D-03): campo numérico entre − y +, con nombres
// accesibles, el tope del servidor y sin cambiar la cantidad mientras lo escrito no es una.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import QuantityStepper from './QuantityStepper';
import { MAX_LINE_QUANTITY } from '@/lib/quantity';

const NAME = 'Proyector LED 100W';

/** El stepper con su estado, como en la ficha y las filas; onChange registra cada cambio. */
function Harness({ initial = 1, variant, onChange }: { initial?: number; variant?: 'pdp' | 'row'; onChange: (n: number) => void }) {
  const [qty, setQty] = useState(initial);
  return (
    <>
      <QuantityStepper name={NAME} variant={variant} value={qty} onChange={n => { onChange(n); if (n > 0) setQty(n); }} />
      <output data-testid="qty">{qty}</output>
    </>
  );
}

const field = () => screen.getByRole('spinbutton', { name: `Cantidad de ${NAME}` }) as HTMLInputElement;
const minus = () => screen.getByRole('button', { name: `Restar una unidad de ${NAME}` });
const plus = () => screen.getByRole('button', { name: `Sumar una unidad de ${NAME}` });
const shown = () => screen.getByTestId('qty').textContent;

describe('QuantityStepper', () => {
  it('campo numérico con nombre propio, entre − y +, de 1 al tope del servidor', () => {
    render(<Harness onChange={vi.fn()} />);
    expect(field()).toHaveAttribute('type', 'number');
    expect(field()).toHaveAttribute('inputmode', 'numeric');
    expect(field()).toHaveAttribute('min', '1');
    expect(field()).toHaveAttribute('max', String(MAX_LINE_QUANTITY));
    expect(field().value).toBe('1');
    expect(minus()).toHaveAttribute('type', 'button');
    expect(plus()).toHaveAttribute('type', 'button');
  });

  it('escribir 40 deja 40 sin 39 clics', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '40' } });
    expect(onChange).toHaveBeenLastCalledWith(40);
    expect(shown()).toBe('40');
    expect(field().value).toBe('40');
    fireEvent.click(plus());
    expect(shown()).toBe('41');
    expect(field().value).toBe('41');
  });

  it('vacío o 0 no cambian la cantidad; al salir del campo vuelve a mostrar la vigente', () => {
    const onChange = vi.fn();
    render(<Harness initial={12} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '' } });
    expect(field().value).toBe('');
    fireEvent.change(field(), { target: { value: '0' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(shown()).toBe('12');
    fireEvent.blur(field());
    expect(field().value).toBe('12');
  });

  it('con el campo vacío, + suma sobre la cantidad vigente', () => {
    render(<Harness initial={5} onChange={vi.fn()} />);
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.click(plus());
    expect(field().value).toBe('6');
  });

  it('más del tope queda en el tope, y + se deshabilita ahí', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '25000' } });
    expect(onChange).toHaveBeenLastCalledWith(MAX_LINE_QUANTITY);
    expect(field().value).toBe(String(MAX_LINE_QUANTITY));
    expect(plus()).toBeDisabled();
  });

  it('fila de una lista: − en 1 entrega 0 (la página quita la línea, como antes)', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(minus()).toBeEnabled();
    fireEvent.click(minus());
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('ficha: − no baja de 1 (deshabilitado en 1)', () => {
    const onChange = vi.fn();
    render(<Harness variant="pdp" initial={2} onChange={onChange} />);
    fireEvent.click(minus());
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(minus()).toBeDisabled();
  });

  it('Enter sale del campo (sin enviar nada) y deja la cantidad escrita', () => {
    render(<Harness onChange={vi.fn()} />);
    field().focus();
    fireEvent.change(field(), { target: { value: '8' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(document.activeElement).not.toBe(field());
    expect(field().value).toBe('8');
  });
});
