// scripts/merchant-feed.ts
// Feed de productos para Google Merchant Center (CLAUDE.md §18): dist/feeds/google-merchant.xml,
// RSS 2.0 con el espacio de nombres g:. Corre en `npm run build`, después de generate-sitemap y
// antes del prerender: si falla, el build falla y Vercel mantiene el despliegue anterior.
//
// Sale de los mismos datos que las fichas (products de src/data/catalog, el contenido SEO de
// src/data/catalog/content/<jumpseller_id>.json y las especificaciones de
// descriptions.generated.ts): precio, nombre y fotos nunca se contradicen con el sitio.
// Un ítem por variante de Jumpseller (las de un producto comparten item_group_id).
//
// El feed NO se sube a Merchant hasta que exista la compra en línea (decisión D1 del dueño,
// 19-11-2026): Google no admite sitios donde solo se pide una cotización. Mientras tanto es un
// archivo que nadie descarga, con noindex (vercel.json).
//
// Funciones puras (como buildSitemap): buildFeedItems, renderFeed, parseFeed, inspectFeed y
// feedReport. Las usan scripts/merchant-feed.test.ts, scripts/check-prerender.ts (precio contra
// el JSON-LD de la ficha prerenderizada) y scripts/smoke.ts (el archivo servido).
//
// Uso: npm run merchant-feed [-- dist]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_NAME, SITE_URL } from '../src/config/site';
import { FREE_SHIPPING_THRESHOLD_CLP, PANEL_MASTER_BOX } from '../src/config/business';
import { products as catalogProducts } from '../src/data/catalog/index';
import { categories } from '../src/data/catalog/categories.config';
import { productDescriptions } from '../src/data/catalog/descriptions.generated';
import { productImageFacts } from '../src/data/catalog/og-images.generated';
import { sentences } from '../src/data/catalog/ds1';
import type { Product, ProductContent, ProductVariant } from '../src/data/catalog/types';
import type { ProductDescription, ProductImageFacts, SpecRow } from '../src/data/catalog/jumpseller.types';
import { MERCHANT_EXCLUSIONS, type MerchantExclusion } from '../src/data/merchant/exclusions';
import { googleCategoryFor } from '../src/data/merchant/google-categories';
import { encodeImageUrl } from '../src/lib/seo/ogImage';
import { htmlToText } from '../src/lib/html';
import { hasVariantChoice, selectionForVariant, VARIANT_PARAM, variantAxes, variantLabel } from '../src/lib/variants';
import { priceIndex } from '../api/_lib/catalog/price-index.generated';
import { findPolicyBreaking } from './jumpseller/descriptions';
import { findForbiddenKeys } from './jumpseller/write';
import { readContent } from './content/files';
import { retiredIn } from '../src/test/retired';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ruta del feed dentro de dist/ y en el sitio. */
export const MERCHANT_FEED_FILE = 'feeds/google-merchant.xml';
export const MERCHANT_FEED_PATH = `/${MERCHANT_FEED_FILE}`;

const G_NS = 'http://base.google.com/ns/1.0';

/**
 * D7 (pendiente del dueño): qué es la marca «JIE» de 277 productos. Si es marca propia, el SKU de
 * Jumpseller es el MPN y va en g:mpn; si es la del fabricante, nuestro SKU no es su MPN y lo
 * correcto sería identifier_exists: no (con D6, sin GTIN). Hasta que lo confirme, el feed no manda
 * ni mpn ni identifier_exists: los dos son opcionales para Google mientras no haya GTIN.
 * Esta constante es el único interruptor; identifier_exists se agrega cuando se decidan D6 y D7.
 */
export const SKU_IS_MPN = false;

/** Límites de Google (especificación de datos de producto, support.google.com/merchants/answer/7052112). */
export const LIMITS = {
  id: 50,
  title: 150,
  description: 5000,
  additionalImages: 10,
  productDetails: 100,
  detailSection: 140,
  detailName: 140,
  detailValue: 1000,
  highlightMin: 2,
  highlightMax: 10,
  highlight: 150,
  mpn: 70,
} as const;

/** Los tres grupos de especificaciones de la ficha (los mismos títulos de src/components/catalog/SpecGroups.tsx). */
export const SPEC_SECTIONS = [
  ['electricos', 'Eléctrico y fotométrico'],
  ['construccion', 'Construcción y operación'],
  ['componentes', 'Componentes y control'],
] as const;
/** Sección de product_detail con las opciones de la variante (temperatura de color, potencia, color). */
export const VARIANT_SECTION = 'Variante';

/** Tramos de precio de custom_label_1 (CON IVA). El alto parte en el monto del despacho sin costo. */
export const PRICE_TIER_LOW_CLP = 50_000;
export function priceTier(price: number): string {
  if (price < PRICE_TIER_LOW_CLP) return `menos-de-${PRICE_TIER_LOW_CLP}`;
  if (price <= FREE_SHIPPING_THRESHOLD_CLP) return `${PRICE_TIER_LOW_CLP}-a-${FREE_SHIPPING_THRESHOLD_CLP}`;
  return `mas-de-${FREE_SHIPPING_THRESHOLD_CLP}`;
}

/** Etiqueta de despacho para la tarifa mayor de Merchant (D4): postes y paneles de formato grande. */
export const BULKY_LABEL = 'voluminoso' as const;
export const isBulky = (p: Pick<Product, 'jumpseller_id' | 'category' | 'categories'>) =>
  PANEL_MASTER_BOX[p.jumpseller_id] !== undefined || p.category === 'poste' || p.categories.includes('poste');

