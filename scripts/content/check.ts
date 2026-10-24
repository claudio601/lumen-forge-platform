// scripts/content/check.ts
// Verifica el contenido SEO de un producto (src/data/catalog/content/<id>.json):
//   - formato y largos del formato BESTLED (lo que la ficha sabe mostrar),
//   - reglas del sitio (sin stock, sin precios, despacho solo "hasta 2 días hábiles" y
//     nunca como plazo de llegada, sin flota propia, sin promesas como "gratis" o "mismo día";
//     D.S. N°1/2022 certificado solo en las líneas certificadas y en sus versiones
//     certificadas, sin el D.S. N°43, sin luz azul en canchas y sin el «% de luz azul» junto a
//     la norma: src/data/catalog/ds1.ts),
//   - que no invente datos: cada cifra con su unidad (W, lm, K, V, h, años, mm, °, %, A…)
//     tiene que estar en los datos de Jumpseller del producto con esa misma unidad (o en
//     una fila cuya etiqueta la implica, como "Garantía" o "Alto (mm)"); lo mismo cada
//     certificación, grado IP/IK y marca de componentes (facts.ts). En los proyectores de
//     estadio, el certificado D.S. N°1/2022 solo en las versiones de hasta 5000K que el producto
//     tiene entre sus variantes (ds1VariantIssues, decisión del dueño del 23-10-2026).
// Cada función devuelve la lista de problemas (vacía si está bien). Formato y reglas no
// dependen de Jumpseller (los verifica content.test.ts); los datos sí, así que la
// sincronización los revisa a diario y avisa en su informe sin bloquear precios.

import type { ProductContent } from '../../src/data/catalog/types';
import { ds1ContentIssues, ds1VariantIssues } from '../../src/data/catalog/ds1';
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
/** Bordes de palabra que entienden tildes ("\b" de JavaScript no reconoce "ó" como letra). */
const W = String.raw`(?<![\p{L}\p{N}])`;
const WE = String.raw`(?![\p{L}\p{N}])`;
const anyOf = (patterns: string[]) => new RegExp(patterns.map(p => `${W}(?:${p})${WE}`).join('|'), 'iu');

/**
 * Flota propia: el dueño no ha confirmado que eLIGHTS tenga camiones (PR 11b). Nombrar
 * camiones o flotas como lugar o cliente ("patios de camiones", "flotas de mantención") sí se puede.
 */
const VEHICLES = String.raw`cami[oó]n|camiones|camionetas?|furg[oó]n|furgones|furgonetas?|flotas?|veh[ií]culos?|repartidor(?:es)?|reparto`;
const OWN_FLEET = anyOf([
  String.raw`(?:${VEHICLES}|transporte|log[ií]stica)\s+propi[oa]s?`, // camiones propios, flota propia, reparto propio
  String.raw`propi[oa]s?\s+(?:${VEHICLES}|transporte)`, // propios camiones, propia flota
  String.raw`nuestr[oa]s?\s+(?:propi[oa]s?\s+)?(?:${VEHICLES})`, // nuestros camiones, nuestra flota, nuestro reparto
  String.raw`(?:${VEHICLES})\s+(?:propi[oa]s?\s+)?de\s+eLIGHTS`, // camiones de eLIGHTS
  String.raw`(?:l[oa]s?\s+)?(?:repartimos|llevamos|entregamos|transportamos)\s+nosotros`, // lo repartimos nosotros
  String.raw`reparto\s+direct[oa]`,
  String.raw`(?:reparto|repartimos)[^.;:\n]{0,80}${W}Santiago|Santiago[^.;:\n]{0,80}${W}(?:reparto|repartimos)`, // en Santiago el reparto…
]);

/**
 * Llegada en 2 días hábiles: son de despacho (desde el pago confirmado; en regiones, hasta
 * entregar el pedido al transportista, y el viaje se informa en la cotización). "Se despacha en
 * hasta 2 días hábiles" y "despachamos a todo Chile en hasta 2 días hábiles" están bien; "el
 * despacho a cualquier región toma (o se hace en) hasta 2 días hábiles", "el despacho alcanza todo
 * el país en…" y "enviamos a cualquier región en…" no (se leen como plazo de llegada). La cifra
 * también se reconoce en letras ("dos días hábiles"), que además se marca aparte.
 */
