import { Link } from 'react-router-dom';
import { ShoppingCart, FileText, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Product, formatCLP } from '@/data/products';
import { useApp } from '@/context/AppContext';
import { toast } from 'sonner';

interface Props {
  product: Product;
}

const ProductCard = ({ product }: Props) => {
  const { addToCart, addToQuote } = useApp();

  return (
    <div className="group border rounded-xl overflow-hidden hover:shadow-product-hover transition-all bg-card">
      <Link to={`/producto/${product.id}`} className="block">
        <div className="aspect-square bg-surface flex items-center justify-center p-6 relative">
          <Zap className="h-16 w-16 text-primary/20" />
          {product.stock > 0 && (
            <span className="absolute top-2 left-2 bg-success/10 text-success text-[10px] font-semibold px-2 py-0.5 rounded-full">
              En stock
            </span>
          )}
          {product.ip && (
            <span className="absolute top-2 right-2 bg-accent text-accent-foreground text-[10px] font-semibold px-2 py-0.5 rounded-full">
              {product.ip}
            </span>
          )}
        </div>
      </Link>
      <div className="p-4 space-y-2">
        <p className="text-[10px] text-muted-foreground font-mono">{product.sku}</p>
        <Link to={`/producto/${product.id}`}>
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 hover:text-primary transition-colors">
            {product.name}
          </h3>
        </Link>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{product.watts}W</span>
          <span>{product.lumens}lm</span>
          <span>{product.kelvin}K</span>
          {product.beamAngle && <span>{product.beamAngle}°</span>}
        </div>
        <p className="text-lg font-bold text-foreground">{formatCLP(product.price)}</p>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1 gradient-primary text-primary-foreground gap-1 text-xs h-8"
            onClick={() => { addToCart(product); toast.success('Agregado al carro'); }}
          >
            <ShoppingCart className="h-3.5 w-3.5" /> Comprar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs border-primary/30 text-primary hover:bg-accent h-8"
            onClick={() => { addToQuote(product); toast.success('Agregado a cotización'); }}
          >
            <FileText className="h-3.5 w-3.5" /> Cotizar
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
