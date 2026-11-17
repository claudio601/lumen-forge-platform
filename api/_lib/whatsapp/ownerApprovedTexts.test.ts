// api/_lib/whatsapp/ownerApprovedTexts.test.ts
// Guarda de los textos del bot de WhatsApp (FASE 3A, 16-11-2026): la lista congelada de TODOS los textos fijos que el
// bot puede mandar al cliente, cada uno con su fuente de aprobación. El bot no redacta con IA (claudeAgent.ts solo
// extrae datos): lo que recibe el cliente sale de estas constantes y de estos trozos.
//
// Qué revisa:
// 1. Cada constante de texto que exporta flowEngine.ts (MSG_*, OWN_EMAIL_NOTE), más FALLBACK_REPLY (claudeAgent.ts) y
//    PRIVACY_NOTICE (privacyNotice.ts), está en CONSTANTS con su texto exacto. Una constante nueva o un texto cambiado
//    hace fallar la prueba.
// 2. Cada literal que puede ser texto de los archivos por donde sale la respuesta (FILES: flowEngine.ts, webhook.ts,
//    privacyNotice.ts y twilio.ts) está en FRAGMENTS (al cliente, con su fuente) o en INTERNAL (logs, nota de Pipedrive,
//    claves, con el motivo). Cuenta como texto (isText) todo literal con letras que no sea una expresión regular y que
//    tenga dos palabras, o una sola que no sea una clave interna en minúscula: con mayúscula ('Gracias, ', 'Hola '),
//    ¿ o ¡, tilde, espacio o signo ('¡Listo!', 'cálida', 'luz '). También la etiqueta que se agrega a una lista con
//    .push('…') (las repreguntas: 'producto', 'correo'), aunque sea una clave en minúscula. No se revisan los literales
//    de console.*, RegExp ni Error, los de import/export ni los tipos. Una entrada que ya no está en el código también
//    falla.
// 3. Los demás módulos del bot (MODULES, todos los .ts de esta carpeta) no arman respuestas: (a) cada constante de
//    texto que exportan está en CONSTANTS, OTHER_CONSTANTS o INTERNAL_EXPORTS; (b) lo que los archivos de FILES
//    importan de ellos está revisado en IMPORTS (nombre por nombre, con el motivo). Un texto nuevo en quantity.ts que se
//    importa para responder falla por los dos lados.
// 4. En el código, los textos al cliente van en ASCII, con escapes \u (como el resto de flowEngine.ts).
// Los literales se leen con api/_tests/sourceLiterals.ts (sin el compilador de TypeScript, que la suite no carga).
//
// Cómo agregar o cambiar un texto:
// - Primero el OK del dueño al texto exacto. Si todavía no lo da, la fuente es 'pendiente OK del dueño (<fecha>)' y se
//   le muestra antes de fusionar.
// - En el .ts, el texto con escapes \u (á \u00e1, é \u00e9, í \u00ed, ó \u00f3, ú \u00fa, ñ \u00f1, ¿ \u00bf, ¡ \u00a1).
// - Aquí, el texto tal cual (UTF-8) en CONSTANTS (constante exportada) o en FRAGMENTS (trozo dentro de una función),
//   con su fuente de APPROVALS; si la fuente es nueva, se agrega a APPROVALS con la fecha y el número de la PR.
// - Un literal que no llega al cliente va en INTERNAL, con el motivo.
// - Una función nueva de otro módulo que se importa en flowEngine.ts o webhook.ts va en IMPORTS, con el motivo (si
//   arma texto al cliente, su archivo pasa a FILES y sus textos a FRAGMENTS).
// - Límite: una palabra sola en minúscula, sin tilde ni signo ('gracias'), se ve igual que una clave interna y no se
//   detecta, salvo como etiqueta en .push('…'). Una respuesta así necesita su prueba exacta (flowFase3a.test.ts).
//   Tampoco se ve un texto que una función ya revisada en IMPORTS empiece a devolver: esa función pasa a FILES.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import * as claudeAgent from './claudeAgent';
import * as comunas from './comunas';
import * as comunasGenerated from './comunas.generated';
import * as conversation from './conversation';
import * as leadCapture from './leadCapture';
import * as notify from './notify';
import * as pipedriveLead from './pipedriveLead';
import * as privacyNotice from './privacyNotice';
import * as quantity from './quantity';
import * as rutCapture from './rutCapture';
import * as stateStore from './stateStore';
import * as summary from './summary';
import * as transcript from './transcript';
import * as twilio from './twilio';
import { sourceLiterals } from '../../_tests/sourceLiterals';

const { FALLBACK_REPLY } = claudeAgent;
const { PRIVACY_NOTICE, PRIVACY_POLICY_URL } = privacyNotice;

