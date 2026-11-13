// api/_lib/whatsapp/flowPreguntas.test.ts
// Bot de WhatsApp, fase 2 (12-11-2026, propuesta del dueño punto 1 y el caso de las estacas): contestar lo que el
// cliente pregunta con los textos aprobados (11-11-2026), sin precios, stock ni asesoría técnica.
// - [PREGUNTA] Precio o stock, ficha o duda técnica, ubicación y despacho, antes y después del cierre.
// - [SIN-REPETIR] Nunca el mismo texto dos veces seguidas cuando hay otro texto existente que dice lo mismo.
// - Caso de las estacas de punta a punta por el flujo (con Claude que acierta y con Claude vacío).
// Solo datos inventados.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { buildNote } from './pipedriveLead';

const PHONE = '+56900000602';
type Claude = Parameters<typeof flow.processFlowStep>[2];
let lastReply: string | undefined;
/** Un mensaje, con la respuesta anterior como la entrega webhook.ts (del historial). */
const step = (body: string, claude: Claude = {}) => {
  const r = flow.processFlowStep(PHONE, body, claude, { wantsHuman: false, qualifiesForDeal: false, lastReply });
  lastReply = r.reply;
  return r;
};
afterEach(() => { flow.clearFlowState(PHONE); lastReply = undefined; });

const ANSWERS = [flow.MSG_Q_PRICE, flow.MSG_Q_TECH, flow.MSG_LOCATION, flow.MSG_WAIT_DELIVERY, flow.MSG_Q_PRICE_HAS_EMAIL, flow.MSG_Q_TECH_HAS_EMAIL];
const PANEL = { producto: 'Panel LED redondo embutido 18W con sensor de movimiento', tipo_de_luz: 'Fría 6500K' };

describe('[PREGUNTA] los textos aprobados, tal cual', () => {
  it('precio, consulta técnica y ubicación (propuesta-dueno.md, OK del 11-11-2026)', () => {
    expect(flow.MSG_Q_PRICE).toBe('Claudio Quero revisará el precio y la disponibilidad y te responderá por correo el mismo día hábil. ¿Cuál es tu correo?');
    expect(flow.MSG_Q_TECH).toBe('Claudio Quero revisará tu consulta y te responderá por correo el mismo día hábil. ¿Cuál es tu correo?');
    expect(flow.MSG_LOCATION).toBe('Somos una tienda online con bodega en Quinta Normal y despachamos a todo Chile.');
    expect(flow.MSG_WAIT_DELIVERY).toBe('El plazo y el costo del despacho van en la cotización, que te enviaremos por correo el mismo día hábil.');
    expect(flow.MSG_Q_PRICE_HAS_EMAIL + ' ¿Cuál es tu correo?').toBe(flow.MSG_Q_PRICE);
    expect(flow.MSG_Q_TECH_HAS_EMAIL + ' ¿Cuál es tu correo?').toBe(flow.MSG_Q_TECH);
  });

  it('ninguno da precios, stock, plazos de entrega ni una dirección', () => {
    for (const text of ANSWERS) {
      expect(text).not.toMatch(/\$|\d|en stock|sin stock|24|48|calle|avenida/i);
    }
  });
});

