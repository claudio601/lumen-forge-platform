// api/_lib/whatsapp/flowRevision.test.ts
// Bot de WhatsApp, fases 1 y 2: hallazgos de la revisión del 12-11-2026 (tres revisores), uno por bloque. Cada prueba
// reproduce el escenario del hallazgo y fija lo que debe pasar (casi siempre, lo que hacía main). Solo datos inventados.
// - [REINICIO] Después del cierre, otro pedido abre otra conversación y un comentario no cambia el negocio registrado.
// - [B2B] "licitación" y "facturación" con tilde son empresa; preguntar por la bodega de la tienda no lo es.
// - [NO-DEGRADAR] Solo "5 focos" (o la familia que el cliente ya dio) conserva el producto específico.
// - [VARIOS-IMAGEN] Una imagen que confirma o corrige la cantidad no es otro ítem.
// - [SIN-VISITA] "busco instalación", "con instalación incluida" e "¿incluye instalación?" siguen pidiendo el servicio.
// - [LUZ] UV es un tipo de luz. [RESPALDO] El uso dicho con otras palabras o con el nombre del producto se anota.
// - [PREGUNTA] Envíos, mandan, la pregunta indirecta del negocio 147, "Hay 3 galpones" y las preguntas de una
//   instalación registrada. [SIN-REPETIR] Las respuestas con el correo ya dado tampoco se repiten iguales.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const PHONE = '+56900000603';
type Claude = Parameters<typeof flow.processFlowStep>[2];
let lastReply: string | undefined;
/** Un mensaje, con la respuesta anterior como la entrega webhook.ts (del historial). */
const step = (body: string, claude: Claude = {}, hasMedia = false) => {
  const r = flow.processFlowStep(PHONE, body, claude, { wantsHuman: false, qualifiesForDeal: false, hasMedia, lastReply });
  lastReply = r.reply;
  return r;
};
afterEach(() => { flow.clearFlowState(PHONE); lastReply = undefined; });