/** Las fuentes de aprobación aceptadas. */
const APPROVALS = [
  'dueño 11-11 tabla',
  'dueño 11-11 tabla, sin la pregunta final (#176)',
  'heredado de main antes del 11-11',
  'heredado de main antes del 11-11 · ortografía con el OK del 11-11',
  'pendiente OK del dueño (16-11)',
  'pendiente OK del dueño (16-11): #185, reescritura del MSG_MEDIA anterior, sin OK literal anotado',
  'dueño 13-11, decisión 1A (#185)',
  'texto A, dueño 16-10 (#88)',
  'texto B, dueño 16-10 (#88)',
  'dueño 16-10, solo correo (#85)',
  'dueño 26-10 (#121)',
  'dueño 31-10 (#140)',
  'dueño 12-11 (#176)',
  'dueño 16-11',
  '#173 (12-11), plan del 11-11 visto por el dueño, sin OK literal anotado',
  'plan del bot, PR #139 (31-10), fusionada con el OK del dueño',
  'legales, dueño 16-10 (#84)',
] as const;
type Approval = (typeof APPROVALS)[number];
interface Approved { text: string; source: Approval }

const ORTO: Approval = 'heredado de main antes del 11-11 · ortografía con el OK del 11-11';
const HEREDADO: Approval = 'heredado de main antes del 11-11';
const PENDIENTE: Approval = 'pendiente OK del dueño (16-11)';
const MEDIA_185: Approval = 'pendiente OK del dueño (16-11): #185, reescritura del MSG_MEDIA anterior, sin OK literal anotado';
const PR_173: Approval = '#173 (12-11), plan del 11-11 visto por el dueño, sin OK literal anotado';
// Fase 3B: el resumen antes del cierre (decisiones del dueño del 16-11-2026, codex-claude/2026-11-16-bot-fase3/).
const RESUMEN: Approval = 'dueño 16-11';

const MEDIA_ASK = 'Cuéntanos por escrito qué producto necesitas, para qué proyecto y qué cantidad aproximada.';
const MEDIA_NOTICE = 'Por WhatsApp no podemos recibir imágenes ni archivos para tu solicitud. Por favor, envíalos por correo a ventas@elights.cl.';
const VOICE_NOTICE = 'Por WhatsApp no podemos escuchar audios ni ver videos.';

