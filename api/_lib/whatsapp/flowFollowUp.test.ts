// api/_lib/whatsapp/flowFollowUp.test.ts
// Bot de WhatsApp (2026-11-11, prueba del dueño en producción):
// - [CORREO-PROPIO] Un correo @elights.cl que el bot no publica (gerencia@) nunca es el del cliente, y el bot
//   dice por qué en vez de repetir el texto A. Los que publica (ventas@, claudio@, constanza@) siguen igual.
// - [PLAZO] Con el negocio registrado, "¿qué hago ahora?" o "¿cuánto demora?" reciben el plazo aprobado por el
//   dueño ("el mismo día hábil") y cualquier otro mensaje, un recordatorio corto, no el cierre largo otra vez.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const HUMAN = { wantsHuman: true, qualifiesForDeal: false };
const PHONE = '+56900000777';
const step = (body: string, claude: Record<string, unknown> = {}, signals = NO_SIGNALS) => flow.processFlowStep(PHONE, body, claude, signals);

afterEach(() => flow.clearFlowState(PHONE));

describe('textos aprobados por el dueño (2026-11-11)', () => {
  it('tal cual', () => {
    expect(flow.MSG_OWN_EMAIL).toBe('Ese correo es de eLIGHTS. Para registrar tu solicitud necesito tu propio correo, de tu empresa o personal. ¿Me lo escribes por aquí? Si prefieres, envía tu solicitud a ventas@elights.cl.');
    expect(flow.MSG_WAIT).toBe('No tienes que hacer nada más. Te enviaremos la cotización por correo el mismo día hábil.');
    expect(flow.MSG_REGISTERED_SHORT).toMatch(/qued[oó] registrada/);
  });
});

describe('correo de eLIGHTS', () => {
  it('la conversación de la prueba: gerencia@ explica por qué no sirve y no crea negocio', () => {
    step('necesito cotizar PROYECTOR LED ANTIVANDÁLICO 100W IP66 10 unidad. luz fria', { producto: 'proyector LED antivandálico 100W IP66', cantidad: '10', tipo_de_luz: 'fría' });
    for (const body of ['gerencia@elights.cl', 'aca esta correo gerencia@elights.cl']) {
      const r = step(body, { correo: 'gerencia@elights.cl' });
      expect(r.shouldCreateDeal).toBe(false);
      expect(r.captured.correo).toBeUndefined();
      expect(r.reply.startsWith('Ese correo es de eLIGHTS')).toBe(true);
    }
  });

  it('con el pedido de ejecutivo, el texto A cambia por MSG_OWN_EMAIL', () => {
    const r = step('Quiero hablar con un vendedor, mi correo es gerencia@elights.cl', { wantsHuman: true, correo: 'gerencia@elights.cl' }, HUMAN);
    expect(r).toMatchObject({ reply: flow.MSG_OWN_EMAIL, shouldCreateDeal: false });
  });

  it('los correos que publica el bot no cambian nada: "le escribo a ventas@elights.cl"', () => {
    const r = step('prefiero escribirle a ventas@elights.cl', {}, HUMAN);
    expect(r.reply).not.toMatch(/Ese correo es de eLIGHTS/);
  });

  it('con un correo del cliente en el mismo mensaje, registra con ese correo', () => {
    const r = step('Quiero hablar con un vendedor. Copien a gerencia@elights.cl, mi correo es ana.prueba@example.com', { wantsHuman: true }, HUMAN);
    expect(r.shouldCreateDeal).toBe(true);
    expect(r.captured.correo).toBe('ana.prueba@example.com');
    expect(r.reply).not.toMatch(/Ese correo es de eLIGHTS/);
  });
});

describe('después del cierre con el negocio registrado', () => {
  function closeRegistered() {
    const r = step('Quiero hablar con un vendedor, mi correo es ana.prueba@example.com', { wantsHuman: true }, HUMAN);
    expect(r).toMatchObject({ reply: flow.MSG_HUMAN, shouldCreateDeal: true });
    flow.recordDealOutcome(PHONE, true);
  }

  it.each([
    'que hace ahora? tiene que espera?',
    'cuantos tempo demora respuesta?',
    '¿Cuánto demoran en responder?',
    '¿Cuándo me llega la cotización?',
    'y ahora qué?',
    '¿Tengo que esperar?',
    '¿Cuánto tarda la respuesta?',
  ])('"%s" recibe el plazo', (body) => {
    closeRegistered();
    expect(step(body)).toMatchObject({ reply: flow.MSG_WAIT, shouldCreateDeal: false, closedFlow: true });
  });

  it.each(['¿Cuándo llega el despacho?', '¿Hacen envío a Rancagua?', '¿Cuándo me entregan?', 'puedo retirar en bodega?', '¿cuándo llega el pedido?'])('"%s" (despacho o retiro) no recibe la promesa de la cotización', (body) => {
    closeRegistered();
    expect(step(body)).toMatchObject({ reply: flow.MSG_WAIT_DELIVERY, shouldCreateDeal: false, closedFlow: true });
  });

  it.each(['gracias', 'Buenas tardes', 'ok', 'perfecto, muchas gracias'])('"%s" recibe el recordatorio corto', (body) => {
    closeRegistered();
    expect(step(body)).toMatchObject({ reply: flow.MSG_REGISTERED_SHORT, shouldCreateDeal: false, closedFlow: true });
  });

  it('el cierre largo no se repite en mensajes seguidos', () => {
    closeRegistered();
    const a = step('que hace ahora? tiene que espera?');
    const b = step('cuantos tempo demora respuesta?');
    expect(a.reply).toBe(flow.MSG_WAIT);
    expect(b.reply).toBe(flow.MSG_WAIT);
    expect(b.reply).not.toBe(flow.MSG4_B2B);
  });

  it('sin el negocio confirmado no promete plazo: texto B si Pipedrive falló', () => {
    step('Quiero hablar con un vendedor, mi correo es ana.prueba@example.com', { wantsHuman: true }, HUMAN);
    flow.recordDealOutcome(PHONE, false);
    expect(step('¿cuánto demora?').reply).toBe(flow.MSG_DEAL_FAILED);
  });
});
