// api/_lib/whatsapp/flowResumen.test.ts
// Bot de WhatsApp, FASE 3B (dueño, 16-11-2026, opción B): el resumen antes del cierre.
// - Formato aprobado: «Te resumo: [productos y cantidades], [color de luz], [uso] y [comuna]. ¿Está bien?», con «luz»,
//   «para» y «en»; la parte que falta no va. Nunca el correo, el nombre ni el RUT. Sin producto, con varios items que
//   no se leen en pares limpios o con más de 500 caracteres, no hay resumen: el cierre de siempre (MSG4).
// - Sale en cada cierre de productos que registra (persona o empresa), también en el primer registro de una
//   conversación cerrada sin correo; no en el ejecutivo (MSG_HUMAN), la instalación ni el reintento del registro.
// - El negocio se crea en el turno del resumen; MSG4 llega con el «sí». Un «no» solo pide el dato; el segundo «no»,
//   MSG4. Un dato que corrige o suma va al mismo negocio con el resumen corregido (una sola vez) o MSG4.
// El texto exacto lo congela ownerApprovedTexts.test.ts; el paso por el webhook, whatsapp-webhook-resumen.test.ts.
// Solo datos inventados.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const PHONE = '+56900000741';
const SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
type Claude = Parameters<typeof flow.processFlowStep>[2];
type Captured = Parameters<typeof flow.summaryMsg>[0];
let lastReply: string | undefined;
/** Un mensaje del cliente, con la respuesta anterior (como el webhook). */
const step = (body: string, claude: Claude = {}, hasMedia = false) => {
  const r = flow.processFlowStep(PHONE, body, claude, { ...SIGNALS, lastReply, hasMedia });
  lastReply = r.reply;
  return r;
};
afterEach(() => { flow.clearFlowState(PHONE); lastReply = undefined; });

