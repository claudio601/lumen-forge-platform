// api/_lib/whatsapp/summary.test.ts
// Bot de WhatsApp, PR 3 del plan (B5): el resumen de Claude no afirma compras, pagos, stock, pedidos,
// despachos ni historial si no los atribuye al cliente. La atribución se mira por cláusula, y un pedido
// o una consulta ("requiere", "pregunta si hay") solo cubre el stock, la entrega por venir y la orden de
// compra, y lo que se afirma solo como pregunta. Solo resúmenes inventados. Cada caso se prueba también
// sin tildes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUMMARY_EMPTY, safeSummary } from './summary';

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const withAndWithoutTildes = (list: string[]) => [...new Set(list.flatMap((s) => [s, sinTildes(s)]))];

describe('frases que se botan', () => {
  it.each(withAndWithoutTildes([
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
    // Informe de Codex, hallazgo 1.
    'Cliente ha realizado una compra.',
    'Cliente pago por transferencia.',
    'Cliente tiene un pedido.',
    'El pedido llegará mañana.',
    'Disponibilidad asegurada para 20 focos.',
    'El cliente pregunta por paneles y ya pagó su pedido.',
    // Las mismas reglas, con otras palabras.
    'Cliente ya ha hecho un pedido.',
    'Realizó una transferencia por los focos.',
    'Los focos serán enviados a Lampa.',
    'Se despachará el lunes.',
    'El cliente pide 20 focos, hay stock.',
    'Paneles con stock.',
    'Stock confirmado para 20 focos.',
    'Cliente de la tienda.',
    'Cliente de eLIGHTS.cl desde hace años.',
    // Cada cláusula necesita su propia atribución; "pregunta" no cubre "su pedido".
    'El cliente dice que compró focos y ya pagó.',
    'El cliente pregunta si su pedido fue despachado.',
    'Cliente pide paneles y el pedido será despachado mañana.',
    'El cliente pregunta por el precio y si ya pagó su pedido.',
    'Cliente de la empresa.',
    // Revisión: un pedido no cubre el stock que se afirma en una cláusula con "que" ni en una relativa.
    'Pide 20 focos, que están en stock.',
    'Solicita 20 paneles 60x60 que están en stock.',
    'Necesita 20 focos que hay en stock.',
    'Pide 20 focos y que hay stock.',
    'Cliente consulta por paneles 60x60, que están disponibles.',
    // "Se pudo confirmar" cuenta lo que ya se hizo: no es un pedido.
    'Se pudo confirmar que hay stock de 20 focos.',
    'Se logró verificar que hay stock para 30 paneles.',
    'Se pudo confirmar la disponibilidad de 20 focos.',
    // El nombre suelto de una lista solo vale si va solo, no si después se afirma algo.
    'Necesita 50 paneles, stock de sobra.',
    'Pide 20 focos, stock suficiente.',
    'Cliente pide paneles, stock: 50 unidades.',
    // Pagos y compras con artículo definido, en participio o con "canceló".
    'Cliente realizó el pago por transferencia.',
    'Cliente hizo la compra el lunes.',
    'Cliente efectuó el pago.',
    'Cliente realizó la transferencia.',
    'Cliente ya realizó la compra de 20 focos.',
    'Cliente ya hizo el pedido.',
    'Pago realizado por transferencia.',
    'Pago recibido.',
    'Transferencia recibida por $250.000.',
    'Pedido recibido conforme.',
    'Productos recibidos sin problemas.',
    'Pago efectuado el viernes.',
    'Comprobante de pago enviado.',
    'Cliente envió el comprobante de transferencia.',
    'Cliente ya canceló la factura.',
    // Despacho o entrega en presente o en perífrasis, y stock con otras palabras.
    'Pedido listo para retiro.',
    'El pedido va en camino.',
    'Los focos llegan el lunes a Lampa.',
    'El despacho sale mañana.',
    'Quedan 20 unidades en bodega.',
    'Cliente cuenta ya con su pedido pagado.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(SUMMARY_EMPTY);
  });
});

describe('frases que se conservan', () => {
  it.each(withAndWithoutTildes([
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
    // "Recibido" tras lo que recibe el bot o ventas no es un pago ni una entrega.
    'Cotización recibida por correo.',
    // "Para stock" es el inventario del cliente; "validar" es otro pedido.
    'Compra de 30 paneles 60x60 luz neutra para stock en su tienda.',
    'Requiere validar disponibilidad y cotización.',
    'Solicitud recibida, requiere 20 focos.',
    'Foto recibida del tablero eléctrico.',
    // "Disponible" referido al contacto, el correo o la información no es stock.
    'Contacto directo disponible.',
    'Prefiere contacto por WhatsApp, sin correo disponible.',
    'Cliente solicita información no disponible en la ficha técnica.',
    'Cliente disponible en las tardes para coordinar.',
    // "Cliente de empresa" es B2B, no un cliente antiguo.
    'Cliente de empresa, requiere cotización.',
    // Un pedido o una consulta cubre el stock, la disponibilidad y la orden de compra.
    'Requiere cotización y disponibilidad de stock.',
    'Cliente requiere confirmación de stock.',
    'Cliente interesado en stock.',
    'Empresa instaladora requiere precio, stock, plazo y garantía.',
    // Informe de Codex, hallazgo 15.
    'Necesita conocer el stock de focos.',
    'Solicita confirmar si hay disponibilidad de focos.',
    'Necesita adjuntar una orden de compra para cotizar.',
    // Una cláusula con "si" sigue la consulta anterior, solo para el stock.
    'El cliente pregunta por el precio y si hay stock.',
    // La atribución sigue en las cláusulas con "que" y en "dice que" sin repetir el sujeto.
    'El cliente dice que ya compró y que pagó por transferencia.',
    'El cliente pide 20 focos y dice que ya pagó.',
    'Necesita saber si tienen pedido mínimo.',
    // Revisión: palabras que solo parecen hechos.
    'Pregunta si el despacho a regiones es pagado o por pagar.',
    'Consulta si los focos llegarán a Temuco antes del viernes.',
    'Necesita saber si tienen compra mínima.',
    'Cliente de la empresa Constructora Andes, requiere 50 focos.',
    'Datos técnicos disponibles en la ficha.',
    // Lo que sigue quedando con las reglas más estrictas.
    'Requiere precio y disponibilidad de focos 100W.',
    'Quiere saber si hay stock de paneles.',
    'Solicita información de stock de paneles.',
    'Pregunta cuándo llegan los focos.',
    'Pregunta si quedan unidades de focos 100W.',
    'Consulta cuánto sale el despacho a regiones.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(summary);
  });
});

describe('resúmenes mixtos', () => {
  afterEach(() => vi.restoreAllMocks());

  it('se bota solo la frase con el hecho sin atribuir', () => {
    expect(safeSummary('El cliente pide 20 focos LED. Ya pagó la cotización anterior.')).toBe('El cliente pide 20 focos LED.');
    expect(safeSummary('Cliente necesita paneles; compró antes con nosotros')).toBe('Cliente necesita paneles');
    expect(safeSummary('Contacto directo disponible. Cliente tiene un pedido.')).toBe('Contacto directo disponible.');
    expect(safeSummary('Requiere cotización y disponibilidad de stock. Disponibilidad asegurada para 20 focos.'))
      .toBe('Requiere cotización y disponibilidad de stock.');
  });

  it('sin resumen, remite a la transcripción', () => {
    expect(safeSummary('')).toBe(SUMMARY_EMPTY);
    expect(safeSummary(undefined)).toBe(SUMMARY_EMPTY);
    expect(safeSummary({ texto: 'Cliente pide focos' })).toBe(SUMMARY_EMPTY);
  });

  it('un resumen muy largo se corta', () => {
    expect(safeSummary('El cliente pide focos. '.repeat(100)).length).toBeLessThanOrEqual(600);
  });

  it('quedan como máximo 6 frases', () => {
    expect(safeSummary('Pide focos. '.repeat(10))).toBe(Array(6).fill('Pide focos.').join(' '));
  });

  it('el log solo lleva la cantidad de frases descartadas, nunca el texto', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    safeSummary('El cliente pide 20 focos. Cliente pago por transferencia. Cliente tiene un pedido.');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[summary] frases descartadas: 2');
  });

  it('un texto armado para trabar las expresiones se resuelve rápido', () => {
    const inputs = [
      'datos de de de de no no disponible '.repeat(30),
      'requiere stock, '.repeat(60),
      'que y que y que pagó '.repeat(40),
      ',,,, ::: ;;; '.repeat(60),
      'el cliente el cliente el cliente dice '.repeat(20),
      'a'.repeat(600),
      'despacho envio flete es '.repeat(30),
      'pide de la de la del en por '.repeat(25),
      'pide focos que si que si stock '.repeat(20),
    ];
    const start = performance.now();
    for (const input of inputs) safeSummary(input);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
