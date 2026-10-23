// Guías (plan del blog, §5.6): formato, reglas del sitio, reglas del D.S. N°1/2022, enlaces y la
// página que genera el servidor. El texto de cada guía es el que aprobó el dueño: estas pruebas
// no lo reescriben, vigilan que nada de lo que el sitio no puede decir se cuele al pasarlo a
// TypeScript, y que el bloque de luminarias con certificado salga de DS1_CERTIFIED_LINES con las
// reglas de src/data/catalog/ds1.ts.
//
// En la PR del robot de Jumpseller (isSyncBot) lo que depende de los datos del día (variantes y
// nombres de los productos, fichas despublicadas) solo avisa: un texto desactualizado nunca
// bloquea los precios.

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverTree } from '@/entry-server';
import { AppRoutes, preloadRoute } from '@/routes';
import { contactEmail } from '@/config/business';
import { categories } from '@/data/catalog/categories.config';
import { products } from '@/data/products';
import { jumpsellerSnapshot } from '@/data/catalog/jumpseller-snapshot.generated';
import {
  DS1_CERTIFIED_IDS,
  DS1_CERTIFIED_LINES,
  ds1CoversKelvin,
  ds1Issues,
  ds1Line,
  normBlueLightIssue,
  sentences,
  sportsBlueLightIssue,
  type Ds1LineKey,
} from '@/data/catalog/ds1';
import { STATIC_ROUTES, noindexGuideRoutes } from '@/lib/seo/routes';
import { DEFAULT_OG, ogImageUrl } from '@/lib/seo/ogImage';
import { SITE_URL } from '@/config/site';
import { retiredIn } from '@/test/retired';
import { isSyncBot } from '@/test/syncBot';
import { findRuleBreaking } from '../../../scripts/jumpseller/descriptions';
import { GUIDE_AUTHORS, GUIDES, GUIDES_INDEX, PLANNED_GUIDE_SLUGS, guideMeta, guidePath, guideTitle, isPublishedGuide } from './index';
import { guideContentSlugs } from './content';
import { ds1ItemSentence, KELVIN_TONE, kelvinText } from './ds1-block';
import { ds1LineGroups } from './ds1-lines';
import { guideLinks, guideTexts, sectionTexts } from './text';
import type { Ds1BlockItem, GuideContent } from './types';

const CONTENTS = import.meta.glob<GuideContent>('./content/*.ts', { eager: true, import: 'default' });
const contents = Object.entries(CONTENTS).map(([file, c]) => ({ file, slug: file.replace(/^\.\/content\/|\.ts$/g, ''), c }));
const contentOf = (slug: string) => contents.find(x => x.slug === slug)!.c;

/** Frases que el dueño aprobó tal cual para el pilar (plan §8): A1 a A8. */
const A = {
  A1: 'Desde el 19 de octubre de 2026, el D.S. N°1/2022 del Ministerio del Medio Ambiente, la norma de contaminación lumínica, se exige en todo Chile a las luminarias exteriores de los proyectos de instalación o recambio que a esa fecha no estaban adjudicados ni iniciados. En las Áreas de Protección Especial se exige desde el 19 de octubre de 2024.',
  A2: 'Las luminarias de proyectos adjudicados, en ejecución o ya instalados antes de esas fechas cuentan como existentes: cumplen la norma cuando se recambian. En parte de las Áreas de Protección Especial hay además un plazo máximo: pregúntanos por tu comuna.',
  A3: 'Las Áreas de Protección Especial no son regiones completas. Son las Áreas Astronómicas (29 comunas de Antofagasta, Atacama y Coquimbo), las áreas protegidas para la biodiversidad y las zonas de reproducción de especies amenazadas que definen los planes RECOGE. Revisa si tu proyecto está en una de ellas en luminica.mma.gob.cl o pregúntanos en ventas@elights.cl.',
  A3b: 'En las áreas protegidas ligadas a especies amenazadas por la luz artificial, el Área de Protección Especial se extiende hasta 5 km desde su límite, y los planes RECOGE suman las comunas de mayor impacto para la especie.',
  A4: 'El cumplimiento del proyecto depende también del diseño y de la instalación.',
  A5: 'Con el certificado de cada luminaria, que emite un organismo autorizado por la SEC. La luminaria se instala respetando el ángulo de montaje que indica ese certificado.',
  A6: 'La norma fija una temperatura de color máxima según la clase del recinto y exige apagar el alumbrado entre las 00:00 y las 07:00, salvo eventos autorizados. Cuentan como alumbrado exterior aunque estén techados, si no tienen muros.',
  A7: 'Temperatura de color de hasta 2.700 K, o de 2.200 K en las Áreas de Protección Especial, sin luz hacia el cielo y apagado entre las 00:00 y las 07:00, salvo eventos autorizados.',
  A8: 'El contenido de luz azul no puede superar el 1 % en las Áreas de Protección Especial ni el 7 % en el resto del país, y la luminaria no puede emitir luz sobre la horizontal.',
};

