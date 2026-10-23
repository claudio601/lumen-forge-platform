// Variantes de Jumpseller (auditoría UX, D-01 y C-01): etiquetas limpias, precio por variante,
// SKU de la variante y los datos que llegan a la solicitud y a la cotización.
// Sin valores fijos del catálogo: la sincronización diaria trae los SKU y precios que el dueño
// corrige en Jumpseller. Cada prueba verifica una regla sobre el snapshot
// (jumpseller-snapshot.generated.ts) y elige sus productos por una propiedad («el producto con
// dos opciones», «uno con el mismo precio en todas sus opciones»); lo esperado (SKU, precio)
// sale del snapshot. Si ningún producto cumple la propiedad, la prueba se omite (skipIf).
// Los casos que el catálogo puede dejar de tener (el SKU del producto es el de otra variante o lo
// comparten varias) se prueban además con productos de ejemplo, que no dependen de Jumpseller.

import { describe, expect, it } from 'vitest';
import { products, type Product } from '@/data/products';
import type { ProductVariant } from '@/data/catalog/types';
import { jumpsellerSnapshot } from '@/data/catalog/jumpseller-snapshot.generated';
import { editorialOverlay } from '@/data/catalog/overlay/editorial';
import { isDs1CertifiedKelvin } from '@/data/catalog/ds1';
import { expectedLineSku, expectedSkuIsDistinct, snapshotVariant } from '@/test/variantRule';
import {
  axisPrices, hasVariantChoice, lightChoice, missingChoicesText, selectedVariant, variantAttributes, variantAxes,
  variantFromPrice, variantKelvin, variantLabel, variantLineSku, variantSku, variantSkuIsDistinct,
  type VariantAxis, type VariantSelection,
} from './variants';

const site = (id: number) => products.find(p => p.jumpseller_id === id)!;
const snapMulti = jumpsellerSnapshot.filter(s => s.variants.length > 1);
const withChoice = products.filter(hasVariantChoice);
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const KIND_ORDER = { potencia: 0, luz: 1, otro: 2 } as const;

/** Variantes compatibles con lo elegido (escrito aquí, sin usar variantsMatching). */
const matching = (variants: readonly ProductVariant[], selection: VariantSelection) =>
  variants.filter(v => Object.entries(selection).every(([name, value]) => v.options.find(o => o.name === name)?.value === value));
/** Lo elegido en cada eje para llegar a la variante `v`. */
const selectionOf = (axes: readonly VariantAxis[], v: ProductVariant): VariantSelection =>
  Object.fromEntries(axes.map(a => [a.name, v.options.find(o => o.name === a.name)!.value]));
/** Opción de la variante en el eje. */
const choiceOf = (axis: VariantAxis, v: ProductVariant) =>
  axis.choices.find(c => c.value === v.options.find(o => o.name === axis.name)?.value)!;
/** La más cara; a igual precio, la que no tiene SKU propio (el caso «JS-<id>») y luego el orden de Jumpseller. */
const mostExpensive = (p: Product) =>
  [...p.variants!].sort((a, b) => b.price - a.price || Number(Boolean(a.sku)) - Number(Boolean(b.sku)))[0];

// ── Productos elegidos por una propiedad del snapshot ────────────────────────
// Hoy, la Flyhawk 40-80W (potencia y temperatura de color)
const twoAxes = withChoice.find(p => variantAxes(p).length > 1);
// Hoy, p. ej., un proyector antivandálico: un color de luz, mismo precio y SKU propio por variante
const samePrice = withChoice.find(p => {
  const axes = variantAxes(p);
  return axes.length === 1 && axes[0].kind === 'luz' && variantFromPrice(p) === undefined &&
    p.variants!.some(v => expectedSkuIsDistinct(p.jumpseller_id, v.id));
});
// Las BESTLED: las del contenido editorial con variantes CCT que siguen publicadas en Jumpseller
const bestledIds = Object.entries(editorialOverlay)
  .filter(([id, e]) => e.availableCCT?.length && jumpsellerSnapshot.some(s => s.jumpseller_id === Number(id)))
  .map(([id]) => Number(id))
  .sort((a, b) => a - b);

