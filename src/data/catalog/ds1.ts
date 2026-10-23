// src/data/catalog/ds1.ts
// D.S. N°1/2022 del Ministerio del Medio Ambiente (contaminación lumínica) en el contenido
// propio del sitio: fichas SEO (content/*.json), overlay editorial (BESTLED) e introducciones
// de categoría (auditoría UX, entrega 4: D-04 y K-03). Lo usan content.test.ts (vía
// scripts/content/check.ts) y src/config/contentTruth.test.ts. Solo imports relativos: también
// lo importa scripts/.
//
// Reglas (decisiones del dueño del 17, 18, 22 y 23-10-2026, skill normativa-ds1-elights; lo que
// dice el dueño prima sobre la skill):
// - «Certificado D.S. N°1» solo para las 8 líneas con certificado (DS1_CERTIFIED_LINES) y solo en
//   las versiones que cubre cada una: las cálidas de 2200K y 2700K en BESTLED, Flyhawk, solar
//   industrial All in One, Island y Slim SMD de 150 a 500W; la ámbar de 1600K y la de 2700K en la
//   Pagoda solar UFO; en los proyectores de estadio, modulares y no modulares, las de hasta 5000K
//   (DS1_SPORTS_MAX_KELVIN). Las demás versiones no se mencionan como certificadas. En los Slim
//   (Jumpseller marca «CON DS1» también la de 3000K), en la Pagoda y en los estadios que tienen
//   una versión de más de 5000K, la ficha dice además cuáles no lo tienen, en una oración aparte
//   que no nombra la norma («La de 3000K y la fría de 6500K no lo tienen»). Al resto no se le
//   afirma: se ofrece asesoría («¿Necesitas el D.S. N°1? Te asesoramos»).
// - Proyectores de estadio (decisión del dueño del 23-10-2026, que reemplaza la del 22-10 de
//   «todas sus versiones»): certificado solo en las versiones de hasta 5000K, mientras el dueño
//   revisa qué versiones cubren sus certificados. La Tabla 4 del D.S. N°1/2022 limita la
//   temperatura de color del alumbrado deportivo a 5000K o 3000K según la clase del recinto: con
//   6000K o 6500K una cancha no puede cumplir. Cada oración del certificado nombra las versiones
//   de hasta 5000K que el producto tiene de verdad (sus variantes en Jumpseller: lo revisa
//   ds1VariantIssues, que recibe sus opciones); si no tiene ninguna (el estadio de 600W, solo
//   6000K), su ficha no lo afirma y ofrece asesoría. El tope de la Tabla 4 no se escribe en la
//   web (el decreto la publica como imagen): la ficha nombra sus versiones, no el tope.
// - Una versión sin certificado tampoco se cuela por otro camino: nombrada sin «K» («y 3000») o
//   por su tono sin su temperatura («la fría», «el frío», «la neutra», «la luz de día», «la
//   blanca»; «la fría de 5000K» sí, pero solo en un estadio) en la oración del certificado; con
//   «ambas versiones», «sus dos versiones» o «igual que la otra versión»; en la respuesta a la
//   pregunta por el certificado («¿Qué versiones tienen certificado…?»), que además nombra una
//   versión certificada; ni con «también lo tiene», «está certificada», «el mismo certificado» o
//   «La de 6000K, también.» en otra oración.
// - Preguntas por producto o por versión: isDs1Certified(id), isDs1CertifiedKelvin(id, kelvin)
//   y ds1Line(id), con la regla de su línea.
// - La clasificación para Áreas de Protección Especial («apta para…») solo está documentada en
//   las BESTLED (su ficha editorial y el bloque de la categoría).
// - El D.S. N°43/2012 quedó sin efecto el 19-10-2024 (art. 20 del D.S. N°1): nunca como vigente.
// - Canchas y recintos deportivos se rigen por temperatura de color según su clase (art. 7), no
//   por luz azul: el «% de luz azul» nunca va junto a ellos.
// - «2200K, 1 % de luz azul» como dato de producto sí se permite (pregunta 32 del informe).
// - En una ficha SEO, con o sin certificado, el «% de luz azul» no va en el mismo bloque
//   (pregunta y respuesta, sección de la descripción) que nombra la norma: juntos se leen como
//   que el porcentaje es lo que la cumple.
// No depende de datos de Jumpseller: solo de los textos que se le pasan (también las opciones de
// las variantes, en ds1VariantIssues) y de la lista de productos certificados, que es un dato
// del dueño.

import type { ProductContent } from './types';

/**
 * Versiones con certificado D.S. N°1 de una línea: sus temperaturas de color (K), o un tope (las
 * de hasta maxKelvin, en los proyectores de estadio).
 */
