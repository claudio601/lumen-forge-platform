// src/lib/variants.ts
// Variantes de Jumpseller en la ficha (selector) y en la tarjeta (auditoría UX, D-01 y C-01).
//
// Jumpseller es la única fuente de verdad: el precio CON IVA, el SKU y las opciones de cada
// variante salen del snapshot. Aquí solo se ordenan y se escriben limpias: «Cálida 2700K»,
// «80W», «Negro»; nunca el texto crudo de Jumpseller («Luz Cálida 2200K - 1% Luz Azul»).
// D.S. N°1: el «% de luz azul» es el límite de cada clase (≤1 %, ≤7 %), no un valor de la
// temperatura (scripts/catalog.test.ts). Con la temperatura en el valor, la etiqueta es solo
// «Ámbar 2200K». Solo cuando Jumpseller no la trae («Luz Cálida - 1% Luz Azul»), el dato va
// aparte («1 % de luz azul»), porque es lo único que distingue las opciones; nunca como
// certificado (decisión del dueño, 2026-10-17).
// Tono: 2200K es «ámbar», aunque Jumpseller la llame «Luz Cálida»; 2700K y 3000K son «cálida»
// (decisión del dueño, 2026-10-23).
// Sin imports de datos: lo usan la tarjeta (bundle principal) y la ficha.

import type { Product, ProductVariant } from '@/data/catalog/types';
import type { RequestCartItem } from '@/types/request-order';

/** Tipo de opción: color de luz (temperatura), potencia u otra (color de la carcasa, largo…). */
export type VariantAxisKind = 'luz' | 'potencia' | 'otro';

export interface VariantChoice {
  /** Valor tal como viene de Jumpseller: identifica la opción. */
  value: string;
  /** Etiqueta limpia: «Cálida 2700K», «80W», «Negro». */
  label: string;
  /** Dato de Jumpseller que distingue la opción cuando no trae temperatura: «1 % de luz azul». */
  detail?: string;
  /** Temperatura de color leída del valor (solo opciones de luz que la traen). */
  kelvin?: number;
}

export interface VariantAxis {
  /** Nombre de la opción en Jumpseller («Color de Temperatura», «Potencia»). */
  name: string;
  kind: VariantAxisKind;
  /** Rótulo visible: «Temperatura de color», «Color de luz», «Potencia», «Color». */
  legend: string;
  choices: VariantChoice[];
}

/** Opción elegida por eje: nombre de la opción en Jumpseller → valor en Jumpseller. */
export type VariantSelection = Readonly<Record<string, string>>;

// ── Lectura de los valores de Jumpseller ────────────────────────────────────

