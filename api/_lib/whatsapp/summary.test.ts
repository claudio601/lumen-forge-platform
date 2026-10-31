// api/_lib/whatsapp/summary.test.ts
// Bot de WhatsApp, PR 3 del plan (B5): el resumen de Claude no afirma compras, pagos, stock, pedidos,
// despachos ni historial si no los atribuye al cliente. Solo resúmenes inventados.

import { describe, expect, it } from 'vitest';
import { SUMMARY_EMPTY, safeSummary } from './summary';

describe('frases que se botan', () => {
  it.each([
    'Cliente ya compró 20 paneles.',
    'Cliente pagó.',
    'Cliente adquirió 10 focos.',
    'El cliente quiere retirar su pedido ya pagado.',
    'Cliente frecuente de la tienda.',
    'Los paneles están en stock.',
    'Pedido confirmado por 20 focos.',
    'Su pedido fue despachado ayer.',
    'Hay disponibilidad de reflectores 100W.',
    'El cliente pide el retiro de su compra.',
    'Cliente compro 10 focos.',
    'Ya es cliente; tiene historial de compras.',
  ])('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(SUMMARY_EMPTY);
  });
});

describe('frases que se conservan', () => {
  it.each([
    'Cliente indica que ya compró.',
    'El cliente dice que ya compró y pregunta por la dirección de retiro.',
    'Consulta disponibilidad de paneles 120x60',
    'Pedido de 20 paneles para oficina',
    'Según el cliente, el pedido anterior llegó incompleto.',
    'Pregunta si hay stock de focos LED.',
    'La clienta señala que pagó por transferencia.',
    'El cliente pide 30 paneles 60x60 luz neutra para una oficina en Providencia.',
    'Consulta las formas de pago y el despacho a regiones.',
    'Necesita 20 focos para un depósito.',
  ])('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(summary);
  });
});

describe('resúmenes mixtos', () => {
  it('se bota solo la frase con el hecho sin atribuir', () => {
    expect(safeSummary('El cliente pide 20 focos LED. Ya pagó la cotización anterior.')).toBe('El cliente pide 20 focos LED.');
    expect(safeSummary('Cliente necesita paneles; compró antes con nosotros')).toBe('Cliente necesita paneles');
  });

  it('sin resumen, remite a la transcripción', () => {
    expect(safeSummary('')).toBe(SUMMARY_EMPTY);
    expect(safeSummary(undefined)).toBe(SUMMARY_EMPTY);
    expect(safeSummary({ texto: 'Cliente pide focos' })).toBe(SUMMARY_EMPTY);
  });

  it('un resumen muy largo se corta', () => {
    expect(safeSummary('El cliente pide focos. '.repeat(100)).length).toBeLessThanOrEqual(600);
  });
});
