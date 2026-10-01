// El módulo de analytics se importa al generar páginas estáticas en Node
// (Etapa 2, prerender): no debe tocar window ni document al importarse ni al llamarse.

import { afterEach, describe, expect, it, vi } from 'vitest';

// Ruta en variable: el tsconfig de scripts/ no incluye tipos del navegador, así que
// el módulo se importa sin que tsc lo revise aquí (ya lo revisa el de src/).
const MODULE = '../src/lib/analytics';

interface Analytics {
  sendPageView(path: string): void;
  sendEvent(name: string, params?: Record<string, string | number | boolean>): void;
  trackLead(formType: string, params?: Record<string, string | number | boolean>): void;
}

describe('analytics en Node (sin navegador)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('importar y llamar con un ID real no falla y no hace nada', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');
    const a = (await import(/* @vite-ignore */ MODULE)) as Analytics;
    expect(typeof (globalThis as Record<string, unknown>).window).toBe('undefined');
    expect(() => {
      a.sendPageView('/');
      a.sendEvent('x', { a: 1 });
      a.trackLead('solicitud_pedido');
    }).not.toThrow();
  });
});