// ── Textos ─────────────────────────────────────────────────────────────────────

/**
 * Lo que no va en un texto del feed (Google: solo el producto, sin políticas, despacho, plazos,
 * precios, enlaces ni el nombre de la tienda; reglas del sitio: nunca stock ni P.MAYOR). Una
 * oración, beneficio o fila de especificación que lo nombra se quita entera.
 */
export const COMMERCIAL_TEXT = new RegExp(
  [
    String.raw`e-?lights`,
    'cotiz',
    'despach',
    String.raw`\benv[ií](?:o|os|a|an|amos|ar)\b`,
    'gratis|gratuit',
    String.raw`\bstock\b|existencias`,
    String.raw`whats\s?app`,
    String.raw`https?:|www\.|@|\.cl\b`,
    'precio',
    String.raw`\$\s?\d`,
    String.raw`\bclp\b|\biva\b`,
    'plazo',
    String.raw`h[aá]bil`,
    'transferencia',
    String.raw`\bflow\b`,
    String.raw`comisi[oó]n`,
    'factura|boleta|orden de compra',
    String.raw`\bpagos?\b`,
    String.raw`\bpedidos?\b`,
    'solicit',
    String.raw`cons[uú]lt`,
    String.raw`cont[aá]ct`,
    String.raw`escr[ií]b(?:e|enos)`,
    String.raw`ll[aá]m(?:a|anos)\b`,
    String.raw`nuestra bodega|retiro en|quinta normal`,
    String.raw`por mayor|p\.\s?mayor`,
    'disponibilidad',
    String.raw`garant[ií]a legal|19\.?496|retracto|devoluci`,
    String.raw`equipo (?:comercial|de ventas)|ventas@`,
    // La voz de la tienda y sus servicios (asesoría, estudio DIALux): en el feed va solo el producto
    String.raw`con nosotros|nuestro equipo|cu[eé]ntan(?:os|oslo)|te (?:ayudamos|recomendamos)|\bpodemos\b`,
    String.raw`estudio lum[ií]nico|dialux`,
  ].join('|'),
  'i',
);

/** Subtítulos del contenido SEO que abren una sección sobre la compra («Cotización y despacho»): se quita entera. */
const COMMERCIAL_SECTION = /cotiz|despach|env[ií]o|precio|compra|pedido|solicitud|pago/i;

/**
 * Una oración que se puede publicar en el feed: sin lo comercial, sin plazos de despacho ni stock
 * (la regla de la sincronización) y sin las frases retiradas del sitio (src/test/retired.ts).
 */
export const isProductSentence = (s: string) => !COMMERCIAL_TEXT.test(s) && !findPolicyBreaking(s) && !retiredIn(s, true).length;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const withPeriod = (s: string) => (/[.!?:;…]$/.test(s) ? s : `${s}.`);

/** Corta en `max` caracteres, en el último fin de oración si lo hay. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Texto plano del contenido SEO o editorial (párrafos, subtítulos «**…**» y listas «- »): sin
 * negritas ni subtítulos, sin las secciones sobre la compra y sin las oraciones comerciales.
 * Un párrafo por línea.
 */
export function plainDescription(markdown: string): string {
  const blocks: string[] = [];
  let skip = false;
  for (const block of markdown.trim().split(/\n{2,}/)) {
    const heading = /^\*\*([^*]+)\*\*$/.exec(block.trim());
    if (heading) {
      skip = COMMERCIAL_SECTION.test(heading[1]);
      continue;
    }
    if (skip) continue;
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const parts = lines.length && lines.every(l => l.startsWith('- ')) ? lines.map(l => withPeriod(l.slice(2).trim())) : [lines.join(' ')];
    const kept = parts.flatMap(p => sentences(p)).map(squash).filter(s => s && isProductSentence(s));
    if (kept.length) blocks.push(kept.join(' '));
  }
  return blocks.join('\n');
}

/** Siglas y nombres que el título conserva tal cual (lo demás en MAYÚSCULAS pasa a minúsculas). */
export const TITLE_KEEP_UPPER: ReadonlySet<string> = new Set([
  'LED', 'SMD', 'COB', 'UFO', 'RGB', 'PIR', 'PMMA', 'ATEX', 'HL', 'SEC', 'AC', 'DC', 'USB', 'PVC', 'ABS', 'NEMA',
  'DALI', 'CRI', 'CCT', 'THD', 'SPD', 'MMA', 'IP', 'IK', 'UV', 'BESTLED', 'I', 'II', 'III', 'D.S.',
]);
/** Palabras con otra forma conocida (unidades y nombres propios). */
const TITLE_SPECIAL: Readonly<Record<string, string>> = {
  LEDS: 'LEDs',
  LM: 'lm',
  'LM.': 'lm.',
  'LM/W': 'lm/W',
  FLYHAWK: 'FlyHawk',
  BRIDGELUX: 'Bridgelux',
  VITO: 'Vito',
  FREYA: 'Freya',
};

const hasLower = (s: string) => s !== s.toLocaleUpperCase('es');
const hasLetter = (s: string) => /\p{L}/u.test(s);

function caseWord(core: string): string {
  if (!hasLetter(core) || hasLower(core)) return core; // ya viene escrita con minúsculas: tal cual
  if (TITLE_SPECIAL[core]) return TITLE_SPECIAL[core];
  if (TITLE_KEEP_UPPER.has(core)) return core;
  return core.toLocaleLowerCase('es');
}

