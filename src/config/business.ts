/**
 * src/config/business.ts
 * ─────────────────────────────────────────────────────────────
 * Fuente única de verdad para datos comerciales de eLIGHTS.
 * Importar desde aquí — NO hardcodear estos valores en componentes.
 */

// ── Contacto ────────────────────────────────────────────────

/** Número E.164 para construir URLs de WhatsApp (sin espacios ni +) */
export const whatsappNumber = '56991273128';

/** Número formateado para mostrar al usuario */
export const whatsappDisplayNumber = '+56 9 9127 3128';

/** Email comercial principal (ventas, cotizaciones) */
export const contactEmail = 'ventas@elights.cl';

/** Email de contacto para instalaciones */
export const contactEmailInstalacion = 'contacto@elights.cl';

/** Horario de atención, el mismo de elights.cl. Lo usan el pie de página y el popup de WhatsApp. */
export const businessHours = 'Lunes a viernes 9:30-14:00 y 15:00-17:30 hrs.';

/**
 * El mismo horario, para una frase ("de lunes a viernes, …"): lo usan las páginas legales.
 * Cambiar los dos juntos (src/pages/legal.test.tsx exige que tengan las mismas horas).
 */
export const businessHoursLong = 'lunes a viernes, de 9:30 a 14:00 y de 15:00 a 17:30 hrs.';

/** Días sin atención (elights.cl: fines de semana cerrado; festivos, decisión del dueño). */
export const businessClosedDays = 'Sábados, domingos y festivos, cerrado.';

// ── Condiciones de venta (páginas legales, PR 12) ───────────

/**
 * Monto (CLP, IVA incluido) sobre el que el despacho en Santiago urbano no tiene costo, o
 * null si no se publica. Hoy null: elights.cl se contradice (su página de envíos y el banner
 * de su inicio dan montos distintos) y el dueño no lo ha confirmado. Con un número, /despacho
 * muestra la condición; sin él, dice que el costo va en la cotización.
 */
export const FREE_SHIPPING_THRESHOLD_CLP: number | null = null;

/** Días hábiles que vale una cotización desde su fecha (términos y condiciones, §5). */
export const quoteValidityBusinessDays = 10;

// ── Helpers de URL ───────────────────────────────────────────

/** URL base de WhatsApp sin mensaje */
export const waBase = `https://wa.me/${whatsappNumber}`;

/** URL de WhatsApp para el servicio de instalación */
export const waInstalacion = `${waBase}?text=Hola%2C%20me%20interesa%20el%20servicio%20de%20instalaci%C3%B3n`;

/** URL de WhatsApp para el servicio de Estudio Luminico DIALux */
export const waEstudioLuminico = `${waBase}?text=Hola%2C%20me%20interesa%20el%20Estudio%20Luminico%20DIALux.%20Mi%20proyecto%20es...`;

/** URL de WhatsApp para instaladores y profesionales (/instaladores) */
export const waInstaladores = `${waBase}?text=${encodeURIComponent('Hola, soy instalador y quiero cotizar un proyecto')}`;

/** URL de WhatsApp genérica para consultas */
export const waGeneral = waBase;

/**
 * Construye una URL de WhatsApp para consulta de un producto específico.
 * @param productName  Nombre del producto
 * @param sku          SKU del producto
 */
export function waProductUrl(productName: string, sku: string): string {
  const text = encodeURIComponent(
    `Hola, consulta por ${productName} (SKU: ${sku})`
  );
  return `${waBase}?text=${text}`;
}

// ── Cobertura de instalación ─────────────────────────────────

/** Cobertura larga (para sección de mapa o descripción) */
export const installationCoverage =
  'Realizamos instalaciones en toda la Región Metropolitana. Los productos también se despachan a regiones a través de nuestros socios logísticos.';

/** Cobertura corta (para bullets o badges) */
export const installationCoverageShort = 'Cobertura Región Metropolitana.';

// ── Datos de la visita técnica ───────────────────────────────
// Sin precio publicado: un precio en el sitio obliga (Ley 19.496, arts. 13 y 18) y este
// no está confirmado. Si el dueño lo confirma, vuelve aquí como constante.

export const installationVisitDescription =
  'Un técnico visita tu espacio, evalúa tus necesidades de iluminación y te entrega un informe detallado con recomendaciones y cotización personalizada.';

// ── Trust claims (cards de confianza) ───────────────────────
// Solo lo confirmado (PR 11, 2026-10): sin años en el mercado, sin una cifra única de
// garantía (la legal es de 6 meses y cada ficha indica la suya), sin vehículos de reparto
// propios y sin certificaciones para todo el catálogo. src/config/contentTruth.test.ts lo vigila.

export const trustClaims = {
  stock: {
    title: 'Catálogo técnico amplio',
    desc: 'Amplia variedad de productos técnicos. Consulta disponibilidad antes de grandes proyectos.',
  },
  dispatch: {
    title: 'Despacho en hasta 2 días hábiles',
    desc: 'Despachamos en hasta 2 días hábiles, y a veces el mismo día; a regiones, vía operador logístico.',
  },
  certifications: {
    title: 'Certificaciones por producto',
    desc: 'Cada ficha indica las certificaciones del producto (SEC, DS1, CE u otras) cuando las tiene.',
  },
  warranty: {
    title: 'Garantía según producto',
    desc: 'Todos los productos tienen la garantía legal de 6 meses desde la recepción. Si un producto tiene una garantía mayor, su ficha la indica.',
  },
  dispatchChile: {
    title: 'Despacho a todo Chile',
    desc: 'Enviamos por Starken, Cruz del Sur, PDQ, ECOEx y otros. También despachamos con el operador logístico que prefiera el cliente.',
  },
} as const;
