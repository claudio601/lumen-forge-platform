// scripts/merchant-feed.test.ts
// Pruebas del feed de Google Merchant Center (scripts/merchant-feed.ts, CLAUDE.md §18). Los
// números de cada bloque son los de la especificación (§6). Ninguna prueba escribe un precio:
// se leen de products y de priceIndex (CLAUDE.md §14).
//
// Lo que depende de los datos que trae Jumpseller ese día (formato y medidas de las fotos, que
// no se cuele un servicio) solo corre fuera del robot (isSyncBot): en su PR se informa en el
// resumen del build, nunca bloquea los precios.

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../src/config/site';
import { products } from '../src/data/catalog/index';
import { categories } from '../src/data/catalog/categories.config';
import { productImageFacts } from '../src/data/catalog/og-images.generated';
import { RETIRED_SITE_IDS } from '../src/data/catalog/renamed-ids';
import { MERCHANT_EXCLUSIONS } from '../src/data/merchant/exclusions';
import {
  CATEGORY_GOOGLE_ID,
  GOOGLE_CATEGORY_PATHS,
  googleCategoryFor,
  POLE,
  POLE_ARM,
  PRODUCT_GOOGLE_CATEGORY,
  TRACK_ACCESSORY,
  TRACK_FIXTURE,
  TRACK_RAIL,
} from '../src/data/merchant/google-categories';
import { PICKUP_PLACE } from '../src/config/business';
import { encodeImageUrl } from '../src/lib/seo/ogImage';
import { indexableRoutes, productPath } from '../src/lib/seo/routes';
import type { Product } from '../src/data/catalog/types';
import { hasVariantChoice, VARIANT_PARAM } from '../src/lib/variants';
import { retiredIn } from '../src/test/retired';
import { isSyncBot } from '../src/test/syncBot';
import { priceIndex } from '../api/_lib/catalog/price-index.generated';
import { findRuleBreaking } from './jumpseller/descriptions';
import { findForbiddenKeys } from './jumpseller/write';
import {
  buildFeedItems,
  BULKY_LABEL,
  CCT_LABEL,
  DS1_MENTION,
  escapeXml,
  feedInvariantIssues,
  feedReport,
  htmlToBlocks,
  inspectFeed,
  isOwnBrand,
  LIMITS,
  MERCHANT_FEED_PATH,
  MIN_IMAGE_SIDE,
  one,
  parseFeed,
  plainDescription,
  priceTier,
  renderFeed,
  REQUIRED_TAGS,
  OWN_BRANDS,
  sentenceCase,
  smallImagesBlock,
  SPEC_SECTIONS,
  VARIANT_SECTION,
  type FeedItem,
} from './merchant-feed';

const G_NS = 'http://base.google.com/ns/1.0';
const { window } = new JSDOM('');
/** Un lector de XML independiente de parseFeed (el de jsdom). */
const domParse = (text: string) => new window.DOMParser().parseFromString(text, 'application/xml');
const items = buildFeedItems();
const xml = renderFeed(items);
const byJid = new Map(products.map(p => [p.jumpseller_id, p]));
const excluded = new Set(MERCHANT_EXCLUSIONS.map(e => e.jumpseller_id));
const published = products.filter(p => !excluded.has(p.jumpseller_id));
const groupsOf = (list: readonly FeedItem[]) => {
  const out = new Map<number, FeedItem[]>();
  for (const it of list) out.set(it.jumpsellerId, [...(out.get(it.jumpsellerId) ?? []), it]);
  return out;
};
/** Todos los textos de un ítem que ve el comprador (sin el título, que es el nombre de Jumpseller). */
const bodyTexts = (it: FeedItem) => [it.description, ...it.productHighlights, ...it.productDetails.flatMap(d => [d.section, d.name, d.value])];
/** Pruebas que recorren los 4-5 MB del feed: con todas las de api/ en paralelo, más de 5 s. */
const HEAVY = 60_000;

