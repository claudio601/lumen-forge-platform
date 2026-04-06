/**
 * src/config/business.ts
 * ─────────────────────────────────────────────────────────────
 * Fuente única de verdad para datos comerciales de eLIGHTS.
 * Importar desde aquí — NO hardcodear estos valores en componentes.
 */

// ── Contacto ──────────────────────────────────────────────────

/** Número E.164 para construir URLs de WhatsApp (sin espacios ni +) */
export const whatsappNumber = '56991273128';

/** Número formateado para mostrar al usuario */
export const whatsappDisplayNumber = '+56 9 9127 3128';

/** Email comercial */
export const contactEmail = 'ventas@elights.cl';

/** Email de contacto para instalaciones */
export const contactEmailInstalacion = 'contacto@elights.cl';

// ── Helpers de URL ────────────────────────────────────────────

/** URL base de WhatsApp sin mensaje */
export const waBase = `https://wa.me/${whatsappNumber}`;

/** URL de WhatsApp para el servicio de instalación */
export const waInstalacion = `${waBase}?text=Hola%2C%20me%20interesa%20el%20servicio%20de%20instalaci%C3%B3n`;

/** URL de WhatsApp genérica para consultas */
export const waGeneral = waBase;

// ── Cobertura de instalación ──────────────────────────────────

/** Cobertura larga (para sección de mapa o descripción) */
export const installationCoverage =
  'Realizamos instalaciones en toda la Región Metropolitana. Los productos también se despachan a regiones a través de nuestros socios logísticos. Próximamente expandiendo cobertura de instalación a Valparaíso y Biobío.';

/** Cobertura corta (para bullets o badges) */
export const installationCoverageShort = 'Cobertura Región Metropolitana.';

// ── Datos de la visita técnica ────────────────────────────────

export const installationVisitLabel = 'Desde $20.000 · Descontable de tu compra';

export const installationVisitDescription =
  'Un técnico certificado visita tu espacio, evalúa tus necesidades de iluminación y te entrega un informe detallado con recomendaciones y cotización personalizada.';

// ── Trust claims (cards de confianza) ────────────────────────

export const trustClaims = {
  stock: {
    title: 'Amplio stock disponible',
    desc: 'Gran variedad de productos disponibles para despacho inmediato.',
  },
  dispatch: {
    title: 'Despacho en 48 hrs',
    desc: 'Entrega directa con camiones propios en Provincia de Santiago. Envío a regiones en 48 hrs al operador logístico.',
  },
  certifications: {
    title: 'Productos certificados',
    desc: 'Certificación SEC, DS1, CE, IEC y normas eléctricas chilenas.',
  },
  experience: {
    title: '+8 años en el mercado',
    desc: 'Experiencia y confianza en iluminación LED industrial.',
  },
  warranty: {
    title: 'Garantía 1 año',
    desc: 'Todos nuestros productos incluyen garantía base de 1 año.',
  },
  dispatchChile: {
    title: 'Despacho a todo Chile',
    desc: 'Enviamos por Starken, Cruz del Sur, PDQ, ECOEx y otros. También despachamos con el operador logístico que prefiera el cliente.',
  },
} as const;