/** La frase obligatoria de toda guía que nombra la norma (plan §5.6). */
const MANDATORY = A.A4;

/**
 * Las únicas oraciones de cada guía que juntan el certificado con la norma: las aprueba el dueño
 * (decisión 6 del plan). Una oración nueva con el certificado se agrega aquí solo con su OK.
 */
const APPROVED_CERTIFICATE_SENTENCES: Readonly<Record<string, readonly string[]>> = {
  'norma-luminica-ds-1-2022': ['Estas luminarias tienen certificado D.S. N°1/2022 solo en las versiones que se nombran.'],
};

/** Las frases de la norma que pueden dar el % de luz azul (A8; plan §5.6). */
const APPROVED_NORM_BLUE_LIGHT: ReadonlySet<string> = new Set([A.A8]);

/**
 * El bloque «Luminarias con certificado» de cada guía, tal como lo aprueba el dueño: lo genera
 * ds1LineGroups (DS1_CERTIFIED_LINES y las variantes de Jumpseller) y lo escribe Claude.
 */
const APPROVED_DS1_BLOCK: Readonly<Record<string, readonly string[]>> = {
  'norma-luminica-ds-1-2022': [
    'Luminarias con certificado en eLIGHTS',
    'Estas luminarias tienen certificado D.S. N°1/2022 solo en las versiones que se nombran. Las demás versiones no lo tienen.',
    'Alumbrado público BESTLED: ámbar de 2200K y cálida de 2700K.',
    'Alumbrado público LED solar Flyhawk: ámbar de 2200K y cálida de 2700K.',
    'Alumbrado público LED solar All in One industrial: ámbar de 2200K y cálida de 2700K.',
    'Pagoda LED solar UFO: ámbar de 1600K y cálida de 2700K.',
    'Luminaria ornamental Island: ámbar de 2200K y cálida de 2700K.',
    'Proyector LED Slim SMD de 150, 300, 400 y 500W: ámbar de 2200K y cálida de 2700K.',
    'Proyector LED Slim SMD de 200W: cálida de 2700K.',
    'En los proyectores de estadio, el certificado es para alumbrado deportivo:',
    'Proyector LED de estadio modular de 100, 150, 200, 300, 400, 500, 600 y 1000W: cálida de 2700K, neutra de 4000K y fría de 5000K.',
    'Proyector LED de estadio 300W: cálida de 3000K.',
    'Proyector LED de estadio 500W: ámbar de 2200K.',
    'Proyector LED de estadio redondo 1000W: ámbar de 2200K, cálida de 2700K, neutra de 4000K y fría de 5000K.',
    MANDATORY,
  ],
};

/** El orden de las líneas en el bloque: alumbrado público, ornamental, proyectores y estadios. */
const DS1_BLOCK_ORDER: readonly Ds1LineKey[] = ['bestled', 'flyhawk', 'solarIndustrial', 'pagoda', 'island', 'slim', 'estadioModular', 'estadio'];

/** Los productos de una línea que el bloque no nombra (ds1LineGroups), con su motivo. */
const DS1_BLOCK_EXCLUDED: Readonly<Record<number, string>> = {
  4450187: 'ninguna versión con certificado', // estadio 600W: solo 6000K
  32913027: 'una versión cálida sin su temperatura de color en Jumpseller', // estadio modular 800W: ficha por corregir (plan §3.3)
};

