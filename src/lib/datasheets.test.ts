import { describe, it, expect } from 'vitest';
import { datasheetLinks, productDatasheetLinks } from './datasheets';

const CDN = 'https://images.jumpseller.com/store/elights-cl/11521285/attachments';
const flyhawk = (w: number) => `${CDN}/ab${w}/luminaria-solar-led-${w}w-alumbrado-publico-flyhaw-elights.pdf?1773013074`;

describe('datasheetLinks', () => {
  it('un PDF: «Ficha técnica»', () => {
    expect(datasheetLinks([flyhawk(80)])).toEqual([{ href: flyhawk(80), label: 'Ficha técnica' }]);
    expect(datasheetLinks([])).toEqual([]);
  });

  it('varios PDF, uno por potencia: cada botón con su potencia, de menor a mayor', () => {
    expect(datasheetLinks([flyhawk(80), flyhawk(60), flyhawk(40)])).toEqual([
      { href: flyhawk(40), label: 'Ficha técnica 40W' },
      { href: flyhawk(60), label: 'Ficha técnica 60W' },
      { href: flyhawk(80), label: 'Ficha técnica 80W' },
    ]);
  });

  it('lee la potencia codificada, con guion bajo o con espacio, e ignora la que comparten todos', () => {
    const a = `${CDN}/aa/FT_FLYHAWK_40-80W_PANEL%2060W_eLIGHTS.cl.pdf`;
    const b = `${CDN}/bb/FT_FLYHAWK_40-80W_PANEL%2040%20W_eLIGHTS.cl.pdf`;
    expect(datasheetLinks([a, b]).map(l => l.label)).toEqual(['Ficha técnica 40W', 'Ficha técnica 60W']);
  });

  it('si los nombres no distinguen la potencia, numera en el orden de Jumpseller', () => {
    const a = `${CDN}/aa/ficha-tecnica.pdf`;
    const b = `${CDN}/bb/certificado-sec-100w.pdf?0`;
    const c = `${CDN}/cc/manual-100w.pdf`;
    expect(datasheetLinks([a, b]).map(l => l.label)).toEqual(['Ficha técnica 1', 'Ficha técnica 2']);
    expect(datasheetLinks([b, c]).map(l => l.label)).toEqual(['Ficha técnica 1', 'Ficha técnica 2']);
  });

  it('no confunde una potencia con parte de otra cifra o palabra', () => {
    const a = `${CDN}/aa/proyector-1.5w-200w.pdf`;
    const b = `${CDN}/bb/proyector-300wx-100w.pdf`;
    expect(datasheetLinks([a, b]).map(l => l.label)).toEqual(['Ficha técnica 100W', 'Ficha técnica 200W']);
  });
});

describe('productDatasheetLinks', () => {
  it('el PDF editorial (BESTLED) gana sobre los de Jumpseller', () => {
    expect(productDatasheetLinks('/fichas/APB40.pdf', [flyhawk(80)])).toEqual([{ href: '/fichas/APB40.pdf', label: 'Ficha técnica' }]);
    expect(productDatasheetLinks(undefined, [flyhawk(80)])).toEqual([{ href: flyhawk(80), label: 'Ficha técnica' }]);
    expect(productDatasheetLinks(undefined, undefined)).toEqual([]);
  });
});