const TWO_DAYS = String.raw`(?:2|dos)\s+d[ií]as\s+h[aá]biles`;
/** Un destino puntual ("cualquier región", "regiones", "tu obra"): con él, el plazo se lee como de llegada. */
const POINT_DESTINATION = String.raw`(?:todas?\s+(?:las\s+)?(?:regiones|ciudades|comunas)|cualquier\s+(?:regi[oó]n|punto|ciudad|comuna|lugar|parte|destino|direcci[oó]n)|(?:las\s+|otras\s+)?regiones|(?:tu|su)\s+(?:obra|ciudad|regi[oó]n|comuna|domicilio|casa|empresa|bodega|local|puerta|destino|direcci[oó]n|proyecto)|Santiago|(?:el\s+)?resto\s+del\s+pa[ií]s)${WE}`;
/** Cualquier destino, también el país entero ("el despacho a todo Chile se hace en…" solo dice que se despacha a todo el país). */
const DESTINATION = String.raw`(?:todo\s+(?:Chile|el\s+pa[ií]s|el\s+territorio)|lo\s+(?:largo|ancho)\s+(?:del\s+pa[ií]s|de\s+(?:todo\s+)?Chile)|${POINT_DESTINATION})${WE}`;
/**
 * Salvo si la misma oración aclara el viaje y que se informa en la cotización ("…a regiones se
 * suma el tiempo de viaje, que te informamos en la cotización"). Nombrar al transportista no basta.
 */
