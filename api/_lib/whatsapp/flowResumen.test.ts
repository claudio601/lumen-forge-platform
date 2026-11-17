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

// (ronda 4, A) La línea interna que deja en la nota la respuesta al resumen que no se aplicó entera.
const unapplied = (body: string) => 'Respuesta del cliente al resumen, sin aplicar (revisar): "' + body + '"';
/** (ronda 4, A) La respuesta no cambió ningún dato y quedó textual en la nota del mismo negocio, sin tarea ni aviso. */
function expectNoted(r: ReturnType<typeof step>, body: string, before: Captured) {
  expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true, quietUpdate: true, closedFlow: true });
  const { cambios, ...data } = flow.getFlowState(PHONE).captured;
  const { cambios: cambiosBefore, ...dataBefore } = before;
  expect(data).toEqual(dataBefore);
  expect(cambios).toEqual([...(cambiosBefore ?? []), unapplied(body)]);
  expect(flow.getFlowState(PHONE).dealId).toBe(4242);
}

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
  ])('(ronda 5, A) un comentario («%s») no cambia los datos y queda textual en la nota, sin aviso', (body, claude) => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step(body, claude);
    expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
    expectNoted(r, body, before);
  });

  it('(ronda 4, A) un comentario con un número que no es un dato del pedido («son 3 dormitorios y el living») no cambia los datos y queda textual en la nota', () => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const body = 'son 3 dormitorios y el living';
    const r = step(body, { proyecto_o_uso: 'dormitorios y living' });
    expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
    expectNoted(r, body, before);
  });

  it('una pregunta sigue la conversación cerrada: la respuesta de siempre; (ronda 5, A) con un dato, también la línea textual', () => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step('¿Hacen envío a Rancagua?');
    expect(r.reply).toBe(flow.MSG_WAIT_DELIVERY);
    expectNoted(r, '¿Hacen envío a Rancagua?', before);
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

  it.each<[string, string, string]>([
    ['Son 8 paneles', '8', '12 focos LED y 8 paneles LED'],
    ['Los paneles son 8', '8', '12 focos LED y 8 paneles LED'],
    ['Sí, pero los focos son 15', '15', '15 focos LED y 5 paneles LED'],
  ])('F1 (ronda 5, C5): «%s» con varios items cambia solo ese item, sin borrar los otros: el resumen corregido', (body, cantidad, items) => {
    closeExample2();
    const r = step(body, { producto: 'focos LED y paneles LED', cantidad });
    expect(r).toMatchObject({ reply: 'Te resumo: ' + items + ', luz fría, para bodega y en Quilicura. ¿Está bien?', shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe(items);
    expect(r.captured.producto).toBe('focos LED y paneles LED');
    expect(r.captured.cambios).toHaveLength(1);
    expect(r.captured.cambios?.[0]).toMatch(/^Cantidad: antes varios items \(.*12 focos LED y 5 paneles LED.*\), ahora varios items \((.*)\)$/);
    expect(r.captured.cambios?.[0].endsWith(', ahora varios items (' + items + ')')).toBe(true);
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
    'F3: «%s» es un comentario: no cambia la comuna; (ronda 5, A) queda textual en la nota, sin aviso', (body, comuna) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body, { comuna_o_ciudad: comuna });
      expectNoted(r, body, before);
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

  it('F5: la pregunta sola por el despacho sigue sin cambiar datos; (ronda 5, A) la comuna preguntada queda en la nota', () => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step('¿Hacen envío a Rancagua?', { comuna_o_ciudad: 'Rancagua' });
    expect(r.reply).toBe(flow.MSG_WAIT_DELIVERY);
    expectNoted(r, '¿Hacen envío a Rancagua?', before);
    unchanged();
  });

  it.each(['Sí, quiero cotizar eso', 'Sí, necesito el presupuesto', 'Si, necesito cotizar esos paneles'])(
    'F6: «%s» confirma el resumen: MSG4, sin reiniciar la conversación ni escribir', (body) => {
      closeWithSummary();
      const r = step(body, PANELES_CLAUDE);
      expect(r).toMatchObject({ reply: flow.MSG4, closedFlow: true, shouldCreateDeal: false });
      expect(flow.getFlowState(PHONE)).toMatchObject({ stage: 'closed', dealId: 4242 });
      unchanged();
    });

  it('F6 (ronda 5, A): «Sí, necesito cotizar urgente» confirma con MSG4 y la urgencia queda textual en la nota, sin aviso', () => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step('Sí, necesito cotizar urgente', PANELES_CLAUDE);
    expect(r.reply).toBe(flow.MSG4);
    expectNoted(r, 'Sí, necesito cotizar urgente', before);
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
  ])('F7: «%s» no cambia el pedido: MSG4, y (ronda 4, A) queda textual en la nota del mismo negocio', (body, claude) => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step(body, claude);
    expect(r.reply).toBe(flow.MSG4);
    unchanged();
    expect(flow.getFlowState(PHONE).captured.cantidad_varios).toBeUndefined();
    expectNoted(r, body, before);
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

// Segunda revisión de la fase 3B (17-11-2026, verificación de 9cf7025): cada punto con su caso literal; todos fallaban
// con 9cf7025.
describe('(revisión 17-11) cambios de producto, listas nuevas, la red de seguridad y lo que no se resume', () => {
  const FOCOS_20 = summaryOf('20 focos LED', 'luz neutra, para oficina y en Maipú');
  const PANELES_30 = summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú');
  /** El ejemplo 2 por el flujo (focos y paneles en varios items, luz fría) con el negocio 4242. */
  function closeExample2() {
    const closing = step('Necesito 12 focos LED y 5 paneles LED luz fría para una bodega en Quilicura. ' + CONTACT,
      { producto: 'focos LED y paneles LED', tipo_de_luz: 'fría', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', ...CONTACT_CLAUDE });
    expect(closing.reply).toBe('Te resumo: 12 focos LED y 5 paneles LED, luz fría, para bodega y en Quilicura. ¿Está bien?');
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }
  /** El pedido de los paneles con el segundo resumen ya mostrado («No, son 30»). */
  function closeWithSecondSummary() {
    closeWithSummary();
    expect(step('No, son 30', { cantidad: '30' }).reply).toBe(PANELES_30);
    expect(flow.getFlowState(PHONE).summaryShown).toBe(2);
  }

  it.each(['Cambio: necesito 20 focos LED', 'Lo cambio por 20 focos LED', 'Modifico: 20 focos LED', 'Actualizo: son 20 focos LED'])(
    'punto 1: «%s» reemplaza el producto en el mismo negocio (no lo suma como otro item) y muestra el resumen corregido', (body) => {
      closeWithSummary();
      const r = step(body, { producto: 'focos LED', cantidad: '20' });
      expect(r).toMatchObject({ reply: FOCOS_20, shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '20' });
      expect(r.captured.cantidad_varios).toBeUndefined();
      expect(r.captured.cambios).toEqual(['Producto: antes paneles LED 60x60, ahora focos LED']);
      expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, summaryShown: 2, lastQuestion: { summary: true } });
    });

  it('punto 1: «Cambio: necesito 30 focos LED» reemplaza el producto y la cantidad', () => {
    closeWithSummary();
    const r = step('Cambio: necesito 30 focos LED', { producto: 'focos LED', cantidad: '30' });
    expect(r).toMatchObject({ reply: summaryOf('30 focos LED', 'luz neutra, para oficina y en Maipú'), rutUpdate: true });
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '30' });
    expect(r.captured.cantidad_varios).toBeUndefined();
    expect(r.captured.cambios).toEqual(['Producto: antes paneles LED 60x60, ahora focos LED', 'Cantidad: antes 20, ahora 30']);
  });

  it.each(['Necesito 10 focos LED para cambiar los del patio', 'Necesito 10 focos LED con cambio de color'])(
    'punto 1: «%s» no es una palabra de cambio: se suma como otro item, como antes', (body) => {
      closeWithSummary();
      const r = step(body, { producto: 'focos LED', cantidad: '10' });
      expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured.producto).toBe('paneles LED 60x60');
      expect(r.captured.cantidad_varios).toBe('paneles LED 60x60: 20 / ' + body);
    });

  it.each(['focos LED', 'Son focos LED'])('punto 2: después de «¿Qué dato corrijo?», «%s» reemplaza el producto en el mismo negocio', (body) => {
    closeWithSummary();
    expect(step('No').reply).toBe(flow.MSG_SUMMARY_FIX);
    const r = step(body, { producto: 'focos LED' });
    expect(r).toMatchObject({ reply: FOCOS_20, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '20' });
    expect(r.captured.cambios).toEqual(['Producto: antes paneles LED 60x60, ahora focos LED']);
    expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, summaryShown: 2 });
  });

  it.each(['focos LED', 'Cambio a focos LED', 'Actualizo: mejor focos LED', 'Son 20 focos LED'])(
    'punto 2: justo después del resumen, «%s» reemplaza el producto y muestra el resumen corregido', (body) => {
      closeWithSummary();
      const r = step(body, { producto: 'focos LED', ...(/\d/.test(body) ? { cantidad: '20' } : {}) });
      expect(r).toMatchObject({ reply: FOCOS_20, shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '20' });
      expect(r.captured.cantidad_varios).toBeUndefined();
    });

  it('punto 2: un «sí» con la familia («Sí, los focos») confirma: MSG4 sin cambiar el producto', () => {
    closeWithSummary();
    const r = step('Sí, los focos', { producto: 'focos LED' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
    expect(flow.getFlowState(PHONE).captured.producto).toBe('paneles LED 60x60');
  });

  it('punto 2: fuera del resumen sigue NO-PISAR: después del «sí», «focos LED» no cambia el producto', () => {
    closeWithSummary();
    expect(step('Sí').reply).toBe(flow.MSG4);
    const r = step('focos LED', { producto: 'focos LED' });
    expect(r.shouldCreateDeal).toBe(false);
    expect(flow.getFlowState(PHONE).captured).toMatchObject({ producto: 'paneles LED 60x60', cantidad: '20' });
  });

  it('punto 3: «Son 30 paneles y 10 focos» (pedido de 20 paneles) reemplaza la cantidad por la lista nueva', () => {
    closeWithSummary();
    const r = step('Son 30 paneles y 10 focos', { producto: 'paneles y focos' });
    expect(r).toMatchObject({ reply: summaryOf('30 paneles y 10 focos', 'luz neutra, para oficina y en Maipú'), shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('30 paneles y 10 focos');
    expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora varios items (30 paneles y 10 focos)']);
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  it.each<[string[], string]>([
    [['Son 15 focos y 8 paneles'], '15 focos y 8 paneles'],
    [['No', '15 focos y 8 paneles'], '15 focos y 8 paneles'],
    [['No, son 8 paneles y 15 focos'], '8 paneles y 15 focos'],
    [['Mejor 15 focos y 8 paneles'], '15 focos y 8 paneles'],
  ])('punto 3: con el ejemplo 2, %j reemplaza los items (no los suma ni los anexa)', (bodies, list) => {
    closeExample2();
    let r = step(bodies[0], bodies[0] === 'No' ? {} : { producto: 'focos y paneles' });
    if (bodies.length > 1) {
      expect(r.reply).toBe(flow.MSG_SUMMARY_FIX);
      r = step(bodies[1], { producto: 'focos y paneles' });
    }
    expect(r).toMatchObject({ reply: 'Te resumo: ' + list + ', luz fría, para bodega y en Quilicura. ¿Está bien?', shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.cantidad_varios).toBe(list);
    expect(r.captured.cambios).toHaveLength(1);
    expect(r.captured.cambios?.[0]).toMatch(new RegExp('^Cantidad: antes varios items \\(Necesito 12 focos LED y 5 paneles LED.*\\), ahora varios items \\(' + list + '\\)$'));
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  it.each(['También necesito 10 focos LED y 5 tubos LED', 'Agrega 10 focos LED y 5 tubos LED', 'Súmale 10 focos LED y 5 tubos LED', 'Otros 10 focos LED y 5 tubos LED'])(
    'punto 3: la adición explícita «%s» suma los items al pedido, como antes', (body) => {
      closeWithSummary();
      const r = step(body, { producto: 'focos LED y tubos LED' });
      expect(r).toMatchObject({ reply: summaryOf('20 paneles LED 60x60, 10 focos LED y 5 tubos LED', 'luz neutra, para oficina y en Maipú'), rutUpdate: true });
      expect(r.captured.producto).toBe('paneles LED 60x60');
      expect(r.captured.cantidad_varios).toBe('paneles LED 60x60: 20 / ' + body);
    });

  it('punto 3: la misma lista otra vez («Sí, 12 focos y 5 paneles») confirma: MSG4 sin escribir', () => {
    closeExample2();
    const before = flow.getFlowState(PHONE).captured;
    const r = step('Sí, 12 focos y 5 paneles', { producto: 'focos y paneles' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
    expect(flow.getFlowState(PHONE).captured).toEqual(before);
  });

  it.each<[string, Claude]>([
    ['Sí, mi casa está en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Gracias. Por si acaso, la bodega queda en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Pudahuel', { comuna_o_ciudad: 'Pudahuel' }],
    ['focos LED', { producto: 'focos LED' }],
    ['Son 30 paneles y 10 focos', { producto: 'paneles y focos' }],
  ])('punto 4: después del segundo resumen, «%s» (sin palabra de corrección) no cambia ningún dato; (ronda 4, A) queda textual en la nota', (body, claude) => {
    closeWithSecondSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step(body, claude);
    expect(r.reply).not.toContain('Te resumo');
    expectNoted(r, body, before);
  });

  it.each<[string, Claude, Record<string, string>]>([
    ['Está bien, pero mejor 25 paneles', { cantidad: '25' }, { cantidad: '25' }],
    ['Cambio a focos LED', { producto: 'focos LED' }, { producto: 'focos LED', cantidad: '30' }],
    ['Corrijo: Pudahuel', { comuna_o_ciudad: 'Pudahuel' }, { comuna_o_ciudad: 'Pudahuel' }],
  ])('punto 4: después del segundo resumen, con palabra de corrección («%s») sí se escribe, con MSG4', (body, claude, fields) => {
    closeWithSecondSummary();
    const r = step(body, claude);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true, captured: fields });
    expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, lastQuestion: null });
  });

  it('punto 4: sin el resumen a la vista se escriben solo los datos firmes: la cantidad con «al final», la comuna no', () => {
    closeWithSecondSummary();
    const r = step('Al final son 40. Mi bodega está en Pudahuel', { cantidad: '40', comuna_o_ciudad: 'Pudahuel' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ cantidad: '40', comuna_o_ciudad: 'Maipú' });
    // (ronda 4, A) La comuna que no se escribió queda textual en la nota.
    expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 30', 'Cantidad: antes 30, ahora 40', unapplied('Al final son 40. Mi bodega está en Pudahuel')]);
    expect(r.quietUpdate).toBe(true);
  });

  it.each(['c/u', 'urgentes', 'con garantía', 'certificados SEC', 'con certificación', 'según norma', 'DS1', 'D.S. N°1', 'homologados'])(
    'punto 5: «%s» en el texto de varios items: sin resumen', (extra) => {
      expect(flow.summaryMsg({ producto: 'paneles LED y focos LED', cantidad_varios: 'Necesito 10 paneles LED ' + extra + ' y 5 focos LED' })).toBeUndefined();
    });

  it('punto 5: lo que el corte de los pares deja fuera también cuenta («…, es urgente»)', () => {
    expect(flow.summaryMsg({ producto: 'paneles LED y focos LED', cantidad_varios: 'Necesito 10 paneles LED y 5 focos LED, es urgente' })).toBeUndefined();
    expect(flow.summaryMsg({ producto: 'paneles LED y focos LED', cantidad_varios: 'Necesito 10 paneles LED y 5 focos LED para la obra' }))
      .toBe('Te resumo: 10 paneles LED y 5 focos LED. ¿Está bien?');
  });

  it.each(['urgentes', 'con garantía', 'certificados SEC', 'norma DS1'])('punto 5: en un solo producto, «%s» tampoco se resume', (extra) => {
    expect(flow.summaryMsg({ producto: 'paneles LED ' + extra, cantidad: '10' })).toBeUndefined();
  });

  it('punto 5: por el flujo, «c/u» en el pedido de varios items recibe MSG4 como antes', () => {
    step('Necesito 10 paneles LED c/u y 5 focos LED para una bodega en Quilicura. ' + CONTACT,
      { producto: 'paneles LED y focos LED', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', ...CONTACT_CLAUDE });
    const r = step('no sé');
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(flow.getFlowState(PHONE).summaryShown).toBeUndefined();
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });
});

// Tercera revisión de la fase 3B (17-11-2026, verificación de 83fbe2f): los dos puntos de severidad media, cada uno con
// su caso literal; fallaban antes del arreglo.
describe('(revisión 17-11, ronda 3) el dato pedido con «¿Qué dato corrijo?» y la comuna con cortesía', () => {
  const PUDAHUEL = summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel');
  /** El pedido de los paneles con el segundo resumen ya mostrado («No, son 30»). */
  function closeWithSecondSummary() {
    closeWithSummary();
    expect(step('No, son 30', { cantidad: '30' }).reply).toBe(summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú'));
    expect(flow.getFlowState(PHONE).summaryShown).toBe(2);
  }

  it.each<[string, Claude, Record<string, string>, string]>([
    ['Pudahuel', { comuna_o_ciudad: 'Pudahuel' }, { comuna_o_ciudad: 'Pudahuel' }, 'Comuna/ciudad: antes Maipú, ahora Pudahuel'],
    ['40', { cantidad: '40' }, { cantidad: '40' }, 'Cantidad: antes 30, ahora 40'],
    ['luz fría', { tipo_de_luz: 'fría' }, { tipo_de_luz: 'fria' }, 'Tipo de luz: antes neutra, ahora fria'],
    ['focos LED', { producto: 'focos LED' }, { producto: 'focos LED', cantidad: '30' }, 'Producto: antes paneles LED 60x60, ahora focos LED'],
    ['es para un taller', { proyecto_o_uso: 'taller' }, { proyecto_o_uso: 'taller' }, 'Proyecto/uso: antes oficina, ahora taller'],
  ])('punto 1: después del segundo resumen, «No» y luego «%s» corrige el mismo negocio con MSG4', (body, claude, fields, line) => {
    closeWithSecondSummary();
    expect(step('No').reply).toBe(flow.MSG_SUMMARY_FIX);
    const r = step(body, claude);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true, closedFlow: true, captured: fields });
    expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 30', line]);
    expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, deal: 'registered', summaryShown: 2, lastQuestion: null });
    // Un «sí» después ya no contesta un resumen: el recordatorio corto, sin escribir otra vez.
    expect(step('Sí')).toMatchObject({ reply: flow.MSG_REGISTERED_SHORT, shouldCreateDeal: false });
  });

  it('punto 1: con Claude repitiendo el historial, solo cambia el dato que el cliente escribe', () => {
    closeWithSecondSummary();
    step('No');
    const r = step('Pudahuel', { ...PANELES_CLAUDE, cantidad: '30', comuna_o_ciudad: 'Pudahuel' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ producto: 'paneles LED 60x60', cantidad: '30', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Pudahuel' });
    expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 30', 'Comuna/ciudad: antes Maipú, ahora Pudahuel']);
  });

  it.each<[string, Claude]>([
    ['Gracias! mi otra casa está en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Mi cuñado vive en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Saludos desde Puente Alto', { comuna_o_ciudad: 'Puente Alto' }],
  ])('punto 1: después de «¿Qué dato corrijo?», un comentario («%s») sigue sin cambiar nada; (ronda 5, A) queda textual en la nota', (body, claude) => {
    closeWithSecondSummary();
    step('No');
    const before = flow.getFlowState(PHONE).captured;
    const r = step(body, claude);
    expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
    expectNoted(r, body, before);
  });

  const COURTESY = [
    'Pudahuel, gracias', 'Pudahuel por favor', 'Pudahuel 🙏', 'Pudahuel 👍', 'Pudahuel 👍🏽', 'Es en Pudahuel 😊',
    'En Pudahuel, gracias', 'Hola, es en Pudahuel', 'La dirección es en Pudahuel', 'Sí, pero en Pudahuel',
    'Sí, pero es en Pudahuel', 'Sí, y es en Pudahuel', 'Buenas tardes, la comuna es Pudahuel', 'Pudahuel, muchas gracias!!',
  ];
  it.each(COURTESY)('punto 2: justo después del resumen, «%s» corrige la comuna con el resumen corregido', (body) => {
    closeWithSummary();
    const r = step(body, { comuna_o_ciudad: 'Pudahuel' });
    expect(r).toMatchObject({ reply: PUDAHUEL, shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Pudahuel']);
    expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, summaryShown: 2, lastQuestion: { summary: true }, captured: { comuna_o_ciudad: 'Pudahuel' } });
  });

  it.each(COURTESY)('punto 2: después de «¿Qué dato corrijo?», «%s» corrige la comuna con el resumen corregido', (body) => {
    closeWithSummary();
    expect(step('No').reply).toBe(flow.MSG_SUMMARY_FIX);
    const r = step(body, { comuna_o_ciudad: 'Pudahuel' });
    expect(r).toMatchObject({ reply: PUDAHUEL, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Pudahuel']);
  });

  it.each(['Pudahuel, gracias', 'Hola, es en Pudahuel', 'Sí, pero en Pudahuel'])(
    'punto 2: después del segundo resumen y «¿Qué dato corrijo?», «%s» se escribe con MSG4', (body) => {
      closeWithSecondSummary();
      step('No');
      const r = step(body, { comuna_o_ciudad: 'Pudahuel' });
      expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true, captured: { comuna_o_ciudad: 'Pudahuel', cantidad: '30' } });
    });

  it.each<[string, Claude]>([
    ['Sí, y Pudahuel', { comuna_o_ciudad: 'Pudahuel' }],
    ['No es en Pudahuel', { comuna_o_ciudad: 'Pudahuel' }],
    ['Sí, gracias, estoy en Pudahuel ahora', { comuna_o_ciudad: 'Pudahuel' }],
    ['Estoy en Santiago', { comuna_o_ciudad: 'Santiago' }],
    ['Mi cuñado vive en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Gracias! mi otra casa está en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Sí, en Pudahuel también', { comuna_o_ciudad: 'Pudahuel' }],
  ])('punto 2: «%s» no es la comuna corregida: no cambia nada; (ronda 5, A) queda textual en la nota, sin aviso', (body, claude) => {
    closeWithSummary();
    const before = flow.getFlowState(PHONE).captured;
    const r = step(body, claude);
    expect(r.reply).not.toContain('Te resumo');
    expectNoted(r, body, before);
  });

  it('punto 2: después del segundo resumen (sin «¿Qué dato corrijo?») sigue la red de seguridad: «Pudahuel, gracias» no cambia la comuna (queda textual en la nota); «Corrijo: Pudahuel, gracias» sí', () => {
    closeWithSecondSummary();
    const before = flow.getFlowState(PHONE).captured;
    const soft = step('Pudahuel, gracias', { comuna_o_ciudad: 'Pudahuel' });
    expectNoted(soft, 'Pudahuel, gracias', before);
    flow.clearFlowState(PHONE);
    closeWithSecondSummary();
    const firm = step('Corrijo: Pudahuel, gracias', { comuna_o_ciudad: 'Pudahuel' });
    expect(firm).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true, captured: { comuna_o_ciudad: 'Pudahuel' } });
  });
});

// Cuarta ronda de la fase 3B (17-11-2026): la red de seguridad (A), la comuna corregida (B1), la aceptación con un dato
// (B2), la unidad que se conserva (B3), «en vez de» (B4) y los arreglos menores (C1 a C5).
describe('(ronda 4) la respuesta al resumen: red de seguridad, correcciones y arreglos menores', () => {
  const QUILICURA = 'Necesito 12 focos LED y 5 paneles LED para una bodega en Quilicura. ' + CONTACT;
  const QUILICURA_CLAUDE = { producto: 'focos LED y paneles LED', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', ...CONTACT_CLAUDE };
  const CINTA = 'Necesito 500 metros de cinta LED 220V luz fría, despacho a Lampa. ' + CONTACT;
  const CINTA_CLAUDE = { producto: 'cinta LED 220V', cantidad: '500', tipo_de_luz: 'fría', comuna_o_ciudad: 'Lampa', ...CONTACT_CLAUDE };
  const PANELS = (rest: string) => summaryOf('20 paneles LED 60x60', rest);
  /** El pedido de los paneles con el segundo resumen ya mostrado («No, son 30»). */
  function closeWithSecondSummary() {
    closeWithSummary();
    expect(step('No, son 30', { cantidad: '30' }).reply).toBe(summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú'));
  }
  /** El ejemplo 2 (focos y paneles, varios items) cerrado con su resumen (el color no se contesta). */
  function closeExample2() {
    step(QUILICURA, QUILICURA_CLAUDE);
    expect(step('no sé').reply).toBe(EXAMPLE_2);
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }
  /** El ejemplo 3 (500 m de cinta) cerrado con su resumen (el uso no se contesta). */
  function closeExample3() {
    step(CINTA, CINTA_CLAUDE);
    expect(step('no sé').reply).toBe(EXAMPLE_3);
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }

  describe('A: la respuesta que no se aplica entera queda textual en la nota del mismo negocio', () => {
    it.each<[string, Claude]>([
      ['Si, y 10 más', { cantidad: '10' }],
      ['Sí, pero que sean de 48W', {}],
      ['Si, pero que sean de 48W', {}],
      ['son 3 dormitorios y el living', {}],
    ])('«%s»: los datos no cambian y la nota lleva el texto', (body, claude) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      expectNoted(step(body, claude), body, before);
    });

    it('«25 por favor» después del segundo resumen: la nota textual, la cantidad sigue en 30', () => {
      closeWithSecondSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step('25 por favor', { cantidad: '25' });
      expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
      expectNoted(r, '25 por favor', before);
    });

    it('«No es oficina, es bodega»: se aplica (el resumen corregido y «Cambios:»), sin la línea textual', () => {
      closeWithSummary();
      const r = step('No es oficina, es bodega');
      expect(r).toMatchObject({ reply: PANELS('luz neutra, para bodega y en Maipú'), shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(['Proyecto/uso: antes oficina, ahora bodega']);
    });

    it.each<[string, string]>([
      ['Sí', flow.MSG4],
      ['no', flow.MSG_SUMMARY_FIX],
      ['¿Cuándo llega?', flow.MSG_WAIT],
    ])('«%s»: sin nota ni escritura', (body, reply) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r).toMatchObject({ reply, shouldCreateDeal: false });
      expect(flow.getFlowState(PHONE).captured).toEqual(before);
    });

    it('(ronda 5, A) «Gracias! mi otra casa está en Pirque»: la respuesta de siempre y la línea textual, sin aviso', () => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step('Gracias! mi otra casa está en Pirque');
      expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
      expectNoted(r, 'Gracias! mi otra casa está en Pirque', before);
    });

    it('«No» y luego «no»: MSG4 sin nota; «No» y luego «la cantidad»: MSG4 con la nota textual', () => {
      closeWithSummary();
      step('No');
      expect(step('no')).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
      flow.clearFlowState(PHONE);
      closeWithSummary();
      step('No');
      const before = flow.getFlowState(PHONE).captured;
      const r = step('la cantidad');
      expect(r.reply).toBe(flow.MSG4);
      expectNoted(r, 'la cantidad', before);
    });

    it('el texto va recortado a unos 300 caracteres y sin saltos de línea dobles', () => {
      closeWithSummary();
      const body = 'Si, y 10 más.\n\n' + 'Les cuento que la obra es grande y tiene varias etapas. '.repeat(10);
      const r = step(body, { cantidad: '10' });
      const line = r.captured.cambios?.at(-1) ?? '';
      expect(line.startsWith('Respuesta del cliente al resumen, sin aplicar (revisar): "Si, y 10 más. Les cuento')).toBe(true);
      expect(line.length).toBeLessThanOrEqual(300);
      expect(line).not.toMatch(/\n/);
      expect(line.endsWith('..."')).toBe(true);
      expect(r.captured).toMatchObject({ cantidad: '20' });
    });
  });

  describe('B1: la comuna corregida con palabra de corrección o negando la capturada', () => {
    const FIXES: Array<[string, string]> = [
      ['Me equivoqué, es en Pudahuel', 'Pudahuel'],
      ['Perdón, es en Pudahuel', 'Pudahuel'],
      ['Es en Pudahuel, no en Maipú', 'Pudahuel'],
      ['No es en Maipú, es en Pudahuel', 'Pudahuel'],
      ['No, en Maipú no. En La Florida', 'La Florida'],
      ['Maipú no, La Florida', 'La Florida'],
      ['en vez de Maipú es Pudahuel', 'Pudahuel'],
    ];
    it.each(FIXES)('justo después del resumen, «%s»: el resumen corregido', (body, comuna) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: PANELS('luz neutra, para oficina y en ' + comuna), shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora ' + comuna]);
      // La comuna negada no queda como otra comuna del pedido.
      expect(r.captured.comunas_otras ?? '').not.toContain('Maipú');
    });

    it.each(FIXES)('después de «¿Qué dato corrijo?», «%s»: el resumen corregido', (body, comuna) => {
      closeWithSummary();
      step('No');
      const r = step(body);
      expect(r).toMatchObject({ reply: PANELS('luz neutra, para oficina y en ' + comuna), shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora ' + comuna]);
    });

    it.each(FIXES)('después del segundo resumen, «%s»: MSG4 y la comuna en el mismo negocio', (body, comuna) => {
      closeWithSecondSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true, captured: { comuna_o_ciudad: comuna, cantidad: '30' } });
      expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 30', 'Comuna/ciudad: antes Maipú, ahora ' + comuna]);
    });

    it('ejemplo 2: «Quilicura no, Renca» corrige la comuna', () => {
      closeExample2();
      const r = step('Quilicura no, Renca');
      expect(r).toMatchObject({ reply: 'Te resumo: 12 focos LED y 5 paneles LED, para bodega y en Renca. ¿Está bien?', shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Quilicura, ahora Renca']);
    });

    it.each(['Mi cuñado vive en Pirque', 'mi otra casa está en Pirque', 'Saludos desde Pirque'])(
      '«%s» sigue sin cambiar nada, después del primer y del segundo resumen; (ronda 5, A) queda textual en la nota', (body) => {
        closeWithSummary();
        let before = flow.getFlowState(PHONE).captured;
        expectNoted(step(body, { comuna_o_ciudad: 'Pirque' }), body, before);
        flow.clearFlowState(PHONE);
        closeWithSecondSummary();
        before = flow.getFlowState(PHONE).captured;
        expectNoted(step(body, { comuna_o_ciudad: 'Pirque' }), body, before);
      });
  });

  describe('B2: la aceptación con un dato después', () => {
    it.each<[string, string]>([
      ['Sí, pero 30', '30'],
      ['si pero 30', '30'],
      ['ok, 30', '30'],
      ['Sí, 30', '30'],
      ['Está bien, pero 25', '25'],
      ['Sí. Que sean 30', '30'],
    ])('«%s»: en un pedido de un item, el número es la cantidad', (body, qty) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: summaryOf(qty + ' paneles LED 60x60', 'luz neutra, para oficina y en Maipú'), shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora ' + qty]);
    });

    it.each(['Si, y 10 más', 'Sí, y 5 más de repuesto'])('F7 «%s»: no se suma; queda textual en la nota', (body) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r.reply).toBe(flow.MSG4);
      expectNoted(r, body, before);
    });
  });

  describe('B3: la cantidad corregida sin unidad conserva los metros', () => {
    const CINTA_300 = 'Te resumo: 300 m de cinta LED 220V, luz fría y en Lampa. ¿Está bien?';
    it.each(['No, 300', '300', 'Son 300', 'mejor 300', 'Corrijo: 300', 'Necesito 300', 'No, 300 metros'])('«%s»: 300 m', (body) => {
      closeExample3();
      const r = step(body);
      expect(r).toMatchObject({ reply: CINTA_300, shouldCreateDeal: true, rutUpdate: true, captured: { cantidad: '300', cantidad_unidad: 'm' } });
      expect(r.captured.cambios).toEqual(['Cantidad: antes 500 m, ahora 300 m']);
    });

    it('«300» después de «¿Qué dato corrijo?»: 300 m', () => {
      closeExample3();
      step('No');
      const r = step('300');
      expect(r).toMatchObject({ reply: CINTA_300, captured: { cantidad: '300', cantidad_unidad: 'm' } });
      expect(r.captured.cambios).toEqual(['Cantidad: antes 500 m, ahora 300 m']);
    });

    it('«300 cinta LED» nunca sale en el resumen corregido', () => {
      for (const body of ['No, 300', '300', 'Corrijo: 300']) {
        flow.clearFlowState(PHONE);
        closeExample3();
        expect(step(body, { cantidad: '300' }).reply).not.toMatch(/\b300 cinta/);
      }
    });

    it.each(['No, 300 unidades', 'No, 300 rollos', 'Corrijo: son 3 rollos'])(
      'una unidad nueva explícita reemplaza los metros («%s»): sin «300 cinta LED», el cierre de siempre', (body) => {
        closeExample3();
        const r = step(body);
        expect(r.captured.cantidad_unidad).toBeUndefined();
        expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true });
        expect(r.captured.cambios?.[0]).toMatch(/^Cantidad: antes 500 m, ahora \d+$/);
      });

    it('el resumen nunca dice «300 cinta LED»: el producto por metro en singular necesita los metros (o 1)', () => {
      expect(flow.summaryMsg({ producto: 'cinta LED 220V', cantidad: '300' })).toBeUndefined();
      expect(flow.summaryMsg({ producto: 'tira LED', cantidad: '3' })).toBeUndefined();
      expect(flow.summaryMsg({ producto: 'cinta LED 220V', cantidad: '300', cantidad_unidad: 'm' })).toBe('Te resumo: 300 m de cinta LED 220V. ¿Está bien?');
      expect(flow.summaryMsg({ producto: 'cintas LED', cantidad: '3' })).toBe('Te resumo: 3 cintas LED. ¿Está bien?');
      expect(flow.summaryMsg({ producto: 'cinta LED', cantidad: '1' })).toBe('Te resumo: 1 cinta LED. ¿Está bien?');
    });
  });

  describe('B4: «en vez de», «en lugar de» y «no X sino Y» aplican solo lo nuevo', () => {
    it.each<[string, string, string[]]>([
      ['Necesito 20 focos LED en vez de paneles', '20 focos LED', ['Producto: antes paneles LED 60x60, ahora focos LED']],
      ['Necesito focos LED en lugar de paneles', '20 focos LED', ['Producto: antes paneles LED 60x60, ahora focos LED']],
      ['No 20 paneles sino 20 focos LED', '20 focos LED', ['Producto: antes paneles LED 60x60, ahora focos LED']],
      ['en vez de 20 paneles, 20 focos LED', '20 focos LED', ['Producto: antes paneles LED 60x60, ahora focos LED']],
      ['Necesito 30 focos LED en vez de paneles', '30 focos LED', ['Producto: antes paneles LED 60x60, ahora focos LED', 'Cantidad: antes 20, ahora 30']],
    ])('«%s»: %s', (body, items, cambios) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: summaryOf(items, 'luz neutra, para oficina y en Maipú'), shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured.cambios).toEqual(cambios);
      expect(r.captured.cantidad_varios).toBeUndefined();
    });

    it('ejemplo 2: «En vez de 12 focos y 5 paneles, 15 focos y 8 paneles»: la lista nueva sola', () => {
      closeExample2();
      const r = step('En vez de 12 focos y 5 paneles, 15 focos y 8 paneles');
      expect(r.reply).toBe('Te resumo: 15 focos y 8 paneles, para bodega y en Quilicura. ¿Está bien?');
      expect(r.captured.cantidad_varios).toBe('15 focos y 8 paneles');
    });
  });

  describe('C1 a C5: cortesía, el dato que está mal, «para cambiar», el resumen inseguro y el color de un item', () => {
    it.each<[string, Record<string, string>, string]>([
      ['25, gracias', { cantidad: '25' }, summaryOf('25 paneles LED 60x60', 'luz neutra, para oficina y en Maipú')],
      ['25 👍', { cantidad: '25' }, summaryOf('25 paneles LED 60x60', 'luz neutra, para oficina y en Maipú')],
      ['25 por favor', { cantidad: '25' }, summaryOf('25 paneles LED 60x60', 'luz neutra, para oficina y en Maipú')],
      ['30 por favor', { cantidad: '30' }, summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú')],
      ['Perdón, la luz es cálida', { tipo_de_luz: 'calida' }, PANELS('luz cálida, para oficina y en Maipú')],
    ])('C1 «%s»: el dato con cortesía, justo después del resumen y después de «¿Qué dato corrijo?»', (body, fields, reply) => {
      closeWithSummary();
      expect(step(body)).toMatchObject({ reply, shouldCreateDeal: true, rutUpdate: true, captured: fields });
      flow.clearFlowState(PHONE);
      closeWithSummary();
      step('No');
      expect(step(body)).toMatchObject({ reply, shouldCreateDeal: true, rutUpdate: true, captured: fields });
    });

    it.each(['No está bien la cantidad', 'la cantidad está mal', 'La comuna está mal', 'la cantidad'])('C2 «%s»: «¿Qué dato corrijo?»', (body) => {
      closeWithSummary();
      expect(step(body)).toMatchObject({ reply: flow.MSG_SUMMARY_FIX, shouldCreateDeal: false });
      expect(flow.getFlowState(PHONE).lastQuestion).toMatchObject({ summary: true, summaryFix: true });
    });

    it('C3 «para cambiar los del patio» no es una corrección: el uso sigue siendo la oficina', () => {
      closeWithSummary();
      const r = step('Necesito 10 focos LED para cambiar los del patio');
      expect(r.captured.proyecto_o_uso).toBe('oficina');
      expect(r.captured.cambios ?? []).not.toContain('Proyecto/uso: antes oficina, ahora patio');
    });

    it.each([
      'inaugurar el lunes', 'una oficina que abre el viernes 20', 'entregar a fin de mes', 'un local que abre en 2 días', 'entrega el 20/11',
      'presupuesto de 500 lucas', 'menos de 300 mil pesos', 'precio con IVA', 'un 10% menos', 'el dcto de la web', 'la promo de noviembre',
      'la promoción', 'la liquidación', 'garantizado', 'certificado DS43', 'sello ENEC', 'un regalo', '2 de cada uno',
    ])('C4 el resumen no repite «%s»: no hay resumen (el cierre de siempre)', (uso) => {
      expect(flow.summaryMsg({ producto: 'focos LED', cantidad: '12', proyecto_o_uso: uso })).toBeUndefined();
    });

    it('C4 el resumen normal sigue igual con medidas y potencias', () => {
      expect(flow.summaryMsg({ producto: 'paneles LED 60x60', cantidad: '20', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Maipú' })).toBe(EXAMPLE_1);
      expect(flow.summaryMsg({ producto: 'focos LED 50W', cantidad: '8', proyecto_o_uso: 'bodega de 200 m2' })).toBe('Te resumo: 8 focos LED 50W y para bodega de 200 m2. ¿Está bien?');
    });

    it.each(['Los focos son cálidos', 'luz neutra para los paneles'])('C5 «%s» en un pedido de varios items: el color del pedido no cambia y queda en la nota', (body) => {
      closeExample2();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r.reply).not.toContain('luz');
      expectNoted(r, body, before);
    });

    it('C5 «Luz cálida» sin nombrar un item: el color de todo el pedido', () => {
      closeExample2();
      const r = step('Luz cálida');
      expect(r).toMatchObject({ reply: 'Te resumo: 12 focos LED y 5 paneles LED, luz cálida, para bodega y en Quilicura. ¿Está bien?', shouldCreateDeal: true, rutUpdate: true });
    });
  });
});

// Quinta ronda de la fase 3B (17-11-2026): la red de seguridad al revés (A), la aplicación parcial (B) y los datos que el
// resumen corregido ahora entiende (C1 a C6) o deja en la línea (C7). Solo datos inventados.
describe('(ronda 5) la respuesta al resumen: todo lo que no se aplica entero queda en la nota', () => {
  const QUILICURA = 'Necesito 12 focos LED y 5 paneles LED para una bodega en Quilicura. ' + CONTACT;
  const QUILICURA_CLAUDE = { producto: 'focos LED y paneles LED', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', ...CONTACT_CLAUDE };
  const CINTA = 'Necesito 500 metros de cinta LED 220V luz fría, despacho a Lampa. ' + CONTACT;
  const CINTA_CLAUDE = { producto: 'cinta LED 220V', cantidad: '500', tipo_de_luz: 'fría', comuna_o_ciudad: 'Lampa', ...CONTACT_CLAUDE };
  const PANELS = (items: string, rest = 'luz neutra, para oficina y en Maipú') => summaryOf(items, rest);
  const ITEMS = (items: string, comuna = 'Quilicura') => 'Te resumo: ' + items + ', para bodega y en ' + comuna + '. ¿Está bien?';
  function closeWithSecondSummary() {
    closeWithSummary();
    expect(step('No, son 30', { cantidad: '30' }).reply).toBe(PANELS('30 paneles LED 60x60'));
  }
  function closeExample2() {
    step(QUILICURA, QUILICURA_CLAUDE);
    expect(step('no sé').reply).toBe(EXAMPLE_2);
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }
  function closeExample3() {
    step(CINTA, CINTA_CLAUDE);
    expect(step('no sé').reply).toBe(EXAMPLE_3);
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }
  /** La lista de varios items quedó en el mismo negocio con su línea de «Cambios:». */
  function expectItems(r: ReturnType<typeof step>, items: string) {
    expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true, quietUpdate: true, closedFlow: true });
    expect(r.captured.cantidad_varios).toBe(items);
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cambios?.[0]?.endsWith(', ahora varios items (' + items + ')')).toBe(true);
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  }

  describe('A: lo que no es una respuesta excluida es contenido; con residuo, la línea textual sin aviso', () => {
    it.each<[string, string]>([
      ['Es para la oficina del segundo piso', flow.MSG_REGISTERED_SHORT],
      ['Necesito los paneles para el lunes', flow.MSG_REGISTERED_SHORT],
      ['luz blanca', flow.MSG_REGISTERED_SHORT],
      ['48W', flow.MSG_REGISTERED_SHORT],
      ['2 cajas', flow.MSG_REGISTERED_SHORT],
      ['Estoy en Renca', flow.MSG_REGISTERED_SHORT],
      ['No es en Maipú', flow.MSG_REGISTERED_SHORT],
      ['No es en Pudahuel', flow.MSG_REGISTERED_SHORT],
      ['No es un colegio', flow.MSG_REGISTERED_SHORT],
      ['Sí, pero con sensor', flow.MSG4],
      ['Sí, sin sensor', flow.MSG4],
      ['Si, y 10 más', flow.MSG4],
      ['¿Y si mejor en Renca?', flow.MSG_REGISTERED_SHORT],
      ['Lo retiro en Quinta Normal', flow.MSG_WAIT_DELIVERY],
    ])('«%s»: la respuesta de siempre, los datos iguales y la línea en el mismo negocio', (body, reply) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r.reply).toBe(reply);
      expectNoted(r, body, before);
    });

    it.each(['Sí', 'Ok perfecto', 'Sí, gracias', 'Sí, no hay problema', 'Ok, sin problema', 'Ok, no te preocupes', 'Sí, cotizar'])(
      '«%s» (el sí de la lista cerrada, con cortesía): MSG4 sin línea ni escritura', (body) => {
        closeWithSummary();
        const before = flow.getFlowState(PHONE).captured;
        const r = step(body);
        expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
        expect(flow.getFlowState(PHONE).captured).toEqual(before);
      });

    it('excluidos: «No» pide el dato; la pregunta sin dato, la foto, el correo y el RUT tardío siguen su camino, sin la línea', () => {
      closeWithSummary();
      expect(step('No')).toMatchObject({ reply: flow.MSG_SUMMARY_FIX, shouldCreateDeal: false });
      flow.clearFlowState(PHONE);
      closeWithSummary();
      expect(step('¿Cuándo llega?')).toMatchObject({ reply: flow.MSG_WAIT, shouldCreateDeal: false });
      flow.clearFlowState(PHONE);
      closeWithSummary();
      expect(flow.recordMediaReply(PHONE, ['image/jpeg'])).toBe(flow.MSG_MEDIA_NOTICE + '\n\n' + flow.MSG_MEDIA_PENDING);
      expect(flow.getFlowState(PHONE).captured.cambios).toBeUndefined();
      flow.clearFlowState(PHONE);
      closeWithSummary();
      const mail = step('mi correo correcto es ana.otra@example.com', { correo: 'ana.otra@example.com' });
      expect(mail).toMatchObject({ reply: flow.MSG4, rutUpdate: true });
      expect(mail.captured.cambios ?? []).not.toContainEqual(expect.stringContaining('sin aplicar'));
      flow.clearFlowState(PHONE);
      closeWithSummary();
      const rut = step('RUT 77.123.456-9');
      expect(rut.captured.cambios ?? []).not.toContainEqual(expect.stringContaining('sin aplicar'));
    });

    it('el pedido nuevo explícito («¿Me pueden cotizar 30 focos más?») abre otra conversación, sin la línea', () => {
      closeWithSummary();
      const r = step('¿Me pueden cotizar 30 focos más?', { producto: 'focos', cantidad: '30' });
      expect(r).toMatchObject({ closedFlow: false, shouldCreateDeal: false });
      expect(r.captured.cambios ?? []).toEqual([]);
    });
  });

  describe('B: aplicado en parte: MSG4, los cambios y la línea, sin el resumen corregido', () => {
    it.each<[string, string, string]>([
      ['Que sean 30 de 48W', '30', 'Cantidad: antes 20, ahora 30'],
      ['Ok. Mi jefe dice que mejor sean 50', '50', 'Cantidad: antes 20, ahora 50'],
    ])('«%s»', (body, cantidad, line) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true, quietUpdate: true, captured: { cantidad } });
      expect(r.captured.cambios).toEqual([line, unapplied(body)]);
      expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, summaryShown: 1, lastQuestion: null });
    });

    it('aplicado entero, el resumen corregido sin la línea («Que sean 30 y en Pudahuel»)', () => {
      closeWithSummary();
      const r = step('Que sean 30 y en Pudahuel');
      expect(r).toMatchObject({ reply: PANELS('30 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel'), shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 30', 'Comuna/ciudad: antes Maipú, ahora Pudahuel']);
    });
  });

  describe('C1: la comuna dicha como destino', () => {
    it.each(['Lo necesito en Renca', 'Va para Renca', 'Sí, pero mejor en Renca'])('«%s»: el resumen corregido', (body) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: PANELS('20 paneles LED 60x60', 'luz neutra, para oficina y en Renca'), shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Renca']);
      expect(r.captured.comunas_otras ?? '').not.toContain('Renca');
    });

    it.each(['Mi cuñado vive en Renca', 'Saludos desde Renca', 'Estoy en Renca', 'Antes era en Renca'])('«%s» (otra persona u otro lugar): la línea', (body) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      expectNoted(step(body), body, before);
    });

    it('después del segundo resumen, «Lo necesito en Renca» solo deja la línea (sin palabra de corrección)', () => {
      closeWithSecondSummary();
      const before = flow.getFlowState(PHONE).captured;
      expectNoted(step('Lo necesito en Renca'), 'Lo necesito en Renca', before);
    });
  });

  describe('C2: la cantidad en palabras', () => {
    it.each<[string, string]>([['treinta', '30'], ['Son veinticinco', '25'], ['una docena', '12'], ['cuarenta y cinco', '45'], ['cien', '100'], ['Son treinta paneles', '30']])(
      '«%s»: %s', (body, cantidad) => {
        closeWithSummary();
        const r = step(body);
        expect(r).toMatchObject({ reply: PANELS(cantidad + ' paneles LED 60x60'), shouldCreateDeal: true, rutUpdate: true, quietUpdate: true, captured: { cantidad } });
        expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora ' + cantidad]);
      });

    it('«trescientos metros» en la cinta: 300 m', () => {
      closeExample3();
      const r = step('trescientos metros');
      expect(r).toMatchObject({ reply: 'Te resumo: 300 m de cinta LED 220V, luz fría y en Lampa. ¿Está bien?', captured: { cantidad: '300', cantidad_unidad: 'm' } });
    });
  });

  describe('C3: el uso sin «para»', () => {
    it.each<[string, string]>([['Colegio', 'Colegio'], ['Es un colegio', 'colegio'], ['uso: colegio', 'colegio'], ['Es una bodega', 'bodega']])('«%s»', (body, uso) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: PANELS('20 paneles LED 60x60', 'luz neutra, para ' + uso + ' y en Maipú'), shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(['Proyecto/uso: antes oficina, ahora ' + uso]);
    });

    it('«son 3 dormitorios y el living» no es un uso: la línea', () => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      expectNoted(step('son 3 dormitorios y el living'), 'son 3 dormitorios y el living', before);
    });
  });

  describe('C4: varios datos en un mensaje', () => {
    it.each<[string, string, string[]]>([
      ['Son 30 paneles para Pudahuel', PANELS('30 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel'), ['Cantidad: antes 20, ahora 30', 'Comuna/ciudad: antes Maipú, ahora Pudahuel']],
      ['30, en Pudahuel', PANELS('30 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel'), ['Cantidad: antes 20, ahora 30', 'Comuna/ciudad: antes Maipú, ahora Pudahuel']],
      ['Para un taller y es en Renca', PANELS('20 paneles LED 60x60', 'luz neutra, para taller y en Renca'), ['Proyecto/uso: antes oficina, ahora taller', 'Comuna/ciudad: antes Maipú, ahora Renca']],
    ])('«%s»', (body, reply, cambios) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply, shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(cambios);
    });
  });

  describe('C5: el cambio de un item en una lista de varios', () => {
    it.each<[string, string, string?]>([
      ['En vez de 5 paneles, 8 paneles', '12 focos LED y 8 paneles LED'],
      ['No son 12 focos, son 15', '15 focos LED y 5 paneles LED'],
      ['Los focos son 15 y los paneles 8', '15 focos LED y 8 paneles LED'],
      ['focos 15 paneles 8', '15 focos LED y 8 paneles LED'],
      ['8 paneles y en Renca', '12 focos LED y 8 paneles LED', 'Renca'],
      ['Los focos son 15, los paneles 8 y es en Renca', '15 focos LED y 8 paneles LED', 'Renca'],
    ])('«%s»: solo ese item, con el resumen corregido', (body, items, comuna) => {
      closeExample2();
      const r = step(body);
      expect(r.reply).toBe(ITEMS(items, comuna));
      expectItems(r, items);
      expect(r.captured.producto).toBe('focos LED y paneles LED');
    });

    it.each(['No, 15', '15', 'Son 15 luminarias', 'Son 30 unidades', 'Necesito 5 focos LED para el patio', '10 rollos de 5 metros'])(
      '«%s» (no se sabe a qué item va): MSG4 y la línea, sin sumar otro item', (body) => {
        closeExample2();
        const before = flow.getFlowState(PHONE).captured;
        const r = step(body);
        expect(r.reply).toBe(flow.MSG4);
        expectNoted(r, body, before);
      });
  });

  describe('C6: todo lo que se escribe con el resumen pendiente va sin aviso', () => {
    it.each(['No, 12 focos y 5 paneles', 'No, 12 focos LED c/u a $3.000 y 5 paneles'])('«%s» en los paneles: la lista, sin aviso', (body) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cantidad_varios).toBe(body.replace(/^No, /, ''));
    });

    it.each(['No, 12 focos y 5 paneles', 'No, 12 focos LED c/u a $3.000 y 5 paneles'])('«%s» en el ejemplo 2: la línea sin sumar otro item, sin aviso', (body) => {
      closeExample2();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
      expectNoted(r, body, before);
      expect(r.captured.cantidad_varios).not.toContain(' / ');
    });
  });

  describe('C7: lo que sigue yendo a la línea', () => {
    it.each(['3 rollos', '2 cajas', '300 unidades', '10 rollos de 5 metros'])('«%s» en la cinta: la línea, los metros iguales', (body) => {
      closeExample3();
      const before = flow.getFlowState(PHONE).captured;
      expectNoted(step(body), body, before);
    });

    it('el color de cada item («Los focos cálidos y los paneles fríos»): la línea', () => {
      closeExample2();
      const before = flow.getFlowState(PHONE).captured;
      expectNoted(step('Los focos cálidos y los paneles fríos'), 'Los focos cálidos y los paneles fríos', before);
    });
  });

  describe('regresiones: lo que ya funcionaba sigue igual', () => {
    it.each<[string, string, string[]]>([
      ['No, son 30', PANELS('30 paneles LED 60x60'), ['Cantidad: antes 20, ahora 30']],
      ['Está bien, pero mejor 25 paneles', PANELS('25 paneles LED 60x60'), ['Cantidad: antes 20, ahora 25']],
      ['Es en Pudahuel, no en Maipú', PANELS('20 paneles LED 60x60', 'luz neutra, para oficina y en Pudahuel'), ['Comuna/ciudad: antes Maipú, ahora Pudahuel']],
      ['Maipú no, La Florida', PANELS('20 paneles LED 60x60', 'luz neutra, para oficina y en La Florida'), ['Comuna/ciudad: antes Maipú, ahora La Florida']],
      ['Cambio: necesito 20 focos LED', PANELS('20 focos LED'), ['Producto: antes paneles LED 60x60, ahora focos LED']],
      ['Necesito 20 focos LED en vez de paneles', PANELS('20 focos LED'), ['Producto: antes paneles LED 60x60, ahora focos LED']],
      ['Son 30 paneles y 10 focos', PANELS('30 paneles y 10 focos'), ['Cantidad: antes 20, ahora varios items (30 paneles y 10 focos)']],
    ])('«%s»: el resumen corregido de siempre, sin la línea', (body, reply, cambios) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply, shouldCreateDeal: true, rutUpdate: true, quietUpdate: true });
      expect(r.captured.cambios).toEqual(cambios);
    });

    it('«No, 300» en la cinta: 300 m con el resumen corregido', () => {
      closeExample3();
      expect(step('No, 300')).toMatchObject({ reply: 'Te resumo: 300 m de cinta LED 220V, luz fría y en Lampa. ¿Está bien?', captured: { cantidad: '300', cantidad_unidad: 'm' } });
    });

    it('«También necesito 10 focos LED» suma el item con el resumen corregido', () => {
      closeWithSummary();
      expect(step('También necesito 10 focos LED', { producto: 'focos LED', cantidad: '10' }).reply).toBe(PANELS('20 paneles LED 60x60 y 10 focos LED'));
    });
  });
});

