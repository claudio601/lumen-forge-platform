// api/_lib/whatsapp/flowClosures.test.ts
// Bot de WhatsApp, PR 1 (cierres honestos), en flowEngine sin el webhook:
// - Textos A y B aprobados por el dueño (2026-10-16), tal cual.
// - El atajo de "pidió ejecutivo" pide el correo una vez y sigue en su etapa (antes: stage3 y el
//   mismo pedido en cada mensaje).
// - Un cierre sin correo responde el texto A y no crea negocio; nunca "quedó registrada" ni
//   "ya derivé" sin negocio.
// - En la conversación cerrada, "quedó registrada" solo si webhook.ts anotó que Pipedrive creó el
//   negocio (recordDealOutcome); "ya derivé" no se repite; el correo tardío registra una vez.
// - Un correo de eLIGHTS (ventas@, claudio@) nunca es el correo del cliente.
// - El resultado de Pipedrive se anota solo en la conversación que pidió el negocio; sin
//   resultado (el intento se cortó), un mensaje nuevo reintenta el registro.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const HUMAN = { wantsHuman: true, qualifiesForDeal: false };
const PHONE = '+56900000301';
const REGISTRADA = /qued[oó] registrad[oa]/i;

afterEach(() => flow.clearFlowState(PHONE));

describe('textos aprobados', () => {
  it('A: pedir el correo', () => {
    expect(flow.MSG_NEED_EMAIL).toBe('Para que Claudio Quero te atienda por correo, necesito tu correo. ¿Me lo escribes por aquí? Si prefieres, envía tu solicitud a ventas@elights.cl.');
  });

  it('B: Pipedrive no registró la solicitud', () => {
    expect(flow.MSG_DEAL_FAILED).toBe('No pude registrar tu solicitud por un problema técnico. Por favor, envíala a ventas@elights.cl y Claudio Quero te responde por correo.');
  });
});

describe('atajo de "pidió ejecutivo" sin correo', () => {
  it('pide el correo una vez y no salta a la etapa 3', () => {
    const first = flow.processFlowStep(PHONE, 'Quiero hablar con un vendedor', { wantsHuman: true }, HUMAN);
    expect(first.reply).toBe(flow.MSG_NEED_EMAIL_AND_CONTEXT);
    expect(first.shouldCreateDeal).toBe(false);
    expect(flow.getFlowState(PHONE).stage).toBe('stage1');

    const second = flow.processFlowStep(PHONE, 'paneles LED para una oficina', { producto: 'paneles LED', proyecto_o_uso: 'oficina' }, NO_SIGNALS);
    expect(second.reply).not.toBe(first.reply);
    expect(second.reply).not.toBe(flow.MSG_NEED_EMAIL);
    expect(second.reply).toMatch(/tipo de luz/i);
  });

  it('con contexto pide el correo con el texto A', () => {
    const r = flow.processFlowStep(PHONE, 'quiero hablar con un vendedor por unos paneles LED', { producto: 'paneles LED', wantsHuman: true }, HUMAN);
    expect(r.reply).toBe(flow.MSG_NEED_EMAIL);
  });

  it('con correo deriva ("ya derivé") y pide crear el negocio', () => {
    const r = flow.processFlowStep(PHONE, 'Quiero hablar con un vendedor, mi correo es ana.prueba@example.com', { wantsHuman: true }, HUMAN);
    expect(r.reply).toBe(flow.MSG_HUMAN);
    expect(r.shouldCreateDeal).toBe(true);
    expect(r.captured.correo).toBe('ana.prueba@example.com');
  });
});

