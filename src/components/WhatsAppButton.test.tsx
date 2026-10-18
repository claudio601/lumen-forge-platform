// Botón flotante de WhatsApp (auditoría UX, F-03; dueño, 2026-10-17): no se ofrece mientras
// se ve una confirmación de /cotizacion, /solicitar-pedido o /cotizador. A quien ya tiene una
// referencia, un WhatsApp le abriría un segundo negocio para la misma solicitud. Al salir de
// la confirmación, el botón vuelve.

import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatsAppButton from './WhatsAppButton';
import RequestConfirmation from './forms/RequestConfirmation';
import { useHideWhatsAppButton } from '@/hooks/useHideWhatsAppButton';

const waButton = () => screen.queryByRole('button', { name: /Contactar por WhatsApp/ });

function Hider() {
  useHideWhatsAppButton();
  return null;
}

/** Como AppLayout: la página (formulario o confirmación) y el botón flotante, a la vez. */
function Layout() {
  const [sent, setSent] = useState(false);
  return (
    <MemoryRouter>
      {sent ? (
        <RequestConfirmation
          form="prueba"
          idPrefix="t-sent"
          title="Solicitud enviada"
          reference="RC-PRUEBA-0001"
          steps={['Paso uno.', 'Paso dos.', 'Paso tres.']}
          seo={null}
          back={{ to: '/catalogo', label: 'Seguir explorando' }}
        />
      ) : (
        <button type="button" onClick={() => setSent(true)}>
          Enviar
        </button>
      )}
      {sent && (
        <button type="button" onClick={() => setSent(false)}>
          Volver al formulario
        </button>
      )}
      <WhatsAppButton />
    </MemoryRouter>
  );
}

describe('WhatsAppButton y las confirmaciones', () => {
  it('se ve en el formulario, se esconde en la confirmación y vuelve al salir de ella', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<Layout />);
    expect(waButton()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.getByRole('heading', { name: 'Solicitud enviada' })).toBeInTheDocument();
    expect(waButton()).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="wa.me"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volver al formulario' }));
    expect(waButton()).toBeInTheDocument();
  });

  it('con dos pedidos de esconderlo, vuelve solo cuando se desmontan los dos', () => {
    const { rerender } = render(
      <>
        <Hider />
        <Hider />
        <WhatsAppButton />
      </>,
    );
    expect(waButton()).not.toBeInTheDocument();
    rerender(
      <>
        <Hider />
        <WhatsAppButton />
      </>,
    );
    expect(waButton()).not.toBeInTheDocument();
    rerender(<WhatsAppButton />);
    expect(waButton()).toBeInTheDocument();
  });
});
