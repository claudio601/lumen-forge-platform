// src/lib/searchMailto.ts
// Correo prellenado a ventas cuando no se encuentra un producto (auditoría UX, B-04 y B-10): lo
// usan /buscar sin resultados y la página 404. Sin el índice de búsqueda: la 404 va también en el
// trozo de las guías y del catálogo. Contacto solo por correo: el WhatsApp prellenado queda para
// después de la marcha blanca del bot.

import { contactEmail } from '@/config/business';

/** Largo máximo de la consulta en el correo prellenado, en caracteres. */
const MAIL_QUERY_MAX = 120;

/** Medio par sustituto (UTF-16) sin su otra mitad: encodeURIComponent no lo acepta. */
const isLoneSurrogate = (ch: string) => ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff;

/** Correo prellenado a ventas: asunto «Busco: {consulta}» y el mismo texto en el cuerpo. */
export function searchRequestMailto(query: string): string {
  // Se corta por caracteres, no por unidades UTF-16: un emoji partido en la posición 120 haría
  // fallar encodeURIComponent, y la página quedaría en blanco.
  const chars = Array.from(query.trim().replace(/\s+/g, ' ')).filter(ch => !isLoneSurrogate(ch));
  const q = chars.slice(0, MAIL_QUERY_MAX).join('');
  const subject = `Busco: ${q}`;
  const body = `Hola, busco: ${q}\r\n\r\nCantidad aproximada:\r\nComuna de despacho:\r\n`;
  return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