function caseToken(token: string): string {
  if (TITLE_SPECIAL[token] || TITLE_KEEP_UPPER.has(token)) return TITLE_SPECIAL[token] ?? token;
  // Con cifras: medidas y códigos (9W, IP66, E27, GU10, 6500K) tal cual, con las unidades de largo en minúsculas
  if (/\d/.test(token)) {
    return token.replace(/(\d)X(?=\d)/g, '$1x').replace(/(\d)(CM|MM|MTS|MT|HRS|LM)(?![A-ZÁÉÍÓÚÑ])/g, (_, d: string, u: string) => d + u.toLowerCase());
  }
  // Partes separadas por «/» y «-» (C/CONTROL, TRI-PROOF), con la puntuación alrededor ((GRIS), MT.)
  return token
    .split(/([/-])/)
    .map(part => {
      if (part === '/' || part === '-') return part;
      const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(part)!;
      const core = TITLE_KEEP_UPPER.has(m[2] + m[3]) || TITLE_SPECIAL[m[2] + m[3]] ? m[2] + m[3] : m[2];
      const tail = core === m[2] ? m[3] : '';
      return m[1] + caseWord(core) + tail;
    })
    .join('');
}

/**
 * Nombre de Jumpseller en tipo oración (Google pide no escribir en mayúsculas para destacar):
 * «AMPOLLETA LED BOLA 9W E27» → «Ampolleta LED bola 9W E27». Conserva siglas, códigos con cifras
 * y las palabras que ya traen minúsculas.
 */
export function sentenceCase(name: string): string {
  const out = squash(name).split(' ').map(caseToken).join(' ');
  // Mayúscula inicial solo si empieza con una letra («120x30 marco…» queda igual)
  return /^\p{Ll}/u.test(out) ? out.charAt(0).toLocaleUpperCase('es') + out.slice(1) : out;
}

// ── Ítems ──────────────────────────────────────────────────────────────────────

export interface FeedDetail {
  section: string;
  name: string;
  value: string;
}

export interface FeedItem {
  /** <jumpseller_id>-<id de la variante>, o <jumpseller_id> si Jumpseller no le da variante. Nunca cambia. */
  id: string;
  /** Solo en productos con más de una variante: su jumpseller_id. */
  itemGroupId?: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  /**
   * D3 (aprobada el 19-11-2026): in_stock en todo lo que entra al feed; lo que se compra en plaza
   * va a la lista de exclusión. La ficha lo mostrará («Disponible») recién cuando exista la compra
   * en línea, el mismo día en que el feed se sube a Merchant; hasta entonces el sitio sigue con
   * «Consultar disponibilidad» y nadie descarga el feed (CLAUDE.md §3 y §18).
   */
  availability: 'in_stock';
  /** CON IVA, en CLP (el de la variante). */
  price: number;
  brand?: string;
  mpn?: string;
  condition: 'new';
  googleProductCategory?: number;
  productType: string;
  productDetails: FeedDetail[];
  productHighlights: string[];
  /** Solo el color del cuerpo (Blanco o Negro: rieles y focos a riel), nunca la temperatura de color. */
  color?: string;
  shippingLabel?: typeof BULKY_LABEL;
  /** 0: categoría, 1: tramo de precio, 2: destacado, 3: voluminoso. Nunca margen, costo ni P.MAYOR. */
  customLabels: [string | undefined, string | undefined, string | undefined, string | undefined];
  // Para las pruebas y los informes (no van al XML):
  jumpsellerId: number;
  variantId?: number;
  siteId: string;
}

/** Fuentes del feed: por defecto, las del sitio. Las pruebas pasan las suyas. */
export interface FeedSources {
  products: readonly Product[];
  content: (jumpsellerId: number) => ProductContent | undefined;
  descriptions: Readonly<Record<number, ProductDescription>>;
  exclusions: readonly MerchantExclusion[];
  site: string;
  skuIsMpn: boolean;
}

const contentCache = new Map<number, ProductContent | undefined>();
const siteContent = (id: number) => {
  if (!contentCache.has(id)) contentCache.set(id, readContent(ROOT, id));
  return contentCache.get(id);
};

export const defaultSources = (): FeedSources => ({
  products: catalogProducts,
  content: siteContent,
  descriptions: productDescriptions,
  exclusions: MERCHANT_EXCLUSIONS,
  site: SITE_URL,
  skuIsMpn: SKU_IS_MPN,
});

const categoryName = new Map(categories.map(c => [c.slug, c.name]));

/** Especificaciones de la ficha: las editoriales (BESTLED) o las de Jumpseller, en sus tres grupos. */
function specGroups(p: Product, d: ProductDescription | undefined): Record<(typeof SPEC_SECTIONS)[number][0], SpecRow[]> {
  const editorial = p.specsElectricos?.length || p.specsConstruccion?.length || p.specsComponentes?.length;
  return editorial
    ? { electricos: p.specsElectricos ?? [], construccion: p.specsConstruccion ?? [], componentes: p.specsComponentes ?? [] }
    : { electricos: d?.electricos ?? [], construccion: d?.construccion ?? [], componentes: d?.componentes ?? [] };
}

/** «Packaging por mayor» es el embalaje de la ficha, no la lista P.MAYOR: su nombre se permite. */
const PACKAGING_LABEL = /^packaging por mayor$/i;
/** Filas que no van: la garantía (la ficha la muestra aparte) y la marca (va en g:brand; D7 pendiente). */
const SKIPPED_LABEL = /garant[ií]a|^marca$/i;

