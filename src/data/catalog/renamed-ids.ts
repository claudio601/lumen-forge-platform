// src/data/catalog/renamed-ids.ts
// Ids del sitio renombrados (URLs /producto/:id), por jumpseller_id. Se mantiene A MANO y
// solo crece: el robot del catálogo nunca escribe este archivo.
//
// - `id`: el id vigente. Gana sobre legacy-ids.ts y site-ids.generated.ts (index.ts).
// - `previous`: ids anteriores. Cada uno redirige con 301 al vigente (vercel.json, generado
//   con `npm run redirects:write`) y nunca se reutiliza para otro producto.
// - Un segundo renombre: el `id` actual pasa al final de `previous` y se pone el nuevo. Así
//   todas las redirecciones llevan directo al vigente, sin cadenas.
// - Nunca borrar una entrada: las URLs nuevas darían 404 y las viejas dejarían de redirigir.
//
// PR 07 (2026-10-05): 50 ids que el catálogo legado cortó en la última '/' del permalink de
// Jumpseller (p. ej. "w-ip66"). El id nuevo es el permalink vigente sin %XX, tildes ni
// signos (la misma regla que newSiteId en build.ts), congelado aquí.
//
// Sin imports: lo usan el carrito de pedido, la cotización y las rutas, que van en el
// bundle principal (el catálogo completo es un trozo aparte).

export interface RenamedSiteId {
  /** Id vigente: la URL es /producto/<id>. */
  id: string;
  /** Ids anteriores, del más antiguo al más reciente. */
  previous: readonly string[];
}