describe('lightChoice: el valor de Jumpseller, limpio', () => {
  it.each([
    // Sin los 2200K confirmados, el tono de Jumpseller (ver «2200K: ámbar» más abajo)
    ['Luz Cálida - 2200K - 1% Luz Azul', 'Cálida 2200K', undefined],
    ['Luz Cálida 2700K 7% Luz Azul', 'Cálida 2700K', undefined],
    ['Luz Neutra – 4000K', 'Neutra 4000K', undefined],
    ['Luz Fría  - 5000K', 'Fría 5000K', undefined],
    ['Luz Fria - 6500K', 'Fría 6500K', undefined],
    ['Luz Neuta - 4500K', 'Neutra 4500K', undefined],
    ['3000K Luz Cálida', 'Cálida 3000K', undefined],
    ['Luz fría 6400k', 'Fría 6400K', undefined],
    ['Luz Natural - 4000K', 'Natural 4000K', undefined],
    ['Luz Ámbar - 1600K', 'Ámbar 1600K', undefined],
    ['Luz Cálida', 'Cálida', undefined],
    ['RGB', 'RGB', undefined],
    // Sin temperatura, el % es lo único que distingue las opciones: va aparte, como dato
    ['Luz Cálida - 1% Luz Azul', 'Cálida', '1 % de luz azul'],
    ['Luz Cálida - 7% Luz Azul', 'Cálida', '7 % de luz azul'],
  ])('%s → %s', (raw, label, detail) => {
    expect(lightChoice(raw).label).toBe(label);
    expect(lightChoice(raw).detail).toBe(detail);
  });

  // 2200K es ámbar aunque Jumpseller diga «Luz Cálida»; 2700K y 3000K, cálidas (dueño, 23-10-2026)
  it.each([
    ['Luz Cálida - 2200K - 1% Luz Azul', 'Ámbar 2200K'],
    ['Luz Cálida - 2200K', 'Ámbar 2200K'],
    ['Luz Cálida 2700K 7% Luz Azul', 'Cálida 2700K'],
    ['3000K Luz Cálida', 'Cálida 3000K'],
    ['Luz Fria - 6500K', 'Fría 6500K'],
  ])('con los 2200K confirmados: %s → %s', (raw, label) => {
    expect(lightChoice(raw, { amber2200: true }).label).toBe(label);
  });
});

describe('2200K: «Ámbar» solo donde los 2200K están confirmados (líneas con certificado D.S. N°1)', () => {
  // En otros productos Jumpseller llama «Luz Cálida - 2200K» a una versión que la ficha da como
  // cálida de 3000K o 3500K (paneles, dicroicos, Ultra Slim…): ahí queda el tono de Jumpseller.
  const with2200 = withChoice
    .filter(p => !p.availableCCT?.length) // las BESTLED llevan el nombre de su ficha (su prueba, más abajo)
    .flatMap(p => variantAxes(p).filter(a => a.kind === 'luz').flatMap(a => a.choices.filter(c => c.kelvin === 2200).map(c => ({ p, c }))));
  const confirmed = with2200.filter(({ p }) => isDs1CertifiedKelvin(p.jumpseller_id, 2200));
  const unconfirmed = with2200.filter(({ p }) => !isDs1CertifiedKelvin(p.jumpseller_id, 2200));

  it.skipIf(!confirmed.length)(`con los 2200K confirmados, «Ámbar 2200K» en el selector, la solicitud y la cotización (${confirmed.length})`, () => {
    for (const { p, c } of confirmed) {
      expect(c.label, p.name).toBe('Ámbar 2200K');
      const v = p.variants!.find(x => x.options.some(o => o.value === c.value))!;
      expect(variantLabel(p, v), p.name).toContain('Ámbar 2200K');
      expect(variantAttributes(p, v).colorLuz, p.name).toContain('Ámbar 2200K');
    }
  });

  it.skipIf(!unconfirmed.length)(`sin confirmar, el tono de Jumpseller: nunca «Ámbar» por la cifra (${unconfirmed.length})`, () => {
    for (const { p, c } of unconfirmed) {
      expect(c.label, p.name).toBe(lightChoice(c.value).label);
      if (!/[aá]mbar/i.test(c.value)) expect(c.label, p.name).not.toMatch(/ámbar/i);
    }
  });
});

