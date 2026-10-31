// api/_lib/whatsapp/summary.ts
// [RESUMEN] El resumen que redacta Claude es una interpretacion, no un dato. Politica conservadora por
// clausula: una frase se conserva solo si cada clausula (a) va atribuida al cliente ("El cliente dice
// que...", "Segun el cliente, ..."), (b) es un pedido o una consulta del cliente, donde el stock, la
// entrega o el historial solo aparecen como lo que pide o pregunta ("Pregunta si hay stock", "Consulta
// si es cliente frecuente"), o (c) es una descripcion neutra: producto, cantidad, uso, lugar o tipo de
// cliente ("Pedido de 20 paneles para oficina"). Si una clausula afirma un estado o un hecho comercial
// (compra, pago, acreditacion, stock, pedido existente, entrega, despacho, llegada, historial), se bota
// la frase entera. Ante la duda se bota: la nota trae la transcripcion. Si no queda nada, la nota
// remite a ella.
//
// [RESUMEN] Los verbos comerciales se reconocen por su raiz y cualquier terminacion verbal ("compr" +
// o/aba/aron/ado...), no por formas sueltas: pasado y participio piden atribucion; presente, futuro,
// condicional y gerundio piden ademas que vayan dentro de una pregunta; el infinitivo y el subjuntivo
// ("quiere comprar", "pide que le envien") no afirman nada, salvo tras "va a" ("van a llegar").
//
// [RESUMEN] Ronda 3: el vocabulario comercial (pago, compra, pedido, despacho, entrega, venta, dinero,
// "en bodega"...) en cualquier forma solo vale dentro de un pedido o una consulta ("Consulta las formas
// de pago"), en una lista que sigue a uno ("y el despacho a regiones") o en la descripcion de lo que se
// pide ("Pedido de 20 paneles", "Compra de 30 paneles"). Suelto, se bota: "Pago completo", "Despacho
// manana a Lampa", "El pedido esta en Starken". "Cliente" solo puede ir seguido de lo que pide o dice,
// de su tipo ("de empresa", "particular") o de un nombre; "Cliente conocido" o "de larga data" es
// historial. "Hay", "quedan", "sobran", "se dispone de", "cuenta con" y "esta en" (salvo la obra, el
// proyecto o el local) son estados que solo cubre una pregunta.
//
// [RESUMEN] Ronda 4 (precision): una clausula se bota solo si afirma una compra, un pago, stock,
// historial, un pedido existente o una entrega. Sin ese vocabulario se conserva, cualquiera sea su
// verbo ("Cliente proporciona nombre y correo"). El sustantivo comercial que complementa a otro
// ("detalles de compra", "sala de ventas", "para despacho en Calama"), la modalidad de entrega sola
// ("Retiro en tienda") y el tipo de documento ("factura empresa") no afirman nada. "Cliente" seguido de
// un adjetivo, un nombre o lo que hace es el tipo de cliente; es historial solo con un adjetivo de
// historial (frecuente, habitual, antiguo, recurrente, conocido, VIP...), "de la tienda", "de la casa",
// "de eLIGHTS", "de nosotros" o una expresion de tiempo. "Desde" es historial solo con una expresion de
// tiempo: "desde elights.cl" es el canal.
//
// [RESUMEN] R7 (Codex, ronda 3): tambien se bota la perifrasis. El verbo de apoyo con la nominalizacion
// del acto, antes o despues ("Se efectuo la adquisicion de veinte focos", "La adquisicion de veinte
// focos se efectuo"), el infinitivo comercial tras un verbo de logro ("logro adquirir", "logro al fin
// adquirir", "pudo pagar", "termino por comprar") y el estado de la mercaderia ("Los focos estan a
// disposicion del cliente", "Los focos estan preparados para el lunes"). Se mira el objeto de la accion
// y el sujeto: entregar o enviar datos no es entregar mercaderia ("Cliente entrega nombre y correo"),
// salvo el dato de un envio o de un pago ("Se le envio el numero de Starken"); el cliente a disposicion
// no es mercaderia; la cuenta de correo no es una cuenta por pagar; el pedido minimo como tema o como
// condicion ("dudas sobre el pedido minimo") no es un pedido; y "Venta al por menor de iluminacion" es
// el giro del cliente, no una venta. Sigue siendo un filtro por construcciones conocidas: un rodeo que
// no esta aqui puede pasar, y la nota igual trae la transcripcion.

export const SUMMARY_EMPTY = 'Ver la transcripci\u00f3n.';

// Limites de palabra que entienden las tildes: "\b" corta "compro" despues de la "r".
const W = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const words = (list: string[], flags = 'giu') => new RegExp(W + '(?:' + list.join('|') + ')' + E, flags);
const blank = (m: string) => ' '.repeat(m.length);
const FOLD: Record<string, string> = { '\u00e1': 'a', '\u00e9': 'e', '\u00ed': 'i', '\u00f3': 'o', '\u00fa': 'u', '\u00fc': 'u' };
// Minusculas sin tildes, con el mismo largo: la terminacion se lee despues en la palabra original.
const fold = (s: string) => s.toLowerCase().replace(/[\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc]/g, (c) => FOLD[c]);

const COMMERCIAL_NOUN = '(?:compras?|pagos?|pedidos?|(?:\u00f3|o)rden(?:es)?|transferencias?|dep(?:\u00f3|o)sitos?|abonos?|reservas?'
  + '|facturas?|boletas?|comprobantes?|despachos?|env(?:\u00ed|i)os?|entregas?)';

