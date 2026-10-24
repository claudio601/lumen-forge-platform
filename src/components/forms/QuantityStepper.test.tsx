// Cantidad que se puede escribir (auditoría UX, D-03): campo numérico entre − y +, con nombres
// accesibles, el tope del servidor y sin cambiar la cantidad mientras lo escrito no es una.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
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
  it('campo con teclado numérico y nombre propio, entre − y +, de 1 al tope del servidor', () => {
    render(<Harness onChange={vi.fn()} />);
    // Texto y no type="number": con type="number", «1.000» quedaba en 1
    expect(field()).toHaveAttribute('type', 'text');
    expect(field()).toHaveAttribute('inputmode', 'numeric');
    expect(field()).toHaveAttribute('aria-valuemin', '1');
    expect(field()).toHaveAttribute('aria-valuemax', String(MAX_LINE_QUANTITY));
    expect(field()).toHaveAttribute('aria-valuenow', '1');
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

  it('Enter confirma sin sacar el foco del campo ni enviar nada', () => {
    render(<Harness onChange={vi.fn()} />);
    field().focus();
    fireEvent.change(field(), { target: { value: '8' } });
    const enter = fireEvent.keyDown(field(), { key: 'Enter' });
    expect(enter).toBe(false); // preventDefault: no envía un formulario
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('8');
    // Con el campo vacío, Enter vuelve a mostrar la cantidad vigente
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('8');
  });

  it('«1.000» con punto de miles, tecla por tecla, deja 1000 (no 1)', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    field().focus();
    for (const typed of ['1', '1.', '1.0', '1.00', '1.000']) fireEvent.change(field(), { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(1000);
    expect(shown()).toBe('1000');
    expect(field().value).toBe('1.000');
    fireEvent.blur(field());
    expect(field().value).toBe('1000');
    expect(shown()).toBe('1000');
  });

  it('pegar «2.500» deja 2500; «12.000» queda en el tope', () => {
    render(<Harness onChange={vi.fn()} />);
    fireEvent.change(field(), { target: { value: '2.500' } });
    expect(shown()).toBe('2500');
    fireEvent.change(field(), { target: { value: '12.000' } });
    expect(shown()).toBe(String(MAX_LINE_QUANTITY));
    expect(field().value).toBe(String(MAX_LINE_QUANTITY));
  });

  it('flechas ↑ y ↓ suman y restan; ↓ no baja de 1 ni quita la línea', () => {
    const onChange = vi.fn();
    render(<Harness initial={2} onChange={onChange} />);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(shown()).toBe('3');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(shown()).toBe('1');
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it('lo escrito en el HTML estático antes de hidratar no se pierde', async () => {
    const onChange = vi.fn();
    const tree = <Harness variant="pdp" onChange={onChange} />;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    const input = container.querySelector('input')!;
    // El visitante escribe 40 en la página estática, antes de que cargue el JavaScript
    input.value = '40';
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, tree); });
      expect(onChange).toHaveBeenCalledWith(40);
      expect(container.querySelector('output')!.textContent).toBe('40');
      expect(input.value).toBe('40');
      // Un cambio posterior parte de 40, no de 1
      await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label^="Sumar"]')!.click(); });
      expect(input.value).toBe('41');
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it('sin nada escrito antes de hidratar, montar no cambia la cantidad', async () => {
    const onChange = vi.fn();
    const tree = <Harness initial={3} onChange={onChange} />;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, tree); });
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it('letra de 16 px en el teléfono (Safari de iPhone no amplía la página) y foco al 100 %', () => {
    render(<Harness onChange={vi.fn()} />);
    expect(field().className).toMatch(/(^|\s)text-base(\s|$)/);
    expect(field().className).toMatch(/(^|\s)md:text-sm(\s|$)/);
    expect(field().className).toMatch(/focus-visible:ring-primary(\s|$)/);
  });
});
