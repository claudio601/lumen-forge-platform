// src/context/RequestCartContext.tsx
// Context y hook para el Request Cart (Solicitud de Pedido).
// Persiste en sessionStorage (estado de UI, no debe sobrevivir entre sesiones).
// Reutiliza el patron de AppContext.
// Cada línea guarda su precio CON IVA del catálogo; el neto del modo empresa se calcula al
// mostrar. Así el total nunca suma precios con IVA y netos (auditoría UX, F-01).

import { createContext, startTransition, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { RequestCartItem } from '@/types/request-order';
import { sendEvent } from '@/lib/analytics';
import { normalizeStoredLine, requestLineKey, requestTotals } from '@/lib/requestOrder';

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
  /** Total CON IVA (precios del catálogo). */
  subtotal: number;
  /** Total neto (sin IVA), sumado línea por línea como se muestra en modo empresa. */
  netSubtotal: number;
  /** true cuando ya se leyó el carrito guardado en la sesión (después de montar). */
  loaded: boolean;
}

const RequestCartContext = createContext<RequestCartContextType | null>(null);

const STORAGE_KEY = 'elights_request_cart';

function loadFromStorage(): RequestCartItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const items = raw ? (JSON.parse(raw) as RequestCartItem[]) : [];
    // Líneas guardadas en modo neto antes del 2026-10-17: pasan a CON IVA
    return Array.isArray(items) ? items.map(normalizeStoredLine) : [];
  } catch {
    return [];
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────
export const RequestCartProvider = ({ children }: { children: ReactNode }) => {
  // El carrito guardado se lee después de montar, para que el HTML generado en el
  // servidor coincida con el primer render del navegador. En una transición (no
  // urgente): durante la hidratación React termina de hidratar antes de aplicarlo.
  // Un producto agregado antes de que termine la carga se suma al carrito guardado
  // (React reaplica las actualizaciones en orden sobre la carga).
  const [items, setItems] = useState<RequestCartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    startTransition(() => {
      setItems(loadFromStorage());
      setLoaded(true);
    });
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
    (added: Omit<RequestCartItem, 'quantity'> & { quantity?: number }) => {
      const incoming = normalizeStoredLine(added);
      const qty = incoming.quantity ?? 1;
      setItems((prev) => {
        const key = requestLineKey(incoming);
        const existing = prev.find((i) => requestLineKey(i) === key);
        if (existing) {
          sendEvent('request_cart_add', {
            item_id: incoming.sku,
            quantity: qty,
            unit_price: incoming.unitPrice,
          });
          // Misma línea: suma cantidad y toma el precio vigente del catálogo.
          return prev.map((i) =>
            requestLineKey(i) === key
              ? { ...i, quantity: i.quantity + qty, unitPrice: incoming.unitPrice }
              : i
          );
        }
        sendEvent('request_cart_add', {
          item_id: incoming.sku,
          quantity: qty,
          unit_price: incoming.unitPrice,
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
        sendEvent('request_cart_remove', { item_id: item.sku });
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
  const { gross: subtotal, net: netSubtotal } = requestTotals(items);

  return (
    <RequestCartContext.Provider
      value={{ items, addItem, removeItem, updateQty, clearCart, replaceItems, itemCount, subtotal, netSubtotal, loaded }}
    >
      {children}
    </RequestCartContext.Provider>
  );
};

// ── Hook ─────────────────────────────────────────────────────────────────────
// Junto a su proveedor, como useApp en AppContext (al editar este archivo, Fast Refresh
// recarga la página completa).
// eslint-disable-next-line react-refresh/only-export-components
export const useRequestCart = () => {
  const ctx = useContext(RequestCartContext);
  if (!ctx) throw new Error('useRequestCart must be used within RequestCartProvider');
  return ctx;
};
