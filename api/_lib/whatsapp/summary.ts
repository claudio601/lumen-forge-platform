// api/_lib/whatsapp/summary.ts
// [RESUMEN] El resumen que redacta Claude es una interpretacion, no un dato: una frase que afirma una
// compra, un pago, el stock, un pedido, un despacho o el historial del cliente se bota si esa
// afirmacion no va atribuida al cliente ("El cliente dice que ya compro" queda; "Cliente ya compro"
// no). La atribucion se mira por clausula: en "El cliente pregunta por paneles y ya pago su pedido" el
// pago no va atribuido y la frase se bota. Ante la duda se bota: la nota trae la transcripcion. Si no
// queda nada, la nota remite a ella.

export const SUMMARY_EMPTY = 'Ver la transcripci\u00f3n.';

// Limites de palabra que entienden las tildes: "\b" corta "compro" despues de la "r".
const W = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const words = (list: string[], flags = 'giu') => new RegExp(W + '(?:' + list.join('|') + ')' + E, flags);
const blank = (m: string) => ' '.repeat(m.length);

// Hechos que solo cubre la atribucion. "Pedido de 20 paneles" (la solicitud) no es un hecho; "su
// pedido", "pedido pagado" o "tiene un pedido" si. Los sustantivos ("formas de pago", "despacho",
// "deposito") tampoco: solo el verbo en pasado, el participio o "cliente pago". "Cancelar" es pagar
// solo junto a la factura, el pedido, la compra o un monto.
const FACT_RE = words([
  'compr(?:\u00f3|o|aron|ad[oa]s?)',
  'compras?\\s+(?:anterior(?:es)?|previas?)',
  'sus?\\s+compras?',
  'adquiri(?:\u00f3|o|eron)|adquirid[oa]s?',
  'pag(?:\u00f3|aron|ad[oa]s?)|(?:client[ea]\\s+(?:ya\\s+)?|ya\\s+)pago',
  'abon(?:\u00f3|aron|ad[oa]s?)',
  'transfiri(?:\u00f3|o|eron)',
  'deposit(?:\u00f3|aron|ad[oa]s?)',
  'factur(?:\u00f3|ad[oa]s?)|boletead[oa]s?',
  '(?:realiz(?:\u00f3|o|aron)|hizo|hicieron|efectu(?:\u00f3|o|aron)|(?:han?|hab(?:\u00ed|i)an?)\\s+(?:realizado|hecho|efectuado))\\s+'
    + '(?:(?:una?|el|la|los|las|su|sus)\\s+)?(?:compras?|pagos?|pedidos?|transferencias?|dep(?:\u00f3|o)sitos?|abonos?)',
  '(?:compras?|pagos?|transferencias?|dep(?:\u00f3|o)sitos?|abonos?)\\s+(?:ya\\s+)?(?:realizad|efectuad|hech|acreditad)[oa]s?',
  // El participio no es un hecho tras lo que recibe el bot o ventas: "Cotizacion recibida por correo".
  'recibi(?:\u00f3|o|eron)|(?<!(?:cotizaci(?:\u00f3|o)n(?:es)?|solicitud(?:es)?|consultas?|mensajes?|correos?|informaci(?:\u00f3|o)n'
    + '|fotos?|fotograf(?:\u00ed|i)as?|im(?:\u00e1|a)gen(?:es)?|archivos?|planos?|documentos?|requerimientos?)\\s+)recibid[oa]s?',
  '(?:envi|adjunt|mand)(?:\u00f3|o|aron)\\s+(?:(?:el|la|los|las|un|una|su|sus)\\s+)?comprobantes?'
    + '|comprobantes?(?:\\s+de\\s+\\p{L}+)?\\s+(?:ya\\s+)?(?:enviad|adjuntad)[oa]s?',
  'cancel(?:\u00f3|o|aron)\\s+(?:(?:el|la|los|las|su|sus|una?)\\s+)?(?:facturas?|boletas?|pedidos?|compras?|montos?|saldos?|totale?s?|cuentas?|(?:\u00f3|o)rden(?:es)?|(?:\\$\\s*)?\\d+)',
  '(?:facturas?|boletas?|compras?|montos?|saldos?|cuentas?)\\s+(?:ya\\s+)?cancelad[oa]s?',
  'sus?\\s+pedidos?|pedidos?\\s+(?:anterior(?:es)?|previos?|confirmad[oa]s?|pagad[oa]s?|despachad[oa]s?|entregad[oa]s?|enviad[oa]s?|cancelad[oa]s?'
    + '|list[oa]s?|en\\s+(?:curso|camino|tr(?:\u00e1|a)nsito)|pendientes?|realizad[oa]s?|hechos?)',
  'tienen?\\s+(?:(?:una?|su|sus)\\s+)?(?:pedidos?|(?:\u00f3|o)rden(?:es)?|compras?)(?!\\s+m(?:\u00ed|i)nim[oa]s?' + E + ')',
  // El despacho y la entrega en pasado ("sera despachado" va con el futuro, en DELIVERY_RE).
  'despach(?:\u00f3|aron)|entreg(?:\u00f3|aron)|(?<!ser(?:\u00e1|a)n?\\s+)(?:despach|entreg)ad[oa]s?|fue(?:ron)?\\s+enviad[oa]s?|lleg(?:\u00f3|o|aron)',
  '(?<!(?:disponibilidad|stock|existencias?)\\s+)(?:confirmad|reservad)[oa]s?',
  'historial|ya\\s+es\\s+client[ea]|client[ea]s?\\s+(?:frecuentes?|habitual(?:es)?|antigu[oa]s?|recurrentes?|de\\s+(?:la\\s+(?:tienda|casa)|elights|nosotros))',
]);
// "Cliente de la empresa" es historial; "Cliente de la empresa Constructora X" presenta a un cliente
// B2B. La mayuscula se mira aparte: con la bandera "i", "\p{Lu}" tambien acepta minusculas.
const COMPANY_CLIENT_RE = words(['client[ea]s?\\s+de\\s+la\\s+empresa']);
const PROPER_NAME_RE = /^\s+\p{Lu}/u;
// Stock y entrega afirmados ("hay stock", "quedan 20", "llegaran el lunes"): los cubre tambien un
// pedido o una consulta de la misma clausula, pero solo como pregunta ("Pregunta si hay stock",
// "Consulta si los focos llegaran el viernes"). El pasado y "su pedido" no: van en FACT_RE.
const STOCK_RE = words([
  '(?<!interesad[oa]s?\\s+)en\\s+(?:stock|existencias?)|(?:hay|tienen?|tenemos|con|sin)\\s+(?:stock|disponibilidad|existencias?|inventario)',
  '(?:disponibilidad|stock|existencias?)\\s+(?:asegurad|confirmad|reservad|garantizad)[oa]s?',
  'disponibles?|agotad[oa]s?',
  'quedan\\s+(?:\\d+|pocas|pocos|s(?:\u00f3|o)lo|unidades)',
]);
const DELIVERY_RE = words([
  '(?:despach|envi|entreg)ar(?:\u00e1|a)n?|ser(?:\u00e1|a)n?\\s+(?:despachad|enviad|entregad)[oa]s?|lleg(?:a|an|ar(?:\u00e1|a)n?)',
  'salen?\\s+(?:hoy|ma(?:\u00f1|n)ana|esta\\s+semana|el\\s+(?:lunes|martes|mi(?:\u00e9|e)rcoles|jueves|viernes|s(?:\u00e1|a)bado))',
  '(?:va|van|est(?:\u00e1|a)n?|sigue|siguen|viene|vienen)\\s+en\\s+(?:camino|tr(?:\u00e1|a)nsito)',
  'list[oa]s?\\s+para\\s+(?:(?:el|su)\\s+)?(?:retir(?:o|ar)|despach(?:o|ar)|entreg(?:a|ar)|env(?:\u00ed|i)o|enviar)',
]);
// La orden de compra la cubre cualquier pedido anterior de la clausula ("Necesita adjuntar una orden
// de compra").
const ORDER_RE = words(['(?:\u00f3|o)rden(?:es)?\\s+de\\s+compra']);
// El nombre suelto lo cubre un pedido de la misma clausula si entre ambos solo van articulos,
// preposiciones o palabras de consulta ("Necesita conocer el stock", "Solicita informacion de stock").
const STOCK_WORD_RE = words(['stock|inventario|existencias?|disponibilidad']);
const COMPLEMENT_RE = new RegExp('^(?:\\s*(?:el|la|los|las|lo|un|una|de|del|por|sobre|en|al?|para|informaci(?:\u00f3|o)n|datos'
  + '|detalles?|confirmaci(?:\u00f3|o)n|estado|revisar|ver)' + E + ')*\\s*$', 'iu');
