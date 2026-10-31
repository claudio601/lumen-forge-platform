// api/_lib/whatsapp/flowEngine.ts
// shouldNotify es siempre false aqui — la regla real vive en webhook.ts.
import { inspectRut, isBusinessRut, removeRuts } from './rutCapture.js';
import type { RutFound, RutTipo } from './rutCapture.js';
import { mentionsItem, mentionsQuantity, readQuantity } from './quantity.js';
import type { QuantityRead } from './quantity.js';

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
  proyecto_o_uso?: string;
  comuna_o_ciudad?: string;
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
  // [RUT-VALIDO] Un RUT que llega despues del cierre se suma a un negocio ya registrado: si
  // Pipedrive no lo confirma, el negocio sigue registrado (webhook.ts no lo marca como fallido).
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
export const MSG4_INSTALL = 'Perfecto, tu solicitud de instalaci\u00f3n qued\u00f3 registrada. Te vamos a escribir por correo para coordinar la visita y la cotizaci\u00f3n.';
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
// [CIERRE-HONESTO] Texto B, aprobado por el dueno (2026-10-16). Pipedrive no confirmo el negocio
// (o el paso del flujo fallo): nunca se dice "quedo registrada".
export const MSG_DEAL_FAILED = 'No pude registrar tu solicitud por un problema t\u00e9cnico. Por favor, env\u00edala a ventas@elights.cl y Claudio Quero te responde por correo.';
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
// [INSTALL-FLOW] Deteccion de intencion de instalacion/servicio
// Activa el flujo de captura de lead para instalacion antes de cualquier derivacion
const INSTALL_INTENT_RE = /\b(instalaci[o\u00f3]n|instalar|servicio\s+de\s+instal|quiero\s+instalar|necesito\s+instalar|cotizar\s+instalaci[o\u00f3]n|proyecto\s+de\s+instalaci[o\u00f3]n|instalador|instaladores)\b/i;
// [INSTALL-FLOW] "Soy instalador" describe a quien escribe (compra para instalar), no pide una
// instalacion: va al flujo de productos. "Busco un instalador" si la pide.
const INSTALLER_SELF_RE = /\b(?:(?:soy|somos)\s+(?:(?!(?:busco|buscamos|necesito|necesitamos|quiero|queremos|requiero|que|para)\b)[a-z\u00e0-\u00fc]+\s+){0,3}?instalador(?:a|es|as)?(?:\s+el[e\u00e9]ctric[oa]s?)?|(?:trabajo|me\s+desempe[n\u00f1]o)\s+(?:como|de)\s+instalador(?:a|es|as)?|me\s+dedico\s+a\s+(?:la\s+|las\s+)?instal\w*|soy\s+(?:un\s+|una\s+)?(?:electricista|contratista|t[e\u00e9]cnico\s+el[e\u00e9]ctrico))\b/gi;
// Quien se presenta como instalador solo pide una instalacion con un pedido de servicio a eLIGHTS ("que me
// instalen", "servicio de instalacion", "mano de obra", "quiero cotizar la instalacion", "cuanto cobran la
// instalacion"): "necesito 50 paneles para una instalacion" o "estoy cotizando una instalacion para un
// cliente" es una compra para su trabajo.
const INSTALL_SERVICE_RE = /\b(?:servicio\s+de\s+instal|que\s+(?:(?:me|nos|se)\s+)?(?:(?:lo|los|la|las)\s+)?instal(?:en|e)\b|mano\s+de\s+obra|busco\s+(?:un\s+|una\s+|otro\s+|otra\s+)?instalador|(?:necesito|necesitamos|quiero|queremos|requiero|requerimos)\s+(?:tambi[e\u00e9]n\s+)?(?:la\s+|una\s+|el\s+|un\s+)?(?:instalaci[o\u00f3]n|instalador)|(?:quiero|queremos|quisiera|quisi[e\u00e9]ramos|necesito|necesitamos|pueden|puede|podr[i\u00ed]an?)\s+cotizar(?:me|nos)?\s+(?:la\s+|una\s+|el\s+)?(?:instalaci[o\u00f3]n|montaje)|(?:me|nos)\s+(?:cotizan|cotiza|cotizas|pueden\s+cotizar|podr[i\u00ed]an\s+cotizar)\s+(?:la\s+|una\s+|el\s+)?(?:instalaci[o\u00f3]n|montaje)|ustedes\s+(?:tambi[e\u00e9]n\s+)?instalan|(?:hacen|realizan|ofrecen)\s+(?:la\s+|el\s+servicio\s+de\s+)?instalaci[o\u00f3]n|cu[a\u00e1]nto\s+(?:sale|cuesta|cobran|vale|costar[i\u00ed]a|saldr[i\u00ed]a)\s+(?:por\s+)?(?:la\s+)?instalaci[o\u00f3]n|cu[a\u00e1]nto\s+cobran\s+por\s+instalar)/i;
function installRequested(body: string): boolean {
  const rest = body.replace(INSTALLER_SELF_RE, ' ');
  return rest === body ? INSTALL_INTENT_RE.test(body) : INSTALL_SERVICE_RE.test(rest);
}
// A mitad del flujo de productos, "la instalacion es en una bodega" o "los voy a instalar en mi casa" contestan
// la pregunta del bot (MSG2): solo un pedido de instalacion ("que me los instalen", "quiero instalar focos en
// mi casa", "cuanto cobran la instalacion") cambia de flujo.
const WANT_INSTALL_RE = /\b(?:quiero|queremos|necesito|necesitamos)\s+instalar\b/i;
function installRequestedMidProducts(body: string): boolean {
  const rest = body.replace(INSTALLER_SELF_RE, ' ');
  return INSTALL_SERVICE_RE.test(rest) || (rest === body && WANT_INSTALL_RE.test(body));
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
const LUZ_RE = /c[a\u00e1]lid[ao]s?|neutr[ao]s?|fr[i\u00ed][ao]s?|warm|cool|daylight|3000\s*k|4000\s*k|5000\s*k|6500\s*k|blancas?\s+c[a\u00e1]lid[ao]s?|blancas?\s+fr[i\u00ed][ao]s?|luz\s+c[a\u00e1]lid[ao]?|luz\s+fr[i\u00ed][ao]?|blanco\s+fr[i\u00ed]o|blanco\s+c[a\u00e1]lido/i;
// [CANTIDAD] Empieza donde empieza la palabra: sin eso, un texto largo sin "@" se recorria una vez por letra.
const EMAIL_RE = /(?<![a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;  // [FIX-EMAIL-PARSER] case insensitive
const CIUDAD_RE = /\b(santiago|maipu|pudahuel|quilicura|la florida|penalolen|nunoa|providencia|las condes|vitacura|lo barnechea|san miguel|la cisterna|el bosque|san bernardo|puente alto|valparaiso|vina del mar|concepcion|temuco|rancagua|talca|iquique|antofagasta|arica|copiapo|la serena|coihaique|punta arenas)\b/i;
const PROYECTO_RE = /\b(quincho|terraza|patio|living|comedor|dormitorio|habitaci[o\u00f3]n|cocina|ba[\u00f1n]o|ba[\u00f1n]os|jardin|bodega|oficina|casa|local\s+comercial|local|galp[o\u00f3]n|galpon|faena|tienda|exterior|interior|planta|f[a\u00e1]brica|fabrica|nave\s+industrial|departamento|edificio|colegio|hospital|estacionamiento|pasillo|sala)\b/i;

// NOTA: 'instalacion' fue removido de B2B_SIGNAL_RE — no es señal B2B por si sola
const B2B_SIGNAL_RE = /empresa|factura|obra|proveedor|licitaci[o\u00f3]n|constructora|bodega|oficina|local comercial|proyecto comercial|s\.a\.|spa|ltda/i;
const PRODUCTO_RE = /\b(campana(?:s)?\s+(?:led|industrial(?:es)?)|panel(?:es)?\s+led|plafon(?:es)?\s+led|ampolleta(?:s)?\s+led|ampolleta(?:s)?|foco(?:s)?\s+led|foco(?:s)?|dicroico(?:s)?|reflector(?:es)?\s+led|reflector(?:es)?|proyector(?:es)?\s+led|proyector(?:es)?|tira(?:s)?\s+led|cinta(?:s)?\s+led|downlight(?:s)?|empotrado(?:s)?\s+led|tubo(?:s)?\s+led|tubo(?:s)?\s+fluorescente(?:s)?|luminaria(?:s)?\s+led|luminaria(?:s)?)\b/i;

// [INSTALL-FLOW] Tipo de proyecto para instalacion
const INSTALL_TIPO_PROYECTO_RE = /\b(casa|departamento|depto|oficina|local comercial|local|bodega|galpon|quincho|terraza|patio|jardin|exterior|edificio|condominio|empresa|industria|nave|faena|planta|colegio|hospital|estacionamiento)\b/i;
// [CIERRE-HONESTO] Los correos de eLIGHTS (ventas@, claudio@, constanza@) los publica el propio
// bot (textos A y B, MSG_EXECUTIVE, MSG4_INSTALL_NO_EMAIL): nunca son el correo del cliente.
// Si el cliente responde "le escribo a ventas@elights.cl", no hay correo suyo que registrar.
const EMAIL_RE_ALL = new RegExp(EMAIL_RE.source, 'gi');
const OWN_EMAIL_RE = /@(?:[a-z0-9-]+\.)*elights\.cl$/i;
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
  const plain = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return !new RegExp('^(?:' + CIUDAD_RE.source + ')$', 'i').test(plain);
}
// [NO-PISAR] La comuna sin importar tildes ni enies (Maipu, Nunoa o Concepcion escritas con ellas), devuelta como
// la escribio el cliente: CIUDAD_RE las tiene sin tildes y antes solo las encontraba asi.
function extractCiudad(text: string): string | undefined {
  const m = bareText(text).match(CIUDAD_RE);
  return m ? text.slice(m.index, m.index + m[0].length) : undefined;
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
  flowStates.set(phone, state);
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
    console.log('[flowEngine] resultado del negocio de otra conversacion — no se anota');
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
function mergeInstallFields(
  captured: CapturedFields,
  body: string,
  claudeParsed: { nombre?: string; empresa?: string; correo?: string; comuna_o_ciudad?: string; proyecto_o_uso?: string; },
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
  if (!updated.install_comuna) {
    const ciudad = claudeParsed.comuna_o_ciudad ?? extractCiudad(body);
    if (ciudad) updated.install_comuna = ciudad;
  }
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
const PHONE_NOISE_RE = /(?:https?:\/\/|www\.)\S*|\b[a-z]+[-_]?\d[\w-]*|\b(?:modelo|mod|c[o\u00f3]digo|cod|ref|referencia|sku|serie|pedido|orden|folio|factura|boleta|oc|cotizaci[o\u00f3]n|licitaci[o\u00f3]n|n[\u00b0\u00ba])\.?\s*[:#.]?\s*(?:n[\u00b0\u00ba]\.?\s*)?\d[\d.-]*/gi;
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
function productWords(text: string): string[] {
  return comparable(text).replace(/\b(?:para|en)\b.*$/, '').split(/[^a-z0-9]+/)
    .filter((w) => w && !PRODUCT_NOISE_RE.test(w))
    .map((w) => (/\d/.test(w) ? w : w.replace(/ces$/, 'z').replace(/s$/, '').replace(/e$/, '')));
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
function keepOrChange(merged: CapturedFields, field: KeptField, fill: string | undefined, change: string | undefined): void {
  const before = merged[field];
  if (!before) { if (fill) merged[field] = fill; return; }
  const same = SAME_VALUE[field] ?? ((a: string, b: string) => comparable(a) === comparable(b));
  if (!change || same(before, change)) return;
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
/** [NO-PISAR] Un codigo o medida ("T8", "18W", "60x60") es el mismo solo con los mismos numeros ("18" y "18w" si; "t5" y "t8" no). */
function sameSpec(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return /\d/.test(short) && long.startsWith(short) && !/\d/.test(long.charAt(short.length));
}
/** [NO-PISAR] Cada palabra del dato de Claude esta en el mensaje, sin tildes ni plurales ("oficinas", Nunoa con enie). */
function inMessage(value: string, text: string): boolean {
  const words = comparable(value).split(/[^a-z0-9]+/).filter((w) => (w.length >= 3 || /\d/.test(w)) && !IN_MESSAGE_SKIP_RE.test(w));
  const textWords = comparable(text).split(/[^a-z0-9]+/);
  return words.length > 0 && words.every((w) => textWords.some((t) => t === w || (/\d/.test(w)
    ? sameSpec(t, w)
    : Math.min(t.length, w.length) >= 4 && (t.startsWith(w) || w.startsWith(t)))));
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
const LUZ_NEGATED_RE = /\b(?:no|ni|sin|nada\s+de|tampoco|menos)\s+(?:(?:lo|la|los|las|le|les|me|nos|se)\s+)?(?:(?:sea|sean|es|son|quiero|queremos|necesito|necesitamos|busco|buscamos|gusta|gustan)\s+)?(?:(?:la|el|una|un|en|de|luz|color|tono|blanca|blanco|tan|muy|tipo)\s+){0,3}$/i;
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
// afirma antes se conserva, salvo una condicion ("y si necesito 50, cuanto sale?"). Una pregunta indirecta
// ("quiero saber si tienen reflectores") tampoco es un dato.
const ASSERTION_RE = /\b(?:necesit|quier|quis|requier|requer|busc|ocup|son\b|ser[i\u00ed]an?\b|ahora\b|cambi|corrij|perd[o\u00f3]n|es\s+para|soy\b|somos\b|estoy\b|estamos\b)/i;
const CONDITIONAL_RE = /^\s*(?:y\s+|pero\s+)?(?:si|en\s+caso\s+(?:de\s+)?(?:que\s+)?|por\s+si)\s+[^\s,;]/i;
const INDIRECT_QUESTION_RE = /\b(?:saber|consultar|preguntar(?:le|les|te)?)\s+(?:si|por|cu[a\u00e1]nt\w*|qu[e\u00e9]|c[o\u00f3]mo|d[o\u00f3]nde|cu[a\u00e1]l\w*)(?![a-z\u00e0-\u00fc])[^,;.!?\n]*/gi;
function withoutQuestions(text: string): string {
  const direct = text.replace(INDIRECT_QUESTION_RE, ' ');
  if (!/[?\u00bf]/.test(direct)) return direct;
  return direct.split(/(?<=[.!?\n])|(?=\u00bf)/).map((part) => {
    if (!/[?\u00bf]/.test(part)) return part;
    if (part.includes('\u00bf')) return '';
    const cut = Math.max(part.lastIndexOf(','), part.lastIndexOf(';'));
    const clauses = cut >= 0 ? part.slice(0, cut + 1).split(/(?<=[,;])/) : [];
    const conditional = clauses.findIndex((clause) => CONDITIONAL_RE.test(clause));
    const head = (conditional >= 0 ? clauses.slice(0, conditional) : clauses).join('');
    return ASSERTION_RE.test(head) ? head : '';
  }).join(' ');
}
// [NO-PISAR] Lo que el cliente niega no es un dato: "no es para bodega", "no necesito 20 focos", "no los
// quiero frios". Se tapa solo el dato negado, con su verbo y sus articulos: lo que sigue si cuenta ("no eran
// 10 eran 20", "no es en Santiago es en Temuco", "no me acorde, tambien necesito 6 focos").
const NEGATED_CUT = '(?!(?:pero|sino|aunque|mejor|perd[o\\u00f3]n|tambi[e\\u00e9]n|adem[a\\u00e1]s|aparte|ahora|c[a\\u00e1]mbi[a-z]*|corrij[a-z]*|equivoqu[a-z\\u00e0-\\u00fc]*|es|era|eran|son|sea|sean|ser[i\\u00ed]an?|que|necesit[a-z]*|quier[a-z]*|quis[a-z]*|busc[a-z]*|requier[a-z]*|ocup[a-z]*|estoy|estamos|soy|somos)(?![a-z\\u00e0-\\u00fc]))';
const NEGATED_WORD = NEGATED_CUT + '[^\\s,;.!?\\n]+';
const NEGATED_DATUM_RE = new RegExp('(?<![a-z\\u00e0-\\u00fc])(?:no|ni|tampoco|nada\\s+de)\\s+'
  + '(?:(?:lo|la|los|las|le|les|me|nos|se|te)\\s+)?'
  + '(?:(?:es|era|eran|son|sea|sean|fue|fueron|ser[a\\u00e1]n?|ser[i\\u00ed]an?|estoy|estamos|est[a\\u00e1]n?|soy|somos|necesito|necesitamos|quiero|queremos|busco|buscamos|ocupo|ocupamos|requiero|tengo|tenemos|gusta|gustan)\\s+)?'
  + '(?:(?:para|en|de|del|un|una|unos|unas|el|la|los|las|mi|mis|su|sus|nuestr[oa]s?|luz|color|tono|tan|muy|tipo)\\s+){0,3}'
  + NEGATED_WORD + '(?:(?<=\\d)\\s+' + NEGATED_WORD + ')?(?:\\s+(?:led|leds|solar|solares))?', 'gi');
function maskNegated(text: string): string {
  return text.replace(NEGATED_DATUM_RE, ' ');
}
// [NO-PISAR] "tambien necesito 10 focos", "20 focos ademas", "agrega", "otros 5", "5 paneles mas": suma un
// item, no cambia lo capturado. "Tambien" o "ademas" suman solo si nombran un producto o una cantidad, y
// nunca en una correccion ("tambien quiero cambiar la cantidad a 20") ni en una caracteristica ("ademas que
// sean calidos").
const ADDITION_WORD_RE = /(?<![a-z\u00e0-\u00fc])(?:tambi[e\u00e9]n|adem[a\u00e1]s|aparte)(?![a-z\u00e0-\u00fc])/gi;
const ADD_VERB_RE = /\b(?:agreg(?:a|ar|ame|ale|uen)|sum(?:a|ar|ame|ale))\b|\botr[oa]s?\s+\d/i;
// "5 paneles mas", "y 20 focos mas", "mas 20 focos"; nunca "20 o mas", "mas o menos", "mas de 20" ni "mas potentes".
const MORE_RE = /\b\d+\s+(?:[a-z\u00e0-\u00fc]+\s+){0,3}?(?<!\bo\s)m[a\u00e1]s(?=\s*(?:[,.;!?\n]|$)|\s+(?:y|para|por\s+favor|porfa)\b)|(?:^|[,.;!?\n]|\by)\s*m[a\u00e1]s\s+\d/i;
// Una correccion de un dato ("corrijo", "me equivoque", "cambia la cantidad a 20", "en vez de 10", "mejor 20"),
// no las mismas palabras en un pedido ("para cambiar los fluorescentes", "focos con cambio de color", "la mejor calidad").
const CORRECTION_RE = /(?:corrij|corrig|correcci[o\u00f3]n|me\s+equivoqu|perd[o\u00f3]n\s*,?\s*(?:son|eran|era|es|ser[i\u00ed]an)\b|c[a\u00e1]mbi[a-z]*\s+(?:la\s+cantidad|el\s+producto|el\s+color|la\s+luz|el\s+tipo|a\s+\d)|en\s+(?:vez|lugar)\s+de\s+\d|(?:^|[,.;!?\n]\s*)(?:no\s*,?\s*)?mejor\s+(?:\d|son\b|que\s+sean|ser[i\u00ed]an))/i;
const addsItem = (text: string) => mentionsItem(text) || mentionsQuantity(text);
function isAddition(text: string): boolean {
  if (CORRECTION_RE.test(text)) return false;
  if (ADD_VERB_RE.test(text) || MORE_RE.test(text)) return true;
  for (const m of text.matchAll(ADDITION_WORD_RE)) {
    const after = text.slice(m.index + m[0].length);
    if (addsItem(after.split(/[.;!?\n]/)[0])) return true;
    // Al final de su clausula ("necesito 20 focos tambien"), suma lo que va antes; "aparte" no ("que no
    // tengan panel aparte" es "por separado").
    const rest = after.split(/[,.;!?\n]/)[0].replace(/\b(?:porfa|por\s+favor|y)\b/gi, '');
    if (!rest.trim() && !/^apart/i.test(m[0]) && addsItem(text.slice(0, m.index).split(/[,.;!?\n]/).pop() ?? '')) return true;
  }
  return false;
}

const MAX_VARIOS = 160;
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
      merged.cantidad_varios = ((merged.producto ? merged.producto + ': ' : '') + merged.cantidad + ' / ' + text).slice(0, 2 * MAX_VARIOS);
      delete merged.cantidad;
    } else appendVarios(merged, text);
    return;
  }
  if (quantity.several) {
    if (!merged.cantidad) { appendVarios(merged, text); return; }
    if (!stated.several) return;
    noteChange(merged, 'cantidad', merged.cantidad, 'varios items');
    delete merged.cantidad;
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
    return;
  }
  keepOrChange(merged, 'cantidad', value, change);
}

// [NO-PISAR] "SpA", "Ltda." o "S.A." son el tipo de una razon social, nunca el proyecto (prueba
// del 16-10: "Proyecto/uso: Spa"). Tampoco lo es una parte del nombre de la empresa.
const LEGAL_FORM_RE = /^(?:s\.?\s?p\.?\s?a\.?|ltda\.?|limitada|s\.?\s?a\.?|e\.?\s?i\.?\s?r\.?\s?l\.?|sociedad(?:\s+an[o\u00f3]nima)?)$/i;
const SPA_PROJECT_RE = /\bpara\s+(?:un|una|el|la|mi|nuestro|nuestra)\s+spa\b/i;
function claudeProject(claudeParsed: ClaudeFields, body: string): string | undefined {
  const value = claudeText(claudeParsed.proyecto_o_uso);
  if (!value) return undefined;
  if (LEGAL_FORM_RE.test(value) && !SPA_PROJECT_RE.test(body)) return undefined;
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
const RAZON_SOCIAL_RE = new RegExp('raz[o\\u00f3]n\\s+social\\s*:?\\s*(?:(?:' + RAZON_NAME_WORD + '\\s+){0,6}?(?:s\\.?\\s?p\\.?\\s?a\\.?|ltda\\.?|limitada|s\\.?\\s?a\\.?|e\\.?\\s?i\\.?\\s?r\\.?\\s?l\\.?)(?![a-z])|(?:' + RAZON_WORD + '[^\\S\\n]*){1,6})', 'gi');
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
/** [NO-PISAR] El mensaje sin correos ni razon social: esas palabras no son producto, proyecto, comuna ni cantidad. */
function factsText(body: string, claudeParsed: ClaudeFields): string {
  let text = body.slice(0, MAX_FACTS);
  for (const name of [claudeParsed.empresa, claudeParsed.nombre]) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length > 2) text = removeLoose(text, trimmed);
  }
  return text.replace(EMAIL_RE_ALL, ' ').replace(RAZON_SOCIAL_RE, ' ');
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
): { merged: CapturedFields; leadType: LeadType; rutToConfirm: boolean; menuPick?: number } {
  const merged: CapturedFields = { ...state.captured };
  // [CANTIDAD] Un estado guardado antes de este cambio puede traer un dato que no es texto (un
  // objeto de Claude) o una cantidad que no es un entero ("No especificada"): se descarta y se pregunta.
  for (const field of KEPT_FIELDS) if (merged[field] !== undefined && typeof merged[field] !== 'string') delete merged[field];
  if (merged.cantidad && !/^\d{1,5}$/.test(merged.cantidad)) delete merged.cantidad;
  const inspected = inspectRut(body, { asked: rutAsked(state) });
  const ruts = inspected.found ? [inspected.found.rut] : inspected.ambiguous ?? [];
  const facts = factsText(body, claudeParsed);
  // [NO-PISAR] Un dato capturado cambia solo con lo que el cliente afirma (sin sus preguntas ni lo que
  // niega) y nunca si el mensaje suma otro item. La regla cambia un dato solo si encuentra un valor (soleMatch).
  const assertive = maskNegated(withoutQuestions(facts));
  const adding = isAddition(assertive);
  const rule = (re: RegExp) => (adding ? undefined : soleMatch(assertive, re));
  const said = (value: string | undefined) => (adding ? undefined : value);
  // [CANTIDAD] Un numero suelto contesta la pregunta solo si la cantidad todavia falta.
  const question = lastQuestionOf(state);
  const options = {
    ruts,
    asked: Boolean(question?.asks.includes('cantidad')) && !merged.cantidad && !merged.cantidad_varios,
    menuLength: question?.listLength ?? 0,
    contact: EMAIL_RE.test(body),
    claude: claudeParsed.cantidad,
  };
  const quantity = readQuantity(facts, options);
  const stated = assertive === facts ? quantity : readQuantity(assertive, { ...options, menuLength: 0 });
  // Con varios items ("20 paneles y 30 focos") la regla ve uno solo: no cambia el producto.
  const claudeProd = claudeText(claudeParsed.producto);
  keepOrChange(merged, 'producto', claudeProd ?? extractProducto(facts), backed(said(claudeProd), quantity.several ? undefined : rule(PRODUCTO_RE), assertive));
  // El color del texto gana al de Claude cuando no calzan (Claude puede repetir uno negado o viejo).
  const luzText = textLuz(facts);
  const claudeLuz = claudeText(claudeParsed.tipo_de_luz);
  const luzConflict = Boolean(luzText && claudeLuz && normalizeLuz(comparable(claudeLuz)) !== luzText);
  // El color que el cliente niega ("no fria") no llena el dato, aunque Claude lo devuelva.
  const luzNegated = Boolean(claudeLuz && !luzText && negatedLuz(facts).has(normalizeLuz(comparable(claudeLuz))));
  keepOrChange(merged, 'tipo_de_luz', luzConflict ? luzText : luzNegated ? undefined : claudeLuz ?? luzText, adding ? undefined : textLuz(assertive));
  mergeQuantity(merged, quantity, stated, facts, adding);
  const claudeProy = claudeProject(claudeParsed, body);
  keepOrChange(merged, 'proyecto_o_uso', claudeProy ?? extractProyecto(facts), backed(said(claudeProy), rule(PROYECTO_RE), assertive));
  const claudeCiudad = claudeText(claudeParsed.comuna_o_ciudad);
  keepOrChange(merged, 'comuna_o_ciudad', claudeCiudad ?? extractCiudad(facts), backed(said(claudeCiudad), rule(CIUDAD_RE), assertive));
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

  // Calcular leadType — instalacion NO es señal B2B
  // [RUT-VALIDO] Solo un RUT valido de empresa es senal B2B (uno de persona, no).
  let leadType: LeadType = state.leadType;
  if (leadType !== 'B2B') {
    const isB2BSignal = B2B_SIGNAL_RE.test(body) || isBusinessRut(rutFound) || (claudeParsed.empresa && claudeParsed.empresa.length > 0);
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
    ? { merged: mergeInstallFields(state.captured, body, claudeParsed), leadType: state.leadType }
    : mergeProductFields(state, body, claudeParsed);
  const captureStatus = state.isInstallFlow ? computeInstallCaptureStatus(late.merged) : computeCaptureStatus(late.merged, late.leadType);
  const next: FlowState = { ...state, captured: late.merged, captureStatus, leadType: late.leadType };
  saveFlowState(phone, next);
  const registers = Boolean(flowEmail(next));
  if (registers) console.log('[flowEngine] conversacion cerrada con correo y sin negocio — registrando' + (hadEmail ? ' (reintento)' : ''));
  let reply = closedReply(next);
  if (registers) {
    if (hadEmail) reply = registeredClosing(next);
    else reply = next.isInstallFlow ? installClosingMsg(late.merged) : productClosingMsg(true, next.wantsHuman, next.leadType);
  }
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
  console.log('[flowEngine] RUT valido despues del cierre — se suma al negocio registrado');
  return { reply: registeredClosing(next), shouldCreateDeal: true, shouldNotify: false, captureStatus, captured, wantsHuman: next.wantsHuman, closedFlow: true, rutUpdate: true };
}

export function processFlowStep(
  phone: string,
  body: string,
  claudeParsed: ClaudeFields,
  signals: { wantsHuman: boolean; qualifiesForDeal: boolean },
): FlowResult {
  const { question, ...result } = flowStep(phone, body, claudeParsed, signals);
  // [RUT-VALIDO] Se anota si esta respuesta pide el RUT: vale solo para el mensaje siguiente.
  // [CANTIDAD] Tambien que pregunta hizo (sin pregunta, ninguna: un numero suelto no es cantidad).
  const state = flowStates.get(phone);
  if (state) saveFlowState(phone, { ...state, rutAskedLast: asksForRut(result.reply), lastQuestion: question ?? null });
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
  signals: { wantsHuman: boolean; qualifiesForDeal: boolean },
): StepResult {
  const state = getFlowState(phone);

  if (state.stage === 'closed') {
    const correctingRut = state.deal === 'registered' && /\brut\b/i.test(body) && /\b(?:corregir|corrijo|correcci[oó]n|correcto|actualizar|cambiar|cambio|modificar)\b/i.test(body);
    const newRequest = !correctingRut && (looksLikeNewRequest(body) || installRequested(body));
    // [CIERRE-HONESTO] Sin negocio, un mensaje con correo se suma a lo capturado y registra la
    // solicitud aunque diga "necesito" o "quiero" (antes eso reiniciaba y perdia lo capturado).
    if (!state.deal && (!newRequest || messageEmail(body, claudeParsed))) {
      return continueClosedWithoutDeal(phone, state, body, claudeParsed);
    }
    if (!newRequest) {
      const late = state.deal === 'registered' ? lateRut(phone, state, body) : undefined;
      if (late) return late;
      return {
        reply: closedReply(state),
        shouldCreateDeal: false,
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
  if (EXECUTIVE_RE.test(body) && !COMMERCIAL_INTENT_RE.test(body)) {
    saveFlowState(phone, { ...state });
    return {
      reply: MSG_EXECUTIVE,
      shouldCreateDeal: false,
      shouldNotify: false,
      captureStatus: state.captureStatus,
      captured: state.captured,
      wantsHuman: false,
      closedFlow: false,
    };
  }
  // ───────────────────────────────────────────────────────────────────────────
  // [INSTALL-FLOW] Deteccion de intencion de instalacion
  // Regla de negocio: sin correo no podemos cotizar.
  // No derivar hasta tener nombre + correo + comuna + tipoProyecto.
  // ───────────────────────────────────────────────────────────────────────────
  const midProducts = state.stage === 'stage2' || state.stage === 'stage3' || Boolean(state.captured.producto);
  const isInstallIntent = midProducts ? installRequestedMidProducts(body) : installRequested(body);
  const isAlreadyInstallFlow = state.isInstallFlow || state.stage === 'install_capture';

  if (isInstallIntent && !isAlreadyInstallFlow) {
    const updatedCaptured = mergeInstallFields(state.captured, body, claudeParsed);
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
    const updatedCaptured = mergeInstallFields(state.captured, body, claudeParsed);
    const { missingRequired } = getMissingInstallFields(updatedCaptured);
    if (missingRequired.length === 0) {
      const captureStatus = computeInstallCaptureStatus(updatedCaptured);
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, isInstallFlow: true });
      console.log('[flowEngine] install_capture completo — derivando');
      return { reply: MSG4_INSTALL, shouldCreateDeal: true, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const repreg = state.repreguntasInstall + 1;
    if (repreg > 3) {
      const captureStatus: CaptureStatus = updatedCaptured.install_correo ? 'partial' : 'incomplete';
      saveFlowState(phone, { ...state, stage: 'closed', captured: updatedCaptured, captureStatus, repreguntasInstall: repreg, isInstallFlow: true });
      console.log('[flowEngine] install_capture timeout — cerrando con status=' + captureStatus);
      return { reply: installClosingMsg(updatedCaptured), shouldCreateDeal: updatedCaptured.install_correo ? true : false, shouldNotify: false, captureStatus, captured: updatedCaptured, wantsHuman: false, closedFlow: true };
    }
    const reply = buildInstallCaptureMsg(updatedCaptured);
    saveFlowState(phone, { ...state, stage: 'install_capture', captured: updatedCaptured, repreguntasInstall: repreg, isInstallFlow: true });
    console.log('[flowEngine] install_capture en curso, missing: ' + missingRequired.join(', '));
    return { reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: updatedCaptured, wantsHuman: false, closedFlow: false };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FIN INSTALL-FLOW — flujo normal de productos LED
  // ───────────────────────────────────────────────────────────────────────────
  // [FIX-WANTSHUMAN] NO activar wantsHuman si el mensaje contiene intencion comercial
  const hasCommercialIntent = COMMERCIAL_INTENT_RE.test(body);
  const wantsHuman = state.wantsHuman || (!hasCommercialIntent && (signals.wantsHuman || Boolean(claudeParsed.wantsHuman))) || WANTS_HUMAN_RE.test(body);

  if (state.stage === 'stage1' && GREET_ONLY.test(body.trim())) {
    saveFlowState(phone, { ...state, wantsHuman });
    return { reply: MSG1, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: state.captured, wantsHuman, closedFlow: false, question: greetQuestion(state.captured) };
  }

  // [FIX-2] Intencion de precio sin producto
  if (
    PRICE_INTENT_RE.test(body) &&
    !claudeParsed.producto &&
    !extractProducto(body) &&
    !state.captured.producto
  ) {
    saveFlowState(phone, { ...state, wantsHuman });
    return {
      reply: 'Con gusto te ayudo con los precios. Que producto necesitas cotizar? (por ejemplo: focos LED, paneles, ampolletas, reflectores, etc.)',
      shouldCreateDeal: false,
      shouldNotify: false,
      captureStatus: 'incomplete',
      captured: state.captured,
      wantsHuman,
      closedFlow: false,
      question: askedIn(['producto'], 0),
    };
  }

  // PASO 1: MERGE
  const { merged, leadType: currentLeadType, rutToConfirm, menuPick } = mergeProductFields(state, body, claudeParsed);

  // [FIX-PRIORITY] PASO 2: wantsHuman path — REQUIERE correo antes de derivar
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
      // Sin correo: no podemos derivar ni crear deal — pedir correo
      const hasAnyContext = Boolean(merged.producto) || Boolean(merged.proyecto_o_uso);
      const reply = hasAnyContext ? MSG_NEED_EMAIL : MSG_NEED_EMAIL_AND_CONTEXT;
      saveFlowState(phone, { ...state, captured: merged, wantsHuman: true, leadType: currentLeadType, humanEmailAsked: true });
      console.log('[flowEngine] wantsHuman sin correo — pidiendo correo antes de derivar');
      return { reply, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: merged, wantsHuman: true, closedFlow: false, question: askedIn(hasAnyContext ? ['correo de contacto'] : ['producto', 'correo de contacto'], 0) };
    }
  }
  // [RUT-VALIDO] Un RUT que no calza se pide de nuevo una sola vez, en la etapa en que estaba. Si
  // llega otra vez sin calzar, queda marcado como invalido y el flujo sigue.
  if (rutToConfirm) {
    saveFlowState(phone, { ...state, captured: merged, wantsHuman, leadType: currentLeadType, rutRetryAsked: true });
    console.log('[flowEngine] RUT con digito verificador que no calza — se pide de nuevo una vez');
    return { reply: MSG_RUT_INVALID, shouldCreateDeal: false, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType), captured: merged, wantsHuman, closedFlow: false, question: askedIn(['RUT de la empresa'], 0) };
  }
  // [CASO-1] Un numero suelto despues de la lista numerada de la etapa 1 se aclara: no es la
  // cantidad ni hace avanzar la etapa (antes, con el "1" como cantidad, saltaba a la comuna y el
  // color no se volvia a preguntar).
  if (menuPick !== undefined && state.stage === 'stage1') {
    saveFlowState(phone, { ...state, captured: merged, wantsHuman, leadType: currentLeadType });
    console.log('[flowEngine] numero suelto despues de una lista — se pide aclarar');
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
        console.log('[flowEngine] closePartial stage1, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ? 'sí' : 'no'));
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
        console.log('[flowEngine] closePartial stage2, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ? 'sí' : 'no'));
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
        console.log('[flowEngine] closePartial stage3, status=' + finalStatus + ', correo=' + (merged.correo ? 'sí' : 'no'));
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
  if (captured.tipo_de_luz) hints.push('luz ' + captured.tipo_de_luz);
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
    if (campo === 'correo de contacto') return 'Para registrar tu solicitud necesito tu correo de contacto.';
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
