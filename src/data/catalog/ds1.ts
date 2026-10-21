// src/data/catalog/ds1.ts
// D.S. N°1/2022 del Ministerio del Medio Ambiente (contaminación lumínica) en el contenido
// propio del sitio: fichas SEO (content/*.json), overlay editorial (BESTLED) e introducciones
// de categoría (auditoría UX, entrega 4: D-04 y K-03). Lo usan content.test.ts (vía
// scripts/content/check.ts) y src/config/contentTruth.test.ts. Solo imports relativos: también
// lo importa scripts/.
//
// Reglas (decisiones del dueño del 17 y 18-10-2026, skill normativa-ds1-elights):
// - «Certificado D.S. N°1» solo para productos con certificado documentado en el repo: hoy, las
//   7 BESTLED (variantes 2200K y 2700K; overlay/editorial.ts, PR #78). Al resto no se le
//   afirma: se ofrece asesoría («¿Necesitas el D.S. N°1? Te asesoramos»).
// - El D.S. N°43/2012 quedó sin efecto el 19-10-2024 (art. 20 del D.S. N°1): nunca como vigente.
// - Canchas y recintos deportivos se rigen por temperatura de color según su clase (art. 7), no
//   por luz azul: el «% de luz azul» nunca va junto a ellos.
// - «2200K, 1 % de luz azul» como dato de producto sí se permite (pregunta 32 del informe).
// - En una ficha sin certificado, el «% de luz azul» no va en el mismo bloque (pregunta y
//   respuesta, sección de la descripción) que nombra la norma: juntos se leen como «cumple».
// No depende de datos de Jumpseller: solo de los textos que se le pasan.

import type { ProductContent } from './types';

/**
 * Productos (id de Jumpseller) con certificado D.S. N°1 documentado: las 7 BESTLED, en sus
 * variantes 2200K (clasificación para Áreas de Protección Especial) y 2700K (resto del país).
 * Para sumar otro, primero el certificado (modelo, temperaturas, apto o no para APE y ángulo
 * de montaje) y la decisión del dueño (pregunta 8 del informe UX).
 */
export const DS1_CERTIFIED_IDS: readonly number[] = [2301098, 2301101, 2301105, 2301110, 2301114, 4156930, 15021313];

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

export interface Ds1Options {
  /** El producto tiene certificado D.S. N°1 documentado (DS1_CERTIFIED_IDS). */
  certified: boolean;
}

/**
 * Afirmaciones normativas que el sitio no puede hacer, oración por oración: el D.S. N°43 como
 * vigente, el certificado D.S. N°1 de un producto sin certificado documentado (también con la
 * sigla «DS1» como sello) y la luz azul junto a canchas o recintos deportivos.
 */
export function ds1Issues(text: string, { certified }: Ds1Options): string[] {
  const issues: string[] = [];
  for (const s of sentences(text)) {
    const short = s.length > 140 ? `${s.slice(0, 140)}…` : s;
    if (DS43.test(s) && !REPEALED.test(s)) issues.push(`cita el D.S. N°43 (sin efecto desde el 19-10-2024): "${short}"`);
    if (!certified && NORM.test(s) && CLAIM.test(s)) issues.push(`afirma el D.S. N°1 sin certificado documentado: "${short}"`);
    if (!certified && DS1_ABBREVIATION.test(s)) issues.push(`usa la sigla «DS1» como sello (va «D.S. N°1/2022», sin afirmar certificado): "${short}"`);
    if (BLUE_LIGHT.test(s) && SPORTS.test(s)) issues.push(`aplica la luz azul a canchas o recintos deportivos (se rigen por temperatura de color): "${short}"`);
  }
  return issues;
}

/**
 * Un bloque de una ficha sin certificado (una pregunta frecuente con su respuesta, una sección
 * de la descripción con su subtítulo, un beneficio) que nombra la norma no da el «% de luz azul»
 * del producto: el 1 % y el 7 % son los límites del art. 5, y juntos se leen como «cumple». El
 * dato puede ir en otro bloque (decisión del dueño); junto a la norma va la asesoría.
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
 * Todas las reglas del D.S. N°1/2022 sobre una ficha SEO (content/*.json), que nunca es de un
 * producto con certificado documentado: esos usan su ficha editorial.
 */
export function ds1ContentIssues(c: ProductContent): string[] {
  const blocks = contentBlocks(c);
  const text = blocks.join('\n');
  const sports = sportsBlueLightIssue(text);
  return [
    ...ds1Issues(text, { certified: false }),
    ...(sports ? [sports] : []),
    ...blocks.flatMap(b => normBlueLightIssue(b) ?? []),
  ];
}
