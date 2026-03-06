import { Link } from 'react-router-dom';
import { Lightbulb, Cylinder, Square, Focus, Factory, SunDim, Lamp, Settings } from 'lucide-react';
import { categories } from '@/data/products';

const iconMap: Record<string, React.ElementType> = {
  Lightbulb, Cylinder, Square, Focus, Factory, SunDim, Lamp, Settings,
};

const CategoryGrid = () => (
  <section className="container py-12">
    <h2 className="text-2xl font-bold mb-2">Categorías</h2>
    <p className="text-muted-foreground mb-6">Encuentra iluminación LED para cada aplicación</p>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {categories.map(cat => {
        const Icon = iconMap[cat.icon] || Lightbulb;
        return (
          <Link
            key={cat.id}
            to={`/catalogo/${cat.slug}`}
            className="group border rounded-xl p-4 hover:border-primary/40 hover:shadow-product transition-all"
          >
            <Icon className="h-8 w-8 text-primary mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-sm">{cat.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{cat.productCount} productos</p>
          </Link>
        );
      })}
    </div>
  </section>
);

export default CategoryGrid;