const UNLESS_TRAVEL_EXPLAINED = String.raw`(?!(?=[^.\n]*${W}(?:viaje|traslado|trayecto|tramo)${WE})(?=[^.\n]*${W}(?:cotiza|presupuesto)))`;
/** Resto de la misma cláusula, sin pasar a un verbo de despacho ("…y se despacha en hasta 2 días hábiles"). */
const DISPATCH_VERB = String.raw`${W}(?:se\s+despachan?|despachamos|despacharl[oa]s?|salen?|entregamos|se\s+entregan?)${WE}`;
const SAME_CLAUSE = String.raw`(?:(?!${DISPATCH_VERB})[^.;:\n])*?`;
/** Lo mismo, y sin hablar de lo que recibe quien cotiza ("recibirás la cotización…") ni del pago. */
const RECEIPT_CLAUSE = String.raw`(?:(?!${DISPATCH_VERB}|${W}(?:cotizaci|propuesta|respuesta|presupuesto|pago|solicitud))[^.;:\n])*?`;
const ARRIVAL = anyOf([
  // "el pedido llega a cualquier región en hasta 2 días hábiles", "llevamos el pedido a todo Chile en…"
  // "te lo entregamos en tu obra en hasta 2 días hábiles" ("lo entregamos al transportista" está bien)
  String.raw`(?:llega|llegan|llegar[aá]n?|lleguen?|llegamos|viaja|viajan|viajar[aá]n?|llevamos|hacemos\s+llegar|har[eé]mos\s+llegar|reparten|repartimos|entregamos|tendr[aá]s|l[oa]s?\s+tienes)(?:\s+(?:el|la|los|las|tu|tus|su|sus)\s+\p{L}+)?\s+(?:a|al|hasta|hacia|en)\s+${DESTINATION}${SAME_CLAUSE}${TWO_DAYS}`,
  // "sale a cualquier región y llega en hasta 2 días hábiles"
  String.raw`(?:llega|llegan|llegar[aá]n?|lleguen?)\s+(?:en\s+)?(?:un\s+plazo\s+(?:m[aá]ximo\s+)?de\s+)?(?:hasta\s+)?${TWO_DAYS}`,
  // "el despacho, en hasta 2 días hábiles, llega a todo Chile", "en hasta 2 días hábiles el pedido llega a…"
  String.raw`${TWO_DAYS},?\s+(?:(?:el|la|los|las|tu|tus|su|sus)\s+\p{L}+\s+)?(?:te\s+)?(?:llega|llegan|llegar[aá]n?)\s+(?:a|al|hasta|en)\s+${DESTINATION}`,
  // "el despacho alcanza todo el territorio nacional en hasta 2 días hábiles", "cubre todo Chile, en…"
  String.raw`(?:alcanzan?|alcanzamos|cubren?|cubrimos)\s+(?:a\s+)?${DESTINATION}(?:\s+(?:nacional|de\s+Chile|del\s+pa[ií]s))?,?\s+(?:en\s+)?(?:un\s+plazo\s+(?:m[aá]ximo\s+)?de\s+)?(?:hasta\s+)?${TWO_DAYS}${UNLESS_TRAVEL_EXPLAINED}`,
  // "el despacho a cualquier región se hace en hasta 2 días hábiles", "…es en hasta…" (a todo Chile sí se puede)
  String.raw`(?:despachos?|env[ií]os?)\s*,?\s+(?:a|al|hacia|hasta|con\s+destino\s+a)\s+${POINT_DESTINATION}[^.;:\n]*?${W}(?:se\s+hacen?|se\s+realizan?|se\s+completan?|se\s+coordinan?|es|son)\s+(?:de\s+|en\s+)(?:un\s+plazo\s+de\s+)?(?:hasta\s+)?${TWO_DAYS}${UNLESS_TRAVEL_EXPLAINED}`,
  // "el despacho es en hasta 2 días hábiles a cualquier región", "un despacho de hasta 2 días hábiles a cualquier punto"
  String.raw`(?:despachos?|env[ií]os?)\s+(?:se\s+hacen?|se\s+realizan?|es|son|de)\s+(?:en\s+)?(?:un\s+plazo\s+de\s+)?(?:hasta\s+)?${TWO_DAYS},?\s+(?:a|al|hacia|hasta|en)\s+${POINT_DESTINATION}${UNLESS_TRAVEL_EXPLAINED}`,
  // "enviamos el pedido a cualquier región en hasta 2 días hábiles", "con envío a todo Chile en…":
  // enviar a un destino en un plazo se lee como puerta a puerta
  String.raw`(?:enviamos|enviaremos|hacemos\s+env[ií]os|env[ií]os?)(?:\s+(?:el|la|los|las|tu|tus|su|sus)\s+\p{L}+)?\s+(?:a|al|hasta|hacia|en|con\s+destino\s+a)\s+${DESTINATION}${SAME_CLAUSE}${TWO_DAYS}${UNLESS_TRAVEL_EXPLAINED}`,
  // "la entrega en cualquier región toma hasta 2 días hábiles", "con llegada en hasta 2 días hábiles"
  String.raw`(?:llegada|entrega|recepci[oó]n)\s+(?:a|al|en|hasta)\s+${DESTINATION}${SAME_CLAUSE}${TWO_DAYS}${UNLESS_TRAVEL_EXPLAINED}`,
  String.raw`(?:con|de)\s+(?:llegada|entrega)\s+(?:en\s+)?(?:un\s+plazo\s+de\s+)?(?:hasta\s+)?${TWO_DAYS}`,
  String.raw`plazo\s+de\s+(?:entrega|llegada)(?!\s+al\s+transportista)${SAME_CLAUSE}${TWO_DAYS}`,
  // "recibes tu pedido en hasta 2 días hábiles" (no "recibirás la cotización…, y se despacha en…")
  String.raw`recib(?:es|e|en|ir[aá]s|ir[aá]|ir[aá]n|ir(?:l[oa]s?)?)${WE}${RECEIPT_CLAUSE}${TWO_DAYS}`,
  // "el despacho a cualquier región toma hasta 2 días hábiles", "el envío sale a regiones y tarda…":
  // destino más duración se lee como plazo de llegada (salvo si la oración aclara el viaje)
  String.raw`(?:despachos?|env[ií]os?)\s*,?\s+(?:salen?\s+)?(?:(?:a|al|hacia|con\s+destino\s+a)\s+|cubren?\s+)${DESTINATION}[^.;:\n]*?${W}(?:toman?|tardan?|demoran?)\s+(?:un\s+plazo\s+de\s+)?(?:hasta\s+)?${TWO_DAYS}${UNLESS_TRAVEL_EXPLAINED}`,
  // "tarda hasta 2 días hábiles y llega a todo el país"
  String.raw`(?:toman?|tardan?|demoran?)\s+(?:hasta\s+)?${TWO_DAYS}\s+y\s+llegan?${UNLESS_TRAVEL_EXPLAINED}`,
]);

