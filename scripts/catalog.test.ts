// scripts/catalog.test.ts
// El catálogo del sitio sale del snapshot de Jumpseller (PR 7). Estas pruebas corren
// también en cada PR de sincronización, así que fijan reglas, no datos que Jumpseller
// puede cambiar: ids/URLs estables, datos derivados del snapshot, valores legados solo
// donde Jumpseller no tiene y TODO el contenido editorial intacto.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { products } from '../src/data/catalog/index';
import { jumpsellerSnapshot } from '../src/data/catalog/jumpseller-snapshot.generated';
import { CATEGORY_PRODUCT_COUNTS, PUBLISHED_PRODUCT_COUNT } from '../src/data/catalog/categories.generated';
import { categories } from '../src/data/catalog/categories.config';
import { editorialOverlay } from '../src/data/catalog/overlay/editorial';
import { baseOverrides } from '../src/data/catalog/overlay/overrides';
import { LEGACY_SITE_IDS } from '../src/data/catalog/legacy-ids';
import { SITE_IDS } from '../src/data/catalog/site-ids.generated';
import { RENAMED_FROM, RENAMED_SITE_IDS, RETIRED_SITE_IDS } from '../src/data/catalog/renamed-ids';
import { EDITORIAL_KEYS, parseIp, parseKelvin, parseKelvins, parseWatts, productKelvins, skuOwners } from '../src/data/catalog/build';
import { cleanSku } from './jumpseller/normalize';
import { buildVariantSku } from '../src/lib/variantSku';
import type { Product } from '../src/data/catalog/types';

type Legacy = Product & { stock?: boolean };
const legacy = JSON.parse(readFileSync(join(__dirname, 'fixtures/catalog-legacy-2026-09-30.json'), 'utf8')) as Legacy[];
const legacyById = new Map(legacy.map(p => [p.jumpseller_id, p]));
const snapById = new Map(jumpsellerSnapshot.map(p => [p.jumpseller_id, p]));
const siteSlugs = categories.map(c => c.slug);
const BESTLED = [2301098, 2301101, 2301105, 2301110, 2301114, 4156930, 15021313];
/** Potencias de la familia BESTLED: su SKU base es APB{W} (APB40 … APB250). */
const BESTLED_WATTS = [40, 60, 90, 120, 150, 200, 250];
const SITE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Recomendación para alumbrado exterior nuevo desde el 19-10-2026 (D.S. N°1/2022 en todo Chile). */
const REC = 'Variantes recomendadas: 2700K Cálida, o 2200K Ámbar si la comuna está declarada como Área de Protección Especial.';
const DS1_2026 = 'que desde el 19 de octubre de 2026 debe cumplir el D.S. N°1/2022 en todo Chile';
/**
 * Cambios intencionales al texto editorial de los BESTLED después del 2026-09-30 (el fixture
 * es el catálogo legado de ese día y no se edita). Se aplican en orden, como reemplazos de texto.
 * - PR 11 (2026-10): el estudio DIALux sin promesa de precio, la FAQ de garantía según la
 *   Ley 19.496 (arts. 20-21) y la cotización sin promesa de rapidez.
 * - D.S. N°1/2022 (2026-10-13): desde el 19-10-2026 se exige en todo Chile para el alumbrado
 *   exterior nuevo. La certificación DS1 es solo de 2200K (Áreas de Protección Especial) y
 *   2700K (territorio nacional general); 4000K y 5000K solo tienen SEC y se recomiendan solo
 *   bajo techo. Las Áreas de Protección Especial son comunas declaradas, no regiones; certifica
 *   un organismo autorizado por la SEC (Protocolo PCL N°1:2024 de la SMA), no el MMA; el % de
 *   luz azul es el límite de la clasificación de cada variante, no una equivalencia de la CCT.
 * - PR 14a (2026-10-16): el texto nombra los SKU de variante como Jumpseller, que es la fuente
 *   de verdad: 2200K = APB{W}1 y 2700K = APB{W}7 (antes APB{W}A y APB{W}C). 4000K (N) y
 *   5000K (F) no cambian. En el fixture cada uno de esos 63 SKU va entre paréntesis, espacios
 *   o puntuación, así que el reemplazo de texto no toca nada más.
 */
