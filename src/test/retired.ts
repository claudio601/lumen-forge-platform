// src/test/retired.ts
// Frases retiradas del sitio (PR 11, 2026-10): afirmaciones sin respaldo que no pueden volver.
// Lista compartida (plan del blog, §5.6): la usan src/config/contentTruth.test.ts (el código y el
// HTML de las páginas) y src/data/guides/guides.test.ts (el contenido de las guías).

export interface Retired {
  re: RegExp;
  why: string;
  /** Solo en el código: en el HTML chocaría con precios del catálogo ("$250.990", "$120.000"). */
  sourceOnly?: true;
}

/** Frases retiradas. Todas están en origin/main b110116 (antes de la PR 11). */
export const RETIRED: readonly Retired[] = [
  { re: /\+8 años/i, why: 'años en el mercado sin confirmar' },
  { re: /100\+/, why: 'cantidad de proyectos sin confirmar' },
  { re: /gratis|gratuit/i, why: 'envío o servicio gratis sin confirmar (DIALux: sin promesa de precio)' },
  // El monto existe (PR 12b), pero escrito a mano se desfasa de la constante: solo FREE_SHIPPING_THRESHOLD_CLP + clp()
  { re: /\$\s?250|250\.000/, why: 'monto del despacho sin costo escrito a mano (usar FREE_SHIPPING_THRESHOLD_CLP)', sourceOnly: true },
  { re: /santiago urbano|[aá]rea urbana/i, why: 'la zona del despacho sin costo es FREE_SHIPPING_AREA (Provincia de Santiago)' },
  { re: /no tenemos[^.]{0,60}retiro|retiro en oficina/i, why: 'sí hay retiro en bodega (PICKUP_PLACE)' },
  { re: /20\.000/, why: 'precio de la visita técnica sin confirmar', sourceOnly: true },
  { re: /descontable|no se descuenta/i, why: 'promesa sobre el precio de la visita o del estudio' },
  { re: /pr[oó]ximamente/i, why: 'anuncia funciones que no existen' },
  { re: /24-48|menos de 24 ?h(?:oras|rs?)?\b|(?:<|&lt;)\s?24 ?h|en 24 ?h(?:oras|rs?)?\b|24 ?h(?:oras|rs?)?\.? h[aá]biles/i, why: 'plazo de respuesta sin confirmar' },
  { re: /cotizaci[oó]n r[aá]pida/i, why: 'rapidez de respuesta sin confirmar' },
  { re: /9:00-18:00/, why: 'horario antiguo (usar businessHours)' },
  { re: /reposici[oó]n continua|prioridad en disponibilidad|reserva de productos/i, why: 'promesa implícita de stock' },
  { re: /precios especiales|tarifas especiales/i, why: 'precios especiales sin confirmar' },
  { re: /descuentos? por (?:proyecto|volumen)/i, why: 'descuentos por proyecto o volumen sin confirmar' },
  { re: /mi cuenta/i, why: 'no hay login (Fase 3)' },
  {
    re: /certificados SEC|SEC\s*Certificados|t[eé]cnicos? certificados?|electricistas certificados|instalador(?:es)? certificad[oa]s?|certificaci[oó]n de (?:la )?instalaci[oó]n/i,
    why: 'credenciales del equipo sin verificar (la declaración ante la SEC exige instalador autorizado)',
  },
  { re: /value: ['"]SEC['"]/, why: 'cifra "SEC / Certificados" del hero de /instalacion', sourceOnly: true },
  { re: /garantizad[oa]/i, why: '"garantizado" sin explicar la garantía (Ley 19.496, art. 33)' },
  { re: /productos certificados|certificaci[oó]n SEC, DS1, CE, IEC/i, why: 'una sola certificación para todo el catálogo' },
  // "12 meses" solo como garantía: la Política de privacidad dice que la decisión de cookies dura 12 meses (PR 13)
  {
    re: /garant[ií]a de f[aá]brica|garant[ií]a (?:base )?(?:de )?(?:1 año|12 meses)|12 meses(?: de)? garant[ií]a|'12 meses', label: 'Garant[ií]a'/i,
    why: 'una sola garantía para todo el catálogo',
  },
  { re: /camiones propios|flota propia|reparto propio|nuestros camiones|propios camiones|camiones de eLIGHTS/i, why: 'flota propia sin confirmar' },
  { re: /post-venta incluida|soporte t[eé]cnico incluido|certificados CE\/IEC|primer mes|letra chica|todo tipo de instalaciones/i, why: 'promesa general sin respaldo' },
  { re: /experiencia en (?:recintos|todo tipo)|nuestro ingeniero/i, why: 'experiencia o equipo sin respaldo' },
  { re: /aproximadamente 20|~20 p/i, why: 'extensión del informe DIALux sin confirmar' },
  { re: /cotizador inteligente/i, why: 'el formulario es simple' },
];

export function retiredIn(text: string, onlyRendered = false): string[] {
  return RETIRED.filter(r => !(onlyRendered && r.sourceOnly)).flatMap(({ re, why }) => {
    const m = text.match(re);
    return m ? [`"${m[0]}" (${why})`] : [];
  });
}
