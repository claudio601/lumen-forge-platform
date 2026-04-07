// api/_lib/whatsapp/flowEngine.ts
// shouldNotify es siempre false aqui — la regla real vive en webhook.ts.

export type FlowStage = 'stage1' | 'stage2' | 'stage3' | 'install_capture' | 'closed';
export type CaptureStatus = 'complete' | 'partial' | 'incomplete';
export type LeadType = 'B2B' | 'B2C' | 'Unknown';

export interface CapturedFields {
  producto?: string;
  tipo_de_luz?: string;
  cantidad?: string;
  proyecto_o_uso?: string;
  comuna_o_ciudad?: string;
  nombre_o_empresa?: string;
  correo?: string;
  rut_empresa?: string;
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
}

export interface FlowResult {
  reply: string;
  shouldCreateDeal: boolean;
  shouldNotify: boolean;
  captureStatus: CaptureStatus;
  captured: CapturedFields;
  wantsHuman: boolean;
  closedFlow: boolean;
}

// [COPY-v3] Mensaje inicial para lanzamiento con numero real
export const MSG1 =
  'Hola! Soy el asistente de eLIGHTS.cl 👋

Estoy ayudando a gestionar las solicitudes de iluminacion para responder mas rapido y dejar todo listo para cotizacion.

Cuentame:
1) Que producto buscas
2) Que tipo de luz prefieres
3) Cuantas unidades necesitas aprox.';

export const MSG2 =
  'Excelente. Para recomendarte las mejores opciones, necesito saber un poco mas:
1) Para que espacio o proyecto es la instalacion?
2) En que comuna o ciudad seria?';

export const MSG3 =
  'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:
1) Tu nombre y empresa (si aplica)
2) Tu correo de contacto';

export const MSG3_B2B =
  'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:
1) El RUT de la empresa
2) Tu correo de contacto';

export const MSG3_B2C =
  'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:
1) Tu nombre
2) Tu correo de contacto';

// [COPY-v2] Cierre mejorado
export const MSG4 =
  'Listo! Tu solicitud quedo registrada en eLIGHTS.cl y ya la derivamos para cotizacion.

Un ejecutivo revisara tu requerimiento y te contactara por correo con los detalles.';

export const MSG4_B2B =
  'Listo! Tu requerimiento comercial quedo registrado en eLIGHTS.cl y ya lo derivamos a nuestro equipo de ventas.

Un ejecutivo revisara tu proyecto y te enviara la cotizacion por correo.';

// [INSTALL-FLOW] Mensaje de cierre para flujo de instalacion
export const MSG4_INSTALL =
  'Perfecto, tu solicitud de instalacion quedo registrada. Un ejecutivo de eLIGHTS te contactara a la brevedad para coordinar la visita y cotizacion.';

// [COPY-v2] Handoff
export const MSG_HUMAN =
  'Perfecto, voy a derivar tu solicitud a un ejecutivo de eLIGHTS para que te ayude directamente.

Te contactaremos a la brevedad por este mismo canal o por correo.';

export const MSG_MEDIA =
  'Recibimos tu imagen/archivo, gracias. Por ahora atendemos mejor por texto: cuentanos que producto necesitas, para que proyecto y que cantidad aproximada, y te ayudamos de inmediato.';

// [COPY-executive]
export const MSG_EXECUTIVE =
  'Perfecto 👍 Si prefieres hablar directamente con un ejecutivo, puedes escribirle por correo:
📩 claudio@elights.cl
📩 constanza@elights.cl

De todas formas, si quieres, tambien puedo ayudarte a dejar tu solicitud lista para cotizacion por acá.';

// [INSTALL-FLOW] Deteccion de intencion de instalacion/servicio
// Activa el flujo de captura de lead para instalacion antes de cualquier derivacion
const INSTALL_INTENT_RE =
  /(instalaci[oó]n|instalar|servicios+des+instal|quieros+instalar|necesitos+instalar|cotizars+instalaci[oó]n|proyectos+des+instalaci[oó]n|instalador|instaladores)/i;

const GREET_ONLY =
  /^(hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|hi|hey|buen dia)[.!?s]*$/i;
const NEW_REQ_INTENT_RE =
  /(necesito|busco|quiero|requiero|cotizar|cotizaci[oó]n|comprar|conseguir|tengo un proyecto)/i;
