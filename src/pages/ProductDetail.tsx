// src/pages/ProductDetail.tsx
// Pagina de detalle de producto (PDP).
// Modelo cotización → link de pago: CTA principal "Solicitar pedido".
// Nunca se muestra stock (no hay control de bodega): "Consultar disponibilidad".

import { useParams, Link } from 'react-router-dom';
import { products, categories, PROJECT_CATEGORIES, type Product } from '@/data/products';
import { useProductContent } from '@/data/catalog/content';
import type { ProductContent } from '@/data/catalog/types';
import { buildVariantSku, requestSku } from '@/lib/variantSku';
import {
    missingChoicesText, selectedVariant, variantAttributes, variantAxes, variantKelvin, variantLabel,
    variantLineSku, variantSku, variantSkuIsDistinct, variantsMatching, type VariantSelection,
} from '@/lib/variants';
import VariantSelector from '@/components/catalog/VariantSelector';
import { fallbackToOriginal, jsImage, jsSrcSet } from '@/lib/jumpsellerImage';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import {
    Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
    FileText, Minus, Plus, Download, MessageCircle, Zap,
    ArrowLeft, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import ProductCard from '@/components/catalog/ProductCard';
import { waProductUrl } from '@/config/business';
import RequestOrderButton from '@/components/request-order/RequestOrderButton';
import Seo from '@/components/Seo';
import { breadcrumbJsonLd, faqJsonLd, productJsonLd } from '@/lib/seo/jsonld';
import { categoryPath, productPath } from '@/lib/seo/routes';
import { productDescriptions } from '@/data/catalog/descriptions.generated';
import { productImageFacts } from '@/data/catalog/og-images.generated';
import { productOgImage } from '@/lib/seo/ogImage';
import SpecGroups, { type SpecGroupsProps } from '@/components/catalog/SpecGroups';
import type { SpecRow } from '@/data/catalog/jumpseller.types';
import { warrantyNote } from '@/lib/productWarranty';
import { htmlToText } from '@/lib/html';

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
    if (lines.every(l => l.trim().startsWith('- '))) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-1 my-2">
          {lines.map((l, j) => (
            <li key={j} className="leading-relaxed">{renderInlineMd(l.replace(/^- /, ''))}</li>
          ))}
        </ul>
      );
    }
    // Solo un bloque que es entero una negrita es subtítulo ("**a** texto **b**" es un párrafo)
    const headingMatch = /^\*\*([^*]+)\*\*$/.exec(block.trim());
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

// Contenido SEO del producto (formato BESTLED) sobre los datos de Jumpseller. Los BESTLED
// tienen su ficha editorial completa y no lo usan.
function withContent(p: Product, c: ProductContent | undefined): Product {
  if (!c || p.description) return p;
  return {
    ...p,
    metaTitle: c.metaTitle,
    metaDescription: c.metaDescription,
    description: c.description,
    keyBenefits: c.keyBenefits,
    useCases: c.useCases,
    installationInfo: c.installationInfo,
    faq: c.faq,
  };
}

