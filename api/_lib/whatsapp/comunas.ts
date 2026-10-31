// api/_lib/whatsapp/comunas.ts
// [COMUNA] La comuna que el cliente da, solo de la lista oficial (comunas.generated.ts) y solo cuando
// el texto la presenta como lugar: despues de una frase de ubicacion ("en Lampa", "para una bodega en
// Lampa", "soy de Maipu", "despacho a Temuco") o como respuesta a la pregunta por la comuna ("Lampa",
// "Maipu, Region Metropolitana"). Antes cualquier palabra de una lista de 29 ciudades, o la que
// devolviera Claude, pasaba por comuna: "santiago.prueba@...", "Av. Santiago Bueras 1234" o la
// "direccion de retiro" (Retiro es una comuna del Maule).
// Cada aparicion se clasifica por su clausula: la de la factura o la empresa va aparte (billing); la de
// un retiro, una sucursal o un local de la tienda, la de una razon social y la que ya no vale ("antes era
// en Lampa") no cuentan.
import { COMUNAS } from './comunas.generated.js';

/** Nombres alternativos que la gente escribe (y los que la fuente traia mal). */
const ALIASES: Record<string, string> = {
  'santiago centro': 'Santiago',
  'santiago de chile': 'Santiago',
  'stgo': 'Santiago',
  'stgo centro': 'Santiago',
  'coihaique': 'Coyhaique',
  'paiguano': 'Paihuano',
  'trehuaco': 'Treguaco',
  'la calera': 'Calera',
  'vichuque': 'Vichuqu\u00e9n',
  'til til': 'Tiltil',
  'llay llay': 'Llaillay',
  'marchigue': 'Marchihue',
  'aisen': 'Ays\u00e9n',
  'puerto aysen': 'Ays\u00e9n',
  'puerto aisen': 'Ays\u00e9n',
  'rapa nui': 'Isla de Pascua',
  'puerto natales': 'Natales',
  'vina': 'Vi\u00f1a del Mar',
  'valpo': 'Valpara\u00edso',
  'conce': 'Concepci\u00f3n',
  'pto montt': 'Puerto Montt',
  'pto varas': 'Puerto Varas',
  'pta arenas': 'Punta Arenas',
  'chol chol': 'Cholchol',
  'san jose de la mariquina': 'Mariquina',
};

// Comunas que tambien son palabras comunes ("la granja", "nogales", "caldera"): fuera de la respuesta
// a la pregunta por la comuna, cuentan solo si llevan alguna mayuscula ("en Victoria", "la Granja") o
// despues de un lugar de obra ("una bodega en victoria").
const COMMON_WORD = new Set([
  'Retiro', 'Primavera', 'Navidad', 'Porvenir', 'Victoria', 'Florida', 'Independencia', 'Recoleta', 'Placilla',
  'Coronel', 'Corral', 'Olivar', 'El Monte', 'La Granja', 'La Estrella', 'La Uni\u00f3n', 'Los Lagos', 'R\u00edo Verde',
  'Laguna Blanca', 'La Cruz', 'Nogales', 'Camarones', 'Pica', 'Mejillones', 'Caldera', 'La Higuera', 'Vicu\u00f1a',
  'Canela', 'Calle Larga', 'Rinconada', 'Cabildo', 'Algarrobo', 'Paredones', 'Constituci\u00f3n', 'Empedrado',
  'Molina', 'Pinto', 'Cabrero', 'Laja', 'Lota', 'Teno', 'El Carmen', 'Sagrada Familia', 'Yerbas Buenas',
  'Villa Alegre', 'Romeral', 'Nacimiento', 'Negrete', 'Portezuelo', 'Lago Verde', 'Cisnes', 'Salamanca', 'Calera',
]);
// Las que casi siempre son otra cosa ("direccion de retiro", "para Navidad", "en primavera"): solo como
// respuesta a la pregunta por la comuna o despues de "comuna de". Retiro y Porvenir valen tambien
// despues de un lugar de obra ("una bodega en Retiro"); una fecha no ("la casa en Navidad").
const ANSWER_ONLY = new Set(['Retiro', 'Navidad', 'Primavera', 'Porvenir']);
const SEASON = new Set(['Navidad', 'Primavera']);
// "retiro en Quinta Normal", "retiro de pedido": la palabra, no la comuna.
const ANSWER_ONLY_AFTER_RE = /^\s+(?:en|de|del|desde|por|a|al)(?![\p{L}])/iu;
// Alias que tambien son palabras comunes ("una vina", "la calera"): igual que COMMON_WORD.
const COMMON_ALIAS = new Set(['vina', 'la calera']);

