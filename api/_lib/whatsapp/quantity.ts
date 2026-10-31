// api/_lib/whatsapp/quantity.ts
// [CANTIDAD] PR 2 del plan del bot (B2, B3 y CASO-1): la cantidad es un entero o nada.
// - Antes de buscarla se sacan del texto los correos, enlaces, RUT, telefonos, medidas (120x60),
//   numeros con unidad (15W, 4000K, IP65, 3 m), codigos de modelo, montos, fechas y numeros de
//   pedido.
// - Cuenta si es explicita ("necesito 30", "son 7", "30 paneles", "10 unidades") o si el mensaje
//   contesta una pregunta del bot que la pedia ("20, luz fria").
// - Dos cantidades distintas (varios items, hasta la PR 9) o un numero de algo que no es una
//   unidad ("2 cotizaciones", "2 tipos") la dejan vacia: el bot la pregunta (el "null honesto").
// - El numero de Claude solo vale si el texto lo respalda.
import { removeRuts } from './rutCapture.js';

const MAX_TEXT = 1000;
const MAX_QUANTITY = 100000;

export interface QuantityRead {
  /** Entero entre 1 y 100.000, o nada. */
  value?: number;
  /** La dijo el cliente (o contesta la pregunta por ella): puede reemplazar la ya capturada. */
  explicit: boolean;
  /** [CASO-1] Numero suelto entre 1 y el largo de la lista numerada que el bot acaba de mostrar. */
  menuPick?: number;
  /** Varias cantidades distintas pedidas (varios items): ninguna es "la" cantidad. */
  several?: boolean;
}

export interface QuantityOptions {
  /** RUT que trae el mensaje (rutCapture.inspectRut). */
  ruts?: readonly string[];
  /** La ultima pregunta del bot pidio la cantidad. */
  asked?: boolean;
  /** Items de la lista numerada de esa pregunta (0 si no tenia). */
  menuLength?: number;
  /** Lo que devolvio Claude en "cantidad". */
  claude?: unknown;
}

