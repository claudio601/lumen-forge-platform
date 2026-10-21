// src/components/request-order/RequestCartDrawer.tsx
// Puerta «Pedido (n)» del encabezado: lleva a /solicitar-pedido.
// Auditoría UX, F-04: las dos puertas se nombran con palabras, también en el teléfono, y se ven
// siempre, aunque estén en 0: «Cotización (n)» (formal, con RUT) y «Pedido (n)» (compra directa
// con link de pago). Antes, en el teléfono solo había un ícono con un número, y la pastilla
// desaparecía con la solicitud vacía.
// El total va en el modo del selector de precios (con IVA, o neto en modo empresa), igual que en
// /solicitar-pedido: nunca suma precios con IVA y netos (auditoría UX, F-01). Se ve desde xl:
// entre 1024 y 1279 px, con las dos puertas con texto, el total dejaba el buscador sin espacio
// para escribir (a 1024 px y en modo empresa con 40 unidades, 67 px de campo).

import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useRequestCart } from '@/context/RequestCartContext';
import { cn } from '@/lib/utils';
import { trackRequestCartView } from './requestCartAnalytics';

/** Aspecto común de las dos puertas del encabezado (con Button variant="outline" size="sm"). */
export const HEADER_DOOR_CLASS =
  'h-9 gap-1.5 px-3 border-primary/40 text-primary hover:bg-accent hover:text-primary text-sm lg:text-xs font-medium';

const RequestCartDrawer = ({ className }: { className?: string }) => {
  const { itemCount, subtotal, netSubtotal } = useRequestCart();
  const { isB2B } = useApp();

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0,
    }).format(n);

  // Con la solicitud vacía no hay total (así también es en el HTML del servidor).
  const total = itemCount > 0 ? (isB2B ? `${fmt(netSubtotal)} neto` : fmt(subtotal)) : '';

  return (
    <Button asChild variant="outline" size="sm" className={cn(HEADER_DOOR_CLASS, className)}>
      <Link
        to="/solicitar-pedido"
        title="Solicitud de pedido: compra directa, te enviamos el link de pago"
        onClick={() => trackRequestCartView(itemCount, subtotal)}
      >
        <ClipboardList aria-hidden="true" />
        <span>
          Pedido ({itemCount})
          {total && <span className="hidden xl:inline"> · {total}</span>}
        </span>
      </Link>
    </Button>
  );
};

export default RequestCartDrawer;