const ANA = { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
/** Cierra con el negocio registrado (id 4242), como lo deja el webhook. */
function closeRegistered(body: string, claude: Claude, registered = true) {
  step(body, claude);
  expect(flow.getFlowState(PHONE).stage).toBe('closed');
  flow.recordDealOutcome(PHONE, registered, undefined, registered ? 4242 : undefined);
}
const FOCOS = 'Necesito 20 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com';
const FOCOS_CLAUDE: Claude = { producto: 'focos LED', cantidad: '20', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', ...ANA };
const REGISTERED = { producto: 'focos LED', cantidad: '20', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' };

describe('[REINICIO] un pedido nuevo o un comentario no pisan el negocio registrado', () => {
  for (const [who, claude] of [['acierta', { producto: 'focos LED', cantidad: '10', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Pirque' }], ['vacío', {}]] as const) {
    it(`"Ahora necesito 10 focos LED para la casa de mi mamá en Pirque" abre otra conversación (Claude ${who})`, () => {
      closeRegistered(FOCOS, FOCOS_CLAUDE);
      const r = step('Ahora necesito 10 focos LED para la casa de mi mamá en Pirque', claude);
      expect(r.closedFlow).toBe(false);
      expect(r.rutUpdate).toBeUndefined();
      expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
      expect(r.captured).toMatchObject({ cantidad: '10', comuna_o_ciudad: 'Pirque' });
      expect(r.captured.cambios).toBeUndefined();
    });
  }

  it.each<[string, Claude]>([
    ['Ok gracias, son 3 dormitorios y el living', { proyecto_o_uso: 'living' }],
    ['Gracias! mi otra casa está en Pirque', { comuna_o_ciudad: 'Pirque' }],
    ['Saludos desde Puente Alto', { comuna_o_ciudad: 'Puente Alto' }],
    ['Necesito 10 focos LED', { producto: 'focos LED', cantidad: '10' }],
  ])('"%s" no cambia el negocio registrado ni escribe en Pipedrive', (body, claude) => {
    closeRegistered(FOCOS, FOCOS_CLAUDE);
    const r = step(body, claude);
    const state = flow.getFlowState(PHONE);
    if (r.closedFlow) {
      expect(r).toMatchObject({ shouldCreateDeal: false });
      expect(r.rutUpdate).toBeUndefined();
      expect(state.captured).toMatchObject(REGISTERED);
      expect(state.captured.comunas_otras).toBeUndefined();
      expect(state.captured.cambios).toBeUndefined();
    } else {
      // Otro pedido: el negocio registrado no se toca y empieza otra conversación.
      expect(state.dealId).toBeUndefined();
    }
  });

  it('una corrección explícita sí cambia la cantidad y la comuna del negocio registrado', () => {
    closeRegistered(FOCOS, FOCOS_CLAUDE);
    const r = step('Corrijo: son 10 focos LED y la comuna es Pirque', { cantidad: '10', comuna_o_ciudad: 'Pirque' });
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ cantidad: '10', comuna_o_ciudad: 'Pirque' });
    expect(r.captured.cambios).toEqual(expect.arrayContaining(['Cantidad: antes 20, ahora 10', 'Comuna/ciudad: antes Maipú, ahora Pirque']));
  });

  it('un dato que faltaba se completa en el negocio registrado', () => {
    step('Necesito 20 focos LED luz cálida para mi casa. Soy Ana Prueba, ana.prueba@example.com', { producto: 'focos LED', cantidad: '20', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', ...ANA });
    for (let i = 0; i < 4 && flow.getFlowState(PHONE).stage !== 'closed'; i++) step('no sé todavía');
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
    expect(flow.getFlowState(PHONE).captured.comuna_o_ciudad).toBeUndefined();
    const r = step('Es en Maipú', { comuna_o_ciudad: 'Maipú' });
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.comuna_o_ciudad).toBe('Maipú');
  });

  for (const [who, claude] of [['acierta', { producto: 'reflectores 40W', cantidad: '4', proyecto_o_uso: 'patio', comuna_o_ciudad: 'Puente Alto' }], ['vacío', {}]] as const) {
    it(`"reflectores 40W" después de "paneles LED 60x60 40W" es otro pedido: 40W no basta (Claude ${who})`, () => {
      closeRegistered('Necesito 10 paneles LED 60x60 40W luz fría para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com', { producto: 'paneles LED 60x60 40W', cantidad: '10', tipo_de_luz: 'fría', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', ...ANA });
      const r = step('Necesito 4 reflectores 40W para el patio de mi mamá en Puente Alto', claude);
      expect(r.closedFlow).toBe(false);
      expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
      expect(r.captured.cantidad).toBe('4');
    });
  }

  for (const [who, claude] of [['acierta', { producto: 'campanas UFO 200W', cantidad: '30', proyecto_o_uso: 'galpón', comuna_o_ciudad: 'Quilicura' }], ['vacío', {}]] as const) {
    it(`"campanas UFO 200W" después de "campanas UFO 100W" es otro pedido (Claude ${who})`, () => {
      closeRegistered('Necesito 10 campanas UFO 100W luz neutra para un galpón en Maipú. Soy Ana Prueba, ana.prueba@example.com', { producto: 'campanas UFO 100W', cantidad: '10', tipo_de_luz: 'neutra', proyecto_o_uso: 'galpón', comuna_o_ciudad: 'Maipú', ...ANA });
      const r = step('Necesito 30 campanas UFO 200W para un galpón en Quilicura', claude);
      expect(r.closedFlow).toBe(false);
      expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
      expect(r.captured.cantidad).toBe('30');
    });
  }

  it('con el negocio fallido (texto B), un pedido nuevo del mismo producto abre otra conversación', () => {
    closeRegistered(FOCOS, FOCOS_CLAUDE, false);
    const r = step('Hola, necesito 30 focos LED para la terraza', { producto: 'focos LED', cantidad: '30', proyecto_o_uso: 'terraza' });
    expect(r.closedFlow).toBe(false);
    expect(r.reply).not.toBe(flow.MSG_DEAL_FAILED);
    expect(r.captured).toMatchObject({ cantidad: '30', proyecto_o_uso: 'terraza' });
  });
});

describe('[B2B] empresa con tilde, y la bodega de la tienda no es empresa', () => {
  it.each([
    'Hola, necesito 40 reflectores LED 200W luz fria para una licitación en Rancagua',
    'Hola, necesito 40 reflectores LED 200W luz fria para una LICITACIÓN en Rancagua',
    'Hola, necesito 40 reflectores LED 200W luz fria para mi casa en Maipú, necesito facturación',
  ])('"%s" es B2B y se pide el RUT de la empresa', (body) => {
    const r = step(body, { producto: 'reflectores LED 200W', cantidad: '40', tipo_de_luz: 'fría' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
    if (flow.getFlowState(PHONE).stage === 'stage3') expect(r.reply).toContain('RUT de la empresa');
  });

  const FIVE = (): void => { step('Hola, necesito 5 focos LED luz cálida', { producto: 'focos LED', cantidad: '5', tipo_de_luz: 'cálida' }); };
  it.each<[string, Array<[string, Claude]>]>([
    ['¿Dónde queda su bodega?', [['¿Dónde queda su bodega? Es para mi casa en Maipú', { proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' }]]],
    ['¿Puedo retirar en la bodega?', [['¿Dónde están ubicados?', {}], ['¿Puedo retirar en la bodega? Es para mi casa en Maipú', { proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' }]]],
    ['¿Tienen oficina para ir a verlos?', [['¿Tienen oficina para ir a verlos? Son para mi casa en Maipú', { proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' }]]],
  ])('%s: la persona sigue siendo persona, sin RUT ni cierre de empresa', (_label, turns) => {
    FIVE();
    const replies = turns.map(([body, claude]) => step(body, claude).reply);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
    const end = step('Soy Ana Prueba, ana.prueba@example.com', ANA);
    for (const reply of [...replies, end.reply]) expect(reply).not.toMatch(/RUT/);
    expect(end.reply).not.toBe(flow.MSG4_B2B);
    expect(end.shouldCreateDeal).toBe(true);
  });

  it.each(['¿Hacen despacho a la obra en Lampa?', '¿Despachan a nuestra bodega en Lampa?'])('"%s" sigue siendo empresa (es del cliente)', (body) => {
    FIVE();
    step(body);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
  });
});

const ESTACA = 'Estaca LED COB 5W para jardín';
describe('[NO-DEGRADAR] otra familia de producto sí cambia el producto', () => {
  it('"Campana UFO 200W" y luego "10 reflectores LED para una cancha": el producto pasa a reflectores, con su cambio', () => {
    step('Hola, me interesa la Campana UFO 200W', { producto: 'Campana UFO 200W' });
    const r = step('Necesito 10 reflectores LED para una cancha', { producto: 'reflectores LED', cantidad: '10', proyecto_o_uso: 'cancha' });
    expect(r.captured).toMatchObject({ producto: 'reflectores LED', cantidad: '10' });
    expect(r.captured.cambios).toContain('Producto: antes Campana UFO 200W, ahora reflectores LED');
  });

  it.each<[string, Claude, string]>([
    ['Necesito 10 paneles', { producto: 'paneles', cantidad: '10' }, 'paneles'],
    ['Prefiero paneles', { producto: 'paneles' }, 'paneles'],
    ['En realidad necesito paneles', { producto: 'paneles' }, 'paneles'],
    ['Perdón, quise decir paneles', { producto: 'paneles' }, 'paneles'],
    ['Cambio a paneles', { producto: 'paneles' }, 'paneles'],
    ['Al final serán 10 reflectores', { producto: 'reflectores', cantidad: '10' }, 'reflectores'],
  ])('después de la estaca, "%s" cambia el producto', (body, claude, expected) => {
    step('Hola, me interesa Estaca LED COB 5W para jardín', { producto: ESTACA });
    const r = step(body, claude);
    expect(r.captured.producto).toBe(expected);
    expect(r.captured.cambios).toContain('Producto: antes ' + ESTACA + ', ahora ' + expected);
  });

  it('"Necesito 5 focos" después de "focos estaca" y la ficha: la familia que el cliente ya dio no degrada la estaca', () => {
    step('Hola, necesito focos estaca con luz cálida', { producto: 'focos estaca', tipo_de_luz: 'cálida' });
    step('https://example.com/producto/estaca-led-cob-5w-para-jardin Estaca LED COB 5W para jardín, 450 lm e IP65', { producto: ESTACA });
    const r = step('Necesito 5 focos', { producto: 'focos', cantidad: '5' });
    expect(r.captured).toMatchObject({ producto: ESTACA, cantidad: '5' });
  });
});

describe('[VARIOS-IMAGEN] la imagen que confirma o corrige la cantidad no es otro ítem', () => {
  it.each<[string, string, Claude]>([
    ['Este modelo, 10 unidades', '10', { cantidad: '10' }],
    ['Como este, 10 unidades', '10', { cantidad: '10' }],
    ['Son 10 de este modelo', '10', { cantidad: '10' }],
    ['Son 15 de este', '15', { cantidad: '15' }],
  ])('"Necesito 10 paneles LED 60x60" y una imagen con "%s": cantidad %s', (body, expected, claude) => {
    step('Hola, necesito 10 paneles LED 60x60 luz neutra', { producto: 'paneles LED 60x60', cantidad: '10', tipo_de_luz: 'neutra' });
    const r = step(body, claude, true);
    expect(r.captured.cantidad).toBe(expected);
    expect(r.captured.cantidad_varios).toBeUndefined();
    if (expected !== '10') expect(r.captured.cambios).toContain('Cantidad: antes 10, ahora ' + expected);
  });
});

describe('[SIN-VISITA] pedir el servicio de instalación con otras palabras', () => {
  it.each(['Hola, busco instalación eléctrica para mi local', 'Necesito luminarias con instalación incluida para mi casa en Ñuñoa', '¿Incluye instalación?'])('"%s" va al flujo de instalación', (body) => {
    step(body);
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });
});

describe('[LUZ] UV y otros tipos de luz', () => {
  it.each(['UV', 'ultravioleta', 'espectro completo', 'full spectrum', 'infrarrojo'])('Claude "%s" se anota y no se vuelve a pedir el tipo de luz', (luz) => {
    const r = step('Hola, necesito 4 focos LED de luz ' + luz + ' para cultivo en Maipú', { producto: 'focos LED', cantidad: '4', tipo_de_luz: luz, proyecto_o_uso: 'cultivo', comuna_o_ciudad: 'Maipú' });
    expect(r.captured.tipo_de_luz).toBe(luz);
    expect(r.reply).not.toMatch(/tipo de luz/i);
  });
});

describe('[RESPALDO] el uso que el cliente sí da', () => {
  it('a la pregunta por el uso, "Para mi negocio de comida rápida" con Claude "restaurante" se anota', () => {
    step('Necesito 10 focos LED luz cálida', { producto: 'focos LED', cantidad: '10', tipo_de_luz: 'cálida' });
    const r = step('Para mi negocio de comida rápida en Maipú', { proyecto_o_uso: 'restaurante', comuna_o_ciudad: 'Maipú' });
    expect(r.captured.proyecto_o_uso).toBe('restaurante');
  });

  it('sin la pregunta por el uso, Claude no inventa uno que el cliente no dijo', () => {
    const r = step('Necesito 10 focos LED luz cálida en Maipú', { producto: 'focos LED', cantidad: '10', tipo_de_luz: 'cálida', proyecto_o_uso: 'restaurante', comuna_o_ciudad: 'Maipú' });
    expect(r.captured.proyecto_o_uso).toBeUndefined();
  });

  it('"focos LED para jardín": el uso va en el nombre genérico y no se vuelve a pedir', () => {
    const r = step('Hola, necesito 10 focos LED para jardín, luz cálida, en La Florida', { producto: 'focos LED para jardín', cantidad: '10', tipo_de_luz: 'cálida', proyecto_o_uso: 'jardín', comuna_o_ciudad: 'La Florida' });
    expect(r.captured.proyecto_o_uso).toBe('jardín');
    expect(r.reply).not.toMatch(/espacio o proyecto/i);
  });
});

describe('[PREGUNTA] envíos, la pregunta indirecta y lo que no es pregunta', () => {
  it.each(['¿Hacen envíos a regiones?', 'hacen envios?', '¿Envían a Temuco?', '¿Mandan a regiones?'])('"%s" pregunta por el despacho', (body) => {
    expect([...flow.questionKinds(body)]).toEqual(['despacho']);
  });

  it('"¿cuánto cuesta enviar a Temuco?" es el despacho, no el precio del producto', () => {
    expect([...flow.questionKinds('¿cuánto cuesta enviar a Temuco?')]).toEqual(['despacho']);
  });

  it.each(['¿Me pueden enviar la ficha técnica?', '¿me pueden enviar la cotización?', '¿Me mandan la ficha técnica a mi correo?'])('"%s" no pregunta por el despacho', (body) => {
    expect(flow.questionKinds(body).has('despacho')).toBe(false);
  });

  it('"¿Hacen envíos a regiones?" antes del cierre recibe el texto del despacho, sin pedir el RUT', () => {
    step('Necesito 5 estacas LED luz cálida', { producto: 'estacas LED', cantidad: '5', tipo_de_luz: 'cálida' });
    const r = step('¿Hacen envíos a regiones?');
    expect(r.reply.startsWith(flow.MSG_WAIT_DELIVERY + '\n\n')).toBe(true);
    expect(r.reply).not.toMatch(/RUT/);
  });

  it('con el negocio registrado, "¿Envían a Temuco?" recibe el texto del despacho', () => {
    closeRegistered(FOCOS, FOCOS_CLAUDE);
    expect(step('¿Envían a Temuco?').reply).toBe(flow.MSG_WAIT_DELIVERY);
  });

  const LITERAL_147 = 'Necesito saber si este producto CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. AZUL. Corresponde a LEDS monocromáticos';
  it('negocio 147: la pregunta indirecta con el título de la ficha es una consulta técnica', () => {
    expect(flow.questionKinds(LITERAL_147).has('tecnica')).toBe(true);
    expect(step(LITERAL_147, { producto: 'CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. AZUL' }).reply).toBe(flow.MSG_Q_TECH);
  });

  it.each(['Hay 3 galpones', 'Tiene 8 metros de alto', 'Hay 2 naves de 30 metros', 'Tienen 2 bodegas de 500 m2'])('"%s" describe el lugar: no es una pregunta de precio', (body) => {
    expect(flow.questionKinds(body).has('precio')).toBe(false);
    step('Necesito campanas LED 150W luz fría', { producto: 'campanas LED 150W', tipo_de_luz: 'fría' });
    const r = step(body);
    for (const text of [flow.MSG_Q_PRICE, flow.MSG_Q_TECH]) expect(r.reply).not.toContain(text);
  });

  it.each(['Tienen 50 unidades disponible?', '¿Tienen 50 de estos?', 'hay stock?'])('"%s" sigue siendo una pregunta de stock', (body) => {
    expect(flow.questionKinds(body).has('precio')).toBe(true);
  });
});

describe('[PREGUNTA] instalación registrada', () => {
  it('"¿cuánto cuesta?" no promete una revisión que no queda en el negocio ni habla de disponibilidad', () => {
    step('Quiero instalar focos en mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba' });
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
    const r = step('¿cuánto cuesta?');
    expect(r.reply).not.toMatch(/disponibilidad|revisar/i);
    expect(r.reply).toBe(flow.MSG_REGISTERED_SHORT);
    expect(r.shouldCreateDeal).toBe(false);
  });
});

describe('[SIN-REPETIR] con el negocio registrado', () => {
  it.each([['¿tienen stock?', '¿y cuánto cuestan?'], ['precio?', 'precio?']])('"%s" y "%s" seguidas no reciben el mismo texto', (a, b) => {
    closeRegistered(FOCOS, FOCOS_CLAUDE);
    const first = step(a);
    const second = step(b);
    expect(first.reply).toBe(flow.MSG_Q_PRICE_HAS_EMAIL);
    expect(second.reply).not.toBe(first.reply);
    expect(second.reply).toBe(flow.MSG_Q_TECH_HAS_EMAIL);
  });

  it('cerrada sin correo: el texto A se repite (decisión pendiente del dueño, T-X1b)', () => {
    step('Necesito 12 focos LED luz cálida para mi casa en Maipú', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' });
    for (let i = 0; i < 4 && flow.getFlowState(PHONE).stage !== 'closed'; i++) step('no sé');
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    expect(step('hola?').reply).toBe(flow.MSG_NEED_EMAIL);
    expect(step('ok').reply).toBe(flow.MSG_NEED_EMAIL);
  });
});
