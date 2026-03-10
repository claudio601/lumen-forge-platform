import { Link } from 'react-router-dom';
import { Trash2, ShoppingBag, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';

const CartPage = () => {
  const { cart, removeFromCart, updateCartQty, cartTotal, clearCart, isB2B, formatDisplayPrice, priceLabel } = useApp();

  if (cart.length === 0) {
    return (
      <div className="container py-16 text-center">
        <ShoppingBag className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Tu carro esta vacio</h2>
        <p className="text-muted-foreground mb-6">Agrega productos desde el catalogo</p>
        <Button asChild><Link to="/catalogo">Ver catalogo</Link></Button>
      </div>
    );
  }

  const netTotal = Math.round(cartTotal / 1.19);
  const iva = cartTotal - netTotal;

  return (
    <div className="container py-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Carro de compras</h1>
      <div className="space-y-4 mb-8">
        {cart.map(({ product, quantity }) => (
          <div key={product.id} className="flex items-center gap-4 p-4 border rounded-xl bg-surface">
            {product.image && (
              <img src={product.image} alt={product.name} className="w-16 h-16 object-contain rounded-lg bg-white shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{product.name}</p>
              <p className="text-xs text-muted-foreground">{product.sku}</p>
              <p className="text-sm font-semibold text-primary mt-1">{formatDisplayPrice(product.price)}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => updateCartQty(product.id, quantity - 1)} className="w-7 h-7 rounded-md border flex items-center justify-center hover:bg-accent text-sm font-bold">-</button>
              <span className="w-8 text-center text-sm font-medium">{quantity}</span>
              <button onClick={() => updateCartQty(product.id, quantity + 1)} className="w-7 h-7 rounded-md border flex items-center justify-center hover:bg-accent text-sm font-bold">+</button>
            </div>
            <p className="w-24 text-right font-semibold text-sm shrink-0">{formatDisplayPrice(product.price * quantity)}</p>
            <button onClick={() => removeFromCart(product.id)} className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-lg transition-colors shrink-0">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="border rounded-xl p-6 bg-surface max-w-sm ml-auto">
        <h3 className="font-semibold mb-4">Resumen</h3>
        {isB2B ? (
          <>
            <div className="flex justify-between text-sm mb-1"><span>Subtotal neto</span><span>{formatDisplayPrice(cartTotal)}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground mb-3"><span>IVA (19%)</span><span>+${iva.toLocaleString('es-CL')}</span></div>
            <div className="flex justify-between font-bold border-t pt-3"><span>Total c/IVA</span><span>${cartTotal.toLocaleString('es-CL')}</span></div>
          </>
        ) : (
          <div className="flex justify-between font-bold border-t pt-3"><span>Total</span><span>{formatDisplayPrice(cartTotal)}</span></div>
        )}
        <p className="text-xs text-muted-foreground mt-1 mb-4">{priceLabel}</p>

        <div className="space-y-2">
          {cart.map(({ product }) => (
            <a key={product.id} href={`https://elights.cl/products/${product.permalink || product.sku.toLowerCase()}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between text-xs text-primary hover:underline">
              <span className="truncate">{product.name}</span>
              <ExternalLink className="h-3 w-3 shrink-0 ml-1" />
            </a>
          ))}
        </div>

        <a href="https://elights.cl" target="_blank" rel="noopener noreferrer">
          <Button className="w-full mt-4 gap-2">
            <ExternalLink className="h-4 w-4" />
            Ir a comprar en eLights
          </Button>
        </a>
        <button onClick={clearCart} className="w-full mt-2 text-xs text-muted-foreground hover:text-destructive transition-colors">
          Vaciar carro
        </button>
      </div>
    </div>
  );
};

export default CartPage;