/** Las constantes exportadas de flowEngine.ts, con su texto exacto. */
const CONSTANTS: Record<string, Approved> = {
  MSG1: {
    text: '¡Hola! Soy el asistente de eLIGHTS.cl 👋\n\nEstoy ayudando a gestionar las solicitudes de iluminación para responder más rápido y dejar todo listo para cotización.\n\nCuéntame:\n1) Qué producto buscas\n2) Qué tipo de luz prefieres\n3) Cuántas unidades necesitas aprox.',
    source: ORTO,
  },
  MSG2: {
    text: 'Excelente. Para recomendarte las mejores opciones, necesito saber un poco más:\n1) ¿Para qué espacio o proyecto es la instalación?\n2) ¿En qué comuna o ciudad sería?',
    source: ORTO,
  },
  MSG3: { text: 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre y empresa (si aplica)\n2) Tu correo de contacto', source: HEREDADO },
  MSG3_B2B: { text: 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) El RUT de la empresa\n2) Tu correo de contacto', source: HEREDADO },
  MSG3_B2C: { text: 'Perfecto. Para registrar tu solicitud y derivarla a un ejecutivo de eLIGHTS, necesito:\n1) Tu nombre\n2) Tu correo de contacto', source: HEREDADO },
  MSG4: { text: 'Tu solicitud quedó registrada. Claudio Quero te responderá por correo el mismo día hábil.', source: 'dueño 11-11 tabla' },
  // Decisión 2 del 16-11: la respuesta a un «no» solo después del resumen.
  MSG_SUMMARY_FIX: { text: '¿Qué dato corrijo? Escríbeme el correcto.', source: RESUMEN },
  MSG4_INSTALL_NO_EMAIL: {
    text: 'Gracias. Para cotizar tu instalación necesitamos tu correo de contacto: escríbelo por aquí o envíanos tu solicitud a ventas@elights.cl.',
    source: 'dueño 16-10, solo correo (#85)',
  },
  MSG_HUMAN: {
    text: 'Perfecto, ya derivé tu solicitud a nuestro equipo de ventas. Te va a atender Claudio Quero directamente por correo.',
    source: 'dueño 16-10, solo correo (#85)',
  },
  MSG_MEDIA_NOTICE: { text: MEDIA_NOTICE, source: 'dueño 13-11, decisión 1A (#185)' },
  MSG_MEDIA_ASK: { text: MEDIA_ASK, source: MEDIA_185 },
  MSG_MEDIA: { text: MEDIA_NOTICE + '\n\n' + MEDIA_ASK, source: MEDIA_185 },
  MSG_VOICE_NOTICE: { text: VOICE_NOTICE, source: PENDIENTE },
  MSG_VOICE: { text: VOICE_NOTICE + '\n\n' + MEDIA_ASK, source: PENDIENTE },
  MSG_MEDIA_PENDING: { text: 'Cuéntanos tu respuesta por escrito y seguimos con tu solicitud.', source: PENDIENTE },
  MSG_VOICE_WRITE: { text: 'Cuéntanos por escrito lo que necesitas.', source: PENDIENTE },
  MSG_EXECUTIVE: {
    text: 'Perfecto 👍 Si prefieres hablar directamente con un ejecutivo, puedes escribirle por correo:\n📩 claudio@elights.cl\n📩 constanza@elights.cl\n\nDe todas formas, si quieres, también puedo ayudarte a dejar tu solicitud lista para cotización por acá.',
    source: ORTO,
  },
  MSG_NEED_EMAIL: {
    text: 'Para que Claudio Quero te atienda por correo, necesito tu correo. ¿Me lo escribes por aquí? Si prefieres, envía tu solicitud a ventas@elights.cl.',
    source: 'texto A, dueño 16-10 (#88)',
  },
  MSG_OWN_EMAIL: {
    text: 'Ese correo es de eLIGHTS. Para registrar tu solicitud necesito tu propio correo, de tu empresa o personal. ¿Me lo escribes por aquí? Si prefieres, envía tu solicitud a ventas@elights.cl.',
    source: PR_173,
  },
  MSG_EMAIL_SHORT: { text: 'Para registrar tu solicitud necesito tu correo de contacto.', source: HEREDADO },
  OWN_EMAIL_NOTE: { text: 'Ese correo es de eLIGHTS: necesito tu propio correo, de tu empresa o personal.', source: PR_173 },
  MSG_WAIT: { text: 'No tienes que hacer nada más. Te enviaremos la cotización por correo el mismo día hábil.', source: PR_173 },
  MSG_WAIT_DELIVERY: { text: 'El plazo y el costo del despacho van en la cotización, que te enviaremos por correo el mismo día hábil.', source: PENDIENTE },
  MSG_Q_PRICE: {
    text: 'Claudio Quero revisará el precio y la disponibilidad y te responderá por correo el mismo día hábil. ¿Cuál es tu correo?',
    source: 'dueño 11-11 tabla',
  },
  MSG_Q_TECH: { text: 'Claudio Quero revisará tu consulta y te responderá por correo el mismo día hábil. ¿Cuál es tu correo?', source: 'dueño 11-11 tabla' },
  MSG_LOCATION: { text: 'Somos una tienda online con bodega en Quinta Normal y despachamos a todo Chile.', source: 'dueño 11-11 tabla' },
  MSG_Q_PRICE_HAS_EMAIL: {
    text: 'Claudio Quero revisará el precio y la disponibilidad y te responderá por correo el mismo día hábil.',
    source: 'dueño 11-11 tabla, sin la pregunta final (#176)',
  },
  MSG_Q_TECH_HAS_EMAIL: { text: 'Claudio Quero revisará tu consulta y te responderá por correo el mismo día hábil.', source: 'dueño 11-11 tabla, sin la pregunta final (#176)' },
  MSG_ALREADY_WROTE: { text: 'Perfecto. Déjame tu correo y lo uno a tu solicitud para que no se pierda.', source: 'dueño 12-11 (#176)' },
  MSG_REGISTERED_SHORT: { text: 'Tu solicitud ya quedó registrada; te escribimos por correo.', source: PR_173 },
  MSG_DEAL_FAILED: {
    text: 'No pude registrar tu solicitud por un problema técnico. Por favor, envíala a ventas@elights.cl y Claudio Quero te responde por correo.',
    source: 'texto B, dueño 16-10 (#88)',
  },
  MSG_DEAL_PENDING: {
    text: 'Estoy terminando de registrar tu solicitud; te confirmo por este chat en un momento. Si no te llega la confirmación, envíala a ventas@elights.cl y Claudio Quero te responde por correo.',
    source: 'dueño 31-10 (#140)',
  },
  MSG_RUT_INVALID: {
    text: 'El RUT que me enviaste no calza con su dígito verificador. ¿Me lo escribes de nuevo, con guion y dígito verificador? Por ejemplo: 12.345.678-5.',
    source: 'dueño 26-10 (#121)',
  },
  MSG_NEED_EMAIL_AND_CONTEXT: {
    text: 'Con gusto te ayudo. Para registrar tu solicitud necesito dos cosas: ¿qué producto o proyecto necesitas iluminar, y cuál es tu correo de contacto?',
    source: ORTO,
  },
};

/** Constantes de otros archivos (no están en el escaneo de flowEngine.ts). */
const OTHER_CONSTANTS: Record<string, Approved & { value: string }> = {
  // Hoy no llega al cliente: askClaude lo devuelve en reply y webhook.ts usa solo parsed y summary.
  FALLBACK_REPLY: {
    value: FALLBACK_REPLY,
    text: '¡Hola! Gracias por escribirnos. Cuéntanos qué necesitas y tu correo de contacto: la respuesta te llega por correo.',
    source: ORTO,
  },
  PRIVACY_NOTICE: {
    value: PRIVACY_NOTICE,
    text: 'Privacidad: eLIGHTS.CL SpA usa tus datos para responder tu consulta y mejorar este asistente automático con IA. Tu solicitud puede quedar registrada en nuestro sistema de seguimiento.\nPolítica: ' + PRIVACY_POLICY_URL + '\nDerechos: ventas@elights.cl, asunto «Datos personales»',
    source: 'legales, dueño 16-10 (#84)',
  },
};

