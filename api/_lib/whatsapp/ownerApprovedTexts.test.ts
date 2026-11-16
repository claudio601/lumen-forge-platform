// api/_lib/whatsapp/ownerApprovedTexts.test.ts
// Guarda de los textos del bot de WhatsApp (FASE 3A, 16-11-2026): la lista congelada de TODOS los textos fijos que el
// bot puede mandar al cliente, cada uno con su fuente de aprobación. El bot no redacta con IA (claudeAgent.ts solo
// extrae datos): lo que recibe el cliente sale de estas constantes y de estos trozos.
//
// Qué revisa:
// 1. Cada constante de texto que exporta flowEngine.ts (MSG_*, OWN_EMAIL_NOTE), más FALLBACK_REPLY (claudeAgent.ts) y
//    PRIVACY_NOTICE (privacyNotice.ts), está en CONSTANTS con su texto exacto. Una constante nueva o un texto cambiado
//    hace fallar la prueba.
// 2. Cada literal de dos palabras o más de flowEngine.ts, webhook.ts y privacyNotice.ts (los trozos con que se arman
//    las repreguntas, la instalación, la aclaración de la lista, etc.) está en FRAGMENTS (al cliente, con su fuente) o
//    en INTERNAL (logs, nota de Pipedrive, resumen interno, con el motivo). No se revisan los literales de console.*,
//    RegExp ni Error, los de import/export ni los tipos. Una entrada que ya no está en el código también falla.
// 3. En el código, los textos al cliente van en ASCII, con escapes \u (como el resto de flowEngine.ts).
// Los literales se leen con api/_tests/sourceLiterals.ts (sin el compilador de TypeScript, que la suite no carga).
//
// Cómo agregar o cambiar un texto:
// - Primero el OK del dueño al texto exacto. Si todavía no lo da, la fuente es 'pendiente OK del dueño (<fecha>)' y se
//   le muestra antes de fusionar.
// - En el .ts, el texto con escapes \u (á \u00e1, é \u00e9, í \u00ed, ó \u00f3, ú \u00fa, ñ \u00f1, ¿ \u00bf, ¡ \u00a1).
// - Aquí, el texto tal cual (UTF-8) en CONSTANTS (constante exportada) o en FRAGMENTS (trozo dentro de una función),
//   con su fuente de APPROVALS; si la fuente es nueva, se agrega a APPROVALS con la fecha y el número de la PR.
// - Un literal que no llega al cliente va en INTERNAL, con el motivo.
// - Límite: una etiqueta de una sola palabra ('nombre', 'correo', 'comuna') no se detecta (no se distingue de las
//   claves internas); la cubren las pruebas de las repreguntas (flowFase3a.test.ts) y de la instalación.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { FALLBACK_REPLY } from './claudeAgent';
import { PRIVACY_NOTICE, PRIVACY_POLICY_URL } from './privacyNotice';
import { sourceLiterals } from '../../_tests/sourceLiterals';

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
    // Etiquetas de los datos que se piden (también son las claves de ASKED_FIELD).
    { text: 'tipo de luz preferida', source: HEREDADO },
    { text: 'cantidad de unidades', source: HEREDADO },
    { text: 'espacio o proyecto de uso', source: HEREDADO },
    { text: 'comuna o ciudad de instalación', source: ORTO },
    { text: 'RUT de la empresa', source: HEREDADO },
    { text: 'correo de contacto', source: HEREDADO },
    // buildRepregunta1 («Entendido, para la casa, luz cálida podemos orientarte bien. …»).
    { text: 'Entendido, para ', source: HEREDADO },
    { text: ' podemos orientarte bien.', source: HEREDADO },
    { text: 'Gracias por tu mensaje, podemos ayudarte.', source: HEREDADO },
    { text: ' Solo necesito saber ', source: HEREDADO },
    { text: ' para continuar.', source: HEREDADO },
    { text: ' Para recomendarte las opciones adecuadas, necesito:\n', source: HEREDADO },
    { text: '\n\n¿Me los puedes indicar?', source: ORTO },
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
};

/** Literales de dos palabras o más que no llegan al cliente, por archivo (texto → motivo). */
const INTERNAL: Record<FileKey, Record<string, string>> = {
  flowEngine: {
    'Tipo de luz': 'KEPT_LABEL: etiqueta de los cambios en la nota de Pipedrive',
    'varios items': 'nota de Pipedrive: la cantidad de varios ítems',
    'varios items (': 'nota de Pipedrive: la cantidad de varios ítems',
    'Correo: antes ': 'nota de Pipedrive: el cambio de correo después del cierre (cambios)',
  },
  webhook: {
    'Claude ok — wantsHuman: ': 'log de Vercel (claudeLogLine)',
    'Claude sin datos utilizables, valores por defecto en todos los campos: motivo=': 'log de Vercel (claudeLogLine)',
    'Claude con valores por defecto en ': 'log de Vercel (claudeLogLine)',
    'Consulta de ': 'resumen interno para la nota de Pipedrive y el aviso al equipo',
  },
  privacyNotice: {},
};

interface Found { text: string; ascii: boolean; line: number }
const HAS_TWO_WORDS = /\p{L}{2,}\p{P}*\s+\p{P}*\p{L}/u;
const read = (relPath: string) => readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');

/** Los literales de dos palabras o más del archivo, sin los de console.*, RegExp, Error, import/export y las constantes listadas. */
function literalsOf(file: FileKey, covered: Set<string>): Found[] {
  return sourceLiterals(read(FILES[file]), covered).literals
    .filter((l) => !l.skipped && HAS_TWO_WORDS.test(l.text))
    .map((l) => ({ text: l.text, ascii: /^[\x20-\x7e]*$/.test(l.raw), line: l.line }));
}

/** Las declaraciones de las constantes listadas: su texto en el código va en ASCII. */
function constantSources(relPath: string, names: Set<string>): Array<{ name: string; ascii: boolean }> {
  return sourceLiterals(read(relPath), names).constants.map((c) => ({ name: c.name, ascii: /^[\x20-\x7e\s]*$/.test(c.source) }));
}

const flowStrings = Object.entries(flow).filter((entry): entry is [string, string] => typeof entry[1] === 'string');

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

  describe.each(Object.keys(FILES) as FileKey[])('%s: cada literal de dos palabras o más está aprobado o es interno', (file) => {
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
