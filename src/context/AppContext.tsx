import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Product } from '@/data/catalog/types';
import { useIsomorphicLayoutEffect } from '@/lib/ssr';

// Selección de variante de color al cotizar. unitPrice es CON IVA (base);
// displayPrice aplica el toggle B2B (÷1,19) al renderizar.
export interface QuoteSelection { cct: number; sku: string; unitPrice: number; }
interface QuoteItem {
  product: Product;
  quantity: number;
  notes?: string;
  cct?: number;
  variantSku?: string;
  unitPrice?: number;
}

// Identidad de línea de cotización: un mismo producto en dos CCT distintas
// son líneas separadas.
export const quoteLineKey = (productId: string, cct?: number) => `${productId}::${cct ?? ''}`;

interface AppContextType {
  quoteCart: QuoteItem[];
  addToQuote: (product: Product, qty?: number, notes?: string, selection?: QuoteSelection) => void;
  removeFromQuote: (lineKey: string) => void;
  clearQuote: () => void;
  updateQuoteQty: (lineKey: string, qty: number) => void;
  quoteCount: number;
  isB2B: boolean;
  toggleB2B: () => void;
  displayPrice: (price: number) => number;
  formatDisplayPrice: (price: number) => string;
  priceLabel: string;
}

const AppContext = createContext<AppContextType | null>(null);

function loadFromSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
  // La sesión se lee después de montar (antes de pintar): así el HTML generado en el
  // servidor (cotización vacía, precios con IVA) coincide con el primer render del
  // navegador. `loaded` evita que el primer guardado borre lo que había en la sesión.
  const [quoteCart, setQuoteCart] = useState<QuoteItem[]>([]);
  const [isB2B, setIsB2B] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useIsomorphicLayoutEffect(() => {
    setQuoteCart(loadFromSession('elights_quote', []));
    setIsB2B(loadFromSession('elights_b2b', false));
    setLoaded(true);
  }, []);

  // El carro viejo (checkout en Jumpseller) se eliminó: limpiar su estado de la sesión.
  useEffect(() => { try { sessionStorage.removeItem('elights_cart'); } catch { /* sin storage */ } }, []);
  useEffect(() => {
    if (!loaded) return;
    try { sessionStorage.setItem('elights_quote', JSON.stringify(quoteCart)); } catch { /* sin storage */ }
  }, [quoteCart, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { sessionStorage.setItem('elights_b2b', JSON.stringify(isB2B)); } catch { /* sin storage */ }
  }, [isB2B, loaded]);

  const addToQuote = (product: Product, qty = 1, notes?: string, selection?: QuoteSelection) => {
    const key = quoteLineKey(product.id, selection?.cct);
    setQuoteCart(prev => {
      const existing = prev.find(i => quoteLineKey(i.product.id, i.cct) === key);
      if (existing) return prev.map(i => quoteLineKey(i.product.id, i.cct) === key ? { ...i, quantity: i.quantity + qty } : i);
      return [...prev, { product, quantity: qty, notes, cct: selection?.cct, variantSku: selection?.sku, unitPrice: selection?.unitPrice }];
    });
  };
  const removeFromQuote = (lineKey: string) => setQuoteCart(prev => prev.filter(i => quoteLineKey(i.product.id, i.cct) !== lineKey));
  const clearQuote = () => setQuoteCart([]);
  const updateQuoteQty = (lineKey: string, qty: number) => {
    if (qty <= 0) { removeFromQuote(lineKey); return; }
    setQuoteCart(prev => prev.map(i => quoteLineKey(i.product.id, i.cct) === lineKey ? { ...i, quantity: qty } : i));
  };
  const quoteCount = quoteCart.reduce((s, i) => s + i.quantity, 0);

  const toggleB2B = () => setIsB2B(v => !v);
  const displayPrice = (price: number) => isB2B ? Math.round(price / 1.19) : price;
  const formatDisplayPrice = (price: number) => {
    const p = displayPrice(price);
    return `$${p.toLocaleString('es-CL')}`;
  };
  const priceLabel = isB2B ? 'Precio neto (sin IVA)' : 'Precio c/IVA';

  return (
    <AppContext.Provider value={{
      quoteCart, addToQuote, removeFromQuote, clearQuote, updateQuoteQty, quoteCount,
      isB2B, toggleB2B, displayPrice, formatDisplayPrice, priceLabel,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
