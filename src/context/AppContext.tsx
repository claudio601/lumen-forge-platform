import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Product } from '@/data/products';

export interface CartItem { product: Product; quantity: number; }
interface QuoteItem { product: Product; quantity: number; notes?: string; }

interface AppContextType {
  cart: CartItem[];
  addToCart: (product: Product, qty?: number) => void;
  removeFromCart: (id: string) => void;
  updateCartQty: (id: string, qty: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotal: number;
  quoteCart: QuoteItem[];
  addToQuote: (product: Product, qty?: number, notes?: string) => void;
  removeFromQuote: (id: string) => void;
  clearQuote: () => void;
  updateQuoteQty: (id: string, qty: number) => void;
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

  const addToQuote = (product: Product, qty = 1, notes?: string) => {
    setQuoteCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + qty } : i);
      return [...prev, { product, quantity: qty, notes }];
    });
  };
  const removeFromQuote = (id: string) => setQuoteCart(prev => prev.filter(i => i.product.id !== id));
  const clearQuote = () => setQuoteCart([]);
  const updateQuoteQty = (id: string, qty: number) => {
    if (qty <= 0) { removeFromQuote(id); return; }
    setQuoteCart(prev => prev.map(i => i.product.id === id ? { ...i, quantity: qty } : i));
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
