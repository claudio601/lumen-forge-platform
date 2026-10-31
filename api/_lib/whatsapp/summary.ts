// api/_lib/whatsapp/summary.ts
// [RESUMEN] El resumen que redacta Claude es una interpretacion, no un dato: una frase que afirma una
// compra, un pago, el stock, un pedido confirmado, un despacho o el historial del cliente se bota si
// no va atribuida al cliente ("El cliente dice que ya compro" queda; "Cliente ya compro" no). Si no
// queda nada, la nota remite a la transcripcion.

export const SUMMARY_EMPTY = 'Ver la transcripci\u00f3n.';

// Limites de palabra que entienden las tildes: "\b" corta "compro" despues de la "r".
const W = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
// Hechos que el resumen no puede afirmar. "Pedido de 20 paneles" (la solicitud) no es un hecho; "su
// pedido", "pedido pagado" o "pedido anterior" si. Los sustantivos de un pedido ("formas de pago",
// "despacho", "deposito", "transferencia") tampoco: solo el verbo en pasado o el participio.
const FACT_RE = new RegExp(W + '(?:' + [
  'compr(?:\u00f3|o|aron|ad[oa]s?)',
  'compras?\\s+(?:anterior(?:es)?|previas?|realizadas?|hechas?)',
  'su\\s+compra',
  'adquiri(?:\u00f3|o|eron)|adquirid[oa]s?',
  'pag(?:\u00f3|aron|ad[oa]s?)',
  'abon(?:\u00f3|aron|ad[oa]s?)',
  'transfiri(?:\u00f3|o|eron)',
  'deposit(?:\u00f3|aron|ad[oa]s?)',
  'factur(?:\u00f3|ad[oa]s?)|boletead[oa]s?',
  'stock|inventario|en\\s+existencia',
  'disponibles?|hay\\s+disponibilidad|tienen\\s+disponibilidad',
  'su\\s+pedido|sus\\s+pedidos|pedidos?\\s+(?:anterior(?:es)?|previos?|confirmad[oa]s?|pagad[oa]s?|despachad[oa]s?|entregad[oa]s?|en\\s+curso|pendientes?|realizad[oa]s?|hechos?)',
  'orden(?:es)?\\s+de\\s+compra',
  'despach(?:\u00f3|aron|ad[oa]s?)|entreg(?:\u00f3|aron|ad[oa]s?)|recibi(?:\u00f3|o|eron)',
  'confirmad[oa]s?|reservad[oa]s?',
  'historial|ya\\s+es\\s+cliente|client[ea]\\s+(?:frecuente|habitual|antigu[oa]|recurrente|de\\s+(?:la\\s+)?(?:tienda|empresa))',
].join('|') + ')' + E, 'iu');
// Lo que dice o pregunta el cliente: "El cliente dice/indica/pregunta...", "Cliente indica que...",
// "Segun el cliente, ...", "Consulta disponibilidad..." o "Pregunta si...". "Quiere", "pide" o
// "necesita" no atribuyen: "El cliente quiere retirar su pedido ya pagado" afirma el pago.
const ATTRIBUTED_RE = new RegExp('^(?:seg(?:\u00fa|u)n\\s+(?:el\\s+|la\\s+)?client[ea]' + E + '|(?:(?:el|la)\\s+)?client[ea]\\s+'
  + '(?:dice|indica|se(?:\u00f1|n)ala|afirma|asegura|cuenta|comenta|menciona|informa|declara|sostiene|escribe|pregunta|consulta)' + E
  + '|(?:consulta|pregunta)' + E + ')', 'iu');
const MAX_SENTENCES = 6;

/** [RESUMEN] El resumen sin las frases que afirman hechos sin atribuirlos al cliente. */
export function safeSummary(summary: unknown): string {
  const text = typeof summary === 'string' ? summary.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  const sentences = text.split(/(?<=[.;!?])\s+|;\s*/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_SENTENCES);
  const kept = sentences.filter((s) => !FACT_RE.test(s) || ATTRIBUTED_RE.test(s.replace(/^[^\p{L}]+/u, '')));
  if (kept.length < sentences.length) console.log('[summary] frases descartadas: ' + (sentences.length - kept.length));
  return kept.join(' ') || SUMMARY_EMPTY;
}