describe('[PREGUNTA] antes del cierre', () => {
  it('negocio 205: "Tienen 50 unidades disponible?" recibe el texto del precio y la disponibilidad, sin avanzar', () => {
    step('Hola, consulta por PANEL LED REDONDO EMBUTIDO 18W CON SENSOR MOVIMIENTO IP33 BLANCO – Fría 6500K', PANEL);
    const before = flow.getFlowState(PHONE);
    const r = step('Tienen 50 unidades disponible?');
    expect(r.reply).toBe(flow.MSG_Q_PRICE);
    const after = flow.getFlowState(PHONE);
    expect(after.stage).toBe(before.stage);
    expect(after.repreguntasStage1).toBe(before.repreguntasStage1);
    expect(after.captured.producto).toBe(PANEL.producto);
    const next = step('ana.prueba@example.com');
    expect(next.captured.correo).toBe('ana.prueba@example.com');
    expect(next.reply).not.toBe(flow.MSG_Q_PRICE);
  });

  it.each(['CUAL ES SU VALOR?', 'Valor???', '¿Cuánto cuesta?', 'precio?', 'hay stock?', 'Necesito saber el precio de estos paneles'])('negocios 159 y 178: "%s" recibe el texto del precio', (body) => {
    step('Panel LED sobrepuesto redondo 12W IP44', { producto: 'Panel LED sobrepuesto redondo 12W IP44' });
    expect(step(body).reply).toBe(flow.MSG_Q_PRICE);
  });

  it('precio sin producto (antes FIX-2, con un texto sin aprobar) recibe el texto aprobado', () => {
    const r = step('cuanto cuestan?');
    expect(r.reply).toBe(flow.MSG_Q_PRICE);
    expect(r.reply).not.toMatch(/Con gusto te ayudo con los precios/);
  });

  it.each([
    'https://example.com/producto/proyector-1000w tengo este proyector pero no tiene ficha tecnica, ustedes cuentan con ficha tecnica?',
    'necesito saber si tienen ficha tecnica',
    'por lo que entiendo estos 60x60 puedes con un dimmer subir y bajar la intensidad de la luz?',
    '¿Cuáles son las dimensiones del foco?',
  ])('negocios 142 y 204: "%s" recibe el texto de la consulta técnica, sin asesoría', (body) => {
    step('Necesito proyectores LED', { producto: 'proyectores LED' });
    expect(step(body).reply).toBe(flow.MSG_Q_TECH);
  });

  it('negocio 142: la misma pregunta dos veces no recibe el mismo texto dos veces', () => {
    step('Necesito proyectores LED', { producto: 'proyectores LED' });
    const a = step('necesito saber si tienen ficha tecnica');
    const b = step('necesito saber si tienen ficha tecnica');
    expect(a.reply).toBe(flow.MSG_Q_TECH);
    expect(b.reply).not.toBe(a.reply);
    expect(b.reply).toBe(flow.MSG_NEED_EMAIL);
  });

  it('negocio 149: "Donde se encuentran ubicados?" recibe la ubicación y sigue con lo que falta', () => {
    step('Hola buenos días');
    const r = step('Donde se encuentran ubicados?');
    expect(r.reply.startsWith(flow.MSG_LOCATION + '\n\n')).toBe(true);
    expect(r.reply).toMatch(/producto/i);
  });

  it('caso de las estacas: "Sabes cuando demora el despacho" recibe el texto del despacho y después el dato que falta', () => {
    step('Necesito 5 estacas LED luz cálida', { producto: 'estacas LED', cantidad: '5', tipo_de_luz: 'cálida' });
    const r = step('Sabes cuando demora el despacho');
    expect(r.reply.startsWith(flow.MSG_WAIT_DELIVERY + '\n\n')).toBe(true);
    expect(r.reply.length).toBeGreaterThan(flow.MSG_WAIT_DELIVERY.length + 2);
  });

  it('negocio 147: despacho y retiro con el correo ya dado: el texto del despacho, sin pedir otra vez el correo', () => {
    step('Necesito 4 cintas LED azules para unas plantas, ana.prueba@example.com', { producto: 'cintas LED', cantidad: '4', tipo_de_luz: 'azul', proyecto_o_uso: 'plantas', correo: 'ana.prueba@example.com' });
    const r = step('Región metropolitana. Las Condes o Colina. Ustedes tienen despacho o puedo retirar en tienda? Y cuánto tarda el despacho?');
    expect(r.reply).toContain(flow.MSG_WAIT_DELIVERY);
    expect(r.reply).not.toMatch(/24|48|ma[nñ]ana/i);
  });

  it('con el correo ya dado, el precio se contesta sin volver a pedir el correo', () => {
    step('Necesito 10 paneles LED luz fría, ana.prueba@example.com', { producto: 'paneles LED', cantidad: '10', tipo_de_luz: 'fría', correo: 'ana.prueba@example.com' });
    const r = step('¿Cuál es el precio?');
    expect(r.reply.startsWith(flow.MSG_Q_PRICE_HAS_EMAIL + '\n\n')).toBe(true);
    expect(r.reply).not.toContain('¿Cuál es tu correo?');
  });

  it('si el turno registra la solicitud, la respuesta y después el cierre', () => {
    step('Necesito 10 paneles LED luz fría para una casa en Maipú. Soy Ana Prueba', { producto: 'paneles LED', cantidad: '10', tipo_de_luz: 'fría', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba' });
    const r = step('ana.prueba@example.com ¿hacen despacho a Maipú?', { correo: 'ana.prueba@example.com' });
    expect(r.shouldCreateDeal).toBe(true);
    expect(r.reply.startsWith(flow.MSG_WAIT_DELIVERY + '\n\n')).toBe(true);
  });

  it.each([
    'necesito despacho a Temuco',
    'Estaca LED COB 5W para jardín, 450 lm e IP65',
    'quiero cotizar 20 paneles',
    '¿me pueden cotizar 20 paneles LED?',
    'Hay que corregir: son 20 paneles',
    'Hola, consulta por PANEL LED REDONDO EMBUTIDO 18W',
    '¿te envío mi correo por acá?',
    '¿Cuándo me entregan la cotización?',
    'ya, vale?',
  ])('"%s" no es una pregunta de precio, técnica, ubicación ni despacho', (body) => {
    expect([...flow.questionKinds(body)]).toEqual([]);
    step('Necesito paneles LED', { producto: 'paneles LED' });
    const r = step(body);
    for (const text of ANSWERS) expect(r.reply).not.toContain(text);
  });
});

describe('[PREGUNTA] después del cierre', () => {
  function closeRegistered() {
    step('Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }

  it('registrada: "¿Tienen ficha técnica?" recibe el texto sin pedir el correo y va en una nota al mismo negocio', () => {
    closeRegistered();
    const r = step('¿Tienen ficha técnica de estos focos?');
    expect(r).toMatchObject({ reply: flow.MSG_Q_TECH_HAS_EMAIL, closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  it('registrada: "¿Cuánto cuestan?" recibe el texto del precio sin pedir el correo', () => {
    closeRegistered();
    expect(step('¿Cuánto cuestan?')).toMatchObject({ reply: flow.MSG_Q_PRICE_HAS_EMAIL, shouldCreateDeal: true, rutUpdate: true });
  });

  it('registrada: "¿Dónde están ubicados?" recibe la ubicación, sin nota', () => {
    closeRegistered();
    expect(step('¿Dónde están ubicados?')).toMatchObject({ reply: flow.MSG_LOCATION, closedFlow: true, shouldCreateDeal: false });
  });

  it('sin correo: el precio pide el correo con su texto y la ubicación va antes del texto A', () => {
    step('Necesito 12 focos LED luz cálida para mi casa en Maipú', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' });
    for (let i = 0; i < 4 && flow.getFlowState(PHONE).stage !== 'closed'; i++) step('no sé');
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    expect(step('¿cuánto cuesta?')).toMatchObject({ reply: flow.MSG_Q_PRICE, shouldCreateDeal: false });
    expect(step('¿Dónde están ubicados?').reply).toBe(flow.MSG_LOCATION + '\n\n' + flow.MSG_NEED_EMAIL);
  });
});

describe('[SIN-REPETIR] la respuesta anterior no se repite igual', () => {
  it('el saludo sí puede repetirse (no hay otro texto aprobado)', () => {
    const a = step('Hola');
    const b = step('Hola');
    expect(a.reply).toBe(flow.MSG1);
    expect(b.reply).toBe(flow.MSG1);
  });

  it('con el negocio registrado, "gracias" y "ok" seguidos no reciben el mismo recordatorio', () => {
    step('Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
    const a = step('gracias');
    const b = step('ok');
    expect(a.reply).toBe(flow.MSG_REGISTERED_SHORT);
    expect(b.reply).toBe(flow.MSG_WAIT);
  });
});

// Caso real del 12-11-2026, anonimizado (caso-2026-11-12-estacas.md), con datos inventados.
const ESTACA = 'Estaca LED COB 5W para jardín';
const FICHA = 'https://example.com/producto/estaca-led-cob-5w-para-jardin Estaca LED COB 5W para jardín, 450 lm e IP65';
const DESPACHO = 'Sabes cuando demora el despacho';
const TURNS: Array<[string, Claude, Claude]> = [
  ['Hola, necesito focos estaca con luz cálida', { producto: 'focos estaca', tipo_de_luz: 'cálida' }, {}],
  ['Estos', {}, {}],
  [FICHA, { producto: ESTACA, proyecto_o_uso: 'jardín' }, {}],
  ['5 focos', { producto: 'focos', cantidad: '5' }, {}],
  ['En un jardin', { proyecto_o_uso: 'jardín' }, {}],
  ['Ok, yo le escribí a Claudio', {}, {}],
  [DESPACHO, {}, {}],
  ['ana.prueba@example.com', { correo: 'ana.prueba@example.com' }, {}],
];

describe('caso de las estacas, de punta a punta por el flujo', () => {
  for (const [label, pick] of [['Claude acierta', 1], ['Claude vacío', 2]] as const) {
    it(label, () => {
      const replies: string[] = [];
      let last: flow.FlowResult | undefined;
      for (const turn of TURNS) {
        last = step(turn[0], turn[pick]);
        replies.push(last.reply);
      }
      // DECISIÓN PENDIENTE DEL DUEÑO (revisión del 12-11-2026): cerrada sin correo, el texto A se repite (T-X1b) hasta
      // que apruebe otro texto. Fuera de eso, ninguna respuesta repite la anterior.
      const closedA = replies.map((r, i) => i > 0 && r === flow.MSG_NEED_EMAIL && replies[i - 1] === flow.MSG_NEED_EMAIL);
      expect(closedA.filter(Boolean).length).toBeLessThanOrEqual(2);
      for (let i = 1; i < replies.length; i++) {
        if (closedA[i]) continue;
        expect(replies[i], 'respuesta ' + (i + 1)).not.toBe(replies[i - 1]);
      }
      expect(replies[TURNS.findIndex((t) => t[0] === DESPACHO)]).toContain(flow.MSG_WAIT_DELIVERY);
      for (const reply of replies) {
        expect(reply).not.toMatch(/RUT/);
        expect(reply).not.toBe(flow.MSG4_B2B);
        expect(reply).not.toMatch(/visita|en stock|sin stock/i);
      }
      expect(last!.shouldCreateDeal).toBe(true);
      expect(last!.captured).toMatchObject({ cantidad: '5', proyecto_o_uso: 'jardín', correo: 'ana.prueba@example.com' });
      if (pick === 1) expect(last!.captured.producto).toBe(ESTACA);
      expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
      const note = buildNote({ phone: PHONE, name: 'Cliente Prueba', summary: '', body: TURNS[TURNS.length - 1][0], captured: last!.captured });
      expect(note).toContain('Cantidad: 5\n');
      expect(note).toContain('Proyecto/uso: jardín\n');
      if (pick === 1) expect(note).toContain('Producto: ' + ESTACA + '\n');
    });
  }
});