// [FIX-CONTINUATION] Frases de continuidad
const CONTINUATION_RE =
  /(seguir|continuar|retomar|la cotizaci[oó]n|lo anterior|la misma|el mismo|anterior|misma solicitud)/i;
const NEW_REQ_SOLO_LUZ_RE =
  /^(c[aá]lida|calida|neutra|fr[ií]a|fria|warm|cool|daylight|3000k|4000k|6500k|blanca|amarilla)[.!?s]*$/i;
const NEW_REQ_SOLO_PROYECTO_RE =
  /^(quincho|terraza|patio|living|comedor|dormitorio|habitaci[oó]n|cocina|ba[ñn]o|ba[ñn]os|bodega|oficina|casa|local comercial|local|galp[oó]n|galpon|faena|tienda|exterior|interior|planta|fabrica|nave industrial|departamento|edificio)[.!?s]*$/i;
const NEW_REQ_SOLO_RUT_RE = /^d{1,2}.?d{3}.?d{3}-?[dkK][.!?s]*$/;
const NEW_REQ_SOLO_EMAIL_RE =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}[.!?s]*$/;
// [FIX-2] Intencion de precio sin producto especificado
const PRICE_INTENT_RE =
  /(precio|precios|cu[aá]nto (cuesta|vale|sale|cuestan|valen|salen)|valor|valores|cuanto sale|cuanto cuesta|cuanto vale)/i;
// [FIX-WANTSHUMAN] Intencion comercial
const COMMERCIAL_INTENT_RE = /(cotizar|cotizaci[oó]n|comprar|necesito|busco)/i;
// [EXECUTIVE-RE] Deteccion de ejecutivos por nombre
const EXECUTIVE_RE = /(claudio|constanza)/i;

function looksLikeNewRequest(body: string): boolean {
  const b = body.trim();
  if (NEW_REQ_SOLO_LUZ_RE.test(b)) return false;
  if (NEW_REQ_SOLO_PROYECTO_RE.test(b)) return false;
  if (NEW_REQ_SOLO_RUT_RE.test(b)) return false;
  if (NEW_REQ_SOLO_EMAIL_RE.test(b)) return false;
  if (/^[A-ZÀ-Ü][a-zà-ü]+ [A-ZÀ-Ü][a-zà-ü]+[.!?s]*$/.test(b)) return false;
  if (CONTINUATION_RE.test(b)) return false;
  if (NEW_REQ_INTENT_RE.test(b)) return true;
  if (/cotizar|cotizaci[oó]n|presupuesto/i.test(b) && b.length > 15) return true;
  if (PRODUCTO_RE.test(b) && /d{1,4}/.test(b)) return true;
  return false;
}

const WANTS_HUMAN_RE =
  /ejecutivo|hablar con|hablar a|llamar|vendedor|humano|asesor|contacten|contactar|quiero hablar|necesito hablar/i;
const EXPLICIT_QUOTE =
  /cotizar|cotizacion|precio|cu[ao]nto (cuesta|vale|sale)|presupuesto|valor/i;
const LUZ_RE =
  /c[aá]lid[ao]s?|neutr[ao]s?|fr[ií][ao]s?|warm|cool|daylight|3000s*k|4000s*k|5000s*k|6500s*k|blancas?s+c[aá]lid[ao]s?|blancas?s+fr[ií][ao]s?|luzs+c[aá]lid[ao]?|luzs+fr[ií][ao]?|blancos+fr[ií]o|blancos+c[aá]lido/i;
const CANTIDAD_RE =
  /(d+)s*(unidades?|und.?|u|lumin|panel|foco|reflector|tira|strip|downlight)?/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}/;
const CIUDAD_RE =
  /(santiago|maipu|pudahuel|quilicura|la florida|penalolen|nunoa|providencia|las condes|vitacura|lo barnechea|san miguel|la cisterna|el bosque|san bernardo|puente alto|valparaiso|vina del mar|concepcion|temuco|rancagua|talca|iquique|antofagasta|arica|copiapo|la serena|coihaique|punta arenas)/i;
const PROYECTO_RE =
  /(quincho|terraza|patio|living|comedor|dormitorio|habitaci[oó]n|cocina|ba[ñn]o|ba[ñn]os|jardin|bodega|oficina|casa|locals+comercial|local|galp[oó]n|galpon|faena|tienda|exterior|interior|planta|f[aá]brica|fabrica|naves+industrial|departamento|edificio|colegio|hospital|estacionamiento|pasillo|sala)/i;
