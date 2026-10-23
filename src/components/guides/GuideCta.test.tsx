// Llamados de las guías (plan del blog, §5.5): el clic hacia /cotizador o /estudio-luminico se
// mide como guia_cta_click (en el texto, guia_texto; en el recuadro final, guia_recuadro). Los
// demás enlaces no lo disparan: el correo ya lo mide contact_email_click en todo el sitio.
// trackGuideCta respeta el consentimiento (lo prueba src/lib/analytics.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { contactEmail, responseTimePromise } from '@/config/business';
import GuideRich from './GuideRich';
import GuideFinalBox from './GuideFinalBox';

vi.mock('@/lib/analytics', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/analytics')>()), trackGuideCta: vi.fn() }));
const { trackGuideCta } = await import('@/lib/analytics');

const PAGE = '/guias/norma-luminica-ds-1-2022';

// jsdom no navega: los clics a mailto: y a otras páginas se quedan aquí (React Router ya los atendió)
const stay = (e: MouseEvent) => e.preventDefault();
beforeEach(() => document.addEventListener('click', stay));
afterEach(() => document.removeEventListener('click', stay));

describe('llamados de una guía', () => {
  it('en el texto: /cotizador y /estudio-luminico se miden como guia_texto; la categoría, el correo y la fuente, no', () => {
    render(
      <MemoryRouter>
        <p>
          <GuideRich
            pagePath={PAGE}
            content={[
              { text: 'solicita una propuesta técnica', to: { route: '/cotizador' } },
              { text: 'estudio lumínico', to: { route: '/estudio-luminico' } },
              { text: 'luminarias de alumbrado público', to: { category: 'alumbrado-publico' } },
              { text: contactEmail, to: { mail: { subject: 'Consulta' } } },
              { text: 'plazos', to: { external: 'https://luminica.mma.gob.cl/plazos-norma-luminica/' } },
            ]}
          />
        </p>
      </MemoryRouter>,
    );
    for (const name of ['luminarias de alumbrado público', contactEmail, 'plazos']) fireEvent.click(screen.getByRole('link', { name }));
    expect(trackGuideCta).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'solicita una propuesta técnica' }));
    fireEvent.click(screen.getByRole('link', { name: 'estudio lumínico' }));
    expect(vi.mocked(trackGuideCta).mock.calls).toEqual([
      ['guia_texto', '/cotizador', PAGE],
      ['guia_texto', '/estudio-luminico', PAGE],
    ]);
    expect(screen.getByRole('link', { name: contactEmail })).toHaveAttribute('href', `mailto:${contactEmail}?subject=Consulta`);
    expect(screen.getByRole('link', { name: 'plazos' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('una guía sin publicar: el trozo que la nombra no se ve', () => {
    render(
      <MemoryRouter>
        <p data-testid="p">
          <GuideRich
            pagePath={PAGE}
            content={['Revisa las áreas', { ifGuide: 'luz-calida-o-fria-en-exteriores', parts: [', y lee la guía ', { text: 'luz cálida', to: { guide: 'luz-calida-o-fria-en-exteriores' } }] }, '.']}
          />
        </p>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('p').textContent).toBe('Revisa las áreas.');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('recuadro final: un botón medido como guia_recuadro, y el correo de ventas con el plazo de respuesta aparte', () => {
    vi.mocked(trackGuideCta).mockClear();
    render(
      <MemoryRouter>
        <GuideFinalBox
          pagePath={PAGE}
          box={{ title: 'Cotiza las luminarias de tu proyecto exterior', text: 'Una oración.', button: { label: 'Solicitar propuesta técnica', route: '/cotizador' } }}
        />
      </MemoryRouter>,
    );
    const button = screen.getByRole('link', { name: 'Solicitar propuesta técnica' });
    expect(button).toHaveAttribute('href', '/cotizador');
    fireEvent.click(button);
    expect(vi.mocked(trackGuideCta).mock.calls).toEqual([['guia_recuadro', '/cotizador', PAGE]]);
    expect(screen.getByRole('link', { name: contactEmail })).toHaveAttribute('href', `mailto:${contactEmail}`);
    expect(screen.getByRole('complementary').textContent).toContain(`O escríbenos a ${contactEmail}. ${responseTimePromise}`);
  });
});
