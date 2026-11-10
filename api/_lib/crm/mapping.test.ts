// api/_lib/crm/mapping.test.ts
// mapPayloadToCustomer: el tipo de cliente de la persona (campo customerType) sale de lo que la
// fuente dice. /cotizacion lo manda como leadType (persona → B2C, empresa → B2B); Jumpseller no
// lo sabe (el webhook siempre manda B2C), así que la persona queda sin tipo.
// Solo datos inventados.

import { describe, expect, it } from 'vitest';
import { mapPayloadToCustomer } from './mapping.js';
import type { QuotePayload } from './types.js';

const quote = (extra: Partial<QuotePayload>): QuotePayload => ({
  sourceSystem: 'nuevo_elights',
  quoteReference: 'NE-prueba1',
  customer: { name: 'Persona Prueba', email: 'persona.prueba@example.com' },
  products: [{ name: 'Producto prueba', quantity: 1 }],
  quoteAmountClp: 1000,
  ...extra,
});

describe('mapPayloadToCustomer: tipo de cliente', () => {
  it.each(['B2B', 'B2C'] as const)('cotización del sitio con leadType %s: la persona lo lleva', (leadType) => {
    expect(mapPayloadToCustomer(quote({ leadType })).customerType).toBe(leadType);
  });

  it('pedido de Jumpseller: la persona queda sin tipo, aunque el webhook mande B2C', () => {
    const customer = mapPayloadToCustomer(quote({ sourceSystem: 'jumpseller', quoteReference: 'JS-1', leadType: 'B2C' }));
    expect(customer.customerType).toBeUndefined();
  });

  it('sin leadType (formulario anterior): no se adivina por la organización', () => {
    const customer = mapPayloadToCustomer(quote({ organization: { name: 'EMPRESA PRUEBA' } }));
    expect(customer.customerType).toBeUndefined();
  });

  it('un leadType que no es B2B ni B2C no llega a la persona', () => {
    const customer = mapPayloadToCustomer(quote({ leadType: 'b2b' as never }));
    expect(customer.customerType).toBeUndefined();
  });
});
