// Descripciones sincronizadas desde Jumpseller: se muestran con dangerouslySetInnerHTML,
// así que tienen que ser seguras y leerse igual en el navegador que en el HTML estático.
import { describe, expect, it } from 'vitest';
import { productDescriptions } from './descriptions.generated';
import { jumpsellerSnapshot } from './jumpseller-snapshot.generated';
import { unsafeHtmlReasons } from '../../../scripts/jumpseller/sanitize-description';

const entries = Object.entries(productDescriptions);

describe('descripciones de Jumpseller (archivo generado)', () => {
  it('solo de productos publicados', () => {
    const published = new Set(jumpsellerSnapshot.map(p => String(p.jumpseller_id)));
    expect(entries.length).toBeGreaterThan(300);
    expect(entries.filter(([id]) => !published.has(id)).map(([id]) => id)).toEqual([]);
  });

  it('ninguna trae etiquetas, eventos, estilos ni URLs no permitidos', () => {
    expect(entries.filter(([, html]) => unsafeHtmlReasons(html).length).map(([id]) => id)).toEqual([]);
  });

  it('el navegador las lee igual que el HTML (sin correcciones de anidamiento): hidratación sin diferencias', () => {
    const div = document.createElement('div');
    const differ = entries.filter(([, html]) => {
      div.innerHTML = html;
      return div.innerHTML !== html;
    });
    expect(differ.map(([id]) => id)).toEqual([]);
  });
});
