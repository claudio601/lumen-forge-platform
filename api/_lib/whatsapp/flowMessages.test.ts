// api/_lib/whatsapp/flowMessages.test.ts
// Regla del dueño (2026-10-16, especificación del bot §5): la atención de una persona es por
// correo, nunca por WhatsApp ni por teléfono (este número lo atiende solo el asistente). Ningún
// mensaje fijo del asistente ofrece seguir "por este canal", llamar o "te contactaremos" sin
// decir que es por correo, y el cierre de instalación solo promete el correo si lo tenemos.
// [ARCHIVOS] Decisión del dueño (13-11-2026, 1A): las imágenes y los archivos que llegan por WhatsApp no pasan a la
// solicitud. El aviso lo dice y pide mandarlos por correo a ventas@, sin prometer que se incorporan ni que alguien
// los revisa por aquí; el texto que los acompaña sigue el flujo, y una ráfaga recibe un solo aviso.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as flow from './flowEngine';
import { FALLBACK_REPLY } from './claudeAgent';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000099';
const PHONE_B = '+56900000098';

/** Todos los textos fijos que el asistente puede enviar. */
const MESSAGES: Array<[string, string]> = [
  ...Object.entries(flow).filter(([k, v]) => /^MSG/.test(k) && typeof v === 'string') as Array<[string, string]>,
  ['FALLBACK_REPLY', FALLBACK_REPLY],
];

afterEach(() => {
  flow.clearFlowState(PHONE);
  flow.clearFlowState(PHONE_B);
  vi.useRealTimers();
});

describe('solo correo: ningún mensaje ofrece seguir por WhatsApp o por teléfono', () => {
  it('hay mensajes que revisar', () => {
    expect(MESSAGES.length).toBeGreaterThan(10);
  });

  it.each(MESSAGES)('%s no ofrece este canal, llamadas ni un contacto sin decir el medio', (_name, text) => {
    // [ARCHIVOS] Decir que por WhatsApp NO se reciben archivos ni audios no ofrece el canal: solo esas frases exactas
    // quedan fuera.
    expect(text.replace(/por whatsapp no podemos (?:recibir imágenes ni archivos|escuchar audios ni ver videos)/gi, '')).not.toMatch(/mismo canal|este canal|por whatsapp|te llam|llamada/i);
    // "te contactará" solo vale si dice que es por correo
    if (/contactar|contactaremos/i.test(text)) expect(text).toMatch(/contactar[a\u00e1]? por correo/i);
  });

  it('pedir un ejecutivo (con correo): lo atiende Claudio Quero por correo', () => {
    expect(flow.MSG_HUMAN).toContain('Te va a atender Claudio Quero directamente por correo');
  });

  it('cierre de instalación con correo: el cierre aprobado (11-11-2026), por correo y sin visita', () => {
    expect(flow.MSG4_INSTALL).toBe('Tu solicitud quedó registrada. Claudio Quero te responderá por correo el mismo día hábil.');
    expect(flow.MSG4_INSTALL).not.toMatch(/visita|terreno|llam/i);
    expect(flow.installClosingMsg({ install_correo: 'a@example.com' })).toBe(flow.MSG4_INSTALL);
  });

  it('cierre de instalación sin correo: no promete contacto, pide el correo o ventas@', () => {
    expect(flow.installClosingMsg({})).toBe(flow.MSG4_INSTALL_NO_EMAIL);
    expect(flow.MSG4_INSTALL_NO_EMAIL).toContain('ventas@elights.cl');
    expect(flow.MSG4_INSTALL_NO_EMAIL).not.toMatch(/te vamos a escribir|registrad/i);
  });
});

describe('flujo de instalación que se cierra sin correo', () => {
  it('tras las repreguntas responde MSG4_INSTALL_NO_EMAIL, sin negocio, y lo repite si vuelve a escribir', () => {
    let r = flow.processFlowStep(PHONE, 'quiero instalar luces', {}, NO_SIGNALS);
    expect(r.closedFlow).toBe(false);
    for (let i = 0; i < 3 && !r.closedFlow; i++) r = flow.processFlowStep(PHONE, 'mmm', {}, NO_SIGNALS);
    expect(r.closedFlow).toBe(true);
    expect(r.reply).toBe(flow.MSG4_INSTALL_NO_EMAIL);
    expect(r.shouldCreateDeal).toBe(false);
    const again = flow.processFlowStep(PHONE, 'gracias', {}, NO_SIGNALS);
    expect(again.reply).toBe(flow.MSG4_INSTALL_NO_EMAIL);
  });
});