export const RENAMED_SITE_IDS: Readonly<Record<number, RenamedSiteId>> = {
  2300837: { id: 'tubo-led-opal-vidrio-18w-120cm-220v-c-sensor-6500k', previous: ['sensor-6500k'] },
  2312822: { id: 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-luz-calida', previous: ['m-5mt-12v-luz-calida-2312822'] },
  2313541: { id: 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-luz-fria', previous: ['m-5mt-12v-luz-fria'] },
  2313620: { id: 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-rojo', previous: ['m-5mt-12v-rojo-2313620'] },
  2313626: { id: 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-azul', previous: ['m-5mt-12v-azul'] },
  2313647: { id: 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-verde', previous: ['m-5mt-12v-verde-2313647'] },
  2313648: { id: 'cinta-led-interior-14-4w-smd-5050-60leds-m-5mt-12v-amarillo', previous: ['m-5mt-12v-amarillo'] },
  2313769: { id: 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-luz-calida', previous: ['m-5mt-12v-luz-calida'] },
  2313836: { id: 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-rojo', previous: ['m-5mt-12v-rojo'] },
  2313842: { id: 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-azul', previous: ['m-5mt-12v-azul-2313842'] },
  2313858: { id: 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-verde', previous: ['m-5mt-12v-verde'] },
  2313868: { id: 'cinta-led-exterior-14-4w-smd-5050-60leds-m-5mt-12v-amarillo', previous: ['m-5mt-12v-amarillo-2313868'] },
  2345320: { id: 'tortuga-aluminio-oval-c-rejilla-e27-ip54-blanca', previous: ['rejilla-e27-ip54-blanca'] },
  3952758: { id: 'cinta-led-exterior-14-4w-5730-72-leds-mt-ip67-100mt-220v', previous: ['mt-ip67-100mt-220v'] },
  // El permalink dice "cinta-led-led-verde": el id lleva "exterior", como el nombre (decisión del dueño).
  3954845: { id: 'cinta-led-exterior-verde-14-4w-m-72-leds-m-ip67-100-mt-220v', previous: ['m-ip67-100-mt-220v'] },
  4122715: { id: 'campana-led-ufo-nf3-150w-150-lm-w-ip66', previous: ['w-ip66'] },
  20610994: { id: 'campana-led-ufo-nf6-300w-110lm-w-ip65', previous: ['w-ip65'] },
  21809432: { id: 'cinta-led-exterior-6-5w-smd-2835-48leds-m-100mt-220v-rgb', previous: ['m-100mt-220v-rgb'] },
  22672906: { id: 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-amarillo', previous: ['m-100mt-220v-amarillo'] },
  22679546: { id: 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-azul', previous: ['m-100mt-220v-azul'] },
  22679578: { id: 'cinta-led-exterior-14-4w-smd-5730-72leds-m-100mt-220v-rojo', previous: ['m-100mt-220v-rojo'] },
  24031164: { id: 'campana-led-ufo-nf8-100w-110lm-w-ip65', previous: ['w-ip65-24031164'] },
  24040212: { id: 'campana-led-ufo-nf8-150w-110lm-w-ip65', previous: ['w-ip65-24040212'] },
  24040292: { id: 'campana-led-ufo-nf8-200w-110lm-w-ip65', previous: ['w-ip65-24040292'] },
  // No publicado hoy: su 301 lleva a una 404 (igual que hoy) y vuelve sola si se republica.
  24043701: { id: 'campana-led-ufo-nf8-300w-110lm-w-ip65', previous: ['w-ip65-24043701'] },
  24043822: { id: 'campana-led-ufo-nf8-pro-300w-150lm-w-ip65', previous: ['w-ip65-24043822'] },
  24192756: { id: 'proyector-led-ultra-slim-50w-ip66-negro-c-sensor-de-movimiento', previous: ['sensor-de-movimiento'] },
  24192873: { id: 'proyector-led-ultra-slim-100w-ip66-negro-c-sensor-de-movimiento', previous: ['sensor-de-movimiento-24192873'] },
  24256942: { id: 'proyector-led-ultra-slim-150w-ip66-negro-c-sensor-de-movimiento', previous: ['sensor-de-movimiento-24256942'] },
  24257068: { id: 'proyector-led-ultra-slim-200w-ip66-negro-c-sensor-de-movimiento', previous: ['sensor-de-movimiento-24257068'] },
  25818717: { id: 'alumbrado-publico-led-solar-200w-all-in-one-c-control-remoto', previous: ['control-remoto-1'] },
  // Sin el "-1" que Jumpseller agregó para no repetir permalinks (como hizo al limpiar 25818717).
  25885210: { id: 'alumbrado-publico-led-solar-100w-all-in-one-c-control-remoto', previous: ['control-remoto-1-25885210'] },
  25888711: { id: 'alumbrado-publico-led-solar-150w-all-in-one-c-control-remoto', previous: ['control-remoto'] },
  25888760: { id: 'alumbrado-publico-led-solar-60w-all-in-one-c-control-remoto', previous: ['control-remoto-1-25888760'] },
  25891192: { id: 'proyector-led-solar-100w-ip65-c-panel-solar-c-control-remoto', previous: ['control-remoto-25891192'] },
  25891958: { id: 'proyector-led-solar-150w-ip65-c-panel-solar-c-control-remoto', previous: ['control-remoto-25891958'] },
  25892132: { id: 'proyector-led-solar-200w-ip65-c-panel-solar-c-control-remoto', previous: ['control-remoto-25892132'] },
  28648231: { id: 'proyector-led-solar-200w-ip66-c-panel-solar-c-control-remoto-gris', previous: ['control-remoto-gris'] },
  28651673: { id: 'proyector-led-solar-100w-ip66-c-panel-solar-c-control-remoto', previous: ['control-remoto-28651673'] },
  28666518: { id: 'proyector-led-solar-300w-ip66-c-panel-solar-c-control-remoto', previous: ['control-remoto-28666518'] },
  28668257: { id: 'proyector-led-solar-150w-ip66-c-panel-solar-c-control-remoto', previous: ['control-remoto-28668257'] },
  31518788: { id: 'campana-led-ufo-regulable-200w-150lm-w-ip66-ik10', previous: ['w-ip66-ik10'] },
  32954808: { id: 'campana-led-ufo-nf9-400w-110-lm-ip65-44000-lm', previous: ['ip65-44000-lm'] },
  33554875: { id: 'campana-led-ufo-nf7-100w-120lm-w-ip65', previous: ['w-ip65-33554875'] },
  33597212: { id: 'campana-led-ufo-nf7-150w-120lm-w-ip65', previous: ['w-ip65-33597212'] },
  33610052: { id: 'campana-led-ufo-nf7-200w-120lm-w-ip65', previous: ['w-ip65-33610052'] },
  33736073: { id: 'campana-led-ufo-nf9-100w-110lm-w-ip65-11000-lm', previous: ['w-ip65-11000-lm'] },
  33748536: { id: 'campana-led-ufo-nf9-150w-110lm-w-ip65-16500-lm', previous: ['w-ip65-16500-lm'] },
  33748560: { id: 'campana-led-ufo-nf9-200w-110lm-w-ip65-22000-lm', previous: ['w-ip65-22000-lm'] },
  34057374: { id: 'proyector-led-solar-500w-ip65-c-panel-solar-c-control-remoto', previous: ['control-remoto-34057374'] },
};

/**
 * Id anterior → id vigente. Es un Map (no un objeto) para que una URL como
 * /producto/constructor no encuentre nada heredado de Object.prototype.
 */
export const RENAMED_FROM: ReadonlyMap<string, string> = new Map(
  Object.values(RENAMED_SITE_IDS).flatMap(r => r.previous.map(p => [p, r.id] as const)),
);

/** Ids que ya no se usan: tienen su 301 y nunca se asignan a otro producto. */
export const RETIRED_SITE_IDS: ReadonlySet<string> = new Set(RENAMED_FROM.keys());
