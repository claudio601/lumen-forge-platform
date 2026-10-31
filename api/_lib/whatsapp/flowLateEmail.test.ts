// api/_lib/whatsapp/flowLateEmail.test.ts
// Bot de WhatsApp, PR 3 del plan (B1): el correo que llega después del cierre registrado (H9 y H10 de la
// ronda 2 de Codex).
// - La intención de corregir el correo se detecta antes que un pedido nuevo, como la del RUT: la nota va al
//   mismo negocio (dealId) y no empieza otro flujo. Un correo negado nunca se toma; con varios correos y sin
//   una corrección clara, no cambia nada.
// - Un pedido nuevo explícito ("otro pedido", "otra cotización") empieza otro flujo y no toca el negocio anterior.
// - Lo que ya funcionaba sigue igual: el RUT tardío, el correo tardío simple, el mismo correo repetido, el que
//   Claude repite sin que el cliente lo escriba y "Perdón, me equivoqué: es …".
// Solo datos inventados: correos @example.com y RUT de prueba.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000701';
const DEAL_ID = 4242;
type Claude = Parameters<typeof flow.processFlowStep>[2];
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, NO_SIGNALS);

const FIRST = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
const FIRST_CLAUDE: Claude = { producto: 'focos LED', tipo_de_luz: 'calida', cantidad: '12', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };

/** Pedido completo, cerrado y registrado en Pipedrive con DEAL_ID. */
function registered() {
  const r = step(FIRST, FIRST_CLAUDE);
  expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, closedFlow: true });
  flow.recordDealOutcome(PHONE, true, undefined, DEAL_ID);
  expect(flow.getFlowState(PHONE)).toMatchObject({ stage: 'closed', deal: 'registered', dealId: DEAL_ID });
}

/** El correo nuevo se suma al mismo negocio: nota de corrección (rutUpdate) con el dealId guardado. */
function expectCorrection(r: ReturnType<typeof step>, email: string) {
  expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, closedFlow: true, rutUpdate: true });
  expect(r.captured.correo).toBe(email);
  expect(r.captured.cambios).toEqual(['Correo: antes ana.prueba@example.com, ahora ' + email]);
  // No empezó otro flujo: el pedido y el negocio son los mismos.
  expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '12', comuna_o_ciudad: 'Maipú' });
  expect(flow.getFlowState(PHONE)).toMatchObject({ stage: 'closed', deal: 'registered', dealId: DEAL_ID });
}

/** Nada cambia: la respuesta de la conversación cerrada, sin nota ni flujo nuevo. */
function expectUntouched(r: ReturnType<typeof step>) {
  expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false, closedFlow: true });
  expect(r.rutUpdate).toBeUndefined();
  expect(r.captured.correo).toBe('ana.prueba@example.com');
  expect(r.captured.cambios).toBeUndefined();
  expect(flow.getFlowState(PHONE)).toMatchObject({ stage: 'closed', deal: 'registered', dealId: DEAL_ID });
}

afterEach(() => flow.clearFlowState(PHONE));

describe('H9: corregir el correo después del cierre registrado', () => {
  it.each<[string, Claude]>([
    ['Mi correo no es ana.prueba@example.com, es ana.nueva@example.com', { correo: 'ana.prueba@example.com' }],
    ['Necesito corregir mi correo: ana.nueva@example.com', { correo: 'ana.nueva@example.com' }],
  ])('los dos casos de Codex: "%s" va al mismo negocio', (body, claude) => {
    registered();
    expectCorrection(step(body, claude), 'ana.nueva@example.com');
  });

  it.each([
    'Quiero cambiar mi correo a ana.nueva@example.com',
    'Necesito actualizar el correo, ahora es ana.nueva@example.com',
    'Me equivoqué de correo, es ana.nueva@example.com',
    'Necesito corregir mi correo: no es ana.prueba@example.com sino ana.nueva@example.com',
    'Quiero cambiar mi mail ana.prueba@example.com por ana.nueva@example.com',
    'No es ana.prueba@example.com, es ana.nueva@example.com',
  ])('"%s" corrige el correo', (body) => {
    registered();
    expectCorrection(step(body, {}), 'ana.nueva@example.com');
  });

  it.each([
    'No es ana.otra@example.com',
    'Mi correo no es ana.otra@example.com',
    'Necesito corregir mi correo, no es ana.otra@example.com',
  ])('un correo negado nunca se toma: "%s"', (body) => {
    registered();
    expectUntouched(step(body, { correo: 'ana.otra@example.com' }));
  });

  it.each([
    'Mi correo es ana.uno@example.com y el de mi socio es socio.prueba@example.com',
    'Pueden escribir a ana.uno@example.com o a ana.dos@example.com',
  ])('con varios correos y sin una corrección clara, no cambia nada: "%s"', (body) => {
    registered();
    expectUntouched(step(body, {}));
  });

  it('con varios correos, el que la corrección marca como el correcto gana', () => {
    registered();
    expectCorrection(step('Corrijo mi correo: ana.uno@example.com está mal, el correcto es ana.nueva@example.com', {}), 'ana.nueva@example.com');
  });

  it('"Necesito corregir mi correo" sin el correo no empieza otro flujo', () => {
    registered();
    expectUntouched(step('Necesito corregir mi correo', {}));
  });
});