describe('missingChoicesText: lo que falta elegir, en palabras', () => {
  const axis = (kind: VariantAxis['kind'], legend: string): VariantAxis => ({ name: legend, kind, legend, choices: [] });

  it('una frase con cada eje que falta', () => {
    expect(missingChoicesText([axis('potencia', 'Potencia'), axis('luz', 'Temperatura de color')])).toBe('una potencia y una temperatura de color');
    expect(missingChoicesText([axis('luz', 'Temperatura de color')])).toBe('una temperatura de color');
    expect(missingChoicesText([axis('luz', 'Color de luz')])).toBe('un color de luz');
    expect(missingChoicesText([axis('potencia', 'Potencia'), axis('luz', 'Color de luz'), axis('otro', 'Color')]))
      .toBe('una potencia, un color de luz y una opción de color');
    expect(missingChoicesText([])).toBe('');
  });
});

describe('las variantes del snapshot en el sitio', () => {
  it(`los ${snapMulti.length} productos con más de una variante en Jumpseller tienen selector, con todas sus variantes; «desde» solo si no cuestan lo mismo`, () => {
    expect(snapMulti.length).toBeGreaterThan(0);
    expect(withChoice.map(p => p.jumpseller_id).sort((a, b) => a - b)).toEqual(snapMulti.map(s => s.jumpseller_id).sort((a, b) => a - b));
    for (const s of snapMulti) {
      const p = site(s.jumpseller_id);
      expect(variantAxes(p).length, p.name).toBeGreaterThan(0);
      // Las variantes de Jumpseller, con su id, SKU y precio
      expect(p.variants!.map(v => [v.id, v.sku, v.price]), p.name).toEqual(s.variants.map(v => [v.id, v.sku, v.price]));
      // «desde» la más barata, solo si no cuestan todas lo mismo
      const prices = s.variants.map(v => v.price);
      expect(variantFromPrice(p), p.name).toBe(new Set(prices).size > 1 ? Math.min(...prices) : undefined);
    }
    // Con una sola variante (o ninguna) no hay nada que elegir
    expect(products.filter(p => !hasVariantChoice(p)).every(p => variantAxes(p).length === 0 && variantFromPrice(p) === undefined)).toBe(true);
  });

  it('cada variante tiene una etiqueta propia, limpia y sin afirmar certificados', () => {
    for (const p of withChoice) {
      const labels = p.variants!.map(v => variantLabel(p, v));
      expect(new Set(labels).size, `${p.jumpseller_id} ${labels.join(' | ')}`).toBe(labels.length);
      for (const label of labels) {
        expect(label, p.name).not.toBe('');
        expect(label).not.toMatch(/^luz\b|\s{2}| - |certific|D\.\s?S\.|DS ?1|SEC\b/i);
        // Con la temperatura en la etiqueta, nunca el % de luz azul (el % es el límite de la clase)
        if (/\d{4}K/.test(label)) expect(label).not.toMatch(/luz azul/i);
      }
    }
  });

  it('los ejes van en orden (potencia, luz, el resto) y cada combinación de opciones lleva a una sola variante, con su precio', () => {
    for (const p of withChoice) {
      const axes = variantAxes(p);
      const kinds = axes.map(a => KIND_ORDER[a.kind]);
      expect(kinds, p.name).toEqual([...kinds].sort((a, b) => a - b));
      for (const v of p.variants!) {
        const picked = selectedVariant(p, axes, selectionOf(axes, v));
        expect(picked?.id, p.name).toBe(v.id);
        expect(picked?.price).toBe(snapshotVariant(p.jumpseller_id, v.id).price);
      }
      // Sin elegir en todos los ejes no hay variante
      expect(selectedVariant(p, axes, {})).toBeUndefined();
    }
  });

  it('precio por opción: solo cuando la opción decide el precio, y es el de Jumpseller', () => {
    let priced = 0;
    for (const p of withChoice) {
      const axes = variantAxes(p);
      for (const axis of axes) {
        // Sin elegir nada y con cada opción de los otros ejes ya elegida
        const selections: VariantSelection[] = [
          {},
          ...axes.filter(a => a !== axis).flatMap(a => a.choices.map(c => ({ [a.name]: c.value }))),
        ];
        for (const selection of selections) {
          const byChoice = axis.choices.map(c => new Set(matching(p.variants!, { ...selection, [axis.name]: c.value }).map(v => v.price)));
          const decides = byChoice.every(set => set.size <= 1) && new Set(byChoice.flatMap(set => [...set])).size > 1;
          const prices = axisPrices(p.variants!, axis, selection);
          if (!decides) {
            expect(prices, `${p.name} · ${axis.legend}`).toBeUndefined();
            continue;
          }
          priced++;
          axis.choices.forEach((c, i) => expect(prices?.get(c.value), `${p.name} · ${c.label}`).toBe([...byChoice[i]][0]));
        }
      }
    }
    // Si en Jumpseller hay variantes con precios distintos, alguna opción lleva su precio
    if (withChoice.some(p => variantFromPrice(p) !== undefined)) expect(priced).toBeGreaterThan(0);
  });

  it(`las ${bestledIds.length} BESTLED: el selector genérico cubre sus variantes CCT (mismo id, SKU y precio de Jumpseller), con el nombre de la ficha`, () => {
    const bestled = products.filter(p => p.availableCCT?.length);
    expect(bestled.map(p => p.jumpseller_id).sort((a, b) => a - b)).toEqual(bestledIds);
    for (const p of bestled) {
      expect(hasVariantChoice(p), p.name).toBe(true);
      const axes = variantAxes(p);
      expect(axes.map(a => a.kind), p.name).toEqual(['luz']);
      for (const c of p.cctVariants!) {
        const v = p.variants!.find(x => x.id === c.jumpseller_variant_id)!;
        expect(v, `${p.name} ${c.kelvin}K`).toBeDefined();
        if (v.sku) expect(c.sku).toBe(v.sku);
        expect(v.price).toBe(c.price);
        expect(variantKelvin(p, v)).toBe(c.kelvin);
        // La opción lleva el nombre de la ficha BESTLED («Ámbar 2200K»): es la etiqueta para Pipedrive
        const label = `${squash(c.name)} ${c.kelvin}K`;
        expect(choiceOf(axes[0], v).label).toBe(label);
        expect(variantAttributes(p, v)).toEqual({ potencia: p.watts > 0 ? `${p.watts}W` : undefined, colorLuz: label });
        expect(variantLineSku(p, v)).toBe(expectedLineSku(p.jumpseller_id, v.id));
      }
    }
  });
});