describe('cierres sin correo', () => {
  it('ningún cierre sin negocio dice "quedó registrada" ni "ya derivé"', () => {
    const conversations: Array<Array<[string, Record<string, unknown>]>> = [
      [['Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }], ['fría', {}], ['no sé', {}], ['no sé', {}]],
      [['Hola, quiero iluminar mi terraza', { proyecto_o_uso: 'terraza' }], ['no sé', {}], ['no sé', {}]],
      [['Necesito hablar con un ejecutivo, busco focos', { producto: 'focos', wantsHuman: true }], ['necesito 20', { cantidad: '20' }], ['mmm', {}], ['mmm', {}], ['mmm', {}]],
    ];
    for (const turns of conversations) {
      flow.clearFlowState(PHONE);
      for (const [body, parsed] of turns) {
        const r = flow.processFlowStep(PHONE, body, parsed, NO_SIGNALS);
        if (!r.shouldCreateDeal) {
          expect(r.reply).not.toMatch(REGISTRADA);
          expect(r.reply).not.toBe(flow.MSG_HUMAN);
        }
      }
      expect(flow.getFlowState(PHONE).stage).toBe('closed');
    }
  });

  it('el cierre sin correo es el texto A, y antes se pidió el correo', () => {
    const replies = [
      flow.processFlowStep(PHONE, 'Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }, NO_SIGNALS),
      flow.processFlowStep(PHONE, 'fría', { tipo_de_luz: 'fría' }, NO_SIGNALS),
      flow.processFlowStep(PHONE, 'todavía no sé dónde', {}, NO_SIGNALS),
      flow.processFlowStep(PHONE, 'no sé', {}, NO_SIGNALS),
    ];
    expect(replies[2].reply).toMatch(/correo de contacto/);
    expect(replies[2].closedFlow).toBe(false);
    expect(replies[3]).toMatchObject({ reply: flow.MSG_NEED_EMAIL, shouldCreateDeal: false, closedFlow: true });
  });

  it('con correo y sin producto ni proyecto, el cierre registra la solicitud (antes: "quedó registrada" sin negocio)', () => {
    flow.processFlowStep(PHONE, 'hola, una consulta', {}, NO_SIGNALS);
    flow.processFlowStep(PHONE, 'no sé', {}, NO_SIGNALS);
    const r = flow.processFlowStep(PHONE, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' }, NO_SIGNALS);
    expect(r.closedFlow).toBe(true);
    expect(r.shouldCreateDeal).toBe(true);
  });
});

describe('conversación cerrada', () => {
  function closeWithoutEmail() {
    flow.processFlowStep(PHONE, 'Hola, busco focos LED para un patio', { producto: 'focos LED', proyecto_o_uso: 'patio' }, NO_SIGNALS);
    flow.processFlowStep(PHONE, 'fría', { tipo_de_luz: 'fría' }, NO_SIGNALS);
    flow.processFlowStep(PHONE, 'todavía no sé dónde', {}, NO_SIGNALS);
    const closing = flow.processFlowStep(PHONE, 'no sé', {}, NO_SIGNALS);
    expect(closing.closedFlow).toBe(true);
  }

  it('sin correo pide el correo (texto A) y no crea negocio', () => {
    closeWithoutEmail();
    const r = flow.processFlowStep(PHONE, 'hola?', {}, NO_SIGNALS);
    expect(r).toMatchObject({ reply: flow.MSG_NEED_EMAIL, shouldCreateDeal: false });
  });

  it('el correo tardío registra la solicitud una sola vez', () => {
    closeWithoutEmail();
    const late = flow.processFlowStep(PHONE, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' }, NO_SIGNALS);
    expect(late).toMatchObject({ shouldCreateDeal: true, closedFlow: true });
    expect(late.captured).toMatchObject({ correo: 'ana.prueba@example.com', producto: 'focos LED', tipo_de_luz: 'fría' });
    flow.recordDealOutcome(PHONE, true);
    const again = flow.processFlowStep(PHONE, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' }, NO_SIGNALS);
    expect(again.shouldCreateDeal).toBe(false);
    expect(again.reply).toMatch(REGISTRADA);
  });

  it('el nombre y después el correo, en mensajes separados, quedan los dos', () => {
    closeWithoutEmail();
    expect(flow.processFlowStep(PHONE, 'Ana Prueba', { nombre: 'Ana Prueba' }, NO_SIGNALS).shouldCreateDeal).toBe(false);
    const late = flow.processFlowStep(PHONE, 'ana.prueba@example.com', { correo: 'ana.prueba@example.com' }, NO_SIGNALS);
    expect(late.captured).toMatchObject({ nombre_o_empresa: 'Ana Prueba', correo: 'ana.prueba@example.com' });
  });

  it('"quedó registrada" solo si Pipedrive confirmó el negocio; si no, el texto B', () => {
    const closing = flow.processFlowStep(
      PHONE,
      'Necesito 10 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com',
      { producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '10', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' },
      NO_SIGNALS,
    );
    expect(closing.shouldCreateDeal).toBe(true);
    flow.recordDealOutcome(PHONE, false);
    expect(flow.processFlowStep(PHONE, 'hola?', {}, NO_SIGNALS).reply).toBe(flow.MSG_DEAL_FAILED);
    flow.recordDealOutcome(PHONE, true);
    expect(flow.processFlowStep(PHONE, 'hola?', {}, NO_SIGNALS).reply).toBe(flow.MSG4);
  });

  it('"ya derivé" no se repite: después del cierre con negocio responde el cierre normal', () => {
    flow.processFlowStep(PHONE, 'Quiero hablar con un vendedor, mi correo es ana.prueba@example.com', { wantsHuman: true }, HUMAN);
    flow.recordDealOutcome(PHONE, true);
    const r = flow.processFlowStep(PHONE, 'gracias', {}, NO_SIGNALS);
    expect(r.reply).not.toBe(flow.MSG_HUMAN);
    expect(r.reply).toMatch(REGISTRADA);
  });

  it('instalación cerrada sin correo: el correo tardío registra con el cierre de instalación', () => {
    let r = flow.processFlowStep(PHONE, 'quiero instalar focos en mi casa', {}, NO_SIGNALS);
    for (let i = 0; i < 3 && !r.closedFlow; i++) r = flow.processFlowStep(PHONE, 'mmm', {}, NO_SIGNALS);
    expect(r.reply).toBe(flow.MSG4_INSTALL_NO_EMAIL);
    const late = flow.processFlowStep(PHONE, 'ana.prueba@example.com', {}, NO_SIGNALS);
    expect(late).toMatchObject({ reply: flow.MSG4_INSTALL, shouldCreateDeal: true });
    expect(late.captured.install_correo).toBe('ana.prueba@example.com');
  });
});

describe('correos de eLIGHTS', () => {
  it('"ventas@elights.cl" no es el correo del cliente: el atajo no deriva ni crea negocio', () => {
    flow.processFlowStep(PHONE, 'quiero hablar con un vendedor por unos paneles LED', { producto: 'paneles LED', wantsHuman: true }, HUMAN);
    const r = flow.processFlowStep(PHONE, 'prefiero escribirle a ventas@elights.cl', {}, NO_SIGNALS);
    expect(r.reply).not.toBe(flow.MSG_HUMAN);
    expect(r.shouldCreateDeal).toBe(false);
    expect(r.captured.correo).toBeUndefined();
  });

  it('tampoco si lo devuelve Claude, ni con mayúsculas ni un subdominio', () => {
    for (const correo of ['ventas@elights.cl', 'Claudio@ELIGHTS.CL', 'compras@mail.elights.cl']) {
      flow.clearFlowState(PHONE);
      const r = flow.processFlowStep(PHONE, 'Quiero hablar con un vendedor', { wantsHuman: true, correo }, HUMAN);
      expect(r.shouldCreateDeal).toBe(false);
      expect(r.captured.correo).toBeUndefined();
    }
  });

  it('con un correo de eLIGHTS y uno del cliente en el mismo mensaje, toma el del cliente', () => {
    const r = flow.processFlowStep(PHONE, 'Quiero hablar con un vendedor. Ya escribí a ventas@elights.cl, mi correo es ana.prueba@example.com', { wantsHuman: true }, HUMAN);
    expect(r.captured.correo).toBe('ana.prueba@example.com');
    expect(r.shouldCreateDeal).toBe(true);
  });
});

describe('resultado de Pipedrive y la conversación', () => {
  const FULL = 'Necesito 10 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
  const FULL_PARSED = { producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '10', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };

  it('con correo y sin resultado de Pipedrive no dice "problema técnico": reintenta con el cierre normal', () => {
    expect(flow.processFlowStep(PHONE, FULL, FULL_PARSED, NO_SIGNALS).shouldCreateDeal).toBe(true);
    // Nadie anotó el resultado (el intento se cortó): el mensaje siguiente reintenta.
    const r = flow.processFlowStep(PHONE, 'hola?', {}, NO_SIGNALS);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(r.reply).not.toBe(flow.MSG_DEAL_FAILED);
  });

  it('el reintento nunca repite "ya derivé"', () => {
    expect(flow.processFlowStep(PHONE, 'Quiero hablar con un vendedor, mi correo es ana.prueba@example.com', { wantsHuman: true }, HUMAN).reply).toBe(flow.MSG_HUMAN);
    const r = flow.processFlowStep(PHONE, 'gracias', {}, NO_SIGNALS);
    expect(r.shouldCreateDeal).toBe(true);
    expect(r.reply).not.toBe(flow.MSG_HUMAN);
  });

  it('el resultado de un negocio no se anota en un pedido nuevo que empezó mientras tanto', () => {
    flow.processFlowStep(PHONE, FULL, FULL_PARSED, NO_SIGNALS);
    const conversationId = flow.getFlowState(PHONE).firstMessageAt;
    flow.recordDealOutcome(PHONE, true, conversationId);
    flow.processFlowStep(PHONE, 'necesito tambien 5 paneles LED', { producto: 'paneles LED', cantidad: '5' }, NO_SIGNALS);
    expect(flow.getFlowState(PHONE).deal).toBeUndefined();
    // Llega tarde el resultado de un intento de la conversación anterior: no va a la nueva.
    const before = flow.getFlowState(PHONE);
    flow.recordDealOutcome(PHONE, true, before.firstMessageAt - 1);
    expect(flow.getFlowState(PHONE).deal).toBeUndefined();
    flow.recordDealOutcome(PHONE, false, before.firstMessageAt);
    expect(flow.getFlowState(PHONE).deal).toBe('failed');
  });
});

describe('instalación después del flujo de productos', () => {
  it('usa el correo y el nombre que ya dio: no los vuelve a pedir', () => {
    flow.processFlowStep(PHONE, 'Hola, busco focos', { producto: 'focos', nombre: 'Luis Prueba', correo: 'luis.prueba@example.com' }, NO_SIGNALS);
    const r = flow.processFlowStep(PHONE, 'en realidad quiero instalar focos en mi casa', { proyecto_o_uso: 'casa' }, NO_SIGNALS);
    expect(r.captured).toMatchObject({ install_correo: 'luis.prueba@example.com', install_nombre: 'Luis Prueba' });
    expect(r.reply).not.toMatch(/correo|nombre/i);
    const close = flow.processFlowStep(PHONE, 'Maipú', { comuna_o_ciudad: 'Maipú' }, NO_SIGNALS);
    expect(close).toMatchObject({ reply: flow.MSG4_INSTALL, shouldCreateDeal: true });
  });
});

describe('looksLikePersonName', () => {
  it('acepta nombres de persona', () => {
    for (const n of ['Ana Prueba', 'Luis Prueba Sim', 'Ana de la Fuente', 'José Pérez', 'María Ñúñez']) expect(flow.looksLikePersonName(n)).toBe(true);
  });

  it('rechaza lo que la regla de instalación saca por error', () => {
    for (const n of ['de Maipu', 'instalador electrico', 'Las Condes', 'Puente Alto', 'Maipú', 'Ana', 'Comercial Prueba SpA', '', undefined, { nombre: 'Ana Prueba' }]) {
      expect(flow.looksLikePersonName(n)).toBe(false);
    }
  });
});
