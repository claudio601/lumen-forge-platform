// src/lib/searchTracking.test.ts
// Cada búsqueda de /buscar se mide una vez por entrada del historial (search, auditoría UX KPI 9):
// «Atrás» y recargar no la repiten; una carga nueva de la página sí cuenta otra vez.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'elights_search_tracked';

/** El módulo de nuevo, como en una carga de página nueva, con el tipo de carga del navegador. */
async function freshLoad(type?: NavigationTimingType) {
  vi.resetModules();
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue(type ? ([{ type }] as unknown as PerformanceEntryList) : []);
  return import('./searchTracking');
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('claimSearch: una vez por entrada del historial', () => {
  it('la primera vez sí; la misma consulta en la misma entrada, no; en otra entrada, sí', async () => {
    const { claimSearch } = await freshLoad('navigate');
    expect(claimSearch('abc123', 'campana')).toBe(true);
    expect(claimSearch('abc123', 'campana')).toBe(false);
    expect(claimSearch('abc123', 'panel')).toBe(true);
    expect(claimSearch('xyz789', 'campana')).toBe(true);
  });

  it('una recarga (la misma entrada) no repite; la marca no guarda el texto buscado', async () => {
    (await freshLoad('navigate')).claimSearch('abc123', 'campana ufo');
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toContain('campana');
    expect((await freshLoad('reload')).claimSearch('abc123', 'campana ufo')).toBe(false);
  });

  it('la primera entrada de la carga (default): se olvida en una carga nueva, no al recargar ni con «Atrás»', async () => {
    expect((await freshLoad('navigate')).claimSearch('default', 'panel')).toBe(true);
    expect((await freshLoad('reload')).claimSearch('default', 'panel')).toBe(false);
    expect((await freshLoad('back_forward')).claimSearch('default', 'panel')).toBe(false);
    const load = await freshLoad('navigate');
    expect(load.claimSearch('default', 'panel')).toBe(true);
    // Dentro de la misma carga, la entrada default vuelve a ser la misma («Atrás» dentro de la app)
    expect(load.claimSearch('default', 'panel')).toBe(false);
  });

  it('sin el tipo de carga (navegador antiguo): cuenta como carga nueva', async () => {
    (await freshLoad('navigate')).claimSearch('default', 'panel');
    expect((await freshLoad()).claimSearch('default', 'panel')).toBe(true);
  });

  it('guarda hasta 50 marcas; las más antiguas salen primero', async () => {
    const { claimSearch } = await freshLoad('navigate');
    for (let i = 0; i < 51; i++) claimSearch(`k${i}`, 'panel');
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toHaveLength(50);
    expect(claimSearch('k50', 'panel')).toBe(false);
    expect(claimSearch('k0', 'panel')).toBe(true);
  });

  it('con sessionStorage bloqueado o alterado no rompe: queda en memoria', async () => {
    const { claimSearch } = await freshLoad('navigate');
    sessionStorage.setItem(STORAGE_KEY, '{');
    expect(claimSearch('abc123', 'panel')).toBe(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(claimSearch('abc123', 'panel')).toBe(false);
    expect(claimSearch('abc123', 'campana')).toBe(true);
    expect(claimSearch('abc123', 'campana')).toBe(false);
  });
});
