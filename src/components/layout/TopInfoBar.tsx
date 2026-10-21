import { Zap } from 'lucide-react';

/**
 * Barra violeta sobre el encabezado.
 *
 * En el teléfono (bajo md) va en 1 línea de exactamente 28 px (h-7, sin saltos): el encabezado
 * es sticky con top -28 px, así que la barra sale de la pantalla al bajar y solo queda fijo
 * el resto (auditoría UX, A-02). Si cambia su alto, cambiar también -top-7 en Header.tsx.
 * Desde md, la barra de siempre, fija con el encabezado.
 */
const TopInfoBar = () => (
  <div className="gradient-primary text-primary-foreground h-7 md:h-auto flex items-center md:block md:py-2 px-4 text-center text-xs md:text-sm font-medium overflow-hidden">
    <div className="container flex items-center justify-center gap-2 min-w-0">
      <Zap className="hidden md:block h-3.5 w-3.5" />
      <span className="md:hidden truncate">Cotización formal · Despacho a todo Chile</span>
      <span className="hidden md:inline">Atención empresas, instaladores y proyectos — Cotización formal y despacho a todo Chile</span>
      <Zap className="hidden md:block h-3.5 w-3.5" />
    </div>
  </div>
);

export default TopInfoBar;