describe('(ronda 6) sumas con el mismo número, el dato rechazado sin el nuevo y las bajas', () => {
  const QUILICURA = 'Necesito 12 focos LED y 5 paneles LED para una bodega en Quilicura. ' + CONTACT;
  const QUILICURA_CLAUDE = { producto: 'focos LED y paneles LED', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', ...CONTACT_CLAUDE };
  const CINTA = 'Necesito 500 metros de cinta LED 220V luz fría, despacho a Lampa. ' + CONTACT;
  const CINTA_CLAUDE = { producto: 'cinta LED 220V', cantidad: '500', tipo_de_luz: 'fría', comuna_o_ciudad: 'Lampa', ...CONTACT_CLAUDE };
  const TUBOS = 'Necesito 30 tubos LED. ' + CONTACT;
  const TUBOS_CLAUDE = { producto: 'tubos LED', cantidad: '30', ...CONTACT_CLAUDE };
  const CONTEXTS: Record<string, () => void> = {
    paneles: closeWithSummary,
    segundo: () => {
      closeWithSummary();
      expect(step('No, son 30', { cantidad: '30' }).reply).toBe(summaryOf('30 paneles LED 60x60', 'luz neutra, para oficina y en Maipú'));
    },
    corrijo: () => {
      closeWithSummary();
      expect(step('No').reply).toBe(flow.MSG_SUMMARY_FIX);
    },
    items: () => {
      step(QUILICURA, QUILICURA_CLAUDE);
      expect(step('no sé').reply).toBe(EXAMPLE_2);
      flow.recordDealOutcome(PHONE, true, undefined, 4242);
    },
    cinta: () => {
      step(CINTA, CINTA_CLAUDE);
      expect(step('no sé').reply).toBe(EXAMPLE_3);
      flow.recordDealOutcome(PHONE, true, undefined, 4242);
    },
    tubos: () => {
      step(TUBOS, TUBOS_CLAUDE);
      step('no sé');
      expect(step('no sé').reply).toBe(EXAMPLE_4);
      flow.recordDealOutcome(PHONE, true, undefined, 4242);
    },
  };

  describe('A: la suma con el número que ya estaba queda textual en el mismo negocio (F7 no se suma)', () => {
    it.each<[string, string, string]>([
      ['paneles', '20 más', flow.MSG_REGISTERED_SHORT],
      ['paneles', 'Y 20 más', flow.MSG_REGISTERED_SHORT],
      ['paneles', 'Sí, y 20 más', flow.MSG4],
      ['paneles', 'Otros 20', flow.MSG_REGISTERED_SHORT],
      ['paneles', 'Necesito otros 20', flow.MSG_REGISTERED_SHORT],
      ['paneles', 'Necesito 20 más', flow.MSG_REGISTERED_SHORT],
      ['paneles', '20 más por favor', flow.MSG_REGISTERED_SHORT],
      ['paneles', 'Agrega 20', flow.MSG_REGISTERED_SHORT],
      ['paneles', 'Agrega 20 más', flow.MSG_REGISTERED_SHORT],
      ['paneles', 'Además otros 20', flow.MSG_REGISTERED_SHORT],
      ['paneles', '20 por oficina', flow.MSG_REGISTERED_SHORT],
      ['segundo', '30 más', flow.MSG_REGISTERED_SHORT],
      ['corrijo', 'Otros 20', flow.MSG_REGISTERED_SHORT],
      ['items', '5 más', flow.MSG_REGISTERED_SHORT],
      ['items', 'Otros 5', flow.MSG_REGISTERED_SHORT],
      ['items', '12 más', flow.MSG_REGISTERED_SHORT],
      ['cinta', '500 metros más', flow.MSG_REGISTERED_SHORT],
      ['cinta', 'Otros 500', flow.MSG_REGISTERED_SHORT],
      ['tubos', '30 más', flow.MSG_REGISTERED_SHORT],
    ])('%s: «%s» responde lo de siempre y deja la línea, sin cambiar datos', (ctx, body, reply) => {
      CONTEXTS[ctx]();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r.reply).toBe(reply);
      expectNoted(r, body, before);
    });

    it('con otro número sigue igual (F7), y otro producto se suma como item, sin la línea', () => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step('Si, y 10 más');
      expect(r.reply).toBe(flow.MSG4);
      expectNoted(r, 'Si, y 10 más', before);
      flow.clearFlowState(PHONE);
      closeWithSummary();
      const added = step('Agrega 5 tubos LED');
      expect(added.reply).toBe(summaryOf('20 paneles LED 60x60 y 5 tubos LED', 'luz neutra, para oficina y en Maipú'));
      expect(added.captured.cambios ?? []).not.toContainEqual(expect.stringContaining('sin aplicar'));
    });

    it('«20 por favor» y «Sí, nada más» no suman: sin línea', () => {
      closeWithSummary();
      expect(step('20 por favor')).toMatchObject({ reply: flow.MSG_REGISTERED_SHORT, shouldCreateDeal: false });
      flow.clearFlowState(PHONE);
      closeWithSummary();
      expect(step('Sí, nada más')).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
    });
  });

  describe('B: el dato rechazado por su nombre, sin el nuevo, pide el dato como «<dato> está mal»', () => {
    it.each<[string, string]>([
      ['paneles', 'La comuna no'], ['paneles', 'La luz no'], ['paneles', 'No es esa comuna'], ['paneles', 'Esa no es la comuna'],
      ['paneles', 'La comuna es otra'], ['paneles', 'Es otra comuna'], ['paneles', 'Otra cantidad'], ['paneles', 'Otro tipo de luz'],
      ['paneles', 'Otro color'], ['paneles', 'Otro producto'], ['paneles', 'La cantidad no es esa'], ['paneles', 'El uso no'],
      ['items', 'Los paneles no'], ['items', 'Los focos no'], ['paneles', 'Todo bien salvo la comuna'],
      ['paneles', 'Todo bien excepto la cantidad'], ['paneles', 'Todo bien salvo la luz'], ['paneles', 'Sí, salvo la luz'],
      ['items', 'Todo bien salvo los paneles'], ['paneles', 'Está bien pero el color no'], ['paneles', 'Sí, pero la comuna no'],
      ['paneles', 'Sí, pero otra comuna'], ['paneles', 'Sí, pero otro color'], ['segundo', 'La comuna no'],
    ])('%s: «%s»: «¿Qué dato corrijo?», sin escribir; un segundo rechazo sin dato, MSG4 y la línea', (ctx, body) => {
      CONTEXTS[ctx]();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r).toMatchObject({ reply: flow.MSG_SUMMARY_FIX, shouldCreateDeal: false });
      expect(flow.getFlowState(PHONE).captured).toEqual(before);
      expect(flow.getFlowState(PHONE).lastQuestion).toMatchObject({ summary: true, summaryFix: true });
      const again = step(body);
      expect(again.reply).toBe(flow.MSG4);
      expectNoted(again, body, before);
    });

    it('después de «¿Qué dato corrijo?», el dato nuevo corrige con el resumen; con el dato en el mismo mensaje, también', () => {
      closeWithSummary();
      expect(step('La comuna no').reply).toBe(flow.MSG_SUMMARY_FIX);
      expect(step('Renca').reply).toBe(summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Renca'));
      for (const body of ['La comuna no es Maipú, es Renca', 'No es esa comuna, es Renca', 'Otra comuna: Renca', 'Todo bien salvo la comuna, es Renca']) {
        flow.clearFlowState(PHONE);
        closeWithSummary();
        const r = step(body);
        expect(r.reply).toBe(summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Renca'));
        expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Renca']);
      }
    });

    it('«Mi cuñado vive en otra comuna» no rechaza la comuna: la línea, como siempre', () => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step('Mi cuñado vive en otra comuna');
      expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
      expectNoted(r, 'Mi cuñado vive en otra comuna', before);
    });
  });

  describe('C: el rechazo de un dato con otro dato que sí se aplica es aplicación parcial', () => {
    it.each<[string, string]>([
      ['La comuna no, y luz fría', 'Tipo de luz: antes neutra, ahora fria'],
      ['Luz fría, la comuna no', 'Tipo de luz: antes neutra, ahora fria'],
      ['Todo bien salvo la comuna, es para un colegio', 'Proyecto/uso: antes oficina, ahora colegio'],
    ])('«%s»: MSG4, «Cambios:» con lo aplicado y la línea, nunca un resumen con la comuna rechazada', (body, line) => {
      closeWithSummary();
      const r = step(body);
      expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, rutUpdate: true, quietUpdate: true, captured: { comuna_o_ciudad: 'Maipú' } });
      expect(r.captured.cambios).toEqual([line, unapplied(body)]);
      expect(flow.getFlowState(PHONE)).toMatchObject({ dealId: 4242, summaryShown: 1, lastQuestion: null });
    });
  });

  describe('D: bajas', () => {
    it.each(['nop', 'No po', 'nope', 'NOP'])('«%s» es un «no» solo', (body) => {
      closeWithSummary();
      expect(step(body)).toMatchObject({ reply: flow.MSG_SUMMARY_FIX, shouldCreateDeal: false });
      expect(step(body)).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: false });
    });

    it.each(['No, gracias', 'No gracias', 'Ya no', 'Mejor no', 'No lo necesito', 'Ya no quiero', 'Creo que no', 'Ninguno'])(
      '«%s» (posible cancelación): la respuesta de siempre y la línea para el vendedor', (body) => {
        closeWithSummary();
        const before = flow.getFlowState(PHONE).captured;
        const r = step(body);
        expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
        expectNoted(r, body, before);
      });
  });
});

