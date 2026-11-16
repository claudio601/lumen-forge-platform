// scripts/jumpseller/panel-boxes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cajas master de los paneles de formato grande (PANEL_MASTER_BOX, src/config/business.ts,
// decisión del dueño del 13-11-2026) frente al «Packaging por mayor» de Jumpseller.
//
// Las cajas se copiaron a mano desde la tabla de Jumpseller, que la misma ficha muestra en
// «Especificaciones técnicas». Si el dueño cambia el packaging en Jumpseller, la ficha mostraría
// dos cajas distintas. La sincronización lo compara y lo informa en la PR del robot, sin bloquear:
// el aviso de la ficha sale de business.ts, que se corrige a mano (revisión del 16-11-2026).
// ─────────────────────────────────────────────────────────────────────────────

import type { ProductDescription } from '../../src/data/catalog/jumpseller.types';
import type { PanelMasterBox } from '../../src/config/business';

/** «10 unidades por caja», «6 piezas x caja», «10 unidades por cajas», «12 unidades/caja». */
const PACKAGING_UNITS = /(?<![\d.,])(\d{1,4})\s*(?:unidades?|unids?\.?|uds?\.?|u\.|piezas?|pzas?\.?)\s*(?:por|x|×|\/)\s*cajas?(?![\p{L}])/iu;

/** Las unidades por caja del «Packaging por mayor» de una descripción, o null si no lo trae o no se lee. */
export function packagingUnits(description: ProductDescription | undefined): number | null {
  if (!description) return null;
  const rows = [...(description.electricos ?? []), ...(description.construccion ?? []), ...(description.componentes ?? [])];
  const row = rows.find(r => /packaging\s+(?:por\s+)?mayor/i.test(r.label));
  if (!row) return null;
  const match = PACKAGING_UNITS.exec(row.value);
  return match ? Number(match[1]) : null;
}

export interface PanelBoxMismatch {
  id: number;
  /** La caja de PANEL_MASTER_BOX (null: sin número). */
  site: number | null;
  /** La de Jumpseller (null: no la trae o no se lee). */
  jumpseller: number | null;
}

/**
 * Paneles publicados cuya caja de PANEL_MASTER_BOX no coincide con la de Jumpseller, también
 * cuando uno de los dos no tiene número. Los que no están publicados no se revisan.
 */
export function comparePanelBoxes(
  boxes: Readonly<Record<number, PanelMasterBox>>,
  descriptions: Readonly<Record<number, ProductDescription>>,
  published: ReadonlySet<number>,
): PanelBoxMismatch[] {
  const mismatches: PanelBoxMismatch[] = [];
  for (const [key, { box }] of Object.entries(boxes)) {
    const id = Number(key);
    if (!published.has(id)) continue;
    const jumpseller = packagingUnits(descriptions[id]);
    if (jumpseller !== box) mismatches.push({ id, site: box, jumpseller });
  }
  return mismatches.sort((a, b) => a.id - b.id);
}

const show = (n: number | null) => (n === null ? 'sin número' : String(n));

/** Sección del informe de la PR del robot. */
export function renderPanelBoxesReport(mismatches: readonly PanelBoxMismatch[], names: ReadonlyMap<number, string>): string {
  const lines = ['## Cajas master de paneles (PANEL_MASTER_BOX)', ''];
  if (!mismatches.length) {
    lines.push('Coinciden con el «Packaging por mayor» de Jumpseller.');
    return lines.join('\n');
  }
  lines.push(
    'La caja que usa el aviso «Despacho a regiones» de la ficha (`src/config/business.ts`) no coincide con el «Packaging por mayor» de Jumpseller. ' +
      'No bloquea: confirmar con el dueño cuál es la correcta y corregir `PANEL_MASTER_BOX` o Jumpseller.',
    '',
    '| Producto | Sitio | Jumpseller |',
    '| --- | --- | --- |',
  );
  for (const m of mismatches) {
    const name = (names.get(m.id) ?? '').replace(/\|/g, '/');
    lines.push(`| ${m.id} ${name} | ${show(m.site)} | ${show(m.jumpseller)} |`);
  }
  return lines.join('\n');
}
