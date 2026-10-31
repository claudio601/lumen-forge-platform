// api/_lib/whatsapp/quantity.ts
// [CANTIDAD] PR 2 del plan del bot (B2, B3 y CASO-1): la cantidad es un entero o nada.
// - Antes de buscarla se sacan del texto los correos, enlaces, RUT, telefonos, direcciones,
//   medidas (120x60), numeros con unidad (15W, 4000K, 3000-4000K, IP65, 3 m, 40 cms), codigos de
//   modelo, montos, fechas y numeros de pedido.
// - Tampoco cuentan un numero que el texto presenta como otro dato ("modelo 50", "presupuesto
//   50000", "piso 3"), uno negado ("no 10") ni uno de algo que no es una unidad ("2 cotizaciones").
// - Cuenta si es explicita ("necesito 30", "son 7", "30 paneles", "10 unidades", "x20") o si el
//   mensaje contesta una pregunta del bot que la pedia ("20, luz fria"). Un mensaje con datos de
//   contacto (RUT o correo) solo trae la explicita: sus otros numeros suelen ser de la direccion.
// - Varias cantidades de items distintos (varios items, hasta la PR 9) la dejan vacia y marcada.
// - El numero de Claude solo vale si el texto lo respalda.
import { removeRuts } from './rutCapture.js';

const MAX_TEXT = 1000;
// 6 digitos o mas nunca son cantidad (RUT sin guion, telefonos): el maximo es coherente con eso.
const MAX_QUANTITY = 99999;

export interface QuantityRead {
  /** Entero entre 1 y 99.999, o nada. */
  value?: number;
  /** La dijo el cliente (o contesta la pregunta por ella): puede reemplazar la ya capturada. */
  explicit: boolean;
  /** [CASO-1] Numero suelto entre 1 y el largo de la lista numerada que el bot acaba de mostrar. */
  menuPick?: number;
  /** Varias cantidades de items distintos (varios items): ninguna es "la" cantidad. */
  several?: boolean;
}

export interface QuantityOptions {
  /** RUT que trae el mensaje (rutCapture.inspectRut). */
  ruts?: readonly string[];
  /** La ultima pregunta del bot pidio la cantidad. */
  asked?: boolean;
  /** Items de la lista numerada de esa pregunta (0 si no tenia). */
  menuLength?: number;
  /** El mensaje trae un correo (ya sacado del texto): solo vale una cantidad explicita. */
  contact?: boolean;
  /** Lo que devolvio Claude en "cantidad". */
  claude?: unknown;
}

