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

/**
 * Correo para los comprobantes de pago, con el número de cotización (decisión del dueño 8A,
 * 2026-11-13). Solo para comprobantes: ventas@ (contactEmail) sigue siendo el correo de ventas
 * para todo lo demás. Lo usa /medios-de-pago.
 */
export const paymentsEmail = 'pagos@elights.cl';

/** Enlace al correo de comprobantes, con el asunto ya escrito. */
export const paymentsMailto = `mailto:${paymentsEmail}?subject=${encodeURIComponent('Comprobante de pago')}`;

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

// ── Plazo de respuesta de las solicitudes (dueño, 2026-10-17) ─────────────────
// El equipo responde SIEMPRE por correo: nunca ofrecer llamadas ni WhatsApp en las
// confirmaciones ni junto al botón de envío. Sin horas exactas: lo que llega fuera del
// horario se responde el día hábil siguiente. Lo usan /cotizacion, /solicitar-pedido y
// /cotizador (junto al botón y en la confirmación).

/** El plazo que se promete. */
export const responseTimePromise = 'Te respondemos por correo el mismo día hábil.';

/** El horario, para ir junto al plazo (antes de enviar). */
export const responseTimeHours = `Atendemos de ${businessHoursLong}`;

/** Lo que pasa con una solicitud que llega fuera del horario (en la confirmación). */
export const responseTimeOffHours = `${responseTimeHours} Si tu solicitud llegó fuera de ese horario, te respondemos el día hábil siguiente.`;

// ── Montos ──────────────────────────────────────────────────

/**
 * Pesos chilenos para mostrar: 1234567 → "$1.234.567". Sin Intl ni toLocaleString: el
 * servidor (prerender) y el navegador dibujan lo mismo y la hidratación no falla.
 */
