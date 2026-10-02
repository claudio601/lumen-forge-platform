// Descripciones sincronizadas desde Jumpseller: el texto y las tablas que no son
// "etiqueta | valor" se muestran con dangerouslySetInnerHTML, así que tienen que ser
// seguros y leerse igual en el navegador que en el HTML estático. Las especificaciones
// agrupadas son texto plano (React las escapa).
import { describe, expect, it } from 'vitest';
import { productDescriptions } from './descriptions.generated';
import { jumpsellerSnapshot } from './jumpseller-snapshot.generated';
import { editorialOverlay } from './overlay/editorial';
import { unsafeHtmlReasons } from '../../../scripts/jumpseller/sanitize-description';

const entries = Object.entries(productDescriptions);
// Las partes en HTML: el texto (Descripción) y las tablas que se conservan tal cual
const htmlParts = entries.flatMap(([id, d]) => [d.text, d.tables].filter((h): h is string => !!h).map(html => [id, html] as const));
const rows = entries.flatMap(([, d]) => [...(d.electricos ?? []), ...(d.construccion ?? []), ...(d.componentes ?? [])]);

// En la PR diaria del robot, lo que depende de cuántas tablas trae Jumpseller solo se informa.
const isSyncBot = (process.env.GITHUB_REF_NAME ?? process.env.GITHUB_HEAD_REF ?? '') === 'bot/jumpseller-sync';

describe('descripciones de Jumpseller (archivo generado)', () => {
  it.skipIf(isSyncBot)('solo de productos publicados, y casi todos con especificaciones agrupadas', () => {
    const published = new Set(jumpsellerSnapshot.map(p => String(p.jumpseller_id)));
    expect(entries.filter(([id]) => !published.has(id)).map(([id]) => id)).toEqual([]);
    const grouped = entries.filter(([, d]) => d.electricos || d.construccion || d.componentes).length;
    expect(grouped).toBeGreaterThan(published.size * 0.85);
  });

  it('los BESTLED usan su contenido editorial: nada de Jumpseller encima', () => {
    for (const id of Object.keys(editorialOverlay)) expect(productDescriptions[Number(id)]).toBeUndefined();
  });

  it('las filas son texto plano con etiqueta y valor', () => {
    for (const r of rows) {
      expect(r.label.trim()).not.toBe('');
      expect(r.value.trim()).not.toBe('');
      expect(r.label).not.toMatch(/<\/?[a-z]/i);
      expect(r.value).not.toMatch(/<\/?[a-z]+[\s>]/i);
    }
  });

  it('el texto no trae tablas y las tablas conservadas son solo tablas', () => {
    for (const [, d] of entries) {
      if (d.text) expect(d.text).not.toContain('<table>');
      if (d.tables) expect(d.tables.startsWith('<table>') && d.tables.endsWith('</table>')).toBe(true);
    }
  });

  it('ninguna trae etiquetas, eventos, estilos ni URLs no permitidos', () => {
    expect(htmlParts.filter(([, html]) => unsafeHtmlReasons(html).length).map(([id]) => id)).toEqual([]);
  });

  it('el navegador las lee igual que el HTML (sin correcciones de anidamiento): hidratación sin diferencias', () => {
    const div = document.createElement('div');
    const differ = htmlParts.filter(([, html]) => {
      div.innerHTML = html;
      return div.innerHTML !== html;
    });
    expect(differ.map(([id]) => id)).toEqual([]);
  });
});
