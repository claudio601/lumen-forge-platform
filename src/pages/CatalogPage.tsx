import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { products, categories } from '@/data/products';
import ProductCard from '@/components/catalog/ProductCard';
import { SlidersHorizontal, Grid3X3, List, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

const wattageRanges = ['0-10W', '11-30W', '31-60W', '61-100W', '101-200W'];
const kelvinOptions = [3000, 4000, 5000, 5700, 6500];
const ipOptions = ['IP20', 'IP44', 'IP65', 'IP66', 'IP67'];

const CatalogPage = () => {
  const { categorySlug } = useParams();
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState('relevance');
  const [selectedCategory, setSelectedCategory] = useState(categorySlug || '');

  const category = categories.find(c => c.slug === categorySlug);

  const filtered = useMemo(() => {
    let result = [...products];
    if (categorySlug) {
      const cat = categories.find(c => c.slug === categorySlug);
      if (cat) result = result.filter(p => p.category === cat.id);
    }
    if (sortBy === 'price-asc') result.sort((a, b) => a.price - b.price);
    if (sortBy === 'price-desc') result.sort((a, b) => b.price - a.price);
    if (sortBy === 'watts') result.sort((a, b) => a.watts - b.watts);
    return result;
  }, [categorySlug, sortBy]);

  return (
    <div className="container py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{category?.name || 'Catálogo completo'}</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} productos encontrados</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Filter sidebar */}
        <aside className={`lg:w-64 shrink-0 ${filterOpen ? 'block' : 'hidden lg:block'}`}>
          <div className="border rounded-xl p-4 space-y-5 sticky top-32">
            <h3 className="font-semibold text-sm">Filtros</h3>
            
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Categoría</p>
              <div className="space-y-1">
                {categories.map(cat => (
                  <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
                    <input type="checkbox" className="accent-primary" checked={selectedCategory === cat.slug} onChange={() => setSelectedCategory(selectedCategory === cat.slug ? '' : cat.slug)} />
                    {cat.name}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Potencia</p>
              <div className="space-y-1">
                {wattageRanges.map(w => (
                  <label key={w} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
                    <input type="checkbox" className="accent-primary" /> {w}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Temperatura de color</p>
              <div className="space-y-1">
                {kelvinOptions.map(k => (
                  <label key={k} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
                    <input type="checkbox" className="accent-primary" /> {k}K
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Grado IP</p>
              <div className="space-y-1">
                {ipOptions.map(ip => (
                  <label key={ip} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
                    <input type="checkbox" className="accent-primary" /> {ip}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Products grid */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4 gap-3">
            <Button variant="outline" size="sm" className="lg:hidden gap-1.5" onClick={() => setFilterOpen(!filterOpen)}>
              <SlidersHorizontal className="h-4 w-4" /> Filtros
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="text-sm border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="relevance">Relevancia</option>
                <option value="price-asc">Precio: menor a mayor</option>
                <option value="price-desc">Precio: mayor a menor</option>
                <option value="watts">Potencia</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {filtered.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-16">
              <p className="text-muted-foreground">No se encontraron productos con los filtros seleccionados.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CatalogPage;
