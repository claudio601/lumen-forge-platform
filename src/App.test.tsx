import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';

describe('rutas: modelo cotización → link de pago', () => {
  beforeEach(() => sessionStorage.clear());

  it('/carro redirige a /solicitar-pedido', async () => {
    window.history.pushState({}, '', '/carro');
    render(<HelmetProvider><App /></HelmetProvider>);
    await waitFor(() => expect(window.location.pathname).toBe('/solicitar-pedido'));
  });
});
