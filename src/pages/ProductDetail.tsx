import { useParams, Link } from 'react-router-dom';
import { products, formatCLP } from '@/data/products';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { ShoppingCart, FileText, Minus, Plus, Download, MessageCircle, Zap, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import ProductCard from '@/components/catalog/ProductCard';

const ProductDetail = () => {
  const { id } = useParams();
  const product = products.find(p => p.id === id);
  const { addToCart, addToQuote } = useApp();
  const [qty, setQty] = useState(1);

  if (!product) {
    return (
      <div className="container py-16 text-center">
        <p className="text-muted-foreground">Producto no encontrado</p>
        <Link to="/catalogo" className="text-primary text-sm mt-4 inline-block">Volver al catálogo</Link>
      </div>
    );
  }

  const related = products.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);

  const specs = [
    { label: 'Potencia', value: `${product.watts}W` },
    { label: 'Flujo luminoso', value: `${product.lumens} lm` },
    { label: 'Temperatura de color', value: `${product.kelvin}K` },
    { label: 'CRI', value: product.cri ? `>${product.cri}` : '—' },
    { label: 'Voltaje', value: product.voltage },
    { label: 'Grado IP', value: product.ip || '—' },
    { label: 'Ángulo de haz', value: product.beamAngle ? `${product.beamAngle}°` : '—' },
    { label: 'Vida útil', value: product.lifetime ? `${product.lifetime.toLocaleString()}h` : '—' },
    { label: 'Garantía', value: product.warranty },
    { label: 'Instalación', value: product.installationType || '—' },
  ];

  return (
    <div className="container py-8">
      <Link to="/catalogo" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Volver al catálogo
      </Link>

      <div className="grid lg:grid-cols-2 gap-8 mb-12">
        {/* Image */}
        <div className="bg-surface rounded-xl flex items-center justify-center aspect-square">
          <Zap className="h-32 w-32 text-primary/15" />
        </div>

        {/* Info */}
        <div>
          <p className="text-xs text-muted-foreground font-mono mb-1">{product.sku}</p>
          <h1 className="text-2xl md:text-3xl font-bold mb-3">{product.name}</h1>
          
          <div className="flex flex-wrap gap-2 mb-4">
            {product.tags.map(t => (
              <span key={t} className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-4">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${product.stock > 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
              {product.stock > 0 ? `${product.stock} en stock` : 'Sin stock'}
            </span>
          </div>

          <p className="text-3xl font-bold mb-6">{formatCLP(product.price)}</p>

          {/* Quantity + CTAs */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center border rounded-lg">
              <button className="p-2 hover:bg-accent transition-colors" onClick={() => setQty(Math.max(1, qty - 1))}><Minus className="h-4 w-4" /></button>
              <span className="px-4 text-sm font-semibold min-w-[3rem] text-center">{qty}</span>
              <button className="p-2 hover:bg-accent transition-colors" onClick={() => setQty(qty + 1)}><Plus className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="flex gap-3 mb-6">
            <Button size="lg" className="flex-1 gradient-primary text-primary-foreground gap-2 h-12" onClick={() => { addToCart(product, qty); toast.success('Agregado al carro'); }}>
              <ShoppingCart className="h-4 w-4" /> Comprar
            </Button>
            <Button size="lg" variant="outline" className="flex-1 gap-2 border-primary/30 text-primary hover:bg-accent h-12" onClick={() => { addToQuote(product, qty); toast.success('Agregado a cotización'); }}>
              <FileText className="h-4 w-4" /> Cotizar
            </Button>
          </div>

          <div className="flex gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
              <Download className="h-3.5 w-3.5" /> Ficha técnica
            </Button>
            <a href="https://wa.me/56912345678" target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-whatsapp">
                <MessageCircle className="h-3.5 w-3.5" /> Consultar por WhatsApp
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* Specs table */}
      <div className="grid lg:grid-cols-2 gap-8 mb-12">
        <div>
          <h2 className="text-lg font-bold mb-4">Especificaciones técnicas</h2>
          <div className="border rounded-xl overflow-hidden">
            {specs.map((s, i) => (
              <div key={s.label} className={`flex justify-between px-4 py-3 text-sm ${i % 2 === 0 ? 'bg-surface' : 'bg-background'}`}>
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-bold mb-4">Aplicaciones</h2>
          <div className="grid grid-cols-2 gap-2">
            {product.applications.map(a => (
              <div key={a} className="flex items-center gap-2 text-sm bg-surface rounded-lg p-3">
                <span className="h-2 w-2 bg-primary rounded-full" />
                {a}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Related */}
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
