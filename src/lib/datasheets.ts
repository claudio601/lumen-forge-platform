// src/lib/datasheets.ts
// Botones «Ficha técnica» de la ficha de producto: el PDF editorial (BESTLED) o los PDF
// adjuntos al producto en Jumpseller (src/data/catalog/datasheets.generated.ts), los mismos
// que muestra elights.cl. Con varios PDF, uno por potencia (Flyhawk 40-80W), cada botón
// lleva su potencia; si los nombres no la distinguen, un número.

export interface DatasheetLink {
  href: string;
  label: string;
}

const LABEL = 'Ficha técnica';
/** Potencia en el nombre del archivo: «80w», «_50W_», «60 W» (sin lookbehind: Safari < 16.4 no lo entiende). */
const POWER_RE = /(^|[^0-9a-z.])(\d+)\s*w(?=$|[^0-9a-z])/gi;

function fileName(href: string): string {
  const last = href.split(/[?#]/)[0].split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function powers(href: string): number[] {
  return [...new Set([...fileName(href).matchAll(POWER_RE)].map(m => Number(m[2])))];
}

export function datasheetLinks(urls: readonly string[]): DatasheetLink[] {
  if (urls.length <= 1) return urls.map(href => ({ href, label: LABEL }));
  const all = urls.map(powers);
  // Una potencia que está en todos los nombres (p. ej. «40-80W») no distingue nada
  const own = all.map(ws => ws.filter(w => !all.every(other => other.includes(w))));
  const distinct = own.every(ws => ws.length === 1) && new Set(own.map(ws => ws[0])).size === urls.length;
  if (!distinct) return urls.map((href, i) => ({ href, label: `${LABEL} ${i + 1}` }));
  return urls
    .map((href, i) => ({ href, watts: own[i][0] }))
    .sort((a, b) => a.watts - b.watts)
    .map(({ href, watts }) => ({ href, label: `${LABEL} ${watts}W` }));
}

/** El PDF editorial gana; si no hay, los de Jumpseller. */
export function productDatasheetLinks(editorialUrl: string | undefined, jumpsellerUrls: readonly string[] | undefined): DatasheetLink[] {
  return editorialUrl ? [{ href: editorialUrl, label: LABEL }] : datasheetLinks(jumpsellerUrls ?? []);
}