const ProductDetail = () => {
    const { id } = useParams();
    const found = products.find(p => p.id === id);
    const content = useProductContent(found?.jumpseller_id);
    const { addToQuote, formatDisplayPrice, displayPrice, priceLabel, isB2B } = useApp();
    const [qty, setQty] = useState(1);
    const [activeImg, setActiveImg] = useState(0);
    const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
    // Variante elegida: opción por eje (nombre de la opción en Jumpseller → valor)
    const [selection, setSelection] = useState<VariantSelection>({});
    const hintId = useId();

    if (!found) {
          return (
                  <div className="container py-16 text-center">
    <Seo title="Producto no encontrado | eLIGHTS.cl" description="El producto solicitado no existe o fue removido del catálogo de eLIGHTS.cl." noindex />

                          <p className="text-muted-foreground">Producto no encontrado</p>
                          <Link to="/catalogo" className="text-primary text-sm mt-4 inline-block">
                                    Volver al catalogo
                          </Link>
                  </div>
                );
    }

    const product = withContent(found, content);
    const productUrlPath = productPath(product.id);
    // Imagen para compartir: la primera foto original de Jumpseller si es PNG o JPEG de menos de
    // 600 KB (revisada en la sincronización); si no, la de la marca (undefined → DEFAULT_OG).
    const ogImage = productOgImage(product.images?.[0], productImageFacts[product.jumpseller_id], product.name);
    const seoTitle = product.metaTitle || `${product.name} | eLIGHTS.cl`;
    const seoDescription =
      product.metaDescription ||
      `${product.name}${product.watts ? ` ${product.watts}W` : ''}${product.ip ? ` ${product.ip}` : ''}. Iluminación LED profesional con ficha técnica, especificaciones y cotización en eLIGHTS.cl.`;
    // Descripción de Jumpseller, limpia y ordenada en la sincronización: su texto (HTML) y su
    // tabla de especificaciones en los grupos de las fichas BESTLED. Los BESTLED conservan su
    // texto y sus especificaciones editoriales (decisión del dueño: mejor para SEO).
    const jumpsellerContent = productDescriptions[product.jumpseller_id];
    const jumpsellerText = product.description ? undefined : jumpsellerContent?.text;
    const jumpsellerRows = [
      ...(jumpsellerContent?.electricos ?? []),
      ...(jumpsellerContent?.construccion ?? []),
      ...(jumpsellerContent?.componentes ?? []),
    ];
    const productDescription =
      (product.description && product.description.replace(/\*\*/g, '').replace(/^- /gm, '').replace(/\s+/g, ' ').trim()) ||
      (jumpsellerContent?.text
        ? htmlToText(jumpsellerContent.text)
        : jumpsellerRows.length
          ? `${product.name}. ${jumpsellerRows.slice(0, 8).map(s => `${s.label}: ${s.value.replace(/\n/g, ', ')}`).join('. ')}.`
          : seoDescription);
    const productCategory = categories.find(c => c.slug === product.category);
    const seoJsonLd = [
      productJsonLd(product, productDescription),
      breadcrumbJsonLd([
        { name: 'Inicio', path: '/' },
        { name: 'Catálogo', path: '/catalogo' },
        ...(productCategory ? [{ name: productCategory.name, path: categoryPath(productCategory.slug) }] : []),
        { name: product.name, path: productUrlPath },
      ]),
      ...(product.faq && product.faq.length > 0 ? [faqJsonLd(product.faq)] : []),
    ];

    // Galería: fotos con id de Jumpseller (tamaños reducidos por CDN); si no hay, las URLs.
    const galleryRefs = product.imageRefs?.length ? product.imageRefs : (product.images ?? []).map(url => ({ url }));
    const gallery = galleryRefs.filter((_, i) => !imgErrors[i]);
    const images = gallery.map(ref => ref.url);
    // Si una foto falla y sale de la galería, el índice activo no puede quedar fuera de rango.
    const current = gallery[Math.min(activeImg, Math.max(gallery.length - 1, 0))];
    const hasImages = images.length > 0;
    const related = products
          .filter(p => p.category === product.category && p.id !== product.id)
          .slice(0, 4);
  
    // Sin tabla en Jumpseller: los pocos datos deducidos del nombre, en los mismos grupos.
    const known = (rows: { label: string; value: string | null }[]) => rows.filter((r): r is SpecRow => !!r.value);
    const nameSpecs = {
      electricos: known([
        { label: 'Potencia', value: product.watts ? product.watts + 'W' : null },
        { label: 'Tensión', value: product.voltage ?? null },
        { label: 'Flujo luminoso', value: product.lumens ? product.lumens.toLocaleString('es-CL') + ' lm' : null },
        { label: 'Temperatura de color', value: product.kelvin ? product.kelvin + 'K' : null },
        { label: 'Índice cromático (CRI)', value: product.cri ? '>' + product.cri : null },
        { label: 'Ángulo de apertura', value: product.beamAngle ? product.beamAngle + '°' : null },
      ]),
      construccion: known([
        { label: 'Grado de protección', value: product.ip ?? null },
        { label: 'Instalación', value: product.installationType ?? null },
        { label: 'Vida útil', value: product.lifetime ? product.lifetime.toLocaleString('es-CL') + ' h' : null },
        { label: 'Garantía', value: product.warranty ?? null },
      ]),
    };
  
    // Variantes de Jumpseller (auditoría UX, D-01): con más de una, el cliente elige en el
    // selector y los botones esperan la elección. Precio CON IVA de la variante; el toggle B2B
    // (÷1,19) lo aplica displayPrice. Mientras falte elegir, si las variantes posibles no
    // cuestan lo mismo, "desde {la más barata}".
    const axes = variantAxes(product);
    const hasVariantChoice = axes.length > 0;
    const chosen = selectedVariant(product, axes, selection);
    const candidatePrices = hasVariantChoice
      ? variantsMatching(product.variants ?? [], selection).map(v => v.price)
      : [product.price];
    const candidateMin = candidatePrices.length ? Math.min(...candidatePrices) : product.price;
    const showFromPrice = !chosen && new Set(candidatePrices).size > 1;
    // Precio de lo que se agrega: el de la variante elegida (o el único posible)
    const basePrice = chosen?.price ?? (showFromPrice ? product.price : candidateMin);
    const displayedBasePrice = showFromPrice ? candidateMin : basePrice;

    // Precio unitario en el modo del selector (total por la cantidad elegida)
    const frozenUnitPrice = displayPrice(displayedBasePrice);

    const hasGroupedSpecs = !!(
      (product.specsElectricos && product.specsElectricos.length > 0) ||
      (product.specsConstruccion && product.specsConstruccion.length > 0) ||
      (product.specsComponentes && product.specsComponentes.length > 0)
    );
    // Especificaciones en el formato BESTLED: las editoriales (BESTLED) o la tabla de Jumpseller
    // (la misma de elights.cl) ordenada en grupos; sin ninguna, los pocos datos deducidos del nombre.
    const specGroups: SpecGroupsProps | null = hasGroupedSpecs
      ? {
          electricos: product.specsElectricos,
          construccion: product.specsConstruccion,
          componentes: product.specsComponentes,
          applications: product.applications,
        }
      : jumpsellerRows.length || jumpsellerContent?.tables || jumpsellerContent?.applications?.length
        ? {
            electricos: jumpsellerContent?.electricos,
            construccion: jumpsellerContent?.construccion,
            componentes: jumpsellerContent?.componentes,
            applications: product.applications?.length ? product.applications : jumpsellerContent?.applications,
            tablesHtml: jumpsellerContent?.tables,
          }
        : nameSpecs.electricos.length || nameSpecs.construccion.length
          ? { ...nameSpecs, applications: product.applications }
          : null;
    // La variante elegida define el SKU de la línea (el de Jumpseller, p. ej. APB907, o JS-<id>
    // si no tiene) y la etiqueta legible que llega a la solicitud, a la cotización, a Pipedrive
    // y a WhatsApp.
    const chosenLabel = chosen ? variantLabel(product, chosen) : undefined;
    const skuFinal = chosen ? variantLineSku(product, chosen) : requestSku(product);
    // Código visible arriba: el de la variante elegida, solo si Jumpseller le dio uno (nunca el
    // del producto ni el interno JS-…)
    const headerSku = chosen ? variantSku(chosen) : product.sku;
    // Consultas por WhatsApp con la variante elegida (SKU + variante), no el SKU base.
    const waUrl = waProductUrl(chosenLabel ? `${product.name} – ${chosenLabel}` : product.name, skuFinal);

    // Sin la variante, los botones no agregan nada (como hasta ahora en las BESTLED)
    const ctaDisabled = hasVariantChoice && !chosen;
    const missingAxes = axes.filter(a => selection[a.name] === undefined);
    // «Define el SKU del despacho» solo si el SKU de la variante la distingue de las otras
    const variantHint = chosen
      ? `Elegiste: ${chosenLabel}. ${variantSkuIsDistinct(product, chosen) ? 'La elección define el SKU del despacho.' : 'La elección queda registrada en tu solicitud.'}`
      : `Elige ${missingChoicesText(missingAxes)} para continuar.`;

    // Variante propagada a la cotización: SKU, precio CON IVA, id y etiqueta de la variante.
    // Sin variante para elegir queda undefined → cae a product.price.
    const quoteSelection = chosen
      ? { cct: variantKelvin(product, chosen), sku: skuFinal, unitPrice: chosen.price, variantId: chosen.id, label: chosenLabel }
      : undefined;

    const requestItem = {
          productId: product.id,
          jumpsellerId: product.jumpseller_id,
          variantId: chosen?.id ?? product.jumpseller_variant_id,
          sku: skuFinal,
          name: product.name,
          // Siempre CON IVA (el de la variante elegida): la solicitud muestra el neto según
          // el selector (auditoría UX, F-01)
          unitPrice: basePrice,
          image: gallery[0] ? jsImage(gallery[0], 200, 'thumb') : undefined,
          url: `/producto/${product.id}`,
          attributes: chosen
            ? variantAttributes(product, chosen)
            : { potencia: product.watts > 0 ? `${product.watts}W` : undefined },
    };
  
    return (
          <div className="container py-8">
                <Seo title={seoTitle} description={seoDescription} path={productUrlPath} image={ogImage} type="product" jsonLd={seoJsonLd} />
                <Link
                          to="/catalogo"
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors"
                        >
                        <ArrowLeft className="h-4 w-4" />
                        Volver al catalogo
                </Link>
          
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
                  {/* ── Galeria ─────────────────────────────────────────── */}
                        <div className="space-y-3">
                                  <div className="bg-surface rounded-xl flex items-center justify-center aspect-square overflow-hidden relative group">
                                    {hasImages ? (
                          <>
                                          <img
                                                              src={jsImage(current, 800)}
                                                              srcSet={jsSrcSet(current, [800, 1200])}
                                                              sizes="(min-width: 1024px) 50vw, 100vw"
                                                              width={800}
                                                              height={800}
                                                              alt={product.name + ' imagen ' + (activeImg + 1)}
                                                              onError={fallbackToOriginal(current, () => setImgErrors(p => ({ ...p, [galleryRefs.indexOf(current)]: true })))}
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
                          {gallery.map((ref, i) => (
                                          <button
                                                              key={i}
                                                              onClick={() => setActiveImg(i)}
                                                              className={'shrink-0 h-16 w-16 rounded-lg border-2 overflow-hidden bg-surface transition-all ' + (i === activeImg ? 'border-primary shadow-sm' : 'border-transparent hover:border-primary/40')}
                                                            >
                                                            <img
                                                                                  src={jsImage(ref, 200, 'thumb')}
                                                                                  width={64}
                                                                                  height={64}
                                                                                  onError={fallbackToOriginal(ref)}
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
                                  <p className="text-xs text-muted-foreground font-mono mb-1 min-h-4">{headerSku}</p>
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
                        
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
                                              <a
                                                href={waUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent text-primary hover:bg-primary/10 transition-colors"
                                              >
                                                Consultar disponibilidad
                                              </a>
                                              <span className="text-xs text-muted-foreground">Despacho en hasta 2 días hábiles</span>
                                              <span className="text-xs text-muted-foreground">{warrantyNote(specGroups)}</span>
                                  </div>
                        
                                  <div className="flex items-baseline gap-2 mb-2">
                                    {showFromPrice && (
                                              <span className="text-sm font-medium text-muted-foreground">desde</span>
                                            )}
                                              <p className="text-3xl font-bold">{formatDisplayPrice(displayedBasePrice)}</p>
                                              <span className={'text-xs font-medium px-2 py-0.5 rounded-full ' + (isB2B ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                                                {priceLabel}
                                              </span>
                                    {isB2B && (
                          <span className="text-sm text-muted-foreground">
                                          ({new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(displayedBasePrice)} c/IVA)
                          </span>
                                              )}
                                  </div>
                        
                          {product.categories.some(c => PROJECT_CATEGORIES.includes(c)) ? (
                        <p className="text-xs text-muted-foreground mb-6">
                                      Precio referencial
                        </p>
                      ) : (
                        <div className="mb-4" />
                      )}
                        
                          {/* Selector de variante (productos con más de una variante en Jumpseller) */}
                          {hasVariantChoice && (
                                  <VariantSelector
                                    axes={axes}
                                    variants={product.variants ?? []}
                                    selection={selection}
                                    onSelect={(name, value) => setSelection(prev => ({ ...prev, [name]: value }))}
                                    formatPrice={formatDisplayPrice}
                                    hint={variantHint}
                                    hintId={hintId}
                                  />
                                )}

                          {/* Selector de cantidad */}
                                  <div className="flex flex-wrap items-center gap-3 mb-4">
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
                                                            Subtotal{showFromPrice ? ' desde' : ''}:{' '}
                                                {new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(frozenUnitPrice * qty)}{' '}
                                                {priceLabel}
                                              </span>
                                  </div>

                          {/* ── CTAs principales ── */}
                                  <div className="flex flex-wrap gap-3 mb-6">
                                    {/* FASE 1: CTA principal = Solicitar pedido */}
                                              <RequestOrderButton item={requestItem} quantity={qty} variant="pdp" disabled={ctaDisabled} aria-describedby={hasVariantChoice ? hintId : undefined} />
                                    {/* Cotizar (QuoteCart) se mantiene como accion secundaria.
                                        Propaga la variante elegida (id, SKU, precio y etiqueta) a la línea de cotización. */}
                                              <Button
                                                              size="lg"
                                                              variant="outline"
                                                              disabled={ctaDisabled}
                                                              aria-describedby={hasVariantChoice ? hintId : undefined}
                                                              className="flex-1 gap-2 border-primary/30 text-primary hover:bg-accent h-12"
                                                              onClick={() => {
                                                                                addToQuote(product, qty, undefined, quoteSelection);
                                                                                toast.success('Agregado a cotización', chosenLabel ? { description: `${product.name} – ${chosenLabel}` } : undefined);
                                                              }}
                                                            >
                                                            <FileText className="h-4 w-4" />
                                                            Cotizar
                                              </Button>
                                  </div>
                        
                          {/* Acciones secundarias */}
                                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                                              {product.datasheetUrl && (
                                                            <a
                                                              href={product.datasheetUrl}
                                                              target="_blank"
                                                              rel="noopener noreferrer"
                                                              download
                                                            >
                                                              <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
                                                                <Download className="h-3.5 w-3.5" />
                                                                Ficha técnica
                                                              </Button>
                                                            </a>
                                              )}
                                              <a href={waUrl} target="_blank" rel="noopener noreferrer">
                                                            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-[#25D366] hover:text-[#25D366]">
                                                                            <MessageCircle className="h-3.5 w-3.5" />
                                                                            Escríbenos por WhatsApp
                                                            </Button>
                                              </a>
                                  </div>
                        </div>
                </div>
          
            {/* ── Especificaciones técnicas ──────────────────────────── */}
            {specGroups && <SpecGroups {...specGroups} />}

            {/* ── Variantes de temperatura de color (preview visual) ── */}
            {product.cctVariants && product.cctVariants.length > 0 && (
                    <section className="mb-12 max-w-4xl">
                              <h2 className="text-xl font-bold mb-4">Variantes de temperatura de color</h2>
                              <p className="text-sm text-muted-foreground mb-4">
                                Aspecto aproximado de la luz emitida por cada variante. Selecciona la temperatura óptima según el tipo de instalación y normativa aplicable.
                              </p>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {product.cctVariants.map(v => (
                                    <div key={v.kelvin} className="border rounded-lg p-3 bg-surface">
                                              <div
                                                className="w-full h-9 rounded-md border border-border mb-3"
                                                style={{ backgroundColor: v.colorHex }}
                                                aria-label={`Color aproximado ${v.kelvin}K`}
                                              />
                                              <p className="text-sm font-semibold">{v.kelvin}K</p>
                                              <p className="text-xs text-muted-foreground">{v.name}</p>
                                              <p className="text-xs font-mono text-muted-foreground mt-1">{buildVariantSku(product.sku, v.kelvin)}</p>
                                    </div>
                                  ))}
                              </div>
                    </section>
                )}

            {/* ── Familia de potencias (cross-sell) ─────────────────── */}
            {product.productFamily && product.productFamily.items.length > 0 && (
                    <section className="mb-12 max-w-4xl">
                              <h2 className="text-xl font-bold mb-4">{product.productFamily.title}</h2>
                              <p className="text-sm text-muted-foreground mb-4">
                                Esta luminaria forma parte de una familia disponible en distintas potencias. Selecciona la versión apropiada para tu proyecto.
                              </p>
                              <div className="border rounded-xl overflow-hidden">
                                <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground font-semibold bg-surface border-b">
                                  <span>Potencia</span>
                                  <span>Flujo</span>
                                  <span>Eficacia</span>
                                  <span>Código</span>
                                </div>
                                {product.productFamily.items.map(row => {
                                      const isCurrent = row.watts === product.watts;
                                      const canLink = !!row.productId && row.productId !== product.id;
                                      const baseClass = 'grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 px-4 py-3 text-sm border-b last:border-b-0 ';
                                      const stateClass = isCurrent
                                        ? 'bg-primary/5 font-medium'
                                        : canLink
                                        ? 'hover:bg-secondary cursor-pointer transition-colors'
                                        : '';
                                      const content = (
                                          <>
                                              <span>{row.watts}W</span>
                                              <span>{row.lumens.toLocaleString('es-CL')} lm</span>
                                              <span>{row.eficacia}</span>
                                              <span className="font-mono text-xs">{row.sku}{isCurrent ? ' · actual' : ''}</span>
                                          </>
                                      );
                                      return canLink ? (
                                          <Link
                                              key={row.sku}
                                              to={`/producto/${row.productId}`}
                                              className={baseClass + stateClass}
                                          >
                                              {content}
                                          </Link>
                                      ) : (
                                          <div key={row.sku} className={baseClass + stateClass}>
                                              {content}
                                          </div>
                                      );
                                  })}
                              </div>
                    </section>
                )}
          
            {/* ── Descripción larga ────────────────────────────────── */}
            {(product.description || jumpsellerText) && (
              <section className="prose-content max-w-3xl mb-12">
                <h2 className="text-xl font-bold mb-4">Descripción</h2>
                {product.description ? (
                  <div className="text-sm text-foreground/90">{renderDescriptionBlocks(product.description)}</div>
                ) : (
                  // Texto de Jumpseller (sin las tablas, que van en Especificaciones técnicas),
                  // limpio en la sincronización (scripts/jumpseller/sanitize-description.ts).
                  <div
                    className="prose prose-sm max-w-none text-foreground/90 prose-table:my-0 prose-td:py-1.5 prose-td:align-top prose-headings:text-foreground"
                    dangerouslySetInnerHTML={{ __html: jumpsellerText! }}
                  />
                )}
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
                                              {/* forceMount: las respuestas quedan en el HTML (las declaran los datos estructurados FAQPage) */}
                                              <AccordionContent forceMount className="text-sm text-foreground/85 leading-relaxed">
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