/** Minusculas, sin tildes, sin apostrofes ni puntos, y con un espacio entre palabras. */
export function comunaKey(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['\u2019\u00b4`]/g, '').replace(/[.-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const BY_KEY = new Map<string, string>();
for (const [, name] of COMUNAS) BY_KEY.set(comunaKey(name), name);
for (const [alias, name] of Object.entries(ALIASES)) BY_KEY.set(alias, name);

/** El nombre oficial de una comuna escrita sola ("nunoa", "Santiago Centro", "Til Til"), o undefined. */
export function officialComuna(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 60) return undefined;
  return BY_KEY.get(comunaKey(value));
}

// Una alternativa por nombre, de la mas larga a la mas corta: "San Pedro de la Paz" antes que "San
// Pedro" y "La Florida" antes que "Florida". Entre palabras acepta espacios, puntos o guiones ("Pto.
// Montt", "Llay-Llay"), y el apostrofe es opcional ("OHiggins").
const PATTERN = [...BY_KEY.keys()]
  .sort((a, b) => b.length - a.length)
  .map((key) => key.split(' ').map((w) => w.replace(/^o(higgins)$/, "o['\u2019]?$1")).join('[\\s.\\-]+'))
  .join('|');
const COMUNA_RE = new RegExp('(?<![\\p{L}\\p{N}@._/])(?:' + PATTERN + ')(?![\\p{L}\\p{N}@_/]|\\.[\\p{L}\\p{N}])', 'giu');

// La palabra que presenta un lugar justo antes de la comuna ("en", "de", "para", "desde"). "Despacho a" y
// "enviar a" son anclas de obra (OBRA_ANCHOR_RE).
const LOCATION_BEFORE_RE = /(?<![\p{L}])(?:en|de|del|para|desde|hacia|sector)\s+$/iu;
// "Soy de Maipu", "Soy Ana Prueba de Maipu", "somos una constructora de Colina", "vengo de Maipu", "desde Maipu":
// de donde es la persona. Llena la comuna vacia si el mensaje no trae la de la obra, pero no cambia una
// capturada ("una casa en Lampa" sigue siendo la obra). Vale tambien cuando contesta la pregunta por la comuna
// ("Soy de Maipu. La obra es en Lampa." es Lampa).
const ORIGIN_BEFORE_RE = /(?:(?<![\p{L}])(?:soy|somos|vengo|venimos)(?:\s+(?!(?:y|e|o|pero|para|en|que|necesit[\p{L}]*|quier[\p{L}]*|busc[\p{L}]*|requier[\p{L}]*|cotiz[\p{L}]*)(?![\p{L}]))[\p{L}'-]+){0,4}\s+(?:de|del)|(?<![\p{L}])desde)\s+$/iu;
// Un "de" suelto tampoco presenta la obra: casi siempre dice de donde es alguien ("Ana Prueba, de Colina", "mi
// senora es de Colina", "la empresa es de Colina", "un amigo de Colina", "ana prueba de colina"). Cuenta igual que
// el origen: llena la vacia, no cambia la capturada. Si ubican la obra "dentro de Colina" y "la bodega de Lampa"
// (PLACE_OF_RE).
const OF_BEFORE_RE = /(?<![\p{L}])(?:de|del)\s+$/iu;
const INSIDE_OF_RE = /(?<![\p{L}])dentro\s+(?:de|del)\s+$/iu;
// "comuna de", "comuna:", "la comuna es: Lampa", "corrijo la comuna a Temuco", "ciudad: Temuco".
// Tambien con lo que ubica: "Comuna de la obra: Lampa", "Comuna obra: Lampa", "ciudad del despacho: Temuco".
const COMUNA_ANCHOR_RE = /(?<![\p{L}])(?:comuna|ciudad|localidad)(?:\s+(?:(?:de|del)\s+)?(?:(?:la|el)\s+)?(?:obra|instalaci[o\u00f3]n|proyecto|despacho|entrega|faena))?(?:\s+(?:es|ser[i\u00ed]a|queda|a|de|del|en))*(?:\s*:\s*|\s+)$/iu;
// La etiqueta explicita de la obra: "Comuna de la obra:", "Comuna obra:", "ciudad del despacho: Temuco" y, fuera de
// un bloque de la factura (labeledBilling), "Comuna:" o "Ciudad:". Gana a las palabras de factura, retiro o sucursal
// del resto de la clausula ("Comuna: Colina con retiro en su local": el retiro es del local).
const OBRA_LABEL_RE = /(?<![\p{L}])(?:comuna|ciudad|localidad)\s+(?:(?:de|del)\s+)?(?:(?:la|el)\s+)?(?:obra|instalaci[o\u00f3]n|proyecto|despacho|entrega|faena)(?:\s+(?:es|ser[i\u00ed]a|queda|a|de|del|en))*(?:\s*:\s*|\s+)$/iu;
const COMUNA_LABEL_RE = /(?<![\p{L}])(?:comuna|ciudad|localidad)\s*:\s*$/iu;
// Lo que califica a la misma comuna de una etiqueta explicita: "Comuna: Providencia para facturacion", "Comuna:
// Providencia - facturacion", "Comuna: Colina, para facturacion" o "(facturacion)" (la factura); "Comuna: Quinta
// Normal para retiro" o "- retiro" (no cuenta). Tras una coma, solo con la preposicion: "Comuna: Colina, retiro en
// su local" puede ser el retiro en el local.
const LABEL_QUALIFIER_RE = /^\s*(?:[(\-\u2013\u2014/]\s*(?:(?:para|de|del|por|en)\s+)?|,?\s*(?:para|de|del|por)\s+)(?:(?:la|el|su)\s+)?(?:(factur[\p{L}]*|boletas?|casa\s+matriz)|retir[\p{L}]*|sucursal(?:es)?)(?![\p{L}])/iu;
// Una correccion: "Corrijo: Colina", "Correccion: Colina", "Perdon, es Colina", "en realidad es Colina", "mejor
// dicho Colina", "antes dije Lampa pero es Colina", "no es Lampa sino Colina" y, al inicio de la clausula, "No es
// Lampa, es Colina" o "Es Colina, no Lampa" ("era" ahi no: "Era Lampa, ahora es Colina").
const CORRECTION_BEFORE_RE = /(?:(?<![\p{L}])(?:corrijo|corrijan|correcci[o\u00f3]n|perd[o\u00f3]n|disculp[ae]|en\s+realidad|mejor\s+dicho|me\s+equivoqu[e\u00e9])\s*[:,]?(?:\s+(?:ahora|es|era|ser[i\u00ed]a|queda))*|(?<![\p{L}])sino(?:\s+(?:que|es|era|ser[i\u00ed]a|queda|en|para))*|(?<![\p{L}])pero(?:\s+ahora)?\s+(?:es|era|ser[i\u00ed]a|queda)|(?:^|[,;:.!?\n\u00bf\u00a1]|(?<![\p{L}])y)\s*(?:ahora\s+)?(?:es|ser[i\u00ed]a|queda))\s+$/iu;
// El lugar de la obra antes de "en": "una bodega en", "la obra es en", "un galpon nuevo en", "su local en".
const OBRA_NOUN = '(?:obra|proyecto|instalaci[o\\u00f3]n|faena|bodega|galp[o\\u00f3]n|casa|oficina|local|planta|parcela|terreno|condominio|edificio|colegio|escuela|liceo|cancha|f[a\\u00e1]brica|nave|recinto|sede|sucursal|tienda|departamento|depto|patio|jard[i\\u00ed]n|pasaje|calle|plaza|estadio|gimnasio|hotel|restaurante?|iglesia)(?:e?s)?';
// "la obra se encuentra en", "la bodega se ubica en", "la obra estara en" (R8 de la ronda 3).
const OBRA_QUALIFIER = '(?:\\s+(?:es|son|est[a\\u00e1]n?|estar[a\\u00e1]n?|se\\s+(?:encuentra|ubica)n?|queda|quedan|ser[i\\u00ed]an?|ser[a\\u00e1]n?|va|van|ubicad[oa]s?|nuev[oa]s?|tambi[e\\u00e9]n|ahora))*';
const PLACE_ANCHOR_RE = new RegExp('(?<![\\p{L}])' + OBRA_NOUN + '(?:\\s+[\\p{L}]+)?' + OBRA_QUALIFIER + '\\s+en\\s+$', 'iu');
// "la sucursal de Temuco", "la obra de Lampa": el lugar, no de donde es la persona.
const PLACE_OF_RE = new RegExp('(?<![\\p{L}])' + OBRA_NOUN + '(?:\\s+[\\p{L}]+)?\\s+(?:de|del)\\s+$', 'iu');
// La obra justo antes de la comuna gana a las palabras de factura, retiro o sucursal de su clausula: "la
// obra es en", "la obra se encuentra en", "la obra esta dentro de", "instalacion en", "despacho a", "despachar 20 focos a", "enviar los 30 paneles a", "despacho a
// domicilio en", "entregar en", "llevar a", "para una bodega en", "para su oficina en" (la del cliente de un
// instalador). Entre el verbo y "a" van hasta 4 palabras, sin las de tiempo ("llevo 20 anos en") ni las de
// la tienda ("entrega en su tienda en").
const OBRA_ANCHOR_RE = new RegExp('(?:'
  + '(?<![\\p{L}])(?:obra|proyecto|instalaci[o\\u00f3]n|faena)s?' + OBRA_QUALIFIER + '\\s+(?:en|dentro\\s+de)'
  + '|(?<![\\p{L}])instal[\\p{L}]*\\s+(?:(?:el|los|las|la|lo|todo|todos)\\s+)?en'
  + '|(?<![\\p{L}])(?:despach|envi|env\\u00ed|mand|llev|entreg)[\\p{L}]*\\s+(?:(?!(?:a\\u00f1os?|anos?|mes(?:es)?|d[i\\u00ed]as?|semanas?|horas?|tiempo|sus?|tiendas?|locale?s?|sucursal(?:es)?|showroom|retiro)(?![\\p{L}]))[\\p{L}\\p{N}]+\\s+){0,4}(?:a|en|hasta)'
  + '|(?<![\\p{L}])para\\s+(?:(?:un|una|unos|unas|el|la|los|las|mi|mis|su|sus|nuestr[oa]s?)\\s+)?' + OBRA_NOUN + '(?:\\s+[\\p{L}]+)?\\s+en'
  + ')\\s+$', 'iu');
// Donde esta la empresa del cliente, al inicio de su clausula: "Nuestra empresa esta en Colina", "la empresa queda en
// Colina", "y mi empresa se encuentra en Colina". Cuenta como de donde es la persona (origin): llena la vacia solo si el
// mensaje no trae la obra ("Nuestra empresa esta en Colina. La obra esta en Lampa." es Lampa). No "la bodega de la
// empresa esta en Lampa" (el lugar) ni "para una empresa en Colina" (sin el verbo). En una oracion que empieza
// corrigiendo ("Perdon, la empresa esta en Colina") es una correccion: cuenta como lugar, como antes.
const COMPANY_PLACE_RE = /(?:^|(?<![\p{L}])(?:y|e|pero|porque|que))\s*(?:(?:nuestra|mi|la|su|una)\s+)?(?:empresa|compa[n\u00f1][i\u00ed]a)s?(?:\s+(?:est[a\u00e1]n?|queda|quedan|se\s+(?:encuentra|ubica)n?|ubicad[oa]s?))+\s+en\s+$/iu;
const CORRECTION_LEAD_RE = /^\s*(?:corrijo|corrijan|correcci[o\u00f3]n|perd[o\u00f3]n|disculp[ae]|en\s+realidad|mejor\s+dicho|me\s+equivoqu[e\u00e9])(?![\p{L}])/iu;
// Lo que ya no vale o el cliente niega: "antes era en Lampa", "antes dije Lampa", "no es en Lampa", "en vez de Lampa".
const HISTORY_BEFORE_RE = /(?:(?<![\p{L}])(?:antes|anteriormente|originalmente)(?:\s+(?:te|le|les|me|se|lo|la|el|que|era|eran|fue|iba|iban|dije|dijimos|puse|pusimos|escrib[i\u00ed]|escribimos|indiqu[e\u00e9]|ten[i\u00ed]a|ten[i\u00ed]amos|hab[i\u00ed]a|hab[i\u00ed]amos|dicho|puesto|indicado|ser[i\u00ed]a|estaba|quedaba|en|de|para|comuna|obra|es))*|(?<![\p{L}])(?:no|ni)(?:\s+(?:es|era|ser[a\u00e1]|ser[i\u00ed]a|queda|va|fue|est[a\u00e1]))?\s+(?:en|para|de|a)|(?<![\p{L}])en\s+(?:vez|lugar)\s+de)\s+$/iu;
// Lo que puede ir antes de la comuna cuando contesta la pregunta ("Lampa", "Soy de Maipu", "En la comuna de Lampa").
const ANSWER_LEAD_RE = /^(?:(?:hola|ok|si|s\u00ed|bueno|y|soy|somos|estoy|estamos|es|ser[i\u00ed]a|queda|quedar[i\u00ed]a|vivo|desde|en|de|del|la|el|comuna|ciudad|para)\s+)*$/iu;
// Calle o direccion: "Av. Santiago Bueras", "calle Providencia", "pasaje Lampa", "Camino de Lampa".
const STREET_BEFORE_RE = /(?<![\p{L}])(?:av|avda|avenida|calle|pasaje|psje|pje|camino|carretera|autopista|ruta|villa|poblaci[o\u00f3]n|pobl|condominio|parcela|plaza|paseo|esquina|esq)\b\.?\s+(?:(?!(?:en|para|desde|hacia|comuna)\s)[\p{L}'.]+\s+){0,3}$/iu;
// "Providencia 1234", "Santiago Bueras 1234, Lampa", "vicuna mackenna 1234", "Lampa #120", "Lampa Km 8 s/n":
// el numero de una direccion, no una cantidad. Hasta dos palabras de la calle, tambien en minuscula, pero no
// las de un pedido: "en Lampa y son 20", "en Lampa unos 20" o "en Lampa necesito 20" no son una direccion.
const STREET_WORDS_AFTER_RE = /^(?:\s+(?!(?:y|e|o|u|a|al|en|de|del|para|por|con|sin|es|son|eran|ser[i\u00ed]an?|ser[a\u00e1]n?|unos?|unas?|como|aprox[\p{L}]*|cerca|m[a\u00e1]s|menos|total|cantidad|x|necesit[\p{L}]*|quier[\p{L}]*|requier[\p{L}]*|ocup[\p{L}]*|cotiz[\p{L}]*)(?![\p{L}]))[\p{L}][\p{L}'.]*){0,2}/iu;
const STREET_NUMBER_RE = /^\s*(?:(?:#|n[\u00b0\u00ba.]|nro\.?|n[u\u00fa]mero)?\s*\d{1,5}(?=\s*(?:$|[,;.\n)]|-|s\s*\/\s*n(?![\p{L}])|(?:depto|dpto|departamento|of|oficina|piso|casa|local|block|torre|villa|comuna)\b))|(?:km|kil[o\u00f3]metros?)\.?\s*\d|s\s*\/\s*n(?![\p{L}]))/iu;
// "Region de Valparaiso", "Provincia de Santiago", "Gran Santiago": no son la comuna.
const REGION_BEFORE_RE = /(?:regi[o\u00f3]n|provincia|gran)\s+(?:(?:de|del)\s+)?(?:la\s+)?$/i;

// En cualquier parte de la clausula (antes o despues de la comuna):
// - La factura o la casa matriz ("los datos de facturacion son de Vina del Mar"): otra comuna mencionada. El
//   domicilio solo no ("despacho a domicilio", "mi domicilio es en La Florida"); el comercial, legal o tributario si.
const BILLING_RE = /(?<![\p{L}])(?:factur[\p{L}]*|boletas?|domicilio\s+(?:comercial|legal|tributario)|casa\s+matriz|oficina\s+central|raz[o\u00f3]n\s+social|giro)(?![\p{L}])/iu;
//   Salvo el documento: "con factura", "necesito factura", "factura por 20 paneles", "con boleta" ("necesito
//   factura a nombre de la empresa de Las Condes" si es la factura).
const DOCUMENT_RE = /(?<![\p{L}])(?:(?:con|sin|o|necesit[\p{L}]*|quier[\p{L}]*|requier[\p{L}]*|ocup[\p{L}]*|pid[\p{L}]*|emit[\p{L}]*|hac[\p{L}]*|d[ae]n)\s+(?:(?:una|la|el|su)\s+)?(?:factura|boleta)s?(?![\p{L}])(?!(?:\s+(?:electr[o\u00f3]nicas?|exentas?|afectas?))?\s+(?:a\s+nombre|es|sale|va|queda|en|a|al|de(?!\s+\$?\s*\d)|del|desde)(?![\p{L}]))|(?:factura|boleta)s?\s+(?:por\s+(?:favor|\$?\s*\d)|de\s+\$?\s*\d))/giu;
// - Retirar en la bodega o ir a la tienda no es el lugar del cliente: "quiero retirar el pedido en Quinta
//   Normal", "retiro en Quinta Normal", "puedo ir a su local en Maipu?", "en Concepcion tienen sucursal?". La del
//   cliente si ("nuestra sucursal en Temuco", "para la sucursal de Temuco"). Sacar los equipos viejos no es un
//   retiro ("retirar los tubos de una bodega en Lampa"), y con un lugar del cliente justo antes ("de una casa en
//   Lampa") solo cuenta el retiro del pedido.
const PICKUP_RE = /(?<![\p{L}])retir[\p{L}]*/iu;
const PICKUP_ORDER_RE = /(?<![\p{L}])(?:retir[\p{L}]*\s+(?:(?:el|la|los|las|mi|mis|su|sus|nuestr[oa]s?)\s+)?(?:pedidos?|compras?|productos?|mercader[i\u00ed]as?|encargos?)|(?:pas[\p{L}]*|ir|voy|vamos)\s+a\s+retir[\p{L}]*)(?![\p{L}])/iu;
const REMOVAL_RE = /(?<![\p{L}])retir[\p{L}]*\s+(?:del?\s+)?(?:(?:los|las|el|la|unos|unas|todos|todas|\p{N}+)\s+){0,2}(?:equipos?|tubos?|fluorescentes?|luminarias?|l[a\u00e1]mparas?|ampolletas?|hal[o\u00f3]genos?|antiguos?|antiguas?|viej[oa]s?|existentes?)(?![\p{L}])/iu;
const BRANCH_RE = /(?<![\p{L}])(?:(?<!(?:mi|mis|nuestr[oa]s?|una|otra|la|las)\s+)sucursal(?:es)?|showroom|sala\s+de\s+ventas|sus?\s+(?:locale?s?|oficinas?|tiendas?|bodegas?|sucursal(?:es)?)|ir\s+a\s+(?:su|sus|la|el)\s+(?:tienda|local|oficina|bodega)s?|(?:tienen|tendr[a\u00e1]n)\s+(?:una?\s+|alg[u\u00fa]n[ao]?\s+)?(?:tienda|local|oficina|bodega)s?)(?![\p{L}])/iu;
// - En una pregunta, "hay tienda en Maipu?", "donde queda la sucursal de Concepcion?".
const BRANCH_QUESTION_RE = /(?<![\p{L}])(?:hay\s+(?:una?\s+|alg[u\u00fa]n[ao]?\s+)?(?:tienda|local|oficina|bodega)s?|las?\s+sucursal(?:es)?)(?![\p{L}])/iu;
// Corte de clausula: puntuacion o "y", "e", "pero" ("la obra es en Lampa y la facturacion en Vina del Mar").
const CLAUSE_CUT_RE = /[,;.!?\n\u00bf\u00a1()]|(?<![\p{L}])(?:y|e|pero)(?![\p{L}])/giu;
const MAX_CLAUSE = 120;

// Una etiqueta de la factura o la empresa ("Facturacion:", "Datos de facturacion:", "Factura a nombre de:",
// "Cotizacion a nombre de:", "Domicilio comercial:", "Casa matriz:") y, con RUT o razon social en el mensaje,
// "Direccion:" o "Domicilio:": la direccion que la sigue en la oracion es la de la factura ("RUT 11.111.111-1,
// Direccion: Av. Prueba 123, oficina 5, Providencia").
const LABEL_RE = /(?<![\p{L}])(?:((?:datos\s+de\s+)?factur[\p{L}]*(?:\s+a\s+nombre\s+de)?|cotizaci[o\u00f3]n\s+a\s+nombre\s+de|datos\s+de\s+(?:la\s+)?empresa|domicilio\s+(?:comercial|legal|tributario)|casa\s+matriz|oficina\s+central|direcci[o\u00f3]n\s+(?:comercial|tributaria|legal|fiscal|de\s+(?:la\s+)?(?:empresa|facturaci[o\u00f3]n)))|direcci[o\u00f3]n|domicilio)\s*:/giu;
// Lo que corta esa direccion: el fin de la oracion (no el punto de "Av." u "of."), un pedido o una obra.
const ADDRESS_END_RE = /[;!?\n\u00bf\u00a1]|(?<!(?<![\p{L}])(?:av|avda|pje|psje|of|depto|dpto|dto|n|nro|km|pobl?|sta|sto|pto|gral|pdte|dr|esq|int|loc|lt|mz|cond|parc))\.(?=\s|$)|(?<![\p{L}])(?:necesit|quier|busc|requier|ocup|cotiz|obra|proyecto|instal|despach|env[i\u00ed]|entreg|llev|mand)/iu;
// Tras un encabezado de la factura ("Facturacion:", "Casa matriz:") el bloque sigue en varias lineas, un dato por
// linea ("Direccion:", "Comuna:", "Ciudad:", "RUT:", "Giro:", "Correo:"): el salto de linea no lo corta. Lo cortan una
// etiqueta que pasa a la obra, el despacho, la instalacion o la entrega ("Direccion de despacho:", "Comuna de la
// obra:") y, en el texto suelto, el fin de la oracion o un pedido. El valor de un dato no lo corta (R8 de la ronda
// 3): "Giro: Despacho de encomiendas", "Observaciones: requiere factura electronica" o "Giro: Instalaciones
// electricas" siguen en el bloque; lo que sigue al fin de la oracion dentro del valor ("Giro: Comercio. Necesito 20
// paneles") ya es texto suelto, y un pedido en primera persona lo corta igual (VALUE_ORDER_RE).
const SENTENCE_END = '[;!?\\u00bf\\u00a1]|(?<!(?<![\\p{L}])(?:av|avda|pje|psje|of|depto|dpto|dto|n|nro|km|pobl?|sta|sto|pto|gral|pdte|dr|esq|int|loc|lt|mz|cond|parc))\\.(?=\\s|$)';
const BLOCK_END_WORD = '(?<![\\p{L}])(?:necesit|quier|busc|requier|ocup|cotiz(?![\\p{L}]*\\s+a\\s+nombre))'
  + '|(?<![\\p{L}])(?:llev|mand)(?:ar|o|a|an|en|amos)(?![\\p{L}])'
  + '|(?<![\\p{L}])(?:obra|proyecto|instalaci[o\\u00f3]n|despachos?|despachar|entregas?|entregar|faena|env[i\\u00ed]os?|enviar)(?![\\p{L}])';
const BLOCK_END_RE = new RegExp(SENTENCE_END + '|' + BLOCK_END_WORD, 'iu');
const BLOCK_END_WORD_RE = new RegExp(BLOCK_END_WORD, 'iu');
const VALUE_END_RE = new RegExp(SENTENCE_END, 'iu');
// Dentro del valor, el pedido del cliente en primera persona si corta el bloque, tambien sin fin de oracion y en la
// linea del encabezado: "Facturacion: Prueba SpA, necesito 20 paneles para Lampa", "Casa matriz: Providencia,
// necesito los focos para Lampa" (un mensaje de WhatsApp suele ir en una sola linea). La tercera persona del valor
// ("Observaciones: requiere factura electronica") y el documento ("necesito factura", DOCUMENT_RE) no.
const VALUE_ORDER_RE = /(?<![\p{L}])(?:necesit(?:o|amos|ar[i\u00ed]a|ar[i\u00ed]amos)|quiero|queremos|quisiera|quisi[e\u00e9]ramos|busco|buscamos|requiero|requerimos|ocupo|ocupamos|cotizo|cotizamos|solicito|solicitamos|pido|pedimos)(?![\p{L}])/iu;
// Tambien lo corta una linea con una etiqueta del lugar ("Direccion de la bodega:", "Bodega:", "Destino:", "Lugar
// de trabajo:", "Donde se instalan:", "Se instalan en:") o con una etiqueta que ya salio en el bloque: un segundo
// "Comuna:" o "Direccion:" es de otra seccion, tambien despues de una linea en blanco. Una linea en blanco sola no:
// hay bloques de factura con una linea en blanco entre cada dato. Los datos de la factura que nombran un lugar
// ("Oficina: 501", "Local: 3") tampoco.
// La etiqueta va al inicio de la linea, tambien despues de una vineta, un numero o un emoji de lista ("- Giro:",
// "1. Giro:", "1) Giro:", "> Giro:") y, si es un dato de la factura, con un guion en vez de los dos puntos ("Giro -
// Despacho de encomiendas"): antes esas lineas se revisaban como texto suelto. Una sola marca, sin repetir el
// grupo: "(-+\s*)*" puede tardar mucho en una linea larga de guiones.
const LIST_MARK = '(?:[-\\u2013\\u2014\\u2022\\u00b7\\u25aa\\u25cf\\u25e6>]+|\\d{1,2}[.)]|\\p{Extended_Pictographic}\\ufe0f?)';
const LINE_START = '^[^\\S\\n]*(?:' + LIST_MARK + '[^\\S\\n]*)?';
const LINE_LABEL_RE = new RegExp(LINE_START + '([\\p{L}][\\p{L}\\p{N}.\'\\u00b0\\u00ba \\t-]{0,40}?)[^\\S\\n]*:', 'u');
const BILLING_DATA = '(?:giro|rut|raz[o\\u00f3]n\\s+social|direcci[o\\u00f3]n|domicilio|comuna|ciudad|localidad|regi[o\\u00f3]n|correo|e-?mail|mail|tel[e\\u00e9]fono|fono|celular|nombre|contacto|empresa|observaci[o\\u00f3]n(?:es)?|notas?)';
const LINE_DASH_LABEL_RE = new RegExp(LINE_START + '(' + BILLING_DATA + ')[^\\S\\n]+[-\\u2013\\u2014][^\\S\\n]+', 'iu');
const PLACE_LABEL_RE = new RegExp('(?<![\\p{L}])(?:' + OBRA_NOUN + '|instal[\\p{L}]*|despach[\\p{L}]*|entreg[\\p{L}]*|env[i\\u00ed][\\p{L}]*|destinos?|lugar(?:es)?|ubicaci[o\\u00f3]n|d[o\\u00f3]nde|sitio)(?![\\p{L}])', 'iu');
const BILLING_FIELD_RE = /^(?:oficina|of|local|depto|dpto|departamento|casa|calle|pasaje|n[u\u00fa]mero\s+de\s+(?:oficina|local|depto|departamento|casa))\.?$/iu;
/** La etiqueta sin tildes ni mayusculas, con "Ciudad" igual a "Comuna" y "Domicilio" igual a "Direccion". */
function labelKey(label: string): string {
  return comunaKey(label).replace(/^(?:ciudad|localidad)$/, 'comuna').replace(/^domicilio$/, 'direccion');
}
/** El bloque de la factura que empieza en `rest` (justo despues del encabezado) ya termino. */
function blockEnds(rest: string): boolean {
  const seen = new Set<string>();
  const lines = rest.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // La primera linea es el valor del encabezado; en las demas, el de su etiqueta, si la trae.
    const label = i === 0 ? undefined : LINE_LABEL_RE.exec(line) ?? LINE_DASH_LABEL_RE.exec(line);
    if (label) {
      const name = label[1].trim();
      const key = labelKey(name);
      if ((PLACE_LABEL_RE.test(name) && !BILLING_FIELD_RE.test(name)) || seen.has(key) || BLOCK_END_WORD_RE.test(name)) return true;
      seen.add(key);
      line = line.slice(label[0].length);
    }
    if (i === 0 || label) {
      if (VALUE_ORDER_RE.test(line.replace(DOCUMENT_RE, ' '))) return true;
      const end = VALUE_END_RE.exec(line);
      if (!end) continue;
      line = line.slice(end.index + end[0].length);
    }
    if (BLOCK_END_RE.test(line)) return true;
  }
  return false;
}
const MAX_LABEL_REACH = 150;
const MAX_BLOCK_REACH = 400;
// Datos de la empresa en el texto: el RUT o la razon social.
const COMPANY_RE = /(?<![\p{L}])(?:rut|raz[o\u00f3]n\s+social)(?![\p{L}])|\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK](?![\p{L}\p{N}])/iu;
// Una razon social con su forma juridica ("Iluminacion de Los Andes SpA", "CONSTRUCTORA PRUEBA LTDA."): sus
// palabras no son la comuna, aunque Claude no la devuelva. La forma juridica va con su escritura usual
// (sin la bandera i: "un spa" no es una razon social).
const LEGAL_NAME = '(?<![\\p{L}\\p{N}])(?:[\\p{Lu}\\p{N}][\\p{L}\\p{N}&\'-]*\\s+(?:(?:de|del|la|las|los|el|y|e)\\s+)?){1,8}(?:SpA|SPA|S\\.\\s?A\\.?|Ltda\\.?|LTDA\\.?|Limitada|LIMITADA|EIRL|E\\.\\s?I\\.\\s?R\\.\\s?L\\.?)(?![\\p{L}\\p{N}])';
const LEGAL_NAME_RE = new RegExp(LEGAL_NAME, 'gu');
const HAS_LEGAL_NAME_RE = new RegExp(LEGAL_NAME, 'u');
// En minusculas, la forma juridica cuenta solo cuando el texto presenta una empresa: "somos iluminacion de los
// andes spa", "trabajo en constructora de los andes limitada", "represento a ...", "de la empresa ...", "les
// escribo de ...", "a nombre de ...", "pertenezco a ...", "Empresa: ...", o con el nombre al inicio de la clausula
// ("Ana Prueba, iluminacion de los andes spa"; ahi con dos palabras o mas, sin articulo y sin "limitada", que
// tambien es un adjetivo). "Necesito focos para un spa en Pucon" sigue siendo un spa.
const LOWER_NAME_WORD = '(?!(?:para|en|un|una|unos|unas|y|e|necesit[\\p{L}]*|quier[\\p{L}]*|busc[\\p{L}]*|requier[\\p{L}]*|cotiz[\\p{L}]*)(?![\\p{L}]))[\\p{L}\\p{N}&\'-]+\\s+';
const LOWER_FORM = '(?:spa|s\\.\\s?p\\.\\s?a\\.?|ltda\\.?|eirl|e\\.\\s?i\\.\\s?r\\.\\s?l\\.?|s\\.\\s?a\\.?';
const LOWER_LEGAL_NAME = '(?:(?<![\\p{L}])(?:somos|empresa|represento\\s+a|representamos\\s+a|trabajo\\s+en|trabajamos\\s+en|pertenezco\\s+a|pertenecemos\\s+a|escrib[\\p{L}]*\\s+de|a\\s+nombre\\s+de)\\s*:?\\s+('
  + '(?:' + LOWER_NAME_WORD + '){1,8}' + LOWER_FORM + '|limitada))'
  + '|(?<=(?:^|[,;:.!?\\n\\u00bf\\u00a1(])[^\\S\\n]{0,3})('
  + '(?!(?:el|la|los|las|lo|al|del|de|mi|mis|su|sus|tu|tus|nuestr[oa]s?|est[ea]s?|es[ea]s?)(?![\\p{L}]))(?:' + LOWER_NAME_WORD + '){2,8}' + LOWER_FORM + ')))(?![\\p{L}\\p{N}])';
const LOWER_LEGAL_NAME_RE = new RegExp(LOWER_LEGAL_NAME, 'giu');
const HAS_LOWER_LEGAL_NAME_RE = new RegExp(LOWER_LEGAL_NAME, 'iu');
// La comuna que el texto presenta como lugar justo antes de la razon social no es parte de ella: "la obra en
// Lampa de Constructora Prueba SpA", "BODEGA EN LAMPA EMPRESA PRUEBA SPA" o, como respuesta, "Puente Alto
// Constructora Prueba SpA". En "Iluminacion de Los Andes SpA" si: "de" es parte del nombre.
const NAME_CUT_BEFORE_RE = /(?<![\p{L}])(?:en|para|desde|hacia|a|hasta)\s+$/iu;
const NAME_COMUNA_RE = new RegExp(COMUNA_RE.source, 'giu');

/** [COMUNA] El texto trae datos de una empresa: RUT, razon social o un nombre con su forma juridica. */
export function mentionsCompany(text: string): boolean {
  return COMPANY_RE.test(text) || HAS_LEGAL_NAME_RE.test(text) || HAS_LOWER_LEGAL_NAME_RE.test(text);
}

/** El tramo de `text` desde el ultimo corte de clausula antes de `index`. */
function clauseBefore(text: string, index: number): string {
  const head = text.slice(Math.max(0, index - 80), index);
  const cut = Math.max(...[',', '.', ';', ':', '\n', '!', '?', '\u00bf', '\u00a1', '(', ')'].map((c) => head.lastIndexOf(c)));
  return head.slice(cut + 1);
}
/** La clausula de la comuna (`start`..`end`), sin la comuna: "En Concepcion tienen sucursal" da "En  tienen sucursal". */
function clauseAround(text: string, start: number, end: number): string {
  const head = text.slice(Math.max(0, start - MAX_CLAUSE), start);
  let from = 0;
  for (const cut of head.matchAll(CLAUSE_CUT_RE)) from = cut.index + cut[0].length;
  const tail = text.slice(end, end + MAX_CLAUSE);
  const to = [...tail.matchAll(CLAUSE_CUT_RE)][0]?.index ?? tail.length;
  return head.slice(from) + ' ' + tail.slice(0, to);
}
/** La oracion que contiene `index` es una pregunta ("?" o "\u00bf"), hasta 200 letras a cada lado. */
function inQuestion(text: string, index: number): boolean {
  const head = text.slice(Math.max(0, index - 200), index);
  const tail = text.slice(index, index + 200);
  const start = Math.max(head.lastIndexOf('.'), head.lastIndexOf('\n'), head.lastIndexOf('!'));
  const ends = [tail.indexOf('.'), tail.indexOf('\n'), tail.indexOf('!')].filter((i) => i >= 0);
  const sentence = head.slice(start + 1) + tail.slice(0, ends.length ? Math.min(...ends) : tail.length);
  return sentence.includes('?') || sentence.includes('\u00bf');
}
/** Lo que sigue a la comuna es el numero de una direccion ("Bueras 1234", "Km 8", "s/n"). */
function streetAfter(after: string): boolean {
  const words = STREET_WORDS_AFTER_RE.exec(after)?.[0] ?? '';
  return STREET_NUMBER_RE.test(after.slice(words.length));
}
/** La comuna cierra la direccion de una etiqueta de la factura o de la empresa. */
function labeledBilling(text: string, start: number, company: boolean): boolean {
  const from = Math.max(0, start - MAX_BLOCK_REACH);
  const head = text.slice(from, start);
  // Cuenta la ultima etiqueta antes de la comuna. Un encabezado abre el bloque de la factura; "Direccion:" dentro del
  // bloque lo hereda (antes lo borraba). Solo se revisa el bloque del ultimo encabezado: revisar el de cada uno
  // tardaba mas de un segundo en un texto largo lleno de encabezados.
  let last: RegExpExecArray | undefined;
  let header: RegExpExecArray | undefined;
  for (const m of head.matchAll(LABEL_RE)) {
    last = m;
    if (m[1]) header = m;
  }
  if (!last) return false;
  const block = header !== undefined && !blockEnds(head.slice(header.index + header[0].length));
  if (last === header) return block;
  return block || (company && start - from - last.index <= MAX_LABEL_REACH && !ADDRESS_END_RE.test(head.slice(last.index + last[0].length)));
}

/** Un retiro en la bodega o la tienda (PICKUP_RE): no el de los equipos viejos ni el de un lugar del cliente. */
function pickup(clause: string, before: string): boolean {
  if (!PICKUP_RE.test(clause) || REMOVAL_RE.test(clause)) return false;
  return PICKUP_ORDER_RE.test(clause) || !PLACE_ANCHOR_RE.test(before);
}
/** El texto sin tildes y con el mismo largo (la enie queda como "n"). */
function withoutMarks(text: string): string {
  return [...text].map((c) => {
    const b = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return b.length === c.length ? b : c;
  }).join('');
}
/** Desde donde se tapa la razon social `name` (en `at`): despues de la ultima comuna que el texto presenta como lugar. */
function legalNameStart(text: string, bare: string, at: number, name: string, answering: boolean): number {
  let from = 0;
  // Solo el tramo del nombre (y la letra anterior, por el lookbehind): antes se buscaba hasta el final del texto
  // por cada nombre, y un texto con muchas razones sociales tardaba segundos.
  const offset = Math.max(0, at - 1);
  for (const m of bare.slice(offset, at + name.length).matchAll(NAME_COMUNA_RE)) {
    const index = offset + m.index;
    if (index < at) continue;
    const before = text.slice(Math.max(0, index - 80), index);
    const answer = answering && ANSWER_LEAD_RE.test(clauseBefore(text, index).trimStart());
    if (answer || NAME_CUT_BEFORE_RE.test(before) || COMUNA_ANCHOR_RE.test(before)) from = index + m[0].length - at;
  }
  return from;
}

export interface ComunaMention {
  name: string;
  /** La comuna de la factura o la casa matriz, no la de la instalacion. */
  billing: boolean;
  /**
   * No presenta la comuna como la obra: de donde es la persona ("soy de Maipu", "desde Maipu"), un "de" suelto
   * ("Ana Prueba, de Colina") o, en un mensaje que trae la obra explicita, un "en" suelto ("Estamos en Colina. La
   * obra esta en Lampa."). Llena la comuna vacia solo si no hay una de la obra; no cambia una capturada.
   */
  origin?: boolean;
}

export interface ComunaOptions {
  /** El bot acaba de preguntar la comuna: tambien vale el nombre solo, al inicio de una clausula. */
  answering?: boolean;
  /** El mensaje trae RUT o razon social aunque el texto ya venga sin ellos (factsText). */
  company?: boolean;
}

/** [COMUNA] Los nombres de findComunaMentions. */
export function findComunas(text: string, opts: ComunaOptions = {}): string[] {
  return findComunaMentions(text, opts).map((m) => m.name);
}

// lead: "Soy de Maipu" como respuesta a la pregunta por la comuna. Es la comuna si el mensaje no trae la de la obra;
// si la trae ("Soy de Maipu. La obra es en Lampa."), es de donde es la persona.
// weak: solo un "en", "para", "hacia" o "sector" antes ("Somos una empresa ubicada en Colina", "Estamos en Colina",
// "Trabajamos en Colina"). Es la comuna si el mensaje no trae la obra explicita (place: un ancla o una etiqueta de la
// obra, un lugar del cliente, una correccion o la respuesta a la pregunta); si la trae ("... La obra esta en Lampa."),
// cuenta como de donde es la persona (R8 de la ronda 3: antes ganaba la primera y Lampa quedaba en "otras").
type Purpose = 'billing' | 'origin' | 'lead' | 'weak' | 'place';
const RANK: Record<Purpose, number> = { billing: 0, origin: 1, lead: 2, weak: 3, place: 4 };
// Entre la comuna de la obra y la siguiente solo un "y", "o" o una coma, con "otra" o "una" y el "en" o el "para":
// la siguiente sigue la obra ("una bodega en Lampa y otra en Colina", "la obra es en Lampa y en Colina").
const COORDINATED_RE = /^\s*,?\s*(?:(?:y|e|o|u)\s+)?(?:(?:la|el|las|los)\s+)?(?:(?:otr[oa]s?|un[oa]s?)\s+)?(?:(?:m[a\u00e1]s|tambi[e\u00e9]n)\s+)?(?:en|para)\s+$/iu;
const MAX_COORDINATED = 40;
/** El tramo de `text` desde el ultimo fin de oracion antes de `index` (hasta 200 letras). */
function sentenceBefore(text: string, index: number): string {
  const head = text.slice(Math.max(0, index - 200), index);
  const cut = Math.max(...['.', '!', '?', '\n', '\u00bf', '\u00a1'].map((c) => head.lastIndexOf(c)));
  return head.slice(cut + 1);
}

/**
 * [COMUNA] Para que sirve esta aparicion de la comuna: el lugar del cliente, solo de donde es la persona
 * (origin), la factura o nada. `text` ya viene sin razones sociales (con el mismo largo).
 */
function purposeOf(text: string, start: number, end: number, name: string, key: string, opts: ComunaOptions, company: boolean): Purpose | undefined {
  const written = text.slice(start, end);
  const before = text.slice(Math.max(0, start - 80), start);
  const after = text.slice(end, end + 60);
  const head = clauseBefore(text, start);
  if (STREET_BEFORE_RE.test(head) || streetAfter(after)) return undefined;
  if (REGION_BEFORE_RE.test(before) || HISTORY_BEFORE_RE.test(before)) return undefined;
  const answer = Boolean(opts.answering) && ANSWER_LEAD_RE.test(head.trimStart());
  const obra = OBRA_ANCHOR_RE.test(before);
  const comunaAnchor = COMUNA_ANCHOR_RE.test(before);
  const strong = obra || comunaAnchor || PLACE_ANCHOR_RE.test(before);
  const firm = answer || strong || CORRECTION_BEFORE_RE.test(before);
  if (ANSWER_ONLY.has(name)) {
    if (ANSWER_ONLY_AFTER_RE.test(after)) return undefined;
    if (!answer && !comunaAnchor && (SEASON.has(name) || !strong)) return undefined;
  } else if (!firm && !LOCATION_BEFORE_RE.test(before)) return undefined;
  if (!answer && !strong && (COMMON_WORD.has(name) || COMMON_ALIAS.has(key)) && !/\p{Lu}/u.test(written)) return undefined;
  // Tras un ancla de obra la comuna es la de la obra ("despacho a Lampa para facturar a nombre de ..."). Tras una
  // etiqueta explicita ("Comuna de la obra:", "Comuna:" fuera de la factura) solo cuenta lo que califica a esta
  // misma comuna ("Comuna: Providencia para facturacion"), no otro complemento ("Colina con retiro en su local").
  if (obra) return 'place';
  if (OBRA_LABEL_RE.test(before) || (COMUNA_LABEL_RE.test(before) && !labeledBilling(text, start, company))) {
    const qualifier = LABEL_QUALIFIER_RE.exec(after);
    return qualifier ? (qualifier[1] ? 'billing' : undefined) : 'place';
  }
  const clause = clauseAround(text, start, end);
  if (pickup(clause, before) || BRANCH_RE.test(clause) || (BRANCH_QUESTION_RE.test(clause) && inQuestion(text, start))) return undefined;
  if (BILLING_RE.test(clause.replace(DOCUMENT_RE, ' ')) || labeledBilling(text, start, company)) return 'billing';
  if (strong || CORRECTION_BEFORE_RE.test(before) || INSIDE_OF_RE.test(before) || PLACE_OF_RE.test(before)) return 'place';
  // "Soy de Maipu" contesta la pregunta por la comuna, pero es de donde es la persona: con la obra en el mismo
  // mensaje gana la obra (lead). "De Maipu", como respuesta, es la comuna. Igual donde esta la empresa, salvo que
  // la oracion corrija ("Perdon, la empresa esta en Colina").
  const companyPlace = COMPANY_PLACE_RE.test(head) && !CORRECTION_LEAD_RE.test(sentenceBefore(text, start));
  if (ORIGIN_BEFORE_RE.test(before) || companyPlace) return answer ? 'lead' : 'origin';
  if (answer) return 'place';
  return OF_BEFORE_RE.test(before) ? 'origin' : 'weak';
}

/**
 * [COMUNA] Las comunas que el texto presenta como lugar, con su nombre oficial y sin repetir, en el
 * orden en que aparecen. Cada aparicion se clasifica aparte y despues se junta por comuna: si alguna es
 * de la obra, la comuna es de la obra ("la facturacion es en Lampa, la obra tambien es en Lampa"); si no,
 * de donde es la persona; si no, de la factura. Con la obra explicita en el mensaje, una comuna con solo un "en"
 * antes cuenta como de donde es la persona (weak). El texto debe venir sin correos ni la razon social que dio
 * Claude (factsText); un nombre con su forma juridica se tapa aqui, sin la comuna que va justo antes.
 */
export function findComunaMentions(source: string, opts: ComunaOptions = {}): ComunaMention[] {
  // La negrita, la cursiva y el tachado de WhatsApp ("*DIRECCION*:") no tapan las etiquetas (mismo largo).
  const text = source.replace(/[*_~]/g, ' ');
  let bareText: string | undefined;
  const maskName = (name: string, at: number) => {
    bareText ??= withoutMarks(text);
    const from = legalNameStart(text, bareText, at, name, Boolean(opts.answering));
    return name.slice(0, from) + ' '.repeat(name.length - from);
  };
  // La que va en minusculas tapa solo el nombre, no la frase que presenta la empresa ("somos").
  const masked = text.replace(LEGAL_NAME_RE, maskName).replace(LOWER_LEGAL_NAME_RE, (whole: string, presented: string | undefined, leading: string | undefined, at: number) => {
    const name = presented ?? leading ?? whole;
    const lead = whole.length - name.length;
    return whole.slice(0, lead) + maskName(name, at + lead);
  });
  const company = Boolean(opts.company) || masked !== text || COMPANY_RE.test(text);
  const found = new Map<string, number>();
  // La aparicion anterior, si fue de la obra explicita: "una bodega en Lampa y otra en Colina" o "la obra es en Lampa
  // y en Colina" siguen siendo la obra (COORDINATED_RE).
  let placeEnd: number | undefined;
  for (const m of withoutMarks(masked).matchAll(COMUNA_RE)) {
    const key = comunaKey(m[0]);
    const name = BY_KEY.get(key);
    if (!name) continue;
    const end = m.index + m[0].length;
    const coordinated = placeEnd !== undefined && m.index - placeEnd <= MAX_COORDINATED && COORDINATED_RE.test(masked.slice(placeEnd, m.index));
    // Una comuna que ya salio como lugar de la obra no cambia con otra aparicion.
    if (found.get(name) === RANK.place) {
      placeEnd = end;
      continue;
    }
    let purpose = purposeOf(masked, m.index, end, name, key, opts, company);
    if (purpose === 'weak' && coordinated) purpose = 'place';
    placeEnd = purpose === 'place' ? end : undefined;
    if (purpose) found.set(name, Math.max(found.get(name) ?? RANK.billing, RANK[purpose]));
  }
  // La obra explicita (place) gana a la mencion debil (weak); cualquiera de las dos, a la respuesta "Soy de Maipu".
  const ranks = [...found.values()];
  const hasPlace = ranks.includes(RANK.place);
  const hasWeak = ranks.includes(RANK.weak);
  return [...found].map(([name, stored]) => {
    let rank = stored;
    if (stored === RANK.lead) rank = hasPlace || hasWeak ? RANK.origin : RANK.place;
    else if (stored === RANK.weak) rank = hasPlace ? RANK.origin : RANK.place;
    return rank === RANK.origin ? { name, billing: false, origin: true } : { name, billing: rank === RANK.billing };
  });
}
