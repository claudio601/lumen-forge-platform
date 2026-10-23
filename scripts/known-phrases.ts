// scripts/known-phrases.ts
// Frases que la regla de contenido de check-prerender (findPolicyBreaking: stock o plazos de
// despacho distintos de "hasta 2 días hábiles") marca, pero que son correctas en esa página:
// check-prerender las informa sin bloquear y src/pages/legal.test.tsx las acepta. Sin
// dependencias, para que también lo importen las pruebas del navegador.

/**
 * Frases que la regla marca pero son correctas en esa página: se informan, sin bloquear.
 * Cada una con su motivo.
 */
export const KNOWN_PHRASES: { routes: string[]; phrase: RegExp; reason: string }[] = [
  {
    routes: ['/', '/estudio-luminico'],
    phrase: /^entrega en 48 horas$/i,
    reason: 'plazo del informe del estudio DIALux, no de despacho; confirmado por el dueño el 2026-10-03',
  },
  {
    routes: ['/politica-de-privacidad'],
    phrase: /^envío no se completa, a más tardar en 48 horas$/i,
    reason:
      'plazo de borrado de los archivos adjuntos cuando el envío del formulario no se completa (Política 1.6, §7), no de despacho; texto de la especificación «Adjuntar archivos» aprobada por el dueño el 2026-10-22',
  },
];
