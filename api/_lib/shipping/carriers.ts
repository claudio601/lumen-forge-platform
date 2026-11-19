// api/_lib/shipping/carriers.ts
// Operadores logísticos del aviso de despacho (spec Nivel 2, §5.3). Las etiquetas son las
// opciones de «Despacho · Operador» en Pipedrive y las de REGION_CARRIERS (src/config/business.ts;
// lo vigila scripts/shipping-carriers.test.ts).
//
// Páginas de seguimiento verificadas el 18-11-2026 con números inventados
// (aviso-despacho-2026-11-06/operadores-seguimiento-2026-11-18.md, fuera del repo):
// - el enlace es siempre https y fijo aquí; con `numberInUrl`, `{n}` se reemplaza por la orden
//   normalizada (solo letras y dígitos) con encodeURIComponent. Nunca un enlace escrito en un campo;
// - PDQ va sin el número a propósito: con un número equivocado, su `?q=` mostró envíos ajenos;
// - Cruz del Sur (dominio oficial sin confirmar) y ECOEx (sin seguimiento público) van sin botón.
// Nombre del documento del operador (Nivel 1): Starken y Samex «comprobante»; Pullman Cargo «orden
// de transporte»; el resto, «orden de flete».
// Un operador sin fila (una opción nueva del enum, p. ej. Rapid Cargo) sale con su etiqueta, sin
// botón, con los textos genéricos («orden de flete», «comprobante») y, al retirar, solo la oración
// de la cédula.
// Sin imports; la carpeta _lib hace que Vercel no lo despliegue como función.

export type CarrierId =
  | 'starken'
  | 'cruz-del-sur'
  | 'ecoex'
  | 'varmontt'
  | 'samex'
  | 'pdq'
  | 'pullman-cargo'
  | 'chilexpress'
  | 'transportes-mena';

type Article = 'el' | 'la';

export interface CarrierRow {
  /** Id estable: va en la clave de idempotencia del envío. Nunca cambia. */
  id: CarrierId;
  /** Opción de «Despacho · Operador» en Pipedrive, exacta. */
  label: string;
  /** Página pública de seguimiento (https fijo) o null: sin botón. Con `numberInUrl`, lleva `{n}`. */
  trackingUrl: string | null;
  /** La página acepta el número en la URL (`{n}`). */
  numberInUrl: boolean;
  /** Cómo llama el operador al número: «orden de flete», «OT», «N° de guía». */
  numberLabel: string;
  numberArticle: Article;
  /** Documento del operador que va adjunto: «el comprobante», «la orden de transporte». */
  document: { noun: string; article: Article };
  /** Regla de retiro escrita del operador (oración completa) o null. */
  pickupRule: string | null;
  /** Otra forma de seguir el envío, para completar «También puedes seguirlo …» o null. */
  trackingExtra: string | null;
}

const ORDEN_DE_FLETE = { numberLabel: 'orden de flete', numberArticle: 'la' } as const;
const DOC_ORDEN_DE_FLETE = { noun: 'orden de flete', article: 'la' } as const;
const DOC_COMPROBANTE = { noun: 'comprobante', article: 'el' } as const;

export const CARRIERS: readonly CarrierRow[] = [
  {
    id: 'starken',
    label: 'Starken',
    // Rellena el campo, pero hay que pulsar Buscar: por eso va también «Ingresa la orden de flete N».
    trackingUrl: 'https://www.starken.cl/seguimiento?codigo={n}',
    numberInUrl: true,
    ...ORDEN_DE_FLETE,
    document: DOC_COMPROBANTE,
    // Plazo y bodegaje del voucher de Starken.
    pickupRule: 'Tienes 10 días corridos desde la fecha de entrega para retirarlo; después Starken cobra bodegaje por día y por kilo.',
    // WhatsApp confirmado en el voucher del 10-11-2026 y en starken.cl (18-11-2026).
    trackingExtra: 'en la app de Starken o por su WhatsApp +56 9 6194 1240',
  },
  {
    id: 'cruz-del-sur',
    label: 'Cruz del Sur',
    trackingUrl: null,
    numberInUrl: false,
    ...ORDEN_DE_FLETE,
    document: DOC_ORDEN_DE_FLETE,
    pickupRule: null,
    trackingExtra: null,
  },
  {
    id: 'ecoex',
    label: 'ECOEx',
    trackingUrl: null,
    numberInUrl: false,
    ...ORDEN_DE_FLETE,
    document: DOC_ORDEN_DE_FLETE,
    pickupRule: null,
    trackingExtra: null,
  },
  {
    id: 'varmontt',
    label: 'Varmontt',
    trackingUrl: 'https://varmontt.cl/seguimiento-varmontt/',
    numberInUrl: false,
    numberLabel: 'orden de servicio',
    numberArticle: 'la',
    document: DOC_ORDEN_DE_FLETE,
    pickupRule: null,
    trackingExtra: null,
  },
  {
    id: 'samex',
    label: 'Samex',
    trackingUrl: 'https://mysamex.samex.cl/gts/pub/locNumSeguimiento.seam?tipo=L&localizador={n}',
    numberInUrl: true,
    numberLabel: 'OT',
    numberArticle: 'la',
    document: DOC_COMPROBANTE,
    pickupRule: null,
    trackingExtra: null,
  },
  {
    id: 'pdq',
    label: 'PDQ',
    // Nunca con ?q=: con un número equivocado mostró envíos ajenos.
    trackingUrl: 'https://www.pdq.cl/tracking',
    numberInUrl: false,
    numberLabel: 'N° de guía',
    numberArticle: 'el',
    document: DOC_ORDEN_DE_FLETE,
    pickupRule: null,
    trackingExtra: null,
  },
  {
    id: 'pullman-cargo',
    label: 'Pullman Cargo',
    trackingUrl: 'https://pullmancargo.cl/seguimiento/{n}',
    numberInUrl: true,
    numberLabel: 'orden de transporte',
    numberArticle: 'la',
    document: { noun: 'orden de transporte', article: 'la' },
    pickupRule: null,
    trackingExtra: null,
  },
  {
    id: 'chilexpress',
    label: 'Chilexpress',
    trackingUrl: 'https://www.chilexpress.cl/estado-envio-paquete-courier',
    numberInUrl: false,
    numberLabel: 'orden de transporte',
    numberArticle: 'la',
    document: DOC_ORDEN_DE_FLETE,
    pickupRule: null,
    trackingExtra: null,
  },
  {
    id: 'transportes-mena',
    label: 'Transportes Mena',
    trackingUrl: 'https://transportesmena.cl/seguimiento',
    numberInUrl: false,
    numberLabel: 'N° de orden',
    numberArticle: 'el',
    document: DOC_ORDEN_DE_FLETE,
    pickupRule: null,
    trackingExtra: null,
  },
];

