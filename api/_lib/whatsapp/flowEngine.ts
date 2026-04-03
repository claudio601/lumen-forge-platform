// api/_lib/whatsapp/flowEngine.ts
// shouldNotify es siempre false aqui — la regla real vive en webhook.ts.
export type FlowStage = 'stage1' | 'stage2' | 'stage3' | 'closed';
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
}

export interface FlowState {
    stage: FlowStage;
    captured: CapturedFields;
    repreguntasStage1: number;
    repreguntasStage2: number;
    repreguntasStage3: number;
    wantsHuman: boolean;
    captureStatus: CaptureStatus;
    firstMessageAt: number;
    leadType: LeadType;
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

export const MSG1 = 'Hola! Soy el asistente de eLIGHTS.cl, especialistas en iluminacion LED.\n\nCuentame que necesitas y te oriento de inmediato:\n1) Que producto buscas? (ampolletas, focos, paneles, etc.)\n2) Que tipo de luz prefieres? (calida, neutra o fria)\n3) Cuantas unidades necesitas aproximadamente?';
export const MSG2 = 'Excelente. Para recomendarte las mejores opciones, necesito saber un poco mas:\n1) Para que espacio o proyecto es la instalacion?\n2) En que comuna o ciudad seria?';
export const MSG3 = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre y empresa (si aplica)\n2) Tu correo de contacto';
export const MSG3_B2B = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) El RUT de la empresa\n2) Tu correo de contacto';
export const MSG3_B2C = 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre\n2) Tu correo de contacto';
export const MSG4 = 'Gracias. Ya registre tu solicitud en eLIGHTS.cl y la derive para cotizacion.\n\nUn ejecutivo continuara la atencion por correo electronico con los antecedentes de tu requerimiento.';
export const MSG4_B2B = 'Gracias. Ya registre tu requerimiento comercial en eLIGHTS.cl y lo derive a nuestro equipo de ventas.\n\nUn ejecutivo te contactara por correo con la cotizacion y antecedentes de tu proyecto.';
export const MSG_HUMAN = 'Entendido! Voy a derivar tu consulta a un ejecutivo de eLIGHTS para que te atienda directamente.\n\nTe contactaran a la brevedad por este mismo canal o por correo electronico.';
export const MSG_MEDIA = 'Recibimos tu imagen/archivo, gracias. Por ahora atendemos mejor por texto: cuentanos que producto necesitas, para que proyecto y que cantidad aproximada, y te ayudamos de inmediato.';

const GREET_ONLY = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|hi|hey|buen dia)[.!?\s]*$/i;
const NEW_REQ_INTENT_RE = /\b(necesito|busco|quiero|requiero|cotizar|cotizaci[oó]n|comprar|conseguir|tengo un proyecto)\b/i;
// [FIX-CONTINUATION] Frases de continuidad — NO son nuevo requerimiento aunque contengan "quiero", "necesito", etc.
const CONTINUATION_RE = /\b(seguir|continuar|retomar|la cotizaci[oó]n|lo anterior|la misma|el mismo|anterior|misma solicitud)\b/i;
const NEW_REQ_SOLO_LUZ_RE = /^(c[aá]lida|calida|neutra|fr[ií]a|fria|warm|cool|daylight|3000k|4000k|6500k|blanca|amarilla)[.!?\s]*$/i;
const NEW_REQ_SOLO_PROYECTO_RE = /^(quincho|terraza|patio|living|comedor|dormitorio|habitaci[o\u00f3]n|cocina|ba[n\u00f1]o|ba[n\u00f1]os|bodega|oficina|casa|local comercial|local|galp[o\u00f3]n|galpon|faena|tienda|exterior|interior|planta|fabrica|nave industrial|departamento|edificio)[.!?\s]*$/i;
const NEW_REQ_SOLO_RUT_RE = /^\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK][.!?\s]*$/;
const NEW_REQ_SOLO_EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}[.!?\s]*$/;
// [FIX-2] Intención de precio sin producto especificado
const PRICE_INTENT_RE = /\b(precio|precios|cu[aá]nto (cuesta|vale|sale|cuestan|valen|salen)|valor|valores|cuanto sale|cuanto cuesta|cuanto vale)\b/i;
// [FIX-WANTSHUMAN] Intencion comercial — si está presente, NO activar wantsHuman
const COMMERCIAL_INTENT_RE = /\b(cotizar|cotizaci[oó]n|comprar|necesito|busco)\b/i;

