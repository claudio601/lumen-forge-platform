// src/pages/ProductDetail.tsx
// Pagina de detalle de producto (PDP).
// FASE 1: CTA principal reemplazado por "Solicitar pedido".
// El boton "Comprar" (Jumpseller) esta temporalmente deshabilitado.

import { useParams, Link } from 'react-router-dom';
import { products, PROJECT_CATEGORIES } from '@/data/products';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import {
    FileText, Minus, Plus, Download, MessageCircle, Zap,
    ArrowLeft, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import ProductCard from '@/components/catalog/ProductCard';
import { waProductUrl } from '@/config/business';
import RequestOrderButton from '@/components/request-order/RequestOrderButton';
import { Helmet } from 'react-helmet-async';

const ProductDetail = () => {
    const { id } = useParams();
    const product = products.find(p => p.id === id);
    const { addToQuote, formatDisplayPrice, displayPrice, priceLabel, isB2B } = useApp();
    const [qty, setQty] = useState(1);
    const [activeImg, setActiveImg] = useState(0);
    const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});

    if (!product) {
          return (
                  <div className="container py-16 text-center">
    <Helmet>
      <title>{product ? `${product.name} | eLIGHTS Chile` : 'Producto | eLIGHTS Chile'}</title>
      <meta name="description" content={product ? `${product.name} — Iluminación LED profesional. Ficha técnica, especificaciones y cotización.` : 'Producto de iluminación LED profesional.'} />
    </Helmet>

                          <p className="text-muted-foreground">Producto no encontrado</p>
                          <Link to="/catalogo" className="text-primary text-sm mt-4 inline-block">
                                    Volver al catalogo
                          </Link>
                  </div>
                );
    }
  
    const images = product.images?.filter((_, i) => !imgErrors[i]) ?? [];
    const hasImages = images.length > 0;
    const related = products
          .filter(p => p.category === product.category && p.id !== product.id)
          .slice(0, 4);
  
    const specs = [
      { label: 'Potencia', value: product.watts ? product.watts + 'W' : null },
      { label: 'Flujo luminoso', value: product.lumens ? product.lumens.toLocaleString('es-CL') + ' lm' : null },
      { label: 'Temperatura de color', value: product.kelvin ? product.kelvin + 'K' : null },
      { label: 'CRI', value: product.cri ? '>' + product.cri : null },
      { label: 'Voltaje', value: product.voltage ?? null },
      { label: 'Grado IP', value: product.ip ?? null },
      { label: 'Angulo de haz', value: product.beamAngle ? product.beamAngle + 'deg' : null },
      { label: 'Vida util', value: product.lifetime ? product.lifetime.toLocaleString() + 'h' : null },
      { label: 'Garantia', value: product.warranty ?? null },
      { label: 'Instalacion', value: product.installationType ?? null },
        ].filter(s => s.value);
  
    // Precio congelado al momento de agregar al Request Cart
    const frozenUnitPrice = displayPrice(product.price);
  
    const requestItem = {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unitPrice: frozenUnitPrice,
          // Fix 1: persistir el modo de precio al momento de agregar al carrito
          priceMode: (isB2B ? 'neto' : 'iva') as 'neto' | 'iva',
          image: images[0],
          url: `/producto/${product.id}`,
          attributes: {
                  potencia: product.watts > 0 ? `${product.watts}W` : undefined,
          },
    };
  
    return (
          <div className="container py-8">
                <Link
                          to="/catalogo"
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors"
                        >
                        <ArrowLeft className="h-4 w-4" />
                        Volver al catalogo
                </Link>
          
                <div className="grid lg:grid-cols-2 gap-8 mb-12">
                  {/* ── Galeria ─────────────────────────────────────────── */}
                        <div className="space-y-3">
                                  <div className="bg-surface rounded-xl flex items-center justify-center aspect-square overflow-hidden relative group">
                                    {hasImages ? (
                          <>
                                          <img
                                                              src={images[activeImg]}
                                                              alt={product.name + ' imagen ' + (activeImg + 1)}
                                                              onError={() => setImgErrors(p => ({ ...p, [activeImg]: true }))}
                                                              className="w-full h-full object-contain p-6"
                                                            />
                            {images.length > 1 && (
                                              <>
                                                                  <button
                                                                                          onClick={() => setActiveImg(i => (i - 1 + images.length) % images.length)}
                                                                                          className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow"
                                                                                        >
                                                                                        <ChevronLeft className="h-4 w-4" />
                                                                  </button>
                                                                  <button
                                                                                          onClick={() => setActiveImg(i => (i + 1) % images.length)}
                                                                                          className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow"
                                                                                        >
                                                                                        <ChevronRight className="h-4 w-4" />
                                                                  </button>
                                                                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                                                                    {images.map((_, i) => (
                                                                        <button
                                                                                                    key={i}
                                                                                                    onClick={() => setActiveImg(i)}
                                                                                                    className={'h-1.5 rounded-full transition-all ' + (i === activeImg ? 'w-4 bg-primary' : 'w-1.5 bg-primary/30')}
                                                                                                  />
                                                                      ))}
                                                                  </div>
                                              </>
                                            )}
                          </>
                        ) : (
                          <Zap className="h-32 w-32 text-primary/15" />
                        )}
                                  </div>
                          {images.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {images.map((img, i) => (
                                          <button
                                                              key={i}
                                                              onClick={() => setActiveImg(i)}
                                                              className={'shrink-0 h-16 w-16 rounded-lg border-2 overflow-hidden bg-surface transition-all ' + (i === activeImg ? 'border-primary shadow-sm' : 'border-transparent hover:border-primary/40')}
                                                            >
                                                            <img
                                                                                  src={img}
                                                                                  alt={product.name + ' thumbnail ' + (i + 1)}
                                                                                  className="w-full h-full object-contain p-1"
                                                                                  loading="lazy"
                                                                                />
                                          </button>
                                        ))}
                        </div>
                                  )}
                        </div>
                
                  {/* ── Info + CTAs ─────────────────────────────────────── */}
                        <div>
                                  <p className="text-xs text-muted-foreground font-mono mb-1">{product.sku}</p>
                                  <h1 className="text-2xl md:text-3xl font-bold mb-3">{product.name}</h1>
                        
                          {(product.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {(product.tags ?? []).map(t => (
                                          <span key={t} className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">
                                            {t}
                                          </span>
                                        ))}
                        </div>
                                  )}
                        
                                  <div className="flex items-center gap-3 mb-4">
                                              <span className={'text-xs font-semibold px-2 py-0.5 rounded-full ' + (product.stock === true ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                                                {product.stock === true ? 'En stock' : 'Disponible - consultar stock'}
                                              </span>
                                  </div>
                        
                                  <div className="flex items-baseline gap-2 mb-2">
                                              <p className="text-3xl font-bold">{formatDisplayPrice(product.price)}</p>
                                              <span className={'text-xs font-medium px-2 py-0.5 rounded-full ' + (isB2B ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                                                {priceLabel}
                                              </span>
                                    {isB2B && (
                          <span className="text-sm text-muted-foreground">
                                          ({new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(product.price)} c/IVA)
                          </span>
                                              )}
                                  </div>
                        
                          {PROJECT_CATEGORIES.includes(product.category) ? (
                        <p className="text-xs text-muted-foreground mb-6">
                                      Precio referencial - Contactanos para descuentos por volumen y proyecto
                        </p>
                      ) : (
                        <div className="mb-4" />
                      )}
                        
                          {/* Selector de cantidad */}
                                  <div className="flex items-center gap-3 mb-4">
                                              <div className="flex items-center border rounded-lg">
                                                            <button className="p-2 hover:bg-accent transition-colors" onClick={() => setQty(Math.max(1, qty - 1))}>
                                                                            <Minus className="h-4 w-4" />
                                                            </button>
                                                            <span className="px-4 text-sm font-semibold min-w-[3rem] text-center">{qty}</span>
                                                            <button className="p-2 hover:bg-accent transition-colors" onClick={() => setQty(qty + 1)}>
                                                                            <Plus className="h-4 w-4" />
                                                            </button>
                                              </div>
                                              <span className="text-sm text-muted-foreground">
                                                            Subtotal:{' '}
                                                {new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(frozenUnitPrice * qty)}{' '}
                                                {priceLabel}
                                              </span>
                                  </div>
                        
                          {/* ── CTAs principales ── */}
                                  <div className="flex gap-3 mb-6">
                                    {/* FASE 1: CTA principal = Solicitar pedido */}
                                              <RequestOrderButton item={requestItem} quantity={qty} variant="pdp" />
                                    {/* Cotizar (QuoteCart) se mantiene como accion secundaria */}
                                              <Button
                                                              size="lg"
                                                              variant="outline"
                                                              className="flex-1 gap-2 border-primary/30 text-primary hover:bg-accent h-12"
                                                              onClick={() => {
                                                                                addToQuote(product, qty);
                                                                                toast.success('Agregado a cotización');
                                                              }}
                                                            >
                                                            <FileText className="h-4 w-4" />
                                                            Cotizar
                                              </Button>
                                  </div>
                        
                          {/* Acciones secundarias */}
                                  <div className="flex gap-3">
                                              <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
                                                            <Download className="h-3.5 w-3.5" />
                                                            Ficha tecnica
                                              </Button>
                                              <a href={waProductUrl(product.name, product.sku)} target="_blank" rel="noopener noreferrer">
                                                            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-[#25D366] hover:text-[#25D366]">
                                                                            <MessageCircle className="h-3.5 w-3.5" />
                                                                            Consultar por WhatsApp
                                                            </Button>
                                              </a>
                                  </div>
                        </div>
                </div>
          
            {/* ── Especificaciones ──────────────────────────────────── */}
            {specs.length > 0 && (
                    <div className="grid lg:grid-cols-2 gap-8 mb-12">
                              <div>
                                          <h2 className="text-lg font-bold mb-4">Especificaciones tecnicas</h2>
                                          <div className="border rounded-xl overflow-hidden">
                                            {specs.map((s, i) => (
                                      <div key={s.label} className={'flex justify-between px-4 py-3 text-sm ' + (i % 2 === 0 ? 'bg-surface' : 'bg-background')}>
                                                        <span className="text-muted-foreground">{s.label}</span>
                                                        <span className="font-medium">{s.value}</span>
                                      </div>
                                    ))}
                                          </div>
                              </div>
                      {(product.applications ?? []).length > 0 && (
                                  <div>
                                                <h2 className="text-lg font-bold mb-4">Aplicaciones</h2>
                                                <div className="grid grid-cols-2 gap-2">
                                                  {(product.applications ?? []).map(a => (
                                                      <div key={a} className="flex items-center gap-2 text-sm bg-surface rounded-lg p-3">
                                                                          <span className="h-2 w-2 bg-primary rounded-full" />
                                                        {a}
                                                      </div>
                                                    ))}
                                                </div>
                                  </div>
                              )}
                    </div>
                )}
          
            {/* ── Relacionados ──────────────────────────────────────── */}
            {related.length > 0 && (
                    <div>
                              <h2 className="text-lg font-bold mb-4">Productos relacionados</h2>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {related.map(p => <ProductCard key={p.id} product={p} />)}
                              </div>
                    </div>
                )}
          </div>
        );
};

export default ProductDetail;