export type Ds1Versions = readonly number[] | { readonly maxKelvin: number };

/**
 * Tope de los proyectores de estadio (decisión del dueño, 23-10-2026): certificado solo en sus
 * versiones de hasta 5000K. La Tabla 4 del D.S. N°1/2022 limita la temperatura de color del
 * alumbrado deportivo a 5000K o 3000K según la clase del recinto.
 */
export const DS1_SPORTS_MAX_KELVIN = 5000;

/** ¿Esas versiones certificadas incluyen la de esa temperatura de color (K)? */
export function ds1CoversKelvin(versions: Ds1Versions, kelvin: number): boolean {
  return 'maxKelvin' in versions ? kelvin <= versions.maxKelvin : versions.includes(kelvin);
}

export interface Ds1Line {
  /** Productos de la línea (ids de Jumpseller). */
  ids: readonly number[];
  /** Versiones con certificado: las demás no se mencionan como certificadas. */
  versions: Ds1Versions;
  /**
   * Proyectores de recintos deportivos: la norma los regula por temperatura de color según la
   * clase del recinto (art. 7), así que su ficha nunca habla de luz azul.
   */
  sports?: true;
}

/** Las cálidas: 2200K (la que se pide en Áreas de Protección Especial) y 2700K. */
export const DS1_WARM_KELVIN: readonly number[] = [2200, 2700];

export type Ds1LineKey = 'bestled' | 'flyhawk' | 'solarIndustrial' | 'island' | 'slim' | 'pagoda' | 'estadioModular' | 'estadio';

/**
 * Líneas con certificado D.S. N°1 y sus versiones certificadas, según el dueño (22-10-2026; los
 * proyectores de estadio, hasta 5000K desde el 23-10-2026): la lista completa, 8 líneas y 33
 * productos. Para sumar otra, la decisión del dueño (pregunta 8 del informe UX). Las BESTLED
 * tienen además su certificado detallado en la ficha editorial (overlay/editorial.ts, PR #78):
 * 2200K con clasificación para Áreas de Protección Especial y 2700K para el resto del país.
 */
export const DS1_CERTIFIED_LINES: Readonly<Record<Ds1LineKey, Ds1Line>> = {
  /** ALUMBRADO PÚBLICO BESTLED 40, 60, 90, 120, 150, 200 y 250W. */
  bestled: { ids: [2301098, 2301101, 2301105, 2301110, 2301114, 4156930, 15021313], versions: DS1_WARM_KELVIN },
  /** ALUMBRADO PÚBLICO LED SOLAR FLYHAWK 40-80W. */
  flyhawk: { ids: [11521285], versions: DS1_WARM_KELVIN },
  /** ALUMBRADO PÚBLICO LED SOLAR 200, 300, 400 y 600W ALL IN ONE INDUSTRIAL C/ CONTROL REMOTO. */
  solarIndustrial: { ids: [30534071, 26946977, 30518805, 30511210], versions: DS1_WARM_KELVIN },
  /**
   * LUMINARIA ORNAMENTAL ISLAND 60 y 90W IP66 IK08 (Iluminación Exterior, no alumbrado
   * público). La Island 60W 4000K (2330766) está deshabilitada y no se publica.
   */
  island: { ids: [2767982, 10796623], versions: DS1_WARM_KELVIN },
  /**
   * PROYECTOR LED SLIM SMD 150, 200, 300, 400 y 500W IP66. La de 3000K no tiene certificado, y
   * los Slim de 30, 50 y 100W (2340468, 2340483, 2340625) tampoco.
   */
  slim: { ids: [2340515, 2340521, 2340383, 2340385, 2993067], versions: DS1_WARM_KELVIN },
  /** PAGODA LED SOLAR UFO 300W ALL IN ONE: la ámbar de 1600K y la cálida de 2700K. */
  pagoda: { ids: [27936170], versions: [1600, 2700] },
  /**
   * PROYECTOR LED DE ESTADIO MODULAR 100 a 1000W: las versiones de hasta 5000K (23-10-2026). Hoy
   * todas sus variantes lo son: cálida (de 2700K, o sin cifra en la de 800W), neutra de 4000K y
   * fría de 5000K.
   */
  estadioModular: {
    ids: [24657400, 24663380, 24669150, 24696340, 24696451, 24697125, 24698439, 32913027, 32913142],
    versions: { maxKelvin: DS1_SPORTS_MAX_KELVIN },
    sports: true,
  },
  /**
   * PROYECTOR LED DE ESTADIO 300, 500 y 600W y ESTADIO REDONDO 1000W: las versiones de hasta
   * 5000K (23-10-2026). La fría de 6000K de los de 300 y 500W no lo tiene, y el de 600W, que solo
   * se vende en 6000K, tampoco: su ficha ofrece asesoría.
   */
  estadio: { ids: [3313196, 3283555, 4450187, 3309140], versions: { maxKelvin: DS1_SPORTS_MAX_KELVIN }, sports: true },
};