const RUT_RE = /d{1,2}.?d{3}.?d{3}-?[dkK]/;
// NOTA: "instalacion" fue removido de B2B_SIGNAL_RE — no es señal B2B por si sola
const B2B_SIGNAL_RE =
  /empresa|factura|obra|proveedor|licitaci[oó]n|constructora|bodega|oficina|local comercial|proyecto comercial|s.a.|spa|ltda/i;
const PRODUCTO_RE =
  /(campana(?:s)?s+(?:led|industrial(?:es)?)|panel(?:es)?s+led|plafon(?:es)?s+led|ampolleta(?:s)?s+led|ampolleta(?:s)?|foco(?:s)?s+led|foco(?:s)?|dicroico(?:s)?|reflector(?:es)?s+led|reflector(?:es)?|proyector(?:es)?s+led|proyector(?:es)?|tira(?:s)?s+led|cinta(?:s)?s+led|downlight(?:s)?|empotrado(?:s)?s+led|tubo(?:s)?s+led|tubo(?:s)?s+fluorescente(?:s)?|luminaria(?:s)?s+led|luminaria(?:s)?)/i;

// [INSTALL-FLOW] Tipo de proyecto para instalacion
const INSTALL_TIPO_PROYECTO_RE =
  /(casa|departamento|depto|oficina|local comercial|local|bodega|galpon|quincho|terraza|patio|jardin|exterior|edificio|condominio|empresa|industria|nave|faena|planta|colegio|hospital|estacionamiento)/i;

function extractEmail(text: string): string | undefined {
  const m = text.match(EMAIL_RE);
  return m ? m[0] : undefined;
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

function hasLuzInfo(text: string): boolean {
  return LUZ_RE.test(text);
}

function normalizeLuz(raw: string): string {
  const r = raw.toLowerCase().trim();
  if (/c[aá]lid[ao]/.test(r) || /warm/i.test(r) || /3000/i.test(r)) return 'calida';
  if (/neutr[ao]/.test(r) || /4000/i.test(r) || /5000/i.test(r)) return 'neutra';
  if (/fr[ií][ao]/.test(r) || /cool/i.test(r) || /daylight/i.test(r) || /6500/i.test(r))
    return 'fria';
  if (/blanca/.test(r) && /c[aá]lid/.test(r)) return 'calida';
  if (/blanca/.test(r) && /fr[ií]/.test(r)) return 'fria';
  return r;
}

function hasCantidadInfo(text: string): boolean {
  return CANTIDAD_RE.test(text);
}

function extractSnippet(text: string, maxLen = 120): string {
  return text.trim().substring(0, maxLen);
}

// [INSTALL-FLOW] Extrae nombre propio de un texto corto
function extractInstallNombre(text: string): string | undefined {
  const t = text.trim();
  const llamo = t.match(/(?:me llamo|soy|mi nombre es)s+([A-ZÀ-Üa-zà-ü][a-zà-ü]+(?:s+[A-ZÀ-Üa-zà-ü][a-zà-ü]+)?)/i);
  if (llamo) return llamo[1].trim();
  const dosPalabras = t.match(/^([A-ZÀ-Ü][a-zà-ü]+s+[A-ZÀ-Ü][a-zà-ü]+)[.!?s]*$/);
  if (dosPalabras) return dosPalabras[1].trim();
  const unaPalabra = t.match(/^([A-ZÀ-Ü][a-zà-ü]{2,})[.!?s]*$/);
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
    }
  );
}

export function saveFlowState(phone: string, state: FlowState): void {
  flowStates.set(phone, state);
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
  if (!captured.install_telefono) missingOptional.push('teléfono de contacto');
  if (!captured.install_descripcion) missingOptional.push('descripción breve del proyecto');
  return { missingRequired, missingOptional };
}

