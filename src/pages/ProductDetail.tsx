// src/pages/ProductDetail.tsx
// Pagina de detalle de producto (PDP).
// FASE 1: CTA principal reemplazado por "Solicitar pedido".
// El boton "Comprar" (Jumpseller) esta temporalmente deshabilitado.

import { useParams, Link } from 'react-router-dom';
import { products, PROJECT_CATEGORIES } from '@/data/products';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
    Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
    FileText, Minus, Plus, Download, MessageCircle, Zap,
    ArrowLeft, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import ProductCard from '@/components/catalog/ProductCard';
import { waProductUrl } from '@/config/business';
import RequestOrderButton from '@/components/request-order/RequestOrderButton';
import { Helmet } from 'react-helmet-async';

// Mapping CCT -> etiqueta visible en UI / Pipedrive
const CCT_LABELS: Record<number, string> = {
  2200: '2200K Ámbar',
  2700: '2700K Cálida',
  4000: '4000K Neutra',
  5000: '5000K Fría',
};

// Mapping CCT -> sufijo de SKU para variantes BESTLED
const CCT_SKU_SUFFIX: Record<number, string> = {
  2200: 'A',
  2700: 'C',
  4000: 'N',
  5000: 'F',
};

// Renderiza inline **bold** -> <strong>
function renderInlineMd(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(<strong key={`b-${key++}`}>{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// Renderiza la descripción larga en bloques: párrafos, headings (línea sola con **bold**),
// y listas con bullets ("- texto"). Mantiene el bundle pequeño sin librerías externas.
function renderDescriptionBlocks(text: string): ReactNode {
  const blocks = text.trim().split(/\n\n+/);
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.length > 1 && lines.every(l => l.trim().startsWith('- '))) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-1 my-2">
          {lines.map((l, j) => (
            <li key={j} className="leading-relaxed">{renderInlineMd(l.replace(/^- /, ''))}</li>
          ))}
        </ul>
      );
    }
    const headingMatch = /^\*\*(.+)\*\*$/.exec(block.trim());
    if (headingMatch) {
      return (
        <h3 key={i} className="text-base font-semibold mt-5 mb-2">
          {headingMatch[1]}
        </h3>
      );
    }
    return (
      <p key={i} className="leading-relaxed mb-3">
        {renderInlineMd(block)}
      </p>
    );
  });
}