// [RESUMEN] Hechos que solo cubre la atribucion: lo que ya existe ("su pedido", "pago pendiente",
// "compra anterior"), una deuda, un pedido que se repite, lo recien hecho ("acaba de pagar"), una
// cotizacion ya hecha, lo que ya salio o entro, y lo que paso ayer o la vez anterior.
const ATTRIBUTED_RE = words([
  'sus?\\s+' + COMMERCIAL_NOUN,
  COMMERCIAL_NOUN + '\\s+(?:ya\\s+)?(?:anterior(?:es)?|previ[oa]s?|pendientes?|atrasad[oa]s?|en\\s+curso|list[oa]s?|complet[oa]s?|ok|okey'
    + '|al\\s+d(?:\u00ed|i)a|en\\s+orden|reflejad[oa]s?|exitos[oa]s?|conforme)',
  'saldos?|deudas?',
  '(?:pedidos?|(?:\u00f3|o)rden(?:es)?|facturas?|boletas?|oc)\\s+(?:(?:n(?:\u00b0|\u00ba|o\\.?|ro\\.?|(?:\u00fa|u)mero)|#)\\s*\\d+|\\d{4,})',
  'repet\\p{L}*\\s+(?:(?:el|la|los|las|un|una)\\s+)?(?:pedidos?|compras?|(?:\u00f3|o)rden(?:es)?)',
  'volvi(?:\u00f3|o|eron)\\s+a',
  'acab\\p{L}*\\s+de\\s+\\p{L}+(?:ar|er|ir)',
  'deb(?:e|en|(?:\u00ed|i)an?)\\s+(?:\\$\\s*)?\\d[\\d.,]*',
  'cotiz(?:\u00f3|o|aron)|cotizad[oa]s?',
  'sal(?:i(?:\u00f3|o)|ieron)|entr(?:\u00f3|o|aron)',
  'ayer|anoche|anteayer|antier|(?:la\\s+semana|el\\s+mes|el\\s+a(?:\u00f1|n)o)\\s+pasad[oa]|el\\s+otro\\s+d(?:\u00ed|i)a'
    + '|la\\s+vez\\s+(?:anterior|pasada)|la\\s+(?:\u00fa|u)ltima\\s+vez',
]);
// R7: "a disposicion", "a su entera disposicion", "a plena disposicion" (ver DISPOSAL_RE).
const DISPOSAL = 'a\\s+(?:(?:la|su|sus|entera|total|plena|libre|completa|inmediata)\\s+){0,2}disposici(?:\u00f3|o)n';
// [RESUMEN] Estados que tambien cubre una consulta, pero solo como pregunta ("Pregunta si hay stock",
// "Consulta si es cliente frecuente", "Pregunta si tenemos focos de 200W"): historial, la tienda que
// habla ("nosotros", "nos"), tener un pedido, "ya" + verbo, stock, existencias y entrega.
const ASK_RE = words([
  'historial(?:es)?',
  'client[ea]s?\\s+(?:frecuentes?|habitual(?:es)?|antigu[oa]s?|recurrentes?|fiel(?:es)?|de\\s+(?:siempre|antes|la\\s+(?:tienda|casa)|e-?lights|nosotros))',
  // "Cliente de 5 anos", "cliente por anos": el tiempo como cliente.
  'client[ea]s?\\s+(?:de|por|durante)\\s+(?:(?:m(?:\u00e1|a)s\\s+de\\s+)?(?:\\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|muchos|varios)\\s+)?'
    + '(?:a(?:\u00f1|n)os?|mes(?:es)?|d(?:\u00e9|e)cadas?|tiempo)',
  'nosotr[oa]s|nuestr[oa]s?|nos',
  // "Desde" solo con una expresion de tiempo: "desde elights.cl" o "desde la web" es el canal.
  'desde\\s+(?:hace\\s+|(?:el|la)\\s+(?:a(?:\u00f1|n)o\\s+)?|(?:principios|inicios|fines)\\s+de\\s+)?(?:\\d{4}|(?:[\\p{L}\\p{N}]+\\s+)?a(?:\u00f1|n)os|tiempo|siempre'
    + '|antes|entonces|enero|febrero|marzo|abril|mayo|junio|julio|agosto|se?tiembre|octubre|noviembre|diciembre)',
  'hace\\s+(?:[\\p{L}\\p{N}]+\\s+)?(?:tiempo|a(?:\u00f1|n)os?|mes(?:es)?|semanas?|d(?:\u00ed|i)as?|mucho|rato|poco)',
  'de\\s+(?:(?:larga|antigua|vieja)\\s+data|toda\\s+la\\s+vida|(?:muchos\\s+)?a(?:\u00f1|n)os)',
  'llev\\p{L}*\\s+(?:[\\p{L}\\p{N}]+\\s+)?(?:a(?:\u00f1|n)os?|tiempo|meses)|(?:muy\\s+)?conocid[oa]s?\\s+(?:de|en|por|para)',
  'seguido|habitualmente|frecuentemente|regularmente|(?:todos\\s+los|cada)\\s+(?:mes(?:es)?|a(?:\u00f1|n)os?|semanas?)',
  // "Compras frecuentes" es historial; "potencial de compra recurrente" no.
  '(?<!(?:potencial|posibilidad|intenci(?:\u00f3|o)n|inter(?:\u00e9|e)s|opci(?:\u00f3|o)n)\\s+de\\s+)(?:compras?|pedidos?|pagos?)\\s+'
    + '(?:frecuentes?|habitual(?:es)?|recurrentes?|regular(?:es)?|seguid[oa]s)',
  // "Con eLIGHTS" es historial; "productos de eLIGHTS" o "retiro de eLIGHTS.cl" no ("cliente de eLIGHTS", arriba, si).
  'con\\s+(?:(?:la|esta|nuestra)\\s+)?tienda|con\\s+e-?lights',
  // "De la tienda" es historial, salvo sus datos o el retiro: "la direccion de la tienda", "retiro en la tienda".
  '(?<!(?:direcci(?:\u00f3|o)n|horarios?|ubicaci(?:\u00f3|o)n|tel(?:\u00e9|e)fonos?|correos?|web|p(?:\u00e1|a)gina|sitio|local|sucursal|nombre|datos|retir\\p{L}*)\\s+)'
    + '(?:de|en|a)\\s+(?:la|esta|nuestra)\\s+tienda',
  'vuelv\\p{L}*\\s+a',
  '(?:tien(?:e|en)|ten(?:\u00ed|i)an?|tuv(?:o|ieron)|tenemos)\\s+(?:(?:una?|unos|unas|el|la|los|las)\\s+)?(?:[\\p{L}\\p{N}]+\\s+)?'
    + '(?:pedidos?|compras?|(?:\u00f3|o)rden(?:es)?|pagos?|facturas?|boletas?|reservas?|transferencias?|cr(?:\u00e9|e)ditos?)'
    + '(?!\\s+m(?:\u00ed|i)nim[oa]s?' + E + ')',
  'ya(?=\\s+\\p{L})(?!\\s+que' + E + ')',
  // Stock y existencias, tambien con otras palabras ("hay 20 focos", "se dispone de", "sobran").
  '(?<!interesad[oa]s?\\s+)en\\s+(?:stock|existencias?)|(?:hay|tienen?|tenemos|con|sin)\\s+(?:stock|disponibilidad|existencias?|inventario)',
  '(?:disponibilidad|stock|existencias?)\\s+(?:asegurad|confirmad|reservad|garantizad)[oa]s?',
  'pocas\\s+unidades|(?:\u00fa|u)ltim[oa]s?\\s+unidad(?:es)?',
  'disponibles?|agotad[oa]s?|(?:guardad|apartad|almacenad)[oa]s?|exist(?:e|en|\u00edan?|ian?)|separad[oa]s?\\s+para',
  // "Hay que cotizar" o "hay poca luz" no son existencias.
  'hay(?!\\s+(?:que|poca|poco|mucha|mucho|problemas?|luz|humedad|riesgo)' + E + ')|hab(?:\u00ed|i)an?|habr(?:\u00e1|a)n?|hubo|tengo',
  'dispon(?:e|en|emos|(?:\u00ed|i)an?|dr(?:\u00e1|a)n?)',
  'sobr(?:a|an|aba|aban|\u00f3|o|aron|ar(?:\u00e1|a)n?|ando)',
  // "Queda a disposicion" lo mira DISPOSAL_RE, que conoce el sujeto.
  'qued(?:a|an|aba|aban|\u00f3|o|aron|ar(?:\u00e1|a)n?|ar(?:\u00ed|i)an?)(?!\\s+(?:(?:ya|todav(?:\u00ed|i)a|a(?:\u00fa|u)n)\\s+)?en' + E
    + '|\\s+' + DISPOSAL + ')',
  'cuent(?:a|an)\\s+(?:ya\\s+)?con|cont(?:amos|aba|aban|\u00f3|o|aron|ar(?:\u00e1|a)n?)\\s+con',
  // Entrega por venir o en curso, tambien en perifrasis ("van a llegar", "va a recibir").
  'sal(?:e|en|i(?:\u00f3|o)|ieron|dr(?:\u00e1|a)n?)\\s+(?:hoy|ayer|ma(?:\u00f1|n)ana|esta\\s+semana|el\\s+(?:lunes|martes|mi(?:\u00e9|e)rcoles|jueves|viernes|s(?:\u00e1|a)bado)|de\\s+(?:la\\s+)?bodega)',
  'part(?:en|i(?:\u00f3|o)|ieron|ir(?:\u00e1|a)n?|ir(?:\u00ed|i)an?)|entrar(?:\u00e1|a)n?',
  '(?:voy|vas|va|vamos|van|iba|iban|ir(?:\u00e1|a)n?|ir(?:\u00ed|i)an?|vien(?:e|en)|vendr(?:\u00e1|a)n?|pas(?:a|an|ar(?:\u00e1|a)n?|ar(?:\u00ed|i)an?|\u00f3|o|aron))'
    + '\\s+a\\s+\\p{L}+(?:ar|er|ir)(?:se|lo|la|los|las|le|les|nos)?',
  'en\\s+(?:camino|tr(?:\u00e1|a)nsito|preparaci(?:\u00f3|o)n|reparto|proceso|ruta)',
  'se\\s+(?:est\\p{L}*\\s+)?prepar\\p{L}*',
  '(?:list|preparad|embalad|empacad|empaquetad)[oa]s?\\s+para\\s+(?:(?:el|su)\\s+)?(?:retir(?:o|ar)|despach(?:o|ar)|entreg(?:a|ar)|env(?:\u00ed|i)o|enviar)',
  '(?:est|qued|encuentr)\\p{L}*\\s+(?:ya\\s+)?list[oa]s?',
]);
// [RESUMEN] R7: lo que esta a disposicion de alguien ya existe ("Los focos estan a disposicion del
// cliente", "a plena disposicion"): solo lo cubre una pregunta, salvo que el sujeto sea el cliente, un
// contacto o una ficha ("El cliente queda a su entera disposicion para coordinar"; "Los focos del
// cliente quedan a su disposicion" habla de los focos).
const DISPOSAL_RE = words([DISPOSAL]);
const PERSON_SUBJECT = /^(?:client[ea]s?|contactos?|encargad[oa]s?|vendedor(?:a|as|es)?|ejecutiv[oa]s?|asesor(?:a|as|es)?|tecnic[oa]s?|fichas?|catalogos?|informacion|datos|horarios?|persona|personal)$/;
// [RESUMEN] "Esta en", "queda en", "sigue en" o "se encuentra en" (R7) dicen donde estan las cosas
// ("El pedido esta en Starken", "La plata esta en la cuenta"): solo los cubre una pregunta, salvo que
// hablen de un lugar ("La obra esta en Lampa", "La obra se encuentra en Lampa").
const STAY = '(?:est(?:\u00e1|a|\u00e1n|an|aba|aban|uvo|uvieron|ar(?:\u00e1|a)n?|ar(?:\u00ed|i)an?)|qued(?:a|an|aba|aban|\u00f3|o|aron|ar(?:\u00e1|a)n?)'
  + '|sigue|siguen|permanec\\p{L}*|encuentr(?:a|an|aba|aban))';
// "En la web" o "en el catalogo" no es un lugar donde este la mercaderia: "El producto se encuentra en la web".
const LOCATION_RE = words([STAY + '\\s+(?:(?:ya|todav(?:\u00ed|i)a|a(?:\u00fa|u)n)\\s+)?en'
  + '(?!\\s+(?:(?:la|el|su|nuestr[oa])\\s+)?(?:web|sitio|p(?:\u00e1|a)gina|cat(?:\u00e1|a)logo|e-?lights(?:\\.cl)?)' + E + ')']);
// [RESUMEN] R7: la mercaderia ya alistada ("Los focos estan preparados", "se encuentran embalados",
// "fueron preparados", "estan preparados para el lunes" o "para que el cliente los retire") es un
// estado que solo cubre una pregunta; el lugar no ("La oficina esta preparada"), ni el uso para el que
// sirve el producto, que se reconoce por una lista cerrada ("preparados para exterior", "contra la
// humedad"): otro "para" afirma el estado.
const PRODUCT_USE = '(?:(?:el|la|los|las|su|uso\\s+en)\\s+)?(?:uso|usar|exterior(?:es)?|interior(?:es)?|intemperie|agua|lluvia|polvo|golpes'
  + '|impactos?|humedad|temperaturas?|climas?|ambientes?|condiciones|zonas?|alturas?|soportar|resistir|funcionar|operar|trabajar|alumbrado)';
const GOODS_STATE_RE = words(['(?:' + STAY + '|fue|fueron|sido)\\s+(?:(?:ya|todav(?:\u00ed|i)a|a(?:\u00fa|u)n)\\s+)?'
  + '(?:preparad|alistad|embalad|empacad|empaquetad)[oa]s?(?!\\s+(?:para|contra)\\s+' + PRODUCT_USE + E + ')']);
