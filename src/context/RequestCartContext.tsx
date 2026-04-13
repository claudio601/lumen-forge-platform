// src/context/RequestCartContext.tsx
// Context y hook para el Request Cart (Solicitud de Pedido).
// Persiste en localStorage. Reutiliza el patron de AppContext.

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { RequestCartItem } from '@/types/request-order';
import { sendEvent } from '@/lib/analytics';

// ── Tipos del contexto ───────────────────────────────────────────────────────
interface RequestCartContextType {
  items: RequestCartItem[];
  addItem: (item: Omit<RequestCartItem, 'quantity'> & { quantity?: number }) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
}

const RequestCartContext = createContext<RequestCartContextType | null>(null);

const STORAGE_KEY = 'elights_request_cart';

function loadFromStorage(): RequestCartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RequestCartItem[]) : [];
  } catch {
    return [];
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────
export const RequestCartProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<RequestCartItem[]>(loadFromStorage);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage lleno o no disponible — silencioso
    }
  }, [items]);

  const addItem = useCallback(
    (incoming: Omit<RequestCartItem, 'quantity'> & { quantity?: number }) => {
      const qty = incoming.quantity ?? 1;
      setItems((prev) => {
        const existing = prev.find((i) => i.productId === incoming.productId);
        if (existing) {
          sendEvent('request_cart_add', {
            sku: incoming.sku,
            quantity: qty,
            unitPrice: incoming.unitPrice,
          });
          return prev.map((i) =>
            i.productId === incoming.productId
              ? { ...i, quantity: i.quantity + qty }
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

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.productId === productId);
      if (item) {
        sendEvent('request_cart_remove', { sku: item.sku });
      }
      return prev.filter((i) => i.productId !== productId);
    });
  }, []);

  const updateQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i))
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const itemCount = items.reduce((s, i) => s + i.quantity, 0);
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  return (
    <RequestCartContext.Provider
      value={{ items, addItem, removeItem, updateQty, clearCart, itemCount, subtotal }}
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