/** Constantes de texto exportadas por flowEngine.ts que no llegan al cliente (nombre → motivo). Hoy, ninguna. */
const INTERNAL_CONSTANTS: Record<string, string> = {};

/** Los archivos que se escanean, relativos a este. */
const FILES = {
  flowEngine: './flowEngine.ts',
  webhook: '../../whatsapp/webhook.ts',
  privacyNotice: './privacyNotice.ts',
  twilio: './twilio.ts',
} as const;
type FileKey = keyof typeof FILES;

/** Trozos fijos al cliente dentro de funciones (repreguntas, instalación, aclaraciones), por archivo. */
const FRAGMENTS: Record<FileKey, Approved[]> = {
  flowEngine: [
    // menuClarifyMsg: «¿Me confirmas a qué te refieres con «1»? …»
    { text: '¿Me confirmas a qué te refieres con «', source: 'plan del bot, PR #139 (31-10), fusionada con el OK del dueño' },
    { text: '»? Cuéntame qué producto buscas, cuántas unidades y el color de luz.', source: 'plan del bot, PR #139 (31-10), fusionada con el OK del dueño' },
    // Instalación (buildInstallCaptureMsg y sus etiquetas). El teléfono y la descripción son opcionales: hoy no se muestran.
    { text: 'nombre completo', source: HEREDADO },
    { text: 'tipo de proyecto (casa, departamento, oficina, etc.)', source: HEREDADO },
    { text: 'teléfono de contacto', source: HEREDADO },
    { text: 'descripción breve del proyecto', source: HEREDADO },
    { text: 'Perfecto. Para derivar tu solicitud de instalación y poder cotizarte, necesito estos datos: nombre completo, correo, comuna y tipo de proyecto.', source: ORTO },
    { text: 'Casi listo. Solo me falta tu ', source: HEREDADO },
    { text: ' para registrar la solicitud.', source: HEREDADO },
    { text: 'Gracias. Para completar tu solicitud de instalación, necesito que me indiques:\n', source: ORTO },
    // Etiquetas de los datos que se piden (también son las claves de ASKED_FIELD). Las de una palabra se ven en la
    // lista («1) Producto», «- nombre», «1) Correo») y en «Solo me falta tu correo…»; flowFase3a.test.ts las fija.
    { text: 'producto', source: HEREDADO },
    { text: 'nombre', source: HEREDADO },
    { text: 'correo', source: HEREDADO },
    { text: 'comuna', source: HEREDADO },
    { text: 'tipo de luz preferida', source: HEREDADO },
    { text: 'cantidad de unidades', source: HEREDADO },
    { text: 'espacio o proyecto de uso', source: HEREDADO },
    { text: 'comuna o ciudad de instalación', source: ORTO },
    { text: 'RUT de la empresa', source: HEREDADO },
    { text: 'correo de contacto', source: HEREDADO },
    // buildRepregunta1 («Entendido, para la casa, luz cálida podemos orientarte bien. …»). El color guardado se muestra
    // con 'luz ' delante y con su tilde (luzShown, LUZ_TILDE).
    { text: 'luz ', source: HEREDADO },
    ...['cálida', 'cálidas', 'cálido', 'cálidos', 'fría', 'frías', 'frío', 'fríos', 'ámbar'].map((text) => ({ text, source: ORTO })),
    { text: 'Entendido, para ', source: HEREDADO },
    { text: ' podemos orientarte bien.', source: HEREDADO },
    { text: 'Gracias por tu mensaje, podemos ayudarte.', source: HEREDADO },
    { text: ' Solo necesito saber ', source: HEREDADO },
    { text: ' para continuar.', source: HEREDADO },
    { text: ' Para recomendarte las opciones adecuadas, necesito:\n', source: HEREDADO },
    { text: '\n\n¿Me los puedes indicar?', source: ORTO },
    // summaryMsg (decisión 1 del 16-11): «Te resumo: 20 paneles LED 60x60, luz neutra, para oficina y en Maipú. ¿Está
    // bien?». Las partes (productos y cantidades, «luz …», «para …», «en …») van con «, » y « y » antes de la última,
    // también con dos (revisión 16-11: «30 tubos LED y luz fría»); la cantidad en metros, «500 m de cinta LED». El color usa 'luz ' y las tildes de arriba. flowResumen.test.ts fija los
    // cuatro ejemplos aprobados.
    { text: 'Te resumo: ', source: RESUMEN },
    { text: '. ¿Está bien?', source: RESUMEN },
    { text: 'para ', source: RESUMEN },
    { text: 'en ', source: RESUMEN },
    { text: ' y ', source: RESUMEN },
    { text: ' m de ', source: RESUMEN },
    // buildRepregunta2.
    { text: 'Casi listo. Solo me falta saber: ', source: HEREDADO },
    { text: '. ¿Me lo puedes indicar?', source: ORTO },
    { text: 'Casi listo. Solo me falta saber:\n', source: HEREDADO },
    // buildRepregunta3.
    { text: 'Para registrar tu solicitud necesito el RUT de la empresa.', source: HEREDADO },
    { text: 'Para registrar tu solicitud necesito tu nombre.', source: HEREDADO },
    { text: 'Para registrar tu solicitud necesito tu ', source: HEREDADO },
    { text: 'Para registrar tu solicitud necesito:\n', source: HEREDADO },
  ],
  webhook: [
    // Mensaje sin texto ni adjuntos.
    { text: '¡Hola! No recibimos tu mensaje. ¿Puedes escribirlo de nuevo?', source: ORTO },
  ],
  // PRIVACY_NOTICE se arma con trozos: van en OTHER_CONSTANTS, con el texto entero.
  privacyNotice: [],
  // buildTwiML solo envuelve la respuesta en el XML de Twilio.
  twilio: [],
};