const PLACE_SUBJECT = /^(?:obras?|proyectos?|licitacion(?:es)?|empresas?|oficinas?|local(?:es)?|casas?|galpon(?:es)?|bodegas?|instalacion(?:es)?|faenas?|terrenos?|sucursal(?:es)?|plantas?|fabricas?|colegios?|edificios?|departamentos?|condominios?|parcelas?|recintos?|canchas?|estadios?|taller(?:es)?|tiendas?|comunas?|direccion|lugar|sitio|predio|campo|fundo|domicilio|cliente|clienta)$/;
const SUBJECT_SKIP = new Set(['ya', 'no', 'todavia', 'aun', 'tambien', 'se']);
const SUBJECT_DETERMINER = /^(?:el|la|los|las|su|sus|esta|este)$/;
// El complemento del sujeto: "La empresa del cliente", "El galpon a iluminar", "La cancha de futbol".
const SUBJECT_COMPLEMENT = /^(?:de|del|a|al|para|con)$/;
// [RESUMEN] Vocabulario comercial que no es verbo: solo vale dentro de un pedido o una consulta, o en
// una lista que sigue a uno. "En bodega" tambien, salvo como lugar de uso o de retiro ("para usar en
// bodega", "retirar en bodega").
// R7: la cuenta de correo o de usuario no es una cuenta por pagar.
const DESC_RE = words([
  'pedidos?|(?:\u00f3|o)rden(?:es)?|oc|ventas?|dinero|la\\s+plata|cartolas?|montos?|negocios?|tratos?|transferencias?|comprobantes?'
    + '|boletas?|cr(?:\u00e9|e)ditos?|transacci(?:\u00f3|o)n(?:es)?|mercader(?:\u00ed|i)as?',
  'cuentas?(?!\\s+(?:que|con)' + E + '|\\s+(?:de\\s+)?(?:correo|e-?mail|mail|gmail|hotmail|outlook|google|usuario|instagram|facebook|linkedin|whatsapp)' + E + ')',
  '(?<!(?:para\\s+\\p{L}+(?:ar|er|ir)|proyect\\p{L}*|retir\\p{L}*|instal\\p{L}*|ilumin\\p{L}*|us\\p{L}*|pon\\p{L}*|trabaj\\p{L}*|coloc\\p{L}*|mont\\p{L}*|ocup\\p{L}*|alumbr\\p{L}*)(?:\\s+[\\p{L}\\p{N}]+){0,3}\\s+)'
    + 'en\\s+(?:(?:la|las|el|los|nuestr[oa]s?)\\s+)?(?:bodegas?|almac(?:\u00e9|e)n(?:es)?|dep(?:\u00f3|o)sitos?)',
]);
// Lo que se vendio tras "venta al por mayor de": un articulo o un determinante, un numeral en palabras
// ("veinticinco", "setenta", "doscientos") o un lote.
const NUMBER_WORD = '(?:un[oa]?s?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\\p{L}+|veint\\p{L}*'
  + '|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:tos?)?|\\p{L}+cient[oa]s|mil(?:es)?|mill(?:\u00f3|o)n(?:es)?)';
const SOLD_LOT = '(?:el|la|los|las|lo|sus?|est[eoa]s?|es[eoa]s?|aquel(?:l[oa]s?|la)?|dich[oa]s?|ambos|ambas|ciert[oa]s|algun[oa]?s?'
  + '|vari[oa]s|much[oa]s|poc[oa]s|tod[oa]s?|lotes?|partidas?|stock|mercader(?:\u00ed|i)as?|' + NUMBER_WORD + ')';
// Una palabra del rubro: sin cifra, sin lo que se vendio y sin participio ("de focos concretada" cuenta
// una venta). Las palabras en "-ado" o "-ido" se botan aunque sean adjetivos ("importados").
const TRADE_WORD = '(?!' + SOLD_LOT + E + ')\\p{L}+(?<!(?:ad|id)[oa]s?)';
// El pedido minimo como cifra o como condicion de otra cosa: "de 10 unidades", "es de $50.000", "para
// despacho sin costo".
const MIN_AMOUNT = '(?:(?:(?:es|son|ser(?:\u00e1|a))\\s+)?(?:de\\s+)?(?:\\$\\s*)?\\d[\\d.,]*(?:\\s+(?:mil|millones?))?(?:\\s+\\p{L}+)?'
  + '|para\\s+(?:(?:el|la)\\s+)?(?:despacho|env(?:\u00ed|i)o|retiro|factura|compra)(?:\\s+sin\\s+costo|\\s+a\\s+regiones)?)[^\\p{L}\\p{N}]*$';
// "Pedido de 20 paneles" o "Compra de 30 paneles" (sin articulo definido: no es un pedido que ya
// existe) describe lo que se pide, "factura empresa" o "boleta electronica", el documento, y "venta
// al por menor", el giro del cliente.
const TEMPLATE_RE = words(['(?<!(?:el|la|los|las|su|sus|este|esta|ese|esa|del|al)\\s+)(?:(?:pedidos?|compras?)\\s+de'
  + '(?=\\s+(?!(?:hace|siempre|larga|toda|antes|nosotros)' + E + ')[\\p{L}\\p{N}$])|facturas?\\s+a\\s+nombre\\s+de'
  + '|(?:facturas?|boletas?)(?=\\s+(?:(?:de|para|a)\\s+(?:(?:la|una|su)\\s+)?)?(?:empresas?|electr(?:\u00f3|o)nicas?|exentas?|afectas?)' + E + '))',
  // El giro termina la clausula o sigue con su lugar o su rubro: "Venta al por menor cerrada" no. R7:
  // tambien al empezar la clausula ("Venta al por menor de iluminacion"), pero no con lo que se vendio
  // ("Venta al por mayor de 500 focos", "de veinticinco focos", "de aquellos paneles") ni con un
  // participio despues del rubro ("Venta al por mayor de focos concretada").
  'ventas?(?=\\s+al\\s+por\\s+(?:menor|mayor)(?:\\s+(?:en|para|con)' + E + '|\\s+del?\\s+' + TRADE_WORD + '(?:\\s+' + TRADE_WORD + '){0,4}'
    + '(?:\\s+(?:en|para|con)' + E + '|[^\\p{L}\\p{N}]*$)|[^\\p{L}\\p{N}]*$))',
  // R7: el pedido, la compra o el monto minimo es una condicion de la tienda cuando es el tema ("dudas
  // sobre el pedido minimo", "sobre el monto minimo de compra") o cuando se enuncia con su cifra
  // ("Pedido minimo de 10 unidades"). Con otra cosa vuelve a ser un pedido: "El pedido minimo sigue
  // pendiente", "tiene un pedido minimo pendiente", "cumplio el pedido minimo".
  '(?<=(?:sobre|acerca\\s+de|respecto\\s+(?:a|al|de|del)|en\\s+cuanto\\s+al?|cu(?:\u00e1|a)l\\s+(?:es|son|ser(?:\u00ed|i)a))\\s+(?:(?:el|la|los|las)\\s+)?)'
    + '(?:pedidos?|montos?|compras?)'
    + '(?=\\s+m(?:\u00ed|i)nim[oa]s?(?:\\s+(?:de|para)' + E + '|[^\\p{L}\\p{N}]*$))',
  '(?<=^(?:(?:el|la|los|las)\\s+)?)(?:pedidos?|montos?|compras?)(?=\\s+m(?:\u00ed|i)nim[oa]s?\\s+' + MIN_AMOUNT + ')']);
// [RESUMEN] El sustantivo comercial que complementa a otro sustantivo, sin articulo ("detalles de
// compra", "opcion de pago", "sala de ventas", "para despacho en Calama"), no afirma nada. Salvo tras
// lo que senala un hecho puntual ("fecha de pago", "estado de despacho", "historial de compras") o
// como rotulo de un valor ("Fecha de entrega: viernes").
const NOUN_OF_RE = new RegExp(W + '(?!(?:fechas?|d(?:\u00ed|i)as?|horas?|horarios?|estados?|n(?:\u00fa|u)meros?|c(?:\u00f3|o)digos?|gu(?:\u00ed|i)as?|seguimientos?'
  + '|comprobantes?|recibos?|constancias?|confirmaci(?:\u00f3|o)n(?:es)?|notas?|avisos?|registros?|historial(?:es)?|historias?|antecedentes?'
  + '|experiencias?|montos?|totales?|total|saldos?)' + E + ')[\\p{L}\\p{N}]+\\s+(?:de|para)\\s+$', 'iu');
const ARTICLE_START_RE = /^(?:el|la|los|las|lo)(?![\p{L}\p{N}])/iu;
// Con una fecha o un plazo despues ya es un hecho: "Focos para despacho manana", "para entrega
// inmediata", "con despacho a Chillan el 21", "para envio en 2 dias".
const COMPLEMENT_WHEN_RE = words(['hoy|ma(?:\u00f1|n)ana|ayer|anoche|pronto|inmediat[oa]s?|lunes|martes|mi(?:\u00e9|e)rcoles|jueves|viernes|s(?:\u00e1|a)bado|domingo'
  + '|est[ae]\\s+(?:semana|mes)|el\\s+mismo\\s+d(?:\u00ed|i)a|el\\s+\\d{1,2}(?![\\p{L}\\p{N}])|\\d{1,2}\\s*[/-]\\s*\\d{1,2}'
  + '|\\d{1,2}\\s+de\\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|se?tiembre|octubre|noviembre|diciembre)'
  + '|(?:en|dentro\\s+de)\\s+(?:hasta\\s+|m(?:\u00e1|a)s\\s+de\\s+)?(?:\\d+|un|una|dos|tres|cuatro|cinco)\\s+(?:d(?:\u00ed|i)as?|horas?|semanas?)'], 'iu');
// [RESUMEN] La modalidad de entrega sola, con su lugar ("Retiro en tienda", "Despacho a Lampa"), es lo
// que se pide; con una fecha o un estado ("Despacho manana a Lampa") ya no. Igual el destino dentro de
// la descripcion: "con despacho a Chillan", "para envio a Iquique".
const MODE_NOUN = /^(?:retiros?|despachos?|envios?|entregas?)$/;
const MODE_PLACE = /^(?:tienda|bodega|sucursal|local|domicilio|obra|oficina|faena|regiones|region|puntos?)$/;
// Lo que une las palabras de un lugar: "San Pedro de la Paz", "punto de retiro".
const PLACE_JOIN = /^(?:de|del|la|las|los|el)$/;
const MODE_ARTICLE = /^(?:el|la|su)$/;
const TIME_WORD = /^(?:hoy|manana|ayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo|pronto|ya)$/;
// Una clausula de lista con verbo no es solo el nombre de lo que se pide: "y el pago esta completo".
const COPULA_RE = words(['es|son|era|eran|fue|fueron|ser(?:\u00e1|a)n?|sea|sean|est(?:\u00e1|a|\u00e1n|an|aba|aban|uvo|uvieron|ar(?:\u00e1|a)n?)'
  + '|qued\\p{L}+|sigue|siguen|va|van|iba|iban|viene|vienen|tiene|tienen|ten(?:\u00ed|i)an?|tuvo|hay|hab(?:\u00ed|i)an?|ha|han|he|hemos'], 'iu');
