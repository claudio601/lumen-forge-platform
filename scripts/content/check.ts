// scripts/content/check.ts
// Verifica el contenido SEO de un producto (src/data/catalog/content/<id>.json):
//   - formato y largos del formato BESTLED (lo que la ficha sabe mostrar),
//   - reglas del sitio (sin stock, sin precios, despacho solo "hasta 2 días hábiles",
//     sin promesas como "gratis" o "mismo día"),
//   - que no invente datos: cada cifra con su unidad (W, lm, K, V, h, años, mm, °, %, A…)
//     tiene que estar en los datos de Jumpseller del producto con esa misma unidad (o en
//     una fila cuya etiqueta la implica, como "Garantía" o "Alto (mm)"); lo mismo cada
//     certificación, grado IP/IK y marca de componentes (facts.ts).
// Cada función devuelve la lista de problemas (vacía si está bien). Formato y reglas no
// dependen de Jumpseller (los verifica content.test.ts); los datos sí, así que la
// sincronización los revisa a diario y avisa en su informe sin bloquear precios.

import type { ProductContent } from '../../src/data/catalog/types';
import { findRuleBreaking } from '../jumpseller/descriptions';
import { factsText, type ProductFacts } from './facts';

const NUM = String.raw`\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?`;
const UNIT = String.raw`lm\s*\/\s*w|l[uú]menes|lm|kw|watts?|vatios|w|kelvin|k|vac|vdc|voltios|v|hz|horas|hrs?\.?|h|años?|mm|cm|m²|m2|metros|mts?\.?|m|kg|kilos|°c|ºc|°|º|%|mah|ma|ah|amperes?`;
/** Cifra (o rango "100 a 277", o "50 mil") seguida de su unidad. "IP66 y 3 años" no es un rango. */
const CLAIM = new RegExp(String.raw`(${NUM})(?:\s*(?:-|–|~|a|\/)\s*(${NUM}))?(\s*mil)?\s*(${UNIT})(?![a-záéíóúñ0-9])`, 'gi');
/** "entre 100 y 240V": las dos cifras llevan la unidad. */
const BETWEEN = new RegExp(String.raw`entre\s+(${NUM})\s+y\s+(${NUM})(\s*mil)?\s*(${UNIT})(?![a-záéíóúñ0-9])`, 'gi');
/** Medidas "390 x 120 mm", "Ø290*H85 mm" o "62 x 31,5 x 24 cm": todas las cifras llevan la unidad. */
const DIMENSIONS = new RegExp(
  String.raw`(?:[ØHLA]\s*)?(${NUM})\s*[x×X*]\s*(?:[ØHLA]\s*)?(${NUM})(?:\s*[x×X*]\s*(?:[ØHLA]\s*)?(${NUM}))?\s*(mm|cm|mts?\.?|m)(?![a-záéíóúñ0-9])`,
  'gi',
);
/** Formato sin unidad en el nombre ("Panel 60x60", "Marco 120x30"): en este catálogo son centímetros. */
const FORMAT = new RegExp(String.raw`(?<![\d.,])(${NUM})\s*[xX×]\s*(${NUM})(?![\d.,]*\s*[xX×*\d])(?!\s*(?:mm|cm|m)\b)`, 'g');
/** Amperes: solo con "A" mayúscula ("8,5A"), para no confundir la preposición "a". */
const AMPS = new RegExp(String.raw`(${NUM})\s?A(?![A-Za-z])`, 'g');
const BARE_NUM = new RegExp(String.raw`(?<![\d.,])(${NUM})(?![\d.,]*\s*(?:${UNIT})(?![a-záéíóúñ0-9]))`, 'gi');
/** Certificaciones, normas y grados de protección (con mayúsculas exactas; los códigos se normalizan antes). */
const CERT = /\b(?:SEC|CE|RoHS|UL|ETL|DS1|ATEX|IECEx|TÜV|ENEC|FCC|EMC|VDE|NOM|(?:IEC|EN)\d{4,5}(?:-\d+)*|IPX?\d{1,2}|IK\d{2})\b/g;
/**
 * Marcas de componentes que no se pueden atribuir si Jumpseller no las nombra. Con su
 * escritura habitual (no "cree", el verbo): "Cree" solo seguido de una serie de LED.
 */