// Y el de una lista tras un pedido ("requiere precio, stock y plazo", "cotizacion y disponibilidad de
// focos 100W") solo si va solo: "stock de sobra", "stock suficiente" o "stock: 50" afirman.
const BARE_STOCK_RE = new RegExp('^(?:(?:el|la|los|las)\\s+)?(?:stock|inventario|existencias?|disponibilidad)'
  + '(?:\\s+del?\\s+(?!sobras?' + E + ')(?:(?:el|la|los|las)\\s+)?\\p{L}[\\p{L}\\p{N}]*(?:\\s+[\\p{L}\\p{N}]+){0,3})?$', 'iu');
const QUESTION_RE = words(['si|cu(?:\u00e1|a)ndo|cu(?:\u00e1|a)nt[oa]s?|qu\u00e9|cu(?:\u00e1|a)l(?:es)?|d(?:\u00f3|o)nde|c(?:\u00f3|o)mo'], 'iu');
// Un "que" entre el pedido y el hecho abre otra afirmacion: "Pide 20 focos que estan en stock".
const QUE_RE = words(['que'], 'iu');
// "Disponible" referido al cliente, el contacto, el correo o la informacion no es stock, y "el
// despacho es pagado o por pagar" es una condicion del despacho, no un pago: se tapan antes de buscar.
const NOT_STOCK_RE = new RegExp(W + '(?:(?:client[ea]s?|contactos?|correos?|e-?mails?|tel(?:\u00e9|e)fonos?|whatsapp|informaci(?:\u00f3|o)n|datos?|horarios?|fichas?)'
  + '(?:\\s+(?:no|direct[oa]s?|t(?:\u00e9|e)cnic[oa]s?|de|del|contacto|atenci(?:\u00f3|o)n|electr(?:\u00f3|o)nicos?|personal(?:es)?|web)' + E + '){0,3}\\s+disponibles?'
  + '|disponibles?\\s+(?:por|v(?:\u00ed|i)a|al?|en)\\s+(?:el\\s+)?(?:whatsapp|correo|tel(?:\u00e9|e)fono)'
  + '|disponibilidad\\s+(?:horaria|de\\s+horarios?)'
  // "Para stock": el cliente compra para su propio inventario.
  + '|para\\s+(?:(?:su|tener|reponer|mantener|hacer)\\s+)?(?:stock|inventario))' + E, 'giu');