/** Fuentes externas: https y oficiales (plan §1.5). */
const OFFICIAL = /^https:\/\/(?:[a-z0-9-]+\.)*(?:bcn\.cl|leychile\.cl|gob\.cl)\//;

const NORM = /D\.S\. N°1\/2022|norma lum[ií]nica|contaminaci[oó]n lum[ií]nica|[ÁA]reas? de Protecci[oó]n Especial/i;

const blocksOf = (c: GuideContent) => c.sections.flatMap(s => [...s.blocks, ...(s.subsections ?? []).flatMap(sub => sub.blocks)]);
const ds1Items = (c: GuideContent): Ds1BlockItem[] => blocksOf(c).flatMap(b => (b.type === 'ds1-lines' ? [...b.items] : []));
const variantOptions = new Map(
  jumpsellerSnapshot.map(p => [p.jumpseller_id, [...new Set((p.variants ?? []).flatMap(v => v.options.map(o => `${o.name}: ${o.value}`)))]] as const),
);
const productName = (id: number) => products.find(p => p.jumpseller_id === id)?.name;

describe('guías: formato', () => {
  it('cada ficha de index.ts tiene su cuerpo en content/, y al revés (solo guías aprobadas en el repo)', () => {
    expect(GUIDES.length).toBeGreaterThan(0);
    expect(guideContentSlugs().sort()).toEqual(GUIDES.map(g => g.slug).sort());
    for (const { slug, c } of contents) expect(c.slug, slug).toBe(slug);
  });

  it('slugs únicos, en minúsculas y con guiones, de la lista del plan (§1.2)', () => {
    const slugs = GUIDES.map(g => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(PLANNED_GUIDE_SLUGS as readonly string[]).toContain(slug);
    }
  });

  it('título completo de 30 a 65 caracteres (metaTitle de 20 a 55, sin la marca) y metaDescription de 110 a 160', () => {
    for (const g of [...GUIDES, GUIDES_INDEX]) {
      expect(g.metaTitle.length, g.metaTitle).toBeGreaterThanOrEqual(20);
      expect(g.metaTitle.length, g.metaTitle).toBeLessThanOrEqual(55);
      expect(g.metaTitle, g.metaTitle).not.toMatch(/eLIGHTS/);
      expect(guideTitle(g).length).toBeGreaterThanOrEqual(30);
      expect(guideTitle(g).length).toBeLessThanOrEqual(65);
      expect(g.metaDescription.length, g.metaDescription).toBeGreaterThanOrEqual(110);
      expect(g.metaDescription.length, g.metaDescription).toBeLessThanOrEqual(160);
    }
  });

  it('un H1 por guía: distinto de los demás y de cada categoría, sin el año ni «nueva norma»', () => {
    const h1s = GUIDES.map(g => g.h1);
    expect(new Set(h1s).size).toBe(h1s.length);
    const names = new Set(categories.map(c => c.name.toLowerCase()));
    for (const h1 of h1s) {
      expect(names.has(h1.toLowerCase()), h1).toBe(false);
      expect(h1.replace(/N°1\/2022/g, ''), h1).not.toMatch(/\b(?:19|20)\d{2}\b/);
      expect(h1).not.toMatch(/nueva norma/i);
    }
    expect(GUIDES_INDEX.h1).not.toMatch(/norma/i); // el índice no compite con el pilar
  });

  it('fechas ISO fijas con la zona horaria de Chile, la visible igual a la ISO, y la actualización solo si cambió', () => {
    const label = (iso: string) => iso.slice(0, 10).split('-').reverse().join('-');
    for (const g of GUIDES) {
      for (const iso of [g.datePublished, g.dateModified]) expect(iso, g.slug).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[34]:00$/);
      expect(Date.parse(g.dateModified)).toBeGreaterThanOrEqual(Date.parse(g.datePublished));
      expect(g.publishedLabel).toBe(label(g.datePublished));
      if (g.dateModified !== g.datePublished) expect(g.modifiedLabel, g.slug).toBe(label(g.dateModified));
      else expect(g.modifiedLabel, g.slug).toBeUndefined();
      expect(GUIDE_AUTHORS[g.author], g.slug).toBeDefined();
    }
  });

  it('ids de sección fijos y únicos, sin chocar con los del marco de la página; fuentes https con su fecha', () => {
    for (const { slug, c } of contents) {
      const ids = c.sections.map(s => s.id);
      expect(new Set(ids).size, slug).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(['fuentes', 'guias-relacionadas', 'en-esta-guia']).not.toContain(id);
      }
      expect(c.sources.length, slug).toBeGreaterThan(0);
      for (const s of c.sources) {
        expect(s.url, s.label).toMatch(OFFICIAL);
        expect(s.reviewed, s.label).toMatch(/^\d{2}-\d{2}-\d{4}$/);
      }
      expect(c.sourcesReviewed).toMatch(/^\d{2}-\d{2}-\d{4}$/);
      for (const h of c.history) expect(h.date).toMatch(/^\d{2}-\d{2}-\d{4}$/);
      expect(c.answer.length, slug).toBeGreaterThan(0);
    }
  });
});

