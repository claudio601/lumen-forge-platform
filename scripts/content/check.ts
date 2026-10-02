// scripts/content/check.ts
// Verifica el contenido SEO de un producto (src/data/catalog/content/<id>.json):
//   - formato y largos del formato BESTLED (lo que la ficha sabe mostrar),
//   - reglas del sitio (sin stock, sin precios, despacho solo "hasta 2 días hábiles",
//     sin promesas como "gratis" o "mismo día"),
//   - que no invente datos: cada cifra con unidad (W, lm, K, V, h, años, mm, °, %…),
//     cada certificación o grado IP/IK y cada marca de componentes tiene que estar en
//     los datos de Jumpseller del producto (facts.ts).
// Cada función devuelve la lista de problemas (vacía si está bien). Formato y reglas no
// dependen de Jumpseller (los verifica content.test.ts); los datos sí, así que la
// sincronización los revisa a diario y avisa en su informe sin bloquear precios.

import type { ProductContent } from '../../src/data/catalog/types';
import { findRuleBreaking } from '../jumpseller/descriptions';
import { factsText, type ProductFacts } from './facts';

const NUM = String.raw`\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?`;
const UNIT = String.raw`lm\/w|l[uú]menes|lm|kw|watts?|vatios|w|kelvin|k|vac|vdc|voltios|v|hz|horas|hrs?\.?|h|años?|mm|cm|m²|m2|metros|mts?\.?|m|kg|kilos|°c|ºc|°|º|%|mah|ma|ah|amperes?`;
const CLAIM = new RegExp(String.raw`(${NUM})(?:\s*(?:-|–|~|a|y|\/)\s*(${NUM}))?\s*(?:${UNIT})(?![a-záéíóúñ0-9])`, 'gi');
const ANY_NUM = new RegExp(NUM, 'g');
/** Certificaciones, normas y grados de protección (con mayúsculas exactas). */
const CERT = /\b(?:SEC|CE|RoHS|UL|ETL|DS1|ATEX|IECEx|TÜV|ENEC|FCC|EMC|VDE|NOM|(?:IEC|EN)\s?\d{4,5}(?:-\d+)*|IP\s?\d{2}|IK\s?\d{2})\b/g;
/** Marcas de componentes que no se pueden atribuir si Jumpseller no las nombra. */
const BRANDS = /\b(?:philips|lumileds|mean ?well|bridgelux|osram|samsung|cree|epistar|nichia|seoul|inventronics|sosen|moso|tridonic|lifud|segurimax|jie|bestled|sunpower|longi)\b/gi;

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

/** Valores posibles de una cifra escrita: "22.500" → 22500 (o 22,5); "0,95" → 0.95. */
function values(token: string): number[] {
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) return [Number(token.replace(/\./g, '')), Number(token)];
  return [Number(token.replace(',', '.'))];
}

const normalizeCodes = (s: string) => s.replace(/\b(IP|IK|IEC|EN)\s+(\d)/g, '$1$2');

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

/** Nada que no esté en Jumpseller: cifras con unidad, certificaciones, grados IP/IK y marcas. */
export function checkFacts(c: ProductContent, f: ProductFacts): string[] {
  const problems: string[] = [];
  const text = allText(c);
  const facts = normalizeCodes(factsText(f));
  const factValues = new Set([...facts.matchAll(ANY_NUM)].flatMap(m => values(m[0])));
  for (const m of text.matchAll(CLAIM)) {
    const ok = [m[1], m[2]].filter(Boolean).every(t => values(t!).some(v => factValues.has(v)));
    if (!ok) problems.push(`cifra que no está en los datos de Jumpseller: "${m[0].trim()}"`);
  }
  for (const m of normalizeCodes(text).matchAll(CERT)) {
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
