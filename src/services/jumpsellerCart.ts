// src/services/jumpsellerCart.ts
// Servicio cliente para crear órdenes en Jumpseller vía la Edge Function /api/create-order
// Las credenciales NUNCA se exponen aquí — todo pasa por el proxy del servidor

import { CartItem } from '@/context/AppContext';

interface OrderItem {
  jumpseller_id: number;
  quantity: number;
  price: number;
}

/**
 * Crea una orden en Jumpseller vía el proxy /api/create-order
 * @param items - items del carrito de compras
 * @returns URL de checkout de Jumpseller para redirigir al usuario
 * @throws Error descriptivo si la llamada falla
 */
export async function createOrder(items: CartItem[]): Promise<string> {
  if (items.length === 0) {
    throw new Error('No hay productos en el carrito para crear la orden');
  }

  const orderItems: OrderItem[] = items.map((item) => ({
    jumpseller_id: item.product.jumpseller_id,
    quantity: item.quantity,
    price: item.product.price,
  }));

  const response = await fetch('/api/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: orderItems }),
  });

  if (!response.ok) {
    let errorMessage = `Error al crear la orden (HTTP ${response.status})`;
    try {
      const errorData = await response.json();
      if (errorData?.error) {
        errorMessage = `Error Jumpseller: ${errorData.error}`;
      }
    } catch {
      // ignore JSON parse error, use default message
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();

  if (!data?.checkout_url) {
    throw new Error('La respuesta del servidor no incluye la URL de pago');
  }

  return data.checkout_url as string;
}
