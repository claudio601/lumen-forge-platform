import { useApp } from '@/context/AppContext';
import { formatCLP } from '@/data/products';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, ShoppingCart, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';

const CartPage = () => {
  const { cart, updateCartQty, removeFromCart, cartTotal, clearCart } = useApp();

  if (cart.length === 0) {
    return (
      <div className="container py-16 text-center">
        <ShoppingCart className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Tu carro está vacío</h1>
        <p className="text-muted-foreground mb-6">Explora nuestro catálogo y agrega productos</p>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/catalogo">Ver catálogo</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <Link to="/catalogo" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Seguir comprando
      </Link>
      <h1 className="text-2xl font-bold mb-6">Carro de compras</h1>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-3">
          {cart.map(item => (
            <div key={item.product.id} className="border rounded-xl p-4 flex gap-4 items-center">
              <div className="h-16 w-16 bg-surface rounded-lg flex items-center justify-center shrink-0">
                <Zap className="h-8 w-8 text-primary/20" />
              </div>
              <div className="flex-1 min-w-0">
                <Link to={`/producto/${item.product.id}`} className="font-semibold text-sm hover:text-primary transition-colors line-clamp-1">
                  {item.product.name}
                </Link>
                <p className="text-xs text-muted-foreground font-mono">{item.product.sku}</p>
              </div>
              <div className="flex items-center border rounded-lg">
                <button className="p-1.5 hover:bg-accent transition-colors" onClick={() => updateCartQty(item.product.id, item.quantity - 1)}><Minus className="h-3 w-3" /></button>
                <span className="px-3 text-sm font-semibold">{item.quantity}</span>
                <button className="p-1.5 hover:bg-accent transition-colors" onClick={() => updateCartQty(item.product.id, item.quantity + 1)}><Plus className="h-3 w-3" /></button>
              </div>
              <p className="font-bold text-sm w-24 text-right">{formatCLP(item.product.price * item.quantity)}</p>
              <button onClick={() => removeFromCart(item.product.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="border rounded-xl p-6 h-fit sticky top-32">
          <h2 className="font-bold mb-4">Resumen del pedido</h2>
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCLP(cartTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Despacho</span>
              <span className="text-muted-foreground">Por calcular</span>
            </div>
            <hr />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>{formatCLP(cartTotal)}</span>
            </div>
          </div>
          <Button className="w-full gradient-primary text-primary-foreground h-12 text-base" disabled>
            Proceder al pago
          </Button>
          <p className="text-[10px] text-muted-foreground text-center mt-2">Integración de pago próximamente (Mercado Pago / Flow)</p>
        </div>
      </div>
    </div>
  );
};

export default CartPage;