/** Literales que parecen texto (isText) y no llegan al cliente, por archivo (texto → motivo). */
const INTERNAL: Record<FileKey, Record<string, string>> = {
  flowEngine: {
    'Tipo de luz': 'KEPT_LABEL: etiqueta de los cambios en la nota de Pipedrive',
    'Producto': 'KEPT_LABEL: etiqueta de los cambios en la nota de Pipedrive',
    'Cantidad': 'KEPT_LABEL: etiqueta de los cambios en la nota de Pipedrive',
    'Proyecto/uso': 'KEPT_LABEL: etiqueta de los cambios en la nota de Pipedrive',
    'Comuna/ciudad': 'KEPT_LABEL: etiqueta de los cambios en la nota de Pipedrive',
    ': antes ': 'nota de Pipedrive: los cambios (noteChange)',
    ', ahora ': 'nota de Pipedrive: los cambios (noteChange)',
    'varios items': 'nota de Pipedrive: la cantidad de varios ítems',
    'varios items (': 'nota de Pipedrive: la cantidad de varios ítems',
    ' m': 'nota de Pipedrive: la unidad de la cantidad en metros (cantidad_varios, cambios)',
    'Correo: antes ': 'nota de Pipedrive: el cambio de correo después del cierre (cambios)',
    'Respuesta del cliente al resumen, sin aplicar (revisar): ': 'nota de Pipedrive (ronda 4, red de seguridad): la respuesta al resumen que no se aplicó entera, textual para el vendedor (cambios); nunca va al cliente',
    'B2B': 'tipo de lead (interno)',
    'B2C': 'tipo de lead (interno)',
    'Unknown': 'tipo de lead (interno)',
    'NFD': 'normalize(): quitar tildes para comparar',
    'aprox ': 'texto del cliente normalizado para leer la cantidad («aprox.» → «aprox »)',
    'K': 'unidad del color que escribió el cliente (4000K): el dato, no un texto del bot',
    'ventas@elights.cl': 'PUBLISHED_EMAILS: reconocer los correos de eLIGHTS (nunca son los del cliente)',
    'claudio@elights.cl': 'PUBLISHED_EMAILS: reconocer los correos de eLIGHTS (nunca son los del cliente)',
    'constanza@elights.cl': 'PUBLISHED_EMAILS: reconocer los correos de eLIGHTS (nunca son los del cliente)',
  },
  webhook: {
    'Claude ok — wantsHuman: ': 'log de Vercel (claudeLogLine)',
    'Claude sin datos utilizables, valores por defecto en todos los campos: motivo=': 'log de Vercel (claudeLogLine)',
    'Claude con valores por defecto en ': 'log de Vercel (claudeLogLine)',
    ' stop_reason=': 'log de Vercel (claudeLogLine)',
    ' largo=': 'log de Vercel (claudeLogLine)',
    '[whatsapp/webhook]': 'prefijo de los logs de Vercel (LOG_PREFIX)',
    'Consulta de ': 'resumen interno para la nota de Pipedrive y el aviso al equipo',
    'POST': 'método HTTP',
    'utf-8': 'lectura del cuerpo de la solicitud',
    'Content-Type': 'cabecera HTTP de la respuesta',
    'text/xml': 'cabecera HTTP de la respuesta',
    '/api/whatsapp/webhook': 'URL firmada por Twilio',
    'x-twilio-signature': 'cabecera de la firma de Twilio',
    'whatsapp:': 'prefijo del número en Twilio',
    'From': 'campo del formulario de Twilio',
    'Body': 'campo del formulario de Twilio',
    'ProfileName': 'campo del formulario de Twilio',
    'MessageSid': 'campo del formulario de Twilio',
    'NumMedia': 'campo del formulario de Twilio',
    'MediaContentType': 'campo del formulario de Twilio (prefijo de MediaContentType0…)',
  },
  privacyNotice: {
    '[privacyNotice]': 'prefijo de los logs de Vercel (LOG_PREFIX)',
    '/politica-de-privacidad': 'ruta de PRIVACY_POLICY_URL (la URL va entera en PRIVACY_NOTICE)',
  },
  twilio: {
    '<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>': 'envoltorio XML de Twilio (buildTwiML)',
    '</Message></Response>': 'envoltorio XML de Twilio (buildTwiML)',
    '<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>': 'respuesta XML vacía de Twilio (buildSilentTwiML)',
    '&amp;': 'escape XML de la respuesta',
    '&lt;': 'escape XML de la respuesta',
    '&gt;': 'escape XML de la respuesta',
  },
};

