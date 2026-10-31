// api/_lib/whatsapp/flowEngine.ts
// shouldNotify es siempre false aqui — la regla real vive en webhook.ts.
import { inspectRut, isBusinessRut, removeRuts } from './rutCapture.js';
import type { RutFound, RutTipo } from './rutCapture.js';
import { readQuantity } from './quantity.js';

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
  lastQuestion?: LastQuestion;
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
const INSTALLER_SELF_RE = /\b(?:soy|somos|trabajo\s+como|como)\s+(?:un\s+|una\s+)?instalador(?:a|es|as)?(?:\s+el[e\u00e9]ctric[oa]s?)?\b/gi;
function installRequested(body: string): boolean {
  return INSTALL_INTENT_RE.test(body.replace(INSTALLER_SELF_RE, ' '));
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
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;  // [FIX-EMAIL-PARSER] case insensitive
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
  const normalized = text.trim();
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
function extractCiudad(text: string): string | undefined {
  const m = text.match(CIUDAD_RE);
  return m ? m[0] : undefined;
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

// [INSTALL-FLOW] Celular o fijo de 9 digitos (+56 9 1234 5678, 912345678, 22 123 4567), sin los
// RUT del mensaje: antes cualquier numero de 8 o 9 digitos, como el de un RUT, pasaba por telefono.
const PHONE_RE = /(?:\+?56[\s.-]*)?[29](?:[\s.-]*\d){8}(?!\d)/;
const RUT_WITH_DASH_RE = /\d{1,2}(?:[.\s]?\d{3}){2}\s*[-\u2010-\u2015\u2212]\s*[\dkK]/g;
function extractPhone(body: string): string | undefined {
  const inspected = inspectRut(body);
  const ruts = inspected.found ? [inspected.found.rut] : inspected.ambiguous ?? [];
  const text = removeRuts(body, ruts).replace(RUT_WITH_DASH_RE, ' ');
  const m = text.match(PHONE_RE);
  if (!m || /\d$/.test(text.slice(0, m.index))) return undefined;
  return m[0].replace(/[\s.-]+/g, '');
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
const SAME_VALUE: Partial<Record<KeptField, (a: string, b: string) => boolean>> = {
  tipo_de_luz: (a, b) => normalizeLuz(comparable(a)) === normalizeLuz(comparable(b)),
  cantidad: (a, b) => parseInt(a, 10) === parseInt(b, 10),
};

/**
 * [NO-PISAR] Un dato vacio se llena; uno ya capturado solo cambia con un dato explicito del mismo
 * tipo en este mensaje, y el cambio queda anotado para la nota ("Cantidad: antes 2, ahora 3").
 */
function keepOrChange(merged: CapturedFields, field: KeptField, value: string | undefined, explicit: boolean): void {
  if (!value) return;
  const before = merged[field];
  if (!before) { merged[field] = value; return; }
  const same = SAME_VALUE[field] ?? ((a: string, b: string) => comparable(a) === comparable(b));
  if (!explicit || same(before, value)) return;
  merged[field] = value;
  merged.cambios = [...(merged.cambios ?? []), KEPT_LABEL[field] + ': antes ' + before + ', ahora ' + value].slice(-MAX_CAMBIOS);
  console.log('[flowEngine] cambio explicito de ' + field);
}

// [NO-PISAR] "SpA", "Ltda." o "S.A." son el tipo de una razon social, nunca el proyecto (prueba
// del 16-10: "Proyecto/uso: Spa"). Tampoco lo es una parte del nombre de la empresa.
const LEGAL_FORM_RE = /^(?:s\.?\s?p\.?\s?a\.?|ltda\.?|limitada|s\.?\s?a\.?|e\.?\s?i\.?\s?r\.?\s?l\.?|sociedad(?:\s+an[o\u00f3]nima)?)$/i;
const SPA_PROJECT_RE = /\bpara\s+(?:un|una|el|la|mi|nuestro|nuestra)\s+spa\b/i;
function claudeProject(claudeParsed: ClaudeFields, body: string): string | undefined {
  const value = claudeParsed.proyecto_o_uso?.trim();
  if (!value) return undefined;
  if (LEGAL_FORM_RE.test(value) && !SPA_PROJECT_RE.test(body)) return undefined;
  const empresa = claudeParsed.empresa ?? claudeParsed.nombre;
  if (empresa && comparable(empresa).includes(comparable(value))) return undefined;
  return value;
}

/** [NO-PISAR] El mensaje sin correos ni razon social: esas palabras no son producto, proyecto, comuna ni cantidad. */
function factsText(body: string, claudeParsed: ClaudeFields): string {
  let text = body.replace(EMAIL_RE_ALL, ' ').replace(/raz[o\u00f3]n\s+social\s*:?[^,;\n]*/gi, ' ');
  for (const name of [claudeParsed.empresa, claudeParsed.nombre]) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length > 2) text = text.split(trimmed).join(' ');
  }
  return text;
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
  const inspected = inspectRut(body, { asked: rutAsked(state) });
  const ruts = inspected.found ? [inspected.found.rut] : inspected.ambiguous ?? [];
  const facts = factsText(body, claudeParsed);
  const prodText = extractProducto(facts);
  keepOrChange(merged, 'producto', claudeParsed.producto ?? prodText, Boolean(prodText));
  const luzMatch = facts.match(LUZ_RE);
  const luzText = luzMatch ? normalizeLuz(luzMatch[0]) : undefined;
  keepOrChange(merged, 'tipo_de_luz', merged.tipo_de_luz ? luzText : claudeParsed.tipo_de_luz ?? luzText, Boolean(luzText));
  const quantity = readQuantity(facts, {
    ruts,
    asked: Boolean(state.lastQuestion?.asks.includes('cantidad')),
    menuLength: state.lastQuestion?.listLength ?? 0,
    claude: claudeParsed.cantidad,
  });
  if (quantity.value !== undefined) keepOrChange(merged, 'cantidad', String(quantity.value), quantity.explicit);
  else if (quantity.several && !merged.cantidad && !merged.cantidad_varios) merged.cantidad_varios = facts.trim().replace(/\s+/g, ' ').slice(0, 160);
  const proyText = extractProyecto(facts);
  keepOrChange(merged, 'proyecto_o_uso', claudeProject(claudeParsed, body) ?? proyText, Boolean(proyText));
  const ciudadText = extractCiudad(facts);
  keepOrChange(merged, 'comuna_o_ciudad', claudeParsed.comuna_o_ciudad ?? ciudadText, Boolean(ciudadText));
  const nombreClaud = claudeParsed.nombre ?? claudeParsed.empresa;
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
  if (state) saveFlowState(phone, { ...state, rutAskedLast: asksForRut(result.reply), lastQuestion: question });
  return result;
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
  const isInstallIntent = installRequested(body);
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
    return { reply: MSG1, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: state.captured, wantsHuman, closedFlow: false, question: askedIn(STAGE1_FIELDS, STAGE1_FIELDS.length) };
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
    return { reply: menuClarifyMsg(menuPick), shouldCreateDeal: false, shouldNotify: false, captureStatus: computeCaptureStatus(merged, currentLeadType), captured: merged, wantsHuman, closedFlow: false, question: askedIn(STAGE1_FIELDS, 0) };
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