// [INSTALL-FLOW] Genera el mensaje de solicitud de datos
function buildInstallCaptureMsg(captured: CapturedFields): string {
  const { missingRequired } = getMissingInstallFields(captured);
  if (missingRequired.length === 0) return '';

  const hasNone = !captured.install_nombre && !captured.install_correo &&
                  !captured.install_comuna && !captured.install_tipo_proyecto;
  if (hasNone) {
    return 'Perfecto. Para derivar tu solicitud de instalacion y poder cotizarte, necesito estos datos: nombre completo, correo, comuna y tipo de proyecto.';
  }

  if (missingRequired.length === 1) {
    return 'Casi listo. Solo me falta tu ' + missingRequired[0] + ' para registrar la solicitud.';
  }
  const items = missingRequired.map((x, i) => (i + 1) + ') ' + capitalize(x)).join('
');
  return 'Gracias. Para completar tu solicitud de instalacion, necesito que me indiques:
' + items;
}

// [INSTALL-FLOW] Registra campos de instalacion desde el mensaje del usuario
function mergeInstallFields(
  captured: CapturedFields,
  body: string,
  claudeParsed: {
    nombre?: string;
    empresa?: string;
    correo?: string;
    comuna_o_ciudad?: string;
    proyecto_o_uso?: string;
  },
): CapturedFields {
  const updated = { ...captured };

  if (!updated.install_nombre) {
    const nom = claudeParsed.nombre ?? claudeParsed.empresa ?? extractInstallNombre(body);
    if (nom) updated.install_nombre = nom;
  }

  if (!updated.install_correo) {
    const email = claudeParsed.correo ?? extractEmail(body);
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
    const telMatch = body.match(/(+?56s*9s*d{4}s*d{4}|9d{8}|d{8,9})/);
    if (telMatch) updated.install_telefono = telMatch[0].replace(/s+/g, '');
  }

  return updated;
}

export function processFlowStep(
  phone: string,
  body: string,
  claudeParsed: {
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
  },
  signals: { wantsHuman: boolean; qualifiesForDeal: boolean },
): FlowResult {
  const state = getFlowState(phone);

  if (state.stage === 'closed') {
    if (!looksLikeNewRequest(body) && !INSTALL_INTENT_RE.test(body)) {
      return {
        reply: state.wantsHuman
          ? MSG_HUMAN
          : state.isInstallFlow
          ? MSG4_INSTALL
          : state.leadType === 'B2B'
          ? MSG4_B2B
          : MSG4,
        shouldCreateDeal: false,
        shouldNotify: false,
        captureStatus: state.captureStatus,
        captured: state.captured,
        wantsHuman: state.wantsHuman,
        closedFlow: true,
      };
    }
    console.log('[flowEngine] nuevo requerimiento, reset para: ' + body.substring(0, 60));
    clearFlowState(phone);
    return processFlowStep(phone, body, claudeParsed, signals);
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

  // ─────────────────────────────────────────────────────────────────────────
  // [INSTALL-FLOW] Deteccion de intencion de instalacion
  // Regla de negocio: sin correo no podemos cotizar.
  // No derivar hasta tener nombre + correo + comuna + tipoProyecto.
  // ─────────────────────────────────────────────────────────────────────────
  const isInstallIntent = INSTALL_INTENT_RE.test(body);
  const isAlreadyInstallFlow = state.isInstallFlow || state.stage === 'install_capture';

  if (isInstallIntent && !isAlreadyInstallFlow) {
    const updatedCaptured = mergeInstallFields(state.captured, body, claudeParsed);
    const { missingRequired } = getMissingInstallFields(updatedCaptured);

    if (missingRequired.length === 0) {
      const captureStatus = computeInstallCaptureStatus(updatedCaptured);
      saveFlowState(phone, {
        ...state,
        stage: 'closed',
        captured: updatedCaptured,
        captureStatus,
        isInstallFlow: true,
        leadType: 'B2C',
      });
      console.log('[flowEngine] install_capture completo en primer mensaje');
      return {
        reply: MSG4_INSTALL,
        shouldCreateDeal: true,
        shouldNotify: false,
        captureStatus,
        captured: updatedCaptured,
        wantsHuman: false,
        closedFlow: true,
      };
    }

    const reply = buildInstallCaptureMsg(updatedCaptured);
    saveFlowState(phone, {
      ...state,
      stage: 'install_capture',
      captured: updatedCaptured,
      repreguntasInstall: 1,
      isInstallFlow: true,
      leadType: 'B2C',
    });
    console.log('[flowEngine] install_capture iniciado, missing: ' + missingRequired.join(', '));
    return {
      reply,
      shouldCreateDeal: false,
      shouldNotify: false,
      captureStatus: 'incomplete',
      captured: updatedCaptured,
      wantsHuman: false,
      closedFlow: false,
    };
  }

  if (state.stage === 'install_capture') {
    const updatedCaptured = mergeInstallFields(state.captured, body, claudeParsed);
    const { missingRequired } = getMissingInstallFields(updatedCaptured);

    if (missingRequired.length === 0) {
      const captureStatus = computeInstallCaptureStatus(updatedCaptured);
      saveFlowState(phone, {
        ...state,
        stage: 'closed',
        captured: updatedCaptured,
        captureStatus,
        isInstallFlow: true,
      });
      console.log('[flowEngine] install_capture completo — derivando');
      return {
        reply: MSG4_INSTALL,
        shouldCreateDeal: true,
        shouldNotify: false,
        captureStatus,
        captured: updatedCaptured,
        wantsHuman: false,
        closedFlow: true,
      };
    }

    const repreg = state.repreguntasInstall + 1;
    if (repreg > 3) {
      const captureStatus: CaptureStatus = updatedCaptured.install_correo ? 'partial' : 'incomplete';
      saveFlowState(phone, {
        ...state,
        stage: 'closed',
        captured: updatedCaptured,
        captureStatus,
        repreguntasInstall: repreg,
        isInstallFlow: true,
      });
      console.log('[flowEngine] install_capture timeout — cerrando con status=' + captureStatus);
      return {
        reply: MSG4_INSTALL,
        shouldCreateDeal: updatedCaptured.install_correo ? true : false,
        shouldNotify: false,
        captureStatus,
        captured: updatedCaptured,
        wantsHuman: false,
        closedFlow: true,
      };
    }

    const reply = buildInstallCaptureMsg(updatedCaptured);
    saveFlowState(phone, {
      ...state,
      stage: 'install_capture',
      captured: updatedCaptured,
      repreguntasInstall: repreg,
      isInstallFlow: true,
    });
    console.log('[flowEngine] install_capture en curso, missing: ' + missingRequired.join(', '));
    return {
      reply,
      shouldCreateDeal: false,
      shouldNotify: false,
      captureStatus: 'incomplete',
      captured: updatedCaptured,
      wantsHuman: false,
      closedFlow: false,
    };
  }
  // ─────────────────────────────────────────────────────────────────────────
  // FIN INSTALL-FLOW — flujo normal de productos LED
  // ─────────────────────────────────────────────────────────────────────────

  // [FIX-WANTSHUMAN] NO activar wantsHuman si el mensaje contiene intencion comercial
  const hasCommercialIntent = COMMERCIAL_INTENT_RE.test(body);
  const wantsHuman =
    state.wantsHuman ||
    (!hasCommercialIntent &&
      (signals.wantsHuman || Boolean(claudeParsed.wantsHuman))) ||
    WANTS_HUMAN_RE.test(body);

  if (state.stage === 'stage1' && GREET_ONLY.test(body.trim())) {
    saveFlowState(phone, { ...state, wantsHuman });
    return {
      reply: MSG1,
      shouldCreateDeal: false,
      shouldNotify: false,
      captureStatus: 'incomplete',
      captured: state.captured,
      wantsHuman,
      closedFlow: false,
    };
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
      reply:
        'Con gusto te ayudo con los precios. Que producto necesitas cotizar? (por ejemplo: focos LED, paneles, ampolletas, reflectores, etc.)',
      shouldCreateDeal: false,
      shouldNotify: false,
      captureStatus: 'incomplete',
      captured: state.captured,
      wantsHuman,
      closedFlow: false,
    };
  }

  // PASO 1: MERGE
  const merged: CapturedFields = { ...state.captured };

  if (claudeParsed.producto) {
    merged.producto = claudeParsed.producto;
  } else if (!merged.producto) {
    const prod = extractProducto(body);
    if (prod) merged.producto = prod;
  }

  if (claudeParsed.tipo_de_luz) {
    merged.tipo_de_luz = claudeParsed.tipo_de_luz;
  } else if (hasLuzInfo(body)) {
    const luzMatch = body.match(LUZ_RE);
    merged.tipo_de_luz = luzMatch
      ? normalizeLuz(luzMatch[0])
      : extractSnippet(body, 40);
  }

  if (claudeParsed.cantidad) {
    merged.cantidad = claudeParsed.cantidad;
  } else if (hasCantidadInfo(body)) {
    const m = body.match(CANTIDAD_RE);
    merged.cantidad = m ? m[0].trim() : extractSnippet(body, 30);
  }

  if (claudeParsed.proyecto_o_uso) {
    merged.proyecto_o_uso = claudeParsed.proyecto_o_uso;
  } else if (!merged.proyecto_o_uso) {
    const proy = extractProyecto(body);
    if (proy) merged.proyecto_o_uso = proy;
  }

  if (claudeParsed.comuna_o_ciudad) {
    merged.comuna_o_ciudad = claudeParsed.comuna_o_ciudad;
  } else if (!merged.comuna_o_ciudad) {
    const ciudad = extractCiudad(body);
    if (ciudad) merged.comuna_o_ciudad = ciudad;
  }

  const nombreClaud = claudeParsed.nombre ?? claudeParsed.empresa;
  if (nombreClaud) merged.nombre_o_empresa = nombreClaud;

  const correoFound = claudeParsed.correo ?? extractEmail(body);
  if (correoFound) merged.correo = correoFound;

  const rutMatch = body.match(RUT_RE);
  if (rutMatch) merged.rut_empresa = rutMatch[0];

  // Calcular leadType — instalacion NO es señal B2B
  let currentLeadType: LeadType = state.leadType;
  if (currentLeadType !== 'B2B') {
    const isB2BSignal =
      B2B_SIGNAL_RE.test(body) ||
      Boolean(rutMatch) ||
      (claudeParsed.empresa && claudeParsed.empresa.length > 0);
    if (isB2BSignal) {
      currentLeadType = 'B2B';
    } else if (currentLeadType === 'Unknown' && body.trim().length > 10) {
      currentLeadType = 'B2C';
    }
  }

  // [FIX-PRIORITY] PASO 2: wantsHuman solo cierra si no hay intencion comercial
  if (wantsHuman && !hasCommercialIntent) {
    const captureStatus = computeCaptureStatus(merged, currentLeadType);
    saveFlowState(phone, {
      ...state,
      stage: 'closed',
      captured: merged,
      wantsHuman: true,
      captureStatus,
      leadType: currentLeadType,
    });
    return {
      reply: MSG_HUMAN,
      shouldCreateDeal: true,
      shouldNotify: false,
      captureStatus,
      captured: merged,
      wantsHuman: true,
      closedFlow: true,
    };
  }

  // PASO 3: AVANCE MULTI-STAGE
  let repreg1 = state.repreguntasStage1;
  let repreg2 = state.repreguntasStage2;
  let repreg3 = state.repreguntasStage3;
  let currentStage: FlowStage = state.stage;

  const baseShouldCreate = signals.qualifiesForDeal || EXPLICIT_QUOTE.test(body);

  while (currentStage !== 'closed' && currentStage !== 'install_capture') {
    if (currentStage === 'stage1') {
      const missing = missingStage1(merged);
      if (missing.length === 0) {
        currentStage = 'stage2';
        continue;
      }
      const missingCritical = missing.filter(
        (m) => m === 'producto' || m === 'cantidad de unidades',
      );
      if (repreg1 >= 1 && missingCritical.length >= 2) {
        const cs = computeCaptureStatus(merged, currentLeadType);
        const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : 'incomplete';
        saveFlowState(phone, {
          ...state,
          stage: 'closed',
          captured: merged,
          captureStatus: finalStatus,
          repreguntasStage1: repreg1,
          repreguntasStage2: repreg2,
          repreguntasStage3: repreg3,
          wantsHuman,
          leadType: currentLeadType,
        });
        console.log('[flowEngine] closePartial desde stage1, status=' + finalStatus);
        return {
          reply: currentLeadType === 'B2B' ? MSG4_B2B : MSG4,
          shouldCreateDeal: true,
          shouldNotify: false,
          captureStatus: finalStatus,
          captured: merged,
          wantsHuman,
          closedFlow: true,
        };
      }
      if (repreg1 >= 1 && missingCritical.length < 2) {
        currentStage = 'stage2';
        continue;
      }
      repreg1 += 1;
      saveFlowState(phone, {
        ...state,
        stage: 'stage1',
        captured: merged,
        repreguntasStage1: repreg1,
        repreguntasStage2: repreg2,
        repreguntasStage3: repreg3,
        wantsHuman,
        leadType: currentLeadType,
      });
      return {
        reply: buildRepregunta1(missing, merged),
        shouldCreateDeal: false,
        shouldNotify: false,
        captureStatus: 'incomplete',
        captured: merged,
        wantsHuman,
        closedFlow: false,
      };
    }

    if (currentStage === 'stage2') {
      const missing = missingStage2(merged);
      if (missing.length === 0) {
        currentStage = 'stage3';
        continue;
      }
      if (repreg2 >= 1) {
        const cs = computeCaptureStatus(merged, currentLeadType);
        const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : 'partial';
        saveFlowState(phone, {
          ...state,
          stage: 'closed',
          captured: merged,
          captureStatus: finalStatus,
          repreguntasStage1: repreg1,
          repreguntasStage2: repreg2,
          repreguntasStage3: repreg3,
          wantsHuman,
          leadType: currentLeadType,
        });
        console.log('[flowEngine] closePartial desde stage2, status=' + finalStatus);
        return {
          reply: currentLeadType === 'B2B' ? MSG4_B2B : MSG4,
          shouldCreateDeal: true,
          shouldNotify: false,
          captureStatus: finalStatus,
          captured: merged,
          wantsHuman,
          closedFlow: true,
        };
      }
      repreg2 += 1;
      saveFlowState(phone, {
        ...state,
        stage: 'stage2',
        captured: merged,
        repreguntasStage1: repreg1,
        repreguntasStage2: repreg2,
        repreguntasStage3: repreg3,
        wantsHuman,
        leadType: currentLeadType,
      });
      const replyS2 = missing.length === 2 ? MSG2 : buildRepregunta2(missing);
      return {
        reply: replyS2,
        shouldCreateDeal: baseShouldCreate,
        shouldNotify: false,
        captureStatus: 'partial',
        captured: merged,
        wantsHuman,
        closedFlow: false,
      };
    }

    if (currentStage === 'stage3') {
      const missing = missingStage3(merged, currentLeadType);
      if (missing.length === 0) {
        const cs = computeCaptureStatus(merged, currentLeadType);
        saveFlowState(phone, {
          ...state,
          stage: 'closed',
          captured: merged,
          captureStatus: cs,
          repreguntasStage1: repreg1,
          repreguntasStage2: repreg2,
          repreguntasStage3: repreg3,
          wantsHuman,
          leadType: currentLeadType,
        });
        return {
          reply: currentLeadType === 'B2B' ? MSG4_B2B : MSG4,
          shouldCreateDeal: true,
          shouldNotify: false,
          captureStatus: cs,
          captured: merged,
          wantsHuman,
          closedFlow: true,
        };
      }
      if (repreg3 >= 1) {
        const cs = computeCaptureStatus(merged, currentLeadType);
        const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : 'partial';
        saveFlowState(phone, {
          ...state,
          stage: 'closed',
          captured: merged,
          captureStatus: finalStatus,
          repreguntasStage1: repreg1,
          repreguntasStage2: repreg2,
          repreguntasStage3: repreg3,
          wantsHuman,
          leadType: currentLeadType,
        });
        console.log('[flowEngine] closePartial desde stage3, status=' + finalStatus);
        return {
          reply: currentLeadType === 'B2B' ? MSG4_B2B : MSG4,
          shouldCreateDeal: true,
          shouldNotify: false,
          captureStatus: finalStatus,
          captured: merged,
          wantsHuman,
          closedFlow: true,
        };
      }
      repreg3 += 1;
      saveFlowState(phone, {
        ...state,
        stage: 'stage3',
        captured: merged,
        repreguntasStage1: repreg1,
        repreguntasStage2: repreg2,
        repreguntasStage3: repreg3,
        wantsHuman,
        leadType: currentLeadType,
      });
      const replyS3 =
        missing.length === 2
          ? currentLeadType === 'B2B'
            ? MSG3_B2B
            : MSG3_B2C
          : buildRepregunta3(missing, currentLeadType);
      return {
        reply: replyS3,
        shouldCreateDeal: true,
        shouldNotify: false,
        captureStatus: 'partial',
        captured: merged,
        wantsHuman,
        closedFlow: false,
      };
    }

    break;
  }

  return {
    reply: currentLeadType === 'B2B' ? MSG4_B2B : MSG4,
    shouldCreateDeal: false,
    shouldNotify: false,
    captureStatus: state.captureStatus,
    captured: merged,
    wantsHuman,
    closedFlow: true,
  };
}

function missingStage1(f: CapturedFields): string[] {
  const m: string[] = [];
  if (!f.producto) m.push('producto');
  if (!f.tipo_de_luz) m.push('tipo de luz preferida');
  if (!f.cantidad) m.push('cantidad de unidades');
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
    if (!f.rut_empresa) m.push('RUT de la empresa');
    if (!f.correo) m.push('correo de contacto');
  } else {
    if (!f.nombre_o_empresa) m.push('nombre');
    if (!f.correo) m.push('correo de contacto');
  }
  return m;
}