const EDITORIAL_EDITS: [string, string][] = [
  ['asesoría técnica gratuita para selección de variante CCT', 'asesoría técnica para la selección de variante CCT'],
  ['estudio fotométrico DIALux gratuito que valida', 'estudio fotométrico DIALux que valida'],
  ['asesoría técnica gratuita y estudio fotométrico DIALux', 'asesoría técnica y estudio fotométrico DIALux'],
  ['Cotización rápida para empresas', 'Cotización formal para empresas'],
  [
    'Reposición o reparación a criterio del fabricante.',
    'Pasados los 6 meses de garantía legal, la reposición o reparación queda a criterio del fabricante; durante esos 6 meses el cliente elige entre reparación, cambio o devolución.',
  ],
  [
    'cuenta con certificación DS1/2022 del Ministerio del Medio Ambiente que regula la contaminación lumínica en Chile.',
    'cuenta con certificación según el D.S. N°1/2022 del Ministerio del Medio Ambiente, la norma que regula la contaminación lumínica en Chile.',
  ],
  [
    'La norma define dos categorías de cumplimiento según luz azul:',
    'Se exige desde octubre de 2024 en las Áreas de Protección Especial y, desde el 19 de octubre de 2026, en todo Chile para las luminarias exteriores nuevas, incluidos los recambios. Para el alumbrado peatonal y vehicular, la norma fija dos límites de contenido de luz azul:',
  ],
  [
    ':** apto para todo el territorio nacional, incluyendo zonas de protección especial astronómica y de biodiversidad',
    ':** apto para las comunas declaradas como Áreas de Protección Especial (29 comunas de las regiones de Antofagasta, Atacama y Coquimbo), para las áreas de protección de biodiversidad y para el resto del país',
  ],
  [
    ':** apto para todo el territorio excepto zonas de protección especial',
    ':** apto para las comunas que no están declaradas como Áreas de Protección Especial',
  ],
  [
    ' opera con 1% de luz azul y cumple los requisitos de **clasificación para Áreas de Protección Especial',
    ' está certificada con **clasificación para Áreas de Protección Especial',
  ],
  [
    ', siendo apta para proyectos en regiones astronómicas como Antofagasta, Atacama y Coquimbo, así como áreas de protección de biodiversidad.',
    ', apta para proyectos en comunas declaradas como Áreas de Protección Especial y en áreas de protección de biodiversidad. Antes de elegir la variante, revise si la comuna del proyecto está declarada.',
  ],
  [
    ' opera con 7% de luz azul y cumple los requisitos de **clasificación para territorio nacional general',
    ' está certificada con **clasificación para territorio nacional general',
  ],
  [
    ', apta para proyectos de alumbrado público en el resto del territorio chileno.',
    ', apta para proyectos de alumbrado público en las comunas que no están declaradas como Áreas de Protección Especial.',
  ],
  [
    ' son aptas para proyectos de alumbrado público bajo regulación SEC tradicional, en zonas no sujetas a la regulación de contaminación lumínica DS1 MMA.',
    ' cuentan con certificación SEC; la certificación DS1 corresponde a las variantes 2200K y 2700K. Para alumbrado exterior nuevo recomendamos 2700K Cálida, o 2200K Ámbar si la comuna está declarada como Área de Protección Especial.',
  ],
  [
    'certificado SEC vigente y certificación DS1 MMA se entregan',
    'certificado SEC vigente y el certificado DS1 de las variantes 2200K y 2700K se entregan',
  ],
  [
    'Disponible en cuatro variantes de temperatura de color con porcentaje de luz azul declarado: Ámbar 2200K (1% luz azul, Áreas de Protección Especial DS1 MMA, SKU',
    'Disponible en cuatro variantes de temperatura de color, todas con certificación SEC: Ámbar 2200K (certificación DS1 para Áreas de Protección Especial, luz azul ≤1%, SKU',
  ],
  [
    'Cálida 2700K (7% luz azul, territorio nacional general DS1 MMA, SKU',
    'Cálida 2700K (certificación DS1 para territorio nacional general, luz azul ≤7%, SKU',
  ],
  ['Neutra 4000K (30% luz azul, alumbrado público SEC, SKU', 'Neutra 4000K (SKU'],
  ['Fría 5000K (45% luz azul, alumbrado público SEC, SKU', 'Fría 5000K (SKU'],
  [
    ' certificada con clasificación para Áreas de Protección Especial del Ministerio del Medio Ambiente. Cumple restricción de luz azul ≤1%, apta para todo el territorio nacional incluyendo zonas de protección especial astronómica y de biodiversidad. Vigente desde octubre 2024.',
    ' certificada según el D.S. N°1/2022 del Ministerio del Medio Ambiente con clasificación para Áreas de Protección Especial. Cumple el límite de luz azul ≤1%: apta para las comunas declaradas como Áreas de Protección Especial, las áreas de protección de biodiversidad y el resto del país. Exigible en esas áreas desde octubre de 2024.',
  ],
  [
    ' certificada con clasificación para territorio nacional general del Ministerio del Medio Ambiente. Cumple restricción de luz azul entre 1% y 7%, apta para alumbrado exterior en todo el territorio nacional excepto zonas de protección especial.',
    ' certificada según el D.S. N°1/2022 del Ministerio del Medio Ambiente con clasificación para territorio nacional general. Cumple el límite de luz azul ≤7%: apta para alumbrado exterior en las comunas que no están declaradas como Áreas de Protección Especial. Exigible en todo Chile para luminarias exteriores nuevas desde el 19 de octubre de 2026.',
  ],
  [
    'Ministerio del Medio Ambiente (MMA) - SMA',
    'Organismo de certificación autorizado por la SEC · Protocolo PCL N°1:2024 de la SMA',
  ],
  ['Variantes recomendadas: 2200K (zonas con regulación de cielos oscuros) o 2700K (resto del país).', REC],
  [
    'Variantes recomendadas: 2700K Cálida para zonas residenciales, 4000K Neutra para plazas con uso nocturno intensivo.',
    REC,
  ],
  ['Variantes recomendadas: 2700K o 4000K según contexto urbano.', REC],
  [
    'Variantes recomendadas: 2700K Cálida para zonas residenciales con regulación DS1 MMA, 4000K Neutra para resto del territorio.',
    REC,
  ],
  ['Variantes recomendadas: 2700K o 4000K según contexto.', REC],
  ['Variantes recomendadas: 2700K para condominios, 4000K para caminos rurales.', REC],
  [
    'Variantes recomendadas: 2700K Cálida para zonas con regulación DS1 MMA, 4000K Neutra para resto del territorio.',
    REC,
  ],
  [
    'Variantes recomendadas: 2700K Cálida para zonas residenciales con regulación DS1, 4000K para plazas con uso nocturno intensivo.',
    REC,
  ],
  ['Variantes recomendadas: 2700K o 4000K según contexto urbano y exigencia normativa.', REC],
  [
    'Variantes recomendadas: 4000K Neutra para visibilidad estándar, 2700K Cálida para zonas con regulación DS1 MMA.',
    REC,
  ],
  ['sensación de seguridad. Variantes recomendadas: 4000K o 5000K.', `sensación de seguridad. ${REC}`],
  [
    'circulación de equipos pesados. Variantes recomendadas: 4000K Neutra o 5000K Fría para máxima visibilidad operativa.',
    `circulación de equipos pesados. ${REC}`,
  ],
  [
    'zonas de carga/descarga. Variantes recomendadas: 4000K Neutra o 5000K Fría.',
    'zonas de carga/descarga. Variantes recomendadas: 4000K Neutra o 5000K Fría bajo techo; en patios y zonas de carga al aire libre, 2700K Cálida, o 2200K Ámbar si la comuna está declarada como Área de Protección Especial.',
  ],
  ['Variantes recomendadas: 4000K Neutra o 5000K Fría para máxima visibilidad operativa y de seguridad.', REC],
  [
    'circulación de equipos pesados. Variantes recomendadas: 4000K Neutra o 5000K Fría.',
    `circulación de equipos pesados. ${REC}`,
  ],
  [
    'para práctica nocturna. Variantes recomendadas: 4000K Neutra o 5000K Fría.',
    'para práctica nocturna. En canchas, el D.S. N°1/2022 limita la temperatura de color según la clase del recinto y exige apagar la iluminación entre las 00:00 y las 07:00, salvo eventos autorizados por el municipio o la Delegación Presidencial Regional. Variante recomendada para multicanchas y canchas municipales: 2700K Cálida.',
  ],
  [
    'en ambiente costero/salino. Variantes recomendadas: 4000K o 5000K para máxima visibilidad operativa.',
    `en ambiente costero/salino. ${REC}`,
  ],
  ['y gran altura. Variantes recomendadas: 4000K Neutra o 5000K Fría.', `y gran altura. ${REC}`],
  [
    '**Zonas de protección astronómica o biodiversidad:** restricción a luminarias con clasificación para',
    '**Comunas declaradas como Áreas de Protección Especial y áreas de biodiversidad:** revise si la comuna del proyecto está declarada; en ellas se exige la clasificación para',
  ],
  ['Variante única apta: 2200K Ámbar', 'Variante con esa certificación: 2200K Ámbar'],
  [
    'y la normativa local aplicable.',
    'y la normativa local aplicable. Para mantener el cumplimiento del D.S. N°1/2022, instale la variante certificada sin superar el ángulo de montaje que declara su certificado DS1.',
  ],
  [
    'Proyectos de recambio municipal con cumplimiento DS1 MMA',
    'Proyectos de recambio municipal con cumplimiento DS1 MMA (variantes 2200K y 2700K)',
  ],
  [
    'Zonas astronómicas en regiones de Antofagasta, Atacama y Coquimbo (variante 2200K)',
    'Comunas declaradas como Áreas de Protección Especial (variante 2200K)',
  ],
  [
    'cuenta con clasificación para Áreas de Protección Especial (luz azul ≤1%), apta para todo el territorio nacional incluyendo zonas de protección especial astronómica y de biodiversidad.',
    'tiene certificación DS1 con clasificación para Áreas de Protección Especial (luz azul ≤1%): apta para las comunas declaradas como Áreas de Protección Especial, las áreas de protección de biodiversidad y el resto del país.',
  ],
  [
    'cuenta con clasificación para territorio nacional general (luz azul entre 1% y 7%), apta para todo el territorio excepto zonas de protección especial.',
    'tiene certificación DS1 con clasificación para territorio nacional general (luz azul ≤7%): apta para las comunas que no están declaradas como Áreas de Protección Especial.',
  ],
  [
    'Las variantes 4000K y 5000K son aptas para alumbrado público con certificación SEC en zonas sin regulación DS1 MMA.',
    `Las variantes 4000K y 5000K cuentan con certificación SEC. Para alumbrado exterior nuevo, ${DS1_2026}, recomendamos 2700K Cálida, o 2200K Ámbar si la comuna está declarada como Área de Protección Especial.`,
  ],
  [
    'La elección depende de la zona y el tipo de aplicación. Para calles residenciales y zonas con regulación de cielos oscuros se recomienda 2200K (Áreas de Protección Especial, 1% luz azul) o 2700K (territorio nacional general, 7% luz azul). Para avenidas y vías principales sin restricción DS1, la 4000K Neutra ofrece buena visibilidad estándar. Para estacionamientos y zonas de seguridad perimetral, las 4000K o 5000K aportan mayor contraste y sensación de seguridad.',
    `La elección depende de la comuna y del tipo de aplicación. Para alumbrado exterior nuevo (calles, avenidas, plazas, estacionamientos y patios), ${DS1_2026}, se recomienda 2700K Cálida (clasificación para territorio nacional general) o, si la comuna está declarada como Área de Protección Especial o el proyecto está en un área de protección de biodiversidad, 2200K Ámbar (clasificación para Áreas de Protección Especial). Revise la comuna del proyecto antes de elegir. Las variantes 4000K y 5000K cuentan con certificación SEC.`,
  ],
  [
    'Para proyectos en regiones con regulación de luz azul (zonas astronómicas o biodiversidad), las variantes 2200K y 2700K cumplen también la norma DS1/2022 MMA.',
    `Para alumbrado exterior, ${DS1_2026}, las variantes 2200K y 2700K cuentan además con certificación DS1: 2200K para comunas declaradas como Áreas de Protección Especial y áreas de biodiversidad, 2700K para el resto del país.`,
  ],
  [
    'La certificación DS1/2022 MMA, otorgada por el Ministerio del Medio Ambiente y vigente desde octubre 2024, regula la emisión de luz azul para reducir contaminación lumínica, proteger la biodiversidad y la observación astronómica — es obligatoria para alumbrado exterior en zonas reguladas.',
    'La certificación DS1 acredita el cumplimiento del D.S. N°1/2022 del Ministerio del Medio Ambiente, que regula, entre otros aspectos, la emisión de luz azul para reducir la contaminación lumínica y proteger la biodiversidad y la observación astronómica. La emite un organismo de certificación autorizado por la SEC, según el Protocolo PCL N°1:2024 de la Superintendencia del Medio Ambiente (SMA). Es obligatoria para el alumbrado exterior: desde octubre de 2024 en las Áreas de Protección Especial y, desde el 19 de octubre de 2026, en todo Chile para luminarias nuevas.',
  ],
  [
    'cumple SEC en sus 4 variantes y DS1 MMA en sus variantes 2200K y 2700K.',
    'cuenta con certificación SEC en sus 4 variantes y con certificación DS1 en sus variantes 2200K y 2700K.',
  ],
  ['(1% luz azul)', '(luz azul ≤1%)'],
  ['(7% luz azul)', '(luz azul ≤7%)'],
  ...BESTLED_WATTS.flatMap((w): [string, string][] => [
    [`APB${w}A`, `APB${w}1`],
    [`APB${w}C`, `APB${w}7`],
  ]),
];
/** Valor editorial del fixture con los cambios intencionales aplicados. */
const withEditorialEdits = <T,>(value: T): T =>
  value === undefined ? value : JSON.parse(EDITORIAL_EDITS.reduce((s, [from, to]) => s.split(from).join(to), JSON.stringify(value)));