interface Found { text: string; ascii: boolean; line: number }
const HAS_TWO_WORDS = /\p{L}{2,}\p{P}*\s+\p{P}*\p{L}/u;
/** Una clave interna: una sola palabra en minúscula, sin tilde, espacio ni signo ('stage1', 'tipo_de_luz', 'closed'). */
const KEY_RE = /^[a-z_$][\w$]*$/;
/** Un trozo de expresión regular (con una barra invertida, "(?" o "|"): nunca es un texto al cliente. */
const REGEX_LIKE = /\\|\(\?|\|/;
/** Lo que va justo antes de una etiqueta que se agrega a la lista de datos que se piden. */
const PUSHED = /\.push\(\s*$/;
const read = (relPath: string) => readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');

/** Puede ser texto al cliente (ver el comienzo de este archivo). */
function isText(text: string, pushed: boolean): boolean {
  if (!/\p{L}/u.test(text) || REGEX_LIKE.test(text)) return false;
  return pushed || HAS_TWO_WORDS.test(text) || !KEY_RE.test(text);
}

/** Los literales que pueden ser texto, sin los de console.*, RegExp, Error, import/export y las constantes listadas. */
function literalsOf(file: FileKey, covered: Set<string>): Found[] {
  const code = read(FILES[file]);
  return sourceLiterals(code, covered).literals
    .filter((l) => !l.skipped && isText(l.text, PUSHED.test(code.slice(Math.max(0, l.index - 12), l.index))))
    .map((l) => ({ text: l.text, ascii: /^[\x20-\x7e]*$/.test(l.raw), line: l.line }));
}

/** Las declaraciones de las constantes listadas: su texto en el código va en ASCII. */
function constantSources(relPath: string, names: Set<string>): Array<{ name: string; ascii: boolean }> {
  return sourceLiterals(read(relPath), names).constants.map((c) => ({ name: c.name, ascii: /^[\x20-\x7e\s]*$/.test(c.source) }));
}

const flowStrings = Object.entries(flow).filter((entry): entry is [string, string] => typeof entry[1] === 'string');

/** Todos los módulos del bot (los .ts de esta carpeta que no son pruebas). Un módulo nuevo se agrega aquí. */
const MODULES: Record<string, Record<string, unknown>> = {
  claudeAgent, comunas, 'comunas.generated': comunasGenerated, conversation, flowEngine: flow, leadCapture, notify,
  pipedriveLead, privacyNotice, quantity, rutCapture, stateStore, summary, transcript, twilio,
};

/** Constantes de texto exportadas por los demás módulos que no llegan al cliente (módulo → nombre → motivo). */
const INTERNAL_EXPORTS: Record<string, Record<string, string>> = {
  claudeAgent: { PROFILE_NOTE: 'instrucción para Claude, que solo extrae datos' },
  pipedriveLead: { NOTE_REF_LABEL: 'nota de Pipedrive: la referencia fija', NOTE_SEARCH_SORT: 'parámetro de la API de Pipedrive' },
  privacyNotice: { PRIVACY_POLICY_URL: 'la URL, que va dentro de PRIVACY_NOTICE' },
  stateStore: { SAVE_IF_REV_SCRIPT: 'script de Upstash (Redis)' },
  summary: { SUMMARY_EMPTY: 'nota de Pipedrive: el resumen vacío' },
  transcript: { PRIVACY_MARK: 'nota de Pipedrive: la marca del aviso de privacidad en la transcripción' },
};

/**
 * Lo que los archivos de FILES importan de los demás módulos del bot, revisado (módulo → nombre → motivo). Lo de
 * flowEngine.ts, privacyNotice.ts y twilio.ts se revisa en su propio escaneo.
 */
const IMPORTS: Record<string, Record<string, string>> = {
  rutCapture: {
    inspectRut: 'lee el RUT del mensaje (dato)', isBusinessRut: 'tipo del RUT (dato)', removeRuts: 'saca el RUT antes de leer la cantidad',
    rutRange: 'tipo del RUT por su número (dato)',
  },
  quantity: {
    itemsIn: 'lee los ítems del mensaje (dato)', mentionsQuantity: 'lee la cantidad (dato)', readQuantity: 'lee la cantidad (dato)',
    itemPairs: 'lee los ítems «cantidad + producto» del texto del cliente para el resumen (trozos de su texto, sin texto del bot)',
  },
  comunas: {
    findComunaMentions: 'lee la comuna (dato)', findComunas: 'lee la comuna (dato)', mentionsCompany: 'señal de empresa (dato)',
    officialComuna: 'nombre oficial de la comuna (el dato del cliente)',
  },
  conversation: { getHistory: 'historial para Claude', addTurn: 'historial para Claude' },
  claudeAgent: { askClaude: 'extrae datos y el resumen interno; su reply (FALLBACK_REPLY) no se envía' },
  leadCapture: { evaluateLeadSignals: 'señales del lead (dato)' },
  pipedriveLead: {
    buildWhatsAppUpdate: 'campos y nota de Pipedrive', ensureWhatsAppDeal: 'negocio de Pipedrive', notePart: 'nota de Pipedrive',
    noteSearchAt: 'búsqueda de la nota en Pipedrive', retryWhatsAppWrite: 'reintento en Pipedrive',
  },
  notify: { notifyTeam: 'aviso al equipo (correo interno)' },
  stateStore: Object.fromEntries([
    'acquireConversationLock', 'claimMessage', 'completeMessage', 'loadConversation', 'persistConversation', 'enqueuePendingWrite',
    'duePendingWrites', 'loadPendingWrites', 'claimPendingWrite', 'settlePendingWrite', 'beginFlowStep', 'settleFlowStep',
    'claimRegistration', 'awaitRegistration', 'stampFlow', 'recordRegistrationOutcome', 'registrationOutcome', 'awaitConversationUnlock',
    'confirmDealFields', 'sendablePendingWrite', 'anticipateWrite', 'retryDeliveredWrite', 'noteWriteKey', 'pendingLeaseUntil',
    'pendingVersion', 'claimDealWrite', 'flowFieldStamp', 'sameData', 'MESSAGE_RETRY_WAIT_MS', 'MAX_PENDING_RETRIES_PER_TURN',
    'MESSAGE_IN_PROGRESS_TTL_S',
  ].map((name) => [name, 'estado en Upstash, candados y cola de Pipedrive'])),
  transcript: Object.fromEntries([
    'botReplyText', 'clearTranscriptAfterNote', 'getTranscript', 'inboundText', 'noteEntryIds', 'recordTranscript', 'transcriptForNote',
  ].map((name) => [name, 'transcripción para la nota de Pipedrive'])),
};

/** Lo que importa (sin `import type`) cada archivo de FILES desde otro módulo del bot: [módulo, nombre]. */
function botImports(file: FileKey): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of read(FILES[file]).matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s*from\s*'([^']+)'/gm)) {
    const path = m[2];
    const inBot = file === 'webhook' ? path.startsWith('../_lib/whatsapp/') : path.startsWith('./');
    if (!inBot) continue;
    const module = path.replace(/^.*\//, '').replace(/\.js$/, '');
    for (const name of m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) out.push([module, name]);
  }
  return out;
}

