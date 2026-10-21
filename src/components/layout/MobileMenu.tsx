// src/components/layout/MobileMenu.tsx
// Menú del teléfono y la tablet (bajo lg), auditoría UX B-02. Antes se desplegaba dentro del
// encabezado fijo (985 px de alto) y, a 360×780, "Cambiar a B2B", "Solicitar cotización" e
// "Instaladores" quedaban fuera de la pantalla, sin forma de llegar a ellos con el scroll.
//
// Ahora es un panel lateral (Sheet de shadcn, un diálogo de Radix): ocupa el alto de la pantalla
// (100dvh), se desplaza por dentro y pone arriba lo que vende (las dos listas, el precio sin
// IVA, la asesoría y los instaladores); las categorías van después. Al abrir, el foco va al panel
// (lector de pantalla: "Menú, diálogo"; con Tab, la X «Cerrar» de arriba a la derecha y después
// las opciones en orden). Radix no enfoca enlaces al abrir y elegiría el botón de B2B, donde un
// Enter cambiaría los precios. Radix encierra el foco en el panel, lo cierra con Escape, con la
// X o tocando fuera, y devuelve el foco al botón del menú. Cada enlace lo cierra al navegar, y
// también se cierra si cambia la página (Atrás).

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    Menu, ChevronRight, FileText, ClipboardList, Compass, Wrench, Users,
    Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium,
    RadioTower, AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings,
    TestTube, Ruler, TrainTrack, UtilityPole,
} from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useApp } from '@/context/AppContext';
import { useRequestCart } from '@/context/RequestCartContext';
import { categories, PUBLISHED_PRODUCT_COUNT } from '@/data/catalog/categories.config';
import { ADVISORY_LINK } from '@/config/navigation';
import { responseTimePromise } from '@/config/business';
import { trackRequestCartView } from '@/components/request-order/requestCartAnalytics';

const iconMap: Record<string, React.ElementType> = {
    Lightbulb, PanelTop, Waves, Projector, Warehouse, SunMedium, RadioTower,
    AlignJustify, Siren, PlugZap, ShieldAlert, Sun, Tag, Settings, TestTube,
    Ruler, TrainTrack, UtilityPole,
};

const rowClass = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const hintClass = 'block text-xs font-normal text-muted-foreground';
const headingClass = 'px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground';

/** Fila con ícono, título y una línea de ayuda que cierra el menú al navegar. */
function MenuLink({ to, icon: Icon, title, hint, onClick }: {
    to: string; icon: React.ElementType; title: string; hint?: string; onClick?: () => void;
}) {
    return (
        <SheetClose asChild>
            <Link to={to} className={rowClass} onClick={onClick}>
                <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{title}</span>
                    {hint && <span className={hintClass}>{hint}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
        </SheetClose>
    );
}

const MobileMenu = () => {
    const [open, setOpen] = useState(false);
    const panel = useRef<HTMLDivElement>(null);
    const { pathname } = useLocation();
    const { quoteCount, isB2B, toggleB2B, loaded } = useApp();
    const { itemCount, subtotal } = useRequestCart();

    // Si la página cambia sin tocar un enlace del menú (Atrás), el menú no queda abierto encima.
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <button
                    type="button"
                    className="lg:hidden -ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Abrir menú"
                >
                    <Menu className="h-6 w-6" aria-hidden="true" />
                </button>
            </SheetTrigger>
            <SheetContent
                ref={panel}
                side="left"
                className="flex h-[100dvh] w-[85%] flex-col gap-0 p-0 focus:outline-none sm:max-w-sm"
                onOpenAutoFocus={e => {
                    e.preventDefault();
                    panel.current?.focus();
                }}
            >
                <SheetHeader className="shrink-0 space-y-0 border-b px-4 py-3 pr-14 text-left">
                    <SheetTitle className="text-base leading-8">Menú</SheetTitle>
                    <SheetDescription className="sr-only">
                        Tus listas de cotización y de pedido, precios para empresa, asesoría técnica y categorías del catálogo.
                    </SheetDescription>
                </SheetHeader>
                <nav aria-label="Menú del sitio" className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
                    <h3 className={headingClass}>Tus listas</h3>
                    <ul className="space-y-0.5">
                        <li>
                            <MenuLink to="/cotizacion" icon={FileText} title={`Cotización (${quoteCount})`} hint="Solicitar cotización formal con RUT, para empresas" />
                        </li>
                        <li>
                            <MenuLink
                                to="/solicitar-pedido"
                                icon={ClipboardList}
                                title={`Pedido (${itemCount})`}
                                hint="Compra directa: te enviamos el link de pago"
                                // El mismo evento que la puerta del encabezado (request_cart_view)
                                onClick={() => trackRequestCartView(itemCount, subtotal)}
                            />
                        </li>
                    </ul>
                    <p className="px-3 pt-1 pb-3 text-xs text-muted-foreground">{responseTimePromise}</p>

                    <ul className="space-y-0.5 border-t pt-3">
                        <li>
                            <button
                                type="button"
                                onClick={() => { toggleB2B(); setOpen(false); }}
                                // Hasta leer la sesión (milisegundos) el modo mostrado aún no es el guardado.
                                disabled={!loaded}
                                className={`${rowClass} font-semibold transition-colors disabled:opacity-50 ${
                                    isB2B ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
                                }`}
                            >
                                <span className={`ml-1.5 mr-1.5 h-2 w-2 shrink-0 rounded-full ${isB2B ? 'bg-primary-foreground' : 'bg-muted-foreground'}`} aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                    <span className="block">{isB2B ? 'B2B activo: precios sin IVA' : 'Cambiar a B2B (empresa)'}</span>
                                    <span className={`block text-xs font-normal ${isB2B ? 'opacity-80' : 'text-muted-foreground'}`}>
                                        {isB2B ? 'Toca para volver a precios con IVA' : 'Ver precios netos, sin IVA'}
                                    </span>
                                </span>
                            </button>
                        </li>
                        <li>
                            <MenuLink to={ADVISORY_LINK.to} icon={Compass} title={ADVISORY_LINK.label} hint={ADVISORY_LINK.hint} />
                        </li>
                        <li>
                            <MenuLink to="/instalacion" icon={Wrench} title="Instalación profesional" />
                        </li>
                        <li>
                            <MenuLink to="/instaladores" icon={Users} title="Instaladores y profesionales" />
                        </li>
                    </ul>

                    <h3 className={`${headingClass} mt-3 border-t pt-4`}>Categorías</h3>
                    <ul>
                        {categories.map(cat => {
                            const Icon = iconMap[cat.icon] || Lightbulb;
                            return (
                                <li key={cat.id}>
                                    <SheetClose asChild>
                                        <Link
                                            to={`/catalogo/${cat.slug}`}
                                            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                            <span className="min-w-0 flex-1">{cat.name}</span>
                                            <span className="text-xs text-muted-foreground">{cat.productCount}</span>
                                        </Link>
                                    </SheetClose>
                                </li>
                            );
                        })}
                        <li>
                            <SheetClose asChild>
                                <Link to="/catalogo" className="block rounded-md px-3 py-2 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    Ver catálogo completo ({PUBLISHED_PRODUCT_COUNT} productos)
                                </Link>
                            </SheetClose>
                        </li>
                    </ul>
                </nav>
            </SheetContent>
        </Sheet>
    );
};

export default MobileMenu;