// Si Jumpseller deja de tener un producto con dos opciones, no hay nada que probar aquí.
describe.skipIf(!twoAxes)(`el producto con dos opciones (${twoAxes?.name ?? 'ninguno en el snapshot'})`, () => {
  const p = twoAxes!;
  const axes = twoAxes ? variantAxes(twoAxes) : [];

  it('un eje por opción de Jumpseller, con sus valores en el orden de Jumpseller', () => {
    const names = [...new Set(p.variants!.flatMap(v => v.options.map(o => o.name)))];
    expect(axes.map(a => a.name).sort()).toEqual([...names].sort());
    for (const axis of axes) {
      const values = [...new Set(p.variants!.map(v => v.options.find(o => o.name === axis.name)!.value))];
      expect(axis.choices.map(c => c.value), axis.legend).toEqual(values);
      if (axis.kind === 'potencia') for (const c of axis.choices) expect(c.label).toMatch(/^\d+(?:[.,]\d+)?W$/);
    }
  });

  it('la variante más cara se puede pedir, con su precio, su etiqueta (todas sus opciones) y el SKU de la regla', () => {
    // Antes de la auditoría solo se podía pedir la más barata
    const v = mostExpensive(p);
    const picked = selectedVariant(p, axes, selectionOf(axes, v))!;
    expect(picked).toMatchObject({ id: v.id, price: snapshotVariant(p.jumpseller_id, v.id).price });
    expect(picked.price).toBe(Math.max(...p.variants!.map(x => x.price)));
    const label = axes.map(a => choiceOf(a, v)).map(c => (c.detail ? `${c.label}, ${c.detail}` : c.label)).join(' · ');
    expect(variantLabel(p, v)).toBe(label);
    const power = axes.find(a => a.kind === 'potencia');
    expect(variantAttributes(p, v)).toMatchObject({
      potencia: power ? choiceOf(power, v).label : p.watts > 0 ? `${p.watts}W` : undefined,
      colorLuz: label,
    });
    expect(variantLineSku(p, v)).toBe(expectedLineSku(p.jumpseller_id, v.id));
  });
});

