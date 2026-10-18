// src/types/request-order.ts
// Tipos para el flujo de Solicitud de Pedido (Request Order)

import type { Attribution } from '@/lib/attribution';
import type { ConsentInput } from '../../api/_lib/forms/consent';

// Item individual en el Request Cart
export interface RequestOrderItem {
    /** Id del producto en Jumpseller: el servidor recalcula el precio CON IVA con él. */
    jumpsellerId?: number;
    /** Id de la variante en Jumpseller (p. ej. color de luz de BESTLED). */
    variantId?: number;
    /** Cómo veía el precio el cliente al enviar (selector del encabezado): 'neto' (modo empresa) o 'iva'. */
    priceMode?: 'neto' | 'iva';
    sku: string;
    name: string;
    quantity: number;
    /** Precio que veía el cliente, en el modo de priceMode (el servidor recalcula CON IVA). */
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
    /** Suma de lineTotal, en el modo de priceMode de las líneas (el servidor recalcula CON IVA). */
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
    /** Honeypot anti-bots: campo oculto que las personas dejan vacío. */
    website?: string;
    /** Origen de la visita (src/lib/attribution.ts); sin origen la clave no viaja. */
    attribution?: Attribution;
    /** Casillas de privacidad, términos y novedades (useConsentFields('pedido').payload()). */
    consent: ConsentInput;
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
    /** 'consent_required' cuando falta la casilla obligatoria (400). */
    code?: string;
    details?: { errors: string[] };
}

export type RequestOrderResponse =
    | RequestOrderSuccessResponse
  | RequestOrderErrorResponse;

// Item en el Request Cart (estado React/sessionStorage)
export interface RequestCartItem {
    productId: string;
    /** Id del producto en Jumpseller (ausente en carritos guardados antes de 2026-10). */
    jumpsellerId?: number;
    /** Id de la variante en Jumpseller; distingue dos colores de luz del mismo producto. */
    variantId?: number;
    sku: string;
    name: string;
    quantity: number;
    /**
     * Precio unitario CON IVA del catálogo (el de la variante, si la hay). El neto del modo
     * empresa se calcula al mostrar (requestTotals, cartItemToOrderItem): así el total nunca
     * suma precios con IVA y netos (auditoría UX, F-01).
     */
    unitPrice: number;
    /**
     * @deprecated Solo en carritos guardados antes del 2026-10-17: 'neto' quería decir que
     * unitPrice venía sin IVA. Al leer la sesión, normalizeStoredLine lo pasa a CON IVA y lo
     * quita; las líneas nuevas no lo llevan.
     */
    priceMode?: 'neto' | 'iva';
    image?: string;
    url: string;
    attributes: {
          potencia?: string;
          colorLuz?: string;
          terminacion?: string;
    };
}
