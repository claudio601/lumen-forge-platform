// api/_lib/whatsapp/flowComuna.test.ts
// Bot de WhatsApp, PR 3 del plan (B4): la comuna en el flujo.
// - §10 (T4, T5 y T11), con mensajes parecidos e inventados.
// - La comuna sale de la lista oficial, con frase de ubicación o como respuesta a la pregunta por ella;
//   nunca de un correo, una calle, una pregunta por sucursal ni de lo que Claude diga solo.
// - Con dos comunas quedan las dos: la de la instalación y "Otras comunas mencionadas".
// Cada caso corre con un Claude simulado que acierta y con otro que se equivoca.
// Solo datos inventados: correos @example.com y direcciones de prueba.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000601';
type Claude = Parameters<typeof flow.processFlowStep>[2];
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, NO_SIGNALS);

afterEach(() => flow.clearFlowState(PHONE));

describe('§10: comuna en el primer mensaje', () => {
  it.each<[string, Claude]>([
    ['acierta', { nombre: 'Andrés Prueba', correo: 'andres.prueba@example.com', producto: 'focos', proyecto_o_uso: 'patio' }],
    ['se equivoca', { nombre: 'Andrés Prueba', correo: 'andres.prueba@example.com', producto: 'focos', proyecto_o_uso: 'patio', comuna_o_ciudad: 'Santiago' }],
  ])('T4: sin comuna en el texto queda vacía y el bot la pregunta (Claude %s)', (_label, claude) => {
    const r = step('Soy Andrés Prueba, andres.prueba@example.com, quiero focos para un patio', claude);
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    const next = step('Luz cálida, son 6', { tipo_de_luz: 'calida', cantidad: '6' });
    expect(next.captured.comuna_o_ciudad).toBeUndefined();
    expect(next.reply).toMatch(/comuna/i);
  });

  it.each<[string, Claude]>([
    ['acierta', {}],
    ['se equivoca', { comuna_o_ciudad: 'Retiro' }],
  ])('T5: "Ya compré, ¿cuál es la dirección de retiro?" no deja Retiro ni da la dirección (Claude %s)', (_label, claude) => {
    const r = step('Ya compré, ¿cuál es la dirección de retiro?', claude);
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toBeUndefined();
    expect(r.reply).not.toMatch(/Quinta Normal|direcci[oó]n de (la )?bodega/i);
  });

  it.each<[string, Claude]>([
    ['acierta', { producto: 'BESTLED', cantidad: '25', comuna_o_ciudad: 'La Serena' }],
    ['se equivoca', { producto: 'BESTLED', cantidad: '25', comuna_o_ciudad: 'Serena' }],
    ['no la da', { producto: 'BESTLED', cantidad: '25' }],
  ])('T11: "…para un pasaje en La Serena" da La Serena (Claude %s)', (_label, claude) => {
    expect(step('Quiero cotizar 25 BESTLED para un pasaje en La Serena', claude).captured.comuna_o_ciudad).toBe('La Serena');
  });

  it('"Es para una bodega en Lampa" da Lampa', () => {
    expect(step('Necesito 20 focos LED luz fría. Es para una bodega en Lampa', {}).captured.comuna_o_ciudad).toBe('Lampa');
  });

  it('la comuna queda con su nombre oficial', () => {
    expect(step('Necesito 20 paneles para una oficina en nunoa', { comuna_o_ciudad: 'nunoa' }).captured.comuna_o_ciudad).toBe('Ñuñoa');
  });

  it.each<[string, Claude]>([
    ['un correo', { correo: 'santiago.prueba@example.com', comuna_o_ciudad: 'Santiago' }],
  ])('%s no da la comuna', (_label, claude) => {
    expect(step('Necesito 20 paneles, mi correo es santiago.prueba@example.com', claude).captured.comuna_o_ciudad).toBeUndefined();
  });

  it('una pregunta por sucursal no da la comuna', () => {
    expect(step('¿Tienen sucursal en Concepción?', { comuna_o_ciudad: 'Concepción' }).captured.comuna_o_ciudad).toBeUndefined();
  });

  it('la razón social no da la comuna', () => {
    const r = step('Necesito 20 paneles. Razón social Comercial Los Andes SpA', { empresa: 'Comercial Los Andes SpA', comuna_o_ciudad: 'Los Andes' });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
  });
});

