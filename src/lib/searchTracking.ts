// src/lib/searchTracking.ts
// Qué búsquedas de /buscar ya se midieron (evento search, auditoría UX KPI 9), para contar cada
// una una sola vez por entrada del historial (location.key de React Router).
//
// - Ir a una ficha y volver con «Atrás», o recargar, vuelve a montar /buscar con la misma entrada
//   (la misma clave): esa búsqueda ya se contó y no se repite. Por eso la marca no vive en el
//   componente, sino en sessionStorage (dura lo que la pestaña). Si sessionStorage falla, queda
//   en memoria: cubre «Atrás» dentro de la app, no la recarga.
// - Una búsqueda nueva desde el encabezado, aunque sea la misma consulta, es otra entrada (otra
//   clave): se cuenta.
// - La primera entrada de cada carga de página no trae clave ('default'). Si la carga es nueva
//   (no una recarga ni «Atrás»/«Adelante» del navegador), sus marcas son de una carga anterior y
//   se olvidan, una vez por carga: llegar dos veces a /buscar?q=panel desde fuera cuenta dos.
// - Sin el texto buscado: se guarda la clave de la entrada y un resumen (hash) de la consulta.
//   Hasta 50 marcas; las más antiguas salen primero. Cada lectura y escritura va en try/catch.

const STORAGE_KEY = 'elights_search_tracked';
const MAX_MARKS = 50;
/** Clave de React Router para la primera entrada de la carga (sin estado en el historial). */
const FIRST_ENTRY_KEY = 'default';

/** Respaldo cuando sessionStorage no funciona. */
let memory: string[] = [];
/** Las marcas de 'default' de una carga anterior ya se revisaron en esta carga. */
let firstEntryChecked = false;

/** FNV-1a de 32 bits, en base 36: la consulta no queda escrita en el navegador. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function load(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) && list.every(item => typeof item === 'string') ? list : [];
  } catch {
    return memory;
  }
}

function save(list: string[]): void {
  memory = list;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Bloqueado o lleno: queda en memoria
  }
}

/** La carga de la página es una recarga o «Atrás»/«Adelante» del navegador (la misma entrada de antes). */
function isSameEntryLoad(): boolean {
  try {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return nav?.type === 'reload' || nav?.type === 'back_forward';
  } catch {
    return false;
  }
}

/**
 * Marca la búsqueda (searchKey: sus palabras normalizadas) en la entrada del historial navKey.
 * true si es la primera vez (hay que medirla); false si ya se midió.
 */
export function claimSearch(navKey: string, searchKey: string): boolean {
  let list = load();
  if (!firstEntryChecked) {
    firstEntryChecked = true;
    if (!isSameEntryLoad()) list = list.filter(mark => !mark.startsWith(`${FIRST_ENTRY_KEY} `));
  }
  const mark = `${navKey} ${digest(searchKey)}`;
  if (list.includes(mark)) {
    save(list);
    return false;
  }
  save([...list, mark].slice(-MAX_MARKS));
  return true;
}