describe('H10: un pedido nuevo explícito no se toma como corrección del anterior', () => {
  it('el caso de Codex empieza la captura de los paneles sin escribir en el negocio anterior', () => {
    registered();
    const body = 'Otro pedido: paneles LED para una oficina en Lampa.\nMi correo es ana.dos@example.com';
    const r = step(body, { producto: 'paneles LED', proyecto_o_uso: 'oficina', correo: 'ana.dos@example.com' });
    expect(r.rutUpdate).toBeUndefined();
    expect(r.closedFlow).toBe(false);
    expect(r.shouldCreateDeal).toBe(false);
    expect(r.captured).toMatchObject({ producto: 'paneles LED', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa', correo: 'ana.dos@example.com' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cambios).toBeUndefined();
    const state = flow.getFlowState(PHONE);
    expect(state.stage).not.toBe('closed');
    expect(state.deal).toBeUndefined();
    expect(state.dealId).toBeUndefined();
  });

  it.each([
    'Otra solicitud: 30 tubos LED para una bodega en Lampa, ana.dos@example.com',
    'Necesito otra cotización de paneles LED, mi correo es ana.dos@example.com',
    'Tengo otro proyecto, ana.dos@example.com',
    'Quiero hacer un nuevo pedido, ana.dos@example.com',
    'Además necesito cotizar paneles LED, ana.dos@example.com',
  ])('"%s" empieza otro flujo con el correo de ese mensaje', (body) => {
    registered();
    const r = step(body, {});
    expect(r.rutUpdate).toBeUndefined();
    expect(r.captured.correo).toBe('ana.dos@example.com');
    expect(r.captured.cambios).toBeUndefined();
    expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
  });
});

describe('lo que ya funcionaba después del cierre registrado', () => {
  it('el correo tardío simple va al mismo negocio', () => {
    registered();
    expectCorrection(step('Es ana.nueva@example.com', { correo: 'ana.nueva@example.com' }), 'ana.nueva@example.com');
  });

  it('"Perdón, me equivoqué: es …" corrige el correo', () => {
    registered();
    expectCorrection(step('Perdón, me equivoqué: es ana.nueva@example.com', { correo: 'ana.nueva@example.com' }), 'ana.nueva@example.com');
  });

  it('el mismo correo repetido, con otras mayúsculas, no escribe otra nota', () => {
    registered();
    expectUntouched(step('Mi correo es ANA.PRUEBA@example.com', { correo: 'ANA.PRUEBA@example.com' }));
  });

  it('el correo que Claude repite sin que el cliente lo escriba no cambia nada', () => {
    registered();
    expectUntouched(step('Muchas gracias', { correo: 'ana.vieja@example.com' }));
  });

  it('el RUT tardío sigue yendo al mismo negocio, y con el correo en el mismo mensaje se suman los dos', () => {
    registered();
    const r = step('mi RUT es 11.111.111-1', {});
    expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.rut).toBe('11.111.111-1');
    const both = step('Corrijo mi correo: ana.nueva@example.com', {});
    expect(both.captured).toMatchObject({ rut: '11.111.111-1', correo: 'ana.nueva@example.com' });
    expect(flow.getFlowState(PHONE).dealId).toBe(DEAL_ID);
  });

  it('"corregir el RUT" con un RUT válido sigue siendo una corrección del RUT', () => {
    registered();
    const r = step('Necesito corregir el RUT: 11.111.111-1', {});
    expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.rut).toBe('11.111.111-1');
    expect(flow.getFlowState(PHONE).dealId).toBe(DEAL_ID);
  });
});

