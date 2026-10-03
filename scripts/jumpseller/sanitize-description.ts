// scripts/jumpseller/sanitize-description.ts
// Limpia la descripción HTML de un producto de Jumpseller antes de guardarla en el
// repo (público) y mostrarla en el sitio. Lista blanca estricta: se lee con parse5
// en el mismo contexto que usa el navegador (un <div>, como dangerouslySetInnerHTML)
// y se vuelve a escribir solo con etiquetas de texto y tablas, sin atributos (salvo
// enlaces https/mailto y colspan/rowspan). Lo que no está en la lista se descarta
// (scripts, estilos, iframes, imágenes…) o se "desenvuelve" conservando su texto
// (span, font, section…). El resultado tiene que leerse igual en el navegador:
// roundTripsInBrowser() lo verifica y la sincronización omite lo que no cumpla.

import { defaultTreeAdapter, html as parse5Html, parseFragment, serialize as serializeHtml } from 'parse5';

interface TextNode { nodeName: '#text'; value: string }
interface ElementNode { nodeName: string; tagName: string; attrs: { name: string; value: string }[]; childNodes: ChildNode[] }
type ChildNode = TextNode | ElementNode | { nodeName: '#comment' | '#documentType' };

const ALLOWED = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'a']);
const RENAME: Record<string, string> = { b: 'strong', i: 'em', h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4', tfoot: 'tbody' };
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'object', 'embed', 'img', 'picture', 'svg', 'math', 'form', 'input', 'button',
  'select', 'textarea', 'noscript', 'template', 'video', 'audio', 'source', 'track', 'link', 'meta', 'head', 'title',
  'canvas', 'map', 'area', 'base', 'dialog',
]);
/** Bloques ya escritos: lo que los contenga no puede ser un <p> ni un elemento en línea. */
const BLOCK_OUT = /<(?:p|ul|ol|li|table|h3|h4|blockquote)\b/;
const INLINE = new Set(['strong', 'em', 'u', 'a']);
/** Filas de la tabla de Jumpseller que repiten (y a veces contradicen) el título y el SKU de la página. */
const REDUNDANT_ROW = /^\s*(?:nombre(?: del producto)?|sku)\s*:?\s*$/i;

const NBSP = String.fromCharCode(160);
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

function safeHref(value: string): string | null {
  const v = value.trim();
  return /^https:\/\/[^\s<>"]+$/i.test(v) || /^mailto:[^\s<>"]+$/i.test(v) ? v : null;
}

const isElement = (n: ChildNode): n is ElementNode => 'tagName' in n;
const tagOf = (n: ElementNode) => n.tagName.toLowerCase();
const textOf = (n: ChildNode): string =>
  n.nodeName === '#text' ? (n as TextNode).value : isElement(n) ? n.childNodes.map(textOf).join('') : '';
const hasText = (htmlString: string) => !!htmlString.replace(/<[^>]+>/g, '').trim();

/** Ninguna descripción real se acerca a esto; más es basura o un intento de colgar la sincronización. */
const MAX_DEPTH = 200;

function write(nodes: ChildNode[], depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error(`descripción anidada más de ${MAX_DEPTH} niveles`);
  let out = '';
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      out += escText((node as TextNode).value);
      continue;
    }
    if (!isElement(node)) continue; // comentarios
    const original = tagOf(node);
    if (DROP.has(original)) continue;
    if (original === 'caption') continue; // va como párrafo antes de su tabla (ver 'table')
    if (original === 'tr') {
      const firstCell = node.childNodes.find(c => isElement(c) && (tagOf(c) === 'td' || tagOf(c) === 'th'));
      if (firstCell && REDUNDANT_ROW.test(textOf(firstCell))) continue;
    }
    const inner = write(node.childNodes, depth + 1);
    // div con bloques adentro (aunque estén dentro de un span o font) se desenvuelve; si no, es un párrafo
    let tag = original === 'div' ? (BLOCK_OUT.test(inner) ? 'unwrap' : 'p') : RENAME[original] ?? original;
    // un elemento en línea o un párrafo que envuelve bloques también se desenvuelve (el navegador los separaría)
    if ((INLINE.has(tag) || tag === 'p') && BLOCK_OUT.test(inner)) tag = 'unwrap';
    if (!ALLOWED.has(tag)) {
      out += inner;
      continue;
    }
    if (tag === 'br') {
      out += '<br>';
      continue;
    }
    if (tag === 'table') {
      const caption = node.childNodes.find(c => isElement(c) && tagOf(c) === 'caption') as ElementNode | undefined;
      const captionText = caption ? write(caption.childNodes, depth + 1) : '';
      if (hasText(captionText) && !BLOCK_OUT.test(captionText)) out += `<p>${captionText}</p>`;
      if (!hasText(inner)) continue; // tabla vacía (p. ej. solo tenía filas redundantes)
    }
    let attrs = '';
    if (tag === 'a') {
      const href = node.attrs.find(a => a.name === 'href');
      const safe = href ? safeHref(href.value) : null;
      if (!safe) {
        out += inner;
        continue;
      }
      attrs = ` href="${escAttr(safe)}" rel="noopener noreferrer nofollow" target="_blank"`;
    }
    if (tag === 'td' || tag === 'th') {
      for (const a of node.attrs) if ((a.name === 'colspan' || a.name === 'rowspan') && /^[1-9]\d?$/.test(a.value)) attrs += ` ${a.name}="${a.value}"`;
    }
    out += `<${tag}${attrs}>${inner}</${tag}>`;
  }
  return out;
}

