// api/_lib/whatsapp/flowRut.test.ts
// Bot de WhatsApp, PR 6 del plan (B12), en flowEngine sin el webhook:
// - T12: un RUT válido con la razón social se guarda con formato, como empresa, y cierra.
// - T13: uno que no calza se pide de nuevo una sola vez; si llega igual, queda marcado.
// - Los dígitos de un correo, un celular o un pedido ya no son RUT ni vuelven B2B el lead
//   (prueba del dueño del 2026-10-26: el correo de prueba dejó "RUT empresa: <dígitos>").
// - Un RUT de persona no vuelve B2B el lead; uno válido no se reemplaza (salvo el de persona por
//   el de empresa).
// - Revisión de la #121: un rango de montos o el ID de una licitación no provocan la repregunta;
//   el número solo vale únicamente en el mensaje que contesta la pregunta por el RUT; copiar el
//   ejemplo de la repregunta no cambia nada; el RUT corregido que llega después del cierre se
//   suma al negocio registrado.
// Solo RUT inventados con dígito válido (módulo 11) y su versión con el dígito cambiado.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { RUT_EXAMPLE } from './rutCapture';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000401';
const CORREO = 'compras@comercial-prueba.example.com';

// Lo que Claude extrae de un pedido de empresa completo, sin el RUT (el RUT lo reconoce el código).
const B2B_CLAUDE = {
  producto: 'paneles LED 60x60', tipo_de_luz: 'fría', cantidad: '30', proyecto_o_uso: 'oficina',
  comuna_o_ciudad: 'Providencia', empresa: 'Comercial Prueba SpA', correo: CORREO,
};
const b2b = (rut: string) =>
  `Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia. Comercial Prueba SpA, RUT ${rut}, ${CORREO}`;

const B2C_CLAUDE = {
  producto: 'ampolletas LED', tipo_de_luz: 'cálida', cantidad: '10', proyecto_o_uso: 'casa',
  comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba',
};

afterEach(() => flow.clearFlowState(PHONE));

describe('texto aprobado', () => {
  it('repregunta del RUT (OK del dueño, 2026-10-26), tal cual', () => {
    expect(flow.MSG_RUT_INVALID).toBe('El RUT que me enviaste no calza con su dígito verificador. ¿Me lo escribes de nuevo, con guion y dígito verificador? Por ejemplo: 12.345.678-5.');
  });
});

describe('T12: RUT válido', () => {
  it('se guarda con formato y como empresa, el lead es B2B y cierra registrando', () => {
    const r = flow.processFlowStep(PHONE, b2b('77123456-9'), B2B_CLAUDE, NO_SIGNALS);
    expect(r.captured).toMatchObject({ rut: '77.123.456-9', rut_valido: true, rut_tipo: 'empresa' });
    expect(r.reply).toBe(flow.MSG4_B2B);
    expect(r.shouldCreateDeal).toBe(true);
    expect(r.captureStatus).toBe('complete');
  });
});

describe('T13: RUT que no calza', () => {
  it('se pide de nuevo una vez, sin crear el negocio; corregido, cierra con el válido', () => {
    const first = flow.processFlowStep(PHONE, b2b('77.123.456-8'), B2B_CLAUDE, NO_SIGNALS);
    expect(first.reply).toBe(flow.MSG_RUT_INVALID);
    expect(first.shouldCreateDeal).toBe(false);
    expect(first.closedFlow).toBe(false);

    const fixed = flow.processFlowStep(PHONE, 'perdón, es 77.123.456-9', {}, NO_SIGNALS);
    expect(fixed.captured).toMatchObject({ rut: '77.123.456-9', rut_valido: true, rut_tipo: 'empresa' });
    expect(fixed.reply).toBe(flow.MSG4_B2B);
    expect(fixed.shouldCreateDeal).toBe(true);
  });

  it('la respuesta a la repregunta vale aunque sea el número solo', () => {
    flow.processFlowStep(PHONE, b2b('77.123.456-8'), B2B_CLAUDE, NO_SIGNALS);
    const fixed = flow.processFlowStep(PHONE, '771234569', {}, NO_SIGNALS);
    expect(fixed.captured.rut).toBe('77.123.456-9');
    expect(fixed.shouldCreateDeal).toBe(true);
  });

  it('si llega otra vez sin calzar, no se pide una tercera: queda marcado como inválido y registra', () => {
    flow.processFlowStep(PHONE, b2b('77.123.456-8'), B2B_CLAUDE, NO_SIGNALS);
    const again = flow.processFlowStep(PHONE, '77.123.456-7', {}, NO_SIGNALS);
    expect(again.reply).not.toBe(flow.MSG_RUT_INVALID);
    expect(again.captured).toMatchObject({ rut: '77.123.456-7', rut_valido: false });
    expect(again.captured.rut_tipo).toBeUndefined();
    expect(again.shouldCreateDeal).toBe(true);
    expect(again.captureStatus).toBe('partial');
  });
});