// La orden de compra y "otro/nuevo/segundo pedido" los cubre cualquier pedido anterior de la clausula
// ("Necesita adjuntar una orden de compra", "Quiere hacer un nuevo pedido").
const ORDER_RE = words([
  '(?:\u00f3|o)rden(?:es)?\\s+de\\s+compra',
  '(?:segund|tercer|cuart|otr|nuev|(?:\u00fa|u)ltim)[oa]s?\\s+(?:compras?|pagos?|pedidos?|transferencias?|dep(?:\u00f3|o)sitos?|abonos?|(?:\u00f3|o)rden(?:es)?)',
]);
// "Cliente de la empresa" es historial; "Cliente de la empresa Constructora X" presenta a un cliente
// B2B. La mayuscula se mira aparte: con la bandera "i", "\p{Lu}" tambien acepta minusculas.
const COMPANY_CLIENT_RE = words(['client[ea]s?\\s+de\\s+la\\s+empresa']);
const PROPER_NAME_RE = /^\s+\p{Lu}/u;
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
  + '|para\\s+(?:(?:su|tener|reponer|mantener|hacer)\\s+)?(?:stock|inventario)'
  // "Queda atento" o "queda a la espera" no es un estado del stock.
  + '|(?:client[ea]s?\\s+)?qued\\p{L}*\\s+(?:atent[oa]s?|a\\s+la\\s+espera|en\\s+espera))' + E, 'giu');
const NOT_PAID_RE = new RegExp(W + '(?:despachos?|env(?:\u00ed|i)os?|fletes?)(?:\\s+[\\p{L}\\p{N}]+){0,4}?\\s+(?:es|son|sean?|ser(?:\u00ed|i)an?)\\s+'
  + '(?:pagad[oa]s?|por\\s+pagar)(?:\\s+o\\s+(?:pagad[oa]s?|por\\s+pagar))?' + E, 'giu');
// Pedidos y consultas: cubren solo el stock, la entrega por venir, el historial, la orden de compra y
// el vocabulario comercial. El infinitivo no cuenta tras "se pudo" o "se logro": "Se pudo confirmar
// la disponibilidad" cuenta algo ya hecho.
const REQUEST_SRC = [
  'requier[ea]n?|solicit(?:a|an)|consult(?:a|an)|pregunt(?:a|an)|pide|piden|necesit(?:a|an)|busca|buscan|cotiz(?:a|an)',
  'quier(?:e|en)|dese(?:a|an)|interes(?:a|an)|prefier(?:e|en)|interesad[oa]s?\\s+en|(?<!con\\s+)confirmaci(?:\u00f3|o)n\\s+de',
  '(?<!(?:pud(?:o|e|imos|ieron)|logr(?:\u00f3|o|\u00e9|e|amos|aron)|podido|logrado|posible)\\s+)'
    + '(?:requerir|solicitar|consultar|preguntar|pedir|necesitar|buscar|confirmar|validar|chequear|saber|conocer|verificar|averiguar|cotizar)',
];
const REQUEST_RE = words(REQUEST_SRC);
const CONFIRM_START_RE = /^confirmaci/i;
// "Solicitada" o "requerida" despues de lo que se pide: "Entrega inmediata solicitada".
const REQUESTED_RE = words(['(?:solicitad|requerid)[oa]s?']);
// "El cliente pregunta: ..." pasa la consulta a la clausula que sigue a los dos puntos.
const REQUEST_END_RE = new RegExp(W + '(?:' + REQUEST_SRC.join('|') + ')(?:\\s+(?:lo\\s+siguiente|esto))?$', 'iu');
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
// Clausulas: coma, dos puntos, "y", "e", "pero", "aunque", "ademas", "porque", tambien tras una coma
// (", y si..."). Solo las de lista (coma, dos puntos, "y", "e") pasan el pedido al nombre suelto que
// sigue. Una clausula que empieza con "que" sigue solo la atribucion de la anterior ("El cliente dice
// que ya compro y que pago"; "Pide focos, que hay stock" se bota); con "si" o una palabra de pregunta
// ("y cuando llegarian"), o con "?" tras "pregunta:", tambien la consulta ("El cliente pregunta por el
// precio y si hay stock"). Sin tilde solo cuentan "si" y "cuando": "y como hay stock" afirma.
const CONNECTOR = '(?:y|e|pero|aunque|adem(?:\u00e1|a)s|porque|pues|sino|mientras)' + E;
const CLAUSE_SPLIT = new RegExp('(\\s*[,:]\\s*(?:' + CONNECTOR + '\\s*)?|\\s+' + CONNECTOR + '\\s*)', 'iu');
const LIST_SEPARATOR = /^\s*(?:[,:]\s*(?:(?:y|e)\s*)?|(?:y|e)\s*)$/i;
const CONTINUES_RE = new RegExp('^(?:(que)|si|cu(?:\u00e1|a)ndo|cu\u00e1nt[oa]s?|d\u00f3nde|cu\u00e1l(?:es)?|qu\u00e9|c\u00f3mo'
  + '|(?:para|hasta|desde)\\s+cu(?:\u00e1|a)ndo|por\\s+qu(?:\u00e9|e))' + E, 'iu');
const DIRECT_QUESTION_RE = /^[\s*_~]*\u00bf/u;
const MAX_SENTENCES = 6;

