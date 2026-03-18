import { Link } from 'react-router-dom';
import {
    Zap, Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium, RadioTower,
    AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings,
    TestTube, Ruler, TrainTrack, UtilityPole,
} from 'lucide-react';
import { categories } from '@/data/products';

const iconMap: Record<string, React.ElementType> = {
    Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium, RadioTower,
    AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings,
    TestTube, Ruler, TrainTrack, UtilityPole, Zap,
};

const CategoryGrid = () => (
  <section className="py-12">
    <div className="container">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Categorías</h2>
        <Link to="/catalogo" className="text-sm text-primary hover:underline">Ver todo →</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {categories.map(cat => {
          const Icon = iconMap[cat.icon] || Zap;
          return (
            <Link
              key={cat.id}
              to={`/catalogo/${cat.slug}`}
              className="group flex flex-col items-center gap-2 p-4 bg-surface rounded-xl border hover:border-primary/40 hover:bg-primary/5 transition-all text-center"
            >
              <div className="gradient-primary rounded-xl p-3 group-hover:scale-110 transition-transform">
                <Icon className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xs font-medium leading-tight">{cat.name}</span>
              <span className="text-[10px] text-muted-foreground">{cat.productCount} productos</span>
            </Link>
          );
        })}
      </div>
    </div>
  </section>
);

export default CategoryGrid;