/** Id del sitio de un producto: el renombrado gana sobre el legado y el de la sincronización. */
const registeredId = (jid: number) => RENAMED_SITE_IDS[jid]?.id ?? LEGACY_SITE_IDS[jid] ?? SITE_IDS[jid];

describe('lectura de specs desde el nombre', () => {
  it('potencia, incluidos decimales con coma', () => {
    expect(parseWatts('PROYECTOR LED ANTIVANDÁLICO 200W IP66')).toBe(200);
    expect(parseWatts('CINTA LED EXTERIOR 14,4W SMD 5730 72LEDs/m')).toBe(14.4);
    expect(parseWatts('RIEL MONOFÁSICO 1 MT')).toBe(0);
  });
  it('temperatura de color e IP', () => {
    expect(parseKelvin('PANEL LED 60X60 40W 4000K')).toBe(4000);
    expect(parseKelvin('PANEL LED 60X60 40W')).toBe(0);
    expect(parseIp('ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08')).toBe('IP66');
    expect(parseIp('TUBO LED T8')).toBeUndefined();
  });
});

describe('catálogo desde Jumpseller', () => {
  it('cada producto tiene su id registrado (renombrado, legado o asignado por la sincronización)', () => {
    for (const p of products) {
      expect(p.id).toBe(registeredId(p.jumpseller_id));
    }
    // Todos los ids usados alguna vez: ninguno se repite (previous[0] es el legado o el de la sincronización)
    const all = [
      ...Object.values(LEGACY_SITE_IDS),
      ...Object.values(SITE_IDS),
      ...Object.values(RENAMED_SITE_IDS).flatMap(r => [r.id, ...r.previous.slice(1)]),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('cada id es un slug limpio: [a-z0-9] separados por "-" (sin %, puntos, comas ni tildes)', () => {
    const ids = [
      ...Object.values(LEGACY_SITE_IDS),
      ...Object.values(SITE_IDS),
      ...Object.values(RENAMED_SITE_IDS).flatMap(r => [r.id, ...r.previous]),
      ...products.map(p => p.id),
    ];
    expect(ids.filter(id => !SITE_ID.test(id))).toEqual([]);
  });

  it('publica exactamente los productos del snapshot, con ids únicos', () => {
    expect(products).toHaveLength(jumpsellerSnapshot.length);
    expect(PUBLISHED_PRODUCT_COUNT).toBe(products.length);
    expect(new Set(products.map(p => p.id)).size).toBe(products.length);
    expect(new Set(products.map(p => p.jumpseller_id)).size).toBe(products.length);
  });

  it('precio, nombre y fotos vienen de Jumpseller; fotos separadas (sin URLs unidas por comas)', () => {
    for (const p of products) {
      const s = snapById.get(p.jumpseller_id)!;
      expect(p.price).toBe(s.price);
      expect(p.price).toBeGreaterThan(0);
      expect(p.name).toBe(s.name);
      expect(p.images).toEqual(s.images.map(i => i.url));
      expect(p.images.length).toBeGreaterThan(0);
      expect(p.image).toBe(p.images[0]);
      for (const url of p.images) expect(url).not.toContain(',');
      expect(p.imageRefs!.map(i => i.id)).toEqual(s.images.map(i => i.id));
    }
  });

  it('categorías: la principal es la primera, todas existen en el sitio y los conteos cuadran', () => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      expect(p.categories.length).toBeGreaterThan(0);
      expect(p.category).toBe(p.categories[0]);
      for (const c of p.categories) {
        expect(siteSlugs).toContain(c);
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    expect(counts).toEqual(CATEGORY_PRODUCT_COUNTS);
    for (const c of categories) expect(c.productCount).toBe(CATEGORY_PRODUCT_COUNTS[c.slug] ?? 0);
  });

  it('nunca publica productos de prueba ni campos prohibidos', () => {
    expect(products.some(p => /PRODUCTO\s+TEST/i.test(p.name))).toBe(false);
    for (const id of [34540602, 34540610, 34540669]) expect(products.some(p => p.jumpseller_id === id)).toBe(false);
    const json = JSON.stringify(products);
    expect(json).not.toMatch(/"stock"|"cost_per_item"|"stock_unlimited"/);
  });
});

describe('se conserva lo que no viene de Jumpseller', () => {
  const kept = products.filter(p => legacyById.has(p.jumpseller_id));

  it('los productos que siguen publicados mantienen su id (URLs /producto/:id), salvo los renombrados', () => {
    expect(kept.length).toBeGreaterThan(0);
    for (const p of kept) expect(p.id).toBe(RENAMED_SITE_IDS[p.jumpseller_id]?.id ?? LEGACY_SITE_IDS[p.jumpseller_id]);
  });

  it('temperatura e IP salen del nombre; los lúmenes legados se conservan', () => {
    for (const p of products) {
      expect(p.kelvin).toBe(parseKelvin(p.name));
      expect(p.ip).toBe(parseIp(p.name));
    }
    for (const p of kept) expect(p.lumens).toBe(legacyById.get(p.jumpseller_id)!.lumens);
  });

  it('las temperaturas de color (kelvins) salen de las opciones de las variantes; sin ninguna ahí, del nombre (auditoría UX, B-05)', () => {
    expect(parseKelvins('Luz Cálida 2200K - 1% Luz Azul')).toEqual([2200]);
    expect(parseKelvins('Luz fría 6400k')).toEqual([6400]);
    expect(parseKelvins('Luz Cálida - 1% Luz Azul')).toEqual([]); // el % de luz azul no se traduce a kelvin
    for (const p of products) {
      const s = snapById.get(p.jumpseller_id)!;
      expect(p.kelvins, p.name).toEqual(productKelvins(s));
      expect(p.kelvins, p.name).toEqual([...new Set(p.kelvins)].sort((a, b) => a - b));
      const optionText = s.variants.flatMap(v => v.options.map(o => o.value)).join(' | ');
      const source = parseKelvins(optionText).length ? optionText : s.name;
      for (const k of p.kelvins) expect(source, `${p.name} ${k}K`).toMatch(new RegExp(`${k}\\s*K\\b`, 'i'));
    }
    // Las BESTLED tienen varias temperaturas en sus variantes de Jumpseller, aunque el nombre no diga ninguna
    const bestled = products.filter(p => BESTLED.includes(p.jumpseller_id));
    expect(bestled.length).toBeGreaterThan(0);
    for (const p of bestled) expect(p.kelvins.length, p.name).toBeGreaterThan(1);
  });

  it('la potencia sale del nombre (corrige cintas "14,4W" que el sitio mostraba como 4W)', () => {
    const changed: number[] = [];
    for (const p of kept) {
      expect(p.watts).toBe(parseWatts(p.name));
      const l = legacyById.get(p.jumpseller_id)!;
      if (p.name === l.name && p.watts !== l.watts) changed.push(p.jumpseller_id);
    }
    for (const id of changed) expect(products.find(p => p.jumpseller_id === id)!.name).toMatch(/\d+,\d+W/);
  });

  it('SKU y marca: los de Jumpseller cuando existen; si no, los del sitio (sin caracteres invisibles)', () => {
    const owners = skuOwners(jumpsellerSnapshot);
    for (const p of kept) {
      const l = legacyById.get(p.jumpseller_id)!;
      const s = snapById.get(p.jumpseller_id)!;
      const single = s.variants.length === 1 && owners.get(s.variants[0].sku)?.size === 1 ? s.variants[0].sku : '';
      expect(p.sku).toBe(s.sku || cleanSku(l.sku) || single);
      expect(p.sku).not.toMatch(/[\u200B\uFEFF]/);
      // Marca: la de Jumpseller cuando existe; si Jumpseller no la trae, la de las
      // correcciones del sitio (overrides). Si alguien la quita en Jumpseller, el sitio
      // deja de mostrarla (no vuelve a la copia de marzo).
      expect(p.brand).toBe(s.brand ?? baseOverrides[p.jumpseller_id]?.brand ?? '');
    }
  });

  it('nunca toma prestado el SKU de variante que usa otro producto (SKUs repetidos en Jumpseller)', () => {
    const owners = skuOwners(jumpsellerSnapshot);
    for (const p of products) {
      const s = snapById.get(p.jumpseller_id)!;
      const legacySku = legacyById.has(p.jumpseller_id) ? cleanSku(legacyById.get(p.jumpseller_id)!.sku) : '';
      if (!p.sku || p.sku === s.sku || p.sku === legacySku) continue;
      expect(owners.get(p.sku), `${p.jumpseller_id} ${p.sku}`).toEqual(new Set([p.jumpseller_id]));
    }
    // Caso real: DLRO40N es del panel Retraído 40W; los de 24W y 6W no lo heredan. Pueden no
    // tener SKU o tener uno propio (el 13-10 Jumpseller le cargó PLRO24N al de 24W), pero nunca
    // el de otro producto.
    for (const id of [25714697, 25714841]) {
      const sku = products.find(p => p.jumpseller_id === id)!.sku;
      expect(sku, String(id)).not.toBe('DLRO40N');
      if (sku) expect(owners.get(sku), `${id} ${sku}`).toEqual(new Set([id]));
    }
  });

  it('todo el contenido editorial de los 7 BESTLED sigue intacto', () => {
    for (const id of BESTLED) {
      const p = products.find(x => x.jumpseller_id === id)!;
      const l = legacyById.get(id)!;
      expect(p, String(id)).toBeDefined();
      for (const k of EDITORIAL_KEYS) {
        if (k === 'cctVariants') continue;
        // El fixture histórico no cambia: las fichas PDF ahora usan rutas del mismo sitio.
        if (k === 'datasheetUrl') {
          expect(p[k], `${id}.${k}`).toBe(new URL(l.datasheetUrl!).pathname);
          continue;
        }
        expect(p[k], `${id}.${k}`).toEqual(withEditorialEdits(l[k]));
      }
    }
    for (const id of Object.keys(editorialOverlay)) expect(snapById.has(Number(id))).toBe(true);
  });

  it.each(BESTLED_WATTS)('BESTLED %iW enlaza una ficha PDF relativa que existe en public/fichas', (watts) => {
    const p = products.find(x => BESTLED.includes(x.jumpseller_id) && x.watts === watts)!;
    expect(p.datasheetUrl).toBe(`/fichas/APB${watts}.pdf`);
    const pdf = readFileSync(join(__dirname, '../public', p.datasheetUrl!));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('los cambios intencionales al editorial se aplicaron en los BESTLED', () => {
    const text = JSON.stringify(BESTLED.map(id => products.find(x => x.jumpseller_id === id)));
    for (const [from, to] of EDITORIAL_EDITS) {
      if (!to.includes(from)) expect(text, from).not.toContain(from);
      expect(text, to).toContain(to);
    }
    expect(text).not.toMatch(/gratuit|cotizaci[oó]n r[aá]pida/i);
  });

  it('los BESTLED no repiten los errores del D.S. N°1/2022', () => {
    // Sin `variants`: son los valores crudos de Jumpseller («Luz Cálida 2200K - 1% Luz Azul»),
    // que el sitio nunca muestra así (src/lib/variants.ts: «Ámbar 2200K»; lo prueba variants.test.ts)
    // ni publica en el HTML (el radio lleva la posición; lo prueba src/ssr-hydration.test.tsx)
    const text = JSON.stringify(
      BESTLED.map(id => products.find(x => x.jumpseller_id === id)),
      (key, value) => (key === 'variants' ? undefined : value),
    );
    for (const wrong of [
      /zonas? (?:no sujetas|sin regulaci[oó]n|sin restricci[oó]n)/i, // desde el 19-10-2026 no quedan zonas sin DS1
      /regiones? astron[oó]mica|astron[oó]micas en regiones/i, // las Áreas de Protección Especial son comunas
      /otorgada por el Ministerio|Ministerio del Medio Ambiente \(MMA\) - SMA/i, // certifica un organismo autorizado por la SEC
      /\b\d+ ?% (?:de )?luz azul|entre 1% y 7%/i, // el % es el límite (≤1%, ≤7%), no un valor de la CCT
    ]) {
      expect(text).not.toMatch(wrong);
    }
  });

  it('las variantes CCT de BESTLED toman precio y SKU de Jumpseller', () => {
    for (const id of BESTLED) {
      const p = products.find(x => x.jumpseller_id === id)!;
      const live = new Map(snapById.get(id)!.variants.map(v => [v.id, v]));
      expect(p.cctVariants).toHaveLength(4);
      for (const v of p.cctVariants!) {
        const s = live.get(v.jumpseller_variant_id!)!;
        expect(s, `${id} variante ${v.jumpseller_variant_id}`).toBeDefined();
        expect(v.price).toBe(s.price);
        expect(v.sku).toBe(s.sku || v.sku);
      }
    }
  });
});

// PR 14a: el texto editorial (fichas, FAQ, certificaciones, SEO) nombra los SKU de los BESTLED.
// Jumpseller es la fuente de verdad: 2200K → APB{W}1, 2700K → APB{W}7, 4000K → N, 5000K → F.
describe('SKU de los BESTLED en el texto editorial', () => {
  /** Todos los textos de un valor: strings de objetos y listas, a cualquier profundidad. */
  const strings = (v: unknown): string[] =>
    typeof v === 'string'
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(strings)
        : v !== null && typeof v === 'object'
          ? Object.values(v).flatMap(strings)
          : [];
  const editorialTexts = Object.values(editorialOverlay).flatMap(strings);
  const mentioned = (re: RegExp) => [...new Set(editorialTexts.flatMap(t => t.match(re) ?? []))].sort();
  const bestled = BESTLED.map(id => {
    const p = products.find(x => x.jumpseller_id === id)!;
    return { id, p, live: new Map(snapById.get(id)!.variants.map(v => [v.id, v.sku])) };
  });

  it('el SKU base del sitio + el sufijo de su color de luz da el SKU de variante de Jumpseller', () => {
    for (const { id, p, live } of bestled) {
      expect(p.cctVariants, String(id)).toHaveLength(4);
      for (const v of p.cctVariants!) {
        expect(buildVariantSku(p.sku, v.kelvin), `${id} ${v.kelvin}K`).toBe(live.get(v.jumpseller_variant_id!));
      }
    }
  });

  it('no quedan SKU con la convención antigua (A = 2200K, C = 2700K)', () => {
    expect(mentioned(/\bAPB\d+[AC]\b/g)).toEqual([]);
  });

  it('cada SKU APB del texto existe en Jumpseller, como SKU de variante o como su base', () => {
    const jumpsellerSkus = new Set(jumpsellerSnapshot.flatMap(s => [s.sku, ...s.variants.map(v => v.sku)]).filter(Boolean));
    // El SKU base (APB40) Jumpseller no lo tiene: vale si con cada sufijo da sus SKU de variante.
    for (const { p, live } of bestled) {
      if (p.cctVariants!.every(v => buildVariantSku(p.sku, v.kelvin) === live.get(v.jumpseller_variant_id!))) {
        jumpsellerSkus.add(p.sku);
      }
    }
    const skus = mentioned(/\bAPB\w*/g);
    expect(skus.filter(sku => !jumpsellerSkus.has(sku))).toEqual([]);
    // La búsqueda sí ve los SKU: el texto nombra la base y las 4 variantes de cada BESTLED.
    for (const { p } of bestled) {
      for (const sku of [p.sku, ...p.cctVariants!.map(v => v.sku)]) expect(skus, sku).toContain(sku);
    }
  });
});

// PR 07: ids que el catálogo legado cortó en la última '/' del permalink. Esta lista no se
// edita: borrar o cambiar una fila de renamed-ids.ts dejaría en 404 las URLs nuevas.
const PR07_RENAMES: [number, string, string][] = [
  [2300837, 'sensor-6500k', 'tubo-led-opal-vidrio-18w-120cm-220v-c-sensor-6500k'],
  [2312822, 'm-5mt-12v-luz-calida-2312822', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-luz-calida'],
  [2313541, 'm-5mt-12v-luz-fria', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-luz-fria'],
  [2313620, 'm-5mt-12v-rojo-2313620', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-rojo'],
  [2313626, 'm-5mt-12v-azul', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-azul'],
  [2313647, 'm-5mt-12v-verde-2313647', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-verde'],
  [2313648, 'm-5mt-12v-amarillo', 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-amarillo'],
  [2313769, 'm-5mt-12v-luz-calida', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-luz-calida'],
  [2313836, 'm-5mt-12v-rojo', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-rojo'],
  [2313842, 'm-5mt-12v-azul-2313842', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-azul'],
  [2313858, 'm-5mt-12v-verde', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-verde'],
  [2313868, 'm-5mt-12v-amarillo-2313868', 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-amarillo'],
  [2345320, 'rejilla-e27-ip54-blanca', 'tortuga-aluminio-oval-c-rejilla-e27-ip54-blanca'],
  [3952758, 'mt-ip67-100mt-220v', 'cinta-led-exterior-14-4w-5730-72-leds-mt-ip67-100mt-220v'],
  [3954845, 'm-ip67-100-mt-220v', 'cinta-led-exterior-verde-14-4w-m-72-leds-m-ip67-100-mt-220v'],
  [4122715, 'w-ip66', 'campana-led-ufo-nf3-150w-150-lm-w-ip66'],
  [20610994, 'w-ip65', 'campana-led-ufo-nf6-300w-110lm-w-ip65'],
  [21809432, 'm-100mt-220v-rgb', 'cinta-led-exterior-6-5w-smd-2835-48leds-m-100mt-220v-rgb'],
  [22672906, 'm-100mt-220v-amarillo', 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-amarillo'],
  [22679546, 'm-100mt-220v-azul', 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-azul'],
  [22679578, 'm-100mt-220v-rojo', 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-rojo'],
  [24031164, 'w-ip65-24031164', 'campana-led-ufo-nf8-100w-110lm-w-ip65'],
  [24040212, 'w-ip65-24040212', 'campana-led-ufo-nf8-150w-110lm-w-ip65'],
  [24040292, 'w-ip65-24040292', 'campana-led-ufo-nf8-200w-110lm-w-ip65'],
  [24043701, 'w-ip65-24043701', 'campana-led-ufo-nf8-300w-110lm-w-ip65'],
  [24043822, 'w-ip65-24043822', 'campana-led-ufo-nf8-pro-300w-150lm-w-ip65'],
  [24192756, 'sensor-de-movimiento', 'proyector-led-ultra-slim-50w-ip66-negro-c-sensor-de-movimiento'],
  [24192873, 'sensor-de-movimiento-24192873', 'proyector-led-ultra-slim-100w-ip66-negro-c-sensor-de-movimiento'],
  [24256942, 'sensor-de-movimiento-24256942', 'proyector-led-ultra-slim-150w-ip66-negro-c-sensor-de-movimiento'],
  [24257068, 'sensor-de-movimiento-24257068', 'proyector-led-ultra-slim-200w-ip66-negro-c-sensor-de-movimiento'],
  [25818717, 'control-remoto-1', 'alumbrado-publico-led-solar-200w-all-in-one-c-control-remoto'],
  [25885210, 'control-remoto-1-25885210', 'alumbrado-publico-led-solar-100w-all-in-one-c-control-remoto'],
  [25888711, 'control-remoto', 'alumbrado-publico-led-solar-150w-all-in-one-c-control-remoto'],
  [25888760, 'control-remoto-1-25888760', 'alumbrado-publico-led-solar-60w-all-in-one-c-control-remoto'],
  [25891192, 'control-remoto-25891192', 'proyector-led-solar-100w-ip65-c-panel-solar-c-control-remoto'],
  [25891958, 'control-remoto-25891958', 'proyector-led-solar-150w-ip65-c-panel-solar-c-control-remoto'],
  [25892132, 'control-remoto-25892132', 'proyector-led-solar-200w-ip65-c-panel-solar-c-control-remoto'],
  [28648231, 'control-remoto-gris', 'proyector-led-solar-200w-ip66-c-panel-solar-c-control-remoto-gris'],
  [28651673, 'control-remoto-28651673', 'proyector-led-solar-100w-ip66-c-panel-solar-c-control-remoto'],
  [28666518, 'control-remoto-28666518', 'proyector-led-solar-300w-ip66-c-panel-solar-c-control-remoto'],
  [28668257, 'control-remoto-28668257', 'proyector-led-solar-150w-ip66-c-panel-solar-c-control-remoto'],
  [31518788, 'w-ip66-ik10', 'campana-led-ufo-regulable-200w-150lm-w-ip66-ik10'],
  [32954808, 'ip65-44000-lm', 'campana-led-ufo-nf9-400w-110-lm-ip65-44000-lm'],
  [33554875, 'w-ip65-33554875', 'campana-led-ufo-nf7-100w-120lm-w-ip65'],
  [33597212, 'w-ip65-33597212', 'campana-led-ufo-nf7-150w-120lm-w-ip65'],
  [33610052, 'w-ip65-33610052', 'campana-led-ufo-nf7-200w-120lm-w-ip65'],
  [33736073, 'w-ip65-11000-lm', 'campana-led-ufo-nf9-100w-110lm-w-ip65-11000-lm'],
  [33748536, 'w-ip65-16500-lm', 'campana-led-ufo-nf9-150w-110lm-w-ip65-16500-lm'],
  [33748560, 'w-ip65-22000-lm', 'campana-led-ufo-nf9-200w-110lm-w-ip65-22000-lm'],
  [34057374, 'control-remoto-34057374', 'proyector-led-solar-500w-ip65-c-panel-solar-c-control-remoto'],
];

describe('ids renombrados (src/data/catalog/renamed-ids.ts)', () => {
  const renamed = Object.entries(RENAMED_SITE_IDS).map(([jid, r]) => ({ jid: Number(jid), ...r }));

  it('cada renombre parte del id registrado (legado o de la sincronización)', () => {
    for (const r of renamed) {
      expect(r.previous.length, String(r.jid)).toBeGreaterThan(0);
      expect(r.previous[0], String(r.jid)).toBe(LEGACY_SITE_IDS[r.jid] ?? SITE_IDS[r.jid]);
      expect(r.previous, String(r.jid)).not.toContain(r.id);
    }
  });

  it('solo crece: los 50 de la PR 07 siguen ahí, con su id nuevo vigente o como id anterior', () => {
    expect(PR07_RENAMES).toHaveLength(50);
    for (const [jid, old, id] of PR07_RENAMES) {
      const r = RENAMED_SITE_IDS[jid];
      expect(r, String(jid)).toBeDefined();
      expect(r.previous, String(jid)).toContain(old);
      expect([r.id, ...r.previous], String(jid)).toContain(id);
      expect(RENAMED_FROM.get(old), old).toBe(r.id);
    }
  });

  it('ningún producto se publica con un id retirado (su 301 taparía la página)', () => {
    expect(RETIRED_SITE_IDS.size).toBe(renamed.reduce((n, r) => n + r.previous.length, 0));
    expect(products.filter(p => RETIRED_SITE_IDS.has(p.id)).map(p => p.id)).toEqual([]);
    for (const r of renamed) expect(RETIRED_SITE_IDS.has(r.id), r.id).toBe(false);
    // Un Map: /producto/constructor no encuentra nada heredado de Object.prototype
    expect(RENAMED_FROM.get('constructor')).toBeUndefined();
  });

  it('la tabla no importa nada, y el carrito y la cotización no cargan el catálogo completo (bundle principal)', () => {
    const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
    expect(read('src/data/catalog/renamed-ids.ts')).not.toMatch(/^\s*import\b/m);
    for (const f of ['src/lib/requestOrder.ts', 'src/context/AppContext.tsx', 'src/routes.tsx']) {
      const staticImports = [...read(f).matchAll(/^import\s[^;]*?from\s+'([^']+)'/gms)].map(m => m[1]);
      expect(staticImports.filter(i => /seo\/routes|data\/catalog\/index|data\/products/.test(i)), f).toEqual([]);
    }
  });
});
