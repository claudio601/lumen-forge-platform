// PR 142, ronda 3: lista cerrada y mensajes sinteticos de 06-hallazgos-verificacion-r2.json.
import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { inspectRut } from './rutCapture';

const PHONE = '+56900000342';
const SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
type Claude = Parameters<typeof flow.processFlowStep>[2];
export type Closure = 'registered' | 'pending' | 'failed' | 'no-email' | 'install';
export const FIELDS = { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'calida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba' };
const FIRST = 'Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba';
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, SIGNALS);
export function close(engine: typeof flow = flow, kind: Closure = 'registered') {
  const send = (body: string, parsed: Claude = {}) => engine.processFlowStep(PHONE, body, parsed, SIGNALS);
  if (kind === 'install') {
    send('Quiero instalar focos en mi casa');
    send('Soy Ana Prueba, ana.prueba@example.com, casa en Maipú', { nombre: 'Ana Prueba' });
  } else {
    send(FIRST + (kind === 'no-email' ? '' : ', ana.prueba@example.com'), FIELDS);
    if (kind === 'no-email') send('no sé');
  }
  expect(engine.getFlowState(PHONE).stage).toBe('closed');
  if (kind === 'registered' || kind === 'install') engine.recordDealOutcome(PHONE, true, undefined, 4242);
  if (kind === 'failed') engine.recordDealOutcome(PHONE, false);
}
afterEach(() => flow.clearFlowState(PHONE));