/** Minusculas y sin tildes, para comparar. */
function plain(text: string): string {
  return text.slice(0, MAX_TEXT).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Lo que se pide: unidades y productos ("30 paneles", "10 unidades", "20 BESTLED", "4 postes").
const UNIT_NOUNS = '(?:unidades|unidad|panel(?:es)?|focos?|reflector(?:es)?|proyector(?:es)?|luminarias?|lamparas?|ampolletas?|tubos?|tiras?|cintas?|downlights?|plafon(?:es)?|campanas?|dicroicos?|apliques?|embutidos?|farol(?:es|as?)?|spots?|riel(?:es)?|modulos?|modulares|equipos?|kits?|bestled|high\\s*bay|ufo|lineal(?:es)?|regletas?|tortugas?|luces|leds?|solares|postes?|rollos?|protector(?:es)?|senaleticas?|drivers?|letreros?|mangueras?|enchufes?|pantallas?|aros?|marcos?|soportes?|brazos?|sensor(?:es)?|baterias?|huinchas?|transformador(?:es)?|balastos?)';

// "15und", "10 uds", "3 pzas" y los multiplicadores "10x panel" o "panel 18W x 20" pasan a
// "N unidades" (nunca "60x60" ni "120 x 30": son medidas).
const UNIT_WORDS_RE = /\b(\d+)\s*(?:unidades|unidad|unids?|unis?|unds?|uds?|pzas?|pzs|pcs|un(?=\.)|u)\b\.?/g;
const TIMES_BEFORE_RE = /\b(\d{1,5})\s*x(?=\s+[a-z])/g;
const TIMES_AFTER_RE = /(^|[\s(])x\s*(\d{1,5})\b/g;
// Numeros en palabras ("dos paneles", "ciento treinta y dos focos", "una docena de focos"): valen
// seguidos de la unidad o el producto, despues de un verbo de pedido ("necesito veinte") o solos.
// Se lee la expresion entera; si no se entiende, ninguna parte (nunca "32" de "ciento treinta y dos").
// "un panel" no: suele nombrar el producto, y vale solo si Claude tambien dice 1 (ONE_UNIT_RE).
const WORD_PHRASES: Record<string, number> = { 'un par de': 2, 'media docena de': 6, 'una docena de': 12, 'docena de': 12 };
const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900, mil: 1000,
};
const byLength = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join('|');
// "un", "una" y "uno" solo dentro de la expresion ("treinta y un focos"); solos, son el articulo.
const WORD_SPAN_RE = new RegExp('\\b(?:' + byLength(Object.keys(NUMBER_WORDS).filter((w) => !/^un[oa]?$/.test(w))) + ')\\b(?:\\s+(?:y\\s+)?(?:' + byLength(Object.keys(NUMBER_WORDS)) + ')\\b)*', 'g');

/** El valor de una expresion en palabras ("ciento treinta y dos" = 132), o nada si no es un numero bien dicho. */
function wordsValue(span: string): number | undefined {
  const words = span.split(/\s+/);
  let thousands = 0;
  let group = 0;
  // Dentro de cada grupo van centenas, decenas y unidades, en ese orden; "y" solo entre decena y unidad.
  let next = 3;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === 'y') {
      const tens = NUMBER_WORDS[words[i - 1]];
      const unit = NUMBER_WORDS[words[i + 1]];
      if (!(tens >= 20 && tens <= 90 && tens % 10 === 0 && unit >= 1 && unit <= 9)) return undefined;
      continue;
    }
    const value = NUMBER_WORDS[word];
    if (value === 1000) {
      if (thousands) return undefined;
      thousands = (group || 1) * 1000;
      group = 0;
      next = 3;
      continue;
    }
    const rank = value >= 100 ? 3 : value >= 10 ? 2 : 1;
    if (rank > next || (word === 'cien' && i < words.length - 1 && words[i + 1] !== 'mil')) return undefined;
    group += value;
    // Despues de 11 a 19 y de 21 a 29 no va unidad ("quince", "veinticinco"); despues de 20 a 90, si.
    next = rank === 3 ? 2 : rank === 2 && value >= 20 && value % 10 === 0 ? 1 : 0;
  }
  const total = thousands + group;
  return total >= 1 ? total : undefined;
}

// Direccion: la calle o avenida con su numero ("Av. Prueba 123"), salvo que el numero sea de un
// producto ("calle con 30 focos"), y el numero de un kilometro, una oficina, un piso o un local.
const STREET_RE = new RegExp('\\b(?:calle|avenida|avda|av|pasaje|psje|pje|camino|ruta|autopista|costanera|alameda)\\.?\\s+(?:(?!(?:con|para|necesito|necesitamos|son|unos|unas|y)\\b)[a-z\'.]+\\s+){0,5}?(?:n[\\u00b0\\u00ba]?\\.?\\s*|#\\s*|numero\\s+)?\\d+\\b(?!\\s*' + UNIT_NOUNS + ')(?:\\s*,?\\s*(?:of|oficina|local|bodega|depto|dpto|departamento|casa|piso|block|torre|lote|parcela|sitio)\\.?\\s*(?:n[\\u00b0\\u00ba]\\.?\\s*|#\\s*|nro\\.?\\s*)?\\d+[a-z]?\\b)*', 'g');
const WORD_PHRASE_RE = new RegExp('\\b(' + Object.keys(WORD_PHRASES).join('|') + ')\\s+(?=' + UNIT_NOUNS + '\\b)', 'g');
const UNIT_NEXT_RE = new RegExp('^\\s+' + UNIT_NOUNS + '\\b');
const ONE_UNIT_RE = new RegExp('\\b(?:un|una)\\s+' + UNIT_NOUNS + '\\b');
const PLACE_NUMBER_RE = new RegExp('\\b(?:(?:km|kilometro|parcela|lote|sitio|manzana|mz|block|blk|torre|depto|dpto|of|piso)\\.?\\s*(?:n[\\u00b0\\u00ba]\\.?\\s*|#\\s*|nro\\.?\\s*|numero\\s*)?|(?:oficina|local|bodega|casa|galpon|nave|departamento)\\s*(?:n[\\u00b0\\u00ba]\\.?\\s*|#\\s*|nro\\.?\\s*|numero\\s*))\\d+[a-z]?\\b(?!\\s*' + UNIT_NOUNS + ')', 'g');

