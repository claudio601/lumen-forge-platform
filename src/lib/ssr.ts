// src/lib/ssr.ts
// Utilidades para que la app se pueda renderizar en el servidor (páginas estáticas,
// Etapa 2) y luego "hidratar" en el navegador sin diferencias.

import { useEffect, useLayoutEffect } from 'react';

/**
 * useLayoutEffect en el navegador (corre antes de pintar, sin parpadeo) y useEffect
 * en el servidor, donde React no ejecuta efectos y avisaría por useLayoutEffect.
 */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
