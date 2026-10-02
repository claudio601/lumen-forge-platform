import { describe, expect, it } from 'vitest';
import { sanitizeDescription, splitDescription, unsafeHtmlReasons } from './sanitize-description';

describe('limpieza de la descripción de Jumpseller', () => {
  it('conserva tablas, párrafos, listas, negritas y subtítulos (sin atributos)', () => {
    const html = '<h2 style="color:red">Ficha</h2><p class="x">Panel <b>LED</b> <i>40W</i></p><ul><li>IP65</li></ul><table border="1"><tr><td colspan="2" width="50">Potencia</td></tr></table>';
    expect(sanitizeDescription(html)).toBe(
      '<h3>Ficha</h3><p>Panel <strong>LED</strong> <em>40W</em></p><ul><li>IP65</li></ul><table><tbody><tr><td colspan="2">Potencia</td></tr></tbody></table>',
    );
  });

  it('descarta todo lo ejecutable y lo incrustado', () => {
    const html = '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil"></iframe><svg onload=alert(1)><circle/></svg><style>p{}</style><p onclick="x()">clic</p>';
    const out = sanitizeDescription(html);
    expect(out).toBe('<p>ok</p><p>clic</p>');
    expect(unsafeHtmlReasons(out)).toEqual([]);
  });

  it('enlaces: solo https y mailto, que abren aparte; los demás quedan como texto', () => {
    expect(sanitizeDescription('<a href="https://elights.cl/ficha.pdf" onclick="x">Ficha</a>')).toBe(
      '<a href="https://elights.cl/ficha.pdf" rel="noopener noreferrer nofollow" target="_blank">Ficha</a>',
    );
    expect(sanitizeDescription('<a href="javascript:alert(1)">mal</a><a href="/relativo">rel</a><a href="data:text/html,x">d</a>')).toBe('malreld');
  });

  it('el texto se escapa: un "<script>" escrito como texto no puede ejecutarse', () => {
    const out = sanitizeDescription('<p>usar &lt;script&gt; &amp; "comillas"</p>');
    expect(out).toBe('<p>usar &lt;script&gt; &amp; "comillas"</p>');
  });

  it('div con texto pasa a párrafo; div con bloques se desenvuelve (sin <p> dentro de <p>)', () => {
    expect(sanitizeDescription('<div>Línea 1</div><div><p>A</p><table><tr><td>B</td></tr></table></div>')).toBe(
      '<p>Línea 1</p><p>A</p><table><tbody><tr><td>B</td></tr></tbody></table>',
    );
  });

  it('espacios duros, saltos sobrantes y párrafos vacíos fuera', () => {
    const nbsp = String.fromCharCode(160);
    expect(sanitizeDescription(`<p>220V${nbsp}<br><br><br><br>Fin<br></p><p>${nbsp}</p><p><br></p>`)).toBe('<p>220V <br><br>Fin</p>');
    expect(sanitizeDescription('   ')).toBe('');
    expect(sanitizeDescription('<p><br></p>')).toBe('');
    expect(sanitizeDescription(null)).toBe('');
  });

  it('es estable: limpiar dos veces da lo mismo', () => {
    const html = '<div>x<b>y</b></div><table><tr><th>a</th><td>b<br></td></tr></table>';
    const once = sanitizeDescription(html);
    expect(sanitizeDescription(once)).toBe(once);
  });

  it('la verificación final detecta atributos o URLs no permitidos dentro de las etiquetas, no en el texto', () => {
    expect(unsafeHtmlReasons('<p>el estilo style= y data: en texto</p>')).toEqual([]);
    expect(unsafeHtmlReasons('<p style="x">a</p>')).toContain('atributo no permitido');
    expect(unsafeHtmlReasons('<a href="javascript:x">a</a>')).toContain('URL no permitida');
    expect(unsafeHtmlReasons('<p onmouseover="x">a</p>')).toContain('atributo de evento');
  });

  it('separa las tablas (especificaciones) del texto (descripción)', () => {
    const t = '<table><tbody><tr><td>Base</td><td>G53</td></tr></tbody></table>';
    const p = '<p>Panel extra plano para oficinas, salas de reuniones y pasillos con cielo americano.</p>';
    expect(splitDescription(t)).toEqual({ text: '', specs: t });
    expect(splitDescription(p + t)).toEqual({ text: p, specs: t });
    expect(splitDescription(p)).toEqual({ text: p, specs: '' });
    // un rótulo suelto antes de la tabla no es una descripción
    expect(splitDescription('<p>Especificaciones técnicas:</p>' + t)).toEqual({ text: '', specs: t });
    // tabla dentro de tabla: una sola especificación
    const nested = '<table><tbody><tr><td><table><tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody></table>';
    expect(splitDescription(nested + p)).toEqual({ text: p, specs: nested });
  });

  it('al separar las tablas no quedan viñetas vacías ni subtítulos huérfanos', () => {
    const html = sanitizeDescription(
      '<p>Panel LED para oficinas, salas de reuniones y pasillos de edificios</p><h3>Especificaciones</h3><table><tr><td>Potencia</td><td>40W</td></tr></table>' +
        '<ul><li><table><tr><td>a</td><td>b</td></tr></table></li></ul>',
    );
    const { text, specs } = splitDescription(html);
    expect(text).toBe('<p>Panel LED para oficinas, salas de reuniones y pasillos de edificios</p>');
    expect(specs).toContain('Potencia');
  });
});
