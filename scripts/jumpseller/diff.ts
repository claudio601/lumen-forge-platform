// scripts/jumpseller/diff.ts
// Compara el snapshot nuevo con la versión anterior (o con el catálogo legado de
// src/data/products.ts en la primera corrida) y arma el informe en español que el
// dueño revisa antes de aprobar el PR de sincronización.

import type { SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import type { Exclusion } from './normalize';

export interface BaselineEntry {
  jumpseller_id: number;
  name: string;
  price: number;
  /** Precios por variante (id de variante de Jumpseller), cuando se conocen. */
  variants?: { id: number; price: number; label?: string }[];
}

export interface PriceChange {
  jumpseller_id: number;
  name: string;
  before: number;
  after: number;
  /** Variación en % respecto al precio anterior (1 decimal). */
  pct: number;
  /** true si la variación es de 50% o más (hacia arriba o abajo). */
  flagged: boolean;
}

export interface VariantPriceChange {
  jumpseller_id: number;
  variant_id: number;
  name: string;
  /** SKU u opción de la variante (p. ej. "APB407 · Luz Cálida - 2700K"). */
  label: string;
  /** null = variante nueva; en ese caso after es su precio. */
  before: number | null;
  /** null = la variante ya no existe. */
  after: number | null;
  pct: number | null;
  flagged: boolean;
}

export interface BenchmarkPrice {
  jumpseller_id: number;
  name: string;
  price: number;
}

export interface CatalogDiff {
  baselineLabel: string;
  beforeCount: number;
  afterCount: number;
  priceChanges: PriceChange[];
  variantPriceChanges: VariantPriceChange[];
  added: { jumpseller_id: number; name: string; price: number }[];
  removed: { jumpseller_id: number; name: string }[];
  renamed: { jumpseller_id: number; before: string; after: string }[];
}

export const FLAG_PCT = 50;

export function diffCatalog(baseline: BaselineEntry[], next: SnapshotProduct[], baselineLabel: string): CatalogDiff {
  const before = new Map(baseline.map(b => [b.jumpseller_id, b]));
  const after = new Map(next.map(p => [p.jumpseller_id, p]));
  const priceChanges: PriceChange[] = [];
  const variantPriceChanges: VariantPriceChange[] = [];
  const renamed: CatalogDiff['renamed'] = [];
  const added: CatalogDiff['added'] = [];
  const removed: CatalogDiff['removed'] = [];

  for (const p of next) {
    const b = before.get(p.jumpseller_id);
    if (!b) { added.push({ jumpseller_id: p.jumpseller_id, name: p.name, price: p.price }); continue; }
    if (b.price !== p.price) {
      const pct = b.price > 0 ? Math.round(((p.price - b.price) / b.price) * 1000) / 10 : 100;
      priceChanges.push({ jumpseller_id: p.jumpseller_id, name: p.name, before: b.price, after: p.price, pct, flagged: Math.abs(pct) >= FLAG_PCT });
    }
    if (b.variants) {
      const prevV = new Map(b.variants.map(v => [v.id, v]));
      const nextV = new Map(p.variants.map(v => [v.id, v]));
      for (const v of p.variants) {
        const label = [v.sku, ...v.options.map(o => o.value)].filter(Boolean).join(' · ') || String(v.id);
        const old = prevV.get(v.id);
        if (!old) {
          variantPriceChanges.push({ jumpseller_id: p.jumpseller_id, variant_id: v.id, name: p.name, label, before: null, after: v.price, pct: null, flagged: false });
        } else if (old.price !== v.price) {
          const pct = old.price > 0 ? Math.round(((v.price - old.price) / old.price) * 1000) / 10 : 100;
          variantPriceChanges.push({ jumpseller_id: p.jumpseller_id, variant_id: v.id, name: p.name, label, before: old.price, after: v.price, pct, flagged: Math.abs(pct) >= FLAG_PCT });
        }
      }
      for (const old of b.variants) {
        if (!nextV.has(old.id)) {
          variantPriceChanges.push({ jumpseller_id: p.jumpseller_id, variant_id: old.id, name: p.name, label: old.label ?? String(old.id), before: old.price, after: null, pct: null, flagged: false });
        }
      }
    }
    if (b.name.trim() !== p.name) renamed.push({ jumpseller_id: p.jumpseller_id, before: b.name.trim(), after: p.name });
  }
  for (const b of baseline) {
    if (!after.has(b.jumpseller_id)) removed.push({ jumpseller_id: b.jumpseller_id, name: b.name.trim() });
  }
  const byId = (a: { jumpseller_id: number }, c: { jumpseller_id: number }) => a.jumpseller_id - c.jumpseller_id;
  priceChanges.sort((a, c) => Number(c.flagged) - Number(a.flagged) || Math.abs(c.pct) - Math.abs(a.pct) || byId(a, c));
  variantPriceChanges.sort((a, c) => Number(c.flagged) - Number(a.flagged) || byId(a, c) || a.variant_id - c.variant_id);
  return { baselineLabel, beforeCount: baseline.length, afterCount: next.length, priceChanges, variantPriceChanges, added: added.sort(byId), removed: removed.sort(byId), renamed: renamed.sort(byId) };
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const pctText = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('es-CL')}%`;
const REASON_TEXT: Record<Exclusion['reason'], string> = {
  'no-disponible': 'No disponible en Jumpseller',
  'lista-de-exclusion': 'En la lista de exclusión',
  'producto-de-prueba': 'Producto de prueba',
  'sin-categoria': 'Sin categoría asignada',
};

export function renderDiffMarkdown(
  diff: CatalogDiff,
  opts: {
    snapshotHash: string;
    excluded: Exclusion[];
    benchmark?: BenchmarkPrice[];
    next: SnapshotProduct[];
    duplicateSkus?: { sku: string; jumpseller_ids: number[] }[];
  },
): string {
  const L: string[] = [];
  const flagged = diff.priceChanges.filter(c => c.flagged).length;
  const flaggedV = diff.variantPriceChanges.filter(c => c.flagged).length;
  L.push('# Sincronización Jumpseller → nuevo.elights.cl', '');
  L.push(`Comparado contra: **${diff.baselineLabel}** · Snapshot \`${opts.snapshotHash}\``, '');
  L.push('| | Cantidad |', '|---|---|');
  L.push(`| Productos publicados | ${diff.afterCount} (antes ${diff.beforeCount}) |`);
  L.push(`| Cambios de precio | ${diff.priceChanges.length}${flagged ? ` (⚠️ ${flagged} de ${FLAG_PCT}% o más)` : ''} |`);
  L.push(`| Cambios en variantes | ${diff.variantPriceChanges.length}${flaggedV ? ` (⚠️ ${flaggedV} de ${FLAG_PCT}% o más)` : ''} |`);
  L.push(`| Productos nuevos | ${diff.added.length} |`);
  L.push(`| Productos que salen | ${diff.removed.length} |`);
  L.push(`| Nombres cambiados | ${diff.renamed.length} |`);
  L.push(`| Excluidos por la sincronización | ${opts.excluded.length} |`, '');

  if (diff.priceChanges.length) {
    L.push('## Cambios de precio (con IVA)', '');
    L.push('| | ID Jumpseller | Producto | Antes | Ahora | Variación |', '|---|---|---|---|---|---|');
    for (const c of diff.priceChanges) {
      L.push(`| ${c.flagged ? '⚠️' : ''} | ${c.jumpseller_id} | ${c.name} | ${clp(c.before)} | ${clp(c.after)} | ${pctText(c.pct)} |`);
    }
    L.push('');
  }
  if (diff.variantPriceChanges.length) {
    L.push('## Cambios de precio en variantes (con IVA)', '');
    L.push('| | ID Jumpseller | Producto | Variante | Antes | Ahora | Variación |', '|---|---|---|---|---|---|---|');
    for (const c of diff.variantPriceChanges) {
      const before = c.before === null ? 'variante nueva' : clp(c.before);
      const after = c.after === null ? 'ya no existe' : clp(c.after);
      L.push(`| ${c.flagged ? '⚠️' : ''} | ${c.jumpseller_id} | ${c.name} | ${c.label} | ${before} | ${after} | ${c.pct === null ? '' : pctText(c.pct)} |`);
    }
    L.push('');
  }
  if (diff.added.length) {
    L.push('## Productos nuevos', '', '| ID Jumpseller | Producto | Precio |', '|---|---|---|');
    for (const a of diff.added) L.push(`| ${a.jumpseller_id} | ${a.name} | ${clp(a.price)} |`);
    L.push('');
  }
  if (diff.removed.length) {
    L.push('## Productos que salen del sitio', '', 'Ya no están disponibles en Jumpseller.', '', '| ID Jumpseller | Producto |', '|---|---|');
    for (const r of diff.removed) L.push(`| ${r.jumpseller_id} | ${r.name} |`);
    L.push('');
  }
  if (diff.renamed.length) {
    L.push('## Nombres cambiados', '', '| ID Jumpseller | Antes | Ahora |', '|---|---|---|');
    for (const r of diff.renamed) L.push(`| ${r.jumpseller_id} | ${r.before} | ${r.after} |`);
    L.push('');
  }
  if (opts.excluded.length) {
    L.push('## Excluidos (no se publican)', '', '| ID Jumpseller | Producto | Motivo |', '|---|---|---|');
    for (const e of opts.excluded) L.push(`| ${e.jumpseller_id} | ${e.name} | ${REASON_TEXT[e.reason]} |`);
    L.push('');
  }
  if (opts.duplicateSkus?.length) {
    const nameOf = new Map(opts.next.map(p => [p.jumpseller_id, p.name]));
    L.push('## SKU repetidos en Jumpseller', '');
    L.push('Estos SKU aparecen en productos distintos (como SKU del producto o de una variante). Conviene corregirlos **en Jumpseller**: el sitio no se los asigna a productos que no los tienen como propios.', '');
    L.push('| SKU | Productos |', '|---|---|');
    for (const d of opts.duplicateSkus) {
      L.push(`| ${d.sku} | ${d.jumpseller_ids.map(id => `${id} ${nameOf.get(id) ?? ''}`.trim()).join('<br>')} |`);
    }
    L.push('');
  }
  if (opts.benchmark?.length) {
    const nextById = new Map(opts.next.map(p => [p.jumpseller_id, p]));
    L.push('## Precios ajustados a mano el 18-03-2026 (benchmark de mercado)', '');
    L.push('Estos precios se cambiaron solo en el sitio nuevo y nunca en Jumpseller. Si se deben mantener, hay que actualizarlos **en Jumpseller**: desde ahora el sitio muestra el precio de Jumpseller.', '');
    L.push('| ID Jumpseller | Producto | Benchmark 18-03 | Jumpseller hoy |', '|---|---|---|---|');
    for (const b of opts.benchmark) {
      const now = nextById.get(b.jumpseller_id);
      L.push(`| ${b.jumpseller_id} | ${b.name} | ${clp(b.price)} | ${now ? clp(now.price) : 'no publicado'} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