/** Productos (id de Jumpseller) con certificado D.S. N°1: los de DS1_CERTIFIED_LINES. */
export const DS1_CERTIFIED_IDS: readonly number[] = Object.values(DS1_CERTIFIED_LINES).flatMap(line => line.ids);

/** La línea certificada de un producto (id de Jumpseller), con su clave; sin id o fuera de las líneas, undefined. */
export function ds1Line(jumpsellerId?: number): (Ds1Line & { key: Ds1LineKey }) | undefined {
  if (jumpsellerId === undefined) return undefined;
  const entry = (Object.entries(DS1_CERTIFIED_LINES) as [Ds1LineKey, Ds1Line][]).find(([, line]) => line.ids.includes(jumpsellerId));
  return entry && { ...entry[1], key: entry[0] };
}

/** ¿El producto tiene certificado D.S. N°1, en alguna de sus versiones? */
export function isDs1Certified(jumpsellerId?: number): boolean {
  return ds1Line(jumpsellerId) !== undefined;
}

/**
 * ¿La versión de esa temperatura de color (K) del producto tiene certificado D.S. N°1? En los
 * proyectores de estadio, las de hasta 5000K; en las demás líneas, solo las de su lista; fuera de
 * las líneas, ninguna.
 */
export function isDs1CertifiedKelvin(jumpsellerId: number | undefined, kelvin: number): boolean {
  const versions = ds1Line(jumpsellerId)?.versions;
  return versions !== undefined && ds1CoversKelvin(versions, kelvin);
}

/**
 * Qué certificado D.S. N°1 respalda la ficha SEO (content/<id>.json) de un producto: las
 * versiones certificadas de su línea; si no es de una línea certificada, o sin id, ninguno.
 */
export function ds1Certificate(jumpsellerId?: number): Ds1Versions | false {
  return ds1Line(jumpsellerId)?.versions ?? false;
}

/**
 * «D.S. N°1», «D.S. 1/2022», «DS1», «DS 01:2022», «DS-1», «Decreto Supremo N°1», «Decreto 1»
 * (no «DS 13» ni «decreto 10»).
 */
const DS1_TOKEN = String.raw`(?:D\.\s?S\.|\bDS)\s?-?\s?(?:N[°º]\.?\s?)?0?1(?!\d)|decreto\s+(?:supremo\s+)?(?:N[°º]\.?\s?)?0?1(?!\d)`;
/** La sigla sin puntos («DS1», «DS 01:2022»): el sitio escribe «D.S. N°1/2022». */
const DS1_ABBREVIATION = /\bDS\s?-?\s?0?1(?!\d)/i;
const DS43 = /(?:D\.\s?S\.|\bDS)\s?-?\s?(?:N[°º]\.?\s?)?43(?!\d)|decreto\s+(?:supremo\s+)?(?:N[°º]\.?\s?)?43(?!\d)/i;
/** Lo que dice que el D.S. N°43 ya no rige. */
const REPEALED = /derog|sin efecto/i;
/**
 * Mención de la norma: el decreto, su nombre («luminosidad artificial»), la contaminación o la
 * norma(tiva) lumínica, los «cielos oscuros» y las Áreas de Protección Especial (la fórmula del
 * mercado: «apta para Áreas de Protección Especial»).
 */
const NORM = new RegExp(
  String.raw`${DS1_TOKEN}|contaminaci[oó]n\s+lum[ií]nica|norma(?:tiva)?\s+lum[ií]nica|cielos?\s+oscuros?|luminosidad\s+artificial|[aá]reas?\s+de\s+protecci[oó]n\s+especial`,
  'iu',
);
/**
 * Palabras que, junto a la norma en la misma oración, afirman que el producto la cumple:
 * «certificado DS1», «certificación SEC y DS1», «cumple el D.S. N°1», «aprobación de
 * contaminación lumínica», «sellos SEC y DS1», «versiones DS1», «marcadas como DS1».
 */
const CLAIM =
  /certific|\bcumplen?\b|\baprob|\bhomolog|\bsellos?\b|\bapt[oa]s?\b|(?:marcad|indicad|declarad)[oa]s?\s+como|figuran?\s+como|\bversi(?:[oó]n|ones)\s+(?:\p{L}+\s+)?(?:D\.\s?S\.|DS)/iu;