export function clp(amount: number): string {
  return `$${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

// ── Condiciones de venta (páginas legales, PR 12; despacho y retiro, PR 12b) ──
// Despacho y retiro confirmados por el dueño el 2026-10-14 (reemplazan los defaults de la
// PR 12, que no publicaban el monto ni ofrecían retiro). Las páginas leen estas constantes;
// no escribir el monto, la zona ni el lugar de retiro a mano (src/config/contentTruth.test.ts).

/**
 * Despacho sin costo: cuando el TOTAL de la compra, CON IVA, es estrictamente mayor que este
 * monto (CLP) y la entrega es en FREE_SHIPPING_AREA. Con este monto exacto o menos, o fuera
 * de esa zona, el costo va en la cotización o el despacho va por pagar. Es la única vez que
 * el monto se escribe en el código: las páginas lo muestran con clp().
 */
export const FREE_SHIPPING_THRESHOLD_CLP = 250_000;

/**
 * Zona del despacho sin costo: la Provincia de Santiago (sus 32 comunas). No entran las otras
 * 20 comunas de la Región Metropolitana, que son de otras provincias:
 * - excluded: las que nombra el dueño, con sus palabras (muchos clientes las cuentan como
 *   Santiago). "El resto de la Provincia de Chacabuco" son Lampa y Tiltil.
 * - alsoExcluded: las 7 que su lista no nombra. Quedan fuera por la misma regla (no son de la
 *   Provincia de Santiago); se publican para que la lista de /despacho no parezca completa sin
 *   serlo (src/pages/legal.test.tsx revisa que estén las 20).
 */
export const FREE_SHIPPING_AREA = {
  name: 'Provincia de Santiago',
  excluded: [
    'San Bernardo, Puente Alto, Colina y el resto de la Provincia de Chacabuco',
    'Talagante, Peñaflor y Padre Hurtado',
    'Melipilla y Alhué',
    'Buin, Paine y Pirque',
  ],
  alsoExcluded: ['Calera de Tango', 'San José de Maipo', 'Isla de Maipo', 'El Monte', 'Curacaví', 'María Pinto', 'San Pedro'],
} as const;

/**
 * Las comunas de la Región Metropolitana que no entran en el despacho sin costo, en una frase:
 * las del dueño y, al final, las 7 que su lista no nombra.
 */
export const freeShippingExcludedList = [
  ...FREE_SHIPPING_AREA.excluded,
  `${FREE_SHIPPING_AREA.alsoExcluded.slice(0, -1).join(', ')} y ${FREE_SHIPPING_AREA.alsoExcluded[FREE_SHIPPING_AREA.alsoExcluded.length - 1]}`,
].join('; ');

/** El despacho sin costo en pocas palabras (barra de confianza del inicio, que enlaza a /despacho). */
export const freeShippingShort = `Despacho sin costo sobre ${clp(FREE_SHIPPING_THRESHOLD_CLP)} en la ${FREE_SHIPPING_AREA.name}`;

/**
 * Despacho a regiones: por pagar, con estos transportistas (lista del dueño, 2026-10-25; antes,
 * desde la PR 12b, «Starken, PDQ u otro operador»). Sale también en la Política §5: cambiarla
 * exige subir LEGAL_VERSION.
 */
export const REGION_CARRIERS = 'Starken, Cruz del Sur, ECOEx, Varmontt, Samex, PDQ, Pullman Cargo, Chilexpress, Transportes Mena u otro operador';

/**
 * Retiro en bodega, sin costo de despacho. La dirección exacta se entrega solo cuando el pago
 * está acreditado: NUNCA publicarla, ni en el sitio ni en el repo (es público).
 */
export const PICKUP_PLACE = 'nuestra bodega en Quinta Normal';

// ── Paneles de formato grande a regiones (regla del dueño A22, aprobada el 2026-11-13, 2A) ──
// «Los paneles de formato grande (60x60, 120x60, 120x30, 120x15, backlight y slim) no se
// despachan por courier si el pedido es menor que su caja master: se rompen. En ese caso va solo
// retiro en bodega, o se ofrece la caja completa. Cajas master: backlight 120x60 y 120x30 = 6;
// slim 120x30, 60x60 y 120x15 = 10. Excepción: el slim 60x60 se despacha desde 4 unidades. Los
// paneles redondos y cuadrados chicos (PLRE, PLRS, PLCE) sí se despachan en cualquier cantidad.
// Con una caja o más se cotiza lo pedido, sin redondear a cajas.»
// Cada fila, con su fuente: la regla del dueño y el «Packaging por mayor» de Jumpseller (revisado
// el 2026-11-13 con `npm run content -- export`). Donde la regla no nombra el formato, manda el
// packaging de Jumpseller; sin dato en ninguno de los dos, box: null (la ficha dice «desde una caja
// completa», sin número). Lo leen la ficha (ProductDetail, panelRegionShippingNotice) y /despacho.
// No cambia formularios ni cantidades: el pedido se cotiza igual.

export interface PanelMasterBox {
  /** Unidades de la caja master; null si no hay dato confiable. */
  box: number | null;
  /** Desde cuántas unidades se despacha a regiones cuando es menos que la caja (slim 60x60: 4). */
  minUnits?: number;
}

/** Paneles de formato grande, por jumpseller_id. */
export const PANEL_MASTER_BOX: Readonly<Record<number, PanelMasterBox>> = {
  // Backlight 120x60 96W: regla del dueño (6); Jumpseller, «6 piezas x caja».
  3702364: { box: 6 },
  // Backlight 120x30 48W: regla del dueño (6); Jumpseller, «6 piezas x caja».
  4426526: { box: 6 },
  // Backlight 60x60 48W: la regla no nombra el backlight 60x60; Jumpseller, «10 piezas x caja».
  4190659: { box: 10 },
  // 120x60 80W marco blanco: la regla solo nombra el backlight 120x60; Jumpseller, «6 unidades por caja».
  2347772: { box: 6 },
  // 120x60 80W marco blanco regulable: ídem; Jumpseller, «6 unidades por caja».
  2348936: { box: 6 },
  // 120x30 40W: regla del dueño (slim 120x30, 10); Jumpseller, «10 unidades por cajas».
  2347854: { box: 10 },
  // 120x30 40W marco blanco regulable: Jumpseller no trae su packaging y su nombre no dice si es
  // slim o backlight. Sin número hasta que el dueño lo confirme.
  2348922: { box: null },
  // 120x15 36W: regla del dueño (slim 120x15, 10); Jumpseller, «10 unidades por caja».
  2347849: { box: 10 },
  // 120x15 36W luz cálida: regla del dueño (slim 120x15, 10); Jumpseller, «10 unidades por caja».
  21766686: { box: 10 },
  // Slim 60x60 40W: regla del dueño (10, y se despacha desde 4); Jumpseller, «10 unidades por cajas».
  4608256: { box: 10, minUnits: 4 },
  // Slim 60x60 40W dimerizable: también es slim 60x60 (regla del dueño, desde 4); Jumpseller, «10 unidades por cajas».
  2501112: { box: 10, minUnits: 4 },
};

/**
 * Aviso de la ficha de un panel de formato grande (junto a «Despacho en hasta 2 días hábiles»),
 * o null si el producto no está en PANEL_MASTER_BOX. «Desde N unidades» y no «por caja»: con una
 * caja o más se cotiza lo pedido, sin redondear a cajas.
 */
export function panelRegionShippingNotice(jumpsellerId: number): string | null {
  const panel = PANEL_MASTER_BOX[jumpsellerId];
  if (!panel) return null;
  const from = panel.minUnits
    ? `desde ${panel.minUnits} unidades`
    : panel.box
      ? `desde ${panel.box} unidades, una caja completa`
      : 'desde una caja completa';
  return `Despacho a regiones: ${from}. Con menos unidades, retiro en ${PICKUP_PLACE}.`;
}

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

/**
 * Correo prellenado a ventas para pedir los documentos técnicos de un producto (auditoría UX,
 * D-02, paso 1): «Pedir documentos técnicos» en las fichas con PDF y «Pedir ficha técnica» en las
 * que no tienen (PR 170). Por correo y no por WhatsApp:
 * los certificados los entrega el equipo con su respaldo. El cuerpo no nombra ningún documento
 * (ficha, IES, certificados): no todos los productos los tienen, y el cliente escribe cuáles
 * necesita. El SKU es el de la línea (el de la variante elegida, o JS-<id>), el mismo de WhatsApp.
 * Sin la variante elegida, el cuerpo trae una línea por opción («Temperatura de color:»), con lo
 * que el cliente ya marcó o en blanco para que la complete: en las BESTLED, por ejemplo, los
 * certificados son por variante, y así ventas no tiene que volver a preguntar.
 * @param productName  Nombre del producto, con la variante elegida si la hay
 * @param sku          SKU de la línea
 * @param url          Dirección absoluta de la ficha
 * @param choices      Opciones de la variante sin elegir del todo: rótulo y lo marcado, si hay
 */
export function docsRequestMailto(
  productName: string,
  sku: string,
  url: string,
  choices: readonly { legend: string; value?: string }[] = [],
): string {
  const subject = `Documentos técnicos: ${productName} (SKU ${sku})`;
  const body = [
    'Hola, necesito los documentos técnicos de este producto:',
    '',
    `Producto: ${productName}`,
    ...choices.map(c => (c.value ? `${c.legend}: ${c.value}` : `${c.legend}:`)),
    `SKU: ${sku}`,
    `Ficha: ${url}`,
    '',
    'Documentos que necesito:',
    'Proyecto o uso:',
    '',
  ].join('\r\n');
  return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
    desc: 'Cada ficha indica las certificaciones del producto (SEC, CE u otras) cuando las tiene.',
  },
  warranty: {
    title: 'Garantía según producto',
    desc: 'Todos los productos tienen la garantía legal de 6 meses desde la recepción. Si un producto tiene una garantía mayor, su ficha la indica.',
  },
  dispatchChile: {
    title: 'Despacho a todo Chile',
    desc: `A regiones, por pagar, vía ${REGION_CARRIERS}. También despachamos con el operador logístico que prefiera el cliente.`,
  },
} as const;
