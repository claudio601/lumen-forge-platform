// Variantes de Jumpseller (auditoría UX, D-01 y C-01): etiquetas limpias, precio por variante,
// SKU de la variante y los datos que llegan a la solicitud y a la cotización. Con productos
// reales del snapshot: la BESTLED 90W, la Flyhawk (potencia y color de luz) y el proyector
// antivandálico 100W (dos opciones, mismo precio).

import { describe, expect, it } from 'vitest';
import { products } from '@/data/products';
import { jumpsellerSnapshot } from '@/data/catalog/jumpseller-snapshot.generated';
import { buildVariantSku } from '@/lib/variantSku';
import {
  axisPrices, hasVariantChoice, lightChoice, missingChoicesText, selectedVariant, variantAttributes, variantAxes,
  variantFromPrice, variantKelvin, variantLabel, variantLineSku, variantSku, variantSkuIsDistinct,
} from './variants';

const byJid = (id: number) => products.find(p => p.jumpseller_id === id)!;
const bestled90 = byJid(2301105);
const flyhawk = byJid(11521285);
const antivandalico = byJid(2252962);
const withChoice = products.filter(hasVariantChoice);

describe('lightChoice: el valor de Jumpseller, limpio', () => {
  it.each([
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
});

describe('las variantes del snapshot en el sitio', () => {
  it('188 productos tienen más de una variante y todos tienen selector; 8 tienen precios distintos ("desde")', () => {
    const snapMulti = jumpsellerSnapshot.filter(s => s.variants.length > 1).map(s => s.jumpseller_id).sort();
    expect(withChoice.map(p => p.jumpseller_id).sort()).toEqual(snapMulti);
    expect(withChoice).toHaveLength(188);
    for (const p of withChoice) expect(variantAxes(p).length, p.name).toBeGreaterThan(0);
    const desde = withChoice.filter(p => variantFromPrice(p) !== undefined).map(p => p.jumpseller_id).sort((a, b) => a - b);
    expect(desde).toEqual([2301098, 2301101, 2301105, 2301110, 2301114, 4156930, 11521285, 15021313]);
    // Con una sola variante (o ninguna) no hay nada que elegir
    expect(products.filter(p => !hasVariantChoice(p)).every(p => variantAxes(p).length === 0)).toBe(true);
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

  it('cada combinación de opciones lleva a una sola variante', () => {
    for (const p of withChoice) {
      const axes = variantAxes(p);
      for (const v of p.variants!) {
        const selection = Object.fromEntries(axes.map(a => [a.name, v.options.find(o => o.name === a.name)!.value]));
        expect(selectedVariant(p, axes, selection)?.id, p.name).toBe(v.id);
      }
    }
  });

  it('las 7 BESTLED: el selector genérico cubre sus 4 variantes CCT (mismo id, SKU y precio de Jumpseller)', () => {
    const bestled = products.filter(p => p.availableCCT?.length);
    expect(bestled).toHaveLength(7);
    for (const p of bestled) {
      expect(hasVariantChoice(p), p.name).toBe(true);
      for (const c of p.cctVariants!) {
        const v = p.variants!.find(x => x.id === c.jumpseller_variant_id)!;
        expect(v, `${p.name} ${c.kelvin}K`).toBeDefined();
        expect(v.sku).toBe(buildVariantSku(p.sku, c.kelvin));
        expect(v.price).toBe(c.price);
        expect(variantKelvin(p, v)).toBe(c.kelvin);
      }
    }
  });
});

describe('BESTLED 90W: temperatura de color, con precio por opción', () => {
  const axes = variantAxes(bestled90);

  it('un eje «Temperatura de color» con los nombres de la ficha BESTLED', () => {
    expect(axes.map(a => a.legend)).toEqual(['Temperatura de color']);
    expect(axes[0].choices.map(c => c.label)).toEqual(['Ámbar 2200K', 'Cálida 2700K', 'Neutra 4000K', 'Fría 5000K']);
  });

  it('antes: entraba a $139.900 (la más barata); ahora «desde $139.900» y cada opción con su precio', () => {
    expect(bestled90.price).toBe(139900);
    expect(variantFromPrice(bestled90)).toBe(139900);
    expect([...axisPrices(bestled90.variants!, axes[0], {})!.values()]).toEqual([154000, 154000, 139900, 139900]);
  });

  it('2700K: SKU APB907, $154.000 y la etiqueta para Pipedrive', () => {
    const v = selectedVariant(bestled90, axes, { [axes[0].name]: axes[0].choices[1].value })!;
    expect(v).toMatchObject({ id: 111887900, sku: 'APB907', price: 154000 });
    expect(variantLineSku(bestled90, v)).toBe('APB907');
    expect(variantSkuIsDistinct(bestled90, v)).toBe(true);
    expect(variantAttributes(bestled90, v)).toEqual({ potencia: '90W', colorLuz: 'Cálida 2700K' });
  });
});

describe('Flyhawk 40-80W: potencia y color de luz', () => {
  const axes = variantAxes(flyhawk);

  it('dos ejes: primero la potencia (decide el precio), después la temperatura de color', () => {
    expect(axes.map(a => a.legend)).toEqual(['Potencia', 'Temperatura de color']);
    expect(axes[0].choices.map(c => c.label)).toEqual(['40W', '60W', '80W']);
    expect(axes[1].choices.map(c => c.label)).toEqual(['Cálida 2200K', 'Cálida 2700K', 'Neutra 4000K']);
    expect([...axisPrices(flyhawk.variants!, axes[0], {})!.values()]).toEqual([442800, 478800, 514800]);
    // El color no cambia el precio: sus opciones no llevan precio
    expect(axisPrices(flyhawk.variants!, axes[1], {})).toBeUndefined();
    expect(axisPrices(flyhawk.variants!, axes[1], { [axes[0].name]: '80W' })).toBeUndefined();
  });

  it('antes no se podía pedir la de $514.800; ahora 80W 2200K es su variante, con su precio', () => {
    expect(flyhawk.price).toBe(442800);
    const v = selectedVariant(flyhawk, axes, { [axes[0].name]: '80W', [axes[1].name]: axes[1].choices[0].value })!;
    expect(v).toMatchObject({ id: 118197864, price: 514800 });
    expect(variantLabel(flyhawk, v)).toBe('80W · Cálida 2200K');
    expect(variantAttributes(flyhawk, v)).toEqual({ potencia: '80W', colorLuz: '80W · Cálida 2200K' });
  });

  it('SKU: la variante 2200K no tiene en Jumpseller y el del producto (APSB80N) es el de las 4000K → JS-<id>', () => {
    const v2200 = flyhawk.variants!.find(v => v.id === 118197864)!;
    const v4000 = flyhawk.variants!.find(v => v.id === 118197863)!;
    expect(flyhawk.sku).toBe('APSB80N');
    expect(variantSku(v2200)).toBe('');
    expect(variantLineSku(flyhawk, v2200)).toBe('JS-11521285');
    expect(variantLineSku(flyhawk, v4000)).toBe('APSB80N');
    // APSB80N es el de las tres 4000K (40W, 60W y 80W): no distingue la variante
    expect(variantSkuIsDistinct(flyhawk, v4000)).toBe(false);
    expect(variantSkuIsDistinct(flyhawk, v2200)).toBe(false);
  });

  it('lo que falta elegir, en palabras', () => {
    expect(missingChoicesText(axes)).toBe('una potencia y una temperatura de color');
    expect(missingChoicesText(axes.slice(1))).toBe('una temperatura de color');
  });
});

describe('Proyector antivandálico 100W: dos opciones de color, mismo precio', () => {
  const axes = variantAxes(antivandalico);

  it('«Color de luz: Cálida · Fría», sin precio por opción ni «desde»', () => {
    expect(axes.map(a => [a.legend, a.choices.map(c => c.label)])).toEqual([['Color de luz', ['Cálida', 'Fría']]]);
    expect(axisPrices(antivandalico.variants!, axes[0], {})).toBeUndefined();
    expect(variantFromPrice(antivandalico)).toBeUndefined();
    expect(missingChoicesText(axes)).toBe('un color de luz');
  });

  it('antes entraba como JS-2252962, sin color; ahora con el SKU de la variante', () => {
    const fria = selectedVariant(antivandalico, axes, { [axes[0].name]: 'Luz Fría' })!;
    expect(variantLineSku(antivandalico, fria)).toBe('CHIPX100NF');
    expect(variantAttributes(antivandalico, fria)).toEqual({ potencia: '100W', colorLuz: 'Fría' });
  });
});

describe('SKU de la variante: solo el suyo, nunca el del producto', () => {
  const sinSku = (id: number) => byJid(id).variants!.filter(v => !v.sku);

  it('en las 188, la línea lleva el SKU de la variante o «JS-<id>»', () => {
    for (const p of withChoice) {
      for (const v of p.variants!) {
        expect(variantSku(v), `${p.jumpseller_id} ${v.id}`).toBe(v.sku);
        expect(variantLineSku(p, v)).toBe(v.sku || `JS-${p.jumpseller_id}`);
      }
    }
  });

  it.each([
    // [jumpseller_id, SKU del producto en Jumpseller, por qué no es el de la variante]
    [2286835, 'FLCBC30F', 'foco codo 30W: es el de su variante Fría'],
    [2340468, 'PLSSMD10', 'proyector slim 30W: lo usan también el de 50W y el de 100W'],
    [2340483, 'PLSSMD10', 'proyector slim 50W: lo usan también el de 30W y el de 100W'],
    [3612990, 'DLS7LVB', 'downlight 7W slim: lo comparten sus dos variantes y el cilindro 7W'],
    [2354701, 'DLS7LVB', 'downlight cilindro 7W: lo comparten sus dos variantes y el slim 7W'],
    [2418983, 'PLRS18SB', 'panel redondo 18W con sensor: lo comparten sus tres variantes'],
  ])('%i (%s): %s → sin SKU arriba y «JS-<id>» en la línea', (id, productSku) => {
    const p = byJid(id);
    expect(p.sku).toBe(productSku);
    const missing = sinSku(id);
    expect(missing.length).toBeGreaterThan(0);
    for (const v of missing) {
      expect(variantSku(v)).toBe('');
      expect(variantLineSku(p, v)).toBe(`JS-${id}`);
      expect(variantSkuIsDistinct(p, v)).toBe(false);
    }
  });
});

describe('otros casos del snapshot', () => {
  it('foco a riel: el color de la carcasa («Negro», «Blanco») va también como terminación', () => {
    const riel = byJid(27987505);
    expect(variantAxes(riel).map(a => a.legend)).toEqual(['Color']);
    expect(variantAttributes(riel, riel.variants![0])).toMatchObject({ colorLuz: 'Negro', terminacion: 'Negro' });
  });

  it('proyector de estadio modular: sin temperatura en Jumpseller, el % distingue las dos cálidas', () => {
    const modular = byJid(32913027);
    expect(variantAxes(modular)[0].legend).toBe('Color de luz');
    expect(modular.variants!.map(v => variantLabel(modular, v))).toEqual([
      'Cálida, 1 % de luz azul', 'Cálida, 7 % de luz azul', 'Neutra 4000K', 'Fría 5000K',
    ]);
  });
});