const BLUE_LIGHT = /luz\s+azul/i;
/** Una cifra en porcentaje («1%», «7 %», «un 1%»). */
const PERCENT = /\d(?:[.,]\d+)?\s?%/;
const SPORTS = /\b(?:multi)?canchas?\b|\bestadios?\b|recintos?\s+deportivos?|alumbrado\s+deportivo|\bgimnasios?\b/i;
/** Temperatura de color escrita en el texto: «2200K», «2.700 K», «4000 kelvin». */
const KELVIN = /(?<![\d.,])(\d{1,2}\.?\d{3})\s?(?:[Kk](?![\p{L}\p{N}])|[Kk]elvin)/gu;
/**
 * Una temperatura de color sin la «K» («la de 3000», «2.700»): una cifra redonda de cuatro
 * dígitos (1000 a 9900) sin otra unidad. No toma el año de la norma («N°1/2022», «DS 01:2022»),
 * fechas («19-10-2026»), montos ni cifras más largas («10.000 lm»).
 */
const BARE_KELVIN =
  /(?<![\d.,/:°º$-])(\d\.?\d00)(?![\d.,]|\s?(?:[Kk]elvin|[Kk]|lm|l[uú]menes|kW|W|watts?|V|mm|cm|m²|m2|mts?|metros|m|horas|hrs?|h|kg|mAh|Ah|lux|°|º|%)(?![\p{L}\p{N}]))/gu;
/**
 * Versiones sin certificado nombradas por su tono, sin la cifra: «la fría», «el frío», «las
 * neutras», «el blanco frío», «la luz natural», «la luz de día», «la blanca». En las líneas
 * certificadas por versión, el certificado es de las cálidas (o de la ámbar de 1600K y la de
 * 2700K, en la Pagoda), nunca de estas. En los proyectores de estadio, la neutra de 4000K y la
 * fría de 5000K sí lo tienen: ahí el tono pasa solo seguido de una temperatura certificada
 * (TONE_KELVIN).
 */
const UNCERTIFIED_TONE =
  /(?<![\p{L}\p{N}])(?:fr[ií][oa]s?|neutr[oa]s?|(?:blanco|tono|color)\s+(?:fr[ií]o|neutro|natural)|(?:luz|blanca|la|las|versi[oó]n|versiones)\s+naturale?s?|luz\s+(?:de\s+)?d[ií]a|luz\s+diurna|(?:la|las|el|los)\s+blanc[oa]s?(?!\s+(?:c[aá]lid|fr[ií]|neutr|natural)))(?![\p{L}\p{N}])/giu;