describe('textos del bot: la lista congelada', () => {
  it('cada fuente es una de APPROVALS', () => {
    const all = [...Object.values(CONSTANTS), ...Object.values(OTHER_CONSTANTS), ...Object.values(FRAGMENTS).flat()];
    for (const { source } of all) expect(APPROVALS).toContain(source);
  });

  it('cada constante de texto exportada por flowEngine.ts está en CONSTANTS con su texto exacto', () => {
    const unlisted = flowStrings.filter(([name]) => !(name in CONSTANTS) && !(name in INTERNAL_CONSTANTS)).map(([name]) => name);
    expect(unlisted, 'constantes nuevas sin aprobación (ver el comienzo de este archivo)').toEqual([]);
    for (const [name, text] of flowStrings) if (name in CONSTANTS) expect(text, name).toBe(CONSTANTS[name].text);
  });

  it('cada entrada de CONSTANTS sigue exportada', () => {
    const exported = new Set(flowStrings.map(([name]) => name));
    expect(Object.keys(CONSTANTS).filter((name) => !exported.has(name))).toEqual([]);
    expect(Object.keys(INTERNAL_CONSTANTS).filter((name) => !exported.has(name))).toEqual([]);
  });

  it.each(Object.entries(OTHER_CONSTANTS))('%s: el texto exacto', (_name, { value, text }) => {
    expect(value).toBe(text);
  });

  describe.each(Object.keys(FILES) as FileKey[])('%s: cada literal que puede ser texto está aprobado o es interno', (file) => {
    const covered = new Set(file === 'flowEngine' ? Object.keys(CONSTANTS) : file === 'privacyNotice' ? ['PRIVACY_NOTICE'] : []);
    const found = literalsOf(file, covered);
    const client = new Set(FRAGMENTS[file].map((f) => f.text));
    const internal = INTERNAL[file];

    it('no hay literales sin listar', () => {
      const unlisted = found.filter((f) => !client.has(f.text) && !(f.text in internal)).map((f) => f.line + ': ' + JSON.stringify(f.text));
      expect(unlisted, 'textos nuevos: agregarlos a FRAGMENTS (con su fuente) o a INTERNAL (ver el comienzo de este archivo)').toEqual([]);
    });

    it('no hay entradas que ya no estén en el código', () => {
      const present = new Set(found.map((f) => f.text));
      expect([...client, ...Object.keys(internal)].filter((text) => !present.has(text))).toEqual([]);
    });

    it('los textos al cliente van en ASCII en el código (escapes \\u)', () => {
      expect(found.filter((f) => client.has(f.text) && !f.ascii).map((f) => f.line + ': ' + JSON.stringify(f.text))).toEqual([]);
    });
  });

  it('las constantes al cliente van en ASCII en el código (escapes \\u)', () => {
    const fromFlow = constantSources(FILES.flowEngine, new Set(Object.keys(CONSTANTS)));
    const others = [
      ...constantSources(FILES.privacyNotice, new Set(['PRIVACY_NOTICE'])),
      ...constantSources('./claudeAgent.ts', new Set(['FALLBACK_REPLY'])),
    ];
    expect(fromFlow.map((c) => c.name).sort()).toEqual(Object.keys(CONSTANTS).sort());
    expect(others.map((c) => c.name).sort()).toEqual(Object.keys(OTHER_CONSTANTS).sort());
    expect([...fromFlow, ...others].filter((c) => !c.ascii).map((c) => c.name)).toEqual([]);
  });
});