// [RESUMEN] Raices de los verbos comerciales. "noun" dice que terminaciones son tambien sustantivo y
// por eso descripcion sin sujeto: "o" (pago, despacho, envio), "a" (compra, entrega, factura) o las
// dos. "light" marca los verbos de apoyo ("realizo", "hizo", "quedo cerrada"), que solo cuentan junto
// a un sustantivo comercial cercano ("hizo una nueva compra", "pago realizado"); sus sustantivos
// ("registro", "cierre") son neutros, igual que los de "nodesc" ("mando", "giro" comercial).
// "partNoun": el participio tras un articulo es una persona ("el encargado"). "pastOnly": solo el
// pasado es un hecho comercial ("giro $500.000"; "un foco que gira 360 grados" no).
interface Stem { s: string; ir?: boolean; noun?: 'o' | 'a' | 'oa'; light?: boolean; nodesc?: boolean; partNoun?: boolean; pastOnly?: boolean }
const STEMS: Stem[] = [
  { s: 'compr', noun: 'a' }, { s: 'recompr', noun: 'a' }, { s: 'pag', noun: 'o' }, { s: 'pagu' }, { s: 'abon', noun: 'o' },
  { s: 'deposit', noun: 'o' }, { s: 'factur', noun: 'a' }, { s: 'bolete' }, { s: 'cancel' }, { s: 'acredit' },
  { s: 'reserv', noun: 'a' }, { s: 'confirm' }, { s: 'cobr', noun: 'o' }, { s: 'sald', noun: 'o' }, { s: 'gir', noun: 'o', nodesc: true, pastOnly: true },
  { s: 'vend', ir: true }, { s: 'encarg', partNoun: true }, { s: 'encargu' }, { s: 'orden' },
  { s: 'despach', noun: 'o' }, { s: 'entreg', noun: 'a' }, { s: 'entregu' }, { s: 'envi', noun: 'o' }, { s: 'mand', noun: 'o', nodesc: true },
  { s: 'lleg' }, { s: 'llegu' }, { s: 'retir', noun: 'o' }, { s: 'acept' }, { s: 'aprob' }, { s: 'aprueb' },
  { s: 'embal' }, { s: 'empac' }, { s: 'empaquet' }, { s: 'apart' }, { s: 'guard' }, { s: 'liquid' }, { s: 'reembols', noun: 'o' },
  { s: 'devolv', ir: true }, { s: 'devuelv', ir: true },
  { s: 'recib', ir: true, noun: 'o' }, { s: 'adquier', ir: true }, { s: 'adquir', ir: true }, { s: 'transfier', ir: true },
  { s: 'transfir', ir: true }, { s: 'transfer', ir: true }, { s: 'emit', ir: true },
  { s: 'realiz', light: true }, { s: 'realic', light: true }, { s: 'efectu', light: true }, { s: 'concret', light: true, noun: 'oa' },
  { s: 'complet', light: true, noun: 'oa' }, { s: 'registr', light: true, noun: 'o' }, { s: 'gener', light: true, noun: 'o' },
  { s: 'curs', light: true, noun: 'o' }, { s: 'ingres', light: true, noun: 'o' }, { s: 'formaliz', light: true },
  { s: 'formalic', light: true }, { s: 'cerr', light: true, noun: 'o' }, { s: 'cierr', light: true, noun: 'o' },
  { s: 'tramit', light: true }, { s: 'prepar', light: true }, { s: 'program', light: true }, { s: 'agend', light: true },
  // "Proceso de compra terminado": el complemento no afirma nada, el participio si.
  { s: 'termin', light: true }, { s: 'finaliz', light: true }, { s: 'finalic', light: true },
  // R7: "Se materializo la compra", "Se llevo a cabo el pago", "Se procedio con el despacho".
  { s: 'materializ', light: true }, { s: 'materialic', light: true }, { s: 'llev', light: true }, { s: 'proced', ir: true, light: true },
];
// Tiempos: "none" no afirma (infinitivo, subjuntivo), "now" afirma algo que una pregunta puede cubrir
// (presente, futuro, condicional, gerundio), "past" y "part" solo los cubre la atribucion. "o", "os" y
// "a" dependen de si esa forma tambien es sustantivo; "desc" es el sustantivo comercial.
type Tense = 'none' | 'now' | 'past' | 'part' | 'o' | 'os' | 'a' | 'desc' | undefined;
const CLITIC = '(?:se|me|te|le|les|lo|la|los|las|nos)*';
const AR_ENDINGS: [RegExp, Tense][] = [
  [new RegExp('^(?:(?:ar|\u00e1r)' + CLITIC + '|e|es|en|emos|\u00e9is|eis)$'), 'none'],
  [/^ad[oa]s?$/, 'part'],
  [/^(?:\u00e9|aste|\u00f3|asteis|aron|aba|abas|\u00e1bamos|abamos|aban|abais)$/, 'past'],
  [/^o$/, 'o'],
  [/^os$/, 'os'],
  [/^as?$/, 'a'],
  [new RegExp('^(?:amos|\u00e1is|ais|an|(?:a|\u00e1)ndo' + CLITIC + '|ar(?:\u00e1|a)[ns]?|ar(?:\u00e9|e)|aremos|ar(?:\u00ed|i)a(?:n|s|mos)?|(?:\u00e1|a)ramos|asen?)$'), 'now'],
];
const IR_ENDINGS: [RegExp, Tense][] = [
  [new RegExp('^(?:(?:ir|\u00edr|er)' + CLITIC + '|a|as|an|amos)$'), 'none'],
  [/^id[oa]s?$/, 'part'],
  [/^(?:\u00ed|i|iste|i\u00f3|io|isteis|ieron|(?:\u00ed|i)a(?:n|s|mos)?)$/, 'past'],
  [/^o$/, 'o'],
  [/^os$/, 'os'],
  [new RegExp('^(?:es|e|en|imos|\u00eds|is|iendo' + CLITIC + '|ir(?:\u00e1|a)[ns]?|ir(?:\u00e9|e)|iremos|ir(?:\u00ed|i)a(?:n|s|mos)?|ier(?:a|on)[ns]?|iesen?)$'), 'now'],
];
// "Hacer" y "pedir" son irregulares: se listan sus formas (sin "hacia" sin tilde, que es la
// preposicion). "Pide" y "piden" son pedidos del cliente, no hechos; "pidio" cuenta lo que ya paso.
// El infinitivo no afirma nada, salvo tras un verbo de logro ("logro hacer el pago").
const HACER_STEM: Stem = { s: 'hac', light: true };
const PEDIR_STEM: Stem = { s: 'ped' };
const IRREGULAR: Record<string, [Tense, Stem]> = Object.fromEntries([
  ...Object.entries({
    hice: 'past', hiciste: 'past', hizo: 'past', hicimos: 'past', hicieron: 'past', 'hac\u00eda': 'past', 'hac\u00edan': 'past', hacian: 'past',
    hecho: 'part', hecha: 'part', hechos: 'part', hechas: 'part', hacer: 'none',
    hace: 'now', hacen: 'now', hago: 'now', 'har\u00e1': 'now', hara: 'now', 'har\u00e1n': 'now', haran: 'now', 'har\u00eda': 'now', haria: 'now',
    'har\u00edan': 'now', harian: 'now', haciendo: 'now',
  } as Record<string, Tense>).map(([form, tense]) => [form, [tense, HACER_STEM]]),
  ...Object.entries({
    'pidi\u00f3': 'past', pidio: 'past', pidieron: 'past', 'ped\u00eda': 'past', pedia: 'past', 'ped\u00edan': 'past', pedian: 'past',
    'ped\u00ed': 'past', pedi: 'past', pedida: 'part', pedidas: 'part', pidiendo: 'now', 'pedir\u00e1': 'now', pedira: 'now',
    'pedir\u00e1n': 'now', pediran: 'now',
  } as Record<string, Tense>).map(([form, tense]) => [form, [tense, PEDIR_STEM]]),
]);
// "Ha pedido": el participio tras "haber" es un pedido que ya se hizo; "pedido" solo es el sustantivo.
const HABER = new Set(['ha', 'han', 'he', 'hemos', 'habia', 'habian', 'hubiera', 'habria', 'haya']);
// Lo que precede a una forma que tambien es sustantivo y la vuelve verbo: "Cliente pago", "se entrega".
const SUBJECTS = new Set(['cliente', 'clienta', 'clientes', 'se', 'le', 'les', 'lo', 'nos', 'me', 'te', 'ella', 'ellos']);
const ADVERBS = new Set(['ya', 'no', 'tambien', 'aun', 'nunca', 'siempre', 'recien', 'todavia', 'solo']);
const OBJECT_START = new Set(['los', 'las', 'un', 'una', 'unos', 'unas']);
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'al', 'del', 'un', 'una']);
const NOUN_BEFORE = new Set([...ARTICLES, 'unos', 'unas', 'de', 'con', 'sin', 'por', 'para', 'su', 'sus', 'este', 'esta', 'ese', 'esa',
  'otro', 'otra', 'cada', 'hace', 'hacen', 'hacer', 'haga', 'hagan', 'hay', 'tiene', 'tienen']);
const FUTURE_SER = new Set(['sera', 'seran', 'seria', 'serian']);
// "Recibido" tras lo que recibe el bot o ventas no es un pago ni una entrega: "Cotizacion recibida".
const RECEIVED_OK = /^(?:cotizacion(?:es)?|solicitud(?:es)?|consultas?|mensajes?|correos?|informacion|fotos?|fotografias?|imagen(?:es)?|archivos?|planos?|documentos?|requerimientos?)$/;
// [RESUMEN] Ni recibir un contacto o una respuesta ("No ha recibido contacto previo"), ni entregar,
// enviar o mandar datos (R7: "Cliente entrega nombre y correo", "Envio de fotos del tablero"): el objeto
// se mira tras los articulos y "de". Recibir, entregar o enviar otra cosa sigue siendo un hecho.
const INFO_OBJ = /^(?:contactos?|respuestas?|llamadas?|mensajes?|correos?|e?mails?|informacion|noticias?|atencion|asesorias?|visitas?|ayuda|orientacion|indicaciones?|nombres?|apellidos?|datos|rut|telefonos?|celular(?:es)?|numeros?|direccion(?:es)?|ubicacion(?:es)?|fotos?|fotografias?|imagen(?:es)?|videos?|planos?|archivos?|detalles?|especificaciones?|medidas?|antecedentes?|referencias?|consultas?|preguntas?|solicitud(?:es)?|requerimientos?|cuentas?|formularios?|codigos?)$/;
const INFO_STEMS = new Set(['recib', 'entreg', 'entregu', 'envi', 'mand']);
// Salvo el dato de un envio o de un pago, en cualquier parte de la clausula: "Se le envio el numero de
// seguimiento", "el numero de Starken", "un mensaje con el numero de guia", "los datos del
// transportista", "los datos bancarios" (los transportistas de REGION_CARRIERS; "cruz" por Cruz del Sur
// y "transportes" por Transportes Mena). Lo que ventas le manda al cliente o lo que el cliente recibe
// tampoco vale con un sustantivo comercial ("Cliente recibio los datos de pago").
const SHIPPED_REF = /^(?:seguimientos?|guias?|tracking|rastreos?|encomiendas?|transportistas?|transportes?|courier|starken|chilexpress|varmontt|samex|pdq|ecoex|pullman|bluexpress|cruz|bancari[oa]s?|bancos?)$/;
const TO_CLIENT = /^(?:le|les)$/;
const OBJECT_SKIP = /^(?:el|la|los|las|un|una|unos|unas|su|sus|ningun|ninguna|algun|alguna|otro|otra|nuevo|nueva|de|del|tod[oa]s|mas|tambien)$/;
const COMMERCIAL_TOKEN = /^(?:compras?|pagos?|pedidos?|orden(?:es)?|transferencias?|depositos?|abonos?|reservas?|facturas?|boletas?|ventas?|despachos?|envios?|entregas?|negocios?|tratos?|retiros?|oc|mercaderias?)$/;
// [RESUMEN] R7: la nominalizacion de un acto comercial tambien es el objeto de un verbo de apoyo ("Se
// efectuo la adquisicion de veinte focos"). Solo vale junto a ese verbo: no es un estado por si sola.
const LIGHT_OBJECT = /^(?:adquisicion(?:es)?|compraventas?|cobros?|devolucion(?:es)?|reembolsos?|acreditacion(?:es)?|cancelacion(?:es)?|contratacion(?:es)?|desembolsos?)$/;
// Despues del verbo de apoyo, lo que se pide o los datos tapan esa nominalizacion: "Cliente realizo una
// consulta sobre la adquisicion" o "Cliente completo los datos para la adquisicion" no cuentan una
// compra. El sustantivo comercial, en cambio, cuenta igual ("Se concreto la solicitud de compra").
const LIGHT_GUARD = /^(?:consultas?|preguntas?|solicitud(?:es)?|cotizacion(?:es)?|requerimientos?|averiguacion(?:es)?|peticion(?:es)?|datos|informacion|detalles?)$/;
// Como se hizo, entre el verbo de apoyo y su objeto, aunque un "y" parta la clausula: "Se efectuo sin
// inconvenientes y con exito la adquisicion".
const MANNER = /^(?:sin|con|de|manera|forma|modo|exito|problemas?|inconvenientes?|normalidad|hoy|ya|tambien|recien|\p{L}{3,}mente)$/u;
// El participio que concuerda con el sustantivo del sujeto: "Adquisicion de veinte focos efectuada".
const PARTICIPLE_RE = /(?:ad|id|ech)([oa])(s?)$/;
const FEMININE_RE = /(?:as?|ion(?:es)?)$|^(?:orden(?:es)?|oc)$/;
// [RESUMEN] R7: el infinitivo comercial tras un verbo de logro cuenta lo que ya paso: "El cliente logro
// adquirir las luminarias", "consiguio comprar", "alcanzo a pagar", "termino de pagar", "termino por
// comprar", "procedio a despachar", "fue a retirar". El tiempo lo pone el verbo de logro; su infinitivo
// o su subjuntivo no afirman nada.
const ACHIEVE: [Stem, string][] = [
  [{ s: 'logr' }, ''], [{ s: 'consegu', ir: true }, ''], [{ s: 'consigu', ir: true }, ''],
  [{ s: 'alcanz' }, 'a'], [{ s: 'alcanc' }, 'a'], [{ s: 'proced', ir: true }, 'a'],
  [{ s: 'termin' }, 'de'], [{ s: 'finaliz' }, 'de'], [{ s: 'finalic' }, 'de'], [{ s: 'termin' }, 'por'], [{ s: 'acab' }, 'por'],
];
// "Poder" solo en pasado: "pudo pagar" es un hecho; "puede pagar con transferencia" es una condicion.
const COULD = new Set(['pude', 'pudiste', 'pudo', 'pudimos', 'pudieron', 'podido']);
// "Fue a retirar", "vino a retirar": ir o venir en pasado, seguidos de "a".
const WENT = new Set(['fue', 'fueron', 'vino', 'vinieron']);
// Lo que puede ir entre el verbo de logro y el infinitivo: "logro al fin adquirir", "logro por fin
// pagar", "pudo hoy pagar", "logro exitosamente adquirir", "logro sin problemas adquirir".
const ACHIEVE_FILLER = /^(?:ya|no|tambien|aun|nunca|siempre|recien|todavia|solo|hoy|al|por|fin|sin|con|problemas?|inconvenientes?|exito|\p{L}{3,}mente)$/u;
// Solo los infinitivos que cuentan una compra, un pago, una venta o una entrega de mercaderia (y los
// verbos de apoyo, que miran su objeto): "no pudo enviar el formulario", "logro confirmar su correo" o
// "termino de reservar la sala" no.
const ACHIEVED_STEMS = new Set(['compr', 'recompr', 'pag', 'pagu', 'abon', 'deposit', 'adquier', 'adquir', 'transfier', 'transfir', 'transfer',
  'cobr', 'reembols', 'acredit', 'liquid', 'factur', 'vend', 'despach', 'entreg', 'entregu', 'envi', 'mand', 'recib', 'retir', 'devolv',
  'devuelv']);