describe('no es un RUT', () => {
  it('prueba del dueño (2026-10-26): los dígitos del correo no son RUT ni vuelven B2B el pedido', () => {
    const r = flow.processFlowStep(
      PHONE,
      'Hola, necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba.20261026@example.com',
      { ...B2C_CLAUDE, correo: 'ana.prueba.20261026@example.com' },
      NO_SIGNALS,
    );
    expect(r.captured.rut).toBeUndefined();
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
    expect(r.reply).toBe(flow.MSG4);
  });

  it('un celular en el mensaje no es RUT', () => {
    const r = flow.processFlowStep(
      PHONE,
      'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com, mi celular 900017774',
      { ...B2C_CLAUDE, correo: 'ana.prueba@example.com' },
      NO_SIGNALS,
    );
    expect(r.captured.rut).toBeUndefined();
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
  });
});

describe('RUT de persona', () => {
  it('se guarda como persona y el pedido sigue siendo B2C', () => {
    const r = flow.processFlowStep(
      PHONE,
      'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Ana Prueba, RUT 11.111.111-1, ana.prueba@example.com',
      { ...B2C_CLAUDE, correo: 'ana.prueba@example.com' },
      NO_SIGNALS,
    );
    expect(r.captured).toMatchObject({ rut: '11.111.111-1', rut_valido: true, rut_tipo: 'persona' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
    expect(r.reply).toBe(flow.MSG4);
  });
});

describe('cuando el bot pide el RUT', () => {
  const SIN_RUT = 'Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia, somos Comercial Prueba SpA';
  const { correo: _correo, ...SIN_CORREO } = B2B_CLAUDE;

  it('el número solo, junto al correo, se toma como RUT', () => {
    const ask = flow.processFlowStep(PHONE, SIN_RUT, SIN_CORREO, NO_SIGNALS);
    expect(ask.reply).toBe(flow.MSG3_B2B);
    const r = flow.processFlowStep(PHONE, '771234569 ' + CORREO, { correo: CORREO }, NO_SIGNALS);
    expect(r.captured).toMatchObject({ rut: '77.123.456-9', rut_valido: true });
    expect(r.shouldCreateDeal).toBe(true);
  });

  it('un RUT válido no se reemplaza por otro que llegue después', () => {
    const first = flow.processFlowStep(PHONE, SIN_RUT + ', RUT 77.123.456-9', SIN_CORREO, NO_SIGNALS);
    expect(first.captured.rut).toBe('77.123.456-9');
    const r = flow.processFlowStep(PHONE, 'RUT 61.234.567-8, ' + CORREO, { correo: CORREO }, NO_SIGNALS);
    expect(r.captured.rut).toBe('77.123.456-9');
    expect(r.captured.rut_tipo).toBe('empresa');
  });
});

describe('rangos de montos e ID de licitación (revisión de la #121)', () => {
  it('un pedido de casa con un rango de presupuesto no recibe la repregunta del RUT y sigue B2C', () => {
    const r = flow.processFlowStep(
      PHONE,
      'Hola, necesito 10 ampolletas LED luz cálida para mi casa en Maipú, tengo entre 1.000.000-2.000.000 de presupuesto',
      B2C_CLAUDE,
      NO_SIGNALS,
    );
    expect(r.reply).not.toBe(flow.MSG_RUT_INVALID);
    expect(r.captured.rut).toBeUndefined();
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
  });

  it('una licitación con su ID no recibe la repregunta: el bot pide el RUT de la empresa', () => {
    const { correo: _correo, ...sinCorreo } = B2B_CLAUDE;
    const r = flow.processFlowStep(
      PHONE,
      'Cotización para la licitación ID 1057501-9-LE24: 30 paneles LED 60x60 luz fría para una oficina en Providencia',
      sinCorreo,
      NO_SIGNALS,
    );
    expect(r.reply).toBe(flow.MSG3_B2B);
    expect(r.captured.rut).toBeUndefined();
  });

  it('con la palabra "RUT" y un rango en el mismo mensaje: guarda el RUT y cierra', () => {
    const r = flow.processFlowStep(
      PHONE,
      `Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia. Comercial Prueba SpA, RUT 77 123 456 9, presupuesto 1.000.000-2.000.000, ${CORREO}`,
      B2B_CLAUDE,
      NO_SIGNALS,
    );
    expect(r.captured).toMatchObject({ rut: '77.123.456-9', rut_valido: true, rut_tipo: 'empresa' });
    expect(r.reply).toBe(flow.MSG4_B2B);
  });
});

describe('el número solo vale únicamente al contestar la pregunta por el RUT', () => {
  const SIN_RUT = 'Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia, somos Comercial Prueba SpA';
  const { correo: _correo, ...SIN_CORREO } = B2B_CLAUDE;

  it('al contestar: el cuerpo con puntos sin dígito verificador no se lee como otro RUT', () => {
    expect(flow.processFlowStep(PHONE, SIN_RUT, SIN_CORREO, NO_SIGNALS).reply).toBe(flow.MSG3_B2B);
    const r = flow.processFlowStep(PHONE, 'el rut es 76.543.216, ' + CORREO, { correo: CORREO }, NO_SIGNALS);
    expect(r.captured.rut).toBeUndefined();
    expect(r.captureStatus).not.toBe('complete');
  });

  it('al contestar: el celular que acompaña al correo no es el RUT', () => {
    flow.processFlowStep(PHONE, SIN_RUT, SIN_CORREO, NO_SIGNALS);
    const r = flow.processFlowStep(PHONE, 'mi correo es ' + CORREO + ' y mi celular 900017774', { correo: CORREO }, NO_SIGNALS);
    expect(r.captured.rut).toBeUndefined();
    expect(r.reply).not.toBe(flow.MSG_RUT_INVALID);
  });

  it('después de la repregunta, un celular que llega más tarde no reemplaza el RUT', () => {
    const first = flow.processFlowStep(PHONE, SIN_RUT + ', RUT 77.123.456-8', SIN_CORREO, NO_SIGNALS);
    expect(first.reply).toBe(flow.MSG_RUT_INVALID);
    const again = flow.processFlowStep(PHONE, '77.123.456-7', {}, NO_SIGNALS);
    expect(again.reply).toBe('Para registrar tu solicitud necesito tu correo de contacto.');
    const r = flow.processFlowStep(PHONE, 'mi correo es ' + CORREO + ' y mi celular 923456783', { correo: CORREO }, NO_SIGNALS);
    expect(r.captured).toMatchObject({ rut: '77.123.456-7', rut_valido: false });
    expect(r.reply).toBe(flow.MSG4_B2B);
  });
});

describe('RUT de persona y después el de la empresa', () => {
  const CASA = 'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Ana Prueba, RUT 11.111.111-1';

  it('el de empresa reemplaza al de persona y el pedido pasa a B2B', () => {
    flow.processFlowStep(PHONE, CASA, B2C_CLAUDE, NO_SIGNALS);
    const r = flow.processFlowStep(PHONE, 'Mejor factura a mi empresa, RUT 77.123.456-9, ana.prueba@example.com', { correo: 'ana.prueba@example.com' }, NO_SIGNALS);
    expect(r.captured).toMatchObject({ rut: '77.123.456-9', rut_valido: true, rut_tipo: 'empresa' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
    expect(r.reply).toBe(flow.MSG4_B2B);
  });

  it('otro de persona, o uno que no calza, no lo reemplaza (y no provoca la repregunta)', () => {
    flow.processFlowStep(PHONE, CASA, B2C_CLAUDE, NO_SIGNALS);
    const r = flow.processFlowStep(PHONE, 'o el RUT 21.111.111-9, o 77.123.456-8', {}, NO_SIGNALS);
    expect(r.captured).toMatchObject({ rut: '11.111.111-1', rut_valido: true, rut_tipo: 'persona' });
    expect(r.reply).not.toBe(flow.MSG_RUT_INVALID);
  });
});

describe('el ejemplo de la repregunta', () => {
  it('es el que la repregunta muestra', () => {
    expect(flow.MSG_RUT_INVALID).toContain(RUT_EXAMPLE);
  });

  it('si el cliente lo copia, no queda como su RUT', () => {
    flow.processFlowStep(PHONE, b2b('77.123.456-8'), B2B_CLAUDE, NO_SIGNALS);
    const r = flow.processFlowStep(PHONE, 'Por ejemplo: ' + RUT_EXAMPLE, {}, NO_SIGNALS);
    expect(r.captured).toMatchObject({ rut: '77.123.456-8', rut_valido: false });
  });
});

describe('el nombre «Rut» con su celular', () => {
  it('no es un RUT y el pedido de casa sigue B2C', () => {
    const r = flow.processFlowStep(PHONE, 'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Saludos,\nRut\n9 8765 4325', B2C_CLAUDE, NO_SIGNALS);
    expect(r.captured.rut).toBeUndefined();
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
  });
});

describe('RUT que llega después del cierre (revisión de la #121)', () => {
  /** Repregunta, "déjame revisarlo" (cierra con el RUT inválido) y Pipedrive registra el negocio. */
  function closedWithInvalidRut() {
    expect(flow.processFlowStep(PHONE, b2b('77.123.456-8'), B2B_CLAUDE, NO_SIGNALS).reply).toBe(flow.MSG_RUT_INVALID);
    const closed = flow.processFlowStep(PHONE, 'déjame revisarlo y te lo mando', {}, NO_SIGNALS);
    expect(closed).toMatchObject({ reply: flow.MSG4_B2B, shouldCreateDeal: true, closedFlow: true });
    expect(closed.captured).toMatchObject({ rut: '77.123.456-8', rut_valido: false });
    expect(closed.rutUpdate).toBeUndefined();
  }

  it('el corregido se suma al negocio registrado: pide actualizarlo, con la misma respuesta de la conversación cerrada', () => {
    closedWithInvalidRut();
    flow.recordDealOutcome(PHONE, true);
    const r = flow.processFlowStep(PHONE, 'el RUT correcto es 77.123.456-9', {}, NO_SIGNALS);
    expect(r).toMatchObject({ reply: flow.MSG4_B2B, shouldCreateDeal: true, closedFlow: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ rut: '77.123.456-9', rut_valido: true, rut_tipo: 'empresa' });
    expect(r.captureStatus).toBe('complete');

    const thanks = flow.processFlowStep(PHONE, 'gracias', {}, NO_SIGNALS);
    expect(thanks).toMatchObject({ reply: flow.MSG4_B2B, shouldCreateDeal: false });
    expect(thanks.rutUpdate).toBeUndefined();
  });

  it('uno que tampoco calza, o el número solo (sin guion ni "RUT"), no cambia nada', () => {
    closedWithInvalidRut();
    flow.processFlowStep(PHONE, 'gracias', {}, NO_SIGNALS);
    flow.recordDealOutcome(PHONE, true);
    for (const body of ['77.123.456-7', '771234569']) {
      const r = flow.processFlowStep(PHONE, body, {}, NO_SIGNALS);
      expect(r.shouldCreateDeal).toBe(false);
      expect(r.captured.rut).toBe('77.123.456-8');
    }
  });

  it('si Pipedrive no registró el negocio, no se intenta actualizar', () => {
    closedWithInvalidRut();
    flow.recordDealOutcome(PHONE, false);
    const r = flow.processFlowStep(PHONE, 'el RUT correcto es 77.123.456-9', {}, NO_SIGNALS);
    expect(r).toMatchObject({ reply: flow.MSG_DEAL_FAILED, shouldCreateDeal: false });
  });

  it('con un RUT válido de empresa ya registrado, otro RUT no lo cambia', () => {
    flow.processFlowStep(PHONE, b2b('77123456-9'), B2B_CLAUDE, NO_SIGNALS);
    flow.recordDealOutcome(PHONE, true);
    const r = flow.processFlowStep(PHONE, 'RUT 61.234.567-8', {}, NO_SIGNALS);
    expect(r.shouldCreateDeal).toBe(false);
    expect(r.captured.rut).toBe('77.123.456-9');
  });

  it('un pedido de casa registrado sin RUT: el RUT de persona que llega después también se suma', () => {
    const r0 = flow.processFlowStep(
      PHONE,
      'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com',
      { ...B2C_CLAUDE, correo: 'ana.prueba@example.com' },
      NO_SIGNALS,
    );
    expect(r0.reply).toBe(flow.MSG4);
    flow.recordDealOutcome(PHONE, true);
    const r = flow.processFlowStep(PHONE, 'mi RUT es 11.111.111-1', {}, NO_SIGNALS);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ rut: '11.111.111-1', rut_tipo: 'persona' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
  });
});
