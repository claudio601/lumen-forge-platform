// src/hooks/useHideWhatsAppButton.ts
// El botón flotante de WhatsApp (src/components/WhatsAppButton.tsx) se esconde mientras se
// ve una confirmación de /cotizacion, /solicitar-pedido o /cotizador (auditoría UX, F-03).
// Regla del dueño (2026-10-17): en las confirmaciones no se ofrece WhatsApp; a quien ya tiene
// una referencia (NE-, RC-, PY-), un WhatsApp le abriría un segundo negocio para la misma
// solicitud. Al salir de la confirmación el botón vuelve.
//
// En el servidor (prerender) y al hidratar, el botón se ve: la confirmación solo aparece
// después de enviar, en el navegador.

import { useEffect, useSyncExternalStore } from 'react';

/** Cuántos componentes montados piden esconder el botón. */
let hiders = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const isHidden = () => hiders > 0;
const shownOnServer = () => false;

/** Esconde el botón flotante de WhatsApp mientras el componente que lo llama está montado. */
export function useHideWhatsAppButton(): void {
  useEffect(() => {
    hiders += 1;
    emit();
    return () => {
      hiders -= 1;
      emit();
    };
  }, []);
}

/** true mientras alguna confirmación pide esconder el botón (lo lee WhatsAppButton). */
export function useWhatsAppButtonHidden(): boolean {
  return useSyncExternalStore(subscribe, isHidden, shownOnServer);
}