const INFINITIVE_RE = new RegExp('(?:ar|er|ir|\u00e1r|\u00e9r|\u00edr)' + CLITIC + '$');
// "El cliente logro, finalmente, adquirir las luminarias": el inciso entre el verbo de logro y el
// infinitivo no corta la clausula.
const INCISE_RE = new RegExp(',\\s*((?:\\p{L}{3,}mente|al\\s+fin|por\\s+fin|sin\\s+(?:problemas?|inconvenientes?)|con\\s+(?:\u00e9|e)xito|hoy)),\\s*'
  + '(?=\\p{L}+(?:ar|er|ir|\u00e1r|\u00e9r|\u00edr)' + CLITIC + E + ')', 'giu');
// "Listo", "OK" o "conforme" junto a un sustantivo comercial: "Pedido de 20 focos listo", "OC lista".
const STATE_ADJ = /^(?:list[oa]s?|ok|okey|conforme)$/;
// La primera persona plural es la tienda que habla ("tenemos", "despachamos"): cuenta como un estado.
const WE_RE = /^\p{L}{2,}(?:amos|emos|imos)$/u;
const NOT_WE_RE = /^(?:\p{L}*gramos|t?ramos|reclamos|prestamos|minimos|maximos|ultimos|proximos|optimos|primos|legitimos|intimos|anonimos|animos|centimos|\p{L}*isimos|extremos|supremos|remos)$/u;
const TOKEN_RE = /[\p{L}\p{N}]+/gu;
// [RESUMEN] "Cliente" seguido de un adjetivo, un nombre o lo que hace es el tipo de cliente
// ("Cliente empresarial", "Cliente PRUEBATEC", "Cliente proporciona nombre y correo"). Es historial
// solo con un adjetivo de historial en las dos palabras que siguen, sin contar su tipo ni su nombre
// ("Cliente conocido", "Cliente empresa constructora frecuente"); "de la tienda", "desde 2020" y "hace
// anos" los mira ASK_RE. "Ex cliente" y "es cliente" sin su tipo ni un nombre tambien son historial.
const CLIENT_TOKEN = /^(?:ex)?(?:client[ea]s?|comprador(?:a|as|es)?|usuari[oa]s?)$/;
const CLIENT_SKIP = new Set(['tambien', 'ademas', 'no', 'tampoco', 'se', 'le', 'les', 'me', 'lo', 'la']);
const CLIENT_COPULA = new Set(['es', 'son', 'era', 'eran', 'fue', 'sea', 'ser']);
// Lo que se salta antes de mirar los adjetivos: "es", "un", "muy" ("El cliente es muy conocido").
const CLIENT_LEAD = new Set([...CLIENT_COPULA, 'un', 'una', 'muy', 'bastante', 'super', 'mas', 'tan']);
// Los adjetivos terminan en una preposicion, un articulo, un conector o lo que pide o dice el cliente:
// "Cliente con proyecto nuevo" o "Cliente pide focos nuevos" no hablan de su historial.
const CLIENT_STOP = /^(?:de|del|desde|con|sin|en|para|por|a|al|que|y|e|o|u|ni|el|la|los|las|un|una|su|sus)$/;
const REQUEST_TOKEN = /^(?:requier[ea]n?|solicit(?:a|an)|consult(?:a|an)|pregunt(?:a|an)|pide|piden|necesit(?:a|an)|busca|buscan|cotiz(?:a|an)|quier(?:e|en)|dese(?:a|an)|interes(?:a|an)|interesad[oa]s?|prefier(?:e|en))$/;
const SAYS_TOKEN = /^(?:dice|dijo|indica|indico|se(?:\u00f1|n)al(?:a|o)|afirma|afirmo|asegura|aseguro|cuenta|conto|comenta|comento|menciona|menciono|informa|informo|declara|declaro|sostiene|escribe|escribio|explica|explico|aclara|aclaro)$/;
const CLIENT_TYPE = /^(?:empresas?|constructor(?:a|as|es)?|instalador(?:a|as|es)?|electricistas?|arquitect[oa]s?|ingenier[oa]s?|particular(?:es)?|persona|municipalidad(?:es)?|municipios?|institucion(?:al|es)?|colegios?|corporativ[oa]s?|final(?:es)?|b2b|b2c|contratistas?|integrador(?:a|as|es)?|inmobiliarias?|industrial(?:es)?|potencial(?:es)?|pymes?|emprendedor(?:a|as|es)?)$/;
// Mas tipos que no cuentan entre las dos palabras que se miran: "Cliente comercial minorista frecuente".
const CLIENT_KIND = /^(?:empresarial(?:es)?|comercial(?:es)?|municipal(?:es)?|inicial(?:es)?|minoristas?|mayoristas?|public[oa]s?|privad[oa]s?|residencial(?:es)?)$/;
const UPPER_NAME_RE = /^\p{Lu}{2,}/u;
// Adjetivos de historial o de fidelidad, como palabras enteras: "especialista" o "nuevamente" no.
const HISTORY_ADJ = /^(?:conocid[oa]s?|antigu[oa]s?|habitual(?:es)?|frecuentes?|fiel(?:es)?|regular(?:es)?|recurrentes?|leal(?:es)?|vip|preferencial(?:es)?|preferentes?|nuev[oa]s?|viej[oa]s?|asidu[oa]s?|historic[oa]s?|premium|gold|oro|platin[oa]s?|platinum|especial(?:es)?|estrella|top|anterior(?:es)?|previ[oa]s?|actual(?:es)?|existentes?)$/;
// Un rotulo suelto ("Tipo de cliente: frecuente") tambien es historial.
const HISTORY_ALONE_RE = /^(?:muy\s+)?(?:frecuentes?|habitual(?:es)?|antigu[oa]s?|recurrentes?|conocid[oa]s?|fiel(?:es)?|leal(?:es)?|vip|premium|nuev[oa]s?)$/iu;
const NAME_RE = /^\p{Lu}\p{Ll}/u;

interface Token { at: number; orig: string; raw: string; f: string }
interface Fact { at: number; need: 'said' | 'ask' | 'noun' | 'order' | 'desc' }

const tokenize = (clause: string): Token[] => [...clause.matchAll(TOKEN_RE)]
  .map((m) => ({ at: m.index ?? 0, orig: m[0], raw: m[0].toLowerCase(), f: fold(m[0]) }));

function endingTense(stem: Stem, ending: string): Tense {
  for (const [re, tense] of stem.ir ? IR_ENDINGS : AR_ENDINGS) if (re.test(ending)) return tense;
  return undefined;
}

/** [RESUMEN] R7: el tiempo del verbo de logro antes del infinitivo ("logro adquirir", "alcanzo a pagar",
 * "pudo hoy pagar", "termino por comprar"): "past" o "now". Sin uno, "none": el infinitivo solo no
 * afirma nada. */
function achievedTense(tokens: Token[], i: number): Tense {
  const between = (from: number) => tokens.slice(from, i).every((t) => ACHIEVE_FILLER.test(t.f));
  for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
    const verb = tokens[j];
    if (COULD.has(verb.f) && between(j + 1)) return 'past';
    if (WENT.has(verb.f) && tokens[j + 1]?.f === 'a' && between(j + 2)) return 'past';
    for (const [stem, link] of ACHIEVE) {
      if (!verb.f.startsWith(stem.s) || (link && tokens[j + 1]?.f !== link) || !between(j + (link ? 2 : 1))) continue;
      const t = endingTense(stem, verb.raw.slice(stem.s.length));
      if (t === 'past' || t === 'part' || (t === 'o' && !stem.ir)) return 'past';
      if (t === 'now' || t === 'a' || t === 'o') return 'now';
    }
    if (!ACHIEVE_FILLER.test(verb.f) && !/^(?:a|de|por)$/.test(verb.f)) return 'none';
  }
  return 'none';
}