describe('guías: reglas del sitio en el contenido', () => {
  // El texto más largo: con los trozos de las guías que aún no se publican
  const all = contents.flatMap(({ slug, c }) => guideTexts(c).map(text => ({ slug, text })));

  it('sin stock, plazos de despacho distintos de «hasta 2 días hábiles», precios con «$» ni frases retiradas', () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all.flatMap(({ slug, text }) => [findRuleBreaking(text) ?? [], ...retiredIn(text)].flat().map(p => `${slug}: ${p}`))).toEqual([]);
  });

  it('sin «nueva norma», «48 horas», «inmediato», la sigla DS1 ni «mismo día» junto al despacho', () => {
    for (const { slug, text } of all) {
      expect(text, slug).not.toMatch(/nueva norma|48 ?h(?:oras|rs?)?\b|inmediat[oa]|\bDS\s?-?0?1\b|\bDS ?43\b/i);
      expect(text, slug).not.toMatch(/despach[^.]*mismo d[ií]a|mismo d[ií]a[^.]*despach/i);
    }
  });

  it('el único contacto es ventas@elights.cl: sin otros correos, teléfonos ni WhatsApp en el contenido', () => {
    for (const { slug, text } of all) {
      for (const email of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) expect(email, slug).toBe(contactEmail);
      expect(text, slug).not.toMatch(/whats ?app|wa\.me|ll[aá]manos|tel[eé]fono|\+56|\b9\s?\d{4}\s?\d{4}\b/i);
    }
    for (const { c } of contents) {
      for (const l of guideLinks(c)) if ('mail' in l.to) expect(l.text).toBe(contactEmail);
    }
  });
});

describe('guías: D.S. N°1/2022', () => {
  it('el pilar (G1) trae las frases aprobadas A1 a A8 tal cual (A1 dos veces: en la respuesta corta y en #plazos)', () => {
    const text = guideTexts(contentOf('norma-luminica-ds-1-2022')).join('\n');
    for (const [key, phrase] of Object.entries(A)) expect(text.includes(phrase), key).toBe(true);
    expect(text.split(A.A1).length - 1).toBe(2);
    const plazos = sectionTexts(contentOf('norma-luminica-ds-1-2022').sections.find(s => s.id === 'plazos')!).join('\n');
    expect(plazos).toContain(A.A1);
    expect(plazos).toContain('Plazos revisados el 23-10-2026.');
  });

  it('el certificado se afirma junto a la norma solo en las oraciones aprobadas por el dueño; nunca el D.S. N°43 como vigente', () => {
    for (const { slug, c } of contents) {
      const approved = new Set(APPROVED_CERTIFICATE_SENTENCES[slug] ?? []);
      const list = guideTexts(c).flatMap(sentences);
      const issues = list.flatMap(s => ds1Issues(s, { certified: approved.has(s) }));
      expect(issues, slug).toEqual([]);
      // Cada aprobada sigue en la guía (una aprobación vieja no se queda sin revisar)
      for (const s of approved) expect(list, slug).toContain(s);
    }
  });

  it('el % de luz azul solo dentro de la frase aprobada (A8), y nunca en la sección (H2 con sus H3) de canchas o recintos deportivos', () => {
    for (const { slug, c } of contents) {
      // Cada párrafo, ítem de lista o fila de tabla por separado
      for (const b of guideTexts(c)) if (normBlueLightIssue(b)) expect(APPROVED_NORM_BLUE_LIGHT.has(b), `${slug}: ${b}`).toBe(true);
      for (const s of c.sections) expect(sportsBlueLightIssue(sectionTexts(s).join('\n')), `${slug}#${s.id}`).toBeNull();
    }
  });

  it('si la guía nombra la norma, trae la frase obligatoria (A4)', () => {
    for (const { slug, c } of contents) {
      const text = guideTexts(c).join('\n');
      if (NORM.test(text)) expect(text, slug).toContain(MANDATORY);
    }
  });

  it('en las secciones de alumbrado exterior solo se enlazan fichas de líneas con certificado (plan §1.5)', () => {
    for (const { slug, c } of contents) {
      for (const l of guideLinks(c)) {
        if (!('products' in l.to)) continue;
        if (l.outdoor) for (const id of l.to.products) expect(DS1_CERTIFIED_IDS, `${slug}#${l.section}: ${l.text}`).toContain(id);
      }
    }
  });
});