// Si Jumpseller deja de tener uno así, no hay nada que probar aquí.
describe.skipIf(!samePrice)(`un color de luz, mismo precio en todas las opciones (${samePrice?.name ?? 'ninguno en el snapshot'})`, () => {
  const p = samePrice!;

  it('sin precio por opción ni «desde»; la línea lleva el SKU propio de la variante', () => {
    const axes = variantAxes(p);
    expect(axes[0].legend).toMatch(/^(Temperatura de color|Color de luz)$/);
    expect(axisPrices(p.variants!, axes[0], {})).toBeUndefined();
    expect(variantFromPrice(p)).toBeUndefined();
    const v = p.variants!.find(x => expectedSkuIsDistinct(p.jumpseller_id, x.id))!;
    expect(variantLineSku(p, v)).toBe(snapshotVariant(p.jumpseller_id, v.id).sku);
    expect(variantSkuIsDistinct(p, v)).toBe(true);
    expect(variantAttributes(p, v)).toMatchObject({ colorLuz: variantLabel(p, v) });
  });
});

describe('SKU de la línea: el propio de la variante o «JS-<id>», nunca el del producto ni el de otra variante', () => {
  it(`las ${snapMulti.reduce((n, s) => n + s.variants.length, 0)} variantes del snapshot`, () => {
    for (const s of snapMulti) {
      const p = site(s.jumpseller_id);
      for (const sv of s.variants) {
        const v = p.variants!.find(x => x.id === sv.id)!;
        const where = `${s.jumpseller_id} ${sv.id}`;
        const line = variantLineSku(p, v);
        expect(variantSku(v), where).toBe(sv.sku);
        expect(line, where).toBe(expectedLineSku(s.jumpseller_id, sv.id));
        // Nunca el SKU de otra variante del mismo producto (salvo que sea también el suyo)
        const otherSkus = s.variants.filter(o => o.id !== sv.id && o.sku && o.sku !== sv.sku).map(o => o.sku);
        expect(otherSkus, where).not.toContain(line);
        // Ni el del producto (el de Jumpseller o el que muestra el sitio), si no es el suyo
        if (!sv.sku) expect([s.sku, p.sku].filter(Boolean), where).not.toContain(line);
        // «Define el SKU del despacho» solo si el SKU es suyo y ninguna otra variante lo comparte
        expect(variantSkuIsDistinct(p, v), where).toBe(expectedSkuIsDistinct(s.jumpseller_id, sv.id));
      }
    }
  });

  // Productos con SKU (en Jumpseller o en el sitio) y alguna variante sin SKU propio
  const withProductSku = snapMulti.filter(s => (s.sku || site(s.jumpseller_id).sku) && s.variants.some(v => !v.sku));
  it.skipIf(!withProductSku.length)(`variantes sin SKU propio en productos con SKU (${withProductSku.length}): «JS-<id>», no el del producto`, () => {
    for (const s of withProductSku) {
      const p = site(s.jumpseller_id);
      for (const v of p.variants!.filter(x => !x.sku)) {
        expect(variantSku(v)).toBe('');
        expect(variantLineSku(p, v), p.name).toBe(`JS-${s.jumpseller_id}`);
        expect(variantSkuIsDistinct(p, v)).toBe(false);
      }
    }
  });

  // Productos cuyo SKU es el de una de sus variantes, lo comparten varias o lo usan otros
  // productos. El 21-10-2026 Jumpseller ya no tenía ninguno (el dueño los corrigió): la prueba
  // se omite y quedan los productos de ejemplo de la prueba siguiente.
  const skuUses = new Map<string, number>();
  for (const s of jumpsellerSnapshot) {
    for (const sku of new Set([s.sku, ...s.variants.map(v => v.sku)].filter(Boolean))) skuUses.set(sku, (skuUses.get(sku) ?? 0) + 1);
  }
  const ambiguous = snapMulti.filter(s => s.sku && (s.variants.some(v => v.sku === s.sku) || skuUses.get(s.sku)! > 1));
  it.skipIf(!ambiguous.length)(`SKU del producto que es de una variante o compartido (${ambiguous.length}): cada variante, el suyo o «JS-<id>»`, () => {
    for (const s of ambiguous) {
      const p = site(s.jumpseller_id);
      for (const v of p.variants!) {
        const line = variantLineSku(p, v);
        expect(line, `${s.jumpseller_id} ${v.id}`).toBe(v.sku || `JS-${s.jumpseller_id}`);
        if (v.sku !== s.sku) expect(line).not.toBe(s.sku);
      }
    }
  });

  it('productos de ejemplo: el SKU del producto es el de otra variante, lo comparten varias o ninguna variante tiene', () => {
    const variant = (id: number, sku: string, value: string): ProductVariant => ({ id, sku, price: 1000, options: [{ name: 'Color', value }] });
    // El del producto es el de su variante Fría (así estaba el foco codo 30W)
    const codo = { jumpseller_id: 9000001, sku: 'COD30F', variants: [variant(1, '', 'Luz Cálida'), variant(2, 'COD30N', 'Luz Neutra'), variant(3, 'COD30F', 'Luz Fría')] };
    expect(codo.variants.map(v => variantLineSku(codo, v))).toEqual(['JS-9000001', 'COD30N', 'COD30F']);
    expect(codo.variants.map(v => variantSkuIsDistinct(codo, v))).toEqual([false, true, true]);
    // El del producto lo comparten dos variantes (así estaba la Flyhawk con sus 4000K)
    const solar = { jumpseller_id: 9000002, sku: 'SOL80N', variants: [variant(1, '', '2200K'), variant(2, 'SOL80N', '4000K 40W'), variant(3, 'SOL80N', '4000K 60W')] };
    expect(solar.variants.map(v => variantLineSku(solar, v))).toEqual(['JS-9000002', 'SOL80N', 'SOL80N']);
    expect(solar.variants.map(v => variantSkuIsDistinct(solar, v))).toEqual([false, false, false]);
    // Ninguna variante tiene SKU; el del producto lo usa también otro producto (así estaban los downlight 7W)
    const downlight = { jumpseller_id: 9000003, sku: 'DL7', variants: [variant(1, '', 'Luz Cálida'), variant(2, '', 'Luz Fría')] };
    expect(downlight.variants.map(v => variantSku(v))).toEqual(['', '']);
    expect(downlight.variants.map(v => variantLineSku(downlight, v))).toEqual(['JS-9000003', 'JS-9000003']);
    expect(downlight.variants.map(v => variantSkuIsDistinct(downlight, v))).toEqual([false, false]);
  });
});