const CONTACT = 'Soy Ana Prueba, ana.prueba@example.com';
const CONTACT_CLAUDE = { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
// Los cuatro ejemplos aprobados por el dueño (decisión 1), tal cual.
const EXAMPLE_1 = 'Te resumo: 20 paneles LED 60x60, luz neutra, para oficina y en Maipú. ¿Está bien?';
const EXAMPLE_2 = 'Te resumo: 12 focos LED y 5 paneles LED, para bodega y en Quilicura. ¿Está bien?';
const EXAMPLE_3 = 'Te resumo: 500 m de cinta LED 220V, luz fría y en Lampa. ¿Está bien?';
const EXAMPLE_4 = 'Te resumo: 30 tubos LED. ¿Está bien?';

const PANELES = 'Necesito 20 paneles LED 60x60 luz neutra para una oficina en Maipú. ' + CONTACT;
const PANELES_CLAUDE = { producto: 'paneles LED 60x60', cantidad: '20', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Maipú', ...CONTACT_CLAUDE };
const summaryOf = (items: string, rest: string) => 'Te resumo: ' + items + ', ' + rest + '. ¿Está bien?';

/** El pedido de los paneles cerrado con su resumen y el negocio 4242 registrado. */
function closeWithSummary() {
  const closing = step(PANELES, PANELES_CLAUDE);
  expect(closing).toMatchObject({ reply: EXAMPLE_1, shouldCreateDeal: true, closedFlow: true });
  flow.recordDealOutcome(PHONE, true, undefined, 4242);
  return closing;
}

describe('el texto del resumen (summaryMsg)', () => {
  it('los cuatro ejemplos aprobados', () => {
    expect(flow.summaryMsg({ producto: 'paneles LED 60x60', cantidad: '20', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Maipú' })).toBe(EXAMPLE_1);
    expect(flow.summaryMsg({ producto: 'focos LED y paneles LED', cantidad_varios: 'Necesito 12 focos LED y 5 paneles LED para una bodega', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura' })).toBe(EXAMPLE_2);
    expect(flow.summaryMsg({ producto: 'cinta LED 220V', cantidad: '500', cantidad_unidad: 'm', tipo_de_luz: 'fría', comuna_o_ciudad: 'Lampa' })).toBe(EXAMPLE_3);
    expect(flow.summaryMsg({ producto: 'tubos LED', cantidad: '30' })).toBe(EXAMPLE_4);
  });

  it.each([
    ['calida', 'luz cálida'],
    ['fria', 'luz fría'],
    ['Luz fría 6500K', 'Luz fría 6500K'],
    ['luz calida', 'luz cálida'],
    ['4000K', 'luz 4000K'],
  ])('el color "%s" se muestra como «%s», sin «luz luz»', (luz, shown) => {
    // (revisión 16-11, T3) Con dos partes, «y» antes de la última.
    expect(flow.summaryMsg({ producto: 'focos LED', cantidad: '12', tipo_de_luz: luz })).toBe('Te resumo: 12 focos LED y ' + shown + '. ¿Está bien?');
  });

  it('el uso va tal cual, con «para» una sola vez y sin artículo agregado', () => {
    expect(flow.summaryMsg({ producto: 'focos LED', cantidad: '12', proyecto_o_uso: 'la casa de mi mamá' })).toBe('Te resumo: 12 focos LED y para la casa de mi mamá. ¿Está bien?');
    expect(flow.summaryMsg({ producto: 'focos LED', cantidad: '12', proyecto_o_uso: 'para el patio' })).toBe('Te resumo: 12 focos LED y para el patio. ¿Está bien?');
  });

  it('la comuna es solo la de la entrega, nunca las otras mencionadas', () => {
    expect(flow.summaryMsg({ producto: 'focos LED', cantidad: '12', comuna_o_ciudad: 'Maipú', comunas_otras: ['Pirque'] } as Captured)).toBe('Te resumo: 12 focos LED y en Maipú. ¿Está bien?');
    expect(flow.summaryMsg({ producto: 'focos LED', cantidad: '12', comunas_otras: ['Pirque'] } as Captured)).toBe('Te resumo: 12 focos LED. ¿Está bien?');
  });

  it('nunca el correo, el nombre ni el RUT: si un dato los trae, no hay resumen', () => {
    const base = { producto: 'focos LED', cantidad: '12', correo: 'ana.prueba@example.com', nombre_o_empresa: 'Comercial Prueba SpA', rut: '77.123.456-9' };
    expect(flow.summaryMsg(base)).toBe('Te resumo: 12 focos LED. ¿Está bien?');
    expect(flow.summaryMsg({ ...base, proyecto_o_uso: 'la oficina de Comercial Prueba SpA' })).toBeUndefined();
    expect(flow.summaryMsg({ ...base, proyecto_o_uso: 'oficina, RUT 77.123.456-9' })).toBeUndefined();
    expect(flow.summaryMsg({ ...base, proyecto_o_uso: 'casa', comuna_o_ciudad: 'ana.prueba@example.com' })).toBeUndefined();
    expect(flow.summaryMsg({ ...base, producto: 'focos LED (cotizar a compras@example.com)' })).toBeUndefined();
  });

  it('los productos: con metros, sin cantidad y los varios items en pares', () => {
    expect(flow.summaryMsg({ producto: 'cinta LED', cantidad: '5', cantidad_unidad: 'm' })).toBe('Te resumo: 5 m de cinta LED. ¿Está bien?');
    expect(flow.summaryMsg({ producto: 'focos LED', tipo_de_luz: 'fría' })).toBe('Te resumo: focos LED y luz fría. ¿Está bien?');
    // El item que ya estaba cuando el cliente sumó otro (mergeQuantity: "<producto>: <cantidad> / ...").
    expect(flow.summaryMsg({ producto: 'paneles LED 60x60', cantidad_varios: 'paneles LED 60x60: 20 / También necesito 10 focos LED' })).toBe('Te resumo: 20 paneles LED 60x60 y 10 focos LED. ¿Está bien?');
    expect(flow.summaryMsg({ producto: 'cinta LED', cantidad_varios: 'cinta LED: 50 m / También necesito 10 focos LED' })).toBe('Te resumo: 50 m de cinta LED y 10 focos LED. ¿Está bien?');
  });

  it.each([
    ['sin producto', { cantidad: '12', tipo_de_luz: 'fría', comuna_o_ciudad: 'Maipú' }],
    ['varios items sin pares limpios', { producto: 'focos LED', cantidad_varios: '12 / 5 UND' }],
    ['un solo par en varios items', { producto: 'focos LED', cantidad_varios: 'Necesito 12 focos LED y algunos paneles' }],
    ['varios items con una corrección', { producto: 'focos LED', cantidad_varios: '12 focos LED / Corrijo: 15 focos LED y 5 paneles LED' }],
    ['más de 500 caracteres', { producto: 'paneles LED ' + 'x'.repeat(480), cantidad: '20' }],
  ])('%s: no hay resumen', (_why, captured) => {
    expect(flow.summaryMsg(captured as Captured)).toBeUndefined();
  });
});

describe('dónde sale el resumen', () => {
  it('el pedido completo de una persona: el resumen en el turno que registra, anotado en el estado por un turno', () => {
    const before = Date.now();
    closeWithSummary();
    const state = flow.getFlowState(PHONE);
    expect(state).toMatchObject({ stage: 'closed', summaryShown: 1, lastQuestion: { asks: [], listLength: 0, summary: true } });
    expect(state.summaryAt).toBeGreaterThanOrEqual(before);
  });

  it('una empresa con su RUT: el resumen sin la razón social, el RUT ni el correo', () => {
    const r = step('Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia. Comercial Prueba SpA, RUT 77.123.456-9, compras@comercial-prueba.example.com',
      { producto: 'paneles LED 60x60', cantidad: '30', tipo_de_luz: 'fría', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia', empresa: 'Comercial Prueba SpA', correo: 'compras@comercial-prueba.example.com' });
    expect(r).toMatchObject({ reply: 'Te resumo: 30 paneles LED 60x60, luz fría, para oficina y en Providencia. ¿Está bien?', shouldCreateDeal: true });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
  });

  it('los ejemplos 2, 3 y 4 por el flujo, con las preguntas que el cliente no contesta', () => {
    step('Necesito 12 focos LED y 5 paneles LED para una bodega en Quilicura. ' + CONTACT, { producto: 'focos LED y paneles LED', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', ...CONTACT_CLAUDE });
    expect(step('no sé')).toMatchObject({ reply: EXAMPLE_2, shouldCreateDeal: true });
    flow.clearFlowState(PHONE);
    step('Necesito 500 metros de cinta LED 220V luz fría, despacho a Lampa. ' + CONTACT, { producto: 'cinta LED 220V', cantidad: '500', tipo_de_luz: 'fría', comuna_o_ciudad: 'Lampa', ...CONTACT_CLAUDE });
    expect(step('no sé')).toMatchObject({ reply: EXAMPLE_3, shouldCreateDeal: true });
    flow.clearFlowState(PHONE);
    step('Necesito 30 tubos LED. ' + CONTACT, { producto: 'tubos LED', cantidad: '30', ...CONTACT_CLAUDE });
    step('no sé');
    expect(step('no sé')).toMatchObject({ reply: EXAMPLE_4, shouldCreateDeal: true });
  });

  it('el primer registro de una conversación cerrada sin correo: el correo tardío recibe el resumen', () => {
    step('Necesito 12 focos LED luz cálida para mi casa en Maipú', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' });
    expect(step('no sé').reply).toBe(flow.MSG_NEED_EMAIL);
    const r = step('ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(r).toMatchObject({ reply: 'Te resumo: 12 focos LED, luz cálida, para casa y en Maipú. ¿Está bien?', shouldCreateDeal: true });
    expect(flow.getFlowState(PHONE)).toMatchObject({ summaryShown: 1, lastQuestion: { summary: true } });
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
    expect(step('Sí')).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
  });

  it('sin resumen posible (varios items sin pares), el cierre de siempre', () => {
    const r = step('Necesito 12 focos LED / 5 UND luz fría para mi casa en Maipú. ' + CONTACT, { producto: 'focos LED', cantidad: '12 / 5 UND', tipo_de_luz: 'fría', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', ...CONTACT_CLAUDE });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(r.captured.cantidad_varios).toContain('12 focos LED / 5 UND');
    expect(flow.getFlowState(PHONE).summaryShown).toBeUndefined();
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });

  it('el ejecutivo (MSG_HUMAN) no recibe resumen', () => {
    const r = step('Quiero hablar con un vendedor, necesito 20 paneles LED 60x60 para una oficina en Maipú. ' + CONTACT, { ...PANELES_CLAUDE, wantsHuman: true });
    expect(r).toMatchObject({ reply: flow.MSG_HUMAN, shouldCreateDeal: true });
    expect(flow.getFlowState(PHONE).summaryShown).toBeUndefined();
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });

  it('la instalación no recibe resumen', () => {
    const r = step('Quiero instalar luces en mi casa en Maipú. ' + CONTACT, { proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', ...CONTACT_CLAUDE });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
    expect(flow.getFlowState(PHONE).summaryShown).toBeUndefined();
  });

  it('el reintento del registro (sin resultado de Pipedrive) no repite el resumen', () => {
    step(PANELES, PANELES_CLAUDE);
    const retry = step('hola?');
    expect(retry).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(flow.getFlowState(PHONE).summaryShown).toBe(1);
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });

  it('el «sí» que llega antes del resultado de Pipedrive reintenta el registro con MSG4, sin otro resumen', () => {
    step(PANELES, PANELES_CLAUDE);
    expect(step('Sí')).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });
});

describe('la respuesta al resumen', () => {
  it.each([
    'Sí', 'si', 'SI!', 'Ok', 'okay', 'Correcto', 'Está bien', 'esta bien.', 'Perfecto', 'Dale', 'De acuerdo', 'Todo bien',
    '👍', '👍🏽', 'Sí, gracias', 'Gracias, sí', 'Ok perfecto', 'si si', 'Perfecto, gracias!',
  ])('«%s»: MSG4, sin escribir en Pipedrive ni cambiar datos', (body) => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE);
    const r = step(body);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false, closedFlow: true });
    expect(r.rutUpdate).toBeUndefined();
    const after = flow.getFlowState(PHONE);
    expect(after.captured).toEqual(before.captured);
    expect(after).toMatchObject({ deal: 'registered', dealId: 4242, lastQuestion: null });
  });

  it('«gracias» solo no es un sí: el recordatorio corto, sin escribir en Pipedrive', () => {
    closeWithSummary();
    expect(step('gracias')).toMatchObject({ reply: flow.MSG_REGISTERED_SHORT, shouldCreateDeal: false });
  });

  it('un «no» solo pide el dato; el segundo «no», MSG4', () => {
    closeWithSummary();
    expect(step('No')).toMatchObject({ reply: flow.MSG_SUMMARY_FIX, shouldCreateDeal: false });
    expect(flow.getFlowState(PHONE).lastQuestion).toMatchObject({ summary: true, summaryFix: true });
    expect(step('no')).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });

  it.each(['No está bien', 'está mal', 'No es así', 'Incorrecto'])('«%s» también pide el dato', (body) => {
    closeWithSummary();
    expect(step(body).reply).toBe(flow.MSG_SUMMARY_FIX);
  });

  it('el dato que llega después del «no» corrige el mismo negocio y muestra el resumen corregido', () => {
    closeWithSummary();
    step('No');
    const r = step('Es en Pudahuel', { comuna_o_ciudad: 'Pudahuel' });
    expect(r).toMatchObject({ reply: summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel'), shouldCreateDeal: true, rutUpdate: true, closedFlow: true });
    expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, summaryShown: 2, lastQuestion: { summary: true } });
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Pudahuel']);
    expect(step('ok')).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
  });

  it.each<[string, Claude, string]>([
    ['No, son 30', { cantidad: '30' }, summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú')],
    ['Está bien, pero mejor 25', { cantidad: '25' }, summaryOf('25 paneles LED 60x60', 'luz neutra, para oficina y en Maipú')],
    ['Corrijo, luz fría', { tipo_de_luz: 'fría' }, summaryOf('20 paneles LED 60x60', 'luz fría, para oficina y en Maipú')],
    ['Pudahuel', { comuna_o_ciudad: 'Pudahuel' }, summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel')],
    ['Es para una bodega', { proyecto_o_uso: 'bodega' }, summaryOf('20 paneles LED 60x60', 'luz neutra, para bodega y en Maipú')],
  ])('la corrección «%s» va al mismo negocio con el resumen corregido', (body, claude, summary) => {
    closeWithSummary();
    const r = step(body, claude);
    expect(r).toMatchObject({ reply: summary, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.cambios?.length).toBe(1);
    expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, deal: 'registered', summaryShown: 2 });
  });

  it.each<[string, Claude]>([
    ['También necesito 10 focos LED', { producto: 'focos LED', cantidad: '10' }],
  ])('«%s» se suma como otro item del mismo pedido, sin cambiar el uso', (body, claude) => {
    closeWithSummary();
    const r = step(body, claude);
    expect(r).toMatchObject({ reply: summaryOf('20 paneles LED 60x60 y 10 focos LED', 'luz neutra, para oficina y en Maipú'), shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ producto: 'paneles LED 60x60', proyecto_o_uso: 'oficina' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  it('el resumen corregido sale una sola vez: la corrección siguiente se anota y recibe MSG4', () => {
    closeWithSummary();
    step('No, son 30', { cantidad: '30' });
    const r = step('Mejor 40', { cantidad: '40' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ cantidad: '40' });
    expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 30', 'Cantidad: antes 30, ahora 40']);
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });

  it.each<[string, Claude]>([
    ['Gracias! mi otra casa está en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Saludos desde Puente Alto', { comuna_o_ciudad: 'Puente Alto' }],
    ['son 3 dormitorios y el living', { proyecto_o_uso: 'dormitorios y living' }],
  ])('un comentario («%s») no cambia los datos ni escribe en Pipedrive', (body, claude) => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step(body, claude);
    expect(r.shouldCreateDeal).toBe(false);
    expect(flow.getFlowState(PHONE).captured).toEqual(before);
  });

  it('una pregunta sigue la conversación cerrada: la respuesta de siempre, sin escribir en Pipedrive', () => {
    closeWithSummary();
    const r = step('¿Hacen envío a Rancagua?');
    expect(r).toMatchObject({ reply: flow.MSG_WAIT_DELIVERY, shouldCreateDeal: false });
    expect(flow.getFlowState(PHONE).captured.comuna_o_ciudad).toBe('Maipú');
    const plazo = step('¿Cuándo me responden?');
    expect(plazo.shouldCreateDeal).toBe(false);
    expect(plazo.reply).not.toContain('Te resumo');
  });

  it('el correo corregido va al mismo negocio (lateEmail)', () => {
    closeWithSummary();
    const r = step('mi correo correcto es ana.otra@example.com', { correo: 'ana.otra@example.com' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.correo).toBe('ana.otra@example.com');
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  it('el RUT tardío va al mismo negocio (lateRut)', () => {
    closeWithSummary();
    const r = step('RUT 77.123.456-9');
    expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ rut: '77.123.456-9', rut_valido: true });
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  it('una foto o un audio con el resumen pendiente: el aviso y «Cuéntanos tu respuesta por escrito»; el resumen sigue esperando', () => {
    closeWithSummary();
    expect(flow.recordMediaReply(PHONE, ['image/jpeg'])).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
    expect(flow.recordMediaReply(PHONE, ['audio/ogg'])).toBe(flow.MSG_VOICE_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
    expect(flow.getFlowState(PHONE).lastQuestion).toMatchObject({ summary: true });
    expect(step('Sí').reply).toBe(flow.MSG4);
  });

  it('con el negocio fallido, el «sí» recibe el texto B: nunca «quedó registrada»', () => {
    step(PANELES, PANELES_CLAUDE);
    flow.recordDealOutcome(PHONE, false);
    const r = step('Sí');
    expect(r).toMatchObject({ reply: flow.MSG_DEAL_FAILED, shouldCreateDeal: false });
    expect(r.reply).not.toMatch(/qued[oó] registrad/i);
  });

  it('una cotización nueva sigue abriendo otra conversación', () => {
    closeWithSummary();
    const r = step('Necesito otra cotización: 10 focos LED para Lampa', { producto: 'focos LED', cantidad: '10', comuna_o_ciudad: 'Lampa' });
    expect(r.closedFlow).toBe(false);
    expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '10' });
  });

  it('el resumen espera un solo mensaje: después de otra respuesta, el «sí» sigue la conversación cerrada', () => {
    closeWithSummary();
    step('gracias');
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
    const r = step('Sí');
    expect(r.shouldCreateDeal).toBe(false);
    expect(r.reply).not.toBe(flow.MSG4);
    expect(r.reply).not.toContain('Te resumo');
  });
});

// Revisión de la fase 3B (16-11-2026): cada hallazgo con su caso literal; todos fallaban antes del arreglo.
describe('(revisión 16-11) la respuesta al resumen no escribe de más ni mezcla datos', () => {
  const EXAMPLE_2_FLOW = 'Te resumo: 12 focos LED y 5 paneles LED, luz fría, para bodega y en Quilicura. ¿Está bien?';
  /** El ejemplo 2 por el flujo (focos y paneles en varios items, luz fría) con el negocio 4242. */
  function closeExample2() {
    const closing = step('Necesito 12 focos LED y 5 paneles LED luz fría para una bodega en Quilicura. ' + CONTACT,
      { producto: 'focos LED y paneles LED', tipo_de_luz: 'fría', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', ...CONTACT_CLAUDE });
    expect(closing.reply).toBe(EXAMPLE_2_FLOW);
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }
  const unchanged = () => expect(flow.getFlowState(PHONE).captured).toMatchObject({
    producto: 'paneles LED 60x60', cantidad: '20', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Maipú',
  });

  it.each<[string, string]>([['Son 8 paneles', '8'], ['Los paneles son 8', '8'], ['Sí, pero los focos son 15', '15']])(
    'F1: «%s» con varios items no borra los otros: se suma a los varios items del mismo negocio y recibe MSG4', (body, cantidad) => {
      closeExample2();
      const r = step(body, { producto: 'focos LED y paneles LED', cantidad });
      expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured.cantidad).toBeUndefined();
      expect(r.captured.cantidad_varios).toContain('12 focos LED y 5 paneles LED');
      expect(r.captured.cantidad_varios?.endsWith(' / ' + body)).toBe(true);
      expect(r.captured.producto).toBe('focos LED y paneles LED');
      expect(r.captured.cambios).toHaveLength(1);
      expect(r.captured.cambios?.[0]).toMatch(/^Cantidad: antes varios items \(.*\), ahora varios items \(.*\)$/);
    });

  it('F1: una cantidad sola con un producto que nombra dos no se resume («8 focos LED y paneles LED»)', () => {
    expect(flow.summaryMsg({ producto: 'focos LED y paneles LED', cantidad: '8', tipo_de_luz: 'fría' })).toBeUndefined();
    expect(flow.summaryMsg({ producto: 'focos LED, paneles LED', cantidad: '8' })).toBeUndefined();
  });

  it.each([
    'En realidad necesito 20 focos LED', 'Al final son 20 focos LED', 'Quise decir 20 focos LED', 'Me confundí, son 20 focos LED',
    'Error mío: 20 focos LED', 'Eran 20 focos LED', 'Son 20 focos LED, no paneles',
  ])('F2: «%s» cambia el producto: no lo suma como otro item', (body) => {
    closeWithSummary();
    const r = step(body, { producto: 'focos LED', cantidad: '20' });
    expect(r).toMatchObject({ reply: summaryOf('20 focos LED', 'luz neutra, para oficina y en Maipú'), shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '20' });
    expect(r.captured.cantidad_varios).toBeUndefined();
    expect(r.captured.cambios).toEqual(['Producto: antes paneles LED 60x60, ahora focos LED']);
  });

  it.each<[string, string]>([['Mi cuñado vive en Pirque', 'Pirque'], ['Ahora estoy en Pirque', 'Pirque'], ['Sí, estoy en Santiago', 'Santiago']])(
    'F3: «%s» es un comentario: no cambia la comuna ni escribe en Pipedrive', (body, comuna) => {
      closeWithSummary();
      const r = step(body, { comuna_o_ciudad: comuna });
      expect(r.shouldCreateDeal).toBe(false);
      expect(r.rutUpdate).toBeUndefined();
      unchanged();
    });

  it.each<[string, string]>([['Pudahuel', 'Pudahuel'], ['No, Pudahuel', 'Pudahuel'], ['La comuna es Pudahuel', 'Pudahuel']])(
    'F3: «%s» sigue corrigiendo la comuna', (body, comuna) => {
      closeWithSummary();
      expect(step(body, { comuna_o_ciudad: comuna })).toMatchObject({ reply: summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel'), rutUpdate: true });
    });

  it.each<[string, Claude, string]>([
    ['30', { cantidad: '30' }, summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú')],
    ['bodega', { proyecto_o_uso: 'bodega' }, summaryOf('20 paneles LED 60x60', 'luz neutra, para bodega y en Maipú')],
    ['una bodega', { proyecto_o_uso: 'bodega' }, summaryOf('20 paneles LED 60x60', 'luz neutra, para bodega y en Maipú')],
  ])('F4: después de «¿Qué dato corrijo?», «%s» corrige ese dato en el mismo negocio', (body, claude, summary) => {
    closeWithSummary();
    expect(step('No').reply).toBe(flow.MSG_SUMMARY_FIX);
    expect(step(body, claude)).toMatchObject({ reply: summary, shouldCreateDeal: true, rutUpdate: true });
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  it('F4: «30» justo después del resumen es la cantidad', () => {
    closeWithSummary();
    const r = step('30', { cantidad: '30' });
    expect(r).toMatchObject({ reply: summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú'), rutUpdate: true });
    expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 30']);
  });

  it.each(['No, el despacho es a Pudahuel', 'La entrega es en Pudahuel'])('F5: «%s» corrige la comuna (no es una pregunta por el despacho)', (body) => {
    closeWithSummary();
    const r = step(body, { comuna_o_ciudad: 'Pudahuel' });
    expect(r).toMatchObject({ reply: summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel'), shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Pudahuel']);
  });

  it('F5: «No, son 30. ¿Cuánto demora el despacho?» corrige la cantidad y contesta el despacho antes del resumen', () => {
    closeWithSummary();
    const r = step('No, son 30. ¿Cuánto demora el despacho?', { cantidad: '30' });
    expect(r.reply).toBe(flow.MSG_WAIT_DELIVERY + '\n\n' + summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú'));
    expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.cantidad).toBe('30');
  });

  it('F5: la pregunta sola por el despacho sigue sin cambiar datos', () => {
    closeWithSummary();
    const r = step('¿Hacen envío a Rancagua?', { comuna_o_ciudad: 'Rancagua' });
    expect(r.shouldCreateDeal).toBe(false);
    unchanged();
  });

  it.each(['Sí, quiero cotizar eso', 'Sí, necesito el presupuesto', 'Sí, necesito cotizar urgente', 'Si, necesito cotizar esos paneles'])(
    'F6: «%s» confirma el resumen: MSG4, sin reiniciar la conversación ni escribir', (body) => {
      closeWithSummary();
      const r = step(body, PANELES_CLAUDE);
      expect(r).toMatchObject({ reply: flow.MSG4, closedFlow: true, shouldCreateDeal: false });
      expect(flow.getFlowState(PHONE)).toMatchObject({ stage: 'closed', dealId: 4242 });
      unchanged();
    });

  it.each<[string, Claude]>([
    ['Sí, en 2 semanas más', {}],
    ['Sí, tengo 2 bodegas más', {}],
    ['Dale, tengo 3 obras más', {}],
    ['Sí, y quizás después pida 10 más', { cantidad: '10' }],
    ['Perfecto. Más adelante pediré 10 más', { cantidad: '10' }],
    ['Sí, y a lo mejor 5 más el próximo mes', { cantidad: '5' }],
    ['Sí, y los de la bodega son 10', { cantidad: '10', proyecto_o_uso: 'bodega' }],
    ['Si. Tambien tengo una bodega en Quilicura', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura' }],
    ['Sí, pero también podría ser luz cálida', { tipo_de_luz: 'cálida' }],
  ])('F7: «%s» no cambia el pedido: MSG4, sin escribir en Pipedrive', (body, claude) => {
    closeWithSummary();
    const r = step(body, claude);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
    expect(r.rutUpdate).toBeUndefined();
    unchanged();
    expect(flow.getFlowState(PHONE).captured.cantidad_varios).toBeUndefined();
  });

  it.each<[string, Claude]>([
    ['También necesito 10 focos LED para mi casa en Pirque', { producto: 'focos LED', cantidad: '10', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Pirque' }],
    ['También necesito 10 focos LED luz cálida', { producto: 'focos LED', cantidad: '10', tipo_de_luz: 'cálida' }],
    ['Necesito 10 focos LED para el patio', { producto: 'focos LED', cantidad: '10', proyecto_o_uso: 'patio' }],
  ])('F8: «%s» suma el item con sus datos para el vendedor y recibe MSG4: el resumen no le pone los del pedido', (body, claude) => {
    closeWithSummary();
    const r = step(body, claude);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Maipú' });
    expect(r.captured.cantidad_varios).toBe('paneles LED 60x60: 20 / ' + body);
  });

  it.each([
    'con despacho gratis', 'de $12.990', 'que tengan stock', 'despacho mañana', 'al mejor precio', 'a $5.000 c/u', 'con entrega hoy',
  ])('T1: el resumen nunca repite del cliente un precio, el stock, un plazo ni «gratis» («%s»)', (extra) => {
    expect(flow.summaryMsg({ producto: 'paneles LED y focos LED', cantidad_varios: 'Necesito 10 paneles LED ' + extra + ' y 5 focos LED' })).toBeUndefined();
  });

  it('T1: por el flujo, el item sumado con su precio recibe MSG4', () => {
    closeWithSummary();
    expect(step('También necesito 10 focos LED a $3.990', { producto: 'focos LED', cantidad: '10' }).reply).toBe(flow.MSG4);
  });

  it.each(['5000K', '4000K', '3000K', '6500K'])('T2: la temperatura «%s» se muestra como la escribió el cliente', (kelvin) => {
    step('Necesito 20 paneles LED 60x60 para oficina en Maipú. ' + CONTACT, CONTACT_CLAUDE);
    expect(step(kelvin, { tipo_de_luz: kelvin === '3000K' ? 'cálida' : kelvin === '4000K' ? 'neutra' : 'fría' }).reply)
      .toBe(summaryOf('20 paneles LED', 'luz ' + kelvin + ', para oficina y en Maipú'));
    expect(flow.getFlowState(PHONE).captured.tipo_de_luz).toBe(kelvin);
  });

  it('T3: con dos partes, «y» antes de la última', () => {
    expect(flow.summaryMsg({ producto: 'tubos LED', cantidad: '30', tipo_de_luz: 'fría' })).toBe('Te resumo: 30 tubos LED y luz fría. ¿Está bien?');
  });

  it('T6: el uso que ya nombra la comuna o el color no los repite', () => {
    const base = { producto: 'paneles LED 60x60', cantidad: '20', tipo_de_luz: 'neutra', comuna_o_ciudad: 'Quilicura' };
    expect(flow.summaryMsg({ ...base, proyecto_o_uso: 'bodega en Quilicura' })).toBe('Te resumo: 20 paneles LED 60x60, luz neutra y para bodega en Quilicura. ¿Está bien?');
    expect(flow.summaryMsg({ ...base, proyecto_o_uso: 'iluminar una bodega con luz neutra' })).toBe('Te resumo: 20 paneles LED 60x60, para iluminar una bodega con luz neutra y en Quilicura. ¿Está bien?');
  });
});
