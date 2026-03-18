import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { products, categories } from '@/data/products';
import ProductCard from '@/components/catalog/ProductCard';
import { SlidersHorizontal, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PRODUCTS_PER_PAGE = 24;

const wattageRanges = [
  { label: '0-10W', min: 0, max: 10 },
  { label: '11-30W', min: 11, max: 30 },
  { label: '31-60W', min: 31, max: 60 },
  { label: '61-100W', min: 61, max: 100 },
  { label: '101-200W', min: 101, max: 200 },
];
const kelvinOptions = [3000, 4000, 5000, 5700, 6500];
const ipOptions = ['IP20', 'IP44', 'IP65', 'IP66', 'IP67'];

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];
}

const CatalogPage = () => {
  const { categorySlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const gridRef = useRef<HTMLDivElement>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState('relevance');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(categorySlug ? [categorySlug] : []);
  const [selectedWatts, setSelectedWatts] = useState<string[]>([]);
  const [selectedKelvin, setSelectedKelvin] = useState<number[]>([]);
  const [selectedIP, setSelectedIP] = useState<string[]>([]);

  const activeFilterCount = selectedCategories.length + selectedWatts.length + selectedKelvin.length + selectedIP.length;

  const currentPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));

  const goToPage = (page: number) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (page === 1) {
        next.delete('page');
      } else {
        next.set('page', String(page));
      }
      return next;
    }, { replace: false });
  };

  const clearAll = () => {
    setSelectedCategories([]);
    setSelectedWatts([]);
    setSelectedKelvin([]);
    setSelectedIP([]);
  };

  const filtered = useMemo(() => {
    let result = [...products];
    if (selectedCategories.length > 0) {
      const catIds = selectedCategories.map(slug => categories.find(c => c.slug === slug)?.id).filter(Boolean);
      result = result.filter(p => catIds.includes(p.category));
    } else if (categorySlug) {
      const cat = categories.find(c => c.slug === categorySlug);
      if (cat) result = result.filter(p => p.category === cat.id);
    }
    if (selectedWatts.length > 0) {
      result = result.filter(p =>
        selectedWatts.some(label => {
          const range = wattageRanges.find(r => r.label === label);
          return range && p.watts >= range.min && p.watts <= range.max;
        })
      );
    }
    if (selectedKelvin.length > 0) result = result.filter(p => selectedKelvin.includes(p.kelvin));
    if (selectedIP.length > 0) result = result.filter(p => p.ip && selectedIP.includes(p.ip));
    if (sortBy === 'price-asc') result.sort((a, b) => a.price - b.price);
    if (sortBy === 'price-desc') result.sort((a, b) => b.price - a.price);
    if (sortBy === 'watts') result.sort((a, b) => a.watts - b.watts);
    return result;
  }, [categorySlug, selectedCategories, selectedWatts, selectedKelvin, selectedIP, sortBy]);

  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('page');
      return next;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategories, selectedWatts, selectedKelvin, selectedIP, sortBy, categorySlug]);

  useEffect(() => {
    if (currentPage > 1) {
      gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentPage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PRODUCTS_PER_PAGE;
  const pageEnd = Math.min(pageStart + PRODUCTS_PER_PAGE, filtered.length);
  const paginated = filtered.slice(pageStart, pageEnd);

  const pageNumbers = (): (number | '...')[] => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (safePage <= 3) return [1, 2, 3, 4, '...', totalPages];
    if (safePage >= totalPages - 2) return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', safePage - 1, safePage, safePage + 1, '...', totalPages];
  };

  const category = categories.find(c => c.slug === categorySlug);

  const FilterPanel = () => (
    <div className="border rounded-xl p-4 space-y-5 sticky top-32">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Filtros</h3>
        {activeFilterCount > 0 && (
          <button onClick={clearAll} className="text-xs text-primary hover:underline flex items-center gap-1">
            <X className="h-3 w-3" /> Limpiar ({activeFilterCount})
          </button>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Categoria</p>
        <div className="space-y-1">
          {categories.map(cat => (
            <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
              <input
                type="checkbox"
                className="accent-primary"
                checked={selectedCategories.includes(cat.slug)}
                onChange={() => setSelectedCategories(toggle(selectedCategories, cat.slug))}
              />
              <span>{cat.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{cat.productCount}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Potencia</p>
        <div className="space-y-1">
          {wattageRanges.map(r => (
            <label key={r.label} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
              <input
                type="checkbox"
                className="accent-primary"
                checked={selectedWatts.includes(r.label)}
                onChange={() => setSelectedWatts(toggle(selectedWatts, r.label))}
              />
              {r.label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Temperatura de color</p>
        <div className="space-y-1">
          {kelvinOptions.map(k => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
              <input
                type="checkbox"
                className="accent-primary"
                checked={selectedKelvin.includes(k)}
                onChange={() => setSelectedKelvin(toggle(selectedKelvin, k))}
              />
              {k}K
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Grado IP</p>
        <div className="space-y-1">
          {ipOptions.map(ip => (
            <label key={ip} className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
              <input
                type="checkbox"
                className="accent-primary"
                checked={selectedIP.includes(ip)}
                onChange={() => setSelectedIP(toggle(selectedIP, ip))}
              />
              {ip}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="container py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{category?.name || 'Catalogo completo'}</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} producto{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6" ref={gridRef}>
        <aside className="lg:w-64 shrink-0 hidden lg:block"><FilterPanel /></aside>

        {filterOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/40" onClick={() => setFilterOpen(false)} />
            <div className="relative ml-auto w-72 bg-background h-full overflow-y-auto p-4 shadow-xl">
              <button className="mb-4 flex items-center gap-1 text-sm text-muted-foreground" onClick={() => setFilterOpen(false)}>
                <X className="h-4 w-4" /> Cerrar
              </button>
              <FilterPanel />
            </div>
          </div>
        )}

        <div className="flex-1">
          <div className="flex items-center justify-between mb-4 gap-3">
            <Button variant="outline" size="sm" className="lg:hidden gap-1.5" onClick={() => setFilterOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground text-[10px] rounded-full h-4 w-4 flex items-center justify-center">{activeFilterCount}</span>
              )}
            </Button>
            <div className="flex-1 hidden lg:flex flex-wrap gap-1.5">
              {selectedCategories.map(slug => (
                <span key={slug} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {categories.find(c => c.slug === slug)?.name}
                  <button onClick={() => setSelectedCategories(toggle(selectedCategories, slug))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              {selectedWatts.map(w => (
                <span key={w} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {w}<button onClick={() => setSelectedWatts(toggle(selectedWatts, w))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              {selectedKelvin.map(k => (
                <span key={k} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {k}K<button onClick={() => setSelectedKelvin(toggle(selectedKelvin, k))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              {selectedIP.map(ip => (
                <span key={ip} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {ip}<button onClick={() => setSelectedIP(toggle(selectedIP, ip))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
            <div className="ml-auto">
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

          {filtered.length > 0 && (
            <p className="text-sm text-muted-foreground mb-3">
              Mostrando {pageStart + 1}&ndash;{pageEnd} de {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {paginated.map(p => <ProductCard key={p.id} product={p} />)}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-3">No se encontraron productos con los filtros seleccionados.</p>
              <button onClick={clearAll} className="text-sm text-primary hover:underline">Limpiar filtros</button>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Pagina {safePage} de {totalPages}
              </p>
              <div className="flex items-center gap-1 flex-wrap justify-center">
                <Button variant="outline" size="sm" className="gap-1 h-8 px-3" onClick={() => goToPage(safePage - 1)} disabled={safePage === 1}>
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Anterior</span>
                </Button>
                {pageNumbers().map((n, i) =>
                  n === '...' ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm select-none">&#8230;</span>
                  ) : (
                    <Button
                      key={n}
                      variant={n === safePage ? 'default' : 'outline'}
                      size="sm"
                      className={`h-8 w-8 p-0 text-sm ${n === safePage ? 'gradient-primary text-primary-foreground' : ''}`}
                      onClick={() => goToPage(n as number)}
                    >
                      {n}
                    </Button>
                  )
                )}
                <Button variant="outline" size="sm" className="gap-1 h-8 px-3" onClick={() => goToPage(safePage + 1)} disabled={safePage === totalPages}>
                  <span className="hidden sm:inline">Siguiente</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CatalogPage;
