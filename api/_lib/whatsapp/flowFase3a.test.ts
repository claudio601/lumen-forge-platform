// api/_lib/whatsapp/flowFase3a.test.ts
// Bot de WhatsApp, FASE 3A (16-11-2026): solo ortografía y los textos aprobados por el dueño el 11-11.
// - Punto 1: tildes y los signos ¿ ¡ en lo que el cliente ve; las etiquetas que el flujo compara (ASKED_FIELD) cambian
//   con el texto, y los valores guardados (tipo_de_luz "calida", "fria") no.
// - Punto 2: un solo cierre registrado (MSG4) para productos (persona o empresa) e instalación.
// - Punto 3: una segunda pregunta por el despacho recibe otra vez MSG_WAIT_DELIVERY, no el recordatorio del registro.
// - Punto 4: una persona (B2C o sin tipo, con un RUT de persona: menos de 50.000.000) que da un RUT con el dígito
//   verificador malo no recibe MSG_RUT_INVALID; queda guardado como inválido y la nota lo marca. Las empresas siguen
//   igual (revisión 16-11): la conversación de empresa, o un RUT de 50.000.000 o más, recibe la repregunta una vez, y
//   solo en el mensaje que trae el RUT (como en main).
// Los textos exactos de cada mensaje los congela ownerApprovedTexts.test.ts. Solo datos inventados.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { buildNote } from './pipedriveLead';

const PHONE = '+56900000731';
const SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
type Claude = Parameters<typeof flow.processFlowStep>[2];
let lastReply: string | undefined;
/** Un mensaje del cliente, con la respuesta anterior (como el webhook) para la regla de no repetir. */
const step = (body: string, claude: Claude = {}) => {
  const r = flow.processFlowStep(PHONE, body, claude, { ...SIGNALS, lastReply });
  lastReply = r.reply;
  return r;
};
afterEach(() => { flow.clearFlowState(PHONE); lastReply = undefined; });

const FIELDS = { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'calida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba' };
const ORDER = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba';
const EMAIL = 'ana.prueba@example.com';