describe('respuesta a la pregunta por la comuna', () => {
  // El primer mensaje trae todo menos la comuna: el bot pregunta solo la comuna.
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina' };

  it('el bot pregunta la comuna', () => {
    const r = step(FIRST, FIRST_CLAUDE);
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.reply).toMatch(/comuna/i);
  });

  it.each([
    ['Lampa', 'Lampa'],
    ['Santiago', 'Santiago'],
    ['santiago', 'Santiago'],
    ['Soy de Maipú', 'Maipú'],
    ['Maipú, Región Metropolitana', 'Maipú'],
    ['Av. Santiago Bueras 1234, Lampa', 'Lampa'],
    ['En la comuna de Pudahuel', 'Pudahuel'],
  ])('"%s" da %s', (answer, comuna) => {
    step(FIRST, FIRST_CLAUDE);
    expect(step(answer, {}).captured.comuna_o_ciudad).toBe(comuna);
  });

  it.each([
    ['santiago.prueba@example.com', { correo: 'santiago.prueba@example.com', comuna_o_ciudad: 'Santiago' }],
    ['Av. Santiago Bueras 1234', { comuna_o_ciudad: 'Santiago' }],
    ['no sé', { comuna_o_ciudad: 'Santiago' }],
  ])('"%s" no da Santiago', (answer, claude) => {
    step(FIRST, FIRST_CLAUDE);
    expect(step(answer, claude).captured.comuna_o_ciudad).toBeUndefined();
  });

  it('sin la pregunta, la comuna sola no cuenta', () => {
    const r = step('Necesito 20 paneles LED luz fría. Lampa', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', comuna_o_ciudad: 'Lampa' });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
  });
});

describe('dos comunas', () => {
  it.each<[string, Claude, string, string[]]>([
    ['acierta', { comuna_o_ciudad: 'Lampa' }, 'Lampa', ['Viña del Mar']],
    ['no la da', {}, 'Lampa', ['Viña del Mar']],
    ['elige la de la factura', { comuna_o_ciudad: 'Viña del Mar' }, 'Lampa', ['Viña del Mar']],
  ])('la obra en Lampa y la facturación en Viña del Mar: quedan las dos (Claude %s)', (_label, claude, comuna, otras) => {
    const r = step('Necesito 20 focos. La obra es en Lampa y la facturación en Viña del Mar', claude);
    expect(r.captured.comuna_o_ciudad).toBe(comuna);
    expect(r.captured.comunas_otras).toEqual(otras);
  });

  it('dos lugares de obra: la que eligió Claude y la otra', () => {
    const r = step('Necesito focos para una bodega en Lampa y otra en Colina', { comuna_o_ciudad: 'Colina' });
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.comunas_otras).toEqual(['Lampa']);
  });

  it('la facturación en otra comuna después no cambia la comuna capturada', () => {
    step('Necesito 20 paneles LED luz fría para una oficina en Lampa', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' });
    const r = step('La factura sale a nombre de la empresa de Las Condes', { comuna_o_ciudad: 'Las Condes' });
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Las Condes']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it('una comuna nueva que el cliente afirma cambia la capturada y queda anotada', () => {
    step('Necesito 20 paneles LED luz fría para una oficina en Lampa', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' });
    const r = step('Perdón, es en Colina', { comuna_o_ciudad: 'Colina' });
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Lampa, ahora Colina']);
  });
});

describe('instalación', () => {
  it('la comuna de la instalación sigue las mismas reglas', () => {
    const r = step('Busco un instalador para una casa, mi correo es santiago.prueba@example.com', { correo: 'santiago.prueba@example.com', comuna_o_ciudad: 'Santiago' });
    expect(r.captured.install_comuna).toBeUndefined();
    const next = step('Lampa', { comuna_o_ciudad: 'Lampa' });
    expect(next.captured.install_comuna).toBe('Lampa');
  });
});
