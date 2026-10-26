// api/_lib/whatsapp/flowRut.test.ts
// Bot de WhatsApp, PR 6 del plan (B12), en flowEngine sin el webhook:
// - T12: un RUT válido con la razón social se guarda con formato, como empresa, y cierra.
// - T13: uno que no calza se pide de nuevo una sola vez; si llega igual, queda marcado.
// - Los dígitos de un correo, un celular o un pedido ya no son RUT ni vuelven B2B el lead
//   (prueba del dueño del 2026-10-26: el correo de prueba dejó "RUT empresa: <dígitos>").
// - Un RUT de persona no vuelve B2B el lead; uno válido no se reemplaza.
// Solo RUT inventados con dígito válido (módulo 11) y su versión con el dígito cambiado.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

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