describe('guías: el bloque de luminarias con certificado (DS1_CERTIFIED_LINES)', () => {
  const withBlock = contents.filter(({ c }) => ds1Items(c).length > 0);

  it('se lee tal como lo aprobó el dueño', () => {
    expect(withBlock.map(x => x.slug)).toEqual(Object.keys(APPROVED_DS1_BLOCK));
    for (const { slug, c } of withBlock) {
      const section = c.sections.find(s => s.blocks.some(b => b.type === 'ds1-lines'))!;
      expect(section.outdoor, slug).toBe(true);
      expect(sectionTexts(section), slug).toEqual(APPROVED_DS1_BLOCK[slug]);
    }
  });

  it('cada ítem: productos de su línea, solo versiones que cubre su certificado (los estadios, hasta 5000K), con su tono', () => {
    for (const { slug, c } of withBlock) {
      for (const item of ds1Items(c)) {
        const line = DS1_CERTIFIED_LINES[item.line];
        expect(item.products.length, item.name).toBeGreaterThan(0);
        for (const id of item.products) expect(ds1Line(id)?.key, `${item.name}: ${id}`).toBe(item.line);
        expect([...item.kelvin], item.name).toEqual([...item.kelvin].sort((a, b) => a - b));
        for (const k of item.kelvin) {
          expect(ds1CoversKelvin(line.versions, k), `${item.name}: ${k}K`).toBe(true);
          expect(KELVIN_TONE[k], `${k}K sin tono`).toBeTruthy();
        }
        // Con las reglas de ds1.ts, como una oración que afirma el certificado de esas versiones
        const claim = `${item.name} tiene certificado D.S. N°1/2022 en sus versiones ${kelvinText(item.kelvin)}.`;
        expect(ds1Issues(claim, { certified: line.versions }), `${slug}: ${claim}`).toEqual([]);
        expect(ds1ItemSentence(item)).toBe(`${item.name}: ${kelvinText(item.kelvin)}.`);
      }
      // Las 8 líneas, sin nombrar un producto dos veces
      expect([...new Set(ds1Items(c).map(i => i.line))].sort()).toEqual([...DS1_BLOCK_ORDER].sort());
      const ids = ds1Items(c).flatMap(i => i.products);
      expect(new Set(ids).size).toBe(ids.length);
      // 2200K se llama ámbar y 2700K, cálida (dueño, 23-10-2026)
      expect(KELVIN_TONE[2200]).toBe('ámbar');
      expect(KELVIN_TONE[2700]).toBe('cálida');
    }
  });

  it.skipIf(isSyncBot)('es el que genera ds1LineGroups desde DS1_CERTIFIED_LINES y las variantes de Jumpseller (fuera, el estadio de 600W y el modular de 800W)', () => {
    const published = new Map([...variantOptions].filter(([id]) => products.some(p => p.jumpseller_id === id)));
    const { groups, excluded } = ds1LineGroups(DS1_BLOCK_ORDER, published);
    expect(Object.fromEntries(excluded.map(e => [e.id, e.reason]))).toEqual(DS1_BLOCK_EXCLUDED);
    const norm = (list: { line: string; products: readonly number[]; kelvin: readonly number[] }[]) =>
      list.map(g => `${g.line}|${[...g.products].sort((a, b) => a - b).join(',')}|${g.kelvin.join(',')}`);
    for (const { slug, c } of withBlock) expect(norm(ds1Items(c)), slug).toEqual(norm(groups));
  });

  it.skipIf(isSyncBot)('las potencias del nombre de cada ítem son las de sus productos en Jumpseller', () => {
    for (const { c } of withBlock) {
      for (const item of ds1Items(c)) {
        const named = [...item.name.matchAll(/(\d+)(?=(?:, \d+)*(?: y \d+)?W\b)|(\d+)W\b/g)].map(m => Number(m[1] ?? m[2]));
        if (!named.length) continue;
        const own = item.products.map(id => Number(productName(id)?.match(/(\d+)W\b/)?.[1]));
        expect([...named].sort((a, b) => a - b), item.name).toEqual([...own].sort((a, b) => a - b));
      }
    }
  });

  it('el generador: agrupa por versiones certificadas y deja fuera lo que no puede nombrar', () => {
    const options = new Map<number, string[]>([
      [2340515, ['Color: Luz Cálida - 2200K', 'Color: Luz Cálida - 2700K', 'Color: Luz Cálida - 3000K', 'Color: Luz Fría - 5000K']],
      [2340521, ['Color: Luz Cálida - 2700K', 'Color: Luz Fría - 6500K']],
      [2340383, ['Color: Luz Cálida - 2200K', 'Color: Luz Cálida - 2700K']],
      [4450187, ['Color: Luz Fría- 6000K']],
      [3313196, ['Color: Luz Cálida - 3000K', 'Color: Luz Fría- 6000K']],
      [32913027, ['Color: Luz Cálida - 1% Luz Azul', 'Color: Luz fría - 5000K']],
    ]);
    const { groups, excluded } = ds1LineGroups(['slim', 'estadio', 'estadioModular'], options);
    expect(groups.map(g => [g.line, g.products, g.kelvin])).toEqual([
      ['slim', [2340515, 2340383], [2200, 2700]], // sin la de 3000K ni la fría
      ['slim', [2340521], [2700]],
      ['estadio', [3313196], [3000]], // sin la de 6000K
    ]);
    expect(excluded.filter(e => [4450187, 32913027].includes(e.id))).toEqual([
      { id: 4450187, reason: 'ninguna versión con certificado' },
      { id: 32913027, reason: 'una versión cálida sin su temperatura de color en Jumpseller' },
    ]);
    expect(excluded.some(e => e.id === 2340385 && e.reason === 'no está publicado')).toBe(true);
  });
});