/** [RESUMEN] R7: el sustantivo comercial es el sujeto del verbo de apoyo ("La adquisicion de veinte
 * focos se efectuo", "Compra de 20 focos concretada"): el primero de la clausula, sin un "que" entre
 * medio. Un participio debe concordar con el: "Pedido de 20 focos para instalacion programada" habla de
 * la instalacion. */
function headObject(tokens: Token[], i: number, isObject: (t: Token) => boolean): boolean {
  const h = SUBJECT_DETERMINER.test(tokens[0]?.f ?? '') || ARTICLES.has(tokens[0]?.f ?? '') ? 1 : 0;
  const head = tokens[h];
  if (h >= i || !isObject(head) || tokens.slice(h + 1, i).some((t) => t.f === 'que')) return false;
  const part = PARTICIPLE_RE.exec(tokens[i].f);
  return !part || ((part[1] === 'a') === FEMININE_RE.test(head.f) && (part[2] === 's') === /s$/.test(head.f));
}

/** [RESUMEN] El sustantivo comercial del verbo de apoyo: hasta tres palabras antes ("Pago realizado",
 * "La compra quedo cerrada"), el sujeto de la clausula (R7) o hasta cuatro palabras despues. Si tras el
 * verbo solo se dice como se hizo, se mira el comienzo de la clausula que sigue ("Se efectuo sin
 * inconvenientes y con exito la adquisicion"). */
function lightObject(tokens: Token[], i: number, next: Token[]): boolean {
  const isObject = (t: Token) => COMMERCIAL_TOKEN.test(t.f) || LIGHT_OBJECT.test(t.f);
  if (tokens.slice(Math.max(0, i - 3), i).some(isObject) || headObject(tokens, i, isObject)) return true;
  let after = tokens.slice(i + 1);
  if (after.every((t) => MANNER.test(t.f))) {
    const rest = next.slice(Math.max(0, next.findIndex((t) => !MANNER.test(t.f))));
    if (rest[0] && (ARTICLES.has(rest[0].f) || isObject(rest[0]))) after = rest;
  }
  let guarded = false;
  for (const t of after.slice(0, 4)) {
    if (COMMERCIAL_TOKEN.test(t.f)) return true;
    if (LIGHT_GUARD.test(t.f)) guarded = true;
    else if (!guarded && LIGHT_OBJECT.test(t.f)) return true;
  }
  return false;
}

/** [RESUMEN] Los verbos comerciales de la clausula, por raiz y terminacion, y sus sustantivos. La clausula
 * que sigue tras una lista solo la mira el verbo de apoyo sin objeto. */
function verbFacts(tokens: Token[], nextClause: Token[]): Fact[] {
  const facts: Fact[] = [];
  tokens.forEach((tok, i) => {
    let j = i - 1;
    let sawYa = false;
    while (j >= 0 && ADVERBS.has(tokens[j].f)) { if (tokens[j].f === 'ya') sawYa = true; j--; }
    const prev = j >= 0 ? tokens[j].f : '';
    if (/^pedid[oa]s?$/.test(tok.f) && HABER.has(prev)) { facts.push({ at: tok.at, need: 'said' }); return; }
    if (STATE_ADJ.test(tok.f) && tokens.slice(Math.max(0, i - 6), i + 3).some((t) => COMMERCIAL_TOKEN.test(t.f))) {
      facts.push({ at: tok.at, need: 'said' });
      return;
    }
    let [tense, stem]: [Tense, Stem | undefined] = IRREGULAR[tok.raw] ?? [undefined, undefined];
    for (const candidate of stem ? [] : STEMS) {
      if (!tok.f.startsWith(candidate.s)) continue;
      const t = endingTense(candidate, tok.raw.slice(candidate.s.length));
      if (t) { stem = candidate; tense = t; break; }
    }
    // La primera persona plural es la tienda que habla ("tenemos", "despachamos"), salvo el subjuntivo
    // de un verbo comercial ("pide que le enviemos la cotizacion").
    if (WE_RE.test(tok.f) && !NOT_WE_RE.test(tok.f) && tense !== 'none') facts.push({ at: tok.at, need: 'ask' });
    // R7: el infinitivo comercial tras un verbo de logro toma su tiempo ("El cliente logro adquirir las
    // luminarias").
    if (stem && tense === 'none' && (stem.light || ACHIEVED_STEMS.has(stem.s)) && INFINITIVE_RE.test(tok.raw)) tense = achievedTense(tokens, i);
    if (!stem || !tense || tense === 'none') return;
    // Tambien es verbo si sigue un articulo plural o indefinido o una cifra: "Retiro los focos", "Pago 50%".
    const next = tokens[i + 1]?.f ?? '';
    // Pero tras un articulo, una preposicion o "hacen" es sustantivo: "si hacen despacho los sabados".
    const cue = sawYa || SUBJECTS.has(prev) || (!NOUN_BEFORE.has(prev) && (OBJECT_START.has(next) || /^\d/.test(next)));
    if (tense === 'o' || tense === 'os' || tense === 'a') {
      const isNoun = stem.noun?.includes(tense === 'a' ? 'a' : 'o');
      if (isNoun && (!cue || tense === 'os')) tense = stem.light || stem.nodesc ? undefined : 'desc';
      else if (tense === 'os') tense = undefined;
      else tense = tense === 'a' ? 'now' : stem.ir ? 'now' : 'past';
    } else if (tense === 'part') {
      // "Llegada" es sustantivo; "recibida" tras lo que recibe ventas no es un hecho; "sera enviado" es
      // futuro; "el encargado" es una persona.
      if (stem.s === 'lleg' && /^adas?$/.test(tok.raw.slice(4))) tense = undefined;
      else if (stem.s === 'recib' && RECEIVED_OK.test(prev)) tense = undefined;
      else if (stem.partNoun && ARTICLES.has(prev)) tense = undefined;
      else if (FUTURE_SER.has(prev)) tense = 'now';
    }
    if (!tense || (stem.pastOnly && tense === 'now')) return;
    if (INFO_STEMS.has(stem.s)) {
      let o = i + 1;
      while (o < tokens.length && OBJECT_SKIP.test(tokens[o].f)) o++;
      const toClient = stem.s === 'recib' || TO_CLIENT.test(prev);
      const ref = (t: Token) => SHIPPED_REF.test(t.f) || (toClient && COMMERCIAL_TOKEN.test(t.f));
      if (INFO_OBJ.test(tokens[o]?.f ?? '') && !tokens.slice(o + 1).some(ref)) return;
    }
    if (stem.light && !lightObject(tokens, i, nextClause)) return;
    facts.push({ at: tok.at, need: tense === 'now' ? 'ask' : tense === 'desc' ? 'desc' : 'said' });
  });
  return facts;
}

/** [RESUMEN] "Cliente" con un adjetivo de historial, "ex cliente" y "es cliente" sin su tipo. */
function clientFacts(tokens: Token[]): Fact[] {
  const facts: Fact[] = [];
  tokens.forEach((tok, i) => {
    if (!CLIENT_TOKEN.test(tok.f)) return;
    const fact = () => { facts.push({ at: tok.at, need: 'ask' }); };
    const prev = tokens[i - 1]?.f ?? '';
    if (tok.f.startsWith('ex') || prev === 'ex') return fact();
    // "Es cliente" o "es un cliente" tambien es historial.
    const copula = CLIENT_COPULA.has(prev) || (/^(?:un|una)$/.test(prev) && CLIENT_COPULA.has(tokens[i - 2]?.f ?? ''));
    let k = i + 1;
    while (k < tokens.length && CLIENT_SKIP.has(tokens[k].f)) k++;
    if (k >= tokens.length) { if (copula) fact(); return; }
    // Las dos palabras que siguen, sin contar su tipo ni su nombre, hasta una preposicion, un articulo
    // o lo que pide o dice.
    let a = k;
    while (a < tokens.length && CLIENT_LEAD.has(tokens[a].f)) a++;
    for (let n = a, seen = 0; n < tokens.length && seen < 2; n++) {
      const t = tokens[n];
      if (CLIENT_STOP.test(t.f) || REQUEST_TOKEN.test(t.f) || SAYS_TOKEN.test(t.f)) break;
      if (HISTORY_ADJ.test(t.f)) return fact();
      if (!CLIENT_TYPE.test(t.f) && !CLIENT_KIND.test(t.f) && !NAME_RE.test(t.orig) && !UPPER_NAME_RE.test(t.orig)) seen++;
    }
    if (!copula) return;
    // "Es cliente" solo vale seguido de su tipo o de un nombre: "Es cliente de empresa".
    const next = tokens[k];
    const m = /^(?:un|una|de)$/.test(next.f) ? k + 1 : k;
    // "Cliente de la empresa" solo lo mira COMPANY_CLIENT_RE, que conoce el nombre propio que sigue.
    if (tokens[m - 1]?.f === 'de' && tokens[m]?.f === 'la' && tokens[m + 1]?.f === 'empresa') return;
    const type = tokens[m];
    if (type && (CLIENT_TYPE.test(type.f) || (NAME_RE.test(type.orig) && !/^e?lights/.test(type.f)))) return;
    fact();
  });
  return facts;
}

const isPlace = (t: Token | undefined) => t !== undefined && !TIME_WORD.test(t.f)
  && (MODE_PLACE.test(t.f) || NAME_RE.test(t.orig) || UPPER_NAME_RE.test(t.orig));

/** La clausula es solo la modalidad de entrega y su lugar: "Retiro en tienda", "Retiro en tienda/punto
 * retiro", "Despacho a San Pedro de la Paz". Devuelve donde estan sus sustantivos. */
function modeLabel(tokens: Token[]): number[] {
  if (tokens.length < 3 || !MODE_NOUN.test(tokens[0].f) || !/^(?:en|a)$/.test(tokens[1].f)) return [];
  const at = [tokens[0].at];
  const start = MODE_ARTICLE.test(tokens[2].f) ? 3 : 2;
  if (!isPlace(tokens[start])) return [];
  for (let n = start + 1; n < tokens.length; n++) {
    const t = tokens[n];
    if (isPlace(t)) continue;
    // "punto retiro" o "punto de retiro": otro lugar de retiro.
    if (MODE_NOUN.test(t.f) && /^(?:puntos?|de)$/.test(tokens[n - 1].f)) { at.push(t.at); continue; }
    if (PLACE_JOIN.test(t.f) && n + 1 < tokens.length) continue;
    return [];
  }
  return at;
}