describe('[ARCHIVOS] imágenes y archivos por WhatsApp (dueño, 13-11-2026, decisión 1A)', () => {
  const MEDIA = { ...NO_SIGNALS, hasMedia: true };
  const FOCOS = 'Necesito 20 focos LED luz fría';
  const FOCOS_CLAUDE = { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20' };
  let lastReply: string | undefined;
  /** Un mensaje, con la respuesta anterior como la entrega webhook.ts (del historial). */
  const step = (body: string, claude: Record<string, string> = {}, hasMedia = false) => {
    const r = flow.processFlowStep(PHONE, body, claude, { ...NO_SIGNALS, hasMedia, lastReply });
    lastReply = r.reply;
    return r;
  };
  afterEach(() => { lastReply = undefined; });

  it('el aviso dice que por WhatsApp no se reciben y pide el correo a ventas@, sin prometer que se incorporan ni que se revisan', () => {
    expect(flow.MSG_MEDIA_NOTICE).toBe('Por WhatsApp no podemos recibir imágenes ni archivos para tu solicitud. Por favor, envíalos por correo a ventas@elights.cl.');
    expect(flow.MSG_MEDIA.startsWith(flow.MSG_MEDIA_NOTICE + '\n\n')).toBe(true);
    for (const text of [flow.MSG_MEDIA_NOTICE, flow.MSG_MEDIA]) {
      expect(text).toContain('no podemos recibir');
      expect(text).toMatch(/por correo a ventas@elights\.cl/);
      expect(text).not.toMatch(/recibimos|recibid|gracias|incorpor|agreg|adjuntamos|qued[oó]|revis|te (responde|contacta|escrib)/i);
    }
  });

  it('archivo solo al empezar: el aviso y la pregunta de la etapa 1, que queda anotada', () => {
    expect(flow.recordMediaReply(PHONE)).toBe(flow.MSG_MEDIA);
    expect(flow.getFlowState(PHONE).lastQuestion?.asks).toEqual(['producto', 'cantidad', 'proyecto_o_uso']);
    expect(step('20').captured.cantidad).toBe('20');
  });

  it('archivo solo más adelante: el aviso y seguir por escrito; la pregunta anterior sigue pendiente y el flujo continúa', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect(step(FOCOS, FOCOS_CLAUDE).reply).toBe(flow.MSG2);
    const asked = flow.getFlowState(PHONE).lastQuestion;
    expect(flow.recordMediaReply(PHONE, ['image/jpeg'])).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
    expect(flow.getFlowState(PHONE).lastQuestion).toEqual(asked);
    expect(flow.getFlowState(PHONE).stage).toBe('stage2');
    const r = step('Es para una bodega en Lampa', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' });
    expect(r.captured).toMatchObject({ ...FOCOS_CLAUDE, proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' });
    expect(flow.getFlowState(PHONE).stage).toBe('stage3');
    expect(flow.hasMediaNotice(r.reply)).toBe(false);
  });

  it('archivo con texto: el texto sigue el flujo y la respuesta del paso va entera, con el aviso delante', () => {
    const plain = flow.processFlowStep(PHONE_B, FOCOS, FOCOS_CLAUDE, NO_SIGNALS);
    const media = flow.processFlowStep(PHONE, FOCOS, FOCOS_CLAUDE, MEDIA);
    expect(media.reply).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + plain.reply);
    expect(media.captured).toEqual(plain.captured);
    expect(flow.getFlowState(PHONE).stage).toBe(flow.getFlowState(PHONE_B).stage);
    expect(flow.getFlowState(PHONE).lastQuestion).toEqual(flow.getFlowState(PHONE_B).lastQuestion);
    // El paso siguiente, sin archivos, sigue igual en los dos.
    const next = { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' };
    expect(flow.processFlowStep(PHONE, 'Es para una bodega en Lampa', next, NO_SIGNALS).reply)
      .toBe(flow.processFlowStep(PHONE_B, 'Es para una bodega en Lampa', next, NO_SIGNALS).reply);
  });

  it('archivo con texto que cierra la solicitud: el cierre no cambia y no dice que el archivo se recibió', () => {
    const body = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
    const claude = { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
    const plain = flow.processFlowStep(PHONE_B, body, claude, NO_SIGNALS);
    const media = flow.processFlowStep(PHONE, body, claude, MEDIA);
    expect(plain.shouldCreateDeal).toBe(true);
    expect(media).toMatchObject({ shouldCreateDeal: true, closedFlow: plain.closedFlow, reply: flow.withMediaNotice(plain.reply) });
  });

  it('una ráfaga recibe un solo aviso: los archivos siguientes, solos o con texto, no lo repiten', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T15:00:00Z'));
    expect(flow.recordMediaReply(PHONE)).toBe(flow.MSG_MEDIA);
    vi.setSystemTime(new Date('2026-11-13T15:00:20Z'));
    expect(flow.recordMediaReply(PHONE)).toBe('');
    vi.setSystemTime(new Date('2026-11-13T15:01:00Z'));
    const withText = step(FOCOS, FOCOS_CLAUDE, true);
    expect(flow.hasMediaNotice(withText.reply)).toBe(false);
    expect(withText.captured).toMatchObject(FOCOS_CLAUDE);
    // Un mensaje sin archivos no lleva el aviso ni corta la ráfaga.
    vi.setSystemTime(new Date('2026-11-13T15:01:30Z'));
    expect(flow.hasMediaNotice(step('ok').reply)).toBe(false);
    vi.setSystemTime(new Date('2026-11-13T15:02:00Z'));
    expect(flow.recordMediaReply(PHONE)).toBe('');
    // Pasado MEDIA_BURST_MS desde el último archivo, otro archivo vuelve a recibir el aviso.
    const last = Date.parse('2026-11-13T15:02:00Z');
    vi.setSystemTime(new Date(last + flow.MEDIA_BURST_MS));
    expect(flow.hasMediaNotice(step('Es para una bodega en Lampa', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' }, true).reply)).toBe(true);
    vi.setSystemTime(new Date(last + 2 * flow.MEDIA_BURST_MS + 1));
    expect(flow.recordMediaReply(PHONE)).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
  });

  it('[SIN-REPETIR] la respuesta anterior se compara sin el aviso: el texto A no se repite igual', () => {
    step('Necesito 12 focos LED luz cálida para mi casa en Maipú', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' });
    for (let i = 0; i < 4 && flow.getFlowState(PHONE).stage !== 'closed'; i++) step('no sé');
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    expect(step('hola?').reply).toBe(flow.MSG_EMAIL_SHORT);
    expect(step('mira esta foto', {}, true).reply).toBe(flow.withMediaNotice(flow.MSG_NEED_EMAIL));
    expect(step('ok').reply).toBe(flow.MSG_EMAIL_SHORT);
  });

  it('fuera de la etapa 1, todo aviso invita a seguir por escrito mientras el bot espera una respuesta', () => {
    // Instalación: la lista de datos sigue pendiente.
    flow.processFlowStep(PHONE, 'quiero instalar luces', {}, NO_SIGNALS);
    expect(flow.getFlowState(PHONE).stage).toBe('install_capture');
    expect(flow.recordMediaReply(PHONE, ['application/pdf'])).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
    // Cerrada sin correo: el cierre pidió el correo, que sigue pendiente.
    let r = flow.processFlowStep(PHONE_B, 'Necesito 12 focos LED luz cálida para mi casa en Maipú', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' }, NO_SIGNALS);
    for (let i = 0; i < 4 && !r.closedFlow; i++) r = flow.processFlowStep(PHONE_B, 'no sé', {}, NO_SIGNALS);
    expect(flow.getFlowState(PHONE_B)).toMatchObject({ stage: 'closed' });
    expect(flow.getFlowState(PHONE_B).captured.correo).toBeUndefined();
    expect(flow.recordMediaReply(PHONE_B, ['audio/ogg'])).toBe(flow.MSG_VOICE_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
  });

  it('cerrada con su solicitud (sin pregunta pendiente): el archivo, solo el aviso; el audio, que lo escriba', () => {
    const body = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
    const claude = { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
    expect(flow.processFlowStep(PHONE, body, claude, NO_SIGNALS).shouldCreateDeal).toBe(true);
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    expect(flow.recordMediaReply(PHONE, ['image/jpeg'])).toBe(flow.MSG_MEDIA_NOTICE);
    expect(flow.recordMediaReply(PHONE, ['audio/ogg'])).toBe(flow.MSG_VOICE_NOTICE + '\n\n' + flow.MSG_VOICE_WRITE);
  });
});

describe('[ARCHIVOS] audios y videos sin texto: que lo escriba (revisión del 13-11-2026)', () => {
  const FOCOS = 'Necesito 20 focos LED luz fría';
  const FOCOS_CLAUDE = { producto: 'focos LED', tipo_de_luz: 'fria', cantidad: '20' };
  const VOICE_PENDING = flow.MSG_VOICE_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING;

  it('los tipos de adjunto: audio y video son voz; imagen, documento o sin tipo son archivo', () => {
    expect(flow.mediaKinds(['audio/ogg'])).toEqual({ files: false, voice: true });
    expect(flow.mediaKinds(['audio/ogg; codecs=opus', 'VIDEO/mp4'])).toEqual({ files: false, voice: true });
    expect(flow.mediaKinds(['image/jpeg'])).toEqual({ files: true, voice: false });
    expect(flow.mediaKinds(['application/pdf', ''])).toEqual({ files: true, voice: false });
    expect(flow.mediaKinds([])).toEqual({ files: true, voice: false });
    expect(flow.mediaKinds(['image/jpeg', 'audio/ogg'])).toEqual({ files: true, voice: true });
  });

  it('los textos: no prometen nada, no piden mandar el audio por correo y piden escribir', () => {
    expect(flow.MSG_VOICE).toBe(flow.MSG_VOICE_NOTICE + '\n\n' + flow.MSG_MEDIA_ASK);
    expect(flow.MSG_MEDIA).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_ASK);
    for (const text of [flow.MSG_VOICE_NOTICE, flow.MSG_VOICE, flow.MSG_MEDIA_PENDING, flow.MSG_VOICE_WRITE]) {
      expect(text).not.toMatch(/recibimos|recibid|gracias|incorpor|agreg|adjuntamos|qued[oó]|revis|te (responde|contacta|escrib)|correo|ventas@/i);
    }
    for (const text of [flow.MSG_VOICE, flow.MSG_MEDIA_PENDING, flow.MSG_VOICE_WRITE]) expect(text).toMatch(/por escrito/);
  });

  it('nota de voz al empezar: que no la escuchamos y la pregunta de la etapa 1, que queda anotada', () => {
    expect(flow.recordMediaReply(PHONE, ['audio/ogg'])).toBe(flow.MSG_VOICE);
    expect(flow.getFlowState(PHONE).lastQuestion?.asks).toEqual(['producto', 'cantidad', 'proyecto_o_uso']);
    expect(flow.getFlowState(PHONE).lastMediaAt).toBeUndefined();
    expect(flow.processFlowStep(PHONE, '20', {}, NO_SIGNALS).captured.cantidad).toBe('20');
  });

  it('nota de voz en la etapa 2: que no la escuchamos y que siga por escrito; la pregunta sigue pendiente y el flujo continúa', () => {
    expect(flow.processFlowStep(PHONE, FOCOS, FOCOS_CLAUDE, NO_SIGNALS).reply).toBe(flow.MSG2);
    const asked = flow.getFlowState(PHONE).lastQuestion;
    const reply = flow.recordMediaReply(PHONE, ['audio/ogg']);
    expect(reply).toBe(VOICE_PENDING);
    expect(reply).not.toContain('ventas@');
    expect(flow.getFlowState(PHONE)).toMatchObject({ stage: 'stage2', lastQuestion: asked });
    const r = flow.processFlowStep(PHONE, 'Es para una bodega en Lampa', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' }, NO_SIGNALS);
    expect(r.captured).toMatchObject({ ...FOCOS_CLAUDE, proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Lampa' });
    expect(flow.getFlowState(PHONE).stage).toBe('stage3');
  });

  it('nota de voz dentro de la ráfaga de una foto: igual responde; y no abre ni alarga la ráfaga de los archivos', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T15:00:00Z'));
    expect(flow.processFlowStep(PHONE, FOCOS, FOCOS_CLAUDE, NO_SIGNALS).reply).toBe(flow.MSG2);
    expect(flow.recordMediaReply(PHONE, ['image/jpeg'])).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
    vi.setSystemTime(new Date('2026-11-13T15:00:30Z'));
    expect(flow.recordMediaReply(PHONE, ['audio/ogg'])).toBe(VOICE_PENDING);
    vi.setSystemTime(new Date('2026-11-13T15:01:00Z'));
    expect(flow.recordMediaReply(PHONE, ['audio/ogg'])).toBe(VOICE_PENDING);
    // Un video también; una foto y un audio juntos, dentro de la ráfaga, solo el aviso de los audios.
    expect(flow.recordMediaReply(PHONE, ['video/mp4'])).toBe(VOICE_PENDING);
    expect(flow.recordMediaReply(PHONE, ['image/jpeg', 'audio/ogg'])).toBe(VOICE_PENDING);
    vi.setSystemTime(new Date('2026-11-13T15:01:10Z'));
    expect(flow.recordMediaReply(PHONE, ['image/png'])).toBe('');
    // La ráfaga se cuenta desde el último archivo (15:01:10), no desde los audios.
    expect(flow.getFlowState(PHONE).lastMediaAt).toBe(Date.parse('2026-11-13T15:01:10Z'));
    vi.setSystemTime(new Date(Date.parse('2026-11-13T15:01:10Z') + flow.MEDIA_BURST_MS));
    expect(flow.recordMediaReply(PHONE, ['audio/ogg'])).toBe(VOICE_PENDING);
    expect(flow.getFlowState(PHONE).lastMediaAt).toBe(Date.parse('2026-11-13T15:01:10Z'));
    expect(flow.recordMediaReply(PHONE, ['image/png'])).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
  });

  it('un audio no abre la ráfaga: la foto que llega después recibe su aviso', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T15:00:00Z'));
    expect(flow.recordMediaReply(PHONE, ['audio/ogg'])).toBe(flow.MSG_VOICE);
    vi.setSystemTime(new Date('2026-11-13T15:00:10Z'));
    expect(flow.recordMediaReply(PHONE, ['image/jpeg'])).toBe(flow.MSG_MEDIA);
  });
});
