// Pie de página (PR 12): las 6 páginas legales y de compra (LEGAL_PAGES), ningún enlace legal
// a '/', la razón social y el RUT de la empresa y el horario de businessHours. El popup de
// WhatsApp con el mismo horario lo revisa src/config/contentTruth.test.ts.

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';
import { LEGAL_PAGES } from '@/config/legal';
import { businessHours } from '@/config/business';

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
    expect(within(company).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/empresa', '/cotizacion', '/instaladores', '/cotizador']);
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
