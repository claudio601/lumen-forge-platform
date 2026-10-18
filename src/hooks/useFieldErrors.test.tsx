// useFieldErrors (auditoría UX, F-02): el foco llega al campo cuando ya muestra su error.
// Si el foco se diera antes de dibujar, el lector de pantalla anunciaría el campo sin
// aria-invalid ni su mensaje, y no lo volvería a leer al aparecer (WCAG 3.3.1).

import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useFieldErrors } from './useFieldErrors';

type Field = 'nombre' | 'correo';
type Values = Record<Field, string>;
const ORDER = ['nombre', 'correo'] as const;
const validate = (name: Field, v: Values) => (v[name].trim() ? null : `Falta ${name}.`);

let setServerError: (name: Field, message: string) => void = () => {};

function Form() {
  const [values] = useState<Values>({ nombre: '', correo: '' });
  const fe = useFieldErrors<Field, Values>('t-', validate, ORDER);
  setServerError = fe.setError;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        fe.checkAll(ORDER, values);
      }}
    >
      {ORDER.map((name) => (
        <div key={name}>
          <label htmlFor={`t-${name}`}>{name}</label>
          <input {...fe.fieldProps(name)} name={name} />
          {fe.errors[name] && <p id={fe.errorId(name)}>{fe.errors[name]}</p>}
        </div>
      ))}
      <button type="submit">Enviar</button>
    </form>
  );
}

/** Lo que tiene el campo en el momento exacto en que recibe el foco. */
function recordOnFocus(input: HTMLElement) {
  const seen: { invalid: string | null; description: string | null }[] = [];
  input.addEventListener('focus', () => {
    const id = input.getAttribute('aria-describedby');
    seen.push({ invalid: input.getAttribute('aria-invalid'), description: id ? document.getElementById(id)?.textContent ?? null : null });
  });
  return seen;
}

describe('useFieldErrors: el foco va al campo con su error ya dibujado', () => {
  it('al enviar (checkAll): el primer campo con error ya tiene aria-invalid y aria-describedby al recibir el foco', () => {
    render(<Form />);
    const nombre = screen.getByLabelText('nombre');
    const seen = recordOnFocus(nombre);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(nombre).toHaveFocus();
    expect(seen).toEqual([{ invalid: 'true', description: 'Falta nombre.' }]);
  });

  it('un error del servidor (setError, después de esperar la respuesta): igual', async () => {
    render(<Form />);
    const correo = screen.getByLabelText('correo');
    const seen = recordOnFocus(correo);
    // Como en las páginas: llega después de un await, fuera del evento del botón
    await act(async () => {
      await Promise.resolve();
      setServerError('correo', 'No pudimos validar tu correo.');
    });
    expect(correo).toHaveFocus();
    expect(seen).toEqual([{ invalid: 'true', description: 'No pudimos validar tu correo.' }]);
  });
});
