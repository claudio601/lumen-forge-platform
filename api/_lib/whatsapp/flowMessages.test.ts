// api/_lib/whatsapp/flowMessages.test.ts
// Regla del dueño (2026-10-16, especificación del bot §5): la atención de una persona es por
// correo, nunca por WhatsApp ni por teléfono (este número lo atiende solo el asistente). Ningún
// mensaje fijo del asistente ofrece seguir "por este canal", llamar o "te contactaremos" sin
// decir que es por correo, y el cierre de instalación solo promete el correo si lo tenemos.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { FALLBACK_REPLY } from './claudeAgent';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000099';

/** Todos los textos fijos que el asistente puede enviar. */
const MESSAGES: Array<[string, string]> = [
  ...Object.entries(flow).filter(([k, v]) => /^MSG/.test(k) && typeof v === 'string') as Array<[string, string]>,
  ['FALLBACK_REPLY', FALLBACK_REPLY],
];

afterEach(() => flow.clearFlowState(PHONE));

describe('solo correo: ningún mensaje ofrece seguir por WhatsApp o por teléfono', () => {
  it('hay mensajes que revisar', () => {
    expect(MESSAGES.length).toBeGreaterThan(10);
  });

  it.each(MESSAGES)('%s no ofrece este canal, llamadas ni un contacto sin decir el medio', (_name, text) => {
    expect(text).not.toMatch(/mismo canal|este canal|por whatsapp|te llam|llamada/i);
    // "te contactará" solo vale si dice que es por correo
    if (/contactar|contactaremos/i.test(text)) expect(text).toMatch(/contactar[a\u00e1]? por correo/i);
  });

  it('pedir un ejecutivo (con correo): lo atiende Claudio Quero por correo', () => {
    expect(flow.MSG_HUMAN).toContain('Te va a atender Claudio Quero directamente por correo');
  });

  it('cierre de instalación con correo: se escribe por correo', () => {
    expect(flow.MSG4_INSTALL).toContain('Te vamos a escribir por correo');
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