function specDetails(p: Product, d: ProductDescription | undefined): FeedDetail[] {
  const groups = specGroups(p, d);
  return SPEC_SECTIONS.flatMap(([key, section]) =>
    groups[key].flatMap(row => {
      const name = squash(row.label);
      const value = row.value.split('\n').map(squash).filter(Boolean).join(', ');
      if (!name || !value || SKIPPED_LABEL.test(name)) return [];
      if (!isProductSentence(`${PACKAGING_LABEL.test(name) ? '' : name} ${value}`)) return [];
      if (name.length > LIMITS.detailName || value.length > LIMITS.detailValue) return [];
      return [{ section, name, value }];
    }),
  );
}

/** Opciones de la variante en cada eje del selector («Temperatura de color: Ámbar 2200K»). */
function variantDetails(p: Product, v: ProductVariant): FeedDetail[] {
  return variantAxes(p).flatMap(axis => {
    const choice = axis.choices.find(c => c.value === v.options.find(o => o.name === axis.name)?.value);
    return choice ? [{ section: VARIANT_SECTION, name: axis.legend, value: choice.detail ? `${choice.label}, ${choice.detail}` : choice.label }] : [];
  });
}

const BODY_COLOR = /^(blanco|negro)$/i;
function bodyColor(v: ProductVariant | undefined): string | undefined {
  const value = v?.options.map(o => squash(o.value)).find(x => BODY_COLOR.test(x));
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : undefined;
}

/**
 * Descripción del ítem: el texto editorial (BESTLED) o el contenido SEO (el mismo orden que la
 * ficha), en texto plano y sin lo comercial; si no queda nada, el texto de Jumpseller y, al
 * final, las especificaciones. Entre 1 y 5.000 caracteres.
 */
function itemDescription(p: Product, content: ProductContent | undefined, d: ProductDescription | undefined, title: string): string {
  const fromMarkdown = plainDescription(p.description || content?.description || '');
  if (fromMarkdown) return clip(fromMarkdown, LIMITS.description);
  const fromJumpseller = d?.text ? plainDescription(htmlToBlocks(d.text)) : '';
  if (fromJumpseller) return clip(fromJumpseller, LIMITS.description);
  const specs = specDetails(p, d).slice(0, 12).map(r => withPeriod(`${r.name}: ${r.value}`)).join(' ');
  return clip(specs || withPeriod(title), LIMITS.description);
}

/**
 * El texto de Jumpseller (HTML limpio de la sincronización: párrafos, listas, negritas y enlaces)
 * en el formato del contenido SEO, para pasarlo por plainDescription: un bloque por párrafo, «- »
 * por ítem de lista y «**…**» en las negritas (un párrafo entero en negrita es un subtítulo).
 */
export function htmlToBlocks(html: string): string {
  return htmlToText(
    html
      .replace(/<\/?(?:strong|b)(?: [^>]*)?>/g, '**')
      .replace(/<li(?: [^>]*)?>/g, '\uE001- ')
      .replace(/<br\s*\/?>|<\/?(?:p|ul|ol|table|thead|tbody|tr|h[1-6]|blockquote)(?: [^>]*)?>/g, '\uE002'),
    LIMITS.description * 4,
  )
    .replace(/\s*\uE002[\s\uE002]*/g, '\n\n')
    .replace(/[ \t]*\uE001/g, '\n')
    .replace(/\n\n\n+/g, '\n\n')
    .replace(/\*\*\s*\*\*/g, '')
    .trim();
}

function highlights(p: Product, content: ProductContent | undefined): string[] {
  const all = (p.keyBenefits?.length ? p.keyBenefits : content?.keyBenefits) ?? [];
  const kept = [...new Set(all.map(squash))].filter(h => h && h.length <= LIMITS.highlight && isProductSentence(h)).slice(0, LIMITS.highlightMax);
  return kept.length >= LIMITS.highlightMin ? kept : [];
}

/**
 * El SKU de la variante; sin selector, el de su única variante o el del producto (solo si
 * SKU_IS_MPN). Una variante sin SKU queda sin mpn: nunca el del producto, que repetiría el mismo
 * mpn en varias variantes.
 */
function mpnFor(p: Product, v: ProductVariant | undefined): string | undefined {
  const sku = (v ? v.sku ?? '' : p.singleVariant?.sku || p.sku || '').trim();
  return sku && sku.length <= LIMITS.mpn ? sku : undefined;
}

