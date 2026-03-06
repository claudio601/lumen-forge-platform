import { products } from '@/data/products';
import ProductCard from '@/components/catalog/ProductCard';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const FeaturedProducts = () => (
  <section className="container py-12">
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-2xl font-bold">Productos destacados</h2>
        <p className="text-muted-foreground text-sm">Iluminación LED con especificaciones técnicas completas</p>
      </div>
      <Link to="/catalogo" className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-primary hover:gap-2 transition-all">
        Ver todo <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.slice(0, 8).map(p => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  </section>
);

export default FeaturedProducts;