describe('feed de Merchant: lo que genera el build', () => {
  it('pasa las mismas revisiones que bloquean el build (feedInvariantIssues)', () => {
    expect(feedInvariantIssues(items, xml)).toEqual([]);
  }, HEAVY);

  it('1. cada precio es el del sitio: priceIndex (servidor) y products (ficha), por variante', () => {
    for (const it of items) {
      const p = byJid.get(it.jumpsellerId)!;
      const entry = priceIndex[String(it.jumpsellerId)];
      expect(entry, `${it.id} en priceIndex`).toBeDefined();
      if (it.itemGroupId) {
        expect(it.price, it.id).toBe(entry.variants[String(it.variantId)].price);
        expect(it.price, it.id).toBe(p.variants!.find(v => v.id === it.variantId)!.price);
      } else {
        expect(it.price, it.id).toBe(entry.price);
        expect(it.price, it.id).toBe(p.price);
      }
      expect(Number.isInteger(it.price) && it.price > 0, it.id).toBe(true);
    }
    for (const parsed of inspectFeed(xml).items) {
      const it = items.find(i => i.id === one(parsed, 'id'))!;
      expect(one(parsed, 'price')).toBe(`${it.price} CLP`);
    }
  }, HEAVY);

  it('2. ids estables: únicos, de 1 a 50 caracteres, solo ids de Jumpseller; un renombre no los cambia', () => {
    const ids = items.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids.map(i => i.toLowerCase())).size).toBe(ids.length);
    for (const it of items) {
      expect(it.id, it.id).toMatch(/^[0-9]+(-[0-9]+)?$/);
      expect(it.id.length).toBeLessThanOrEqual(LIMITS.id);
      expect(it.id).toBe(it.variantId ? `${it.jumpsellerId}-${it.variantId}` : String(it.jumpsellerId));
    }
    // Renombre en memoria (como una fila nueva de renamed-ids.ts): cambian los links, no los ids
    const renamed = buildFeedItems({ products: products.map(p => ({ ...p, id: `${p.id}-renombrado` })) });
    expect(renamed.map(i => i.id)).toEqual(ids);
    expect(renamed.map(i => i.link)).toEqual(items.map(i => i.link.replace(`/producto/${i.siteId}`, `/producto/${i.siteId}-renombrado`)));
  }, HEAVY);

  it('3. cada link es la ficha vigente e indexable del producto, con ?variante= de una de sus variantes', () => {
    const indexable = new Set(indexableRoutes());
    for (const it of items) {
      const p = byJid.get(it.jumpsellerId)!;
      expect(it.siteId).toBe(p.id);
      expect(RETIRED_SITE_IDS.has(p.id), `${p.id} es un id retirado`).toBe(false);
      expect(indexable.has(productPath(p.id)), `${productPath(p.id)} no es indexable`).toBe(true);
      const url = new URL(it.link);
      expect(url.origin + url.pathname).toBe(`${SITE_URL}${productPath(p.id)}`);
      if (hasVariantChoice(p)) {
        expect([...url.searchParams.keys()]).toEqual([VARIANT_PARAM]);
        expect(p.variants!.map(v => String(v.id))).toContain(url.searchParams.get(VARIANT_PARAM));
      } else {
        expect(url.search, it.link).toBe('');
      }
      expect(url.hash).toBe('');
    }
  });

  it('4. sin campos prohibidos: costos, stock, códigos de barra, P.MAYOR, bodega ni comisión de Flow', () => {
    expect(findForbiddenKeys([xml])).toEqual([]);
    expect(xml).not.toMatch(/cost_per_item|barcode|<g:(?:stock|gtin|cost_of_goods_sold)\b/i);
    expect(xml).not.toMatch(/p\.\s?mayor/i);
    // «por mayor» solo en el nombre de la fila «Packaging por mayor» (el embalaje de la ficha)
    for (const m of xml.matchAll(/.{0,40}por mayor.{0,25}/gi)) expect(m[0], m[0]).toMatch(/<g:attribute_name>Packaging por mayor<\/g:attribute_name>/);
    expect(xml.toLowerCase()).not.toContain(PICKUP_PLACE.toLowerCase());
    expect(xml).not.toMatch(/quinta normal/i);
    const bad = items.flatMap(it => [it.title, ...bodyTexts(it)].filter(t => /\bstock\b|existencias|comisi[oó]n|\bflow\b/i.test(t)).map(t => `${it.id}: ${t}`));
    expect(bad).toEqual([]);
  }, HEAVY);

  it('5. textos permitidos: título en tipo oración y descripción solo del producto', () => {
    const banned = /https?:|www\.|e-?lights|cotiz|despach|env[ií]os?\b|gratis|\bstock\b|whats\s?app|\$\s?\d|\bclp\b|\biva\b/i;
    const bad: string[] = [];
    const want = (ok: boolean, it: FeedItem, what: string) => {
      if (!ok) bad.push(`${it.id}: ${what}`);
    };
    // Los textos se repiten entre variantes: cada uno se revisa una vez
    const checked = new Set<string>();
    for (const it of items) {
      want(it.title.length > 0 && it.title.length <= LIMITS.title, it, `título de ${it.title.length} caracteres`);
      want(it.title === it.title.trim(), it, 'título con espacios en los bordes');
      want(it.description.length > 0 && it.description.length <= LIMITS.description, it, `descripción de ${it.description.length} caracteres`);
      want(!/\*\*|^- /m.test(it.description), it, 'descripción con negritas o listas');
      for (const t of bodyTexts(it)) {
        if (checked.has(t)) continue;
        checked.add(t);
        want(!banned.test(t), it, `texto comercial: ${t}`);
        want(findRuleBreaking(t) === null, it, `regla del sitio (${findRuleBreaking(t)}): ${t}`);
        want(!retiredIn(t, true).length, it, `frase retirada (${retiredIn(t, true).join(', ')}): ${t}`);
      }
      const h = it.productHighlights.length;
      want(h === 0 || (h >= LIMITS.highlightMin && h <= LIMITS.highlightMax), it, `${h} product_highlight`);
      for (const x of it.productHighlights) want(x.length <= LIMITS.highlight, it, `product_highlight de ${x.length} caracteres`);
      want(it.productDetails.length <= LIMITS.productDetails, it, `${it.productDetails.length} product_detail`);
      for (const d of it.productDetails) {
        want(!!(d.section && d.name && d.value), it, `product_detail vacío: ${JSON.stringify(d)}`);
        want(d.name.length <= LIMITS.detailName && d.value.length <= LIMITS.detailValue, it, `product_detail largo: ${d.name}`);
        want(!/garant[ií]a|^marca$/i.test(d.name), it, `fila que no va: ${d.name}`);
      }
    }
    expect(bad).toEqual([]);
  }, HEAVY);

  it('6. imágenes en https, ASCII y codificadas como en el JSON-LD de la ficha', () => {
    for (const it of items) {
      const p = byJid.get(it.jumpsellerId)!;
      expect(it.imageLink).toBe(encodeImageUrl(p.images?.[0] ?? p.image));
      expect(it.additionalImageLinks).toEqual((p.images ?? []).slice(1, 1 + LIMITS.additionalImages).map(encodeImageUrl));
      for (const u of [it.imageLink, ...it.additionalImageLinks]) {
        expect(u, it.id).toMatch(/^https:\/\/[\x21-\x7e]+$/);
        expect(u.length).toBeLessThanOrEqual(2000);
      }
    }
  });

  it.skipIf(isSyncBot)('6. primera foto: PNG, JPEG o WebP, menos de 16 MB y 64 MP; bajo 500 px avisa y desde el 01-01-2027 bloquea', () => {
    for (const jid of new Set(items.map(i => i.jumpsellerId))) {
      const p = byJid.get(jid)!;
      const f = productImageFacts[jid];
      if (!f || f.url !== p.images?.[0]) continue; // sin revisar todavía: lo informa el build
      expect(['png', 'jpeg', 'webp'], `${jid}: formato ${f.format}`).toContain(f.format);
      expect(f.bytes, String(jid)).toBeLessThan(16 * 1024 * 1024);
      if (f.width && f.height) expect(f.width * f.height, String(jid)).toBeLessThan(64_000_000);
    }
    const small = feedReport(items).smallImages;
    if (small.length) console.warn(`[merchant-feed] ${small.length} primeras fotos bajo ${MIN_IMAGE_SIDE} px (cambiarlas en Jumpseller): ${small.join(', ')}`);
    if (smallImagesBlock(new Date().toISOString().slice(0, 10))) expect(small, `fotos bajo ${MIN_IMAGE_SIDE} px`).toEqual([]);
  });

  it('6. la fecha del bloqueo de las fotos chicas es fija', () => {
    expect(smallImagesBlock('2026-11-19')).toBe(false);
    expect(smallImagesBlock('2026-12-31')).toBe(false);
    expect(smallImagesBlock('2027-01-01')).toBe(true);
    expect(smallImagesBlock('2027-01-31')).toBe(true);
  });

  it('8. variantes coherentes: un item_group_id por producto, títulos distintos y color solo Blanco o Negro', () => {
    for (const [jid, group] of groupsOf(items)) {
      const p = byJid.get(jid)!;
      if (hasVariantChoice(p)) {
        expect(group.length).toBe(p.variants!.length);
        expect(new Set(group.map(i => i.itemGroupId))).toEqual(new Set([String(jid)]));
        expect(new Set(group.map(i => i.title)).size, `${jid}: títulos repetidos`).toBe(group.length);
        expect(new Set(group.map(i => i.variantId))).toEqual(new Set(p.variants!.map(v => v.id)));
      } else {
        expect(group.length).toBe(1);
        expect(group[0].itemGroupId).toBeUndefined();
      }
      for (const it of group) if (it.color !== undefined) expect(['Blanco', 'Negro']).toContain(it.color);
    }
    expect(new Set(items.map(i => i.title)).size).toBe(items.length);
  });

  it('8. etiquetas: categoría, tramo de precio, destacado y voluminoso (postes y paneles de caja master)', () => {
    for (const it of items) {
      const p = byJid.get(it.jumpsellerId)!;
      expect(it.customLabels[0]).toBe(p.category);
      expect(it.customLabels[1]).toBe(priceTier(it.price));
      expect(it.customLabels[2]).toBe(p.featured ? 'destacado' : undefined);
      expect(it.customLabels[3]).toBe(it.shippingLabel);
      expect(it.availability).toBe('in_stock');
      expect(it.condition).toBe('new');
      expect(it.productType.startsWith('Iluminación LED > ')).toBe(true);
    }
    expect(items.some(i => i.shippingLabel === BULKY_LABEL)).toBe(true);
    expect(priceTier(1)).toBe('menos-de-50000');
  });

  it('9. solo productos publicados, sin los excluidos: el total es «publicados menos excluidos», con las variantes', () => {
    const expected = published.reduce((n, p) => n + (hasVariantChoice(p) ? p.variants!.length : 1), 0);
    expect(items).toHaveLength(expected);
    expect(new Set(items.map(i => i.jumpsellerId))).toEqual(new Set(published.map(p => p.jumpseller_id)));
    for (const it of items) expect(excluded.has(it.jumpsellerId)).toBe(false);
    // Una exclusión saca todos los ítems de ese producto, y nada más
    const victim = products.find(p => hasVariantChoice(p))!;
    const without = buildFeedItems({ exclusions: [{ jumpseller_id: victim.jumpseller_id, motivo: 'prueba' }] });
    expect(without.some(i => i.jumpsellerId === victim.jumpseller_id)).toBe(false);
    expect(without).toHaveLength(buildFeedItems({ exclusions: [] }).length - victim.variants!.length);
  }, HEAVY);

  it('9. la lista de exclusión: ids únicos y un motivo con texto', () => {
    const ids = MERCHANT_EXCLUSIONS.map(e => e.jumpseller_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of MERCHANT_EXCLUSIONS) {
      expect(Number.isInteger(e.jumpseller_id) && e.jumpseller_id > 0).toBe(true);
      expect(e.motivo.trim().length, String(e.jumpseller_id)).toBeGreaterThan(3);
    }
  });

  it.skipIf(isSyncBot)('9. ningún servicio (instalación, estudio DIALux, visita técnica) entra al feed', () => {
    const service = /^\s*(?:servicio|instalaci[oó]n|estudio|visita|mano de obra)\b|dialux|visita t[eé]cnica/i;
    for (const it of items) expect(it.title, it.id).not.toMatch(service);
  });

  it('10. XML válido para un lector independiente (DOMParser de jsdom) y para parseFeed', () => {
    const doc = domParse(xml);
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.nodeName).toBe('rss');
    expect(doc.documentElement.getAttribute('version')).toBe('2.0');
    const channel = doc.documentElement.firstElementChild!;
    expect(channel.nodeName).toBe('channel');
    for (const name of ['title', 'link', 'description']) expect(channel.getElementsByTagName(name)[0]?.textContent?.trim(), name).toBeTruthy();
    const domItems = [...doc.getElementsByTagName('item')];
    expect(domItems).toHaveLength(items.length);
    const bad: string[] = [];
    for (const [n, el] of domItems.entries()) {
      for (const child of el.children) if (child.namespaceURI !== G_NS) bad.push(`${items[n].id}: <${child.nodeName}> fuera de g:`);
      const text = (name: string) => el.getElementsByTagNameNS(G_NS, name)[0]?.textContent;
      for (const [tag, want] of [['id', items[n].id], ['title', items[n].title], ['description', items[n].description], ['link', items[n].link]] as const) {
        if (text(tag) !== want) bad.push(`${items[n].id}: ${tag} distinto al leerlo`);
      }
      for (const t of REQUIRED_TAGS) if (!text(t)) bad.push(`${items[n].id}: falta ${t}`);
    }
    expect(bad).toEqual([]);
    const inspection = inspectFeed(xml, { origin: SITE_URL, expectedCount: items.length });
    expect(inspection.issues).toEqual([]);
    expect(inspection.items.map(i => one(i, 'id'))).toEqual(items.map(i => i.id));
  }, HEAVY);

  it('10. el escape de XML es reversible (tildes, &, <, comillas) y quita los controles que XML no admite', () => {
    const tricky = 'Foco «riel» 3 & 4 <negro> "x" \'y\' Ø48 mm\u0001\u000b';
    const sample: FeedItem = { ...items[0], title: tricky, description: `${tricky}\nsegunda línea` };
    const out = renderFeed([sample]);
    const parsed = inspectFeed(out, { origin: SITE_URL });
    expect(parsed.issues).toEqual([]);
    expect(one(parsed.items[0], 'title')).toBe('Foco «riel» 3 & 4 <negro> "x" \'y\' Ø48 mm');
    expect(one(parsed.items[0], 'description')).toBe('Foco «riel» 3 & 4 <negro> "x" \'y\' Ø48 mm\nsegunda línea');
    const doc = domParse(out);
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });

  it('10. parseFeed e inspectFeed rechazan un XML roto, atributos desconocidos y datos fuera de formato', () => {
    const head = '<?xml version="1.0" encoding="UTF-8"?>';
    for (const bad of ['', '<rss/>', `${head}<rss><a></rss>`, `${head}<rss>a & b</rss>`, `${head}<rss/><rss/>`, `${head}texto<rss/>`, `${head}<rss><![CDATA[x]]></rss>`, `${head}<rss><a>&nbsp;</a></rss>`]) {
      expect(() => parseFeed(bad), bad).toThrow();
    }
    const first = `<g:id>${items[0].id}</g:id>`;
    const cases: [string, string, RegExp][] = [
      ['sin título', `<g:title>${escapeXml(items[0].title)}</g:title>`, /falta title/],
      ['atributo desconocido', first, /atributo desconocido <g:foo>/],
      ['precio sin moneda', `<g:price>${items[0].price} CLP</g:price>`, /no es «<entero> CLP»/],
      ['link a otro sitio', `<g:link>${escapeXml(items[0].link)}</g:link>`, /no es una ficha de/],
      ['id repetido', `<g:id>${items[0].id}</g:id>`, /id repetido/],
    ];
    const replacement: Record<string, string> = {
      'sin título': '',
      'atributo desconocido': `${first}<g:foo>x</g:foo>`,
      'precio sin moneda': `<g:price>${items[0].price}</g:price>`,
      'link a otro sitio': '<g:link>https://otro.cl/producto/x</g:link>',
      'id repetido': `<g:id>${items[1].id}</g:id>`,
    };
    for (const [name, find, expected] of cases) {
      const changed = xml.replace(find, replacement[name]);
      expect(changed, name).not.toBe(xml);
      expect(inspectFeed(changed).issues.join('\n'), name).toMatch(expected);
    }
    expect(inspectFeed(xml, { expectedCount: items.length + 1 }).issues.join('\n')).toMatch(/ítems; el repo tiene/);
    expect(inspectFeed(xml, { origin: 'https://otro.cl' }).issues.length).toBeGreaterThan(0);
    expect(inspectFeed(xml.replace(/<g:link>([^<]+)<\/g:link>/, '<g:link>$1?utm_source=x</g:link>')).issues.join('\n')).toMatch(/no es una ficha/);
  }, HEAVY);

  it('el feed vive en /feeds/google-merchant.xml', () => {
    expect(MERCHANT_FEED_PATH).toBe('/feeds/google-merchant.xml');
  });
});

