// api/_lib/forms/quantityMentions.ts
// ─────────────────────────────────────────────────────────────────────────────
// «Revisar cantidad» (decisión del dueño, 13-11-2026): si el comentario de una solicitud
// menciona una cantidad distinta de las elegidas en el formulario, la nota y el correo lo
// dicen bajo «Para revisar». Solo avisa: el pedido se cotiza con lo que se eligió.
//
// Es conservadora a propósito: un aviso de más cansa y uno de menos solo deja las cosas
// como antes. Cuenta un número (1 a 9999, o «dos» a «cien» en palabras) solo si:
//   - va seguido de una palabra de conteo: «2 rollos», «10 unidades», «4 u.», «tres paneles»;
//   - viene después de un verbo de pedido: «necesito 3», «son 12», «cantidad: 5», «en total 8»,
//     y termina ahí (fin, puntuación, «de», «para», «y»…);
//   - o va en un «x N» suelto: «panel 60x60 x 4» (el x de una medida, «60x60», no cuenta).
// Tras un verbo o una «x», solo de 1 a 999: «cotizar 2027», «necesito 1990» o «son 4990» son
// un año o un precio. Con una palabra de conteo sí vale: «2000 unidades».
// Nunca cuenta lo que está pegado a letras, puntos, comas, barras, guiones o «$» (modelos
// como AR111, RUT, precios, fechas 15/12, horas), lo que sigue con una unidad (40W, 4000K,
// 220V, 3 metros, 15 mil, 2 UF), un «IP 65» o «IK 08», un «modelo 200», una fecha «15 de
// diciembre», un teléfono (+56 9 1234 5678) ni el tamaño de un envase («cajas de 10»).
// Una mención que coincide con alguna cantidad elegida, o con su total, no avisa.
// ─────────────────────────────────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100,
};
const WORD = Object.keys(WORD_NUMBERS).join('|');

/** Un número de 1 a 9999 que no está pegado a otro dígito, letra ni signo, o uno en palabras. */
const NUMBER =
  `(?<![\\p{L}\\d.,/:$#°+-])(?:(?<digits>[1-9]\\d{0,3})(?![\\d\\p{L}])(?![.,/:-]\\d)|(?<word>${WORD})(?![\\p{L}\\d]))`;

/** Palabras de conteo (sin tildes: el texto se compara sin ellas). */
const COUNT_NOUN =
  '(?:unidades|unidad|unids?\\.?|unds?\\.?|uds?\\.?|u\\.|un\\.|piezas?|pzas?\\.?|rollos?|cajas?|equipos?|' +
  'luminarias?|focos?|paneles|panel|tubos?|ampolletas?|campanas?|proyectores?|proyector|reflectores?|reflector|' +
  'kits?|lamparas?|postes?|apliques?|plafones|plafon|cintas?|tiras?|drivers?|sensores?|sensor|luces)(?![\\p{L}\\d])';

const ORDER_VERB =
  '(?:necesito|necesitamos|necesitaria|necesitariamos|requiero|requerimos|quiero|queremos|ocupo|ocupamos|' +
  'cotizar|comprar|pido|pedimos|solicito|solicitamos|busco|buscamos|serian|seria|son|en total|un total de|' +
  'total de|cantidad de|cantidad|cant\\.)';
const FILLER = '(?:(?:unas|unos|aprox\\.?|aproximadamente|como|alrededor de|al menos|minimo|solo|solamente|cerca de)\\s+)*';
/** Después de «necesito N» el número termina: fin, puntuación o una palabra que lo cierra. */
const ORDER_END =
  '(?=\\s*(?:$|[.,;:!?)\\n]|(?:de|del|para|y|e|en|que|o|por|mas|aprox)(?![\\p{L}\\d])))' +
  '(?!\\s*de\\s+(?:potencia|largo|ancho|alto|altura|diametro|distancia|watts?|lumenes)(?![\\p{L}]))';

