// src/components/request-order/requestCartAnalytics.ts
// Evento de Analytics «request_cart_view»: el visitante va a ver su solicitud de pedido.
// Lo envían la puerta «Pedido (n)» del encabezado y el «Pedido (n)» del menú del teléfono, así
// la misma acción se mide igual desde los dos lugares. Solo con productos en la solicitud: desde
// la entrega 3 la puerta se ve también en 0, y un clic a una lista vacía no es ver la solicitud
// (así el conteo sigue significando lo mismo que antes, cuando la pastilla desaparecía en 0).

import { sendEvent } from '@/lib/analytics';

/** subtotal: CON IVA, sea cual sea el modo de precios. */
export function trackRequestCartView(itemCount: number, subtotal: number): void {
  if (itemCount <= 0) return;
  sendEvent('request_cart_view', { item_count: itemCount, subtotal });
}
