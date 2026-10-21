// src/config/navigation.ts
// Destinos fijos del encabezado, del menú del teléfono y del pie (auditoría UX, entrega 3).

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