/** Ítems del feed: los productos publicados menos la lista de exclusión, uno por variante. */
export function buildFeedItems(sources: Partial<FeedSources> = {}): FeedItem[] {
  const src = { ...defaultSources(), ...sources };
  const excluded = new Set(src.exclusions.map(e => e.jumpseller_id));
  return src.products
    .filter(p => !excluded.has(p.jumpseller_id))
    .flatMap(p => {
      const content = p.description ? undefined : src.content(p.jumpseller_id);
      const d = src.descriptions[p.jumpseller_id];
      const base = sentenceCase(p.name);
      const shared = {
        description: itemDescription(p, content, d, base),
        imageLink: encodeImageUrl(p.images?.[0] ?? p.image),
        additionalImageLinks: (p.images ?? []).slice(1, 1 + LIMITS.additionalImages).map(encodeImageUrl),
        availability: 'in_stock' as const,
        ...(p.brand?.trim() ? { brand: p.brand.trim() } : {}),
        condition: 'new' as const,
        googleProductCategory: googleCategoryFor(p),
        productType: `Iluminación LED > ${categoryName.get(p.category) ?? p.category}`,
        productHighlights: highlights(p, content),
        ...(isBulky(p) ? { shippingLabel: BULKY_LABEL } : {}),
        jumpsellerId: p.jumpseller_id,
        siteId: p.id,
      };
      const specs = specDetails(p, d);
      const link = `${src.site}/producto/${p.id}`;
      const labels = (price: number): FeedItem['customLabels'] => [p.category, priceTier(price), p.featured ? 'destacado' : undefined, isBulky(p) ? BULKY_LABEL : undefined];
      if (!hasVariantChoice(p)) {
        const vid = p.jumpseller_variant_id;
        const mpn = src.skuIsMpn ? mpnFor(p, undefined) : undefined;
        return [{
          ...shared,
          id: vid ? `${p.jumpseller_id}-${vid}` : String(p.jumpseller_id),
          title: clip(base, LIMITS.title),
          link,
          price: p.price,
          ...(mpn ? { mpn } : {}),
          productDetails: specs.slice(0, LIMITS.productDetails),
          customLabels: labels(p.price),
          ...(vid ? { variantId: vid } : {}),
        } satisfies FeedItem];
      }
      const items = p.variants!.map((v): FeedItem => {
        const label = variantLabel(p, v);
        const color = bodyColor(v);
        const mpn = src.skuIsMpn ? mpnFor(p, v) : undefined;
        return {
          ...shared,
          id: `${p.jumpseller_id}-${v.id}`,
          itemGroupId: String(p.jumpseller_id),
          title: clip(label ? `${base} – ${label}` : base, LIMITS.title),
          link: `${link}?${VARIANT_PARAM}=${v.id}`,
          price: v.price,
          ...(mpn ? { mpn } : {}),
          productDetails: [...variantDetails(p, v), ...specs].slice(0, LIMITS.productDetails),
          ...(color ? { color } : {}),
          customLabels: labels(v.price),
          variantId: v.id,
        };
      });
      // Dos variantes con la misma etiqueta: Google pide títulos que distingan cada variante
      const repeated = new Set(items.filter((it, i) => items.findIndex(o => o.title === it.title) !== i).map(it => it.title));
      for (const it of items) {
        if (!repeated.has(it.title)) continue;
        const v = p.variants!.find(x => x.id === it.variantId)!;
        it.title = clip(`${it.title} (${v.sku || `variante ${v.id}`})`, LIMITS.title);
      }
      return items;
    });
}

// ── XML ────────────────────────────────────────────────────────────────────────

