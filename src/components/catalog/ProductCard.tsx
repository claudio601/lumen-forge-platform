// src/components/catalog/ProductCard.tsx
// Tarjeta de producto en listados y catalogo.
// FASE 1: CTA principal reemplazado por "Solicitar pedido" (Request Order).
// El boton "Comprar" (Jumpseller) esta temporalmente deshabilitado.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Product, PROJECT_CATEGORIES } from '@/data/products';
import { useApp } from '@/context/AppContext';
import { useRequestCart } from '@/context/RequestCartContext';
import { toast } from 'sonner';
import RequestOrderButton from '@/components/request-order/RequestOrderButton';

interface Props {
  product: Product;
}

const ProductCard = ({ product }: Props) => {
  const { addToQuote, formatDisplayPrice, priceLabel, isB2B, displayPrice } = useApp();
  const { } = useRequestCart(); // Asegura que el provider este activo
  const [imgError, setImgError] = useState(false);

  const firstImage = product.images?.[0];
  const showImage = firstImage && !imgError;

  // Precio congelado al momento de renderizar la tarjeta
  const frozenUnitPrice = displayPrice(product.price);

  const requestItem = {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPrice: frozenUnitPrice,
    image: firstImage,
    url: `/producto/${product.id}`,
    attributes: {
      potencia: product.watts > 0 ? `${product.watts}W` : undefined,
    },
  };

  return (
    <div className="group border rounded-xl overflow-hidden hover:shadow-product-hover transition-all bg-card">
      <Link to={`/producto/${product.id}`} className="block">
        <div className="aspect-square bg-surface flex items-center justify-center relative overflow-hidden">
          {showImage ? (
            <img
              src={firstImage}
              alt={product.name}
              onError={() => setImgError(true)}
              className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <Zap className="h-16 w-16 text-primary/20" />
          )}
          {product.stock === true && (
            <span className="absolute top-2 left-2 bg-success/10 text-success text-[10px] font-semibold px-2 py-0.5 rounded-full">
              En stock
            </span>
          )}
          {product.stock === false && (
            <span className="absolute top-2 left-2 bg-muted text-muted-foreground text-[10px] font-semibold px-2 py-0.5 rounded-full">
              Sin stock
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
          {product.watts > 0 && <span>{product.watts}W</span>}
          {product.lumens > 0 && <span>{product.lumens.toLocaleString('es-CL')}lm</span>}
          {product.kelvin > 0 && <span>{product.kelvin}K</span>}
          {product.beamAngle && <span>{product.beamAngle}deg</span>}
        </div>
        <div className="flex items-baseline gap-1.5">
          <p className="text-lg font-bold text-foreground">{formatDisplayPrice(product.price)}</p>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              isB2B ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            {priceLabel}
          </span>
        </div>
        {PROJECT_CATEGORIES.includes(product.category) && (
          <p className="text-[10px] text-muted-foreground">
            Precio referencial · Descuentos por proyecto
          </p>
        )}
        <div className="flex gap-2 pt-1">
          {/* FASE 1: CTA principal = Solicitar pedido */}
          <RequestOrderButton item={requestItem} variant="card" />
          {/* Cotizar (QuoteCart) se mantiene como accion secundaria */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs border-primary/30 text-primary hover:bg-accent h-8"
            onClick={() => {
              addToQuote(product);
              toast.success('Agregado a cotizacion');
            }}
          >
            <FileText className="h-3.5 w-3.5" />
            Cotizar
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
