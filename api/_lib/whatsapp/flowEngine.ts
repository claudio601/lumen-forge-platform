// api/_lib/whatsapp/flowEngine.ts
// shouldNotify es siempre false aqui - la regla real vive en webhook.ts.
import { inspectRut, isBusinessRut, removeRuts } from './rutCapture.js';
import type { RutFound, RutTipo } from './rutCapture.js';
import { itemsIn, mentionsQuantity, readQuantity } from './quantity.js';
import type { QuantityRead } from './quantity.js';
import { findComunaMentions, findComunas, mentionsCompany, officialComuna } from './comunas.js';
import type { ComunaMention } from './comunas.js';

export type FlowStage = 'stage1' | 'stage2' | 'stage3' | 'install_capture' | 'closed';
export type CaptureStatus = 'complete' | 'partial' | 'incomplete';
export type LeadType = 'B2B' | 'B2C' | 'Unknown';

export interface CapturedFields {
  producto?: string;
  tipo_de_luz?: string;
  cantidad?: string;
  // [CANTIDAD] Varias cantidades en un mensaje (varios items, hasta la PR 9): la cantidad queda
  // vacia y aqui va el texto del cliente, para la nota. Cuenta como respondida: no se repregunta.
  cantidad_varios?: string;
  // [METROS] La cantidad es en metros ("500 metros" de cinta): la nota dice "500 m". Se escribe y se borra junto
  // con la cantidad (stateStore mezcla dato por dato).
  cantidad_unidad?: 'm';
  proyecto_o_uso?: string;
  comuna_o_ciudad?: string;
  // [COMUNA] Otras comunas que el cliente dio como lugar ("la obra en Lampa y la factura en Vina del
  // Mar"), para la nota: la comuna es una sola.
  comunas_otras?: string[];
  nombre_o_empresa?: string;
  correo?: string;
  // [RUT-VALIDO] RUT con formato NN.NNN.NNN-D (rutCapture.ts). rut_valido: calza el digito
  // verificador; rut_tipo, solo si es valido. Antes era rut_empresa, sin validar.
  rut?: string;
  rut_valido?: boolean;
  rut_tipo?: RutTipo;
  rut_ambiguos?: string[];
  // [NO-PISAR] Cambios explicitos de un dato ya capturado ("Cantidad: antes 2, ahora 3"), para la nota.
  cambios?: string[];
  // Campos especificos para instalacion
  install_nombre?: string;
  install_correo?: string;
  install_comuna?: string;
  install_tipo_proyecto?: string;
  install_telefono?: string;
  install_descripcion?: string;
}

export interface FlowState {
  stage: FlowStage;
  captured: CapturedFields;
  repreguntasStage1: number;
  repreguntasStage2: number;
  repreguntasStage3: number;
  repreguntasInstall: number;
  wantsHuman: boolean;
  captureStatus: CaptureStatus;
  firstMessageAt: number;
  leadType: LeadType;
  isInstallFlow: boolean;
  // [CIERRE-HONESTO] El atajo de "pidio ejecutivo" ya pidio el correo: lo pide una sola vez.
  humanEmailAsked: boolean;
  // [CIERRE-HONESTO] Resultado del negocio en Pipedrive, segun la respuesta de Pipedrive que
  // anota webhook.ts (recordDealOutcome). Sin valor: no se intento crear.
  deal?: 'registered' | 'failed';
  dealId?: number;
  // [RUT-VALIDO] Ya se pidio de nuevo un RUT cuyo digito verificador no calzaba (se pide una vez).
  rutRetryAsked?: boolean;
  // [RUT-VALIDO] La ultima respuesta del bot pidio el RUT (la etapa 3 de una empresa o la
  // repregunta): solo el mensaje que la contesta puede traer el numero solo, sin guion.
  rutAskedLast?: boolean;
  // [CANTIDAD] La ultima pregunta del bot. Un numero suelto vale como cantidad solo si ella la
  // pidio; entre 1 y el largo de su lista numerada, se aclara (CASO-1). La usa tambien la PR 3.
  // null: la ultima respuesta no pregunto nada. Sin la propiedad: estado guardado antes de este
  // cambio, y la pregunta se deduce de la etapa (lastQuestionOf).
  lastQuestion?: LastQuestion | null;
  // [CASO-1] Etapa (2 o 3) en que ya se repitio la pregunta por un numero suelto: se repite una vez.
  menuRepeatedIn?: FlowStage;
}

export type AskedField = 'producto' | 'tipo_de_luz' | 'cantidad' | 'proyecto_o_uso' | 'comuna_o_ciudad' | 'nombre' | 'rut' | 'correo';
export interface LastQuestion {
  asks: AskedField[];
  /** Items de su lista numerada "1) 2) 3)" (0 si no tenia). */
  listLength: number;
}

export interface FlowResult {
  reply: string;
  shouldCreateDeal: boolean;
  shouldNotify: boolean;
  captureStatus: CaptureStatus;
  captured: CapturedFields;
  wantsHuman: boolean;
  closedFlow: boolean;
  // [RUT-VALIDO] Un RUT (o, [TRANSCRIPCION], un correo) que llega despues del cierre se suma a un
  // negocio ya registrado: si Pipedrive no lo confirma, el negocio sigue registrado (webhook.ts no
  // lo marca como fallido).
  rutUpdate?: boolean;
}

/** [CANTIDAD] Paso del flujo con la pregunta que hace su respuesta (processFlowStep la guarda). */
type StepResult = FlowResult & { question?: LastQuestion };

// [COPY-v3] Mensaje inicial
export const MSG1 = 'Hola! Soy el asistente de eLIGHTS.cl \u{1F44B}\n\nEstoy ayudando a gestionar las solicitudes de iluminacion para responder mas rapido y dejar todo listo para cotizacion.\n\nCuentame:\n1) Que producto buscas\n2) Que tipo de luz prefieres\n3) Cuantas unidades necesitas aprox.';
export const MSG2 = 'Excelente. Para recomendarte las mejores opciones, necesito saber un poco mas:\n1) Para que espacio o proyecto es la instalacion?\n2) En que comuna o ciudad seria?';
export const MSG3 = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre y empresa (si aplica)\n2) Tu correo de contacto';
export const MSG3_B2B = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) El RUT de la empresa\n2) Tu correo de contacto';
export const MSG3_B2C = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre\n2) Tu correo de contacto';

// [COPY-v2] Cierre mejorado
export const MSG4 = 'Listo! Tu solicitud quedo registrada en eLIGHTS.cl y ya la derivamos para cotizacion.\n\nUn ejecutivo revisara tu requerimiento y te contactara por correo con los detalles.';
export const MSG4_B2B = 'Listo! Tu requerimiento comercial quedo registrado en eLIGHTS.cl y ya lo derivamos a nuestro equipo de ventas.\n\nUn ejecutivo revisara tu proyecto y te enviara la cotizacion por correo.';

// [INSTALL-FLOW] Mensaje de cierre para flujo de instalacion
// [SIN-VISITA] Especificacion 5: el bot nunca ofrece visitas (negocio 195: "coordinar la visita" a quien solo
// compraba focos). Es el cierre aprobado por el dueno (2026-11-11, "Cierre con la solicitud registrada").
export const MSG4_INSTALL = 'Tu solicitud qued\u00f3 registrada. Claudio Quero te responder\u00e1 por correo el mismo d\u00eda h\u00e1bil.';
// [BOT-SOLO-CORREO] Cierre de instalacion sin correo (tras las repreguntas): no se crea el
// negocio, asi que no se promete contacto; se pide el correo o escribir a ventas@.
export const MSG4_INSTALL_NO_EMAIL = 'Gracias. Para cotizar tu instalaci\u00f3n necesitamos tu correo de contacto: escr\u00edbelo por aqu\u00ed o env\u00edanos tu solicitud a ventas@elights.cl.';

/** Cierre del flujo de instalacion: solo promete el correo si lo tenemos. */
export function installClosingMsg(captured: CapturedFields): string {
  return captured.install_correo ? MSG4_INSTALL : MSG4_INSTALL_NO_EMAIL;
}

// [BOT-SOLO-CORREO] Dueno (2026-10-16): la atencion de una persona es por correo, nunca por este
// canal (lo atiende solo el asistente). [CIERRE-HONESTO] Sale una sola vez, al cerrar con
// correo, y webhook.ts la cambia por MSG_DEAL_FAILED si Pipedrive no confirma el negocio.
export const MSG_HUMAN = 'Perfecto, ya deriv\u00e9 tu solicitud a nuestro equipo de ventas. Te va a atender Claudio Quero directamente por correo.';
export const MSG_MEDIA = 'Recibimos tu imagen/archivo, gracias. Por ahora atendemos mejor por texto: cuentanos que producto necesitas, para que proyecto y que cantidad aproximada, y te ayudamos de inmediato.';
export const MSG_EXECUTIVE = 'Perfecto \u{1F44D} Si prefieres hablar directamente con un ejecutivo, puedes escribirle por correo:\n\u{1F4E9} claudio@elights.cl\n\u{1F4E9} constanza@elights.cl\n\nDe todas formas, si quieres, tambien puedo ayudarte a dejar tu solicitud lista para cotizacion por ac\u00e1.';

// [FIX-EMAIL-GATE] Mensaje para pedir correo antes de derivar
// [CIERRE-HONESTO] Texto A, aprobado por el dueno (2026-10-16). Se usa cuando pidio un ejecutivo
// y falta el correo, y en el cierre sin correo (sin correo la solicitud no queda registrada).
export const MSG_NEED_EMAIL = 'Para que Claudio Quero te atienda por correo, necesito tu correo. \u00bfMe lo escribes por aqu\u00ed? Si prefieres, env\u00eda tu solicitud a ventas@elights.cl.';
// [CORREO-PROPIO] Dueno (2026-11-11): un correo @elights.cl que no publica el bot (gerencia@, en una prueba)
// nunca se registra como el del cliente; antes el bot repetia el texto A sin decir por que.
export const MSG_OWN_EMAIL = 'Ese correo es de eLIGHTS. Para registrar tu solicitud necesito tu propio correo, de tu empresa o personal. \u00bfMe lo escribes por aqu\u00ed? Si prefieres, env\u00eda tu solicitud a ventas@elights.cl.';
// [SIN-REPETIR] La pregunta corta por el correo de la etapa 3 (texto existente). Tambien alterna con el texto A para
// no repetirlo igual en mensajes seguidos.
export const MSG_EMAIL_SHORT = 'Para registrar tu solicitud necesito tu correo de contacto.';
export const OWN_EMAIL_NOTE = 'Ese correo es de eLIGHTS: necesito tu propio correo, de tu empresa o personal.';
// [PLAZO] Dueno (2026-11-11, decision 4 de la especificacion): el bot promete la respuesta "el mismo dia
// habil", como la web. Solo con el negocio registrado y cuando el cliente pregunta que sigue o cuanto demora.
export const MSG_WAIT = 'No tienes que hacer nada m\u00e1s. Te enviaremos la cotizaci\u00f3n por correo el mismo d\u00eda h\u00e1bil.';
// [PLAZO] Despacho o retiro despues del cierre: el bot no promete plazos de entrega; van en la cotizacion.
export const MSG_WAIT_DELIVERY = 'El plazo y el costo del despacho van en la cotizaci\u00f3n, que te enviaremos por correo el mismo d\u00eda h\u00e1bil.';
// [PREGUNTA] Textos aprobados por el dueno (2026-11-11, propuesta-dueno.md): pregunta por precio o stock, por ficha
// tecnica o una duda tecnica, y por la ubicacion. El bot no contesta precios, stock ni asesoria tecnica.
export const MSG_Q_PRICE = 'Claudio Quero revisar\u00e1 el precio y la disponibilidad y te responder\u00e1 por correo el mismo d\u00eda h\u00e1bil. \u00bfCu\u00e1l es tu correo?';
export const MSG_Q_TECH = 'Claudio Quero revisar\u00e1 tu consulta y te responder\u00e1 por correo el mismo d\u00eda h\u00e1bil. \u00bfCu\u00e1l es tu correo?';
export const MSG_LOCATION = 'Somos una tienda online con bodega en Quinta Normal y despachamos a todo Chile.';
// [PREGUNTA] Con el correo ya anotado, los mismos textos sin la pregunta final por el correo.
export const MSG_Q_PRICE_HAS_EMAIL = 'Claudio Quero revisar\u00e1 el precio y la disponibilidad y te responder\u00e1 por correo el mismo d\u00eda h\u00e1bil.';
export const MSG_Q_TECH_HAS_EMAIL = 'Claudio Quero revisar\u00e1 tu consulta y te responder\u00e1 por correo el mismo d\u00eda h\u00e1bil.';
// [PLAZO] Cualquier otro mensaje con el negocio registrado: un recordatorio corto, no el cierre largo otra vez.
export const MSG_REGISTERED_SHORT = 'Tu solicitud ya qued\u00f3 registrada; te escribimos por correo.';
// [CIERRE-HONESTO] Texto B, aprobado por el dueno (2026-10-16). Pipedrive no confirmo el negocio
// (o el paso del flujo fallo): nunca se dice "quedo registrada".
export const MSG_DEAL_FAILED = 'No pude registrar tu solicitud por un problema t\u00e9cnico. Por favor, env\u00edala a ventas@elights.cl y Claudio Quero te responde por correo.';
// [REGISTRO] Otro mensaje del numero sigue registrando la solicitud y no termino a tiempo: no se afirma el
// registro ni se da por fallido. Texto aprobado por el dueno (2026-10-31).
export const MSG_DEAL_PENDING = 'Estoy terminando de registrar tu solicitud; te confirmo por este chat en un momento. Si no te llega la confirmaci\u00f3n, env\u00edala a ventas@elights.cl y Claudio Quero te responde por correo.';
// [RUT-VALIDO] El RUT no calza con su digito verificador: se pide de nuevo, una sola vez.
// Texto aprobado por el dueno (2026-10-26).
export const MSG_RUT_INVALID = 'El RUT que me enviaste no calza con su d\u00edgito verificador. \u00bfMe lo escribes de nuevo, con guion y d\u00edgito verificador? Por ejemplo: 12.345.678-5.';
/**
 * [CASO-1] Un numero suelto entre 1 y el largo de la lista numerada que el bot acaba de mostrar
 * (texto de la PR 2 del plan del bot): antes el "1" pasaba por cantidad.
 */
export function menuClarifyMsg(pick: number): string {
  return '\u00bfMe confirmas a qu\u00e9 te refieres con \u00ab' + pick + '\u00bb? Cu\u00e9ntame qu\u00e9 producto buscas, cu\u00e1ntas unidades y el color de luz.';
}
export const MSG_NEED_EMAIL_AND_CONTEXT = 'Con gusto te ayudo. Para registrar tu solicitud necesito dos cosas: \u00bfque producto o proyecto necesitas iluminar, y cual es tu correo de contacto?';
// [INSTALL-FLOW] Deteccion de intencion de instalacion/servicio (installRequested): activa el flujo de captura de
// lead para instalacion antes de cualquier derivacion.
// [INSTALL-FLOW] "Soy instalador" describe a quien escribe (compra para instalar), no pide una
// instalacion: va al flujo de productos. "Busco un instalador" si la pide.
const INSTALLER_SELF_RE = /\b(?:(?:soy|somos)\s+(?:(?!(?:busco|buscamos|necesito|necesitamos|quiero|queremos|requiero|que|para)\b)[a-z\u00e0-\u00fc]+\s+){0,3}?instalador(?:a|es|as)?(?:\s+el[e\u00e9]ctric[oa]s?)?|(?:trabajo|me\s+desempe[n\u00f1]o)\s+(?:como|de)\s+instalador(?:a|es|as)?|me\s+dedico\s+a\s+(?:la\s+|las\s+)?instal\w*|soy\s+(?:un\s+|una\s+)?(?:electricista|contratista|t[e\u00e9]cnico\s+el[e\u00e9]ctrico))\b/gi;
// Quien se presenta como instalador solo pide una instalacion con un pedido de servicio a eLIGHTS ("que me
// instalen", "servicio de instalacion", "mano de obra", "quiero cotizar la instalacion", "cuanto cobran la
// instalacion"): "necesito 50 paneles para una instalacion" o "estoy cotizando una instalacion para un
// cliente" es una compra para su trabajo.
const INSTALL_SERVICE_RE = /\b(?:servicio\s+de\s+instal|que\s+(?:(?:me|nos|se)\s+)?(?:(?:lo|los|la|las)\s+)?instal(?:en|e)\b|mano\s+de\s+obra|busco\s+(?:un\s+|una\s+|otro\s+|otra\s+)?instalador|(?:necesito|necesitamos|quiero|queremos|requiero|requerimos)\s+(?:tambi[e\u00e9]n\s+)?(?:la\s+|una\s+|el\s+|un\s+)?(?:instalaci[o\u00f3]n|instalador)|(?:quiero|queremos|quisiera|quisi[e\u00e9]ramos|necesito|necesitamos|pueden|puede|podr[i\u00ed]an?)\s+cotizar(?:me|nos)?\s+(?:la\s+|una\s+|el\s+)?(?:instalaci[o\u00f3]n|montaje)|(?:me|nos)\s+(?:cotizan|cotiza|cotizas|pueden\s+cotizar|podr[i\u00ed]an\s+cotizar)\s+(?:la\s+|una\s+|el\s+)?(?:instalaci[o\u00f3]n|montaje)|ustedes\s+(?:tambi[e\u00e9]n\s+)?instalan|(?:hacen|realizan|ofrecen)\s+(?:la\s+|el\s+servicio\s+de\s+)?instalaci[o\u00f3]n|cu[a\u00e1]nto\s+(?:sale|cuesta|cobran|vale|costar[i\u00ed]a|saldr[i\u00ed]a)\s+(?:por\s+)?(?:la\s+)?instalaci[o\u00f3]n|cu[a\u00e1]nto\s+cobran\s+por\s+instalar)/i;
// "quiero un presupuesto para la instalacion", "precio de instalacion", "cotizar instalacion para mi casa": pedido
// del servicio, salvo que el mensaje pida productos con su cantidad ("necesitamos presupuesto para una
// instalacion de 40 tubos LED" es una compra para su obra).
const SERVICE_QUOTE_RE = /\b(?:(?:presupuesto|precio|valor|costo|cotizaci[o\u00f3]n)\s+(?:de|para|por)\s+(?:la\s+|una\s+|el\s+)?(?:instalaci[o\u00f3]n|montaje)|cotizar(?:me|nos)?\s+(?:la\s+|una\s+|el\s+)?(?:instalaci[o\u00f3]n|montaje))/i;
// El instalador que cotiza su obra ("tengo que cotizar la instalacion", "me pidieron cotizar", "para armar el
// presupuesto de la instalacion") no pide el servicio.
const OWN_QUOTE_RE = /\b(?:(?:tengo|tenemos|debo|debemos|hay)\s+que|(?:me|nos)\s+pidieron|para)\s+(?:cotizar|armar|hacer|preparar)\b|\b(?:armar|hacer|preparar)\s+(?:el\s+|un\s+|mi\s+|nuestro\s+)?presupuesto/i;
function quotesService(text: string): boolean {
  if (!SERVICE_QUOTE_RE.test(text) || OWN_QUOTE_RE.test(text)) return false;
  const quantity = readQuantity(text);
  return quantity.value === undefined && !quantity.several;
}
// [INSTALL-FLOW] `body` llega sin lo que el cliente niega (maskNegated): "no quiero instalacion" no la pide.
// [SIN-VISITA] El sustantivo solo no pide el servicio: "Nuestra instalacion funciona con 12V" o "Mi instalacion
// electrica es de 220V" describen la del cliente (negocio 195). Si lo piden "quiero instalar", "busco un
// instalador", "servicio de instalacion", "cotizar instalacion" o "que me los instalen".
function installRequested(body: string): boolean {
  const rest = body.replace(INSTALLER_SELF_RE, ' ');
  if (rest !== body) return INSTALL_SERVICE_RE.test(rest) || quotesService(rest);
  return installRequestedMidProducts(body) || INSTALL_ASK_RE.test(body);
}
// [SIN-VISITA] (revision 12-11) Tambien "busco instalacion electrica", "con instalacion incluida" e "incluye instalacion?":
// piden el servicio, como en main. Describir la propia ("mi instalacion es de 220V") sigue sin pedirlo.
const INSTALL_ASK_RE = /\b(?:instalador(?:a|es|as)?|servicio\s+de\s+instal\w*|cotizar\s+(?:la\s+|una\s+)?instalaci[o\u00f3]n|proyecto\s+de\s+instalaci[o\u00f3]n|(?:busco|buscamos|necesito|necesitamos|quiero|queremos|requiero|requerimos)\s+(?:la\s+|una\s+|el\s+|un\s+)?instalaci[o\u00f3]n|con\s+(?:la\s+|su\s+)?instalaci[o\u00f3]n(?=\s*(?:[?.!,;]|$)|\s+(?:y|para|en|por|incluid[oa])\b)|instalaci[o\u00f3]n\s+incluida|incluyen?\s+(?:la\s+|el\s+servicio\s+de\s+)?instalaci[o\u00f3]n)\b/i;
// A mitad del flujo de productos, "la instalacion es en una bodega" o "los voy a instalar en mi casa" contestan
// la pregunta del bot (MSG2): solo un pedido de instalacion ("que me los instalen", "quiero instalar focos en
// mi casa", "cuanto cobran la instalacion") cambia de flujo.
const WANT_INSTALL_RE = /\b(?:quiero|queremos|necesito|necesitamos)\s+instalar\b/i;
function installRequestedMidProducts(body: string): boolean {
  const rest = body.replace(INSTALLER_SELF_RE, ' ');
  return INSTALL_SERVICE_RE.test(rest) || quotesService(rest) || (rest === body && WANT_INSTALL_RE.test(body));
}
const GREET_ONLY = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|hi|hey|buen dia)[.!?\s]*$/i;
const NEW_REQ_INTENT_RE = /\b(necesito|busco|quiero|requiero|cotizar|cotizaci[o\u00f3]n|comprar|conseguir|tengo un proyecto)\b/i;

// [FIX-CONTINUATION] Frases de continuidad
const CONTINUATION_RE = /\b(seguir|continuar|retomar|la cotizaci[o\u00f3]n|lo anterior|la misma|el mismo|anterior|misma solicitud)\b/i;
const NEW_REQ_SOLO_LUZ_RE = /^(c[a\u00e1]lida|calida|neutra|fr[i\u00ed]a|fria|warm|cool|daylight|3000k|4000k|6500k|blanca|amarilla)[.!?\s]*$/i;
const NEW_REQ_SOLO_PROYECTO_RE = /^(quincho|terraza|patio|living|comedor|dormitorio|habitaci[o\u00f3]n|cocina|ba[\u00f1n]o|ba[\u00f1n]os|bodega|oficina|casa|local comercial|local|galp[o\u00f3]n|galpon|faena|tienda|exterior|interior|planta|fabrica|nave industrial|departamento|edificio)[.!?\s]*$/i;
const NEW_REQ_SOLO_RUT_RE = /^\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK][.!?\s]*$/;
const NEW_REQ_SOLO_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[.!?\s]*$/;
const PRICE_INTENT_RE = /\b(precio|precios|cu[a\u00e1]nto (cuesta|vale|sale|cuestan|valen|salen)|valor|valores|cuanto sale|cuanto cuesta|cuanto vale)\b/i;
const COMMERCIAL_INTENT_RE = /\b(cotizar|cotizaci[o\u00f3]n|comprar|necesito|busco)\b/i;
const EXECUTIVE_RE = /\b(claudio|constanza)\b/i;