function articleFor(proyecto: string): string {
  const p = proyecto.toLowerCase().trim();
  const femeninos =
    /^(terraza|oficina|habitaci[oó]n|cocina|bodega|tienda|sala|fabrica|f[aá]brica|nave industrial|faena|planta|casa)/;
  const femeninoPlural = /^(ba[ñn]os)/;
  if (femeninoPlural.test(p)) return 'los';
  if (femeninos.test(p)) return 'la';
  return 'el';
}

function buildRepregunta1(missing: string[], captured: CapturedFields = {}): string {
  const hints: string[] = [];
  if (captured.proyecto_o_uso) {
    const art = articleFor(captured.proyecto_o_uso);
    hints.push(art + ' ' + captured.proyecto_o_uso);
  }
  if (captured.tipo_de_luz) hints.push('luz ' + captured.tipo_de_luz);
  const intro =
    hints.length > 0
      ? 'Entendido, para ' + hints.join(', ') + ' podemos orientarte bien.'
      : 'Gracias por tu mensaje, podemos ayudarte.';
  if (missing.length === 1) {
    return intro + ' Solo necesito saber ' + missing[0] + ' para continuar.';
  }
  const items = missing.map((x, i) => i + 1 + ') ' + capitalize(x));
  return (
    intro +
    ' Para recomendarte las opciones adecuadas, necesito:
' +
    items.join('
') +
    '

Me los puedes indicar?'
  );
}

function buildRepregunta2(missing: string[]): string {
  if (missing.length === 1)
    return 'Casi listo. Solo me falta saber: ' + missing[0] + '. Me lo puedes indicar?';
  return (
    'Casi listo. Solo me falta saber:
' +
    missing.map((x) => '- ' + x).join('
') +
    '

Me los puedes indicar?'
  );
}

function buildRepregunta3(missing: string[], leadType: LeadType): string {
  if (missing.length === 1) {
    const campo = missing[0];
    if (campo === 'RUT de la empresa')
      return 'Para registrar tu solicitud necesito el RUT de la empresa.';
    if (campo === 'correo de contacto')
      return 'Para registrar tu solicitud necesito tu correo de contacto.';
    if (campo === 'nombre') return 'Para registrar tu solicitud necesito tu nombre.';
    return 'Para registrar tu solicitud necesito tu ' + campo + '.';
  }
  return (
    'Para registrar tu solicitud necesito:
' +
    missing.map((x) => '- ' + x).join('
') +
    '

Me los puedes indicar?'
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// [INSTALL-FLOW] CaptureStatus para flujo de instalacion
function computeInstallCaptureStatus(f: CapturedFields): CaptureStatus {
  const requiredOk =
    Boolean(f.install_nombre) &&
    Boolean(f.install_correo) &&
    Boolean(f.install_comuna) &&
    Boolean(f.install_tipo_proyecto);
  if (requiredOk) return 'complete';
  if (f.install_correo) return 'partial';
  return 'incomplete';
}

function computeCaptureStatus(
  f: CapturedFields,
  leadType: LeadType = 'Unknown',
): CaptureStatus {
  const contactOk =
    leadType === 'B2B'
      ? Boolean(f.rut_empresa && f.correo)
      : Boolean(f.nombre_o_empresa && f.correo);
  const baseFields = [f.producto, f.tipo_de_luz, f.cantidad, f.proyecto_o_uso, f.comuna_o_ciudad];
  const baseFilled = baseFields.filter(Boolean).length;
  if (baseFilled >= 5 && contactOk) return 'complete';
  if (baseFilled >= 2 || f.correo) return 'partial';
  return 'incomplete';
}
