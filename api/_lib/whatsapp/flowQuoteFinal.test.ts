// PR 142, verificación final: mensajes sintéticos que la lista cerrada y el puente del RUT no deben aceptar.
import { afterEach, expect, it } from 'vitest';
import * as flow from './flowEngine';
import { inspectRut } from './rutCapture';

const PHONE = '+56900000343';
const SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
type Claude = Parameters<typeof flow.processFlowStep>[2];
const FIELDS = { producto: 'focos LED', cantidad: '12', tipo_de_luz: 'calida', proyecto_o_uso: 'casa', comuna_o_ciudad: 'Maipú', nombre: 'Ana Prueba' };
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, SIGNALS);
// Pedido registrado en Pipedrive (negocio 4242), sin RUT.
function close() {
  step('Necesito 12 focos LED luz cálida para mi casa en Maipú. Soy Ana Prueba, ana.prueba@example.com', FIELDS);
  expect(flow.getFlowState(PHONE).stage).toBe('closed');
  flow.recordDealOutcome(PHONE, true, undefined, 4242);
}
afterEach(() => flow.clearFlowState(PHONE));

const ANNOUNCEMENTS = [
  'Hola, ¿cómo va? Mi nueva cotización:',
  '¿Cómo va? La nueva cotización 👇',
  'Buenas, ¿cómo va? La otra cotización ⬇️',
  '¿Llegó? Mi nueva cotización 👇',
  '¿Cómo va? La nueva cotización',
  '¿Me confirman? La otra cotización',
  'Mi nueva cotización:',
];
it.each(ANNOUNCEMENTS)('un saludo con el anuncio de un pedido reabre el flujo como en main: %s', (body) => {
  close();
  expect(step(body).closedFlow).toBe(false);
  expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
  const r = step('20 postes solares para una bodega en Lampa', { producto: 'postes solares', cantidad: '20' });
  expect(r.captured).toMatchObject({ producto: 'postes solares', cantidad: '20' });
  expect(flow.getFlowState(PHONE).dealId).toBeUndefined();
});

it.each([
  '*¿Me confirman la nueva cotización?*',
  '_¿Me confirman la nueva cotización?_',
  '*Me confirman la nueva cotización?*',
  'Hola. ¿Me confirman la nueva cotización? Gracias.',
  '¿Me confirman la nueva cotización? :)',
])('la consulta completa conserva el cierre: %s', (body) => {
  close();
  const before = structuredClone(flow.getFlowState(PHONE));
  expect(step(body)).toMatchObject({ closedFlow: true, shouldCreateDeal: false });
  expect(flow.getFlowState(PHONE)).toEqual(before);
});

const REJECTED_RUT = [
  'No usen el RUT de la otra cotización: 76.123.456-0',
  'Ese no es el RUT de la otra cotización: 76.123.456-0',
  'El RUT de la otra cotización: 76.123.456-0 está malo',
  'el RUT de la otra cotización es 76.123.456-0 (no es mío)',
  'Hay que corregir: el RUT de la otra cotización: 76.123.456-0 no corresponde a esta compra',
  'El RUT de la cotización anterior: 76.123.456-0 estaba malo, el nuevo se los mando mañana',
  'El RUT de la otra cotización es 76.123.456-0, que es el antiguo',
];
it.each(REJECTED_RUT)('el puente no toma un RUT rechazado en la misma oración: %s', (body) => {
  for (const asked of [false, true]) expect(inspectRut(body, { asked })).toEqual({});
  // Que reabra o no el flujo lo decide main; el negocio anterior nunca recibe ese RUT.
  close();
  const r = step(body);
  expect(r.rutUpdate ?? false).toBe(false);
  expect(r.captured.rut).toBeUndefined();
  expect(flow.getFlowState(PHONE).leadType).not.toBe('B2B');
});

it.each([
  'Necesito corregir el RUT de la otra cotización: 76.123.456-0',
  'No sé si les llegó. El RUT de la otra cotización: 76.123.456-0',
  'El RUT de mi nueva cotización es 76.123.456-0. No tengo el otro a mano',
])('un rechazo en otra oración no apaga el puente: %s', (body) => {
  expect(inspectRut(body)).toEqual({ found: { rut: '76.123.456-0', valido: true, tipo: 'empresa' } });
});