function looksLikeNewRequest(body: string): boolean {
    const b = body.trim();
    if (NEW_REQ_SOLO_LUZ_RE.test(b)) return false;
    if (NEW_REQ_SOLO_PROYECTO_RE.test(b)) return false;
    if (NEW_REQ_SOLO_RUT_RE.test(b)) return false;
    if (NEW_REQ_SOLO_EMAIL_RE.test(b)) return false;
    if (/^[A-ZÀ-Ü][a-zà-ü]+ [A-ZÀ-Ü][a-zà-ü]+[.!?\s]*$/.test(b)) return false;
    // [FIX-CONTINUATION] Excluir frases de continuidad antes de evaluar intención
  if (CONTINUATION_RE.test(b)) return false;
    // [FIX-NEWREQ] Detectar intención sola, sin requerir producto+número
  if (NEW_REQ_INTENT_RE.test(b)) return true;
    if (/cotizar|cotizaci[oó]n|presupuesto/i.test(b) && b.length > 15) return true;
    if (PRODUCTO_RE.test(b) && /\b\d{1,4}\b/.test(b)) return true;
    return false;
}

const WANTS_HUMAN_RE = /ejecutivo|hablar con|hablar a|llamar|vendedor|humano|asesor|contacten|contactar|quiero hablar|necesito hablar/i;
const EXPLICIT_QUOTE = /cotizar|cotizacion|precio|cu[ao]nto (cuesta|vale|sale)|presupuesto|valor/i;
const LUZ_RE = /c[aá]lid[ao]s?|neutr[ao]s?|fr[ií][ao]s?|warm|cool|daylight|3000\s*k|4000\s*k|5000\s*k|6500\s*k|blancas?\s+c[aá]lid[ao]s?|blancas?\s+fr[ií][ao]s?|luz\s+c[aá]lid[ao]?|luz\s+fr[ií][ao]?|blanco\s+fr[ií]o|blanco\s+c[aá]lido/i;
const CANTIDAD_RE = /\b(\d+)\s*(unidades?|und\.?|u\b|lumin|panel|foco|reflector|tira|strip|downlight)?/i;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const CIUDAD_RE = /\b(santiago|maipu|pudahuel|quilicura|la florida|penalolen|nunoa|providencia|las condes|vitacura|lo barnechea|san miguel|la cisterna|el bosque|san bernardo|puente alto|valparaiso|vina del mar|concepcion|temuco|rancagua|talca|iquique|antofagasta|arica|copiapo|la serena|coihaique|punta arenas)\b/i;
const PROYECTO_RE = /\b(quincho|terraza|patio|living|comedor|dormitorio|habitaci[o\u00f3]n|cocina|ba[n\u00f1]o|ba[n\u00f1]os|jardin|bodega|oficina|casa|local\s+comercial|local|galp[o\u00f3]n|galpon|faena|tienda|exterior|interior|planta|f[a\u00e1]brica|fabrica|nave\s+industrial|departamento|edificio|colegio|hospital|estacionamiento|pasillo|sala)\b/i;
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/;
const B2B_SIGNAL_RE = /empresa|factura|obra|proveedor|licitaci[oó]n|constructora|instalaci[oó]n|bodega|oficina|local comercial|proyecto comercial|s\.a\.|spa|ltda/i;
const PRODUCTO_RE = /\b(campana(?:s)?\s+(?:led|industrial(?:es)?)|panel(?:es)?\s+led|plafon(?:es)?\s+led|ampolleta(?:s)?\s+led|ampolleta(?:s)?|foco(?:s)?\s+led|foco(?:s)?|dicroico(?:s)?|reflector(?:es)?\s+led|reflector(?:es)?|proyector(?:es)?\s+led|proyector(?:es)?|tira(?:s)?\s+led|cinta(?:s)?\s+led|downlight(?:s)?|empotrado(?:s)?\s+led|tubo(?:s)?\s+led|tubo(?:s)?\s+fluorescente(?:s)?|luminaria(?:s)?\s+led|luminaria(?:s)?)\b/i;

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
    if (/fr[ií][ao]/.test(r) || /cool/i.test(r) || /daylight/i.test(r) || /6500/i.test(r)) return 'fria';
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

const flowStates = new Map<string, FlowState>();

export function getFlowState(phone: string): FlowState {
    return (
          flowStates.get(phone) ?? {
                  stage: 'stage1',
                  captured: {},
                  repreguntasStage1: 0,
                  repreguntasStage2: 0,
                  repreguntasStage3: 0,
                  wantsHuman: false,
                  captureStatus: 'incomplete',
                  firstMessageAt: Date.now(),
                  leadType: 'Unknown',
          }
        );
}

export function saveFlowState(phone: string, state: FlowState): void {
    flowStates.set(phone, state);
}