/** Lo que nunca es una cantidad aunque el número calce: unidades, fechas, teléfonos, medidas. */
const NOT_A_QUANTITY_AFTER = new RegExp(
  '^\\s*(?:' +
    '(?:w|watts?|kw|k|kelvin|v|volts?|vac|vdc|mm|cm|m|mts?|metros?|mt2|m2|lm|lumenes|lux|%|°|grados|hz|' +
    'amp|amperes?|ah|mah|kwh|pulgadas?|"|\'|mil|millones?|lucas?|pesos|clp|uf|usd|dolares|iva|hrs?|horas?|' +
    'minutos?|min|dias?|semanas?|meses|anos?|pm|am)(?![\\p{L}\\d])' +
    '|[x×*]\\s*\\d' +
    '|de\\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?![\\p{L}])' +
    '|[.-]?\\d{3,}' +
    ')',
  'u',
);
const NOT_A_QUANTITY_BEFORE = new RegExp(
  '(?:(?<![\\p{L}\\d])(?:ip|ik|ra|cri|modelo|mod\\.?|codigo|cod\\.?|sku|ref\\.?|referencia|n°|nº|no\\.|numero|serie|' +
    'linea|version|tipo|fono|telefono|tel\\.?|celular|cel\\.?|whatsapp|wsp|rut|dia|el|del|hasta el|antes del|lote|' +
    'piso|oficina|calle|pasaje|av\\.?|avenida)\\s*:?\\s*' +
    '|(?<![\\p{L}\\d])(?:cajas?|kits?|packs?|sets?|juegos?|rollos?|paquetes?|bolsas?)\\s+(?:de|con|x)\\s+' +
    '|(?<![\\p{L}\\d])(?:tengo|tenemos|tiene|hay|habia|existen|ya|actualmente|instalad[oa]s)\\s+' +
    '|\\d[\\s.-]+)$',
  'u',
);

const PATTERNS = [
  new RegExp(`${NUMBER}\\s*${COUNT_NOUN}`, 'gu'),
  new RegExp(`(?<![\\p{L}\\d])${ORDER_VERB}\\s*:?\\s*${FILLER}${NUMBER}${ORDER_END}`, 'gu'),
  new RegExp(`(?<=^|[\\s(,;])[x×*]\\s*(?<digits>[1-9]\\d{0,3})(?![\\d\\p{L}])(?![.,/:-]\\d)`, 'gu'),
];

/** Sin tildes ni mayúsculas, para comparar con las listas. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Las cantidades que menciona un comentario, en el orden en que aparecen y sin repetir.
 * Vacío si no hay ninguna clara.
 */
export function mentionedQuantities(comment: unknown): number[] {
  if (typeof comment !== 'string' || !comment.trim()) return [];
  const text = normalize(comment.slice(0, 5000));
  const found: Array<{ at: number; value: number }> = [];
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const groups = match.groups ?? {};
      const raw = groups.digits ?? groups.word;
      if (!raw) continue;
      const value = groups.digits ? Number(groups.digits) : WORD_NUMBERS[groups.word];
      // Dónde está el número dentro del texto (el patrón puede empezar en el verbo o en «x»)
      const offset = (match.index ?? 0) + match[0].lastIndexOf(raw);
      const before = text.slice(Math.max(0, offset - 30), offset);
      const after = text.slice(offset + raw.length, offset + raw.length + 30);
      if (NOT_A_QUANTITY_BEFORE.test(before)) continue;
      // Tras una palabra de conteo no hay unidad que mirar; tras un verbo o una «x», sí
      if (pattern !== PATTERNS[0] && NOT_A_QUANTITY_AFTER.test(after)) continue;
      // Sin palabra de conteo, un número de 4 cifras es un año o un precio («cotizar 2027», «son 4990»)
      if (pattern !== PATTERNS[0] && value >= 1000) continue;
      // «60 x 60»: la x une dos números (una medida). Tras una medida o una potencia sí vale:
      // «60x60 x 4», «40W x 4».
      if (pattern === PATTERNS[2] && /(?:^|[^\p{L}\d.,x×*])\d+\s*$/u.test(text.slice(0, match.index))) continue;
      found.push({ at: offset, value });
    }
  }
  const values: number[] = [];
  for (const { value } of found.sort((a, b) => a.at - b.at)) {
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

const listText = (values: readonly number[]) =>
  values.length === 1 ? String(values[0]) : `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`;

/**
 * «Revisar cantidad: el comentario menciona N; se eligió M» si el comentario menciona una
 * cantidad que no es ninguna de las elegidas ni su total; null si no (o si no hay ítems).
 */
export function quantityReviewItem(comment: unknown, chosen: readonly number[]): string | null {
  const quantities = chosen.filter((q) => Number.isInteger(q) && q > 0);
  if (!quantities.length) return null;
  const total = quantities.reduce((sum, q) => sum + q, 0);
  const odd = mentionedQuantities(comment).filter((n) => n !== total && !quantities.includes(n));
  if (!odd.length) return null;
  const picked =
    quantities.length === 1 ? `se eligió ${quantities[0]}` : `se eligieron ${listText(quantities)} (en total ${total})`;
  return `Revisar cantidad: el comentario menciona ${listText(odd)}; ${picked}`;
}