describe('guías: enlaces', () => {
  const links = contents.flatMap(({ slug, c }) => guideLinks(c).map(l => ({ slug, ...l })));

  it('cada destino existe: categoría, página fija, guía del plan, ancla de la misma guía, fuente oficial https', () => {
    const slugs = new Set(categories.map(c => c.slug));
    for (const l of links) {
      const where = `${l.slug}#${l.section}: ${l.text}`;
      if ('category' in l.to) expect(slugs.has(l.to.category), where).toBe(true);
      if ('route' in l.to) expect(STATIC_ROUTES as readonly string[], where).toContain(l.to.route);
      if ('guide' in l.to) expect(PLANNED_GUIDE_SLUGS as readonly string[], where).toContain(l.to.guide);
      if ('anchor' in l.to) expect(contentOf(l.slug).sections.map(s => s.id), where).toContain(l.to.anchor);
      if ('external' in l.to) expect(l.to.external, where).toMatch(OFFICIAL);
    }
  });

  it('una guía sin publicar solo se enlaza en un trozo que se esconde con ella, o en las relacionadas (la prueba solo avisa)', () => {
    for (const l of links) {
      if (!('guide' in l.to)) continue;
      const where = `${l.slug}#${l.section}: ${l.text}`;
      if (l.section !== 'guias-relacionadas') expect(l.ifGuide, `${where}: el enlace va dentro de { ifGuide }`).toBe(l.to.guide);
      if (!isPublishedGuide(l.to.guide)) console.warn(`[guías] ${where} → ${guidePath(l.to.guide)}: esa guía no está publicada; el enlace no se muestra`);
    }
  });

  it.skipIf(isSyncBot)('cada lista de fichas tiene al menos una publicada', () => {
    for (const l of links) {
      if (!('products' in l.to)) continue;
      const published = l.to.products.filter(id => products.some(p => p.jumpseller_id === id));
      expect(published.length, `${l.slug}#${l.section}: ${l.text}`).toBeGreaterThan(0);
    }
  });

  it('el llamado en el texto y el recuadro final llevan a los formularios que ya existen', () => {
    for (const { slug, c } of contents) {
      expect(['/cotizador', '/estudio-luminico'], slug).toContain(c.finalBox.button.route);
      expect(links.some(l => l.slug === slug && 'route' in l.to && ['/cotizador', '/estudio-luminico'].includes(l.to.route)), slug).toBe(true);
    }
  });
});

