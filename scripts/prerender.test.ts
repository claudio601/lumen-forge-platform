import { describe, expect, it } from 'vitest';
import { fillTemplate, HEAD_MARK, HTML_MARK, markNotFound, outputPath, preloadLinks, type Manifest } from './prerender';

const TEMPLATE = `<!doctype html><html lang="es"><head><meta charset="UTF-8" />${HEAD_MARK}<script type="module" src="/assets/index-a.js"></script></head><body><div id="root">${HTML_MARK}</div></body></html>`;

describe('prerender', () => {
  it('cada ruta va a su carpeta con index.html (así Vercel la sirve sin redirigir)', () => {
    expect(outputPath('/')).toBe('index.html');
    expect(outputPath('/catalogo')).toBe('catalogo/index.html');
    expect(outputPath('/catalogo/paneles-led')).toBe('catalogo/paneles-led/index.html');
    expect(outputPath('/producto/proyector-led-cob-20w-gris-ip65')).toBe('producto/proyector-led-cob-20w-gris-ip65/index.html');
  });

  it('rechaza rutas que saldrían de dist/ o con caracteres raros', () => {
    for (const bad of ['/../etc', '/producto/../../x', 'sin-barra', '/a b', '/x?y=1', '/./x']) {
      expect(() => outputPath(bad), bad).toThrow();
    }
  });

  it('inserta la cabecera, el HTML y las precargas, aunque el contenido traiga "$&" o "$1"', () => {
    const html = fillTemplate(TEMPLATE, '<title>Precio $& y $1</title>', '<main><h1>$$ 1.990 $&</h1></main>', '<link rel="modulepreload" href="/assets/p.js">');
    expect(html).toContain('<title>Precio $& y $1</title>');
    expect(html).toContain('<div id="root"><main><h1>$$ 1.990 $&</h1></main></div>');
    expect(html).toContain('<link rel="modulepreload" href="/assets/p.js"></head>');
    expect(html).not.toContain(HEAD_MARK);
    expect(html).not.toContain(HTML_MARK);
  });

  it('falla si la plantilla no tiene las marcas (dist/index.html ya generado)', () => {
    expect(() => fillTemplate(TEMPLATE.replace(HTML_MARK, ''), '', '')).toThrow(HTML_MARK);
    expect(() => fillTemplate(TEMPLATE.replace(HEAD_MARK, ''), '', '')).toThrow(HEAD_MARK);
  });

  it('precarga el trozo de la página y sus dependencias, sin repetir lo que ya carga index.html', () => {
    const manifest: Manifest = {
      'index.html': { file: 'assets/index-a.js', isEntry: true, imports: ['_vendor-b.js'], css: ['assets/index-a.css'] },
      '_vendor-b.js': { file: 'assets/vendor-b.js' },
      '_products-c.js': { file: 'assets/products-c.js', imports: ['_vendor-b.js'] },
      'src/pages/ProductDetail.tsx': { file: 'assets/ProductDetail-d.js', imports: ['_products-c.js', '_vendor-b.js'], css: ['assets/pd.css'] },
      'src/data/catalog/content/123.json': { file: 'assets/123-e.js' },
    };
    const links = preloadLinks(manifest, ['src/pages/ProductDetail.tsx', 'src/data/catalog/content/123.json']);
    expect(links).toBe(
      '<link rel="stylesheet" crossorigin href="/assets/pd.css">' +
        '<link rel="modulepreload" crossorigin href="/assets/ProductDetail-d.js">' +
        '<link rel="modulepreload" crossorigin href="/assets/products-c.js">' +
        '<link rel="modulepreload" crossorigin href="/assets/123-e.js">',
    );
    expect(() => preloadLinks(manifest, ['src/pages/NoExiste.tsx'])).toThrow('manifiesto');
  });

  it('404.html: marca #root una sola vez para que el navegador hidrate la página "no encontrada"', () => {
    const html = fillTemplate(TEMPLATE, '<title>Página no encontrada</title>', '<main><h1>404</h1></main>');
    expect(markNotFound(html)).toContain('<div id="root" data-not-found=""><main><h1>404</h1></main></div>');
    expect(() => markNotFound(html.replace('<div id="root">', '<div>'))).toThrow('se esperaba');
    expect(() => markNotFound(html + '<div id="root">')).toThrow('hay 2');
  });
});