const BRANDS = /\b(?:Philips|PHILIPS|Lumileds|LUMILEDS|Mean ?Well|MEAN ?WELL|Meanwell|MEANWELL|Bridgelux|BRIDGELUX|Osram|OSRAM|Samsung|SAMSUNG|CREE|Cree(?= (?:XP|XM|XL|XT|XH|J |LED))|Epistar|EPISTAR|Nichia|NICHIA|Seoul Semiconductor|Inventronics|INVENTRONICS|Sosen|SOSEN|MOSO|Tridonic|TRIDONIC|Lifud|LIFUD|Segurimax|SEGURIMAX|JIE|Bestled|BESTLED|SunPower|LONGi|Longi)\b/g;

/** Clase de cada unidad: "hrs." y "horas" son lo mismo; "W" y "lm" no. */
const UNIT_CLASS: [RegExp, string][] = [
  [/^lm\s*\/\s*w$/i, 'lm/W'],
  [/^(?:l[uú]menes|lm)$/i, 'lm'],
  [/^kw$/i, 'kW'],
  [/^(?:watts?|vatios|w)$/i, 'W'],
  [/^(?:kelvin|k)$/i, 'K'],
  [/^(?:vac|vdc|voltios|v)$/i, 'V'],
  [/^hz$/i, 'Hz'],
  [/^(?:horas|hrs?\.?|h)$/i, 'h'],
  [/^años?$/i, 'año'],
  [/^mm$/i, 'mm'],
  [/^cm$/i, 'cm'],
  [/^(?:m²|m2)$/i, 'm²'],
  [/^(?:metros|mts?\.?|m)$/i, 'm'],
  [/^(?:kg|kilos)$/i, 'kg'],
  [/^(?:°c|ºc|°|º)$/i, '°'],
  [/^%$/, '%'],
  [/^mah$/i, 'mAh'],
  [/^ma$/i, 'mA'],
  [/^ah$/i, 'Ah'],
  [/^(?:amperes?|A)$/, 'A'],
];
const unitClass = (u: string) => UNIT_CLASS.find(([re]) => re.test(u.trim()))?.[1] ?? u.toLowerCase();