/** Operador del aviso: una fila de la tabla o uno sin fila (opción nueva en Pipedrive). */
export interface Carrier extends Omit<CarrierRow, 'id'> {
  id: CarrierId | null;
  /** Para la clave de idempotencia: el id, o la etiqueta en minúsculas y con guiones. */
  slug: string;
}

/** Lo que recibe la plantilla: el id de una fila o, sin fila, solo la etiqueta (nunca un enlace). */
export type CarrierRef = { id: CarrierId } | { id: null; label: string };

/** Sin mayúsculas, tildes ni espacios de más: «ecoex» calza con la opción «ECOEx». */
function normalizeLabel(label: string): string {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** «Rapid Cargo» → «rapid-cargo»; «Transportes Ñandú» → «transportes-nandu». */
export function slugify(text: string): string {
  return normalizeLabel(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const BY_ID = new Map(CARRIERS.map((c) => [c.id, c]));
const BY_LABEL = new Map(CARRIERS.map((c) => [normalizeLabel(c.label), c]));

const asCarrier = (row: CarrierRow): Carrier => ({ ...row, slug: row.id });

/** Operador sin fila: su etiqueta, sin botón y con los textos genéricos. */
function genericCarrier(label: string): Carrier {
  const clean = label.replace(/\s+/g, ' ').trim();
  return {
    id: null,
    slug: slugify(clean) || 'otro',
    label: clean,
    trackingUrl: null,
    numberInUrl: false,
    ...ORDEN_DE_FLETE,
    document: DOC_COMPROBANTE,
    pickupRule: null,
    trackingExtra: null,
  };
}

/** La opción elegida en «Despacho · Operador» → su fila o, si no tiene, un operador genérico. */
export function carrierFromLabel(label: string): Carrier {
  const row = BY_LABEL.get(normalizeLabel(label));
  return row ? asCarrier(row) : genericCarrier(label);
}

export function resolveCarrier(ref: CarrierRef): Carrier {
  // `in` y no `id !== null`: tsconfig.api.json va sin strictNullChecks y no distinguiría por null.
  if ('label' in ref) return carrierFromLabel(ref.label);
  const row = BY_ID.get(ref.id);
  if (!row) throw new Error('resolveCarrier: operador desconocido');
  return asCarrier(row);
}

export function carrierRef(carrier: Carrier): CarrierRef {
  return carrier.id ? { id: carrier.id } : { id: null, label: carrier.label };
}

/**
 * Enlace del botón «Seguir mi envío»: la página fija del operador y, si la acepta, la orden
 * normalizada (solo letras y dígitos). null si el operador no tiene página verificada.
 */
export function trackingLink(carrier: Carrier, orderNormalized: string): string | null {
  if (!carrier.trackingUrl) return null;
  if (!carrier.numberInUrl) return carrier.trackingUrl;
  if (!/^[A-Z0-9]+$/.test(orderNormalized)) return null;
  return carrier.trackingUrl.replace('{n}', encodeURIComponent(orderNormalized));
}

/** El número con su nombre, para el texto: «orden de flete N° 282.022.397», «N° de guía 123». */
export function numberPhrase(carrier: Pick<Carrier, 'numberLabel'>, order: string): string {
  return /^N°/.test(carrier.numberLabel) ? `${carrier.numberLabel} ${order}` : `${carrier.numberLabel} N° ${order}`;
}

/** Etiqueta del número con mayúscula inicial, para la celda: «Orden de flete», «OT», «N° de guía». */
export function numberCellLabel(carrier: Pick<Carrier, 'numberLabel'>): string {
  return carrier.numberLabel.charAt(0).toUpperCase() + carrier.numberLabel.slice(1);
}

/** El operador en un nombre de archivo: «Pullman Cargo» → «Pullman-Cargo». */
export function carrierFileLabel(carrier: Pick<Carrier, 'label'>): string {
  return (
    carrier.label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'Operador'
  );
}
