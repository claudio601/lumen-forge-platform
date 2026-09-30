import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import { RequestCartProvider } from '@/context/RequestCartContext';
import ProductCard from './ProductCard';
import { products, type Product } from '@/data/products';

const base = products[0];

function renderCard(product: Product) {
  return render(
    <MemoryRouter>
      <AppProvider>
        <RequestCartProvider>
          <ProductCard product={product} />
        </RequestCartProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

describe('ProductCard: nunca muestra stock (modelo cotización)', () => {
  beforeEach(() => sessionStorage.clear());

  for (const stock of [true, false, undefined]) {
    it(`stock=${String(stock)} → "Consultar disponibilidad" y ninguna mención a stock`, () => {
      const { container } = renderCard({ ...base, stock });
      expect(screen.getByText('Consultar disponibilidad')).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/(en|sin) stock/i);
    });
  }

  it('los CTA son "Solicitar" (pedido) y "Cotizar": no hay compra directa', () => {
    renderCard(base);
    expect(screen.getByRole('button', { name: /^solicitar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cotizar/i })).toBeInTheDocument();
  });
});
