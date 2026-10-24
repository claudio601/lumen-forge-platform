// src/pages/NotFound.tsx
// Página "no encontrada" (auditoría UX, B-10). Vercel la sirve con estado 404 y noindex en toda
// URL sin página (dist/404.html, src/lib/notFound.ts); la app la dibuja también en una categoría o
// una guía que no existen. Tres salidas, para los enlaces viejos y los anuncios de productos dados
// de baja:
//   - el buscador, precargado con las palabras de la URL (searchTermsFromPath), que lleva a
//     /buscar. Es un formulario GET a /buscar: funciona también antes de hidratar;
//   - las 6 categorías principales (las del pie, mainCategories);
//   - «¿Buscabas un producto que ya no está?», con el correo prellenado a ventas (como /buscar sin
//     resultados, B-04). Sin WhatsApp: queda para después de la marcha blanca del bot.
// 404.html se genera una sola vez, para NOT_FOUND_URL: las palabras de la URL se ponen al montar,
// así el primer render del navegador es igual al HTML del servidor.

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Search } from 'lucide-react';
import Seo from '@/components/Seo';
import { Button } from '@/components/ui/button';
import { mainCategories } from '@/data/catalog/categories.config';
import { contactEmail, responseTimePromise } from '@/config/business';
import { searchTermsFromPath } from '@/lib/notFound';
import { searchRequestMailto } from '@/lib/searchMailto';

const NotFound = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  // Al montar (después de hidratar) y al pasar a otra URL sin página
  useEffect(() => {
    setQuery(searchTermsFromPath(pathname));
  }, [pathname]);
  const typed = query.trim();

  const search = (e: FormEvent) => {
    e.preventDefault();
    navigate(typed ? `/buscar?q=${encodeURIComponent(typed)}` : '/buscar');
  };

  return (
    <div className="container py-12 md:py-16">
      <Seo title="Página no encontrada | eLIGHTS Chile" description="Esta página no existe. Vuelve al inicio para explorar el catálogo de iluminación LED profesional." noindex />

      <div className="max-w-2xl mx-auto text-center">
        <h1 className="mb-2 text-4xl font-bold">404</h1>
        <p className="mb-8 text-xl text-muted-foreground">Página no encontrada</p>
        <form action="/buscar" method="get" role="search" onSubmit={search} className="flex flex-col sm:flex-row gap-2 text-left">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              name="q"
              aria-label="Buscar productos"
              enterKeyHint="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por SKU, producto, watts, kelvin, IP..."
              className="w-full pl-12 pr-4 py-3 border-2 rounded-xl text-base bg-background focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <Button type="submit" size="lg" className="h-auto py-3 rounded-xl">
            Buscar
          </Button>
        </form>
      </div>

      <section aria-labelledby="not-found-categories" className="max-w-3xl mx-auto mt-10">
        <h2 id="not-found-categories" className="text-sm font-semibold text-muted-foreground mb-3 text-center">
          Categorías principales
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {mainCategories().map(cat => (
            <Link
              key={cat.id}
              to={`/catalogo/${cat.slug}`}
              className="text-sm border rounded-lg p-3 hover:border-primary/40 hover:text-primary transition-colors text-center"
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="not-found-gone" className="max-w-2xl mx-auto mt-10 rounded-xl border border-primary/20 bg-primary/5 p-4 md:p-5 text-center">
        <h2 id="not-found-gone" className="text-base md:text-lg font-semibold mb-3">
          ¿Buscabas un producto que ya no está?
        </h2>
        <Button asChild size="sm" className="h-auto min-h-9 py-2 whitespace-normal">
          <a href={typed ? searchRequestMailto(typed) : `mailto:${contactEmail}`}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            Escríbenos a {contactEmail}
          </a>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{responseTimePromise}</p>
      </section>

      <p className="mt-10 text-center">
        <Link to="/" className="text-primary underline hover:text-primary/90">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
};

export default NotFound;
