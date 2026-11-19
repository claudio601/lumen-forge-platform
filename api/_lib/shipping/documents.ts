// api/_lib/shipping/documents.ts
// Documento tributario que acompaña el despacho: factura o guía de despacho (requisito del dueño
// del 18-11-2026; aviso real del 16-11 con guía de despacho). Un solo lugar para los dos tipos:
// la opción de «Despacho · Documento» en Pipedrive, cómo se nombra en el asunto, el encabezado y
// «Documentos», y el nombre limpio del PDF que recibe el cliente.
// Sin imports; la carpeta _lib hace que Vercel no lo despliegue como función.

export const DOCUMENT_TYPES = {
  factura: {
    /** Opción de «Despacho · Documento» en Pipedrive. */
    option: 'Factura',
    /** En el asunto y el encabezado: «Factura N° 8430». */
    title: 'Factura',
    /** Dentro de una oración: «la factura N° 8430». */
    noun: 'factura',
    article: 'la',
    /** Nombre del adjunto: «Factura-8430.pdf». */
    filePrefix: 'Factura',
  },
  guia: {
    option: 'Guía de despacho',
    title: 'Guía de despacho',
    noun: 'guía de despacho',
    article: 'la',
    filePrefix: 'Guia-de-despacho',
  },
} as const;

export type DocumentTypeId = keyof typeof DOCUMENT_TYPES;

/** «Despacho · Documento» vacío equivale a factura. */
export const DEFAULT_DOCUMENT_TYPE: DocumentTypeId = 'factura';

export const DOCUMENT_TYPE_IDS = Object.keys(DOCUMENT_TYPES) as DocumentTypeId[];

export interface ShippingDocument {
  type: DocumentTypeId;
  /** Solo dígitos, sin ceros a la izquierda. */
  number: string;
}

/** «Factura N° 8430» / «Guía de despacho N° 291». */
export function documentTitle(doc: ShippingDocument): string {
  return `${DOCUMENT_TYPES[doc.type].title} N° ${doc.number}`;
}

/** «la factura N° 8430» / «la guía de despacho N° 291». */
export function documentPhrase(doc: ShippingDocument): string {
  const t = DOCUMENT_TYPES[doc.type];
  return `${t.article} ${t.noun} N° ${doc.number}`;
}

/** Nombre limpio del PDF que recibe el cliente: «Factura-8430.pdf» / «Guia-de-despacho-291.pdf». */
export function documentFileName(doc: ShippingDocument): string {
  return `${DOCUMENT_TYPES[doc.type].filePrefix}-${doc.number}.pdf`;
}
