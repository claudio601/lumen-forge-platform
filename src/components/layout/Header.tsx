import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShoppingCart, FileText, User, Menu, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { categories } from '@/data/products';
import TopInfoBar from './TopInfoBar';

const Header = () => {
  const { cartCount, quoteCount } = useApp();
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/buscar?q=${encodeURIComponent(search.trim())}`);
      setSearch('');
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-background border-b shadow-sm">
      <TopInfoBar />
      <div className="container py-3">
        <div className="flex items-center gap-4">
          {/* Mobile menu */}
          <button className="lg:hidden" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>

          {/* Logo */}
          <Link to="/" className="flex items-center gap-1 shrink-0">
            <div className="gradient-primary rounded-lg p-1.5">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              e<span className="text-gradient-primary">LIGHTS</span>
            </span>
          </Link>

          {/* Categories dropdown - desktop */}
          <div className="relative hidden lg:block">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-primary/20 text-foreground hover:bg-accent"
              onClick={() => setCatOpen(!catOpen)}
            >
              <Menu className="h-4 w-4" />
              Categorías
              <ChevronDown className="h-3 w-3" />
            </Button>
            {catOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCatOpen(false)} />
                <div className="absolute left-0 top-full mt-2 z-50 bg-background border rounded-lg shadow-lg w-[600px] p-4 grid grid-cols-2 gap-1 animate-fade-in">
                  {categories.map(cat => (
                    <div key={cat.id} className="p-2">
                      <Link
                        to={`/catalogo/${cat.slug}`}
                        className="font-semibold text-sm text-foreground hover:text-primary transition-colors"
                        onClick={() => setCatOpen(false)}
                      >
                        {cat.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                        {cat.subcategories.map(sub => (
                          <Link
                            key={sub.slug}
                            to={`/catalogo/${cat.slug}/${sub.slug}`}
                            className="text-xs text-muted-foreground hover:text-primary transition-colors"
                            onClick={() => setCatOpen(false)}
                          >
                            {sub.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xl hidden md:flex">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por SKU, producto, watts, kelvin..."
                className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>
          </form>

          {/* Actions */}
          <div className="flex items-center gap-1 ml-auto">
            <Link to="/buscar" className="md:hidden p-2 hover:bg-accent rounded-lg transition-colors">
              <Search className="h-5 w-5" />
            </Link>
            <Link to="/cotizacion" className="relative p-2 hover:bg-accent rounded-lg transition-colors" title="Cotización">
              <FileText className="h-5 w-5" />
              {quoteCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                  {quoteCount}
                </span>
              )}
            </Link>
            <Link to="/carro" className="relative p-2 hover:bg-accent rounded-lg transition-colors" title="Carro">
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                  {cartCount}
                </span>
              )}
            </Link>
            <Link to="/instaladores" className="hidden sm:flex p-2 hover:bg-accent rounded-lg transition-colors" title="Mi cuenta">
              <User className="h-5 w-5" />
            </Link>
          </div>
        </div>

        {/* Mobile search */}
        <form onSubmit={handleSearch} className="mt-3 md:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar productos..."
              className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </form>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="lg:hidden border-t bg-background animate-fade-in">
          <div className="container py-4 space-y-2">
            {categories.map(cat => (
              <Link
                key={cat.id}
                to={`/catalogo/${cat.slug}`}
                className="block py-2 px-3 text-sm font-medium hover:bg-accent rounded-md transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                {cat.name}
              </Link>
            ))}
            <hr className="my-2" />
            <Link to="/cotizador" className="block py-2 px-3 text-sm font-medium text-primary hover:bg-accent rounded-md" onClick={() => setMenuOpen(false)}>
              Cotizador Inteligente
            </Link>
            <Link to="/instaladores" className="block py-2 px-3 text-sm font-medium hover:bg-accent rounded-md" onClick={() => setMenuOpen(false)}>
              Área Instaladores
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