const URL_RE = /(?:https?:\/\/|www\.)\S*/g;
// Empieza donde empieza la palabra: sin eso, un texto largo sin "@" se recorre una vez por letra.
const EMAIL_RE = /(?<![a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
const RUT_DASH_RE = /\b\d{1,2}(?:[.\s]?\d{3}){2}\s*[-\u2010-\u2015\u2212]\s*[\dk]\b/g;
const MONTHS = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
// Numeros de documentos ("pedido 4521", "cotizacion n 88", "licitacion 1234"), salvo "cotizacion 30 focos".
const DOCUMENT_NUMBER_RE = new RegExp('\\b(?:pedido|orden|factura|boleta|folio|oc|licitacion|cotizacion|ticket|caso|solicitud|reclamo|id)\\s*[:.#]?\\s*(?:n[\\u00b0\\u00ba]\\.?\\s*)?\\d+\\b(?!\\s*' + UNIT_NOUNS + ')', 'g');
// Chips LED (tira 5050, SMD 2835).
const LED_CHIP_RE = new RegExp('\\b(?:smd\\s*)?(?:5050|2835|3528|5630|5730|2216|3014|4014)\\b(?!\\s*' + UNIT_NOUNS + ')', 'g');
// [CASO-1] Marcas de una lista contestada en una linea ("1: paneles 2: fria 3: 20", "1. paneles, 2. fria"):
// se quitan si hay dos o mas seguidas (tambien "2: fria 3: 20", si contesta solo lo que faltaba).
const INLINE_MARK_RE = /(^|[\s,;])([1-9])\s*(?:[.):]\s*-?|-)\s+/g;

// Lo que nunca es cantidad, en este orden (cada uno se cambia por un espacio).
const NOT_QUANTITY: readonly RegExp[] = [
  // RUT con guion y telefonos (+56 9 1234 5678, +56 32 212 3456, 912345678, (9) 0000 1234)
  RUT_DASH_RE,
  /\+?56(?:[\s.()-]*\d){8,9}/g,
  /\(\s*\d{1,2}\s*\)\s*\d{3,4}[\s.-]?\d{4}/g,
  /\b[29][\s.-]?\d{4}[\s.-]?\d{4}\b/g,
  /\b\d{2}[\s.-]\d{3}[\s.-]\d{4}\b/g,
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{3}\b/g,
  /\b\d{4}[\s.-]\d{4}\b/g,
  // IDs de licitacion de Mercado Publico (1234-56-LE26)
  /\b\d{3,5}-\d{1,4}-[a-z]{1,3}\d{1,3}\b/g,
  // direcciones: el bloque "Direccion: ..." hasta el dato siguiente, la calle y el numero de un
  // lugar ("of. 12", "km 5", "local n 3"), y numeros con letra ("45-b")
  /\bdireccion[^:\n]{0,30}:[^\n]*?(?=\b(?:correo|e-?mail|mail|contacto|fono|telefono|tel|celular|giro|rut|razon social|nombre|comuna|ciudad|region)\b|\n|$)/g,
  STREET_RE,
  PLACE_NUMBER_RE,
  /\b\d+-[a-z]\b/g,
  // el numero de una razon social ("Comercial 25 SpA")
  /\b\d+\s+(?:spa|ltda|limitada|eirl|s\.a)\b\.?/g,
  // numeros de pedido, montos, fechas y horas
  /(?:\bn[\u00b0\u00ba]|\bnro\b\.?|\bnumero\b|#)\s*[:.]?\s*\d+/g,
  DOCUMENT_NUMBER_RE,
  /\$\s*\d[\d.,]*/g,
  /\b\d{1,2}[:/-]\d{1,2}(?:[:/-]\d{2,4})?\b/g,
  new RegExp('\\b\\d{1,2}\\s+de\\s+' + MONTHS + '\\b', 'g'),
  new RegExp('\\b' + MONTHS + '\\s+(?:de\\s+|del\\s+)?\\d{2,4}\\b', 'g'),
  /\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+\d{1,2}\b/g,
  /\b(?:de|del|en|el|ano|hasta|desde|antes\s+de|fines\s+de)\s+(?:19|20)\d{2}\b/g,
  // medidas (60x60, 120 x 30 x 8, 60 por 60), casquillos con espacio (E 27, GU 10) y chips LED
  /\b\d+(?:[.,]\d+)?\s*[x\u00d7*]\s*\d+(?:[.,]\d+)?(?:\s*[x\u00d7*]\s*\d+(?:[.,]\d+)?)?/g,
  /\b\d+(?:[.,]\d+)?\s+por\s+\d+(?:[.,]\d+)?\b/g,
  /\b(?:e\s(?:27|14|40|12)|gu\s(?:10|5\.3)|mr\s(?:16|11)|ar\s111|t\s(?:5|8|12)|g\s(?:13|9|4|24))\b/g,
  LED_CHIP_RE,
  /\b\d+\s*leds?\s*(?:\/|x|por)\s*(?:m|mts?|mtrs?|metros?)\b/g,
  // marcas de una lista copiada ("1) paneles", "2. fria")
  /(?:^|\n)\s*\d\s*(?:[.)]\s*-?|-)\s/g,
  /\b\d\)/g,
  // numeros largos o con dos puntos (RUT sin guion, celulares), decimales
  /\b\d{1,3}(?:\.\d{3}){2,}\b/g,
  /\b\d{6,}\b/g,
  /\b\d+,\d+\b/g,
  /\b\d+\.(?!\d{3}\b)\d+\b/g,
  // numeros con unidad, tambien en rango (15W, 4000 K, 3000-4000K, 3 m, 40 cms, 200 m2, 220V, 30%)
  /\b\d+(?:[.,]\d+)?(?:\s*[-/\u2013]\s*\d+(?:[.,]\d+)?)?\s*(?:w|watts?|wats?|whatts?|watt|vatios?|wts?|kw|kwh|kva|kv|k|kelvin|cm|cms|cmts?|ctms?|centimetros?|mm|mms|milimetros?|m2|mt2|mts?2|m\u00b2|mts?|mtrs?|m|metros?|v|volts?|vac|vdc|lm|lms|lumen(?:es|s)?|kelvins?|lux|hz|mah|ah|kg|kilos?|lts?|litros?|grados?|pulgadas?|pulg)(?![a-z])/g,
  /\b\d+(?:[.,]\d+)?\s*(?:\u00b0|\u00ba|%|")/g,
  // grados IP/IK y codigos de modelo (VENUSII08017, BL-200, E27, GU10, T8, 2do)
  /\b(?:ip|ik)\s*\d+/g,
  /\b[a-z]+[-_]?\d[a-z0-9]*(?:[-_/][a-z0-9]+)*/g,
  /\b\d+[a-z][a-z0-9]*/g,
];

// Despues del numero: algo que no son unidades del pedido ("2 cotizaciones", "3 bodegas", "2 dias").
const NOT_UNIT_AFTER_RE = /^\s*(?:cotizacion(?:es)?|tipos?|modelos?|opcion(?:es)?|colou?r(?:es)?|medidas?|potencias?|alternativas?|presupuestos?|consultas?|preguntas?|sucursal(?:es)?|dias?|semanas?|mes(?:es)?|anos?|horas?|hrs?|minutos?|veces|vez|pisos?|salas?|oficinas?|bodegas?|local(?:es)?|casas?|departamentos?|deptos?|ambientes?|habitacion(?:es)?|piezas?|dormitorios?|banos?|canchas?|sector(?:es)?|zonas?|areas?|pasillos?|lineas?|cosas?|productos?|items?|articulos?|personas?|trabajador(?:es)?|proyectos?|obras?|etapas?|fases?|nivel(?:es)?|calles?|galpon(?:es)?|naves?|edificios?|tiendas?|terrazas?|patios?|jardin(?:es)?|estacionamientos?|colegios?|recintos?|sedes?|faenas?|torres?|blocks?|bloques?|plantas?|comunas?|ciudades|regiones|mil|millon(?:es)?|pesos|lucas|clp|usd|dolares|uf|cuotas?|puntos?|lugar(?:es)?|espacios?|partes?|version(?:es)?|marcas?|fichas?|catalogos?|ofertas?)\b/;
// Despues del numero: unidades o productos ("30 paneles", "10 unidades", "20 BESTLED").
const UNIT_AFTER_RE = new RegExp('^\\s*(' + UNIT_NOUNS + ')\\b');
// "20 piezas de panel", "5 articulos de tubos": la pieza o el articulo es del producto.
const GENERIC_OF_UNIT_RE = new RegExp('^\\s*(?:piezas?|articulos?|productos?|items?)\\s+(?:de\\s+)?(?:(?:el|la|los|las|este|estos|ese|esos)\\s+)?' + UNIT_NOUNS + '\\b');
// "tubos de 120", "plafones led de 18": el numero despues del producto y "de" es su medida o potencia.
// Tambien los numeros que la siguen ("tubos de 120 y 60").
const SPEC_OF_BEFORE_RE = new RegExp('\\b' + UNIT_NOUNS + '(?:\\s+[a-z]+){0,2}\\s+de\\s*(?:\\d+\\s*(?:y|o|,|\\/)\\s*)*$');
// Antes del numero: un pedido ("necesito 30", "son 7", "cotizar unos 20", "cantidad: 12", "sino 10").
const VERB_BEFORE_RE = /(?:\b(?:necesito|necesitamos|necesitaria|necesitariamos|requiero|requerimos|quiero|queremos|quisiera|quisieramos|busco|buscamos|ocupo|ocupamos|cotizar|cotizo|cotizame|cotizarme|comprar|compro|compraria|pedir|llevar|llevo|son|eran|serian|seria|seran|sera|sean|total|cantidad|cant\.?|sino|mejor|corrijo|corrigo|correccion|ahora|perdon|(?:cambio|cambiar|cambia|cambiamos|subir|sube|subo|bajar|baja|bajo|aumentar|aumenta|reducir|reduce)\s+(?:(?:la|el)\s+(?:cantidad|total|pedido)\s+)?a|cantidad\s+(?:a|en))[\s:=,]*(?:de\s+)?(?:unos|unas|un total de|aprox(?:imadamente)?\.?|alrededor de|como|cerca de|al menos|minimo|maximo|mas o menos)?|(?:^|[\s,.;:])(?:unos|unas|aprox(?:imadamente)?\.?|alrededor de|cerca de|mas o menos))\s*$/;
// Antes del numero: otro dato ("modelo 50", "presupuesto clp 50000", "potencia de 24", "fono 1234").
const OTHER_DATUM_BEFORE_RE = /\b(?:modelo|mod|codigo|cod|ref|referencia|sku|serie|potencia|vatios|watts|presupuesto|precio|valor|monto|costo|clp|usd|uf|fono|telefono|tel|cel|celular|movil|whatsapp|wsp|rut|altura|largo|ancho|alto|diametro|distancia|superficie|temperatura|voltaje|tension|cri|irc|ra|lumenes|flujo|chip|smd|ano)\.?\s*(?:(?:de|del|es|era|seria|sera|son|el|la|los|las|un|una|unos|unas|como|hasta|sobre|cerca\s+de|alrededor\s+de|mas\s+o\s+menos|maximo|minimo|total)\s+|>\s*|=\s*|:\s*|n[\u00b0\u00ba]\.?\s*|#\s*|nro\.?\s*|aprox(?:imado|imadamente)?\.?\s*)*(?:\d+\s*(?:y|o|,|\/)\s*)*$/;
// Antes del numero: una negacion ("son 7, no 10", "ni 20").
const NEGATED_BEFORE_RE = /(?:\b(?:no|ni|tampoco)\s+(?:(?:son|eran|serian|era|es|necesito|necesitamos|quiero|queremos)\s+)?|\ben\s+(?:vez|lugar)\s+de\s+)$/;
// Despues del numero: la cantidad que corrige ("eran 25, no 20", "25 en vez de 20").
const CORRECTION_AFTER_RE = /^\s*,?\s*(?:y\s+)?(?:no\s+\d|en\s+(?:vez|lugar)\s+de\b)/;
// Junto a otra cantidad: "30 paneles y 20 de 24W", "entre 20 y 30", "20 o 30 focos".
const CHAIN_BEFORE_RE = /(?:\by|,|;|\+|\bmas|\bademas|\btambien|\bentre|\botr[oa]s?)\s*$/;
const CHAIN_AFTER_RE = /^\s*(?:y|o|a|al|hasta|\+|,)\s*\d/;
// Una cantidad por item ("10 de cada modelo", "5 c/u"): varios items.
const PER_ITEM_RE = /\b(?:de\s+cada\s+(?:un[oa]|modelo|tipo|color|producto|medida|potencia|item)|cada\s+un[oa]|c\/u|por\s+(?:cada\s+)?(?:modelo|tipo|color))\b/;
// La respuesta a la pregunta por la cantidad es "uno" ("solo una", "uno nomas").
const ONE_ANSWER_RE = /^\s*(?:(?:necesito|quiero|solo|solamente|nada\s+mas|es|seria|sera)\s+)*un[oa](?:\s+(?:solo|sola|nomas|nada\s+mas|no\s+mas))?\s*[.!]*\s*$/;
// [CASO-1] El mensaje es solo un numero corto ("1", "1.", "la 2", "opcion 3").
const MENU_PICK_RE = /^\s*(?:(?:la|el|opcion|numero)\s+)?(\d{1,2})\s*[).:-]?\s*[.!]?\s*$/;
// [CASO-1] Una eleccion de la lista ("la opcion 2", "me referia a la 1", "el 3"): nunca es la cantidad.
const SELECTION_RE = new RegExp('^\\s*(?:me\\s+referia\\s+a\\s+(?:la\\s+|el\\s+)?(?:opcion\\s+|numero\\s+)?|(?:la|el)\\s+(?:opcion\\s+|numero\\s+)?|(?:opcion|numero|alternativa)\\s+)(\\d{1,2})\\b(?!\\s*' + UNIT_NOUNS + ')');

/** [NO-PISAR] El texto nombra una unidad o un producto ("tambien necesito 10 focos"). */
export function mentionsItem(text: string): boolean {
  return new RegExp('\\b' + UNIT_NOUNS + '\\b').test(plain(text));
}

/** El texto sin lo que nunca es cantidad. */
export function withoutNonQuantities(text: string, ruts: readonly string[] = []): string {
  let out = removeRuts(plain(text), ruts).replace(URL_RE, ' ').replace(EMAIL_RE, ' ')
    .replace(WORD_PHRASE_RE, (all: string, words: string) => WORD_PHRASES[words] + ' ')
    .replace(WORD_SPAN_RE, (span: string, offset: number, s: string) => {
      const counts = UNIT_NEXT_RE.test(s.slice(offset + span.length)) || VERB_BEFORE_RE.test(s.slice(Math.max(0, offset - 40), offset))
        || (!s.slice(0, offset).trim() && /^[\s.!,]*$/.test(s.slice(offset + span.length)));
      if (!counts) return span;
      const value = wordsValue(span);
      return value === undefined ? ' ' : ' ' + value + ' ';
    })
    .replace(UNIT_WORDS_RE, '$1 unidades ')
    .replace(TIMES_BEFORE_RE, '$1 unidades ')
    .replace(TIMES_AFTER_RE, (all: string, lead: string, n: string, offset: number, s: string) =>
      /\d/.test(s.slice(0, offset).trimEnd().slice(-1)) ? all : lead + n + ' unidades ');
  const marks = [...new Set([...out.matchAll(INLINE_MARK_RE)].map((m) => Number(m[2])))].sort((a, b) => a - b);
  if (marks.length >= 2 && marks.every((n, i) => i === 0 || n === marks[i - 1] + 1)) out = out.replace(INLINE_MARK_RE, '$1 ');
  for (const re of NOT_QUANTITY) out = out.replace(re, ' ');
  return out;
}

/** [B2] Lo que devolvio Claude, solo si es un entero entre 1 y 99.999 ("30", 30, "30 paneles"). */
export function claudeQuantity(value: unknown): number | undefined {
  let n: number | undefined;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const m = plain(value).trim().match(/^(?:(?:aprox(?:imadamente)?\.?|unos|unas)\s*)?(\d{1,3}\.\d{3}|\d+)(?:\s+[a-z]+(?:\s+[a-z]+)*)?\s*$/);
    if (m) n = Number(m[1].replace('.', ''));
  }
  return n !== undefined && Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY ? n : undefined;
}