/** Unidad implícita de una fila sin unidad en el valor: "Alto (mm)", "Garantía", "Temperatura de operación"… */
const LABEL_UNIT: [RegExp, string][] = [
  [/\((?:mm\.?)\)/i, 'mm'],
  [/\((?:cm\.?)\)/i, 'cm'],
  [/\((?:hrs?\.?|horas)\)/i, 'h'],
  [/\((?:°k|k)\)/i, 'K'],
  [/\((?:°c|t°)\)/i, '°'],
  [/temperatura de color|temperatura color/i, 'K'],
  [/temperatura/i, '°'],
  [/eficacia/i, 'lm/W'],
  [/flujo/i, 'lm'],
  [/potencia|consumo/i, 'W'],
  [/tensi[oó]n|voltaje/i, 'V'],
  [/frecuencia/i, 'Hz'],
  [/vida [uú]til|autonom[ií]a|tiempo de/i, 'h'],
  [/garant[ií]a/i, 'año'],
  [/peso/i, 'kg'],
  [/[aá]ngulo/i, '°'],
];
const FORBIDDEN: [RegExp, string][] = [
  [/gratis|gratuit[oa]s?/i, 'promete algo gratis'],
  [/\bmismo d[ií]a\b/i, 'promete despacho el mismo día'],
  [/mejor precio|precios? (?:bajos?|competitivos?|imbatibles?)|m[aá]s barat|oferta|descuento|liquidaci[oó]n|promoci[oó]n/i, 'habla de precios u ofertas'],
  [/de por vida/i, 'garantía de por vida'],
  [/\bn[°º]\s?1\b|n[uú]mero uno|l[ií]der (?:del|en el) mercado/i, 'se declara líder'],
  [/24\/7/, 'promete atención 24/7'],
  [/checkout|carrito/i, 'menciona checkout o carrito (el sitio cotiza)'],
  [/https?:\/\/|www\./i, 'trae URLs'],
  [/<[a-z/]/i, 'trae HTML'],
  [/^#{1,6}\s/m, 'usa títulos markdown con # (la ficha usa **Subtítulo**)'],
];

/** Valor de una cifra escrita en Chile: "22.500" → 22500 (punto de miles); "0,95" → 0.95. */
const value = (token: string) => Number(/^\d{1,3}(?:\.\d{3})+$/.test(token) ? token.replace(/\./g, '') : token.replace(',', '.'));

/** "IP 66", "ip-66", "IP66" → "IP66"; "IEC 60598" → "IEC60598". */
const normalizeCodes = (s: string) =>
  s.replace(/\b(ip|ik)[\s-]?(x?\d{1,2})\b/gi, (_, a: string, b: string) => `${a.toUpperCase()}${b.toUpperCase()}`).replace(/\b(IEC|EN)\s+(\d)/g, '$1$2');

/** Cifras con unidad de un texto: "100-277V" → [100 V, 277 V]; "50 mil horas" → [50000 h]. */
function quantities(text: string): { raw: string; values: number[]; unit: string }[] {
  const out: { raw: string; values: number[]; unit: string }[] = [];
  for (const m of text.matchAll(CLAIM)) {
    const k = m[3] ? 1000 : 1;
    out.push({ raw: m[0].trim(), values: [m[1], m[2]].filter(Boolean).map(t => value(t!) * k), unit: unitClass(m[4]) });
  }
  for (const m of text.matchAll(BETWEEN)) {
    const k = m[3] ? 1000 : 1;
    out.push({ raw: m[0].trim(), values: [value(m[1]) * k, value(m[2]) * k], unit: unitClass(m[4]) });
  }
  for (const m of text.matchAll(AMPS)) out.push({ raw: m[0].trim(), values: [value(m[1])], unit: 'A' });
  return out;
}

/** Pares cifra-unidad de los datos, incluida la unidad implícita en la etiqueta de cada fila. */
function factQuantities(f: ProductFacts): Set<string> {
  const pairs = new Set<string>();
  const add = (v: number, unit: string) => pairs.add(`${v}|${unit}`);
  const text = normalizeCodes(factsText(f));
  for (const q of quantities(text)) for (const v of q.values) add(v, q.unit);
  for (const m of text.matchAll(DIMENSIONS)) for (const t of [m[1], m[2], m[3]]) if (t) add(value(t), unitClass(m[4]));
  for (const m of f.name.matchAll(FORMAT)) for (const t of [m[1], m[2]]) add(value(t), 'cm');
  for (const r of [...f.electricos, ...f.construccion, ...f.componentes]) {
    const unit = LABEL_UNIT.find(([re]) => re.test(r.label))?.[1];
    if (!unit) continue;
    for (const m of r.value.matchAll(BARE_NUM)) add(value(m[1]), unit);
  }
  return pairs;
}

function allText(c: ProductContent): string {
  return [c.metaTitle, c.metaDescription, c.description, ...c.keyBenefits, ...c.useCases, c.installationInfo ?? '', ...c.faq.flatMap(q => [q.question, q.answer])].join('\n');
}

function between(problems: string[], what: string, value: number, min: number, max: number) {
  if (value < min || value > max) problems.push(`${what}: ${value} (debe estar entre ${min} y ${max})`);
}

/** Formato y largos del formato BESTLED (lo que la ficha sabe mostrar). */
export function checkFormat(c: ProductContent): string[] {
  const problems: string[] = [];
  between(problems, 'metaTitle (caracteres)', c.metaTitle.length, 30, 65);
  if (!c.metaTitle.endsWith(' | eLIGHTS')) problems.push('metaTitle debe terminar en " | eLIGHTS"');
  between(problems, 'metaDescription (caracteres)', c.metaDescription.length, 110, 160);
  between(problems, 'description (caracteres)', c.description.length, 1200, 5000);
  const blocks = c.description.trim().split(/\n\n+/);
  const headings = blocks.filter(b => /^\*\*[^*]+\*\*$/.test(b.trim()));
  between(problems, 'description (subtítulos **…**)', headings.length, 2, 6);
  for (const b of blocks) {
    const lines = b.split('\n');
    if (lines.some(l => /^\s*[-*•]\s/.test(l)) && !lines.every(l => l.trim().startsWith('- '))) {
      problems.push('description: una lista tiene que ir sola en su bloque y cada línea empezar con "- "');
    }
  }
  between(problems, 'keyBenefits (cantidad)', c.keyBenefits.length, 4, 8);
  for (const b of c.keyBenefits) between(problems, `keyBenefits "${b.slice(0, 30)}…" (caracteres)`, b.length, 15, 160);
  between(problems, 'useCases (cantidad)', c.useCases.length, 3, 8);
  for (const u of c.useCases) between(problems, `useCases "${u.slice(0, 30)}…" (caracteres)`, u.length, 3, 90);
  between(problems, 'faq (cantidad)', c.faq.length, 3, 6);
  for (const q of c.faq) {
    if (!/^¿.+\?$/.test(q.question.trim())) problems.push(`faq: la pregunta "${q.question}" debe ir entre ¿ y ?`);
    between(problems, `faq "${q.question.slice(0, 30)}…" (caracteres de la respuesta)`, q.answer.length, 80, 800);
  }
  if (c.installationInfo !== undefined) between(problems, 'installationInfo (caracteres)', c.installationInfo.length, 100, 1800);
  return problems;
}

/** Reglas del sitio: sin stock, sin precios, despacho solo "hasta 2 días hábiles", sin promesas. */
export function checkRules(c: ProductContent): string[] {
  const problems: string[] = [];
  const text = allText(c);
  const rule = findRuleBreaking(text);
  if (rule) problems.push(`rompe una regla del sitio: "${rule}"`);
  for (const [re, why] of FORBIDDEN) {
    const m = text.match(re);
    if (m) problems.push(`${why}: "${m[0]}"`);
  }
  return problems;
}

/** Nada que no esté en Jumpseller: cifras con su unidad, certificaciones, grados IP/IK y marcas. */
export function checkFacts(c: ProductContent, f: ProductFacts): string[] {
  const problems: string[] = [];
  const text = normalizeCodes(allText(c));
  const facts = normalizeCodes(factsText(f));
  const known = factQuantities(f);
  for (const q of quantities(text)) {
    if (!q.values.every(v => known.has(`${v}|${q.unit}`))) problems.push(`cifra que no está en los datos de Jumpseller: "${q.raw}"`);
  }
  for (const m of text.matchAll(CERT)) {
    if (!new RegExp(String.raw`\b${m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`).test(facts)) {
      problems.push(`certificación o grado que no está en los datos de Jumpseller: "${m[0]}"`);
    }
  }
  const factsLower = facts.toLowerCase().replace(/meanwell/g, 'mean well');
  for (const m of text.matchAll(BRANDS)) {
    const brand = m[0].toLowerCase().replace(/meanwell/, 'mean well');
    if (!factsLower.includes(brand)) problems.push(`marca que no está en los datos de Jumpseller: "${m[0]}"`);
  }
  return [...new Set(problems)];
}

export function checkContent(c: ProductContent, f: ProductFacts): string[] {
  return [...checkFormat(c), ...checkRules(c), ...checkFacts(c, f)];
}

/** Oraciones largas repetidas en muchos productos (contenido duplicado: malo para SEO). */
export function repeatedSentences(contents: ReadonlyMap<number, ProductContent>, minProducts = 6): { sentence: string; ids: number[] }[] {
  const seen = new Map<string, Set<number>>();
  for (const [id, c] of contents) {
    for (const s of allText(c).split(/(?<=[.!?])\s+|\n+/)) {
      const key = s.trim();
      if (key.length < 60) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(id);
    }
  }
  return [...seen]
    .filter(([, ids]) => ids.size >= minProducts)
    .map(([sentence, ids]) => ({ sentence, ids: [...ids] }))
    .sort((a, b) => b.ids.length - a.ids.length);
}
