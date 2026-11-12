// api/_lib/whatsapp/flowFase1.test.ts
// Bot de WhatsApp, fase 1 (12-11-2026, propuesta del dueño puntos 2 a 6 y el caso de las estacas): datos mal anotados.
// - [NO-DEGRADAR] Un mensaje de cantidad ("5 focos") no cambia un producto específico por uno genérico.
// - [B2B] "despacho", "espacio" o "sobra" no convierten a una persona en empresa (no se le pide el RUT).
// - [LUZ] "luz interior" o "LED" no son un color de luz; 5700K se anota tal cual.
// - [RESPALDO] El uso y el producto salen de lo que el cliente dice, no del nombre del producto ni del perfil.
// - [COMUNA] "comuna san bdo" es San Bernardo, no Santiago.
// - [SIN-VISITA] Describir la instalación propia no pide el servicio, y ningún cierre ofrece una visita (negocio 195).
// - [REINICIO] Después del cierre, solo otro pedido empieza otra conversación; un cambio del mismo pedido va al
//   negocio registrado (negocios 144, 145 y 186).
// Cada caso corre con un Claude simulado que acierta y con otro que se equivoca. Solo datos inventados.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { buildNote } from './pipedriveLead';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000601';
type Claude = Parameters<typeof flow.processFlowStep>[2];
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, NO_SIGNALS);

afterEach(() => flow.clearFlowState(PHONE));

const ESTACA = 'Estaca LED COB 5W para jardín';
const FICHA = 'https://example.com/producto/estaca-led-cob-5w-para-jardin Estaca LED COB 5W para jardín, 450 lm e IP65';