// [TRANSCRIPCION] Un pedido nuevo explicito despues del cierre: "otro pedido", "otra solicitud", "otra
// cotizacion", "otro proyecto", "tengo otra obra", "un nuevo pedido", "Nuevo pedido:", "Nueva solicitud:", "ademas
// necesito cotizar" y "Otra cosa:" con un producto. Va antes que el correo tardio (lateEmail), que las
// correcciones y que la conversacion cerrada sin resultado de Pipedrive (continueClosedWithoutDeal): el negocio
// anterior no se toca y el flujo nuevo captura el pedido y el correo de ese mensaje.
// Antes "Otro pedido: paneles LED ... Mi correo es X" cambiaba el correo del anterior.
// No cuentan el que ya existe ("mi otro pedido", "la otra cotizacion"), el negado ("no es otro pedido", "es el
// mismo, no otro proyecto", "para no hacer otro pedido") ni una pregunta ("Llego mi otro pedido?"), salvo la que
// lo pide ("Puedo hacer otro pedido?"), ni la que pide reenviar la misma (SEND_BEFORE_RE).
const NEW_THING = '(?:pedidos?|solicitud(?:es)?|cotizaci[o\\u00f3]n(?:es)?|proyectos?|compras?|requerimientos?|obras?)';
const EXPLICIT_NEW_REQUEST_RE = new RegExp('(?<![a-z\\u00e0-\\u00fc])(?:otr[oa]s?\\s+' + NEW_THING
  + '|(?:(?:un|una|unos|unas)\\s+)?nuev[oa]s?\\s+' + NEW_THING
  + '|adem[a\\u00e1]s\\s+(?:necesit|quier|requier)[a-z]*\\s+(?:cotizar|comprar|pedir)'
  + '|(otra\\s+cosa))(?![a-z\\u00e0-\\u00fc])', 'gi');
const EXISTING_BEFORE_RE = /(?<![a-z\u00e0-\u00fc])(?:el|la|los|las|lo|al|del|mi|mis|tu|tus|su|sus|nuestr[oa]s?|es[ea]s?|est[ea]s?|aquel(?:la)?s?)\s+$/i;
const NEGATION_RE = /(?<![a-z\u00e0-\u00fc])(?:no|ni|sin|nunca|jam[a\u00e1]s|tampoco)(?![a-z\u00e0-\u00fc])/i;
const ASKS_TO_ORDER_RE = /(?<![a-z\u00e0-\u00fc])(?:puedo|podemos|podr[i\u00ed]a|podr[i\u00ed]amos|puede|pueden|se\s+puede|quiero|quisiera|queremos|necesito|necesitamos|me\s+gustar[i\u00ed]a)\s+(?:(?:hacer|pedir|solicitar|cotizar|enviar|mandar|ingresar|dejar|generar)(?:le|les)?\s+)?(?:(?:un|una)\s+)?$/i;
const CLAUSE_MARKS = [',', ';', '.', ':', '!', '?', '\n', '\u00bf', '\u00a1'];
const SENTENCE_END_RE = /[.!?\n]/;
// "Me pueden enviar otra cotizacion? La anterior no me llego": enviar o mandar otra, sin un producto en el mensaje,
// pide reenviar la misma o no trae nada nuevo; no es un pedido nuevo explicito (antes reiniciaba el flujo y la
// solicitud anterior, quizas sin registrar, no se reintentaba). Con un producto si ("Me pueden enviar otra cotizacion
// por 30 paneles LED?").
const SEND_BEFORE_RE = /(?<![a-z\u00e0-\u00fc])(?:re)?(?:envi|env\u00ed|m[a\u00e1]nd)[a-z\u00e0-\u00fc]*\s+(?:(?:me|nos|le|les)\s+)?$/i;
function explicitNewRequest(body: string): boolean {
  const text = body.slice(0, MAX_FACTS);
  for (const m of text.matchAll(EXPLICIT_NEW_REQUEST_RE)) {
    const head = text.slice(Math.max(0, m.index - 60), m.index);
    const clause = head.slice(Math.max(...CLAUSE_MARKS.map((c) => head.lastIndexOf(c))) + 1);
    if (EXISTING_BEFORE_RE.test(head) || NEGATION_RE.test(clause)) continue;
    const tail = text.slice(m.index);
    const end = tail.search(SENTENCE_END_RE);
    const sentence = head.slice(Math.max(...['.', '!', '?', '\n'].map((c) => head.lastIndexOf(c))) + 1) + (end < 0 ? tail : tail.slice(0, end + 1));
    if ((sentence.includes('?') || sentence.includes('\u00bf')) && !ASKS_TO_ORDER_RE.test(clause)) continue;
    // "Otra cosa:" pide algo nuevo solo con un producto en la misma oracion ("Otra cosa: mi correo es X" no).
    const rest = end < 0 ? tail : tail.slice(0, end);
    if (m[1] && !PRODUCTO_RE.test(rest)) continue;
    if (SEND_BEFORE_RE.test(clause) && !PRODUCTO_RE.test(text)) continue;
    return true;
  }
  return false;
}

