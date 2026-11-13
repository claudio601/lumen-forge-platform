// PR 142, ronda 2. Mensajes inventados de los tres verificadores.
import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { inspectRut } from './rutCapture';

const PHONE = '+56900000142';
const SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
type Claude = Parameters<typeof flow.processFlowStep>[2];
type Closure = 'registered' | 'failed' | 'pending' | 'no-email' | 'install';
const FIRST = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba';
const FIELDS = { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'calida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba' };
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, SIGNALS);
function close(kind: Closure = 'registered') {
  if (kind === 'install') {
    step('Quiero instalar focos en mi casa', {});
    step('Soy Ana Prueba, ana.prueba@example.com, casa en Maipú', { nombre: 'Ana Prueba' });
  } else if (kind === 'no-email') {
    step(FIRST, FIELDS);
    step('no sé');
  } else {
    step(FIRST + ', ana.prueba@example.com', { ...FIELDS, correo: 'ana.prueba@example.com' });
  }
  expect(flow.getFlowState(PHONE).stage).toBe('closed');
  if (kind === 'registered' || kind === 'install') flow.recordDealOutcome(PHONE, true, undefined, 4242);
  if (kind === 'failed') flow.recordDealOutcome(PHONE, false);
}
function expectNew(body: string, claude: Claude = {}) {
  const r = step(body, claude);
  expect(r.closedFlow).toBe(false);
  expect(r.shouldCreateDeal).toBe(false);
  expect(r.rutUpdate).toBeUndefined();
  expect(r.captured.cambios).toBeUndefined();
  expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
  expect(flow.getFlowState(PHONE).deal).toBeUndefined();
  return r;
}
afterEach(() => flow.clearFlowState(PHONE));

// V1.1/V1.2/V1.6 y V3.1/V3.2: cada pedido reproducido, también sin verbo o producto conocido.
const ORDERS = [
  'Quiero la nueva cotización de 40 reflectores LED',
  'Quiero la nueva cotizacion de 40 reflectores LED',
  'QUIERO LA NUEVA COTIZACIÓN DE 40 REFLECTORES LED',
  'mi nueva cotizacion: 15 campanas industriales',
  'Mi nueva cotización:\n15 campanas industriales',
  '*Mi nueva cotización:* 15 campanas industriales',
  'Hola!\n*Mi nueva cotización:*\n- 15 campanas industriales\n- 10 reflectores LED',
  'La nueva cotización es por 40 reflectores LED',
  'Les pido la nueva cotización con 40 reflectores LED',
  'Quiero la otra cotización con 40 reflectores LED',
  '¿Me pueden agregar 30 focos más a la nueva cotización?',
  'Necesito unos 30 focos para mi nueva cotización',
  'Para mi nueva cotización necesito unos 30 focos',
  'Necesito 30 unidades de focos LED para mi nueva cotización',
  'Necesito 1.000 focos LED para mi nueva cotización',
  'Necesito:\n30 focos LED para mi nueva cotización',
  'Necesito también 30 focos para mi nueva cotización',
  'Necesito 20 paneles solares para mi nueva cotización',
  'Busco 10 tubos para mi nueva cotización',
  'Gracias por la nueva cotización. Ahora quiero cotizar 20 paneles solares',
  'Recibí la otra cotización, ahora necesito cotizar postes solares',
  'Gracias por la otra cotización. Necesito una de 40 reflectores LED',
  'Recibí la nueva cotización. Ahora necesito otra con 40 reflectores LED',
  'Necesito 20 paneles para la nueva cotización',
  'Necesito unos 30 focos LED para mi nueva cotización',
  'Necesito aprox. 30 focos LED para mi nueva cotización',
  'Quiero 30 unidades de focos LED para mi nueva cotización',
  'Mi nueva cotización: 20 paneles LED luz fría para una bodega en Quilicura',
  'Para la nueva cotización: 20 paneles LED luz fría',
  'Quiero agregar 10 paneles LED a la nueva cotización',
  'Necesito 40 campanas para la otra cotización',
  'Necesito 40 tubos para mi nueva cotización',
  'Necesito lo mismo que la otra cotización pero 50 focos LED',
  'Hola, en la nueva cotización faltaron 10 focos LED',
  'Necesito postes solares para mi nueva cotización',
  'Quiero saber el estado de mi nueva cotización.',
  '¿Me confirman la nueva cotización de 20 paneles LED?',
  'Quiero que me instalen los focos de mi nueva cotización',
  'Necesito otra cotización de 20 paneles',
  'Otro pedido: 20 paneles LED',
  '¿Me pueden cotizar 30 focos más?',
  'El galpon tiene varias zonas. '.repeat(80) + ' Necesito 40 reflectores LED para el galpon',
  'El galpon tiene varias zonas. '.repeat(80) + ' Quiero cotizar 40 reflectores LED',
];
describe.each<Closure>(['registered', 'failed', 'pending', 'no-email', 'install'])('regresiones conservadas: pedidos con cierre %s', (kind) => {
  it.each(ORDERS)('abre otro flujo: %s', (body) => {
    close(kind);
    const previous = flow.getFlowState(PHONE);
    const snapshot = structuredClone(previous);
    expectNew(body);
    expect(previous).toEqual(snapshot);
  });
});

