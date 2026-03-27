// api/_lib/whatsapp/flowEngine.ts
// shouldNotify es siempre false aqui — la regla real vive en webhook.ts.
export type FlowStage = 'stage1' | 'stage2' | 'stage3' | 'closed';
export type CaptureStatus = 'complete' | 'partial' | 'incomplete';
export interface CapturedFields {
  producto?: string;
  tipo_de_luz?: string;
  cantidad?: string;
  proyecto_o_uso?: string;
  comuna_o_ciudad?: string;
  nombre_o_empresa?: string;
  correo?: string;
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
}
export interface FlowResult {
  reply: string;
  shouldCreateDeal: boolean;
  shouldNotify: boolean; // siempre false desde flowEngine; webhook.ts calcula la regla real
  captureStatus: CaptureStatus;
  captured: CapturedFields;
  wantsHuman: boolean;
  closedFlow: boolean;
}
export const MSG1 = 'Hola, soy el asistente comercial de eLIGHTS.cl\n\nTe puedo ayudar a orientar tu requerimiento y dejar tu solicitud registrada para cotizacion.\n\nCuentame por favor:\n1) Que producto necesitas?\n2) Que tipo de luz buscas? (calida, neutra o fria)\n3) Cuantas unidades necesitas de cada producto?';
export const MSG2 = 'Perfecto, gracias. Para orientarte mejor, indicame por favor:\n1) Para que espacio o proyecto necesitas los productos?\n2) En que comuna o ciudad seria la instalacion?';
export const MSG3 = 'Perfecto, gracias. Para dejar tu solicitud registrada y derivarla a un ejecutivo de eLIGHTS, comparteme por favor:\n1) Tu nombre y empresa (si aplica)\n2) Tu correo de contacto';
export const MSG4 = 'Gracias. Ya registre tu solicitud en eLIGHTS.cl y la derive para cotizacion.\n\nUn ejecutivo continuara la atencion por correo electronico con los antecedentes de tu requerimiento.';
export const MSG_MEDIA = 'Recibimos tu imagen/archivo, gracias. Por ahora atendemos mejor por texto: cuentanos que producto necesitas, para que proyecto y que cantidad aproximada, y te ayudamos de inmediato.';
const GREET_ONLY = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|hi|hey|buen dia)[.!?\s]*$/i;
const WANTS_HUMAN_RE = /ejecutivo|hablar con|hablar a|llamar|vendedor|humano|asesor|contacten|contactar|quiero hablar|necesito hablar/i;
const EXPLICIT_QUOTE = /cotizar|cotizacion|precio|cu[ao]nto (cuesta|vale|sale)|presupuesto|valor/i;
const LUZ_RE = /calida|neutra|fria|warm|cool|daylight|3000k|4000k|6500k|blanca|amarilla/i;
const CANTIDAD_RE = /\\b(\\d+)\\s*(unidades?|und\\.?|u\\b|lumin|panel|foco|reflector|tira|strip|downlight)?/i;
const EMAIL_RE = /[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/;
function extractEmail(text: string): string | undefined { const m = text.match(EMAIL_RE); return m ? m[0] : undefined; }
function hasLuzInfo(text: string): boolean { return LUZ_RE.test(text); }
function hasCantidadInfo(text: string): boolean { return CANTIDAD_RE.test(text); }
function extractSnippet(text: string, maxLen = 120): string { return text.trim().substring(0, maxLen); }
const flowStates = new Map<string, FlowState>();
export function getFlowState(phone: string): FlowState {
  return flowStates.get(phone) ?? { stage: 'stage1', captured: {}, repreguntasStage1: 0, repreguntasStage2: 0, repreguntasStage3: 0, wantsHuman: false, captureStatus: 'incomplete', firstMessageAt: Date.now() };
}
export function saveFlowState(phone: string, state: FlowState): void { flowStates.set(phone, state); }
export function clearFlowState(phone: string): void { flowStates.delete(phone); }
export function processFlowStep(
  phone: string,
  body: string,
  claudeParsed: { producto?: string; tipo_de_luz?: string; cantidad?: string; proyecto_o_uso?: string; comuna_o_ciudad?: string; nombre?: string; empresa?: string; correo?: string; wantsHuman?: boolean; qualifiesForDeal?: boolean; },
  signals: { wantsHuman: boolean; qualifiesForDeal: boolean },
): FlowResult {
  const state = getFlowState(phone);
  if (state.stage === 'closed') {
    return { reply: MSG4, shouldCreateDeal: false, shouldNotify: false, captureStatus: state.captureStatus, captured: state.captured, wantsHuman: state.wantsHuman, closedFlow: true };
  }
  const wantsHuman = state.wantsHuman || signals.wantsHuman || Boolean(claudeParsed.wantsHuman) || WANTS_HUMAN_RE.test(body);
  if (state.stage === 'stage1' && GREET_ONLY.test(body.trim())) {
    saveFlowState(phone, { ...state, wantsHuman });
    return { reply: MSG1, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: state.captured, wantsHuman, closedFlow: false };
  }
  const merged: CapturedFields = { ...state.captured };
  if (!merged.producto && claudeParsed.producto) merged.producto = claudeParsed.producto;
  if (!merged.tipo_de_luz) { if (claudeParsed.tipo_de_luz) merged.tipo_de_luz = claudeParsed.tipo_de_luz; else if (hasLuzInfo(body)) merged.tipo_de_luz = extractSnippet(body, 40); }
  if (!merged.cantidad) { if (claudeParsed.cantidad) merged.cantidad = claudeParsed.cantidad; else if (hasCantidadInfo(body)) { const m = body.match(CANTIDAD_RE); merged.cantidad = m ? m[0].trim() : extractSnippet(body, 30); } }
  if (!merged.proyecto_o_uso && claudeParsed.proyecto_o_uso) merged.proyecto_o_uso = claudeParsed.proyecto_o_uso;
  if (!merged.comuna_o_ciudad && claudeParsed.comuna_o_ciudad) merged.comuna_o_ciudad = claudeParsed.comuna_o_ciudad;
  if (!merged.nombre_o_empresa) { const n = claudeParsed.nombre ?? claudeParsed.empresa; if (n) merged.nombre_o_empresa = n; }
  if (!merged.correo) { const c = claudeParsed.correo ?? extractEmail(body); if (c) merged.correo = c; }
  if (wantsHuman) {
    const captureStatus = computeCaptureStatus(merged);
    saveFlowState(phone, { ...state, stage: 'closed', captured: merged, wantsHuman: true, captureStatus });
    return { reply: MSG4, shouldCreateDeal: true, shouldNotify: false, captureStatus, captured: merged, wantsHuman: true, closedFlow: true };
  }
  if (state.stage === 'stage1') {
    const missing1 = missingStage1(merged);
    if (missing1.length === 0) {
      saveFlowState(phone, { ...state, stage: 'stage2', captured: merged, wantsHuman });
      return { reply: MSG2, shouldCreateDeal: signals.qualifiesForDeal || EXPLICIT_QUOTE.test(body), shouldNotify: false, captureStatus: 'partial', captured: merged, wantsHuman: false, closedFlow: false };
    }
    if (state.repreguntasStage1 >= 1) return closePartial(phone, state, merged, 'stage1');
    saveFlowState(phone, { ...state, captured: merged, repreguntasStage1: state.repreguntasStage1 + 1, wantsHuman });
    return { reply: buildRepregunta1(missing1), shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: merged, wantsHuman: false, closedFlow: false };
  }
  if (state.stage === 'stage2') {
    const missing2 = missingStage2(merged);
    if (missing2.length === 0) {
      saveFlowState(phone, { ...state, stage: 'stage3', captured: merged, wantsHuman });
      return { reply: MSG3, shouldCreateDeal: true, shouldNotify: false, captureStatus: 'partial', captured: merged, wantsHuman: false, closedFlow: false };
    }
    if (state.repreguntasStage2 >= 1) return closePartial(phone, state, merged, 'stage2');
    saveFlowState(phone, { ...state, captured: merged, repreguntasStage2: state.repreguntasStage2 + 1, wantsHuman });
    return { reply: buildRepregunta2(missing2), shouldCreateDeal: false, shouldNotify: false, captureStatus: 'partial', captured: merged, wantsHuman: false, closedFlow: false };
  }
  if (state.stage === 'stage3') {
    const missing3 = missingStage3(merged);
    if (missing3.length === 0) {
      saveFlowState(phone, { ...state, stage: 'closed', captured: merged, wantsHuman, captureStatus: 'complete' });
      return { reply: MSG4, shouldCreateDeal: true, shouldNotify: false, captureStatus: 'complete', captured: merged, wantsHuman: false, closedFlow: true };
    }
    if (state.repreguntasStage3 >= 1) return closePartial(phone, state, merged, 'stage3');
    saveFlowState(phone, { ...state, captured: merged, repreguntasStage3: state.repreguntasStage3 + 1, wantsHuman });
    return { reply: buildRepregunta3(missing3), shouldCreateDeal: true, shouldNotify: false, captureStatus: 'partial', captured: merged, wantsHuman: false, closedFlow: false };
  }
  return { reply: MSG1, shouldCreateDeal: false, shouldNotify: false, captureStatus: 'incomplete', captured: merged, wantsHuman: false, closedFlow: false };
}
function missingStage1(f: CapturedFields): string[] {
  const m: string[] = [];
  if (!f.producto) m.push('producto');
  if (!f.tipo_de_luz) m.push('tipo de luz (calida, neutra o fria)');
  if (!f.cantidad) m.push('cantidad de unidades');
  return m;
}
function missingStage2(f: CapturedFields): string[] {
  const m: string[] = [];
  if (!f.proyecto_o_uso) m.push('espacio o proyecto de uso');
  if (!f.comuna_o_ciudad) m.push('comuna o ciudad de instalacion');
  return m;
}
function missingStage3(f: CapturedFields): string[] {
  const m: string[] = [];
  if (!f.nombre_o_empresa) m.push('nombre o empresa');
  if (!f.correo) m.push('correo de contacto');
  return m;
}
function buildRepregunta1(missing: string[]): string { return 'Para continuar, necesito completar algunos datos:\n' + missing.map(x => '- ' + x).join('\n') + '\n\nMe los puedes indicar?'; }
function buildRepregunta2(missing: string[]): string { return 'Solo me falta saber:\n' + missing.map(x => '- ' + x).join('\n') + '\n\nMe los puedes indicar?'; }
function buildRepregunta3(missing: string[]): string { return 'Para registrar tu solicitud necesito:\n' + missing.map(x => '- ' + x).join('\n') + '\n\nMe los puedes indicar?'; }
function computeCaptureStatus(f: CapturedFields): CaptureStatus {
  const all = [f.producto, f.tipo_de_luz, f.cantidad, f.proyecto_o_uso, f.comuna_o_ciudad, f.nombre_o_empresa, f.correo];
  const filled = all.filter(Boolean).length;
  if (filled >= 6) return 'complete';
  if (filled >= 2) return 'partial';
  return 'incomplete';
}
function closePartial(phone: string, state: FlowState, merged: CapturedFields, fromStage: string): FlowResult {
  const cs = computeCaptureStatus(merged);
  const finalStatus: CaptureStatus = cs === 'complete' ? 'complete' : fromStage === 'stage3' ? 'partial' : 'incomplete';
  saveFlowState(phone, { ...state, stage: 'closed', captured: merged, captureStatus: finalStatus });
  console.log('[flowEngine] closePartial desde ' + fromStage + ', status=' + finalStatus);
  return { reply: MSG4, shouldCreateDeal: true, shouldNotify: false, captureStatus: finalStatus, captured: merged, wantsHuman: state.wantsHuman, closedFlow: true };
}