describe('[NO-DEGRADAR] un nombre genérico no reemplaza al producto específico', () => {
  for (const [who, claude] of [['acierta', { cantidad: '5', producto: ESTACA }], ['se equivoca', { cantidad: '5', producto: 'focos' }], ['no dice nada', { cantidad: '5' }]] as const) {
    it(`caso de las estacas (Claude ${who}): "5 focos" deja la estaca y la cantidad 5`, () => {
      step('Hola, necesito focos estaca con luz cálida', { producto: 'focos estaca', tipo_de_luz: 'cálida' });
      step('Estos');
      expect(step(FICHA, { producto: ESTACA }).captured.producto).toBe(ESTACA);
      const r = step('5 focos', claude);
      expect(r.captured).toMatchObject({ producto: ESTACA, cantidad: '5' });
      expect((r.captured.cambios ?? []).join(' ')).not.toMatch(/ahora focos/);
      const end = step('En un jardin', { proyecto_o_uso: 'jardín' });
      const note = buildNote({ phone: PHONE, name: 'Cliente Prueba', summary: '', body: 'En un jardin', captured: end.captured });
      expect(note).toContain('Producto: ' + ESTACA + '\n');
      expect(note).toContain('Cantidad: 5\n');
    });
  }

  it('"paneles LED 60x60" y luego "20 paneles": siguen los paneles 60x60, sin cambios', () => {
    step('Necesito paneles LED 60x60', { producto: 'paneles LED 60x60' });
    const r = step('20 paneles', { cantidad: '20', producto: 'paneles' });
    expect(r.captured).toMatchObject({ producto: 'paneles LED 60x60', cantidad: '20' });
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each([
    ['corrijo, mejor focos', { producto: 'focos' }],
    ['no quiero estacas, quiero focos', { producto: 'focos' }],
    ['mejor focos', { producto: 'focos' }],
  ])('una corrección sí cambia: "%s"', (body, claude) => {
    step('Necesito estaca LED COB 5W', { producto: 'estaca LED COB 5W' });
    const r = step(body, claude);
    expect(r.captured.producto).toBe('focos');
    expect(r.captured.cambios?.[0]).toMatch(/^Producto: antes estaca LED COB 5W, ahora focos$/);
  });

  it('de genérico a genérico sigue cambiando: "focos LED" y luego "20 paneles"', () => {
    step('Necesito focos LED', { producto: 'focos LED' });
    expect(step('20 paneles', { cantidad: '20', producto: 'paneles' }).captured.producto).toBe('paneles');
  });

  it('de genérico a específico también: "focos estaca" pasa a la estaca de la ficha', () => {
    step('Hola, necesito focos estaca', { producto: 'focos estaca' });
    expect(step(FICHA, { producto: ESTACA }).captured.producto).toBe(ESTACA);
  });
});

describe('[B2B] una persona que pregunta por el despacho sigue siendo persona', () => {
  it.each([
    '¿Cuánto demora el despacho?',
    'hacen despachos a regiones?',
    'me sobra uno',
    'es para un espacio de mi casa en Maipú',
    'Sabes cuando demora el despacho',
  ])('"%s" deja B2C y nunca pide el RUT de la empresa', (body) => {
    step('Hola, necesito 5 focos LED luz cálida para mi casa', { producto: 'focos LED', cantidad: '5', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa' });
    const r = step(body);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
    expect(r.reply).not.toMatch(/RUT/);
    const end = step('ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(end.reply).not.toBe(flow.MSG4_B2B);
  });

  it.each(['Somos Comercial Prueba SpA', 'es para una obra', 'necesito factura', 'Somos una constructora'])('"%s" sigue siendo B2B', (body) => {
    step('Hola, necesito 5 focos LED luz cálida', { producto: 'focos LED', cantidad: '5', tipo_de_luz: 'cálida' });
    step(body);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
  });

  it('un correo con "empresa" no es una empresa', () => {
    step('Hola, necesito 5 focos LED luz cálida', { producto: 'focos LED', cantidad: '5', tipo_de_luz: 'cálida' });
    step('mi correo es ana@empresaprueba.example.com', { correo: 'ana@empresaprueba.example.com' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
  });
});

describe('[LUZ] el color de luz es un color', () => {
  it('"luz interior" de Claude no es un color: se pregunta y no dice "luz luz"', () => {
    const r = step('Tubo led de 60 cm para luz interior, necesito 10', { producto: 'Tubo led de 60 cm', cantidad: '10', tipo_de_luz: 'luz interior' });
    expect(r.captured.tipo_de_luz).toBeUndefined();
    expect(r.reply).toMatch(/tipo de luz/i);
    expect(r.reply).not.toMatch(/luz luz/i);
  });

  it('"Cinta led morada" con Claude "LED": el color no es LED', () => {
    expect(step('Cinta led morada', { producto: 'Cinta led', tipo_de_luz: 'LED' }).captured.tipo_de_luz).toBeUndefined();
  });

  it.each([['2700K', '2700K'], ['luz cálida', 'luz cálida'], ['Luz fría 6500K', 'Luz fría 6500K']])('"%s" se acepta', (value, expected) => {
    expect(step('Necesito focos LED ' + value, { producto: 'focos LED', tipo_de_luz: value }).captured.tipo_de_luz).toBe(expected);
  });

  it('"luz cálida" de Claude no se repite como "luz luz cálida"', () => {
    const r = step('Necesito focos LED luz cálida para el patio', { producto: 'focos LED', tipo_de_luz: 'luz cálida', proyecto_o_uso: 'patio' });
    expect(r.reply).not.toMatch(/luz luz/i);
  });

  it('5700K cambia una luz neutra y el cambio queda anotado', () => {
    step('Necesito 100 campanas UFO 100W luz neutra', { producto: 'campanas UFO 100W', cantidad: '100', tipo_de_luz: 'neutra' });
    const r = step('mejor color 5700k', { tipo_de_luz: '5700K' });
    expect(r.captured.tipo_de_luz).toBe('5700K');
    expect(r.captured.cambios).toContain('Tipo de luz: antes neutra, ahora 5700K');
  });
});

describe('[RESPALDO] el uso y el producto los dice el cliente', () => {
  it('negocio 119: "estadio" sale del nombre del producto, no es el uso', () => {
    const r = step('PROYECTOR LED DE ESTADIO 500W IP66 IK09', { producto: 'Proyector LED de estadio 500W IP66 IK09', proyecto_o_uso: 'estadio' });
    expect(r.captured.producto).toBe('Proyector LED de estadio 500W IP66 IK09');
    expect(r.captured.proyecto_o_uso).toBeUndefined();
  });

  it('la estaca "para jardín" de la ficha no es el uso; "En un jardín" sí', () => {
    step('Hola, necesito focos estaca', { producto: 'focos estaca' });
    expect(step(FICHA, { producto: ESTACA, proyecto_o_uso: 'jardín' }).captured.proyecto_o_uso).toBeUndefined();
    expect(step('En un jardín').captured.proyecto_o_uso).toBe('jardín');
  });

  it('negocio 206: el nombre del perfil no es el producto ni el uso', () => {
    const r = step('necesito 6 unidades', { producto: 'Sistemas de seguridad', proyecto_o_uso: 'sistemas de seguridad', cantidad: '6' });
    expect(r.captured.producto).toBeUndefined();
    expect(r.captured.proyecto_o_uso).toBeUndefined();
    expect(r.captured.cantidad).toBe('6');
  });

  it('negocio 197: un uso que el cliente nunca dijo no se anota', () => {
    const r = step('70 unidades de Ampolleta Led PAR30 8,5W Luz Fria E27', { producto: 'Ampolleta Led PAR30 8,5W', proyecto_o_uso: 'corredores' });
    expect(r.captured.proyecto_o_uso).toBeUndefined();
  });

  it('negocio 186: con solo el enlace de la ficha, el producto se conserva', () => {
    const r = step('https://example.com/producto/panel-led-redondo-embutido-18w', { producto: 'Panel LED redondo embutido 18W' });
    expect(r.captured.producto).toBe('Panel LED redondo embutido 18W');
  });

  it('un uso que el cliente sí dice se anota', () => {
    expect(step('Necesito 10 focos LED para mi casa', { producto: 'focos LED', cantidad: '10', proyecto_o_uso: 'casa' }).captured.proyecto_o_uso).toBe('casa');
  });
});

describe('[COMUNA] abreviaturas y "Santiago" como ciudad', () => {
  for (const claude of [{}, { comuna_o_ciudad: 'San Bernardo' }]) {
    it(`"Santiago, comuna san bdo" es San Bernardo (Claude ${JSON.stringify(claude)})`, () => {
      step('Necesito 10 focos LED luz cálida', { producto: 'focos LED', cantidad: '10', tipo_de_luz: 'cálida' });
      expect(step('Para mi casa. Santiago, comuna san bdo', claude).captured.comuna_o_ciudad).toBe('San Bernardo');
    });
  }

  it('"Santiago, comuna xyz": ninguna, y se pregunta', () => {
    step('Necesito 10 focos LED luz cálida', { producto: 'focos LED', cantidad: '10', tipo_de_luz: 'cálida' });
    const r = step('Santiago, comuna xyz');
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
  });

  it('"Santiago" solo, como respuesta a la pregunta por la comuna, es Santiago', () => {
    step('Necesito 10 focos LED luz cálida', { producto: 'focos LED', cantidad: '10', tipo_de_luz: 'cálida' });
    expect(step('Santiago').captured.comuna_o_ciudad).toBe('Santiago');
  });
});

const CLOSE_FIELDS = { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'cálida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' };
/** Cierra con el negocio registrado (id 4242), como lo deja el webhook. */
function closeRegistered(body = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com', claude: Claude = CLOSE_FIELDS) {
  step(body, claude);
  expect(flow.getFlowState(PHONE).stage).toBe('closed');
  flow.recordDealOutcome(PHONE, true, undefined, 4242);
}

describe('[SIN-VISITA] comprar productos no es pedir una instalación', () => {
  it('negocio 195: "nuestra instalación funciona con 12V" pide 6 focos, no el servicio', () => {
    const r = step('Hola, busco 6 focos LED sumergibles RGB de 10W IP68 para piscina. Nuestra instalación funciona con un transformador de 12V AC. ¿Qué modelos tienen?', { producto: 'focos LED sumergibles RGB 10W IP68', cantidad: '6', proyecto_o_uso: 'piscina' });
    const state = flow.getFlowState(PHONE);
    expect(state.isInstallFlow).toBeFalsy();
    expect(state.stage).not.toBe('install_capture');
    expect(r.captured.cantidad).toBe('6');
    expect(r.reply).not.toMatch(/instalaci|visita|terreno/i);
  });

  it('"Mi instalación eléctrica es de 220V, necesito 10 paneles LED" sigue en productos', () => {
    const r = step('Mi instalación eléctrica es de 220V, necesito 10 paneles LED', { producto: 'paneles LED', cantidad: '10' });
    expect(flow.getFlowState(PHONE).isInstallFlow).toBeFalsy();
    expect(r.captured).toMatchObject({ producto: 'paneles LED', cantidad: '10' });
  });

  it.each(['Necesito el servicio de instalación de 10 focos', 'Quiero instalar focos en mi casa', 'Busco un instalador para mi casa'])('"%s" sí pide el servicio', (body) => {
    step(body);
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });

  it('con el negocio registrado, "la instalación la hace mi eléctrico" no empieza otra conversación', () => {
    closeRegistered();
    const r = step('la instalación la hace mi eléctrico');
    expect(r.closedFlow).toBe(true);
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
    expect(flow.getFlowState(PHONE).isInstallFlow).toBeFalsy();
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '12' });
  });

  it('ningún mensaje fijo ni el cierre de instalación ofrece una visita o una llamada', () => {
    const texts = Object.entries(flow).filter(([k, v]) => /^MSG/.test(k) && typeof v === 'string').map(([, v]) => v as string);
    texts.push(flow.installClosingMsg({ install_correo: 'ana.prueba@example.com' }), flow.installClosingMsg({}));
    for (const text of texts) expect(text).not.toMatch(/visita|terreno|llam/i);
    expect(flow.installClosingMsg({ install_correo: 'ana.prueba@example.com' })).toBe('Tu solicitud quedó registrada. Claudio Quero te responderá por correo el mismo día hábil.');
  });

  it('el cierre de instalación registrado y la pregunta por lo que sigue no prometen visita', () => {
    step('Quiero instalar focos en mi casa');
    const r = step('Soy Ana Prueba, ana.prueba@example.com, casa en Maipú', { nombre: 'Ana Prueba' });
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, reply: flow.MSG4_INSTALL });
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
    expect(step('¿Y ahora qué hago?').reply).toBe(flow.MSG_WAIT);
  });
});

describe('[REINICIO] después del cierre, el mismo pedido sigue en el mismo negocio', () => {
  it('negocio 144: "necesito hablar con un vendedor" no vuelve a pedir la cantidad', () => {
    closeRegistered('PLRE9F (Luz fría - 6500K), 25 unidades para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com', { producto: 'PLRE9F', tipo_de_luz: 'Luz fría 6500K', cantidad: '25', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    const r = step('necesito hablar con un vendedor{', { wantsHuman: true });
    expect(r.closedFlow).toBe(true);
    expect(r.reply).not.toMatch(/cantidad/i);
    expect(r.captured).toMatchObject({ producto: 'PLRE9F', cantidad: '25' });
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });

  for (const claude of [{}, { producto: 'campana UFO 100W driver Philips', tipo_de_luz: '5700K', cantidad: '100', comuna_o_ciudad: 'Osorno' }]) {
    it(`negocio 145: el color definitivo va al mismo negocio y se conservan 100 y Osorno (Claude ${Object.keys(claude).length ? 'repite' : 'vacío'})`, () => {
      closeRegistered('Necesito cotizar 100 luminarias UFO 100W con driver Philips, luz neutra, para un galpón industrial en Osorno. Soy Ana Prueba, ana.prueba@example.com', { producto: 'luminarias UFO 100W con driver Philips', cantidad: '100', tipo_de_luz: 'neutra', proyecto_o_uso: 'galpón industrial', comuna_o_ciudad: 'Osorno', nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
      const r = step('Estimado, las luminarias que necesitamos definitivamente son: campana Ufo 100W driver philips color 5700k 90 grados', claude);
      expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
      expect(r.reply).not.toMatch(/cantidad/i);
      expect(r.captured).toMatchObject({ tipo_de_luz: '5700K', cantidad: '100', comuna_o_ciudad: 'Osorno' });
      expect(r.captured.cambios).toContain('Tipo de luz: antes neutra, ahora 5700K');
      expect(flow.getFlowState(PHONE).dealId).toBe(4242);
    });
  }

  it('negocio 186: "ya me cotizaron, quiero ese artículo, ¿cómo lo puedo comprar?" conserva la cantidad 1', () => {
    step('quiero este artículo: https://example.com/panel-led-cuadrado-sobrepuesto-18w-ip44', { producto: 'Panel LED cuadrado sobrepuesto 18W IP44' });
    step('luz: Neutra', { tipo_de_luz: 'Neutra' });
    step('Cantidad: 1', { cantidad: '1' });
    for (let i = 0; i < 4 && flow.getFlowState(PHONE).stage !== 'closed'; i++) step('no sé');
    expect(flow.getFlowState(PHONE).stage).toBe('closed');
    const r = step('ya me cotizaron, quiero ese artículo, como lo puedo comprar?');
    expect(r.closedFlow).toBe(true);
    expect(r.reply).not.toMatch(/cantidad/i);
    expect(r.captured).toMatchObject({ producto: 'Panel LED cuadrado sobrepuesto 18W IP44', cantidad: '1' });
    const end = step('ana.prueba@example.com', { correo: 'ana.prueba@example.com' });
    expect(end).toMatchObject({ closedFlow: true, shouldCreateDeal: true });
    expect(end.captured).toMatchObject({ producto: 'Panel LED cuadrado sobrepuesto 18W IP44', cantidad: '1', correo: 'ana.prueba@example.com' });
  });

  it('otro producto con su cantidad sí es otro pedido', () => {
    closeRegistered();
    const r = step('Necesito 30 paneles LED 60x60 para una oficina', { producto: 'paneles LED 60x60', cantidad: '30', proyecto_o_uso: 'oficina' });
    expect(r.closedFlow).toBe(false);
    expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
    expect(r.captured).toMatchObject({ producto: 'paneles LED 60x60', cantidad: '30' });
  });

  it('una cantidad nueva del mismo producto va al mismo negocio, con el cambio anotado', () => {
    closeRegistered();
    const r = step('Necesito 20 focos LED, no 12', { producto: 'focos LED', cantidad: '20' });
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '20', comuna_o_ciudad: 'Maipú' });
    expect(r.captured.cambios?.join(' ')).toMatch(/Cantidad: antes 12, ahora 20/);
  });

  it('lo que Claude repite del historial no se escribe otra vez', () => {
    closeRegistered();
    const r = step('gracias', CLOSE_FIELDS);
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: false, reply: flow.MSG_REGISTERED_SHORT });
  });

  it('"Claudio me dijo que eran 25 unidades para Maipú": la cantidad y la comuna se guardan antes de responder', () => {
    step('Necesito paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fría' });
    const r = step('Claudio me dijo que eran 25 unidades para Maipú', { cantidad: '25', comuna_o_ciudad: 'Maipú' });
    expect(r.reply).toBe(flow.MSG_EXECUTIVE);
    expect(flow.getFlowState(PHONE).captured).toMatchObject({ producto: 'paneles LED', cantidad: '25', comuna_o_ciudad: 'Maipú' });
  });
});