it('un pedido con datos de Claude usa el producto y la cantidad nuevos', () => {
  close();
  const r = expectNew(ORDERS[0], { producto: 'reflectores LED', cantidad: '40' });
  expect(r.captured).toMatchObject({ producto: 'reflectores LED', cantidad: '40' });
});

it.each([
  ['mi nueva cotizacion: 15 campanas industriales', 'campanas industriales', '15'],
  ['Necesito unos 30 focos para mi nueva cotización', 'focos', '30'],
  ['Busco 10 tubos para mi nueva cotización', undefined, '10'],
  ['Necesito 20 paneles solares para mi nueva cotización', undefined, '20'],
  // #144: el punto de miles ya no corta la oración (antes quedaba la cantidad 1).
  ['Necesito 1.000 focos LED para mi nueva cotización', 'focos LED', '1000'],
])('conserva la extracción de main: %s', (body, producto, cantidad) => {
  close();
  const r = expectNew(body);
  expect(r.captured.producto).toBe(producto);
  expect(r.captured.cantidad).toBe(cantidad);
});

// V1.3/V3.5: "requiero" no gana sobre una corrección ni pierde el pedido pendiente.
describe('regresiones conservadas: preguntas con requiero', () => {
  it.each([
    '¿Requiero hacer otra cotización para cambiar el RUT? El correcto es 76.123.456-0',
    '¿Requiero otra cotización para corregir el RUT? 76.123.456-0',
  ])('%s', (body) => {
    close();
    const r = step(body);
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured).toMatchObject({ rut: '76.123.456-0', rut_valido: true, producto: 'focos LED', cantidad: '12' });
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });
  it('la pregunta conserva la corrección de correo', () => {
    close();
    const r = step('¿Requiero hacer otra cotización para cambiar mi correo? Es ana.nueva@example.com');
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.correo).toBe('ana.nueva@example.com');
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });
  it('la pregunta con correo registra el pedido pendiente', () => {
    close('pending');
    const r = step('¿Requiero otra cotización? Mi correo es ana.nueva@example.com');
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true });
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '12', correo: 'ana.nueva@example.com' });
  });
});

const EMAILS = [
  ['cotizaciones_obra@example.com', 'cotizaciones_obra@example.com'],
  ['presupuesto_obra@example.com', 'presupuesto_obra@example.com'],
  ['Necesito corregir mi correo: otros_pedidos@example.com', 'otros_pedidos@example.com'],
  ['Mi correo nuevo es nueva_cotizacion@example.com', 'nueva_cotizacion@example.com'],
  ['Mi correo correcto es nuevos_proyectos@example.com', 'nuevos_proyectos@example.com'],
  ['Escríbanme a nuevos_proyectos@example.com', 'nuevos_proyectos@example.com'],
  ['presupuestos_obra@example.com', 'presupuestos_obra@example.com'],
  ['otros_pedidos@example.com', 'otros_pedidos@example.com'],
  ['nueva_cotizacion@example.com', 'nueva_cotizacion@example.com'],
  ['nuevos_proyectos@example.com', 'nuevos_proyectos@example.com'],
];
describe.each<Closure>(['registered', 'failed'])('regresiones conservadas: correo con cierre %s', (kind) => {
  it.each(EMAILS)('%s', (body, correo) => {
    close(kind);
    // [REINICIO] (fase 1, 12-11-2026) Con el negocio fallido, "Necesito corregir mi correo: X" y "Mi correo nuevo es
    // nueva_cotizacion@…" ya no empiezan otra conversación (antes la reiniciaban y perdían el pedido): no nombran
    // otro producto ni otra cantidad, y la palabra del correo no es una cotización. Siguen como las demás formas.
    const r = step(body);
    expect(r.closedFlow).toBe(true);
    expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '12' });
    if (kind === 'failed') {
      expect(r.reply).toBe(flow.MSG_DEAL_FAILED);
      expect(r.shouldCreateDeal).toBe(false);
    } else {
      expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true });
      expect(r.captured.correo).toBe(correo);
      expect(flow.getFlowState(PHONE).dealId).toBe(4242);
    }
  });
});