const ProductDetail = () => {
    const { id } = useParams();
    const product = products.find(p => p.id === id);
    const { addToQuote, formatDisplayPrice, displayPrice, priceLabel, isB2B } = useApp();
    const [qty, setQty] = useState(1);
    const [activeImg, setActiveImg] = useState(0);
    const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
    const [selectedCCT, setSelectedCCT] = useState<number | null>(null);

    if (!product) {
          return (
                  <div className="container py-16 text-center">
    <Helmet>
      <title>Producto no encontrado | eLIGHTS.cl</title>
      <meta name="description" content="El producto solicitado no existe o fue removido del catálogo de eLIGHTS.cl." />
      <meta name="robots" content="noindex, follow" />
    </Helmet>

                          <p className="text-muted-foreground">Producto no encontrado</p>
                          <Link to="/catalogo" className="text-primary text-sm mt-4 inline-block">
                                    Volver al catalogo
                          </Link>
                  </div>
                );
    }

    const canonicalUrl = `https://nuevo.elights.cl/producto/${product.id}`;
    const fallbackImage = 'https://nuevo.elights.cl/logo.svg';
    const ogImage = (product.images && product.images[0]) || product.image || fallbackImage;
    const seoTitle = product.metaTitle || `${product.name} | eLIGHTS.cl`;
    const seoDescription =
      product.metaDescription ||
      `${product.name}${product.watts ? ` ${product.watts}W` : ''}${product.ip ? ` ${product.ip}` : ''}. Iluminación LED profesional con ficha técnica, especificaciones y cotización en eLIGHTS.cl.`;
    const productDescription = product.description || seoDescription;
    const productBrand = product.brand || 'BESTLED';

    const productJsonLd = {
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: product.name,
      image: (product.images && product.images.length > 0) ? product.images : [product.image].filter(Boolean),
      description: productDescription,
      sku: product.sku || product.id,
      mpn: product.sku || product.id,
      brand: {
        '@type': 'Brand',
        name: productBrand,
      },
      offers: {
        '@type': 'Offer',
        url: canonicalUrl,
        priceCurrency: 'CLP',
        price: product.price,
        availability: product.stock === true
          ? 'https://schema.org/InStock'
          : 'https://schema.org/PreOrder',
        seller: {
          '@type': 'Organization',
          name: 'eLIGHTS.cl',
        },
      },
    };

    const faqJsonLd = (product.faq && product.faq.length > 0) ? {
      '@context': 'https://schema.org/',
      '@type': 'FAQPage',
      mainEntity: product.faq.map(item => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    } : null;
  
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

    // CCT: si el producto define availableCCT[], el cliente debe elegir antes de
    // poder solicitar pedido o cotizar. La selección define el SKU final
    // despachable (ej. APB120 + 'A' -> APB120A) y la etiqueta visible.
    const hasCCTSelector = !!(product.availableCCT && product.availableCCT.length > 0);
    const cctLabel = selectedCCT != null ? CCT_LABELS[selectedCCT] : undefined;
    const skuFinal = selectedCCT != null && CCT_SKU_SUFFIX[selectedCCT]
      ? `${product.sku}${CCT_SKU_SUFFIX[selectedCCT]}`
      : product.sku;

    const ctaDisabled = hasCCTSelector && selectedCCT === null;

    const requestItem = {
          productId: product.id,
          sku: skuFinal,
          name: product.name,
          unitPrice: frozenUnitPrice,
          // Fix 1: persistir el modo de precio al momento de agregar al carrito
          priceMode: (isB2B ? 'neto' : 'iva') as 'neto' | 'iva',
          image: images[0],
          url: `/producto/${product.id}`,
          attributes: {
                  potencia: product.watts > 0 ? `${product.watts}W` : undefined,
                  colorLuz: cctLabel,
          },
    };
  
    return (
          <div className="container py-8">
                <Helmet>
                  <title>{seoTitle}</title>
                  <meta name="description" content={seoDescription} />
                  <link rel="canonical" href={canonicalUrl} />
                  <meta property="og:title" content={seoTitle} />
                  <meta property="og:description" content={seoDescription} />
                  <meta property="og:type" content="product" />
                  <meta property="og:url" content={canonicalUrl} />
                  <meta property="og:image" content={ogImage} />
                  <meta property="og:site_name" content="eLIGHTS.cl" />
                  <meta name="twitter:card" content="summary_large_image" />
                  <meta name="twitter:title" content={seoTitle} />
                  <meta name="twitter:description" content={seoDescription} />
                  <meta name="twitter:image" content={ogImage} />
                  <script type="application/ld+json">
                    {JSON.stringify(productJsonLd)}
                  </script>
                  {faqJsonLd && (
                    <script type="application/ld+json">
                      {JSON.stringify(faqJsonLd)}
                    </script>
                  )}
                </Helmet>
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
                        
                          {/* Selector de temperatura de color (solo si product.availableCCT existe) */}
                          {hasCCTSelector && (
                                  <div className="mb-4 p-4 border rounded-xl bg-surface">
                                              <Label className="text-sm font-semibold mb-3 block">
                                                Temperatura de color <span className="text-destructive">*</span>
                                              </Label>
                                              <RadioGroup
                                                value={selectedCCT != null ? String(selectedCCT) : ''}
                                                onValueChange={(v) => setSelectedCCT(Number(v))}
                                                className="grid grid-cols-2 gap-2"
                                              >
                                                {(product.availableCCT ?? []).map(cct => (
                                                  <div key={cct} className="flex items-center gap-2">
                                                    <RadioGroupItem value={String(cct)} id={`cct-${cct}`} />
                                                    <Label htmlFor={`cct-${cct}`} className="text-sm cursor-pointer">
                                                      {CCT_LABELS[cct] ?? `${cct}K`}
                                                    </Label>
                                                  </div>
                                                ))}
                                              </RadioGroup>
                                              <p className="text-xs text-muted-foreground mt-3">
                                                Selecciona la temperatura de color. La elección afecta el SKU final del despacho.
                                              </p>
                                              {ctaDisabled && (
                                                <p className="text-xs text-destructive mt-2">
                                                  Selecciona temperatura de color para continuar
                                                </p>
                                              )}
                                  </div>
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
                                              <RequestOrderButton item={requestItem} quantity={qty} variant="pdp" disabled={ctaDisabled} />
                                    {/* Cotizar (QuoteCart) se mantiene como accion secundaria.
                                        TODO: pasar selectedCCT a QuoteCart cuando se actualice AppContext.addToQuote
                                        para aceptar atributos por línea (hoy solo recibe Product + quantity). */}
                                              <Button
                                                              size="lg"
                                                              variant="outline"
                                                              disabled={ctaDisabled}
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
          
            {/* ── Descripción larga ────────────────────────────────── */}
            {product.description && (
                    <section className="prose-content max-w-3xl mb-12">
                              <h2 className="text-xl font-bold mb-4">Descripción</h2>
                              <div className="text-sm text-foreground/90">
                                {renderDescriptionBlocks(product.description)}
                              </div>
                    </section>
                )}

            {/* ── Beneficios clave ─────────────────────────────────── */}
            {product.keyBenefits && product.keyBenefits.length > 0 && (
                    <section className="mb-12">
                              <h2 className="text-xl font-bold mb-4">Beneficios clave</h2>
                              <ul className="grid md:grid-cols-2 gap-3 max-w-3xl">
                                {product.keyBenefits.map((b, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm bg-surface rounded-lg p-3">
                                              <span className="h-2 w-2 mt-1.5 bg-primary rounded-full shrink-0" />
                                      <span className="leading-relaxed">{b}</span>
                                    </li>
                                  ))}
                              </ul>
                    </section>
                )}

            {/* ── Detalles técnicos extendidos ─────────────────────── */}
            {product.technicalDetails && (
                    <section className="mb-12 max-w-3xl">
                              <h2 className="text-xl font-bold mb-4">Detalles técnicos</h2>
                              <p className="text-sm leading-relaxed text-foreground/90">
                                {product.technicalDetails}
                              </p>
                    </section>
                )}

            {/* ── Certificaciones y ensayos ────────────────────────── */}
            {product.certifications && product.certifications.length > 0 && (
                    <section className="mb-12">
                              <h2 className="text-xl font-bold mb-4">Certificaciones y ensayos</h2>
                              <div className="grid md:grid-cols-2 gap-3 max-w-4xl">
                                {product.certifications.map((c, i) => (
                                    <div key={i} className="border rounded-xl p-4 bg-surface">
                                              <h3 className="text-sm font-semibold mb-1">{c.name}</h3>
                                      {c.issuer && (
                                  <p className="text-xs text-muted-foreground mb-2">{c.issuer}</p>
                                            )}
                                              <p className="text-xs leading-relaxed text-foreground/80">{c.description}</p>
                                    </div>
                                  ))}
                              </div>
                    </section>
                )}

            {/* ── Información de instalación ───────────────────────── */}
            {product.installationInfo && (
                    <section className="mb-12 max-w-3xl">
                              <h2 className="text-xl font-bold mb-4">Información de instalación</h2>
                              <div className="text-sm text-foreground/90">
                                {renderDescriptionBlocks(product.installationInfo)}
                              </div>
                    </section>
                )}

            {/* ── Casos de uso ─────────────────────────────────────── */}
            {product.useCases && product.useCases.length > 0 && (
                    <section className="mb-12">
                              <h2 className="text-xl font-bold mb-4">Casos de uso</h2>
                              <ul className="grid md:grid-cols-2 gap-2 max-w-3xl">
                                {product.useCases.map((u, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm">
                                              <span className="h-1.5 w-1.5 mt-2 bg-primary rounded-full shrink-0" />
                                      <span className="leading-relaxed">{u}</span>
                                    </li>
                                  ))}
                              </ul>
                    </section>
                )}

            {/* ── Preguntas frecuentes (FAQ) ───────────────────────── */}
            {product.faq && product.faq.length > 0 && (
                    <section className="mb-12 max-w-3xl">
                              <h2 className="text-xl font-bold mb-4">Preguntas frecuentes</h2>
                              <Accordion type="single" collapsible className="w-full">
                                {product.faq.map((q, i) => (
                                    <AccordionItem key={i} value={`faq-${i}`}>
                                              <AccordionTrigger className="text-sm font-medium text-left">
                                                {q.question}
                                              </AccordionTrigger>
                                              <AccordionContent className="text-sm text-foreground/85 leading-relaxed">
                                                {q.answer}
                                              </AccordionContent>
                                    </AccordionItem>
                                  ))}
                              </Accordion>
                    </section>
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