// Pedido-nuevo 1, regresiones 2: cada campo adicional y productos desconocidos.
export const CHANGES: [string, Claude][] = [
  ['la nueva cotizacion pero en luz fria', { tipo_de_luz: 'fria' }],
  ['la nueva cotizacion pero en luz fria', { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'fria' }],
  ['¿La nueva cotización la pueden hacer en 4000K?', { tipo_de_luz: 'neutra' }],
  ['La nueva cotización pero para Quilicura', { comuna_o_ciudad: 'Quilicura' }],
  ['La nueva cotización pero de 100W', {}],
  ['La nueva cotización mejor a nombre de la empresa, Constructora Prueba SpA', { empresa: 'Constructora Prueba SpA' }],
  ['La nueva cotización es para un colegio en Puente Alto', { proyecto_o_uso: 'colegio', comuna_o_ciudad: 'Puente Alto' }],
  ['Mi nueva cotización es para una bodega en Quilicura', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura' }],
  ['La otra cotización es para la oficina de Providencia, luz fría', {}],
  ['Mi nueva cotización: luz fría, para un galpón en Lampa', {}],
  ['La otra cotización es para el colegio de Puente Alto', {}],
  ['La nueva cotización es para mi empresa, Comercial Prueba SpA', {}],
];
export const UNKNOWN_PRODUCTS = [
  'La nueva cotización: postes solares',
  'Solicito la nueva cotización de postes solares',
  'Me gustaría la nueva cotización con postes solares',
  'Me interesan postes solares para la nueva cotización',
  'Ocupo postes solares para la nueva cotización',
  'Cotícenme la nueva cotización con postes solares',
  'Incluyan postes solares en la nueva cotización',
  'La nueva cotización: campanas UFO 200W',
  'La otra cotización con paneles de 60x60',
  'La nueva cotización: plafones para el pasillo',
  'Mi otra cotización: apliques de muro y spots',
  'La nueva cotización es de postes solares',
  'La otra cotización es de tubos T8',
  'La nueva cotización es de paneles 60x60',
  'Mi nueva cotización es de campanas UFO para la bodega',
  'Pongan postes solares en la nueva cotización',
  'Hagan la nueva cotización con postes solares',
  'Deseo postes solares para la nueva cotización',
];
// Una sola palabra extra basta, incluso cuando no hay producto ni cantidad conocida.
export const OUTSIDE = [
  'luz', 'comuna', 'potencia', 'producto', 'pero', 'para', 'fría', 'Quilicura',
  '100W', 'colegio', 'empresa', 'bodega', 'paneles', 'postes', 'campanas',
  'plafones', 'apliques', 'spots', 'agregar', 'cambiar', 'mejor', 'mañana',
].map((word) => '¿Me confirman la nueva cotización? ' + word);
export const OLD_EXCLUSIONS = [
  '¿Me confirman esta nueva cotización?', '¿Me envían esa otra cotización?',
  'La otra cotización estaba bien',
  '¿Me confirman la nueva cotización? ~otro pedido~',
  '¿Me confirman la nueva cotización? ~Quiero comprar 40 postes solares~',
  '¿Me confirman la nueva cotización? https://example.com/otro_pedido',
  '¿Me confirman la nueva cotización? www.example.com/necesito_focos',
  '¿Me confirman la nueva cotización? https://example.com/ana@example.com/otro_pedido',
  'Quería saber si les llegó mi nueva cotización',
  'Quisiera saber si ya está lista la nueva cotización',
  'Necesito saber si les llegó mi nueva cotización',
  '¿Les llegó la nueva cotización que pedí?',
  'Hola, soy Ana Prueba. ¿Les llegó mi nueva cotización?',
  'Hola, me llamo Ana Prueba, ¿me confirman la nueva cotización?',
  '¿Me confirman la nueva_cotizacion?',
  '¿Me confirman la nueva*cotizacion?',
  '¿Me confirman la nueva cotización? otro_pedido.xlsx',
  '¿Me confirman la nueva cotización? nueva_cotizacion@example.com',
  '¿Me confirman 👍 la nueva cotización?',
  '¿Me confirman la nueva cotización*?',
  '¿Me confirman la nueva cotización_?',
];
export const EXPLICIT: [string, Claude][] = [
  ['Otro pedido: 20 paneles LED para la oficina, mi correo es ana.nueva@example.com ¿me confirman?', { producto: 'paneles LED', cantidad: '20', proyecto_o_uso: 'oficina', correo: 'ana.nueva@example.com' }],
  ['Tengo otra obra: 20 campanas LED para Lampa, cotización a compras@example.com ¿ok?', {}],
  ['Otro pedido: 20 paneles LED como este https://nuevo.elights.cl/producto/panel ¿me lo cotizan? correo ana.nueva@example.com', {}],
  ['Otro pedido: 20 paneles LED, mi correo correcto ahora es ana.nueva@example.com ¿me confirman?', {}],
  ['Nuevo pedido: 20 paneles LED a pedro@example.com, ¿me avisan cuando llegue la cotización?', {}],
  ['Mi correo correcto es ana.nueva@example.com ~otro pedido~', {}],
];
export const FILES: [string, Claude][] = [
  ['Mi correo correcto es ana.nueva@example.com, les mando el archivo nueva_cotizacion.pdf', {}],
  ['Necesito corregir mi RUT: 76.123.456-0, va en el archivo otro_pedido.xlsx', {}],
  ['Mi correo correcto es ana.nueva@example.com (asunto: nueva_cotizacion)', {}],
];
export const RUT_NAMES = [
  'Hola, soy Rut. De la otra cotización: 965432108',
  'Saludos, Rut. De la nueva cotización: 965432108',
  'Necesito 10 ampolletas LED luz cálida para mi casa en Maipú. Saludos, Rut. De mi cotización anterior: 912345678',
];
export const OWN_RUT = [
  'Necesito 30 paneles LED 60x60 luz fría para una oficina en Providencia. Comercial Prueba SpA, RUT 76.123.456-0 (el RUT de la otra cotización era 77.345.678-K), compras@comercial-prueba.example.com',
  'RUT 76.123.456-0. El RUT de la cotización anterior: 77.345.678-K',
  'Para esta cotización usen el RUT 76.123.456-0; el RUT de la otra cotización es 77.345.678-K',
  'Usen el RUT 76.123.456-0, no el RUT de la otra cotización: 77.345.678-K',
  'Necesito corregir el RUT: 76.123.456-0. El RUT de la otra cotización era 77.345.678-K',
];
export const PAST_RUT = [
  ['El RUT de la cotización anterior era 76.123.456-0, mi RUT correcto es 77.345.678-K, compras@example.com', '77.345.678-K'],
  ['El RUT de la cotización anterior era 15.678.901-1, mi RUT correcto es 76.123.456-0', '76.123.456-0'],
  ['Perdón, el RUT de la cotización era 15.678.901-1 (el mío), el correcto es el de la empresa: 76.123.456-0', '76.123.456-0'],
  ['El RUT de mi cotización anterior era 76.123.456-0, ahora es 77.345.678-K. compras@example.com', '77.345.678-K'],
  ['El RUT de la cotización anterior era 76.123.456-0, el correcto es 77.123.456-9', '77.123.456-9'],
];
export const RANGES = [
  ['Reflector 200W AC85~265V, RUT 76.123.456-0, 3000~6500K', '76.123.456-0'],
  ['Necesito entre 30~40 focos, RUT 76.123.456-0, y 10~15 paneles', '76.123.456-0'],
  ['Necesito 20 reflectores LED 200W AC85~265V luz fría para una bodega en Quilicura, Comercial Prueba SpA RUT 76.123.456-0, temperatura de trabajo -20~50°C, compras@example.com', '76.123.456-0'],
  ['Comercial Prueba SpA, voltaje 100~240V, RUT 76.123.456-0, 3000~6500K, compras@example.com', '76.123.456-0'],
  ['Necesito corregir el RUT, los paneles son 100~240V, RUT correcto 77.123.456-9, temperatura -20~45°C', '77.123.456-9'],
  ['Equipos 100~240V, RUT correcto 77.123.456-9, 3000~6500K', '77.123.456-9'],
  ['Equipos :~) RUT 76.123.456-0 :~)', '76.123.456-0'],
];
export const STRUCK = [
  'Necesito corregir mi RUT: ~76.123.456-0~ 77.345.678-K',
  'Corrijo el RUT: ~76.123.456-0~ 77.345.678-K',
  'El RUT de la empresa es ~76.123.456-0~ 77.345.678-K',
  'Mi RUT es ~76.123.456-0~ 77.345.678-K',
];

describe.each<Closure>(['registered', 'pending', 'failed', 'no-email', 'install'])('ronda 3: pedidos con cierre %s', (kind) => {
  it.each([...CHANGES, ...UNKNOWN_PRODUCTS.flatMap((body): [string, Claude][] => [[body, {}], [body, { producto: 'focos LED', cantidad: '12' }]]), ...OUTSIDE.map((body): [string, Claude] => [body, {}]), ...OLD_EXCLUSIONS.map((body): [string, Claude] => [body, {}]), ...EXPLICIT])('conserva el pedido nuevo de main: %s', (body, parsed) => {
    close(flow, kind);
    const before = flow.getFlowState(PHONE);
    const snapshot = structuredClone(before);
    const r = step(body, parsed);
    // Main ya incorpora un correo al pendiente si no hay un pedido explicito.
    if ((kind === 'pending' || kind === 'no-email') && OLD_EXCLUSIONS.includes(body) && body.includes('@')) {
      expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true });
      expect(r.captured).toMatchObject({ producto: 'focos LED', cantidad: '12' });
      return;
    }
    expect(r.closedFlow).toBe(false);
    expect(r.rutUpdate).toBeUndefined();
    expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
    expect(r.captured.cambios).toBeUndefined();
    expect(before).toEqual(snapshot);
  });
});

