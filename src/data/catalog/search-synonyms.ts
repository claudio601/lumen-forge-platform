// src/data/catalog/search-synonyms.ts
// Sinónimos de la búsqueda del sitio (/buscar), auditoría UX, B-03. Para que el dueño lo revise.
//
// Cómo se lee cada fila: si el cliente escribe alguna de las palabras de «busca», también
// encuentra los productos de «encuentra» (una búsqueda o varias). Va en un solo sentido: buscar
// «proyector» no trae los «foco». Lo que el cliente escribió también se busca tal cual: «foco»
// trae los focos y los proyectores, primero los que dicen «foco». Con «categoria», lo que llega
// por sinónimo se limita a esa categoría: «plafón» trae los paneles LED sobrepuestos, no los «panel solar».
//
// Reglas para editar:
// - Tildes y mayúsculas no importan: «galpón» y «galpon» son lo mismo.
// - Solo el singular: los plurales («reflectores», «galpones») se reconocen solos. Una letra de
//   diferencia también («galpn», «deportiva»), en palabras de 5 letras o más que no estén en el
//   catálogo y que empiecen con la misma letra.
// - «encuentra» se escribe como se muestra en las sugerencias («proyector de estadio») y tiene
//   que dar resultados en el catálogo (lo revisa src/lib/productSearch.test.ts).
// Sin datos de productos: lo importa la página de búsqueda.

export interface SearchSynonym {
  /** Palabras (o frases) que escribe el cliente. */
  busca: readonly string[];
  /** Lo que también se busca, como se muestra en las sugerencias (una búsqueda o varias). */
  encuentra: string | readonly string[];
  /** Solo los productos de esta categoría del sitio (su id en categories.config.ts). */
  categoria?: string;
}

export const SEARCH_SYNONYMS: readonly SearchSynonym[] = [
  { busca: ['reflector', 'foco'], encuentra: 'proyector' },
  { busca: ['vial', 'calle', 'farol'], encuentra: 'alumbrado público' },
  { busca: ['galpon', 'bodega', 'nave industrial', 'high bay', 'highbay'], encuentra: 'campana' },
  { busca: ['antiexplosivo', 'ex', 'atex', 'zona clasificada'], encuentra: 'antiexplosiva' },
  { busca: ['cancha', 'multicancha', 'deportivo', 'recinto deportivo'], encuentra: 'proyector de estadio' },
  // «Plafón» es el panel sobrepuesto; «cielo falso», cualquier panel (regla del Project, 07-10-2026)
  { busca: ['plafon'], encuentra: 'panel sobrepuesto', categoria: 'paneles-led' },
  { busca: ['cielo falso'], encuentra: 'panel', categoria: 'paneles-led' },
  // «30x30»: el panel cuadrado sobrepuesto de 24 W, de 29,6 cm (aprendizajes del 07-10-2026)
  { busca: ['30x30'], encuentra: 'panel cuadrado sobrepuesto 24W', categoria: 'paneles-led' },
  { busca: ['fluorescente'], encuentra: 'tubo' },
  { busca: ['manguera', 'huincha'], encuentra: 'cinta' },
  { busca: ['transformador', 'driver'], encuentra: 'fuente de poder' },
  { busca: ['letrero', 'cartel'], encuentra: 'señalética' },
  { busca: ['fotovoltaico'], encuentra: 'solar' },
  { busca: ['dimmer', 'dimerizable', 'regulable'], encuentra: ['regulable', 'dimerizable'] },
  { busca: ['triproof', 'tri proof'], encuentra: 'hermética' },
  { busca: ['empotrado'], encuentra: 'embutido' },
  { busca: ['detector'], encuentra: 'sensor' },
  { busca: ['presencia'], encuentra: 'movimiento' },
  // Nombres que usan los clientes (Project «Cotizador eLIGHTS.cl», auditoría del 13-11-2026)
  { busca: ['skyfly', 'sky fly'], encuentra: 'flyhawk' },
  // El «tubo PC» es el de aluminio con policarbonato, no el de vidrio
  { busca: ['tubo pc', 'tubo policarbonato'], encuentra: 'tubo opal aluminio' },
  // «Antares» es nuestra línea de ampolletas bola E27 y dicroica GU10 (no las AR111)
  { busca: ['antares'], encuentra: ['ampolleta bola', 'ampolleta gu10'] },
  // Los antivandálicos son IK08: el «antivandálico IK10» es el proyector de estadio modular
  { busca: ['antivandalico ik10'], encuentra: 'proyector de estadio modular' },
];

/**
 * Palabras que no filtran cuando hay otras, tampoco en plural («luminarias», «lámparas»):
 * «luminaria vial» busca solo «vial», y «luces de emergencia», solo «emergencia». Si el cliente
 * escribe solo estas («led»), se buscan tal cual. «luces» y «leds» van escritas aparte porque su
 * singular no se saca solo.
 */
export const GENERIC_SEARCH_WORDS: readonly string[] = [
  'luminaria', 'lampara', 'led', 'leds', 'luz', 'luces', 'iluminacion',
  'de', 'del', 'la', 'las', 'el', 'los', 'para', 'con', 'en', 'y', 'a', 'al', 'tipo',
];