const FORBIDDEN: [RegExp, string][] = [
  [/gratis|gratuit[oa]s?/i, 'promete algo gratis'],
  [/\bmismo d[ií]a\b/i, 'promete despacho el mismo día'],
  [new RegExp(`${W}dos\\s+d[ií]as\\s+h[aá]biles${WE}`, 'iu'), 'escribe el plazo en letras (va "hasta 2 días hábiles")'],
  [OWN_FLEET, 'afirma que eLIGHTS tiene camiones, flota o reparto propio (no está confirmado)'],
  [
    ARRIVAL,
    'promete que el pedido llega en 2 días hábiles: son de despacho (en regiones, hasta entregarlo al transportista; el viaje se informa en la cotización)',
  ],
  [/mejor precio|precios? (?:bajos?|competitivos?|imbatibles?)|m[aá]s barat|oferta|descuento|liquidaci[oó]n|promoci[oó]n/i, 'habla de precios u ofertas'],
  [/de por vida/i, 'garantía de por vida'],
  // «D.S. N°1/2022» (la norma de contaminación lumínica) no es declararse «N°1»
  [/(?<!D\.\s?S\.\s?)\bn[°º]\s?1\b|n[uú]mero uno|l[ií]der (?:del|en el) mercado/i, 'se declara líder'],
  [/24\/7/, 'promete atención 24/7'],
  [/whats\s?app/i, 'menciona WhatsApp (lo atiende un asistente automático que solo toma solicitudes; la asesoría es por correo)'],
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

/** El plazo de despacho en una oración con dos o más ";": lo de regiones va en otra oración. */
const CHAINED_DISPATCH = new RegExp(String.raw`${W}${TWO_DAYS}${WE}`, 'iu');

/**
 * Reglas del sitio: sin stock, sin precios, despacho solo "hasta 2 días hábiles" (no de llegada),
 * sin flota propia ni promesas, y el D.S. N°1/2022. El id de Jumpseller decide si el producto es
 * de una línea con certificado D.S. N°1 (src/data/catalog/ds1.ts); sin id, se revisa como un
 * producto sin certificado.
 */
export function checkRules(c: ProductContent, jumpsellerId?: number): string[] {
  const problems: string[] = [];
  const text = allText(c);
  const rule = findRuleBreaking(text);
  if (rule) problems.push(`rompe una regla del sitio: "${rule}"`);
  for (const [re, why] of FORBIDDEN) {
    const m = text.match(re);
    if (m) problems.push(`${why}: "${m[0]}"`);
  }
  const chained = text.split(/(?<=[.!?])\s+|\n+/).find(s => CHAINED_DISPATCH.test(s) && s.split(';').length > 2);
  if (chained) problems.push(`encadena el plazo de despacho con dos o más ";" (lo de regiones va en otra oración): "${chained.slice(0, 60)}…"`);
  // D.S. N°1/2022: el certificado solo en las líneas certificadas, y ahí solo en sus versiones
  // certificadas (src/data/catalog/ds1.ts)
  problems.push(...ds1ContentIssues(c, jumpsellerId));
  return problems;
}

/**
 * Nada que no esté en Jumpseller: cifras con su unidad, certificaciones, grados IP/IK y marcas; y
 * en los proyectores de estadio, el certificado D.S. N°1/2022 solo en versiones de hasta 5000K
 * que el producto tiene entre sus variantes.
 */
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
  // D.S. N°1/2022 en los proyectores de estadio: solo en las versiones de hasta 5000K que tiene
  // el producto (src/data/catalog/ds1.ts)
  problems.push(...ds1VariantIssues(c, f.jumpseller_id, f.variantOptions));
  return [...new Set(problems)];
}

export function checkContent(c: ProductContent, f: ProductFacts): string[] {
  return [...checkFormat(c), ...checkRules(c, f.jumpseller_id), ...checkFacts(c, f)];
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