// [CIERRE] Lista cerrada: toda palabra adicional conserva la decision de main.
const QUOTE_STATUS_RE = /^(?:(?:hola|buenas|gracias|por favor) )*(?:(?:me|nos) (?:pueden )?confirma(?:n|r)|(?:llego|ya llego|enviaron|mandaron|recibieron)|cuando (?:me|nos) (?:llega|mandan|envian)|(?:como va|en que va|estado de)) (?:la|mi|esa) (?:nueva|otra) cotizacion(?: (?:hola|buenas|gracias|por favor))*$/;
const COURTESY_RE = /^(?:(?:hola|buenas|gracias|por favor) ?)*$/;
// Un anuncio ("Mi nueva cotizacion:", "La otra cotizacion \u{1F447}") presenta lo que sigue; no pregunta.
const ANNOUNCES_RE = /:(?!-?[()])|[\u2193\u2b07\u27a1\u2935\u{1F447}\u{1F449}]/u;
function asksAboutExistingQuote(body: string, captured: CapturedFields, claudeParsed: ClaudeFields): boolean {
  // Solo marcas que envuelven palabras completas o el mensaje entero; un correo o archivo conserva sus signos internos.
  const marked = body.trim().replace(/^([*_])([^*_]+)\1$/, '$2')
    .replace(/(?<![\p{L}\p{N}._@/])([*_])(\p{L}(?:[^*_\n]*\p{L})?)\1(?![\p{L}\p{N}._@/])/gu, '$2')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Los emojis solo se admiten al final; los internos no se borran.
  const tail = /(?:(?![*_])(?:[\s\p{P}\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]|\uFE0F|\u200D))+$/u.exec(marked)?.[0] ?? '';
  if (ANNOUNCES_RE.test(tail)) return false;
  // Una sola oracion pregunta; las demas solo pueden ser saludo o gracias. Antes "Hola, como va? Mi nueva
  // cotizacion:" se leia como "como va mi nueva cotizacion" y el pedido del mensaje siguiente se perdia.
  const sentences = marked.slice(0, marked.length - tail.length).split(/[.?!:;\u2026\n]+/)
    .map((sentence) => sentence.replace(/\p{P}/gu, (mark) => mark === '*' || mark === '_' ? mark : '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (sentences.filter((sentence) => !COURTESY_RE.test(sentence)).length !== 1) return false;
  if (!QUOTE_STATUS_RE.test(sentences.join(' '))) return false;
  const aliases: Record<string, keyof CapturedFields> = { nombre: 'nombre_o_empresa', empresa: 'nombre_o_empresa' };
  return Object.entries(claudeParsed).every(([key, value]) => {
    // askClaude agrega siempre summary: es un resumen para la nota, no un campo del pedido.
    if (key === 'summary') return true;
    if (value == null || value === '') return true;
    if (value === false && (key === 'wantsHuman' || key === 'qualifiesForDeal')) return true;
    const previous = captured[aliases[key] ?? (key as keyof CapturedFields)];
    return typeof value === 'string' && (!value.trim() || value.trim() === previous);
  });
}

function looksLikeNewRequest(body: string): boolean {
  const b = body.trim();
  if (NEW_REQ_SOLO_LUZ_RE.test(b)) return false;
  if (NEW_REQ_SOLO_PROYECTO_RE.test(b)) return false;
  if (NEW_REQ_SOLO_RUT_RE.test(b)) return false;
  if (NEW_REQ_SOLO_EMAIL_RE.test(b)) return false;
  if (/^[A-Z\u00c0-\u00dc][a-z\u00e0-\u00fc]+ [A-Z\u00c0-\u00dc][a-z\u00e0-\u00fc]+[.!?\s]*$/.test(b)) return false;
  if (CONTINUATION_RE.test(b)) return false;
  if (NEW_REQ_INTENT_RE.test(b)) return true;
  if (/cotizar|cotizaci[o\u00f3]n|presupuesto/i.test(b) && b.length > 15) return true;
  if (PRODUCTO_RE.test(b) && /\b\d{1,4}\b/.test(b)) return true;
  return false;
}

const WANTS_HUMAN_RE = /ejecutivo|hablar con|hablar a|llamar|vendedor|humano|asesor|contacten|contactar|quiero hablar|necesito hablar/i;
const EXPLICIT_QUOTE = /cotizar|cotizacion|precio|cu[ao]nto (cuesta|vale|sale)|presupuesto|valor/i;
// [LUZ] Cualquier temperatura de color entre 2000 y 6999 K ("5700k", "2700 K"): antes solo 3000, 4000, 5000 y 6500.
const LUZ_RE = /c[a\u00e1]lid[ao]s?|neutr[ao]s?|fr[i\u00ed][ao]s?|warm|cool|daylight|[2-6]\d{3}\s*k(?![a-z])|blancas?\s+c[a\u00e1]lid[ao]s?|blancas?\s+fr[i\u00ed][ao]s?|luz\s+c[a\u00e1]lid[ao]?|luz\s+fr[i\u00ed][ao]?|blanco\s+fr[i\u00ed]o|blanco\s+c[a\u00e1]lido/i;
// [CANTIDAD] Empieza donde empieza la palabra: sin eso, un texto largo sin "@" se recorria una vez por letra.
const EMAIL_RE = /(?<![a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;  // [FIX-EMAIL-PARSER] case insensitive
const PROYECTO_RE = /\b(quincho|terraza|patio|living|comedor|dormitorio|habitaci[o\u00f3]n|cocina|ba[\u00f1n]o|ba[\u00f1n]os|jard[i\u00ed]n|bodega|oficina|casa|local\s+comercial|local|galp[o\u00f3]n|galpon|faena|tienda|exterior|interior|planta|f[a\u00e1]brica|fabrica|nave\s+industrial|departamento|edificio|colegio|hospital|estacionamiento|pasillo|sala)\b/i;

// NOTA: 'instalacion' fue removido de B2B_SIGNAL_RE - no es senal B2B por si sola
// [B2B] Palabras completas: "despacho" y "espacio" traen "spa", y "sobra" o "cobra" traen "obra" (caso del 12-11:
// una persona que pregunto por el despacho paso a empresa y se le pidio el RUT de la empresa).
// (revision 12-11) Con letras con tilde: "\w" no incluye la "o" con tilde y "licitacion" o "facturacion" escritas con
// tilde dejaban de ser empresa.
const B2B_SIGNAL_RE = /(?<![a-z\u00e0-\u00fc])(?:empresa[a-z\u00e0-\u00fc]*|factur[a-z\u00e0-\u00fc]*|obras?|proveedor[a-z\u00e0-\u00fc]*|licitaci[a-z\u00e0-\u00fc]*|constructor[a-z\u00e0-\u00fc]*|bodegas?|oficinas?|locale?s?\s+comercial(?:es)?|proyectos?\s+comercial(?:es)?|spa|ltda)(?![a-z\u00e0-\u00fc])|(?<![a-z\u00e0-\u00fc])s\.\s?a\./i;
// [B2B] La bodega, la oficina, el local o la tienda de eLIGHTS no son del cliente: "Donde queda su bodega?", "Puedo
// retirar en la bodega?" (la respuesta natural a MSG_LOCATION) o "Tienen oficina para ir a verlos?" no lo vuelven
// empresa. En una pregunta por la ubicacion o el despacho esas palabras salen; "la obra", "la empresa" o la del cliente
// ("Despachan a nuestra bodega en Lampa?") no.
const STORE_WORD_RE = /(?<![a-z\u00e0-\u00fc])(?<!\b(?:mi|mis|nuestr[oa]s?|tu|tus)\s+)(?:bodegas?|oficinas?|locale?s?(?:\s+comercial(?:es)?)?|tiendas?|sucursal(?:es)?)(?![a-z\u00e0-\u00fc])/gi;
/** [B2B] El mensaje para buscar senales de empresa: sin enlaces, correos ni tildes, ni los lugares de la tienda. */
function b2bText(body: string): string {
  return questionSplit(withoutStorePlaces(questionText(body))).map(({ part, question }) => {
    if (!question) return part;
    const kinds = partKinds(part);
    return kinds.has('ubicacion') || kinds.has('despacho') ? part.replace(STORE_WORD_RE, ' ') : part;
  }).join(' . ');
}
const PRODUCTO_RE = /\b(campana(?:s)?\s+(?:led|industrial(?:es)?)|panel(?:es)?\s+led|plafon(?:es)?\s+led|ampolleta(?:s)?\s+led|ampolleta(?:s)?|foco(?:s)?\s+led|foco(?:s)?|dicroico(?:s)?|reflector(?:es)?\s+led|reflector(?:es)?|proyector(?:es)?\s+led|proyector(?:es)?|tira(?:s)?\s+led|cinta(?:s)?\s+led|downlight(?:s)?|empotrado(?:s)?\s+led|tubo(?:s)?\s+led|tubo(?:s)?\s+fluorescente(?:s)?|luminaria(?:s)?\s+led|luminaria(?:s)?)\b/i;

// [INSTALL-FLOW] Tipo de proyecto para instalacion
const INSTALL_TIPO_PROYECTO_RE = /\b(casa|departamento|depto|oficina|local comercial|local|bodega|galpon|quincho|terraza|patio|jardin|exterior|edificio|condominio|empresa|industria|nave|faena|planta|colegio|hospital|estacionamiento)\b/i;
// [CIERRE-HONESTO] Los correos de eLIGHTS (ventas@, claudio@, constanza@) los publica el propio
// bot (textos A y B, MSG_EXECUTIVE, MSG4_INSTALL_NO_EMAIL): nunca son el correo del cliente.
// Si el cliente responde "le escribo a ventas@elights.cl", no hay correo suyo que registrar.
const EMAIL_RE_ALL = new RegExp(EMAIL_RE.source, 'gi');
const OWN_EMAIL_RE = /@(?:[a-z0-9-]+\.)*elights\.cl$/i;
// [CORREO-PROPIO] Los que publica el bot: si el cliente los nombra, es para escribirles, no su correo.
const PUBLISHED_EMAILS = new Set(['ventas@elights.cl', 'claudio@elights.cl', 'constanza@elights.cl']);
/** [CORREO-PROPIO] El mensaje trae un correo de eLIGHTS que el bot no publica y ningun correo del cliente. */
function offersOwnEmail(text: string): boolean {
  const normalized = text.slice(0, MAX_FACTS);
  if (extractEmail(normalized)) return false;
  return (normalized.match(EMAIL_RE_ALL) ?? []).some((raw) => {
    const email = raw.replace(/[.,;:!]+$/, '').toLowerCase();
    return OWN_EMAIL_RE.test(email) && !PUBLISHED_EMAILS.has(email);
  });
}
function extractEmail(text: string): string | undefined {
  // [FIX-EMAIL-PARSER] Normalizar texto: quitar espacios, limpiar prefijos
  const normalized = text.slice(0, MAX_FACTS).trim();
  for (const raw of normalized.match(EMAIL_RE_ALL) ?? []) {
    // Limpiar puntuacion al final (. , ; : !) y devolver en minuscula
    const email = raw.replace(/[.,;:!]+$/, '').toLowerCase();
    if (!OWN_EMAIL_RE.test(email)) return email;
  }
  return undefined;
}
// [TRANSCRIPCION] La intencion de corregir el correo despues del cierre: "corregir/cambiar/actualizar mi correo",
// "cambiar la direccion de correo", "mi correo no es X, es Y", "me equivoque de correo", "el correo esta mal", "el
// correo que les di esta malo", "escribanme a otro correo". Como la del RUT (correctingRut), se detecta antes que
// un pedido nuevo: "Necesito corregir mi correo: X" ya no empieza otro flujo. La negrita o la cursiva de WhatsApp
// ("mi *correo*") no la tapan (correctsEmail).
const EMAIL_NOUN = '(?:correo|mail|e-?mail|email)';
const EMAIL_WORD = '(?:(?:la\\s+)?direcci[o\\u00f3]n\\s+de\\s+)?' + EMAIL_NOUN + '(?:\\s+electr[o\\u00f3]nico)?';
const EMAIL_WRONG = '(?:mal[oa]?|incorrect[oa]|equivocad[oa]|err[o\\u00f3]ne[oa])';
const EMAIL_CORRECTION_RE = new RegExp('(?<![a-z\\u00e0-\\u00fc])(?:'
  + '(?:corregir|corrijo|corrijan|corrige|correcci[o\\u00f3]n\\s+(?:de|del)|cambiar|cambio|cambien|cambia|actualizar|actualizo|actualicen|actualiza|modificar|modifiquen)\\s+(?:(?:el|la|mi|su|tu|de|del)\\s+)*' + EMAIL_WORD
  + '|' + EMAIL_WORD + '\\s+(?:no\\s+es|correct[oa]|nuev[oa]|buen[oa]|' + EMAIL_WRONG + '|(?:est[a\\u00e1]|qued[o\\u00f3])\\s+' + EMAIL_WRONG + ')'
  + '|' + EMAIL_WORD + '\\s+(?:[a-z\\u00e0-\\u00fc]+\\s+){1,5}?(?:est[a\\u00e1]|qued[o\\u00f3]|es|era|fue|sali[o\\u00f3])\\s+' + EMAIL_WRONG
  + '|me\\s+equivoqu[e\\u00e9]\\s+(?:de|en\\s+el|con\\s+el)\\s+' + EMAIL_WORD
  + '|(?:otr[oa]|nuev[oa]|distint[oa]|diferente)\\s+(?:direcci[o\\u00f3]n\\s+de\\s+)?' + EMAIL_NOUN
  + ')(?![a-z\\u00e0-\\u00fc])', 'i');
/** [TRANSCRIPCION] El mensaje pide corregir el correo (EMAIL_CORRECTION_RE), sin la negrita ni la cursiva de WhatsApp. */
function correctsEmail(body: string): boolean {
  return EMAIL_CORRECTION_RE.test(body.slice(0, MAX_FACTS).replace(/[*_~]/g, ' '));
}
// Un correo negado o que el cliente descarta: "no es X", "ni X", "en vez de X", "antes era X", "X esta mal", "X no".
const EMAIL_NEGATED_BEFORE_RE = /(?:(?<![a-z\u00e0-\u00fc])(?:no|ni)(?:\s+(?:es|era|ser[a\u00e1]|va|fue|uses?|usen|usar))?|(?<![a-z\u00e0-\u00fc])en\s+(?:vez|lugar)\s+de(?:l)?|(?<![a-z\u00e0-\u00fc])antes(?:\s+(?:era|fue|dije|puse|di|escrib[i\u00ed]|ten[i\u00ed]a))?|(?<![a-z\u00e0-\u00fc])(?:anterior|viejo|equivocado|incorrecto|malo)(?:\s+(?:era|es|fue))?)\s*:?\s*(?:(?:el|mi|ese|este)\s+)?(?:(?:correo|mail|e-?mail|email)\s*:?\s*)?$/i;
// Tambien con otras palabras entre la negacion y el correo, en la misma clausula: "No me escriban a X", "No envien
// nada a X", "Mi correo nunca fue X", "Nunca use X", "No me escriban por ningun motivo a X", "No utilizo la
// direccion de correo X" (R9 de la ronda 3: antes valian hasta 4 palabras y una negacion mas larga cambiaba el
// correo). La clausula del correo empieza despues de la puntuacion, de un "sino", "pero", "aunque", "y" o "ahora",
// o del correo anterior ("no es X sino Y" es Y; "No tengo RUT. Mi correo es Y" tambien). Un correo que va solo en su
// linea, entre parentesis o tras una coma sigue a la clausula anterior cuando esta lo presenta o le falta el
// complemento: "No me escriban a este correo:\nX", "No usen el correo antiguo (X)", "No me escriban, por favor, a X"
// (EMAIL_SOFT_CUTS). La negacion vale para su verbo y lo que depende de el ("No quiero que me escriban a X"), no para
// otro verbo o "mi correo es" que vienen despues ("No me llego nada al correo escribanme a Y", "No tengo RUT mi
// correo es Y"). No cuentan "si no", "no olviden / no se olviden / no duden / no dejen de escribirme a X", "no hay
// problema" ni el "no mas" de "escribanme no mas a X". Con una negacion que no se sabe a que se refiere ("No se si
// es X"), el correo no se toma: queda el vigente.
const EMAIL_CLAUSE_CUT_RE = /[,;.!?\n\u00bf\u00a1()]|(?<![a-z\u00e0-\u00fc])(?:sino|pero|aunque|y|ahora)(?![a-z\u00e0-\u00fc])/gi;
// Los cortes que el correo puede cruzar hacia atras; el fin de la oracion y "pero", "sino" o "ahora" no.
const EMAIL_SOFT_CUTS = new Set([',', '\n', '(', ')']);
// Lo que no dice nada propio entre el corte y el correo ("a", "al", "por favor", los dos puntos).
const EMAIL_FILLER_RE = /^[\s,:()]*(?:(?:a|al|por\s+favor|porfa(?:vor)?|plis|please)(?![a-z\u00e0-\u00fc])[\s,:()]*)*$/i;
const EMAIL_PREPOSITION_RE = /(?<![a-z\u00e0-\u00fc])al?(?![a-z\u00e0-\u00fc])/i;
// La clausula anterior presenta el correo: termina en "este correo:", "el correo antiguo" o en dos puntos.
const EMAIL_POINTER_RE = /(?:(?:correo|mail|e-?mail|email)(?:\s+[a-z\u00e0-\u00fc]+)?\s*:?|:)\s*$/i;
const EMAIL_CLAUSE_NEGATOR_RE = /(?<![a-z\u00e0-\u00fc])(?<!(?<![a-z\u00e0-\u00fc])si\s+)(?:no|ni|nunca|jam[a\u00e1]s|tampoco)(?![a-z\u00e0-\u00fc])(?!\s+(?:(?:me|nos|se|te|le|les)\s+)?(?:olvid|dud|dej|import|preocup)[a-z\u00e0-\u00fc]*)(?!\s+(?:hay|habr[a\u00e1])\s+(?:problemas?|dramas?|rollos?|inconvenientes?|apuros?|l[i\u00ed]os?)(?![a-z\u00e0-\u00fc]))(?!\s+pasa\s+nada)/gi;
// Los pronombres que van entre la negacion y su verbo ("No me escriban", "Jamas les di").
const EMAIL_CLITICS_RE = /^(?:\s+(?:me|nos|se|te|le|les|lo|la|los|las)(?![a-z\u00e0-\u00fc]))*/i;
const EMAIL_WORD_RE = /^\s+[a-z\u00e0-\u00fc]+/i;
// Lo que vuelve a presentar el correo despues de la negacion: otro verbo ("escribanme a", "usen", "envien") o "mi
// correo es", "mi correo nuevo es", "el correo correcto:". Tras un "que" sigue negado ("No quiero que me escriban").
const EMAIL_FRESH_VERB_RE = /(?<![a-z\u00e0-\u00fc])(?:escr[i\u00ed]b[a-z\u00e0-\u00fc]*|env[i\u00ed][a-z\u00e0-\u00fc]*|m[a\u00e1]nd[a-z\u00e0-\u00fc]*|cont[a\u00e1]ct[a-z\u00e0-\u00fc]*|resp[o\u00f3]nd[a-z\u00e0-\u00fc]*|us(?:e|en|a|an|o|amos|ar)|utili[cz][a-z\u00e0-\u00fc]*|ocup[a-z\u00e0-\u00fc]*|anot[a-z\u00e0-\u00fc]*)(?![a-z\u00e0-\u00fc])/i;
const EMAIL_FRESH_NOUN_RE = /(?<![a-z\u00e0-\u00fc])(?:mi|nuestro|el)\s+(?:correo|mail|e-?mail|email)(?:\s+(?:nuevo|correcto|bueno|actual|real|personal|de\s+contacto|electr[o\u00f3]nico))*\s*(?:es|ser[i\u00ed]a|queda|:)/i;
const EMAIL_SUBORDINATE_RE = /(?<![a-z\u00e0-\u00fc])que(?![a-z\u00e0-\u00fc])/i;
// Entre dos correos solo una "o" ("u"), "ni", "y" ("e") o una coma ("No usen X o Y", "ni X ni Y"): el segundo
// sigue la suerte del primero.
const EMAIL_SAME_LIST_RE = /^\s*(?:,|o|u|ni|y|e)?\s*(?:a|al)?\s*$/i;
const MAX_EMAIL_CLAUSE = 200;
/** [TRANSCRIPCION] La clausula que termina en el correo; `text` va desde el correo anterior. */
function emailClause(text: string): string {
  const cuts = [...text.matchAll(EMAIL_CLAUSE_CUT_RE)];
  let k = cuts.length - 1;
  let from = k >= 0 ? cuts[k].index + cuts[k][0].length : 0;
  while (k >= 0 && EMAIL_SOFT_CUTS.has(cuts[k][0]) && EMAIL_FILLER_RE.test(text.slice(from))) {
    const cut = cuts[k];
    const previous = k > 0 ? cuts[k - 1].index + cuts[k - 1][0].length : 0;
    if (cut[0] !== '(' && !EMAIL_PREPOSITION_RE.test(text.slice(from)) && !EMAIL_POINTER_RE.test(text.slice(previous, cut.index))) break;
    from = previous;
    k--;
  }
  return text.slice(from);
}
/** [TRANSCRIPCION] La presentacion `re` aparece en `text` y no depende de un "que" anterior. */
function freshIn(text: string, re: RegExp): boolean {
  const m = re.exec(text);
  return m !== null && !EMAIL_SUBORDINATE_RE.test(text.slice(0, m.index));
}
/** [TRANSCRIPCION] La clausula del correo (`text` va desde el correo anterior) lo niega. */
function negatedClause(text: string): boolean {
  const clause = emailClause(text);
  const negators = [...clause.matchAll(EMAIL_CLAUSE_NEGATOR_RE)];
  const last = negators[negators.length - 1];
  if (!last) return false;
  const rest = clause.slice(last.index + last[0].length);
  // "Escribanme no mas a X": el "no mas" despues del verbo no niega ("no me vayan a escribir nunca mas a X" si).
  if (negators.length === 1 && /^no$/i.test(last[0]) && /^\s+m[a\u00e1]s(?![a-z\u00e0-\u00fc])/i.test(rest)
    && EMAIL_FRESH_VERB_RE.test(clause.slice(0, last.index))) return false;
  const object = rest.slice(EMAIL_CLITICS_RE.exec(rest)?.[0].length ?? 0);
  // "No, mi correo es X" sin la coma: la negacion suelta no niega lo que sigue.
  if (EMAIL_FRESH_NOUN_RE.exec(object.trimStart())?.index === 0) return false;
  const verb = EMAIL_WORD_RE.exec(object)?.[0] ?? '';
  const tail = object.slice(verb.length);
  // "No es mi correo: X": tras "es", "mi correo" sigue negado.
  const copula = /^\s+(?:es|era|fue|son|ser[a\u00e1]|ser[i\u00ed]a)$/i.test(verb);
  return !freshIn(tail, EMAIL_FRESH_VERB_RE) && (copula || !freshIn(tail, EMAIL_FRESH_NOUN_RE));
}
// Despues del correo: "X esta mal", "X no.", "X no lo usen", "X no por favor", "X ya no".
const EMAIL_NEGATED_AFTER_RE = /^\s*(?:est[a\u00e1]\s+mal|qued[o\u00f3]\s+mal|es\s+(?:incorrecto|el\s+(?:anterior|viejo|malo|equivocado))|era\s+el\s+anterior|no\s+(?:es|va|sirve|existe|funciona|me\s+llega)|no\s+(?:lo|la)\s+(?:us|utili[cz]|ocup|revis|tom|anot|consider)[a-z\u00e0-\u00fc]*|no\s*(?:[,.;!]|por\s+favor)|ya\s+no|equivocado|incorrecto|mal\s+escrito)/i;
// El que la correccion marca como el bueno: "el correcto es Y", "el nuevo es Y", "ahora es Y".
const EMAIL_MARKED_RE = /(?:correct[oa]|buen[oa]|nuev[oa]|actualizad[oa]|ahora)(?:\s+(?:es|ser[i\u00ed]a))?\s*:?\s*$/i;
interface EmailCandidate { email: string; marked: boolean }
/** [TRANSCRIPCION] Los correos del cliente en el mensaje (sin los de eLIGHTS), sin los que niega ni repetidos. */
function affirmedEmails(text: string): EmailCandidate[] {
  const normalized = text.slice(0, MAX_FACTS);
  const out: EmailCandidate[] = [];
  let previousEnd: number | undefined;
  let previousNegated = false;
  for (const m of normalized.matchAll(EMAIL_RE_ALL)) {
    const email = m[0].replace(/[.,;:!]+$/, '').toLowerCase();
    if (OWN_EMAIL_RE.test(email)) continue;
    // La negrita o la cursiva de WhatsApp ("*no* es X") no tapan la negacion.
    const before = normalized.slice(Math.max(0, m.index - 60), m.index).replace(/[*_~]/g, ' ');
    const after = normalized.slice(m.index + m[0].length, m.index + m[0].length + 40).replace(/[*_~]/g, ' ');
    const clause = normalized.slice(Math.max(previousEnd ?? 0, m.index - MAX_EMAIL_CLAUSE), m.index).replace(/[*_~]/g, ' ');
    const negated = EMAIL_NEGATED_BEFORE_RE.test(before) || negatedClause(clause) || EMAIL_NEGATED_AFTER_RE.test(after)
      || (previousEnd !== undefined && previousNegated && EMAIL_SAME_LIST_RE.test(clause));
    previousEnd = m.index + m[0].length;
    previousNegated = negated;
    if (negated) continue;
    const marked = EMAIL_MARKED_RE.test(before);
    const seen = out.find((c) => c.email === email);
    if (seen) seen.marked ||= marked;
    else out.push({ email, marked });
  }
  return out;
}
/** [CIERRE-HONESTO] El correo que trae Claude, solo si es texto y tiene forma de correo. */
function emailFrom(value: unknown): string | undefined {
  return typeof value === 'string' ? extractEmail(value) : undefined;
}
/** [CIERRE-HONESTO] Correo del cliente que trae este mensaje (Claude o el texto), si trae uno. */
function messageEmail(body: string, claudeParsed: { correo?: unknown }): string | undefined {
  return emailFrom(claudeParsed.correo) ?? extractEmail(body);
}
/** [CIERRE-HONESTO] Correo del flujo en curso: el mismo que mira su cierre para crear el negocio. */
function flowEmail(state: Pick<FlowState, 'isInstallFlow' | 'captured'>): string | undefined {
  return state.isInstallFlow ? state.captured.install_correo : state.captured.correo;
}

const NAME_PARTICLE_RE = /^(de|del|la|las|los|y)$/;
const NAME_WORD_RE = /^[A-Z\u00c0-\u00dc][a-z\u00e0-\u00fc]+(?:['-][A-Za-z\u00c0-\u00fc]+)?$/;
const NAME_FIRST_WORD_BAN_RE = /^(de|del|la|las|el|los|lo|un|una|san|santa|soy|hola)$/i;
/**
 * [CIERRE-HONESTO] Nombre con forma de nombre de persona, para la persona y la nota de Pipedrive:
 * de 2 a 5 palabras con mayuscula inicial (se admiten "de", "del", "la", "las", "los" e "y" al
 * medio), que no empieza con un articulo o "de" y que no es una comuna. "de Maipu",
 * "instalador electrico" o "Las Condes" no lo son; "Ana Prueba" y "Ana de la Fuente", si.
 */
export function looksLikePersonName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const words = value.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (NAME_FIRST_WORD_BAN_RE.test(words[0])) return false;
  const first = words[0];
  const last = words[words.length - 1];
  if (!NAME_WORD_RE.test(first) || !NAME_WORD_RE.test(last)) return false;
  if (!words.slice(1, -1).every((w) => NAME_WORD_RE.test(w) || NAME_PARTICLE_RE.test(w))) return false;
  return officialComuna(value) === undefined;
}
/** [NO-PISAR] El texto sin tildes ni enies y del mismo largo, para buscar en el y volver al original. */
function bareText(text: string): string {
  return [...text].map((c) => {
    const b = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return b.length === c.length ? b : c;
  }).join('');
}
/** [NO-PISAR] El unico valor que la regla encuentra en el texto; con dos distintos ("Maipu ... Providencia"), ninguno. */
function soleMatch(text: string, re: RegExp): string | undefined {
  const found = new Map<string, string>();
  for (const m of bareText(text).matchAll(new RegExp(re.source, 'gi'))) {
    found.set(comparable(m[0]).replace(/(?:es|s)$/, ''), text.slice(m.index, m.index + m[0].length).trim());
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
}

function extractProyecto(text: string): string | undefined {
  const m = text.match(PROYECTO_RE);
  return m ? m[0].trim() : undefined;
}

function extractProducto(text: string): string | undefined {
  const m = text.match(PRODUCTO_RE);
  return m ? m[0].trim() : undefined;
}

function normalizeLuz(raw: string): string {
  const r = raw.toLowerCase().trim();
  if (/c[a\u00e1]lid[ao]/.test(r) || /warm/i.test(r) || /3000/i.test(r)) return 'calida';
  if (/neutr[ao]/.test(r) || /4000/i.test(r) || /5000/i.test(r)) return 'neutra';
  if (/fr[i\u00ed][ao]/.test(r) || /cool/i.test(r) || /daylight/i.test(r) || /6500/i.test(r)) return 'fria';
  if (/blanca/.test(r) && /c[a\u00e1]lid/.test(r)) return 'calida';
  if (/blanca/.test(r) && /fr[i\u00ed]/.test(r)) return 'fria';
  // [LUZ] Otra temperatura ("5700k") queda tal cual, como la escribe el cliente: "5700K".
  const cct = r.match(/^(\d{4})\s*k$/);
  if (cct) return cct[1] + 'K';
  return r;
}

// [INSTALL-FLOW] Extrae nombre propio de un texto corto
function extractInstallNombre(text: string): string | undefined {
  const t = text.trim();
  const llamo = t.match(/(?:me llamo|soy|mi nombre es)\s+([A-Z\u00c0-\u00dca-z\u00e0-\u00fc][a-z\u00e0-\u00fc]+(?:\s+[A-Z\u00c0-\u00dc][a-z\u00e0-\u00fc]+)?)/i);
  if (llamo) return llamo[1].trim();
  const dosPalabras = t.match(/^([A-Z\u00c0-\u00dc][a-z\u00e0-\u00fc]+\s+[A-Z\u00c0-\u00dc][a-z\u00e0-\u00fc]+)[.!?\s]*$/);
  if (dosPalabras) return dosPalabras[1].trim();
  const unaPalabra = t.match(/^([A-Z\u00c0-\u00dc][a-z\u00e0-\u00fc]{2,})[.!?\s]*$/);
  if (unaPalabra) return unaPalabra[1].trim();
  return undefined;
}

// [INSTALL-FLOW] Extrae tipo de proyecto de instalacion
function extractInstallTipoProyecto(text: string): string | undefined {
  const m = text.match(INSTALL_TIPO_PROYECTO_RE);
  return m ? m[0].trim() : undefined;
}

const flowStates = new Map<string, FlowState>();

export function getFlowState(phone: string): FlowState {
  return (
    flowStates.get(phone) ?? {
      stage: 'stage1',
      captured: {},
      repreguntasStage1: 0,
      repreguntasStage2: 0,
      repreguntasStage3: 0,
      repreguntasInstall: 0,
      wantsHuman: false,
      captureStatus: 'incomplete',
      firstMessageAt: Date.now(),
      leadType: 'Unknown',
      isInstallFlow: false,
      humanEmailAsked: false,
      lastQuestion: null,
    }
  );
}

export function saveFlowState(phone: string, state: FlowState): void {
  flowStates.set(phone, withOfficialComunas(state));
}

/**
 * [COMUNA] Un estado guardado por una version anterior (lo que restaura stateStore.ts) puede traer una
 * comuna que no es de la lista oficial ("Moragas", de un correo) o escrita de otra forma ("nunoa",
 * "Maipu, Region Metropolitana"): queda con su nombre oficial o, si no hay ninguna, se borra y el bot
 * la vuelve a preguntar (la etapa 3 vuelve a la 2). Lo que guarda el flujo ya viene oficial: no cambia.
 */
function withOfficialComunas(state: FlowState): FlowState {
  const captured: CapturedFields = { ...state.captured };
  let changed = false;
  for (const field of ['comuna_o_ciudad', 'install_comuna'] as const) {
    const value: unknown = captured[field];
    if (value === undefined) continue;
    const name = officialComuna(value) ?? (typeof value === 'string' ? findComunas(value.slice(0, 200), { answering: true })[0] : undefined);
    if (name === value) continue;
    changed = true;
    if (name) captured[field] = name;
    else delete captured[field];
  }
  const otras: unknown = captured.comunas_otras;
  if (otras !== undefined) {
    const list = Array.isArray(otras) ? otras : [];
    const valid = [...new Set(list.map((o) => officialComuna(o)).filter((o): o is string => Boolean(o)))].slice(0, MAX_COMUNAS_OTRAS);
    if (valid.length !== list.length || valid.some((o, i) => o !== list[i]) || !Array.isArray(otras)) {
      changed = true;
      if (valid.length) captured.comunas_otras = valid;
      else delete captured.comunas_otras;
    }
  }
  if (!changed) return state;
  console.log('[flowEngine] comuna guardada fuera de la lista oficial \u2014 se normaliza o se vuelve a preguntar');
  const askAgain = state.stage === 'stage3' && !state.isInstallFlow && state.captured.comuna_o_ciudad !== undefined && !captured.comuna_o_ciudad;
  return { ...state, captured, ...(askAgain ? { stage: 'stage2' as const, repreguntasStage2: 0 } : {}) };
}

/**
 * [CIERRE-HONESTO] webhook.ts anota aqui lo que respondio Pipedrive despues de intentar crear el
 * negocio. Con eso, la conversacion cerrada solo repite "quedo registrada" si el negocio existe.
 * `conversationId` es el firstMessageAt de la conversacion que pidio el negocio: si mientras tanto
 * empezo otra (un pedido nuevo), el resultado no se anota en la nueva.
 */
export function recordDealOutcome(phone: string, registered: boolean, conversationId?: number, dealId?: number): void {
  const state = flowStates.get(phone);
  if (!state) return;
  if (conversationId !== undefined && state.firstMessageAt !== conversationId) {
    console.log('[flowEngine] resultado del negocio de otra conversacion \u2014 no se anota');
    return;
  }
  saveFlowState(phone, { ...state, deal: registered ? 'registered' : 'failed', ...(registered && dealId ? { dealId } : {}) });
}

export function clearFlowState(phone: string): void {
  flowStates.delete(phone);
}
// [INSTALL-FLOW] Campos minimos requeridos para instalacion
interface InstallMissingResult {
  missingRequired: string[];
  missingOptional: string[];
}

function getMissingInstallFields(captured: CapturedFields): InstallMissingResult {
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  if (!captured.install_nombre) missingRequired.push('nombre completo');
  if (!captured.install_correo) missingRequired.push('correo');
  if (!captured.install_comuna) missingRequired.push('comuna');
  if (!captured.install_tipo_proyecto) missingRequired.push('tipo de proyecto (casa, departamento, oficina, etc.)');
  if (!captured.install_telefono) missingOptional.push('tel\u00e9fono de contacto');
  if (!captured.install_descripcion) missingOptional.push('descripci\u00f3n breve del proyecto');
  return { missingRequired, missingOptional };
}

// [INSTALL-FLOW] Genera el mensaje de solicitud de datos
function buildInstallCaptureMsg(captured: CapturedFields): string {
  const { missingRequired } = getMissingInstallFields(captured);
  if (missingRequired.length === 0) return '';
  const hasNone = !captured.install_nombre && !captured.install_correo && !captured.install_comuna && !captured.install_tipo_proyecto;
  if (hasNone) {
    return 'Perfecto. Para derivar tu solicitud de instalacion y poder cotizarte, necesito estos datos: nombre completo, correo, comuna y tipo de proyecto.';
  }
  if (missingRequired.length === 1) {
    return 'Casi listo. Solo me falta tu ' + missingRequired[0] + ' para registrar la solicitud.';
  }
  const items = missingRequired.map((x, i) => (i + 1) + ') ' + capitalize(x)).join('\n');
  return 'Gracias. Para completar tu solicitud de instalacion, necesito que me indiques:\n' + items;
}

// [INSTALL-FLOW] Registra campos de instalacion desde el mensaje del usuario
// [COMUNA] answering: la ultima pregunta del bot pedia la comuna (la lista de instalacion o MSG2).
function mergeInstallFields(
  captured: CapturedFields,
  body: string,
  claudeParsed: ClaudeFields,
  answering = false,
): CapturedFields {
  const updated = { ...captured };
  // [CIERRE-HONESTO] El nombre y el correo que ya dio en el flujo de productos sirven para la
  // instalacion: no se vuelven a pedir, y el cierre de instalacion crea el negocio con ellos.
  if (!updated.install_nombre) {
    const nom = claudeParsed.nombre ?? claudeParsed.empresa ?? updated.nombre_o_empresa ?? extractInstallNombre(body);
    if (nom) updated.install_nombre = nom;
  }
  if (!updated.install_correo) {
    const email = emailFrom(claudeParsed.correo) ?? extractEmail(body) ?? updated.correo;
    if (email) updated.install_correo = email;
  }
  // [COMUNA] La misma regla que la comuna de productos: se corrige ("Perdon, es en Colina") y las demas
  // van a "Otras comunas mencionadas" (antes solo se llenaba una vez).
  const facts = factsText(body, claudeParsed);
  const assertive = maskNegated(withoutQuestions(facts));
  mergeComuna(updated, 'install_comuna', claudeParsed.comuna_o_ciudad, {
    answering, company: mentionsCompany(body.slice(0, MAX_FACTS)), assertive, affirmed: maskNegated(facts), base: assertive,
  });
  if (!updated.install_tipo_proyecto) {
    const tipo = claudeParsed.proyecto_o_uso ?? extractInstallTipoProyecto(body);
    if (tipo) updated.install_tipo_proyecto = tipo;
  }
  if (!updated.install_telefono) {
    const tel = extractPhone(body);
    if (tel) updated.install_telefono = tel;
  }
  return updated;
}

// [INSTALL-FLOW] Celular o fijo (+56 9 1234 5678, +56 32 212 3456, 912345678, 22 123 4567, 32 212 3456), sin los
// RUT, correos, enlaces ni codigos de modelo del mensaje: antes cualquier numero de 8 o 9 digitos,
// como el de un RUT o el de un correo, pasaba por telefono. Primero el que trae su etiqueta
// ("fono", "cel", "whatsapp"); un numero pegado a una letra o a otro digito no es telefono.
const PHONE_LABEL_RE = /\b(?:fono|tel[e\u00e9]fono|tel|cel(?:ular)?|m[o\u00f3]vil|whats?app|wsp)\s*(?:de\s+contacto\s*)?[:.]?\s*(\+?\d[\d\s.()-]{6,16}\d)(?![\w])/i;
const PHONE_CORE = '(?:\\+?56(?:[\\s.()-]*\\d){9}|\\(?[29]\\)?(?:[\\s.-]*\\d){8}|\\(?[3-7]\\d\\)?(?:[\\s.-]*\\d){7})';
const PHONE_RE = new RegExp('(?<![\\w+])' + PHONE_CORE + '(?![\\w])');
// Despues de la etiqueta va un telefono con forma valida, sin juntarle el numero siguiente ("fono 900001234. 20 focos").
const PHONE_AFTER_LABEL_RE = new RegExp('^' + PHONE_CORE + '(?![\\w])');
const RUT_WITH_DASH_RE = /\d{1,2}(?:[.\s]?\d{3}){2}\s*[-\u2010-\u2015\u2212]\s*[\dkK]/g;
// Enlaces, codigos ("BL-200") y el numero de un modelo, una serie o un documento ("modelo 900001234").
const PHONE_NOISE_RE = /(?:https?:\/\/|www\.)\S*|\b[a-z]+[-_]?\d[\w-]*|\b(?:modelo|mod|c[o\u00f3]digo|cod|ref|referencia|sku|serie|pedido|orden|folio|factura|boleta|oc|cotizaci[o\u00f3]n|licitaci[o\u00f3]n|n[\u00b0\u00ba])\.?(?:\s*(?:[:#.]|(?:es|era|ser[i\u00ed]a|el|la|del|de|n[\u00b0\u00ba]\.?|n[u\u00fa]mero|nro\.?)(?![a-z\u00e0-\u00fc])))*\s*\d[\d.-]*/gi;
function extractPhone(body: string): string | undefined {
  const inspected = inspectRut(body);
  const ruts = inspected.found ? [inspected.found.rut] : inspected.ambiguous ?? [];
  const text = removeRuts(body.slice(0, MAX_FACTS), ruts).replace(RUT_WITH_DASH_RE, ' ').replace(EMAIL_RE_ALL, ' ').replace(PHONE_NOISE_RE, ' ');
  const labeled = text.match(PHONE_LABEL_RE)?.[1].match(PHONE_AFTER_LABEL_RE)?.[0];
  const digits = (labeled ?? text.match(PHONE_RE)?.[0])?.replace(/[^\d+]/g, '');
  return digits && /^\+?\d{8,11}$/.test(digits) ? digits : undefined;
}
// [FIX-EMAIL-GATE] Sin correo no se crea el negocio.
// [CIERRE-HONESTO] Con correo, el cierre siempre registra la solicitud: antes exigia ademas
// producto o proyecto y, sin ellos, decia "quedo registrada" sin crear nada. Una persona
// responde por correo, asi que el correo basta (politica de privacidad 1.3).
function canRegister(captured: CapturedFields): boolean {
  return Boolean(captured.correo);
}

/**
 * [CIERRE-HONESTO] Cierre del flujo de productos. Sin correo pide el correo (texto A) y no promete
 * nada. Con correo, el texto de "registrada" (o "ya derive", si pidio ejecutivo); webhook.ts lo
 * cambia por MSG_DEAL_FAILED si Pipedrive no confirma el negocio.
 */
function productClosingMsg(registers: boolean, wantsHuman: boolean, leadType: LeadType): string {
  if (!registers) return MSG_NEED_EMAIL;
  if (wantsHuman) return MSG_HUMAN;
  return leadType === 'B2B' ? MSG4_B2B : MSG4;
}

/** [CIERRE-HONESTO] El cierre de una solicitud registrada, sin "ya derive" (sale una sola vez). */
function registeredClosing(state: Pick<FlowState, 'isInstallFlow' | 'leadType'>): string {
  return state.isInstallFlow ? MSG4_INSTALL : state.leadType === 'B2B' ? MSG4_B2B : MSG4;
}

/**
 * [CIERRE-HONESTO] Respuesta a un mensaje en una conversacion ya cerrada, segun lo que respondio
 * Pipedrive y nada mas: "quedo registrada" si confirmo el negocio, el texto B si fallo, y sin
 * intento (no hay correo) se pide el correo.
 */
function closedReply(state: FlowState): string {
  if (state.deal === 'registered') return registeredClosing(state);
  if (state.deal === 'failed') return MSG_DEAL_FAILED;
  return state.isInstallFlow ? MSG4_INSTALL_NO_EMAIL : MSG_NEED_EMAIL;
}

// [PLAZO] "Que hago ahora?", "tengo que esperar?", "cuanto demora la respuesta?", "cuando me responden?"
// (sin tildes: se compara el texto sin acentos). "Buenas tardes" no cuenta: solo "tarda", "tardan", "tardara".
const WAIT_QUESTION_RE = /\b(?:demor\w*|tarda(?:n|ra|ran|ria|rian)?|esper\w*|plazo|cuando)\b|\bque\s+(?:hago|hace|hacemos|sigue|debo|tengo|tiene)\b|\by\s+ahora\b|\bahora\s+que\b|\bcuant[oa]s?\s+(?:tiempo|tempo|dias)\b/i;
// [PLAZO] Despacho, entrega, flete o retiro: no es la respuesta por correo (Codex, 2026-11-11: "Cuando llega el
// despacho?" recibia la promesa de la cotizacion).
const DELIVERY_QUESTION_RE = /\b(?:despach\w*|entreg\w*|envios?|flete|retir\w*)\b|\bllega(?:n|ra|ria)?\s+(?:el|mi|los|las|la)\s+(?:pedido|producto|despacho|luminaria|foco|focos|equipo|equipos|compra|mercaderia)\b/i;
function normalizedText(body: string): string {
  return body.slice(0, MAX_FACTS).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function asksAboutDelivery(body: string): boolean {
  return DELIVERY_QUESTION_RE.test(normalizedText(body));
}
function asksWhatNext(body: string): boolean {
  return WAIT_QUESTION_RE.test(normalizedText(body));
}

// [PREGUNTA] Lo que el cliente pregunta (fase 2, 12-11-2026): antes el bot contestaba con la pregunta siguiente
// del formulario (negocios 142, 149, 159, 178, 204, 205 y el caso de las estacas). Solo cuenta una pregunta: con
// "?" o "\u00bf", o que empieza como pregunta ("Sabes cuando demora el despacho") o la pide ("necesito saber si
// tienen ficha tecnica"). "Necesito despacho a Temuco", "quiero cotizar 20 paneles" o el titulo de una ficha con
// "IP65" no preguntan nada. Se compara sin tildes.
export type QuestionKind = 'precio' | 'tecnica' | 'ubicacion' | 'despacho';
const ASK_LEAD_RE = /^(?:(?:hola|buenas|buenos\s+dias|buenas\s+(?:tardes|noches)|ok|oye|y|pero|consulta|una\s+consulta|disculpa|perdon|estimad[oa]s?|gracias)[\s,.:;!]+)+/;
const ASK_START_RE = /^(?:cuant|que\b|cual|como\b|donde|cuando|hay\b(?!\s+que\b)|tienen\b|tiene\b|tendran?\b|me\s+(?:pueden|podrian|puede|podria)\b|pueden\b|podrian\b|puedo\b|hacen\b|venden\b|cuentan\b|ustedes\b|sab(?:es|en|e|ria|rian)\b|sale\b|cuesta|vale\b|habria|seria\b)/;
const ASK_INDIRECT_RE = /\b(?:saber|consultar|preguntar(?:les|le|te)?)\s+(?:si\b|cuant|cual|como\b|donde|cuando|que\b|(?:por\s+)?(?:el|la|los|las|su|sus)\s+(?:precio|valor|stock|disponib|ficha|despacho|envio|plazo|direccion|ubicacion))/;
const ASK_PRICE_RE = /\bprecios?\b|\bvalor(?:es)?\b|\bcuest(?:a|an)\b|\b(?:cuanto|que)\s+valen?\b|\bcobr(?:a|an)\b|\bcostos?\b|\bstock\b|\bdisponib\w*|\bdescuentos?\b|\bcuanto\s+salen?\b/;
// [PREGUNTA] (revision 12-11) "Tienen 50 de estos?" pregunta por el stock; "Hay 3 galpones", "Tiene 8 metros de alto" o
// "Tienen 2 bodegas de 500 m2" describen el lugar: el numero seguido de un lugar o una medida no es stock.
const ASK_STOCK_NUMBER_RE = /\b(?:tienen|tiene|hay|quedan|tendran)\s+(?:unas?\s+|unos\s+)?\d+(?!\d|[.,]\d|\s*(?:galpon\w*|naves?|bodegas?|metros?|mts?|m2|m|cm|mm|km|pisos?|locale?s?|oficinas?|salas?|casas?|departamentos?|habitacion\w*|dormitorios?|piezas?|banos?|canchas?|pasillos?|sectores?|lineas?|areas?|zonas?|plantas?|edificios?|niveles?|hectareas?|anos?|dias?|meses|horas?|personas?|trabajadores|puertas?|ventanas?|muros?|paredes|postes?|galerias?|estacionamientos?|calles?|sucursal\w*|tiendas?|faenas?|obras?)\b)/;
// [PREGUNTA] Enviar o mandar el pedido es el despacho; enviar o mandar un documento ("la ficha", "la cotizacion"), no.
const SEND_VERB_RE = /\b(?:envi(?:an|a|amos|ar|aran|arian|aria|en)|mand(?:an|a|amos|ar|aran|arian|aria|en))\b/;
const SEND_DOC_RE = /\b(?:ficha|cotiz|presupuesto|catalogo|informacion|info\b|datos|fotos?\b|imagen|link|enlace|precios?\b|lista|correo|mail|pdf|archivo|detalle|factura|boleta|propuesta|planilla|plano|cuenta|numero)/;
// El costo del despacho es una pregunta por el despacho, no por el precio del producto.
const DELIVERY_COST_RE = /\b(?:cuanto\s+)?(?:cuesta|vale|sale|cobran?|costos?|precio|valor)\s+(?:el\s+|del\s+|de\s+|la\s+|un\s+|los\s+)?(?:despach|envi|mandar|flete|traslad)\w*|\b(?:despacho|envio|flete)\w*\s+(?:cuesta|vale|cobran?|tiene\s+(?:costo|valor))/g;
const ASK_TECH_RE = /\bficha\w*|\bespecificaci\w*|\bdatasheet|\bcatalogo\w*|\bdimensi\w*|\bmedidas?\b|\btamano\b|\bgarantia\w*|\bcompatib\w*|\bcertific\w*|\bvoltaje\b|\blumen\w*|\bdimm?er\w*|\bdimeriz\w*|\bregulab\w*|\bintensidad\b|\bcomo\s+se\s+(?:controla|instala|conecta|usa|programa)\w*|\bsirven?\s+para\b|\bfuncionan?\s+con\b|\bcorrespond\w*|\bes\s+(?:apt[oa]|sumergible|resistente)\b|\baguant\w*|\bresiste\w*|\bconsum\w*|\bduracion\b|\bvida\s+util\b|\bmonocrom\w*/;
// "Te envio mi correo?" no es un envio, y "cuando me entregan la cotizacion?" pregunta por la respuesta (MSG_WAIT).
const NOT_DELIVERY_RE = /\b(?:te|le|les|se|lo|la|los|las|me|nos)\s+envio\b/g;
const ABOUT_QUOTE_RE = /\bcotiz|\bpresupuesto|\brespuesta|\brespond/;
const DELIVERY_WORD_RE = /\bdespach|\bflete|\bretir|\benvio\b/;
const ASK_LOCATION_RE = /\bdonde\s+(?:estan|se\s+encuentran|quedan|queda|se\s+ubican|ubicad\w*|esta\s+(?:la\s+)?(?:tienda|bodega|oficina|local))|\bubicad\w*|\bubicacion\b|\bdireccion\b|\bsucursal\w*|\btienda\s+fisica|\blocal\s+fisico|\bshowroom\b|\bsala\s+de\s+ventas\b|\b(?:tienen|tiene|hay|cuentan\s+con)\s+(?:una?\s+)?(?:oficinas?|tiendas?|locale?s?|sucursal\w*|bodegas?|showroom)\b|\b(?:ir|pasar)\s+a\s+(?:ver|buscar|retirar)(?:l[oa]s?)?\b/;
// (revision 12-11) Lo ultimo: "Tienen oficina para ir a verlos?", "hay tienda?", "puedo pasar a buscarlos?".
/** [PREGUNTA] El mensaje en minusculas, sin enlaces, correos ni tildes. */
function questionText(body: string): string {
  return normalizedText(body).toLowerCase().replace(/(?:https?:\/\/|www\.)\S*/g, ' ').replace(EMAIL_RE_ALL, ' ');
}
/** [PREGUNTA] El trozo es una pregunta: con "?" o "\u00bf", empieza como pregunta o la pide ("necesito saber si"). */
function isQuestionPart(part: string): boolean {
  const lead = part.replace(/^[\u00bf\s*_~]+/, '').replace(ASK_LEAD_RE, '');
  return /[?\u00bf]/.test(part) || ASK_START_RE.test(lead) || ASK_INDIRECT_RE.test(part);
}
/**
 * [PREGUNTA] El texto (de questionText) en trozos: cada frase, hasta "?", "!" o el salto de linea, se corta en sus
 * puntos. (revision 12-11) La pregunta indirecta sigue hasta el fin de su frase: en el negocio 147 ("Necesito saber si
 * este producto CINTA LED ... 5mt. 12V. AZUL. Corresponde a LEDS monocromaticos") los puntos del titulo de la ficha
 * dejaban la pregunta sin lo que pregunta.
 */
function questionSplit(text: string): Array<{ part: string; question: boolean }> {
  const out: Array<{ part: string; question: boolean }> = [];
  for (const sentence of text.split(/(?<=[?!\n])|(?=\u00bf)/)) {
    const pieces = sentence.split(/(?<=[a-z\s])\.(?!\d)/);
    for (let i = 0; i < pieces.length; i++) {
      const part = pieces[i].trim();
      if (!part) continue;
      if (ASK_INDIRECT_RE.test(part) && i < pieces.length - 1) {
        out.push({ part: pieces.slice(i).join('.').trim(), question: true });
        break;
      }
      out.push({ part, question: isQuestionPart(part) });
    }
  }
  return out;
}
/** [PREGUNTA] Los trozos del mensaje que son preguntas, sin enlaces ni correos y sin tildes. */
function questionParts(body: string): string[] {
  return questionSplit(questionText(body)).filter((p) => p.question).map((p) => p.part);
}
/** [PREGUNTA] Que pregunta un trozo: precio o stock, ficha o duda tecnica, ubicacion o despacho. */
function partKinds(part: string): Set<QuestionKind> {
  const kinds = new Set<QuestionKind>();
  const delivery = part.replace(NOT_DELIVERY_RE, ' ');
  // (revision 12-11) "Envian a Temuco?", "Mandan a regiones?" y "cuanto cuesta enviar": el despacho.
  const sends = SEND_VERB_RE.test(delivery) && !SEND_DOC_RE.test(delivery);
  if ((DELIVERY_QUESTION_RE.test(delivery) || sends) && (!ABOUT_QUOTE_RE.test(delivery) || DELIVERY_WORD_RE.test(delivery))) kinds.add('despacho');
  if (ASK_LOCATION_RE.test(part)) kinds.add('ubicacion');
  if (ASK_TECH_RE.test(part)) kinds.add('tecnica');
  const price = part.replace(DELIVERY_COST_RE, ' ');
  if (ASK_PRICE_RE.test(price) || ASK_STOCK_NUMBER_RE.test(price)) kinds.add('precio');
  return kinds;
}
/** [PREGUNTA] Que pregunta el cliente: precio o stock, ficha o duda tecnica, ubicacion o despacho. */
export function questionKinds(body: string): Set<QuestionKind> {
  const kinds = new Set<QuestionKind>();
  for (const part of questionParts(body)) for (const kind of partKinds(part)) kinds.add(kind);
  return kinds;
}
/**
 * [PREGUNTA] Lo que se contesta antes de la respuesta del flujo: la ubicacion, el despacho y, si ya hay correo, que
 * Claudio Quero revisa el precio o la consulta. `withEmail` false deja fuera el precio y la consulta tecnica: se
 * contestan con MSG_Q_PRICE o MSG_Q_TECH, que piden el correo.
 */
function questionAnswers(kinds: Set<QuestionKind>, withEmail: boolean, install: boolean): string[] {
  const out: string[] = [];
  if (kinds.has('ubicacion')) out.push(MSG_LOCATION);
  if (kinds.has('despacho') && !install) out.push(MSG_WAIT_DELIVERY);
  // (revision 12-11) En la instalacion la pregunta no va en una nota a Claudio (asksForClaudio): no se promete que la
  // revisa ni se habla de disponibilidad.
  if (install) return out;
  if (withEmail && kinds.has('tecnica')) out.push(MSG_Q_TECH_HAS_EMAIL);
  else if (withEmail && kinds.has('precio')) out.push(MSG_Q_PRICE_HAS_EMAIL);
  return out;
}
/** [PREGUNTA] Precio o consulta tecnica sin correo: el texto aprobado que lo pide. */
function questionAsksEmail(kinds: Set<QuestionKind>): string | undefined {
  if (kinds.has('tecnica')) return MSG_Q_TECH;
  if (kinds.has('precio')) return MSG_Q_PRICE;
  return undefined;
}
/** [PREGUNTA] Antepone las respuestas a la del flujo, sin repetir una que ya esta. */
function withAnswers(answers: string[], reply: string): string {
  const missing = answers.filter((answer) => !reply.includes(answer));
  return missing.length ? [...missing, reply].join('\n\n') : reply;
}

/**
 * [PLAZO] Mensaje en una conversacion cerrada que no es un pedido nuevo ni un dato tardio. Con el negocio
 * registrado ya no se repite el cierre largo: si pregunta que sigue o cuanto demora, el plazo; si no, el
 * recordatorio corto. Sin negocio confirmado, lo de siempre (closedReply).
 */
function closedFollowUp(state: FlowState, body: string): string {
  if (state.deal !== 'registered') return closedReply(state);
  // [PREGUNTA] La ubicacion, el despacho y el precio o la consulta tecnica (Claudio Quero la revisa: va en la nota).
  const kinds = questionKinds(body);
  if (!state.isInstallFlow && asksAboutDelivery(body)) kinds.add('despacho');
  const answers = questionAnswers(kinds, true, Boolean(state.isInstallFlow));
  if (answers.length) return answers.join('\n\n');
  if (asksWhatNext(body)) return MSG_WAIT;
  return MSG_REGISTERED_SHORT;
}
/** [PREGUNTA] Con el negocio registrado, una pregunta de precio o tecnica va en una nota al mismo negocio. */
function asksForClaudio(state: FlowState, body: string): boolean {
  if (state.deal !== 'registered' || state.isInstallFlow) return false;
  const kinds = questionKinds(body);
  return kinds.has('precio') || kinds.has('tecnica');
}

type ClaudeFields = {
  producto?: string;
  tipo_de_luz?: string;
  cantidad?: string;
  proyecto_o_uso?: string;
  comuna_o_ciudad?: string;
  nombre?: string;
  empresa?: string;
  correo?: string;
  wantsHuman?: boolean;
  qualifiesForDeal?: boolean;
};

/**
 * [RUT-VALIDO] El ultimo mensaje del bot pidio el RUT: la etapa 3 de una empresa sin RUT, o la
 * repregunta de un RUT que no calzaba. Solo entonces vale el numero sin guion ni la palabra "RUT".
 */
function rutAsked(state: FlowState): boolean {
  return Boolean(state.rutAskedLast);
}

/** [RUT-VALIDO] La respuesta pide el RUT: MSG3_B2B, la repregunta por el RUT o MSG_RUT_INVALID. */
function asksForRut(reply: string): boolean {
  return reply === MSG_RUT_INVALID || reply.includes('RUT de la empresa');
}

/**
 * [RUT-VALIDO] El RUT que reemplaza al capturado, o undefined. Un RUT valido no se reemplaza,
 * salvo uno de persona por uno valido de empresa (B12: "personales en vez de empresa"); uno que
 * no calza, si (por el corregido).
 */
function acceptedRut(current: CapturedFields, found: RutFound | undefined): RutFound | undefined {
  if (!found || !current.rut_valido) return found;
  return current.rut_tipo === 'persona' && isBusinessRut(found) ? found : undefined;
}

// [NO-PISAR] Etiquetas de los cambios (las mismas lineas de la nota de Pipedrive).
type KeptField = 'producto' | 'tipo_de_luz' | 'cantidad' | 'proyecto_o_uso' | 'comuna_o_ciudad';
const KEPT_LABEL: Record<KeptField, string> = {
  producto: 'Producto', tipo_de_luz: 'Tipo de luz', cantidad: 'Cantidad', proyecto_o_uso: 'Proyecto/uso', comuna_o_ciudad: 'Comuna/ciudad',
};
const MAX_CAMBIOS = 10;
function comparable(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// [NO-PISAR] Las palabras que identifican un producto: sin "LED", el color, los articulos, el plural ni el uso
// o el lugar ("para oficina"). "focos LED" es "focos" y "reflectores" es "reflector"; "paneles LED 60x60
// regulables" es mas preciso que "paneles LED 60x60".
const PRODUCT_NOISE_RE = /^(?:led|leds|de|del|con|la|el|los|las|un|una|unos|unas|y|luz|tipo|color|fri[ao]s?|calid[ao]s?|neutr[ao]s?|blanc[ao]s?|amarill[ao]s?)$/;
const stem = (word: string) => (/\d/.test(word) ? word : word.replace(/ces$/, 'z').replace(/s$/, '').replace(/e$/, ''));
function productWords(text: string): string[] {
  return comparable(text).replace(/\b(?:para|en)\b.*$/, '').split(/[^a-z0-9]+/).filter((w) => w && !PRODUCT_NOISE_RE.test(w)).map(stem);
}
// [NO-DEGRADAR] Palabras que solo nombran la familia ("focos", "luminarias LED"), sin modelo ni medida.
const GENERIC_PRODUCT_STEMS = new Set(['foco', 'panel', 'luminaria', 'ampolleta', 'reflector', 'proyector', 'lampara', 'tubo', 'tira',
  'cinta', 'downlight', 'plafon', 'plafone', 'campana', 'dicroico', 'spot', 'equipo', 'producto', 'luz', 'luce', 'articulo', 'item', 'unidad', 'cosa']);
/** [NO-DEGRADAR] El producto es solo una familia ("focos"), sin modelo, medida ni tipo ("Estaca LED COB 5W"). */
function genericProduct(text: string): boolean {
  const words = productWords(text);
  return words.length > 0 && words.every((w) => GENERIC_PRODUCT_STEMS.has(w));
}
// [NO-DEGRADAR] (revision 12-11) Las palabras que sirven para cualquier luminaria: "focos" o "luminarias" tambien
// nombran una estaca o una campana. "Paneles", "reflectores" o "tubos" son otra familia.
const ANY_PRODUCT_STEMS = new Set(['foco', 'luminaria', 'equipo', 'producto', 'luz', 'luce', 'articulo', 'item', 'unidad', 'cosa']);
/**
 * [NO-DEGRADAR] El nombre generico `generic` nombra el mismo producto que `specific`, con menos precision: cada palabra
 * sirve para cualquier luminaria o ya esta en el especifico ("campanas" y "Campana UFO 200W"). "10 reflectores LED"
 * despues de la campana es otro producto.
 */
function sameFamily(generic: string, specific: string): boolean {
  const own = productWords(specific);
  return productWords(generic).every((w) => ANY_PRODUCT_STEMS.has(w) || own.includes(w));
}
/** [NO-PISAR] Las palabras de `text` que no quedan en `kept` (lo que el cliente nego). */
function droppedStems(text: string, kept: string): Set<string> {
  const words = (s: string) => comparable(s).split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  const keep = new Set(words(kept));
  return new Set(words(text).filter((w) => !keep.has(w)));
}
const SAME_VALUE: Partial<Record<KeptField, (a: string, b: string) => boolean>> = {
  tipo_de_luz: (a, b) => normalizeLuz(comparable(a)) === normalizeLuz(comparable(b)),
  cantidad: (a, b) => parseInt(a, 10) === parseInt(b, 10),
  // "paneles led" no cambia "paneles LED 60x60": es el mismo, menos preciso (productWords).
  producto: (a, b) => {
    const before = productWords(a);
    return productWords(b).every((w) => before.includes(w));
  },
  proyecto_o_uso: (a, b) => comparable(a).includes(comparable(b)) || comparable(b).includes(comparable(a)),
};
const KEPT_FIELDS = Object.keys(KEPT_LABEL) as KeptField[];

function noteChange(merged: CapturedFields, field: KeptField, before: string, after: string): void {
  merged.cambios = [...(merged.cambios ?? []), KEPT_LABEL[field] + ': antes ' + before + ', ahora ' + after].slice(-MAX_CAMBIOS);
  console.log('[flowEngine] cambio explicito de ' + field);
}

/**
 * [NO-PISAR] Un dato vacio se llena con `fill`; uno ya capturado solo cambia por `change`, el dato
 * que este mensaje trae explicito y respaldado por su texto (backed), y el cambio queda anotado
 * para la nota ("Cantidad: antes 2, ahora 3").
 */
function keepOrChange(merged: CapturedFields, field: KeptField, fill: string | undefined, change: string | undefined, force = false): void {
  const before = merged[field];
  if (!before) { if (fill) merged[field] = fill; return; }
  const same = SAME_VALUE[field] ?? ((a: string, b: string) => comparable(a) === comparable(b));
  if (!change || (!force && same(before, change))) return;
  merged[field] = change;
  noteChange(merged, field, before, change);
}

/** [NO-PISAR] Lo que devuelve Claude en un campo, solo si es texto (un objeto llegaba como "[object Object]"). */
function claudeText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 120 ? text : undefined;
}

// [NO-PISAR] Palabras que no identifican el dato de Claude ("panel LED para oficina").
const IN_MESSAGE_SKIP_RE = /^(?:para|desde|hasta|como|con|del|las|los|una|uno|unos|unas|que|led|leds)$/;
/** [NO-PISAR] Un codigo o medida ("T8", "18W", "60x60") es el mismo solo si es igual o es el numero con su unidad ("18" y "18w" si; "t8" y "t8a" no). */
function sameSpec(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return /^\d+$/.test(short) && long.startsWith(short) && /^(?:w|watts?|k|v|lm|cm|mm|mts?|m|kw)$/.test(long.slice(short.length));
}
/** [NO-PISAR] Cada palabra del dato de Claude esta en el mensaje, sin tildes ni plurales ("oficinas", Nunoa con enie). */
function inMessage(value: string, text: string): boolean {
  const words = comparable(value).split(/[^a-z0-9]+/).filter((w) => (w.length >= 3 || /\d/.test(w)) && !IN_MESSAGE_SKIP_RE.test(w));
  const textWords = comparable(text).split(/[^a-z0-9]+/);
  return words.length > 0 && words.every((w) => textWords.some((t) => t === w || (/\d/.test(w)
    ? sameSpec(t, w)
    : Math.min(t.length, w.length) >= 4 && (t.startsWith(w) || w.startsWith(t)))));
}

/** [RESPALDO] Alguna palabra del dato de Claude (no "LED" ni "para") esta en el texto, sin tildes ni plurales. */
function sharesWord(value: string, text: string): boolean {
  return comparable(value).split(/[^a-z0-9]+/).filter((w) => (w.length >= 4 || /\d/.test(w)) && !IN_MESSAGE_SKIP_RE.test(w))
    .some((w) => inMessage(w, text));
}
/** [RESPALDO] Las palabras de los enlaces del mensaje ("…/estaca-led-cob-5w-para-jardin" → "estaca led cob 5w para jardin"). */
function linkWords(body: string): string {
  return (body.slice(0, MAX_FACTS).match(/(?:https?:\/\/|www\.)\S*/gi) ?? [])
    .map((url) => url.replace(/^(?:https?:\/\/)?[^/]*/i, '').replace(/[-_/.?=&#%+]+/g, ' ')).join(' ');
}
/** [RESPALDO] El texto sin los nombres de producto (los de Claude y el capturado), del mismo largo cuando se puede. */
function withoutProductNames(text: string, names: Array<string | undefined>): string {
  let out = text;
  for (const name of names) if (name && name.trim().length > 2) out = removeLoose(out, name.trim());
  return out;
}
// [VARIOS-IMAGEN] (revision 12-11) El mensaje de la imagen senala el producto: "este modelo", "como este", "de este",
// "de estos", "el mismo". Se compara sin tildes.
const THIS_ONE_RE = /(?<![a-z])(?:(?:de|como|igual(?:es)?\s+a)\s+(?:est[eao]s?|es[eao]s?|aquel(?:la|los|las)?)|(?:est[eao]s?|es[eao]s?)\s+(?:mism[oa]s?\s+)?(?:modelos?|productos?|equipos?|luminarias?|items?|articulos?)|(?:el|la|los|las)\s+mism[oa]s?)(?![a-z])/;
// [NO-DEGRADAR] Cambiar de producto sin palabra de correccion: "mejor focos", "en vez de estacas, focos", "no, focos".
const PRODUCT_SWITCH_RE = /(?:^|[,.;!?\n]\s*)(?:(?:no\s*,\s*)|(?:no\s*,?\s*)?mejor\s+|en\s+(?:vez|lugar)\s+de\s+)/i;
// [LUZ] Lo que es un color de luz: el de LUZ_RE (calida, neutra, fria, 2200 a 6500 K), ambar, RGB y otros colores.
const LUZ_VALUE_RE = new RegExp('(?<![a-z\\u00e0-\\u00fc])(?:' + LUZ_RE.source
  + '|blanc[oa]s?|amarill[oa]s?|[a\\u00e1]mbar|rgbw?|multicolor|colores|d[i\\u00ed]a|natural|roj[oa]s?|verdes?|azul(?:es)?|morad[oa]s?|violetas?|naranj[oa]s?|rosad[oa]s?|lila|\\d{4}\\s*k(?:elvin)?'
  // (revision 12-11) Luz de cultivo o especial ("Tipo de luz: UV" en las conversaciones reales): antes se volvia a pedir.
  + '|uv[abc]?|ultravioleta|infrarroj[oa]s?|espectro\\s+completo|(?:full|dual)\\s+spectrum|monocrom[a\\u00e1]tic[oa]s?)(?![a-z\\u00e0-\\u00fc])', 'i');
/** [LUZ] El color que trae Claude, solo si es un color de luz. */
function luzValue(value: string | undefined): string | undefined {
  return value && LUZ_VALUE_RE.test(value) ? value : undefined;
}

/**
 * [NO-PISAR] El dato que puede reemplazar al capturado: el de Claude si aparece en este mensaje
 * (Claude lee toda la conversacion y puede repetir uno viejo); si no, el de las reglas.
 */
function backed(claudeValue: string | undefined, ruleValue: string | undefined, facts: string): string | undefined {
  return claudeValue && inMessage(claudeValue, facts) ? claudeValue : ruleValue;
}

// "calidad" no es luz calida: el color va como palabra completa.
const LUZ_RE_ALL = new RegExp('(?<![a-z\\u00e0-\\u00fc])(?:' + LUZ_RE.source + ')(?![a-z\\u00e0-\\u00fc])', 'gi');
// [NO-PISAR] "no fria", "nada de calida", "sin luz fria", "que no sea fria", "no los quiero frios", "no me
// gusta la luz fria": ese color no es el que pide.
const LUZ_NEGATED_RE = /\b(?:no|ni|sin|nada\s+de|tampoco|menos)\s+(?:(?:lo|la|los|las|le|les|me|nos|se)\s+)?(?:(?:sea|sean|es|son|quiero|queremos|necesito|necesitamos|busco|buscamos|gusta|gustan)\s+)?(?:que\s+(?:sea|sean)\s+)?(?:(?:la|el|una|un|en|de|luz|color|tono|blanca|blanco|tan|muy|tipo)\s+){0,3}$/i;
/** [NO-PISAR] El color que pide el mensaje: uno solo, sin los negados ("no fria, calida"); con dos distintos, ninguno. */
function textLuz(facts: string): string | undefined {
  const found = new Set<string>();
  for (const m of facts.matchAll(LUZ_RE_ALL)) {
    if (!LUZ_NEGATED_RE.test(facts.slice(Math.max(0, m.index - 40), m.index))) found.add(normalizeLuz(m[0]));
  }
  return found.size === 1 ? [...found][0] : undefined;
}
/** [NO-PISAR] Los colores que el mensaje niega ("no fria"). */
function negatedLuz(facts: string): Set<string> {
  const found = new Set<string>();
  for (const m of facts.matchAll(LUZ_RE_ALL)) {
    if (LUZ_NEGATED_RE.test(facts.slice(Math.max(0, m.index - 40), m.index))) found.add(normalizeLuz(m[0]));
  }
  return found;
}

// [NO-PISAR] Solo lo que el cliente afirma cambia un dato: sus preguntas ("tienen tienda en Santiago?") no.
// Sin "\u00bf", la pregunta es la ultima clausula ("Ahora necesito 20 paneles, hacen despacho?"): lo que
// afirma antes se conserva, salvo una condicion ("y si necesito 50, cuanto sale?", tambien sin "?"). Una
// pregunta indirecta ("quiero saber si tienen focos, calidos") tampoco es un dato.
// [CANTIDAD] Un punto entre cifras ("1.000 focos", "1.5 m") es parte del numero: no corta la oracion, la
// pregunta ni la palabra (aqui, en maskNegated y en additions). Antes "Necesito 1.000 focos" quedaba en
// "Necesito 1." y "000 focos", y la cantidad era 1.
const ASSERTION_RE = /\b(?:necesit|quier|quis|requier|requer|busc|ocup|son\b|ser[i\u00ed]an?\b|ahora\b|cambi|corrij|perd[o\u00f3]n|es\s+para|soy\b|somos\b|estoy\b|estamos\b)/i;
const CONDITIONAL_RE = /^\s*(?:y\s+|pero\s+)?(?:si|por\s+si|en\s+caso(?:\s+de)?(?:\s+que)?)\s+[^\s,;]/i;
const QUESTION_START_RE = /^\s*(?:cu[a\u00e1]nt|qu[e\u00e9](?![a-z\u00e0-\u00fc])|cu[a\u00e1]l|c[o\u00f3]mo|d[o\u00f3]nde|hay\b|tienen\b|me\s+hacen|hacen\b|dan\b|sale\b|cuesta|vale\b|habr[i\u00ed]a|ser[i\u00ed]a\b|podr[i\u00ed]an)/i;
// La pregunta termina ante otro pedido o correccion; "pero necesito" y "corrijo:" tambien sin coma.
const INDIRECT_CLAUSE_START = '(?:necesit|quier|quis|requier|requer|busc|ocup|son\\b|ser[i\\u00ed]an?\\b|ahora\\b|corrij|corrig|correcci[o\\u00f3]n|me\\s+equivoqu'
  + '|c[a\\u00e1]mbi[a-z]*\\s+(?:la\\s+cantidad|el\\s+producto|el\\s+color|la\\s+luz|el\\s+tipo|a\\s+\\d)'
  + '|perd[o\\u00f3]n\\s*,?\\s*(?:son|eran|era|es|ser[i\\u00ed]an)\\b|mejor\\s+(?:\\d|son\\b|que\\s+sean|ser[i\\u00ed]an)|en\\s+(?:vez|lugar)\\s+de\\s+\\d)';
const INDIRECT_QUESTION_RE = new RegExp('\\b(?:saber|consultar|preguntar(?:le|les|te)?)\\s+(?:si|por|cu[a\\u00e1]nt\\w*|qu[e\\u00e9]|c[o\\u00f3]mo|d[o\\u00f3]nde|cu[a\\u00e1]l\\w*)(?![a-z\\u00e0-\\u00fc])'
  + '(?:(?!\\b(?:(?:corrij|corrig)[a-z]*\\s*:|pero\\s+' + INDIRECT_CLAUSE_START + '))'
  + '(?:[^,;.!?\\n]|(?<=\\d)\\.(?=\\d)|[,;](?!\\s*(?:(?:y|pero)\\s+)?' + INDIRECT_CLAUSE_START + ')))*', 'gi');
// El punto de "aprox. 30" es parte de la abreviatura, no el fin de la pregunta o negacion.
const APPROX_DOT_RE = /\baprox\./gi;
function withoutIndirectQuestions(text: string): string {
  return text.replace(APPROX_DOT_RE, 'aprox ').replace(INDIRECT_QUESTION_RE, ' ');
}
function withoutQuestions(text: string): string {
  return withoutIndirectQuestions(text).split(/(?<=[!?\n]|(?<!\d)\.|\.(?!\d))|(?=\u00bf)/).map((part) => {
    const clauses = part.split(/(?<=[,;])/);
    if (!/[?\u00bf]/.test(part)) return clauses.length > 1 && CONDITIONAL_RE.test(clauses[0]) && QUESTION_START_RE.test(clauses[1]) ? '' : part;
    if (part.includes('\u00bf')) return '';
    const head = clauses.slice(0, -1);
    const conditional = head.findIndex((clause) => CONDITIONAL_RE.test(clause));
    const kept = (conditional >= 0 ? head.slice(0, conditional) : head).join('');
    return ASSERTION_RE.test(kept) ? kept : '';
  }).join(' ');
}
// [NO-PISAR] Lo que el cliente niega no es un dato: "no es para bodega", "no necesito 20 focos para la bodega
// en Maipu", "no los quiero frios", "sin focos". Con un verbo ("no necesito", "no es"), la negacion llega hasta
// la coma o hasta lo que el cliente afirma despues ("no eran 10 eran 20", "no es en Santiago es en Temuco",
// "no me acorde, tambien necesito 6 focos"); sin verbo ("no fria", "no muy caro", "sin marco") o en "que no
// sea fria", solo a esa palabra. "No se", "no tengo claro" o "no importa" no niegan un dato.
const NEGATOR_RE = /(?<![a-z\u00e0-\u00fc])(?:no|ni|tampoco|nada\s+de|sin)\s+/gi;
const NOT_A_DATUM_RE = /^(?:s[e\u00e9]|lo\s+s[e\u00e9]|tengo\s+(?:claro|idea)|estoy\s+segur[oa]s?|importa|hay\s+(?:problema|apuro)|me\s+acuerdo|recuerdo|idea)(?![a-z\u00e0-\u00fc])/i;
const NEGATED_VERB_RE = /^(?:es|era|eran|son|sea|sean|fue|fueron|ser[a\u00e1]n?|ser[i\u00ed]an?|est[a\u00e1]n?|estoy|estamos|soy|somos|necesito|necesitamos|necesitaba|quiero|queremos|quer[i\u00ed]a|quisiera|busco|buscamos|requiero|requerimos|ocupo|ocupamos|tengo|tenemos|compro|compramos|cotizo|cotizamos|pido|pedimos|uso|usamos|va|van|voy|vamos|gusta|gustan|sirve|sirven|interesa|interesan|llevo|llevamos)$/i;
const NEGATION_PIVOT_RE = /^(?:pero|sino|aunque|mejor|perd[o\u00f3]n|tambi[e\u00e9]n|adem[a\u00e1]s|aparte|ahora|c[a\u00e1]mbi[a-z]*|corrij[a-z]*|corrig[a-z]*|equivoqu[a-z\u00e0-\u00fc]*)$/i;
const NEGATED_PRONOUN_RE = /^(?:lo|la|los|las|le|les|me|nos|se|te)$/i;
// Sin verbo: la palabra negada, con sus articulos y su complemento ("no muy caro", "sin servicio de instalacion").
const NARROW_NEGATION_RE = /^(?:(?:muy|tan|demasiado|tanto|el|la|los|las|un|una|en|para|de|del|mi|luz|color|tipo)\s+){0,3}(?:[^\s,;.!?\n]|(?<=\d)\.(?=\d))+(?:\s+de\s+(?:[^\s,;.!?\n]|(?<=\d)\.(?=\d))+)?(?:\s+(?:led|leds|solar|solares))?/i;
const LUZ_WORD_RE = new RegExp('^(?:' + LUZ_RE.source + ')$', 'i');
const MAX_NEGATED_WORDS = 12;
const isMark = (word: string) => /^[,;.!?\n]$/.test(word);
/** Donde termina lo que niega el "no" (o "ni", "sin") que termina en `from`. */
function negatedEnd(text: string, from: number, negator: string, relative: boolean): number {
  const rest = text.slice(from, from + 200);
  const notDatum = rest.match(NOT_A_DATUM_RE);
  if (notDatum) return from + notDatum[0].length;
  const words: RegExpExecArray[] = [];
  for (const word of rest.matchAll(/(?:[^\s,;.!?\n]|(?<=\d)\.(?=\d))+|[,;.!?\n]/g)) if (words.push(word) > MAX_NEGATED_WORDS + 4) break;
  let i = 0;
  while (i < words.length && NEGATED_PRONOUN_RE.test(words[i][0])) i++;
  const first = words[i]?.[0];
  if (!first || isMark(first) || NEGATION_PIVOT_RE.test(first)) return from;
  const verb = NEGATED_VERB_RE.test(first);
  if (/^sin/i.test(negator) || relative || !verb) {
    const at = verb && words[i + 1] && !isMark(words[i + 1][0]) ? words[i + 1].index : words[i].index;
    // "No 1.000 focos": el producto tambien queda negado, no solo el numero.
    const quantity = rest.slice(at).match(/^\d+(?:\.\d{3})*\s+/);
    const product = quantity && rest.slice(at + quantity[0].length).match(PRODUCTO_RE);
    if (quantity && product?.index === 0) return from + at + quantity[0].length + product[0].length;
    return from + at + (rest.slice(at).match(NARROW_NEGATION_RE)?.[0].length ?? 0);
  }
  // Con verbo: hasta la coma, un verbo que afirma otra cosa o un segundo color ("no fria, calida").
  let end = words[i].index + first.length;
  let color = LUZ_WORD_RE.test(first);
  for (let j = i + 1; j < words.length && j - i < MAX_NEGATED_WORDS; j++) {
    const word = words[j][0];
    if (isMark(word) || NEGATION_PIVOT_RE.test(word)) break;
    if (NEGATED_VERB_RE.test(word) && !/^que$/i.test(words[j - 1][0])) break;
    const isColor = LUZ_WORD_RE.test(word);
    if (isColor && color) break;
    color ||= isColor;
    end = words[j].index + word.length;
  }
  return from + end;
}
function maskNegated(text: string): string {
  text = text.replace(APPROX_DOT_RE, 'aprox ');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(NEGATOR_RE)) {
    if (m.index < last) continue;
    const from = m.index + m[0].length;
    const end = negatedEnd(text, from, m[0], /\bque\s+$/i.test(text.slice(Math.max(0, m.index - 6), m.index)));
    if (end <= from) continue;
    out += text.slice(last, m.index) + ' ';
    last = end;
  }
  return out + text.slice(last);
}
// [NO-PISAR] Lo que el mensaje suma como otro item ("tambien necesito 10 focos", "20 focos ademas", "agrega",
// "otros 5", "5 paneles mas") no cambia lo capturado; el resto del mensaje (base) si puede corregir otro dato
// ("corrijo la comuna a Temuco, tambien necesito 20 focos"). "Tambien" o "ademas" suman solo si nombran otro
// producto o una cantidad, y nunca en una correccion ("tambien quiero cambiar la cantidad a 20") ni en una
// caracteristica ("ademas que los paneles sean calidos").
const ADDITION_WORD_RE = /(?<![a-z\u00e0-\u00fc])(?:tambi[e\u00e9]n|adem[a\u00e1]s|aparte)(?![a-z\u00e0-\u00fc])/gi;
const ADD_VERB_RE = /\b(?:agreg(?:a|ar|ame|ale|uen)|sum(?:a|ar|ame|ale))\b|\botr[oa]s?\s+\d/i;
// "5 paneles mas", "y 20 focos mas", "mas 20 focos"; nunca "20 o mas", "mas o menos", "mas de 20" ni "mas potentes".
const MORE_RE = /\b\d+\s+(?:[a-z\u00e0-\u00fc]+\s+){0,3}?(?<!\bo\s)m[a\u00e1]s(?=\s*(?:[,.;!?\n]|$)|\s+(?:y|para|por\s+favor|porfa)\b)|(?:^|[,.;!?\n]|\by)\s*m[a\u00e1]s\s+\d/i;
// Una correccion de un dato ("corrijo", "me equivoque", "cambia la cantidad a 20", "en vez de 10", "mejor 20"),
// no las mismas palabras en un pedido ("para cambiar la luz", "focos con cambio de color", "la mejor calidad").
const CORRECTION_RE = /(?:corrij|corrig|correcci[o\u00f3]n|me\s+equivoqu|perd[o\u00f3]n\s*,?\s*(?:son|eran|era|es|ser[i\u00ed]an)\b|(?<!\bpara\s+)c[a\u00e1]mbi[a-z]*\s+(?:la\s+cantidad|el\s+producto|el\s+color|la\s+luz|el\s+tipo|a\s+\d)|en\s+(?:vez|lugar)\s+de\s+\d|(?:^|[,.;!?\n]\s*)(?:no\s*,?\s*)?mejor\s+(?:\d|son\b|que\s+sean|ser[i\u00ed]an))/i;
const MAX_ADDITION_MARKS = 5;
function additions(text: string, producto: string | undefined): { adding: boolean; base: string } {
  const own = new Set(producto ? productWords(producto) : []);
  const addsNew = (part: string) => mentionsQuantity(part) || itemsIn(part).some((item) => !own.has(stem(item)));
  const spans: Array<[number, number]> = [];
  const add = (start: number, end: number) => { if (!CORRECTION_RE.test(text.slice(start, end))) spans.push([start, end]); };
  for (const s of text.matchAll(/(?:[^.;!?\n]|(?<=\d)\.(?=\d))+/g)) {
    const sentence = s[0];
    for (const c of sentence.matchAll(/[^,]+/g)) {
      if (ADD_VERB_RE.test(c[0]) || MORE_RE.test(c[0])) add(s.index + c.index, s.index + c.index + c[0].length);
    }
    for (const m of [...sentence.matchAll(ADDITION_WORD_RE)].slice(0, MAX_ADDITION_MARKS)) {
      const at = m.index + m[0].length;
      const after = sentence.slice(at);
      if (/^\s*,?\s*que\b/i.test(after)) continue;
      // Hasta la clausula que nombra el item: "tambien necesito 20 focos, corrijo la comuna" deja la comuna.
      const named = [...after.matchAll(/[^,]+/g)].slice(0, 4).find((c) => addsNew(c[0]));
      if (named) { add(s.index + m.index, s.index + at + named.index + named[0].length); continue; }
      // Al final de su clausula ("necesito 20 focos tambien"), suma lo que va antes; "aparte" no ("que no
      // tengan panel aparte" es "por separado").
      const start = sentence.lastIndexOf(',', m.index) + 1;
      if (!after.split(',')[0].replace(/\b(?:porfa|por\s+favor|y)\b/gi, '').trim() && !/^apart/i.test(m[0]) && addsNew(sentence.slice(start, m.index))) {
        add(s.index + start, s.index + at);
      }
    }
  }
  let base = text;
  for (const [start, end] of spans) base = base.slice(0, start) + ' '.repeat(end - start) + base.slice(end);
  return { adding: spans.length > 0, base };
}

// [VARIOS] Un pedido largo de varios items en un mensaje (negocios 139, 197 y 211) queda entero en la nota: con 160
// caracteres se perdian el tercer y el cuarto item.
const MAX_VARIOS = 600;
function appendVarios(merged: CapturedFields, text: string): void {
  if (comparable(merged.cantidad_varios ?? '').includes(comparable(text))) return;
  merged.cantidad_varios = ((merged.cantidad_varios ? merged.cantidad_varios + ' / ' : '') + text).slice(0, 2 * MAX_VARIOS);
}
/**
 * [CANTIDAD] La cantidad del mensaje (`quantity`) y la que afirma, sin sus preguntas (`stated`).
 * - Un entero sigue la regla de no pisar (keepOrChange).
 * - Varios items afirmados reemplazan a la cantidad capturada (el cambio queda anotado) o se suman
 *   al texto de varios items; una cantidad afirmada despues de varios items los reemplaza.
 * - Si el mensaje afirma otro item ("tambien necesito 10 focos"), lo capturado pasa a varios items.
 */
function mergeQuantity(merged: CapturedFields, quantity: QuantityRead, stated: QuantityRead, facts: string, adding: boolean): void {
  const text = facts.trim().replace(/\s+/g, ' ').slice(0, MAX_VARIOS);
  if (adding && (merged.cantidad || merged.cantidad_varios)) {
    if (merged.cantidad) {
      noteChange(merged, 'cantidad', merged.cantidad, 'varios items');
      merged.cantidad_varios = ((merged.producto ? merged.producto + ': ' : '') + merged.cantidad + (merged.cantidad_unidad === 'm' ? ' m' : '') + ' / ' + text).slice(0, 2 * MAX_VARIOS);
      delete merged.cantidad;
      delete merged.cantidad_unidad;
    } else appendVarios(merged, text);
    return;
  }
  if (quantity.several) {
    if (!merged.cantidad) { appendVarios(merged, text); return; }
    if (!stated.several) return;
    noteChange(merged, 'cantidad', merged.cantidad, 'varios items');
    delete merged.cantidad;
    delete merged.cantidad_unidad;
    merged.cantidad_varios = text;
    return;
  }
  if (quantity.value === undefined) return;
  const value = String(quantity.value);
  const change = quantity.explicit && stated.value === quantity.value ? value : undefined;
  if (merged.cantidad_varios && !merged.cantidad) {
    if (!change) return;
    noteChange(merged, 'cantidad', 'varios items (' + merged.cantidad_varios.slice(0, 80) + ')', value);
    delete merged.cantidad_varios;
    merged.cantidad = value;
    setUnit(merged, quantity);
    return;
  }
  const before = merged.cantidad;
  keepOrChange(merged, 'cantidad', value, change);
  if (merged.cantidad === value && before !== value) setUnit(merged, quantity);
}
/** [METROS] La unidad va con la cantidad que se acaba de anotar: metros, o (sin unidad) unidades. */
function setUnit(merged: CapturedFields, quantity: QuantityRead): void {
  if (quantity.unit) merged.cantidad_unidad = quantity.unit;
  else delete merged.cantidad_unidad;
}

// [NO-PISAR] "SpA", "Ltda." o "S.A." son el tipo de una razon social, nunca el proyecto (prueba
// del 16-10: "Proyecto/uso: Spa"). Tampoco lo es una parte del nombre de la empresa.
const LEGAL_FORM_RE = /^(?:s\.?\s?p\.?\s?a\.?|ltda\.?|limitada|s\.?\s?a\.?|e\.?\s?i\.?\s?r\.?\s?l\.?|sociedad(?:\s+an[o\u00f3]nima)?)$/i;
const SPA_PROJECT_RE = /\bpara\s+(?:un|una|el|la|mi|nuestro|nuestra)\s+spa\b/i;
// [NO-PISAR] El local, la tienda o la bodega de eLIGHTS donde el cliente retira o va tampoco es el proyecto: "con
// retiro en su local", "retiro el pedido en la bodega", "puedo pasar a su tienda" (R8 de la ronda 3: "Comuna: Colina
// con retiro en su local" dejaba "Proyecto/uso: local"). El del cliente si ("focos para su local", "retirar los
// tubos de la bodega"). Ir, pasar o visitar, en cualquier tiempo y tambien "a buscarlos", solo con "su": "pasare por su
// tienda", "ire a su local", "paso a buscarlos a su tienda"; "los vamos a pasar a la oficina" es la del cliente.
const STORE_PLACE_RE = new RegExp('(?<![a-z\\u00e0-\\u00fc])(?:'
  + 'retir[a-z\\u00e0-\\u00fc]*(?:\\s+(?:el|la|los|las|mi|mis|nuestr[oa]s?)\\s+(?:pedidos?|compras?|productos?|mercader[i\\u00ed]as?|encargos?))?'
  + '\\s+(?:en|a|al|por|desde)\\s+(?:(?:su|sus|la|el|vuestr[oa]s?)\\s+)?'
  + '|(?:ir|ir[e\\u00e9]|iremos|ir[i\\u00ed]a|ir[i\\u00ed]amos|voy|vamos|pas(?:ar|o|e|amos|ar[e\\u00e9]|aremos|ar[i\\u00ed]a|ar[i\\u00ed]amos)'
  + '|visit(?:ar|o|e|amos|ar[e\\u00e9]|aremos|ar[i\\u00ed]a))(?:\\s+a\\s+(?:buscar|retirar)(?:l[oa]s?)?)?\\s+(?:en|a|al|por)\\s+(?:su|sus|vuestr[oa]s?)\\s+'
  + ')(?:locale?s?|tiendas?|bodegas?|oficinas?|sucursal(?:es)?|showroom)(?![a-z\\u00e0-\\u00fc])', 'gi');
// [RESPALDO] Lo que no dice un uso en la respuesta a la pregunta por el uso: saludos, "no se", la comuna o el color.
const NOT_A_USE_RE = /^(?:hola|buenas|buenos|dias|tardes|noches|gracias|saludos|ok|okey|vale|bueno|si|no|se|nose|aun|todavia|quizas|tal|vez|para|por|con|del|las|los|una|unos|unas|que|mi|mis|su|sus|el|la|en|es|son|led|leds|luz|comuna|ciudad|region|santiago)$/;
/** [RESPALDO] El mensaje dice algo mas que la comuna, el color o un saludo: lo que queda es el uso que contesta. */
function saysAUse(said: string, claudeParsed: ClaudeFields): boolean {
  let rest = comparable(said);
  for (const value of [claudeText(claudeParsed.comuna_o_ciudad), claudeText(claudeParsed.tipo_de_luz), claudeText(claudeParsed.nombre)]) {
    if (value) rest = rest.split(comparable(value)).join(' ');
  }
  rest = rest.replace(LUZ_RE_ALL, ' ').replace(/\d+/g, ' ');
  return rest.split(/[^a-z]+/).some((w) => w.length >= 4 && !NOT_A_USE_RE.test(w));
}
/** [NO-PISAR] El texto sin el lugar de la tienda (STORE_PLACE_RE), del mismo largo. */
function withoutStorePlaces(text: string): string {
  return text.replace(STORE_PLACE_RE, (m) => ' '.repeat(m.length));
}
function claudeProject(claudeParsed: ClaudeFields, body: string, said: string, answering = false): string | undefined {
  const value = claudeText(claudeParsed.proyecto_o_uso);
  if (!value) return undefined;
  // [RESPALDO] Solo el uso que el cliente dice en este mensaje, fuera del nombre del producto. (revision 12-11) Si el
  // mensaje contesta la pregunta por el uso con otras palabras ("Para mi negocio de comida rapida" y Claude
  // "restaurante"), vale lo de Claude: el cliente si lo dijo.
  if (!inMessage(value, said) && !(answering && saysAUse(said, claudeParsed))) return undefined;
  if (LEGAL_FORM_RE.test(value) && !SPA_PROJECT_RE.test(body)) return undefined;
  if (inMessage(value, body) && !inMessage(value, withoutStorePlaces(body))) return undefined;
  const empresa = claudeText(claudeParsed.empresa) ?? claudeText(claudeParsed.nombre);
  if (empresa && comparable(empresa).includes(comparable(value))) return undefined;
  return value;
}

// [NO-PISAR] "Razon social: Comercial Prueba SpA": hasta su tipo (SpA, Ltda.) o, si no lo trae, hasta
// 6 palabras sin numeros, sin cruzar una coma ni un pedido ("necesito 30 paneles" sigue en el texto).
// Primero sale el nombre que dio Claude, entero: antes la regla cortaba "Comercial 25 SpA" en el 25.
const RAZON_STOP = '(?!(?:necesito|necesitamos|quiero|queremos|busco|requiero|rut|correo|mail|para|y)\\b)';
const RAZON_WORD = RAZON_STOP + '[^\\s\\d,;\\n]+';
// Con su tipo (SpA, Ltda.), el nombre puede traer numeros ("Comercial 25 SpA").
const RAZON_NAME_WORD = RAZON_STOP + '[^\\s,;\\n]+';
// Sin su tipo, el nombre puede terminar en un numero ("Comercial 25"), salvo el de un pedido ("Comercial 30 paneles").
const RAZON_SOCIAL_RE = new RegExp('raz[o\\u00f3]n\\s+social\\s*:?\\s*(?:(?:' + RAZON_NAME_WORD + '\\s+){0,6}?(?:s\\.?\\s?p\\.?\\s?a\\.?|ltda\\.?|limitada|s\\.?\\s?a\\.?|e\\.?\\s?i\\.?\\s?r\\.?\\s?l\\.?)(?![a-z])|(?:' + RAZON_WORD + '[^\\S\\n]*){1,6}(?:\\d+(?![^\\S\\n]*[a-z\\u00e0-\\u00fc]))?)', 'gi');
// Un mensaje de WhatsApp trae hasta 1.600 caracteres: el tope evita trabajo de mas con uno mas largo.
const MAX_FACTS = 2000;
/** [NO-PISAR] El texto sin `needle`, sin importar mayusculas ni tildes ("COMERCIAL PRUEBA SPA"). */
function removeLoose(text: string, needle: string): string {
  const hay = bareText(text).toLowerCase();
  const key = bareText(needle).toLowerCase();
  if (hay.length !== text.length) return text.split(needle).join(' ');
  let out = text;
  for (let i = hay.indexOf(key); i >= 0; i = hay.indexOf(key, i + key.length)) out = out.slice(0, i) + ' '.repeat(key.length) + out.slice(i + key.length);
  return out;
}
/** [NO-PISAR] El mensaje sin enlaces, correos ni razon social: no son producto, proyecto, comuna ni cantidad. */
function factsText(body: string, claudeParsed: ClaudeFields): string {
  let text = body.slice(0, MAX_FACTS);
  for (const name of [claudeParsed.empresa, claudeParsed.nombre]) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length > 2) text = removeLoose(text, trimmed);
  }
  // Los enlaces salen antes de cortar preguntas: el punto del dominio no debe dejar fragmentos con numeros.
  return text.replace(/(?:https?:\/\/|www\.)\S*/gi, ' ').replace(EMAIL_RE_ALL, ' ').replace(RAZON_SOCIAL_RE, ' ');
}

// [COMUNA] La comuna de la instalacion: con varias en el mensaje, la que eligio Claude (si es una de ellas)
// o la primera. La de la factura no cuenta, y la de donde es la persona ("Soy de Maipu. La obra es en Lampa.")
// solo si no hay ninguna de la obra: Claude elige dentro de ese mismo grupo.
function pickComuna(mentions: ComunaMention[], claudeValue: unknown): string | undefined {
  const obra = mentions.filter((m) => !m.billing && !m.origin).map((m) => m.name);
  const places = obra.length ? obra : mentions.filter((m) => !m.billing).map((m) => m.name);
  const claudePick = officialComuna(claudeText(claudeValue));
  return claudePick && places.includes(claudePick) ? claudePick : places[0];
}
const MAX_COMUNAS_OTRAS = 5;
/** [COMUNA] Las comunas del mensaje que no quedaron como la comuna van a "Otras comunas mencionadas". */
function noteOtherComunas(merged: CapturedFields, mentions: ComunaMention[], kept: string | undefined): void {
  const current = [kept, merged.comuna_o_ciudad, merged.install_comuna].filter(Boolean).map((c) => comparable(c as string));
  const others = [...(merged.comunas_otras ?? [])];
  for (const { name: comuna } of mentions) {
    if (!current.includes(comparable(comuna)) && !others.some((o) => comparable(o) === comparable(comuna))) others.push(comuna);
  }
  if (others.length) merged.comunas_otras = others.slice(0, MAX_COMUNAS_OTRAS);
}
/**
 * [COMUNA] La comuna sale solo de la lista oficial y cuando el texto la presenta como lugar o contesta
 * la pregunta por ella (findComunaMentions): lo que devuelve Claude solo elige entre esas. Una vacia se
 * llena con lo que el cliente afirma (o, si no, pregunta: "despachan a Temuco?"); una capturada cambia
 * solo si lo que afirma trae una comuna (o varias, y Claude eligio una), y el cambio queda anotado. La
 * comuna de la factura ("la facturacion en Vina del Mar"), la de donde es la persona ("soy de Maipu") y las
 * demas van a "Otras comunas mencionadas". Lo que ya no vale ("antes era en Lampa") no es una mencion: "Corrijo: ahora es en Colina, antes era en
 * Lampa" cambia a Colina. Vale igual para la comuna de la instalacion (`field`).
 */
function mergeComuna(
  merged: CapturedFields,
  field: 'comuna_o_ciudad' | 'install_comuna',
  claudeValue: unknown,
  texts: { answering: boolean; company: boolean; assertive: string; affirmed: string; base: string },
): void {
  const opts = { answering: texts.answering, company: texts.company };
  const stated = findComunaMentions(texts.assertive, opts);
  const current = merged[field];
  if (!current) {
    const comunas = stated.length ? stated : findComunaMentions(texts.affirmed, opts);
    const pick = pickComuna(comunas, claudeValue);
    if (pick) merged[field] = pick;
    noteOtherComunas(merged, comunas, pick);
    return;
  }
  // withOfficialComunas deja la capturada con su nombre oficial. De donde es la persona ("Soy Ana Prueba de
  // Maipu", "desde Maipu") no cambia la obra: va a "Otras comunas mencionadas".
  const inBase = findComunaMentions(texts.base, opts).filter((m) => !m.billing && !m.origin).map((m) => m.name);
  if (inBase.length && !inBase.includes(current)) {
    const claudePick = officialComuna(claudeText(claudeValue));
    const change = inBase.length === 1 ? inBase[0] : claudePick && inBase.includes(claudePick) ? claudePick : undefined;
    if (change) {
      merged[field] = change;
      noteChange(merged, 'comuna_o_ciudad', current, change);
    }
  }
  noteOtherComunas(merged, stated, undefined);
}

// PASO 1: MERGE de los campos del flujo de productos.
// [NO-PISAR] Producto, color, cantidad, proyecto y comuna: un dato vacio se llena (con lo de
// Claude o, si no, con las reglas); uno ya capturado solo cambia si este mensaje lo trae explicito
// (keepOrChange). Antes lo de Claude, que lee toda la conversacion, y la regla del color pisaban.
// [CANTIDAD] La cantidad sale de readQuantity (quantity.ts), nunca del primer numero del mensaje.
// [RUT-VALIDO] rutToConfirm: llego un RUT que no calza y todavia no se pidio de nuevo.
// [CASO-1] menuPick: el mensaje es solo el numero de un item de la lista que el bot acaba de mostrar.
function mergeProductFields(
  state: FlowState,
  body: string,
  claudeParsed: ClaudeFields,
  hasMedia = false,
): { merged: CapturedFields; leadType: LeadType; rutToConfirm: boolean; menuPick?: number } {
  const merged: CapturedFields = { ...state.captured };
  // [CANTIDAD] Un estado guardado antes de este cambio puede traer un dato que no es texto (un
  // objeto de Claude) o una cantidad que no es un entero ("No especificada"): se descarta y se pregunta.
  for (const field of KEPT_FIELDS) if (merged[field] !== undefined && typeof merged[field] !== 'string') delete merged[field];
  if (merged.cantidad && !/^\d{1,5}$/.test(merged.cantidad)) delete merged.cantidad;
  if (!merged.cantidad || (merged.cantidad_unidad !== undefined && merged.cantidad_unidad !== 'm')) delete merged.cantidad_unidad;
  const inspected = inspectRut(body, { asked: rutAsked(state) });
  const ruts = inspected.found ? [inspected.found.rut] : inspected.ambiguous ?? [];
  const facts = factsText(body, claudeParsed);
  // [NO-PISAR] Lo que el cliente niega no llena ni cambia un dato (affirmed); para llenar, lo que afirma gana a lo
  // que pregunta ("Necesito 20 paneles, tienen focos?" es paneles). Un dato capturado cambia solo con
  // lo que afirma (sin sus preguntas: assertive) y fuera de lo que suma como otro item (base). La regla cambia
  // un dato solo si encuentra un valor (soleMatch).
  const affirmed = maskNegated(facts);
  const assertive = maskNegated(withoutQuestions(facts));
  const { adding, base } = additions(assertive, merged.producto);
  const rule = (re: RegExp) => soleMatch(base, re);
  // El dato de Claude que el mensaje solo nombra negado ("No necesito focos") no llena el campo.
  const negatedOnly = (value: string | undefined) => Boolean(value && inMessage(value, facts) && !inMessage(value, affirmed));
  const fillWith = (value: string | undefined, fallback: string | undefined) => (value && !negatedOnly(value) ? value : fallback);
  // [CANTIDAD] Un numero suelto contesta la pregunta solo si la cantidad todavia falta.
  const question = lastQuestionOf(state);
  const options = {
    ruts,
    asked: Boolean(question?.asks.includes('cantidad')) && !merged.cantidad && !merged.cantidad_varios,
    menuLength: question?.listLength ?? 0,
    contact: EMAIL_RE.test(body),
    claude: claudeParsed.cantidad,
    // [METROS] (revision 12-11) Los metros cuentan solo si el producto se vende por metro.
    product: merged.producto ?? claudeText(claudeParsed.producto),
  };
  const quantity = readQuantity(maskNegated(withoutIndirectQuestions(facts)), options);
  const stated = assertive === facts ? quantity : readQuantity(assertive, { ...options, menuLength: 0 });
  // Con varios items ("20 paneles y 30 focos") la regla ve uno solo: no cambia el producto.
  const claudeProd = claudeText(claudeParsed.producto);
  const prodChange = backed(claudeProd, quantity.several ? undefined : rule(PRODUCTO_RE), base);
  // "Corrijo: paneles LED, no regulables": quitar del producto lo que el cliente niega tambien es un cambio.
  const negated = droppedStems(facts, affirmed);
  const dropsNegated = Boolean(prodChange && merged.producto
    && productWords(merged.producto).some((w) => negated.has(w) && !productWords(prodChange).includes(w)));
  // [NO-DEGRADAR] Caso del 12-11: "5 focos" no cambia "Estaca LED COB 5W para jardin" por "focos". Un nombre
  // generico nunca reemplaza a uno especifico, salvo una correccion ("corrijo, mejor focos", "no quiero estacas,
  // quiero focos"). De generico a especifico, o entre dos genericos, si cambia.
  // (revision 12-11) Solo la misma familia: "10 reflectores LED" despues de la campana, o "paneles" despues de la
  // estaca, cambian el producto (sameFamily).
  const downgrade = Boolean(prodChange && merged.producto && genericProduct(prodChange) && !genericProduct(merged.producto)
    && sameFamily(prodChange, merged.producto)
    && !dropsNegated && !CORRECTION_RE.test(assertive) && !PRODUCT_SWITCH_RE.test(assertive));
  // [RESPALDO] El producto de Claude llena el dato vacio solo si alguna de sus palabras esta en el mensaje o en el
  // enlace de la ficha (negocio 206: "Sistemas de seguridad" salia del nombre del perfil).
  const claudeProdFill = claudeProd && sharesWord(claudeProd, facts + ' ' + linkWords(body)) ? claudeProd : undefined;
  keepOrChange(merged, 'producto', fillWith(claudeProdFill, extractProducto(assertive) ?? (itemsIn(assertive).length ? undefined : extractProducto(affirmed))), downgrade ? undefined : prodChange, dropsNegated);
  // El color del texto gana al de Claude cuando no calzan (Claude puede repetir uno negado o viejo).
  const luzText = textLuz(assertive) ?? textLuz(affirmed);
  // [LUZ] El de Claude solo si es un color de luz: nunca "LED", "luz interior" ni el uso (negocios 148 y 156).
  const claudeLuz = luzValue(claudeText(claudeParsed.tipo_de_luz));
  const luzConflict = Boolean(luzText && claudeLuz && normalizeLuz(comparable(claudeLuz)) !== luzText);
  // El color que el cliente niega ("no fria") no llena el dato, aunque Claude lo devuelva.
  const luzNegated = Boolean(claudeLuz && !luzText && (negatedLuz(facts).has(normalizeLuz(comparable(claudeLuz))) || negatedOnly(claudeLuz)));
  keepOrChange(merged, 'tipo_de_luz', luzConflict ? luzText : luzNegated ? undefined : claudeLuz ?? luzText, textLuz(base));
  // Lo que el cliente afirma decide la cantidad ("Necesito 20 paneles, tienen 30 focos?" es 20); si no afirma
  // ninguna, el mensaje sin negaciones ni consultas indirectas puede llenar el dato vacio.
  // [VARIOS-IMAGEN] Negocio 130: cada imagen con su cantidad ("12 UND" y luego "5 UND") es otro item, no una
  // correccion: lo capturado pasa a varios items. Con "perdon", "mejor" o "corrijo" si corrige.
  // (revision 12-11) La imagen del mismo producto ("Este modelo, 10 unidades", "Son 15 de este") confirma o corrige la
  // cantidad: no es otro item.
  const mediaItem = hasMedia && Boolean(merged.cantidad || merged.cantidad_varios)
    && (stated.value !== undefined || quantity.value !== undefined) && !CORRECTION_RE.test(assertive)
    && !THIS_ONE_RE.test(comparable(assertive));
  mergeQuantity(merged, stated.value !== undefined || stated.several ? stated : quantity, stated, facts, adding || mediaItem);
  // [RESPALDO] El uso sale de lo que el cliente dice, no del nombre del producto ("PROYECTOR LED DE ESTADIO",
  // "Estaca LED COB 5W para jardin") ni de lo que Claude deduce (negocios 119, 197 y 206).
  // (revision 12-11) De un nombre generico ("focos LED para jardin") sale solo la familia: "para jardin" es el uso que
  // el cliente dio. El nombre de una ficha ("Estaca LED COB 5W para jardin") sale entero.
  const productNames = [claudeProd, merged.producto, state.captured.producto]
    .map((name) => (name && genericProduct(name) ? name.replace(/\s+(?:para|en)\s+.*$/i, '') : name));
  const noProduct = (text: string) => withoutProductNames(text, productNames);
  const claudeProy = claudeProject(claudeParsed, body, noProduct(facts), Boolean(question?.asks.includes('proyecto_o_uso')) && !merged.proyecto_o_uso);
  const ownProject = (text: string) => extractProyecto(withoutStorePlaces(noProduct(text)));
  keepOrChange(merged, 'proyecto_o_uso', fillWith(claudeProy, ownProject(assertive) ?? ownProject(affirmed)), backed(claudeProy, soleMatch(withoutStorePlaces(noProduct(base)), PROYECTO_RE), base));
  mergeComuna(merged, 'comuna_o_ciudad', claudeParsed.comuna_o_ciudad, {
    answering: Boolean(question?.asks.includes('comuna_o_ciudad')), company: mentionsCompany(body.slice(0, MAX_FACTS)), assertive, affirmed, base,
  });
  const nombreClaud = claudeText(claudeParsed.nombre) ?? claudeText(claudeParsed.empresa);
  if (nombreClaud) merged.nombre_o_empresa = nombreClaud;
  // [FIX-EMAIL-PARSER] normalizar correo aunque venga de claudeParsed
  // [CIERRE-HONESTO] el de Claude solo si es texto con forma de correo (una lista hacia caer el webhook)
  const correoFound = emailFrom(claudeParsed.correo) ?? extractEmail(body);
  if (correoFound) merged.correo = correoFound;
  // [RUT-VALIDO] Un RUT valido no se reemplaza (salvo el de persona por el de empresa); uno que
  // no calza, si (por el corregido).
  if (inspected.ambiguous) merged.rut_ambiguos = inspected.ambiguous;
  const rutFound = acceptedRut(merged, inspected.found);
  if (rutFound) {
    delete merged.rut_ambiguos;
    merged.rut = rutFound.rut;
    merged.rut_valido = rutFound.valido;
    if (rutFound.tipo) merged.rut_tipo = rutFound.tipo;
    else delete merged.rut_tipo;
  }

  // Calcular leadType - instalacion NO es senal B2B
  // [RUT-VALIDO] Solo un RUT valido de empresa es senal B2B (uno de persona, no).
  let leadType: LeadType = state.leadType;
  if (leadType !== 'B2B') {
    // Sin enlaces ni correos ("ana@empresa.cl" no es una empresa) ni los lugares de la tienda (b2bText).
    const isB2BSignal = B2B_SIGNAL_RE.test(b2bText(body)) || isBusinessRut(rutFound) || (claudeParsed.empresa && claudeParsed.empresa.length > 0);
    if (isB2BSignal) { leadType = 'B2B'; }
    else if (leadType === 'Unknown' && body.trim().length > 10) { leadType = 'B2C'; }
  }
  return { merged, leadType, rutToConfirm: Boolean(rutFound && !rutFound.valido && !state.rutRetryAsked), menuPick: quantity.menuPick };
}

/**
 * [CIERRE-HONESTO] Conversacion cerrada sin resultado de Pipedrive. Lo que llega se suma a lo
 * capturado (por ejemplo, el nombre y despues el correo) y, con correo, se registra la solicitud.
 * Si el correo ya estaba, un intento anterior no dejo resultado (se corto, o no termino dentro de
 * la espera de webhook.ts): se reintenta y se responde el cierre normal, nunca otro "ya derive".
 */
function continueClosedWithoutDeal(phone: string, state: FlowState, body: string, claudeParsed: ClaudeFields): FlowResult {
  const hadEmail = Boolean(flowEmail(state));
  const late = state.isInstallFlow
    ? { merged: mergeInstallFields(state.captured, body, claudeParsed, answersComuna(state)), leadType: state.leadType }
    : mergeProductFields(state, body, claudeParsed);
  const captureStatus = state.isInstallFlow ? computeInstallCaptureStatus(late.merged) : computeCaptureStatus(late.merged, late.leadType);
  const next: FlowState = { ...state, captured: late.merged, captureStatus, leadType: late.leadType };
  saveFlowState(phone, next);
  const registers = Boolean(flowEmail(next));
  if (registers) console.log('[flowEngine] conversacion cerrada con correo y sin negocio \u2014 registrando' + (hadEmail ? ' (reintento)' : ''));
  let reply = closedReply(next);
  if (registers) {
    if (hadEmail) reply = registeredClosing(next);
    else reply = next.isInstallFlow ? installClosingMsg(late.merged) : productClosingMsg(true, next.wantsHuman, next.leadType);
  }
  // [PREGUNTA] Se contesta lo que pregunta antes de pedir el correo o de cerrar (caso de las estacas: "Sabes cuando
  // demora el despacho" recibia otra vez la peticion del correo). Sin correo, el precio o la consulta tecnica piden
  // el correo con su texto aprobado.
  const kinds = questionKinds(body);
  const install = Boolean(next.isInstallFlow);
  const asksEmail = !registers && !state.deal && !install ? questionAsksEmail(kinds) : undefined;
  if (asksEmail) reply = withAnswers(questionAnswers(kinds, false, install), asksEmail);
  else reply = withAnswers(questionAnswers(kinds, registers, install), reply);
  return { reply, shouldCreateDeal: registers, shouldNotify: false, captureStatus, captured: late.merged, wantsHuman: next.wantsHuman, closedFlow: true };
}

/**
 * [RUT-VALIDO] Conversacion cerrada con el negocio registrado: un RUT valido que llega despues (el
 * corregido tras la repregunta, el que falto o el de la empresa en vez del personal) se suma al
 * negocio. webhook.ts usa el dealId guardado, aunque ya este ganado o perdido: nota
 * con el RUT y tarea para ventas. La respuesta es la misma de la conversacion cerrada.
 */
function lateRut(phone: string, state: FlowState, body: string): FlowResult | undefined {
  if (state.isInstallFlow) return undefined;
  const inspected = inspectRut(body, { asked: rutAsked(state) });
  if (inspected.ambiguous) {
    const captured = { ...state.captured, rut_ambiguos: inspected.ambiguous };
    saveFlowState(phone, { ...state, captured });
    return { reply: registeredClosing(state), shouldCreateDeal: true, shouldNotify: false, captureStatus: state.captureStatus, captured, wantsHuman: state.wantsHuman, closedFlow: true, rutUpdate: true };
  }
  const found = acceptedRut(state.captured, inspected.found);
  if (!found?.valido) return undefined;
  const captured: CapturedFields = { ...state.captured, rut: found.rut, rut_valido: true, rut_tipo: found.tipo };
  delete captured.rut_ambiguos;
  const leadType: LeadType = isBusinessRut(found) ? 'B2B' : state.leadType;
  const captureStatus = computeCaptureStatus(captured, leadType);
  const next: FlowState = { ...state, captured, captureStatus, leadType };
  saveFlowState(phone, next);
  console.log('[flowEngine] RUT valido despues del cierre \u2014 se suma al negocio registrado');
  return { reply: registeredClosing(next), shouldCreateDeal: true, shouldNotify: false, captureStatus, captured, wantsHuman: next.wantsHuman, closedFlow: true, rutUpdate: true };
}

/**
 * [REINICIO] El mensaje despues del cierre abre otro pedido: lo que antes era un pedido nuevo (looksLikeNewRequest),
 * salvo pedir un vendedor sin nombrar un producto con el negocio registrado, no nombrar producto ni cantidad ("quiero
 * ese articulo, como lo compro?") o nombrar el mismo producto ya capturado ("campana Ufo 100W ... 5700k" es la
 * "Luminaria UFO 100W" de antes, con otro color).
 */
function opensNewRequest(body: string, state: FlowState, claudeParsed: ClaudeFields): boolean {
  if (!looksLikeNewRequest(body)) return false;
  // Nombrar una cotizacion ("la nueva cotizacion para Quilicura") u otro proyecto ("mi nuevo proyecto") sigue la regla
  // anterior (PR 142, ronda 3), y un mensaje demasiado largo para leerlo entero tambien; "ya me cotizaron" habla de
  // la que ya existe.
  const plain = body.replace(/(?:https?:\/\/|www\.)\S*/gi, ' ').replace(EMAIL_RE_ALL, ' ');
  if (body.length > MAX_FACTS || QUOTE_WORD_RE.test(plain) || OTHER_ORDER_RE.test(plain)) return true;
  const captured = state.captured;
  const facts = maskNegated(factsText(body, claudeParsed));
  const claudeProd = claudeText(claudeParsed.producto);
  const named = [extractProducto(facts), ...itemsIn(facts), claudeProd && inMessage(claudeProd, facts) ? claudeProd : undefined]
    .filter((p): p is string => Boolean(p) && productWords(p as string).length > 0);
  const quantity = readQuantity(facts);
  // Sin negocio registrado, pedir un vendedor empieza otra conversacion como antes: alli lo atiende el atajo del
  // ejecutivo (wantsHuman), que registra con el correo siguiente.
  if (!named.length && (WANTS_HUMAN_RE.test(body) || EXECUTIVE_RE.test(body))) return state.deal !== 'registered';
  if (!named.length && quantity.value === undefined && !quantity.several) return false;
  if (!captured.producto || !named.length) return true;
  // El mismo producto: comparten una palabra del modelo que no es solo la familia ni una medida ("ufo"), sin otra
  // medida ("campanas UFO 200W" no es la "UFO 100W"; "reflectores 40W" no es el "panel 60x60 40W"), o todas sus
  // palabras ya estaban ("focos LED" otra vez).
  const own = productWords(captured.producto);
  const same = named.some((p) => {
    const words = productWords(p);
    if (words.every((w) => own.includes(w))) return true;
    return words.some((w) => own.includes(w) && !GENERIC_PRODUCT_STEMS.has(w) && !/\d/.test(w))
      && words.every((w) => !/\d/.test(w) || own.includes(w));
  });
  if (!same) return true;
  // (revision 12-11) El mismo producto con otra cantidad es otro pedido ("Ahora necesito 10 focos LED para la casa de
  // mi mama en Pirque"), como en main, salvo que corrija la que ya estaba ("Corrijo: son 10", "20 focos, no 12").
  const other = quantity.value !== undefined && captured.cantidad !== undefined && String(quantity.value) !== captured.cantidad;
  return other && !correctsCaptured(body, captured);
}

// [REINICIO] (revision 12-11) Despues del cierre, un dato ya registrado cambia solo si el mensaje lo corrige: con
// palabra de correccion ("corrijo", "perdon, son", "mejor", "en vez de"), con un "definitivamente", "en realidad" o
// "al final" (negocio 145), o negando el dato anterior ("20 focos LED, no 12"). "Gracias, mi otra casa esta en
// Pirque" o "son 3 dormitorios y el living" son comentarios.
const LATE_CORRECTION_RE = /(?<![a-zà-ü])(?:definitiv[a-z]*|en\s+realidad|al\s+final|finalmente|actualiz[a-z]*|modific[a-z]*|cambi[a-z]*|quise\s+decir|quer[ií]a\s+decir|me\s+confund[a-z]*)(?![a-zà-ü])/i;
function correctsCaptured(body: string, captured: CapturedFields): boolean {
  const text = body.slice(0, MAX_FACTS);
  if (CORRECTION_RE.test(text) || PRODUCT_SWITCH_RE.test(text) || LATE_CORRECTION_RE.test(text)) return true;
  const plain = comparable(text);
  return [captured.cantidad, captured.comuna_o_ciudad, captured.tipo_de_luz].some((value) => {
    if (!value) return false;
    const escaped = comparable(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?<![a-z0-9])no\\s+(?:son|eran|es|era|en|sea|sean)?\\s*' + escaped + '(?![a-z0-9])').test(plain);
  });
}

const OTHER_ORDER_RE = /(?<![a-z\u00e0-\u00fc])(?:nuev|otr)[oa]s?\s+(?:proyecto|obra|pedido|solicitud|requerimiento|compra)/i;
const QUOTE_WORD_RE = /cotizaci[o\u00f3]n|presupuesto|cotizar(?![a-z\u00e0-\u00fc])/i;
const LATE_FIELDS = ['producto', 'tipo_de_luz', 'cantidad', 'cantidad_varios', 'cantidad_unidad', 'proyecto_o_uso', 'comuna_o_ciudad', 'comunas_otras'] as const;
/**
 * [REINICIO] Conversacion cerrada con el negocio registrado: un dato que cambia o se completa (otro color, la
 * cantidad, la comuna) va al mismo negocio, como el RUT y el correo tardios (rutUpdate: nota y campos). Antes el
 * mensaje reiniciaba la conversacion, volvia a pedir la cantidad y perdia la comuna (negocios 144, 145 y 186).
 * Solo cuenta lo que este mensaje dice: un dato que Claude repite del historial no se escribe.
 */
function lateChange(phone: string, state: FlowState, body: string, claudeParsed: ClaudeFields, hasMedia: boolean): FlowResult | undefined {
  // Preguntar por el despacho ("¿Hacen envio a Rancagua?") no cambia la comuna ni otro dato.
  if (state.isInstallFlow || asksAboutDelivery(body)) return undefined;
  const question = /[?\u00bf]/.test(body);
  const { merged, leadType } = mergeProductFields(state, body, claudeParsed, hasMedia);
  const facts = factsText(body, claudeParsed);
  const captured: CapturedFields = { ...state.captured };
  const corrects = correctsCaptured(body, state.captured);
  // La cantidad y sus acompanantes (varios items, metros) se aplican juntos; las otras comunas, con la comuna.
  const filled = (field: typeof LATE_FIELDS[number]): boolean => {
    if (field === 'cantidad_varios' || field === 'cantidad_unidad') return Boolean(state.captured.cantidad || state.captured.cantidad_varios);
    if (field === 'comunas_otras') return Boolean(state.captured.comuna_o_ciudad);
    return state.captured[field] !== undefined && state.captured[field] !== '';
  };
  const applied = new Set<string>();
  let changed = false;
  for (const field of LATE_FIELDS) {
    const before = JSON.stringify(state.captured[field] ?? null);
    const after = JSON.stringify(merged[field] ?? null);
    if (before === after) continue;
    const value = merged[field];
    // Una comuna en una pregunta ("¿tienen sucursal en Concepcion?") no es la de la entrega.
    if (question && (field === 'comuna_o_ciudad' || field === 'comunas_otras')) continue;
    // El color o el uso que se llena con lo que Claude recuerda (sin decirlo en este mensaje) no cuenta.
    if ((field === 'tipo_de_luz' || field === 'proyecto_o_uso' || field === 'producto') && typeof value === 'string' && !sharesWord(value, facts) && !textLuz(facts)) continue;
    // (revision 12-11) Un dato ya registrado cambia solo con una correccion (correctsCaptured); uno vacio se completa.
    if (filled(field) && !corrects) continue;
    (captured as Record<string, unknown>)[field] = value;
    applied.add(field === 'cantidad_varios' || field === 'cantidad_unidad' ? 'cantidad' : field === 'comunas_otras' ? 'comuna_o_ciudad' : field);
    changed = true;
  }
  if (!changed) return undefined;
  // Solo las lineas de cambio de los datos que se aplicaron.
  const labels = [...applied].map((field) => KEPT_LABEL[field as KeptField]).filter(Boolean);
  const previous = state.captured.cambios ?? [];
  const added = (merged.cambios ?? []).filter((line) => !previous.includes(line) && labels.some((label) => line.startsWith(label + ':')));
  if (added.length) captured.cambios = [...previous, ...added].slice(-MAX_CAMBIOS);
  const captureStatus = computeCaptureStatus(captured, leadType);
  const next: FlowState = { ...state, captured, captureStatus, leadType };
  saveFlowState(phone, next);
  console.log('[flowEngine] dato nuevo despues del cierre \u2014 se suma al negocio registrado');
  return { reply: closedFollowUp(next, body), shouldCreateDeal: true, shouldNotify: false, captureStatus, captured, wantsHuman: next.wantsHuman, closedFlow: true, rutUpdate: true };
}

/**
 * [TRANSCRIPCION] Conversacion cerrada con el negocio registrado: un correo distinto del capturado
 * (el corregido despues del cierre) se suma al mismo negocio, como el RUT tardio: nota con el correo
 * nuevo, la linea de cambios y la conversacion hasta este mensaje. Antes quedaba solo en la
 * transcripcion, a la espera de un pedido nuevo. La persona de Pipedrive conserva el correo anterior.
 * Solo vale el correo escrito en este mensaje: Claude ve el historial y puede repetir uno anterior.
 */
function lateEmail(phone: string, state: FlowState, body: string, correcting: boolean): FlowResult | undefined {
  const field = state.isInstallFlow ? 'install_correo' : 'correo';
  const before = state.captured[field];
  // [TRANSCRIPCION] Un correo negado nunca se toma ("Mi correo no es X, es Y" es Y). Al corregir, el capturado es
  // el que se corrige ("cambiar X por Y"). Con varios correos y ninguno marcado ("el correcto es Y"), no cambia nada.
  let candidates = affirmedEmails(body);
  if (correcting && before) candidates = candidates.filter((c) => c.email !== before.toLowerCase());
  if (candidates.length > 1) candidates = candidates.filter((c) => c.marked);
  const email = candidates.length === 1 ? candidates[0].email : undefined;
  if (!email || email === before?.toLowerCase()) return undefined;
  const captured: CapturedFields = { ...state.captured, [field]: email };
  if (before) captured.cambios = [...(captured.cambios ?? []), 'Correo: antes ' + before + ', ahora ' + email].slice(-MAX_CAMBIOS);
  const next: FlowState = { ...state, captured };
  saveFlowState(phone, next);
  console.log('[flowEngine] correo nuevo despues del cierre - se suma al negocio registrado');
  return { reply: registeredClosing(next), shouldCreateDeal: true, shouldNotify: false, captureStatus: next.captureStatus, captured, wantsHuman: next.wantsHuman, closedFlow: true, rutUpdate: true };
}

/** Lo que webhook.ts sabe del mensaje. hasMedia: trae una imagen o un archivo (con su texto). */
// [SIN-REPETIR] lastReply: la ultima respuesta que recibio el cliente (webhook.ts la toma del historial).
export interface FlowSignals { wantsHuman: boolean; qualifiesForDeal: boolean; hasMedia?: boolean; lastReply?: string }

export function processFlowStep(
  phone: string,
  body: string,
  claudeParsed: ClaudeFields,
  signals: FlowSignals,
): FlowResult {
  const before = flowStates.get(phone);
  const lastReply = typeof signals.lastReply === 'string' ? signals.lastReply : undefined;
  const { question, ...stepResult } = flowStep(phone, body, claudeParsed, signals);
  let result = explainOwnEmail(stepResult, body);
  const state = flowStates.get(phone);
  // Abierta antes, o el mensaje empezo otro pedido (la conversacion cerrada siguio abierta).
  const open = !before || before.stage !== 'closed' || !result.closedFlow;
  // [PREGUNTA] Con la conversacion abierta, la ubicacion, el despacho y (con correo) el precio o la consulta tecnica
  // se contestan antes de la respuesta del flujo, que sigue con el dato que falta. Las conversaciones cerradas y la
  // instalacion lo contestan en su rama.
  if (open && state && !state.isInstallFlow) {
    const reply = withAnswers(questionAnswers(questionKinds(body), Boolean(state.captured.correo), false), result.reply);
    if (reply !== result.reply) result = { ...result, reply };
  }
  // [SIN-REPETIR] (revision 12-11) Cerrada sin negocio ni correo, el texto A y MSG4_INSTALL_NO_EMAIL se repiten como en
  // main: es la decision pendiente del dueno (T-X1b), sin un texto aprobado para alternar.
  const closedWithoutDeal = Boolean(result.closedFlow && state?.stage === 'closed' && !state.deal);
  if (!closedWithoutDeal) result = notRepeated(result, lastReply);
  // [RUT-VALIDO] Se anota si esta respuesta pide el RUT: vale solo para el mensaje siguiente.
  // [CANTIDAD] Tambien que pregunta hizo (sin pregunta, ninguna: un numero suelto no es cantidad).
  if (state) saveFlowState(phone, { ...state, rutAskedLast: asksForRut(result.reply), lastQuestion: question ?? null });
  return result;
}

// [SIN-REPETIR] Si la respuesta es igual a la anterior, otro texto ya aprobado que dice lo mismo (caso de las
// estacas: tres veces seguidas la misma peticion del correo). El saludo, el texto B y el registro pendiente no
// cambian. Si no hay otro texto para esa respuesta, se repite.
const ALTERNATE_REPLY: Record<string, string> = {
  [MSG_NEED_EMAIL]: MSG_EMAIL_SHORT,
  [MSG_EMAIL_SHORT]: MSG_NEED_EMAIL,
  [MSG4_INSTALL_NO_EMAIL]: MSG_NEED_EMAIL,
  [MSG_Q_PRICE]: MSG_Q_TECH,
  [MSG_Q_TECH]: MSG_NEED_EMAIL,
  // (revision 12-11) Con el correo ya dado: "¿tienen stock?" y "¿y cuanto cuestan?" seguidas.
  [MSG_Q_PRICE_HAS_EMAIL]: MSG_Q_TECH_HAS_EMAIL,
  [MSG_Q_TECH_HAS_EMAIL]: MSG_REGISTERED_SHORT,
  [MSG_WAIT]: MSG_REGISTERED_SHORT,
  [MSG_WAIT_DELIVERY]: MSG_REGISTERED_SHORT,
  [MSG_REGISTERED_SHORT]: MSG_WAIT,
};
function notRepeated(result: FlowResult, lastReply: string | undefined): FlowResult {
  if (!lastReply || result.reply !== lastReply) return result;
  for (const [text, other] of Object.entries(ALTERNATE_REPLY)) {
    if (result.reply === text) return { ...result, reply: other };
    if (result.reply.endsWith('\n\n' + text)) return { ...result, reply: result.reply.slice(0, -text.length) + other };
  }
  return result;
}

/**
 * [CORREO-PROPIO] Si el cliente dio un correo de eLIGHTS (no uno que publica el bot) y la respuesta le vuelve a
 * pedir el correo, se le dice por que no sirve: el texto A cambia por MSG_OWN_EMAIL y otra pregunta que pide el
 * correo lleva la nota antes. Nunca cambia que se registra ni el negocio.
 */
function explainOwnEmail(result: FlowResult, body: string): FlowResult {
  if (!offersOwnEmail(body)) return result;
  if (result.reply === MSG_NEED_EMAIL || result.reply === MSG_NEED_EMAIL_AND_CONTEXT) return { ...result, reply: MSG_OWN_EMAIL };
  if (/\bcorreo\b/i.test(result.reply) && !result.shouldCreateDeal) return { ...result, reply: OWN_EMAIL_NOTE + '\n\n' + result.reply };
  return result;
}

/**
 * [CANTIDAD] webhook.ts responde MSG_MEDIA sin pasar por el flujo: su pregunta (producto, proyecto
 * y cantidad aproximada, sin lista) queda anotada igual, para el mensaje siguiente.
 */
export function recordMediaReply(phone: string): void {
  const state = getFlowState(phone);
  const asks = [...missingStage1(state.captured).filter((m) => m !== 'tipo de luz preferida'), ...(state.captured.proyecto_o_uso ? [] : ['espacio o proyecto de uso'])];
  saveFlowState(phone, { ...state, rutAskedLast: false, lastQuestion: askedIn(asks, 0) });
}

/** [CANTIDAD] webhook.ts respondio sin el flujo (el paso fallo): esa respuesta no pregunto nada. */
export function recordNoQuestion(phone: string): void {
  const state = flowStates.get(phone);
  if (state) saveFlowState(phone, { ...state, rutAskedLast: false, lastQuestion: null });
}

/**
 * [COMUNA] La ultima pregunta del bot pedia la comuna: la lista de instalacion, si todavia le faltaba
 * (con "una casa en Lampa" pide solo el nombre y el correo: "Soy Ana Prueba de Maipu" no contesta la
 * comuna), o MSG2.
 */
function answersComuna(state: FlowState): boolean {
  if (state.stage === 'install_capture') return !state.captured.install_comuna;
  return Boolean(lastQuestionOf(state)?.asks.includes('comuna_o_ciudad'));
}

/**
 * [CANTIDAD] La ultima pregunta del bot. Un estado guardado antes de este cambio no la trae: se
 * deduce de la etapa (el saludo o la repregunta de la etapa 1, MSG2 o MSG3).
 */
function lastQuestionOf(state: FlowState): LastQuestion | null {
  if (state.lastQuestion !== undefined) return state.lastQuestion;
  // Despues de pedir el correo para el ejecutivo no se sabe que se pregunto: nunca la cantidad.
  if (state.humanEmailAsked) return askedIn(['correo de contacto'], 0);
  if (state.stage === 'stage1') {
    if (state.repreguntasStage1 === 0) return greetQuestion(state.captured);
    const missing = missingStage1(state.captured);
    return askedIn(missing, missing.length > 1 ? missing.length : 0);
  }
  const missing = state.stage === 'stage2' ? missingStage2(state.captured) : state.stage === 'stage3' ? missingStage3(state.captured, state.leadType) : [];
  return missing.length ? askedIn(missing, missing.length === 2 ? 2 : 0) : null;
}

function flowStep(
  phone: string,
  body: string,
  claudeParsed: ClaudeFields,
  signals: FlowSignals,
): StepResult {
  const state = getFlowState(phone);

  if (state.stage === 'closed') {
    const correctingRut = state.deal === 'registered' && /\brut\b/i.test(body) && /\b(?:corregir|corrijo|correcci[o\u00f3]n|correcto|actualizar|cambiar|cambio|modificar)\b/i.test(body);
    const correctingEmail = state.deal === 'registered' && correctsEmail(body);
    // [TRANSCRIPCION] Un pedido nuevo explicito gana a las correcciones; las correcciones, a un pedido nuevo que
    // solo lo parece ("Necesito corregir mi correo: X" dice "necesito").
    const explicit = explicitNewRequest(body);
    // [REINICIO] Solo otro pedido abre otra conversacion: pedir un vendedor (negocio 144), cambiar el color del mismo
    // producto (145) o preguntar como comprar lo cotizado (186) siguen en la misma.
    const newRequest = explicit
      || (!correctingRut && !correctingEmail && ((opensNewRequest(body, state, claudeParsed) && !asksAboutExistingQuote(body, state.captured, claudeParsed)) || installRequested(maskNegated(body))));
    // [CIERRE-HONESTO] Sin negocio, un mensaje con correo se suma a lo capturado y registra la
    // solicitud aunque diga "necesito" o "quiero" (antes eso reiniciaba y perdia lo capturado).
    // [TRANSCRIPCION] Salvo un pedido nuevo explicito ("Otro pedido: ... Mi correo es X"): empieza otra conversacion
    // con ese correo, tambien si la anterior tenia correo y todavia no hay resultado de Pipedrive (decision 4 del
    // dueno; R10 de la ronda 3: antes se mezclaba con el pedido anterior). Lo capturado en la anterior no se
    // reintenta aparte.
    if (!state.deal && !explicit && (!newRequest || messageEmail(body, claudeParsed))) {
      return continueClosedWithoutDeal(phone, state, body, claudeParsed);
    }
    if (!newRequest) {
      // [TRANSCRIPCION] El RUT y el correo tardios van al mismo negocio; si llegan juntos, el correo
      // parte del estado que ya trae el RUT.
      const lateRutResult = state.deal === 'registered' ? lateRut(phone, state, body) : undefined;
      const late = state.deal === 'registered'
        ? lateEmail(phone, lateRutResult ? getFlowState(phone) : state, body, correctingEmail) ?? lateRutResult
          ?? lateChange(phone, state, body, claudeParsed, Boolean(signals.hasMedia))
        : undefined;
      if (late) return late;
      const forClaudio = asksForClaudio(state, body);
      return {
        reply: closedFollowUp(state, body),
        shouldCreateDeal: forClaudio,
        ...(forClaudio ? { rutUpdate: true } : {}),
        shouldNotify: false,
        captureStatus: state.captureStatus,
        captured: state.captured,
        wantsHuman: state.wantsHuman,
        closedFlow: true,
      };
    }
    console.log('[flowEngine] nuevo requerimiento, reset; caracteres=' + body.length);
    clearFlowState(phone);
    return flowStep(phone, body, claudeParsed, signals);
  }

  // [EXECUTIVE-RE] Guard
  // [GUARDAR-ANTES] Los datos del mensaje se guardan antes de responder: "Claudio me dijo que eran 25 unidades para
  // Maipu" ya no pierde la cantidad ni la comuna.
  if (EXECUTIVE_RE.test(body) && !COMMERCIAL_INTENT_RE.test(body)) {
    const kept = state.isInstallFlow ? { merged: state.captured, leadType: state.leadType } : mergeProductFields(state, body, claudeParsed, Boolean(signals.hasMedia));
    saveFlowState(phone, { ...state, captured: kept.merged, leadType: kept.leadType });
    return {
      reply: MSG_EXECUTIVE,
      shouldCreateDeal: false,
      shouldNotify: false,
      captureStatus: computeCaptureStatus(kept.merged, kept.leadType),
      captured: kept.merged,
      wantsHuman: false,
      closedFlow: false,
    };
  }
  // ---------------------------------------------------------------------------
  // [INSTALL-FLOW] Deteccion de intencion de instalacion
  // Regla de negocio: sin correo no podemos cotizar.
  // No derivar hasta tener nombre + correo + comuna + tipoProyecto.
  // ---------------------------------------------------------------------------
  const midProducts = state.stage === 'stage2' || state.stage === 'stage3' || Boolean(state.captured.producto);
  const intentText = maskNegated(body);
  const isInstallIntent = midProducts ? installRequestedMidProducts(intentText) : installRequested(intentText);
  const isAlreadyInstallFlow = state.isInstallFlow || state.stage === 'install_capture';

  if (isInstallIntent && !isAlreadyInstallFlow) {
    const updatedCaptured = mergeInstallFields(state.captured, body, claudeParsed, answersComuna(state));
    const { missingRequired } = getMissingInstallFields(updatedCaptured);
    if (missingRequired.length === 0) {
      const captureStatus = computeInstallCaptureStatus(updatedCaptured);
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, isInstallFlow: true, leadType: 'B2C' });
      console.log('[flowEngine] install_capture completo en primer mensaje');
      return { reply: MSG4_INSTALL, shouldCreateDeal: true, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const reply = buildInstallCaptureMsg(updatedCaptured);
    saveFlowState(phone, { ...state, stage: 'install_capture', captured: updatedCaptured, repreguntasInstall: 1, isInstallFlow: true, leadType: 'B2C' });
    console.log('[flowEngine] install_capture iniciado, missing: ' + missingRequired.join(', '));
    return { reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: updatedCaptured, wantsHuman: false, closedFlow: false };
  }

  if (state.stage === 'install_capture') {
    const updatedCaptured = mergeInstallFields(state.captured, body, claudeParsed, answersComuna(state));
    const { missingRequired } = getMissingInstallFields(updatedCaptured);
    if (missingRequired.length === 0) {
      const captureStatus = computeInstallCaptureStatus(updatedCaptured);
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, isInstallFlow: true });
      console.log('[flowEngine] install_capture completo \u2014 derivando');
      return { reply: MSG4_INSTALL, shouldCreateDeal: true, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const repreg = state.repreguntasInstall + 1;
    if (repreg > 3) {
      const captureStatus: CaptureStatus = updatedCaptured.install_correo ? 'partial' : 'incomplete';
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, repreguntasInstall: repreg, isInstallFlow: true });
      console.log('[flowEngine] install_capture timeout \u2014 cerrando con status=' + captureStatus);
      return { reply: installClosingMsg(updatedCaptured), shouldCreateDeal: updatedCaptured.install_correo ? true : false, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const reply = buildInstallCaptureMsg(updatedCaptured);
    saveFlowState(phone, { ...state, stage: 'install_capture', captured: updatedCaptured, repreguntasInstall: repreg, isInstallFlow: true });
    console.log('[flowEngine] install_capture en curso, missing: ' + missingRequired.join(', '));
    return { reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: updatedCaptured, wantsHuman: false, closedFlow: false };
  }

  // ---------------------------------------------------------------------------
  // FIN INSTALL-FLOW - flujo normal de productos LED
  // ---------------------------------------------------------------------------
  // [FIX-WANTSHUMAN] NO activar wantsHuman si el mensaje contiene intencion comercial
  const hasCommercialIntent = COMMERCIAL_INTENT_RE.test(body);
  const wantsHuman = state.wantsHuman || (!hasCommercialIntent && (signals.wantsHuman || Boolean(claudeParsed.wantsHuman))) || WANTS_HUMAN_RE.test(body);

  if (state.stage === 'stage1' && GREET_ONLY.test(body.trim())) {
    saveFlowState(phone, { ...state, wantsHuman });
    return { reply: MSG1, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: state.captured, wantsHuman, closedFlow: false, question: greetQuestion(state.captured) };
  }

  // PASO 1: MERGE
  const { merged, leadType: currentLeadType, rutToConfirm, menuPick } = mergeProductFields(state, body, claudeParsed, Boolean(signals.hasMedia));

  // [FIX-PRIORITY] PASO 2: wantsHuman path - REQUIERE correo antes de derivar
  // [FIX-EMAIL-GATE] Si el usuario quiere ejecutivo pero no tiene correo, pedirlo primero
  // [CIERRE-HONESTO] Lo pide una sola vez y sigue en la etapa en que estaba (antes saltaba a
  // stage3 y repetia el pedido en cada mensaje). Despues sigue el flujo normal.
  if (wantsHuman && !hasCommercialIntent) {
    if (merged.correo) {
      // Con correo: puede derivar (webhook.ts confirma el negocio antes de decir "ya derive")
      const captureStatus = computeCaptureStatus(merged, currentLeadType);
      saveFlowState(phone, { ...state, stage: 'closed', captured: merged, wantsHuman: true, captureStatus, leadType: currentLeadType });
      return { reply: MSG_HUMAN, shouldCreateDeal: true, shouldNotify: false, captureStatus, captured: merged, wantsHuman: true, closedFlow: true };
    }
    if (!state.humanEmailAsked) {
      // Sin correo: no podemos derivar ni crear deal - pedir correo
      const hasAnyContext = Boolean(merged.producto) || Boolean(merged.proyecto_o_uso);
      const reply = hasAnyContext ? MSG_NEED_EMAIL : MSG_NEED_EMAIL_AND_CONTEXT;
      saveFlowState(phone, { ...state, captured: merged, wantsHuman: true, leadType: currentLeadType, humanEmailAsked: true });
      console.log('[flowEngine] wantsHuman sin correo \u2014 pidiendo correo antes de derivar');
      return { reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: merged, wantsHuman: true, closedFlow: false, question: askedIn(hasAnyContext ? ['correo de contacto'] : ['producto', 'correo de contacto'], 0) };
    }
  }
  // [RUT-VALIDO] Un RUT que no calza se pide de nuevo una sola vez, en la etapa en que estaba. Si
  // llega otra vez sin calzar, queda marcado como invalido y el flujo sigue.
  if (rutToConfirm) {
    saveFlowState(phone, { ...state, captured: merged, wantsHuman, leadType: currentLeadType, rutRetryAsked: true });
    console.log('[flowEngine] RUT con digito verificador que no calza \u2014 se pide de nuevo una vez');
    return { reply: MSG_RUT_INVALID, shouldCreateDeal: false, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType), captured: merged, wantsHuman, closedFlow: false, question: askedIn(['RUT de la empresa'], 0) };
  }
  // [CASO-1] Un numero suelto despues de la lista numerada de la etapa 1 se aclara: no es la
  // cantidad ni hace avanzar la etapa (antes, con el "1" como cantidad, saltaba a la comuna y el
  // color no se volvia a preguntar).
  if (menuPick !== undefined && state.stage === 'stage1') {
    saveFlowState(phone, { ...state, captured: merged, wantsHuman, leadType: currentLeadType });
    console.log('[flowEngine] numero suelto despues de una lista \u2014 se pide aclarar');
    return { reply: menuClarifyMsg(menuPick), shouldCreateDeal: false, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType), captured: merged, wantsHuman, closedFlow: false, question: askedIn(missingStage1(merged), 0) };
  }
  // [CASO-1] En las etapas 2 y 3, un numero suelto despues de su lista (MSG2, MSG3) repite la misma
  // pregunta, ya aprobada, una vez y sin avanzar. La lista sigue anotada (es la que se muestra); un
  // segundo numero sigue el flujo, como cualquier respuesta sin datos.
  if (menuPick !== undefined && (state.stage === 'stage2' || state.stage === 'stage3') && state.menuRepeatedIn !== state.stage) {
    const again = state.stage === 'stage2' ? MSG2 : state.leadType === 'B2B' ? MSG3_B2B : MSG3_B2C;
    saveFlowState(phone, { ...state, captured: merged, wantsHuman, leadType: currentLeadType, menuRepeatedIn: state.stage });
    console.log('[flowEngine] numero suelto despues de la lista de la ' + state.stage + ' \u2014 se repite la pregunta');
    return { reply: again, shouldCreateDeal: false, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType), captured: merged, wantsHuman, closedFlow: false, question: lastQuestionOf(state) ?? undefined };
  }

  // [PREGUNTA] Precio, stock o una consulta tecnica sin correo: el texto aprobado que pide el correo, sin avanzar de
  // etapa (los datos del mensaje quedan guardados). Reemplaza a FIX-2 ("Con gusto te ayudo con los precios..."):
  // pedir precio sin producto tambien cuenta. La ubicacion y el despacho se contestan antes de la respuesta del
  // flujo (processFlowStep).
  const kinds = questionKinds(body);
  if (PRICE_INTENT_RE.test(body) && !merged.producto) kinds.add('precio');
  const asksEmail = !merged.correo ? questionAsksEmail(kinds) : undefined;
  if (asksEmail) {
    saveFlowState(phone, { ...state, captured: merged, wantsHuman, leadType: currentLeadType });
    const reply = withAnswers(questionAnswers(kinds, false, false), asksEmail);
    console.log('[flowEngine] pregunta de precio o tecnica sin correo \u2014 se pide el correo');
    return { reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType), captured: merged, wantsHuman, closedFlow: false, question: askedIn(['correo de contacto'], 0) };
  }

  // PASO 3: AVANCE MULTI-STAGE
  let repreg1 = state.repreguntasStage1;
  let repreg2 = state.repreguntasStage2;
  let repreg3 = state.repreguntasStage3;
  let currentStage: FlowStage = state.stage;
  const baseShouldCreate = signals.qualifiesForDeal || EXPLICIT_QUOTE.test(body);

  while (currentStage === 'stage1' || currentStage === 'stage2' || currentStage === 'stage3') {
    if (currentStage === 'stage1') {
      const missing = missingStage1(merged);
      if (missing.length === 0) { currentStage = 'stage2'; continue; }
      const missingCritical = missing.filter((m) => m === 'producto' || m === 'cantidad de unidades');
      if (repreg1 >= 1 && missingCritical.length >= 2) {
        // [CIERRE-HONESTO] Sin correo no se cierra sin haber pedido los datos de contacto (etapa 3)
        if (!merged.correo && repreg3 === 0) { currentStage = 'stage3'; continue; }
        const cs = computeCaptureStatus(merged, currentLeadType);
        const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : 'incomplete';
        // [FIX-EMAIL-GATE] Solo crear deal si hay correo
        const canCreateDeal = canRegister(merged);
        saveFlowState(phone, { ...state, stage: 'closed', captured: merged, captureStatus: finalStatus, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType });
        console.log('[flowEngine] closePartial stage1, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ? 's\u00ed' : 'no'));
        return { reply: productClosingMsg(canCreateDeal, wantsHuman, currentLeadType), shouldCreateDeal: canCreateDeal, shouldNotify: false, captureStatus: finalStatus, captured: merged, wantsHuman, closedFlow: true };
      }
      if (repreg1 >= 1 && missingCritical.length < 2) { currentStage = 'stage2'; continue; }
      repreg1 += 1;
      saveFlowState(phone, { ...state, stage: 'stage1', captured: merged, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType });
      return { reply: buildRepregunta1(missing, merged), shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: merged, wantsHuman, closedFlow: false, question: askedIn(missing, missing.length > 1 ? missing.length : 0) };
    }

    if (currentStage === 'stage2') {
      const missing = missingStage2(merged);
      if (missing.length === 0) { currentStage = 'stage3'; continue; }
      if (repreg2 >= 1) {
        // [CIERRE-HONESTO] Sin correo no se cierra sin haber pedido los datos de contacto (etapa 3)
        if (!merged.correo && repreg3 === 0) { currentStage = 'stage3'; continue; }
        const cs = computeCaptureStatus(merged, currentLeadType);
        const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : 'partial';
        // [FIX-EMAIL-GATE] Solo crear deal si hay correo
        const canCreateDeal = canRegister(merged);
        saveFlowState(phone, { ...state, stage: 'closed', captured: merged, captureStatus: finalStatus, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType });
        console.log('[flowEngine] closePartial stage2, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ? 's\u00ed' : 'no'));
        return { reply: productClosingMsg(canCreateDeal, wantsHuman, currentLeadType), shouldCreateDeal: canCreateDeal, shouldNotify: false, captureStatus: finalStatus, captured: merged, wantsHuman, closedFlow: true };
      }
      repreg2 += 1;
      saveFlowState(phone, { ...state, stage: 'stage2', captured: merged, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType });
      // [CASO-1] Lo que falto de la etapa 1 (el color, la cantidad) se pregunta junto con esto.
      const asked2 = [...missingStage1(merged), ...missing];
      const replyS2 = asked2.length === 2 && missing.length === 2 ? MSG2 : buildRepregunta2(asked2);
      return { reply: replyS2, shouldCreateDeal: false  /* [FIX-EMAIL-GATE] no crear deal sin correo */, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType) /* [FIX-CS1] was hardcoded 'partial' */, captured: merged, wantsHuman, closedFlow: false, question: askedIn(asked2, replyS2 === MSG2 ? 2 : 0) };
    }
    if (currentStage === 'stage3') {
      const missing = missingStage3(merged, currentLeadType);
      if (missing.length === 0) {
        const cs = computeCaptureStatus(merged, currentLeadType);
        saveFlowState(phone, { ...state, stage: 'closed', captured: merged, captureStatus: cs, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType });
        return { reply: productClosingMsg(true, wantsHuman, currentLeadType), shouldCreateDeal: true, shouldNotify: false, captureStatus: cs, captured: merged, wantsHuman, closedFlow: true };
      }
      if (repreg3 >= 1) {
        const cs = computeCaptureStatus(merged, currentLeadType);
        const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : 'partial';
        saveFlowState(phone, { ...state, stage: 'closed', captured: merged, captureStatus: finalStatus, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType });
        console.log('[flowEngine] closePartial stage3, status=' + finalStatus + ', correo=' + (merged.correo ? 's\u00ed' : 'no'));
        const canCreate3 = canRegister(merged);  // [FIX-EMAIL-GATE] solo crear si hay correo
        return { reply: productClosingMsg(canCreate3, wantsHuman, currentLeadType), shouldCreateDeal: canCreate3, shouldNotify: false, captureStatus: finalStatus, captured: merged, wantsHuman, closedFlow: true };
      }
      // [CASO-1] Si la etapa 2 no pregunto nada (ya estaba completa), lo que falto de la etapa 1 se
      // pregunta aqui, una vez.
      const asked3 = [...(repreg2 === 0 && repreg3 === 0 ? missingStage1(merged) : []), ...missing];
      repreg3 += 1;
      saveFlowState(phone, { ...state, stage: 'stage3', captured: merged, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType });
      const replyS3 = asked3.length === 2 && missing.length === 2 ? (currentLeadType === 'B2B' ? MSG3_B2B : MSG3_B2C) : buildRepregunta3(asked3, currentLeadType);
      return { reply: replyS3, shouldCreateDeal: false  /* [FIX-EMAIL-GATE] no crear deal sin correo en stage3 */, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType) /* [FIX-CS2] was hardcoded 'partial' */, captured: merged, wantsHuman, closedFlow: false, question: askedIn(asked3, asked3.length === 2 && missing.length === 2 ? 2 : 0) };
    }
    break;
  }

  // Salida de respaldo (no deberia alcanzarse): sin negocio, nunca "quedo registrada".
  return { reply: MSG_NEED_EMAIL, shouldCreateDeal: false, shouldNotify: false, captureStatus: state.captureStatus, captured: merged, wantsHuman, closedFlow: true };
}

// [CANTIDAD] Que dato pide cada item de las preguntas (las etiquetas de missingStage1/2/3).
const ASKED_FIELD: Record<string, AskedField> = {
  'producto': 'producto',
  'tipo de luz preferida': 'tipo_de_luz',
  'cantidad de unidades': 'cantidad',
  'espacio o proyecto de uso': 'proyecto_o_uso',
  'comuna o ciudad de instalacion': 'comuna_o_ciudad',
  'RUT de la empresa': 'rut',
  'correo de contacto': 'correo',
  'nombre': 'nombre',
};
const STAGE1_FIELDS = ['producto', 'tipo de luz preferida', 'cantidad de unidades'];
function askedIn(items: string[], listLength: number): LastQuestion {
  return { asks: items.map((item) => ASKED_FIELD[item]).filter(Boolean), listLength };
}
/** [CANTIDAD] MSG1 muestra la lista de 3, pero solo pide lo que falta (un "20" no pisa la cantidad ya dada). */
function greetQuestion(captured: CapturedFields): LastQuestion {
  return { asks: askedIn(missingStage1(captured), 0).asks, listLength: STAGE1_FIELDS.length };
}

function missingStage1(f: CapturedFields): string[] {
  const m: string[] = [];
  if (!f.producto) m.push('producto');
  if (!f.tipo_de_luz) m.push('tipo de luz preferida');
  if (!f.cantidad && !f.cantidad_varios) m.push('cantidad de unidades');
  return m;
}

function missingStage2(f: CapturedFields): string[] {
  const m: string[] = [];
  if (!f.proyecto_o_uso) m.push('espacio o proyecto de uso');
  if (!f.comuna_o_ciudad) m.push('comuna o ciudad de instalacion');
  return m;
}

function missingStage3(f: CapturedFields, leadType: LeadType): string[] {
  const m: string[] = [];
  if (leadType === 'B2B') {
    if (!f.rut) m.push('RUT de la empresa');
    if (!f.correo) m.push('correo de contacto');
  } else {
    if (!f.nombre_o_empresa) m.push('nombre');
    if (!f.correo) m.push('correo de contacto');
  }
  return m;
}
function articleFor(proyecto: string): string {
  const p = proyecto.toLowerCase().trim();
  const femeninos = /^(terraza|oficina|habitaci[o\u00f3]n|cocina|bodega|tienda|sala|fabrica|f[a\u00e1]brica|nave industrial|faena|planta|casa)/;
  const femeninoPlural = /^(ba[\u00f1n]os)/;
  if (femeninoPlural.test(p)) return 'los';
  if (femeninos.test(p)) return 'la';
  return 'el';
}

function buildRepregunta1(missing: string[], captured: CapturedFields = {}): string {
  const hints: string[] = [];
  if (captured.proyecto_o_uso) { const art = articleFor(captured.proyecto_o_uso); hints.push(art + ' ' + captured.proyecto_o_uso); }
  // [LUZ] Sin "luz luz" cuando el color ya trae la palabra ("luz cálida").
  if (captured.tipo_de_luz) hints.push(/^luz\b/i.test(captured.tipo_de_luz) ? captured.tipo_de_luz : 'luz ' + captured.tipo_de_luz);
  const intro = hints.length > 0 ? 'Entendido, para ' + hints.join(', ') + ' podemos orientarte bien.' : 'Gracias por tu mensaje, podemos ayudarte.';
  if (missing.length === 1) return intro + ' Solo necesito saber ' + missing[0] + ' para continuar.';
  const items = missing.map((x, i) => i + 1 + ') ' + capitalize(x));
  return intro + ' Para recomendarte las opciones adecuadas, necesito:\n' + items.join('\n') + '\n\nMe los puedes indicar?';
}

function buildRepregunta2(missing: string[]): string {
  if (missing.length === 1) return 'Casi listo. Solo me falta saber: ' + missing[0] + '. Me lo puedes indicar?';
  return 'Casi listo. Solo me falta saber:\n' + missing.map((x) => '- ' + x).join('\n') + '\n\nMe los puedes indicar?';
}

function buildRepregunta3(missing: string[], leadType: LeadType): string {
  if (missing.length === 1) {
    const campo = missing[0];
    if (campo === 'RUT de la empresa') return 'Para registrar tu solicitud necesito el RUT de la empresa.';
    if (campo === 'correo de contacto') return MSG_EMAIL_SHORT;
    if (campo === 'nombre') return 'Para registrar tu solicitud necesito tu nombre.';
    return 'Para registrar tu solicitud necesito tu ' + campo + '.';
  }
  return 'Para registrar tu solicitud necesito:\n' + missing.map((x) => '- ' + x).join('\n') + '\n\nMe los puedes indicar?';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// [INSTALL-FLOW] CaptureStatus para flujo de instalacion
function computeInstallCaptureStatus(f: CapturedFields): CaptureStatus {
  const requiredOk = Boolean(f.install_nombre) && Boolean(f.install_correo) && Boolean(f.install_comuna) && Boolean(f.install_tipo_proyecto);
  if (requiredOk) return 'complete';
  if (f.install_correo) return 'partial';
  return 'incomplete';
}

function computeCaptureStatus(f: CapturedFields, leadType: LeadType = 'Unknown'): CaptureStatus {
  const contactOk = leadType === 'B2B' ? Boolean(f.rut && f.rut_valido && f.correo) : Boolean(f.nombre_o_empresa && f.correo);
  const baseFields = [f.producto, f.tipo_de_luz, f.cantidad || f.cantidad_varios, f.proyecto_o_uso, f.comuna_o_ciudad];
  const baseFilled = baseFields.filter(Boolean).length;
  if (baseFilled >= 5 && contactOk) return 'complete';
  if (baseFilled >= 2 && f.correo) return 'partial';  // [FIX-EMAIL-GATE] requiere correo para partial
  return 'incomplete';
}
