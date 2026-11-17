// api/_lib/whatsapp/flowEngine.ts
// shouldNotify es siempre false aqui - la regla real vive en webhook.ts.
import { inspectRut, isBusinessRut, removeRuts, rutRange } from './rutCapture.js';
import type { RutFound, RutTipo } from './rutCapture.js';
import { itemPairs, itemsIn, mentionsQuantity, readQuantity, spelledQuantities, withoutNonQuantities } from './quantity.js';
import type { QuantityRead } from './quantity.js';
import { findComunaMentions, findComunas, isCommonWordComuna, mentionsCompany, officialComuna } from './comunas.js';
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
  // [ARCHIVOS] Date.now() del ultimo mensaje con imagenes o archivos. Si el siguiente llega antes de MEDIA_BURST_MS,
  // es de la misma rafaga y ya tuvo el aviso MSG_MEDIA_NOTICE (no se repite). Sin la propiedad: no hubo archivos.
  lastMediaAt?: number;
  // [RESUMEN] Fase 3B (dueno, 16-11-2026): Date.now() del ultimo resumen ("Te resumo: ... \u00bfEst\u00e1 bien?") y cuantos
  // se mostraron en la conversacion: el del registro y, a lo mas, uno corregido. Cambian juntos (stateStore, FIELD_GROUPS).
  summaryAt?: number;
  summaryShown?: number;
}

export type AskedField = 'producto' | 'tipo_de_luz' | 'cantidad' | 'proyecto_o_uso' | 'comuna_o_ciudad' | 'nombre' | 'rut' | 'correo';
export interface LastQuestion {
  asks: AskedField[];
  /** Items de su lista numerada "1) 2) 3)" (0 si no tenia). */
  listLength: number;
  /** [RESUMEN] La respuesta fue el resumen (o MSG_SUMMARY_FIX): el mensaje siguiente lo confirma o lo corrige. */
  summary?: true;
  /** [RESUMEN] La respuesta fue MSG_SUMMARY_FIX: un segundo "no" recibe el cierre (MSG4). */
  summaryFix?: true;
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
  // [RESUMEN] El dato que corrige o suma al contestar el resumen va al mismo negocio (nota y campos) sin otro aviso a
  // ventas: ya tuvo el del registro, que fue en el turno del resumen.
  quietUpdate?: boolean;
}

/** [CANTIDAD] Paso del flujo con la pregunta que hace su respuesta (processFlowStep la guarda). */
type StepResult = FlowResult & { question?: LastQuestion };

// [COPY-v3] Mensaje inicial
// [TILDES] Propuesta aprobada por el dueno (11-11-2026), fila "Tildes": "Corregir la ortografia en todos los mensajes
// sin cambiar lo que dicen". Solo tildes y los signos de apertura; las palabras no cambian. Todo texto fijo al
// cliente esta en ownerApprovedTexts.test.ts.
export const MSG1 = '\u00a1Hola! Soy el asistente de eLIGHTS.cl \u{1F44B}\n\nEstoy ayudando a gestionar las solicitudes de iluminaci\u00f3n para responder m\u00e1s r\u00e1pido y dejar todo listo para cotizaci\u00f3n.\n\nCu\u00e9ntame:\n1) Qu\u00e9 producto buscas\n2) Qu\u00e9 tipo de luz prefieres\n3) Cu\u00e1ntas unidades necesitas aprox.';
export const MSG2 = 'Excelente. Para recomendarte las mejores opciones, necesito saber un poco m\u00e1s:\n1) \u00bfPara qu\u00e9 espacio o proyecto es la instalaci\u00f3n?\n2) \u00bfEn qu\u00e9 comuna o ciudad ser\u00eda?';
export const MSG3 = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre y empresa (si aplica)\n2) Tu correo de contacto';
export const MSG3_B2B = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) El RUT de la empresa\n2) Tu correo de contacto';
export const MSG3_B2C = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre\n2) Tu correo de contacto';

// [CIERRE] El cierre con la solicitud registrada, aprobado por el dueno (2026-11-11, "Cierre con la solicitud
// registrada"): uno solo para productos (persona o empresa) e instalacion. Antes productos cerraba con dos textos sin
// tildes ("Un ejecutivo revisara...", uno para personas y otro para empresas) y solo la instalacion usaba este.
// [SIN-VISITA] Especificacion 5: el bot nunca ofrece visitas (negocio 195: "coordinar la visita" a quien solo
// compraba focos). webhook.ts lo cambia por MSG_DEAL_FAILED o MSG_DEAL_PENDING si Pipedrive no confirma el negocio.
export const MSG4 = 'Tu solicitud qued\u00f3 registrada. Claudio Quero te responder\u00e1 por correo el mismo d\u00eda h\u00e1bil.';
// [RESUMEN] Fase 3B (dueno, 16-11-2026, decision 2): la respuesta a un "no" solo, despues del resumen. Un segundo "no"
// recibe MSG4.
export const MSG_SUMMARY_FIX = '\u00bfQu\u00e9 dato corrijo? Escr\u00edbeme el correcto.';
// [BOT-SOLO-CORREO] Cierre de instalacion sin correo (tras las repreguntas): no se crea el
// negocio, asi que no se promete contacto; se pide el correo o escribir a ventas@.
export const MSG4_INSTALL_NO_EMAIL = 'Gracias. Para cotizar tu instalaci\u00f3n necesitamos tu correo de contacto: escr\u00edbelo por aqu\u00ed o env\u00edanos tu solicitud a ventas@elights.cl.';

/** Cierre del flujo de instalacion: solo promete el correo si lo tenemos. */
export function installClosingMsg(captured: CapturedFields): string {
  return captured.install_correo ? MSG4 : MSG4_INSTALL_NO_EMAIL;
}

// [BOT-SOLO-CORREO] Dueno (2026-10-16): la atencion de una persona es por correo, nunca por este
// canal (lo atiende solo el asistente). [CIERRE-HONESTO] Sale una sola vez, al cerrar con
// correo, y webhook.ts la cambia por MSG_DEAL_FAILED si Pipedrive no confirma el negocio.
export const MSG_HUMAN = 'Perfecto, ya deriv\u00e9 tu solicitud a nuestro equipo de ventas. Te va a atender Claudio Quero directamente por correo.';
// [ARCHIVOS] Dueno (13-11-2026, decision 1A): las imagenes y los archivos que llegan por WhatsApp no pasan a la
// solicitud (la nota solo anota "[El cliente envio 1 imagen]"). El aviso lo dice y pide mandarlos por correo a
// ventas@, sin decir que se recibieron ni que alguien los revisara por aqui. Sale una vez por rafaga (MEDIA_BURST_MS):
// con una invitacion a seguir por escrito si el archivo no trae texto (recordMediaReply; en la etapa 1, MSG_MEDIA), y
// delante de la respuesta del paso si lo trae (el texto sigue el flujo como siempre).
export const MSG_MEDIA_NOTICE = 'Por WhatsApp no podemos recibir im\u00e1genes ni archivos para tu solicitud. Por favor, env\u00edalos por correo a ventas@elights.cl.';
/** [ARCHIVOS] La pregunta de la etapa 1 despues de un aviso (producto, proyecto y cantidad aproximada, sin lista). */
export const MSG_MEDIA_ASK = 'Cu\u00e9ntanos por escrito qu\u00e9 producto necesitas, para qu\u00e9 proyecto y qu\u00e9 cantidad aproximada.';
export const MSG_MEDIA = MSG_MEDIA_NOTICE + '\n\n' + MSG_MEDIA_ASK;
// [ARCHIVOS] Un audio (una nota de voz) o un video sin texto suele ser la respuesta del cliente dicha en voz alta: no
// llega al flujo. Se le pide escribirla, siempre (tambien dentro de la rafaga de archivos), y no se le pide mandarla
// por correo. TEXTOS NUEVOS (revision del 13-11-2026): MSG_VOICE_NOTICE, MSG_MEDIA_PENDING y MSG_VOICE_WRITE esperan
// el OK del dueno.
export const MSG_VOICE_NOTICE = 'Por WhatsApp no podemos escuchar audios ni ver videos.';
export const MSG_VOICE = MSG_VOICE_NOTICE + '\n\n' + MSG_MEDIA_ASK;
/** [ARCHIVOS] Despues del aviso, fuera de la etapa 1, con una pregunta del bot pendiente: seguir por escrito. */
export const MSG_MEDIA_PENDING = 'Cu\u00e9ntanos tu respuesta por escrito y seguimos con tu solicitud.';
/** [ARCHIVOS] Un audio o un video sin pregunta pendiente (conversacion cerrada con su solicitud): escribir el mensaje. */
export const MSG_VOICE_WRITE = 'Cu\u00e9ntanos por escrito lo que necesitas.';
/** [ARCHIVOS] Un mensaje con archivos que llega antes de esto desde el anterior es de la misma rafaga. */
export const MEDIA_BURST_MS = 2 * 60_000;

/** [ARCHIVOS] Que trae un mensaje con adjuntos, segun sus MediaContentType: imagenes o archivos, y audios o videos. */
export interface MediaKinds { files: boolean; voice: boolean }

/** [ARCHIVOS] Sin tipos (o con uno vacio o desconocido) cuenta como archivo, como en la nota (transcript.ts). */
export function mediaKinds(types: readonly string[] = []): MediaKinds {
  const voice = types.filter((type) => /^\s*(?:audio|video)\//i.test(type)).length;
  return { files: types.length === 0 || voice < types.length, voice: voice > 0 };
}

/** [ARCHIVOS] La respuesta con el aviso de los archivos delante (una respuesta vacia: solo el aviso). */
export function withMediaNotice(reply: string): string {
  return reply ? MSG_MEDIA_NOTICE + '\n\n' + reply : MSG_MEDIA_NOTICE;
}

/** [ARCHIVOS] La respuesta empieza con el aviso de los archivos. */
export function hasMediaNotice(reply: string): boolean {
  return reply === MSG_MEDIA_NOTICE || reply.startsWith(MSG_MEDIA_NOTICE + '\n\n');
}

/** [ARCHIVOS] La respuesta sin el aviso de los archivos delante: lo que respondio el paso. */
function withoutMediaNotice(reply: string | undefined): string | undefined {
  return reply?.startsWith(MSG_MEDIA_NOTICE + '\n\n') ? reply.slice(MSG_MEDIA_NOTICE.length + 2) : reply;
}

/** [ARCHIVOS] El mensaje con archivos anterior llego hace menos de MEDIA_BURST_MS: esta rafaga ya tuvo el aviso. */
function inMediaBurst(state: FlowState | undefined, now: number): boolean {
  const at = state?.lastMediaAt;
  // Con el reloj de otra instancia un poco adelantado, la diferencia puede ser negativa: tambien es la misma rafaga.
  return typeof at === 'number' && Number.isFinite(at) && Math.abs(now - at) < MEDIA_BURST_MS;
}
export const MSG_EXECUTIVE = 'Perfecto \u{1F44D} Si prefieres hablar directamente con un ejecutivo, puedes escribirle por correo:\n\u{1F4E9} claudio@elights.cl\n\u{1F4E9} constanza@elights.cl\n\nDe todas formas, si quieres, tambi\u00e9n puedo ayudarte a dejar tu solicitud lista para cotizaci\u00f3n por ac\u00e1.';

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
// [YA-ESCRIBI] (aprobado por el dueno el 12-11) "Ok, yo le escribi a Claudio" sin su correo (caso de las estacas).
export const MSG_ALREADY_WROTE = 'Perfecto. D\u00e9jame tu correo y lo uno a tu solicitud para que no se pierda.';
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
export const MSG_NEED_EMAIL_AND_CONTEXT = 'Con gusto te ayudo. Para registrar tu solicitud necesito dos cosas: \u00bfqu\u00e9 producto o proyecto necesitas iluminar, y cu\u00e1l es tu correo de contacto?';
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

// El recinto de instalacion (oficina, bodega, obra, local o proyecto comercial) no identifica al comprador.
// [B2B] Palabras completas: "despacho" y "espacio" traen "spa" (caso del 12-11:
// una persona que pregunto por el despacho paso a empresa y se le pidio el RUT de la empresa).
// (revision 12-11) Con letras con tilde: "\w" no incluye la "o" con tilde y "licitacion" o "facturacion" escritas con
// tilde dejaban de ser empresa.
const B2B_SIGNAL_RE = /(?<![a-z\u00e0-\u00fc])(?:empresa[a-z\u00e0-\u00fc]*|factur[a-z\u00e0-\u00fc]*|proveedor[a-z\u00e0-\u00fc]*|licitaci[a-z\u00e0-\u00fc]*|constructor[a-z\u00e0-\u00fc]*|razon\s+social|giro\s*:|spa|ltda)(?![a-z\u00e0-\u00fc])|(?<![a-z\u00e0-\u00fc])s\.\s?a\./i;
// [B2B] La bodega, la oficina, el local o la tienda de eLIGHTS no son del cliente: "Donde queda su bodega?", "Puedo
// retirar en la bodega?" (la respuesta natural a MSG_LOCATION) o "Tienen oficina para ir a verlos?" no lo vuelven
// empresa. En una pregunta por la ubicacion o el despacho esas palabras salen; se conservan las referencias al cliente
// para reconocer sus senales explicitas de empresa.
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

// [LUZ] Para comparar: el nombre del color de una temperatura. (fase 3B, revision 16-11) 5000K es fria (regla del dueno
// del 22-10: 5000K o mas, "F"); antes quedaba como neutra.
function normalizeLuz(raw: string): string {
  const r = raw.toLowerCase().trim();
  if (/c[a\u00e1]lid[ao]/.test(r) || /warm/i.test(r) || /3000/i.test(r)) return 'calida';
  if (/neutr[ao]/.test(r) || /4000/i.test(r)) return 'neutra';
  if (/fr[i\u00ed][ao]/.test(r) || /cool/i.test(r) || /daylight/i.test(r) || /5000/i.test(r) || /6500/i.test(r)) return 'fria';
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
    return 'Perfecto. Para derivar tu solicitud de instalaci\u00f3n y poder cotizarte, necesito estos datos: nombre completo, correo, comuna y tipo de proyecto.';
  }
  if (missingRequired.length === 1) {
    return 'Casi listo. Solo me falta tu ' + missingRequired[0] + ' para registrar la solicitud.';
  }
  const items = missingRequired.map((x, i) => (i + 1) + ') ' + capitalize(x)).join('\n');
  return 'Gracias. Para completar tu solicitud de instalaci\u00f3n, necesito que me indiques:\n' + items;
}

/**
 * [REGISTRO] (revision 16-11) El tipo en el flujo de instalacion. Pedir una instalacion no es senal de empresa (queda
 * persona, B2C, como antes), pero tampoco la borra: la conversacion que ya era de empresa sigue B2B, y las senales de
 * mergeProductFields (palabras de empresa, la empresa que lee Claude, un RUT valido de empresa) la vuelven B2B. Antes
 * se fijaba B2C y, desde que el negocio nuevo de Pipedrive toma el tipo del flujo, una constructora que pedia una
 * instalacion quedaba como persona (boleta en vez de factura).
 */
function installLeadType(state: FlowState, body: string, claudeParsed: ClaudeFields, captured: CapturedFields): LeadType {
  if (state.leadType === 'B2B') return 'B2B';
  const businessRut = isBusinessRut({ valido: captured.rut_valido === true, tipo: captured.rut_tipo });
  const company = B2B_SIGNAL_RE.test(b2bText(body)) || businessRut || Boolean(claudeParsed.empresa && claudeParsed.empresa.length > 0);
  return company ? 'B2B' : 'B2C';
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
 * nada. Con correo, el cierre aprobado MSG4 (o "ya derive", si pidio ejecutivo); webhook.ts lo
 * cambia por MSG_DEAL_FAILED si Pipedrive no confirma el negocio.
 */
function productClosingMsg(registers: boolean, wantsHuman: boolean): string {
  if (!registers) return MSG_NEED_EMAIL;
  if (wantsHuman) return MSG_HUMAN;
  return registeredClosing();
}

/**
 * [CIERRE-HONESTO] El cierre de una solicitud registrada, sin "ya derive" (sale una sola vez). [CIERRE] El mismo
 * texto aprobado para productos e instalacion, para una persona o una empresa.
 */
function registeredClosing(): string {
  return MSG4;
}

// [RESUMEN] Fase 3B (dueno, 16-11-2026, decision 1): el resumen antes del cierre, en el formato aprobado el 11-11
// ("Te resumo: [productos y cantidades], [color de luz], [uso] y [comuna]. Esta bien?"), con "luz", "para" y "en". Cada
// parte va solo si el dato esta y nunca el correo, el nombre ni el RUT. Sin producto, con varios items que no se leen
// en pares limpios (menos de 2) o con mas de MAX_SUMMARY caracteres, no hay resumen: el cierre va directo (MSG4).
// Decision 3: el negocio se crea en el mismo turno del resumen; MSG4 llega con el "si" del cliente.
const MAX_SUMMARY = 500;
const SUMMARY_QUESTION: LastQuestion = { asks: [], listLength: 0, summary: true };
const SUMMARY_FIX_QUESTION: LastQuestion = { asks: [], listLength: 0, summary: true, summaryFix: true };
/** [RESUMEN] El dato tal como quedo, en una linea y sin el punto o la coma del final. */
function summaryValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(/\s+/g, ' ').trim().replace(/[\s.,;:]+$/, '') || undefined;
}
/** [RESUMEN] "a", "a y b", "a, b y c". */
function joinList(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' y ' + parts[parts.length - 1];
}
/** [RESUMEN] "<cantidad> <producto>" o, en metros, "<cantidad> m de <producto>". */
function summaryItem(cantidad: string, metros: boolean, producto: string): string {
  return cantidad + (metros ? ' m de ' : ' ') + producto;
}
/**
 * [RESUMEN] Los productos y cantidades. Varios items: los pares "cantidad + producto" del texto del cliente (itemPairs);
 * el primero puede ser el item que ya estaba cuando el cliente sumo otro (mergeQuantity: "<producto>: <cantidad> / ...").
 * Con una correccion dentro del texto ("12 focos / Corrijo: 15 focos") no se sabe cual vale: sin resumen.
 */
