// src/components/request-order/RequestCartDrawer.tsx
// Badge + resumen del Request Cart para el Header.
// El total va en el modo del selector de precios (con IVA, o neto en modo empresa), igual
// que en /solicitar-pedido: nunca suma precios con IVA y netos (auditoría UX, F-01).

import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useRequestCart } from '@/context/RequestCartContext';
import { sendEvent } from '@/lib/analytics';

const RequestCartDrawer = () => {
  const { itemCount, subtotal, netSubtotal } = useRequestCart();
  const { isB2B } = useApp();

  if (itemCount === 0) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0,
    }).format(n);

  const total = isB2B ? `${fmt(netSubtotal)} neto` : fmt(subtotal);

  return (
    <Link
      to="/solicitar-pedido"
      // subtotal CON IVA en Analytics, sea cual sea el modo
      onClick={() => sendEvent('request_cart_view', { itemCount, subtotal })}
    >
      <Button
        variant="outline"
        size="sm"
        className="gap-2 border-primary/40 text-primary hover:bg-accent relative h-9"
      >
        <ClipboardList className="h-4 w-4" />
        <span className="hidden sm:inline text-xs font-medium">
          Solicitud ({itemCount}) · {total}
        </span>
        <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center sm:hidden">
          {itemCount}
        </span>
      </Button>
    </Link>
  );
};

export default RequestCartDrawer;