/** Lee el HTML como lo hace el navegador al asignarlo a un <div> (dangerouslySetInnerHTML). */
function parseLikeBrowser(input: string) {
  const context = defaultTreeAdapter.createElement('div', parse5Html.NS.HTML, []);
  return parseFragment(context, input, {});
}

function sanitizeOnce(input: string): string {
  const fragment = parseLikeBrowser(input) as unknown as { childNodes: ChildNode[] };
  let out = write(fragment.childNodes)
    .split(NBSP).join(' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/(<br>\s*){3,}/g, '<br><br>')
    .replace(/\s*(<br>\s*)+(<\/(?:p|td|th|li|h3|h4|blockquote)>)/g, '$2')
    .replace(/(<(?:p|td|th|li|h3|h4|blockquote)(?: [^>]*)?>)\s*(<br>\s*)+/g, '$1')
    .replace(/<(p|h3|h4|strong|em|u)>\s*<\/\1>/g, '')
    .replace(/\s*(<\/?(?:p|ul|ol|li|table|thead|tbody|tr|th|td|h3|h4|blockquote)(?: [^>]*)?>)\s*/g, '$1')
    .trim();
  // Solo espacios y etiquetas vacías: sin descripción
  if (!hasText(out)) out = '';
  return out;
}

/** HTML limpio y seguro para mostrar; '' si no queda texto. Estable: limpiarlo de nuevo no lo cambia. */
export function sanitizeDescription(input: string | null | undefined): string {
  if (!input || !input.trim()) return '';
  let out = sanitizeOnce(input);
  for (let i = 0; i < 3; i++) {
    const again = sanitizeOnce(out);
    if (again === out) break;
    out = again;
  }
  return out;
}

/** true si el navegador lee este HTML y lo vuelve a escribir igual (sin correcciones de anidamiento). */
export function roundTripsInBrowser(htmlString: string): boolean {
  return serializeHtml(parseLikeBrowser(htmlString)) === htmlString;
}

/** Defensa en profundidad: nada ejecutable puede sobrevivir a la limpieza. */
export function unsafeHtmlReasons(htmlString: string): string[] {
  const reasons: string[] = [];
  if (/<\s*(script|style|iframe|object|embed|img|svg|form|input)/i.test(htmlString)) reasons.push('etiqueta no permitida');
  // Solo dentro de las etiquetas: el texto ya va escapado y puede decir "data:" o "style=".
  if (/<[^>]*\son[a-z]+\s*=/i.test(htmlString)) reasons.push('atributo de evento');
  if (/<[^>]*\shref\s*=\s*"(?!https:|mailto:)/i.test(htmlString)) reasons.push('URL no permitida');
  if (/<[^>]*\s(?:style|class|id|src)\s*=/i.test(htmlString)) reasons.push('atributo no permitido');
  return reasons;
}

/**
 * Lo que queda vacío al sacar las tablas del texto: viñetas y listas vacías, y subtítulos
 * huérfanos (seguidos de otro subtítulo o al final, como el "Especificaciones" de la tabla).
 */
function dropEmptyLeftovers(htmlString: string): string {
  let out = htmlString;
  for (let i = 0; i < 5; i++) {
    const next = out
      .replace(/<(p|h3|h4|strong|em|u|li|blockquote)>\s*<\/\1>/g, '')
      .replace(/<(ul|ol)>\s*<\/\1>/g, '')
      .replace(/<(h3|h4)>(?:(?!<\/?h[34]>).)*<\/\1>(?=\s*(?:<h[34]>|$))/g, '');
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

/** Texto mínimo (sin etiquetas) para considerar que hay una descripción: menos es un rótulo suelto. */
const MIN_TEXT = 40;

/**
 * Separa una descripción ya limpia en sus tablas (las especificaciones técnicas: la
 * mayoría de los productos solo traen eso) y el resto del texto (la descripción
 * propiamente tal). Un texto de menos de MIN_TEXT caracteres, como
 * "Especificaciones técnicas:", se descarta.
 */
export function splitDescription(htmlString: string): { text: string; specs: string } {
  const tables: string[] = [];
  let text = '';
  let depth = 0;
  let start = 0;
  let last = 0;
  for (const m of htmlString.matchAll(/<\/?table>/g)) {
    if (m[0] === '<table>') {
      if (depth === 0) {
        text += htmlString.slice(last, m.index);
        start = m.index!;
      }
      depth++;
    } else if (depth > 0 && --depth === 0) {
      last = m.index! + m[0].length;
      tables.push(htmlString.slice(start, last));
    }
  }
  if (depth > 0) {
    // Tabla sin cerrar (no debería pasar: parse5 siempre las cierra): todo lo que sigue es especificación
    tables.push(htmlString.slice(start));
    last = htmlString.length;
  }
  text = dropEmptyLeftovers(text + htmlString.slice(last));
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { text: plain.length >= MIN_TEXT ? text : '', specs: tables.join('') };
}