/** Minusculas y sin tildes, para comparar. */
function plain(text: string): string {
  return text.slice(0, MAX_TEXT).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const UNIT_WORDS_RE = /\b(\d+)\s*(?:unidades|unidad|unids?|unds?|uds?|u|pcs|pzas?)\b\.?/g;

// Lo que nunca es cantidad, en este orden (cada uno se cambia por un espacio).
const NOT_QUANTITY: readonly RegExp[] = [
  /(?:https?:\/\/|www\.)\S*/g,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g,
  // RUT con guion y telefonos (+56 9 1234 5678, 912345678, 9 1234 5678)
  /\b\d{1,2}(?:[.\s]?\d{3}){2}\s*[-\u2010-\u2015\u2212]\s*[\dk]\b/g,
  /\+?56[\s.-]*\d(?:[\s.-]*\d){7,8}/g,
  /\b9[\s.-]?\d{4}[\s.-]?\d{4}\b/g,
  // numeros de pedido, montos, fechas y horas
  /(?:\bn[\u00b0\u00ba]|\bnro\b\.?|\bnumero\b|#)\s*[:.]?\s*\d+/g,
  /\b(?:pedido|orden|factura|boleta|folio|oc|licitacion|id)\s*[:.#]?\s*\d+/g,
  /\$\s*\d[\d.,]*/g,
  /\b\d{1,2}[:/-]\d{1,2}(?:[:/-]\d{2,4})?\b/g,
  // medidas (60x60, 120 x 30 x 8)
  /\b\d+(?:[.,]\d+)?\s*[x\u00d7*]\s*\d+(?:[.,]\d+)?(?:\s*[x\u00d7*]\s*\d+(?:[.,]\d+)?)?/g,
  // marcas de una lista copiada ("1) paneles", "2. fria")
  /(?:^|\n)\s*\d\s*[.)-]\s/g,
  /\b\d\)/g,
  // numeros largos o con dos puntos (RUT sin guion, celulares), decimales
  /\b\d{1,3}(?:\.\d{3}){2,}\b/g,
  /\b\d{6,}\b/g,
  /\b\d+,\d+\b/g,
  /\b\d+\.(?!\d{3}\b)\d+\b/g,
  // numeros con unidad (15W, 4000 K, 3 m, 200 m2, 220V, 1.000 lm, 30%, 90°)
  /\b\d+(?:[.,]\d+)?\s*(?:w|watts?|wats?|kw|k|kelvin|cm|mm|m2|mts?2|m\u00b2|mts?|m|metros?|v|volts?|vac|vdc|lm|lumen(?:es)?|lux|hz|mah|ah|kg|grados?|pulgadas?)(?![a-z])/g,
  /\b\d+(?:[.,]\d+)?\s*(?:\u00b0|%|")/g,
  // grados IP/IK y codigos de modelo (VENUSII08017, BL-200, E27, GU10, T8, 2do)
  /\b(?:ip|ik)\s*\d+/g,
  /\b[a-z]+[-_]?\d[a-z0-9]*(?:[-_/][a-z0-9]+)*/g,
  /\b\d+[a-z][a-z0-9]*/g,
];

// Despues del numero: algo que no son unidades del pedido ("2 cotizaciones", "3 bodegas", "2 dias").
const NOT_UNIT_AFTER_RE = /^\s*(?:cotizacion(?:es)?|tipos?|modelos?|opcion(?:es)?|colou?r(?:es)?|medidas?|potencias?|alternativas?|presupuestos?|consultas?|preguntas?|sucursal(?:es)?|dias?|semanas?|mes(?:es)?|anos?|horas?|hrs?|minutos?|veces|vez|pisos?|salas?|oficinas?|bodegas?|local(?:es)?|casas?|departamentos?|deptos?|ambientes?|habitacion(?:es)?|piezas?|dormitorios?|banos?|canchas?|sector(?:es)?|zonas?|areas?|pasillos?|lineas?|cosas?|productos?|items?|articulos?|personas?|trabajador(?:es)?|proyectos?|obras?|etapas?|fases?|nivel(?:es)?|calles?|mil|millon(?:es)?|pesos|lucas|clp|usd|dolares|uf|cuotas?|puntos?|lugar(?:es)?|espacios?|partes?|version(?:es)?|marcas?|fichas?|catalogos?|ofertas?)\b/;
// Despues del numero: unidades o productos ("30 paneles", "10 unidades", "20 BESTLED").
const UNIT_AFTER_RE = /^\s*(?:unidades|unidad|panel(?:es)?|focos?|reflector(?:es)?|proyector(?:es)?|luminarias?|lamparas?|ampolletas?|tubos?|tiras?|cintas?|downlights?|plafon(?:es)?|campanas?|dicroicos?|apliques?|embutidos?|farol(?:es|as?)?|spots?|riel(?:es)?|modulos?|modulares|equipos?|kits?|bestled|high\s*bay|ufo|lineal(?:es)?|regletas?|tortugas?|luces|leds?|solares)\b/;
// Antes del numero: un pedido ("necesito 30", "son 7", "cotizar unos 20", "cantidad: 12").
const VERB_BEFORE_RE = /\b(?:necesito|necesitamos|necesitaria|necesitariamos|requiero|requerimos|quiero|queremos|quisiera|quisieramos|busco|buscamos|ocupo|ocupamos|cotizar|cotizo|cotizame|cotizarme|comprar|compro|compraria|pedir|llevar|llevo|son|serian|seria|seran|sera|sean|total|cantidad|cant\.?)[\s:=,]*(?:de\s+)?(?:unos|unas|un total de|aprox(?:imadamente)?\.?|alrededor de|como|cerca de|al menos|minimo|maximo|mas o menos)?\s*$/;
// [CASO-1] El mensaje es solo un numero corto ("1", "1.", "la 2", "opcion 3").
const MENU_PICK_RE = /^\s*(?:(?:la|el|opcion|numero)\s+)?(\d{1,2})\s*[).:-]?\s*[.!]?\s*$/;

/** El texto sin lo que nunca es cantidad. */
export function withoutNonQuantities(text: string, ruts: readonly string[] = []): string {
  let out = removeRuts(plain(text), ruts).replace(UNIT_WORDS_RE, '$1 unidades ');
  for (const re of NOT_QUANTITY) out = out.replace(re, ' ');
  return out;
}

/** [B2] Lo que devolvio Claude, solo si es un entero entre 1 y 100.000 ("30", 30, "30 paneles"). */
export function claudeQuantity(value: unknown): number | undefined {
  let n: number | undefined;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const m = plain(value).trim().match(/^(?:(?:aprox(?:imadamente)?\.?|unos|unas)\s*)?(\d{1,3}\.\d{3}|\d+)(?:\s+[a-z]+(?:\s+[a-z]+)*)?\s*$/);
    if (m) n = Number(m[1].replace('.', ''));
  }
  return n !== undefined && Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY ? n : undefined;
}

interface Candidate { value: number; explicit: boolean; }

/** Los numeros que pueden ser la cantidad, con si estan dichos como pedido. */
function candidates(clean: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of clean.matchAll(/\b(\d{1,3}\.\d{3}|\d+)\b/g)) {
    const end = m.index + m[0].length;
    const after = clean.slice(end, end + 40);
    if (NOT_UNIT_AFTER_RE.test(after)) continue;
    const value = Number(m[1].replace('.', ''));
    if (value < 1 || value > MAX_QUANTITY) continue;
    const before = clean.slice(Math.max(0, m.index - 40), m.index);
    out.push({ value, explicit: UNIT_AFTER_RE.test(after) || VERB_BEFORE_RE.test(before) });
  }
  return out;
}

/** La cantidad que trae el mensaje, segun las reglas de arriba. */
export function readQuantity(body: string, options: QuantityOptions = {}): QuantityRead {
  const menu = plain(body).match(MENU_PICK_RE);
  if (menu && options.asked && options.menuLength) {
    const pick = Number(menu[1]);
    if (pick >= 1 && pick <= options.menuLength) return { explicit: false, menuPick: pick };
  }
  const found = candidates(withoutNonQuantities(body, options.ruts));
  const values = [...new Set(found.map((c) => c.value))];
  if (values.length > 1 && (found.some((c) => c.explicit) || options.asked)) return { explicit: false, several: true };
  if (values.length !== 1) return { explicit: false };
  const [value] = values;
  if (found.some((c) => c.explicit) || options.asked) return { value, explicit: true };
  return claudeQuantity(options.claude) === value ? { value, explicit: false } : { explicit: false };
}