describe('(ronda 7) el rechazo con un dato que no se reconoce y los rechazos generales por el nombre del campo', () => {
  const PANELES_REST = 'luz neutra, para oficina y en Maipú';
  describe('A: «sin dato» solo si el resto queda vacío y Claude no trae otro valor', () => {
    it.each([
      'Otro color: blanco', 'La luz no, blanca', 'Otro color, amarilla', 'El color no, luz día', 'La luz no, la más blanca',
      'El color no, la quiero dimerizable', 'La comuna no, Til-Til', 'Salvo la comuna, que es Til Til', 'Otro lugar: la región de Los Lagos',
      'Otro uso, iluminación de fachada', 'La cantidad no, un par', 'La cantidad no, el doble',
    ])('«%s» no pide el dato: queda textual en el mismo negocio', (body) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step(body);
      expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
      expectNoted(r, body, before);
    });

    it('lo que se reconoce se aplica: «La comuna no, es Stgo centro» corrige a Santiago con el resumen', () => {
      closeWithSummary();
      const r = step('La comuna no, es Stgo centro');
      expect(r).toMatchObject({ reply: summaryOf('20 paneles LED 60x60', 'luz neutra, para oficina y en Santiago'), shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Santiago']);
    });

    it('con el valor nuevo de Claude para el campo rechazado no pide el dato', () => {
      closeWithSummary();
      const r = step('La comuna no', { comuna_o_ciudad: 'Renca' });
      expect(r.reply).not.toBe(flow.MSG_SUMMARY_FIX);
      expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true });
    });

    it('sin resto ni valor de Claude sigue pidiendo el dato (ronda 6)', () => {
      closeWithSummary();
      expect(step('La comuna no', { comuna_o_ciudad: 'Maipú' }).reply).toBe(flow.MSG_SUMMARY_FIX);
    });
  });

  describe('B: los rechazos generales por el nombre del campo', () => {
    it.each([
      'Es en otra comuna', 'Va a otra comuna', 'Es para otra comuna', 'Queda en otra comuna', 'No es esa la comuna', 'No es esa la cantidad',
      'No es ese el color', 'No es esa la luz', 'No era esa la comuna', 'Es otra la comuna', 'No es en esa comuna', 'Es en otro lugar',
      'No es así la cantidad', 'Son otros paneles', 'Cambia la comuna', 'Cambiar la comuna', 'Corrige la comuna', 'Me equivoqué en la comuna',
      'Error en la comuna', 'Hay un error en la cantidad', 'La comuna, no', 'La comuna es distinta', 'Diferente comuna', 'Hay que cambiar la comuna',
    ])('«%s» pide el dato («¿Qué dato corrijo?») sin escribir; el segundo, MSG4 con la línea', (body) => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      expect(step(body)).toMatchObject({ reply: flow.MSG_SUMMARY_FIX, shouldCreateDeal: false });
      expect(flow.getFlowState(PHONE).captured).toEqual(before);
      const again = step(body);
      expect(again.reply).toBe(flow.MSG4);
      expectNoted(again, body, before);
    });

    it.each(['¿Y si es otra comuna?', '¿Sería otro color?'])('la pregunta hipotética «%s» no pide el dato', (body) => {
      closeWithSummary();
      const r = step(body);
      expect(r.reply).not.toBe(flow.MSG_SUMMARY_FIX);
      expect(r.shouldCreateDeal).toBe(false);
    });

    it.each<[string, string, string]>([
      ['Otra cantidad: 35', '35 paneles LED 60x60', PANELES_REST],
      ['Otra comuna: Renca', '20 paneles LED 60x60', 'luz neutra, para oficina y en Renca'],
    ])('«%s» cambia ese campo (no suma): resumen corregido, sin línea', (body, items, rest) => {
      closeWithSummary();
      const r = step(body);
      expect(r.reply).toBe(summaryOf(items, rest));
      expect(r.captured.cambios ?? []).not.toContainEqual(expect.stringContaining('sin aplicar'));
    });

    it('el nombre de un campo que no se aplicó queda en el residuo; el aplicado no', () => {
      closeWithSummary();
      const before = flow.getFlowState(PHONE).captured;
      const r = step('La comuna no la sé');
      expectNoted(r, 'La comuna no la sé', before);
    });

    it('«Sí, la luz neutra» (el valor registrado) no deja línea', () => {
      closeWithSummary();
      const r = step('Sí, la luz neutra');
      expect(r.reply).toBe(flow.MSG4);
      expect(r.captured.cambios ?? []).not.toContainEqual(expect.stringContaining('sin aplicar'));
    });
  });
});