/** La temperatura de color que sigue a un tono: «la fría de 5000K», «neutra (4000K)», «fría - 5000K». */
const TONE_KELVIN = /^\s*(?:de\s+|\(\s*|[-–]\s*)?(\d{1,2}\.?\d{3})\s?(?:[Kk](?![\p{L}\p{N}])|[Kk]elvin)/u;
const kelvinValue = (digits: string) => Number(digits.replace('.', ''));
/** Temperaturas de color de una oración, con «K» o sin ella. */
const kelvinIn = (sentence: string): number[] => [...sentence.matchAll(KELVIN), ...sentence.matchAll(BARE_KELVIN)].map(m => kelvinValue(m[1]));
/**
 * Lo que una oración nombra de versiones sin certificado: sus temperaturas («3000K») y sus tonos
 * («la fría»). Solo en una línea con tope de temperatura (los proyectores de estadio) pasa un
 * tono seguido de una temperatura certificada («la fría de 5000K»); en las líneas certificadas
 * por versión, un tono frío o neutro con una temperatura cálida («la fría de 2700K») es un error
 * de redacción y se marca.
 */
function uncertifiedVersions(sentence: string, versions: Ds1Versions): string[] {
  const others = kelvinIn(sentence)
    .filter(k => !ds1CoversKelvin(versions, k))
    .map(k => `${k}K`);
  const tones = [...sentence.matchAll(UNCERTIFIED_TONE)]
    .filter(m => {
      if (!('maxKelvin' in versions)) return true;
      const kelvin = sentence.slice((m.index ?? 0) + m[0].length).match(TONE_KELVIN);
      return !kelvin || !ds1CoversKelvin(versions, kelvinValue(kelvin[1]));
    })
    .map(m => m[0].toLowerCase());
  return [...new Set([...others, ...tones])];
}
/**
 * Sin nombrar la norma, una oración que extiende el certificado a otra versión: «la de 3000K
 * también lo tiene», «la versión de 4000K está certificada», «tiene el mismo certificado». La
 * certificación SEC (u otra con su sigla) no cuenta.
 */
const CERTIFICATE_REFERENCE =
  /\bcertificad[oa]s?\b(?!\s+(?:por\s+(?:la\s+)?)?(?:SEC|Superintendencia|CE|RoHS|ISO|CB|UL|ETL)\b)|\bmismo\s+certificado\b|\bl[oa]s?\s+tienen?\b/iu;
/** Una negación: «no lo tienen», «sin certificado», «ni la fría». */
const NEGATION = /(?<![\p{L}\p{N}])(?:no|sin|ni)(?![\p{L}\p{N}])/iu;
const VERSION_NOUNS = String.raw`(?:versiones|variantes|temperaturas|tonos|colores)`;
/**
 * El certificado para todas las versiones: «todas sus versiones», «cualquier temperatura», «ambas
 * versiones», «sus dos versiones», «las cuatro variantes».
 */
const ALL_VARIANTS = new RegExp(
  String.raw`\btod[oa]s\s+(?:sus\s+|las\s+|los\s+)?(?:\p{L}+\s+)?${VERSION_NOUNS}\b|\bcualquier(?:a\s+de\s+sus)?\s+(?:versi[oó]n|variante|temperatura|tono|color)|\bamb[oa]s\s+(?:sus\s+|las\s+|los\s+)?${VERSION_NOUNS}\b|\b(?:sus|las|los)\s+(?:dos|tres|cuatro|cinco)\s+${VERSION_NOUNS}\b`,
  'iu',
);
/** Otra versión, sin nombrarla: «igual que la otra versión», «y las otras». */
const OTHER_VARIANT =
  /(?<![\p{L}\p{N}])(?:la|las|el|los|su|sus)\s+otr[oa]s?(?:\s+(?:versi[oó]n|versiones|variantes?|temperaturas?|tonos?|colores?))?(?![\p{L}\p{N}])/iu;
/**
 * Una oración que sigue a la del certificado y lo extiende a otra versión sin decir
 * «certificado»: «La de 6000K, también.», «Lo mismo vale para la fría.», «Igual que la otra».
 */
const ALSO = /(?:tambi[eé]n|igual(?:mente)?)\s*[.!]?$|(?<![\p{L}\p{N}])(?:lo\s+mismo|igual\s+que|al\s+igual|asimismo)(?![\p{L}\p{N}])/iu;

/** «Apta también para las Áreas de Protección Especial», «certificada para APE»: la clasificación del certificado. */
const APE_FIT = /\b(?:apt|certificad|clasificad|homologad)[oa]s?\s+(?:\p{L}+\s+)?(?:para|en)\s+(?:las?\s+)?(?:[aá]reas?\s+de\s+protecci[oó]n\s+especial|APE)\b/iu;

/**
 * Oraciones de un texto. No corta en «D.S.» ni en el «D.» de «D. S.»; los subtítulos («**…**»)
 * y las líneas van solos.
 */
export function sentences(text: string): string[] {
  return text
    .replace(/\*\*/g, '')
    .split(/\n+|(?<=[.!?])(?<!\bD\.)(?<!\bD\.\s?S\.)\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Qué certificado D.S. N°1 respalda un texto:
 * - false: ninguno. El texto no lo afirma ni usa la sigla «DS1».
 * - las temperaturas de color de una línea certificada (su ficha SEO): cada oración que afirma
 *   el certificado nombra una de esas versiones, y ninguna otra temperatura ni «todas sus
 *   versiones».
 * - { maxKelvin }: una línea certificada hasta un tope (los proyectores de estadio, hasta 5000K
 *   desde el 23-10-2026): cada oración que afirma el certificado nombra una versión de hasta ese
 *   tope, y ninguna de más ni «todas sus versiones». Que el producto tenga esas versiones lo
 *   revisa ds1VariantIssues, con sus variantes.
 * - true: un texto ya aprobado por el dueño (la ficha editorial de las BESTLED, que reparte las
 *   variantes en varias oraciones, y las oraciones aprobadas de una introducción de categoría).
 * Fuera de un texto aprobado, la norma va como «D.S. N°1/2022», sin la sigla, y sin la
 * clasificación para Áreas de Protección Especial.
 */
export type Ds1Certificate = boolean | Ds1Versions;

export interface Ds1Options {
  certified: Ds1Certificate;
}

/** «2200K y 2700K», «1600K y 2700K». */
const kelvinList = (kelvin: readonly number[]) => kelvin.map(k => `${k}K`).join(', ').replace(/, ([^,]*)$/, ' y $1');
/** «solo las de 2200K y 2700K», «solo las de hasta 5000K». */
const onlyVersions = (versions: Ds1Versions) =>
  'maxKelvin' in versions ? `solo las de hasta ${versions.maxKelvin}K` : `solo las de ${kelvinList(versions)}`;

/**
 * Lo que falla en una oración que afirma el certificado de un producto certificado solo en
 * algunas versiones: no dice de cuáles (salvo una pregunta, «¿Qué versiones tienen
 * certificado…?», que responde lo que sigue: lo revisa ds1Issues), nombra otra versión (por su
 * temperatura, con o sin «K», o por su tono: «la fría», «la neutra»), lo extiende a todas
 * («todas sus versiones», «ambas versiones») o a otra sin nombrarla («igual que la otra versión»).
 */
function versionsIssue(sentence: string, versions: Ds1Versions): string | null {
  const named = kelvinIn(sentence);
  const others = uncertifiedVersions(sentence, versions);
  const only = onlyVersions(versions);
  if (!sentence.endsWith('?') && !named.some(k => ds1CoversKelvin(versions, k))) return `sin decir de qué versiones (${only})`;
  if (others.length) return `junto a una versión sin certificado (${others.join(', ')}; ${only})`;
  if (ALL_VARIANTS.test(sentence)) return `de todas las versiones (${only})`;
  if (OTHER_VARIANT.test(sentence)) return `también en otra versión, sin nombrarla (${only})`;
  return null;
}

/** Sin nombrar la norma, ¿la oración dice que una versión tiene el certificado? («también lo tiene», «está certificada»). */
const extendsCertificate = (sentence: string) => !sentence.endsWith('?') && !NEGATION.test(sentence) && CERTIFICATE_REFERENCE.test(sentence);

/**
 * Qué hace cada oración de un texto (un bloque de la ficha) con el certificado D.S. N°1:
 * - claim: lo afirma (nombra la norma junto a «certificado», «cumple»…); question, si es una
 *   pregunta («¿Qué versiones tienen certificado D.S. N°1/2022?»).
 * - answer: responde esa pregunta (las oraciones que la siguen en el bloque, hasta la próxima
 *   pregunta).
 * - extension: sin nombrar la norma, dice que una versión lo tiene («también lo tiene», «está
 *   certificada»), o sigue a una oración del certificado y lo extiende («La de 6000K, también.»,
 *   «Lo mismo vale para la fría.»).
 * Con una negación, una respuesta o una extensión dice cuáles no lo tienen: no extiende nada.
 */
type CertificateRole = 'claim' | 'question' | 'answer' | 'extension' | undefined;

function certificateRoles(list: readonly string[]): CertificateRole[] {
  let answering = false;
  let previous: CertificateRole;
  return list.map(s => {
    let role: CertificateRole;
    if (NORM.test(s) && CLAIM.test(s)) role = s.endsWith('?') ? 'question' : 'claim';
    else if (s.endsWith('?')) role = undefined;
    else if (answering) role = 'answer';
    else if (extendsCertificate(s) || (previous !== undefined && ALSO.test(s) && !NEGATION.test(s))) role = 'extension';
    if (s.endsWith('?')) answering = role === 'question';
    previous = role;
    return role;
  });
}

/**
 * Lo que falla en una oración que no nombra la norma pero extiende el certificado (una
 * respuesta a la pregunta del certificado, «también lo tiene», «La de 6000K, también.»): a una
 * versión sin certificado, a todas o a otra sin nombrarla. Decir cuáles no lo tienen («La de
 * 3000K y la fría no lo tienen») y preguntarlo están bien.
 */
function continuationIssue(sentence: string, role: CertificateRole, versions: Ds1Versions): string | null {
  if ((role !== 'answer' && role !== 'extension') || NEGATION.test(sentence)) return null;
  const only = onlyVersions(versions);
  const others = uncertifiedVersions(sentence, versions);
  if (others.length) return `extiende el certificado D.S. N°1 a una versión sin certificado (${others.join(', ')}; ${only})`;
  if (ALL_VARIANTS.test(sentence)) return `extiende el certificado D.S. N°1 a todas las versiones (${only})`;
  if (OTHER_VARIANT.test(sentence)) return `extiende el certificado D.S. N°1 a otra versión, sin nombrarla (${only})`;
  return null;
}

/**
 * Afirmaciones normativas que el sitio no puede hacer, oración por oración: el D.S. N°43 como
 * vigente, el certificado D.S. N°1 de un producto sin certificado (también con la sigla «DS1»
 * como sello) o de una versión sin certificado (también en la respuesta a una pregunta por el
 * certificado, o en la oración que sigue con «también»), la clasificación para Áreas de
 * Protección Especial fuera de un texto aprobado y la luz azul junto a canchas o recintos
 * deportivos. Una pregunta por el certificado se puede responder en lo que sigue del texto (en
 * una ficha SEO, cada bloque por separado: ds1ContentIssues), pero esa respuesta nombra una
 * versión certificada.
 */
export function ds1Issues(text: string, { certified }: Ds1Options): string[] {
  const issues: string[] = [];
  const list = sentences(text);
  const roles = typeof certified === 'object' ? certificateRoles(list) : [];
  list.forEach((s, i) => {
    const short = s.length > 140 ? `${s.slice(0, 140)}…` : s;
    const claim = NORM.test(s) && CLAIM.test(s);
    if (DS43.test(s) && !REPEALED.test(s)) issues.push(`cita el D.S. N°43 (sin efecto desde el 19-10-2024): "${short}"`);
    if (!certified && claim) issues.push(`afirma el D.S. N°1 sin certificado documentado: "${short}"`);
    if (typeof certified === 'object' && claim) {
      const issue = versionsIssue(s, certified);
      if (issue) issues.push(`afirma el D.S. N°1 ${issue}: "${short}"`);
    }
    if (typeof certified === 'object' && roles[i] === 'question') {
      const answer: string[] = [];
      for (let j = i + 1; j < list.length && roles[j] !== undefined && roles[j] !== 'question'; j++) answer.push(list[j]);
      if (answer.length && !answer.some(a => kelvinIn(a).some(k => ds1CoversKelvin(certified, k)))) {
        issues.push(`afirma el D.S. N°1 en una pregunta cuya respuesta no dice de qué versiones (${onlyVersions(certified)}): "${short}"`);
      }
    }
    if (typeof certified === 'object' && !claim) {
      const issue = continuationIssue(s, roles[i], certified);
      if (issue) issues.push(`${issue}: "${short}"`);
    }
    if (certified && certified !== true && APE_FIT.test(s)) {
      issues.push(`afirma la clasificación para Áreas de Protección Especial (documentada solo en las BESTLED): "${short}"`);
    }
    if (certified !== true && DS1_ABBREVIATION.test(s)) issues.push(`usa la sigla «DS1» como sello (va «D.S. N°1/2022»): "${short}"`);
    if (BLUE_LIGHT.test(s) && SPORTS.test(s)) issues.push(`aplica la luz azul a canchas o recintos deportivos (se rigen por temperatura de color): "${short}"`);
  });
  return issues;
}

/**
 * Un bloque de una ficha SEO (una pregunta frecuente con su respuesta, una sección de la
 * descripción con su subtítulo, un beneficio) que nombra la norma no da el «% de luz azul» del
 * producto: el 1 % y el 7 % son los límites del art. 5, y juntos se leen como que el porcentaje
 * es lo que la cumple (lo único que la acredita es el certificado). El dato puede ir en otro
 * bloque (decisión del dueño); junto a la norma va el certificado o la asesoría.
 */
export function normBlueLightIssue(block: string): string | null {
  const norm = block.match(NORM);
  if (!norm || !BLUE_LIGHT.test(block) || !PERCENT.test(block)) return null;
  const short = block.length > 100 ? `${block.slice(0, 100)}…` : block;
  return `da el % de luz azul junto a la norma («${norm[0]}»), y se lee como que la cumple: "${short}"`;
}

/**
 * Ficha SEO de un producto para canchas o recintos deportivos: no habla de luz azul en ninguna
 * parte (la norma los regula por temperatura de color según la clase del recinto, art. 7).
 */
export function sportsBlueLightIssue(text: string): string | null {
  const sports = text.match(SPORTS);
  const blue = text.match(BLUE_LIGHT);
  return sports && blue ? `menciona la luz azul en una ficha de canchas o recintos deportivos ("${sports[0]}" y "${blue[0]}")` : null;
}

/** Un texto con subtítulos «**…**» en una línea, en secciones: cada subtítulo con sus párrafos. */
const sections = (text: string): string[] =>
  text
    .split(/\n+(?=\*\*[^*\n]+\*\*\s*(?:\n|$))/)
    .map(s => s.trim())
    .filter(Boolean);

/**
 * Bloques de una ficha SEO que se leen juntos: el título y la descripción para buscadores, cada
 * sección de la descripción y de la instalación, cada beneficio y uso, y cada pregunta frecuente
 * con su respuesta.
 */
export function contentBlocks(c: ProductContent): string[] {
  return [
    c.metaTitle,
    c.metaDescription,
    ...sections(c.description),
    ...(c.installationInfo ? sections(c.installationInfo) : []),
    ...c.keyBenefits,
    ...c.useCases,
    ...c.faq.map(f => `${f.question}\n${f.answer}`),
  ];
}

/**
 * Las reglas del D.S. N°1/2022 sobre la ficha SEO (content/<id>.json) de un producto que no
 * dependen de Jumpseller: si es de una línea certificada (DS1_CERTIFIED_LINES), el certificado
 * solo en sus versiones certificadas (en los estadios, las de hasta 5000K); si no, o sin id,
 * ningún certificado. En los proyectores de recintos deportivos (las líneas de estadio), nada de
 * luz azul, aunque el texto no nombre la cancha. Que un estadio tenga de verdad la versión que
 * nombra lo revisa ds1VariantIssues, con sus variantes.
 */
export function ds1ContentIssues(c: ProductContent, jumpsellerId?: number): string[] {
  const blocks = contentBlocks(c);
  const text = blocks.join('\n');
  const line = ds1Line(jumpsellerId);
  const blue = text.match(BLUE_LIGHT);
  const sports =
    sportsBlueLightIssue(text) ??
    (line?.sports && blue ? `menciona la luz azul ("${blue[0]}") en la ficha de un proyector de recintos deportivos (se rigen por temperatura de color)` : null);
  return [
    // Bloque por bloque: la respuesta a una pregunta por el certificado es la de su pregunta frecuente
    ...blocks.flatMap(b => ds1Issues(b, { certified: line?.versions ?? false })),
    ...(sports ? [sports] : []),
    ...blocks.flatMap(b => normBlueLightIssue(b) ?? []),
  ];
}

/** Una versión cálida o ámbar que Jumpseller nombra sin su temperatura («Luz Cálida - 1% Luz Azul»). */
const WARM_OPTION = /c[aá]lid|[aá]mbar/i;

/**
 * El certificado D.S. N°1 de un proyector de estadio (línea con tope de temperatura de color),
 * contra sus versiones reales: las opciones de sus variantes en Jumpseller («Color de Luz: Luz
 * fría - 5000K»; ProductFacts.variantOptions). Cada oración que afirma el certificado, que
 * responde la pregunta por el certificado o que sin nombrar la norma dice que una versión lo
 * tiene («también lo tiene», «La de 4000K, también.») nombra solo versiones de hasta el tope que
 * el producto tiene; si no tiene ninguna (el estadio de 600W, solo en 6000K), la ficha no lo
 * afirma y ofrece asesoría. Una cálida sin cifra («Luz Cálida - 1% Luz Azul», en el modular de
 * 800W) cuenta como versión de hasta el tope. Lo que no depende de las variantes (el tope, «todas
 * sus versiones», la luz azul) lo revisa ds1ContentIssues; en las demás líneas, nada que agregar.
 */
export function ds1VariantIssues(c: ProductContent, jumpsellerId: number | undefined, variantOptions: readonly string[]): string[] {
  const versions = ds1Line(jumpsellerId)?.versions;
  if (!versions || !('maxKelvin' in versions)) return [];
  const max = versions.maxKelvin;
  const kelvin = [...new Set(variantOptions.flatMap(o => [...o.matchAll(KELVIN)].map(m => kelvinValue(m[1]))))].sort((a, b) => a - b);
  const own = kelvin.filter(k => k <= max);
  const warmWithoutKelvin = variantOptions.some(o => WARM_OPTION.test(o) && !o.match(KELVIN));
  const variants = kelvin.length ? `sus variantes: ${kelvinList(kelvin)}` : 'sus variantes no dicen su temperatura de color';
  const issues: string[] = [];
  for (const block of contentBlocks(c)) {
    const list = sentences(block);
    const roles = certificateRoles(list);
    list.forEach((s, i) => {
      const role = roles[i];
      const claim = role === 'claim' || role === 'question';
      // Una respuesta o una extensión con una negación dice cuáles no lo tienen
      if (!role || (!claim && NEGATION.test(s))) return;
      const short = s.length > 140 ? `${s.slice(0, 140)}…` : s;
      if (claim && !own.length && !warmWithoutKelvin) {
        issues.push(`afirma el D.S. N°1, pero el producto no tiene versiones de hasta ${max}K (${variants}): su ficha ofrece asesoría: "${short}"`);
        return;
      }
      const missing = [...new Set(kelvinIn(s).filter(k => k <= max && !own.includes(k)))];
      if (missing.length) {
        issues.push(`afirma el D.S. N°1 en una versión que el producto no tiene (${kelvinList(missing)}; ${variants}): "${short}"`);
      }
    });
  }
  return issues;
}
