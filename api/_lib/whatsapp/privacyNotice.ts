// api/_lib/whatsapp/privacyNotice.ts
// Aviso breve de privacidad del asistente de WhatsApp (Etapa 2 · PR 13w; Ley 21.719: informar
// a la persona al recoger sus datos). Va una vez por número, al final de la primera respuesta
// que el asistente le envía, dentro del mismo <Message> y separado por una línea en blanco.
// Nunca reemplaza ni adelanta la respuesta: el saludo o la respuesta se lee primero.
//
// Reglas
// - El texto dice solo lo que el código hace: las respuestas son plantillas fijas y la IA
//   (claudeAgent.ts) solo extrae datos; el negocio en Pipedrive solo se crea si hay correo
//   ("puede quedar registrada"). No promete pasar a una persona: el flujo pide el correo antes.
//   Todo lo que dice está en la política vigente (src/pages/PrivacidadPage.tsx, versión 1.2);
//   privacyNotice.test.ts lo comprueba.
// - Los textos van con escapes \u, como flowEngine.ts, para no arriesgar mojibake.
// - El registro de "ya mostrado" es un Set en la memoria de la instancia, con el mismo teléfono
//   que usan conversation.ts y flowEngine.ts (From sin 'whatsapp:'). El aviso puede repetirse:
//   tras un cold start o un deploy, si el mensaje lo atiende otra instancia de Vercel o al
//   llegar al tope del registro (MAX_TRACKED).
// - Solo se da por mostrado si la respuesta sale a tiempo. Twilio espera 15 s la respuesta del
//   webhook y, si se pasa, no envía nada (error 11200), aunque la función siga corriendo. Si
//   pasaron más de NOTICE_DEADLINE_MS desde que empezó el webhook (Claude o Pipedrive lentos),
//   la respuesta lleva el aviso, pero el número no se marca y la siguiente lo vuelve a llevar.
// - Lo que este código no ve: si Twilio o WhatsApp no entregan una respuesta enviada a tiempo,
//   el número queda marcado en esa instancia y no vuelve a recibir el aviso hasta un reinicio.
// - Síncrono, sin red ni I/O, y nunca lanza: ante cualquier falla del registro se envía la
//   respuesta CON el aviso (lado seguro). Nunca bloquea ni demora la respuesta.
// - webhook.ts lo llama al armar el TwiML que se envía, después de addTurn y del log QA: el
//   aviso no entra al historial que va a Claude, ni a Pipedrive, ni a los logs.
// - Si el estado pasa a Redis (v2 del bot): SET NX con TTL y espera corta; si falla o se demora,
//   mostrar el aviso. Eso guarda un dato personal nuevo y obliga a cambiar la política.

import { SITE_URL } from '../site.js';

const LOG_PREFIX = '[privacyNotice]';

/** Política vigente (no una versión archivada). Pasa sola a elights.cl con SITE_URL en la Etapa 3. */
export const PRIVACY_POLICY_URL: string = SITE_URL + '/politica-de-privacidad';

/**
 * Texto del aviso, hasta 300 caracteres. Tres líneas: la URL va sola en la suya para que
 * WhatsApp la convierta en enlace sin pegarle un punto ni una coma. Sin &, < ni >, así que
 * buildTwiML lo deja tal cual.
 */
export const PRIVACY_NOTICE: string =
  'Privacidad: eLIGHTS.CL SpA usa tus datos para responder tu consulta. Te atiende un asistente autom\u00e1tico con IA y tu solicitud puede quedar registrada en nuestro sistema de seguimiento.\n' +
  'Pol\u00edtica: ' + PRIVACY_POLICY_URL + '\n' +
  'Derechos: ventas@elights.cl, asunto \u00abDatos personales\u00bb';

/** Separación entre la respuesta y el aviso: una línea en blanco. */
export const NOTICE_SEPARATOR = '\n\n';

/** Tope del registro en memoria. Al llegar se vacía y el aviso vuelve a mostrarse (lado seguro). */
export const MAX_TRACKED = 5000;

/**
 * Plazo, desde que empieza el webhook, para dar el aviso por mostrado. Twilio espera 15 s; el
 * margen de 5 s cubre lo que corre antes del webhook (arranque en frío y red) y el envío.
 */
export const NOTICE_DEADLINE_MS = 10_000;

/** Lo que el aviso necesita del registro de "ya mostrado". Un Set<string> lo cumple. */
export interface NoticeStore {
  has(phone: string): boolean;
  add(phone: string): unknown;
  clear(): void;
  readonly size: number;
}

/** La respuesta, intacta, y después el aviso. Con una respuesta vacía, solo el aviso. */
export function appendPrivacyNotice(reply: string): string {
  return reply ? reply + NOTICE_SEPARATOR + PRIVACY_NOTICE : PRIVACY_NOTICE;
}

/**
 * Dice si a `phone` hay que mostrarle el aviso y, si es así y `mark` es true, lo deja
 * registrado. Devuelve false solo cuando el número ya estaba en el registro. Con un número
 * vacío o ante cualquier falla del registro devuelve true (lado seguro). Nunca lanza.
 */
export function shouldShowPrivacyNotice(
  store: NoticeStore,
  phone: string,
  maxTracked: number = MAX_TRACKED,
  mark: boolean = true,
): boolean {
  try {
    if (!phone) return true;
    if (store.has(phone)) return false;
    if (!mark) return true;
    if (store.size >= maxTracked) store.clear();
    store.add(phone);
  } catch {
    // Sin el teléfono en el log: solo que el registro falló.
    console.warn(LOG_PREFIX + ' registro no disponible; se muestra el aviso');
  }
  return true;
}

/** Números (From sin 'whatsapp:') que ya recibieron el aviso en esta instancia. */
const shownTo: NoticeStore = new Set<string>();

/**
 * La respuesta que se envía a `phone`: la primera vez en esta instancia, con el aviso al
 * final; después, sin cambios. `startedAt` es el Date.now() del inicio del webhook: si ya
 * pasaron más de NOTICE_DEADLINE_MS (o no es un número), la respuesta lleva el aviso pero el
 * número no se marca. Síncrona y sin red; nunca lanza ni demora la respuesta.
 */
export function withPrivacyNotice(phone: string, reply: string, startedAt: number): string {
  const onTime = Date.now() - startedAt <= NOTICE_DEADLINE_MS;
  return shouldShowPrivacyNotice(shownTo, phone, MAX_TRACKED, onTime) ? appendPrivacyNotice(reply) : reply;
}
