// src/services/jumpsellerCart.ts
// Construye la URL de checkout directa de Jumpseller — sin API, sin Edge Function
import { CartItem } from '@/context/AppContext';

export function buildCheckoutUrl(items: CartItem[]): string {
  const base = 'https://elights.cl/checkout';
  const params = items
    .map(
      (item, i) =>
        `products[${i}][id]=${item.product.jumpseller_variant_id ?? item.product.jumpseller_id}&products[${i}][qty]=${item.quantity}`
    )
    .join('&');
  return `${base}?${params}`;
}
