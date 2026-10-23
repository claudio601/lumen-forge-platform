// src/components/forms/RequestConfirmation.test.tsx
// La confirmación de /solicitar-pedido, /cotizacion y /cotizador enlaza un correo a ventas@ con
// la referencia en el asunto. Con la medición aceptada, ese clic (contact_email_click) llega a la
// capa de datos sin el asunto: la referencia nunca va a Google ni a Meta (especificación 3.5).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestConfirmation from './RequestConfirmation';

const ALL = { analytics: true, ads: true, meta: true, origin: true };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  delete window.dataLayer;
  delete window.gtag;
  if (window.__elightsContactClick) {
    document.removeEventListener('click', window.__elightsContactClick, true);
    delete window.__elightsContactClick;
  }
  document.head.innerHTML = '';
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('RequestConfirmation: el correo con la referencia y la medición', () => {
  it.each(['RC-abc12', 'NE-x9y8z7', 'PY-q1w2e3'])('el clic en el correo con %s empuja contact_email_click sin la referencia', async reference => {
    vi.resetModules();
    vi.stubEnv('VITE_GTM_ID', 'GTM-TEST123');
    vi.stubEnv('VITE_ANALYTICS_HOSTS', 'localhost');
    const a = await import('@/lib/analytics');
    const cc = await import('@/lib/cookieConsent');
    a.applyCookieChoice(cc.setCookieChoice(ALL));

    render(
      <MemoryRouter>
        <RequestConfirmation
          form="request-order"
          idPrefix="rc"
          title="Recibimos tu solicitud"
          reference={reference}
          steps={['Uno', 'Dos', 'Tres']}
          seo={null}
          back={{ to: '/catalogo', label: 'Volver al catálogo' }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'ventas@elights.cl' });
    // El enlace sigue llevando la referencia para quien escribe (asunto ya escrito)
    expect(link.getAttribute('href')).toBe(`mailto:ventas@elights.cl?subject=${encodeURIComponent(`Solicitud ${reference}`)}`);
    link.addEventListener('click', e => e.preventDefault()); // jsdom no navega
    link.click();

    const entries = (window.dataLayer ?? []).filter(e => Object.prototype.toString.call(e) !== '[object Arguments]') as Record<string, unknown>[];
    const clicks = entries.filter(e => e.event === 'contact_email_click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ link_url: 'mailto:ventas@elights.cl', link_type: 'email' });
    expect(JSON.stringify(entries)).not.toMatch(/\b(RC|NE|PY)-[a-z0-9]/i);
  });
});

// /cotizador con adjuntos (especificación «Adjuntar archivos», §1): una línea con la cantidad de
// archivos, en la descripción del título; sin archivos, la confirmación queda como antes.
describe('RequestConfirmation: archivos que llegaron', () => {
  const renderWith = (attachments: number | undefined, reference = 'PY-f1l3s') =>
    render(
      <MemoryRouter>
        <RequestConfirmation
          form="cotizador"
          idPrefix="sq-sent"
          title="Propuesta solicitada"
          reference={reference}
          attachments={attachments}
          steps={['Uno', 'Dos', 'Tres']}
          seo={null}
          back={{ to: '/', label: 'Volver al inicio' }}
        />
      </MemoryRouter>,
    );

  it.each([
    [3, 'Recibimos tu solicitud PY-f1l3s y tus 3 archivos. Si te falta alguno, envíalo a ventas@elights.cl con tu número de solicitud.'],
    [1, 'Recibimos tu solicitud PY-f1l3s y tu archivo. Si te falta alguno, envíalo a ventas@elights.cl con tu número de solicitud.'],
  ])('%i archivo(s): la línea y el título la lee', (count, line) => {
    renderWith(count);
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Propuesta solicitada' }).getAttribute('aria-describedby')).toBe('sq-sent-detail sq-sent-ref sq-sent-files');
    // Un solo enlace al correo (el de siempre, con la referencia en el asunto)
    expect(screen.getAllByRole('link', { name: 'ventas@elights.cl' })).toHaveLength(1);
  });

  it('sin referencia, la línea igual se lee bien', () => {
    renderWith(2, '');
    expect(screen.getByText('Recibimos tu solicitud y tus 2 archivos. Si te falta alguno, envíalo a ventas@elights.cl con tu número de solicitud.')).toBeInTheDocument();
  });

  it.each([0, undefined])('con %s archivos no hay línea', (count) => {
    renderWith(count);
    expect(screen.queryByText(/Recibimos tu solicitud/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Propuesta solicitada' }).getAttribute('aria-describedby')).toBe('sq-sent-detail sq-sent-ref');
  });
});