interface Candidate {
  value: number;
  /** Dicha como pedido: con su unidad o producto despues, o un verbo de pedido antes. */
  explicit: boolean;
  /** El producto que la sigue, para distinguir items ("2 postes + 2 focos"). */
  item?: string;
  /** Pegada a otra cantidad ("y 20", "20 o 30"). */
  chained: boolean;
}

/** Los numeros que pueden ser la cantidad, con si estan dichos como pedido. */
function candidates(clean: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of clean.matchAll(/\b(\d{1,3}\.\d{3}|\d+)\b/g)) {
    const end = m.index + m[0].length;
    const after = clean.slice(end, end + 40);
    const before = clean.slice(Math.max(0, m.index - 40), m.index);
    const unit = after.match(UNIT_AFTER_RE);
    const ofUnit = unit !== null || GENERIC_OF_UNIT_RE.test(after);
    const verb = VERB_BEFORE_RE.test(before);
    if (!ofUnit && (NOT_UNIT_AFTER_RE.test(after) || OTHER_DATUM_BEFORE_RE.test(before))) continue;
    if (!ofUnit && !verb && SPEC_OF_BEFORE_RE.test(before)) continue;
    if (NEGATED_BEFORE_RE.test(before)) continue;
    const value = Number(m[1].replace('.', ''));
    if (value < 1 || value > MAX_QUANTITY) continue;
    const item = unit && !unit[1].startsWith('unidad') ? unit[1].replace(/\s+/g, '').slice(0, 4) : undefined;
    out.push({ value, explicit: ofUnit || verb || CORRECTION_AFTER_RE.test(after), item, chained: CHAIN_BEFORE_RE.test(before) || CHAIN_AFTER_RE.test(after) });
  }
  return out;
}

