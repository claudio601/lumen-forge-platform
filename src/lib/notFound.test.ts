// src/lib/notFound.test.ts
// Las palabras de una URL sin página (auditoría UX, B-10): precargan el buscador de la 404.

import { describe, expect, it } from 'vitest';
import { NOT_FOUND_SEARCH_STATE, NOT_FOUND_URL, isNotFoundSearch, searchTermsFromPath } from './notFound';

describe('searchTermsFromPath: las palabras de la URL para el buscador de la 404', () => {
  it('un producto que salió del catálogo: las palabras de su id, sin /producto', () => {
    expect(searchTermsFromPath('/producto/lineal-led-flat-40w-120-cm-ip20-6500k')).toBe('lineal led flat 40w 120 cm ip20 6500k');
    expect(searchTermsFromPath('/producto/foco-que-no-existe')).toBe('foco que no existe');
  });

  it('una categoría o una URL de la tienda anterior: sin las partes de ruta ni la extensión', () => {
    expect(searchTermsFromPath('/catalogo/no-existe')).toBe('no existe');
    expect(searchTermsFromPath('/products/campana_led_ufo.html')).toBe('campana led ufo');
    expect(searchTermsFromPath('/Proyector-LED-200W/')).toBe('proyector led 200w');
  });

  it('decodifica tildes y eñes; un % suelto no rompe nada', () => {
    expect(searchTermsFromPath('/alumbrado-p%C3%BAblico-led')).toBe('alumbrado público led');
    expect(searchTermsFromPath('/se%C3%B1al%C3%A9tica')).toBe('señalética');
    expect(searchTermsFromPath('/cinta-100%-led')).toBe('cinta 100 led');
  });

  it('conserva decimales y medidas («14,4w», «2x18w»), sin ids largos ni repeticiones', () => {
    expect(searchTermsFromPath('/cinta-led-14,4w-m')).toBe('cinta led 14.4w m');
    expect(searchTermsFromPath('/tubo-led-2x18w')).toBe('tubo led 2x18w');
    expect(searchTermsFromPath('/producto/2325754')).toBe('');
    expect(searchTermsFromPath('/panel-led/panel-led-60x60')).toBe('panel led 60x60');
  });

  it('hasta 8 palabras y 80 caracteres', () => {
    expect(searchTermsFromPath('/a-b-c-d-e-f-g-h-i-j').split(' ')).toHaveLength(8);
    const long = searchTermsFromPath(`/${'luminaria'.repeat(4)}-${'proyector'.repeat(4)}-${'campana'.repeat(4)}`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long).toBe(`${'luminaria'.repeat(4)} ${'proyector'.repeat(4)}`);
  });

  it('nada en la URL del HTML estático, en la raíz ni en una ruta sin palabras', () => {
    expect(searchTermsFromPath(NOT_FOUND_URL)).toBe('');
    expect(searchTermsFromPath('/')).toBe('');
    expect(searchTermsFromPath('/producto/')).toBe('');
    expect(searchTermsFromPath('/---/')).toBe('');
  });
});

describe('isNotFoundSearch: la navegación a /buscar con el texto que precargó la 404', () => {
  it('solo con NOT_FOUND_SEARCH_STATE', () => {
    expect(isNotFoundSearch(NOT_FOUND_SEARCH_STATE)).toBe(true);
    for (const other of [null, undefined, 'fromNotFound', {}, { fromNotFound: 'true' }]) expect(isNotFoundSearch(other)).toBe(false);
  });
});
