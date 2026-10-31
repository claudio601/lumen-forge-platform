// api/_lib/whatsapp/summary.test.ts
// Bot de WhatsApp, PR 3 del plan (B5): el resumen de Claude no afirma compras, pagos, stock, pedidos,
// despachos ni historial si no los atribuye al cliente. La atribución se mira por cláusula, y un pedido
// o una consulta ("requiere", "pregunta si hay") solo cubre el stock, la entrega por venir y la orden de
// compra, y lo que se afirma solo como pregunta. Ronda 2 (H1): política conservadora por cláusula,
// con los verbos comerciales reconocidos por raíz y terminación. Solo resúmenes inventados. Cada caso
// se prueba también sin tildes.

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

// Informe de Codex, ronda 2 (H1): agregar formas sueltas a una lista no garantiza B5. El filtro
// reconoce los verbos comerciales por su raíz y cualquier terminación, y los estados con otras
// palabras ("en bodega", "con nosotros", "desde 2020", "ya" + verbo, la tienda que habla en plural).
describe('H1: afirmaciones comerciales que se botan', () => {
  it.each(withAndWithoutTildes([
    // Los seis casos del informe.
    'Cliente hizo una nueva compra.',
    'El pago se acreditó ayer.',
    'Tenemos 20 focos en bodega.',
    'El pedido ya está en bodega.',
    'Los focos se entregan mañana.',
    'Compra con nosotros desde 2020.',
    // Compra y pago, con adjetivos intermedios, "se" y otros tiempos.
    'Cliente realizó un segundo pago.',
    'El cliente efectuó una nueva compra de focos.',
    'El cliente hizo dos pedidos este año.',
    'Se acreditó la transferencia.',
    'La transferencia se acreditó el lunes.',
    'El depósito fue acreditado.',
    'Los pagos se acreditan en 24 horas.',
    'Ya compraba focos antes.',
    'Cliente pagaba con transferencia.',
    'El cliente abonó la mitad.',
    'Abono recibido por $100.000.',
    'Transfirió el total ayer.',
    'Cliente transfiere mañana.',
    'Pagará contra entrega.',
    'El cliente pagaría hoy.',
    'Pago 50%.',
    'Ya se pagó.',
    'Cliente confirmó la compra.',
    'Cliente aprobó la cotización.',
    'La cotización fue aceptada.',
    'Pedido completado y pagado.',
    'La compra quedó cerrada.',
    'El abono quedó registrado.',
    'Se generó la orden de compra.',
    'La factura fue emitida.',
    'Se emitió la boleta.',
    'Factura emitida el lunes.',
    'Se facturó.',
    'Cliente con pago pendiente.',
    'Tiene una factura pendiente.',
    'Tiene crédito con la tienda.',
    'Su orden fue ingresada.',
    'Pedido N° 1234 en proceso.',
    'Pedido #567 listo.',
    'El cliente pide 20 focos y ya pagó la mitad.',
    // Stock y existencias.
    'Tenemos stock de paneles 60x60.',
    'Contamos con 50 unidades.',
    'Contamos con stock.',
    'Nos quedan 10 focos.',
    'Existen 10 unidades.',
    'Hay unidades disponibles.',
    'El stock alcanza para 20 focos.',
    'Hay 30 paneles guardados para el cliente.',
    'Reservamos 20 focos para el cliente.',
    'Los focos quedaron reservados.',
    'Los focos están reservados para él.',
    'Los focos ya están en bodega.',
    // Entrega, despacho y llegada.
    'Los paneles se despachan hoy.',
    'Se entrega el viernes en Lampa.',
    'Mañana se envían los focos.',
    'Llega el lunes.',
    'Los reflectores llegaron a la obra.',
    'El pedido ya está listo.',
    'Despachamos el martes.',
    'Despachado a Rancagua el lunes.',
    'Le enviamos los paneles a Temuco.',
    'Se le despachó ayer.',
    'Se le entregó la factura.',
    'El envío salió ayer.',
    'El pedido salió de bodega.',
    'El pedido se está preparando.',
    'Mercadería en tránsito a Concepción.',
    'Mercadería despachada.',
    'Pedido entregado conforme.',
    'Envío gratis confirmado.',
    'Retiró los focos en bodega.',
    'Los focos ya fueron retirados.',
    'Cliente recibió los paneles.',
    'Ya tiene los focos.',
    'El cliente compró y retiró.',
    // Historial del cliente.
    'Compra con nosotros hace años.',
    'Cliente nos compra seguido.',
    'Cliente factura con nosotros.',
    'Es cliente nuestro desde 2019.',
    'Cliente habitual, compró en marzo.',
    'Cliente compró hace dos semanas.',
    'El cliente compra seguido con la tienda.',
    'Cliente adquiere focos todos los meses.',
    'Volvió a comprar paneles.',
    'Cliente con historial de pagos al día.',
    'Cliente con compra anterior.',
    'Cliente de hace años.',
    'El cliente es cliente antiguo.',
    'Segunda compra del cliente.',
    'Cliente ya canceló.',
    'El cliente pregunta por paneles, compra seguido con nosotros.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(SUMMARY_EMPTY);
  });
});

describe('H1: pedidos, consultas y descripciones que se conservan', () => {
  it.each(withAndWithoutTildes([
    // Regresión de la tabla del informe: en 4b5d1fc se conservaba.
    'Consulta si es cliente frecuente.',
    'El cliente pregunta si es cliente frecuente.',
    // Preguntas indirectas sobre stock, pago, despacho o historial.
    'El cliente pregunta si hay stock de paneles 60x60.',
    'El cliente pregunta si tienen stock de focos 100W.',
    'El cliente pregunta si tenemos focos de 200W.',
    'El cliente pregunta si hay existencias de paneles 120x60.',
    'El cliente pregunta si existen focos de 500W.',
    'El cliente pregunta si los focos están disponibles para retiro.',
    'El cliente pregunta si ya está disponible el foco de 300W.',
    'El cliente pregunta si pueden reservar 20 focos.',
    'El cliente pregunta si puede pagar con transferencia.',
    'El cliente pregunta si aceptan pago con tarjeta.',
    'El cliente pregunta cómo se paga el pedido.',
    'El cliente pregunta si se paga al retirar.',
    'El cliente quiere saber si el pago puede ser en cuotas.',
    'El cliente pregunta si emiten factura.',
    'El cliente pregunta si emiten boleta o factura.',
    'El cliente pregunta si aprueban crédito a empresas.',
    'El cliente pregunta si despachan a Temuco.',
    'El cliente pregunta si entregan en Puente Alto.',
    'El cliente pregunta si llegan a Punta Arenas.',
    'El cliente pregunta si llegan hasta Arica.',
    'El cliente pregunta cuándo llegarían los focos a Lampa.',
    'El cliente pregunta cuándo se despacharía el pedido.',
    'El cliente pregunta cuánto demora el despacho a regiones.',
    'El cliente pregunta cuántos días demora la entrega en regiones.',
    'El cliente pregunta si el despacho tiene costo.',
    'El cliente pregunta si puede retirar en bodega.',
    'El cliente pregunta si se puede retirar el mismo día.',
    'El cliente consulta si tiene historial de compras con la tienda.',
    'El cliente pregunta si hay descuento para clientes frecuentes.',
    'El cliente pregunta si la compra mínima es de 10 unidades.',
    'El cliente pregunta si hace falta un pedido mínimo.',
    // Pedidos y consultas.
    'El cliente pide 20 paneles LED para una oficina.',
    'El cliente necesita 15 focos para una bodega en Quilicura.',
    'El cliente solicita cotización de reflectores solares.',
    'El cliente quiere comprar 10 focos de 150W.',
    'El cliente quiere hacer un nuevo pedido de 30 paneles.',
    'El cliente busca luminarias para un galpón.',
    'El cliente requiere factura a nombre de la empresa.',
    'El cliente pide que le envíen la cotización por correo.',
    'El cliente necesita la entrega antes del viernes.',
    'El cliente pide despacho a Rancagua.',
    'El cliente pide factura con despacho a Lampa.',
    'El cliente consulta los plazos de entrega.',
    'El cliente consulta la fecha de llegada de los paneles.',
    'El cliente consulta el precio de 50 paneles.',
    'El cliente quiere retirar los focos en bodega.',
    'El cliente prefiere retiro en bodega.',
    'El cliente pide instalar los focos en bodega.',
    'El cliente pide una luminaria completa para exterior.',
    'El cliente pide 2 tramos de riel de 2 metros.',
    'El cliente pregunta si pueden cotizar 20 focos de 100W.',
    'El cliente pide cotizar paneles para una oficina de 80 m2.',
    // Descripciones neutras y lo que el cliente dice.
    'Proyecto en Lampa.',
    'Pedido de 12 focos para una casa en Maipú.',
    'Cliente de empresa constructora, requiere 40 focos.',
    'El cliente dice que compra con nosotros desde 2020.',
    'El cliente dice que ya pagó la cotización anterior.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(summary);
  });

  it('en un resumen con los seis casos del informe solo quedan las consultas', () => {
    const summary = 'Cliente hizo una nueva compra. El pago se acreditó ayer. Consulta si es cliente frecuente. '
      + 'Tenemos 20 focos en bodega; El pedido ya está en bodega. Los focos se entregan mañana.';
    expect(safeSummary(summary)).toBe('Consulta si es cliente frecuente.');
    expect(safeSummary('Compra con nosotros desde 2020. El cliente pregunta si hay stock de focos LED.'))
      .toBe('El cliente pregunta si hay stock de focos LED.');
  });
});

// Verificador adversario de la ronda 2: variaciones mínimas de H1 que todavía se conservaban. El
// vocabulario comercial (pago, compra, pedido, despacho, entrega, venta, dinero, "en bodega") en
// cualquier forma solo vale dentro de un pedido o una consulta, o en la descripción de lo que se
// pide ("Pedido de 20 paneles"); "Cliente" solo puede ir seguido de lo que pide o dice, de su tipo o
// de un nombre; "hay", "quedan", "sobran", "se dispone de", "está en" y "va a + infinitivo" son
// estados que solo cubre una pregunta.
describe('H1 (verificador): variaciones que se botan', () => {
  it.each(withAndWithoutTildes([
    // Bodega con artículo, mayúsculas o formato; perífrasis; "compra" sin sujeto.
    'El pedido está en la bodega.',
    'EL PEDIDO ESTA EN LA BODEGA.',
    '*El pedido está en la bodega.*',
    'La orden está en la bodega.',
    'Hay 20 focos en la bodega.',
    'Los focos van a llegar mañana.',
    'Compra en la tienda hace tiempo.',
    'Compra con la tienda hace mucho.',
    // Pago, compra, venta o pedido existente con otros verbos o un adjetivo de estado.
    'Pago completo.',
    'Pago OK.',
    'Pago reflejado en la cartola.',
    'El dinero entró ayer.',
    'La plata está en la cuenta.',
    'Cliente giró $500.000.',
    'Cliente saldó la cuenta.',
    'Se le vendieron 20 focos.',
    'Se vendió el panel al cliente.',
    'Cliente cerró el negocio.',
    'Pidió 20 focos el mes pasado.',
    'Encargó 20 focos ayer.',
    'Ordenó 50 paneles.',
    'Ha pedido focos antes.',
    'El pedido está preparado.',
    'El pedido fue preparado.',
    'El pedido está embalado.',
    // Stock, despacho e historial con otras palabras.
    'Hay 20 focos.',
    'Hay 50 unidades de focos 100W.',
    'Se dispone de 50 paneles.',
    'Se cuenta con 20 focos.',
    'Quedan focos de 100W.',
    'Sobran paneles 60x60.',
    'Los focos están en el almacén.',
    'Despacho programado para el lunes.',
    'Entrega agendada para el viernes.',
    'Despacho mañana a Lampa.',
    'Los focos parten mañana a Lampa.',
    'Pedido en ruta a Lampa.',
    'El pedido está en Starken.',
    'Va a recibir los focos el lunes.',
    'Cliente de hace tiempo.',
    'Cliente conocido.',
    'Cliente de larga data.',
    'Trabajó antes con la tienda.',
    'Siempre nos pide focos.',
    // Más variaciones inventadas.
    'Pagado.',
    'Ya está pagado.',
    'Pago hecho.',
    'Pagos al día.',
    'Abono OK.',
    'Depositó ayer.',
    'Transferencia hecha ayer.',
    'Plata recibida.',
    'Monto cancelado.',
    'Sin deuda.',
    'Venta cerrada.',
    'Trato cerrado.',
    'Se cerró el trato.',
    'Venta concretada.',
    'Boleta enviada.',
    'OC recibida.',
    'OC lista.',
    'Aceptó la cotización.',
    'Compra realizada.',
    'Compra lista.',
    'Nos compró en 2023.',
    'Le vendimos 20 focos.',
    'Le vendí 20 focos.',
    'Es su tercera compra.',
    'Pedido OK.',
    'Pedido armado.',
    'Pedido en bodega.',
    'Pedido 1234.',
    'Pedido de 20 focos listo.',
    'Pedido de 20 focos entregado.',
    'Compra de hace dos semanas.',
    'El pedido sale hoy.',
    'Sale mañana.',
    'Llegaría el lunes.',
    'Despacho hoy.',
    'Despacho confirmado.',
    'Envío en camino.',
    'Mandamos los focos.',
    'Se mandaron los focos.',
    'Focos en bodega.',
    'Focos en la bodega de Quilicura.',
    'Focos para el cliente en bodega.',
    'Los focos de la obra están en la bodega.',
    'Unidades en bodega.',
    'Queda 1.',
    'Última unidad.',
    'Pocas unidades.',
    'No quedan.',
    'Stock limitado.',
    'Disponemos de 20.',
    'Lo tenemos.',
    'Focos separados para el cliente.',
    'Se apartaron 20 focos.',
    'Se guardaron 20 focos para él.',
    'Cliente frecuente.',
    'Cliente conocido de la tienda.',
    'Es cliente.',
    'Ya es cliente.',
    'Cliente desde 2019.',
    'Cliente hace 3 años.',
    'Cliente de años.',
    'Cliente VIP.',
    'Cliente Premium.',
    'Ex cliente.',
    'Excliente.',
    'Comprador conocido.',
    'Usuario frecuente.',
    'Tipo de cliente: frecuente.',
    'Lleva 5 años como cliente.',
    'El cliente, conocido de la tienda, pide focos.',
    'Trabaja con nosotros.',
    'Ya nos conoce.',
    'Siempre compra aquí.',
    'El cliente va a pagar mañana.',
    'Pasará a retirar.',
    'Viene a retirar mañana.',
    'Paga contra entrega.',
    'Se liquidó.',
    'Se reembolsó.',
    'Se le devolvió el monto.',
    'Acaba de pagar.',
    'Debe $100.000.',
    'Se le cotizó 20 focos.',
    'Los paneles salieron.',
    'Entraron 50 focos.',
    'Mercadería lista.',
    'Cobro realizado.',
    // Dentro de un pedido: un estado en la cláusula que sigue, un pedido con número o de ayer.
    'El cliente pide 20 focos y pago completo.',
    'El cliente pide 20 focos y el pago está completo.',
    'El cliente pide 20 focos y pago al día.',
    'El cliente pide 20 focos, cliente conocido.',
    'El cliente pide focos y compra con la tienda.',
    'El cliente pide 20 focos y donde hay stock, compra.',
    'El cliente pide 20 focos y como hay stock, quiere más.',
    'Pide 20 focos que tenemos en bodega.',
    'El cliente necesita la factura del pedido 1234.',
    'El cliente quiere retirar el pedido de ayer.',
    'El cliente pide el mismo foco de la última vez.',
    'El cliente pregunta por el envío de la semana pasada.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(SUMMARY_EMPTY);
  });
});

describe('H1 (verificador): consultas, pedidos y descripciones que se conservan', () => {
  it.each(withAndWithoutTildes([
    // Dos preguntas coordinadas: la segunda sigue la consulta (en la ronda anterior se botaban).
    'El cliente pregunta si hay stock y cuándo llegarían.',
    'El cliente pregunta el precio y cuándo despachan.',
    'El cliente pregunta cómo se paga y cuándo despachan.',
    'El cliente pregunta si hay stock, y cuándo llegarían.',
    'El cliente pregunta si hay stock, y si despachan a Temuco.',
    'El cliente pregunta por el precio, y cuándo llegarían a Lampa.',
    'El cliente pregunta si hay stock, cuánto cuesta y cuándo llegaría.',
    'El cliente pregunta si despachan el mismo día y cuánto cuesta.',
    // Pregunta directa tras los dos puntos.
    'El cliente pregunta: ¿despachan a Temuco?',
    'El cliente pregunta: ¿cuándo llegan los focos?',
    'El cliente pregunta: ¿hay stock de paneles 60x60?',
    'El cliente pregunta: ¿tienen focos de 200W?',
    'El cliente pregunta: ¿cuánto cuesta el despacho a Lampa?',
    'El cliente pregunta: ¿hacen factura?',
    // "En bodega" como lugar de uso.
    'El cliente pide 20 focos para usar en bodega.',
    'El cliente pide 10 paneles para usar en bodega y oficina.',
    'El cliente pide reflectores para poner en bodega.',
    'El cliente necesita focos para trabajar en bodega.',
    'El cliente pide 20 focos para usar en la bodega.',
    'El cliente pide 20 focos para instalar en la bodega de su empresa.',
    'El cliente pide instalación en bodega.',
    'Iluminación en bodega industrial.',
    'Proyecto en bodega de 500 m2.',
    // Lugares, tipos de cliente y nombres.
    'La obra está en Lampa.',
    'El proyecto queda en Colina.',
    'El cliente está en Lampa.',
    'El cliente pregunta si la bodega queda en Quilicura.',
    'Cliente de Maipú, pide 20 focos.',
    'Cliente particular, pide 10 focos.',
    'Cliente Ana Prueba pide 20 focos.',
    'Usuario final pide 20 focos.',
    'El cliente es una empresa constructora.',
    'El cliente queda atento a la cotización.',
    'Factura a nombre de Constructora Prueba.',
    // "Girar" solo es un hecho en pasado ("giró $500.000").
    'El cliente pide un foco que gira 360 grados.',
    // Más consultas y pedidos con el estilo del prompt.
    'El cliente pregunta por la dirección de la tienda.',
    'El cliente quiere retirar en la tienda.',
    'El cliente pide el retiro en la tienda.',
    'El cliente pide una cotización para su tienda.',
    'El cliente pregunta si van a llegar antes del viernes.',
    'El cliente pregunta cuándo van a despachar.',
    'El cliente pregunta si nos quedan focos de 200W.',
    'El cliente pregunta si hacen despacho los sábados.',
    'El cliente pregunta si hay stock y el plazo de despacho.',
    'El cliente pide cotización con despacho a Temuco y factura a nombre de su empresa.',
    'El cliente pide 20 focos y la entrega en Lampa.',
    'El cliente pide: 20 focos de 100W y despacho a Lampa.',
    'El cliente pide que le enviemos la cotización por correo.',
    'El cliente pide hablar con el encargado de ventas.',
    'El cliente prefiere pagar con transferencia.',
    'El cliente pregunta si el pago se puede hacer en dos cuotas.',
    'El cliente pregunta cuándo tendrían stock de paneles 60x60.',
    'El cliente pregunta cuándo vuelve a haber stock de focos de 400W.',
    'El cliente pregunta si es cliente nuevo o antiguo.',
    'El cliente pregunta si tienen paneles de 60x60 en bodega.',
    'El cliente pide despacho para mañana.',
    'El cliente pide cotización de 20 focos LED de 150W para un galpón en Lampa.',
    'El cliente pregunta si hay stock de paneles 60x60 y cuánto demora el despacho a Temuco.',
    'El cliente pide 30 paneles LED para una oficina en Providencia y pregunta si emiten factura.',
    'El cliente dice que la obra está en Colina y pide 15 luminarias para estacionamiento.',
    'El cliente pregunta si pueden retirar en bodega y en qué horario.',
    'El cliente dice que ya compró antes y pide el mismo modelo de foco.',
    'El cliente pregunta si emiten boleta o factura y si despachan a regiones.',
    'El cliente pide 25 paneles para un colegio en Maipú y pregunta si pueden despachar esta semana.',
    'Obra en Lampa, 20 focos.',
    'Proyecto de iluminación para un galpón en Lampa.',
    'Según el cliente, el pedido ya llegó.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(summary);
  });
});

// Ronda 4 (precisión): una cláusula se bota solo si afirma una compra, un pago, stock, historial, un
// pedido existente o una entrega. El vocabulario comercial dentro de un sintagma descriptivo
// ("detalles de compra", "sala de ventas", "para despacho en Calama", "Retiro en tienda") no afirma
// nada; "Cliente" con un adjetivo o un nombre es su tipo; "desde elights.cl" es el canal. Frases
// inventadas con la forma de resúmenes reales.
describe('ronda 4: descripciones que se conservan', () => {
  it.each(withAndWithoutTildes([
    'Cliente de constructora solicita información sobre productos de iluminación.',
    'Cliente de Oficina Prueba consulta por cinta LED.',
    'Cliente proporciona nombre y correo.',
    'Contacto: Ana Prueba',
    'Retiro en tienda, factura empresa.',
    'Cotización de 26 proyectores LED 20W IP66 para empresa de venta al por menor en Lampa.',
    'Cliente empresa de venta al por menor, requiere contacto ejecutivo.',
    'Cliente desde elights.cl requiere contacto de ejecutivo.',
    'Cliente desde elights.cl.',
    'Cliente comercial con proyecto definido.',
    'Cliente de gimnasio interesado en luminarias LED lineales IP44 para un recinto deportivo.',
    'Potencial cliente con volumen.',
    '100 equipos UFO 100W 3000K para sala de ventas en Limache, V Región',
    'Cliente empresarial.',
    'Cliente empresarial Prueba.',
    'Cliente PRUEBATEC.',
    'Cliente comercial establecido.',
    'Cliente empresarial calificado.',
    'Cliente empresarial requiere seguimiento.',
    'No ha especificado producto ni detalles de compra.',
    'Consulta sobre dirección de retiro de eLIGHTS.cl',
    'Cliente sin respuesta previa.',
    'Cliente comercial (ferretería) en Melipilla.',
    'Cliente tiene dificultad para encontrar opción de pago en sitio web.',
    'Cliente de ferretería en Cañete solicita cotización de 42 unidades.',
    'Cliente inicial sin detalles de producto o proyecto especificado.',
    'Cotización de 42 paneles LED 60x60cm 40W para despacho en Calama.',
    'Cliente con múltiples productos de interés.',
    'Consulta B2B: proveedor de equipos eléctricos interesado en evaluar complementariedad con línea antiexplosiva.',
    'Cliente municipal consulta sobre certificación SEC y cumplimiento normativo DS1 para proyector LED 1000W.',
    'Cliente interesado en consultar sobre productos de eLIGHTS.cl.',
    'Expresa frustración con el proceso de compra.',
    'Cliente comercial con potencial de compra recurrente.',
    'No ha recibido contacto previo.',
    // Las mismas reglas, con otras palabras.
    'Despacho a regiones, factura empresa.',
    'Cliente desde la web.',
    'Cliente con proyecto nuevo.',
    'Cliente reemplaza luminarias antiguas.',
    'Cliente recibió respuesta por correo.',
    'Problema de pago en el sitio web.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(summary);
  });
});

describe('ronda 4: afirmaciones que se siguen botando', () => {
  it.each(withAndWithoutTildes([
    'Cliente ya ha realizado compra.',
    'Cliente ya en proceso de cotización.',
    'Cliente frecuente de la tienda.',
    'Compra con nosotros desde 2020.',
    'Cliente de la tienda hace años.',
    // "Cliente" con un adjetivo de historial, aunque vaya después de su tipo o de un nombre.
    'Cliente comercial frecuente.',
    'Cliente empresa constructora frecuente.',
    'Cliente B2B recurrente.',
    'Cliente Prueba frecuente.',
    'Cliente muy frecuente.',
    'El cliente es muy conocido.',
    'Cliente de compra frecuente.',
    'Cliente con compras recurrentes.',
    'Cliente de eLIGHTS.',
    'Cliente de la casa.',
    'Cliente de nosotros.',
    'Trabaja con eLIGHTS.',
    // "Desde" o "de" con una expresión de tiempo.
    'Cliente desde el 2019.',
    'Cliente desde marzo.',
    'Cliente de 5 años.',
    'Cliente de antigua data.',
    'Cliente de antes.',
    // El complemento no cubre una fecha, un rótulo con su valor, un hecho puntual ni un participio.
    'Focos para despacho mañana.',
    '20 paneles para entrega inmediata.',
    'Fecha de pago: lunes.',
    'Estado de pago: completo.',
    'Fecha de entrega el viernes.',
    'Proceso de compra terminado.',
    'Detalles de compra enviados.',
    'Opción de pago, ya pagó.',
    // La modalidad de entrega con una fecha o un estado.
    'Despacho a Lampa mañana.',
    'Retiro en tienda mañana.',
    'Retiro en tienda confirmado.',
    'Factura empresa emitida.',
    'Cliente recibió el pedido.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(SUMMARY_EMPTY);
  });
});

// Ronda 5: "con/para despacho, envío o entrega a/en <lugar>" es el destino de lo que se pide, salvo con
// una fecha o un estado; "Contacto:" con un nombre es neutro; "X solicitada/requerida" es un pedido.
// "Confirmación de" suelta cubre el stock, pero no la compra ni el pago.
describe('ronda 5: destinos, rótulos y pedidos en participio que se conservan', () => {
  it.each(withAndWithoutTildes([
    'Solicitud de 25 paneles LED backlight 60x60cm 48W luz fría para empresa Prueba Tecnología con despacho a Chillán.',
    'Solicitud de cotización de 6 proyectores LED 300W con envío a Pichilemu.',
    'Solicitud de 30 paneles LED tipo plafón con certificación DS (2200K, emisión descendente) para envío a Iquique.',
    'Cotización de 15 paneles redondos embutidos 18W IP44 (10 cálidos 3000K + 5 neutros 4000K) para despacho en San Pedro de la Paz',
    'Retiro en tienda/punto retiro, factura empresa.',
    'Cliente empresa venta al por menor, requiere contacto ejecutivo.',
    'Contacto: José Muñoz',
    'Contacto: María José Pérez Soto',
    'Entrega inmediata solicitada.',
    // "Confirmación de" sigue cubriendo el stock, y un pedido antes cubre la confirmación del pago.
    'Solicita confirmación de stock.',
    'Requiere confirmación de pago.',
    // Las mismas reglas, con otras palabras.
    'Despacho a San Pedro de la Paz.',
    'Retiro en punto de retiro.',
    'Envío a domicilio solicitado.',
    'Solicitud de 6 focos con retiro en tienda.',
    'Empresa de venta al por mayor en Quilicura.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(summary);
  });
});

describe('ronda 5: afirmaciones que se siguen botando', () => {
  it.each(withAndWithoutTildes([
    'Cliente ya ha realizado compra.',
    'Cliente retira producto.',
    'Consulta sobre factura emitida el 21.',
    'Confirmación de compra.',
    'Correo de confirmación de pago.',
    // El destino con una fecha, un plazo o un estado.
    'Solicitud de 25 paneles con despacho a Chillán mañana.',
    'Cotización con envío a Pichilemu el 21.',
    'Solicitud de 30 paneles para envío a Iquique en 2 días.',
    'Despacho a San Pedro de la Paz el lunes.',
    'Con despacho a Chillán confirmado.',
    'Solicitud de 10 focos con despacho a Chillán ya pagado.',
    'Cotización con envío gratis a Pichilemu.',
    'Pedido con despacho a Lampa.',
    'Retiro en tienda/punto retiro mañana.',
    // El giro y el participio no tapan un estado.
    'Venta al por menor cerrada.',
    'Empresa venta al por menor cerrada.',
    'Entrega inmediata.',
    'El pedido fue solicitado.',
    'Entrega solicitada para el 15 de noviembre, ya pagada.',
  ]))('"%s"', (summary) => {
    expect(safeSummary(summary)).toBe(SUMMARY_EMPTY);
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

  it('H1: el log de las afirmaciones botadas lleva solo la cantidad', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    safeSummary('Tenemos 20 focos en bodega. Consulta si es cliente frecuente. El pago se acreditó ayer.');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[summary] frases descartadas: 2');
  });

  it('H1: un texto largo con raíces y terminaciones se resuelve en menos de 200 ms', () => {
    const inputs = [
      'El cliente pregunta si se acreditaron los pagos que compraron y despacharon desde 2020 con nosotros. '.repeat(2000),
      'compraba pagaba entregaba despachaba recibia transferia '.repeat(3000),
      'ya ya ya ya en en en bodega bodega '.repeat(3000),
      'Cliente hizo hizo realizó una una nueva nueva compra pago pedido, '.repeat(3000),
      'tiene tiene una una pedido '.repeat(3000),
      'retirar retirar los los focos en bodega '.repeat(3000),
      'á'.repeat(200_000),
      'compr'.repeat(40_000),
      // Verificador: las reglas de bodega, lugar, perífrasis y cliente.
      'para usar para usar en en la la bodega bodega '.repeat(3000),
      'van a van a llegar llegar a a a '.repeat(3000),
      'cliente cliente de de la la empresa empresa es es una una '.repeat(3000),
      'está está en en ya ya todavía en '.repeat(3000),
      'pedido de pedido de compra de factura a nombre de '.repeat(3000),
      'El cliente pregunta: ¿hay stock?, y cuándo, y si, y cuándo '.repeat(3000),
      'lleva lleva años años hace hace tiempo tiempo '.repeat(3000),
      // Ronda 4: tipos de cliente, complementos y modalidad de entrega.
      'cliente comercial empresa constructora PRUEBATEC Prueba '.repeat(3000),
      'detalles de compra para despacho de venta para entrega de '.repeat(3000),
      'Retiro en tienda Lampa Prueba en bodega a '.repeat(3000),
      'cliente desde cliente de cliente por cliente muy '.repeat(3000),
    ];
    const start = performance.now();
    for (const input of inputs) safeSummary(input);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
