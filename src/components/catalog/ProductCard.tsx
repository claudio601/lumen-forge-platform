// src/components/catalog/ProductCard.tsx
// Tarjeta de producto en listados y catalogo.
// Modelo cotización → link de pago: CTA principal "Solicitar pedido".
// Nunca se muestra stock (no hay control de bodega): "Consultar disponibilidad".
// Con más de una variante en Jumpseller, la tarjeta no agrega a ciegas (auditoría UX, C-01):
// "Elegir variante" lleva a la ficha, donde está el selector, y si las variantes no cuestan
// lo mismo el precio dice "desde".

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, SlidersHorizontal, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Product } from '@/data/catalog/types';
import { PROJECT_CATEGORIES } from '@/data/catalog/categories.config';
import { requestSku } from '@/lib/variantSku';
import { hasVariantChoice, variantFromPrice } from '@/lib/variants';
import { fallbackToOriginal, jsImage, jsSrcSet } from '@/lib/jumpsellerImage';
import { useApp } from '@/context/AppContext';
import { useRequestCart } from '@/context/RequestCartContext';
import { toast } from 'sonner';
import RequestOrderButton from '@/components/request-order/RequestOrderButton';

interface Props {
    product: Product;
}

const ProductCard = ({ product }: Props) => {
    const { addToQuote, formatDisplayPrice, priceLabel, isB2B } = useApp();
    const [imgError, setImgError] = useState(false);

    // Foto en tamaño tarjeta desde el CDN de Jumpseller (la original puede pesar varios MB).
    const imageRef = product.imageRefs?.[0] ?? product.images?.[0];
    const firstImage = jsImage(imageRef, 400);
    const showImage = firstImage && !imgError;
    const mustChoose = hasVariantChoice(product);
    const fromPrice = variantFromPrice(product);

    const requestItem = {
          productId: product.id,
          jumpsellerId: product.jumpseller_id,
          variantId: product.jumpseller_variant_id,
          sku: requestSku(product),
          name: product.name,
          // Siempre CON IVA: la solicitud muestra el neto según el selector (auditoría UX, F-01)
          unitPrice: product.price,
          image: jsImage(imageRef, 200, 'thumb'),
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
                                        srcSet={jsSrcSet(imageRef, [400, 800])}
                                        sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                                        width={400}
                                        height={400}
                                        alt={product.name}
                                        onError={fallbackToOriginal(imageRef, () => setImgError(true))}
                                        className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                                        loading="lazy"
                                      />
                      ) : (
                        <Zap className="h-16 w-16 text-primary/20" />
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
                        {/* flex-wrap: en el teléfono, «desde $167.800» y la pastilla no caben en una línea */}
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                                  {fromPrice !== undefined && <span className="text-xs text-muted-foreground">desde</span>}
                                  <p className="text-lg font-bold text-foreground">{formatDisplayPrice(fromPrice ?? product.price)}</p>
                                  <span
                                                className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                                                isB2B ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                                                }`}
                                              >
                                    {priceLabel}
                                  </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Consultar disponibilidad</p>
                  {product.categories.some(c => PROJECT_CATEGORIES.includes(c)) && (
                      <p className="text-[10px] text-muted-foreground">
                                  Precio referencial
                      </p>
                        )}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {mustChoose ? (
                                  // La variante se elige en la ficha: aquí no se agrega nada sin ella
                                  <Button asChild size="sm" className="flex-1 gap-1 text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground">
                                              {/* El nombre accesible empieza con el texto visible y dice de qué producto es */}
                                              <Link to={`/producto/${product.id}`} aria-label={`Elegir variante: ${product.name}`}>
                                                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                                                          Elegir variante
                                              </Link>
                                  </Button>
                          ) : (
                                  <>
                                    {/* FASE 1: CTA principal = Solicitar pedido */}
                                              <RequestOrderButton item={requestItem} variant="card" />
                                    {/* Cotizar (QuoteCart) se mantiene como accion secundaria */}
                                              <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="flex-1 gap-1 text-xs border-primary/30 text-primary hover:bg-accent h-8"
                                                            onClick={() => {
                                                                            addToQuote(product);
                                                                            toast.success('Agregado a cotización');
                                                            }}
                                                          >
                                                          <FileText className="h-3.5 w-3.5" />
                                                          Cotizar
                                              </Button>
                                  </>
                          )}
                        </div>
                </div>
          </div>
        );
};

export default ProductCard;
