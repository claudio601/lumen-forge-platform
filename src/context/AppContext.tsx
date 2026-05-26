import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Product } from '@/data/products';

export interface CartItem { product: Product; quantity: number; }
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
  cart: CartItem[];
  addToCart: (product: Product, qty?: number) => void;
  removeFromCart: (id: string) => void;
  updateCartQty: (id: string, qty: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotal: number;
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
  const [cart, setCart] = useState<CartItem[]>(() => loadFromSession('elights_cart', []));
  const [quoteCart, setQuoteCart] = useState<QuoteItem[]>(() => loadFromSession('elights_quote', []));
  const [isB2B, setIsB2B] = useState(() => loadFromSession('elights_b2b', false));

  useEffect(() => { sessionStorage.setItem('elights_cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { sessionStorage.setItem('elights_quote', JSON.stringify(quoteCart)); }, [quoteCart]);
  useEffect(() => { sessionStorage.setItem('elights_b2b', JSON.stringify(isB2B)); }, [isB2B]);

  const addToCart = (product: Product, qty = 1) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + qty } : i);
      return [...prev, { product, quantity: qty }];
    });
  };
  const removeFromCart = (id: string) => setCart(prev => prev.filter(i => i.product.id !== id));
  const updateCartQty = (id: string, qty: number) => {
    if (qty <= 0) { removeFromCart(id); return; }
    setCart(prev => prev.map(i => i.product.id === id ? { ...i, quantity: qty } : i));
  };
  const clearCart = () => setCart([]);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);

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
      cart, addToCart, removeFromCart, updateCartQty, clearCart, cartCount, cartTotal,
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