describe('consulta estrecha, normalización y datos de Claude', () => {
  it.each([
    '¿Me confirman la nueva cotización?',
    '¿Me confirman *la nueva cotización*?',
    '¿ME CONFIRMAN LA NUEVA COTIZACIÓN?',
    '¿Me confirman esa nueva cotización?',
    '¿Me confirman la _nueva_ cotización?',
  ])('%s conserva el cierre con extracción vacía o repetida', (body) => {
    for (const parsed of [{}, { producto: '', cantidad: '' }, { producto: 'focos LED', cantidad: '12' }]) {
      flow.clearFlowState(PHONE);
      close();
      const before = structuredClone(flow.getFlowState(PHONE));
      expect(step(body, parsed)).toMatchObject({ closedFlow: true, shouldCreateDeal: false });
      expect(flow.getFlowState(PHONE)).toEqual(before);
    }
  });
  it.each<Claude>([{ producto: 'postes solares' }, { cantidad: '40' }])('la extracción nueva impide frenar el pedido: %j', (parsed) => {
    close();
    expectNew('¿Me confirman la nueva cotización?', parsed);
  });
  it('una consulta con URL conserva el reinicio de main', () => {
    close();
    const r = step('¿Me confirman la nueva cotización? https://example.com/ana@example.com/otro_pedido');
    expect(r.closedFlow).toBe(false);
    expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
  });
  it.each(['Necesitamos', 'Quisiéramos', 'Buscamos', 'Requerimos', 'Cotizar', 'Pedimos', 'Pidan', 'Agreguen', 'Sumen', 'Compramos', 'Instalen', 'Otro producto:'])('cualquier forma de pedido impide la guarda: %s', (verb) => {
    close();
    expectNew('¿Me confirman la nueva cotización? ' + verb + ' postes solares');
  });
  it.each<Closure>(['failed', 'pending', 'no-email', 'install'])('conserva las reglas del cierre %s', (kind) => {
    close(kind);
    const r = step('¿Me confirman la nueva cotización?');
    expect(r.closedFlow).toBe(true);
    expect(r.reply).toBe({ failed: flow.MSG_DEAL_FAILED, pending: flow.MSG4, 'no-email': flow.MSG_NEED_EMAIL, install: flow.MSG_REGISTERED_SHORT }[kind]);
    expect(r.shouldCreateDeal).toBe(kind === 'pending');
  });
});

it('un pedido tachado conserva la prioridad explícita de main', () => {
  close();
  const r = step('Mi correo correcto es ana.nueva@example.com ~otro pedido~');
  expect(r).toMatchObject({ closedFlow: false, shouldCreateDeal: false });
  expect(r.captured.correo).toBe('ana.nueva@example.com');
  expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
});

// V2.1: ni folios ni un celular del nombre Rut son correcciones del RUT.
const FOLIOS = [
  'Necesito corregir el RUT de la cotización #10456789',
  'Necesito corregir el RUT de la cotización 10456789',
  'Necesito corregir el RUT de la cotización # 10456789',
  'Necesito corregir el RUT de la cotización #1045678-9',
  'Necesito corregir el RUT de la cotización\n10456789',
  'Hola, necesito corregir el RUT de la cotización #765432103',
  'Necesito corregir el RUT de la otra cotización 765432103',
  'Hola, necesito corregir el RUT de la cotización 20261235',
];
describe('regresiones conservadas: folios', () => {
  it.each(FOLIOS)('%s no bloquea el RUT correcto que llega después', (body) => {
    expect(inspectRut(body)).toEqual({});
    if (!body.includes('\n')) expect(inspectRut(body, { asked: true })).toEqual({});
    close();
    const r = step(body);
    expect(r.rutUpdate).toBeUndefined();
    expect(r.captured.rut).toBeUndefined();
    expect(r.closedFlow).toBe(true);
    const correction = step('Es 77.123.456-9');
    expect(correction).toMatchObject({ shouldCreateDeal: true, rutUpdate: true });
    expect(correction.captured.rut).toBe('77.123.456-9');
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });
  it('un folio inválido no dispara la repregunta de RUT en un flujo nuevo', () => {
    const r = step(FOLIOS[7]);
    expect(r.reply).not.toBe(flow.MSG_RUT_INVALID);
    expect(r.captured.rut).toBeUndefined();
    expect(flow.getFlowState(PHONE).stage).toBe('stage1');
  });
});

