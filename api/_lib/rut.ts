// api/_lib/rut.ts
// Dígito verificador del RUT chileno (módulo 11): una sola fuente para el sitio y las funciones
// de api/. src/lib/rut.ts lo reexporta (formularios /cotizacion y /solicitar-pedido) y el bot de
// WhatsApp lo usa para validar el RUT (api/_lib/whatsapp/rutCapture.ts). Mismo patrón que
// api/_lib/site.ts: el código de api/ no importa nada desde src/ (con "type": "module", una
// función que lo hace no carga en Vercel). Sin imports.

/** Dígito verificador (módulo 11) de un cuerpo de solo dígitos: '0' a '9' o 'K'. */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  if (rest === 11) return '0';
  if (rest === 10) return 'K';
  return String(rest);
}