/** La cantidad que trae el mensaje, segun las reglas de arriba. */
export function readQuantity(body: string, options: QuantityOptions = {}): QuantityRead {
  const text = plain(body);
  const selection = text.match(SELECTION_RE);
  const menu = text.match(MENU_PICK_RE) ?? selection;
  if (menu && options.menuLength) {
    const pick = Number(menu[1]);
    if (pick >= 1 && pick <= options.menuLength) return { explicit: false, menuPick: pick };
  }
  if (selection) return { explicit: false };
  const contact = Boolean(options.contact || options.ruts?.length || new RegExp(RUT_DASH_RE.source).test(text));
  const asked = Boolean(options.asked) && !contact;
  if (asked && ONE_ANSWER_RE.test(text)) return { value: 1, explicit: true };
  const clean = withoutNonQuantities(body, options.ruts);
  const found = candidates(clean);
  const explicit = found.filter((c) => c.explicit);
  const values = new Set(explicit.map((c) => c.value));
  const items = new Set(explicit.flatMap((c) => (c.item ? [c.item] : [])));
  const chainedLoose = found.some((c) => !c.explicit && c.chained);
  if (values.size > 1 || items.size > 1 || (values.size === 1 && (chainedLoose || PER_ITEM_RE.test(clean)))) return { explicit: false, several: true };
  if (values.size === 1) return { value: [...values][0], explicit: true };
  const loose = [...new Set(found.map((c) => c.value))];
  if (asked && loose.length === 1) return { value: loose[0], explicit: true };
  if (asked && loose.length > 1 && chainedLoose) return { explicit: false, several: true };
  if (!found.length && claudeQuantity(options.claude) === 1 && ONE_UNIT_RE.test(clean)) return { value: 1, explicit: false };
  return loose.length === 1 && claudeQuantity(options.claude) === loose[0] ? { value: loose[0], explicit: false } : { explicit: false };
}