describe('otros casos del snapshot', () => {
  // Opciones que no son de luz y cuyo nombre dice «Color» (hoy, p. ej., los focos a riel)
  const finishes = withChoice.filter(p => variantAxes(p).some(a => a.kind === 'otro' && /color/i.test(a.name)));
  it.skipIf(!finishes.length)(`el color de la carcasa («Negro», «Blanco») va también como terminación (${finishes.length})`, () => {
    for (const p of finishes) {
      const axis = variantAxes(p).find(a => a.kind === 'otro' && /color/i.test(a.name))!;
      for (const v of p.variants!) {
        expect(variantAttributes(p, v), p.name).toMatchObject({ colorLuz: variantLabel(p, v), terminacion: choiceOf(axis, v).label });
      }
    }
  });

  // Opciones de luz sin temperatura en Jumpseller (hoy, p. ej., los proyectores de estadio modulares)
  const blueLight = withChoice.filter(p => variantAxes(p).some(a => a.kind === 'luz' && a.choices.some(c => c.detail)));
  it.skipIf(!blueLight.length)(`sin temperatura en Jumpseller, el % de luz azul distingue las opciones, aparte y como dato (${blueLight.length})`, () => {
    for (const p of blueLight) {
      const axis = variantAxes(p).find(a => a.kind === 'luz' && a.choices.some(c => c.detail))!;
      expect(axis.legend, p.name).toBe('Color de luz');
      for (const v of p.variants!) {
        const c = choiceOf(axis, v);
        if (!c.detail) continue;
        expect(c.kelvin).toBeUndefined();
        expect(c.detail).toMatch(/^\d+(?:,\d+)? % de luz azul$/);
        expect(variantLabel(p, v)).toContain(`${c.label}, ${c.detail}`);
      }
    }
  });
});
