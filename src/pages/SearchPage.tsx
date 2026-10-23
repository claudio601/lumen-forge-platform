import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useLocation, Link } from 'react-router-dom';
import { products, popularSearches, categories } from '@/data/products';
import ProductCard from '@/components/catalog/ProductCard';
import { Search, X, TrendingUp, Mail } from 'lucide-react';
import Seo from '@/components/Seo';
import { Button } from '@/components/ui/button';
import { contactEmail, responseTimePromise } from '@/config/business';
import { ADVISORY_LINK } from '@/config/navigation';
import { searchProducts, searchRequestMailto, searchSuggestions } from '@/lib/productSearch';

/**
 * Salida cuando la búsqueda no da resultados (auditoría UX, B-04): un correo prellenado a ventas,
 * la asesoría técnica y hasta 3 búsquedas que sí dan resultados (primero por sinónimo). Contacto
 * solo por correo: el WhatsApp prellenado queda para después de la marcha blanca del bot.
 */
const NoResults = ({ query, onSearch }: { query: string; onSearch: (q: string) => void }) => {
  const suggestions = useMemo(() => searchSuggestions(products, query), [query]);
  const buttonClass = 'h-auto min-h-9 py-2 whitespace-normal text-left justify-start sm:justify-center';
  return (
    <section aria-labelledby="no-results-title" className="max-w-2xl mx-auto py-8">
      <p className="text-center text-sm text-muted-foreground mb-6">No encontramos productos para «{query.trim()}».</p>
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 md:p-5">
        <h2 id="no-results-title" className="text-base md:text-lg font-semibold mb-2">¿No lo encuentras? Te lo buscamos</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          Cuéntanos qué necesitas y lo buscamos por ti.
        </p>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <Button asChild size="sm" className={buttonClass}>
            <a href={searchRequestMailto(query)}>
              <Mail className="h-4 w-4" aria-hidden="true" />
              Escríbenos a {contactEmail}
            </a>
          </Button>
          <Button asChild size="sm" variant="outline" className={buttonClass}>
            <Link to={ADVISORY_LINK.to}>
              <span>
                {ADVISORY_LINK.label}
                <span className="block text-xs font-normal opacity-80">{ADVISORY_LINK.hint}</span>
              </span>
            </Link>
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{responseTimePromise}</p>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-6 text-center">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">También puedes buscar</h3>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => onSearch(s)}
                className="text-sm border rounded-full px-3 py-1.5 hover:border-primary/40 hover:text-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const SearchPage = () => {
  const [params] = useSearchParams();
  const initialQ = params.get('q') || '';
  const [query, setQuery] = useState(initialQ);
  // Cada búsqueda desde el header estando ya en /buscar es una navegación nueva
  // (location.key cambia aunque ?q sea el mismo): el campo vuelve a seguir a ?q.
  const { key: navKey } = useLocation();
  useEffect(() => { setQuery(initialQ); }, [initialQ, navKey]);

  // Búsqueda tolerante (auditoría UX, B-03): sin tildes, por palabras, con los SKU de las
  // variantes y sinónimos de obra (src/lib/productSearch.ts).
  const results = useMemo(() => searchProducts(products, query), [query]);

  return (
    <div className="container py-8">
    <Seo title="Buscar Productos | eLIGHTS Chile" description="Busca en el catálogo de iluminación LED profesional de eLIGHTS." noindex />

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
      ) : results.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            {results.length} resultado{results.length !== 1 ? 's' : ''} para «{query.trim()}»
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {results.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </>
      ) : (
        <NoResults query={query} onSearch={setQuery} />
      )}
    </div>
  );
};

export default SearchPage;