it.each(FILES)('el archivo conserva la corrección de main: %s', (body, parsed) => {
  close();
  const r = step(body, parsed);
  expect(r).toMatchObject({ closedFlow: true, shouldCreateDeal: true, rutUpdate: true });
  expect(flow.getFlowState(PHONE).dealId).toBe(4242);
  expect(r.captured).toMatchObject(body.includes('RUT') ? { rut: '76.123.456-0' } : { correo: 'ana.nueva@example.com' });
});

const ACCEPTED = [
  '¿Me confirman la nueva cotización?', '¿ME CONFIRMAN LA NUEVA COTIZACION? Gracias 🙏',
  'Hola, ¿me confirman *la nueva cotización*? Por favor, gracias 👍',
  'Buenas, ¿nos pueden confirmar esa otra cotización?',
  '¿Me confirman la _nueva_ cotización?', '¿Me confirman *la nueva cotizacion*? gracias',
  '¿Ya llegó mi nueva cotización?', '¿Cuándo me mandan la otra cotización?',
  '¿Llegó la nueva cotización?', '¿Enviaron mi otra cotización?',
  '¿Mandaron esa nueva cotización?', '¿Recibieron la otra cotización?',
  '¿Cuándo nos llega mi nueva cotización?', '¿Cuándo nos envían esa otra cotización?',
  '¿Cómo va la nueva cotización?', '¿En qué va mi otra cotización?', 'Estado de esa nueva cotización, por favor.',
];
it.each(ACCEPTED)('solo la consulta completa conserva el cierre: %s', (body) => {
  close();
  const before = structuredClone(flow.getFlowState(PHONE));
  expect(step(body, { ...FIELDS, correo: 'ana.prueba@example.com', empresa: 'Ana Prueba', wantsHuman: false, qualifiesForDeal: false })).toMatchObject({ closedFlow: true, shouldCreateDeal: false });
  expect(flow.getFlowState(PHONE)).toEqual(before);
});

