// Encabezado del sitio. Auditoría UX, entrega 3 (2026-10):
// - A-02: en el teléfono el encabezado fijo pasa de 191 px (24 % de una pantalla de 375×812)
//   a unos 100 px. La barra violeta va en 1 línea y sale de la pantalla al bajar (sticky con
//   top -28 px, el alto de la barra bajo md); el buscador se pliega en la lupa, que abre
//   /buscar con el campo listo para escribir.
// - F-04: las dos puertas se nombran con palabras, también en el teléfono, y se ven siempre:
//   «Cotización (n)» → /cotizacion y «Pedido (n)» → /solicitar-pedido. En el teléfono van en
//   su propia fila; desde lg, a la derecha, donde estaban el ícono y la pastilla.
// - B-02: el menú del teléfono es un panel lateral con scroll (MobileMenu).
// En escritorio (lg) no cambia nada más que los textos de las puertas y la tilde de "Categorías",
// salvo entre 1024 y 1279 px: ahí las puertas con texto le quitaban al buscador el espacio para
// escribir, así que el total del pedido y la palabra "Instalación" (queda la llave, con su
// título) se ven desde xl, y el buscador tiene un piso de 15rem.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Search, FileText, Menu, ChevronDown,
    Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium,
    RadioTower, AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings,
    TestTube, Ruler, TrainTrack, UtilityPole, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { categories, PUBLISHED_PRODUCT_COUNT } from '@/data/catalog/categories.config';
import { cn } from '@/lib/utils';
import TopInfoBar from './TopInfoBar';
import MobileMenu from './MobileMenu';
import Logo from '../Logo';
import RequestCartDrawer, { HEADER_DOOR_CLASS } from '@/components/request-order/RequestCartDrawer';

const iconMap: Record<string, React.ElementType> = {
    Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium, RadioTower,
    AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings, TestTube,
    Ruler, TrainTrack, UtilityPole,
};

/** Bajo sm, cada puerta ocupa media fila; desde sm, su propio ancho. */
const doorLayout = 'w-full sm:w-auto';

const Header = () => {
    const { quoteCount, isB2B, toggleB2B, loaded } = useApp();
    const [search, setSearch] = useState('');
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
        // -top-7: el alto de la barra violeta bajo md (TopInfoBar, h-7). Al bajar, la barra
        // sale de la pantalla y queda fijo el resto.
        <header className="sticky -top-7 md:top-0 z-50 bg-background border-b shadow-sm">
            <TopInfoBar />
            <div className="container py-2 lg:py-3">
                <div className="flex flex-wrap lg:flex-nowrap items-center gap-x-2 gap-y-2 sm:gap-x-4">
                    <MobileMenu />
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
                                            const Icon = iconMap[cat.icon] || Lightbulb;
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

                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="border-t mt-3 pt-3 flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">
                                            {PUBLISHED_PRODUCT_COUNT} productos en total
                                        </span>
                                        <Link to="/catalogo" className="text-xs font-semibold text-primary hover:underline" onClick={() => setCatOpen(false)}>
                                            Ver catálogo completo
                                        </Link>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                    <form onSubmit={handleSearch} className="flex-1 min-w-[15rem] max-w-xl hidden md:flex">
                        <div className="relative w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Buscar por SKU, producto, watts, kelvin..."
                                aria-label="Buscar productos"
                                className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                            />
                        </div>
                    </form>
                    <div className="flex items-center gap-1 ml-auto">
                        <button
                            onClick={toggleB2B}
                            // Hasta leer la sesión (milisegundos) el modo mostrado aún no es el guardado.
                            disabled={!loaded}
                            title={isB2B ? 'Modo empresa activo - precios sin IVA' : 'Activar precios para empresa'}
                            className={`hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                                isB2B
                                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                    : 'bg-background text-muted-foreground border-border hover:border-primary hover:text-primary'
                            }`}
                        >
                            <span className={`h-1.5 w-1.5 rounded-full ${isB2B ? 'bg-primary-foreground' : 'bg-muted-foreground'}`} />
                            {isB2B ? 'B2B - Precio neto' : 'B2C - Con IVA'}
                        </button>
                        {/* El buscador del teléfono, plegado en la lupa: /buscar abre con el campo listo. */}
                        <Link
                            to="/buscar"
                            className="md:hidden -mr-2 inline-flex h-10 w-10 items-center justify-center hover:bg-accent rounded-lg transition-colors"
                            aria-label="Buscar productos"
                        >
                            <Search className="h-5 w-5" aria-hidden="true" />
                        </Link>
                        <Link
                            to="/instalacion"
                            className="hidden sm:flex items-center gap-1 px-2 py-2 hover:bg-accent rounded-lg transition-colors text-sm font-medium"
                            title="Instalación Profesional"
                        >
                            <Wrench className="h-4 w-4 text-primary" />
                            <span className="hidden xl:inline text-xs">Instalación</span>
                        </Link>
                    </div>
                    {/* Las dos puertas. Bajo lg, en una fila propia bajo el logo (order-last): a lo
                        ancho en el teléfono, a la derecha en la tablet. Desde lg, junto a
                        "Instalación", con los 4 px de antes (lg:-ml-3 sobre el gap de 16 px). */}
                    <nav
                        aria-label="Tus listas"
                        className="order-last grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end lg:order-none lg:-ml-3 lg:w-auto lg:gap-1"
                    >
                        <Button asChild variant="outline" size="sm" className={cn(HEADER_DOOR_CLASS, doorLayout)}>
                            <Link to="/cotizacion" title="Cotización formal con RUT, para empresas">
                                <FileText aria-hidden="true" />
                                <span>Cotización ({quoteCount})</span>
                            </Link>
                        </Button>
                        <RequestCartDrawer className={doorLayout} />
                    </nav>
                </div>
            </div>
        </header>
    );
};

export default Header;
