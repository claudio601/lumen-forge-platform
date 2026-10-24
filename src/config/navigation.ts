// src/config/navigation.ts
// Destinos fijos del encabezado, del menú del teléfono y del pie (auditoría UX, entrega 3), el
// aviso D.S. N°1 del hero de la portada (entrega 4) y la caja del estudio DIALux de las fichas
// (entrega 6).

/**
 * «Asesoría técnica» en el menú del teléfono, en el pie y en /cotizacion vacía (E-02).
 *
 * El hub /asesoria (informe UX, sección 5.4) todavía no existe. Mientras tanto lleva al
 * Estudio Lumínico DIALux: es la asesoría técnica que ya existe (con su formulario, un plazo
 * de 48 horas desde que están los antecedentes y una FAQ para empresas), es la tarjeta central
 * del futuro hub y hoy no está en el menú ni en el pie, aunque 120 fichas lo mencionan. El
 * cotizador (/cotizador) y la instalación (/instalacion) ya tienen su propio enlace.
 *
 * El estudio se cotiza (brand/terminology/glossary.md): no se ofrece como cortesía. Cuando
 * exista /asesoria, se cambia solo aquí.
 */
export const ADVISORY_LINK = {
  label: 'Asesoría técnica',
  to: '/estudio-luminico',
  hint: 'Estudio lumínico DIALux (servicio cotizado)',
} as const;

/**
 * Aviso del D.S. N°1/2022 bajo los botones del hero de la portada (auditoría UX, A-01): lleva a
 * la categoría, que explica la norma (src/data/catalog/category-intros.ts). Sin "con
 * certificado": el certificado D.S. N°1 es solo de 8 líneas, y en la mayoría solo en algunas
 * versiones (src/data/catalog/ds1.ts); la categoría dice cuáles son de alumbrado público.
 * La ruta va escrita: src/lib/seo/routes.ts importa el catálogo completo y la portada no debe
 * cargarlo (lo prueba contentTruth.test.ts contra categoryPath).
 */
export const DS1_NOTICE = {
  label: 'D.S. N°1/2022:',
  text: 'desde el 19 de octubre de 2026 rige en todo Chile para el alumbrado exterior nuevo.',
  cta: 'Ver alumbrado público',
  to: '/catalogo/alumbrado-publico',
} as const;

/**
 * Caja «Estudio DIALux (servicio cotizado)» bajo los botones de las fichas de proyecto (auditoría
 * UX, E-02; qué fichas la llevan y a dónde lleva: src/lib/studyLink.ts). El estudio se cotiza
 * (brand/terminology/glossary.md): sin promesa de precio. Sin plazo: las 48 horas del informe se
 * dicen solo en / y en /estudio-luminico (scripts/known-phrases.ts), donde se explica desde
 * cuándo corren.
 */
export const DIALUX_BOX_TEXT = {
  title: 'Estudio DIALux (servicio cotizado)',
  text: '¿Cuántas necesitas para tu proyecto? Un estudio lumínico en DIALux te entrega la simulación y la propuesta de luminarias en un informe. Lo cotizamos según tu proyecto.',
  button: 'Cotizar estudio DIALux',
} as const;