const TONES: readonly (readonly [RegExp, string])[] = [
  [/c[aá]lida/i, 'Cálida'],
  [/\bneut?r?a\b/i, 'Neutra'], // también «Neuta» (así está en Jumpseller)
  [/natural/i, 'Natural'],
  [/fr[ií]a/i, 'Fría'],
  [/[aá]mbar/i, 'Ámbar'],
];
const KELVIN = /(\d{4})\s*k\b/i;
/** 2200K se llama «ámbar», no «cálida» (decisión del dueño, 2026-10-23). */
const AMBER_KELVIN = 2200;
const BLUE_LIGHT = /(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?luz\s+azul/i;
const RGB = /\brgb\b/i;
const WATTS = /^(\d+(?:[.,]\d+)?)\s*w$/i;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const isLight = (value: string) => TONES.some(([re]) => re.test(value)) || KELVIN.test(value) || RGB.test(value);

/**
 * Valor de una opción de luz, limpio: «Luz Cálida 2200K - 1% Luz Azul» → «Ámbar 2200K» (2200K es
 * ámbar); «3000K Luz Cálida» → «Cálida 3000K»; «Luz fría 6400k» → «Fría 6400K». Sin temperatura,
 * «Luz Cálida - 1% Luz Azul» → «Cálida» con el dato «1 % de luz azul». Sin tono ni temperatura
 * reconocibles, el texto tal cual (sin espacios de más).
 */
export function lightChoice(raw: string): Omit<VariantChoice, 'value'> {
  const text = squash(raw);
  const k = KELVIN.exec(text);
  const kelvin = k ? Number(k[1]) : undefined;
  const found = TONES.find(([re]) => re.test(text))?.[1];
  const tone = found === 'Cálida' && kelvin === AMBER_KELVIN ? 'Ámbar' : found;
  const blue = kelvin ? null : BLUE_LIGHT.exec(text);
  const detail = blue ? `${blue[1].replace('.', ',')} % de luz azul` : undefined;
  const parts = [tone, kelvin ? `${kelvin}K` : undefined].filter(Boolean);
  const label = parts.length ? parts.join(' ') : RGB.test(text) ? 'RGB' : text;
  return { label, ...(detail ? { detail } : {}), ...(kelvin ? { kelvin } : {}) };
}

function axisKind(name: string, values: readonly string[]): VariantAxisKind {
  if (/potencia/i.test(name) || values.every(v => WATTS.test(squash(v)))) return 'potencia';
  if (values.every(isLight)) return 'luz';
  return 'otro';
}

function choiceFor(kind: VariantAxisKind, raw: string): Omit<VariantChoice, 'value'> {
  if (kind === 'luz') return lightChoice(raw);
  const watts = kind === 'potencia' ? WATTS.exec(squash(raw)) : null;
  return { label: watts ? `${watts[1]}W` : squash(raw) };
}

function legendFor(kind: VariantAxisKind, name: string, choices: readonly VariantChoice[]): string {
  if (kind === 'potencia') return 'Potencia';
  if (kind === 'luz') return choices.every(c => c.kelvin) ? 'Temperatura de color' : 'Color de luz';
  const clean = squash(name);
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

const KIND_ORDER: Record<VariantAxisKind, number> = { potencia: 0, luz: 1, otro: 2 };

const optionValue = (variant: ProductVariant, name: string) => variant.options.find(o => o.name === name)?.value;

/** El producto tiene más de una variante en Jumpseller: el cliente tiene que elegir. */
export function hasVariantChoice(product: Pick<Product, 'variants'>): boolean {
  return (product.variants?.length ?? 0) > 1;
}

/**
 * Ejes del selector (uno por opción de Jumpseller), en este orden: potencia, luz y el resto.
 * Las opciones van en el orden de Jumpseller. Sin variantes para elegir, [].
 * En las BESTLED, la opción de luz lleva el nombre editorial de su variante CCT («Ámbar 2200K»),
 * el mismo de la sección «Variantes de temperatura de color», si la temperatura coincide.
 */
export function variantAxes(product: Pick<Product, 'variants' | 'cctVariants'>): VariantAxis[] {
  const variants = product.variants ?? [];
  if (variants.length < 2) return [];
  const names = [...new Set(variants.flatMap(v => v.options.map(o => o.name)))];
  const axes = names.map((name, position) => {
    const values = [...new Set(variants.map(v => optionValue(v, name)).filter((v): v is string => v !== undefined))];
    const kind = axisKind(name, values);
    const choices: VariantChoice[] = values.map(value => {
      const choice: VariantChoice = { value, ...choiceFor(kind, value) };
      if (kind === 'luz' && choice.kelvin) {
        const owners = variants.filter(v => optionValue(v, name) === value);
        const editorial = owners.length === 1
          ? product.cctVariants?.find(c => c.jumpseller_variant_id === owners[0].id && c.kelvin === choice.kelvin)
          : undefined;
        if (editorial?.name) choice.label = `${squash(editorial.name)} ${editorial.kelvin}K`;
      }
      return choice;
    });
    // Dos valores que se leen igual (p. ej. «Luz Cálida» y «Luz cálida»): se muestra el texto limpio
    const key = (c: VariantChoice) => `${c.label}|${c.detail ?? ''}`;
    for (const c of choices) {
      if (choices.filter(o => key(o) === key(c)).length > 1) {
        c.label = squash(c.value);
        delete c.detail;
      }
    }
    return { axis: { name, kind, legend: legendFor(kind, name, choices), choices }, position };
  });
  return axes
    .filter(a => a.axis.choices.length > 0)
    .sort((a, b) => KIND_ORDER[a.axis.kind] - KIND_ORDER[b.axis.kind] || a.position - b.position)
    .map(a => a.axis);
}

// ── Selección y precios ─────────────────────────────────────────────────────

/** Variantes compatibles con lo elegido hasta ahora (ignorando el eje `except`, si se indica). */
export function variantsMatching(
  variants: readonly ProductVariant[],
  selection: VariantSelection,
  except?: string,
): ProductVariant[] {
  return variants.filter(v =>
    Object.entries(selection).every(([name, value]) => name === except || optionValue(v, name) === value),
  );
}

/** La variante elegida: solo cuando hay una opción elegida en cada eje. */
export function selectedVariant(
  product: Pick<Product, 'variants'>,
  axes: readonly VariantAxis[],
  selection: VariantSelection,
): ProductVariant | undefined {
  if (!axes.length || axes.some(a => selection[a.name] === undefined)) return undefined;
  const hits = variantsMatching(product.variants ?? [], selection);
  return hits.length === 1 ? hits[0] : undefined;
}

/** La opción `value` del eje `axis` se puede combinar con lo elegido en los otros ejes. */
export function choiceAvailable(
  variants: readonly ProductVariant[],
  axis: VariantAxis,
  value: string,
  selection: VariantSelection,
): boolean {
  return variantsMatching(variants, { ...selection, [axis.name]: value }).length > 0;
}

/**
 * Precio CON IVA de cada opción del eje, solo si el eje decide el precio: con lo elegido en
 * los otros ejes, cada opción tiene un único precio y no todas cuestan lo mismo. Si no,
 * undefined (no se muestra precio en las opciones).
 */
export function axisPrices(
  variants: readonly ProductVariant[],
  axis: VariantAxis,
  selection: VariantSelection,
): Map<string, number> | undefined {
  const prices = new Map<string, number>();
  for (const c of axis.choices) {
    const options = new Set(variantsMatching(variants, { ...selection, [axis.name]: c.value }).map(v => v.price));
    if (options.size > 1) return undefined;
    if (options.size === 1) prices.set(c.value, [...options][0]);
  }
  return new Set(prices.values()).size > 1 ? prices : undefined;
}

/** Precio «desde» (CON IVA) de un producto cuyas variantes no cuestan todas lo mismo; si no, undefined. */
export function variantFromPrice(product: Pick<Product, 'variants'>): number | undefined {
  if (!hasVariantChoice(product)) return undefined;
  const prices = product.variants!.map(v => v.price);
  const min = Math.min(...prices);
  return min !== Math.max(...prices) ? min : undefined;
}

// ── La variante en la solicitud y en la cotización ─────────────────────────

/**
 * SKU de la variante: solo el que Jumpseller le dio a ella; vacío si no tiene. Nunca el del
 * producto: con varias variantes, ese SKU es el de otra (la Flyhawk usa el de sus 4000K; el
 * foco codo 30W, el de su Fría), lo comparten todas (PLRS18SB, DLS7LVB) o lo usan otros
 * productos (PLSSMD10 en los proyectores slim de 30W, 50W y 100W). Es la única regla de
 * respaldo del sitio: la ficha, la solicitud y la cotización la toman de aquí.
 */
export function variantSku(variant: ProductVariant): string {
  return variant.sku;
}

/** SKU de la línea (solicitud y cotización): el de la variante o, si no tiene, «JS-<id Jumpseller>». */
export function variantLineSku(product: Pick<Product, 'jumpseller_id'>, variant: ProductVariant): string {
  return variantSku(variant) || `JS-${product.jumpseller_id}`;
}

/**
 * El SKU de la variante la distingue de las otras del producto: lo tiene y ninguna otra lo
 * comparte (en Jumpseller, las 4000K de la Flyhawk comparten APSB80N). Solo entonces la ficha
 * dice que la elección define el SKU del despacho.
 */
export function variantSkuIsDistinct(product: Pick<Product, 'variants'>, variant: ProductVariant): boolean {
  return Boolean(variant.sku) && (product.variants ?? []).filter(v => v.sku === variant.sku).length === 1;
}

/** Opción de la variante en cada eje, en el orden del selector. */
function variantChoices(axes: readonly VariantAxis[], variant: ProductVariant): { axis: VariantAxis; choice: VariantChoice }[] {
  return axes.flatMap(axis => {
    const choice = axis.choices.find(c => c.value === optionValue(variant, axis.name));
    return choice ? [{ axis, choice }] : [];
  });
}

/**
 * Etiqueta legible de la variante, con todas sus opciones: «Ámbar 2200K», «80W · Cálida 2700K»,
 * «Cálida, 7 % de luz azul», «Negro». La ven el cliente (lista, avisos) y el vendedor (nota de
 * Pipedrive y correo).
 */
export function variantLabel(product: Pick<Product, 'variants' | 'cctVariants'>, variant: ProductVariant): string {
  return variantChoices(variantAxes(product), variant)
    .map(({ choice }) => (choice.detail ? `${choice.label}, ${choice.detail}` : choice.label))
    .join(' · ');
}

/** Temperatura de color de la variante (si su opción de luz la trae). */
export function variantKelvin(product: Pick<Product, 'variants' | 'cctVariants'>, variant: ProductVariant): number | undefined {
  return variantChoices(variantAxes(product), variant).find(({ axis }) => axis.kind === 'luz')?.choice.kelvin;
}

/**
 * Atributos de la línea de la solicitud. `colorLuz` lleva la etiqueta completa de la variante:
 * es el texto que la nota de Pipedrive y el correo a ventas muestran junto al nombre
 * (api/request-orders/create.ts). `potencia` y `terminacion` van como datos sueltos.
 */
export function variantAttributes(
  product: Pick<Product, 'variants' | 'cctVariants' | 'watts'>,
  variant: ProductVariant,
): RequestCartItem['attributes'] {
  const picked = variantChoices(variantAxes(product), variant);
  const power = picked.find(({ axis }) => axis.kind === 'potencia')?.choice.label;
  const finish = picked.find(({ axis }) => axis.kind === 'otro' && /color/i.test(axis.name))?.choice.label;
  return {
    potencia: power ?? (product.watts > 0 ? `${product.watts}W` : undefined),
    colorLuz: variantLabel(product, variant) || undefined,
    ...(finish ? { terminacion: finish } : {}),
  };
}

/** Lo que falta elegir, en una frase: «una temperatura de color», «una potencia y un color de luz». */
export function missingChoicesText(axes: readonly VariantAxis[]): string {
  const phrase = (a: VariantAxis) =>
    a.kind === 'potencia'
      ? 'una potencia'
      : a.legend === 'Temperatura de color'
        ? 'una temperatura de color'
        : a.legend === 'Color de luz'
          ? 'un color de luz'
          : `una opción de ${a.legend.toLowerCase()}`;
  const parts = axes.map(phrase);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : (parts[0] ?? '');
}
