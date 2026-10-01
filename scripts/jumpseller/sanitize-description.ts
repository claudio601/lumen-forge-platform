// scripts/jumpseller/sanitize-description.ts
// Limpia la descripción HTML de un producto de Jumpseller antes de guardarla en el
// repo (público) y mostrarla en el sitio. Lista blanca estricta: se lee con parse5
// (el mismo algoritmo que un navegador) y se vuelve a escribir solo con etiquetas
// de texto y tablas, sin atributos (salvo enlaces https/mailto y colspan/rowspan).
// Lo que no está en la lista se descarta (scripts, estilos, iframes, imágenes…) o
// se "desenvuelve" conservando su texto (span, font, section…).

import { parseFragment } from 'parse5';

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
const BLOCK = new Set(['p', 'div', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article']);

const NBSP = String.fromCharCode(160);
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

function safeHref(value: string): string | null {
  const v = value.trim();
  return /^https:\/\/[^\s<>"]+$/i.test(v) || /^mailto:[^\s<>"]+$/i.test(v) ? v : null;
}

const isElement = (n: ChildNode): n is ElementNode => 'tagName' in n;
const hasBlockChild = (n: ElementNode) => n.childNodes.some(c => isElement(c) && BLOCK.has(c.tagName.toLowerCase()));

function serialize(nodes: ChildNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      out += escText((node as TextNode).value);
      continue;
    }
    if (!isElement(node)) continue; // comentarios
    const original = node.tagName.toLowerCase();
    if (DROP.has(original)) continue;
    // div con bloques adentro se desenvuelve; div con texto pasa a párrafo (sin anidar <p> en <p>)
    const tag = original === 'div' ? (hasBlockChild(node) ? 'unwrap' : 'p') : RENAME[original] ?? original;
    const inner = serialize(node.childNodes);
    if (!ALLOWED.has(tag)) {
      out += inner;
      continue;
    }
    if (tag === 'br') {
      out += '<br>';
      continue;
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

/** HTML limpio y seguro para mostrar; '' si no queda texto. */
export function sanitizeDescription(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  const fragment = parseFragment(html) as unknown as { childNodes: ChildNode[] };
  let out = serialize(fragment.childNodes)
    .split(NBSP).join(' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/(<br>\s*){3,}/g, '<br><br>')
    .replace(/\s*(<br>\s*)+(<\/(?:p|td|th|li|h3|h4|blockquote)>)/g, '$2')
    .replace(/(<(?:p|td|th|li|h3|h4|blockquote)(?: [^>]*)?>)\s*(<br>\s*)+/g, '$1')
    .replace(/<(p|h3|h4|strong|em|u)>\s*<\/\1>/g, '')
    .replace(/\s*(<\/?(?:p|ul|ol|li|table|thead|tbody|tr|th|td|h3|h4|blockquote)(?: [^>]*)?>)\s*/g, '$1')
    .trim();
  // Solo espacios y etiquetas vacías: sin descripción
  if (!out.replace(/<[^>]+>/g, '').trim()) out = '';
  return out;
}

/** Defensa en profundidad: nada ejecutable puede sobrevivir a la limpieza. */
export function unsafeHtmlReasons(html: string): string[] {
  const reasons: string[] = [];
  if (/<\s*(script|style|iframe|object|embed|img|svg|form|input)/i.test(html)) reasons.push('etiqueta no permitida');
  // Solo dentro de las etiquetas: el texto ya va escapado y puede decir "data:" o "style=".
  if (/<[^>]*\son[a-z]+\s*=/i.test(html)) reasons.push('atributo de evento');
  if (/<[^>]*\shref\s*=\s*"(?!https:|mailto:)/i.test(html)) reasons.push('URL no permitida');
  if (/<[^>]*\s(?:style|class|id|src)\s*=/i.test(html)) reasons.push('atributo no permitido');
  return reasons;
}