/** Caracteres que XML 1.0 no admite (controles y sustitutos sueltos): se quitan. */
// eslint-disable-next-line no-control-regex -- justamente los controles que XML 1.0 no admite
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const escapeXml = (value: string) =>
  value.replace(XML_INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const tag = (name: string, value: string | number | undefined, indent = '      ') =>
  value === undefined || value === '' ? [] : [`${indent}<g:${name}>${escapeXml(String(value))}</g:${name}>`];

function renderItem(it: FeedItem): string[] {
  return [
    '    <item>',
    ...tag('id', it.id),
    ...tag('item_group_id', it.itemGroupId),
    ...tag('title', it.title),
    ...tag('description', it.description),
    ...tag('link', it.link),
    ...tag('image_link', it.imageLink),
    ...it.additionalImageLinks.flatMap(u => tag('additional_image_link', u)),
    ...tag('availability', it.availability),
    ...tag('price', `${it.price} CLP`),
    ...tag('brand', it.brand),
    ...tag('mpn', it.mpn),
    ...tag('condition', it.condition),
    ...tag('google_product_category', it.googleProductCategory),
    ...tag('product_type', it.productType),
    ...it.productDetails.flatMap(d => [
      '      <g:product_detail>',
      ...tag('section_name', d.section, '        '),
      ...tag('attribute_name', d.name, '        '),
      ...tag('attribute_value', d.value, '        '),
      '      </g:product_detail>',
    ]),
    ...it.productHighlights.flatMap(h => tag('product_highlight', h)),
    ...tag('color', it.color),
    ...tag('shipping_label', it.shippingLabel),
    ...it.customLabels.flatMap((l, i) => tag(`custom_label_${i}`, l)),
    '    </item>',
  ];
}

export function renderFeed(items: readonly FeedItem[], site = SITE_URL): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:g="${G_NS}">`,
    '  <channel>',
    `    <title>${escapeXml(SITE_NAME)}</title>`,
    `    <link>${escapeXml(site)}</link>`,
    `    <description>${escapeXml(`Productos publicados en ${site}`)}</description>`,
    ...items.flatMap(renderItem),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

// ── Lectura y revisión del XML (build, check-prerender, humo y pruebas) ─────────

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(raw: string, at: number): string {
  return raw.replace(/&([^;\s&<]*);?/g, (m, body: string) => {
    if (!m.endsWith(';')) throw new Error(`«&» sin escapar cerca del carácter ${at}`);
    if (ENTITIES[body]) return ENTITIES[body];
    const num = /^#(\d+)$/.exec(body) ?? /^#x([0-9a-fA-F]+)$/.exec(body);
    if (num) return String.fromCodePoint(parseInt(num[1], body[1] === 'x' ? 16 : 10));
    throw new Error(`entidad desconocida &${body}; cerca del carácter ${at}`);
  });
}

/**
 * Lee un XML sin comentarios, CDATA ni DTD (el que escribe renderFeed, o el que sirve Vercel):
 * elementos, atributos entre comillas, texto y entidades. Estricto: lanza un Error ante una
 * etiqueta mal cerrada, un «<» o «&» suelto, texto fuera de la raíz o más de una raíz.
 */
export function parseFeed(xml: string): XmlElement {
  const decl = /^\uFEFF?<\?xml version="1\.0" encoding="UTF-8"\?>/.exec(xml);
  if (!decl) throw new Error('falta la declaración <?xml version="1.0" encoding="UTF-8"?>');
  let i = decl[0].length;
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  const NAME = /[A-Za-z_][\w.:-]*/y;
  const readName = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(xml);
    if (!m) throw new Error(`nombre de etiqueta inválido cerca del carácter ${i}`);
    i = NAME.lastIndex;
    return m[0];
  };
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = xml.slice(i, lt < 0 ? xml.length : lt);
    if (text) {
      if (!stack.length) {
        if (text.trim()) throw new Error(`texto fuera de la raíz cerca del carácter ${i}`);
      } else {
        if (text.includes('>')) throw new Error(`«>» suelto cerca del carácter ${i}`);
        stack[stack.length - 1].text += decodeEntities(text, i);
      }
    }
    if (lt < 0) break;
    i = lt + 1;
    if (xml.startsWith('!', i) || xml.startsWith('?', i)) throw new Error(`comentario, CDATA o instrucción no admitidos cerca del carácter ${lt}`);
    if (xml[i] === '/') {
      i++;
      const name = readName();
      while (/\s/.test(xml[i] ?? '')) i++;
      if (xml[i] !== '>') throw new Error(`cierre </${name}> mal formado cerca del carácter ${lt}`);
      i++;
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`</${name}> no cierra <${open?.name ?? '(nada)'}> (carácter ${lt})`);
      continue;
    }
    if (!stack.length && root) throw new Error(`segunda raíz <…> cerca del carácter ${lt}`);
    const el: XmlElement = { name: readName(), attrs: {}, children: [], text: '' };
    for (;;) {
      const ws = /\s*/y;
      ws.lastIndex = i;
      ws.exec(xml);
      const spaced = ws.lastIndex > i;
      i = ws.lastIndex;
      if (xml.startsWith('/>', i) || xml[i] === '>') break;
      if (!spaced) throw new Error(`atributo sin espacio antes cerca del carácter ${i}`);
      const attr = readName();
      const m = /="([^"<]*)"|='([^'<]*)'/y;
      m.lastIndex = i;
      const v = m.exec(xml);
      if (!v) throw new Error(`atributo ${attr} sin valor entre comillas cerca del carácter ${i}`);
      if (attr in el.attrs) throw new Error(`atributo ${attr} repetido cerca del carácter ${i}`);
      el.attrs[attr] = decodeEntities(v[1] ?? v[2], i);
      i = m.lastIndex;
    }
    const selfClosing = xml.startsWith('/>', i);
    i += selfClosing ? 2 : 1;
    if (stack.length) stack[stack.length - 1].children.push(el);
    else root = el;
    if (!selfClosing) stack.push(el);
  }
  if (stack.length) throw new Error(`<${stack[stack.length - 1].name}> sin cerrar`);
  if (!root) throw new Error('XML sin raíz');
  return root;
}

/** Atributos g: que puede traer un ítem (y cuántas veces). */
const SINGLE_TAGS = [
  'id', 'item_group_id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'mpn',
  'condition', 'google_product_category', 'product_type', 'color', 'shipping_label',
  'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4',
] as const;
const REPEATED_TAGS = ['additional_image_link', 'product_detail', 'product_highlight'] as const;
export const REQUIRED_TAGS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price'] as const;
const DETAIL_TAGS = ['section_name', 'attribute_name', 'attribute_value'];
export const AVAILABILITY_VALUES = ['in_stock', 'out_of_stock', 'preorder', 'backorder'];

/** Un ítem leído del XML: cada atributo g: con sus valores (product_detail aparte). */
export interface ParsedItem {
  values: Record<string, string[]>;
  details: FeedDetail[];
}

export interface FeedInspection {
  items: ParsedItem[];
  issues: string[];
}

export const ITEM_ID = /^\d+(?:-\d+)?$/;
export const PRICE = /^(\d+) CLP$/;

/** El valor de un atributo único del ítem ('' si no viene). */
export const one = (it: ParsedItem, name: string) => it.values[name]?.[0] ?? '';

/**
 * Revisa el XML del feed: RSS 2.0 con el espacio g:, el canal con título, enlace y descripción, y
 * cada ítem con los atributos obligatorios, sin g: desconocidos ni repetidos, con id válido y
 * único, precio «<entero> CLP», disponibilidad válida, link a una ficha en `origin` (con
 * ?variante=<id> si corresponde) e imágenes https. `expectedCount`: cuántos ítems debe tener.
 */
export function inspectFeed(xml: string, opts: { origin?: string; expectedCount?: number } = {}): FeedInspection {
  const origin = opts.origin ?? SITE_URL;
  let root: XmlElement;
  try {
    root = parseFeed(xml);
  } catch (err) {
    return { items: [], issues: [`XML inválido: ${(err as Error).message}`] };
  }
  const issues: string[] = [];
  if (root.name !== 'rss' || root.attrs.version !== '2.0') issues.push('la raíz no es <rss version="2.0">');
  if (root.attrs['xmlns:g'] !== G_NS) issues.push(`falta xmlns:g="${G_NS}"`);
  const channels = root.children.filter(c => c.name === 'channel');
  if (channels.length !== 1 || root.children.length !== 1) return { items: [], issues: [...issues, 'debe haber un <channel> y nada más'] };
  const channel = channels[0];
  for (const name of ['title', 'link', 'description']) {
    const els = channel.children.filter(c => c.name === name);
    if (els.length !== 1 || !els[0].text.trim()) issues.push(`el canal debe tener un <${name}> con texto`);
  }
  const unknownChannel = channel.children.filter(c => !['title', 'link', 'description', 'item'].includes(c.name));
  if (unknownChannel.length) issues.push(`el canal trae <${unknownChannel[0].name}>`);
  const items: ParsedItem[] = [];
  const ids = new Set<string>();
  for (const [n, el] of channel.children.filter(c => c.name === 'item').entries()) {
    const values: Record<string, string[]> = {};
    const details: FeedDetail[] = [];
    const where = `ítem ${n + 1}`;
    for (const c of el.children) {
      const name = c.name.startsWith('g:') ? c.name.slice(2) : '';
      if (!name || (!(SINGLE_TAGS as readonly string[]).includes(name) && !(REPEATED_TAGS as readonly string[]).includes(name))) {
        issues.push(`${where}: atributo desconocido <${c.name}>`);
        continue;
      }
      if (name === 'product_detail') {
        const get = (t: string) => c.children.filter(x => x.name === `g:${t}`);
        if (c.children.some(x => !DETAIL_TAGS.includes(x.name.slice(2)) || !x.name.startsWith('g:')) || DETAIL_TAGS.some(t => get(t).length !== 1 || !get(t)[0].text.trim())) {
          issues.push(`${where}: product_detail mal formado`);
        } else details.push({ section: get('section_name')[0].text, name: get('attribute_name')[0].text, value: get('attribute_value')[0].text });
        continue;
      }
      if (c.children.length) issues.push(`${where}: <${c.name}> trae elementos adentro`);
      (values[name] ??= []).push(c.text);
    }
    const it: ParsedItem = { values, details };
    const id = one(it, 'id');
    const label = id ? `ítem ${id}` : where;
    for (const t of REQUIRED_TAGS) if (!one(it, t).trim()) issues.push(`${label}: falta ${t}`);
    for (const t of SINGLE_TAGS) if ((values[t]?.length ?? 0) > 1) issues.push(`${label}: ${t} repetido`);
    if (id && (!ITEM_ID.test(id) || id.length > LIMITS.id)) issues.push(`${label}: id inválido`);
    if (id && ids.has(id)) issues.push(`${label}: id repetido`);
    ids.add(id);
    const price = one(it, 'price');
    if (price && !PRICE.test(price)) issues.push(`${label}: precio «${price}» no es «<entero> CLP»`);
    const availability = one(it, 'availability');
    if (availability && !AVAILABILITY_VALUES.includes(availability)) issues.push(`${label}: disponibilidad «${availability}»`);
    const link = one(it, 'link');
    if (link) {
      let url: URL | undefined;
      try {
        url = new URL(link);
      } catch {
        /* abajo */
      }
      const query = url ? [...url.searchParams.keys()] : [];
      if (!url || url.origin !== origin || !/^\/producto\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname) || url.hash || query.some(k => k !== VARIANT_PARAM) || query.length > 1) {
        issues.push(`${label}: link ${link} no es una ficha de ${origin}`);
      } else if (url.searchParams.has(VARIANT_PARAM) && !/^\d+$/.test(url.searchParams.get(VARIANT_PARAM)!)) {
        issues.push(`${label}: ?${VARIANT_PARAM}= inválido en ${link}`);
      }
    }
    for (const img of [one(it, 'image_link'), ...(values.additional_image_link ?? [])].filter(Boolean)) {
      if (!/^https:\/\/[\x21-\x7e]+$/.test(img)) issues.push(`${label}: imagen sin https o sin codificar: ${img}`);
    }
    if ((values.additional_image_link?.length ?? 0) > LIMITS.additionalImages) issues.push(`${label}: más de ${LIMITS.additionalImages} imágenes adicionales`);
    if (details.length > LIMITS.productDetails) issues.push(`${label}: más de ${LIMITS.productDetails} product_detail`);
    const highlightsCount = values.product_highlight?.length ?? 0;
    if (highlightsCount && (highlightsCount < LIMITS.highlightMin || highlightsCount > LIMITS.highlightMax)) issues.push(`${label}: ${highlightsCount} product_highlight`);
    items.push(it);
  }
  if (!items.length) issues.push('el feed no tiene ítems');
  if (opts.expectedCount !== undefined && items.length !== opts.expectedCount) issues.push(`${items.length} ítems; el repo tiene ${opts.expectedCount}`);
  return { items, issues };
}

/**
 * Lo que debe cumplirse siempre (bloquea el build): el XML se lee y pasa inspectFeed, cada precio
 * es el de priceIndex (el que usa el servidor), cada link es la ficha vigente del producto y su
 * ?variante= es una de sus variantes, y no hay campos prohibidos. Nada aquí depende de los datos
 * del día: los avisos de Jumpseller (fotos chicas, marcas vacías) van en feedReport.
 */
export function feedInvariantIssues(items: readonly FeedItem[], xml: string, site = SITE_URL): string[] {
  const issues = inspectFeed(xml, { origin: site, expectedCount: items.length }).issues;
  for (const it of items) {
    const entry = priceIndex[String(it.jumpsellerId)];
    const want = it.itemGroupId ? entry?.variants[String(it.variantId)]?.price : entry?.price;
    if (want !== it.price) issues.push(`ítem ${it.id}: precio ${it.price} y en priceIndex ${String(want)}`);
    const base = `${site}/producto/${it.siteId}`;
    if (it.link !== (it.itemGroupId ? `${base}?${VARIANT_PARAM}=${it.variantId}` : base)) issues.push(`ítem ${it.id}: link ${it.link} no es su ficha`);
  }
  const forbidden = findForbiddenKeys([xml]);
  if (forbidden.length) issues.push(`campos prohibidos en el feed: ${forbidden.join(', ')}`);
  for (const t of ['cost_per_item', 'stock', 'barcode', 'gtin', 'identifier_exists']) if (xml.includes(`<g:${t}`)) issues.push(`el feed trae <g:${t}>`);
  return issues;
}

// ── Informe (avisos que no bloquean) ───────────────────────────────────────────

/** Medida mínima de Google para image_link: obligatoria desde el 31-01-2027. */
export const MIN_IMAGE_SIDE = 500;
/**
 * Desde este día (un mes antes de la regla de Google) una primera foto bajo MIN_IMAGE_SIDE hace
 * fallar scripts/merchant-feed.test.ts, salvo en el robot. Antes, solo se informa en el build.
 */
export const SMALL_IMAGES_BLOCK_FROM = '2027-01-01';
export const smallImagesBlock = (isoDay: string) => isoDay >= SMALL_IMAGES_BLOCK_FROM;

export interface FeedReport {
  products: number;
  items: number;
  groups: number;
  excluded: number;
  /** jumpseller_id con la primera foto bajo 500 px por lado. */
  smallImages: number[];
  /** jumpseller_id sin medidas leídas de la primera foto (no se puede revisar). */
  unmeasuredImages: number[];
  /** jumpseller_id sin marca en Jumpseller. */
  withoutBrand: number[];
  /** Ítems cuyo ?variante= no deja elegida la variante en la ficha (sus opciones no la distinguen). */
  unresolvedVariants: string[];
  /** Exclusiones de productos que ya no se publican. */
  staleExclusions: number[];
}

export function feedReport(
  items: readonly FeedItem[],
  sources: Partial<Pick<FeedSources, 'products' | 'exclusions'>> = {},
  facts: Readonly<Record<number, ProductImageFacts>> = productImageFacts,
): FeedReport {
  const products = sources.products ?? catalogProducts;
  const exclusions = sources.exclusions ?? MERCHANT_EXCLUSIONS;
  const inFeed = [...new Set(items.map(i => i.jumpsellerId))];
  const byId = new Map(products.map(p => [p.jumpseller_id, p]));
  const factsOf = (jid: number) => {
    const f = facts[jid];
    return f && f.url === byId.get(jid)?.images?.[0] ? f : undefined;
  };
  return {
    products: inFeed.length,
    items: items.length,
    groups: new Set(items.flatMap(i => (i.itemGroupId ? [i.itemGroupId] : []))).size,
    excluded: exclusions.filter(e => byId.has(e.jumpseller_id)).length,
    smallImages: inFeed.filter(jid => {
      const f = factsOf(jid);
      return f?.width && f.height && Math.min(f.width, f.height) < MIN_IMAGE_SIDE;
    }),
    unmeasuredImages: inFeed.filter(jid => !factsOf(jid)?.width),
    withoutBrand: inFeed.filter(jid => !items.find(i => i.jumpsellerId === jid)?.brand),
    unresolvedVariants: items
      .filter(i => i.itemGroupId && !selectionForVariant(byId.get(i.jumpsellerId)!, i.variantId))
      .map(i => i.id),
    staleExclusions: exclusions.filter(e => !byId.has(e.jumpseller_id)).map(e => e.jumpseller_id),
  };
}

export function renderFeedReport(r: FeedReport, bytes: number): string[] {
  const list = (ids: readonly (number | string)[]) => (ids.length ? `: ${ids.join(', ')}` : '');
  return [
    `[merchant-feed] ${r.items} ítems de ${r.products} productos (${r.groups} con variantes; ${r.excluded} excluidos a mano) en dist/${MERCHANT_FEED_FILE}, ${(bytes / 1024).toFixed(0)} KB`,
    `[merchant-feed] Avisos (no bloquean; se corrigen en Jumpseller): ${r.smallImages.length} primeras fotos bajo ${MIN_IMAGE_SIDE} px${list(r.smallImages)}`,
    `[merchant-feed]   ${r.unmeasuredImages.length} primeras fotos sin medidas leídas${list(r.unmeasuredImages)}; ${r.withoutBrand.length} productos sin marca${list(r.withoutBrand)}`,
    ...(r.unresolvedVariants.length ? [`[merchant-feed]   ${r.unresolvedVariants.length} ítems cuyo ?${VARIANT_PARAM}= no deja elegida la variante${list(r.unresolvedVariants)}`] : []),
    ...(r.staleExclusions.length ? [`[merchant-feed]   exclusiones de productos que ya no se publican (se pueden borrar)${list(r.staleExclusions)}`] : []),
  ];
}

function main() {
  const out = resolve(ROOT, process.argv[2] ?? 'dist');
  const items = buildFeedItems();
  const xml = renderFeed(items);
  const issues = feedInvariantIssues(items, xml);
  if (issues.length) {
    for (const i of issues.slice(0, 50)) console.log(`::error title=Feed de Merchant::${i}`);
    console.error(`[merchant-feed] ${issues.length} problema(s): no se escribió el feed`);
    process.exit(1);
  }
  mkdirSync(join(out, dirname(MERCHANT_FEED_FILE)), { recursive: true });
  writeFileSync(join(out, MERCHANT_FEED_FILE), xml, 'utf8');
  for (const line of renderFeedReport(feedReport(items), Buffer.byteLength(xml))) console.log(line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