export function clearFlowState(phone: string): void {
    flowStates.delete(phone);
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
        if (!looksLikeNewRequest(body)) {
                return {
                          reply: state.wantsHuman ? MSG_HUMAN : (state.leadType === 'B2B' ? MSG4_B2B : MSG4),
                          shouldCreateDeal: false,
                          shouldNotify: false,
                          captureStatus: state.captureStatus,
                          captured: state.captured,
                          wantsHuman: state.wantsHuman,
                          closedFlow: true,
                };
        }
        // Nuevo requerimiento detectado: reset y reprocesar desde stage1
      console.log('[flowEngine] nuevo requerimiento, reset para: ' + body.substring(0, 60));
        clearFlowState(phone);
        return processFlowStep(phone, body, claudeParsed, signals);
  }

  // [FIX-WANTSHUMAN] NO activar wantsHuman si el mensaje contiene intencion comercial
  const hasCommercialIntent = COMMERCIAL_INTENT_RE.test(body);
    const wantsHuman =
          state.wantsHuman ||
          (!hasCommercialIntent && (signals.wantsHuman || Boolean(claudeParsed.wantsHuman))) ||
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

  // [FIX-2] Intención de precio sin producto: preguntar qué producto necesita cotizar
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
        };
  }

  // PASO 1: MERGE — latest non-empty wins; Claude tiene precedencia, regex como fallback
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
        merged.tipo_de_luz = luzMatch ? normalizeLuz(luzMatch[0]) : extractSnippet(body, 40);
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

  // Detectar RUT en mensaje
  const rutMatch = body.match(RUT_RE);
    if (rutMatch) merged.rut_empresa = rutMatch[0];

  // Calcular leadType acumulativo (B2B nunca revierte)
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

  // [FIX-PRIORITY] PASO 2: Evaluar intencion comercial ANTES de wantsHuman
  // wantsHuman solo cierra el flujo si no hay intencion comercial activa
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

  while (currentStage !== 'closed') {
        if (currentStage === 'stage1') {
                const missing = missingStage1(merged);
                if (missing.length === 0) {
                          currentStage = 'stage2';
                          continue;
                }
                // [FIX-1] Evitar cierre prematuro: solo cerrar si faltan ambos (producto Y cantidad)
          // Si falta solo tipo_de_luz, avanzar igual a stage2
          const missingCritical = missing.filter(m => m === 'producto' || m === 'cantidad de unidades');
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
                          // Tiene producto O cantidad — avanzar a stage2 sin cerrar
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

// Retorna el articulo definido correcto segun el espacio/proyecto capturado
function articleFor(proyecto: string): string {
    const p = proyecto.toLowerCase().trim();
    const femeninos = /^(terraza|oficina|habitaci[o\u00f3]n|cocina|bodega|tienda|sala|fabrica|f[a\u00e1]brica|nave industrial|faena|planta)/;
    const femeninoPlural = /^(ba[n\u00f1]os)/;
    if (femeninoPlural.test(p)) return 'los';
    if (femeninos.test(p)) return 'la';
    return 'el';
}

function buildRepregunta1(missing: string[], captured: CapturedFields = {}): string {
    // [FIX-4] Nunca mostrar campos vacios o "no especificado" al usuario
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
          ' Para recomendarte las opciones adecuadas, necesito:\n' +
          items.join('\n') +
          '\n\nMe los puedes indicar?'
        );
}

function buildRepregunta2(missing: string[]): string {
    if (missing.length === 1)
          return 'Casi listo. Solo me falta saber: ' + missing[0] + '. Me lo puedes indicar?';
    return (
          'Casi listo. Solo me falta saber:\n' +
          missing.map((x) => '- ' + x).join('\n') +
          '\n\nMe los puedes indicar?'
        );
}

function buildRepregunta3(missing: string[], leadType: LeadType): string {
    if (missing.length === 1) {
          const campo = missing[0];
          if (campo === 'RUT de la empresa') return 'Para registrar tu solicitud necesito el RUT de la empresa.';
          if (campo === 'correo de contacto') return 'Para registrar tu solicitud necesito tu correo de contacto.';
          if (campo === 'nombre') return 'Para registrar tu solicitud necesito tu nombre.';
          return 'Para registrar tu solicitud necesito tu ' + campo + '.';
    }
    return (
          'Para registrar tu solicitud necesito:\n' +
          missing.map((x) => '- ' + x).join('\n') +
          '\n\nMe los puedes indicar?'
        );
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function computeCaptureStatus(f: CapturedFields, leadType: LeadType = 'Unknown'): CaptureStatus {
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