it.each<Claude>([
  { producto: 'postes solares' }, { cantidad: '40' }, { tipo_de_luz: 'fria' },
  { proyecto_o_uso: 'oficina' }, { comuna_o_ciudad: 'Quilicura' }, { nombre: 'Pedro Prueba' },
  { empresa: 'Constructora Prueba SpA' }, { correo: 'ana.nueva@example.com' },
  { wantsHuman: true }, { qualifiesForDeal: true },
])('cualquier campo nuevo de Claude desactiva la excepción: %j', (parsed) => {
  close();
  expect(step('¿Me confirman la nueva cotización?', parsed).closedFlow).toBe(false);
  expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
});

it.each(RUT_NAMES)('Rut con punto y celular sigue sin RUT: %s', (body) => {
  for (const asked of [false, true]) expect(inspectRut(body, { asked })).toEqual({});
  const r = step(body);
  expect(r.captured.rut).toBeUndefined();
  expect(flow.getFlowState(PHONE).leadType).toBe('B2C');
});
it.each([...PAST_RUT, ...RANGES, ...OWN_RUT.map((body) => [body, '76.123.456-0'])])('conserva el RUT propio de main: %s', (body, rut) => {
  for (const asked of [false, true]) expect(inspectRut(body, { asked }).found).toMatchObject({ rut, valido: true });
});
it.each([...PAST_RUT, ...RANGES, ...OWN_RUT.map((body) => [body, '76.123.456-0'])])('tras la repregunta conserva el RUT válido de main: %s', (body, rut) => {
  step('Necesito 12 focos LED luz cálida para una bodega en Maipú', { ...FIELDS, proyecto_o_uso: 'bodega' });
  expect(step('RUT 77.123.456-8').reply).toBe(flow.MSG_RUT_INVALID);
  expect(step(body).captured).toMatchObject({ rut, rut_valido: true });
});
it.each(STRUCK)('con RUT empresarial válido conserva la nota ambigua: %s', (body) => {
  step(FIRST + ', RUT 76.123.456-0, ana.prueba@example.com', FIELDS);
  flow.recordDealOutcome(PHONE, true, undefined, 5151);
  const r = step(body);
  expect(r).toMatchObject({ shouldCreateDeal: true, rutUpdate: true, closedFlow: true });
  expect(r.captured).toMatchObject({ rut: '76.123.456-0', rut_ambiguos: ['76.123.456-0', '77.345.678-K'] });
  expect(flow.getFlowState(PHONE).dealId).toBe(5151);
});

it.each([
  'Necesito corregir el *RUT* de la *otra cotización*: *76.123.456-0*',
  '*RUT* de mi *nueva cotización* es *761234560*',
])('el puente con marcas internas conserva la exclusión de main: %s', (body) => {
  expect(inspectRut(body)).toEqual({});
});

it('el summary que devuelve siempre askClaude no es un campo nuevo del pedido', () => {
  close();
  const parsed = { ...FIELDS, summary: 'El cliente pregunta por la nueva cotización.' };
  expect(step('¿Me confirman la nueva cotización?', parsed)).toMatchObject({ closedFlow: true, shouldCreateDeal: false });
  expect(flow.getFlowState(PHONE).dealId).toBe(4242);
});