describe('feed de Merchant: categorías, grupos y mpn', () => {
  it('cada categoría del sitio y cada producto tiene un ID revisado de la taxonomía de Google', () => {
    for (const c of categories) {
      expect(CATEGORY_GOOGLE_ID[c.slug], c.slug).toBeDefined();
      expect(GOOGLE_CATEGORY_PATHS[CATEGORY_GOOGLE_ID[c.slug]], c.slug).toBeTruthy();
    }
    for (const id of Object.values(PRODUCT_GOOGLE_CATEGORY)) expect(GOOGLE_CATEGORY_PATHS[id]).toBeTruthy();
    for (const p of products) expect(GOOGLE_CATEGORY_PATHS[googleCategoryFor(p)!], `${p.jumpseller_id} ${p.name}`).toBeTruthy();
    for (const it of items) expect(it.googleProductCategory).toBe(googleCategoryFor(byJid.get(it.jumpsellerId)!));
  });

  it('focos a riel y postes se deciden por el nombre', () => {
    const at = (category: string, name: string) => googleCategoryFor({ jumpseller_id: 1, category, name });
    expect(at('focos-a-riel', 'RIEL MONOFÁSICO 2 MT.')).toBe(TRACK_RAIL);
    expect(at('focos-a-riel', 'FOCO RIEL 30W NEGRO')).toBe(TRACK_FIXTURE);
    expect(at('focos-a-riel', 'CONECTOR L PARA RIEL')).toBe(TRACK_ACCESSORY);
    expect(at('poste', 'BRAZO GALVANIZADO PARA POSTE 1 SALIDA')).toBe(POLE_ARM);
    expect(at('poste', 'POSTE TUBULAR GALVANIZADO 4MTS')).toBe(POLE);
    expect(at('paneles-led', 'PANEL LED 60X60')).toBe(CATEGORY_GOOGLE_ID['paneles-led']);
  });

  it('las secciones de product_detail son los grupos de la ficha (SpecGroups.tsx) más «Variante»', () => {
    const source = readFileSync(new URL('../src/components/catalog/SpecGroups.tsx', import.meta.url), 'utf-8');
    for (const [key, title] of SPEC_SECTIONS) expect(source).toContain(`['${key}', '${title}']`);
    const sections = new Set(items.flatMap(i => i.productDetails.map(d => d.section)));
    for (const s of sections) expect([...SPEC_SECTIONS.map(([, t]) => t), 'Variante']).toContain(s);
  });

  it('D7: en las marcas propias, el SKU como mpn o, sin SKU, identifier_exists: no; en las demás, ninguno', () => {
    expect(OWN_BRANDS).toEqual(['JIE', 'eLIGHTS', 'eLIGHTS.cl']);
    expect([isOwnBrand('JIE'), isOwnBrand(' jie '), isOwnBrand('ELIGHTS'), isOwnBrand('eLIGHTS.cl')]).toEqual([true, true, true, true]);
    expect([isOwnBrand('CHUHAN'), isOwnBrand('WAROM'), isOwnBrand('OEM'), isOwnBrand(''), isOwnBrand(undefined)]).toEqual([false, false, false, false, false]);
    for (const it of items) {
      const p = byJid.get(it.jumpsellerId)!;
      const v = it.itemGroupId ? p.variants!.find(x => x.id === it.variantId)! : undefined;
      const sku = (v ? v.sku ?? '' : p.singleVariant?.sku || p.sku || '').trim();
      expect(it.sku ?? '', it.id).toBe(sku);
      if (!isOwnBrand(p.brand)) {
        expect([it.mpn, it.identifierExists], it.id).toEqual([undefined, undefined]);
      } else if (sku && sku.length <= LIMITS.mpn) {
        expect([it.mpn, it.identifierExists], it.id).toEqual([sku, undefined]);
      } else {
        expect([it.mpn, it.identifierExists], it.id).toEqual([undefined, 'no']);
      }
    }
    expect(xml).toContain('<g:mpn>');
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
  }, HEAVY);

  it('D7: inspectFeed rechaza identifier_exists distinto de «no», junto a mpn o sin brand', () => {
    const [it] = items.filter(i => i.mpn);
    const issuesOf = (patch: Partial<FeedItem>) => inspectFeed(renderFeed([{ ...it, ...patch }])).issues;
    expect(issuesOf({})).toEqual([]);
    expect(issuesOf({ mpn: undefined, identifierExists: 'no' })).toEqual([]);
    expect(issuesOf({ identifierExists: 'no' }).join()).toContain('identifier_exists junto a mpn');
    expect(issuesOf({ mpn: undefined, identifierExists: 'yes' as 'no' }).join()).toContain('identifier_exists «yes»');
    expect(issuesOf({ brand: undefined }).join()).toContain('sin brand');
  });

  it('ningún product_detail nombra el D.S. N°1: cada ítem es una variante y la fila es del producto completo', () => {
    for (const text of ['SEC · DS1', 'SEC, DS1', 'SEC - CE - RoHS - DS1', 'SEC. D.S. N°1/2022 solo en la versión ámbar', '2700K (CON DS1)', 'D.S. Nº 1', 'DS-1']) {
      expect(DS1_MENTION.test(text), text).toBe(true);
    }
    for (const text of ['SEC', 'DS43', 'DS 10', 'IP65 IK10', 'D.S. N°43']) expect(DS1_MENTION.test(text), text).toBe(false);
    const bad = items.flatMap(it => it.productDetails.filter(d => DS1_MENTION.test(`${d.name} ${d.value}`)).map(d => `${it.id}: ${d.name} = ${d.value}`));
    expect(bad).toEqual([]);
  }, HEAVY);

  it('en las variantes, las filas «Variante» reemplazan a las del producto con la misma etiqueta y a su temperatura de color', () => {
    const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    let withCct = 0;
    for (const it of items.filter(i => i.itemGroupId)) {
      const variant = it.productDetails.filter(d => d.section === VARIANT_SECTION);
      const rest = it.productDetails.filter(d => d.section !== VARIANT_SECTION);
      expect(it.productDetails.slice(0, variant.length), it.id).toEqual(variant);
      const names = new Set(variant.map(d => key(d.name)));
      expect(rest.filter(d => names.has(key(d.name))), it.id).toEqual([]);
      if (variant.some(d => CCT_LABEL.test(d.name))) {
        withCct++;
        expect(rest.filter(d => CCT_LABEL.test(d.name)), it.id).toEqual([]);
      }
    }
    expect(withCct).toBeGreaterThan(0);
    for (const label of ['Temperatura de color', 'Temperatura color (°K)', 'Color de luz', 'CCT']) expect(CCT_LABEL.test(label), label).toBe(true);
    for (const label of ['Flujo luminoso', 'Potencia', 'Color', 'Índice de reproducción cromática (CRI)']) expect(CCT_LABEL.test(label), label).toBe(false);
  }, HEAVY);

  it('títulos distintos aunque Jumpseller repita un nombre: primero el SKU y, si sigue repetido o no hay, el id', () => {
    const p = products.find(x => !hasVariantChoice(x) && x.jumpseller_variant_id)!;
    const twin = (jid: number, sku: string | undefined, name = p.name) => ({ ...p, jumpseller_id: jid, id: `${p.id}-${jid}`, name, sku, singleVariant: undefined, jumpseller_variant_id: undefined });
    const titles = (list: Product[]) => buildFeedItems({ products: list, exclusions: [] }).map(i => i.title);
    const base = sentenceCase(p.name);
    expect(titles([twin(1, 'AB-1'), twin(2, 'AB-2')])).toEqual([`${base} (AB-1)`, `${base} (AB-2)`]);
    expect(titles([twin(1, undefined), twin(2, undefined)])).toEqual([`${base} (1)`, `${base} (2)`]);
    expect(titles([twin(1, 'AB'), twin(2, 'AB')])).toEqual([`${base} (AB) (1)`, `${base} (AB) (2)`]);
    // Dos nombres que solo difieren en mayúsculas quedan iguales con sentenceCase
    expect(new Set(titles([twin(1, 'X1', p.name.toUpperCase()), twin(2, 'X2', p.name.toLowerCase())])).size).toBe(2);
    // El sufijo siempre cabe en los 150 caracteres
    const [long] = titles([twin(1, 'SKU-LARGO-1', 'Proyector '.repeat(20)), twin(2, 'SKU-LARGO-2', 'Proyector '.repeat(20))]);
    expect(long.length).toBeLessThanOrEqual(LIMITS.title);
    expect(long.endsWith(' (SKU-LARGO-1)')).toBe(true);
  });
});