function summaryItems(captured: CapturedFields): string | undefined {
  const producto = summaryValue(captured.producto);
  // (revision 16-11) Una cantidad sola con un producto que nombra dos ("focos LED y paneles LED") no dice de cual es la
  // cantidad: sin resumen ("8 focos LED y paneles LED" no es lo que pidio).
  if (captured.cantidad && producto && namesSeveralProducts(producto)) return undefined;
  if (captured.cantidad_varios && !captured.cantidad) {
    let text = captured.cantidad_varios;
    // (revision 17-11, T1) El texto entero, antes de cortar los pares: "10 paneles LED c/u" deja "10 paneles LED c" en el
    // par, y lo que el corte deja fuera tampoco se resume.
    if (CORRECTION_RE.test(text) || LATE_CORRECTION_RE.test(text) || SUMMARY_UNSAFE_RE.test(comparable(text))) return undefined;
    const pairs: string[] = [];
    const own = producto ? captured.producto + ': ' : undefined;
    const prefix = own && text.startsWith(own) ? /^(\d{1,5})( m)? \/ /.exec(text.slice(own.length)) : null;
    if (own && prefix && producto) {
      pairs.push(summaryItem(prefix[1], Boolean(prefix[2]), producto));
      text = text.slice(own.length + prefix[0].length);
    }
    const rest = itemPairs(text);
    if (!rest.length) return undefined;
    for (const pair of rest) if (!pairs.some((p) => comparable(p) === comparable(pair))) pairs.push(pair);
    return pairs.length >= 2 ? joinList(pairs) : undefined;
  }
  if (!producto) return undefined;
  // (ronda 4, B3) Un producto que se vende por metro, en singular, con una cantidad sin metros distinta de 1 ("300
  // unidades", "3 rollos") se leeria "300 cinta LED": sin resumen (el cierre de siempre; el texto queda en la nota).
  if (captured.cantidad && captured.cantidad_unidad !== 'm' && !/^0*1$/.test(captured.cantidad) && LENGTH_PRODUCT_RE.test(producto)) return undefined;
  return captured.cantidad ? summaryItem(captured.cantidad, captured.cantidad_unidad === 'm', producto) : producto;
}
const LENGTH_PRODUCT_RE = /^(?:cinta|tira|manguera)(?![a-z\u00e0-\u00fc])/i;
/** [RESUMEN] (revision 16-11) El producto nombra dos o mas, unidos por "y", una coma, "+" o "/" ("focos LED y paneles LED"). */
function namesSeveralProducts(producto: string): boolean {
  return producto.split(/\s+(?:y|e)\s+|\s*[,+/]\s*/i).filter((side) => itemsIn(side).length > 0).length >= 2;
}
// [RESUMEN] (revision 16-11) El resumen repite el texto del cliente: si trae un precio, el stock, un plazo, el despacho o
// "gratis" (reglas del sitio: nunca precios ni stock, despacho solo "hasta 2 dias habiles", nunca "gratis"), no hay
// resumen y va el cierre (MSG4). Se compara sin tildes ni mayusculas.
// (revision 17-11, T1) Tambien en plural ("urgentes") y lo que el bot no afirma: la garantia, un certificado o la
// certificacion, la SEC, una norma, el D.S. N\u00b01 ("DS1", "D.S. 1") y la homologacion.
// (ronda 4, C) Tambien los dias y las fechas ("el lunes", "fin de mes", "en 2 dias", "20/11"), los pesos, "lucas", el IVA,
// un porcentaje, "dcto", la promocion o la liquidacion, "garantizado", el DS43, ENEC, "de regalo" y "cada uno". La fecha va
// sin espacios: " / " separa los items de varios ("paneles LED 60x60: 20 / 10 focos LED").
const SUMMARY_UNSAFE_RE = /\$|%|(?<![0-9])\d{1,2}\/\d{1,2}(?![0-9])|(?<![a-z0-9])(?:precios?|valor(?:es)?|valen?|cuestan?|costos?|ofertas?|rebaj[a-z]*|descuentos?|barat[a-z]*|stock|disponib[a-z]*|gratis|gratuit[a-z]*|despach[a-z]*|envios?|entreg[a-z]*|manana|hoy|urgentes?|plazos?|c\/u|garantias?|garantiz[a-z]*|certific[a-z]*|sec|normas?|normativ[a-z]*|homolog[a-z]*|d\.?\s?s\.?\s?(?:n\S{0,2}\s?)?(?:1|43)|enec|pesos|lucas?|iva|dctos?|promos?|promoci[a-z]*|liquidaci[a-z]*|regal[a-z]*|cada\s+un[oa]s?|lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|fin\s+de\s+mes|en\s+\d+\s+(?:dias?|semanas?|meses|mes|horas?))(?![a-z0-9])/;
/** [RESUMEN] (revision 16-11) `text` ya nombra el valor `value` como palabra (la comuna dentro del uso). */
function namesValue(text: string, value: string): boolean {
  return new RegExp('(?<![a-z0-9])' + comparable(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(comparable(text));
}
/** [RESUMEN] El resumen de lo capturado, o nada si no se puede armar (ver arriba). */
export function summaryMsg(captured: CapturedFields): string | undefined {
  const items = summaryItems(captured);
  if (!items) return undefined;
  // Las partes en lista, con "y" antes de la ultima (alcance de la fase 3B): "20 paneles LED 60x60, luz neutra, para
  // oficina y en Maipu"; con una sola ademas de los productos, "30 tubos LED y luz fria".
  const parts: string[] = [items];
  const uso = summaryValue(captured.proyecto_o_uso);
  // [TILDES] El color con su tilde (luzShown); otro valor ("blanca", "4000K") tal cual, sin "luz luz". (revision 16-11)
  // Si el uso ya nombra ese color ("iluminar una bodega con luz neutra"), no se repite.
  const luz = summaryValue(captured.tipo_de_luz);
  const usoLuz = uso ? textLuz(uso) : undefined;
  if (luz && !(uso && (namesValue(uso, luz) || (usoLuz && normalizeLuz(usoLuz) === normalizeLuz(comparable(luz)))))) {
    parts.push(luzShown(/^luz\b/i.test(luz) ? luz : 'luz ' + luz));
  }
  // El uso tal cual (sin articleFor), sin "para para".
  if (uso) parts.push(/^para\s/i.test(uso) ? uso : 'para ' + uso);
  // La comuna de la entrega, nunca las otras mencionadas. (revision 16-11) Si el uso ya la nombra ("bodega en
  // Quilicura"), no se repite.
  const comuna = summaryValue(captured.comuna_o_ciudad);
  if (comuna && !(uso && namesValue(uso, comuna))) parts.push('en ' + comuna);
  const text = 'Te resumo: ' + joinList(parts) + '. \u00bfEst\u00e1 bien?';
  if (text.length > MAX_SUMMARY) return undefined;
  if (SUMMARY_UNSAFE_RE.test(comparable(text))) return undefined;
  // Nunca el correo, el nombre ni el RUT, aunque el cliente los haya escrito dentro de otro dato.
  const shown = comparable(text);
  const privateData = [captured.correo, captured.rut, captured.nombre_o_empresa].filter((v): v is string => typeof v === 'string' && v.trim().length > 2);
  const inSummary = (v: string) => new RegExp('(?<![a-z0-9])' + comparable(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(shown);
  if (text.includes('@') || privateData.some(inSummary)) return undefined;
  return text;
}
/**
 * [RESUMEN] El cierre de una solicitud de productos: con correo y sin el ejecutivo (MSG_HUMAN), el resumen si se puede
 * armar (y queda anotado en el estado `saved`, ya guardado como cerrado); si no, el cierre de siempre.
 */
function productClosing(phone: string, saved: FlowState, registers: boolean, wantsHuman: boolean): { reply: string; question?: LastQuestion } {
  const summary = registers && !wantsHuman && !saved.isInstallFlow ? summaryMsg(saved.captured) : undefined;
  if (!summary) return { reply: productClosingMsg(registers, wantsHuman) };
  saveFlowState(phone, { ...saved, summaryAt: Date.now(), summaryShown: 1 });
  return { reply: summary, question: SUMMARY_QUESTION };
}

/**
 * [CIERRE-HONESTO] Respuesta a un mensaje en una conversacion ya cerrada, segun lo que respondio
 * Pipedrive y nada mas: "quedo registrada" si confirmo el negocio, el texto B si fallo, y sin
 * intento (no hay correo) se pide el correo.
 */
function closedReply(state: FlowState): string {
  if (state.deal === 'registered') return registeredClosing();
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
/** [LUZ] La temperatura tal como la escribe el cliente ("5000 k" -> "5000K"), o nada si el texto no es una temperatura. */
function kelvinOf(text: string): string | undefined {
  const m = /^(\d{4})\s*k$/i.exec(text.trim());
  return m ? m[1] + 'K' : undefined;
}
/**
 * [NO-PISAR] El color que pide el mensaje: uno solo, sin los negados ("no fria, calida"); con dos distintos, ninguno.
 * (fase 3B, revision 16-11) Una temperatura queda como la escribio el cliente ("4000K"), sin pasarla a un nombre: el
 * resumen la muestra tal cual. Para saber si son dos colores distintos se comparan con normalizeLuz.
 */
function textLuz(facts: string): string | undefined {
  const found = new Map<string, string>();
  for (const m of facts.matchAll(LUZ_RE_ALL)) {
    if (LUZ_NEGATED_RE.test(facts.slice(Math.max(0, m.index - 40), m.index))) continue;
    const key = normalizeLuz(m[0]);
    if (!found.has(key)) found.set(key, kelvinOf(m[0]) ?? key);
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
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
  const unitBefore = merged.cantidad_unidad;
  keepOrChange(merged, 'cantidad', value, change);
  if (merged.cantidad === value && before !== value) {
    // [METROS] (ronda 4, B3) Una cantidad corregida sin unidad ("No, 300", "Corrijo: 300") conserva los metros capturados;
    // una unidad nueva explicita ("300 unidades", "3 rollos") los reemplaza. La linea de cambio lleva las unidades.
    const keepsMeters = !quantity.unit && unitBefore === 'm' && !namesUnits(facts);
    if (!keepsMeters) setUnit(merged, quantity);
    const unitNow = merged.cantidad_unidad;
    const plainLine = KEPT_LABEL.cantidad + ': antes ' + before + ', ahora ' + value;
    if (before && (unitBefore === 'm' || unitNow === 'm') && merged.cambios?.[merged.cambios.length - 1] === plainLine) {
      merged.cambios = [...merged.cambios.slice(0, -1), KEPT_LABEL.cantidad + ': antes ' + before + (unitBefore === 'm' ? ' m' : '') + ', ahora ' + value + (unitNow === 'm' ? ' m' : '')];
    }
  }
  // (revision 13-11) El mismo numero con otra unidad, afirmado: "Corrijo: necesito 5 metros de cinta LED" despues de
  // "5 cintas LED", o al reves ("5 cintas LED" nombra unidades). Un "son 5" sin unidad no borra los metros.
  else if (change && before === value && (quantity.unit ? quantity.unit !== unitBefore : unitBefore !== undefined && itemsIn(facts).length > 0)) {
    noteChange(merged, 'cantidad', value + (unitBefore === 'm' ? ' m' : ''), value + (quantity.unit === 'm' ? ' m' : ''));
    setUnit(merged, quantity);
  }
}
/** [METROS] La unidad va con la cantidad que se acaba de anotar: metros, o (sin unidad) unidades. */
function setUnit(merged: CapturedFields, quantity: QuantityRead): void {
  if (quantity.unit) merged.cantidad_unidad = quantity.unit;
  else delete merged.cantidad_unidad;
}
/** [METROS] (ronda 4, B3) El mensaje nombra unidades: un item ("3 rollos", "300 cintas") o "unidades". */
function namesUnits(facts: string): boolean {
  return itemsIn(facts).length > 0 || /(?<![a-z\u00e0-\u00fc])(?:unidad(?:es)?|unds?|u)(?![a-z\u00e0-\u00fc])/i.test(facts);
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
  texts: { answering: boolean; company: boolean; assertive: string; affirmed: string; base: string; firmOnly?: boolean; correcting?: boolean },
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
  // [RESUMEN] firmOnly: solo la que el texto presenta como la obra, la entrega o la respuesta (no una mencion debil).
  let inBase = findComunaMentions(texts.base, { ...opts, firmOnly: texts.firmOnly }).filter((m) => !m.billing && !m.origin).map((m) => m.name);
  // [RESUMEN] (ronda 4, B1) El mensaje que corrige o niega la capturada ("Es en Pudahuel, no en Maipu", "Maipu no, La
  // Florida") nombra la nueva junto a la vieja: la nueva es la que no es la capturada.
  if (texts.correcting) inBase = inBase.filter((name) => name !== current);
  if (inBase.length && !inBase.includes(current)) {
    const claudePick = officialComuna(claudeText(claudeValue));
    const change = inBase.length === 1 ? inBase[0] : claudePick && inBase.includes(claudePick) ? claudePick : undefined;
    if (change) {
      merged[field] = change;
      noteChange(merged, 'comuna_o_ciudad', current, change);
    }
  }
  // La capturada que el mensaje niega no es otra comuna mencionada: el cliente la descarto.
  noteOtherComunas(merged, texts.correcting ? stated.filter((m) => m.name !== current) : stated, undefined);
}

// PASO 1: MERGE de los campos del flujo de productos.
// [NO-PISAR] Producto, color, cantidad, proyecto y comuna: un dato vacio se llena (con lo de
// Claude o, si no, con las reglas); uno ya capturado solo cambia si este mensaje lo trae explicito
// (keepOrChange). Antes lo de Claude, que lee toda la conversacion, y la regla del color pisaban.
// [CANTIDAD] La cantidad sale de readQuantity (quantity.ts), nunca del primer numero del mensaje.
// [RUT-VALIDO] rutToConfirm: llego un RUT que no calza y todavia no se pidio de nuevo.
// [CASO-1] menuPick: el mensaje es solo el numero de un item de la lista que el bot acaba de mostrar.
// [RESUMEN] summaryReply: el mensaje contesta el resumen; una comuna sola ("Pudahuel") la corrige, como la respuesta
// a la pregunta por la comuna.
function mergeProductFields(
  state: FlowState,
  body: string,
  claudeParsed: ClaudeFields,
  hasMedia = false,
  summaryReply = false,
  instead = false,
): { merged: CapturedFields; leadType: LeadType; rutToConfirm: boolean; menuPick?: number; addsProduct?: boolean; addedText?: string; listReplace?: boolean; switchWords?: boolean; unmapped?: boolean; destComuna?: boolean; itemFirm?: boolean } {
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
  // [RESUMEN] (revision 16-11) O si contesta el resumen o "Que dato corrijo?" ("30", "No, 30"): es la cantidad.
  const question = lastQuestionOf(state);
  const summaryFix = summaryReply && Boolean(question?.summaryFix);
  const options = {
    ruts,
    // (ronda 5, C4) Tambien el numero solo en una de sus clausulas ("30, en Pudahuel", "Si pero 30 y luz fria").
    asked: (Boolean(question?.asks.includes('cantidad')) && !merged.cantidad && !merged.cantidad_varios) || (summaryReply && bareNumberClause(body)),
    menuLength: question?.listLength ?? 0,
    contact: EMAIL_RE.test(body),
    claude: claudeParsed.cantidad,
    // [METROS] (revision 12-11) Los metros cuentan solo si el producto se vende por metro.
    product: merged.producto ?? claudeText(claudeParsed.producto),
  };
  const quantity = readQuantity(maskNegated(withoutIndirectQuestions(facts)), options);
  const stated = assertive === facts ? quantity : readQuantity(assertive, { ...options, menuLength: 0 });
  // [RESUMEN] Al contestar el resumen, otro producto con su cantidad y sin corregir ("Necesito 5 focos LED para el
  // patio" despues de "20 paneles LED") se suma como otro item: no reemplaza el producto ni su cantidad.
  // (revision 16-11) No se suma el que reemplaza al capturado: con "en realidad", "al final", "quise decir", "me
  // confundi", "error mio" o "eran" (SUMMARY_SWITCH_RE), o negando el capturado ("Son 20 focos LED, no paneles").
  const negated = droppedStems(facts, affirmed);
  const negatesOwn = Boolean(merged.producto) && productWords(merged.producto as string).some((w) => negated.has(w));
  // (revision 17-11) Tambien con las palabras de cambio de LATE_CORRECTION_RE ("Cambio: necesito 20 focos LED", "Lo
  // cambio por", "Modifico:", "Actualizo: son"; SUMMARY_CHANGE_RE), que ademas hacen firme el cambio de producto
  // (switchWords), y con un "Son ..." al inicio ("Son 20 focos LED"), que dice cual es el pedido.
  // (ronda 4, B4) Lo nuevo de un "en vez de" ("Necesito 20 focos LED en vez de paneles": `instead`) tambien.
  const switchWords = summaryReply && (SUMMARY_SWITCH_RE.test(assertive) || SUMMARY_CHANGE_RE.test(assertive) || negatesOwn || instead);
  const switches = switchWords || (summaryReply && SUMMARY_IS_RE.test(assertive));
  // [RESUMEN] (revision 17-11) La lista completa nueva ("Son 30 paneles y 10 focos", "No, son 8 paneles y 15 focos",
  // "15 focos y 8 paneles"): con 2 pares limpios o mas (itemPairs) y sin sumar ("tambien", "ademas", "agrega", "sumale",
  // "otros 10 focos", "10 focos mas"), reemplaza los items y su cantidad, no se suma al texto de varios items.
  const explicitAdd = adding || SUMMARY_ADDITIVE_RE.test(assertive) || ADD_VERB_RE.test(comparable(assertive));
  const listFound = summaryReply && !explicitAdd ? summaryList(assertive) : undefined;
  // La misma lista otra vez ("Si, 12 focos y 5 paneles") confirma: no cambia la cantidad.
  const sameList = Boolean(listFound && sameItems(itemPairs(listFound), capturedPairs(merged)));
  const listText = sameList ? undefined : listFound;
  // (ronda 5, C7) Una unidad de venta ("3 rollos", "2 cajas") no nombra otro producto.
  const named = summaryReply && !adding && merged.producto
    ? namedProducts(assertive, claudeParsed).filter((p) => !productWords(p).every((w) => PACKAGING_RE.test(w))) : [];
  const summaryAdds = !listText && named.length > 0 && !sameProduct(named, merged.producto as string)
    && (stated.value !== undefined || stated.several) && !CORRECTION_RE.test(assertive) && !PRODUCT_SWITCH_RE.test(assertive) && !switches;
  // [RESUMEN] (ronda 5, C5) En un pedido de varios items, la cantidad de uno de ellos ("En vez de 5 paneles, 8 paneles",
  // "Los focos son 15 y los paneles 8") cambia ese item en la lista (itemQuantities), nunca suma "/ 8 paneles" como otro
  // item. Si no calza con un solo item (unmapped), ni la cantidad ni el producto cambian y el mensaje queda textual en la
  // nota. Tampoco si trae su propio uso ("Necesito 5 focos LED para el patio"): puede ser otro item.
  // (ronda 5, C7) Una cantidad en otra unidad de venta ("2 cajas", "10 rollos de 5 metros") tampoco cambia la cantidad.
  const quantityFound = stated.value !== undefined || stated.several || quantity.value !== undefined;
  const pairsBefore = capturedPairs(merged);
  const itemRead = summaryReply && quantityFound && !listText && !sameList && !explicitAdd && !summaryAdds && !merged.cantidad
    && pairsBefore.length >= 2 ? itemQuantities(assertive, facts, pairsBefore) : undefined;
  const itemUse = itemRead ? summaryUseValue(base) ?? (SUMMARY_USE_RE.test(assertive) ? extractProyecto(assertive) : undefined) : undefined;
  const otherUse = Boolean(itemUse && !(merged.proyecto_o_uso && (SAME_VALUE.proyecto_o_uso as (a: string, b: string) => boolean)(merged.proyecto_o_uso, itemUse)));
  const itemFix = otherUse ? 'unmapped' : itemRead;
  const unmapped = itemFix === 'unmapped';
  // "No son 12 focos, son 15": negar la cantidad capturada de un item la corrige con firmeza (como "en vez de").
  const itemFirm = Boolean(itemFix && !unmapped && pairsBefore.some((pair) => negatesValue(facts, /^\S+/.exec(pair)?.[0])));
  // Con palabra de correccion o un "No," delante ("Corrijo: son 3 rollos", "No, 300 rollos") la unidad nueva reemplaza los metros
  // (ronda 4, B3).
  const firmUnit = CORRECTION_RE.test(assertive) || /^\s*no\s*[,.]/i.test(assertive);
  const packaging = summaryReply && quantityFound && !listText && !itemFix && !summaryAdds && !explicitAdd && !firmUnit && packagingOnly(assertive, merged.producto);
  // [RESUMEN] (revision 17-11) En un pedido de un item, otro producto afirmado sin su cantidad ("focos LED", "Son focos
  // LED" despues de "20 paneles LED 60x60") lo reemplaza aunque sea un nombre generico: el cliente lo escribe al ver el
  // resumen (decision 2 del dueno: "si despues escribe el dato, se corrige en el mismo negocio"). Un "si" con el nombre
  // de la familia ("Si, los focos") confirma. Fuera del resumen sigue [NO-DEGRADAR].
  const summarySwitch = summaryReply && !state.captured.cantidad_varios && !listText && !quantity.several && !summaryAdds
    && named.length > 0 && !sameProduct(named, merged.producto as string)
    && (switches || !SUMMARY_YES_LEAD_RE.test(summaryAnswerText(body)));
  // [RESUMEN] (revision 16-11) Lo que suma como otro item ("tambien necesito 10 focos LED", o el de summaryAdds) y si
  // nombra un producto: "Si, en 2 semanas mas" o "tengo 3 obras mas" suman sin producto y no son otro item.
  const addedText = summaryAdds ? assertive : adding ? [...assertive].map((c, i) => (base[i] === c ? ' ' : c)).join('') : '';
  const addsProduct = summaryAdds || (adding && namedProducts(addedText, claudeParsed).length > 0);
  // Con varios items ("20 paneles y 30 focos") la regla ve uno solo: no cambia el producto.
  const claudeProd = claudeText(claudeParsed.producto);
  const prodChange = summaryAdds || unmapped ? undefined : backed(claudeProd, quantity.several ? undefined : rule(PRODUCTO_RE), base);
  // "Corrijo: paneles LED, no regulables": quitar del producto lo que el cliente niega tambien es un cambio.
  const dropsNegated = Boolean(prodChange && merged.producto
    && productWords(merged.producto).some((w) => negated.has(w) && !productWords(prodChange).includes(w)));
  // [NO-DEGRADAR] Caso del 12-11: "5 focos" no cambia "Estaca LED COB 5W para jardin" por "focos". Un nombre
  // generico nunca reemplaza a uno especifico, salvo una correccion ("corrijo, mejor focos", "no quiero estacas,
  // quiero focos"). De generico a especifico, o entre dos genericos, si cambia.
  // (revision 12-11) Solo la misma familia: "10 reflectores LED" despues de la campana, o "paneles" despues de la
  // estaca, cambian el producto (sameFamily).
  const downgrade = Boolean(prodChange && merged.producto && genericProduct(prodChange) && !genericProduct(merged.producto)
    && sameFamily(prodChange, merged.producto)
    && !dropsNegated && !CORRECTION_RE.test(assertive) && !PRODUCT_SWITCH_RE.test(assertive) && !(switches && !listText) && !summarySwitch);
  // [RESPALDO] El producto de Claude llena el dato vacio solo si alguna de sus palabras esta en el mensaje o en el
  // enlace de la ficha (negocio 206: "Sistemas de seguridad" salia del nombre del perfil).
  const claudeProdFill = claudeProd && sharesWord(claudeProd, facts + ' ' + linkWords(body)) ? claudeProd : undefined;
  keepOrChange(merged, 'producto', fillWith(claudeProdFill, extractProducto(assertive) ?? (itemsIn(assertive).length ? undefined : extractProducto(affirmed))), downgrade ? undefined : prodChange, dropsNegated);
  // El color del texto gana al de Claude cuando no calzan (Claude puede repetir uno negado o viejo).
  const luzText = textLuz(assertive) ?? textLuz(affirmed);
  // [LUZ] El de Claude solo si es un color de luz: nunca "LED", "luz interior" ni el uso (negocios 148 y 156).
  const claudeLuz = luzValue(claudeText(claudeParsed.tipo_de_luz));
  const luzConflict = Boolean(luzText && claudeLuz && normalizeLuz(comparable(claudeLuz)) !== normalizeLuz(luzText));
  // El color que el cliente niega ("no fria") no llena el dato, aunque Claude lo devuelva.
  const luzNegated = Boolean(claudeLuz && !luzText && (negatedLuz(facts).has(normalizeLuz(comparable(claudeLuz))) || negatedOnly(claudeLuz)));
  // (fase 3B, revision 16-11) La temperatura que escribe el cliente ("4000K") gana al nombre que le da Claude ("neutra")
  // si ese nombre no esta en el mensaje: el resumen no reinterpreta una temperatura.
  const kelvinText = Boolean(luzText && kelvinOf(luzText) && claudeLuz && !inMessage(claudeLuz, facts));
  keepOrChange(merged, 'tipo_de_luz', luzConflict || kelvinText ? luzText : luzNegated ? undefined : claudeLuz ?? luzText, textLuz(base));
  // Lo que el cliente afirma decide la cantidad ("Necesito 20 paneles, tienen 30 focos?" es 20); si no afirma
  // ninguna, el mensaje sin negaciones ni consultas indirectas puede llenar el dato vacio.
  // [VARIOS-IMAGEN] Negocio 130: cada imagen con su cantidad ("12 UND" y luego "5 UND") es otro item, no una
  // correccion: lo capturado pasa a varios items. Con "perdon", "mejor" o "corrijo" si corrige.
  // (revision 12-11) La imagen del mismo producto ("Este modelo, 10 unidades", "Son 15 de este") confirma o corrige la
  // cantidad: no es otro item.
  const mediaItem = hasMedia && Boolean(merged.cantidad || merged.cantidad_varios)
    && (stated.value !== undefined || quantity.value !== undefined) && !CORRECTION_RE.test(assertive)
    && !THIS_ONE_RE.test(comparable(assertive));
  if (listText) replaceVarios(merged, listText);
  else if (itemFix && !unmapped) replaceVarios(merged, itemFix);
  else if (!sameList && !unmapped && !packaging) mergeQuantity(merged, stated.value !== undefined || stated.several ? stated : quantity, stated, facts, adding || mediaItem || summaryAdds);
  // [RESPALDO] El uso sale de lo que el cliente dice, no del nombre del producto ("PROYECTOR LED DE ESTADIO",
  // "Estaca LED COB 5W para jardin") ni de lo que Claude deduce (negocios 119, 197 y 206).
  // (revision 12-11) De un nombre generico ("focos LED para jardin") sale solo la familia: "para jardin" es el uso que
  // el cliente dio. El nombre de una ficha ("Estaca LED COB 5W para jardin") sale entero.
  const productNames = [claudeProd, merged.producto, state.captured.producto]
    .map((name) => (name && genericProduct(name) ? name.replace(/\s+(?:para|en)\s+.*$/i, '') : name));
  const noProduct = (text: string) => withoutProductNames(text, productNames);
  // [RESUMEN] (revision 16-11) Despues de "Que dato corrijo?", un texto corto ("bodega", "una bodega") contesta el uso.
  const claudeProy = claudeProject(claudeParsed, body, noProduct(facts), (Boolean(question?.asks.includes('proyecto_o_uso')) && !merged.proyecto_o_uso) || (summaryFix && shortUseReply(facts)));
  const ownProject = (text: string) => extractProyecto(withoutStorePlaces(noProduct(text)));
  // [RESUMEN] (ronda 5, C3) Despues del resumen, el uso dicho sin "para" ("Colegio", "Es un colegio", "uso: colegio") o con
  // un uso de la lista ("Para un taller"): summaryUseValue. El de Claude gana solo si lo contiene y esta en el mensaje.
  const useValue = summaryReply ? summaryUseValue(withoutStorePlaces(noProduct(base))) : undefined;
  const useChange = useValue && claudeProy && comparable(claudeProy).includes(comparable(useValue)) ? claudeProy : useValue;
  keepOrChange(merged, 'proyecto_o_uso', fillWith(claudeProy, useChange ?? ownProject(assertive) ?? ownProject(affirmed)), useChange ?? backed(claudeProy, soleMatch(withoutStorePlaces(noProduct(base)), PROYECTO_RE), base));
  // [RESUMEN] (revision 16-11) Al contestar el resumen, la comuna capturada cambia solo con una comuna sola ("Pudahuel",
  // "Es en Pudahuel": comunaReply) o presentada como la obra o la entrega ("el despacho es a Pudahuel"); "vive en Pirque"
  // o "estoy en Santiago" no (firmOnly).
  // (revision 17-11, ronda 3) El mensaje que es solo la comuna (comunaReply, con su saludo o su cortesia) la presenta como
  // la respuesta: cuenta aunque vaya con un "en" suelto ("Si, pero en Pudahuel", "La direccion es en Pudahuel").
  const replyComuna = summaryReply && comunaReply(facts);
  // [RESUMEN] (ronda 4, B1) Con palabra de correccion ("Me equivoque, es en Pudahuel", "Perdon, es en Pudahuel") o negando
  // la capturada ("Es en Pudahuel, no en Maipu", "Maipu no, La Florida") la comuna que nombra el mensaje es la nueva:
  // firmOnly no aplica, y la negacion contesta la comuna (un nombre solo cuenta). "Mi cunado vive en Pirque" sigue igual.
  const negatesComuna = summaryReply && negatesValue(facts, merged.comuna_o_ciudad);
  const comunaCorrection = summaryReply && (negatesComuna || CORRECTION_RE.test(assertive)
    || LATE_CORRECTION_RE.test(assertive.replace(PURPOSE_CHANGE_RE, ' ')) || SUMMARY_SWITCH_RE.test(assertive));
  mergeComuna(merged, 'comuna_o_ciudad', claudeParsed.comuna_o_ciudad, {
    answering: Boolean(question?.asks.includes('comuna_o_ciudad')) || replyComuna || negatesComuna, company: mentionsCompany(body.slice(0, MAX_FACTS)), assertive, affirmed, base,
    firmOnly: summaryReply && !replyComuna && !comunaCorrection, correcting: negatesComuna,
  });
  // [RESUMEN] (ronda 5, C1) La comuna presentada como destino en una clausula ("Lo necesito en Renca", "Son 30 paneles para
  // Pudahuel", "Que sean 30 y en Pudahuel"): destinationComuna. Sale de "Otras comunas mencionadas".
  let destComuna = false;
  if (summaryReply && state.captured.comuna_o_ciudad && merged.comuna_o_ciudad === state.captured.comuna_o_ciudad) {
    const dest = destinationComuna(summaryParts(facts).statement, merged.comuna_o_ciudad);
    if (dest) {
      noteChange(merged, 'comuna_o_ciudad', merged.comuna_o_ciudad, dest);
      merged.comuna_o_ciudad = dest;
      const otras = (merged.comunas_otras ?? []).filter((c) => comparable(c) !== comparable(dest));
      if (otras.length) merged.comunas_otras = otras;
      else delete merged.comunas_otras;
      destComuna = true;
    }
  }
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
  // [RUT-PERSONA] Dueno (13-11-2026): a una persona se le emite boleta sin RUT y el bot nunca se lo pide. Un RUT cuyo
  // digito verificador no calza se pide de nuevo (una vez), como antes, si llega en este mensaje y es de una empresa: la
  // conversacion es de empresa (B2B) o el numero es de 50.000.000 o mas (rutRange: empresa, organismo o comunidad,
  // aunque el mensaje no traiga otras palabras de empresa). El de una persona (B2C o sin tipo, con numero de persona)
  // queda guardado como invalido y la nota lo marca para revisarlo (pipedriveLead.ts, rutLine).
  // (revision 16-11) Un RUT malo guardado en un mensaje anterior (por ejemplo, el del ejecutivo, que no lo pide) no se
  // pide en un mensaje sin RUT, como en main. Solo en el mensaje en que la conversacion pasa de persona a empresa, y si
  // ese mensaje no puede registrar la solicitud (sin correo) ni pregunta el precio: la repregunta nunca atrasa un
  // registro ni reemplaza la respuesta a una pregunta.
  const invalidHere = Boolean(rutFound && !rutFound.valido);
  const companyRut = leadType === 'B2B' || Boolean(rutFound && rutRange(rutFound.rut) !== 'persona');
  const becameCompany = !invalidHere && state.leadType !== 'B2B' && leadType === 'B2B'
    && merged.rut !== undefined && merged.rut_valido === false && !canRegister(merged)
    // Un mensaje que pregunta el precio o algo tecnico recibe esa respuesta (pide el correo), como en main.
    && !questionAsksEmail(questionKinds(body));
  const rutToConfirm = !state.rutRetryAsked && ((invalidHere && companyRut) || becameCompany);
  return { merged, leadType, rutToConfirm, menuPick: quantity.menuPick, ...(summaryReply ? { addsProduct, addedText, listReplace: Boolean(listText) || (Boolean(itemFix) && !unmapped), switchWords, unmapped, destComuna, itemFirm } : {}) };
}
/**
 * [RESUMEN] (revision 17-11) La lista de items de la respuesta al resumen, desde su primer par ("No, son 8 paneles y 15
 * focos" -> "8 paneles y 15 focos"), o nada si trae menos de 2 pares limpios. Sin la palabra de correccion del inicio, el
 * resumen corregido puede leer la lista (summaryItems no resume un texto con una correccion dentro).
 */
function summaryList(text: string): string | undefined {
  const flat = text.replace(/[^\S\n]+/g, ' ');
  const pairs = itemPairs(flat);
  if (pairs.length < 2) return undefined;
  const at = flat.indexOf(pairs[0]);
  if (at < 0) return undefined;
  return flat.slice(at).replace(/\s+/g, ' ').trim().slice(0, MAX_VARIOS) || undefined;
}
/** [RESUMEN] (revision 17-11) Los items capturados en pares, como los lee el resumen (summaryItems). */
function capturedPairs(captured: CapturedFields): string[] {
  if (captured.cantidad && captured.producto) return [captured.cantidad + ' ' + captured.producto];
  if (!captured.cantidad_varios) return [];
  let text = captured.cantidad_varios;
  const own = captured.producto ? captured.producto + ': ' : undefined;
  const prefix = own && text.startsWith(own) ? /^(\d{1,5})( m)? \/ /.exec(text.slice(own.length)) : null;
  const pairs: string[] = [];
  if (own && prefix) {
    pairs.push(prefix[1] + ' ' + captured.producto);
    text = text.slice(own.length + prefix[0].length);
  }
  return [...pairs, ...itemPairs(text)];
}
/** [RESUMEN] (revision 17-11) Los mismos items: cada par con la misma cantidad y el mismo producto, dicho igual o con menos palabras. */
function sameItems(a: string[], b: string[]): boolean {
  if (!a.length || a.length !== b.length) return false;
  const key = (pair: string) => {
    const m = /^(\S+)\s+(.*)$/.exec(pair);
    return m ? { n: m[1].replace(/\./g, ''), words: productWords(m[2]) } : undefined;
  };
  const left = b.map(key);
  return a.every((pair) => {
    const k = key(pair);
    const i = left.findIndex((o) => o && k && o.n === k.n && (k.words.every((w) => o.words.includes(w)) || o.words.every((w) => k.words.includes(w))));
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
}
/** [RESUMEN] (revision 17-11) La lista nueva reemplaza la cantidad o los varios items, con su linea de cambio. */
function replaceVarios(merged: CapturedFields, text: string): void {
  if (!merged.cantidad && comparable(merged.cantidad_varios ?? '') === comparable(text)) return;
  const before = merged.cantidad
    ? merged.cantidad + (merged.cantidad_unidad === 'm' ? ' m' : '')
    : merged.cantidad_varios ? 'varios items (' + merged.cantidad_varios.slice(0, 80) + ')' : undefined;
  delete merged.cantidad;
  delete merged.cantidad_unidad;
  merged.cantidad_varios = text;
  if (before) noteChange(merged, 'cantidad', before, 'varios items (' + text.slice(0, 160) + ')');
}
/** [RESUMEN] (revision 16-11) La respuesta corta que nombra un uso: hasta 4 palabras, sin numeros, color ni comuna. */
function shortUseReply(facts: string): boolean {
  const words = facts.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 4 && !/\d/.test(facts) && !textLuz(facts) && !findComunas(facts, { answering: true }).length;
}
// [RESUMEN] (ronda 5, C4) La cantidad sola en una de las clausulas de la respuesta al resumen ("30, en Pudahuel", "30 y
// luz fria" despues de summaryData): como el numero solo (BARE_NUMBER_RE), es la cantidad.
function bareNumberClause(body: string): boolean {
  const text = body.slice(0, MAX_FACTS);
  return BARE_NUMBER_RE.test(text) || text.split(/\s*[,;]\s*|\s+y\s+/i).some((part) => BARE_NUMBER_RE.test(part));
}
// [RESUMEN] (ronda 5) Las clausulas de la respuesta al resumen: cortadas en sus pausas y en " y ", " e " o " pero ".
const CLAUSE_SPLIT_RE = /[,;:!?\u00a1\u00bf\n]|\.(?!\d)|\s(?:y|e|pero)\s/i;
/**
 * [RESUMEN] (ronda 5, C1) La comuna que una clausula de la respuesta al resumen presenta como el destino: "mejor en
 * Renca", "Renca mejor", "Lo necesito en Renca", "Va para Renca", "El pedido va a Renca", "Ah, y es en Renca", "Son 30
 * paneles para Pudahuel", "Que sean 30 y en Pudahuel". No cuenta la de una clausula con otra persona u otro lugar ("Mi
 * cunado vive en Pirque", "mi otra casa esta en Pirque", "Saludos desde Pirque": DEST_BLOCK_RE), negada o descartada; la
 * comuna que es una palabra comun ("Florida"), solo con mayuscula. Una sola comuna distinta de la capturada, o nada.
 */
const DEST_BLOCK_RE = /(?<![a-z])(?:viv[a-z]*|cunad[oa]s?|herman[oa]s?|famili[a-z]*|mama|papa|madre|padre|suegr[oa]s?|ti[oa]s?|prim[oa]s?|hij[oa]s?|abuel[oa]s?|amig[oa]s?|vecin[oa]s?|novi[oa]s?|pareja|espos[oa]s?|marido|senora|casas?|desde|saludos?|central|matriz|sucursal(?:es)?|factur[a-z]*|boletas?|estoy|estamos|soy|somos|trabaj[a-z]*|naci[a-z]*|ubicad[oa]s?|otr[oa]s?|antes|anterior[a-z]*|retir[a-z]*|busc[a-z]*|ir|voy|vamos|pas[a-z]*|ustedes|su|sus|no|ni|sin|tampoco|vez|lugar)(?![a-z])/;
const DEST_LEAD_RE = /^(?:(?:ah|ya|ok|okay|si|bueno|pero|y|entonces|ahora|hola|perdon)\s+)*(mejor\s+)?(?:((?:lo|los|las|la|les)\s+(?:necesit|quier|requier|ocup|mand|envi|despach)[a-z]*\s+)|((?:(?:el|la)\s+(?:pedido|despacho|entrega|envio|obra|direccion)\s+)?(?:va|van|iria|irian|es|son|seria|serian|sera|seran|queda|quedan)\s+)|((?:que\s+)?sean?\s+))?(mejor\s+)?((?:en|a|al|para|hacia|hasta)\s+)?/;
const DEST_TAIL_RE = /(?:\s+(?:mejor|gracias|por favor|porfa))+$/;
const DEST_PREP_RE = /(?:^|\s)(?:para|a|al|en|hacia|hasta)\s+/g;
/** [RESUMEN] (ronda 5, C1) El texto escribe la comuna `name` con alguna mayuscula ("en Florida"). */
function capitalizedIn(text: string, name: string): boolean {
  const key = comparable(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return [...bareText(text).matchAll(new RegExp('(?<![\\p{L}])' + key + '(?![\\p{L}])', 'giu'))].some((m) => /\p{Lu}/u.test(m[0]));
}
function destinationComuna(statement: string, current: string | undefined): string | undefined {
  const found = new Set<string>();
  for (const raw of statement.slice(0, MAX_FACTS).split(CLAUSE_SPLIT_RE)) {
    const clause = comparable(raw ?? '').replace(/[^a-z0-9\s'\u2019.-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clause || DEST_BLOCK_RE.test(clause)) continue;
    const tail = DEST_TAIL_RE.exec(clause);
    const text = tail ? clause.slice(0, tail.index) : clause;
    const lead = DEST_LEAD_RE.exec(text);
    // Una comuna sola en una clausula necesita su marca ("mejor", "va", "es", "en"...): "Si, y Pudahuel" puede sumar otra.
    const marked = Boolean(lead && lead.slice(1).some(Boolean)) || Boolean(tail && /mejor/.test(tail[0]));
    const candidates = [...(marked && lead ? [text.slice(lead[0].length)] : []), ...[...text.matchAll(DEST_PREP_RE)].map((m) => text.slice(m.index + m[0].length))];
    for (const candidate of candidates) {
      const name = officialComuna(candidate.trim());
      if (name && (!isCommonWordComuna(name) || capitalizedIn(raw ?? '', name))) { found.add(name); break; }
    }
  }
  if (found.size !== 1) return undefined;
  const [name] = [...found];
  return name !== current && !negatesValue(statement, name) ? name : undefined;
}
/**
 * [RESUMEN] (ronda 5, C3) El uso dicho sin "para" despues del resumen: la clausula es un uso conocido ("Colegio", "Un
 * colegio"), "es un/una X", "uso: X" o "para X" con un uso de la lista (tambien "taller", que no es PROYECTO_RE). Una
 * palabra suelta que no es un uso conocido no cuenta. Con dos usos distintos, ninguno.
 */
const USE_NOUNS = 'quincho|terraza|patio|living|comedor|dormitorio|habitacion|cocina|bano|jardin infantil|jardin|bodega|oficina|casa|local comercial|local|galpon|faena|tienda|exterior|interior|planta|fabrica|nave industrial|departamento|depto|edificio|colegio|hospital|estacionamiento|pasillo|sala|taller|restaurante|restaurant|gimnasio|hotel|iglesia|cancha|estadio|condominio|escuela|liceo|supermercado|minimarket|almacen|negocio|clinica|consultorio|hostal|cabana|piscina|parque|plaza|salon|club|universidad|instituto|industria';
const USE_STOP = '(?:en|para|y|e|con|pero|que|porque|ya|no|esta|estan|es|son|era|queda|quedan|va|van|tiene|tienen|necesito|vive|desde|a|al|de\\s+mi|gracias)';
const USE_CLAUSE_RE = new RegExp('^(?:(?:si|ok|bueno|pero|y|ah|ahora|entonces|no|mejor|perdon|corrijo)\\s+)*'
  + '(?:(?:el\\s+)?uso\\s*(?::\\s*|\\s+es\\s+(?:para\\s+)?|\\s+)|(?:es|son|seria|serian|sera|seran)\\s+(?:para\\s+)?|para\\s+)?'
  + '(?:(?:un|una|unos|unas|el|la|los|las|mi|mis|nuestr[oa]s?)\\s+)?'
  + '((?:' + USE_NOUNS + ')(?:es|s)?(?:\\s+(?!' + USE_STOP + '(?![a-z]))[a-z]+){0,3})$');
const USE_WORD_RE = new RegExp('^(?:' + USE_NOUNS.split('|').filter((w) => !/\s/.test(w)).join('|') + ')(?:es|s)?$');
function summaryUseValue(text: string): string | undefined {
  const found = new Map<string, string>();
  const clauses = text.slice(0, MAX_FACTS).split(CLAUSE_SPLIT_RE).map((raw) => (raw ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Las clausulas de cortesia ("Si", "gracias") no cuentan.
  const content = clauses.filter((clause) => leftoverTokens(clause).some((t) => !fillerToken(t))).length;
  for (const original of clauses) {
    const bare = bareText(original).toLowerCase();
    if (!original || bare.length !== original.length) continue;
    let end = bare.replace(/(?:[\s.!]|\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\uFE0F|\u200D)+$/u, '').length;
    let clause = bare.slice(0, end);
    const place = /^(.*?)\s+en\s+(.+)$/.exec(clause);
    if (place && officialComuna(place[2])) { end = place[1].length; clause = place[1]; }
    const m = USE_CLAUSE_RE.exec(clause);
    // El uso sin "es", "son", "uso" ni "para" ("Colegio", "Un colegio") cuenta solo si es el mensaje entero: "son 3
    // dormitorios y el living" describe la obra.
    if (!m || (content > 1 && !/^(?:(?:si|ok|bueno|pero|y|ah|ahora|entonces|no|mejor|perdon|corrijo)\s+)*(?:(?:el\s+)?uso\b|es\b|son\b|seria|serian|sera|seran|para\b)/.test(clause))) continue;
    const value = original.slice(end - m[1].length, end).trim();
    found.set(comparable(value), value);
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
}
/**
 * [RESUMEN] (ronda 5, C5) En un pedido de varios items, las cantidades dichas por item ("En vez de 5 paneles, 8 paneles",
 * "No son 12 focos, son 15", "Los focos son 15 y los paneles 8", "Que sean 15 focos"): la lista capturada con esas
 * cantidades. Cada numero va con su item: el que lo sigue ("15 focos"), el que lo antecede ("los focos son 15") o, si es
 * el unico numero, el unico item que nombra el mensaje ("No son 12 focos, son 15"). 'unmapped' si un numero no calza con
 * un solo item capturado (otra unidad, "10 rollos de 5 metros", o un numero solo): nunca se inventa un item.
 */
const PACKAGING_RE = /^(?:rollos?|cajas?|paquetes?|packs?|bolsas?|kits?|sets?|piezas?)$/;
const LINK_SKIP = new Set(['de', 'los', 'las', 'el', 'la']);
const LINK_BACK_SKIP = new Set(['son', 'sean', 'serian', 'seran', 'seria', 'sera', 'es', 'eran', 'de', 'que', 'mejor', 'ahora', 'solo']);
function quantityLinks(text: string): Array<{ n: string; noun?: string }> {
  const tokens = withoutNonQuantities(text).split(/[^a-z0-9]+/).filter(Boolean);
  const isNoun = (t: string | undefined) => Boolean(t && !/\d/.test(t) && (itemsIn(t).length > 0 || PACKAGING_RE.test(t)));
  const nounBefore = (i: number) => {
    let k = i - 1;
    while (k >= 0 && k >= i - 3 && LINK_BACK_SKIP.has(tokens[k])) k--;
    return k >= 0 && isNoun(tokens[k]) ? tokens[k] : undefined;
  };
  const nounAfter = (i: number) => {
    let j = i + 1;
    while (j < tokens.length && j <= i + 2 && LINK_SKIP.has(tokens[j])) j++;
    return isNoun(tokens[j]) ? tokens[j] : undefined;
  };
  const numbers = tokens.map((t, i) => (/^\d{1,5}$/.test(t) ? i : -1)).filter((i) => i >= 0);
  // "Los focos son 15 y los paneles 8" o "focos 15 paneles 8": el producto va antes del numero en todo el mensaje. Se usa
  // la forma que da un producto a cada numero; con las dos, el numero antes ("15 focos").
  const after = numbers.map((i) => nounAfter(i));
  const before = numbers.map((i) => nounBefore(i));
  const nounFirst = before.every(Boolean) && !after.every(Boolean);
  return numbers.map((i, k) => ({ n: String(Number(tokens[i])), noun: nounFirst ? before[k] : after[k] }));
}
function itemQuantities(assertive: string, facts: string, pairs: string[]): string | 'unmapped' | undefined {
  const links = quantityLinks(assertive);
  if (!links.length || pairs.length < 2) return links.length ? 'unmapped' : undefined;
  const words = pairs.map((pair) => productWords(pair.replace(/^\S+\s+/, '')));
  const pairOf = (noun: string) => {
    const hits = words.map((w, i) => (w.includes(stem(comparable(noun))) ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : -1;
  };
  if (links.length === 1 && !links[0].noun) {
    const named = [...new Set(itemsIn(facts).map((noun) => stem(comparable(noun))))];
    if (named.length === 1) links[0].noun = named[0];
  }
  const next = pairs.map((pair) => /^\S+/.exec(pair)?.[0] ?? '');
  const set = new Set<number>();
  for (const link of links) {
    const at = link.noun ? pairOf(link.noun) : -1;
    if (at < 0 || set.has(at)) return 'unmapped';
    set.add(at);
    next[at] = link.n;
  }
  if (next.every((n, i) => n.replace(/\./g, '') === (/^\S+/.exec(pairs[i])?.[0] ?? '').replace(/\./g, ''))) return undefined;
  const items = pairs.map((pair, i) => next[i] + pair.replace(/^\S+/, ''));
  return items.length === 2 ? items.join(' y ') : items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
}
/** [RESUMEN] (ronda 5, C7) La cantidad en otra unidad de venta ("2 cajas", "3 rollos") que no es la del producto capturado. */
function packagingOnly(assertive: string, producto: string | undefined): boolean {
  const own = productWords(producto ?? '');
  return quantityLinks(assertive).some((link) => Boolean(link.noun && PACKAGING_RE.test(link.noun) && !own.includes(stem(link.noun))));
}

/**
 * [CIERRE-HONESTO] Conversacion cerrada sin resultado de Pipedrive. Lo que llega se suma a lo
 * capturado (por ejemplo, el nombre y despues el correo) y, con correo, se registra la solicitud.
 * Si el correo ya estaba, un intento anterior no dejo resultado (se corto, o no termino dentro de
 * la espera de webhook.ts): se reintenta y se responde el cierre normal, nunca otro "ya derive".
 * [RESUMEN] El primer registro de productos (llega el correo) responde el resumen, como el cierre de las etapas; el
 * reintento (ya habia correo: el resumen pudo salir, y un "si" mientras se registra) responde MSG4.
 */
function continueClosedWithoutDeal(phone: string, state: FlowState, body: string, claudeParsed: ClaudeFields): StepResult {
  const hadEmail = Boolean(flowEmail(state));
  const installMerged = state.isInstallFlow ? mergeInstallFields(state.captured, body, claudeParsed, answersComuna(state)) : undefined;
  const late = installMerged
    ? { merged: installMerged, leadType: installLeadType(state, body, claudeParsed, installMerged) }
    : mergeProductFields(state, body, claudeParsed);
  const captureStatus = state.isInstallFlow ? computeInstallCaptureStatus(late.merged) : computeCaptureStatus(late.merged, late.leadType);
  const next: FlowState = { ...state, captured: late.merged, captureStatus, leadType: late.leadType };
  saveFlowState(phone, next);
  const registers = Boolean(flowEmail(next));
  if (registers) console.log('[flowEngine] conversacion cerrada con correo y sin negocio \u2014 registrando' + (hadEmail ? ' (reintento)' : ''));
  let reply = closedReply(next);
  let question: LastQuestion | undefined;
  if (registers) {
    if (hadEmail) reply = registeredClosing();
    else if (next.isInstallFlow) reply = installClosingMsg(late.merged);
    else ({ reply, question } = productClosing(phone, next, true, next.wantsHuman));
  }
  // [PREGUNTA] Se contesta lo que pregunta antes de pedir el correo o de cerrar (caso de las estacas: "Sabes cuando
  // demora el despacho" recibia otra vez la peticion del correo). Sin correo, el precio o la consulta tecnica piden
  // el correo con su texto aprobado.
  const kinds = questionKinds(body);
  const install = Boolean(next.isInstallFlow);
  const asksEmail = !registers && !state.deal && !install ? questionAsksEmail(kinds) : undefined;
  if (asksEmail) reply = withAnswers(questionAnswers(kinds, false, install), asksEmail);
  else reply = withAnswers(questionAnswers(kinds, registers, install), reply);
  return { reply, shouldCreateDeal: registers, shouldNotify: false, captureStatus, captured: late.merged, wantsHuman: next.wantsHuman, closedFlow: true, ...(question ? { question } : {}) };
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
    return { reply: registeredClosing(), shouldCreateDeal: true, shouldNotify: false, captureStatus: state.captureStatus, captured, wantsHuman: state.wantsHuman, closedFlow: true, rutUpdate: true };
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
  return { reply: registeredClosing(), shouldCreateDeal: true, shouldNotify: false, captureStatus, captured, wantsHuman: next.wantsHuman, closedFlow: true, rutUpdate: true };
}

/** [REINICIO] Los productos que nombra el texto: los de la regla, los items y el de Claude si esta en el texto. */
function namedProducts(facts: string, claudeParsed: ClaudeFields): string[] {
  const claudeProd = claudeText(claudeParsed.producto);
  return [extractProducto(facts), ...itemsIn(facts), claudeProd && inMessage(claudeProd, facts) ? claudeProd : undefined]
    .filter((p): p is string => Boolean(p) && productWords(p as string).length > 0);
}
/**
 * [REINICIO] El mismo producto: comparten una palabra del modelo que no es solo la familia ni una medida ("ufo"), sin
 * otra medida ("campanas UFO 200W" no es la "UFO 100W"; "reflectores 40W" no es el "panel 60x60 40W"), o todas sus
 * palabras ya estaban ("focos LED" otra vez).
 */
function sameProduct(named: string[], producto: string): boolean {
  const own = productWords(producto);
  return named.some((p) => {
    const words = productWords(p);
    if (words.every((w) => own.includes(w))) return true;
    return words.some((w) => own.includes(w) && !GENERIC_PRODUCT_STEMS.has(w) && !/\d/.test(w))
      && words.every((w) => !/\d/.test(w) || own.includes(w));
  });
}

/**
 * [REINICIO] El mensaje despues del cierre abre otro pedido: lo que antes era un pedido nuevo (looksLikeNewRequest),
 * salvo pedir un vendedor sin nombrar un producto con el negocio registrado, no nombrar producto ni cantidad ("quiero
 * ese articulo, como lo compro?") o nombrar el mismo producto ya capturado ("campana Ufo 100W ... 5700k" es la
 * "Luminaria UFO 100W" de antes, con otro color).
 * [RESUMEN] summaryReply: el mensaje contesta el resumen. Otro producto, otra cantidad u otra comuna lo corrigen o se
 * suman (lateChange): solo abre otro pedido el que nombra otra cotizacion u otro proyecto (la regla de la ronda 3, "Quiero
 * agregar 10 paneles LED a la nueva cotizacion") o uno demasiado largo.
 */
function opensNewRequest(body: string, state: FlowState, claudeParsed: ClaudeFields, summaryReply = false): boolean {
  if (!looksLikeNewRequest(body)) return false;
  // Nombrar una cotizacion ("la nueva cotizacion para Quilicura") u otro proyecto ("mi nuevo proyecto") sigue la regla
  // anterior (PR 142, ronda 3), y un mensaje demasiado largo para leerlo entero tambien; "ya me cotizaron" habla de
  // la que ya existe.
  const plain = body.replace(/(?:https?:\/\/|www\.)\S*/gi, ' ').replace(EMAIL_RE_ALL, ' ');
  if (body.length > MAX_FACTS || OTHER_ORDER_RE.test(plain)) return true;
  const captured = state.captured;
  const facts = maskNegated(factsText(body, claudeParsed));
  const named = namedProducts(facts, claudeParsed);
  if (QUOTE_WORD_RE.test(plain)) {
    // [RESUMEN] (revision 16-11) Un "si" con "quiero cotizar eso" o "necesito el presupuesto" confirma el resumen: abre
    // otro pedido la cotizacion nueva u otra ("Mi nueva cotizacion:", "la otra cotizacion"), otra cantidad u otro producto.
    // Lo demas sigue como antes: "Me pueden cotizar 30 focos mas?" es otro pedido.
    if (!summaryReply || OTHER_QUOTE_RE.test(plain) || !SUMMARY_YES_LEAD_RE.test(summaryAnswerText(body))) return true;
    const asked = readQuantity(facts);
    return asked.value !== undefined || asked.several || (named.length > 0 && (!captured.producto || !sameProduct(named, captured.producto)));
  }
  // [RESUMEN] Al contestar el resumen, lo demas corrige o suma (lateChange).
  if (summaryReply) return false;
  const quantity = readQuantity(facts);
  // Sin negocio registrado, pedir un vendedor empieza otra conversacion como antes: alli lo atiende el atajo del
  // ejecutivo (wantsHuman), que registra con el correo siguiente.
  if (!named.length && (WANTS_HUMAN_RE.test(body) || EXECUTIVE_RE.test(body))) return state.deal !== 'registered';
  if (!named.length && quantity.value === undefined && !quantity.several) return false;
  if (!captured.producto || !named.length) return true;
  if (!sameProduct(named, captured.producto)) return true;
  const own = productWords(captured.producto);
  // (revision 13-11) Otra medida en cualquiera de los nombres es otro producto, aunque la familia ("campanas") coincida:
  // "10 campanas UFO 200W" despues de "10 campanas UFO 100W".
  if (named.some((p) => productWords(p).some((w) => /\d/.test(w) && !own.includes(w)))) return true;
  // (revision 13-11) El mismo producto para otra comuna es otro pedido, como en main ("Ahora necesito 10 campanas UFO
  // 100W para un galpon en Quilicura"), salvo que la corrija.
  const place = officialComuna(captured.comuna_o_ciudad);
  const places = findComunas(facts);
  if (place && places.length && !places.includes(place) && !correctsCaptured(body, captured, places[0])) return true;
  // (revision 12-11) El mismo producto con otra cantidad es otro pedido ("Ahora necesito 10 focos LED para la casa de
  // mi mama en Pirque"), como en main, salvo que corrija la que ya estaba ("Corrijo: son 10", "20 focos, no 12").
  const other = quantity.value !== undefined && captured.cantidad !== undefined && String(quantity.value) !== captured.cantidad;
  return other && !correctsCaptured(body, captured, String(quantity.value));
}

// [REINICIO] (revision 12-11) Despues del cierre, un dato ya registrado cambia solo si el mensaje lo corrige: con
// palabra de correccion ("corrijo", "perdon, son", "mejor", "en vez de"), con un "definitivamente", "en realidad" o
// "al final" (negocio 145), o negando el dato anterior ("20 focos LED, no 12"). "Gracias, mi otra casa esta en
// Pirque" o "son 3 dormitorios y el living" son comentarios.
// (fase 3B, revision 16-11) "me confundi" tambien con tilde en la i.
const LATE_CORRECTION_RE = /(?<![a-z\u00e0-\u00fc])(?:definitiv[a-z]*|en\s+realidad|al\s+final|finalmente|actualiz[a-z]*|modific[a-z]*|cambi[a-z]*|quise\s+decir|quer[i\u00ed]a\s+decir|me\s+confund[a-z\u00e0-\u00fc]*)(?![a-z\u00e0-\u00fc])/i;
// (revision 13-11) "definitivamente", "al final" o "finalmente" corrigen solo el dato (`value`) que traen en su misma
// oracion: "Gracias, finalmente me respondieron. Mi otra casa esta en Pirque" no cambia la comuna; "La comuna
// definitiva es Pirque" si.
// (ronda 4, C) "para cambiar los del patio", "para reemplazar los focos" o "con cambio de color" piden algo: no corrigen
// un dato (como SUMMARY_CHANGE_RE).
function correctsCaptured(body: string, captured: CapturedFields, value?: unknown): boolean {
  const text = body.slice(0, MAX_FACTS).replace(PURPOSE_CHANGE_RE, ' ');
  if (CORRECTION_RE.test(text) || PRODUCT_SWITCH_RE.test(text)) return true;
  if (text.split(/[.;!?\n]+/).some((part) => LATE_CORRECTION_RE.test(part) && mentionsValue(part, value))) return true;
  // (ronda 4, B1) Negar el dato capturado, en cualquiera de sus formas (negatesValue); tambien el uso ("No es oficina").
  return [captured.cantidad, captured.comuna_o_ciudad, captured.tipo_de_luz, captured.proyecto_o_uso].some((v) => negatesValue(text, v));
}
const PURPOSE_CHANGE_RE = /(?<![a-z\u00e0-\u00fc])(?:(?:para|con|por)\s+(?:(?:el|un|los|las|la)\s+)?(?:cambi|reemplaz|renov|sustitu)[a-z\u00e0-\u00fc]*|cambi[a-z\u00e0-\u00fc]*\s+de\s+(?:colou?r(?:es)?|temperatura|luz|tono|tonalidad))(?![a-z\u00e0-\u00fc])/gi;
/**
 * [REINICIO] (ronda 4, B1) El mensaje niega el dato capturado (`value`), sin tildes ni mayusculas: delante ("no 12", "no
 * son 12", "no es en Maipu", "no en Maipu", "ni Maipu"), detras con su pausa ("Maipu no, La Florida", "en Maipu no."),
 * o con "en vez de" / "en lugar de" ("en vez de Maipu es Pudahuel").
 */
function negatesValue(text: string, value: string | undefined): boolean {
  if (!value || !value.trim()) return false;
  const plain = comparable(text);
  const own = '(?<![a-z0-9])' + comparable(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])';
  const lead = '(?:(?:en|a|al|para|de|del|el|la|los|las|un|una)\\s+){0,2}';
  return new RegExp('(?<![a-z0-9])(?:no|ni)\\s+(?:(?:son|eran|es|era|sea|sean|seria|serian|va|iba|queda|quedaba)\\s+)?' + lead + own).test(plain)
    || new RegExp(own + '\\s*,?\\s+no(?:\\s*[,.;:!]|\\s*$)').test(plain)
    || new RegExp('(?<![a-z0-9])en\\s+(?:vez|lugar)\\s+de\\s+' + lead + own).test(plain);
}

function mentionsValue(part: string, value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  const v = comparable(value);
  if (/^\d+$/.test(v)) return new RegExp('(?<![0-9])' + v + '(?![0-9])').test(comparable(part));
  return comparable(part).includes(v) || sharesWord(value, part);
}

const OTHER_ORDER_RE = /(?<![a-z\u00e0-\u00fc])(?:nuev|otr)[oa]s?\s+(?:proyecto|obra|pedido|solicitud|requerimiento|compra)/i;
// [RESUMEN] El uso dicho como uso, y el lugar que no es el del pedido ("mi otra casa", "el otro local").
const SUMMARY_USE_RE = /(?<![a-z\u00e0-\u00fc])para\s+\S/i;
// [RESUMEN] (revision 16-11) Lo que no corrige el resumen aunque traiga un dato: lo que puede pasar mas adelante ("a lo
// mejor 5 mas el proximo mes", "tambien podria ser luz calida", "despues pida 10 mas") y lo que se suma al pedido sin
// reemplazar nada ("Si, y los de la bodega son 10", "Tambien tengo una bodega en Quilicura").
const SUMMARY_HEDGE_RE = /(?<![a-z\u00e0-\u00fc])(?:a\s+lo\s+mejor|quiz[a\u00e1]s?|tal\s+vez|podr[i\u00ed]a(?:n|mos)?|puede\s+que|posiblemente|probablemente|eventualmente|despu[e\u00e9]s|m[a\u00e1]s\s+adelante|pr[o\u00f3]xim[oa]s?|luego|futur[oa]s?)(?![a-z\u00e0-\u00fc])/i;
const SUMMARY_ADDITIVE_RE = new RegExp(ADDITION_WORD_RE.source, 'i');
const YES_WORDS = '(?:si|ok|okay|correcto|esta bien|perfecto|dale|de acuerdo|todo bien|\\u{1F44D})';
// El mensaje empieza confirmando el resumen (sobre summaryAnswerText: sin tildes, mayusculas ni signos).
const SUMMARY_YES_LEAD_RE = new RegExp('^' + YES_WORDS + '(?: |$)', 'u');
const SUMMARY_YES_AND_RE = new RegExp('^(?:' + YES_WORDS + ' )+y ', 'u');
// [RESUMEN] (revision 16-11) Otro producto en lugar del capturado, sin palabra de correccion de CORRECTION_RE: "en
// realidad", "al final", "quise decir", "me confundi", "error mio", "eran 20 focos LED".
const SUMMARY_SWITCH_RE = /(?<![a-z\u00e0-\u00fc])(?:definitiv[a-z]*|en\s+realidad|al\s+final|finalmente|quise\s+decir|quer[i\u00ed]a\s+decir|me\s+confund[a-z\u00e0-\u00fc]*|me\s+equivoqu[a-z\u00e0-\u00fc]*|error\s+m[i\u00ed]o|mi\s+error|eran?)(?![a-z\u00e0-\u00fc])/i;
// [RESUMEN] (revision 17-11) Las otras palabras de cambio de LATE_CORRECTION_RE: "Cambio: ...", "Lo cambio por",
// "Cambio a", "Modifico:", "Actualizo: son". No "para cambiar los del patio" ni "con cambio de color", que piden algo.
const SUMMARY_CHANGE_RE = /(?<![a-z\u00e0-\u00fc])(?:actualiz[a-z]*|modific[a-z]*|(?<!\b(?:para|con)\s+)cambi[a-z]*(?![a-z\u00e0-\u00fc])(?!\s+de\s+(?:colou?r(?:es)?|temperatura|luz|tono|tonalidad)))(?![a-z\u00e0-\u00fc])/i;
// [RESUMEN] (revision 17-11) "Son ..." al inicio dice cual es el pedido ("Son 20 focos LED"): no suma otro item.
const SUMMARY_IS_RE = /^\s*son\s/i;
// [RESUMEN] (revision 17-11) "pero mejor 25" corrige como "mejor 25" (CORRECTION_RE lo pide al inicio de una frase); "a
// lo mejor 5 mas" no.
const SUMMARY_BETTER_RE = /(?<![a-z\u00e0-\u00fc])(?<!\blo\s+)mejor\s+(?:\d|son\b|que\s+sean|ser[i\u00ed]an)/i;
// [RESUMEN] (revision 16-11) La respuesta que es solo una comuna: "Pudahuel", "en Pudahuel", "Es en Pudahuel", "No,
// Pudahuel", "La comuna es Pudahuel". "Mi cunado vive en Pirque" o "estoy en Santiago" no contestan el resumen.
// (revision 17-11, ronda 3) Tambien con un saludo, un "gracias" o un "pero" delante ("Hola, es en Pudahuel", "Si, pero
// en Pudahuel"), con "y es" ("Si, y es en Pudahuel"; "Si, y Pudahuel" puede sumar otra y no cuenta), con "la direccion
// es" ("La direccion es en Pudahuel") y con la cortesia o un emoji al final ("Pudahuel, gracias", "Pudahuel por favor").
const COMUNA_REPLY_LEAD_RE = /^\s*(?:(?:no|s[i\u00ed]|ok|okay|bueno|perd[o\u00f3]n|corrijo|correcci[o\u00f3]n|ahora|hola|buen[oa]s(?:\s+(?:d[i\u00ed]as|tardes|noches))?|(?:muchas\s+)?gracias|pero)[\s,.:;!]+)*(?:la\s+direcci[o\u00f3]n\s*(?::\s*|\s+))?(?:(?:y\s+)?(?:es|ser[i\u00ed]a|queda)\s+)?(?:(?:en|a|para)\s+)?(?:(?:la\s+)?(?:comuna|ciudad)\s*(?::\s*|\s+(?:es\s+|de\s+)?))?/i;
const COMUNA_REPLY_TAIL_RE = /(?:[\s,.;:!\u00a1]|(?<![\p{L}])(?:(?:muchas\s+)?gracias|por\s+favor|porfa(?:vor)?|porfis|saludos)(?![\p{L}])|\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\uFE0F|\u200D)+$/iu;
function comunaReply(facts: string): boolean {
  return replyComunaName(facts) !== undefined;
}
/** [RESUMEN] La comuna del mensaje que es solo una comuna (comunaReply). */
function replyComunaName(facts: string): string | undefined {
  if (facts.length > 160) return undefined;
  return officialComuna(facts.replace(COMUNA_REPLY_LEAD_RE, '').replace(COMUNA_REPLY_TAIL_RE, ''));
}
// [RESUMEN] (revision 16-11) Un numero solo ("30", "No, 30") contesta el resumen con la cantidad.
const BARE_NUMBER_RE = /^\s*(?:no\s*[,.]?\s*)?\d{1,3}(?:\.\d{3})*\s*[.!]*\s*$/i;
const OTHER_PLACE_RE = /(?<![a-z\u00e0-\u00fc])otr[oa]s?\s+(?:casas?|locale?s?|oficinas?|bodegas?|obras?|sucursal(?:es)?|propiedad(?:es)?|direcci[o\u00f3]n|lugar(?:es)?|parcelas?|departamentos?|deptos?|galpon(?:es)?|tiendas?|sedes?|plantas?)(?![a-z\u00e0-\u00fc])/i;
const QUOTE_WORD_RE = /cotizaci[o\u00f3]n|presupuesto|cotizar(?![a-z\u00e0-\u00fc])/i;
const OTHER_QUOTE_RE = /(?<![a-z\u00e0-\u00fc])(?:nuev|otr)[oa]s?(?![a-z\u00e0-\u00fc])/i;
const QTY_FIELDS = ['cantidad', 'cantidad_varios', 'cantidad_unidad'] as const;
const LATE_FIELDS = ['producto', 'tipo_de_luz', 'cantidad', 'cantidad_varios', 'cantidad_unidad', 'proyecto_o_uso', 'comuna_o_ciudad', 'comunas_otras'] as const;

// [RESUMEN] (ronda 4, C) La cortesia y el emoji alrededor del dato ("25, gracias", "25 \u{1F44D}", "30 por favor", "Hola,
// 25"): el mismo limpiador de comunaReply, para todo el mensaje que contesta el resumen. "Perdon" se queda: corrige.
const COURTESY_LEAD_RE = /^\s*(?:(?:hola|buen[oa]s(?:\s+(?:d[i\u00ed]as|tardes|noches))?|(?:muchas\s+)?gracias)[\s,.:;!\u00a1]+)+/iu;
function courtesyFree(body: string): string {
  return body.replace(COMUNA_REPLY_TAIL_RE, '').replace(COURTESY_LEAD_RE, '').trim() || body;
}
// [RESUMEN] (ronda 4, B2) "Si, 30", "si pero 30", "ok, 30", "Esta bien, pero 25", "Si. Que sean 30": la aceptacion delante
// de un dato que empieza con un numero sale, y el resto contesta el resumen (en un pedido de un item, un numero solo es la
// cantidad). "Si, y 10 mas" no (F7: no se suma; queda textual en la nota).
const ACCEPT_LEAD_RE = /^\s*(?:s[i\u00ed]|ok(?:ay|ey)?|correcto|est[a\u00e1]\s+bien|perfecto|dale|de\s+acuerdo|todo\s+bien)(?![\p{L}])[\s,.;:!]*(?:pero(?![\p{L}])[\s,]*)?(?:(?:y\s+)?que\s+sean?(?![\p{L}])\s*)?(?=\d)/iu;
/** [RESUMEN] (ronda 4, B2 y C) El mensaje que contesta el resumen, sin la aceptacion delante del numero ni la cortesia. */
function summaryData(body: string): string {
  const accept = ACCEPT_LEAD_RE.exec(body);
  return courtesyFree(accept ? body.slice(accept[0].length) : body);
}
// [RESUMEN] (ronda 4, C) "No esta bien la cantidad", "la cantidad esta mal", "La comuna esta mal", "la cantidad": dice que
// dato esta mal sin dar el correcto, como el "no" solo (sobre summaryAnswerText).
const SUMMARY_FIELD_WORDS = '(?:(?:la|el|los|las) )?(?:cantidad(?:es)?|metros|unidades|numero|productos?|colou?r|luz|tipo de luz|uso|proyecto|comuna|direccion|ciudad|lugar)';
const SUMMARY_WRONG_WORDS = '(?:esta mal|estan mal|no esta bien|no estan bien|esta incorrect[ao]|es incorrect[ao]|no es correct[ao]|no corresponde|mal|incorrect[ao])';
const SUMMARY_FIELD_NO_RE = new RegExp('^(?:no )?(?:' + SUMMARY_WRONG_WORDS + ' )?' + SUMMARY_FIELD_WORDS + '(?: ' + SUMMARY_WRONG_WORDS + ')?$');
/**
 * [RESUMEN] (ronda 6, B) Los datos del resumen que el mensaje rechaza por su nombre, sin mayusculas ni tildes: el campo
 * (comuna, lugar, luz, color, tipo de luz, cantidad, uso, producto) o el sustantivo de un item registrado (paneles,
 * focos) con negacion o excepcion: "La comuna no", "No es esa comuna", "Esa no es la comuna", "La comuna es otra", "Es
 * otra comuna", "Otro color", "Todo bien salvo la luz", "Si, pero la comuna no", "La cantidad no es esa". Devuelve cada
 * campo rechazado con su palabra y el texto sin esas frases (`rest`), para ver si el mensaje trae otro dato.
 */
type RejectedGroup = 'tipo_de_luz' | 'comuna_o_ciudad' | 'cantidad' | 'proyecto_o_uso' | 'producto';
const REJECT_GROUP_FIELDS: Record<RejectedGroup, Array<keyof CapturedFields>> = {
  tipo_de_luz: ['tipo_de_luz'],
  comuna_o_ciudad: ['comuna_o_ciudad'],
  cantidad: ['cantidad', 'cantidad_varios'],
  proyecto_o_uso: ['proyecto_o_uso'],
  producto: ['producto', 'cantidad', 'cantidad_varios'],
};
// En este orden: la frase mas larga antes ("tipo de luz" antes que "luz").
const REJECT_FIELD_NAMES: Array<[string, RejectedGroup]> = [
  ['tipo de luz', 'tipo_de_luz'], ['temperatura de color', 'tipo_de_luz'], ['temperatura', 'tipo_de_luz'], ['colores', 'tipo_de_luz'],
  ['color', 'tipo_de_luz'], ['colour', 'tipo_de_luz'], ['luz', 'tipo_de_luz'], ['comuna', 'comuna_o_ciudad'], ['ciudad', 'comuna_o_ciudad'],
  ['lugar', 'comuna_o_ciudad'], ['direccion', 'comuna_o_ciudad'], ['destino', 'comuna_o_ciudad'], ['cantidades', 'cantidad'],
  ['cantidad', 'cantidad'], ['metros', 'cantidad'], ['unidades', 'cantidad'], ['numero', 'cantidad'], ['uso', 'proyecto_o_uso'], ['proyecto', 'proyecto_o_uso'], ['productos', 'producto'], ['producto', 'producto'],
];
const REJECT_ARTICLE = '(?:(?:la|el|los|las|esa|ese|esos|esas|esta|este|estos|estas|mi|su|tu) )?';
const REJECT_END = '(?= [,.;:!?]| y | pero | e | o |$)';
function rejectedFields(text: string, captured: CapturedFields): { fields: Array<{ group: RejectedGroup; word: string }>; rest: string } {
  let plain = ' ' + comparable(text.slice(0, MAX_FACTS)).replace(/[^a-z0-9,.;:!?\s]+/g, ' ').replace(/([,.;:!?])/g, ' $1 ').replace(/\s+/g, ' ').trim();
  const fields: Array<{ group: RejectedGroup; word: string }> = [];
  // Los sustantivos de los items registrados ("los paneles no"); "otros paneles" suma, no rechaza.
  const own = new Set([...itemsIn(captured.producto ?? ''), ...itemsIn(captured.cantidad_varios ?? '')].map((noun) => stem(comparable(noun))));
  const nouns = [...new Set(itemsIn(plain).map((noun) => comparable(noun)))].filter((noun) => own.has(stem(noun)));
  const names: Array<[string, RejectedGroup, boolean]> = [
    ...REJECT_FIELD_NAMES.map(([word, group]): [string, RejectedGroup, boolean] => [word, group, true]),
    ...nouns.map((noun): [string, RejectedGroup, boolean] => [noun, 'producto', false]),
  ];
  for (const [word, group, fieldName] of names) {
    const f = REJECT_ARTICLE + word;
    const patterns = [
      ' ' + f + ' (?:no|tampoco)' + REJECT_END,
      ' ' + f + ' (?:no (?:es|son|esta|estan|corresponde|corresponden|va|van)|tampoco)(?: (?:esa|ese|esas|esos|asi|correct[ao]s?|bien|la correcta|el correcto))?' + REJECT_END,
      ' (?:no (?:es|son|era|eran)|tampoco) (?:esa|ese|esas|esos|esta|este|la|el|los|las|mi|su) ' + word + REJECT_END,
      ' (?:esa|ese|eso|esta|este|esas|esos) no (?:es|son) ' + f + REJECT_END,
      ' ' + f + ' (?:es|son|era|eran) otr[oa]s?' + REJECT_END,
      ' ' + f + ' (?:(?:esta|estan|es|son) )?(?:mal|incorrect[ao]s?|equivocad[ao]s?)' + REJECT_END,
      ' (?:salvo|excepto|menos|excepcion de|aparte de) (?:por )?' + f + REJECT_END,
      // "Otro color", "Es otra comuna", "Si, pero otra comuna"; "Mi cunado vive en otra comuna" no.
      ...(fieldName ? ['(?:^| [,.;:!?]| si| pero| es| son| y| no| sea| seria) otr[oa]s? ' + word + REJECT_END] : []),
      // (ronda 7, B2) Las otras formas de rechazo, error o cambio con el nombre del campo: "La comuna, no", "No es esa la
      // comuna", "No era esa la comuna", "No es en esa comuna", "No es asi la cantidad", "Es otra la comuna", "La comuna es
      // distinta", "Hay que cambiar la comuna", "Corrige la comuna", "Me equivoque en la comuna", "Hay un error en la cantidad".
      ' ' + f + ' , (?:no|tampoco)' + REJECT_END,
      ' (?:no|tampoco) (?:es|son|era|eran) (?:esa|ese|esas|esos|esta|este|estas|estos|asi) ' + REJECT_ARTICLE + word + REJECT_END,
      ' (?:no|tampoco) (?:es|son|era|eran|va|van|iba|queda|quedaba) (?:en|a|al|para|de|del) ' + REJECT_ARTICLE + word + REJECT_END,
      ' (?:es|son|era|eran) otr[oa]s? (?:la|el|los|las) ' + word + REJECT_END,
      ' ' + f + ' (?:es|son|era|eran|esta|estan) (?:distint[ao]s?|diferentes?|equivocad[ao]s?|errone[ao]s?)' + REJECT_END,
      ' (?:hay que |tengo que |tienes que |hay q )?(?:cambi(?:a|ar|en|e|ame|ale|alo|ala)|corregir|corrige|corrijan?|modific(?:a|ar|ar|alo|ala)) ' + REJECT_ARTICLE + word + REJECT_END,
      ' (?:me )?(?:equivoque|equivoco|confundi|confundo) (?:en|con) ' + REJECT_ARTICLE + word + REJECT_END,
      ' (?:hay )?(?:un )?(?:error|problema) (?:en|con) ' + REJECT_ARTICLE + word + REJECT_END,
      ...(fieldName ? [
        // "Es en otra comuna", "Va a otra comuna", "Es para otra comuna", "Queda en otra comuna", "Es en otro lugar".
        '(?:^| [,.;:!?]| si| pero| y| no) (?:es|son|va|van|queda|quedan|sea|seria|era) (?:en|a|al|para|de) (?:otr[oa]s?|un[ao]? (?:distint[ao]|diferente)) ' + word + REJECT_END,
        // "Diferente comuna", "Distinta comuna", "Es una comuna distinta".
        '(?:^| [,.;:!?]| si| pero| y| no| es| son| sea| seria) (?:una |un )?(?:distint[ao]s?|diferentes?) ' + word + REJECT_END,
        ' (?:es|son|sea|seria) (?:una|un|otr[oa]) ' + word + ' (?:distint[ao]|diferente)' + REJECT_END,
      ] : [
        // "Son otros paneles" (sin numero ni palabra de suma): no son esos.
        '^ (?:no )?(?:son|eran) otr[oa]s? ' + word + REJECT_END,
      ]),
    ];
    let hit = false;
    for (const src of patterns) {
      if (!new RegExp(src).test(plain)) continue;
      hit = true;
      plain = plain.replace(new RegExp(src, 'g'), ' ,');
    }
    if (hit) fields.push({ group, word });
  }
  return { fields, rest: plain };
}
/**
 * [RESUMEN] (ronda 6, B) El mensaje rechaza un dato del resumen por su nombre y no trae ningun dato nuevo: es lo mismo que
 * "<dato> esta mal" (MSG_SUMMARY_FIX). El valor registrado del dato rechazado no es un dato nuevo ("La luz no es la neutra").
 */
// (ronda 7, A) Lo que no es contenido en el resto de un rechazo: la negacion, la excepcion, el cambio y el error, y el
// relleno chileno ("po"). Los nombres de campo tampoco ("La comuna no, el color").
const REJECT_REST_RE = /^(?:ni|tampoco|hay|q|tengo|tienes|distint[ao]s?|diferentes?|incorrect[ao]s?|equivocad[ao]s?|errone[ao]s?|menos|excepcion|aparte|problema|po|pos|poh|oiga|oye|mira|igual|cierto|nop|nope|noo+|sii+)$/;
function rejectsFieldWithoutData(body: string, captured: CapturedFields, claudeParsed: ClaudeFields): boolean {
  // Una pregunta con signo ("Y si es otra comuna?", "Seria otro color?") no rechaza: sigue closedFollowUp. "Hay un error
  // en la cantidad" sin signo si. (ronda 8) Tampoco un rechazo con una pregunta en el mismo mensaje ("Cambia la comuna.
  // Tienen ficha tecnica?", "La cantidad no, cuanto cuesta cada uno"): la pregunta sigue closedFollowUp, como en main.
  const statement = body.slice(0, MAX_FACTS);
  if (!statement.trim() || /[?\u00bf]/.test(statement) || questionKinds(statement).size > 0) return false;
  const { fields, rest } = rejectedFields(statement, captured);
  if (!fields.length) return false;
  const groupFields = fields.flatMap((x) => REJECT_GROUP_FIELDS[x.group]);
  // (ronda 7, A) Claude trae para el campo rechazado un valor distinto del registrado: el mensaje trae el dato.
  const parsed = claudeParsed as Record<string, unknown>;
  if (groupFields.some((field) => typeof parsed[field] === 'string' && (parsed[field] as string).trim() !== ''
    && comparable(parsed[field] as string) !== comparable(String(captured[field] ?? '')))) return false;
  const old = new Set(groupFields.flatMap((field) => leftoverTokens(String(captured[field] ?? ''))));
  // (ronda 7, A) Cualquier palabra con contenido en el resto ("Otro color: blanco", "La comuna no, es Stgo centro", "La
  // cantidad no, el doble") es un dato: sigue lateChange y la red de seguridad.
  return leftoverTokens(rest).filter((t) => !fillerToken(t) && !REJECT_REST_RE.test(t) && !FIELD_NAME_RE.test(t) && !old.has(t)).length === 0;
}
/**
 * [RESUMEN] (ronda 4, B4) Lo nuevo de "Y en vez de X" ("Necesito 20 focos LED en vez de paneles"), "en vez de X, Y" ("en
 * vez de 20 paneles, 20 focos LED"; "en vez de Maipu es Pudahuel"), "no X sino Y" o "no X, Y" ("No 20 paneles, 20 focos
 * LED"), sin lo descartado. Solo si las dos partes traen un dato (numero, producto, color o comuna); si no, nada.
 */
const INSTEAD_RE = /(?<![\p{L}])en\s+(?:vez|lugar)\s+de(?![\p{L}])/iu;
const INSTEAD_LEAD_RE = /^(?:(?:no|s[i\u00ed]|ok|bueno|perd[o\u00f3]n|corrijo|correcci[o\u00f3]n|hola|pero|y|entonces|ahora)(?:[\s,.:;!]+|$))*$/iu;
const INSTEAD_NEW_RE = /^(.+?)(?:\s*[,;:]\s*|\s+(?=(?:es|son|sean|ser[i\u00ed]an?|mejor|quiero|queremos|necesito|necesitamos)\s))(.+)$/iu;
const SINO_RE = /^(.*?)(?<![\p{L}])no\s+(.+?)\s*,?\s+sino(?:\s+que)?\s+(.+)$/iu;
const NO_COMMA_RE = /^\s*no\s+(?!(?:es|son|era|eran|est[a\u00e1]n?|sea|sean|s[e\u00e9]|hay|va|van|me|nos|se|lo|la|los|las|le|les|tengo|tenemos|necesito|necesitamos|quiero|queremos|importa|gracias|tanto)(?![\p{L}]))([^,;.]+?)\s*[,;]\s*(.+)$/iu;
function hasDatum(text: string): boolean {
  return /\d/.test(text) || itemsIn(text).length > 0 || Boolean(extractProducto(text)) || Boolean(textLuz(text)) || findComunas(text, { answering: true }).length > 0;
}
function insteadSplit(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  const pick = (dropped: string, fresh: string) => (hasDatum(dropped) && hasDatum(fresh) ? fresh.trim() : undefined);
  const instead = INSTEAD_RE.exec(flat);
  if (instead) {
    const before = flat.slice(0, instead.index).replace(/[\s,.;:]+$/, '');
    const after = flat.slice(instead.index + instead[0].length).trim();
    if (!INSTEAD_LEAD_RE.test(before)) {
      // "Necesito 20 focos LED en vez de paneles, para la bodega": lo descartado llega hasta la pausa.
      const pause = /^([^,;.]+)[,;.]\s*(.*)$/.exec(after);
      return pick(pause ? pause[1] : after, pause && pause[2] ? before + ', ' + pause[2] : before);
    }
    const split = INSTEAD_NEW_RE.exec(after);
    return split ? pick(split[1], split[2]) : undefined;
  }
  const sino = SINO_RE.exec(flat);
  // "No solo 20 paneles sino tambien 10 focos" suma: no descarta nada.
  if (sino && /^(?:s[o\u00f3]lo|solamente|nada\s+m[a\u00e1]s)(?![\p{L}])/iu.test(sino[2])) return undefined;
  if (sino) return pick(sino[2], (INSTEAD_LEAD_RE.test(sino[1].trim()) ? '' : sino[1].trim() + ' ') + sino[3]);
  const comma = NO_COMMA_RE.exec(flat);
  return comma ? pick(comma[1], comma[2]) : undefined;
}
/**
 * [RESUMEN] (ronda 4, C) En un pedido de varios items, el color dicho para algunos de ellos ("luz neutra para los paneles",
 * "Los focos son calidos"): nombra productos y no todos los items capturados.
 */
function itemOnlyColor(captured: CapturedFields, facts: string, claudeParsed: ClaudeFields): boolean {
  if (!captured.cantidad_varios || captured.cantidad || !textLuz(facts)) return false;
  const named = namedProducts(maskNegated(facts), claudeParsed).flatMap(productWords);
  const items = capturedPairs(captured).map((pair) => productWords(pair.replace(/^\S+\s+/, '')));
  if (!named.length || items.length < 2) return false;
  return !items.every((words) => words.some((w) => named.includes(w)));
}
// [RESUMEN] (ronda 4, A) La red de seguridad: la respuesta al resumen (o a "Que dato corrijo?") con un dato que el motor
// no aplica entero queda textual en la nota del mismo negocio, para que el vendedor la lea. Es una nota interna, nunca un
// texto al cliente. La linea entera cabe en la nota (pipedriveLead.ts: FIELD_MAX, 300).
const UNAPPLIED_PREFIX = 'Respuesta del cliente al resumen, sin aplicar (revisar): ';
const MAX_UNAPPLIED = 300 - UNAPPLIED_PREFIX.length - 2;
function unappliedLine(body: string): string {
  const chars = [...body.replace(/\s+/g, ' ').trim()];
  const text = chars.length > MAX_UNAPPLIED ? chars.slice(0, MAX_UNAPPLIED - 3).join('') + '...' : chars.join('');
  return UNAPPLIED_PREFIX + '"' + text + '"';
}
/**
 * [RESUMEN] (ronda 5, A) La red de seguridad al reves: lo que queda de la respuesta al resumen (el RESIDUO) despues de
 * sacar lo que se aplico y las palabras de relleno, cortesia o correccion (LEFTOVER_FILLER_RES, nunca un sustantivo con un
 * dato). Se compara sin mayusculas, tildes, signos ni emoji, con los numeros en palabras como cifras ("treinta" es 30) y
 * los colores en una sola forma ("calidos" es "calida"). Lo aplicado: lo registrado (`after`) del producto, la cantidad,
 * los varios items, el color, el uso y la comuna (nunca "Otras comunas mencionadas"), salvo lo que el mensaje niega sin
 * cambiarlo; lo que reemplazo un cambio ("antes ..."); y las unidades o los metros de la cantidad. De una pregunta cuenta
 * solo su dato (un numero, un producto, una comuna, un color o un uso): "Cuando llega?" no deja residuo y "Y si mejor en
 * Renca?" si. Si nada cambio y el mensaje rechaza ("No, ...", "corrijo"), tambien queda: ante la duda, la linea va.
 */
// Relleno, cortesia y palabras de correccion: nunca un sustantivo con un dato.
const LEFTOVER_FILLER_RES = [
  /^(?:no|si|sip|ya|ok|okay|okey|oki|vale|dale|listo|claro|bueno|buena|buenas|buenos|hola|gracias|muchas|mil|favor|porfa|porfis|porfavor|plis|perdon|disculpa|disculpas)$/,
  /^(?:disculpe|equivoque|confundi|error|quise|queria|decir|dije|olvide|falto|corrijo|correccion|corrige|cambio|cambia|cambiar|cambiamos|es|son|era|eran|sea|sean)$/,
  /^(?:seria|serian|sera|seran|fue|esta|estan|queda|quedan|va|van|iria|irian|en|a|al|para|de|del|el|la|lo|los|las|le|les|un|una|unos|unas|y|e|o|u|que|con|por|pero)$/,
  /^(?:sino|mas|mejor|me|mi|mis|te|tu|nos|se|su|sus|desde|pedido|despacho|entrega|envio)$/,
  /^(?:obra|item|items|total|necesito|necesitamos|necesitaria|quiero|queremos|quisiera|prefiero|preferimos|pon|ponle|ponga|agrega|agregar|agregale|ah|ahora)$/,
  /^(?:entonces|tambien|ademas|todo|todos|todas|bien|mal|correcto|correcta|exacto|perfecto|acuerdo|genial|excelente|super|cotizar|cotiza|cotizame|cotizacion|presupuesto)$/,
  /^(?:eso|esto|este|estos|estas|ese|esa|asi|solo|solamente|real|realidad|final|finalmente|vez|led|leds|dias|tardes|noches|saludo|saludos|quedo|atento|atenta|atentos)$/,
  /^(?:espero|aviso|cada|aprox|aproximadamente|como|salvo|excepto|aunque|ninguno|ninguna|nada|consulta|pregunta|duda|dice|dijo|dicen|creo|pienso|parece)$/,
  /^(?:esos|esas|aquel|aquella|aquellos|aquellas|estado|nueva|nuevo|nuevas|nuevos|otra|otro|otras|otros|ver|saber|mio|mia|culpa)$/,
  // Las palabras de correccion conjugadas ("Modifico:", "Actualizo:", "Cambialo a", "Corrige").
  /^(?:cambi|corrij|corrig|correc|modific|actualiz|equivoc|confund|disculp)[a-z]*$/,
];
// (ronda 7, B1) Los nombres de campo, aparte: en summaryLeftover son relleno solo si ese campo se aplico en el mensaje.
const FIELD_NAME_FIELDS: Array<[RegExp, Array<keyof CapturedFields>]> = [
  [/^(?:cantidad|cantidades)$/, ['cantidad', 'cantidad_varios']],
  [/^(?:color|colores|colour|luz|temperatura)$/, ['tipo_de_luz']],
  [/^tipo$/, ['tipo_de_luz', 'producto']],
  [/^(?:producto|productos)$/, ['producto', 'cantidad', 'cantidad_varios']],
  [/^(?:uso|proyecto)$/, ['proyecto_o_uso']],
  [/^(?:comuna|ciudad|direccion|lugar|destino)$/, ['comuna_o_ciudad']],
];
const FIELD_NAME_RE = /^(?:cantidad|cantidades|color|colores|colour|luz|temperatura|tipo|producto|productos|uso|proyecto|comuna|ciudad|direccion|lugar)$/;
const baseFillerToken = (token: string) => LEFTOVER_FILLER_RES.some((re) => re.test(token));
const fillerToken = (token: string) => baseFillerToken(token) || FIELD_NAME_RE.test(token);
// (ronda 6, A) Las palabras que suman y el reparto por algo ("20 por oficina"; "por favor" no).
const LEFTOVER_ADD_WORD_RE = /^(?:mas|otr[oa]s?|adicional(?:es)?|extras?|agreg[a-z]*|suma(?:le|me|r|n)?|sumen?|ademas|tambien)$/;
const LEFTOVER_PER_RE = /\d\s+por\s+(?!favor(?![a-z]))(?:cada\s+)?[a-z]/;
// "Nada mas", "no mas", "nomas" cierran la frase: no suman.
const NOTHING_MORE_RE = /(?<![\p{L}])(?:(?:nada|no)\s+m[a\u00e1]s|nom[a\u00e1]s)(?![\p{L}])/giu;
const LEFTOVER_REJECT = new Set(['no', 'mal', 'incorrecto', 'incorrecta', 'error', 'equivoque', 'confundi', 'corrijo', 'correccion', 'cambio', 'cambiar']);
// Estas rechazan solo al inicio ("No, 12 focos y 5 paneles"); "Son 20, no 30" niega otro numero.
const LEFTOVER_LEAD_REJECT = new Set(['no', 'mal', 'incorrecto', 'incorrecta']);
const UNIT_TOKENS = ['unidad', 'unidades', 'und', 'unds', 'ud', 'uds', 'unid', 'unids'];
const METER_TOKENS = ['metro', 'metros', 'mt', 'mts', 'mtr', 'mtrs', 'm'];
function colorToken(token: string): string {
  const m = /^(calid|fri|neutr|blanc|amarill)[oa]s?$/.exec(token);
  return m ? m[1] + 'a' : token;
}
function leftoverTokens(text: string): string[] {
  const plainText = comparable(text).replace(/c\/u/g, ' ').replace(/[^a-z0-9\s.,;:!?$/-]+/g, ' ');
  return spelledQuantities(plainText, true).replace(/(\d)\.(?=\d{3}(?!\d))/g, '$1').replace(/(\d)\s+k(?![a-z])/g, '$1k')
    .split(/[^a-z0-9]+/).filter(Boolean).map(colorToken);
}
/** [RESUMEN] (ronda 5, A) Las palabras de una pregunta que son un dato: numero, producto, comuna, color o uso. */
function questionData(part: string): string[] {
  const items = new Set(itemsIn(part).map((noun) => stem(comparable(noun))));
  const comunaWords = new Set(findComunas(part, { answering: true }).flatMap(leftoverTokens));
  const luz = textLuz(part);
  const luzWords = new Set(luz ? leftoverTokens(luz) : []);
  return leftoverTokens(part).filter((t) => /\d/.test(t) || items.has(stem(t)) || comunaWords.has(t) || luzWords.has(t) || USE_WORD_RE.test(t));
}
/**
 * [RESUMEN] (ronda 5) La respuesta al resumen en lo que afirma y sus preguntas, cortada como statementText. "Que sean 30"
 * o "Que tengan sensor" piden algo: no son una pregunta aunque empiecen con "que".
 */
const SUMMARY_ASK_THAT_RE = /^que\s+(?:sean?|ser[i\u00ed]an?|tengan?|vayan?|lleguen?|vengan?)(?![\p{L}])/iu;
function summaryParts(text: string): { statement: string; questions: string[] } {
  const parts = text.slice(0, MAX_FACTS).split(/(?<=[?!\n])|(?=\u00bf)/).flatMap((part) => part.split(/(?<=[\p{L}\s])\.(?!\d)/u))
    .map((part) => part.trim()).filter(Boolean);
  const asks = (part: string) => {
    const plain = questionText(part).trim();
    const lead = plain.replace(/^[\u00bf\s*_~]+/, '').replace(ASK_LEAD_RE, '');
    return /[?\u00bf]/.test(part) || (!SUMMARY_ASK_THAT_RE.test(lead) && isQuestionPart(plain));
  };
  return { statement: parts.filter((part) => !asks(part)).join('. '), questions: parts.filter(asks) };
}
const LEFTOVER_FIELDS = ['producto', 'cantidad', 'cantidad_varios', 'tipo_de_luz', 'proyecto_o_uso', 'comuna_o_ciudad'] as const;
// (ronda 7, B3) "otra/otro" delante del nombre de un campo cambia ese campo ("Otra cantidad: 35"): no es una suma.
// "En lugar de" no nombra el lugar de la entrega.
const INSTEAD_PLACE_RE = /(?<![\p{L}])en\s+lugar\s+de(?![\p{L}])/giu;
const OTHER_FIELD_RE = /(?<![\p{L}])otr[oa]s?\s+((?:tipo\s+de\s+luz|temperatura|colou?r(?:es)?|luz|cantidad(?:es)?|comuna|ciudad|direcci[o\u00f3]n|lugar|destino|uso|proyecto)(?![\p{L}]))/giu;
// La cortesia con una negacion ("Si, no hay problema", "Ok, sin drama", "no te preocupes") no es un dato.
const COURTESY_DENIAL_RE = /(?<![\p{L}])(?:(?:no\s+hay|sin|ning[u\u00fa]n)\s+(?:problemas?|drama|rollo|apuro)|no\s+(?:te|se)\s+preocupe[ns]?)(?![\p{L}])/giu;
function summaryLeftover(body: string, before: CapturedFields, after: CapturedFields, claudeParsed: ClaudeFields): string {
  // (ronda 6, D) Una posible cancelacion queda para el vendedor.
  if (SUMMARY_CANCEL_RE.test(summaryAnswerText(body))) return 'cancelacion';
  // (ronda 7, B3) "Otra cantidad: 35", "Otra comuna: Renca": cambia ese campo, no suma.
  const { statement, questions } = summaryParts(factsText(body, claudeParsed).replace(COURTESY_DENIAL_RE, ' ').replace(NOTHING_MORE_RE, ' ')
    .replace(OTHER_FIELD_RE, '$1').replace(INSTEAD_PLACE_RE, 'en vez de'));
  // Lo que el mensaje niega o descarta ("Son 20, no 30", "en vez de 5 paneles") no es un dato por aplicar.
  const said = maskNegated(insteadSplit(statement) ?? statement);
  const saidTokens = leftoverTokens(said);
  const same = (field: keyof CapturedFields) => JSON.stringify(before[field] ?? null) === JSON.stringify(after[field] ?? null);
  // (ronda 6, A) Una suma con numero ("20 mas", "Otros 20", "Agrega 20", "20 por oficina") que no se aplico como otro
  // item: sus palabras no son relleno y el numero de un dato que no cambio no cuenta como aplicado.
  const adds = same('cantidad_varios') && saidTokens.some((t) => /^\d/.test(t))
    && (saidTokens.some((t) => LEFTOVER_ADD_WORD_RE.test(t)) || LEFTOVER_PER_RE.test(comparable(said)));
  const consumed = new Set<string>();
  const take = (value: string | undefined, keepNumbers = false) => {
    for (const t of leftoverTokens(value ?? '')) if (!keepNumbers || !/^\d+$/.test(t)) { consumed.add(t); consumed.add(stem(t)); }
  };
  let changed = false;
  for (const field of LEFTOVER_FIELDS) {
    const was = before[field];
    const now = after[field];
    if (!same(field)) { changed = true; take(was); take(now); }
    // Lo que el mensaje niega y quedo igual no cuenta como aplicado ("No es en Maipu" con Maipu registrada).
    else if (!negatesValue(said, now)) take(now, adds);
  }
  if (after.tipo_de_luz) consumed.add(normalizeLuz(comparable(after.tipo_de_luz)));
  // Las palabras que sirven para cualquier luminaria ("Si, los focos") no nombran otro producto.
  if (after.producto || after.cantidad_varios) for (const t of ANY_PRODUCT_STEMS) consumed.add(t);
  if (after.cantidad) for (const t of UNIT_TOKENS) consumed.add(t);
  if (after.cantidad_unidad === 'm' || /\bm\b|metros?/i.test(after.cantidad_varios ?? '')) for (const t of METER_TOKENS) consumed.add(t);
  // La comuna escrita de otra forma ("Santiago centro", "pte alto") tambien es la aplicada.
  for (let i = 0; i < saidTokens.length; i++) {
    for (let size = 2; size <= 4 && i + size <= saidTokens.length; size++) {
      const words = saidTokens.slice(i, i + size);
      const name = officialComuna(words.join(' '));
      if (name && leftoverTokens(name).every((t) => consumed.has(t))) for (const t of words) consumed.add(t);
    }
  }
  // (ronda 7, B1) El nombre de un campo es relleno solo si ese campo se aplico en este mensaje: cambio, o el mensaje dice
  // su valor registrado sin negarlo ("Si, la luz neutra"). Si no ("Corrige la comuna"), queda en el residuo.
  const appliedField = (field: keyof CapturedFields) => !same(field) || (typeof after[field] === 'string' && Boolean(after[field])
    && !negatesValue(said, after[field]) && leftoverTokens(String(after[field])).some((t) => saidTokens.includes(t)));
  const fieldNameApplied = (t: string) => FIELD_NAME_FIELDS.some(([re, fields]) => re.test(t) && fields.some(appliedField));
  const filler = (t: string) => baseFillerToken(t) || (FIELD_NAME_RE.test(t) && fieldNameApplied(t));
  const left = (tokens: string[]) => tokens.filter((t) => (!filler(t) || (adds && LEFTOVER_ADD_WORD_RE.test(t))) && !consumed.has(t) && !consumed.has(stem(t)));
  // Lo negado que no es un dato del pedido ("No es en Pudahuel" con Maipu registrada) tambien queda para el vendedor.
  const kept = new Set(saidTokens);
  const negated = leftoverTokens(statement).filter((t) => !kept.has(t));
  // (ronda 6, B y C) El dato rechazado por su nombre que no cambio ("La comuna no, y luz fria") tampoco se aplico.
  const rejected = rejectedFields(statement, before).fields.filter((x) => REJECT_GROUP_FIELDS[x.group].every(same)).map((x) => x.word);
  const residue = [...left(saidTokens), ...left(negated), ...questions.flatMap((part) => left(questionData(part))), ...rejected];
  if (residue.length) return residue.join(' ');
  // Nada cambio y el mensaje niega un dato registrado sin dar el nuevo ("No es en Maipu", "No son paneles", "No es luz
  // neutra"): queda para el vendedor.
  const denied = negated.filter((t) => !filler(t) && (consumed.has(t) || consumed.has(stem(t))));
  if (!changed && denied.length) return ['no', ...denied].join(' ');
  // Nada cambio y el mensaje rechaza el resumen con otras palabras ("No, 12 focos y 5 paneles"): queda para el vendedor.
  const words = leftoverTokens(statement);
  const rejects = words.filter((t, i) => LEFTOVER_REJECT.has(t) && (i === 0 || !LEFTOVER_LEAD_REJECT.has(t)));
  return !changed && rejects.length && questionData(said).length ? rejects.join(' ') : '';
}
/**
 * [RESUMEN] (ronda 4, A) Con el resumen pendiente, la respuesta que no se aplico entera suma su linea textual a los cambios
 * y se escribe en el mismo negocio (rutUpdate), sin tarea nueva ni aviso a ventas (quietUpdate). La respuesta al cliente
 * no cambia.
 * (ronda 5, A) Al reves: primero se apartan las respuestas que no son contenido (el "si" de la lista cerrada, con su
 * cortesia; el "no" solo o "<dato> esta mal" sin el dato, que contesta "Que dato corrijo?"; una foto o un audio; el correo
 * o el RUT tardio; un pedido nuevo explicito, que no llega aqui). Todo lo demas es contenido y deja la linea si su residuo
 * (summaryLeftover) no esta vacio.
 */
function withUnappliedNote(phone: string, state: FlowState, body: string, claudeParsed: ClaudeFields, hasMedia: boolean, result: StepResult, dropped = false): StepResult {
  if (hasMedia || result.reply === MSG_SUMMARY_FIX || state.deal !== 'registered') return result;
  const after = result.captured;
  if (after.correo !== state.captured.correo || after.rut !== state.captured.rut) return result;
  // El RUT y el correo tienen su camino (lateRut, lateEmail): un mensaje que los trae o habla del RUT no es un dato del pedido.
  const inspected = inspectRut(body, { asked: false });
  if (inspected.found || inspected.ambiguous?.length || /(?<![a-z])rut(?![a-z])/i.test(body) || EMAIL_RE.test(body)) return result;
  const answer = summaryAnswerText(body);
  if (!dropped && (!answer || SUMMARY_YES_RE.test(answer) || SUMMARY_NO_RE.test(answer))) return result;
  if (!dropped && !summaryLeftover(body, state.captured, after, claudeParsed)) return result;
  const captured: CapturedFields = { ...after, cambios: [...(after.cambios ?? []), unappliedLine(body)].slice(-MAX_CAMBIOS) };
  saveFlowState(phone, { ...getFlowState(phone), captured });
  console.log('[flowEngine] respuesta al resumen sin aplicar entera: queda textual en la nota del negocio');
  return { ...result, captured, shouldCreateDeal: true, rutUpdate: true, quietUpdate: result.rutUpdate ? result.quietUpdate : true, closedFlow: true };
}
/**
 * [RESUMEN] (ronda 5, C6) Con el resumen pendiente, todo camino que escribe un dato del pedido en el negocio va sin aviso a
 * ventas (quietUpdate): la vuelta sin modo resumen (closedAnswer) tambien. El correo, el RUT y la consulta para Claudio
 * siguen como hoy.
 */
function quietAfterSummary(result: StepResult | undefined, afterSummary: boolean): StepResult | undefined {
  return result && afterSummary && result.rutUpdate ? { ...result, quietUpdate: true } : result;
}
/**
 * [RESUMEN] (revision 16-11) El mensaje sin sus partes de pregunta, cortado como questionText (cada frase hasta "?", "!"
 * o el salto de linea, y en sus puntos): "No, son 30. Cuanto demora el despacho?" es "No, son 30.".
 */
function statementText(body: string): string {
  return body.slice(0, MAX_FACTS).split(/(?<=[?!\n])|(?=\u00bf)/).flatMap((part) => part.split(/(?<=[\p{L}\s])\.(?!\d)/u))
    .map((part) => part.trim()).filter((part) => part && !isQuestionPart(questionText(part).trim())).join('. ');
}
/**
 * [REINICIO] Conversacion cerrada con el negocio registrado: un dato que cambia o se completa (otro color, la
 * cantidad, la comuna) va al mismo negocio, como el RUT y el correo tardios (rutUpdate: nota y campos). Antes el
 * mensaje reiniciaba la conversacion, volvia a pedir la cantidad y perdia la comuna (negocios 144, 145 y 186).
 * Solo cuenta lo que este mensaje dice: un dato que Claude repite del historial no se escribe.
 * [RESUMEN] summaryReply: el mensaje contesta el resumen. Un dato que afirma distinto del capturado lo corrige aunque no
 * traiga palabra de correccion ("Esta bien, pero mejor 25 paneles", "Pudahuel"), y otro item se suma como varios items
 * ("Tambien necesito 10 focos LED"), en el mismo negocio. La respuesta es el resumen corregido (el segundo y ultimo de
 * la conversacion) o, si ya se mostro o no se puede armar, MSG4.
 */
// [RESUMEN] (ronda 4, A) `report.dropped`: un dato que el mensaje cambiaba quedo sin escribir porque el resumen corregido no
// sale (ya se mostro, o no se puede armar): withUnappliedNote lo deja textual en la nota.
// (ronda 5, C5) `report.unmapped`: una cantidad de un pedido de varios items que no calza con un solo item; flowStep no
// prueba la vuelta sin modo resumen (closedAnswer), que podia reemplazar la lista con una cantidad equivocada.
interface SummaryReport { dropped?: boolean; unmapped?: boolean }
function lateChange(phone: string, state: FlowState, body: string, claudeParsed: ClaudeFields, hasMedia: boolean, summaryReply = false, afterSummary = summaryReply, report?: SummaryReport): StepResult | undefined {
  if (state.isInstallFlow) return undefined;
  // Preguntar por el despacho ("Hacen envio a Rancagua?") no cambia la comuna ni otro dato. (revision 13-11) Corregirlo
  // si: "Corrijo: el despacho es a Quilicura".
  // [RESUMEN] (revision 16-11) Al contestar el resumen, el despacho dicho como dato ("No, el despacho es a Pudahuel", "La
  // entrega es en Pudahuel") corrige como cualquier dato, y del mensaje que ademas pregunta por el despacho ("No, son 30.
  // Cuanto demora el despacho?") cuenta lo que afirma (statementText); la pregunta se contesta antes del resumen.
  let data = body;
  if (asksAboutDelivery(body) && !CORRECTION_RE.test(body.slice(0, MAX_FACTS))) {
    if (!summaryReply) return undefined;
    if (questionKinds(body).has('despacho')) data = statementText(body);
    if (!data.trim()) return undefined;
  }
  // [RESUMEN] (ronda 4, B4) "en vez de", "en lugar de", "no X sino Y" o "no X, Y": cuenta solo lo nuevo (producto, lista o
  // cantidad), como una correccion firme; lo descartado no se suma ni se lee.
  const fresh = summaryReply ? insteadSplit(data) : undefined;
  if (fresh) data = fresh;
  const instead = Boolean(fresh);
  const question = /[?\u00bf]/.test(data);
  const { merged, leadType, addsProduct = false, addedText = '', listReplace = false, switchWords = false, unmapped = false, destComuna = false, itemFirm = false } = mergeProductFields(state, data, claudeParsed, hasMedia, summaryReply, instead);
  if (unmapped && report) report.unmapped = true;
  const facts = factsText(data, claudeParsed);
  const captured: CapturedFields = { ...state.captured };
  // [RESUMEN] Al contestar el resumen, un dato afirmado distinto del capturado lo corrige sin palabra de correccion. El
  // uso, solo dicho como uso ("para bodega": "son 3 dormitorios y el living" lo describe) o, despues de "Que dato
  // corrijo?", en pocas palabras ("bodega"); la comuna, salvo la de otro lugar ("mi otra casa esta en Pirque"); las otras
  // comunas mencionadas ("saludos desde Puente Alto"), solo junto con la comuna corregida.
  // (revision 16-11) Sin palabra de correccion, no corrige lo que puede pasar mas adelante ("a lo mejor 5 mas el proximo
  // mes"), lo que se suma ("Tambien tengo una bodega en Quilicura") ni lo que sigue a un "si y" ("Si, y los de la bodega
  // son 10"). Con otro item ("Necesito 5 focos LED para el patio"), su uso, su comuna y su color no cambian los del pedido.
  const hedge = SUMMARY_HEDGE_RE.test(facts);
  const relaxable = summaryReply && !hedge && !SUMMARY_ADDITIVE_RE.test(facts) && !SUMMARY_YES_AND_RE.test(summaryAnswerText(data));
  const summaryFix = summaryReply && Boolean(lastQuestionOf(state)?.summaryFix);
  // (revision 17-11) La lista completa nueva (listReplace) reemplaza los items: no es otro item.
  const addsItem = !listReplace && merged.cantidad_varios !== undefined && merged.cantidad_varios !== state.captured.cantidad_varios;
  const relaxed = (field: typeof LATE_FIELDS[number]): boolean => {
    // (ronda 5, C5) Con una cantidad que no calza con un item, lo demas del mensaje puede ser de ese item: solo cambia lo firme.
    if (!summaryReply || unmapped) return false;
    if (field === 'comunas_otras') return captured.comuna_o_ciudad !== state.captured.comuna_o_ciudad;
    // (revision 17-11, ronda 3) El mensaje que es solo la comuna corrige aunque empiece con "Si, y" ("Si, y es en
    // Pudahuel"): no trae otro dato que se sume.
    if (field === 'comuna_o_ciudad' && !hedge && !addsItem && comunaReply(facts)) return true;
    // (ronda 5, C1) La comuna dicha como destino en una clausula (destinationComuna), tambien tras un "si, y" ("Si, y en Renca").
    if (field === 'comuna_o_ciudad' && destComuna && !hedge && !addsItem && !SUMMARY_ADDITIVE_RE.test(facts)) return true;
    if (addsItem || !relaxable) return false;
    // (ronda 5, C3) Tambien el uso conocido sin "para" ("Colegio", "Es un colegio", "uso: colegio"): summaryUseValue.
    if (field === 'proyecto_o_uso') return SUMMARY_USE_RE.test(facts) || (summaryFix && shortUseReply(facts)) || Boolean(summaryUseValue(facts));
    if (field === 'comuna_o_ciudad') return !OTHER_PLACE_RE.test(facts);
    return true;
  };
  const filled = (field: typeof LATE_FIELDS[number]): boolean => {
    if (field === 'comunas_otras') return Boolean(state.captured.comuna_o_ciudad);
    return state.captured[field] !== undefined && state.captured[field] !== '';
  };
  // afterSummary: tambien la vuelta sin modo resumen de la respuesta al resumen (closedAnswer en flowStep).
  const itemColor = afterSummary && itemOnlyColor(state.captured, facts, claudeParsed);
  const applied = new Set<string>();
  let changed = false;
  // [RESUMEN] (revision 16-11) Un cambio firme: con palabra de correccion, un dato que faltaba, otro item con su
  // producto, o una cantidad dentro de varios items. Uno sin palabra de correccion (relaxed) se escribe solo si el
  // resumen corregido se puede mostrar. (revision 17-11) Se anota cada dato que cambio sin ser firme (soft): si el
  // resumen corregido no sale (ya se mostro o no se puede armar), esos datos vuelven a lo registrado.
  // (revision 17-11, ronda 3) La respuesta a "Que dato corrijo? Escribeme el correcto." (summaryFix) es el dato que el
  // bot pidio: nunca es blanda, tambien despues del segundo resumen (decision 2 del dueno: "si despues escribe el dato,
  // se corrige en el mismo negocio").
  const soft = new Set<string>();
  const markSoft = (field: string) => { if (!summaryFix) soft.add(field); };
  // (revision 13-11) La cantidad, los varios items y los metros cambian juntos o no cambian: "Son 5 unidades" despues de
  // "12 focos y 5 paneles" ya no deja el numero y los varios items a la vez.
  const sameQty = QTY_FIELDS.every((field) => JSON.stringify(state.captured[field] ?? null) === JSON.stringify(merged[field] ?? null));
  const hadQty = Boolean(state.captured.cantidad || state.captured.cantidad_varios);
  // (revision 17-11) "Esta bien, pero mejor 25 paneles" tambien corrige (SUMMARY_BETTER_RE).
  let qtyOk = !hadQty || instead || itemFirm || correctsCaptured(data, state.captured, merged.cantidad ?? merged.cantidad_varios)
    || (summaryReply && !hedge && SUMMARY_BETTER_RE.test(facts));
  let qtyFirm = qtyOk;
  // [RESUMEN] (revision 16-11) Otro item cuenta si nombra su producto ("Tambien necesito 10 focos LED"): "Si, en 2
  // semanas mas" o "tengo 3 obras mas" no.
  if (!qtyOk && summaryReply) qtyOk = addsItem ? addsProduct && !hedge : relaxable;
  if (addsItem && addsProduct && qtyOk) qtyFirm = true;
  // [RESUMEN] (revision 16-11) Una cantidad sola despues de varios items ("Son 8 paneles" despues de "12 focos LED y 5
  // paneles LED") es la de uno de ellos: se suma al texto de varios items para el vendedor y no hay resumen.
  const oneOfSeveral = summaryReply && Boolean(state.captured.cantidad_varios && !state.captured.cantidad)
    && Boolean(merged.cantidad) && !merged.cantidad_varios;
  let qtyLine: string | undefined;
  // [RESUMEN] (ronda 5, C5) La vuelta sin modo resumen de la respuesta al resumen (closedAnswer en flowStep) no cambia la
  // cantidad: el modo resumen ya la leyo, y esta vuelta sumaba la respuesta entera como otro item ("/ No, 12 focos y 5
  // paneles"). Lo que no se aplico queda textual en la nota.
  if (!sameQty && qtyOk && !(afterSummary && !summaryReply)) {
    if (oneOfSeveral) {
      const before = state.captured.cantidad_varios as string;
      const text = facts.trim().replace(/\s+/g, ' ').slice(0, MAX_VARIOS);
      for (const field of QTY_FIELDS) delete captured[field];
      captured.cantidad_varios = (before + ' / ' + text).slice(0, 2 * MAX_VARIOS);
      qtyLine = KEPT_LABEL.cantidad + ': antes ' + 'varios items (' + before.slice(0, 80) + ')' + ', ahora ' + 'varios items (' + captured.cantidad_varios.slice(0, 160) + ')';
      qtyFirm = true;
    } else {
      for (const field of QTY_FIELDS) {
        if (merged[field] === undefined) delete captured[field];
        else (captured as Record<string, unknown>)[field] = merged[field];
      }
    }
    applied.add('cantidad');
    if (!qtyFirm) markSoft('cantidad');
    changed = true;
  }
  for (const field of LATE_FIELDS) {
    if ((QTY_FIELDS as readonly string[]).includes(field)) continue;
    // La cantidad de uno de los items no cambia el producto, que los nombra a todos.
    if (oneOfSeveral && field === 'producto') continue;
    const before = JSON.stringify(state.captured[field] ?? null);
    const after = JSON.stringify(merged[field] ?? null);
    if (before === after) continue;
    const value = merged[field];
    // Una comuna en una pregunta ("tienen sucursal en Concepcion?") no es la de la entrega.
    if (question && (field === 'comuna_o_ciudad' || field === 'comunas_otras')) continue;
    // El color o el uso que se llena con lo que Claude recuerda (sin decirlo en este mensaje) no cuenta.
    if ((field === 'tipo_de_luz' || field === 'proyecto_o_uso' || field === 'producto') && typeof value === 'string' && !sharesWord(value, facts) && !textLuz(facts)) continue;
    // (revision 12-11) Un dato ya registrado cambia solo con una correccion (correctsCaptured); uno vacio se completa.
    // (revision 17-11) El producto tambien con una palabra de cambio ("Cambio: ...", "Eran 20 focos LED", "no paneles").
    // (ronda 4, C) En un pedido de varios items, el color dicho para uno de ellos ("luz neutra para los paneles", "Los focos
    // son calidos") no es el de todo el pedido: no cambia y queda textual en la nota (unappliedLine).
    if (field === 'tipo_de_luz' && itemColor) continue;
    const corrects = !filled(field) || instead || correctsCaptured(data, state.captured, field === 'comunas_otras' ? merged.comuna_o_ciudad : value)
      || (field === 'producto' && switchWords);
    if (!corrects && !relaxed(field)) continue;
    if (!corrects) markSoft(field);
    (captured as Record<string, unknown>)[field] = value;
    applied.add(field === 'comunas_otras' ? 'comuna_o_ciudad' : field);
    changed = true;
  }
  if (!changed) return undefined;
  // [RESUMEN] (revision 16-11) Otro item con su propio uso, comuna o color ("Tambien necesito 10 focos LED para mi casa en
  // Pirque") no se resume con los del pedido: va el cierre y el vendedor lee el item entero en los varios items.
  const ownUse = addsItem ? extractProyecto(addedText) : undefined;
  const capturedUse = state.captured.proyecto_o_uso;
  const itemOwnData = addsItem && addedText.trim() !== '' && (
    ((SUMMARY_USE_RE.test(addedText) || Boolean(ownUse)) && !(ownUse && capturedUse && comparable(ownUse) === comparable(capturedUse)))
    || findComunas(addedText).some((c) => comparable(c) !== comparable(state.captured.comuna_o_ciudad ?? ''))
    || Boolean(textLuz(addedText) && normalizeLuz(textLuz(addedText) as string) !== normalizeLuz(comparable(state.captured.tipo_de_luz ?? ''))));
  const noSummary = oneOfSeveral || itemOwnData;
  // [RESUMEN] (ronda 5, B) Aplicacion parcial: se aplico algo y queda residuo (summaryLeftover). No sale el resumen
  // corregido (mostraria lo viejo como si fuera lo nuevo): MSG4, y en el mismo negocio los cambios aplicados con su linea
  // "Cambios:" y la linea textual (withUnappliedNote), sin aviso a ventas. El resumen corregido sale solo si el mensaje se
  // aplico entero. Despues del segundo resumen, un dato sin palabra de correccion sigue sin cambiar (ronda 2, punto 4).
  const partial = summaryReply && Boolean(summaryLeftover(body, state.captured, captured, claudeParsed));
  const firstSummary = (state.summaryShown ?? 1) < 2;
  const again = summaryReply && !noSummary && !partial && firstSummary ? summaryMsg(captured) : undefined;
  // [RESUMEN] (revision 16-11) Un cambio sin palabra de correccion que deja un resumen que no se puede armar no se
  // escribe: sigue la respuesta al resumen sin cambios. (revision 17-11) Tampoco despues del segundo resumen ("Si, mi casa
  // esta en Pirque"): sin el resumen corregido a la vista, nada cambia en silencio. Se escriben solo los datos firmes.
  if (summaryReply && !again && soft.size && !(partial && firstSummary && !noSummary)) {
    const restore = (field: string) => {
      for (const f of field === 'cantidad' ? QTY_FIELDS : [field] as Array<keyof CapturedFields>) {
        if (state.captured[f] === undefined) delete captured[f];
        else (captured as Record<string, unknown>)[f] = state.captured[f];
      }
    };
    if (soft.has('comuna_o_ciudad')) soft.add('comunas_otras');
    if (report) report.dropped = true;
    for (const field of soft) restore(field);
    const comunaKept = !soft.has('comuna_o_ciudad') && JSON.stringify(captured.comuna_o_ciudad ?? null) !== JSON.stringify(state.captured.comuna_o_ciudad ?? null);
    const otrasKept = !soft.has('comunas_otras') && JSON.stringify(captured.comunas_otras ?? null) !== JSON.stringify(state.captured.comunas_otras ?? null);
    for (const field of soft) if (field !== 'comuna_o_ciudad' && field !== 'comunas_otras') applied.delete(field);
    if (!comunaKept && !otrasKept) applied.delete('comuna_o_ciudad');
    if (!applied.size) return undefined;
  }
  // Solo las lineas de cambio de los datos que se aplicaron.
  const labels = [...applied].filter((field) => !(qtyLine && field === 'cantidad')).map((field) => KEPT_LABEL[field as KeptField]).filter(Boolean);
  const previous = state.captured.cambios ?? [];
  const added = (merged.cambios ?? []).filter((line) => !previous.includes(line) && labels.some((label) => line.startsWith(label + ':')));
  if (qtyLine) added.push(qtyLine);
  if (added.length) captured.cambios = [...previous, ...added].slice(-MAX_CAMBIOS);
  const captureStatus = computeCaptureStatus(captured, leadType);
  const next: FlowState = { ...state, captured, captureStatus, leadType };
  console.log('[flowEngine] dato nuevo despues del cierre \u2014 se suma al negocio registrado');
  const result = { shouldCreateDeal: true, shouldNotify: false, captureStatus, captured, wantsHuman: next.wantsHuman, closedFlow: true, rutUpdate: true };
  if (!summaryReply) {
    saveFlowState(phone, next);
    return { ...result, reply: closedFollowUp(next, body) };
  }
  // [RESUMEN] La pregunta que trae el mensaje (el despacho, el precio) se contesta antes, como en closedFollowUp.
  const answers = questionAnswers(questionKinds(body), true, false);
  if (!again) {
    saveFlowState(phone, next);
    return { ...result, quietUpdate: true, reply: withAnswers(answers, MSG4) };
  }
  saveFlowState(phone, { ...next, summaryAt: Date.now(), summaryShown: 2 });
  return { ...result, quietUpdate: true, reply: withAnswers(answers, again), question: SUMMARY_QUESTION };
}

// [RESUMEN] Fase 3B (dueno, 16-11-2026): la respuesta al resumen, el mensaje entero sin mayusculas, tildes ni signos.
// "Si" es una de estas (con "gracias" o no); "no" solo, una de las otras. Lo demas (un dato, una pregunta) sigue el
// flujo de la conversacion cerrada.
const SUMMARY_YES_RE = /^(?:(?:si|ok|okay|correcto|esta bien|perfecto|dale|de acuerdo|todo bien|\u{1F44D})(?: |$)){1,3}(?:gracias)?$|^gracias (?:(?:si|ok|okay|correcto|esta bien|perfecto|dale|de acuerdo|todo bien|\u{1F44D})(?: |$)){1,3}$/u;
// (ronda 6, D) Tambien "nop", "nope" y "no po".
// (ronda 8) Tambien el error sin decir cual ("Hay un error", "Me equivoque", "Hay un dato malo", "Algo esta mal").
const SUMMARY_NO_RE = /^(?:no|nop|nope|no po|no esta bien|esta mal|no es asi|incorrecto|(?:hay|tiene) (?:un )?(?:error|errores)(?: en (?:el resumen|los datos|algo|algun dato))?|me equivoque(?: en algo)?|(?:hay )?(?:un|algun) dato (?:malo|mal|erroneo|incorrecto)|(?:un dato|algo) (?:esta )?mal)$/;
// [RESUMEN] (ronda 6, D) Una posible cancelacion ("No, gracias", "Ya no", "Mejor no", "No lo necesito", "Ninguno"): la
// respuesta no cambia, pero queda textual en la nota del negocio para el vendedor (summaryLeftover).
const SUMMARY_CANCEL_RE = /^(?:no (?:muchas )?gracias|ya no|mejor no|(?:ya )?no (?:lo|los|la|las) (?:necesito|necesitamos|quiero|queremos)|(?:ya )?no (?:quiero|queremos|me interesa|nos interesa)|creo que no|ningun[oa]|mejor nada|ya no (?:lo|los|la|las) (?:necesito|quiero))(?: gracias)?$/;
/** [RESUMEN] El mensaje sin tildes, mayusculas, signos ni el tono de piel del pulgar, con un espacio entre palabras. */
function summaryAnswerText(body: string): string {
  return normalizedText(body).toLowerCase().replace(/[\u{1F3FB}-\u{1F3FF}]|\uFE0F/gu, '')
    .replace(/\u{1F44D}/gu, ' \u{1F44D} ').replace(/[^\p{L}\p{N}\u{1F44D}]+/gu, ' ').trim();
}
/**
 * [RESUMEN] El mensaje que llega despues del resumen (o de MSG_SUMMARY_FIX), con el negocio registrado:
 * - "si" (SUMMARY_YES_RE): MSG4, sin escribir en Pipedrive;
 * - "no" solo: MSG_SUMMARY_FIX y el resumen sigue pendiente un mensaje mas; el segundo "no", MSG4;
 * - el correo o el RUT: lateEmail o lateRut, como siempre;
 * - un dato que corrige o suma: lateChange en modo resumen (mismo negocio, nota con los cambios, sin tarea nueva);
 * - un "si" con un comentario sin datos ni preguntas: MSG4.
 * Lo demas (una pregunta, "gracias"): nada, y sigue closedFollowUp.
 */
const LINEAR_METERS_RE = /(?<![\p{L}])(?:metros?|mts?\.?|m)\s+lineales?(?![\p{L}])/giu;
function summaryAnswer(phone: string, state: FlowState, body: string, claudeParsed: ClaudeFields, hasMedia: boolean, correctingEmail: boolean, report?: SummaryReport): StepResult | undefined {
  const answer = summaryAnswerText(body);
  const closed = (reply: string): StepResult => ({
    reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: state.captureStatus, captured: state.captured, wantsHuman: state.wantsHuman, closedFlow: true,
  });
  if (SUMMARY_YES_RE.test(answer)) return closed(MSG4);
  // (ronda 4, C) Tambien el dato que esta mal sin el correcto ("No esta bien la cantidad", "La comuna esta mal").
  if (SUMMARY_NO_RE.test(answer) || SUMMARY_FIELD_NO_RE.test(answer)) {
    if (lastQuestionOf(state)?.summaryFix) {
      // (ronda 4, A) Despues de "Que dato corrijo?", "la cantidad" dice que dato esta mal sin el correcto: MSG4 y el
      // texto en la nota del negocio, para que el vendedor lo revise. El "no" solo, sin nota.
      if (report && !SUMMARY_NO_RE.test(answer)) report.dropped = true;
      return closed(MSG4);
    }
    return { ...closed(MSG_SUMMARY_FIX), question: SUMMARY_FIX_QUESTION };
  }
  // (ronda 6, B) El dato rechazado por su nombre sin el nuevo ("La comuna no", "Todo bien salvo la luz", "Si, pero otra
  // comuna"), sin otro dato: como "<dato> esta mal". Despues de "Que dato corrijo?", MSG4 y la linea textual en la nota.
  if (!hasMedia && !EMAIL_RE.test(body) && !inspectRut(body, { asked: false }).found && rejectsFieldWithoutData(body, state.captured, claudeParsed)) {
    if (lastQuestionOf(state)?.summaryFix) {
      if (report) report.dropped = true;
      return closed(MSG4);
    }
    return { ...closed(MSG_SUMMARY_FIX), question: SUMMARY_FIX_QUESTION };
  }
  const lateRutResult = lateRut(phone, state, body);
  // (ronda 4, B2 y C) El dato sin la aceptacion delante ("Si, 30") ni la cortesia ("25, gracias"): summaryData.
  const late = lateEmail(phone, lateRutResult ? getFlowState(phone) : state, body, correctingEmail) ?? lateRutResult
    // (ronda 5, C2) Los numeros en palabras que son una clausula por si solos ("treinta", "Que sean treinta y en Pudahuel").
    // (ronda 8) "300 metros lineales" es la cantidad en metros, no otro item.
    ?? lateChange(phone, state, summaryData(spelledQuantities(body.replace(LINEAR_METERS_RE, 'metros'))), claudeParsed, hasMedia, true, true, report);
  if (late) return late;
  // (revision 16-11) Un "si" con un comentario que no cambia nada ("Si, quiero cotizar eso", "Si, en 2 semanas mas") y
  // sin pregunta tambien confirma: MSG4.
  if (SUMMARY_YES_LEAD_RE.test(answer) && !/[?\u00bf]/.test(body) && questionKinds(body).size === 0 && !asksWhatNext(body)) return closed(MSG4);
  return undefined;
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
  return { reply: registeredClosing(), shouldCreateDeal: true, shouldNotify: false, captureStatus: next.captureStatus, captured, wantsHuman: next.wantsHuman, closedFlow: true, rutUpdate: true };
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
  const { question: stepQuestion, ...stepResult } = flowStep(phone, body, claudeParsed, signals);
  let question = stepQuestion;
  let result = explainOwnEmail(stepResult, body);
  let state = flowStates.get(phone);
  // Abierta antes, o el mensaje empezo otro pedido (la conversacion cerrada siguio abierta).
  const open = !before || before.stage !== 'closed' || !result.closedFlow;
  // [PREGUNTA] Con la conversacion abierta, la ubicacion, el despacho y (con correo) el precio o la consulta tecnica
  // se contestan antes de la respuesta del flujo, que sigue con el dato que falta. Las conversaciones cerradas y la
  // instalacion lo contestan en su rama.
  if (open && state && !state.isInstallFlow) {
    const reply = withAnswers(questionAnswers(questionKinds(body), Boolean(state.captured.correo), false), result.reply);
    if (reply !== result.reply) result = { ...result, reply };
  }
  // [YA-ESCRIBI] Dice que ya le escribio a Claudio o a ventas@ y la respuesta le pide el correo: el texto aprobado.
  if (!result.shouldCreateDeal && ALREADY_WROTE_RE.test(body.slice(0, MAX_FACTS))) {
    for (const ask of [MSG_NEED_EMAIL, MSG_EMAIL_SHORT]) {
      if (result.reply === ask) result = { ...result, reply: MSG_ALREADY_WROTE };
      else if (result.reply.endsWith('\n\n' + ask)) result = { ...result, reply: result.reply.slice(0, -ask.length) + MSG_ALREADY_WROTE };
    }
  }
  // [SIN-REPETIR] (dueno, 12-11) Tampoco se repite el texto A en la conversacion cerrada sin negocio ni correo (T-X1b):
  // la segunda vez va MSG_EMAIL_SHORT. [ARCHIVOS] Se compara con lo que respondio el paso anterior, sin el aviso.
  result = notRepeated(result, withoutMediaNotice(lastReply));
  // [ARCHIVOS] El texto que acompana imagenes o archivos sigue el flujo como siempre; la respuesta lleva delante el
  // aviso de que no pasan a la solicitud, una vez por rafaga (se decide con el estado que leyo este mensaje).
  const now = Date.now();
  const mediaNotice = Boolean(signals.hasMedia) && !inMediaBurst(before, now);
  // [RESUMEN] (revision 16-11) El resumen, con las respuestas a las preguntas y el aviso de archivos, deja lugar para el
  // aviso de privacidad (webhook.ts lo agrega a la primera respuesta: hasta 300 caracteres y la linea en blanco) dentro de
  // los 1.000 caracteres: si no cabe, va el cierre (MSG4) y el resumen no queda pendiente.
  const summary = question?.summary && state ? summaryMsg(state.captured) : undefined;
  if (summary && result.reply.endsWith(summary)
    && (mediaNotice ? withMediaNotice(result.reply) : result.reply).length + PRIVACY_NOTICE_ROOM > MAX_FIRST_REPLY) {
    result = { ...result, reply: result.reply.slice(0, -summary.length) + MSG4 };
    question = undefined;
    const sameChat = Boolean(before && state && before.firstMessageAt === state.firstMessageAt);
    const { summaryAt: _at, summaryShown: _shown, ...rest } = state as FlowState;
    state = { ...rest, ...(sameChat && before?.summaryAt !== undefined ? { summaryAt: before.summaryAt } : {}), ...(sameChat && before?.summaryShown !== undefined ? { summaryShown: before.summaryShown } : {}) };
  }
  // [RUT-VALIDO] Se anota si esta respuesta pide el RUT: vale solo para el mensaje siguiente.
  // [CANTIDAD] Tambien que pregunta hizo (sin pregunta, ninguna: un numero suelto no es cantidad).
  if (state) saveFlowState(phone, { ...state, rutAskedLast: asksForRut(result.reply), lastQuestion: question ?? null, ...(signals.hasMedia ? { lastMediaAt: now } : {}) });
  if (mediaNotice) result = { ...result, reply: withMediaNotice(result.reply) };
  return result;
}

// [RESUMEN] (revision 16-11) El lugar del aviso de privacidad (privacyNotice.ts: hasta 300 caracteres y "\n\n") y el tope
// del mensaje con el aviso (privacyNotice.test.ts, MAX_COMBINED).
const PRIVACY_NOTICE_ROOM = 302;
const MAX_FIRST_REPLY = 1000;
// [SIN-REPETIR] Si la respuesta es igual a la anterior, otro texto ya aprobado que dice lo mismo (caso de las
// estacas: tres veces seguidas la misma peticion del correo). El saludo, el texto B y el registro pendiente no
// cambian. Si no hay otro texto para esa respuesta, se repite.
// "Ok, yo le escribi a Claudio", "ya les mande un correo", "le envie un mail a ventas".
const ALREADY_WROTE_RE = /(?<![a-z\u00e0-\u00fc])(?:(?:le|les)\s+(?:escrib[i\u00ed]|mand[e\u00e9]|envi[e\u00e9])|(?:ya\s+)?(?:escrib[i\u00ed]|mand[e\u00e9]|envi[e\u00e9])\s+(?:un\s+)?(?:a|al|correo|mail|email)\b)(?![a-z\u00e0-\u00fc])/i;
const ALTERNATE_REPLY: Record<string, string> = {
  [MSG_ALREADY_WROTE]: MSG_EMAIL_SHORT,
  [MSG_NEED_EMAIL]: MSG_EMAIL_SHORT,
  [MSG_EMAIL_SHORT]: MSG_NEED_EMAIL,
  [MSG4_INSTALL_NO_EMAIL]: MSG_EMAIL_SHORT,
  [MSG_Q_PRICE]: MSG_Q_TECH,
  [MSG_Q_TECH]: MSG_NEED_EMAIL,
  // (revision 12-11) Con el correo ya dado: "¿tienen stock?" y "¿y cuanto cuestan?" seguidas.
  [MSG_Q_PRICE_HAS_EMAIL]: MSG_Q_TECH_HAS_EMAIL,
  [MSG_Q_TECH_HAS_EMAIL]: MSG_REGISTERED_SHORT,
  [MSG_WAIT]: MSG_REGISTERED_SHORT,
  // [DESPACHO] MSG_WAIT_DELIVERY no tiene otro texto aprobado que hable del despacho: una segunda pregunta por el
  // despacho recibe otra vez la respuesta del despacho (antes, el recordatorio del registro, que no la contesta).
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
 * [ARCHIVOS] La respuesta de webhook.ts a adjuntos sin texto, que no pasan por el flujo (`types`: sus
 * MediaContentType). El aviso:
 * - imagenes o archivos: MSG_MEDIA_NOTICE (mandarlos por correo a ventas@), una vez por rafaga (MEDIA_BURST_MS);
 * - solo audios o videos (una nota de voz): MSG_VOICE_NOTICE, siempre, tambien dentro de la rafaga, porque traen lo
 *   que el cliente quiso decir. No abren ni alargan la rafaga de los archivos.
 * Despues del aviso, siempre una invitacion a seguir por escrito:
 * - en la etapa 1, MSG_MEDIA_ASK: la pregunta por producto, proyecto y cantidad aproximada (sin lista), que
 *   [CANTIDAD] queda anotada para el mensaje siguiente;
 * - mas adelante (o en la instalacion), con una pregunta del bot pendiente, MSG_MEDIA_PENDING: esa pregunta sigue
 *   pendiente y anotada (no se repregunta lo que el cliente ya dijo);
 * - sin pregunta pendiente (cerrada con su solicitud), nada despues del aviso de archivos y MSG_VOICE_WRITE despues
 *   del de audios.
 * Archivos dentro de la rafaga, sin audio: '' (sin mensaje): ya tuvo el aviso y nada cambia.
 */
export function recordMediaReply(phone: string, types: readonly string[] = [], now = Date.now()): string {
  const state = getFlowState(phone);
  const { files, voice } = mediaKinds(types);
  const notice = files && !inMediaBurst(state, now) ? MSG_MEDIA_NOTICE : voice ? MSG_VOICE_NOTICE : '';
  const next: FlowState = files ? { ...state, lastMediaAt: now } : { ...state };
  if (notice && state.stage === 'stage1' && !state.isInstallFlow) {
    const asks = [...missingStage1(state.captured).filter((m) => m !== 'tipo de luz preferida'), ...(state.captured.proyecto_o_uso ? [] : ['espacio o proyecto de uso'])];
    saveFlowState(phone, { ...next, rutAskedLast: false, lastQuestion: askedIn(asks, 0) });
    return notice + '\n\n' + MSG_MEDIA_ASK;
  }
  saveFlowState(phone, next);
  if (!notice) return '';
  const follow = awaitsAnswer(state) ? MSG_MEDIA_PENDING : notice === MSG_VOICE_NOTICE ? MSG_VOICE_WRITE : '';
  return follow ? notice + '\n\n' + follow : notice;
}

/**
 * [ARCHIVOS] El bot espera la respuesta a una pregunta suya: en las etapas 1 a 3 y en la instalacion siempre (cada
 * respuesta pregunta algo), y en la conversacion cerrada solo si todavia falta el correo (el cierre lo pide).
 */
function awaitsAnswer(state: FlowState): boolean {
  // [RESUMEN] Tambien el resumen (o MSG_SUMMARY_FIX): el cliente lo confirma o lo corrige por escrito.
  return state.stage !== 'closed' || !flowEmail(state) || Boolean(state.lastQuestion?.summary);
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
    // [RESUMEN] El mensaje siguiente al resumen (o a MSG_SUMMARY_FIX) lo confirma o lo corrige: otro producto u otra
    // cantidad se suman al mismo negocio y no abren otra conversacion. Un pedido nuevo explicito y la instalacion si.
    const summaryPending = state.deal === 'registered' && !state.isInstallFlow && Boolean(lastQuestionOf(state)?.summary);
    // [REINICIO] Solo otro pedido abre otra conversacion: pedir un vendedor (negocio 144), cambiar el color del mismo
    // producto (145) o preguntar como comprar lo cotizado (186) siguen en la misma.
    const newRequest = explicit
      || (!correctingRut && !correctingEmail && ((opensNewRequest(body, state, claudeParsed, summaryPending) && !asksAboutExistingQuote(body, state.captured, claudeParsed)) || installRequested(maskNegated(body))));
    // [CIERRE-HONESTO] Sin negocio, un mensaje con correo se suma a lo capturado y registra la
    // solicitud aunque diga "necesito" o "quiero" (antes eso reiniciaba y perdia lo capturado).
    // [TRANSCRIPCION] Salvo un pedido nuevo explicito ("Otro pedido: ... Mi correo es X"): empieza otra conversacion
    // con ese correo, tambien si la anterior tenia correo y todavia no hay resultado de Pipedrive (decision 4 del
    // dueno; R10 de la ronda 3: antes se mezclaba con el pedido anterior). Lo capturado en la anterior no se
    // reintenta aparte.
    if (!state.deal && !explicit && (!newRequest || messageEmail(body, claudeParsed))) {
      return continueClosedWithoutDeal(phone, state, body, claudeParsed);
    }
    const closedAnswer = (afterSummary = false): StepResult => {
      // [TRANSCRIPCION] El RUT y el correo tardios van al mismo negocio; si llegan juntos, el correo
      // parte del estado que ya trae el RUT.
      const lateRutResult = state.deal === 'registered' ? lateRut(phone, state, body) : undefined;
      const late = state.deal === 'registered'
        ? lateEmail(phone, lateRutResult ? getFlowState(phone) : state, body, correctingEmail) ?? lateRutResult
          ?? quietAfterSummary(lateChange(phone, state, body, claudeParsed, Boolean(signals.hasMedia), false, afterSummary), afterSummary)
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
    };
    // [RESUMEN] (ronda 4, A) Lo que el cliente contesta al resumen y no se aplica entero queda textual en la nota del
    // mismo negocio (withUnappliedNote): ninguna correccion se pierde.
    if (!newRequest && summaryPending) {
      const report: SummaryReport = {};
      // (ronda 5, C5) La cantidad que no calza con un item no prueba la vuelta sin modo resumen: MSG4 y la linea textual.
      const answered = summaryAnswer(phone, state, body, claudeParsed, Boolean(signals.hasMedia), correctingEmail, report)
        ?? (report.unmapped ? { reply: registeredClosing(), shouldCreateDeal: false, shouldNotify: false, captureStatus: state.captureStatus, captured: state.captured, wantsHuman: state.wantsHuman, closedFlow: true } : closedAnswer(true));
      return withUnappliedNote(phone, state, body, claudeParsed, Boolean(signals.hasMedia), answered, Boolean(report.dropped));
    }
    if (!newRequest) return closedAnswer();
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
    const leadType = installLeadType(state, body, claudeParsed, updatedCaptured);
    if (missingRequired.length === 0) {
      const captureStatus = computeInstallCaptureStatus(updatedCaptured);
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, isInstallFlow: true, leadType });
      console.log('[flowEngine] install_capture completo en primer mensaje');
      return { reply: MSG4, shouldCreateDeal: true, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const reply = buildInstallCaptureMsg(updatedCaptured);
    saveFlowState(phone, { ...state, stage: 'install_capture', captured: updatedCaptured, repreguntasInstall: 1, isInstallFlow: true, leadType });
    console.log('[flowEngine] install_capture iniciado, missing: ' + missingRequired.join(', '));
    return { reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: updatedCaptured, wantsHuman: false, closedFlow: false };
  }

  if (state.stage === 'install_capture') {
    const updatedCaptured = mergeInstallFields(state.captured, body, claudeParsed, answersComuna(state));
    const { missingRequired } = getMissingInstallFields(updatedCaptured);
    const leadType = installLeadType(state, body, claudeParsed, updatedCaptured);
    if (missingRequired.length === 0) {
      const captureStatus = computeInstallCaptureStatus(updatedCaptured);
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, isInstallFlow: true, leadType });
      console.log('[flowEngine] install_capture completo \u2014 derivando');
      return { reply: MSG4, shouldCreateDeal: true, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const repreg = state.repreguntasInstall + 1;
    if (repreg > 3) {
      const captureStatus: CaptureStatus = updatedCaptured.install_correo ? 'partial' : 'incomplete';
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, repreguntasInstall: repreg, isInstallFlow: true, leadType });
      console.log('[flowEngine] install_capture timeout \u2014 cerrando con status=' + captureStatus);
      return { reply: installClosingMsg(updatedCaptured), shouldCreateDeal: updatedCaptured.install_correo ? true : false, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const reply = buildInstallCaptureMsg(updatedCaptured);
    saveFlowState(phone, { ...state, stage: 'install_capture', captured: updatedCaptured, repreguntasInstall: repreg, isInstallFlow: true, leadType });
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
        const closed1: FlowState = { ...state, stage: 'closed', captured: merged, captureStatus: finalStatus, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType };
        saveFlowState(phone, closed1);
        console.log('[flowEngine] closePartial stage1, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ? 's\u00ed' : 'no'));
        return { ...productClosing(phone, closed1, canCreateDeal, wantsHuman), shouldCreateDeal: canCreateDeal, shouldNotify: false, captureStatus: finalStatus, captured: merged, wantsHuman, closedFlow: true };
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
        const closed2: FlowState = { ...state, stage: 'closed', captured: merged, captureStatus: finalStatus, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType };
        saveFlowState(phone, closed2);
        console.log('[flowEngine] closePartial stage2, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ? 's\u00ed' : 'no'));
        return { ...productClosing(phone, closed2, canCreateDeal, wantsHuman), shouldCreateDeal: canCreateDeal, shouldNotify: false, captureStatus: finalStatus, captured: merged, wantsHuman, closedFlow: true };
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
        const complete: FlowState = { ...state, stage: 'closed', captured: merged, captureStatus: cs, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType };
        saveFlowState(phone, complete);
        return { ...productClosing(phone, complete, true, wantsHuman), shouldCreateDeal: true, shouldNotify: false, captureStatus: cs, captured: merged, wantsHuman, closedFlow: true };
      }
      if (repreg3 >= 1) {
        const cs = computeCaptureStatus(merged, currentLeadType);
        const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : 'partial';
        const closed3: FlowState = { ...state, stage: 'closed', captured: merged, captureStatus: finalStatus, repreguntasStage1: repreg1, repreguntasStage2: repreg2, repreguntasStage3: repreg3, wantsHuman, leadType: currentLeadType };
        saveFlowState(phone, closed3);
        console.log('[flowEngine] closePartial stage3, status=' + finalStatus + ', correo=' + (merged.correo ? 's\u00ed' : 'no'));
        const canCreate3 = canRegister(merged);  // [FIX-EMAIL-GATE] solo crear si hay correo
        return { ...productClosing(phone, closed3, canCreate3, wantsHuman), shouldCreateDeal: canCreate3, shouldNotify: false, captureStatus: finalStatus, captured: merged, wantsHuman, closedFlow: true };
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

// [TILDES] La etiqueta de la comuna se muestra al cliente (buildRepregunta1/2) y es la clave de ASKED_FIELD: va en
// una sola constante para que las dos cambien juntas (si no, la respuesta con la comuna no se reconoceria).
const COMUNA_LABEL = 'comuna o ciudad de instalaci\u00f3n';
// [CANTIDAD] Que dato pide cada item de las preguntas (las etiquetas de missingStage1/2/3).
const ASKED_FIELD: Record<string, AskedField> = {
  'producto': 'producto',
  'tipo de luz preferida': 'tipo_de_luz',
  'cantidad de unidades': 'cantidad',
  'espacio o proyecto de uso': 'proyecto_o_uso',
  [COMUNA_LABEL]: 'comuna_o_ciudad',
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
  if (!f.comuna_o_ciudad) m.push(COMUNA_LABEL);
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
  // [TILDES] El color se muestra con su tilde (luzShown); el valor guardado no cambia.
  if (captured.tipo_de_luz) hints.push(luzShown(/^luz\b/i.test(captured.tipo_de_luz) ? captured.tipo_de_luz : 'luz ' + captured.tipo_de_luz));
  const intro = hints.length > 0 ? 'Entendido, para ' + hints.join(', ') + ' podemos orientarte bien.' : 'Gracias por tu mensaje, podemos ayudarte.';
  if (missing.length === 1) return intro + ' Solo necesito saber ' + missing[0] + ' para continuar.';
  const items = missing.map((x, i) => i + 1 + ') ' + capitalize(x));
  return intro + ' Para recomendarte las opciones adecuadas, necesito:\n' + items.join('\n') + '\n\n\u00bfMe los puedes indicar?';
}

// [TILDES] normalizeLuz guarda "calida" y "fria" sin tilde (se usan para comparar y van asi a Pipedrive), y Claude puede
// devolver "ambar": al mostrarlos al cliente llevan su tilde. Solo esas palabras enteras; otro color queda tal cual.
const LUZ_TILDE: Record<string, string> = {
  calida: 'c\u00e1lida', calidas: 'c\u00e1lidas', calido: 'c\u00e1lido', calidos: 'c\u00e1lidos',
  fria: 'fr\u00eda', frias: 'fr\u00edas', frio: 'fr\u00edo', frios: 'fr\u00edos', ambar: '\u00e1mbar',
};
function luzShown(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])(?:calid[ao]s?|fri[ao]s?|ambar)(?![\p{L}\p{N}])/giu, (word) => {
    const accented = LUZ_TILDE[word.toLowerCase()];
    if (word === word.toLowerCase()) return accented;
    if (word === word.toUpperCase()) return accented.toUpperCase();
    return word === capitalize(word.toLowerCase()) ? capitalize(accented) : word;
  });
}

function buildRepregunta2(missing: string[]): string {
  if (missing.length === 1) return 'Casi listo. Solo me falta saber: ' + missing[0] + '. \u00bfMe lo puedes indicar?';
  return 'Casi listo. Solo me falta saber:\n' + missing.map((x) => '- ' + x).join('\n') + '\n\n\u00bfMe los puedes indicar?';
}

function buildRepregunta3(missing: string[], leadType: LeadType): string {
  if (missing.length === 1) {
    const campo = missing[0];
    if (campo === 'RUT de la empresa') return 'Para registrar tu solicitud necesito el RUT de la empresa.';
    if (campo === 'correo de contacto') return MSG_EMAIL_SHORT;
    if (campo === 'nombre') return 'Para registrar tu solicitud necesito tu nombre.';
    return 'Para registrar tu solicitud necesito tu ' + campo + '.';
  }
  return 'Para registrar tu solicitud necesito:\n' + missing.map((x) => '- ' + x).join('\n') + '\n\n\u00bfMe los puedes indicar?';
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