describe('textos del bot: los demás módulos no arman respuestas', () => {
  it('MODULES lista todos los .ts del bot de esta carpeta', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => f.replace(/\.ts$/, ''));
    expect(files.sort()).toEqual(Object.keys(MODULES).sort());
  });

  it('cada constante de texto exportada está aprobada o es interna', () => {
    const unlisted: string[] = [];
    for (const [module, exports] of Object.entries(MODULES)) {
      if (module === 'flowEngine') continue; // la revisan las pruebas de CONSTANTS
      for (const [name, value] of Object.entries(exports)) {
        if (typeof value !== 'string' || !/\p{L}/u.test(value)) continue;
        if (OTHER_CONSTANTS[name]?.value === value || INTERNAL_EXPORTS[module]?.[name]) continue;
        unlisted.push(module + '.' + name);
      }
    }
    expect(unlisted, 'constantes de texto nuevas: a OTHER_CONSTANTS (con su fuente) o a INTERNAL_EXPORTS (con el motivo)').toEqual([]);
    for (const [module, names] of Object.entries(INTERNAL_EXPORTS)) {
      for (const name of Object.keys(names)) expect(typeof MODULES[module]?.[name], module + '.' + name).toBe('string');
    }
  });

  it('lo que flowEngine.ts y webhook.ts importan de los demás módulos está revisado en IMPORTS', () => {
    const scanned = new Set<string>(Object.keys(FILES));
    const imports = (Object.keys(FILES) as FileKey[]).flatMap(botImports).filter(([module]) => !scanned.has(module));
    expect(imports.length).toBeGreaterThan(0);
    const unlisted = imports.filter(([module, name]) => !IMPORTS[module]?.[name]).map(([module, name]) => module + '.' + name);
    expect(unlisted, 'imports nuevos: revisarlos y agregarlos a IMPORTS (si arman texto al cliente, su archivo va a FILES)').toEqual([]);
    const used = new Set(imports.map(([module, name]) => module + '.' + name));
    const stale = Object.entries(IMPORTS).flatMap(([module, names]) => Object.keys(names).map((name) => module + '.' + name)).filter((key) => !used.has(key));
    expect(stale, 'entradas de IMPORTS que ya no se importan').toEqual([]);
  });
});

// (revisión 16-11, T5) quantity.itemPairs pasa al resumen sin revisar su texto (IMPORTS lo da por dato): cada par que
// devuelve tiene que ser un trozo del texto del cliente (con los espacios juntados). Un texto que agregue itemPairs
// («aprox.», «unidades», una unidad traducida) hace fallar esta prueba.
describe('textos del bot: itemPairs solo devuelve trozos del texto del cliente', () => {
  const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();
  it.each([
    'Necesito 12 focos LED y 5 paneles LED para una bodega',
    'También necesito 10 focos LED',
    'Necesito 10 paneles LED a $5.000 c/u y 5 focos LED',
    'necesito 12 focos  LED\ny 5 paneles LED 60x60, luz fría',
    '20 campanas UFO 200W, 15 reflectores LED 100W IP66 y 8 focos embutidos',
    'Necesito 1.000 focos LED y 500 metros de cinta LED 220V',
    '30 tubos LED T8 18W 120cm / 25 tubos LED T5 14W',
    'Necesito 10 unidades de paneles LED y 4 unds de focos',
  ])('«%s»', (text) => {
    const pairs = quantity.itemPairs(text);
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) expect(squeeze(text)).toContain(squeeze(pair));
  });
});
