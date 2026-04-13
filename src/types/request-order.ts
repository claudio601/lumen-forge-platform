// src/types/request-order.ts
// Tipos para el flujo de Solicitud de Pedido (Request Order)

// Item individual en el Request Cart
export interface RequestOrderItem {
    sku: string;
    name: string;
    quantity: number;
    /** Precio congelado al momento de agregar al carrito */
    unitPrice: number;
    currency: 'CLP';
    /** quantity * unitPrice calculado en frontend */
    lineTotal: number;
    url: string;
    attributes: {
          potencia?: string;
          colorLuz?: string;
          terminacion?: string;
    };
}

// Payload que se envia al endpoint api/request-orders/create
export interface RequestOrderPayload {
    items: RequestOrderItem[];
    subtotal: number;
    fullName: string;
    email: string;
    phone: string;
    customerType: 'empresa' | 'persona';
    companyName?: string;
    rut?: string;
    commune: string;
    region: string;
    notes?: string;
    requestReference: string;
}

// Respuesta exitosa del endpoint
export interface RequestOrderSuccessResponse {
    success: true;
    requestReference: string;
    dealId: number;
}

export interface RequestOrderErrorResponse {
    success: false;
    error: string;
    details?: { errors: string[] };
}

export type RequestOrderResponse =
    | RequestOrderSuccessResponse
  | RequestOrderErrorResponse;

// Item en el Request Cart (estado React/localStorage)
export interface RequestCartItem {
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    /** Precio congelado al momento de agregar */
    unitPrice: number;
    /**
       * Modo de precio con que fue congelado el item al agregarlo al carrito.
          * 'neto' = precio sin IVA (B2B). 'iva' = precio con IVA (B2C).
             * Persiste en localStorage junto con el item.
                */
    priceMode: 'neto' | 'iva';
    image?: string;
    url: string;
    attributes: {
          potencia?: string;
          colorLuz?: string;
          terminacion?: string;
    };
}
