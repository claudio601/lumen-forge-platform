import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { products, popularSearches, categories } from '@/data/products';
import ProductCard from '@/components/catalog/ProductCard';
import { Search, X, TrendingUp } from 'lucide-react';
import { Helmet } from 'react-helmet-async';

const SearchPage = () => {
  const [params] = useSearchParams();
  const initialQ = params.get('q') || '';
  const [query, setQuery] = useState(initialQ);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.category.includes(q) ||
      String(p.watts).includes(q) ||
      String(p.kelvin).includes(q) ||
      String(p.lumens).includes(q) ||
      (p.ip && p.ip.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <div className="container py-8">
    <Helmet>
      <title>Buscar Productos | eLIGHTS Chile</title>
      <meta name="description" content="Busca en el catálogo de iluminación LED profesional de eLIGHTS." />
    </Helmet>

      <div className="max-w-2xl mx-auto mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por SKU, producto, watts, kelvin, IP..."
            className="w-full pl-12 pr-10 py-4 border-2 rounded-xl text-base bg-background focus:outline-none focus:border-primary transition-colors"
            autoFocus
          />
          {query && (
            <button className="absolute right-4 top-1/2 -translate-y-1/2" onClick={() => setQuery('')}>
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {!query.trim() ? (
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4" /> Búsquedas populares
            </h3>
            <div className="flex flex-wrap gap-2">
              {popularSearches.map(s => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="text-sm border rounded-full px-3 py-1.5 hover:border-primary/40 hover:text-primary transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Explorar categorías</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {categories.map(cat => (
                <Link key={cat.id} to={`/catalogo/${cat.slug}`} className="text-sm border rounded-lg p-3 hover:border-primary/40 hover:text-primary transition-colors text-center">
                  {cat.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">{results.length} resultados para "{query}"</p>
          {results.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {results.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-lg font-semibold mb-2">No se encontraron resultados</p>
              <p className="text-sm text-muted-foreground mb-4">Intenta con otros términos o explora nuestras categorías</p>
              <div className="flex flex-wrap justify-center gap-2">
                {popularSearches.slice(0, 4).map(s => (
                  <button key={s} onClick={() => setQuery(s)} className="text-sm border rounded-full px-3 py-1.5 hover:border-primary/40 hover:text-primary transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SearchPage;