describe('feed de Merchant: textos', () => {
  it('11. sentenceCase: tipo oración, con siglas, códigos y medidas', () => {
    const cases: [string, string][] = [
      ['AMPOLLETA LED BOLA 9W E27', 'Ampolleta LED bola 9W E27'],
      ['PANEL LED 60X60 40W', 'Panel LED 60x60 40W'],
      ['CAMPANA UFO PRO HL 200W', 'Campana UFO pro HL 200W'],
      ['FOCO PROYECTOR FLYHAWK 100W', 'Foco proyector FlyHawk 100W'],
      ['TUBO LED T8 120CM', 'Tubo LED T8 120cm'],
      ['CINTA LED C/CONTROL (GRIS)', 'Cinta LED c/control (gris)'],
      ['LUMINARIA TRI-PROOF 40W 4000K IP65', 'Luminaria tri-proof 40W 4000K IP65'],
      ['PROYECTOR LED 150LM/W', 'Proyector LED 150lm/W'],
      ['120X30 MARCO', '120x30 marco'],
      ['Panel LED 60x60 Slim', 'Panel LED 60x60 Slim'],
      ['  PANEL   LED  ', 'Panel LED'],
    ];
    for (const [input, output] of cases) expect(sentenceCase(input), input).toBe(output);
  });

  it('11. plainDescription: sin subtítulos, listas ni secciones u oraciones sobre la compra', () => {
    const md = [
      'El panel entrega 4.000 lm con un CRI mayor a 80. Pídelo por WhatsApp.',
      '**Cotización y despacho**',
      'Despacho en hasta 2 días hábiles.',
      'Otra oración que se salta por la sección.',
      '**Instalación**',
      '- Se embute en cielo falso\n- Driver externo',
      'Confirma con nosotros el modelo de dimmer. Trae 5 años de garantía de fábrica. Funciona a 220V.',
    ].join('\n\n');
    expect(plainDescription(md)).toBe('El panel entrega 4.000 lm con un CRI mayor a 80.\nSe embute en cielo falso. Driver externo.\nFunciona a 220V.');
    expect(plainDescription('Precio $12.990 + IVA. Envío gratis.')).toBe('');
  });

  it('11. htmlToBlocks: el HTML limpio de Jumpseller en bloques, listas y subtítulos', () => {
    const html = '<p><strong>Características</strong></p><p>Cuerpo de aluminio inyectado.<br>Vidrio templado.</p><ul><li>IP65</li><li>Driver <strong>incluido</strong></li></ul><p>Precio $12.990 + IVA.</p>';
    expect(htmlToBlocks(html)).toBe('**Características**\n\nCuerpo de aluminio inyectado.\n\nVidrio templado.\n\n- IP65\n- Driver **incluido**\n\nPrecio $12.990 + IVA.');
    expect(plainDescription(htmlToBlocks(html))).toBe('Cuerpo de aluminio inyectado.\nVidrio templado.\nIP65. Driver incluido.');
  });

  it('11. sin contenido SEO ni texto de Jumpseller, la descripción sale de las especificaciones o del título', () => {
    const p = products.find(x => !hasVariantChoice(x))!;
    const [bare] = buildFeedItems({ products: [{ ...p, description: undefined, keyBenefits: undefined }], content: () => undefined, descriptions: {} });
    expect(bare.description.length).toBeGreaterThan(0);
    expect(bare.productHighlights).toEqual([]);
  });
});