describe('guías: la página', () => {
  afterEach(() => vi.restoreAllMocks());

  async function serverHtml(path: string) {
    // En jsdom, Radix usa useLayoutEffect también en el render del servidor y React avisa (en
    // Node, donde corre el prerender, no lo usa): ver src/ssr-hydration.test.tsx
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await preloadRoute(path);
    const html = renderToString(serverTree(path));
    const root = document.createElement('div');
    root.innerHTML = html;
    return { html, root };
  }

  for (const g of GUIDES) {
    const path = guidePath(g.slug);

    it(`${path}: el servidor la dibuja completa, con un h1, la firma, la fecha y sin enlaces a guías sin publicar`, async () => {
      const { html, root } = await serverHtml(path);
      expect(html).not.toContain('<!--$!-->'); // nada quedó para el navegador
      expect([...root.querySelectorAll('h1')].map(h => h.textContent)).toEqual([g.h1]);
      const byline = root.querySelector('main h1 + p')?.textContent;
      expect(byline).toBe(`Por ${GUIDE_AUTHORS[g.author].name} · Publicada el ${g.publishedLabel}`);
      expect(root.querySelector('main time')?.getAttribute('datetime')).toBe(g.datePublished.slice(0, 10));
      const c = contentOf(g.slug);
      for (const s of c.sections) expect(root.querySelector(`main h2#${s.id}`)?.textContent, s.id).toBe(s.title);
      const guideHrefs = [...root.querySelectorAll('main a[href^="/guias/"]')].map(a => a.getAttribute('href')!);
      for (const href of guideHrefs) expect(isPublishedGuide(href.replace('/guias/', '')), href).toBe(true);
      // Sin guías relacionadas publicadas, la sección no aparece
      expect(!!root.querySelector('#guias-relacionadas')).toBe(c.related.some(r => isPublishedGuide(r.guide)));
      // Contacto: solo ventas@
      for (const a of root.querySelectorAll('main a[href^="mailto:"]')) expect(a.getAttribute('href')!.split('?')[0]).toBe(`mailto:${contactEmail}`);
      expect(root.querySelector('main a[href^="tel:"], main a[href*="wa.me"]')).toBeNull();
      // Fuentes oficiales en otra pestaña, sin nofollow
      for (const a of root.querySelectorAll('main a[target="_blank"]')) {
        expect(a.getAttribute('href')).toMatch(OFFICIAL);
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      }
      expect(root.textContent).toContain(`Fuentes revisadas el ${c.sourcesReviewed}.`);
      expect(root.textContent).toContain(
        `Redactamos esta guía con apoyo de herramientas de inteligencia artificial. Verificamos cada dato en las fuentes citadas y ${GUIDE_AUTHORS[g.author].name} la revisó y aprobó antes de publicarla.`,
      );
    });
  }

  it('G1: el bloque de luminarias con certificado, con sus fichas publicadas y la frase obligatoria al cerrar', async () => {
    const { root } = await serverHtml('/guias/norma-luminica-ds-1-2022');
    const h2 = root.querySelector('h2#luminarias-con-certificado')!;
    const section = h2.closest('section')!;
    const items = [...section.querySelectorAll('[data-ds1-lines] li')].map(li => li.textContent);
    expect(items).toEqual(APPROVED_DS1_BLOCK['norma-luminica-ds-1-2022'].filter(s => /: (?:ámbar|cálida|neutra|fría) de \d+K/.test(s)));
    expect(section.lastElementChild?.textContent).toBe(MANDATORY);
    for (const a of section.querySelectorAll('a')) {
      const id = products.find(p => `/producto/${p.id}` === a.getAttribute('href'))?.jumpseller_id;
      expect(DS1_CERTIFIED_IDS, a.textContent ?? '').toContain(id);
    }
    // Ni el estadio de 600W (solo 6000K) ni el modular de 800W (ficha por corregir)
    expect(section.innerHTML).not.toMatch(/estadio-600w|modular-800w|6000K|6500K/);
    // Las oraciones que llevan a guías sin publicar (G3, G4, G5 y G7) no se ven todavía
    expect(root.textContent).not.toMatch(/lee la guía|Para revisarlo paso a paso/);
    // Los llamados: el correo de las Áreas de Protección Especial y la propuesta técnica (§3.3)
    const mail = [...root.querySelectorAll('main a[href^="mailto:"]')].map(a => decodeURIComponent(a.getAttribute('href')!.split('subject=')[1] ?? ''));
    expect(mail).toContain('Consulta D.S. N°1/2022: ¿mi comuna es Área de Protección Especial?');
    const cotizador = [...root.querySelectorAll('main a[href="/cotizador"]')].map(a => a.textContent);
    expect(cotizador).toEqual(['solicita una propuesta técnica', 'Solicitar propuesta técnica']);
  });

  it('las guías sin indexar llevan noindex (sin canonical); el JSON-LD es Article (headline = H1) y BreadcrumbList, sin FAQPage', async () => {
    expect(noindexGuideRoutes()).toContain('/guias/norma-luminica-ds-1-2022');
    for (const g of GUIDES) {
      const path = guidePath(g.slug);
      await preloadRoute(path);
      document.head.innerHTML = '';
      const view = render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(AppRoutes))));
      await waitFor(() => expect(document.title).toBe(guideTitle(g)));
      const head = (sel: string) => document.head.querySelector(sel);
      expect(head('meta[name="robots"]')?.getAttribute('content') ?? null).toBe(g.index ? null : 'noindex, follow');
      expect(head('link[rel="canonical"]')?.getAttribute('href') ?? null).toBe(g.index ? `${SITE_URL}${path}` : null);
      expect(head('meta[property="og:type"]')?.getAttribute('content')).toBe('article');
      expect(head('meta[property="og:image"]')?.getAttribute('content')).toBe(ogImageUrl(DEFAULT_OG));
      const ld = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent ?? ''));
      expect(ld.map(d => d['@type'])).toEqual(['BreadcrumbList', 'Article']);
      const [crumbs, article] = ld;
      expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Inicio', 'Guías', g.h1]); // G1 es el pilar: sin ese nivel
      expect(article).toMatchObject({
        headline: g.h1,
        description: g.metaDescription,
        datePublished: g.datePublished,
        dateModified: g.dateModified,
        inLanguage: 'es-CL',
        author: { '@type': 'Person', name: GUIDE_AUTHORS[g.author].name, url: `${SITE_URL}/empresa` },
        publisher: { '@type': 'Organization', name: 'eLIGHTS.cl' },
        mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}${path}` },
        image: [ogImageUrl(DEFAULT_OG)],
      });
      view.unmount();
    }
  });

  it('/guias: el índice muestra los pilares con sus guías publicadas', async () => {
    const { root } = await serverHtml('/guias');
    expect([...root.querySelectorAll('h1')].map(h => h.textContent)).toEqual([GUIDES_INDEX.h1]);
    const hrefs = [...root.querySelectorAll('main h3 a')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(GUIDES.map(g => guidePath(g.slug)));
    expect(guideMeta('no-existe')).toBeUndefined();
  });

  it('una guía que no existe muestra la página "no encontrada"', async () => {
    const { root } = await serverHtml('/guias/no-existe');
    expect(root.querySelector('main h1')?.textContent).toBe('404');
  });
});