describe('regresiones conservadas: nombre Rut con celular', () => {
  it.each([
    'Hola, soy Rut de la otra cotización: 965432108',
    'Rut de la otra cotización, 912345678',
    'Soy Rut, de la otra cotización: 965432108',
    'rut de la otra cotización 912345678',
  ])('%s', (body) => {
    expect(inspectRut(body)).toEqual({});
    expect(inspectRut(body, { asked: true })).toEqual({});
    const r = step(body);
    expect(r.captured.rut).toBeUndefined();
    expect(flow.getFlowState(PHONE).leadType).not.toBe('B2B');
  });
  it('el nombre Rut y el celular no impiden pedir el correo', () => {
    const r = step('Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Rut de la otra cotización, 912345678');
    expect(r.reply).toMatch(/correo/);
    expect(r.captured.rut).toBeUndefined();
    expect(flow.getFlowState(PHONE).stage).toBe('stage3');
  });
  it('el nombre tras el cierre conserva el reinicio de main, sin RUT', () => {
    close();
    expectNew('Soy Rut, de la otra cotización: 965432108');
    expect(flow.getFlowState(PHONE).captured.rut).toBeUndefined();
  });
});

const STRUCK = [
  'Mi RUT es ~76.123.456-0~ 77.345.678-K',
  'Mi RUT es ~76.123.456-0~, el correcto es 77.345.678-K',
  'Nuestro RUT: ~76.123.456-0~ 77.345.678-K',
  'Mi RUT es ~76.123.456-0~ 77.345.678-K, correo pedro.prueba@example.com',
  'Necesito corregir mi RUT: ~76.123.456-0~ 77.345.678-K',
  'Necesito corregir el RUT de la otra cotización: ~76.123.456-0~ 77.345.678-K',
];
describe('RUT tachado: se conserva la ambigüedad de main', () => {
  it.each(STRUCK)('%s', (body) => {
    // Main descarta el primero tras "cotizacion: ~"; sin esa referencia conserva ambos.
    const quote = body.includes('cotización');
    expect(inspectRut(body)).toEqual(quote
      ? { found: { rut: '77.345.678-K', valido: true, tipo: 'empresa' } }
      : { ambiguous: ['76.123.456-0', '77.345.678-K'] });
    close();
    const r = step(body);
    expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true, closedFlow: true });
    expect(r.captured.rut).toBe(quote ? '77.345.678-K' : undefined);
    expect(r.captured.rut_ambiguos).toEqual(quote ? undefined : ['76.123.456-0', '77.345.678-K']);
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });
  it('la respuesta B2B en etapa 3 tampoco captura el tachado', () => {
    step('Necesito 12 focos LED luz cálida para la bodega en Maipú', { ...FIELDS, proyecto_o_uso: 'bodega' });
    expect(flow.getFlowState(PHONE).stage).toBe('stage3');
    const r = step(STRUCK[3]);
    expect(r.closedFlow).toBe(true);
    expect(r.captured.rut).toBeUndefined();
    expect(r.captured.rut_ambiguos).toEqual(['76.123.456-0', '77.345.678-K']);
  });
});

describe('puente cerrado con es', () => {
  it.each([
    'Necesito corregir el RUT de mi nueva cotización es 76.123.456-0',
    'Necesito corregir el RUT de la otra cotización es 76.123.456-0',
    'Necesito corregir el RUT de nuestra nueva cotización es el 76.123.456-0',
  ])('%s actualiza el mismo negocio', (body) => {
    close();
    const r = step(body);
    expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
    expect(r.captured.rut).toBe('76.123.456-0');
    expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  });
});
