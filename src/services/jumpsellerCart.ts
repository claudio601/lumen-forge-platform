// src/services/jumpsellerCart.ts
// Construye la URL de checkout directa de Jumpseller — sin API, sin Edge Function
import { CartItem } from '@/context/AppContext';

/**
 * Resuelve el ID de variante Jumpseller para un item del carrito.
  * Prioridad: jumpseller_variant_id > jumpseller_id > undefined
   */
   function resolveVariantId(item: CartItem): number | undefined {
     return item.product.jumpseller_variant_id ?? item.product.jumpseller_id;
     }

     /**
      * Construye la URL de checkout de Jumpseller con los productos del carrito.
       * Filtra silenciosamente los items sin ID válido y los reporta en consola
        * para que aparezcan en los logs de producción sin romper el checkout.
         *
          * Formato esperado por Jumpseller:
           *   /checkout?products[0][id]=VARIANT_ID&products[0][qty]=QTY&products[1][id]=...
            */
            export function buildCheckoutUrl(items: CartItem[]): string {
              const base = 'https://elights.cl/checkout';

                // Separar items válidos de los que no tienen ID resuelto
                  const valid: CartItem[] = [];
                    const invalid: CartItem[] = [];

                      for (const item of items) {
                          if (resolveVariantId(item) !== undefined) {
                                valid.push(item);
                                    } else {
                                          invalid.push(item);
                                              }
                                                }

                                                  // Reportar en consola para que quede en logs de Vercel / Sentry
                                                    if (invalid.length > 0) {
                                                        console.error(
                                                              '[buildCheckoutUrl] Productos sin jumpseller_id ni jumpseller_variant_id — se omiten del checkout:',
                                                                    invalid.map(i => `${i.product.sku} (${i.product.id})`)
                                                                        );
                                                                          }

                                                                            if (valid.length === 0) {
                                                                                // No hay items válidos: redirigir al home de la tienda en lugar de enviar
                                                                                    // una URL con products[0][id]=undefined que Jumpseller ignora silenciosamente
                                                                                        console.error('[buildCheckoutUrl] Carrito vacío de items con ID válido — abortando checkout');
                                                                                            return 'https://elights.cl';
                                                                                              }

                                                                                                const params = valid
                                                                                                    .map(
                                                                                                          (item, i) =>
                                                                                                                  `products[${i}][id]=${resolveVariantId(item)}&products[${i}][qty]=${item.quantity}`
                                                                                                                      )
                                                                                                                          .join('&');

                                                                                                                            return `${base}?${params}`;
                                                                                                                            }

                                                                                                                            /**
                                                                                                                             * Retorna la lista de SKUs del carrito que no tienen jumpseller_id asignado.
                                                                                                                              * Útil para mostrar un aviso en CartPage antes de intentar el checkout.
                                                                                                                               */
                                                                                                                               export function getItemsWithoutId(items: CartItem[]): CartItem[] {
                                                                                                                                 return items.filter(item => resolveVariantId(item) === undefined);
                                                                                                                                 }