describe('punto 1: tildes y signos de apertura', () => {
  it.each([
    ['calida', 'luz cálida'],
    ['fria', 'luz fría'],
    ['ambar', 'luz ámbar'],
    ['luz calida', 'luz cálida'],
    ['Calida y FRIA', 'luz Cálida y FRÍA'],
  ])('el color guardado "%s" se muestra como «%s» y se guarda sin cambios', (luz, shown) => {
    const r = step('Hola, busco focos luz ' + luz + ' para mi casa', { producto: 'focos', tipo_de_luz: luz, proyecto_o_uso: 'casa' });
    expect(r.reply).toBe('Entendido, para la casa, ' + shown + ' podemos orientarte bien. Solo necesito saber cantidad de unidades para continuar.');
    expect(flow.getFlowState(PHONE).captured.tipo_de_luz).toBe(luz);
  });

  it('un color que no es de la lista queda tal cual (neutra, 4000K)', () => {
    const r = step('Hola, busco focos luz neutra para mi casa', { producto: 'focos', tipo_de_luz: 'neutra', proyecto_o_uso: 'casa' });
    expect(r.reply).toContain('luz neutra podemos');
  });

  it('la repregunta de la etapa 1 con varios datos termina en «¿Me los puedes indicar?»', () => {
    const r = step('Hola, busco focos LED', { producto: 'focos LED' });
    expect(r.reply).toBe('Gracias por tu mensaje, podemos ayudarte. Para recomendarte las opciones adecuadas, necesito:\n1) Tipo de luz preferida\n2) Cantidad de unidades\n\n¿Me los puedes indicar?');
  });

  it('la etapa 2 con un dato: «comuna o ciudad de instalación. ¿Me lo puedes indicar?», y la respuesta se reconoce', () => {
    const r = step('Necesito 10 paneles 60x60 luz fria para una oficina', { producto: 'paneles 60x60', tipo_de_luz: 'fria', cantidad: '10', proyecto_o_uso: 'oficina' });
    expect(r.reply).toBe('Casi listo. Solo me falta saber: comuna o ciudad de instalación. ¿Me lo puedes indicar?');
    // La etiqueta con tilde sigue siendo la clave de ASKED_FIELD: la pregunta queda anotada y la comuna sola se toma.
    expect(flow.getFlowState(PHONE).lastQuestion).toEqual({ asks: ['comuna_o_ciudad'], listLength: 0 });
    expect(step('Maipú').captured.comuna_o_ciudad).toBe('Maipú');
  });

  it('la etapa 2 con varios datos termina en «¿Me los puedes indicar?» y la lista lleva la comuna con tilde', () => {
    step('Necesito 10 paneles 60x60 para una oficina', { producto: 'paneles 60x60', cantidad: '10', proyecto_o_uso: 'oficina' });
    const r = step('no sé');
    expect(r.reply).toBe('Casi listo. Solo me falta saber:\n- tipo de luz preferida\n- comuna o ciudad de instalación\n\n¿Me los puedes indicar?');
    expect(flow.getFlowState(PHONE).lastQuestion?.asks).toEqual(['tipo_de_luz', 'comuna_o_ciudad']);
  });

  it('la etapa 3 con varios datos termina en «¿Me los puedes indicar?»', () => {
    step('Necesito 10 paneles 60x60 para mi casa en Maipú', { producto: 'paneles 60x60', cantidad: '10', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú' });
    const r = step('no sé');
    expect(r.reply).toBe('Para registrar tu solicitud necesito:\n- tipo de luz preferida\n- nombre\n- correo de contacto\n\n¿Me los puedes indicar?');
  });

  // (revisión 16-11) Las etiquetas de una palabra también llegan al cliente: la guarda las congela en FRAGMENTS.
  it('la etiqueta «producto» se muestra en la lista como «1) Producto»', () => {
    const r = step('Hola, necesito 10 unidades para mi casa', { cantidad: '10', proyecto_o_uso: 'casa' });
    expect(r.reply).toBe('Entendido, para la casa podemos orientarte bien. Para recomendarte las opciones adecuadas, necesito:\n1) Producto\n2) Tipo de luz preferida\n\n¿Me los puedes indicar?');
  });

  it('la etiqueta «correo» de la instalación: «Casi listo. Solo me falta tu correo para registrar la solicitud.»', () => {
    const r = step('Quiero instalar focos en mi casa en Maipú, soy Ana Prueba', { nombre: 'Ana Prueba', comuna_o_ciudad: 'Maipú', proyecto_o_uso: 'casa' });
    expect(r.reply).toBe('Casi listo. Solo me falta tu correo para registrar la solicitud.');
  });

  it('la instalación: «solicitud de instalación» con tilde en las dos preguntas', () => {
    expect(step('Necesito un instalador').reply).toBe(
      'Perfecto. Para derivar tu solicitud de instalación y poder cotizarte, necesito estos datos: nombre completo, correo, comuna y tipo de proyecto.',
    );
    flow.clearFlowState(PHONE);
    expect(step('Quiero instalar focos en mi casa').reply).toBe(
      'Gracias. Para completar tu solicitud de instalación, necesito que me indiques:\n1) Nombre completo\n2) Correo\n3) Comuna',
    );
  });

  it('el saludo, MSG2 y las preguntas llevan ¡ y ¿ (texto exacto en ownerApprovedTexts.test.ts)', () => {
    expect(flow.MSG1.startsWith('¡Hola! Soy el asistente de eLIGHTS.cl')).toBe(true);
    expect(flow.MSG2).toContain('1) ¿Para qué espacio o proyecto es la instalación?\n2) ¿En qué comuna o ciudad sería?');
    expect(flow.MSG_NEED_EMAIL_AND_CONTEXT).toContain('¿qué producto');
    expect(flow.MSG_EXECUTIVE).toContain('también');
  });
});

describe('punto 2: un solo cierre registrado (MSG4)', () => {
  it('el texto es el aprobado el 11-11 y no quedan MSG4_B2B ni MSG4_INSTALL', () => {
    expect(flow.MSG4).toBe('Tu solicitud quedó registrada. Claudio Quero te responderá por correo el mismo día hábil.');
    expect(Object.keys(flow)).not.toContain('MSG4_B2B');
    expect(Object.keys(flow)).not.toContain('MSG4_INSTALL');
  });

  it('persona (B2C): cierra con MSG4', () => {
    const r = step(ORDER + ', ' + EMAIL, FIELDS);
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, closedFlow: true });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
  });

  it('empresa (B2B) con RUT válido: cierra con el mismo MSG4', () => {
    const r = step('Necesito 12 focos LED luz cálida para la bodega de Comercial Prueba SpA en Maipú, RUT 77.123.456-9, compras@comercial-prueba.example.com',
      { ...FIELDS, proyecto_o_uso: 'bodega', empresa: 'Comercial Prueba SpA', correo: 'compras@comercial-prueba.example.com' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
  });

  it('empresa sin RUT que cierra con el correo: MSG4', () => {
    step('Necesito 20 paneles LED 60x60 luz neutra para la oficina de Comercial Prueba SpA en Ñuñoa',
      { producto: 'paneles 60x60', tipo_de_luz: 'neutra', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Ñuñoa', empresa: 'Comercial Prueba SpA' });
    const r = step('compras@comercial-prueba.example.com', { correo: 'compras@comercial-prueba.example.com' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
  });

  it('el correo que llega después del cierre sin negocio: MSG4', () => {
    step(ORDER, FIELDS);
    expect(step('no tengo correo ahora').closedFlow).toBe(true);
    expect(step(EMAIL, { correo: EMAIL })).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
  });

  it('el RUT válido que llega con el negocio registrado: MSG4', () => {
    step(ORDER + ', ' + EMAIL, FIELDS);
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
    expect(step('RUT 77.123.456-9')).toMatchObject({ reply: flow.MSG4, rutUpdate: true });
  });

  it('instalación con correo: MSG4; sin correo, MSG4_INSTALL_NO_EMAIL (sin cambios)', () => {
    expect(flow.installClosingMsg({ install_correo: EMAIL })).toBe(flow.MSG4);
    expect(flow.installClosingMsg({})).toBe(flow.MSG4_INSTALL_NO_EMAIL);
  });
});

describe('punto 3: el despacho preguntado dos veces', () => {
  const DELIVERY = '¿Cuánto demora el despacho?';
  function registered() {
    step(ORDER + ', ' + EMAIL, FIELDS);
    flow.recordDealOutcome(PHONE, true, undefined, 4242);
  }

  it('con el negocio registrado, la segunda y la tercera vez reciben otra vez MSG_WAIT_DELIVERY', () => {
    registered();
    for (let i = 0; i < 3; i++) expect(step(DELIVERY).reply).toBe(flow.MSG_WAIT_DELIVERY);
  });

  it('la ubicación y el despacho juntos, dos veces: la misma respuesta completa', () => {
    registered();
    const both = flow.MSG_LOCATION + '\n\n' + flow.MSG_WAIT_DELIVERY;
    expect(step('¿Dónde están ubicados y cuánto demora el despacho?').reply).toBe(both);
    expect(step('¿Dónde están ubicados y cuánto demora el despacho?').reply).toBe(both);
  });

  it('«gracias» repetido sigue alternando los textos aprobados (sin cambios)', () => {
    registered();
    expect(step('gracias').reply).toBe(flow.MSG_REGISTERED_SHORT);
    expect(step('gracias').reply).toBe(flow.MSG_WAIT);
    expect(step('gracias').reply).toBe(flow.MSG_REGISTERED_SHORT);
  });

  it('el texto de MSG_WAIT_DELIVERY no cambia', () => {
    expect(flow.MSG_WAIT_DELIVERY).toBe('El plazo y el costo del despacho van en la cotización, que te enviaremos por correo el mismo día hábil.');
  });
});

describe('punto 4: el RUT que no calza de una persona no se vuelve a pedir', () => {
  // Un RUT de persona (menos de 50.000.000) con el dígito verificador malo: el válido es 15.432.876-9.
  const PERSON_RUT = '15.432.876-0';
  it('persona (B2C) en el primer mensaje: no recibe MSG_RUT_INVALID, cierra y la nota marca el RUT', () => {
    const r = step(ORDER + ', RUT ' + PERSON_RUT + ', ' + EMAIL, FIELDS);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
    expect(r.reply).toBe(flow.MSG4);
    expect(r.captured).toMatchObject({ rut: PERSON_RUT, rut_valido: false });
    expect(flow.getFlowState(PHONE).rutRetryAsked).toBeUndefined();
    expect(flow.getFlowState(PHONE).rutAskedLast).toBe(false);
    const note = buildNote({ phone: PHONE, name: 'Perfil Prueba', summary: 'Pide focos.', body: 'x', captured: r.captured, captureStatus: r.captureStatus });
    expect(note).toContain('RUT: ' + PERSON_RUT + ' (INVALIDO: no calza el digito verificador)');
  });

  it('persona (B2C) a mitad de la conversación: sigue con lo que falta, sin pedir el RUT', () => {
    step(ORDER, FIELDS);
    const r = step('RUT ' + PERSON_RUT);
    expect(r.reply).not.toBe(flow.MSG_RUT_INVALID);
    expect(r.reply).not.toMatch(/RUT/);
    expect(r.captured).toMatchObject({ rut: PERSON_RUT, rut_valido: false });
  });

  it('sin tipo (Unknown): tampoco recibe MSG_RUT_INVALID', () => {
    step('Hola');
    expect(flow.getFlowState(PHONE).leadType).toBe('Unknown');
    const r = step('15432876-0');
    expect(flow.getFlowState(PHONE).leadType).toBe('Unknown');
    expect(r.reply).not.toBe(flow.MSG_RUT_INVALID);
    expect(r.captured).toMatchObject({ rut: PERSON_RUT, rut_valido: false });
  });

  it('empresa (B2B): se le pide de nuevo una vez, como antes', () => {
    step('Necesito 12 focos LED luz cálida para la bodega de Comercial Prueba SpA en Maipú', { ...FIELDS, proyecto_o_uso: 'bodega', empresa: 'Comercial Prueba SpA' });
    expect(step('RUT 77.123.456-8').reply).toBe(flow.MSG_RUT_INVALID);
    expect(flow.getFlowState(PHONE)).toMatchObject({ rutRetryAsked: true, rutAskedLast: true });
    expect(step('RUT 77.123.456-0').reply).not.toBe(flow.MSG_RUT_INVALID);
  });

  it('una empresa que da un RUT de persona que no calza: también se le pide de nuevo', () => {
    step('Necesito 12 focos LED luz cálida para la bodega de Comercial Prueba SpA en Maipú', { ...FIELDS, proyecto_o_uso: 'bodega', empresa: 'Comercial Prueba SpA' });
    expect(step('RUT ' + PERSON_RUT).reply).toBe(flow.MSG_RUT_INVALID);
  });

  // (revisión 16-11) Un RUT de 50.000.000 o más es de empresa, organismo o comunidad aunque el mensaje no traiga otras
  // palabras de empresa (el flujo marca B2C a cualquier mensaje largo sin ellas): se pide de nuevo, como en main.
  it('RUT de empresa (76.x) que no calza, sin palabras de empresa: se pide de nuevo y no se registra todavía', () => {
    step('Hola, necesito 20 campanas LED 150W luz fria para un galpon en Pudahuel',
      { producto: 'campanas LED 150W', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'galpon', comuna_o_ciudad: 'Pudahuel' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
    const r = step('RUT 76.123.456-3, Maria Prueba, maria@example.com', { nombre: 'Maria Prueba', correo: 'maria@example.com' });
    expect(r).toMatchObject({ reply: flow.MSG_RUT_INVALID, shouldCreateDeal: false });
    const fixed = step('perdón, es 76.123.456-0');
    expect(fixed.captured).toMatchObject({ rut: '76.123.456-0', rut_valido: true, rut_tipo: 'empresa' });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
    expect(fixed).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
  });

  it('RUT de empresa (77.x) que no calza, todo en un mensaje y sin palabras de empresa: se pide de nuevo', () => {
    const r = step('Necesito 12 focos LED luz cálida para la bodega en Maipú, RUT 77.123.456-8, ' + EMAIL,
      { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'calida', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Maipú', correo: EMAIL });
    expect(r).toMatchObject({ reply: flow.MSG_RUT_INVALID, shouldCreateDeal: false });
    expect(r.captured).toMatchObject({ rut: '77.123.456-8', rut_valido: false });
  });

  it('el RUT de empresa que vuelve a no calzar queda guardado y el flujo sigue (una sola repregunta)', () => {
    step('Hola, necesito 20 campanas LED 150W luz fria para un galpon en Pudahuel',
      { producto: 'campanas LED 150W', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'galpon', comuna_o_ciudad: 'Pudahuel' });
    expect(step('RUT 76.123.456-3, Maria Prueba, maria@example.com', { nombre: 'Maria Prueba', correo: 'maria@example.com' }).reply).toBe(flow.MSG_RUT_INVALID);
    const again = step('76.123.456-4');
    expect(again).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(again.captured).toMatchObject({ rut: '76.123.456-4', rut_valido: false });
  });

  // (revisión 16-11) Un RUT malo guardado en un mensaje anterior que no lo pide (el del ejecutivo o el de «hablar con un
  // vendedor») no se pide en un mensaje sin RUT: como en main, el mensaje con el correo registra la solicitud y el que
  // pregunta el precio recibe su respuesta.
  it('empresa: RUT malo en el mensaje del ejecutivo y después todo con el correo: registra (sin repregunta)', () => {
    expect(step('Claudio me dijo que les escribiera. Somos Constructora Prueba SpA, RUT 76.123.456-3', { empresa: 'Constructora Prueba SpA' }).reply).toBe(flow.MSG_EXECUTIVE);
    const r = step('necesitamos 50 campanas LED 200W luz fria para una bodega en Quilicura, compras10@example.com',
      { producto: 'campanas LED 200W', tipo_de_luz: 'fria', cantidad: '50', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', correo: 'compras10@example.com' });
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true, closedFlow: true });
    expect(r.captured).toMatchObject({ rut: '76.123.456-3', rut_valido: false });
  });

  it('empresa: pide un vendedor con un RUT malo y después pregunta el precio: recibe la respuesta del precio', () => {
    step('Somos Constructora Prueba SpA, necesitamos 50 campanas LED 200W luz fria para una bodega en Quilicura',
      { producto: 'campanas LED 200W', tipo_de_luz: 'fria', cantidad: '50', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura', empresa: 'Constructora Prueba SpA' });
    const human = flow.processFlowStep(PHONE, 'quiero hablar con un vendedor, rut 76.123.456-3', {}, { wantsHuman: true, qualifiesForDeal: false, lastReply });
    lastReply = human.reply;
    expect(human.reply).toBe(flow.MSG_NEED_EMAIL);
    expect(step('¿cuanto cuestan las campanas?').reply).toBe(flow.MSG_Q_PRICE);
  });

  it('persona que después resulta ser empresa, con el RUT malo guardado y sin correo: se le pide una vez', () => {
    step(ORDER + ', RUT ' + PERSON_RUT, FIELDS);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
    expect(step('Es para mi empresa, Comercial Prueba SpA', { empresa: 'Comercial Prueba SpA' }).reply).toBe(flow.MSG_RUT_INVALID);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
    expect(step(EMAIL, { correo: EMAIL }).reply).toBe(flow.MSG4);
  });

  it('persona que pasa a empresa y pregunta el precio, con el RUT malo guardado y sin correo: recibe la respuesta del precio', () => {
    step(ORDER + ', RUT ' + PERSON_RUT, FIELDS);
    expect(step('Es para mi empresa, Comercial Prueba SpA. ¿Cuánto cuestan?', { empresa: 'Comercial Prueba SpA' }).reply).toBe(flow.MSG_Q_PRICE);
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
  });

  it('persona que pasa a empresa en el mensaje que trae el correo: registra, sin repregunta (no atrasa el registro)', () => {
    step(ORDER + ', RUT ' + PERSON_RUT, FIELDS);
    const r = step('Es para mi empresa, Comercial Prueba SpA: ' + EMAIL, { empresa: 'Comercial Prueba SpA', correo: EMAIL });
    expect(flow.getFlowState(PHONE).leadType).toBe('B2B');
    expect(r).toMatchObject({ reply: flow.MSG4, shouldCreateDeal: true });
    expect(r.captured).toMatchObject({ rut: PERSON_RUT, rut_valido: false });
  });
});