/** "con despacho a Chillan", "para envio a Iquique": el destino de lo que se pide, sin fecha despues. */
function destinations(tokens: Token[], clause: string): number[] {
  const at: number[] = [];
  tokens.forEach((t, n) => {
    if (!MODE_NOUN.test(t.f) || !/^(?:con|para)$/.test(tokens[n - 1]?.f ?? '') || !/^(?:a|en|hasta)$/.test(tokens[n + 1]?.f ?? '')) return;
    const place = tokens[MODE_ARTICLE.test(tokens[n + 2]?.f ?? '') ? n + 3 : n + 2];
    if (isPlace(place) && !COMPLEMENT_WHEN_RE.test(clause.slice(t.at))) at.push(t.at);
  });
  return at;
}

/** [RESUMEN] El nucleo del sujeto antes de la posicion "at", al empezar la clausula: "obra" en "La obra
 * esta en Lampa", tambien con su complemento ("La empresa del cliente", "El galpon a iluminar", "Las
 * fichas tecnicas"), el antecedente de un "que" ("Cliente con obra que se encuentra en Lampa") o, sin
 * sujeto, el de la clausula anterior de la lista si concuerda en numero con el verbo ("El cliente pide
 * 20 focos y se encuentra en Lampa"; en "El cliente pide 20 focos, estan en Starken" son los focos). */
function subjectHead(tokens: Token[], at: number, inherited: Token | undefined): Token | undefined {
  const before = tokens.filter((t) => t.at < at && !SUBJECT_SKIP.has(t.f));
  if (before.length === 0) {
    const verb = tokens.find((t) => t.at >= at);
    return inherited && verb && /n$/.test(verb.f) === /s$/.test(inherited.f) ? inherited : undefined;
  }
  const que = before.map((t) => t.f).lastIndexOf('que');
  if (que >= 0) return before[que - 1];
  const h = before.length > 1 && SUBJECT_DETERMINER.test(before[0].f) ? 1 : 0;
  const rest = before.slice(h + 1);
  if (rest.length === 0 || (rest.length <= 6 && SUBJECT_COMPLEMENT.test(rest[0].f))
    || (rest.length <= 2 && !rest.some((t) => COMMERCIAL_TOKEN.test(t.f)))) return before[h];
  return undefined;
}

/** La primera palabra de la clausula tras su articulo, que la clausula siguiente hereda como sujeto. */
function clauseHead(tokens: Token[]): Token | undefined {
  const list = tokens.filter((t) => !SUBJECT_SKIP.has(t.f));
  return list[list.length > 1 && SUBJECT_DETERMINER.test(list[0].f) ? 1 : 0];
}

const matches = (re: RegExp, text: string, need: Fact['need']): Fact[] => [...text.matchAll(re)].map((m) => ({ at: m.index ?? 0, need }));

// Niveles de cobertura: 0 nada, 1 pedido o consulta (stock, entrega por venir, historial), 2 atribuido.
function keepSentence(sentence: string): boolean {
  const parts = sentence.replace(INCISE_RE, ' $1 ').split(CLAUSE_SPLIT);
  const clauseAt = (n: number) => parts[n].replace(/^[^\p{L}\p{N}]+/u, '').replace(NOT_STOCK_RE, blank).replace(NOT_PAID_RE, blank);
  let prev = 0;
  let carry = 0;
  let prevHead: Token | undefined;
  for (let i = 0; i < parts.length; i += 2) {
    const clause = clauseAt(i);
    const chain = i > 0 && LIST_SEPARATOR.test(parts[i - 1]) ? Math.min(prev, 1) : 0;
    const listed = chain > 0 && !(parts[i + 1] ?? '').includes(':') && BARE_STOCK_RE.test(clause.replace(/[^\p{L}\p{N}]+$/u, '').trim());
    const continues = CONTINUES_RE.exec(clause);
    // "y si...", "y cuando...", o "?..." tras la consulta: la pregunta sigue.
    const asked = i > 0 && ((continues && !continues[1]) || DIRECT_QUESTION_RE.test(parts[i])) ? Math.min(prev, 1) : 0;
    const inherited = Math.max(carry, continues?.[1] && prev === 2 ? 2 : 0, asked);
    const said = SAYS_START_RE.test(clause) ? 0 : clause.search(ATTRIBUTION_RE);
    // "Confirmacion de" suelta pide el stock ("Confirmacion de stock"), pero no cubre el vocabulario
    // comercial: "Confirmacion de compra" o "Correo de confirmacion de pago" afirman la compra o el pago.
    const asks = [...clause.matchAll(REQUEST_RE)].map((m) => ({ end: (m.index ?? 0) + m[0].length, confirm: CONFIRM_START_RE.test(m[0]) }));
    // Entre el pedido mas cercano y el hecho: sin "que" y con lo que pide cada tipo de hecho.
    const askedFor = (at: number, ok: (between: string) => boolean, commercial = false) => {
      const end = asks.filter((a) => a.end <= at && !(commercial && a.confirm)).pop()?.end;
      return end !== undefined && !QUE_RE.test(clause.slice(end, at)) && ok(clause.slice(end, at));
    };
    // "Entrega inmediata solicitada": el participio de un pedido, despues y sin verbo entre medio.
    const requested = [...clause.matchAll(REQUESTED_RE)].map((m) => m.index ?? 0);
    const requestedAfter = (at: number) => requested.some((p) => p > at
      && !QUE_RE.test(clause.slice(at, p)) && !COPULA_RE.test(clause.slice(at, p)));
    const isQuestion = (between: string) => QUESTION_RE.test(between);
    const tokens = tokenize(clause);
    const listNext = i + 2 < parts.length && LIST_SEPARATOR.test(parts[i + 1]);
    const inheritedHead = i > 0 && LIST_SEPARATOR.test(parts[i - 1]) ? prevHead : undefined;
    const subject = (at: number) => subjectHead(tokens, at, inheritedHead);
    const placeHead = (at: number) => PLACE_SUBJECT.test(subject(at)?.f ?? '');
    const alone: Fact[] = HISTORY_ALONE_RE.test(clause.replace(/[^\p{L}\p{N}]+$/u, '').trim()) ? [{ at: 0, need: 'ask' }] : [];
    const templates = new Set(matches(TEMPLATE_RE, clause, 'desc').map((f) => f.at));
    for (const at of [...modeLabel(tokens), ...destinations(tokens, clause)]) templates.add(at);
    const colon = (parts[i + 1] ?? '').includes(':');
    // "Detalles de compra", "para despacho en Calama": el sustantivo comercial complementa a otro.
    const complement = (at: number) => !colon && !ARTICLE_START_RE.test(clause.slice(at))
      && NOUN_OF_RE.test(clause.slice(Math.max(0, at - 40), at)) && !COMPLEMENT_WHEN_RE.test(clause.slice(at));
    const facts = [
      ...verbFacts(tokens, listNext ? tokenize(clauseAt(i + 2)) : []),
      ...clientFacts(tokens),
      ...alone,
      ...matches(ATTRIBUTED_RE, clause, 'said'),
      ...matches(ASK_RE, clause, 'ask'),
      ...matches(LOCATION_RE, clause, 'ask').filter((f) => !placeHead(f.at)),
      ...matches(GOODS_STATE_RE, clause, 'ask').filter((f) => !placeHead(f.at)),
      ...matches(DISPOSAL_RE, clause, 'ask').filter((f) => !PERSON_SUBJECT.test(subject(f.at)?.f ?? '')),
      ...matches(DESC_RE, clause, 'desc'),
      ...matches(ORDER_RE, clause, 'order'),
      ...(listed ? [] : matches(STOCK_WORD_RE, clause, 'noun')),
      ...[...clause.matchAll(COMPANY_CLIENT_RE)]
        .filter((m) => !PROPER_NAME_RE.test(clause.slice((m.index ?? 0) + m[0].length)))
        .map((m): Fact => ({ at: m.index ?? 0, need: 'ask' })),
    ].filter((f) => !(f.need === 'desc' && (templates.has(f.at) || complement(f.at))));
    // Una clausula de lista sin verbo ("y el despacho a regiones") nombra otra cosa que se pide.
    const bareListItem = chain > 0 && !COPULA_RE.test(clause);
    const covered = (f: Fact) => inherited >= (f.need === 'said' ? 2 : 1) || (said >= 0 && said < f.at)
      || (f.need === 'ask' && askedFor(f.at, isQuestion))
      || (f.need === 'noun' && askedFor(f.at, (between) => COMPLEMENT_RE.test(between) || isQuestion(between)))
      || ((f.need === 'order' || f.need === 'desc') && askedFor(f.at, () => true, true))
      || (f.need === 'desc' && (bareListItem || requestedAfter(f.at)));
    if (!facts.every(covered)) return false;
    prevHead = clauseHead(tokens) ?? inheritedHead;
    prev = Math.max(said >= 0 ? 2 : asks.length ? 1 : 0, inherited, chain);
    carry = ATTRIBUTION_END_RE.test(clause.trim()) ? 2
      : colon && REQUEST_END_RE.test(clause.replace(/[^\p{L}\p{N}]+$/u, '').trim()) ? 1 : 0;
  }
  return true;
}

/** [RESUMEN] El resumen sin las frases que afirman hechos sin atribuirlos al cliente. */
export function safeSummary(summary: unknown): string {
  const text = typeof summary === 'string' ? summary.replace(/\s+/g, ' ').trim().slice(0, 600).normalize('NFC') : '';
  const sentences = text.split(/(?<=[.;!?])\s+|;\s*/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_SENTENCES);
  const kept = sentences.filter(keepSentence);
  if (kept.length < sentences.length) console.log('[summary] frases descartadas: ' + (sentences.length - kept.length));
  return kept.join(' ') || SUMMARY_EMPTY;
}
