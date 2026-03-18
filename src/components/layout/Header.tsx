import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Search, ShoppingCart, FileText, User, Menu, X, ChevronDown,
    Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium, RadioTower,
    AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings,
    TestTube, Ruler, TrainTrack, UtilityPole,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { categories } from '@/data/products';
import TopInfoBar from './TopInfoBar';
import Logo from '../Logo';

const iconMap: Record<string, React.ElementType> = {
    Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium, RadioTower,
    AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings,
    TestTube, Ruler, TrainTrack, UtilityPole,
};

const Header = () => {
    const { cartCount, quoteCount, isB2B, toggleB2B } = useApp();
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
                                  <button className="lg:hidden" onClick={() => setMenuOpen(!menuOpen)}>
                                    {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                                  </button>
                                  <Logo />
                        
                                  <div className="relative hidden lg:block">
                                              <Button
                                                              variant="outline"
                                                              size="sm"
                                                              className="gap-1.5 border-primary/20 text-foreground hover:bg-accent"
                                                              onClick={() => setCatOpen(!catOpen)}
                                                            >
                                                            <Menu className="h-4 w-4" />
                                                            Categorías
                                                            <ChevronDown className={`h-3 w-3 transition-transform ${catOpen ? 'rotate-180' : ''}`} />
                                              </Button>
                                    {catOpen && (
                          <>
                                          <div className="fixed inset-0 z-40" onClick={() => setCatOpen(false)} />
                                          <div className="absolute left-0 top-full mt-2 z-50 bg-background border rounded-xl shadow-xl w-[720px] p-5 animate-fade-in">
                                                            <div className="grid grid-cols-3 gap-x-6 gap-y-1">
                                                              {categories.map(cat => {
                                                  const Icon = iconMap[cat.icon] || Zap;
                                                  return (
                                                                            <div key={cat.id} className="py-2">
                                                                                                      <Link
                                                                                                                                    to={`/catalogo/${cat.slug}`}
                                                                                                                                    className="flex items-center gap-2 font-semibold text-sm text-foreground hover:text-primary transition-colors mb-1"
                                                                                                                                    onClick={() => setCatOpen(false)}
                                                                                                                                  >
                                                                                                                                  <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                                                                                                        {cat.name}
                                                                                                                                  <span className="ml-auto text-[10px] text-muted-foreground font-normal">{cat.productCount}</span>
                                                                                                        </Link>
                                                                              {cat.subcategories.slice(0, 3).map(sub => (
                                                                                                          <Link
                                                                                                                                          key={sub.slug}
                                                                                                                                          to={`/catalogo/${cat.slug}/${sub.slug}`}
                                                                                                                                          className="block text-xs text-muted-foreground hover:text-primary transition-colors pl-5 py-0.5"
                                                                                                                                          onClick={() => setCatOpen(false)}
                                                                                                                                        >
                                                                                                            {sub.name}
                                                                                                            </Link>
                                                                                                        ))}
                                                                              {cat.subcategories.length > 3 && (
                                                                                                          <Link
                                                                                                                                          to={`/catalogo/${cat.slug}`}
                                                                                                                                          className="block text-xs text-primary/60 hover:text-primary transition-colors pl-5 py-0.5"
                                                                                                                                          onClick={() => setCatOpen(false)}
                                                                                                                                        >
                                                                                                                                        +{cat.subcategories.length - 3} más…
                                                                                                            </Link>
                                                                                                      )}
                                                                              </div>
                                                                          );
                          })}
                                                            </div>
                                                            <div className="border-t mt-3 pt-3 flex justify-between items-center">
                                                                                <span className="text-xs text-muted-foreground">
                                                                                  {categories.reduce((s, c) => s + c.productCount, 0)} productos en total
                                                                                  </span>
                                                                                <Link to="/catalogo" className="text-xs font-semibold text-primary hover:underline" onClick={() => setCatOpen(false)}>
                                                                                                      Ver catálogo completo →
                                                                                  </Link>
                                                            </div>
                                          </div>
                          </>
                        )}
                                  </div>
                        
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
                        
                                  <div className="flex items-center gap-1 ml-auto">
                                              <button
                                                              onClick={toggleB2B}
                                                              title={isB2B ? 'Modo empresa activo — precios sin IVA' : 'Activar precios para empresa'}
                                                              className={`hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                                                                                isB2B
                                                                                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                                                                  : 'bg-background text-muted-foreground border-border hover:border-primary hover:text-primary'
                                                              }`}
                                                            >
                                                            <span className={`h-1.5 w-1.5 rounded-full ${isB2B ? 'bg-primary-foreground' : 'bg-muted-foreground'}`} />
                                                {isB2B ? 'B2B · Precio neto' : 'B2C · Con IVA'}
                                              </button>
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
          
            {menuOpen && (
                    <div className="lg:hidden border-t bg-background animate-fade-in">
                              <div className="container py-4 space-y-1">
                                {categories.map(cat => {
                                    const Icon = iconMap[cat.icon] || Zap;
                                    return (
                                                      <Link
                                                                          key={cat.id}
                                                                          to={`/catalogo/${cat.slug}`}
                                                                          className="flex items-center gap-2 py-2 px-3 text-sm font-medium hover:bg-accent rounded-md transition-colors"
                                                                          onClick={() => setMenuOpen(false)}
                                                                        >
                                                                        <Icon className="h-4 w-4 text-primary shrink-0" />
                                                        {cat.name}
                                                                        <span className="ml-auto text-xs text-muted-foreground">{cat.productCount}</span>
                                                      </Link>
                                                    );
                    })}
                              
                                          <hr className="my-2" />
                              
                                          <button
                                                          onClick={() => { toggleB2B(); setMenuOpen(false); }}
                                                          className={`w-full flex items-center gap-2 py-2 px-3 text-sm font-semibold rounded-md transition-all ${
                                                                            isB2B
                                                                              ? 'bg-primary text-primary-foreground'
                                                                              : 'text-muted-foreground hover:bg-accent hover:text-primary'
                                                          }`}
                                                        >
                                                        <span className={`h-2 w-2 rounded-full shrink-0 ${isB2B ? 'bg-primary-foreground' : 'bg-muted-foreground'}`} />
                                            {isB2B ? 'B2B activo — Precio neto sin IVA' : 'Cambiar a B2B (empresa)'}
                                                        <span className="ml-auto text-xs font-normal opacity-70">
                                                          {isB2B ? 'Toca para desactivar' : 'Toca para activar'}
                                                        </span>
                                          </button>
                              
                                          <Link
                                                          to="/cotizacion"
                                                          className="block py-2 px-3 text-sm font-medium text-primary hover:bg-accent rounded-md"
                                                          onClick={() => setMenuOpen(false)}
                                                        >
                                                        Solicitar cotización
                                          </Link>
                                          <Link
                                                          to="/instaladores"
                                                          className="block py-2 px-3 text-sm font-medium hover:bg-accent rounded-md"
                                                          onClick={() => setMenuOpen(false)}
                                                        >
                                                        Área Instaladores
                                          </Link>
                              </div>
                    </div>
                )}
          </header>
        );
};

export default Header;
