// src/lib/html.ts

/**
 * Texto plano de un HTML ya limpio (descripciones sincronizadas desde Jumpseller),
 * para los datos estructurados. Corta en `max` caracteres.
 */
export function htmlToText(html: string, max = 5000): string {
  const text = html
    .replace(/<br>/g, ' ')
    .replace(/<\/(?:p|li|tr|td|th|h3|h4|blockquote)>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