const NOT_PAID_RE = new RegExp(W + '(?:despachos?|env(?:\u00ed|i)os?|fletes?)(?:\\s+[\\p{L}\\p{N}]+){0,4}?\\s+(?:es|son|sean?|ser(?:\u00ed|i)an?)\\s+'
  + '(?:pagad[oa]s?|por\\s+pagar)(?:\\s+o\\s+(?:pagad[oa]s?|por\\s+pagar))?' + E, 'giu');
// Pedidos y consultas: cubren solo el stock, la entrega por venir y la orden de compra. El infinitivo
// no cuenta tras "se pudo" o "se logro": "Se pudo confirmar la disponibilidad" cuenta algo ya hecho.
const REQUEST_RE = words([
  'requier[ea]n?|solicit(?:a|an)|consult(?:a|an)|pregunt(?:a|an)|pide|piden|necesit(?:a|an)|busca|buscan|cotiz(?:a|an)',
  'interesad[oa]s?\\s+en|(?<!con\\s+)confirmaci(?:\u00f3|o)n\\s+de',
  '(?<!(?:pud(?:o|e|imos|ieron)|logr(?:\u00f3|o|\u00e9|e|amos|aron)|podido|logrado|posible)\\s+)'
    + '(?:requerir|solicitar|consultar|preguntar|pedir|necesitar|buscar|confirmar|validar|chequear|saber|conocer|verificar|averiguar|cotizar)',
]);
// Lo que dice el cliente: "El cliente dice/indica/senala...", "Segun el cliente, ..." o "dice que..." al
// empezar la clausula ("El cliente pide focos y dice que ya pago"). "Pregunta", "pide" o "quiere" no
// atribuyen: "El cliente quiere retirar su pedido ya pagado" afirma el pago. Tampoco "cuenta (ya) con".
const SAYS = '(?:dice|dijo|indic(?:a|\u00f3|o)|se(?:\u00f1|n)al(?:a|\u00f3|o)|afirm(?:a|\u00f3|o)|asegur(?:a|\u00f3|o)'
  + '|cuenta(?!(?:\\s+(?:ya|tambi(?:\u00e9|e)n|adem(?:\u00e1|a)s|a(?:\u00fa|u)n))?\\s+con' + E + ')'
  + '|cont(?:\u00f3|o)|coment(?:a|\u00f3|o)|mencion(?:a|\u00f3|o)|inform(?:a|\u00f3|o)|declar(?:a|\u00f3|o)|sostiene|escribe|escribi(?:\u00f3|o)'
  + '|explic(?:a|\u00f3|o)|aclar(?:a|\u00f3|o))' + E;
const ATTRIBUTION = W + '(?:seg(?:\u00fa|u)n\\s+(?:(?:el|la)\\s+)?client[ea]' + E
  + '|client[ea]\\s+(?:tambi(?:\u00e9|e)n\\s+|adem(?:\u00e1|a)s\\s+)?' + SAYS + ')';
