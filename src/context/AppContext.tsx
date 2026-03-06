import React, { createContext, useContext, useState, useCallback } from 'react';
import { Product, CartItem, QuoteItem } from '@/data/products';

interface AppContextType {
  cart: CartItem[];
  quoteItems: QuoteItem[];
  addToCart: (product: Product, qty?: number) => void;
  removeFromCart: (productId: string) => void;
  updateCartQty: (productId: string, qty: number) => void;
  addToQuote: (product: Product, qty?: number) => void;
  removeFromQuote: (productId: string) => void;
  updateQuoteQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  clearQuote: () => void;
  cartTotal: number;
  cartCount: number;
  quoteCount: number;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);

  const addToCart = useCallback((product: Product, qty = 1) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + qty } : i);
      return [...prev, { product, quantity: qty }];
    });
  }, []);

  const removeFromCart = useCallback((id: string) => setCart(p => p.filter(i => i.product.id !== id)), []);
  const updateCartQty = useCallback((id: string, qty: number) => setCart(p => p.map(i => i.product.id === id ? { ...i, quantity: Math.max(1, qty) } : i)), []);

  const addToQuote = useCallback((product: Product, qty = 1) => {
    setQuoteItems(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + qty } : i);
      return [...prev, { product, quantity: qty }];
    });
  }, []);

  const removeFromQuote = useCallback((id: string) => setQuoteItems(p => p.filter(i => i.product.id !== id)), []);
  const updateQuoteQty = useCallback((id: string, qty: number) => setQuoteItems(p => p.map(i => i.product.id === id ? { ...i, quantity: Math.max(1, qty) } : i)), []);

  const clearCart = useCallback(() => setCart([]), []);
  const clearQuote = useCallback(() => setQuoteItems([]), []);

  const cartTotal = cart.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const quoteCount = quoteItems.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <AppContext.Provider value={{ cart, quoteItems, addToCart, removeFromCart, updateCartQty, addToQuote, removeFromQuote, updateQuoteQty, clearCart, clearQuote, cartTotal, cartCount, quoteCount }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
