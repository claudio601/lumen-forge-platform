import { createContext, startTransition, useContext, useState, useEffect, ReactNode } from 'react';
import type { Product } from '@/data/catalog/types';
// Tabla chica y sin imports: este archivo va en el bundle principal (no importar el catálogo)
import { RENAMED_FROM } from '@/data/catalog/renamed-ids';
// Identidad de cada línea: producto + variante (src/lib/quoteLine.ts)
import { quoteItemKey, quoteLineKey } from '@/lib/quoteLine';
import { requestSku } from '@/lib/variantSku';
import { sendEvent } from '@/lib/analytics';
// Tope de unidades por línea, el del servidor (la cantidad ahora se escribe)
import { clampQuantity } from '@/lib/quantity';

// Variante elegida al cotizar. unitPrice es CON IVA (base); displayPrice aplica el toggle
// B2B (÷1,19) al renderizar. variantId y label: la variante de Jumpseller y su etiqueta
// legible (src/lib/variants.ts); cct, la temperatura de color si la opción la trae.
export interface QuoteSelection {
  cct?: number;
  sku: string;
  unitPrice: number;
  variantId?: number;
  label?: string;
}
interface QuoteItem {
  product: Product;
  quantity: number;
  notes?: string;
  cct?: number;
  variantSku?: string;
  unitPrice?: number;
  /** Id de la variante en Jumpseller (las cotizaciones guardadas antes de 2026-10-21 no lo traen). */
  variantId?: number;
  /** Etiqueta legible de la variante: «Cálida 2700K», «80W · Neutra 4000K». */
  variantLabel?: string;
}


interface AppContextType {
  quoteCart: QuoteItem[];
  addToQuote: (product: Product, qty?: number, notes?: string, selection?: QuoteSelection) => void;
  removeFromQuote: (lineKey: string) => void;
  clearQuote: () => void;
  updateQuoteQty: (lineKey: string, qty: number) => void;
  quoteCount: number;
  isB2B: boolean;
  toggleB2B: () => void;
  /** true cuando ya se leyó la sesión (después de montar). */
  loaded: boolean;
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

/**
 * Una cotización guardada antes de renombrar ids (PR 07) guarda el producto con su id
 * viejo: pasa al id vigente y junta las líneas que quedan iguales (si no, el mismo
 * producto agregado otra vez llegaría a Pipedrive en dos líneas).
 */
function withCurrentIds(items: QuoteItem[]): QuoteItem[] {
  if (!Array.isArray(items)) return [];
  const out: QuoteItem[] = [];
  for (const item of items) {
    const current = RENAMED_FROM.get(item?.product?.id ?? '');
    let next = current ? { ...item, product: { ...item.product, id: current } } : item;
    // Línea BESTLED guardada antes del selector genérico (solo con su CCT): toma el id de la
    // variante, para juntarse con la misma variante agregada después.
    if (next?.cct != null && next.variantId == null) {
      const variantId = next.product?.cctVariants?.find(v => v.kelvin === next.cct)?.jumpseller_variant_id;
      if (variantId) next = { ...next, variantId };
    }
    const key = quoteItemKey(next);
    const twin = out.findIndex(i => quoteItemKey(i) === key);
    if (twin >= 0) out[twin] = { ...out[twin], quantity: out[twin].quantity + next.quantity };
    else out.push(next);
  }
  return out;
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
  // La sesión se lee después de montar: así el HTML generado en el servidor
  // (cotización vacía, precios con IVA) coincide con el primer render del navegador.
  // Va en una transición (no urgente): si la página se está hidratando, React termina
  // de hidratar antes de aplicarla, en vez de descartar el HTML del servidor.
  // `loaded` evita que el primer guardado borre lo que había en la sesión.
  const [quoteCart, setQuoteCart] = useState<QuoteItem[]>([]);
  const [isB2B, setIsB2B] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    startTransition(() => {
      setQuoteCart(withCurrentIds(loadFromSession('elights_quote', [])));
      setIsB2B(loadFromSession('elights_b2b', false));
      setLoaded(true);
    });
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
    const key = quoteLineKey(product.id, selection?.cct, selection?.variantId);
    // GA4 (solo con la medición de visitas): un evento por «Cotizar», con el SKU que va en la
    // cotización. No es conversión de Google Ads ni evento de Meta (especificación 4.1, fila 6).
    sendEvent('add_to_quote', { item_id: selection?.sku ?? requestSku(product), quantity: qty });
    setQuoteCart(prev => {
      const existing = prev.find(i => quoteItemKey(i) === key);
      if (existing) return prev.map(i => quoteItemKey(i) === key ? { ...i, quantity: clampQuantity(i.quantity + qty) } : i);
      return [...prev, {
        product, quantity: clampQuantity(qty), notes,
        cct: selection?.cct, variantSku: selection?.sku, unitPrice: selection?.unitPrice,
        ...(selection?.variantId != null ? { variantId: selection.variantId } : {}),
        ...(selection?.label ? { variantLabel: selection.label } : {}),
      }];
    });
  };
  const removeFromQuote = (lineKey: string) => setQuoteCart(prev => prev.filter(i => quoteItemKey(i) !== lineKey));
  const clearQuote = () => setQuoteCart([]);
  const updateQuoteQty = (lineKey: string, qty: number) => {
    if (qty <= 0) { removeFromQuote(lineKey); return; }
    setQuoteCart(prev => prev.map(i => quoteItemKey(i) === lineKey ? { ...i, quantity: clampQuantity(qty) } : i));
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
      isB2B, toggleB2B, displayPrice, formatDisplayPrice, priceLabel, loaded,
    }}>
      {children}
    </AppContext.Provider>
  );
};

// Junto a su proveedor, como useRequestCart en RequestCartContext.
// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