describe('revisión adversaria de H9 y H10', () => {
  // Un pedido nuevo negado, o una pregunta por uno que ya existe, no reinicia ni pierde el negocio registrado.
  it.each([
    'No es un nuevo pedido, es el mismo. Mi correo correcto es ana.nueva@example.com',
    'Perdón, no es otro pedido. El correo correcto es ana.nueva@example.com',
    'Es el mismo proyecto, no otro proyecto. Mi correo es ana.nueva@example.com',
    'Para no hacer otro pedido, corrijo mi correo: ana.nueva@example.com',
    'Otra cosa: mi correo correcto es ana.nueva@example.com',
  ])('"%s" corrige el correo del mismo negocio', (body) => {
    registered();
    expectCorrection(step(body, {}), 'ana.nueva@example.com');
  });

  it.each(['¿Llegó mi otro pedido?', 'Gracias. ¿Y el otro pedido que hice ayer?', '¿Ya les llegó mi nuevo pedido?'])(
    '"%s" da la respuesta de la conversación cerrada',
    (body) => {
      registered();
      expectUntouched(step(body, {}));
    },
  );

  it('"corregir el RUT de la otra cotización" no empieza otro flujo', () => {
    registered();
    const r = step('Necesito corregir el RUT de la otra cotización: 11.111.111-1', {});
    expect(r.closedFlow).toBe(true);
    expect(flow.getFlowState(PHONE)).toMatchObject({ stage: 'closed', deal: 'registered', dealId: DEAL_ID });
  });

  // Sinónimos de un pedido nuevo explícito: empiezan la captura de los paneles y no tocan el negocio anterior.
  it.each([
    'Nuevo pedido: paneles LED para una oficina en Lampa. Mi correo es ana.dos@example.com',
    'Nueva solicitud: paneles LED para una oficina en Lampa, ana.dos@example.com',
    'Tengo otra obra: paneles LED para una oficina en Lampa, ana.dos@example.com',
    'Otra cosa: paneles LED para una oficina en Lampa, ana.dos@example.com',
  ])('"%s" empieza la captura de los paneles', (body) => {
    registered();
    const r = step(body, {});
    expect(r.rutUpdate).toBeUndefined();
    expect(r.closedFlow).toBe(false);
    expect(r.captured).toMatchObject({ producto: 'paneles LED', comuna_o_ciudad: 'Lampa', correo: 'ana.dos@example.com' });
    expect(r.captured.cambios).toBeUndefined();
    expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
  });

  it('"¿Puedo hacer otro pedido?" sí empieza otro flujo', () => {
    registered();
    step('¿Puedo hacer otro pedido?', {});
    expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
  });

  // Otras formas de corregir el correo, también con la negrita o la cursiva de WhatsApp.
  it.each([
    'Necesito corregir mi *correo*: ana.nueva@example.com',
    'Necesito corregir mi _correo_: ana.nueva@example.com',
    'Necesito cambiar la dirección de correo a ana.nueva@example.com',
    'El correo que les di está malo, necesito que usen ana.nueva@example.com',
    'Necesito que me escriban a otro correo: ana.nueva@example.com',
  ])('"%s" corrige el correo del mismo negocio', (body) => {
    registered();
    expectCorrection(step(body, {}), 'ana.nueva@example.com');
  });

  // Un correo negado nunca se toma, aunque haya palabras entre la negación y el correo.
  it.each([
    'No me escriban a ana.otra@example.com',
    'No envíen nada a ana.otra@example.com',
    'No mandes a ana.otra@example.com',
    'Mi correo nunca fue ana.otra@example.com',
    'Nunca usé ana.otra@example.com',
    'Jamás usé ana.otra@example.com',
    'Por favor *no* usen ana.otra@example.com',
  ])('"%s" no cambia nada', (body) => {
    registered();
    expectUntouched(step(body, { correo: 'ana.otra@example.com' }));
  });

  it.each([
    'No olviden escribirme a ana.nueva@example.com',
    'Si no les llega, escríbanme a ana.nueva@example.com',
    'No tengo RUT. Mi correo es ana.nueva@example.com',
  ])('"%s" no es un correo negado', (body) => {
    registered();
    expectCorrection(step(body, {}), 'ana.nueva@example.com');
  });
});
