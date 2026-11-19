// api/_lib/shipping/productName.ts
// Nombre del producto en el aviso de despacho (dueño, 18-11-2026): Jumpseller escribe casi todos
// los nombres en MAYÚSCULAS; el aviso los muestra con mayúscula inicial, como los avisos del Nivel 1
// («Alumbrado público BESTLED 40W IP66 IK08 – neutra 4000K»). Se aplica al mostrar: el generado
// (product-links) guarda el nombre tal cual. El texto que escribe el dueño en «Despacho ·
// Productos» (« — texto») no pasa por aquí: va como lo escribió.
//
// Regla, palabra por palabra:
// - una palabra con dígitos queda igual (40W, IP66, IK08, 4000K, 2X18W, 60LEDs/m, Ø48MM);
// - en las demás, cada tramo de letras (los separa «/», «-», «.», paréntesis) va en minúscula,
//   salvo las siglas y marcas de ACRONYMS (en mayúsculas) y las de SPECIAL (con su forma fija);
// - «C/» es «con» y, si el nombre lleva otro «C/», ese es «y» («C/PANEL SOLAR C/CONTROL REMOTO»
//   → «con panel solar y control remoto»);
// - la primera letra del nombre va en mayúscula (salvo que empiece con una sigla o un número).
// La etiqueta de la variante va entera en minúscula, con la misma regla y sin mayúscula inicial
// («Neutra 4000K» → «neutra 4000K»; «RGB» sigue «RGB»).
// Las listas salen de los 323 nombres del catálogo del 18-11-2026; productName.test.ts falla si
// aparece una palabra en mayúsculas que no está clasificada (aquí o en su lista de palabras comunes).
// Sin imports; la carpeta _lib hace que Vercel no lo despliegue como función.

/** Siglas y marcas que van en mayúsculas. */
export const ACRONYMS: ReadonlySet<string> = new Set([
  'LED', // diodo emisor de luz
  'SMD', // montaje superficial
  'COB', // chip on board
  'RGB', // rojo, verde y azul
  'PIR', // sensor infrarrojo pasivo
  'UFO', // campana UFO
  'PRO', // UFO PRO HL (modelo)
  'HL', // UFO PRO HL (modelo)
  'BESTLED', // línea de alumbrado público (así en las fichas)
  'PMMA', // acrílico
  'ATEX', // certificación para atmósferas explosivas
  'I', // «clase I» (número romano)
]);

/** Palabras con una forma fija que no es solo mayúsculas ni solo minúsculas (clave en mayúsculas). */
export const SPECIAL: ReadonlyMap<string, string> = new Map([
  ['ELIGHTS', 'eLIGHTS'],
  ['LEDS', 'LEDs'],
  ['W', 'W'], // vatio, en «LM/W»
  ['DIV', 'Div'], // «clase I Div. 2»
  ['BRIDGELUX', 'Bridgelux'], // marca del chip
  ['FLYHAWK', 'FlyHawk'], // modelo de alumbrado solar
  ['VITO', 'Vito'], // modelo de alumbrado solar
  ['FREYA', 'Freya'], // modelo de farol
]);

const LOCALE = 'es-CL';
const LETTERS = /\p{L}+/gu;
const WITH_LETTER = /\p{L}/u;

/** Un tramo de letras: sigla, forma fija o minúscula. */
function casePart(part: string): string {
  const upper = part.toLocaleUpperCase(LOCALE);
  if (ACRONYMS.has(upper)) return upper;
  return SPECIAL.get(upper) ?? part.toLocaleLowerCase(LOCALE);
}

/** Una palabra (separada por espacios). `true` en `kept`: quedó como sigla, forma fija o con dígitos. */
function caseWord(word: string): { text: string; kept: boolean } {
  if (/\d/.test(word)) return { text: word, kept: true };
  const text = word.replace(LETTERS, casePart);
  const letters = word.match(LETTERS) ?? [];
  const first = letters[0]?.toLocaleUpperCase(LOCALE);
  return { text, kept: Boolean(first && (ACRONYMS.has(first) || SPECIAL.has(first))) };
}

/** «C/» (con o sin espacio después) → «con» la primera vez e «y» las siguientes. */
function expandWith(words: string[]): string[] {
  let seen = 0;
  const out: string[] = [];
  for (const w of words) {
    const m = /^[cC]\/(.*)$/.exec(w);
    if (!m) {
      out.push(w);
      continue;
    }
    out.push(seen++ === 0 ? 'con' : 'y');
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Nombre del catálogo para mostrar: «PANEL LED SLIM 60X60 CM. 48W» → «Panel LED slim 60X60 cm. 48W». */
export function displayProductName(name: string): string {
  const words = expandWith(name.trim().split(/\s+/).filter(Boolean));
  return words
    .map((w, i) => {
      const { text, kept } = caseWord(w);
      return i === 0 && !kept ? text.replace(WITH_LETTER, (c) => c.toLocaleUpperCase(LOCALE)) : text;
    })
    .join(' ');
}

/** Etiqueta de la variante para mostrar, en minúscula: «Neutra 4000K» → «neutra 4000K»; «40W · Ámbar 2200K» → «40W · ámbar 2200K». */
export function displayVariantLabel(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => caseWord(w).text)
    .join(' ');
}
