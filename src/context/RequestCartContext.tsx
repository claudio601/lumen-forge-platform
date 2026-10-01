// src/context/RequestCartContext.tsx
// Context y hook para el Request Cart (Solicitud de Pedido).
// Persiste en sessionStorage (estado de UI, no debe sobrevivir entre sesiones).
// Reutiliza el patron de AppContext.

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { RequestCartItem } from '@/types/request-order';
import { sendEvent } from '@/lib/analytics';
import { requestLineKey } from '@/lib/requestOrder';
import { useIsomorphicLayoutEffect } from '@/lib/ssr';

// ── Tipos del contexto ───────────────────────────────────────────────────────
interface RequestCartContextType {
  items: RequestCartItem[];
  addItem: (item: Omit<RequestCartItem, 'quantity'> & { quantity?: number }) => void;
  /** lineKey = requestLineKey(item): producto + variante. */
  removeItem: (lineKey: string) => void;
  updateQty: (lineKey: string, qty: number) => void;
  clearCart: () => void;
  /** Reemplaza el carrito completo (p. ej. tras ponerlo al día con el catálogo). */
  replaceItems: (items: RequestCartItem[]) => void;
  itemCount: number;
  subtotal: number;
  /** true cuando ya se leyó el carrito guardado en la sesión (después de montar). */
  loaded: boolean;
}

const RequestCartContext = createContext<RequestCartContextType | null>(null);

const STORAGE_KEY = 'elights_request_cart';

function loadFromStorage(): RequestCartItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RequestCartItem[]) : [];
  } catch {
    return [];
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────
export const RequestCartProvider = ({ children }: { children: ReactNode }) => {
  // El carrito guardado se lee después de montar (antes de pintar), para que el HTML
  // generado en el servidor coincida con el primer render del navegador.
  const [items, setItems] = useState<RequestCartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useIsomorphicLayoutEffect(() => {
    setItems(loadFromStorage());
    setLoaded(true);
  }, []);

  // Limpieza única: el request-cart vivía en localStorage y arrastraba snapshots
  // viejos (precios congelados pre-refactor) entre sesiones. El estado de UI ahora
  // es de sesión; eliminamos la key legacy de localStorage para que no resucite stale.
  useEffect(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!loaded) return; // sin esto, el carrito vacío inicial borraría el guardado
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage lleno o no disponible — silencioso
    }
  }, [items, loaded]);

  const addItem = useCallback(
    (incoming: Omit<RequestCartItem, 'quantity'> & { quantity?: number }) => {
      const qty = incoming.quantity ?? 1;
      setItems((prev) => {
        const key = requestLineKey(incoming);
        const existing = prev.find((i) => requestLineKey(i) === key);
        if (existing) {
          sendEvent('request_cart_add', {
            sku: incoming.sku,
            quantity: qty,
            unitPrice: incoming.unitPrice,
          });
          // Misma línea: suma cantidad y toma el precio vigente del catálogo.
          return prev.map((i) =>
            requestLineKey(i) === key
              ? { ...i, quantity: i.quantity + qty, unitPrice: incoming.unitPrice, priceMode: incoming.priceMode }
              : i
          );
        }
        sendEvent('request_cart_add', {
          sku: incoming.sku,
          quantity: qty,
          unitPrice: incoming.unitPrice,
        });
        return [...prev, { ...incoming, quantity: qty }];
      });
    },
    []
  );

  const removeItem = useCallback((lineKey: string) => {
    setItems((prev) => {
      const item = prev.find((i) => requestLineKey(i) === lineKey);
      if (item) {
        sendEvent('request_cart_remove', { sku: item.sku });
      }
      return prev.filter((i) => requestLineKey(i) !== lineKey);
    });
  }, []);

  const updateQty = useCallback((lineKey: string, qty: number) => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((i) => requestLineKey(i) !== lineKey));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (requestLineKey(i) === lineKey ? { ...i, quantity: qty } : i))
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);
  const replaceItems = useCallback((next: RequestCartItem[]) => setItems(next), []);

  const itemCount = items.reduce((s, i) => s + i.quantity, 0);
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  return (
    <RequestCartContext.Provider
      value={{ items, addItem, removeItem, updateQty, clearCart, replaceItems, itemCount, subtotal, loaded }}
    >
      {children}
    </RequestCartContext.Provider>
  );
};

// ── Hook ─────────────────────────────────────────────────────────────────────
export const useRequestCart = () => {
  const ctx = useContext(RequestCartContext);
  if (!ctx) throw new Error('useRequestCart must be used within RequestCartProvider');
  return ctx;
};