const ATTRIBUTION_RE = new RegExp(ATTRIBUTION, 'iu');
const SAYS_START_RE = new RegExp('^(?:tambi(?:\u00e9|e)n\\s+|adem(?:\u00e1|a)s\\s+)?' + SAYS + '\\s+que' + E, 'iu');
// "Segun el cliente, ..." o "El cliente indica: ..." atribuyen la clausula que sigue.
const ATTRIBUTION_END_RE = new RegExp(ATTRIBUTION + '(?:\\s+que)?$', 'iu');
// Clausulas: coma, dos puntos, "y", "e", "pero", "aunque", "ademas", "porque". Solo las de lista (coma,
// dos puntos, "y", "e") pasan el pedido al nombre suelto que sigue. Una clausula que empieza con "que"
// sigue solo la atribucion de la anterior ("El cliente dice que ya compro y que pago"; "Pide focos, que
// hay stock" se bota); con "si", tambien el pedido ("El cliente pregunta por el precio y si hay stock").
const CLAUSE_SPLIT = new RegExp('(\\s*[,:]\\s*|\\s+(?:y|e|pero|aunque|adem(?:\u00e1|a)s|porque|pues|sino|mientras)' + E + '\\s*)', 'iu');
const LIST_SEPARATOR = /^\s*(?:[,:]|y|e)\s*$/i;
const CONTINUES_RE = new RegExp('^(?:(que)|si)' + E, 'iu');
const MAX_SENTENCES = 6;

// Niveles de cobertura: 0 nada, 1 pedido o consulta (stock, entrega por venir), 2 atribuido (todo).
function keepSentence(sentence: string): boolean {
  const parts = sentence.split(CLAUSE_SPLIT);
  let prev = 0;
  let carry = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i].replace(/^[^\p{L}\p{N}]+/u, '').replace(NOT_STOCK_RE, blank).replace(NOT_PAID_RE, blank);
    const chain = i > 0 && LIST_SEPARATOR.test(parts[i - 1]) ? Math.min(prev, 1) : 0;
    const listed = chain > 0 && !(parts[i + 1] ?? '').includes(':') && BARE_STOCK_RE.test(clause.replace(/[^\p{L}\p{N}]+$/u, '').trim());
    const continues = CONTINUES_RE.exec(clause);
    const inherited = Math.max(carry, !continues ? 0 : continues[1] ? (prev === 2 ? 2 : 0) : Math.min(prev, 1));
    const said = SAYS_START_RE.test(clause) ? 0 : clause.search(ATTRIBUTION_RE);
    const asks = [...clause.matchAll(REQUEST_RE)].map((m) => (m.index ?? 0) + m[0].length);
    // Entre el pedido mas cercano y el hecho: sin "que" y con lo que pide cada tipo de hecho.
    const askedFor = (at: number, ok: (between: string) => boolean) => {
      const end = asks.filter((a) => a <= at).pop();
      return end !== undefined && !QUE_RE.test(clause.slice(end, at)) && ok(clause.slice(end, at));
    };
    const covered = (re: RegExp, level: number, ok: (between: string) => boolean = () => false) => [...clause.matchAll(re)]
      .every((m) => inherited >= level || (said >= 0 && said < (m.index ?? 0)) || (level === 1 && askedFor(m.index ?? 0, ok)));
    const isQuestion = (between: string) => QUESTION_RE.test(between);
    if (!covered(FACT_RE, 2) || !covered(STOCK_RE, 1, isQuestion) || !covered(DELIVERY_RE, 1, isQuestion)) return false;
    if (!covered(ORDER_RE, 1, () => true)) return false;
    if (!listed && !covered(STOCK_WORD_RE, 1, (between) => COMPLEMENT_RE.test(between) || isQuestion(between))) return false;
    const company = [...clause.matchAll(COMPANY_CLIENT_RE)].filter((m) => !PROPER_NAME_RE.test(clause.slice((m.index ?? 0) + m[0].length)));
    if (company.some((m) => inherited < 2 && !(said >= 0 && said < (m.index ?? 0)))) return false;
    prev = Math.max(said >= 0 ? 2 : asks.length ? 1 : 0, inherited, chain);
    carry = ATTRIBUTION_END_RE.test(clause.trim()) ? 2 : 0;
  }
  return true;
}

/** [RESUMEN] El resumen sin las frases que afirman hechos sin atribuirlos al cliente. */
export function safeSummary(summary: unknown): string {
  const text = typeof summary === 'string' ? summary.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  const sentences = text.split(/(?<=[.;!?])\s+|;\s*/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_SENTENCES);
  const kept = sentences.filter(keepSentence);
  if (kept.length < sentences.length) console.log('[summary] frases descartadas: ' + (sentences.length - kept.length));
  return kept.join(' ') || SUMMARY_EMPTY;
}
