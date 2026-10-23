// Pie de página (PR 12): las 6 páginas legales y de compra (LEGAL_PAGES), ningún enlace legal
// a '/', la razón social y el RUT de la empresa y el horario de businessHours. PR 13: el botón
// «Configurar cookies». El popup de
// WhatsApp con el mismo horario lo revisa src/config/contentTruth.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';
import { LEGAL_PAGES } from '@/config/legal';
import { businessHours } from '@/config/business';
import { OPEN_COOKIE_SETTINGS_EVENT } from '@/lib/cookieConsent';

function renderFooter() {
  render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
  return screen.getByRole('contentinfo');
}

describe('pie de página', () => {
  it('enlaza las 6 páginas legales y de compra, cada una a su ruta', () => {
    const footer = renderFooter();
    for (const { path, label } of LEGAL_PAGES) {
      expect(within(footer).getByRole('link', { name: label })).toHaveAttribute('href', path);
    }
    // Columnas "Empresa" (quiénes somos y las páginas de venta) y "Ayuda" (las demás)
    const help = within(footer).getByRole('navigation', { name: 'Ayuda' });
    expect(within(help).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(LEGAL_PAGES.filter(p => p.path !== '/empresa').map(p => p.path));
    const company = within(footer).getByRole('navigation', { name: 'Empresa' });
    expect(within(company).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/empresa', '/cotizacion', '/estudio-luminico', '/instaladores', '/cotizador', '/guias']);
    // «Asesoría técnica» (auditoría UX, E-02): al estudio lumínico mientras no exista /asesoria
    expect(within(company).getByRole('link', { name: 'Asesoría técnica' })).toHaveAttribute('href', '/estudio-luminico');
    // Guías (plan del blog, §5.4): el índice /guias, desde la primera guía publicada
    expect(within(company).getByRole('link', { name: 'Guías' })).toHaveAttribute('href', '/guias');
  });

  it('«Configurar cookies» (PR 13): un botón al final de "Ayuda", estático, que abre el diálogo de cookies', () => {
    const footer = renderFooter();
    const help = within(footer).getByRole('navigation', { name: 'Ayuda' });
    const button = within(help).getByRole('button', { name: 'Configurar cookies' });
    expect(button).toHaveAttribute('type', 'button');
    expect(help.lastElementChild).toBe(button);
    const onOpen = vi.fn();
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
    fireEvent.click(button);
    window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
    expect(onOpen).toHaveBeenCalledTimes(1);
    // En el HTML del servidor (páginas estáticas) también está
    const html = renderToString(
      <StaticRouter location="/">
        <Footer />
      </StaticRouter>,
    );
    expect(html).toContain('>Configurar cookies</button>');
  });

  it('ningún enlace con texto legal apunta a la portada', () => {
    const footer = renderFooter();
    const labels = new Set<string>(LEGAL_PAGES.map(p => p.label));
    const toHome = within(footer).getAllByRole('link').filter(a => a.getAttribute('href') === '/');
    expect(toHome.filter(a => labels.has(a.textContent?.trim() ?? ''))).toEqual([]);
  });

  it('razón social, RUT de la empresa, Santiago y el horario de elights.cl', () => {
    const footer = renderFooter();
    const text = footer.textContent ?? '';
    expect(text).toContain('eLIGHTS.CL SpA');
    expect(text).toContain('RUT 76.947.784-6');
    expect(text).toContain('Santiago, Chile');
    expect(text).toContain(businessHours);
    expect(text).not.toContain('9:00-18:00');
    expect(text).not.toContain('Todos los derechos reservados');
  });

  it('línea legal: en el teléfono la comuna baja a su propia línea, centrada y sin un "·" colgando', () => {
    const footer = renderFooter();
    const rut = within(footer).getByText(/RUT 76\.947\.784-6/);
    expect(rut).toHaveClass('whitespace-nowrap');
    const line = rut.parentElement!;
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^© \d{4} eLIGHTS\.CL SpA · RUT 76\.947\.784-6 · Santiago, Chile$/);
    expect(line.parentElement).toHaveClass('text-center', 'sm:text-left');
    // El segundo "·" solo se ve desde sm; en el teléfono lo reemplaza el salto de línea
    expect(line.querySelector('br')).toHaveClass('sm:hidden');
    const separators = [...line.children].filter(el => el.textContent?.trim() === '·');
    expect(separators).toHaveLength(1);
    expect(separators[0]).toHaveClass('hidden', 'sm:inline');
    for (const span of line.querySelectorAll('span')) {
      if (span !== separators[0]) expect(span).toHaveClass('whitespace-nowrap');
    }
  });
});
